# 2027 Particles

A local 3D editor for drawing emitters, animating golden debris, and rendering PNG sequences.

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. Three.js uses WebGPU when available and falls back to WebGL 2. Add `?renderer=webgl` to exercise the fallback. Use `npm run build` for a static build and `npm run preview` to serve it locally.

Choose Line, Outline, or Area and drag on the work plane. Change the plane or offset before drawing. Use the emitter inspector to change its position, rotation, and emission. Orbit mode lets you drag to orbit, scroll to zoom, and right-drag to pan.

In Outline or Area mode, choose Circle or Square and drag outward from the center. Outline emits around the perimeter. Area emits across the filled shape.

Choose Curve in Line, Outline, or Area mode. Click to place points on the drawing plane. Use Finish curve or Enter to commit it. Backspace removes the last point while drawing, and Escape cancels the curve.

Save project downloads a JSON file with the emitters, camera, forces, trail and blur settings, drawing plane, timeline and export preferences. Load project restores that file in the editor. Project slots hold the same full scene in 20 named slots in your browser. Use Rename to change a slot's name while keeping its saved scene.

Right-click a slider to reset it to its default value.

Use Fullscreen for a clean animation preview. Drag to orbit or scroll to zoom. Press Space to play or pause and Escape to return to the editor.

Under Preview, choose Auto to adapt resolution during playback or Full resolution to use native display pixels up to 3840 × 2160. Frame rate controls playback and PNG export. Both rates play the same ten-second timeline. Export produces 250 frames at 25 fps or 500 frames at 50 fps.

Each emitter has its own launch Speed variation and Launch spread. Set spread to 0% for a tight jet, 100% for the default spread, or up to 200% for a wider spray.

Drag the points on the Lifetime brightness curve or enter brightness percentages at the five ages. Brightness variation makes individual particles and sparks dimmer or brighter across the whole curve. Particles become more transparent near the end of their lives.

Sparkle amount controls how many particles and burst sparks can briefly flash with a star-shaped glint. Glints vary in size from particle to particle. The slider starts at 0% in the starter scene. Older projects load with 46%, which matches their original flash frequency.

Every emitter uses a mix of ♥ hearts, ★ stars, ❄ snowflakes, ● solid circles, ✚ plus signs, ✦ sparkles, ✿ flowers, ⚡ lightning bolts, and ○ rings. Solid circles appear twice as often as each other shape.

Rotation speed sets the tumble rate in degrees per second. Rotation variation spreads that rate above and below the selected speed. Set speed to 0°/s to hold each particle's starting orientation.

Lifetime variation gives particles a spread around the selected Lifetime. At 0%, particles have the same starting lifetime. The 28% default preserves the original spread.

Split chance gives each particle a chance to burst once partway through its life. Burst size variation changes how many sparks it produces, from six sparks at 0% variation to a random count between two and eight at 100%. Each burst scatters a mix of shapes and colors in 3D.

Chip size can be set from 0.001 to 0.3. Size variation controls the spread around that size. Set it to 0% for equal-sized chips, 100% for the default mix, or up to 150% for a wider mix.

Hue variation gives each particle from the selected emitter a consistent random color shift. At 0° the palette stays gold. Wider ranges add more colors in the preview, PNG frames, and SVG.

Lines and outlines emit from the moving tip as they draw in. Set Draw speed to 25%/s for a four-second reveal, or to 0%/s for continuous emission along the whole stroke.

Use Smoothing on a line or outline to round its corners. New emitters start with the most recently drawn emitter's settings. An old emitter preset opens in a starter scene, where it can be saved as a full project.

Export SVG frame saves the current camera and timeline frame as editable paths and gradients with a transparent background. The SVG includes the chips, glints, and motion trails. Use PNG export for the winter photo, depth of field, and shutter blur.

Print PNG renders the current frame as a transparent 3840 × 2160 PNG, with 300 ppi metadata, depth of field, and shutter blur. At 300 ppi, the full 16:9 frame prints at approximately 32.5 × 18.3 cm.

When depth of field is enabled, both PNG export dialogs let you match the sample count of the last displayed preview frame or choose Export quality at 24 samples.

Increase Air drag under Forces to slow particles throughout their flight and keep wind and turbulence from carrying them as far.

The 25–200 mm full-frame focal length control moves the camera along its viewing axis to keep the orbit target at the same apparent size. Focus distance sets the sharp plane independently of the camera position. Use Depth of field to soften the particles in front of and behind that plane.

A 90° shutter gives a 5 ms exposure. Trail length controls how far back along each particle's motion the gold trail extends, up to 1.2 seconds. Export uses the current camera and creates a ZIP with consecutively numbered 1920 × 1080 PNGs. Choose transparent frames or include the winter backdrop. A browser with a save picker can write directly to the selected file. Otherwise the editor prepares the archive in browser storage and enables a download button.

Trail width scales ribbon thickness from 0% to 300%. Trail length variation gives individual particles shorter and longer trails around the selected length. At 100% variation, a trail can last up to twice that length.

Particle contours come from [Noto Sans Symbols 2](https://github.com/google/fonts/tree/7b6724ac7ececc713e9ba93af309f7520c9a80a3/ofl/notosanssymbols2) under the [SIL Open Font License](public/licenses/NotoSansSymbols2-OFL.txt). To regenerate them from the source TTF, run `uv run --no-project --with fonttools python scripts/extract-particle-glyphs.py NotoSansSymbols2-Regular.ttf > src/particle-glyphs.json`.

The winter environment is [Snowy Field by Andreas Mischok](https://polyhaven.com/a/snowy_field), distributed under CC0.
