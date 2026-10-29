import { DEFAULTS, type Settings } from './types';

export interface Limit {
  min: number;
  max: number;
  int?: boolean;
  label: string;
}

/**
 * Sane bounds for every setting. Values outside them either make no physical sense (a 0 mm wall) or can
 * hang the generator (a rotation step of 0 would loop forever), and they can arrive from anywhere:
 * typed in, loaded from a preset, or left behind in browser storage by an older version.
 */
export const LIMITS: Record<keyof Settings, Limit> = {
  tolerance: { min: 0, max: 2, label: 'Clearance' },
  cell: { min: 0.05, max: 0.5, label: 'Raster cell' },
  zStep: { min: 0.02, max: 0.5, label: 'Floor height step' },
  floor: { min: 0.2, max: 20, label: 'Floor' },
  wall: { min: 0.4, max: 10, label: 'Wall between minis' },
  outerWall: { min: 0.4, max: 10, label: 'Outer wall' },
  minPillar: { min: 0, max: 500, label: 'Pillar size' },
  pillarLowering: { min: 0, max: 30, label: 'Pillar lowering' },
  floorSimplify: { min: 0, max: 2, label: 'Floor simplification' },
  lidClearance: { min: 0, max: 2, label: 'Lid clearance' },
  lidWall: { min: 0.4, max: 10, label: 'Lid wall' },
  lidCeiling: { min: 0.4, max: 10, label: 'Lid ceiling' },
  skirtGap: { min: 0, max: 5, label: 'Skirt gap' },
  chamfer: { min: 0, max: 3, label: 'Chamfer' },
  fingerNotch: { min: 0, max: 20, label: 'Finger notch' },
  bedX: { min: 20, max: 2000, label: 'Bed X' },
  bedY: { min: 20, max: 2000, label: 'Bed Y' },
  rotStep: { min: 1, max: 180, int: true, label: 'Rotation step' },
  nestCell: { min: 0.1, max: 2, label: 'Packing grid' },
  effort: { min: 1, max: 3, int: true, label: 'Nesting effort' },
};

export function clampSetting(key: keyof Settings, v: number): number {
  const { min, max, int } = LIMITS[key];
  if (!Number.isFinite(v)) return DEFAULTS[key];
  const c = Math.min(max, Math.max(min, v));
  return int ? Math.round(c) : c;
}

export function describeLimit(key: keyof Settings): string {
  const { min, max, label } = LIMITS[key];
  return `${label} must be between ${min} and ${max}`;
}

/** Anything goes in, a complete valid Settings comes out; missing or non-numeric entries fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const out: Settings = { ...DEFAULTS };
  for (const key of Object.keys(LIMITS) as (keyof Settings)[]) {
    const v = src[key];
    out[key] = typeof v === 'number' ? clampSetting(key, v) : DEFAULTS[key];
  }
  return out;
}
