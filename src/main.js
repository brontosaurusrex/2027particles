import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, WIDTH, HEIGHT } from './renderer.js';
import {
  EMITTER_LIMIT, FRAME_COUNT, FPS, MAX_TRAIL_MS, STEP, Simulation, createEmitter, emitterRotation, polygonFaces,
  positionOnStroke, strokeDuration, strokePath, validateStroke,
} from './simulation.js';
import { chooseDestination, discardDestination, renderArchive } from './export.js';
import { renderVectorFrame } from './export-svg.js';
import { mountBrightnessEditor } from './brightness-editor.js';
import { mountProjectSlots } from './project-slots.js';
import {
  DEFAULT_FOCAL_LENGTH, FOCAL_LENGTH_BOUNDS, MAX_FOCUS_DISTANCE, encodeProject, readProject,
} from './project.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const status = $('backend');
const hints = {
  orbit: 'Drag to orbit · Scroll to zoom · Right-drag to pan',
  line: 'Drag on the grid to draw an open line.',
  outline: 'Drag on the grid. The last point joins the first.',
  area: 'Drag around a region to fill it with births.',
};
const planeAngles = { xy: [0, 0, 0], xz: [-90, 0, 0], yz: [0, 90, 0] };

async function start() {
  const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
  const view = await createRenderer(stage, forceWebGL);
  const { renderer, camera } = view;
  camera.filmGauge = 36;
  const orbit = new OrbitControls(camera, renderer.domElement);

  const forces = { gravity: 2.2, wind: [0.35, 0, -0.20], turbulence: 0.90, drag: 1.5, seed: 2027 };
  const effects = { depth: 1, shutter: 90, focus: 9.6, trail: 110, trailWidth: 100, trailLengthVariation: 0 };
  const demo = createEmitter(1, 'line', [
    [-2.4, -0.36], [-1.7, -0.12], [-1.05, 0.15], [-0.45, 0.22], [0.2, 0.17],
    [0.85, -0.01], [1.6, -0.25], [2.35, -0.54],
  ]);
  demo.rate = 155;
  demo.drawSpeed = 12.5;
  const emitters = [demo];
  let nextId = 2;
  let selected = demo;
  let simulation = new Simulation(forces, emitters, view.shapeChoices);
  let playing = true;
  let playStart = performance.now();
  let playFrame = 1;
  let frame = 1;
  let dirty = true;
  let ready = false;
  let winter = false;
  let focalLength = DEFAULT_FOCAL_LENGTH;
  let previewFullscreen = false;
  let mode = 'orbit';
  let stroke = null;
  let exporting = null;
  let downloadURL;
  let downloadDestination;

  const guides = new THREE.Scene();
  const grid = new THREE.GridHelper(36, 72, 0x8d7459, 0x3b4157);
  grid.material.transparent = true;
  grid.material.opacity = 0.43;
  grid.material.depthTest = false;
  const workPlane = new THREE.Group();
  grid.rotateX(Math.PI / 2);
  grid.position.z = -0.002;
  workPlane.add(grid);
  guides.add(workPlane);
  const outlines = new THREE.Group();
  guides.add(outlines);
  const animatedOutlines = [];
  const plane = new THREE.Plane();
  const ray = new THREE.Raycaster();
  const zero = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();

  function setLens(value, keepFraming = false) {
    if (keepFraming) {
      camera.position.sub(orbit.target).multiplyScalar(value / focalLength).add(orbit.target);
    }
    focalLength = value;
    const scale = value / DEFAULT_FOCAL_LENGTH;
    orbit.minDistance = 1.5 * scale;
    orbit.maxDistance = 36 * scale;
    camera.far = Math.max(120, orbit.maxDistance + 60);
    camera.setFocalLength(value);
    orbit.update();
    dirty = true;
  }

  function resetCamera() {
    camera.position.set(3.1, 2.38, 8.85);
    orbit.target.set(0.18, 0.03, 0);
    setLens(DEFAULT_FOCAL_LENGTH);
  }
  resetCamera();

  function invalidateSimulation() {
    simulation = new Simulation(forces, emitters, view.shapeChoices);
    dirty = true;
  }

  function updatePlane() {
    workPlane.rotation.set(...planeAngles[$('plane').value].map(THREE.MathUtils.degToRad));
    normal.set(0, 0, 1).applyQuaternion(workPlane.quaternion);
    const offset = $('plane-offset');
    const distance = THREE.MathUtils.clamp(Number(offset.value) || 0, -12, 12);
    offset.value = distance;
    workPlane.position.copy(normal).multiplyScalar(distance);
    workPlane.updateMatrixWorld(true);
    plane.setFromNormalAndCoplanarPoint(normal, workPlane.position);
    dirty = true;
  }

  function strokePoint(event) {
    const bounds = stage.getBoundingClientRect();
    ray.setFromCamera({
      x: (event.clientX - bounds.left) / bounds.width * 2 - 1,
      y: 1 - (event.clientY - bounds.top) / bounds.height * 2,
    }, camera);
    if (Math.abs(ray.ray.direction.dot(normal)) < 0.045) return null;
    if (!ray.ray.intersectPlane(plane, point) || point.distanceToSquared(zero) > 1200) return null;
    workPlane.worldToLocal(point);
    return [point.x, point.y];
  }

  function updateGuides() {
    animatedOutlines.length = 0;
    for (const group of [...outlines.children]) {
      group.traverse(object => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      group.removeFromParent();
    }
    const entries = [...emitters];
    if (stroke?.points.length > 1) entries.push(stroke);
    for (const emitter of entries) {
      const group = new THREE.Group();
      group.position.set(...emitter.position);
      group.quaternion.copy(emitterRotation(emitter));
      const active = emitter === selected || emitter === stroke;
      const tint = active ? 0xf4c468 : 0x9a907a;
      const path = strokePath(emitter === stroke ? { ...emitter, smoothing: 0 } : emitter);
      const duration = emitter === stroke ? Infinity : strokeDuration(emitter);
      const animated = Number.isFinite(duration);
      const material = new THREE.LineBasicMaterial({
        color: tint, transparent: true, opacity: animated ? 0.3 : 0.9, depthTest: false,
      });
      const vertices = path.vertices.map(([x, y]) => new THREE.Vector3(x, y, 0));
      const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 3;
      group.add(line);
      if (animated) {
        const revealed = new THREE.Line(geometry.clone(), material.clone());
        revealed.material.opacity = 0.95;
        revealed.renderOrder = 4;
        group.add(revealed);
        animatedOutlines.push({ geometry: revealed.geometry, path, duration, tip: 0 });
      }
      if (emitter.kind === 'area' && emitter !== stroke) {
        const area = new THREE.BufferGeometry().setFromPoints(vertices.slice(0, -1));
        area.setIndex(polygonFaces(emitter.points).flat());
        const fill = new THREE.Mesh(area, new THREE.MeshBasicMaterial({
          color: tint, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
        }));
        fill.renderOrder = 2;
        group.add(fill);
      }
      outlines.add(group);
    }
    dirty = true;
  }

  function updateGuideProgress() {
    for (const outline of animatedOutlines) {
      const { geometry, path, duration, tip } = outline;
      const { x, y, index } = positionOnStroke(path, frame * STEP / duration);
      const positions = geometry.attributes.position;
      positions.setXYZ(tip, ...path.vertices[tip], 0);
      positions.setXYZ(index, x, y, 0);
      positions.needsUpdate = true;
      geometry.setDrawRange(0, index + 1);
      outline.tip = index;
    }
  }

  function setMode(value) {
    mode = value;
    const drawing = mode !== 'orbit';
    orbit.enabled = previewFullscreen || !drawing;
    workPlane.visible = drawing;
    outlines.visible = drawing;
    stage.dataset.draw = String(drawing);
    document.querySelectorAll('[data-mode]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    $('hint').textContent = hints[mode];
    dirty = true;
  }

  document.querySelectorAll('[data-mode]').forEach(button =>
    button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('plane').addEventListener('change', updatePlane);
  $('plane-offset').addEventListener('change', updatePlane);
  $('reset-view').addEventListener('click', () => {
    resetCamera();
    focalLengthInput.setValue(focalLength);
  });
  const viewport = $('viewport');
  const fullscreen = $('fullscreen');
  fullscreen.disabled = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async () => {
    try {
      await viewport.requestFullscreen();
    } catch {
      $('hint').textContent = 'Fullscreen is unavailable in this browser window.';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === viewport;
    if (previewFullscreen === active) return;
    previewFullscreen = active;
    orbit.enabled = active || mode === 'orbit';
    fullscreen.setAttribute('aria-pressed', String(active));
    (active ? viewport : fullscreen).focus({ preventScroll: true });
    dirty = true;
  });
  orbit.addEventListener('change', () => { dirty = true; });
  updatePlane();
  setMode('orbit');

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', event => {
    if (previewFullscreen || mode === 'orbit' || stroke || event.button !== 0) return;
    if (emitters.length >= EMITTER_LIMIT) {
      $('hint').textContent = `Delete an emitter before adding another. Maximum ${EMITTER_LIMIT}.`;
      return;
    }
    const first = strokePoint(event);
    if (!first) {
      $('hint').textContent = 'Choose another plane or orbit until the grid faces the camera.';
      return;
    }
    event.preventDefault();
    pause();
    $('hint').textContent = hints[mode];
    stroke = createEmitter(nextId, mode, [first], workPlane.position.toArray(),
      planeAngles[$('plane').value], emitters.at(-1));
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!stroke || !canvas.hasPointerCapture(event.pointerId)) return;
    const next = strokePoint(event);
    if (!next) return;
    const last = stroke.points.at(-1);
    if (stroke.points.length < 512 && Math.hypot(next[0] - last[0], next[1] - last[1]) >= 0.047) {
      stroke.points.push(next);
      updateGuides();
    }
  });
  canvas.addEventListener('pointerup', event => {
    if (!stroke || !canvas.hasPointerCapture(event.pointerId)) return;
    const next = strokePoint(event);
    const last = stroke.points.at(-1);
    if (next && Math.hypot(next[0] - last[0], next[1] - last[1]) > 0.025 && stroke.points.length < 512) {
      stroke.points.push(next);
    }
    const first = stroke.points[0];
    if (stroke.kind !== 'line' && stroke.points.length > 2) {
      const end = stroke.points.at(-1);
      if (Math.hypot(end[0] - first[0], end[1] - first[1]) < 0.12) stroke.points.pop();
    }
    const issue = validateStroke(stroke.kind, stroke.points);
    if (issue) {
      $('hint').textContent = issue;
    } else {
      nextId++;
      const count = stroke.points.length;
      const center = stroke.points.reduce((sum, [x, y]) => [sum[0] + x / count, sum[1] + y / count], [0, 0]);
      stroke.points = stroke.points.map(([x, y]) => [x - center[0], y - center[1]]);
      stroke.position = workPlane.localToWorld(new THREE.Vector3(...center, 0)).toArray();
      emitters.push(stroke);
      selected = stroke;
      updateInspector();
      invalidateSimulation();
    }
    stroke = null;
    updateGuides();
  });
  canvas.addEventListener('lostpointercapture', () => {
    if (!stroke) return;
    stroke = null;
    updateGuides();
  });

  const brightnessEditor = mountBrightnessEditor($('brightness'), curve => {
    if (!selected) return;
    selected.brightness = curve;
    invalidateSimulation();
  });
  function updateInspector() {
    const menu = $('emitters');
    menu.replaceChildren(...emitters.map(emitter => {
      const label = emitter.id === demo.id ? 'Demo line' : `${emitter.kind[0].toUpperCase() + emitter.kind.slice(1)} ${emitter.id}`;
      return new Option(label, emitter.id, false, emitter === selected);
    }));
    if (!selected) menu.add(new Option('Draw an emitter', ''));
    menu.disabled = !selected;
    $('emitter-controls').hidden = !selected;
    if (!selected) return;
    const emission = $('emission');
    emission.replaceChildren();
    for (const [label, key, min, max, step, suffix] of [
      ['Rate / sec', 'rate', 0, 400, 1], ['Lifetime (s)', 'lifetime', 0.1, 8, 0.1],
      ['Chip size', 'size', 0.02, 0.3, 0.005], ['Size variation', 'sizeVariation', 0, 150, 1, '%'],
      ['Launch speed', 'speed', 0, 10, 0.1],
      ['Hue variation', 'hueVariation', 0, 180, 1, '°'],
      ['Rotation speed', 'rotationSpeed', 0, 360, 1, '°/s'],
      ['Rotation variation', 'rotationVariation', 0, 100, 1, '%'],
    ]) {
      range(emission, label, min, max, step, selected[key], value => {
        selected[key] = value;
        invalidateSimulation();
      }, suffix);
    }
    const { input: variation } = range(emission, 'Speed variation', 0, 100, 1, selected.speedVariation, value => {
      selected.speedVariation = value;
      invalidateSimulation();
    }, '%');
    variation.title = 'Random variation above and below the launch speed.';
    if (selected.kind !== 'area') {
      range(emission, 'Smoothing', 0, 100, 1, selected.smoothing, value => {
        selected.smoothing = value;
        updateGuides();
        invalidateSimulation();
      }, '%');
      const { input } = range(emission, 'Draw speed', 0, 100, 0.5, selected.drawSpeed, value => {
        selected.drawSpeed = value;
        updateGuides();
        invalidateSimulation();
      }, '%/s');
      input.title = 'Percentage of the stroke revealed per second. Set to 0 for continuous emission along the whole stroke.';
    }
    const transform = $('transform');
    brightnessEditor.setCurve(selected.brightness);
    transform.replaceChildren();
    for (const [key, label, min, max, step] of [
      ['position', 'Position', -24, 24, 0.1], ['rotation', 'Rotation', -360, 360, 1],
    ]) {
      ['X', 'Y', 'Z'].forEach((axis, index) => {
        const value = Number(selected[key][index].toFixed(3));
        numberField(transform, `${label} ${axis}`, min, max, step, value, changed => {
          selected[key][index] = changed;
          updateGuides();
          invalidateSimulation();
        });
      });
    }
  }

  $('emitters').addEventListener('change', event => {
    selected = emitters.find(emitter => emitter.id === Number(event.target.value));
    updateInspector();
    updateGuides();
  });
  $('delete-emitter').addEventListener('click', () => {
    if (!selected) return;
    emitters.splice(emitters.indexOf(selected), 1);
    selected = emitters.at(-1);
    updateInspector();
    updateGuides();
    invalidateSimulation();
  });

  const forcePanel = $('forces');
  const forceFields = [
    ...settingsRanges(forcePanel, forces, [['gravity', 'Gravity', -10, 10, 0.1]], invalidateSimulation),
    ...settingsRanges(forcePanel, forces.wind, ['X', 'Y', 'Z'].map((axis, index) =>
      [index, `Wind ${axis}`, -8, 8, 0.05]), invalidateSimulation),
    ...settingsRanges(forcePanel, forces, [
      ['turbulence', 'Turbulence', 0, 10, 0.05], ['drag', 'Air drag', 0, 8, 0.1, ' /s'],
    ], invalidateSimulation),
  ];
  const seedField = numberField(forcePanel, 'Seed', 0, 4294967295, 1, forces.seed, value => {
    forces.seed = Math.round(value);
    invalidateSimulation();
  });

  const cameraPanel = $('camera');
  const focalLengthInput = range(cameraPanel, 'Focal length', ...FOCAL_LENGTH_BOUNDS, 1, focalLength, value => {
    setLens(value, true);
    syncFocusRange();
  }, ' mm');
  const effectFields = settingsRanges(cameraPanel, effects, [
    ['depth', 'Depth of field', 0, 5, 0.1], ['shutter', 'Shutter angle', 0, 360, 1, '°'],
    ['trail', 'Trail length', 0, MAX_TRAIL_MS, 10, ' ms'],
    ['trailWidth', 'Trail width', 0, 300, 1, '%'],
    ['trailLengthVariation', 'Trail length variation', 0, 100, 1, '%'],
  ], () => { dirty = true; });
  effectFields[0].input.title = 'Higher values soften particles in front of and behind the focus distance.';
  const focus = range(cameraPanel, 'Focus distance', 0.2, 40, 0.1, effects.focus, value => {
    effects.focus = value;
    dirty = true;
  });
  focus.input.title = 'Distance from the camera lens to the plane that stays sharp.';
  function syncFocusRange() {
    const distance = camera.position.distanceTo(orbit.target);
    focus.input.max = Math.min(MAX_FOCUS_DISTANCE, Math.max(40, effects.focus, Math.ceil(distance + 15)));
    focus.setValue(effects.focus);
  }
  orbit.addEventListener('change', syncFocusRange);
  $('winter').addEventListener('change', event => {
    winter = event.target.checked;
    dirty = true;
  });
  updateInspector();
  updateGuides();

  function seek(value) {
    frame = THREE.MathUtils.clamp(value, 1, FRAME_COUNT);
    $('frame').value = String(frame).padStart(3, '0');
    $('timeline').value = frame;
    dirty = true;
  }

  function pause() {
    playing = false;
    $('play').textContent = 'Play';
  }

  function play(restartAtEnd = true) {
    if (restartAtEnd && frame === FRAME_COUNT) seek(1);
    playStart = performance.now();
    playFrame = frame;
    playing = true;
    $('play').textContent = 'Pause';
  }

  const togglePlayback = () => playing ? pause() : play();
  $('play').addEventListener('click', togglePlayback);
  const loop = $('loop');
  $('timeline').addEventListener('input', event => { pause(); seek(Number(event.target.value)); });
  $('previous').addEventListener('click', () => { pause(); seek(frame - 1); });
  $('next').addEventListener('click', () => { pause(); seek(frame + 1); });
  $('restart').addEventListener('click', () => { seek(1); play(); });
  document.addEventListener('keydown', event => {
    if (previewFullscreen && event.key === 'Escape' && document.fullscreenElement === viewport) {
      event.preventDefault();
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (event.code !== 'Space' || $('export-dialog').open || $('slots-dialog').open ||
        (!previewFullscreen && event.target !== document.body)) return;
    event.preventDefault();
    if (!event.repeat) togglePlayback();
  });

  const profiles = [[1, 4], [0.76, 4], [0.58, 4], [0.45, 3], [0.39, 2]];
  let quality = 0;
  let qualityFrames = 0;
  let elapsed = 0;
  let lastDraw = 0;
  let lastWidth = 0;
  const sizeWatcher = new ResizeObserver(() => { dirty = true; });
  sizeWatcher.observe(stage);

  renderer.setAnimationLoop(now => {
    if (!ready || exporting) return;
    if (playing) {
      let next = playFrame + Math.floor(Math.max(0, now - playStart) * FPS / 1000);
      if (next > FRAME_COUNT && loop.checked) {
        const completedFrames = Math.floor((next - 1) / FRAME_COUNT) * FRAME_COUNT;
        playStart += (completedFrames - playFrame + 1) * 1000 / FPS;
        playFrame = 1;
        next -= completedFrames;
      }
      if (next !== frame) seek(next);
      if (next > FRAME_COUNT) pause();
    }
    if (!dirty) return;
    const [scale, sampleCount] = playing ? profiles[quality] : profiles[0];
    const previewSamples = effects.depth >= 2.5 ? (playing ? sampleCount * 2 : 16) : sampleCount;
    const maxWidth = previewFullscreen ? WIDTH : 1440;
    const width = Math.max(128, Math.round(Math.min(stage.clientWidth * Math.min(devicePixelRatio, 1.5), maxWidth) * scale));
    const height = Math.round(width * HEIGHT / WIDTH);
    dirty = false;
    const showGuides = mode !== 'orbit' && !previewFullscreen;
    if (showGuides) updateGuideProgress();
    view.draw(simulation, frame, camera, effects, width, height, {
      exporting: false, sampleCount: previewSamples, winter, overlay: showGuides ? guides : null,
    });
    if (playing && lastDraw > 0 && width === lastWidth) {
      elapsed += now - lastDraw;
      if (++qualityFrames >= 24) {
        const average = elapsed / qualityFrames;
        if (average > 25 && quality < profiles.length - 1) quality++;
        qualityFrames = 0;
        elapsed = 0;
      }
    }
    lastDraw = playing ? now : 0;
    lastWidth = width;
  });

  const exportDialog = $('export-dialog');
  const progress = $('export-progress');
  const exportStatus = $('export-status');
  const done = $('download');
  const exportBackground = $('export-background');
  const projectFile = $('project-file');
  const projectStatus = $('project-status');

  function captureProject() {
    return {
      emitters, selectedEmitterId: selected?.id ?? null, nextEmitterId: nextId,
      forces, effects,
      camera: {
        position: camera.position.toArray(), target: orbit.target.toArray(), focalLength, winter,
      },
      editor: { mode, plane: $('plane').value, planeOffset: Number($('plane-offset').value) },
      playback: { frame, playing, loop: loop.checked },
      exportBackground: exportBackground.value,
    };
  }

  mountProjectSlots($('slots-dialog'), $('project-slots'), captureProject, restoreProject, structuredClone(captureProject()));

  $('save-project').addEventListener('click', () => {
    const json = encodeProject(captureProject());
    downloadFile(json, 'application/json', '2027-particles.project.json');
  });
  $('load-project').addEventListener('click', () => projectFile.click());
  projectFile.addEventListener('change', async () => {
    const file = projectFile.files[0];
    projectFile.value = '';
    if (!file) return;
    $('load-project').disabled = true;
    projectStatus.hidden = true;
    try {
      const project = await readProject(file);
      if (exportDialog.open) throw new Error('Close the PNG export dialog before loading a project.');
      restoreProject(project);
      projectStatus.textContent = 'Project loaded.';
    } catch (error) {
      projectStatus.textContent = error.message;
    } finally {
      $('load-project').disabled = false;
      projectStatus.hidden = false;
    }
  });

  function restoreProject(project) {
    const { wind, ...savedForces } = project.forces;
    Object.assign(forces, savedForces);
    forces.wind.splice(0, 3, ...wind);
    Object.assign(effects, project.effects);
    forceFields.forEach(field => field.sync());
    seedField.setValue(forces.seed);
    effectFields.forEach(field => field.sync());

    camera.position.fromArray(project.camera.position);
    orbit.target.fromArray(project.camera.target);
    setLens(project.camera.focalLength);
    focalLengthInput.setValue(focalLength);
    syncFocusRange();
    winter = project.camera.winter;
    $('winter').checked = winter;
    exportBackground.value = project.exportBackground;

    stroke = null;
    emitters.splice(0, emitters.length, ...project.emitters);
    selected = emitters.find(emitter => emitter.id === project.selectedEmitterId);
    nextId = project.nextEmitterId;
    $('plane').value = project.editor.plane;
    $('plane-offset').value = project.editor.planeOffset;
    setMode(project.editor.mode);
    updatePlane();
    updateInspector();
    updateGuides();
    invalidateSimulation();

    loop.checked = project.playback.loop;
    seek(project.playback.frame);
    if (project.playback.playing) play(false);
    else pause();
  }

  $('export-svg').addEventListener('click', () => {
    if (exporting) return;
    try {
      const svg = renderVectorFrame(view, simulation, frame, camera, effects);
      downloadFile(svg, 'image/svg+xml', `frame_${String(frame).padStart(4, '0')}.svg`);
    } catch (error) {
      $('hint').textContent = 'Could not export this frame as SVG.';
      console.error(error);
    } finally {
      dirty = true;
    }
  });
  $('export').addEventListener('click', () => {
    pause();
    dirty = true;
    exportDialog.showModal();
  });
  $('close-export').addEventListener('click', () => {
    if (exporting) exporting.abort();
    else exportDialog.close();
  });
  exportDialog.addEventListener('cancel', event => {
    if (!exporting) return;
    event.preventDefault();
    exporting.abort();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted || !downloadDestination) return;
    URL.revokeObjectURL(downloadURL);
    discardDestination(downloadDestination).catch(() => {});
  });

  $('export-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (exporting) return;
    exporting = new AbortController();
    const signal = exporting.signal;
    $('start-export').disabled = true;
    $('close-export').textContent = 'Cancel';
    $('export-background').disabled = true;
    done.hidden = true;
    progress.value = 0;
    progress.hidden = true;
    exportStatus.hidden = true;
    let destination;
    try {
      if (downloadURL) {
        URL.revokeObjectURL(downloadURL);
        discardDestination(downloadDestination).catch(() => {});
        downloadURL = null;
        downloadDestination = null;
      }
      destination = await chooseDestination();
      signal.throwIfAborted();
      progress.hidden = false;
      exportStatus.hidden = false;
      exportStatus.textContent = 'Rendering frame 1 of 500…';
      const snapshot = {
        camera: camera.clone(),
        effects: { ...effects },
        forces: structuredClone(forces),
        emitters: structuredClone(emitters),
        winter: $('export-background').value === 'winter',
      };
      const file = await renderArchive(view, snapshot, destination, signal, rendered => {
        progress.value = rendered;
        exportStatus.textContent = `Rendered ${rendered} of ${FRAME_COUNT} frames`;
      });
      if (file) {
        downloadDestination = destination;
        downloadURL = URL.createObjectURL(file);
        done.href = downloadURL;
        done.hidden = false;
      }
      exportStatus.textContent = file ? 'The ZIP is ready to download.' : 'The ZIP was saved.';
    } catch (error) {
      await discardDestination(destination).catch(() => {});
      exportStatus.hidden = false;
      exportStatus.textContent = error.name === 'AbortError' ? 'Export cancelled.' : `Export failed. ${error.message}`;
      progress.hidden = true;
      if (error.name !== 'AbortError') console.error(error);
    } finally {
      exporting = null;
      $('start-export').disabled = false;
      $('close-export').textContent = 'Close';
      $('export-background').disabled = false;
      dirty = true;
    }
  });

  try {
    await view.loadEnvironment(`${import.meta.env.BASE_URL}snowy_field_1k.hdr`);
  } catch (error) {
    console.error('Could not load the winter environment.', error);
    $('winter').disabled = true;
    $('export-background').querySelector('option[value=winter]').disabled = true;
    $('hint').textContent = 'Could not load winter lighting. You can still preview and export sparks.';
  }
  status.textContent = view.isWebGL ? 'WebGL 2' : 'WebGPU';
  ready = true;
  $('export').disabled = false;
  $('export-svg').disabled = false;
  $('save-project').disabled = false;
  $('load-project').disabled = false;
  $('project-slots').disabled = false;
  play();
}

function downloadFile(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function settingsRanges(container, settings, specs, onChange) {
  return specs.map(([key, label, min, max, step, suffix]) => {
    const field = range(container, label, min, max, step, settings[key], value => {
      settings[key] = value;
      onChange();
    }, suffix);
    return { input: field.input, sync: () => field.setValue(settings[key]) };
  });
}

function makeField(container, className, label) {
  const row = document.createElement('label');
  row.className = className;
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.setAttribute('aria-label', label);
  row.append(text, input);
  container.append(row);
  return { row, input };
}

function range(container, label, min, max, step, value, onChange, suffix = '') {
  const { row, input } = makeField(container, 'range-row', label);
  Object.assign(input, { type: 'range', min, max, step, value });
  const output = document.createElement('output');
  row.append(output);
  const updateReadout = () => { output.value = input.value + suffix; };
  updateReadout();
  input.addEventListener('input', () => {
    updateReadout();
    onChange(input.valueAsNumber);
  });
  return {
    input,
    setValue(next) {
      input.value = next;
      updateReadout();
    },
  };
}

function numberField(container, label, min, max, step, value, onChange) {
  const { input } = makeField(container, 'number-row', label);
  Object.assign(input, { type: 'number', min, max, step, value });
  let previous = value;
  input.addEventListener('change', () => {
    const next = input.valueAsNumber;
    previous = Number.isFinite(next) ? THREE.MathUtils.clamp(next, min, max) : previous;
    input.value = previous;
    onChange(previous);
  });
  return {
    setValue(next) {
      previous = next;
      input.value = next;
    },
  };
}

start().catch(error => {
  status.textContent = 'Renderer unavailable';
  $('hint').textContent = 'This browser could not start WebGPU or WebGL 2.';
  console.error(error);
});
