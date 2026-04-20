import { useEffect, useRef } from "react";

type Segment = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
};

const LIFE_DECAY = 0.012;
const INERTIA = 0.96;
const CURL_SCALE = 0.003;

interface CursorLinesProps {
  density?: number;
  speed?: number;
}

export default function CursorLines({ density = 3, speed = 0.3 }: CursorLinesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const densityRef = useRef(density);
  const speedRef = useRef(speed);

  useEffect(() => {
    densityRef.current = density;
  }, [density]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;

    const segments: Segment[] = [];
    let lastX = 0;
    let lastY = 0;
    let hasMoved = false;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMove(e: MouseEvent) {
      if (!hasMoved) {
        lastX = e.clientX;
        lastY = e.clientY;
        hasMoved = true;
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const moveDist = Math.hypot(dx, dy);
      const d = densityRef.current;
      const s = speedRef.current;
      const spawnPerPixel = d / 180;
      const velocityMul = 0.05 + s * 0.45;
      const jitter = 0.2 + s * 1.5;
      const count = Math.max(1, Math.ceil(moveDist * spawnPerPixel));
      for (let i = 0; i < count; i++) {
        if (segments.length >= d) segments.shift();
        const t = count > 1 ? i / (count - 1) : 0;
        segments.push({
          x: lastX + dx * t + (Math.random() - 0.5) * 8,
          y: lastY + dy * t + (Math.random() - 0.5) * 8,
          vx: dx * velocityMul + (Math.random() - 0.5) * jitter,
          vy: dy * velocityMul + (Math.random() - 0.5) * jitter,
          life: 1,
          hue: Math.random() < 0.15 ? 280 : 185,
        });
      }
      lastX = e.clientX;
      lastY = e.clientY;
    }

    // Cheap pseudo-curl field — no noise dep, good enough to drift segments
    function curl(x: number, y: number, t: number): [number, number] {
      return [
        Math.sin(y * CURL_SCALE + t) - Math.cos(x * CURL_SCALE * 1.3 + t * 0.6),
        Math.cos(x * CURL_SCALE + t) + Math.sin(y * CURL_SCALE * 1.3 + t * 0.6),
      ];
    }

    let raf = 0;
    const start = performance.now();

    function frame(now: number) {
      const t = (now - start) / 1000;
      const curlStrength = 0.03 + speedRef.current * 0.6;

      // Fade existing trails by eroding their alpha
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, w, h);

      // Additive blending for glowy overlap
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1;

      // Trim oldest if density was reduced at runtime
      while (segments.length > densityRef.current) segments.shift();

      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        const [fx, fy] = curl(s.x, s.y, t);
        s.vx = s.vx * INERTIA + fx * curlStrength;
        s.vy = s.vy * INERTIA + fy * curlStrength;
        s.x += s.vx;
        s.y += s.vy;
        s.life -= LIFE_DECAY;
        if (s.life <= 0 || s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) {
          segments.splice(i, 1);
          continue;
        }
        const mag = Math.hypot(s.vx, s.vy) || 1;
        const len = Math.max(3, mag * 3);
        const nx = s.vx / mag;
        const ny = s.vy / mag;
        ctx.strokeStyle = `hsla(${s.hue}, 100%, 65%, ${s.life * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(s.x - nx * len, s.y - ny * len);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }

      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-lines-canvas" aria-hidden="true" />;
}
