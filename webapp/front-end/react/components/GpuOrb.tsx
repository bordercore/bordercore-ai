import React, { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import useGpuStats, { GpuStats } from "../hooks/useGpuStats";

// ─── Inline Ashima simplex noise (3D) ──────────────────────────
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0,0.5,1.0,2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  f += 0.5000 * snoise(p); p *= 2.01;
  f += 0.2500 * snoise(p); p *= 2.02;
  f += 0.1250 * snoise(p); p *= 2.03;
  f += 0.0625 * snoise(p);
  return f / 0.9375;
}
`;

// ─── Vertex Shader ──────────────────────────────────────────────
const vertexShader = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uGpuUtil;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
  float noiseScale = 1.5 + uGpuUtil * 2.0;
  float displacement = fbm(position * noiseScale + uTime * 0.4) * (0.05 + uGpuUtil * 0.25);
  vec3 newPosition = position + normal * displacement;

  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelViewMatrix * vec4(newPosition, 1.0)).xyz;
  vDisplacement = displacement;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

// ─── Fragment Shader ────────────────────────────────────────────
const fragmentShader = /* glsl */ `
uniform float uTemperature;
uniform float uMemPressure;
uniform float uPowerDraw;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
  // Temperature-driven color: electric blue (cool) → hot red (hot)
  float tempNorm = clamp((uTemperature - 30.0) / 60.0, 0.0, 1.0);
  vec3 coolColor = vec3(0.0, 0.55, 1.0);    // deep electric blue
  vec3 midColor  = vec3(0.95, 0.0, 0.7);    // hot magenta
  vec3 warmColor = vec3(1.0, 0.15, 0.0);    // intense red-orange

  // Two-stop gradient: blue → magenta → red
  vec3 baseColor = tempNorm < 0.5
    ? mix(coolColor, midColor, tempNorm * 2.0)
    : mix(midColor, warmColor, (tempNorm - 0.5) * 2.0);

  // Memory pressure → core brightness with higher floor
  float brightness = 0.6 + uMemPressure * 0.5;
  baseColor *= brightness;

  // Fresnel rim glow — high-contrast complementary: green-cyan vs warm gold
  vec3 viewDir = normalize(-vPosition);
  float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.0);
  float glowStrength = 0.5 + uPowerDraw * 0.7;
  vec3 rimColor = mix(vec3(0.0, 1.0, 0.6), vec3(1.0, 0.9, 0.0), tempNorm);

  vec3 finalColor = baseColor + rimColor * fresnel * glowStrength;

  // Displacement highlights — bright white on peaks
  finalColor += vec3(0.4, 0.35, 0.3) * smoothstep(0.0, 0.10, vDisplacement);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ─── Lerp helper ────────────────────────────────────────────────
function lerpTo(current: number, target: number, speed: number, dt: number): number {
  return current + (target - current) * Math.min(speed * dt, 1.0);
}

// ─── OrbMesh ────────────────────────────────────────────────────
function OrbMesh({ statsRef, available, active }: {
  statsRef: React.MutableRefObject<GpuStats>;
  available: boolean;
  active: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const smoothed = useRef({ gpuUtil: 0, memPressure: 0, temperature: 30, powerDraw: 0 });

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uGpuUtil: { value: 0 },
    uTemperature: { value: 30 },
    uMemPressure: { value: 0 },
    uPowerDraw: { value: 0 },
  }), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = smoothed.current;
    const mat = matRef.current;
    if (!mat) return;

    mat.uniforms.uTime.value += dt;

    if (available) {
      const stats = statsRef.current;
      s.gpuUtil = lerpTo(s.gpuUtil, stats.gpu_util / 100, 3.0, dt);
      s.memPressure = lerpTo(s.memPressure, stats.mem_percent / 100, 3.0, dt);
      s.temperature = lerpTo(s.temperature, stats.temperature, 3.0, dt);
      const powerLimit = stats.power_limit || 350;
      s.powerDraw = lerpTo(s.powerDraw, Math.min(stats.power_draw / powerLimit, 1.0), 3.0, dt);
    } else {
      // Fallback: sinusoidal time-based animation when no GPU data
      const t = mat.uniforms.uTime.value;
      const pulse = active ? 0.3 + 0.3 * Math.sin(t * 1.5) : 0.1;
      s.gpuUtil = lerpTo(s.gpuUtil, pulse, 2.0, dt);
      s.memPressure = lerpTo(s.memPressure, active ? 0.4 : 0.1, 2.0, dt);
      s.temperature = lerpTo(s.temperature, active ? 45 : 30, 2.0, dt);
      s.powerDraw = lerpTo(s.powerDraw, active ? 0.3 + 0.2 * Math.sin(t * 0.8) : 0.05, 2.0, dt);
    }

    mat.uniforms.uGpuUtil.value = s.gpuUtil;
    mat.uniforms.uMemPressure.value = s.memPressure;
    mat.uniforms.uTemperature.value = s.temperature;
    mat.uniforms.uPowerDraw.value = s.powerDraw;

    // Slow rotation
    if (meshRef.current) {
      meshRef.current.rotation.y += dt * 0.15;
      meshRef.current.rotation.x += dt * 0.05;
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 32]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

// ─── ParticleRing ───────────────────────────────────────────────
function ParticleRing({ statsRef, available, active }: {
  statsRef: React.MutableRefObject<GpuStats>;
  available: boolean;
  active: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const PARTICLE_COUNT = 60;

  const positions = useMemo(() => {
    const arr = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      arr[i * 3] = Math.cos(angle) * 1.6;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
      arr[i * 3 + 2] = Math.sin(angle) * 1.6;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const speed = available
      ? 0.5 + (statsRef.current.clock_mhz / 2000) * 2.0
      : active ? 0.8 : 0.2;
    groupRef.current.rotation.y += delta * speed;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={PARTICLE_COUNT}
            array={positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.04}
          color="#00ffaa"
          transparent
          opacity={0.8}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

// ─── OuterGlow ──────────────────────────────────────────────────
function OuterGlow({ statsRef, available, active }: {
  statsRef: React.MutableRefObject<GpuStats>;
  available: boolean;
  active: boolean;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const smoothedOpacity = useRef(0.05);

  useFrame((state, delta) => {
    if (!matRef.current) return;
    const powerLimit = statsRef.current.power_limit || 350;
    const target = available
      ? 0.03 + Math.min(statsRef.current.power_draw / powerLimit, 1.0) * 0.12
      : active ? 0.06 + 0.03 * Math.sin(state.clock.elapsedTime) : 0.02;
    smoothedOpacity.current = lerpTo(smoothedOpacity.current, target, 2.0, delta);
    matRef.current.opacity = smoothedOpacity.current;
  });

  return (
    <mesh>
      <sphereGeometry args={[1.8, 32, 32]} />
      <meshBasicMaterial
        ref={matRef}
        color="#0066ff"
        transparent
        opacity={0.05}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

// ─── Scene ──────────────────────────────────────────────────────
function OrbScene({ statsRef, available, active }: {
  statsRef: React.MutableRefObject<GpuStats>;
  available: boolean;
  active: boolean;
}) {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[3, 3, 3]} intensity={1.0} color="#0088ff" />
      <pointLight position={[-3, -2, 2]} intensity={0.8} color="#ff0066" />
      <pointLight position={[0, -3, 1]} intensity={0.4} color="#00ff99" />
      <OrbMesh statsRef={statsRef} available={available} active={active} />
      <ParticleRing statsRef={statsRef} available={available} active={active} />
      <OuterGlow statsRef={statsRef} available={available} active={active} />
    </>
  );
}

// ─── GpuOrb (public component) ──────────────────────────────────
interface GpuOrbProps {
  size?: number;
  active?: boolean;
}

export default function GpuOrb({ size = 140, active = false }: GpuOrbProps) {
  const { statsRef, available } = useGpuStats({ active });

  return (
    <div
      style={{
        width: size,
        height: size,
        maskImage: "radial-gradient(circle, black 40%, transparent 70%)",
        WebkitMaskImage: "radial-gradient(circle, black 40%, transparent 70%)",
      }}
      aria-busy={active ? "true" : "false"}
      role="img"
      aria-label={active ? "GPU activity visualization" : "GPU idle"}
    >
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 45 }}
        dpr={[1, 2]}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Suspense fallback={null}>
          <OrbScene statsRef={statsRef} available={available} active={active} />
        </Suspense>
      </Canvas>
    </div>
  );
}
