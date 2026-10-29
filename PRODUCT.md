# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Tabletop-miniature hobbyists who own a 3D printer (or have access to one) and a collection of STL files for their figures. They sit at a desktop browser before a print job, with a pile of minis to organise, and want storage boxes that fit those exact figures. The tool is intended as a public, free-to-open web tool for the wider hobby, not only its author's own use.

## Product Purpose
Turn a set of miniature STL files into printable storage: the user uploads STLs, sets how each figure stands, sorts figures into groups, and the app generates for each group one or more boxes with a cavity cut for every figure plus a matching friction-fit lid. Success is a box set that prints without repair and where every figure drops in with a snug fit, sits flush with the top, and cannot move once the lid is on.

## Positioning
The cavities are generated from the figures' own undersides, not from generic bounding boxes or foam-insert templates. Figures are nested in the box by their true top-down outline, and the clearance is calibrated to an inaccurate printer. The whole pipeline runs in the browser, so models never leave the user's machine.

## Operating Context
- Runs fully client-side (no server, no upload). Heavy geometry runs in a Web Worker.
- Input: binary or ASCII STL files, interpreted as millimetres, one figure per file.
- Output: a box and a lid per generated box, as 3MF (default, compressed, opens directly in slicers) or binary STL, downloadable singly or as a compressed .zip, previewed in a 3D viewer before download. File size is a product concern: detailed figures once produced 200+ MB of STL for about 20 minis, so floors inside cavities are simplified by default (the fit around each mini is unaffected).
- Typical session: upload minis, set orientation and quantity per figure, assign groups, tune print settings (tolerance, walls, lid clearance, bed size), generate, inspect, download, slice and print.
- Settings and named presets persist in the browser (localStorage). Uploaded minis, their orientation, quantities and groups are also kept in this browser (IndexedDB) and come back after a reload, with a "Start over" button to clear them. Nothing is uploaded anywhere. If the browser runs out of storage the user is told which mini was not kept.
- Changes made while a generation run is in progress apply to the next run, never to the groups of the current one (the run works from a snapshot).

## Capabilities and Constraints
- Per-figure orientation (rotation about X/Y/Z, scale) set by the user; the app only rotates figures around Z when nesting.
- Per-figure quantity, so the same figure can appear several times in one box.
- Groups; each group becomes one box set, split automatically across several boxes when it exceeds the printer bed.
- Friction-fit lid only (no magnets or latches). Lid clearance is separate from figure tolerance.
- The lid has half-circle finger notches cut into its open rim on the two longer sides (radius adjustable, 0 = none), so it is easier to get a fingertip in and open. The radius shrinks automatically on small lids and is skipped when it would not fit.
- Default clearance around figures is 0.2 mm, tuned for a printer that is not very accurate.
- Free-standing thin pillars of material inside a box are removed below a configurable footprint.
- Free-standing pillars that remain (for example the island between a mini's legs, or the middle of a ring-shaped base) are lowered by a configurable amount (default 6 mm, 0 = full height) so there is room for fingers to reach in and lift the mini out. Walls connected to the box rim are never lowered.
- A "Model detail" slider trades how closely the floor under each mini follows its underside against file size: far right is the exact floor (largest files), far left simplifies it by up to 2 mm (smallest files, the default). It never changes the walls or the fit around the mini.
- Pre-supported STLs produce cavities for their supports; the user should supply bare models.
- Local dev address is localhost:6785. Deployment beyond local use (likely static hosting) is not decided.
- Checked on real high-poly figures (a dreadnought and a supported winged Hivelord, 170k to 510k triangles each): generated boxes load in PrusaSlicer as manifold single parts and no figure vertex lies below the floor. Not yet test-printed, so the real-world fit and lid friction are unconfirmed.

## Brand Commitments
The working name is "Mini Box Generator". No logo, brand voice or visual identity has been committed.

## Evidence on Hand
- Synthetic test minis and three sample STLs in `samples/`; a geometry test suite in `tests/`.
- No real user testimonials, usage data, benchmarks or printed-fit results exist yet. Do not invent any.

## Product Principles
1. The fit is the product: geometry correctness (flush top, true clearance, printable meshes) outranks everything else.
2. Frontend only, private by default: models never leave the user's machine.
3. Sensible defaults for an imprecise printer, with every dimension adjustable and remembered.
4. Show the result before the user prints it: preview and dimensions make mistakes visible early.
5. Fail loudly and early: oversize figures, unprintable settings and storage failures are stated, never silent.
