import React, { useEffect, useRef } from "react";

interface TokenStreamProps {
  width?: number;
  height?: number;
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  radius: number;
  color: [number, number, number];
  intensity: number;
  streak: boolean;
};

const COLORS: [number, number, number][] = [
  [0, 234, 255], // cyan
  [168, 85, 247], // purple
  [236, 72, 153], // pink
  [103, 232, 249], // light cyan
];

export default function TokenStream({ width = 180, height = 26 }: TokenStreamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const particles: Particle[] = [];
    const SPAWN_HZ = 55;
    const spawnInterval = 1000 / SPAWN_HZ;
    let lastSpawn = performance.now();
    let lastTime = performance.now();
    let rafId: number;

    function spawn() {
      const streak = Math.random() < 0.12;
      particles.push({
        x: -4,
        y: height / 2 + (Math.random() - 0.5) * (height - 6),
        vx: streak ? 220 + Math.random() * 120 : 70 + Math.random() * 130,
        radius: streak ? 1.8 + Math.random() * 0.8 : 0.9 + Math.random() * 1.0,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        intensity: 0.7 + Math.random() * 0.3,
        streak,
      });
    }

    function tick(now: number) {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      while (now - lastSpawn > spawnInterval) {
        spawn();
        lastSpawn += spawnInterval;
      }

      // Trail fade
      ctx!.globalCompositeOperation = "destination-out";
      ctx!.fillStyle = "rgba(0, 0, 0, 0.22)";
      ctx!.fillRect(0, 0, width, height);

      // Channel line (subtle horizontal guide)
      ctx!.globalCompositeOperation = "source-over";
      const gradient = ctx!.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(0, 234, 255, 0)");
      gradient.addColorStop(0.5, "rgba(0, 234, 255, 0.10)");
      gradient.addColorStop(1, "rgba(168, 85, 247, 0)");
      ctx!.fillStyle = gradient;
      ctx!.fillRect(0, height / 2 - 0.5, width, 1);

      // Particles
      ctx!.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        if (p.x > width + 6) {
          particles.splice(i, 1);
          continue;
        }

        const edgeFadeIn = Math.min(1, (p.x + 4) / 14);
        const edgeFadeOut = Math.min(1, (width - p.x) / 24);
        const alpha = p.intensity * edgeFadeIn * edgeFadeOut;
        const [r, g, b] = p.color;

        // Outer glow
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.28})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius * 3.2, 0, Math.PI * 2);
        ctx!.fill();

        // Core
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fill();

        // Streak tail
        if (p.streak) {
          ctx!.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`;
          ctx!.lineWidth = p.radius * 0.8;
          ctx!.lineCap = "round";
          ctx!.beginPath();
          ctx!.moveTo(p.x - p.vx * 0.04, p.y);
          ctx!.lineTo(p.x, p.y);
          ctx!.stroke();
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="token-stream"
      style={{ width, height }}
      role="status"
      aria-label="AI responding"
    />
  );
}
