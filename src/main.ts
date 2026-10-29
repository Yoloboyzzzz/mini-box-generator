import { DETAIL_STEPS, describeDetail, detailToSlider, sliderToDetail } from './detail';
import { makeNamer, safeFileName } from './filenames';
import { parseSTL, writeSTL } from './geometry/stl';
import { build3MF } from './geometry/threemf';
import { IDENTITY_POSE, poseMesh, type Pose, type Posed } from './geometry/transform';
import { fitsInRect, footprintHull } from './preflight';
import { restoreFrom } from './project';
import { snapshotRun } from './run';
import { LIMITS, clampSetting, describeLimit, sanitizeSettings } from './settings';
import { clearProject, deleteMesh, isQuotaError, loadProject, saveMesh, saveProject, storageAvailable, type SavedProject } from './storage';
import { DEFAULTS, type BoxResult, type Settings } from './types';
import { Viewer } from './viewer';
import type { WorkerRequest, WorkerResponse } from './worker/geometry.worker';

interface Mini { id: number; name: string; src: Float32Array; pose: Pose; posed: Posed; group: number; count: number }
interface Group { id: number; name: string; color: string }
interface GroupResult { group: string; boxes: BoxResult[] }

type Attrs = Record<string, unknown>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k in e) (e as unknown as Attrs)[k] = v;
    else e.setAttribute(k, String(v));
  }
  e.append(...kids);
  return e;
}

// ---------- state ----------
const SETTINGS_KEY = 'minibox.settings.v1';
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return { ...DEFAULTS };
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

const PRESETS_KEY = 'minibox.presets.v1';
function loadPresets(): Record<string, Settings> {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([name, p]) => [name, sanitizeSettings(p)]));
    }
  } catch { /* storage unavailable or corrupt: start empty */ }
  return {};
}
/** Returns false when the browser refused to store the presets. */
function savePresets(p: Record<string, Settings>): boolean {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

const settings = loadSettings();
let presets = loadPresets();
let presetSel = '';
/** A quiet dot per group ties each mini to its group at a glance; the dropdown still names it in words. */
const GROUP_COLORS = ['#3f7fbf', '#2a8f85', '#8460c4', '#c04f78', '#5b9a35', '#8b7355'];
let colorIndex = 0;
const nextGroupColor = () => GROUP_COLORS[colorIndex++ % GROUP_COLORS.length];
const minis: Mini[] = [];
const groups: Group[] = [{ id: 1, name: 'Group 1', color: nextGroupColor() }];
let selected: number | null = null;
let results: GroupResult[] = [];
let shownBox: BoxResult | null = null;
let showLid = true;
let exploded = true;
let busy = false;
let nextId = 2; // the first group has id 1
/** Minis ticked for a bulk "Move to group". */
const checked = new Set<number>();
/** Problems and hints about files that were just added; shown under the drop zone. */
let uploadMessages: { kind: 'error' | 'note'; text: string }[] = [];
const uploadEl = el('div', { class: 'upload-msg', 'aria-live': 'polite' });
/** Set while a job runs; stops the worker. */
let cancelJob: (() => void) | null = null;

const side = document.getElementById('side-body')!;
const sideFoot = document.getElementById('side-foot')!;
const resultsEl = document.getElementById('results')!;
const viewer = new Viewer(document.getElementById('viewer')!);
const statusEl = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
const barFill = el('i');
const bar = el('div', {
  class: 'bar', role: 'progressbar', 'aria-label': 'Generation progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
}, barFill);

const safe = safeFileName;
const fmt = (n: number) => n.toFixed(1);

/** Unique file name per box for this run, shared by the single downloads and the zip. */
const fileBase = new Map<BoxResult, string>();
let nameFor = makeNamer();
function nameFiles(boxes: BoxResult[]) {
  for (const b of boxes) fileBase.set(b, nameFor(b.name));
}

function saveBlob(name: string, data: BlobPart) {
  const a = el('a', { href: URL.createObjectURL(new Blob([data])), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function setStatus(msg: string, fraction?: number, warn = false) {
  const f = fraction === undefined ? 0 : Math.min(1, Math.max(0, fraction));
  statusEl.textContent = msg;
  statusEl.className = 'status' + (warn ? ' warn' : '');
  barFill.style.transform = `scaleX(${f})`;
  bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
}

// ---------- minis ----------
const MAX_FILE_BYTES = 150e6;

interface UploadMessage { kind: 'error' | 'note'; text: string }
/** A problem with one file, already worded for the user. */
class FileProblem extends Error {}

/** Shown right under the drop zone, where the user just acted, not in the footer. */
function renderUploadMsg() {
  uploadEl.replaceChildren();
  if (!uploadMessages.length) return;
  for (const m of uploadMessages.slice(0, 5)) uploadEl.append(el('p', { class: m.kind }, m.text));
  if (uploadMessages.length > 5) uploadEl.append(el('p', {}, `and ${uploadMessages.length - 5} more.`));
  uploadEl.append(el('button', { class: 'link', onclick: () => {
    uploadMessages = [];
    renderUploadMsg();
    document.querySelector<HTMLElement>('.drop')?.focus();
  } }, 'Dismiss'));
}

async function addFiles(files: FileList | File[]) {
  // Copy the list first: the file input is cleared right after this is called, and a FileList is live.
  const incoming = Array.from(files);
  await restoreDone; // never mix new files into a half-restored project
  const msgs: UploadMessage[] = [];
  const fail = (name: string, rest: string) => msgs.push({ kind: 'error', text: `${name} ${rest}` });
  for (const f of incoming) {
    if (!/\.stl$/i.test(f.name)) { fail(f.name, 'is not an STL file. Export the model as .stl and add it again.'); continue; }
    if (f.size > MAX_FILE_BYTES) { fail(f.name, `is larger than ${MAX_FILE_BYTES / 1e6} MB. Export a lower-resolution STL and add it again.`); continue; }
    try {
      const src = parseSTL(await f.arrayBuffer());
      if (src.length === 0) throw new FileProblem('has no geometry. Re-export it from your modelling tool.');
      const pose = { ...IDENTITY_POSE };
      const posed = poseMesh(src, pose);
      if (!posed.size.every(Number.isFinite)) throw new FileProblem('contains invalid numbers. Re-export it from your modelling tool.');
      const longest = Math.max(...posed.size);
      if (longest < 5 || longest > 400) {
        msgs.push({ kind: 'note', text: `${f.name} was added, but it is ${trim(longest)} mm at its longest. If it isn’t in millimetres, set Scale in Orientation.` });
      }
      const mini: Mini = { id: nextId++, name: f.name.replace(/\.stl$/i, '') || 'mini', src, pose, posed, group: groups[0].id, count: 1 };
      minis.push(mini);
      void persistMesh(mini);
      selectMini(mini.id);
    } catch (err) {
      fail(f.name, err instanceof FileProblem ? err.message : 'couldn’t be read as an STL (binary or ASCII). Re-export it from your modelling tool.');
    }
  }
  uploadMessages = msgs;
  renderUploadMsg();
  renderSide();
}

function selectMini(id: number | null) {
  selected = id;
  shownBox = null;
  const m = minis.find((x) => x.id === id);
  viewer.showMini(m ? m.posed.tris : null);
}

function repose(m: Mini) {
  m.posed = poseMesh(m.src, m.pose);
  if (selected === m.id) viewer.showMini(m.posed.tris);
}

// ---------- keeping your minis in this browser ----------
// IndexedDB, on this device only. Without it every reload meant uploading 20 big files again.
let projectReady = false;
let restoreDone: Promise<void> = Promise.resolve();
let confirmingStartOver = false;
/** One entry per mini (or -1 for the project itself) that could not be saved, so the user is told. */
const saveProblems = new Map<number, string>();
const saveEl = el('div', { class: 'save-note', 'aria-live': 'polite' });

/** Saves run one after another, so a delete can never overtake the save it follows. */
let ioQueue: Promise<unknown> = Promise.resolve();
const inQueue = (job: () => Promise<void>): Promise<void> => {
  const next = ioQueue.then(job, job);
  ioQueue = next;
  return next;
};

function renderSaveNote() {
  saveEl.replaceChildren();
  if (minis.length === 0 && saveProblems.size === 0) return;
  if (!storageAvailable()) {
    saveEl.append(el('p', { class: 'problem' }, 'This browser can’t keep your minis, so they will be gone after a reload.'));
    return;
  }
  for (const text of saveProblems.values()) saveEl.append(el('p', { class: 'problem' }, text));
  const saved = minis.filter((m) => !saveProblems.has(m.id));
  const bytes = saved.reduce((n, m) => n + m.src.byteLength, 0);
  if (saved.length) saveEl.append(el('p', {}, `Saved on this device: ${plural(saved.length, 'mini')}, ${sizeLabel2(bytes)}.`));
  saveEl.append(el('button', { class: 'link', onclick: () => {
    if (!confirmingStartOver) {
      confirmingStartOver = true;
      renderSaveNote();
      saveEl.querySelector('button')?.focus();
      window.setTimeout(() => { confirmingStartOver = false; renderSaveNote(); }, 4000);
      return;
    }
    confirmingStartOver = false;
    void startOver();
  } }, confirmingStartOver ? 'Click again to remove all minis' : 'Start over'));
}

function persistMesh(m: Mini): Promise<void> {
  if (!storageAvailable()) { renderSaveNote(); return Promise.resolve(); }
  return inQueue(async () => {
    try {
      await saveMesh(m.id, m.src);
      saveProblems.delete(m.id);
    } catch (err) {
      saveProblems.set(m.id, isQuotaError(err)
        ? `Not enough browser storage to keep “${m.name}”. It will be gone after a reload.`
        : `Could not save “${m.name}”: ${err instanceof Error ? err.message : err}`);
    }
    renderSaveNote();
  });
}

function forgetMesh(id: number) {
  saveProblems.delete(id);
  if (storageAvailable()) void inQueue(async () => { try { await deleteMesh(id); } catch { /* nothing left to clean up */ } });
  renderSaveNote();
}

let saveTimer = 0;
function flushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  const project: SavedProject = {
    version: 1, savedAt: Date.now(), nextId, colorIndex,
    groups: groups.map((g) => ({ ...g })),
    minis: minis.map((m) => ({ id: m.id, name: m.name, pose: { ...m.pose }, group: m.group, count: m.count })),
  };
  void inQueue(async () => {
    try {
      await saveProject(project);
      saveProblems.delete(-1);
    } catch (err) {
      saveProblems.set(-1, `Could not save your project: ${err instanceof Error ? err.message : err}`);
    }
    renderSaveNote();
  });
}

/** Called after anything that changes the project; writes a moment later so typing does not hammer the disk. */
function scheduleSave() {
  if (!projectReady || !storageAvailable()) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 400);
}

// Closing the tab right after an edit must not lose that edit.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) flushSave();
});

async function restoreProject() {
  try {
    if (!storageAvailable()) return;
    const { project, meshes } = await loadProject();
    if (!project) return;
    const restored = restoreFrom(project, meshes);
    groups.splice(0, groups.length, ...restored.groups);
    colorIndex = restored.colorIndex;
    const lost = [...restored.lost];
    for (const m of restored.minis) {
      const posed = poseMesh(m.src, m.pose);
      if (!posed.size.every(Number.isFinite)) { lost.push(m.name); continue; }
      minis.push({ id: m.id, name: m.name, src: m.src, pose: m.pose, posed, group: m.group, count: m.count });
    }
    nextId = Math.max(nextId, restored.nextId);
    renderSide();
    if (minis.length) setStatus(`Restored ${plural(minis.length, 'mini')} from your last session.`);
    if (lost.length) {
      setStatus(`Restored ${plural(minis.length, 'mini')}. ${lost.slice(0, 3).join(', ')}${lost.length > 3 ? ` and ${lost.length - 3} more` : ''} could not be loaded; add ${lost.length === 1 ? 'it' : 'them'} again.`, undefined, true);
    }
    if (restored.repaired || lost.length) flushSave(); // write the corrected project back
  } catch (err) {
    setStatus(`Could not restore your saved minis: ${err instanceof Error ? err.message : err}`, undefined, true);
  } finally {
    projectReady = true;
    renderSaveNote();
  }
}

async function startOver() {
  if (busy) { setStatus('Cancel the running job first, then start over.', undefined, true); return; }
  minis.length = 0;
  checked.clear();
  selectMini(null);
  groups.splice(0, groups.length, { id: nextId++, name: 'Group 1', color: nextGroupColor() });
  results = [];
  shownBox = null;
  fileBase.clear();
  uploadMessages = [];
  renderUploadMsg();
  renderResults();
  saveProblems.clear();
  window.clearTimeout(saveTimer);
  await inQueue(async () => {
    try { await clearProject(); } catch (err) { saveProblems.set(-1, `Could not clear the saved minis: ${err instanceof Error ? err.message : err}`); }
  });
  renderSide();
  setStatus('Started over. Your saved minis were removed from this browser.');
}

// ---------- side panel ----------
/** A number field that reverts to its last good value when cleared or left invalid. */
function numberInput(value: number, step: number, onChange: (v: number, input: HTMLInputElement) => void, attrs: Attrs = {}): HTMLInputElement {
  const input = el('input', {
    type: 'number', value: String(value), step: String(step), ...attrs,
    onchange: (e: Event) => {
      const field = e.target as HTMLInputElement;
      const v = parseFloat(field.value);
      if (Number.isFinite(v)) {
        onChange(v, field);
        field.dataset.good = field.value;
      } else {
        field.value = field.dataset.good ?? String(value);
      }
    },
  });
  input.dataset.good = String(value);
  return input;
}

type Field = [keyof Settings, string, number, string];
interface FieldGroup { title: string; hint?: string; fields: Field[] }

const SETTINGS_PRIMARY: FieldGroup[] = [
  { title: 'Fit', hint: 'Clearance is the gap around each mini. The 0.2 mm default allows for a printer that isn’t very accurate. Raise it if minis jam, lower it if they rattle.', fields: [
    ['tolerance', 'Clearance around mini', 0.05, 'mm'],
    ['floor', 'Floor under tallest mini', 0.1, 'mm'],
  ] },
  { title: 'Printer', fields: [
    ['bedX', 'Bed X', 5, 'mm'],
    ['bedY', 'Bed Y', 5, 'mm'],
  ] },
];

const SETTINGS_ADVANCED: FieldGroup[] = [
  { title: 'Precision', fields: [
    ['cell', 'Raster cell (smaller = tighter, bigger files)', 0.05, 'mm'],
    ['zStep', 'Floor height step', 0.05, 'mm'],
  ] },
  { title: 'Walls', fields: [
    ['wall', 'Wall between minis', 0.1, 'mm'],
    ['outerWall', 'Outer wall', 0.1, 'mm'],
    ['minPillar', 'Remove free-standing pillars smaller than (0 = keep)', 1, 'mm²'],
    ['pillarLowering', 'Lower remaining free-standing pillars by (0 = full height)', 1, 'mm'],
  ] },
  { title: 'Lid', fields: [
    ['lidClearance', 'Lid clearance per side', 0.05, 'mm'],
    ['lidWall', 'Lid wall', 0.1, 'mm'],
    ['lidCeiling', 'Lid ceiling', 0.1, 'mm'],
    ['skirtGap', 'Skirt stops short of base', 0.1, 'mm'],
    ['chamfer', 'Lead-in chamfer', 0.1, 'mm'],
    ['fingerNotch', 'Finger notch radius (0 = none)', 1, 'mm'],
  ] },
  { title: 'Packing', fields: [
    ['rotStep', 'Rotation step', 5, '°'],
    ['nestCell', 'Packing grid', 0.1, 'mm'],
    ['effort', 'Nesting effort (1-3)', 1, ''],
  ] },
];

/** Open/closed state of the settings disclosures survives the full re-render. */
let settingsOpen = false;
let advancedOpen = false;

const trim = (n: number) => String(+n.toFixed(2));

function settingsSummary(): string {
  const parts = [`${trim(settings.tolerance)} mm clearance`, `${trim(settings.bedX)} × ${trim(settings.bedY)} bed`];
  return presetSel ? [presetSel, ...parts].join(' · ') : parts.join(' · ');
}

function disclosure(title: string, summary: string, open: boolean, onToggle: (open: boolean) => void, cls: string, ...body: (Node | string)[]) {
  const d = el('details', { class: `disc ${cls}`, open },
    el('summary', {}, el('span', { class: 'disc-title' }, title), summary ? el('span', { class: 'disc-sum' }, summary) : ''),
    el('div', { class: 'disc-body' }, ...body));
  d.addEventListener('toggle', () => onToggle(d.open));
  return d;
}

/** The native stepper counts from `min`, so only pass it when it sits on the step grid. */
const onStepGrid = (min: number, step: number) => Math.abs(min / step - Math.round(min / step)) < 1e-9;

function fieldGroup(g: FieldGroup): HTMLElement {
  return el('section', { class: 'fields' }, el('h3', { class: 'sub' }, g.title), ...(g.hint ? [el('div', { class: 'note' }, g.hint)] : []),
    ...g.fields.map(([key, label, step, unit]) => {
      const lim = LIMITS[key];
      const id = `f-${key}`;
      const input = numberInput(settings[key], step, (v, field) => {
        const c = clampSetting(key, v);
        if (c !== v) {
          field.value = String(c);
          setStatus(`${describeLimit(key)}.`, undefined, true);
        }
        settings[key] = c;
        saveSettings();
        renderFoot();
      }, {
        id,
        max: String(lim.max),
        ...(onStepGrid(lim.min, step) ? { min: String(lim.min) } : {}),
        ...(unit ? { 'aria-describedby': `u-${key}` } : {}),
      });
      return el('div', { class: 'row' }, el('label', { htmlFor: id }, label), input, el('span', { class: 'unit', id: `u-${key}` }, unit));
    }));
}

/** One slider for how closely the floor under each mini follows its underside: right = exact (largest files), left = smallest files. */
function detailSlider(): HTMLElement {
  const readout = el('div', { class: 'note', id: 'detail-readout' }, describeDetail(settings.floorSimplify));
  const slider = el('input', {
    type: 'range', id: 'detail-slider', min: '0', max: String(DETAIL_STEPS), step: '1',
    value: String(detailToSlider(settings.floorSimplify)), 'aria-describedby': 'detail-readout',
    oninput: (e: Event) => {
      const mm = sliderToDetail(+(e.target as HTMLInputElement).value);
      settings.floorSimplify = mm;
      readout.textContent = describeDetail(mm);
      (e.target as HTMLInputElement).setAttribute('aria-valuetext', describeDetail(mm));
      saveSettings();
    },
  });
  slider.setAttribute('aria-valuetext', describeDetail(settings.floorSimplify));
  return el('section', { class: 'fields' },
    el('h3', { class: 'sub' }, 'Detail'),
    el('div', { class: 'note' }, 'Higher detail follows every part of each mini’s underside but makes much larger files. The walls and the fit around the mini are the same at every setting.'),
    el('label', { htmlFor: 'detail-slider', class: 'detail-label' }, 'Model detail'),
    slider,
    el('div', { class: 'detail-ends' }, el('span', {}, 'Smaller files'), el('span', {}, 'Highest detail')),
    readout);
}

function presetBlock(): HTMLElement {
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  const nameInput = el('input', { placeholder: 'Name this preset', value: presetSel, maxLength: 60, 'aria-label': 'Preset name' });
  const pick = el('select', { 'aria-label': 'Saved presets', onchange: (e: Event) => {
    presetSel = (e.target as HTMLSelectElement).value;
    nameInput.value = presetSel;
    if (!presetSel || !Object.hasOwn(presets, presetSel)) { renderSide(); return; }
    Object.assign(settings, sanitizeSettings(presets[presetSel]));
    saveSettings();
    renderSide();
    setStatus(`Loaded preset “${presetSel}”.`);
  } },
  el('option', { value: '' }, names.length ? '— saved presets —' : '— none saved yet —'),
  ...names.map((n) => el('option', { value: n, selected: n === presetSel }, n)));
  return el('div', { class: 'presets' },
    el('div', { class: 'row' }, pick,
      el('button', { class: 'icon', disabled: !presetSel, title: 'Delete this preset', 'aria-label': 'Delete this preset', onclick: () => {
        const { [presetSel]: _gone, ...rest } = presets;
        void _gone;
        presets = rest;
        const ok = savePresets(presets);
        const name = presetSel;
        presetSel = '';
        renderSide();
        setStatus(ok ? `Deleted preset “${name}”.` : 'Could not update browser storage.', undefined, !ok);
      } }, '✕')),
    el('div', { class: 'row' }, nameInput,
      el('button', { onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { setStatus('Enter a name for the preset.', undefined, true); return; }
        presets = { ...presets, [name]: { ...settings } };
        const ok = savePresets(presets);
        presetSel = name;
        renderSide();
        setStatus(ok ? `Saved preset “${name}” in this browser.` : 'Could not save: browser storage is unavailable.', undefined, !ok);
      } }, 'Save')),
    el('button', { class: 'link', onclick: () => {
      Object.assign(settings, DEFAULTS);
      presetSel = '';
      saveSettings();
      renderSide();
      setStatus('Settings reset to defaults.');
    } }, 'Reset to defaults'));
}

const FOCUSABLE = 'button, input, select, summary';
interface FocusMark { host: HTMLElement; index: number }

/** A re-render replaces every control; remember which one had focus (by position) so keyboard users keep their place. */
function captureFocus(host: HTMLElement): FocusMark | null {
  const active = document.activeElement;
  if (!active || !host.contains(active)) return null;
  const index = [...host.querySelectorAll(FOCUSABLE)].indexOf(active);
  return index < 0 ? null : { host, index };
}

function restoreFocus(mark: FocusMark | null) {
  if (!mark) return;
  const all = mark.host.querySelectorAll<HTMLElement>(FOCUSABLE);
  all[Math.min(mark.index, all.length - 1)]?.focus({ preventScroll: true });
}

/**
 * Edits that fire on blur (quantity, rotation, group name) must not rebuild the panel: the rebuild lands
 * between mouse-down and mouse-up on whatever the user clicked next, and swallows that click.
 * They update just the text that changed.
 */
const groupColor = (id: number) => groups.find((g) => g.id === id)?.color ?? GROUP_COLORS[0];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const groupCount = (g: Group) => minis.filter((m) => m.group === g.id).reduce((n, m) => n + m.count, 0);
const sizeLabel = (m: Mini, digits: number) => `${m.posed.size.map((v) => v.toFixed(digits)).join(' × ')} mm`;

function refreshCounts() {
  scheduleSave();
  renderFoot();
  const spans = side.querySelectorAll<HTMLElement>('.group .count');
  groups.forEach((g, i) => { if (spans[i]) spans[i].textContent = plural(groupCount(g), 'mini'); });
}

function refreshDims(m: Mini) {
  scheduleSave();
  renderFoot();
  const el = side.querySelector<HTMLElement>('.mini.sel .dims');
  if (!el) return;
  el.textContent = sizeLabel(m, 0);
  el.title = sizeLabel(m, 1);
}

function refreshGroupNames() {
  scheduleSave();
  for (const o of side.querySelectorAll<HTMLOptionElement>('.mini select.grp option, .bulk select option')) {
    const g = groups.find((x) => String(x.id) === o.value);
    if (g) o.textContent = g.name;
  }
}

/**
 * Orientation lives right under the mini it belongs to, in two compact rows, so selecting a mini changes
 * the layout only where the user just clicked instead of relocating a tall editor below the whole list.
 */
function orientationPanel(m: Mini): HTMLElement {
  const axes = ['rx', 'ry', 'rz'] as const;
  const cells = axes.map((axis) => {
    const letter = axis.slice(1).toUpperCase();
    const input = numberInput(m.pose[axis], 1, (v) => { m.pose[axis] = v; repose(m); refreshDims(m); }, { id: `o-${axis}` });
    return el('div', { class: 'cell' }, el('label', { htmlFor: `o-${axis}` }, `Rotate ${letter} (°)`), input);
  });
  const scale = el('div', { class: 'cell' }, el('label', { htmlFor: 'o-scale' }, 'Scale (%)'),
    numberInput(m.pose.scale * 100, 1, (v, field) => {
      const c = Math.min(1000, Math.max(1, v));
      if (c !== v) {
        field.value = String(c);
        setStatus('Scale must be between 1 and 1000 %.', undefined, true);
      }
      m.pose.scale = c / 100;
      repose(m);
      refreshDims(m);
    }, { id: 'o-scale', min: '1', max: '1000' }));
  const turns = axes.map((axis) => el('button', {
    'aria-label': `Turn ${m.name} 90 degrees around ${axis.slice(1).toUpperCase()}`,
    onclick: () => { m.pose[axis] = (m.pose[axis] + 90) % 360; repose(m); renderSide(); },
  }, '+90°'));
  const reset = el('button', {
    'aria-label': `Reset orientation and scale of ${m.name}`,
    onclick: () => { m.pose = { ...IDENTITY_POSE }; repose(m); renderSide(); },
  }, 'Reset');
  return el('div', { class: 'orient', role: 'group', 'aria-label': `Orientation of ${m.name}` },
    el('div', { class: 'orient-grid' }, ...cells, scale, ...turns, reset),
    el('div', { class: 'note' }, 'Set how the mini stands in its box. The app only turns minis around Z to nest them.'));
}

function renderSide() {
  renderSaveNote();
  const scroll = side.scrollTop;
  const focus = captureFocus(side);
  side.replaceChildren();
  side.append(el('h1', {}, 'Mini Box Generator'));

  // library: a real button, so keyboard and screen-reader users can add files; the file input itself stays hidden
  const fileInput = el('input', { type: 'file', accept: '.stl', multiple: true, hidden: true, onchange: () => {
    if (fileInput.files) void addFiles(fileInput.files);
    fileInput.value = ''; // picking the same file again must fire change again
  } });
  const drop = el('button', { type: 'button', class: 'drop', 'aria-describedby': 'units-note' }, 'Drop STL files here or click to browse');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) void addFiles(e.dataTransfer.files);
  });
  const allPicked = minis.length > 0 && checked.size === minis.length;
  side.append(
    el('div', { class: 'sec-head' }, el('h2', {}, 'Minis'),
      minis.length > 1
        ? el('button', { class: 'link', onclick: () => {
          if (allPicked) checked.clear(); else for (const m of minis) checked.add(m.id);
          renderSide();
        } }, allPicked ? 'Clear selection' : 'Select all')
        : ''),
    drop, fileInput,
    el('div', { class: 'note trust' }, 'Runs in your browser. Your files never leave this device.'),
    el('div', { class: 'note', id: 'units-note' }, 'Units are taken as millimetres. Pre-supported STLs will get cavities for their supports, so use the bare model.'),
    uploadEl, saveEl);

  if (checked.size > 0) {
    const target = el('select', { 'aria-label': 'Move selected minis to group' },
      ...groups.map((g) => el('option', { value: String(g.id) }, g.name)));
    side.append(el('div', { class: 'bulk' },
      el('span', {}, `${checked.size} selected`), el('span', { class: 'spacer' }), target,
      el('button', { onclick: () => {
        for (const m of minis) if (checked.has(m.id)) m.group = +target.value;
        checked.clear();
        renderSide();
      } }, 'Move'),
      el('button', { onclick: () => { checked.clear(); renderSide(); } }, 'Clear')));
  }

  const list = el('div', { class: 'mini-list' });
  for (const m of minis) {
    const stop = (e: Event) => e.stopPropagation();
    const choose = () => { selectMini(m.id); renderSide(); };
    const dot = el('span', { class: 'gdot', 'aria-hidden': 'true', style: `background:${groupColor(m.group)}` });
    const sel = el('select', { class: 'grp', 'aria-label': `Group for ${m.name}`, onchange: (e: Event) => {
      m.group = +(e.target as HTMLSelectElement).value;
      dot.style.background = groupColor(m.group);
      refreshCounts();
    } },
      ...groups.map((g) => el('option', { value: String(g.id), selected: g.id === m.group }, g.name)));
    sel.addEventListener('click', stop);
    const del = el('button', { class: 'icon', title: `Remove ${m.name}`, 'aria-label': `Remove ${m.name}`, onclick: (e: Event) => {
      stop(e);
      minis.splice(minis.indexOf(m), 1);
      checked.delete(m.id);
      forgetMesh(m.id);
      if (selected === m.id) selectMini(null);
      renderSide();
    } }, '✕');
    const qty = el('input', {
      type: 'number', min: '1', max: '99', step: '1', value: String(m.count), title: 'Copies in the box', 'aria-label': `Copies of ${m.name}`, class: 'qty',
      onchange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        const v = Math.round(parseFloat(input.value));
        m.count = Number.isFinite(v) ? Math.min(99, Math.max(1, v)) : 1;
        input.value = String(m.count);
        refreshCounts();
      },
    });
    qty.addEventListener('click', stop);
    const pick = el('input', {
      type: 'checkbox', class: 'pick', checked: checked.has(m.id), 'aria-label': `Select ${m.name} for bulk move`,
      onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) checked.add(m.id); else checked.delete(m.id);
        renderSide();
      },
    });
    pick.addEventListener('click', stop);
    const nameBtn = el('button', {
      class: 'mini-name', title: m.name,
      ...(m.id === selected ? { 'aria-current': 'true' } : {}),
      onclick: (e: Event) => { stop(e); choose(); },
    }, m.name);
    list.append(el('div', { class: 'mini' + (m.id === selected ? ' sel' : ''), onclick: choose },
      pick, nameBtn, del,
      el('div', { class: 'meta' },
        el('span', { class: 'dims', title: sizeLabel(m, 1) }, sizeLabel(m, 0)),
        el('div', { class: 'ctl' }, el('span', { class: 'times', 'aria-hidden': 'true' }, '×'), qty, dot, sel))));
    if (m.id === selected) list.append(orientationPanel(m));
  }
  side.append(list);

  // groups
  side.append(el('h2', {}, 'Groups (one box set each)'));
  groups.forEach((g, i) => {
    side.append(el('div', { class: 'group' },
      el('span', { class: 'gdot', 'aria-hidden': 'true', style: `background:${g.color}` }),
      el('input', { value: g.name, maxLength: 60, 'aria-label': `Name of group ${i + 1}`, onchange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        g.name = input.value.trim() || g.name;
        input.value = g.name;
        refreshGroupNames();
      } }),
      el('span', { class: 'note count' }, plural(groupCount(g), 'mini')),
      el('button', { class: 'icon', title: `Delete ${g.name}`, 'aria-label': `Delete ${g.name}`, disabled: groups.length === 1, onclick: () => {
        groups.splice(groups.indexOf(g), 1);
        for (const m of minis) if (m.group === g.id) m.group = groups[0].id;
        renderSide();
      } }, '✕')));
  });

  // naming a group as it is created saves renaming it afterwards; Enter adds, and focus stays for the next one
  const nameField = el('input', { placeholder: 'New group name', maxLength: 60, 'aria-label': 'New group name' });
  const addGroup = () => {
    groups.push({ id: nextId++, name: nameField.value.trim() || `Group ${groups.length + 1}`, color: nextGroupColor() });
    renderSide();
    side.querySelector<HTMLInputElement>('.add-group input')?.focus({ preventScroll: true });
  };
  nameField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGroup(); }
  });
  side.append(el('div', { class: 'add-group' }, nameField, el('button', { onclick: addGroup }, 'Add group')));

  // print settings: secondary to the add -> group -> generate path, so one quiet row until opened
  side.append(disclosure('Print settings', settingsSummary(), settingsOpen, (o) => { settingsOpen = o; }, 'top',
    presetBlock(),
    ...SETTINGS_PRIMARY.map(fieldGroup),
    detailSlider(),
    disclosure('Advanced', '', advancedOpen, (o) => { advancedOpen = o; }, 'nested', ...SETTINGS_ADVANCED.map(fieldGroup))));

  renderFoot();
  side.scrollTop = scroll;
  restoreFocus(focus);
  scheduleSave();
}

/**
 * The commit action lives outside the scrolling body, and is never rebuilt, so a click on it always lands.
 * While a job runs the same button becomes Cancel, so focus stays where the user put it.
 */
const preflightEl = el('div', { class: 'preflight', 'aria-live': 'polite', hidden: true });
const summaryEl = el('div', { class: 'summary' });
const generateBtn = el('button', { class: 'primary', onclick: () => (busy ? cancelJob?.() : void generate()) });
sideFoot.append(preflightEl, summaryEl, generateBtn, statusEl, bar);

/** Footprint hull per posed mesh: computed once, then the bed check stays cheap while typing. */
const hullCache = new WeakMap<Float32Array, Float32Array>();
function hullOf(m: Mini): Float32Array {
  let h = hullCache.get(m.posed.tris);
  if (!h) {
    h = footprintHull(m.posed.tris);
    hullCache.set(m.posed.tris, h);
  }
  return h;
}

/** Minis that fit the bed at no rotation, once walls, lid and clearance are counted (a lower bound: no false alarms). */
function tooBigForBed(): Mini[] {
  const margin = 2 * (settings.lidClearance + settings.lidWall + settings.outerWall + settings.tolerance);
  return minis.filter((m) => !fitsInRect(hullOf(m), settings.bedX - margin, settings.bedY - margin));
}

function renderFoot() {
  const total = minis.reduce((n, m) => n + m.count, 0);
  const used = groups.filter((g) => minis.some((m) => m.group === g.id)).length;

  const big = tooBigForBed();
  preflightEl.hidden = big.length === 0;
  if (big.length) {
    const bed = `${trim(settings.bedX)} × ${trim(settings.bedY)} mm`;
    const names = big.slice(0, 3).map((m) => m.name).join(', ') + (big.length > 3 ? ` and ${big.length - 3} more` : '');
    preflightEl.textContent = big.length === 1
      ? `${names} is too large for the ${bed} print bed once walls and lid are added. Check the bed size in Print settings, or reduce its Scale.`
      : `${big.length} minis are too large for the ${bed} print bed once walls and lid are added: ${names}. Check the bed size in Print settings, or reduce their Scale.`;
  }

  summaryEl.textContent = busy
    ? 'Working on your device. Changes you make now apply to the next run. You can cancel at any time.'
    : minis.length === 0 ? 'Add an STL to get started.' : `${plural(total, 'mini')} in ${plural(used, 'group')}`;
  generateBtn.disabled = !busy && minis.length === 0;
  generateBtn.textContent = busy ? 'Cancel' : 'Generate boxes';
  generateBtn.classList.toggle('cancel', busy);
  if (busy) generateBtn.setAttribute('aria-label', 'Cancel generating boxes'); else generateBtn.removeAttribute('aria-label');
}

// ---------- generation ----------
class Cancelled extends Error {}

function runJob(worker: Worker, req: WorkerRequest): Promise<BoxResult[]> {
  return new Promise((resolve, reject) => {
    cancelJob = () => {
      worker.terminate();
      reject(new Cancelled('cancelled'));
    };
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') setStatus(msg.message, msg.fraction);
      else if (msg.type === 'result') resolve(msg.boxes);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(req);
  });
}

async function generate() {
  if (busy) return; // a double click or Enter-repeat must not start a second job
  busy = true;
  results = [];
  shownBox = null;
  fileBase.clear();
  nameFor = makeNamer();
  renderSide();
  renderResults();
  // Everything this run needs is copied now. The sidebar stays editable while it works, and those edits
  // apply to the next run; they must not reach the groups of this run that have not been built yet.
  const jobs = snapshotRun(groups, minis);
  const runSettings = sanitizeSettings(settings);
  const worker = new Worker(new URL('./worker/geometry.worker.ts', import.meta.url), { type: 'module' });
  try {
    let id = 0;
    for (const job of jobs) {
      const boxes = await runJob(worker, { id: id++, groupName: job.name, minis: job.minis, settings: runSettings });
      nameFiles(boxes);
      results.push({ group: job.name, boxes });
      renderResults();
      if (!shownBox) showBox(boxes[0]);
    }
    const n = results.reduce((sum, r) => sum + r.boxes.length, 0);
    setStatus(`${n} ${n === 1 ? 'box' : 'boxes'} ready. Preview and download below the 3D view.`, 1);
  } catch (err) {
    if (err instanceof Cancelled) {
      setStatus(results.length ? 'Cancelled. Boxes that were already finished are kept below.' : 'Cancelled.');
    } else {
      setStatus(err instanceof Error ? err.message : String(err), undefined, true);
    }
  } finally {
    worker.terminate();
    cancelJob = null;
    busy = false;
    renderSide();
  }
}

// ---------- results ----------
function showBox(b: BoxResult) {
  shownBox = b;
  selected = null;
  viewer.showBox(b, exploded, showLid);
  renderResults();
}

/** 3MF is a compressed container that slicers open directly; STL is kept for tools that only read STL. */
type ExportFormat = '3mf' | 'stl';
const FORMAT_KEY = 'minibox.format.v1';
function loadFormat(): ExportFormat {
  try { if (localStorage.getItem(FORMAT_KEY) === 'stl') return 'stl'; } catch { /* storage unavailable: use the default */ }
  return '3mf';
}
let format: ExportFormat = loadFormat();

const triCount = (tris: Float32Array) => tris.length / 9;
const stlMB = (tris: Float32Array) => ((triCount(tris) * 50 + 84) / 1e6).toFixed(1);
const triLabel = (tris: Float32Array) => {
  const n = triCount(tris);
  return n >= 10000 ? `${Math.round(n / 1000)}k triangles` : `${n} triangles`;
};
const sizeLabel2 = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** Lets the "Preparing…" status paint before a long synchronous build starts. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function exportPart(b: BoxResult, kind: 'box' | 'lid'): Promise<{ name: string; data: Blob | ArrayBuffer }> {
  const base = fileBase.get(b) ?? safe(b.name);
  const tris = kind === 'box' ? b.box : b.lid;
  if (format === 'stl') return { name: `${base}_${kind}.stl`, data: writeSTL(tris) };
  return { name: `${base}_${kind}.3mf`, data: await build3MF([{ name: `${b.name} ${kind}`, tris }]) };
}

async function downloadPart(b: BoxResult, kind: 'box' | 'lid') {
  setStatus(`Preparing the ${kind} file…`);
  await nextFrame();
  try {
    const file = await exportPart(b, kind);
    saveBlob(file.name, file.data);
    setStatus(`Saved ${file.name} (${sizeLabel2(file.data instanceof Blob ? file.data.size : file.data.byteLength)}).`);
  } catch (err) {
    setStatus(`Could not prepare the ${kind} file: ${err instanceof Error ? err.message : err}`, undefined, true);
  }
}

/** Says what happened to the finger notches, only when something is worth saying. */
function notchNote(b: BoxResult): string {
  if (b.fingerNotchWanted <= 0) return '';
  if (b.fingerNotch <= 0) return ' · no finger notches: the lid is too small for them';
  const reduced = b.fingerNotch < b.fingerNotchWanted - 0.05 ? ' (reduced to fit)' : '';
  return ` · lid finger notches ${fmt(b.fingerNotch * 2)} mm wide${reduced}`;
}

function renderResults() {
  resultsEl.replaceChildren();
  if (!results.length) return;
  const toggle = (label: string, value: boolean, on: (v: boolean) => void) =>
    el('label', {}, el('input', { type: 'checkbox', checked: value, onchange: (e: Event) => { on((e.target as HTMLInputElement).checked); if (shownBox) viewer.showBox(shownBox, exploded, showLid); } }), ` ${label}`);
  const formatSelect = el('select', { 'aria-label': 'Download format', onchange: (e: Event) => {
    format = (e.target as HTMLSelectElement).value === 'stl' ? 'stl' : '3mf';
    try { localStorage.setItem(FORMAT_KEY, format); } catch { /* ignore */ }
    renderResults();
  } },
  el('option', { value: '3mf', selected: format === '3mf' }, '3MF (smaller)'),
  el('option', { value: 'stl', selected: format === 'stl' }, 'STL'));
  const ext = format.toUpperCase();
  resultsEl.append(el('div', { class: 'toolbar' },
    el('button', { onclick: () => void downloadAll() }, 'Download all (.zip)'),
    el('label', {}, 'Format ', formatSelect),
    toggle('Show lid', showLid, (v) => (showLid = v)),
    toggle('Exploded', exploded, (v) => (exploded = v))));
  for (const r of results) {
    for (const b of r.boxes) {
      resultsEl.append(el('div', { class: 'card' },
        el('strong', {}, b.name),
        el('div', { class: 'actions' },
          el('button', { 'aria-pressed': String(b === shownBox), 'aria-label': `View ${b.name} in 3D`, onclick: () => showBox(b) }, b === shownBox ? 'Viewing' : 'View'),
          el('button', { 'aria-label': `Download box ${ext} for ${b.name}`, onclick: () => void downloadPart(b, 'box') }, `Box ${ext}`),
          el('button', { 'aria-label': `Download lid ${ext} for ${b.name}`, onclick: () => void downloadPart(b, 'lid') }, `Lid ${ext}`)),
        el('div', { class: 'meta' },
          `${fmt(b.width)} × ${fmt(b.depth)} × ${fmt(b.height)} mm box · lid ${fmt(b.lidHeight)} mm tall · ${b.miniCount} mini${b.miniCount === 1 ? '' : 's'}: ${b.minis.join(', ')}`,
          b.oversize ? ' ⚠ larger than the print bed' : '',
          notchNote(b),
          ` · box ${triLabel(b.box)} (${stlMB(b.box)} MB as STL)`)));
    }
  }
}

async function downloadAll() {
  setStatus('Preparing the zip…');
  await nextFrame();
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    // STL compresses about 6x; a 3MF is already compressed, so it is stored as is.
    const compression = format === 'stl' ? 'DEFLATE' : 'STORE';
    for (const r of results) {
      for (const b of r.boxes) {
        for (const kind of ['box', 'lid'] as const) {
          const file = await exportPart(b, kind);
          zip.file(file.name, file.data, { compression });
        }
      }
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    saveBlob('mini_boxes.zip', blob);
    setStatus(`Saved mini_boxes.zip (${sizeLabel2(blob.size)}).`);
  } catch (err) {
    setStatus(`Could not prepare the zip: ${err instanceof Error ? err.message : err}`, undefined, true);
  }
}

// A file dropped beside the drop zone would otherwise make the browser open it and throw away the whole session.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, (e) => e.preventDefault());

renderSide();
restoreDone = restoreProject();
