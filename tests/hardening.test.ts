import { describe, expect, it } from 'vitest';
import { makeNamer, safeFileName } from '../src/filenames';
import { generateBoxes } from '../src/geometry/generate';
import { parseSTL } from '../src/geometry/stl';
import { LIMITS, clampSetting, sanitizeSettings } from '../src/settings';
import { DEFAULTS } from '../src/types';
import { cylinder } from './helpers';

describe('settings limits', () => {
  it('has a limit for every setting and every default sits inside it', () => {
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const lim = LIMITS[key];
      expect(lim, key).toBeDefined();
      expect(DEFAULTS[key], key).toBeGreaterThanOrEqual(lim.min);
      expect(DEFAULTS[key], key).toBeLessThanOrEqual(lim.max);
    }
  });

  it('clamps out-of-range values and rounds integers', () => {
    expect(clampSetting('rotStep', 0)).toBe(1);
    expect(clampSetting('rotStep', 7.6)).toBe(8);
    expect(clampSetting('bedX', 5)).toBe(20);
    expect(clampSetting('bedX', 1e9)).toBe(2000);
    expect(clampSetting('tolerance', -1)).toBe(0);
    expect(clampSetting('effort', 9)).toBe(3);
    expect(clampSetting('cell', NaN)).toBe(DEFAULTS.cell);
  });

  it('turns any junk into complete valid settings', () => {
    for (const junk of [null, undefined, 'x', 42, [], { cell: 'big', bedX: null, wall: -5, rotStep: 0 }]) {
      const s = sanitizeSettings(junk);
      for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
        expect(Number.isFinite(s[key]), key).toBe(true);
        expect(s[key], key).toBeGreaterThanOrEqual(LIMITS[key].min);
        expect(s[key], key).toBeLessThanOrEqual(LIMITS[key].max);
      }
    }
    expect(sanitizeSettings({ rotStep: 0 }).rotStep).toBe(1);
    expect(sanitizeSettings({ tolerance: 0.3 }).tolerance).toBe(0.3);
  });

  it('generation survives settings that would otherwise hang it (rotation step 0)', () => {
    const bad = { ...DEFAULTS, rotStep: 0, effort: 1, cell: 0, nestCell: 0 };
    const [box] = generateBoxes('bad', [{ name: 'a', tris: cylinder(6, 15) }], bad);
    expect(box.box.length).toBeGreaterThan(0);
  }, 60000);
});

describe('file names', () => {
  it('keeps letters from any script instead of flattening them', () => {
    expect(safeFileName('Orc Warrior #3')).toBe('Orc_Warrior_3');
    expect(safeFileName('兽人 战士')).toBe('兽人_战士');
    expect(safeFileName('Élfe ñandú')).toBe('Élfe_ñandú');
  });

  it('never returns an empty or path-like name', () => {
    expect(safeFileName('')).toBe('box');
    expect(safeFileName('///')).toBe('box');
    expect(safeFileName('😀😀')).toBe('box');
    expect(safeFileName('../../etc/passwd')).not.toContain('/');
    expect(safeFileName('a'.repeat(500)).length).toBeLessThanOrEqual(80);
  });

  it('gives colliding names distinct files, case-insensitively', () => {
    const next = makeNamer();
    const names = [next('😀'), next('🎉'), next('Box'), next('box'), next('BOX')];
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
});

describe('STL input', () => {
  it('rejects text that is not an STL', () => {
    const buf = new TextEncoder().encode('hello world, definitely not a mesh');
    expect(() => parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)).toThrow();
  });

  it('reads a binary STL with zero triangles as empty (the UI then reports it)', () => {
    const buf = new ArrayBuffer(84);
    expect(parseSTL(buf).length).toBe(0);
  });
});
