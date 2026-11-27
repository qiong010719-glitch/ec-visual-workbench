# Three.js local runtime

- Version: 0.187.0 (r187), retrieved 2026-11-21.
- Project: https://github.com/mrdoob/three.js
- License: MIT; see LICENSE in this directory.
- `three.module.js`: unmodified bytes from https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.min.js
- `three.core.js`: unmodified bytes from https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.core.min.js (local filename matches the module's relative import).
- The cockpit loads these files from its own local server. It does not request a CDN or remote textures at runtime.

The independently authored scene is in `public/local/cockpit-scene.js`, with GPU particle choreography in `cockpit-atmosphere.js`. Cards use MeshPhysicalMaterial transmission, thickness, IOR, attenuation and clearcoat. The floating-point environment is generated locally; it is not a photographic HDRI. Text sits on a dark inset for readability.

`addons/` contains unmodified Three.js 0.187.0 example modules from `https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/`: EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, MaskPass, Pass and their CopyShader, LuminosityHighPassShader, OutputShader and FXAAShader dependencies. The page's import map resolves the bare `three` specifier locally. These modules share Three.js's MIT license.

The pipeline applies Bloom in linear HDR, tone mapping/output conversion, then FXAA. Material dispersion is disabled to reduce sampling cost. Rendering settles after interaction; measured sustained slow frames reduce pixel ratio to 0.85 and transmission resolution to 0.4. This is an adaptive rendering tradeoff, not a guaranteed frame rate.
