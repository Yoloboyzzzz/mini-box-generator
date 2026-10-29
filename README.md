# Mini Box Generator

Turn the STL files of your tabletop miniatures into 3D-printable storage boxes with friction-fit lids.
Everything runs in your browser. Your files never leave your device.

**Live version: https://yoloboyzzzz.github.io/mini-box-generator/**

## How it works

1. **Add your minis.** Drop STL files in (units are taken as millimetres). Set how each one stands and how many copies you want.
2. **Group them.** Each group becomes one box set. A group that does not fit your printer bed is split across several boxes automatically.
3. **Generate.** Every mini gets a cavity cut from its own underside, so it drops in from the top and sits flush with the box top. The lid slips over the whole box and holds everything in place.
4. **Download** the box and lid as 3MF (small, opens directly in your slicer) or STL.

What it does for you:

- A snug fit with a clearance you set (0.2 mm by default, meant for printers that are not very accurate).
- Minis are nested by their real outline and can be rotated around Z to pack tightly.
- A **Model detail** slider trades file size against how closely the floor follows each mini. The walls and the fit are the same at every setting.
- Half-circle **finger notches** in the lid, and free-standing pillars lowered so minis are easy to lift out.
- Your minis, orientation, quantities and groups are kept in this browser between visits. **Start over** clears them.

Use bare models: a supported STL gets a cavity for every support. Print one small box and lid first to check the fit and the lid friction on your own printer.

## Run it locally

```
npm install
npm run dev      # http://localhost:6785
npm test         # geometry, storage and export tests
npm run build    # production build into dist/
```

Built with TypeScript, Vite and three.js. The geometry is generated in a web worker, no server involved.

`samples/` holds a few simple STL files to try the app with.
