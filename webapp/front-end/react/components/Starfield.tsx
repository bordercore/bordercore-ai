import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
};

const STAR_COUNT = 40;

function makeStars(w: number, h: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 7; // px/sec — very slow drift
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 0.4 + Math.random() * 1.4,
      hue: Math.random() < 0.2 ? 280 : 185,
      baseAlpha: 0.15 + Math.random() * 0.55,
      twinkleSpeed: 0.3 + Math.random() * 0.8,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];

    function resize() {
      dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h);
    }

    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let lastNow = performance.now();
    const start = lastNow;
    let paused = false;

    function frame(now: number) {
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      if (!paused) {
        const t = (now - start) / 1000;
        ctx.clearRect(0, 0, w, h);
        for (const s of stars) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.x < -10) s.x = w + 10;
          else if (s.x > w + 10) s.x = -10;
          if (s.y < -10) s.y = h + 10;
          else if (s.y > h + 10) s.y = -10;
          const twinkle = 0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);
          const alpha = s.baseAlpha * (0.5 + 0.5 * twinkle);
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
          grad.addColorStop(0, `hsla(${s.hue}, 100%, 75%, ${alpha})`);
          grad.addColorStop(1, `hsla(${s.hue}, 100%, 75%, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsla(${s.hue}, 100%, 90%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
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
    };
  }, []);

  return <canvas ref={canvasRef} className="starfield-canvas" aria-hidden="true" />;
}
