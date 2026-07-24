import React, { useEffect, useRef } from "react";
import useGpuStats from "../hooks/useGpuStats";

interface NeonPulseReactorProps {
  active: boolean;
}

const HISTORY_SIZE = 60;

function loadColor(load: number, alpha = 1) {
  if (load < 0.55) return `rgba(0, 234, 255, ${alpha})`;
  if (load < 0.82) return `rgba(168, 85, 247, ${alpha})`;
  return `rgba(196, 92, 255, ${alpha})`;
}

export default function NeonPulseReactor({ active }: NeonPulseReactorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { statsRef, available } = useGpuStats({ active });

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const drawingContext = canvasElement.getContext("2d");
    if (!drawingContext) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const context: CanvasRenderingContext2D = drawingContext;

    const history = new Array<number>(HISTORY_SIZE).fill(0);
    let displayedLoad = 0;
    let lastSample = 0;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(timestamp: number) {
      const targetLoad = active && available ? statsRef.current.gpu_util / 100 : 0;
      displayedLoad += (targetLoad - displayedLoad) * 0.08;

      if (timestamp - lastSample >= 1000) {
        history.shift();
        history.push(targetLoad);
        lastSample = timestamp;
      }

      context.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = Math.min(height * 0.48, 96);
      const radius = Math.min(width * 0.28, 72);
      const time = timestamp / 1000;
      const pulse =
        1 + Math.sin(time * (1.6 + displayedLoad * 5)) * (0.025 + displayedLoad * 0.035);
      const color = loadColor(displayedLoad);

      // Faint technical reticle and containment rings.
      context.save();
      context.translate(cx, cy);
      context.strokeStyle = "rgba(100, 120, 180, 0.16)";
      context.lineWidth = 1;
      for (const scale of [0.68, 0.84, 1.2]) {
        context.beginPath();
        context.arc(0, 0, radius * scale, 0, Math.PI * 2);
        context.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const angle = i * (Math.PI / 2) + Math.PI / 4;
        context.beginPath();
        context.moveTo(Math.cos(angle) * radius * 1.25, Math.sin(angle) * radius * 1.25);
        context.lineTo(Math.cos(angle) * radius * 1.42, Math.sin(angle) * radius * 1.42);
        context.stroke();
      }
      context.restore();

      // One minute of utilization, wrapped around the reactor as energy cells.
      const segmentGap = 0.035;
      history.forEach((sample, index) => {
        const start = -Math.PI / 2 + (index / HISTORY_SIZE) * Math.PI * 2;
        const end = start + (Math.PI * 2) / HISTORY_SIZE - segmentGap;
        const age = (index + 1) / HISTORY_SIZE;
        context.beginPath();
        context.arc(cx, cy, radius * 1.08, start, end);
        context.lineWidth = 4 + sample * 5;
        context.lineCap = "round";
        context.strokeStyle = loadColor(sample, 0.12 + age * (0.25 + sample * 0.65));
        context.shadowBlur = sample > 0.05 ? 8 + sample * 10 : 0;
        context.shadowColor = loadColor(sample);
        context.stroke();
      });
      context.shadowBlur = 0;

      // Rotating scanner arc.
      // Keep the decorative telemetry sweep deliberately slow. It should
      // communicate that the display is live without competing with the data.
      const sweep = time * (0.12 + displayedLoad * 0.28);
      context.beginPath();
      context.arc(cx, cy, radius * 1.2, sweep, sweep + 0.62);
      context.lineWidth = 1.5;
      context.strokeStyle = loadColor(displayedLoad, 0.7);
      context.shadowBlur = 10;
      context.shadowColor = color;
      context.stroke();
      context.shadowBlur = 0;

      // Layered plasma core.
      const gradient = context.createRadialGradient(cx, cy, 2, cx, cy, radius * 0.68 * pulse);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      gradient.addColorStop(0.12, loadColor(displayedLoad, 0.9));
      gradient.addColorStop(0.45, loadColor(displayedLoad, 0.28 + displayedLoad * 0.35));
      gradient.addColorStop(1, loadColor(displayedLoad, 0));
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(cx, cy, radius * 0.68 * pulse, 0, Math.PI * 2);
      context.fill();

      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#e2e8f0";
      context.font = "700 22px JetBrains Mono, ui-monospace, monospace";
      context.shadowBlur = 10;
      context.shadowColor = color;
      context.fillText(`${Math.round(displayedLoad * 100)}%`, cx, cy - 2);
      context.shadowBlur = 0;
      context.fillStyle = "rgba(136, 146, 176, 0.9)";
      context.font = "600 8px JetBrains Mono, ui-monospace, monospace";
      context.fillText(active ? (available ? "GPU LOAD" : "LINKING") : "STANDBY", cx, cy + 17);

      // Telemetry rail.
      const stats = statsRef.current;
      const gib = 1024 ** 3;
      const railY = height - 14;
      const metrics = [
        ["VRAM", `${(stats.mem_used / gib).toFixed(1)} / ${(stats.mem_total / gib).toFixed(0)}G`],
        ["TEMP", `${Math.round(stats.temperature)}°C`],
        ["POWER", `${Math.round(stats.power_draw)}W`],
      ];
      const columnWidth = width / metrics.length;
      metrics.forEach(([label, value], index) => {
        const x = columnWidth * index + columnWidth / 2;
        context.textAlign = "center";
        context.fillStyle = "rgba(90, 100, 134, 0.95)";
        context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
        context.fillText(label, x, railY - 8);
        context.fillStyle =
          active && available ? loadColor(displayedLoad, 0.95) : "rgba(90, 100, 134, 0.8)";
        context.font = "600 10px JetBrains Mono, ui-monospace, monospace";
        context.fillText(active && available ? value : "—", x, railY + 5);
      });

      animationFrame = requestAnimationFrame(draw);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [active, available, statsRef]);

  return (
    <div className="neon-reactor" aria-label="Live GPU utilization">
      <div className="neon-reactor__header">
        <span>GPU Telemetry</span>
        <span className={active && available ? "neon-reactor__live" : "neon-reactor__idle"}>
          {active && available ? "● Live" : "○ Standby"}
        </span>
      </div>
      <canvas ref={canvasRef} className="neon-reactor__canvas" />
    </div>
  );
}
