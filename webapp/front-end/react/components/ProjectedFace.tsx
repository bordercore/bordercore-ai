import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { FaceQuality } from "../stores/ChatStoreContext";
import { FaceConfig, FaceId, FACES } from "../utils/faceConfigs";
import { createFaceLifecycle, createFaceMotion, FacePose, FaceState } from "../utils/faceMotion";
import { createGlyphField, drawGlyphFrame, GlyphField, Landmark } from "../utils/faceGlyphs";
import {
  eyeFragmentShader,
  eyeVertexShader,
  plateFragmentShader,
  plateVertexShader,
  skinFragmentShader,
  skinVertexShader,
  teethFragmentShader,
  teethVertexShader,
} from "../utils/faceShaders";

// A face is a reference picture projected onto a head model. The model is
// baked from ICT-FaceKit by scripts/bake-face.mjs, fitted to the picture
// that scripts/prepare_face_picture.py splits into two layers. Which face
// is shown, and the little that differs between them, comes from
// utils/faceConfigs.

const DEG_TO_RAD = Math.PI / 180;
// The head turns about a point in the neck, in the model's own space
// (scene units; 1 = 10 cm).
const NECK_PIVOT = new THREE.Vector3(0, -1.0, -0.1);
// The backplate stands at the depth of this point inside the head.
const HEAD_CENTRE = new THREE.Vector3(0, 0.3, 0);
// How much larger the backplate is than the picture, so its edges stay out
// of view as the head moves.
const PLATE_OVERSCAN = 1.5;
// Emissive strength of the glyph texture; above 1 so the bloom picks it up.
const GLYPH_GAIN = 1.3;
// The glyphs painted on the picture start to draw in this many seconds
// into a query and take this long.
const REVEAL_START_SEC = 1.2;
const REVEAL_SPAN_SEC = 7;
// Half the angle the iris covers on the eyeball, in radians, where a face
// does not take it from its picture.
const IRIS_ANGLE = 0.34;

/** What the bake records about how the head sits in the reference picture. */
interface HeadFit {
  fovDeg: number;
  cameraDistance: number;
  rotation: [number, number, number, number];
  translation: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  restWeights: Record<string, number>;
}

interface QualitySettings {
  /** Upper bound on the device pixel ratio. */
  maxPixelRatio: number;
  bloom: boolean;
  /** MSAA samples on the offscreen target. */
  samples: number;
  /** Glyph texture size in pixels. */
  glyphSize: number;
  /** How often the glyph texture is redrawn. */
  glyphHz: number;
  /** Frame rate cap. */
  fps: number;
}

// The model runs alongside a local LLM, so even "high" stays modest: the
// bloom pass works at half resolution and the pixel ratio is capped.
const QUALITY: Record<FaceQuality, QualitySettings> = {
  low: { maxPixelRatio: 1, bloom: false, samples: 0, glyphSize: 512, glyphHz: 12, fps: 24 },
  medium: { maxPixelRatio: 1.5, bloom: true, samples: 4, glyphSize: 1024, glyphHz: 20, fps: 30 },
  high: { maxPixelRatio: 2, bloom: true, samples: 4, glyphSize: 1024, glyphHz: 30, fps: 60 },
};

export interface ProjectedFaceHandle {
  /** Pin the lifecycle state, or pass null to follow the query again. */
  setState(state: FaceState | null): void;
  /** Blink now; `double` adds a second blink straight after. */
  blink(double?: boolean): void;
  /**
   * Hold the gaze at a direction in degrees (positive yaw is the viewer's
   * right, positive pitch is up; 0, 0 is eye contact). Pass null to let her
   * look around again.
   */
  lookAt(yawDeg: number | null, pitchDeg?: number): void;
  /**
   * Lip activity, 0 to 1. Pass null to hand the lips back: they then stay
   * as painted, or follow the response stream if `animateMouth` is set.
   */
  setSpeak(amount: number | null): void;
  /** Glyph density, 0 to 1, or null to let it grow with waiting time. */
  setGlyphIntensity(amount: number | null): void;
  /** Report that `chars` characters of the response just arrived. */
  notifyChunk(chars: number): void;
}

interface Engine extends ProjectedFaceHandle {
  setActive(active: boolean): void;
  setQuality(quality: FaceQuality): void;
  setAnimateMouth(animate: boolean): void;
  setMouthOpenness(openness: number): void;
  dispose(): void;
}

function createEngine(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  config: FaceConfig,
  initialQuality: FaceQuality
): Engine | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      // Leave the discrete GPU to the model where there is a choice.
      powerPreference: "low-power",
    });
  } catch {
    // No WebGL available; leave the area empty.
    return null;
  }
  // The picture is shown as painted, so no tone curve is applied.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x010208, 1);

  const scene = new THREE.Scene();
  // Replaced by the fitted camera once the model has loaded.
  const camera = new THREE.PerspectiveCamera(20, width / height, 0.5, 40);
  camera.position.set(0, 0, 6);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // The mover carries everything that turns with the head. It sits at the
  // neck pivot; the model hangs off it in the pose that matches the picture.
  const mover = new THREE.Group();
  scene.add(mover);
  const moverRest = new THREE.Vector3();
  // Takes a point in the model's space to where it falls in the picture.
  const pictureMatrix = new THREE.Matrix4();

  // Shared uniforms.
  const glow = { value: 0.35 };
  const picture = { value: null as THREE.Texture | null };
  const skinUniforms = {
    uPicture: picture,
    uPictureGlyphs: { value: null as THREE.Texture | null },
    uGlyphMap: { value: null as THREE.Texture | null },
    uGlyphGain: { value: GLYPH_GAIN },
    uScanV: { value: -1 },
    uDissolve: { value: 0 },
    uReveal: { value: 0 },
    uRevealFrom: { value: new THREE.Vector2(...config.revealFrom) },
    uPaintedGain: { value: config.pictureGlyphGain },
    uLidBlur: { value: config.lid.blur },
    uLidShade: { value: config.lid.shade },
    uLidCover: { value: config.lid.cover },
    uBlinkLeft: { value: 1 },
    uBlinkRight: { value: 1 },
    // Centre and radii of each painted eye in the picture: her right eye,
    // then her left.
    uEyeRight: { value: new THREE.Vector4(0.32, 0.38, 0.1, 0.05) },
    uEyeLeft: { value: new THREE.Vector4(0.61, 0.38, 0.1, 0.05) },
    // The line each closed eye makes: the corners of the lower lid in the
    // picture (x, y, x, y), and how far it dips between them.
    uLidLineRight: { value: new THREE.Vector4(0.25, 0.38, 0.39, 0.4) },
    uLidLineLeft: { value: new THREE.Vector4(0.53, 0.4, 0.69, 0.38) },
    uLidSag: { value: new THREE.Vector2(0.012, 0.012) },
    uPictureMatrix: { value: new THREE.Matrix4() },
    uUnit: { value: 1 },
    uNeckTop: { value: -0.7 },
    uNeckBottom: { value: -1.1 },
    uGlow: glow,
  };
  const eyeUniforms = [0, 1].map(() => ({
    uPicture: picture,
    uPictureMatrix: { value: new THREE.Matrix4() },
    uAxis: { value: new THREE.Vector3(0, 0, 1) },
    uIrisAngle: { value: IRIS_ANGLE },
    uIrisInner: { value: new THREE.Vector3(...config.iris.inner) },
    uIrisOuter: { value: new THREE.Vector3(...config.iris.outer) },
    uPupil: { value: config.iris.pupil },
    uLimbal: { value: config.iris.limbal },
    uExposure: { value: config.iris.exposure },
    uCatchlight: { value: config.iris.catchlight },
    uPupilColor: { value: new THREE.Vector3(...config.iris.pupilColor) },
    uGlow: glow,
    uOpen: { value: 0 },
    uDepthBias: { value: 0.02 },
  }));

  // Post-processing: render, bloom at half resolution, then encode.
  let qualityName = initialQuality;
  let quality = QUALITY[initialQuality];
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let renderTarget: THREE.WebGLRenderTarget | null = null;

  const buildComposer = () => {
    composer?.dispose();
    bloomPass?.dispose();
    renderTarget?.dispose();

    const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    renderTarget = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: quality.samples,
    });
    composer = new EffectComposer(renderer, renderTarget);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = null;
    if (quality.bloom) {
      // UnrealBloomPass halves the resolution it is given for its first blur.
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width * pixelRatio, height * pixelRatio),
        0.55,
        0.5,
        0.8
      );
      composer.addPass(bloomPass);
    }
    composer.addPass(new OutputPass());
  };

  // Glyph texture.
  let glyphCanvas: HTMLCanvasElement | null = null;
  let glyphContext: CanvasRenderingContext2D | null = null;
  let glyphTexture: THREE.CanvasTexture | null = null;

  const buildGlyphTexture = () => {
    glyphTexture?.dispose();
    glyphCanvas = document.createElement("canvas");
    glyphCanvas.width = quality.glyphSize;
    glyphCanvas.height = quality.glyphSize;
    glyphContext = glyphCanvas.getContext("2d");
    if (glyphContext) {
      glyphContext.fillStyle = "#000";
      glyphContext.fillRect(0, 0, quality.glyphSize, quality.glyphSize);
    }
    glyphTexture = new THREE.CanvasTexture(glyphCanvas);
    glyphTexture.colorSpace = THREE.SRGBColorSpace;
    // Mipmaps keep the thin strokes from shimmering when the face is small.
    glyphTexture.generateMipmaps = quality.glyphSize > 512;
    glyphTexture.minFilter = glyphTexture.generateMipmaps
      ? THREE.LinearMipmapLinearFilter
      : THREE.LinearFilter;
    skinUniforms.uGlyphMap.value = glyphTexture;
  };

  buildComposer();
  buildGlyphTexture();

  // State driven from outside.
  const lifecycle = createFaceLifecycle();
  const motion = createFaceMotion();
  let glyphs: GlyphField | null = null;
  let active = false;
  let animateMouth = false;
  let mouthOpenness = 1;
  let lookAt: { yawDeg: number; pitchDeg: number } | null = null;
  let speakOverride: number | null = null;
  let intensityOverride: number | null = null;

  // Model parts, filled in once the GLB has loaded.
  let morphMeshes: THREE.Mesh[] = [];
  let eyes: THREE.Object3D[] = [];
  // How far each eye is turned within the head for eye contact, in degrees.
  let eyeRest: { yawDeg: number; pitchDeg: number }[] = [];
  let fit: HeadFit | null = null;
  let disposed = false;
  let loaded = false;
  let sleeping = true;
  let frameHandle = 0;
  let lastMs = 0;
  let glyphElapsed = 0;
  let glyphChunks = 0;
  let glyphsShowing = false;

  const setMorph = (name: string, value: number) => {
    for (const mesh of morphMeshes) {
      const index = mesh.morphTargetDictionary?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1.2, value));
      }
    }
  };
  /** Weight of a shape in the pose that matches the picture. */
  const rest = (name: string): number => fit?.restWeights[name] ?? 0;

  const applyPose = (pose: FacePose) => {
    if (!fit) return;
    mover.rotation.set(
      -pose.headPitchDeg * DEG_TO_RAD,
      pose.headYawDeg * DEG_TO_RAD,
      pose.headRollDeg * DEG_TO_RAD
    );
    mover.position.set(moverRest.x, moverRest.y + pose.bobY, moverRest.z);

    eyes.forEach((eye, index) => {
      const eyePitch = (pose.eyePitchDeg + eyeRest[index].pitchDeg) * DEG_TO_RAD;
      const eyeYaw = (pose.eyeYawDeg + eyeRest[index].yawDeg) * DEG_TO_RAD;
      eye.rotation.set(-eyePitch, eyeYaw, 0, "YXZ");
      eye.updateMatrix();
      eyeUniforms[index].uPictureMatrix.value.multiplyMatrices(pictureMatrix, eye.matrix);
    });
    // The lids follow the eyes away from that. The painted lids already
    // suit eye contact, so only the difference counts. "Left" is her left,
    // the viewer's right.
    const right = Math.max(0, pose.eyeYawDeg) / 30;
    const left = Math.max(0, -pose.eyeYawDeg) / 30;
    setMorph("eyeLookOutLeft", right);
    setMorph("eyeLookInRight", right);
    setMorph("eyeLookInLeft", left);
    setMorph("eyeLookOutRight", left);
    const up = Math.max(0, pose.eyePitchDeg) / 22;
    const down = Math.max(0, -pose.eyePitchDeg) / 22;
    const lids = { Left: pose.lidLeft, Right: pose.lidRight };
    for (const side of ["Left", "Right"] as const) {
      const lid = lids[side];
      setMorph(`eyeLookUp${side}`, up);
      setMorph(`eyeLookDown${side}`, down);
      // Every shape starts from its weight in the picture's own pose.
      setMorph(`eyeBlink${side}`, lid + rest(`eyeBlink${side}`) * (1 - lid));
      setMorph(`eyeWide${side}`, rest(`eyeWide${side}`) * (1 - lid));
      setMorph(`browInnerUp${side}`, rest(`browInnerUp${side}`) + pose.browRaise * 0.6);
      setMorph(`browOuterUp${side}`, rest(`browOuterUp${side}`) + pose.browRaise * 0.4);
      setMorph(`browDown${side}`, rest(`browDown${side}`) * (1 - pose.browRaise * 0.6));
      setMorph(`mouthPress${side}`, pose.mouth.press);
      setMorph(`mouthStretch${side}`, pose.mouth.stretch);
      // The shapes that part her lips in the picture, eased off to close
      // her mouth further than it is there.
      setMorph(
        `mouthLowerDown${side}`,
        rest(`mouthLowerDown${side}`) * mouthOpenness + pose.mouth.lowerDown
      );
      setMorph(`mouthUpperUp${side}`, rest(`mouthUpperUp${side}`) * mouthOpenness);
    }
    skinUniforms.uBlinkLeft.value = pose.lidLeft;
    skinUniforms.uBlinkRight.value = pose.lidRight;
    eyeUniforms[0].uOpen.value = 1 - pose.lidLeft;
    eyeUniforms[1].uOpen.value = 1 - pose.lidRight;
    // More clearance as the lids come down over the eye.
    eyeUniforms[0].uDepthBias.value = 0.015 + 0.06 * pose.lidLeft;
    eyeUniforms[1].uDepthBias.value = 0.015 + 0.06 * pose.lidRight;
    // Her lips are already parted in the picture; pressing them closes that.
    setMorph(
      "jawOpen",
      rest("jawOpen") * mouthOpenness * (1 - pose.mouth.press) + pose.mouth.jawOpen
    );
    setMorph("mouthFunnel", rest("mouthFunnel") + pose.mouth.funnel);
    setMorph("mouthPucker", pose.mouth.pucker);

    glow.value = 0.3 + 0.7 * pose.presence;
  };

  /** Advances everything by `dt` seconds and draws. Returns true once at rest. */
  const tick = (dt: number): boolean => {
    const snapshot = lifecycle.step(dt, active);
    const pose = motion.step(dt, {
      state: snapshot.state,
      // Left alone, her lips stay as they are in the picture.
      speak: speakOverride ?? (animateMouth ? snapshot.speak : 0),
      lookAt,
      idleMouth: animateMouth,
    });
    applyPose(pose);

    // The glyph texture is redrawn at its own, lower rate.
    glyphElapsed += dt;
    glyphChunks += snapshot.chunks;
    if (glyphs && glyphContext && glyphTexture && glyphElapsed >= 1 / quality.glyphHz) {
      const glyphFrame = glyphs.step(glyphElapsed, {
        state: snapshot.state,
        chunks: glyphChunks,
        intensity: intensityOverride,
      });
      glyphElapsed = 0;
      glyphChunks = 0;
      const showing =
        glyphFrame.lines.length + glyphFrame.dots.length + glyphFrame.chars.length > 0;
      if (showing || glyphsShowing) {
        drawGlyphFrame(glyphContext, quality.glyphSize, glyphFrame);
        glyphTexture.needsUpdate = true;
      }
      glyphsShowing = showing;
      skinUniforms.uGlyphGain.value = GLYPH_GAIN * glyphFrame.gain;
      skinUniforms.uScanV.value = glyphFrame.scanV;
      skinUniforms.uDissolve.value = glyphFrame.dissolve;
      skinUniforms.uReveal.value = Math.max(
        0,
        Math.min(1, (glyphFrame.density - REVEAL_START_SEC) / REVEAL_SPAN_SEC)
      );
    }

    composer?.render();

    return (
      snapshot.state === "idle" &&
      pose.presence < 0.004 &&
      pose.lidLeft > 0.995 &&
      !glyphsShowing &&
      !active
    );
  };

  const frame = (nowMs: number) => {
    if (disposed) return;
    frameHandle = requestAnimationFrame(frame);
    const elapsedMs = nowMs - lastMs;
    // Hold to the frame rate cap, with a little slack for timer jitter.
    if (elapsedMs < 1000 / quality.fps - 2) return;
    lastMs = nowMs;
    // Once she has come to rest and nothing is moving, stop drawing
    // altogether.
    if (tick(Math.min(elapsedMs / 1000, 0.1))) {
      sleeping = true;
      cancelAnimationFrame(frameHandle);
    }
  };

  const wake = () => {
    if (disposed || !loaded || !sleeping) return;
    sleeping = false;
    lastMs = performance.now();
    frameHandle = requestAnimationFrame(frame);
  };

  const loadPicture = (src: string) =>
    new THREE.TextureLoader().loadAsync(src).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Picture coordinates run down from the top, as the bake wrote them.
      texture.flipY = false;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return track(texture);
    });

  Promise.all([
    new GLTFLoader().loadAsync(config.model),
    loadPicture(config.picture),
    loadPicture(config.pictureGlyphs),
  ])
    .then(([gltf, pictureTexture, pictureGlyphs]) => {
      if (disposed) return;
      picture.value = pictureTexture;
      skinUniforms.uPictureGlyphs.value = pictureGlyphs;

      const model = gltf.scene;
      const headFit = model.userData.fit as HeadFit;
      const landmarkData = model.userData.landmarks as number[][];
      const landmarks: Landmark[] = landmarkData.map(([u, v]) => ({ u, v }));
      glyphs = createGlyphField(landmarks, Math.random, {
        constellationSide: config.constellationSide,
      });

      // Use the camera the head was fitted to, so that at rest the painted
      // head reproduces the picture.
      camera.fov = headFit.fovDeg;
      camera.position.set(0, 0, headFit.cameraDistance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      const restRotation = new THREE.Quaternion().fromArray(headFit.rotation);
      const restTranslation = new THREE.Vector3().fromArray(headFit.translation);
      const toWorld = (point: THREE.Vector3) =>
        point.clone().applyQuaternion(restRotation).add(restTranslation);
      camera.updateMatrixWorld();
      pictureMatrix
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(
          new THREE.Matrix4().compose(restTranslation, restRotation, new THREE.Vector3(1, 1, 1))
        );
      moverRest.copy(toWorld(NECK_PIVOT));
      mover.position.copy(moverRest);
      model.quaternion.copy(restRotation);
      model.position.copy(restTranslation).sub(moverRest);
      mover.add(model);

      // The backplate fills the view at the depth of the middle of the head.
      const plateZ = toWorld(HEAD_CENTRE).z;
      const plateSize =
        2 * (headFit.cameraDistance - plateZ) * Math.tan((headFit.fovDeg * DEG_TO_RAD) / 2);
      const plate = new THREE.Mesh(
        track(new THREE.PlaneGeometry(plateSize * PLATE_OVERSCAN, plateSize * PLATE_OVERSCAN)),
        track(
          new THREE.ShaderMaterial({
            vertexShader: plateVertexShader,
            fragmentShader: plateFragmentShader,
            uniforms: { uPicture: picture, uOverscan: { value: PLATE_OVERSCAN } },
          })
        )
      );
      plate.position.set(-moverRest.x, -moverRest.y, plateZ - moverRest.z);
      plate.renderOrder = -1;
      mover.add(plate);

      // Where each painted eye sits in the picture, from where the model's
      // landmarks fall in it.
      const inPicture = (index: number) => {
        const [, , x, y, z] = landmarkData[index];
        const clip = new THREE.Vector4(x, y, z, 1).applyMatrix4(pictureMatrix);
        return new THREE.Vector2(0.5 + (0.5 * clip.x) / clip.w, 0.5 - (0.5 * clip.y) / clip.w);
      };
      // The painted eye with its lashes, as an ellipse around the corners.
      const paintedEye = (cornerA: number, cornerB: number) => {
        const a = inPicture(cornerA);
        const b = inPicture(cornerB);
        const halfWidth = a.distanceTo(b) / 2;
        return [(a.x + b.x) / 2, (a.y + b.y) / 2, halfWidth * 1.45, halfWidth * 0.78] as const;
      };
      skinUniforms.uEyeRight.value.set(...paintedEye(36, 39));
      skinUniforms.uEyeLeft.value.set(...paintedEye(42, 45));
      // The lower lid, from the viewer's left corner to the right, and how
      // far its middle hangs below the line between them.
      const lowerLid = (left: number, right: number, middle: number[]) => {
        const a = inPicture(left);
        const b = inPicture(right);
        const dip = middle.reduce((sum, index) => sum + inPicture(index).y, 0) / middle.length;
        return { line: [a.x, a.y, b.x, b.y] as const, sag: dip - (a.y + b.y) / 2 };
      };
      const rightLid = lowerLid(36, 39, [40, 41]);
      const leftLid = lowerLid(42, 45, [46, 47]);
      skinUniforms.uLidLineRight.value.set(...rightLid.line);
      skinUniforms.uLidLineLeft.value.set(...leftLid.line);
      skinUniforms.uLidSag.value.set(rightLid.sag, leftLid.sag);
      const part = (name: string) => model.getObjectByName(name) as THREE.Mesh;
      const skin = part("skin");
      const teeth = part("teeth");
      const eyeMeshes = [part("eyeL"), part("eyeR")];

      // The neck fades out a little below the chin, leaving the collar to
      // the backplate.
      const chinY = landmarkData[8][3];
      skinUniforms.uUnit.value = skin.scale.x;
      skin.updateMatrix();
      skinUniforms.uPictureMatrix.value.multiplyMatrices(pictureMatrix, skin.matrix);
      skinUniforms.uNeckTop.value = chinY - 0.1;
      skinUniforms.uNeckBottom.value = chinY - 0.5;
      skin.material = track(
        new THREE.ShaderMaterial({
          vertexShader: skinVertexShader,
          fragmentShader: skinFragmentShader,
          uniforms: skinUniforms,
          transparent: true,
        })
      );
      teeth.material = track(
        new THREE.ShaderMaterial({
          vertexShader: teethVertexShader,
          fragmentShader: teethFragmentShader,
        })
      );
      eyeMeshes.forEach((eye, index) => {
        // The bake records which way each cornea faces.
        eyeUniforms[index].uAxis.value.fromArray(eye.userData.axis as number[]).normalize();
        eye.material = track(
          new THREE.ShaderMaterial({
            vertexShader: eyeVertexShader,
            fragmentShader: eyeFragmentShader,
            uniforms: eyeUniforms[index],
          })
        );
      });

      model.traverse(object => {
        // Bounds from the quantised rest pose are no use once morphed.
        object.frustumCulled = false;
        if ((object as THREE.Mesh).isMesh) track((object as THREE.Mesh).geometry);
      });

      morphMeshes = [skin, teeth];
      eyes = eyeMeshes;
      eyeRest = eyeMeshes.map((eye, index) => {
        if (config.irisPlacement === "marked") {
          const marked = eye.userData.iris as { yawDeg: number; pitchDeg: number; angle: number };
          eyeUniforms[index].uIrisAngle.value = marked.angle;
          return marked;
        }
        // In the picture her head is turned and tipped, so the eyes turn
        // back by as much within it.
        return { yawDeg: -headFit.yawDeg, pitchDeg: -headFit.pitchDeg };
      });
      fit = headFit;
      // Shapes the motion never touches still need their weight in the
      // picture's pose.
      for (const [name, weight] of Object.entries(headFit.restWeights)) setMorph(name, weight);

      loaded = true;
      wake();
    })
    .catch(error => {
      console.error(`${config.label} failed to load`, error);
    });

  return {
    setActive(next) {
      active = next;
      wake();
    },
    setQuality(next) {
      if (next === qualityName) return;
      qualityName = next;
      quality = QUALITY[next];
      buildComposer();
      buildGlyphTexture();
      glyphsShowing = true;
      wake();
    },
    setAnimateMouth(animate) {
      animateMouth = animate;
    },
    setMouthOpenness(openness) {
      mouthOpenness = Math.max(0, Math.min(1, openness));
      wake();
    },
    setState(state) {
      lifecycle.setState(state);
      wake();
    },
    blink(double) {
      motion.blink(double);
      wake();
    },
    lookAt(yawDeg, pitchDeg = 0) {
      lookAt = yawDeg === null ? null : { yawDeg, pitchDeg };
      wake();
    },
    setSpeak(amount) {
      speakOverride = amount;
      wake();
    },
    setGlyphIntensity(amount) {
      intensityOverride = amount;
      wake();
    },
    notifyChunk(chars) {
      lifecycle.notifyChunk(chars);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      disposables.forEach(item => item.dispose());
      glyphTexture?.dispose();
      bloomPass?.dispose();
      composer?.dispose();
      renderTarget?.dispose();
      renderer.dispose();
    },
  };
}

interface ProjectedFaceProps {
  /** Which face to show. */
  face: FaceId;
  /** Rendered width and height in px. */
  size?: number;
  /** True while a response is being generated. */
  active?: boolean;
  quality?: FaceQuality;
  /**
   * Let her lips move by themselves: parting and muttering while she waits,
   * and following the response as it streams. Off by default, which keeps
   * her mouth as it is in the picture.
   */
  animateMouth?: boolean;
  /**
   * How far her lips are parted at rest: 1 is as in the picture, 0 is
   * closed. Defaults to what suits the face.
   */
  mouthOpenness?: number;
}

type ConsoleHost = Partial<Record<FaceId, ProjectedFaceHandle>>;

const ProjectedFace = forwardRef<ProjectedFaceHandle, ProjectedFaceProps>(function ProjectedFace(
  {
    face,
    size = 282,
    active = false,
    quality = "medium",
    animateMouth = false,
    mouthOpenness = FACES[face].mouthOpenness,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef({ active, quality, animateMouth, mouthOpenness });
  latest.current = { active, quality, animateMouth, mouthOpenness };

  const width = size;
  // Square, like the reference picture.
  const height = size;

  const handleRef = useRef<ProjectedFaceHandle>({
    setState: state => engineRef.current?.setState(state),
    blink: double => engineRef.current?.blink(double),
    lookAt: (yawDeg, pitchDeg) => engineRef.current?.lookAt(yawDeg, pitchDeg),
    setSpeak: amount => engineRef.current?.setSpeak(amount),
    setGlyphIntensity: amount => engineRef.current?.setGlyphIntensity(amount),
    notifyChunk: chars => engineRef.current?.notifyChunk(chars),
  });
  useImperativeHandle(ref, () => handleRef.current, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createEngine(canvas, width, height, FACES[face], latest.current.quality);
    if (!engine) return;
    engineRef.current = engine;
    engine.setAnimateMouth(latest.current.animateMouth);
    engine.setMouthOpenness(latest.current.mouthOpenness);
    engine.setActive(latest.current.active);

    // Also reachable from the browser console under the face's own name
    // (window.nova, window.sable), for driving her by hand.
    const host = window as unknown as ConsoleHost;
    const handle = handleRef.current;
    host[face] = handle;

    return () => {
      if (host[face] === handle) delete host[face];
      engineRef.current = null;
      engine.dispose();
    };
  }, [face, width, height]);

  useEffect(() => {
    engineRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    engineRef.current?.setAnimateMouth(animateMouth);
  }, [animateMouth]);

  useEffect(() => {
    engineRef.current?.setMouthOpenness(mouthOpenness);
  }, [mouthOpenness]);

  return (
    <canvas
      ref={canvasRef}
      className="projected-face"
      style={{ width, height }}
      aria-busy={active ? "true" : "false"}
      role="img"
      aria-label={active ? "AI working" : "AI idle"}
    />
  );
});

export default ProjectedFace;
