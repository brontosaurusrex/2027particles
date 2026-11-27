# 2027 Particles

A local 3D editor for drawing emitters, animating golden debris, and exporting PNG, SVG, and MOV files.

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. Three.js uses WebGPU when available and falls back to WebGL 2. Add `?renderer=webgl` to exercise the fallback. Use `npm run build` for a static build and `npm run preview` to serve it locally.

Choose Line, Outline, or Area and drag on the work plane. Change the plane or offset before drawing. Use the emitter inspector to change its position, rotation, and emission. Orbit mode lets you drag to orbit, scroll to zoom, and right-drag to pan.

Choose Camera plane to draw flat to the current view. At zero offset the plane passes through the orbit target. Positive offsets bring it toward the camera. The finished emitter stays in its 3D position and orientation as you orbit.

In Outline or Area mode, choose Circle or Rectangle and drag outward from the center. Hold Shift while drawing a rectangle to make it square. Outline emits around the perimeter. Area emits across the filled shape.

To reposition an emitter, select it, click Move, and drag in the viewport. Its guide follows the pointer while you drag. Release to apply the new position, or press Escape to cancel.

Choose Curve in Line, Outline, or Area mode. Click to place points on the drawing plane. Use Finish curve or Enter to commit it. Backspace removes the last point while drawing, and Escape cancels the curve.

Save project downloads a JSON file with the emitters, camera, forces, trail and blur settings, drawing plane, timeline and export preferences. Load project restores that file in the editor. Project slots hold the same full scene in 20 named slots in your browser. The editor reopens the last slot you loaded when the page starts. Use Rename to change a slot's name while keeping its saved scene. Copy share link opens the complete project in any browser that can reach the editor. Link creation is limited to 8,000 characters. Use the JSON file for larger projects.

Select an emitter and use Solo to isolate it or Mute to hide it. Duplicate emitter copies its geometry, transform, and settings into a new editable emitter. Solo temporarily overrides mute. The preview and all exports show the same emitters. When exporting an isolated emitter, the filename includes its emitter number so you can keep each layer separate.

Right-click a slider to reset it to its default value.

Use Fullscreen or press F for a clean animation preview. Drag to orbit or scroll to zoom. Press Space to play or pause and Escape to return to the editor.

Under Preview, choose Auto to adapt resolution during playback or Full resolution to use native display pixels up to 3840 × 2160. Frame rate controls playback, the timeline frame count, and PNG export. The default ten seconds is 250 frames at 25 fps or 500 frames at 50 fps. Click the end-frame number beside the playhead readout to set the timeline length in frames at the current rate.

Under Preview, use Load reference image to trace a picture. It fits inside the frame and stays fixed to the screen as you orbit. Reference darkening adjusts the black tint. The image stays in the current tab and is excluded from fullscreen playback, project saves, and exports.

Each emitter has its own launch Speed variation up to 200% and Launch spread. Birth scatter varies the birth position in a sphere around the emitter. Welding sparks adds tiny sparks at the same birth points with one-third of the standard particle lifetime. Set spread to 0% for a tight jet, 100% for the default spread, or up to 200% for a wider spray.

Drag the points on the Lifetime brightness curve or enter brightness percentages at the five ages. Brightness variation makes individual particles and sparks dimmer or brighter across the whole curve. Particles become more transparent near the end of their lives.

Sparkle amount controls how many particles and burst sparks can briefly flash with a star-shaped glint. Glints vary in size from particle to particle. The default is 0%, including for older projects that lack a saved sparkle amount.

Every emitter uses a mix of ♥ hearts, ★ stars, ❄ snowflakes, ● solid circles, ✦ sparkles, ✿ flowers, ⚡ lightning bolts, ◆ diamonds, ▲ triangles, and ⏾ crescents. Solid circles appear twice as often as each other shape.

Rotation speed sets the tumble rate in degrees per second. Rotation variation spreads that rate above and below the selected speed. Set speed to 0°/s to hold each particle's starting orientation.

Lifetime variation gives particles a spread around the selected Lifetime. At 0%, particles have the same starting lifetime. The 28% default preserves the original spread.

Split chance gives each particle a chance to burst once partway through its life. Burst size variation changes how many sparks it produces, from six sparks at 0% variation to a random count between six and nine at 100%. Burst sparks use the emitter palette and hue variation.

Chip size can be set from 0.001 to 0.3. Size variation controls the spread around that size. Set it to 0% for equal-sized chips, 100% for the default mix, or up to 150% for a wider mix.

Choose Original, Ferrari Red / Fir Green / Gold, or Silver / Ferrari Red / Fir Green per emitter. Each particle and burst spark picks a base color from its palette. Hue variation shifts that color, and the particle keeps the same color in its glint and trail.

Lines and outlines emit from the moving tip as they draw in. Set Draw speed to 25%/s for a four-second reveal, or to 0%/s for continuous emission along the whole stroke. Use Draw direction to run a line forward or reverse, or trace an outline clockwise or counterclockwise as seen from the front of the emitter.

Use Smoothing on a line or outline to round its corners. New emitters start with the most recently drawn emitter's settings. An old emitter preset opens in a starter scene, where it can be saved as a full project.

Export SVG frame saves the current camera and timeline frame as editable paths and gradients with a transparent background. The SVG includes the chips, glints, and motion trails. Use PNG or MOV export for lens blur and shutter blur.

Print PNG renders the current frame as a 3840 × 2160 PNG with a transparent or black background, with 300 ppi metadata, depth of field, and shutter blur. At 300 ppi, the full 16:9 frame prints at approximately 32.5 × 18.3 cm.

When depth of field is enabled, export dialogs let you match the sample count of the last displayed preview frame or choose Export quality at 24 samples.

Increase Air drag under Forces to slow particles throughout their flight and keep wind and turbulence from carrying them as far.

The 25–200 mm full-frame focal length control moves the camera along its viewing axis to keep the orbit target at the same apparent size. Focus distance sets the sharp plane independently of the camera position. Depth of field softens particles away from that plane.

Shutter angle controls exposure as a fraction of a frame. At 90° the exposure is 5 ms at 50 fps or 10 ms at 25 fps. Export animation can create a ZIP of 1920 × 1080 PNGs with a transparent, black, or winter background. A browser with a save picker can write directly to the selected file. Otherwise the editor prepares the archive in browser storage and enables a download button.

Trail length extends each emitter’s curved ribbon up to six seconds. SVG exports use editable Bézier paths for trail curves. Trail width scales ribbon thickness from 0% to 300%. Trail only hides the chips and glints. Trail length variation gives individual particles shorter and longer trails around the selected length. At 100% variation, a trail can last up to twice that length. Trail width variation sets how much the width varies between particles.

The Noise panel sets the rate and detail for three smooth time-varying channels. Use Noise beside a parameter to select a channel and set its amount as a percentage of the parameter’s range. The thumb sets the base value and the readout shows the effective value. Noise follows the timeline during playback, scrubbing, and export.

The Material panel sets metalness and roughness globally for all chips. Reflection lighting switches between the winter panorama and a photographic studio HDRI independently of the backdrop. Rounded chip edges catch highlights as the particles spin. Both settings are saved with the project and apply to raster exports. SVG exports use simplified vector shading and chip outlines.

Enable **Screen-space reflections (SSR)** to add reflections of nearby visible chips to the selected HDRI lighting in the preview, PNG and MOV exports on browsers with floating-point render targets. The setting is off by default and is saved with the project. 4K PNG export with SSR renders the whole frame together to keep reflections continuous.

Export animation also offers **ProRes 422 MOV** and **CineForm MOV** at 1920 × 1080 with a black background and Rec.709 SDR color. The browser encodes the movie locally and offers a download after rendering. The movie file name starts with the loaded or saved slot name and can be edited before export. Black PNGs use the same composition as Preview on black and carry an sRGB tag.

The MOV encoder uses [FFmpeg 7.1.2](https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz) under the [LGPL](public/video/FFmpeg-LGPL-2.1.txt). Rebuild the browser module with Emscripten 4.0.20 and `scripts/build-movie-encoder.sh`.

Particle contours come from [Noto Sans Symbols 2](https://github.com/google/fonts/tree/7b6724ac7ececc713e9ba93af309f7520c9a80a3/ofl/notosanssymbols2) under the [SIL Open Font License](public/licenses/NotoSansSymbols2-OFL.txt). To regenerate them from the source TTF, run `uv run --no-project --with fonttools python scripts/extract-particle-glyphs.py NotoSansSymbols2-Regular.ttf > src/particle-glyphs.json`.

The HDRI environments are [Snowy Field by Andreas Mischok](https://polyhaven.com/a/snowy_field) and [Studio Small 03 by Greg Zaal](https://polyhaven.com/a/studio_small_03), distributed under CC0.
