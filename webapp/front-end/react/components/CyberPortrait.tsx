import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { createPortraitMotion } from "../utils/portraitMotion";

const OPEN_EYES_SRC = "/static/img/cyber-portrait-open.jpg";
const CLOSED_EYES_SRC = "/static/img/cyber-portrait-closed.jpg";

// The portrait photographs are 1024x801.
const PORTRAIT_ASPECT = 1024 / 801;
const PLANE_WIDTH = 3.15;
const PLANE_HEIGHT = PLANE_WIDTH / PORTRAIT_ASPECT;
const GRID_SEGMENTS = 200;
const DEPTH_SCALE = 0.85;
const DEG_TO_RAD = Math.PI / 180;

// ─── Depth field ────────────────────────────────────────────────
// The portrait is a flat photograph pushed into relief: each vertex gets a
// height from a hand-fitted sum of gaussians matching the face's landmarks.
// Coordinates are image space, x left→right and y top→bottom, both 0..1.

function gaussian2D(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleRad: number
): number {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const ux = dx * c + dy * s;
  const uy = -dx * s + dy * c;
  const d2 = (ux * ux) / (rx * rx) + (uy * uy) / (ry * ry);
  return d2 > 16 ? 0 : Math.exp(-d2);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function faceDepth(x: number, y: number): number {
  // Broad ellipsoid so face, fringe and side hair turn as one volume.
  const fdx = (x - 0.495) / 0.52;
  const fdy = (y - 0.46) / 0.56;
  let z = 0.36 * Math.exp(-0.55 * (fdx * fdx + fdy * fdy));

  // Central facial plane, jaw and chin, fringe.
  z += 0.11 * gaussian2D(x, y, 0.49, 0.48, 0.26, 0.34, -0.03);
  z += 0.055 * gaussian2D(x, y, 0.495, 0.865, 0.095, 0.065, 0);
  z += 0.055 * gaussian2D(x, y, 0.485, 0.155, 0.34, 0.13, -0.04);

  // Brow ridges and cheekbones.
  z += 0.032 * gaussian2D(x, y, 0.32, 0.275, 0.11, 0.04, 0.06);
  z += 0.034 * gaussian2D(x, y, 0.61, 0.245, 0.11, 0.04, -0.1);
  z += 0.05 * gaussian2D(x, y, 0.285, 0.485, 0.12, 0.1, 0.18);
  z += 0.052 * gaussian2D(x, y, 0.655, 0.465, 0.12, 0.1, -0.18);

  // Nose bridge and tip.
  const tNose = smoothstep(0.26, 0.54, y);
  const noseCenterX = 0.468 - 0.008 * tNose;
  const bridgeWidth = 0.062 + 0.022 * tNose;
  const ndx = (x - noseCenterX) / bridgeWidth;
  const wy = Math.exp(-Math.pow((y - 0.445) / 0.115, 2));
  z += 0.075 * Math.exp(-ndx * ndx) * wy;
  z += 0.07 * gaussian2D(x, y, 0.462, 0.528, 0.068, 0.058, 0);

  // Lips.
  z += 0.048 * gaussian2D(x, y, 0.484, 0.69, 0.095, 0.038, -0.04);
  z += 0.055 * gaussian2D(x, y, 0.486, 0.752, 0.092, 0.042, -0.04);

  // Eyeballs.
  z += 0.028 * gaussian2D(x, y, 0.318, 0.362, 0.068, 0.045, 0.05);
  z += 0.028 * gaussian2D(x, y, 0.612, 0.336, 0.07, 0.045, -0.08);

  // Neck recess below the chin.
  const neckFactor = smoothstep(0.86, 0.98, y);
  const neckDx = (x - 0.495) / 0.22;
  const neckCyl = Math.exp(-neckDx * neckDx * 1.2);
  z = z * (1 - 0.38 * neckFactor) + 0.06 * neckCyl * neckFactor;

  // Taper toward the frame so the edges stay flat.
  const edgeX = Math.pow((x - 0.5) * 2, 4);
  const edgeY = Math.pow((y - 0.5) * 2, 4);
  return z * Math.exp(-0.35 * (edgeX + edgeY)) - 0.18;
}

// ─── Vertex shader ──────────────────────────────────────────────
// Head rotation happens here rather than on the mesh: the skull turns about
// a pivot behind the face while the neck base and frame edges stay put, and
// the hanging hair lags behind the turn.
const vertexShader = /* glsl */ `
uniform float uDepthScale;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform float uYawRad;
uniform float uPitchRad;
uniform float uRollRad;
uniform float uSwayYawRad;
attribute float aBaseDepth;
varying vec2 vUv;
varying vec3 vViewPos;
varying vec3 vNormalView;

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
}
mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
}

void main() {
  vUv = uv;
  float imgX = uv.x;
  float imgY = 1.0 - uv.y;

  // Flatten the corneal bulge slightly as each lid closes.
  float leftEyeBulge = exp(-pow((imgX - 0.318) / 0.045, 2.0) - pow((imgY - 0.362) / 0.028, 2.0));
  float rightEyeBulge = exp(-pow((imgX - 0.612) / 0.046, 2.0) - pow((imgY - 0.336) / 0.028, 2.0));
  float lidFlatten = -0.012 * (leftEyeBulge * uBlinkLeft + rightEyeBulge * uBlinkRight);

  vec3 p = position;
  p.z = (aBaseDepth + lidFlatten) * uDepthScale;

  float neckBaseMask = smoothstep(0.76, 0.99, imgY) * exp(-pow((imgX - 0.495) / 0.28, 2.0));
  float borderSoftX = 1.0 - 0.55 * pow(abs((imgX - 0.5) * 2.0), 3.2);
  float borderSoftY = 1.0 - 0.45 * pow(abs((imgY - 0.5) * 2.0), 3.6);
  float cranialWeight = (1.0 - 0.78 * neckBaseMask) * borderSoftX * borderSoftY;

  float sideHairZone = smoothstep(0.42, 0.85, imgY) * smoothstep(0.16, 0.36, abs(imgX - 0.495));
  float effYaw = (uYawRad * cranialWeight) + (uSwayYawRad - uYawRad) * 0.32 * sideHairZone;
  float effPitch = uPitchRad * cranialWeight;
  float effRoll = uRollRad * cranialWeight;

  vec3 pivot = vec3(0.0, -0.32, -0.45);
  mat3 R = rotZ(effRoll) * rotX(effPitch) * rotY(effYaw);
  vec3 rotatedPos = pivot + R * (p - pivot);

  // Damp depth change so the cheeks don't stretch at the ends of a turn.
  rotatedPos.z = mix(p.z, rotatedPos.z, 0.72);

  vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
  vViewPos = -mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normalize(R * normal));
  gl_Position = projectionMatrix * mvPosition;
}
`;

// ─── Fragment shader ────────────────────────────────────────────
// Blends the open-eye photograph with a closed-eye version of the same
// frame, sweeping each lid down from the top of its socket, and warps the
// mouth for faint lip movement.
const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uClosedMap;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform vec2 uGazeOffset;
uniform vec2 uSmile;
uniform float uLipPress;
uniform float uIrisGlow;
uniform float uRimLight;

varying vec2 vUv;
varying vec3 vViewPos;
varying vec3 vNormalView;

void evaluateEyeCurtain(
  in vec2 imgCoord,
  in float cx,
  in float cy,
  in float rx,
  in float ryTop,
  in float ryBot,
  in float slope,
  in float blink,
  inout float closedMix,
  inout float movingLashLine,
  inout float openEyeMask
) {
  float dx = imgCoord.x - cx;
  float nx = dx / rx;
  if (abs(nx) >= 1.05) return;

  float clampedNx = clamp(nx, -1.0, 1.0);
  float arch = pow(max(0.0, 1.0 - clampedNx * clampedNx), 0.56);
  float yc = cy + slope * dx;
  float yTop = yc - ryTop * arch;
  float yBot = yc + ryBot * arch;

  if (imgCoord.y < yTop - 0.015 || imgCoord.y > yBot + 0.015) return;

  float v = clamp((imgCoord.y - yTop) / max(0.0001, yBot - yTop), 0.0, 1.0);
  float horizFeather = smoothstep(1.05, 0.82, abs(nx));
  float vertFeather = smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);
  float socketMask = horizFeather * vertFeather;

  float b = clamp(blink, 0.0, 1.0);

  if (b > 0.002) {
    float curtainV = mix(0.08, 1.04, smoothstep(0.0, 0.96, b));
    float revealCurtain = smoothstep(curtainV + 0.08, curtainV - 0.08, v);
    float fullClosed = smoothstep(0.75, 0.98, b);
    float localClosed = mix(revealCurtain * smoothstep(0.0, 0.18, b), 1.0, fullClosed);

    closedMix = max(closedMix, localClosed * socketMask);

    // Lash shadow on the leading edge of the lid, mid-blink only; the
    // closed-eye photograph already carries the resting lash line.
    float midBlinkWeight = sin(b * 3.14159265) * (1.0 - fullClosed);
    float edgeBand = exp(-pow((v - curtainV) / 0.055, 2.0));
    movingLashLine = max(movingLashLine, edgeBand * midBlinkWeight * socketMask * 0.72);
  }

  float openV = smoothstep(0.32, 0.52, v) * smoothstep(0.95, 0.75, v);
  openEyeMask = max(openEyeMask, openV * arch * (1.0 - smoothstep(0.15, 0.75, b)));
}

// Offset to add to a sample position so the photograph appears to move its
// mouth: each corner is drawn up and slightly outward, and the parted lips
// are drawn toward the line between them.
vec2 mouthWarp(vec2 imgCoord) {
  vec2 leftCorner = vec2(0.385, 0.735);
  vec2 rightCorner = vec2(0.595, 0.715);
  vec2 cornerRadius = vec2(0.055, 0.050);

  vec2 dl = (imgCoord - leftCorner) / cornerRadius;
  vec2 dr = (imgCoord - rightCorner) / cornerRadius;
  vec2 lift = exp(-dot(dl, dl)) * uSmile.x * vec2(-0.004, -0.009)
    + exp(-dot(dr, dr)) * uSmile.y * vec2(0.004, -0.009);

  vec2 mouthCenter = vec2(0.490, 0.725);
  float lipLineY = mouthCenter.y - 0.095 * (imgCoord.x - mouthCenter.x);
  vec2 dm = (imgCoord - vec2(mouthCenter.x, lipLineY)) / vec2(0.085, 0.040);
  float press = exp(-dot(dm, dm)) * uLipPress * 0.16 * (imgCoord.y - lipLineY);

  // Moving the picture by an offset means sampling from the opposite side.
  return vec2(-lift.x, -lift.y + press);
}

void main() {
  vec2 imgCoord = vec2(vUv.x, 1.0 - vUv.y);
  vec2 warpedCoord = imgCoord + mouthWarp(imgCoord);
  float closedMix = 0.0;
  float movingLashLine = 0.0;
  float openEyeMask = 0.0;

  evaluateEyeCurtain(
    imgCoord, 0.316, 0.362, 0.092, 0.076, 0.055, 0.11,
    uBlinkLeft, closedMix, movingLashLine, openEyeMask
  );
  evaluateEyeCurtain(
    imgCoord, 0.614, 0.330, 0.096, 0.085, 0.055, -0.21,
    uBlinkRight, closedMix, movingLashLine, openEyeMask
  );

  // Shift the iris within the open eye to follow the gaze.
  vec2 openSampleCoord = warpedCoord;
  if (openEyeMask > 0.01) {
    openSampleCoord -= uGazeOffset * openEyeMask * 0.012;
  }
  vec2 openUv = vec2(openSampleCoord.x, 1.0 - openSampleCoord.y);

  vec3 openCol = texture2D(uMap, openUv).rgb;
  vec3 closedCol = texture2D(uClosedMap, vec2(warpedCoord.x, 1.0 - warpedCoord.y)).rgb;
  vec3 col = mix(openCol, closedCol, clamp(closedMix, 0.0, 1.0));

  if (movingLashLine > 0.001) {
    col = mix(col, vec3(0.04, 0.03, 0.06), movingLashLine);
  }

  // Lift the violet iris glow while the eyes are open.
  float isMagentaIris = clamp((openCol.r + openCol.b - 1.75 * openCol.g) * 1.4, 0.0, 1.0)
    * openEyeMask * (1.0 - closedMix);
  col += vec3(0.28, 0.04, 0.34) * isMagentaIris * (uIrisGlow - 1.0);

  // Corneal catchlights that track the gaze.
  if (openEyeMask > 0.15 && closedMix < 0.5) {
    vec2 leftSpecPos = vec2(0.312, 0.354) + uGazeOffset * 0.011;
    vec2 rightSpecPos = vec2(0.606, 0.326) + uGazeOffset * 0.011;
    float dLeft = length((imgCoord - leftSpecPos) * vec2(1.0, 1.45));
    float dRight = length((imgCoord - rightSpecPos) * vec2(1.0, 1.45));
    float catchLight = smoothstep(0.009, 0.002, dLeft) * (1.0 - uBlinkLeft)
      + smoothstep(0.009, 0.002, dRight) * (1.0 - uBlinkRight);
    col += vec3(0.85, 0.95, 1.0) * catchLight * 0.50 * (1.0 - closedMix);
  }

  // Neon speculars that slide across the relief as the head turns.
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(vViewPos);
  float specCyan = pow(max(dot(N, normalize(normalize(vec3(-0.65, 0.25, 0.72)) + V)), 0.0), 28.0);
  float specMag = pow(max(dot(N, normalize(normalize(vec3(0.70, 0.35, 0.62)) + V)), 0.0), 24.0);
  float specAmb = pow(max(dot(N, normalize(normalize(vec3(0.0, -0.78, 0.62)) + V)), 0.0), 20.0);

  float lipGloss = exp(-pow((imgCoord.x - 0.485) / 0.085, 2.0) - pow((imgCoord.y - 0.735) / 0.055, 2.0));
  float noseGloss = exp(-pow((imgCoord.x - 0.460) / 0.045, 2.0) - pow((imgCoord.y - 0.528) / 0.045, 2.0));
  float surfaceGloss = 0.10 + 0.28 * (lipGloss + noseGloss) + 0.22 * openEyeMask * (1.0 - closedMix);

  col += (
    vec3(0.18, 0.82, 1.0) * specCyan * 0.50 +
    vec3(0.96, 0.32, 0.92) * specMag * 0.50 +
    vec3(1.0, 0.52, 0.12) * specAmb * 0.45
  ) * surfaceGloss * uRimLight;

  // Fade to transparent at the frame so the portrait sits on the panel.
  float edgeX = smoothstep(0.495, 0.42, abs(vUv.x - 0.5));
  float edgeY = smoothstep(0.495, 0.43, abs(vUv.y - 0.5));
  float alphaMask = edgeX * edgeY;

  gl_FragColor = vec4(col * alphaMask, alphaMask);
}
`;

function buildGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT, GRID_SEGMENTS, GRID_SEGMENTS);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const baseDepth = new Float32Array(position.count);

  for (let i = 0; i < position.count; i++) {
    const z = faceDepth(uv.getX(i), 1 - uv.getY(i));
    baseDepth[i] = z;
    position.setZ(i, z);
  }

  geometry.setAttribute("aBaseDepth", new THREE.BufferAttribute(baseDepth, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function loadTexture(loader: THREE.TextureLoader, src: string): Promise<THREE.Texture> {
  return loader.loadAsync(src).then(texture => {
    // The shader works directly on the photograph's encoded values, so the
    // texture must not be decoded to linear on upload.
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  });
}

interface CyberPortraitProps {
  /** Rendered width in px; the height follows the portrait's aspect ratio. */
  size?: number;
  /** Eyes open and looking around when true; eyes closed at rest when false. */
  active?: boolean;
}

export default function CyberPortrait({ size = 282, active = false }: CyberPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const width = size;
  const height = Math.round(size / PORTRAIT_ASPECT);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // No WebGL available; leave the area empty.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 0.03, 4.25);
    camera.lookAt(0, 0.02, 0);

    const head = new THREE.Group();
    scene.add(head);

    const geometry = buildGeometry();
    const uniforms = {
      uMap: { value: null as THREE.Texture | null },
      uClosedMap: { value: null as THREE.Texture | null },
      uDepthScale: { value: DEPTH_SCALE },
      uBlinkLeft: { value: 1 },
      uBlinkRight: { value: 1 },
      uYawRad: { value: 0 },
      uPitchRad: { value: 0 },
      uRollRad: { value: 0 },
      uSwayYawRad: { value: 0 },
      uGazeOffset: { value: new THREE.Vector2(0, 0) },
      uSmile: { value: new THREE.Vector2(0, 0) },
      uLipPress: { value: 0 },
      uIrisGlow: { value: 1.25 },
      uRimLight: { value: 1.15 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      premultipliedAlpha: true,
    });
    head.add(new THREE.Mesh(geometry, material));

    const motion = createPortraitMotion();
    const textures: THREE.Texture[] = [];
    let disposed = false;
    let frame = 0;
    let lastMs = performance.now();

    const render = (nowMs: number) => {
      frame = requestAnimationFrame(render);
      const pose = motion.step((nowMs - lastMs) / 1000, activeRef.current);
      lastMs = nowMs;

      const yawRad = pose.yawDeg * DEG_TO_RAD;
      const pitchRad = pose.pitchDeg * DEG_TO_RAD;
      const rollRad = pose.rollDeg * DEG_TO_RAD;

      // Most of the turn is articulated in the vertex shader; a small rigid
      // rotation of the whole relief adds parallax.
      head.rotation.set(pitchRad * 0.18, yawRad * 0.18, rollRad * 0.22);
      head.position.y = pose.floatY;

      uniforms.uYawRad.value = yawRad * 0.82;
      uniforms.uPitchRad.value = pitchRad * 0.82;
      uniforms.uRollRad.value = rollRad * 0.78;
      uniforms.uSwayYawRad.value = pose.swayYawDeg * DEG_TO_RAD * 0.82;
      uniforms.uBlinkLeft.value = pose.lidLeft;
      uniforms.uBlinkRight.value = pose.lidRight;
      uniforms.uGazeOffset.value.set(pose.gazeX, pose.gazeY);
      uniforms.uSmile.value.set(pose.smileLeft, pose.smileRight);
      uniforms.uLipPress.value = pose.lipPress;

      renderer.render(scene, camera);
    };

    const loader = new THREE.TextureLoader();
    Promise.all([loadTexture(loader, OPEN_EYES_SRC), loadTexture(loader, CLOSED_EYES_SRC)])
      .then(([openTexture, closedTexture]) => {
        textures.push(openTexture, closedTexture);
        if (disposed) {
          textures.forEach(texture => texture.dispose());
          return;
        }
        uniforms.uMap.value = openTexture;
        uniforms.uClosedMap.value = closedTexture;
        lastMs = performance.now();
        frame = requestAnimationFrame(render);
      })
      .catch(error => {
        console.error("Cyber Portrait textures failed to load", error);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      textures.forEach(texture => texture.dispose());
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="cyber-portrait"
      style={{ width, height }}
      aria-busy={active ? "true" : "false"}
      role="img"
      aria-label={active ? "AI working" : "AI idle"}
    />
  );
}
