# 2027 Particles

A local 3D editor for drawing emitters, animating golden debris, and rendering PNG sequences.

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. Three.js uses WebGPU when available and falls back to WebGL 2. Add `?renderer=webgl` to exercise the fallback. Use `npm run build` for a static build and `npm run preview` to serve it locally.

Choose Line, Outline, or Area and drag on the work plane. Change the plane or offset before drawing. Use the emitter inspector to change its position, rotation, and emission. Orbit mode lets you drag to orbit, scroll to zoom, and right-drag to pan.

Use Fullscreen for a clean animation preview. Press Space to play or pause and Escape to return to the editor.

Each emitter has its own launch Speed variation and Lifetime brightness curve. Drag the curve points or enter brightness percentages at the five ages. Particles become more transparent near the end of their lives.

Size variation controls the spread around the selected emitter's Chip size. Set it to 0% for equal-sized chips, 100% for the default mix, or up to 150% for a wider mix.

Lines and outlines emit from the moving tip as they draw in. Set Draw speed to 25%/s for a four-second reveal, or to 0%/s for continuous emission along the whole stroke.

Use Smoothing on a line or outline to round its corners. New emitters start with the most recently drawn emitter's settings. The 20 Emitter preset slots save settings in the current browser. Loading a slot applies it to the selected emitter and keeps its shape and placement.

Increase Air drag under Forces to slow particles throughout their flight and keep wind and turbulence from carrying them as far.

Camera controls adjust depth of field, focus distance, shutter angle, and trail length. Uncheck Focus on orbit target to set the distance manually with the slider. A 90° shutter gives a 5 ms exposure at 50 fps. Trail length controls how far back along each particle's motion the gold trail extends, up to 1.2 seconds. Export uses the current camera and creates a ZIP with 500 consecutively numbered 1920 × 1080 PNGs. Choose transparent frames or include the winter backdrop. A browser with a save picker can write directly to the selected file. Otherwise the editor prepares the archive in browser storage and enables a download button.

Particle contours are adapted from Physical's mixed brick debris. The winter environment is [Snowy Field by Andreas Mischok](https://polyhaven.com/a/snowy_field), distributed under CC0.
