# Adult survivor asset provenance

Derived from MakeHuman Community assets released under CC0-1.0.

- Repository: https://github.com/makehumancommunity/makehuman
- Asset license: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md (local LICENSE.CC0.md)
- Sources: `makehuman/data/3dobjs/base.obj`, `data/targets/macrodetails/caucasian-male-young.target`, universal adult male averageweight targets (65% average muscle, 35% maximum muscle), `data/rigs/default.mhskel`, `data/rigs/default_weights.mhw`.
- Skin and eyes: https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html ; archive https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip. Skin `young_caucasian_male2/young_lightskinned_male_diffuse2.png`; eyes `low-poly` + `materials/brown_eye.png`.
- Source copyright acknowledgements: Data Collection AB, Joel Palmius, Jonas Hauquier. CC0 assets require no attribution; provenance retained for review.
- Preparation: apply adult male morphs, retain body faces only, evaluate eye proxy indices on morphed mesh, triangulate, normalize height1.8m feet0, rotate180degrees aroundY to face-Z, retain UVs, normalize top4 skin weights, derive skeleton joint centers from original joint indices.
- Runtime schema: `male-adult-rigged.json`, mesh `positions`, `uvs`, `indices`, `skinIndex`, `skinWeight`; `bones` array names,parent index,local rest `position`,modelspace `head`/`tail`. Rest quaternion identity. `eyes` secondary mesh shares same skeleton. PNGs use standard OBJ UVs (Three TextureLoader default flipY=true).
- Original conversion script and source downloads: `/tmp/kite3d-human-assets/prepare_asset.py`. No MakeHuman program code bundled in game; JSON contains CC0 asset data only.
- The game renders a pelvis cover for non-explicit presentation. This is an original survivor adaptation, not a Rust asset.

Source revision checked at preparation: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.

Prepared asset SHA256:

- `skin-male.png`: `03efe1f6b0ae52429649dcefc9dcaef6058032f874a251169cc3e2ed473c3874`
- `male-adult-rigged.json`: `67d4d6fa8e134f0e703182954b817b99ff52f592225a3818b12613a44a1f1951`
- `eyes-brown.png`: `4659691c7295ad6206c78b003e5fd0e5f91dcd53032fa914a229bb48cabe424b`

First-person hand revision: `BowHandRig.ts` selects only triangles fully weighted to each arm from the same CC0 mesh (2,252 vertices / 3,981 triangles per arm). Original UVs, skin image, anatomical finger/nail geometry and normalized four-bone weights are retained. No Rust assets or newly downloaded assets are used. Camera-space shoulder/elbow controls drive the continuous skinned forearm; original finger bones provide separate bow grip, three-finger string hook and release poses. `BowHandPose.ts` derives mirrored flexion axes from the native hand frame; thumb opposition uses its own joint axes. First-person hands are scaled to 135% of the source adult hand proportions for the reference viewmodel camera, blended at the wrist by the existing skin weights.
