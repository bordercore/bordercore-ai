import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle, Vec2 } from "ogl";

const vertex = /* glsl */ `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision mediump float;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float blob(vec2 p, vec2 c, float r) {
    float d = distance(p, c);
    return exp(-(d * d) / (r * r));
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vUv;
    uv.x *= aspect;

    float tSlow = uTime * 0.05;
    float tMed  = uTime * 0.08;

    vec2 c1 = vec2(
      aspect * (0.78 + sin(tMed) * 0.12),
      0.55 + cos(tMed * 0.7) * 0.18
    );
    float b1 = blob(uv, c1, 0.55);

    vec2 c2 = vec2(
      aspect * (0.42 + cos(tSlow * 1.3) * 0.22),
      0.28 + sin(tSlow) * 0.14
    );
    float b2 = blob(uv, c2, 0.38) * 0.55;

    float intensity = b1 + b2;
    intensity = pow(clamp(intensity, 0.0, 1.5), 1.3);

    vec3 deep = vec3(0.05, 0.25, 0.55);
    vec3 bright = vec3(0.25, 0.75, 1.0);
    vec3 color = mix(deep, bright, clamp(intensity * 0.6, 0.0, 1.0));

    float alpha = clamp(intensity * 0.55, 0.0, 0.7);
    gl_FragColor = vec4(color, alpha);
  }
`;

export default function AuroraBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new Renderer({
      canvas,
      alpha: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(window.innerWidth, window.innerHeight) },
      },
      transparent: true,
    });
    const mesh = new Mesh(gl, { geometry, program });

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value.set(w, h);
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const start = performance.now();
    let paused = false;

    function frame(now: number) {
      if (!paused) {
        program.uniforms.uTime.value = (now - start) / 1000;
        renderer.render({ scene: mesh });
      }
      raf = requestAnimationFrame(frame);
    }

    function onVisibility() {
      paused = document.hidden;
    }
    document.addEventListener("visibilitychange", onVisibility);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className="aurora-canvas" aria-hidden="true" />;
}
