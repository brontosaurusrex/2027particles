import * as THREE from 'three/webgpu';
import {
  attribute, materialColor, mix, mx_noise_float, output, positionLocal, renderOutput, smoothstep,
  texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { chipGeometries } from './chips.js';
import { CAPACITY, FPS, STEP } from './simulation.js';
import { EFFECT_BOUNDS, EMITTER_BOUNDS, FOCAL_LENGTH_BOUNDS, LIVE_EMITTER_KEYS, MATERIAL_DEFAULTS,
  modulateSettings, modulationValue } from './modulation.js';
import { MotionTrails } from './trails.js';
import { colorWithPalette, particleTint } from './palette-color.js';
import { brightnessAt, DEFAULT_BRIGHTNESS } from './lifetime.js';

export const WIDTH = 1920;
export const HEIGHT = 1080;
const GOLD = [0xffa320, 0xffc642, 0xffd272, 0xf6a741, 0xffe39b].map(value => new THREE.Color(value));
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function setLifetimeAppearance(material) {
  const appearance = attribute('lifetimeAppearance', 'vec3');
  material.opacityNode = appearance.x;
  material.outputNode = vec4(colorWithPalette(output.rgb, appearance.z).mul(appearance.y), output.a);
  return material;
}

function compositeQuad(fragment) {
  const material = new THREE.NodeMaterial();
  material.setValues({ depthTest: false, depthWrite: false });
  material.fragmentNode = fragment;
  return new THREE.QuadMesh(material);
}

export async function createRenderer(stage, forceWebGL) {
  const renderer = new THREE.WebGPURenderer({ alpha: true, forceWebGL, antialias: false });
  await renderer.init();
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('aria-label', 'Golden particle preview');
  stage.prepend(renderer.domElement);
  return new ParticleRenderer(renderer);
}

class ParticleRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.isWebGL = renderer.backend.isWebGLBackend === true;
    this.scene = new THREE.Scene();
    this.backdrop = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, WIDTH / HEIGHT, 0.08, 120);
    this.sampleCamera = this.camera.clone();
    this.animatedCamera = this.camera.clone();
    this.object = new THREE.Object3D();
    this.spinAxis = new THREE.Vector3();

    const mainLight = new THREE.DirectionalLight(0xffe1a7, 3.6);
    mainLight.position.set(-4, 6, 4);
    const rimLight = new THREE.DirectionalLight(0xffb047, 2.2);
    rimLight.position.set(5, 1, -4);
    this.scene.add(mainLight, rimLight, new THREE.HemisphereLight(0xffebbc, 0x493320, 1.1));

    const gold = setLifetimeAppearance(new THREE.MeshStandardNodeMaterial({
      metalness: 0.80, roughness: 0.22, emissive: 0xe89c32, emissiveIntensity: 0.34,
      transparent: true, depthWrite: false,
    }));
    this.finish = Object.fromEntries(Object.entries(MATERIAL_DEFAULTS).map(([key, value]) => [key, uniform(value)]));
    const scratchPosition = positionLocal.mul(vec3(4, 63, 7));
    const resolved = smoothstep(0.4, 1.6, scratchPosition.y.fwidth()).oneMinus();
    const cuts = smoothstep(0.16, 0.5, mx_noise_float(scratchPosition)).mul(resolved).mul(this.finish.scratches);
    gold.metalnessNode = this.finish.metalness;
    gold.roughnessNode = this.finish.roughness.add(cuts.mul(0.35)).min(1);
    gold.colorNode = materialColor.mul(cuts.mul(0.32).oneMinus());
    this.chips = chipGeometries().map(geometry => this.createBatch(geometry, gold));
    this.shapeChoices = this.chips.flatMap((mesh, index) =>
      mesh.geometry.userData.symbol === 'circle' ? [index, index] : [index]);

    const star = new THREE.Shape();
    const points = [[0, 1], [0.12, 0.12], [0.78, 0], [0.12, -0.12], [0, -1],
      [-0.12, -0.12], [-0.78, 0], [-0.12, 0.12]];
    star.moveTo(...points[0]);
    points.slice(1).forEach(point => star.lineTo(...point));
    star.closePath();
    const spark = setLifetimeAppearance(new THREE.MeshBasicNodeMaterial({
      color: 0xffd070, side: THREE.DoubleSide, transparent: true, depthWrite: false, forceSinglePass: true,
    }));
    const sparkleGeometry = new THREE.ShapeGeometry(star);
    sparkleGeometry.userData.outline = points;
    this.sparks = this.createBatch(sparkleGeometry, spark);
    this.sparks.renderOrder = 1;
    this.trails = new MotionTrails();
    this.scene.add(this.trails.mesh);

    const colorType = this.isWebGL && !renderer.backend.extensions.has('EXT_color_buffer_float')
      ? THREE.UnsignedByteType : THREE.HalfFloatType;
    const makeTarget = (depthBuffer, type = colorType) => new THREE.RenderTarget(1, 1, {
      type, depthBuffer, colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.samples = makeTarget(true);
    this.accumulation = makeTarget(false);
    this.sky = makeTarget(false);
    this.output = makeTarget(false, THREE.UnsignedByteType);

    this.weight = uniform(1);
    const exposureMaterial = new THREE.NodeMaterial();
    exposureMaterial.setValues({
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    exposureMaterial.fragmentNode = texture(this.samples.texture).mul(this.weight);
    this.exposurePass = new THREE.QuadMesh(exposureMaterial);
    this.backdropMode = uniform(0);
    const sceneColor = texture(this.accumulation.texture);
    const distance = uv().sub(0.5).length().mul(1.4).clamp(0, 1);
    const studio = mix(uniform(new THREE.Color(0x2c2532)), uniform(new THREE.Color(0x10141e)), distance);
    const sky = texture(this.sky.texture).rgb;
    const background = mix(studio, sky, this.backdropMode.sub(1).clamp(0, 1))
      .mul(this.backdropMode.sub(2).clamp(0, 1).oneMinus());
    const alpha = sceneColor.a.clamp(0, 1);
    const opaque = this.backdropMode.min(1);
    const linear = mix(sceneColor.rgb.div(alpha.max(0.0001)), sceneColor.rgb.add(background.mul(alpha.oneMinus())), opaque);
    const displayColor = renderOutput(vec4(linear, mix(alpha, 1, opaque)), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    // PNG stores straight RGB and alpha. The transparent branch has already divided out alpha.
    displayColor.premultipliedAlpha = false;
    this.composite = compositeQuad(displayColor);
    this.referenceDarkening = uniform(0);

    this.skyKey = '';
  }

  setReferenceImage(image) {
    this.reference?.texture.dispose();
    this.reference?.quad.material.dispose();
    this.reference = null;
    if (!image) return;

    const map = new THREE.CanvasTexture(image);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    const aspect = (image.width / image.height) / (WIDTH / HEIGHT);
    const fit = vec2(Math.min(1, aspect), Math.min(1, 1 / aspect));
    const imagePoint = uv().sub(0.5).div(fit);
    const inside = imagePoint.x.abs().lessThanEqual(0.5).and(imagePoint.y.abs().lessThanEqual(0.5));
    const reference = texture(map, imagePoint.add(0.5));
    const particles = texture(this.accumulation.texture);
    const foreground = particles.toneMapping(THREE.ACESFilmicToneMapping).rgb;
    const opacity = particles.a.clamp(0, 1);
    const background = reference.rgb.mul(reference.a).mul(this.referenceDarkening.oneMinus());
    const rgb = foreground.add(background.mul(inside.select(1, 0)).mul(opacity.oneMinus()));
    const display = renderOutput(vec4(rgb, 1), THREE.NoToneMapping, THREE.SRGBColorSpace);
    this.reference = { texture: map, quad: compositeQuad(display) };
  }

  async loadEnvironment(url) {
    const environment = await new HDRLoader().loadAsync(url);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = environment;
    this.scene.environmentIntensity = 1.25;
    this.backdrop.background = environment;
    this.backdrop.backgroundIntensity = 0.96;
  }

  createBatch(geometry, material) {
    const appearance = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    geometry.setAttribute('lifetimeAppearance', appearance.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('paletteTint',
      new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  frameEffects(simulation, effects, frame) {
    if (!Object.keys(effects.noise ?? {}).length) return effects;
    return modulateSettings(effects, EFFECT_BOUNDS, simulation.noiseAt(frame * STEP));
  }

  frameCamera(simulation, camera, effects, frame, target) {
    if (!target || !effects.noise?.focalLength?.amount) return camera;
    const base = camera.getFocalLength();
    const focal = modulationValue(base, effects.noise.focalLength, FOCAL_LENGTH_BOUNDS, simulation.noiseAt(frame * STEP));
    const moved = this.animatedCamera.copy(camera, false);
    moved.position.sub(target).multiplyScalar(focal / base).add(target);
    moved.far = Math.max(camera.far, moved.position.distanceTo(target) + 60);
    moved.setFocalLength(focal);
    moved.updateMatrixWorld(true);
    return moved;
  }

  updateInstances(simulation, time, camera, effects, width = WIDTH, height = HEIGHT) {
    const { object, chips, sparks, trails } = this;
    for (const [key, fallback] of Object.entries(MATERIAL_DEFAULTS)) this.finish[key].value = effects[key] ?? fallback;
    const signals = simulation.simulationNoise ? simulation.noiseAt(time) : [];
    const styles = new Map();
    chips.forEach(mesh => { mesh.count = 0; });
    sparks.count = 0;
    trails.begin(camera, effects, width, height);
    simulation.sample(time, (particle, fraction, age) => {
      const { rotation, spin, death, birth } = particle;
      const lifetime = particle.lifetime ?? (death - birth);
      const lifeScale = Math.min(1, (lifetime - age) * 7 + 0.12);
      const lifeProgress = age / lifetime;
      const opacity = THREE.MathUtils.smoothstep(1 - lifeProgress, 0, 0.75);
      const brightness = brightnessAt(particle.brightness ?? DEFAULT_BRIGHTNESS, lifeProgress) * particle.brightnessScale;
      const baseStyle = particle.style ?? effects;
      let style = baseStyle;
      if (signals.length && baseStyle.noise) {
        if (!styles.has(baseStyle)) styles.set(baseStyle, modulateSettings(baseStyle, EMITTER_BOUNDS, signals, LIVE_EMITTER_KEYS));
        style = styles.get(baseStyle);
      }
      const angle = baseStyle.noise?.hueVariation?.amount && particle.hueFactor !== undefined
        ? particle.hueFactor * THREE.MathUtils.degToRad(style.hueVariation)
        : particle.hue ?? 0;
      object.position.lerpVectors(particle.previous, particle.position, fraction);
      trails.add(particle, object.position, time, lifeScale, opacity, brightness, style, angle);
      if (particle.style?.trailOnly) return;
      object.rotation.set(...rotation);
      this.spinAxis.fromArray(spin);
      const spinSpeed = this.spinAxis.length();
      if (spinSpeed > 0) object.rotateOnAxis(this.spinAxis.divideScalar(spinSpeed), spinSpeed * age);
      object.scale.setScalar(particle.size * lifeScale);
      object.updateMatrix();
      const mesh = chips[particle.shape];
      const index = mesh.count++;
      const tint = particleTint(particle);
      mesh.setMatrixAt(index, object.matrix);
      mesh.setColorAt(index, GOLD[particle.shade]);
      mesh.geometry.attributes.lifetimeAppearance.setXYZ(index, opacity, brightness, angle);
      mesh.geometry.attributes.paletteTint.setXYZ(index, ...tint);

      const pulse = particle.glint ? Math.sin(particle.phase + age * particle.flashRate) : 0;
      if (pulse > 0.79) {
        const size = particle.size * particle.glintSizeScale * lifeScale * (pulse - 0.70) * 7;
        object.position.applyMatrix4(camera.matrixWorldInverse);
        object.position.z += particle.size * 0.76;
        object.position.applyMatrix4(camera.matrixWorld);
        object.quaternion.copy(camera.quaternion);
        object.rotateZ(particle.phase * 0.35);
        object.scale.setScalar(size);
        object.updateMatrix();
        const sparkle = sparks.count++;
        sparks.setMatrixAt(sparkle, object.matrix);
        this.sparkColor ??= new THREE.Color();
        this.sparkColor.setRGB(6 * pulse, 3.25 * pulse, 1.15 * pulse);
        sparks.setColorAt(sparkle, this.sparkColor);
        sparks.geometry.attributes.lifetimeAppearance.setXYZ(sparkle, opacity, brightness, angle);
        sparks.geometry.attributes.paletteTint.setXYZ(sparkle, ...tint);
      }
    });
    trails.finish();
    for (const batch of [...chips, sparks]) {
      if (!batch.count) continue;
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      batch.instanceColor.addUpdateRange(0, batch.count * 3);
      batch.instanceColor.needsUpdate = true;
      for (const attribute of [batch.geometry.attributes.lifetimeAppearance, batch.geometry.attributes.paletteTint]) {
        attribute.addUpdateRange(0, batch.count * 3);
        attribute.needsUpdate = true;
      }
    }
  }

  setLensSample(camera, focus, amount, radius, angle) {
    const sampled = this.sampleCamera;
    sampled.copy(camera, false);
    const dx = Math.cos(angle) * radius * amount;
    const dy = Math.sin(angle) * radius * amount;
    sampled.translateX(dx);
    sampled.translateY(dy);
    // Keep the focus plane fixed while shifting the lens across its aperture.
    const projection = sampled.projectionMatrix.elements;
    projection[8] -= projection[0] * dx / focus;
    projection[9] -= projection[5] * dy / focus;
    sampled.projectionMatrixInverse.copy(sampled.projectionMatrix).invert();
    sampled.updateMatrixWorld(true);
    return sampled;
  }

  draw(simulation, frame, camera, settings, width, height, options) {
    const { renderer, samples, accumulation, sky, output } = this;
    const { exporting, sampleCount, winter, black, overlay, updateOverlay, showReference, target, frameRate = FPS } = options;
    camera = this.frameCamera(simulation, camera, settings, frame, target);
    settings = this.frameEffects(simulation, settings, frame);
    const reference = !exporting && showReference ? this.reference : null;
    const count = settings.depth || settings.shutter ? sampleCount : 1;
    const focus = Math.max(camera.near * 2, settings.focus);
    const aperture = focus * settings.depth * 0.007;
    const exposure = settings.shutter / (360 * frameRate);
    if (!exporting && (renderer.domElement.width !== width || renderer.domElement.height !== height)) {
      renderer.setSize(width, height, false);
    }
    samples.setSize(width, height);
    accumulation.setSize(width, height);
    output.setSize(exporting ? width : 1, exporting ? height : 1);
    if (camera.coordinateSystem !== renderer.coordinateSystem) {
      camera.coordinateSystem = renderer.coordinateSystem;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    if (exposure <= STEP) simulation.seek(frame);

    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    if (winter && !black && !reference) {
      const key = [width, height, ...camera.quaternion.toArray(), camera.fov].join(',');
      if (key !== this.skyKey) {
        sky.setSize(Math.min(width, 960), Math.min(height, 540));
        renderer.setRenderTarget(sky);
        renderer.render(this.backdrop, camera);
        this.skyKey = key;
      }
    } else if (this.skyKey === '') {
      renderer.setRenderTarget(sky);
      renderer.clear();
      this.skyKey = 'empty';
    }
    renderer.setRenderTarget(accumulation);
    renderer.clear();
    this.weight.value = 1 / count;
    for (let index = 0; index < count; index++) {
      const temporalIndex = exposure > STEP ? count - 1 - index : index;
      const fraction = (temporalIndex + 0.5) / count;
      const time = frame * STEP - exposure * fraction;
      if (exposure > STEP) simulation.seek(Math.max(1, Math.ceil(time / STEP)));
      const radius = count === 1 ? 0 : Math.sqrt(((index * (count - 1)) % count + 0.5) / count);
      const sampled = this.setLensSample(camera, focus, aperture, radius, index * GOLDEN_ANGLE);
      this.updateInstances(simulation, time, sampled, settings, width, height);
      renderer.autoClear = true;
      renderer.setRenderTarget(samples);
      renderer.render(this.scene, sampled);
      renderer.autoClear = false;
      renderer.setRenderTarget(accumulation);
      this.exposurePass.render(renderer);
    }

    renderer.autoClear = true;
    renderer.setRenderTarget(exporting ? output : null);
    this.backdropMode.value = black ? 3 : winter ? 2 : Number(!exporting);
    (reference?.quad ?? this.composite).render(renderer);
    if (overlay) {
      updateOverlay?.();
      renderer.autoClear = false;
      renderer.render(overlay, camera);
      renderer.autoClear = true;
    }
    renderer.setRenderTarget(null);
  }

  async readImage() {
    const { width, height } = this.output;
    const pixels = await this.renderer.readRenderTargetPixelsAsync(this.output, 0, 0, width, height);
    if (this.isWebGL) {
      const stride = width * 4;
      const rowData = new Uint8Array(stride);
      for (let row = 0; row < Math.floor(height / 2); row++) {
        const top = row * stride;
        const bottom = (height - 1 - row) * stride;
        rowData.set(pixels.subarray(top, top + stride));
        pixels.copyWithin(top, bottom, bottom + stride);
        pixels.set(rowData, bottom);
      }
    }
    return new ImageData(new Uint8ClampedArray(pixels.buffer), width, height);
  }
}
