# World Workshop integration

This directory preserves the editable source and provenance documents for the delivered World Workshop module. The homepage loads the prebuilt ES module from `public/world-workshop/lib/world-workshop.js` and its runtime assets from `public/world-workshop/assets/`.

To rebuild the module from this directory, run `npm ci` and `npm run build:lib`, then copy `dist/lib/world-workshop.js` to `../../public/world-workshop/lib/world-workshop.js`. Asset originals, stand-alone demo, and QA scripts are in the full delivery archive, not this repository. See `docs/ASSETS.md` and `docs/ANIMATION.md` for provenance and limitations.
