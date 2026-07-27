# Texture assets

Everything in this directory is **optional**. The renderer generates a
procedural equivalent for every map listed below and falls back to it whenever
a file is missing or fails to decode, so the app works with this directory
completely empty — which is how it ships.

Drop real imagery in to upgrade specific bodies; no code changes are needed.

## Layout

```
public/textures/
  bodies/<slug>/albedo.jpg       base colour, sRGB
  bodies/<slug>/normal.jpg       tangent-space normals (topography), linear
  bodies/<slug>/roughness.jpg    roughness / ocean mask, linear
  bodies/<slug>/clouds.png       cloud cover in the ALPHA channel
  bodies/<slug>/ring.png         radial ring profile, density in ALPHA
  env/starfield.hdr              8K equirectangular skybox
```

`<slug>` is the lowercased body name as it appears in the preset:
`sun`, `mercury`, `venus`, `earth`, `moon`, `mars`, `jupiter`, `saturn`,
`uranus`, `neptune`, `pluto`, `ceres`, `halley`.

Bodies with no named profile — procedurally generated systems, user-launched
bodies — are classified by mass and colour into one of four shared slugs:
`generic-star`, `generic-gas`, `generic-terrestrial`, `generic-rocky`. Supply
those to change the look of every unnamed body at once.

## Format requirements

- **Surface maps** must be equirectangular at 2:1 aspect (e.g. 4096×2048).
  Anything else will stretch, because they are mapped straight onto a sphere.
- **Cloud and ring maps** carry their coverage in the **alpha** channel, not in
  a separate greyscale file. three's `alphaMap` samples the *green* channel,
  which on a white cloud plate is 1.0 everywhere; the renderer therefore uses
  the map's own alpha and no `alphaMap` is wired up.
- **Ring maps** are a 1-D radial profile: `u = 0` is the inner edge, `u = 1`
  the outer edge. The mesh supplies radial UVs, so a square ring image will
  not work — use a wide, short strip.
- **The skybox** is loaded as a Radiance `.hdr`. It is HEAD-probed before it is
  requested, so a missing file costs one 404 and never an error boundary.

## Serving from a CDN

Set `NEXT_PUBLIC_TEXTURE_BASE` to an absolute origin to load everything from
elsewhere:

```
NEXT_PUBLIC_TEXTURE_BASE=https://cdn.example.com/nbody-textures
```

The origin **must** send `Access-Control-Allow-Origin`. Without it the browser
taints the WebGL canvas, and the PNG screenshot and WebM capture features in
`lib/utils/export.ts` stop working — silently, with a security error at read
time rather than at load time.

When unset, the base is `${NEXT_PUBLIC_BASE_PATH}/textures`, which is this
directory.

## Suggested sources

Public-domain planetary imagery: NASA's Scientific Visualization Studio, the
USGS Astrogeology map catalogue, and Solar System Scope's texture set
(CC BY 4.0). Check each licence before shipping.
