# three-mesh-bvh 0.9.5

This directory vendors the published `build/index.module.js` browser bundle, `src/index.d.ts`,
and MIT `LICENSE` from `three-mesh-bvh@0.9.5`. The source-map comment was removed because the
map is not shipped.

The published JavaScript SHA-256 is
`c6ea2189f8d5c84a11de15bb333001f5630d0982c7a2edc5e85604162eba1a4e`.

Reproduce after `npm install`:

```sh
cp node_modules/three-mesh-bvh/build/index.module.js vendor/three-mesh-bvh-0.9.5/index.module.js
cp node_modules/three-mesh-bvh/src/index.d.ts vendor/three-mesh-bvh-0.9.5/index.d.ts
cp node_modules/three-mesh-bvh/LICENSE vendor/three-mesh-bvh-0.9.5/LICENSE
sed -i '' '/^\/\/# sourceMappingURL=index.module.js.map$/d' \
  vendor/three-mesh-bvh-0.9.5/index.module.js
shasum -a 256 vendor/three-mesh-bvh-0.9.5/index.module.js
```
