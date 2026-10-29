/** File-name safe, but keeps letters and digits from any script (accents, CJK) instead of flattening them to "_". */
export function safeFileName(s: string): string {
  return s.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'box';
}

/** Hands out file names that never collide (case-insensitively), so two boxes can't overwrite each other in a zip. */
export function makeNamer(): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    const base = safeFileName(name);
    let out = base, n = 2;
    while (used.has(out.toLowerCase())) out = `${base}-${n++}`;
    used.add(out.toLowerCase());
    return out;
  };
}
