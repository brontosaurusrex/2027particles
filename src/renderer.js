import * as THREE from 'three/webgpu';
import { attribute, hue, mix, output, renderOutput, texture, uniform, uv, vec4 } from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { chipGeometries } from './chips.js';
import { CAPACITY, STEP } from './simulation.js';
import { MotionTrails } from './trails.js';
import { brightnessAt, DEFAULT_BRIGHTNESS } from './lifetime.js';

export const WIDTH = 1920;
export const HEIGHT = 1080;
const GOLD = [0xffa320, 0xffc642, 0xffd272, 0xf6a741, 0xffe39b].map(value => new THREE.Color(value));
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function setLifetimeAppearance(material) {
  const appearance = attribute('lifetimeAppearance', 'vec3');
  material.opacityNode = appearance.x;
  material.outputNode = vec4(hue(output.rgb, appearance.z).mul(appearance.y), output.a);
  return material;
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
    const background = mix(studio, sky, this.backdropMode.sub(1).max(0));
    const alpha = sceneColor.a.clamp(0, 1);
    const opaque = this.backdropMode.min(1);
    const linear = mix(sceneColor.rgb.div(alpha.max(0.0001)), sceneColor.rgb.add(background.mul(alpha.oneMinus())), opaque);
    const displayColor = renderOutput(vec4(linear, mix(alpha, 1, opaque)), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    const compositeMaterial = new THREE.NodeMaterial();
    compositeMaterial.setValues({ depthTest: false, depthWrite: false });
    compositeMaterial.fragmentNode = displayColor;
    this.composite = new THREE.QuadMesh(compositeMaterial);

    this.skyKey = '';
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
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  updateInstances(simulation, time, camera, effects) {
    const { object, chips, sparks, trails } = this;
    chips.forEach(mesh => { mesh.count = 0; });
    sparks.count = 0;
    trails.begin(camera, effects);
    simulation.sample(time, (particle, fraction, age) => {
      const { rotation, spin, death, birth } = particle;
      const lifetime = particle.lifetime ?? (death - birth);
      const lifeScale = Math.min(1, (lifetime - age) * 7 + 0.12);
      const lifeProgress = age / lifetime;
      const opacity = THREE.MathUtils.smoothstep(1 - lifeProgress, 0, 0.75);
      const brightness = brightnessAt(particle.brightness ?? DEFAULT_BRIGHTNESS, lifeProgress) * particle.brightnessScale;
      const angle = particle.hue ?? 0;
      object.position.lerpVectors(particle.previous, particle.position, fraction);
      trails.add(particle, object.position, time, lifeScale, opacity, brightness);
      object.rotation.set(...rotation);
      this.spinAxis.fromArray(spin);
      const spinSpeed = this.spinAxis.length();
      if (spinSpeed > 0) object.rotateOnAxis(this.spinAxis.divideScalar(spinSpeed), spinSpeed * age);
      object.scale.setScalar(particle.size * lifeScale);
      object.updateMatrix();
      const mesh = chips[particle.shape];
      const index = mesh.count++;
      mesh.setMatrixAt(index, object.matrix);
      mesh.setColorAt(index, GOLD[particle.shade]);
      mesh.geometry.attributes.lifetimeAppearance.setXYZ(index, opacity, brightness, angle);

      const pulse = Math.max(0, Math.sin(particle.phase + age * particle.flashRate));
      if (particle.glint && pulse > 0.79) {
        const size = particle.size * lifeScale * (pulse - 0.70) * 7;
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
      }
    });
    trails.finish();
    for (const batch of [...chips, sparks]) {
      if (!batch.count) continue;
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      batch.instanceColor.addUpdateRange(0, batch.count * 3);
      batch.instanceColor.needsUpdate = true;
      const appearance = batch.geometry.attributes.lifetimeAppearance;
      appearance.addUpdateRange(0, batch.count * 3);
      appearance.needsUpdate = true;
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
    const { exporting, sampleCount, winter, overlay } = options;
    const count = settings.depth || settings.shutter ? sampleCount : 1;
    const focus = Math.max(camera.near * 2, settings.focus);
    const aperture = focus * settings.depth * 0.007;
    const exposure = STEP * settings.shutter / 360;
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
    simulation.seek(frame);

    renderer.autoClear = true;
    renderer.setClearColor(0, 0);
    if (winter) {
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
      const fraction = (index + 0.5) / count;
      const time = frame * STEP - exposure * fraction;
      const radius = count === 1 ? 0 : Math.sqrt(((index * (count - 1)) % count + 0.5) / count);
      const sampled = this.setLensSample(camera, focus, aperture, radius, index * GOLDEN_ANGLE);
      this.updateInstances(simulation, time, sampled, settings);
      renderer.autoClear = true;
      renderer.setRenderTarget(samples);
      renderer.render(this.scene, sampled);
      renderer.autoClear = false;
      renderer.setRenderTarget(accumulation);
      this.exposurePass.render(renderer);
    }

    renderer.autoClear = true;
    renderer.setRenderTarget(exporting ? output : null);
    this.backdropMode.value = winter ? 2 : Number(!exporting);
    this.composite.render(renderer);
    if (overlay) {
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
