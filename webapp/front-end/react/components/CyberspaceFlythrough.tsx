import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const ROWS = 28;
const ROW_DEPTH = 10;
const LOOP_DEPTH = ROWS * ROW_DEPTH;

type Vault = {
  position: [number, number, number];
  scale: [number, number, number];
};

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.731 + salt * 47.117) * 43758.5453;
  return value - Math.floor(value);
}

function makeVaults(): Vault[] {
  const vaults: Vault[] = [];

  for (let copy = 0; copy < 2; copy++) {
    for (let row = 0; row < ROWS; row++) {
      const z = -row * ROW_DEPTH - copy * LOOP_DEPTH;

      for (const side of [-1, 1]) {
        for (let layer = 0; layer < 3; layer++) {
          const key = row * 11 + layer * 3 + (side + 1);
          const width = 5.5 + seeded(key, 1) * 4;
          const height = 82 + seeded(key, 2) * 42;
          const depth = 7 + seeded(key, 3) * 5;
          const corridorEdge = 6.2 + layer * 4.8;
          const x = side * (corridorEdge + width / 2);
          const y = (seeded(key, 4) - 0.5) * 10;

          vaults.push({
            position: [x, y, z - seeded(key, 5) * 3],
            scale: [width, height, depth],
          });
        }
      }
    }
  }

  return vaults;
}

function makeDataLights() {
  const points: number[] = [];

  for (let copy = 0; copy < 2; copy++) {
    for (let row = 0; row < ROWS; row++) {
      for (const side of [-1, 1]) {
        const amount = 3 + Math.floor(seeded(row + copy * ROWS, side + 9) * 5);
        for (let light = 0; light < amount; light++) {
          const key = row * 23 + light * 7 + (side + 1);
          points.push(
            side * (6.15 + seeded(key, 7) * 7),
            -48 + seeded(key, 8) * 96,
            -row * ROW_DEPTH - copy * LOOP_DEPTH + (seeded(key, 9) - 0.5) * 8
          );
        }
      }
    }
  }

  return new Float32Array(points);
}

function VaultCity() {
  const cityRef = useRef<THREE.Group>(null);
  const solidRef = useRef<THREE.InstancedMesh>(null);
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  const vaults = useMemo(makeVaults, []);
  const lights = useMemo(makeDataLights, []);
  const { camera } = useThree();

  useEffect(() => {
    const helper = new THREE.Object3D();
    vaults.forEach((vault, index) => {
      helper.position.set(...vault.position);
      helper.scale.set(...vault.scale);
      helper.updateMatrix();
      solidRef.current?.setMatrixAt(index, helper.matrix);
      edgeRef.current?.setMatrixAt(index, helper.matrix);
    });
    if (solidRef.current) solidRef.current.instanceMatrix.needsUpdate = true;
    if (edgeRef.current) edgeRef.current.instanceMatrix.needsUpdate = true;
  }, [vaults]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();
    if (cityRef.current) {
      cityRef.current.position.z = (cityRef.current.position.z + delta * 2.15) % LOOP_DEPTH;
    }
    camera.position.x = Math.sin(elapsed * 0.09) * 0.65;
    camera.position.y = 1.2 + Math.sin(elapsed * 0.13) * 0.35;
    camera.lookAt(Math.sin(elapsed * 0.07) * 0.25, 1, -42);
  });

  return (
    <group ref={cityRef}>
      <instancedMesh ref={solidRef} args={[undefined, undefined, vaults.length]}>
        <boxGeometry />
        <meshStandardMaterial
          color="#082f52"
          emissive="#02182d"
          emissiveIntensity={0.65}
          roughness={0.7}
          metalness={0.58}
        />
      </instancedMesh>
      <instancedMesh ref={edgeRef} args={[undefined, undefined, vaults.length]}>
        <boxGeometry />
        <meshBasicMaterial
          color="#008bd1"
          wireframe
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </instancedMesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lights, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#19c8ff"
          size={0.22}
          sizeAttenuation
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#010712"]} />
      <fog attach="fog" args={["#04172a", 36, 155]} />
      <ambientLight color="#168ed1" intensity={1.1} />
      <directionalLight color="#77d7ff" intensity={2.2} position={[0, 18, -38]} />
      <pointLight color="#27bfff" intensity={48} distance={110} position={[0, 4, -48]} />
      <VaultCity />
    </>
  );
}

export default function CyberspaceFlythrough() {
  return (
    <div className="cyberspace-flythrough" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 72, near: 0.1, far: 600, position: [0, 1.2, 16] }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <Scene />
      </Canvas>
      <div className="cyberspace-horizon" />
      <div className="cyberspace-vignette" />
    </div>
  );
}
