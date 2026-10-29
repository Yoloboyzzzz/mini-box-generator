export interface Settings {
  /** Clearance around each mini in XY (mm). */
  tolerance: number;
  /** Raster cell size (mm). Smaller = tighter fit, bigger files. */
  cell: number;
  /** Height quantisation of cavity floors (mm). */
  zStep: number;
  /** Material under the tallest mini (mm). */
  floor: number;
  /** Minimum wall between two cavities (mm). */
  wall: number;
  /** Minimum wall between a cavity and the outside (mm). */
  outerWall: number;
  /** Free-standing pieces of material smaller than this footprint (mm²) are removed; 0 = keep all. */
  minPillar: number;
  /** Free-standing pillars that stay are lowered by this much so a hand can reach in (mm); 0 = full height. */
  pillarLowering: number;
  /** Floors inside cavities may be merged into blocks up to this much deeper than the mini needs (mm); 0 = exact. */
  floorSimplify: number;
  /** Clearance between box and lid per side (mm). */
  lidClearance: number;
  lidWall: number;
  lidCeiling: number;
  /** The lid skirt stops this far above the table so the ceiling lands on the box (mm). */
  skirtGap: number;
  /** Lead-in chamfer on the lid's inner rim (mm). */
  chamfer: number;
  /** Radius of the half-circle finger notches cut into the lid's rim (mm); 0 = none. */
  fingerNotch: number;
  bedX: number;
  bedY: number;
  /** Z-rotation step used while nesting (degrees). */
  rotStep: number;
  /** Packing grid size (mm). */
  nestCell: number;
  /** 1 = quick, 2 = normal, 3 = thorough nesting search. */
  effort: number;
}

export const DEFAULTS: Settings = {
  tolerance: 0.2,
  cell: 0.1,
  zStep: 0.1,
  floor: 1.5,
  wall: 1.2,
  outerWall: 2.0,
  minPillar: 6,
  pillarLowering: 6,
  floorSimplify: 2.0,
  lidClearance: 0.2,
  lidWall: 1.6,
  lidCeiling: 1.6,
  skirtGap: 0.4,
  chamfer: 0.6,
  fingerNotch: 7,
  bedX: 220,
  bedY: 220,
  rotStep: 15,
  nestCell: 0.5,
  effort: 2,
};

/** A mini ready for generation: z starts at 0, XY centred on the origin. */
export interface MiniInput {
  name: string;
  tris: Float32Array;
  /** How many copies go into the box (default 1). */
  count?: number;
}

export interface BoxResult {
  name: string;
  /** Triangle soup (9 floats per triangle), print orientation. */
  box: Float32Array;
  lid: Float32Array;
  width: number;
  depth: number;
  height: number;
  lidHeight: number;
  /** Radius of the finger notches actually cut into the lid (mm); 0 when none fit. */
  fingerNotch: number;
  /** The radius that was asked for, so the UI can say when it had to be skipped or reduced. */
  fingerNotchWanted: number;
  /** Offset from box origin to lid origin in XY (mm, negative). */
  lidOffset: number;
  lidCeiling: number;
  /** Figure names, with "×n" when a figure appears more than once. */
  minis: string[];
  /** Total number of figures in the box, copies included. */
  miniCount: number;
  oversize: boolean;
}
