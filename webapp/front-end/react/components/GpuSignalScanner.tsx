import React, { useEffect, useRef } from "react";
import useGpuStats from "../hooks/useGpuStats";

interface GpuSignalScannerProps {
  active: boolean;
}

const HISTORY_SIZE = 120;

function signalColor(load: number, alpha = 1) {
  if (load < 0.55) return `rgba(0, 234, 255, ${alpha})`;
  if (load < 0.82) return `rgba(168, 85, 247, ${alpha})`;
  return `rgba(196, 92, 255, ${alpha})`;
}

export default function GpuSignalScanner({ active }: GpuSignalScannerProps) {
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
    const sparks: Array<{ x: number; y: number; life: number; drift: number }> = [];
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

    function signalPoint(index: number, plotTop: number, plotHeight: number) {
      const x = 10 + (index / (HISTORY_SIZE - 1)) * (width - 20);
      const y = plotTop + plotHeight - history[index] * plotHeight;
      return { x, y };
    }

    function drawCircuitTrace(y: number, phase: number) {
      context.beginPath();
      context.moveTo(8, y);
      const stride = 24;
      for (let x = 8; x < width - 8; x += stride) {
        const notch = (x / stride + phase) % 3 === 0 ? 3 : 0;
        context.lineTo(Math.min(x + 14, width - 8), y);
        context.lineTo(Math.min(x + 14, width - 8), y - notch);
        context.lineTo(Math.min(x + stride, width - 8), y - notch);
      }
      context.stroke();
    }

    function draw(timestamp: number) {
      const targetLoad = active && available ? statsRef.current.gpu_util / 100 : 0;
      displayedLoad += (targetLoad - displayedLoad) * 0.1;

      if (timestamp - lastSample >= 500) {
        history.shift();
        history.push(targetLoad);
        if (targetLoad > 0.8) {
          const latest = signalPoint(HISTORY_SIZE - 1, 43, 100);
          for (let i = 0; i < 3; i++) {
            sparks.push({
              x: latest.x - Math.random() * 5,
              y: latest.y + (Math.random() - 0.5) * 8,
              life: 1,
              drift: 10 + Math.random() * 16,
            });
          }
        }
        lastSample = timestamp;
      }

      context.clearRect(0, 0, width, height);
      const plotTop = 43;
      const plotHeight = 100;
      const plotBottom = plotTop + plotHeight;
      const time = timestamp / 1000;

      // Dim circuit-board thresholds instead of a conventional chart grid.
      context.strokeStyle = "rgba(0, 234, 255, 0.09)";
      context.lineWidth = 1;
      drawCircuitTrace(plotTop + plotHeight * 0.2, 0);
      drawCircuitTrace(plotTop + plotHeight * 0.5, 1);
      drawCircuitTrace(plotTop + plotHeight * 0.8, 2);

      // A translucent phosphor field beneath the utilization signal.
      const fillGradient = context.createLinearGradient(0, plotTop, 0, plotBottom);
      fillGradient.addColorStop(0, signalColor(displayedLoad, 0.3));
      fillGradient.addColorStop(0.65, "rgba(0, 234, 255, 0.06)");
      fillGradient.addColorStop(1, "rgba(0, 234, 255, 0)");
      context.beginPath();
      history.forEach((_, index) => {
        const point = signalPoint(index, plotTop, plotHeight);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.lineTo(width - 10, plotBottom);
      context.lineTo(10, plotBottom);
      context.closePath();
      context.fillStyle = fillGradient;
      context.fill();

      // Multiple strokes create a bright center with a fading phosphor halo.
      for (const [lineWidth, alpha, blur] of [
        [7, 0.08, 15],
        [3, 0.28, 10],
        [1.25, 0.95, 5],
      ] as const) {
        context.beginPath();
        history.forEach((sample, index) => {
          const point = signalPoint(index, plotTop, plotHeight);
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
          if (sample > 0.82 && index % 5 === 0) {
            context.lineTo(point.x + 1.5, point.y - 2);
          }
        });
        context.lineWidth = lineWidth;
        context.lineJoin = "round";
        context.strokeStyle = signalColor(displayedLoad, alpha);
        context.shadowBlur = blur;
        context.shadowColor = signalColor(displayedLoad);
        context.stroke();
      }
      context.shadowBlur = 0;

      // Slow glass scanner beam.
      const beamX = 10 + ((time * 22) % Math.max(1, width - 20));
      const beamGradient = context.createLinearGradient(beamX - 72, 0, beamX + 5, 0);
      beamGradient.addColorStop(0, "rgba(0, 234, 255, 0)");
      beamGradient.addColorStop(0.38, signalColor(displayedLoad, 0.025));
      beamGradient.addColorStop(0.7, signalColor(displayedLoad, 0.08));
      beamGradient.addColorStop(0.9, signalColor(displayedLoad, 0.18));
      beamGradient.addColorStop(1, signalColor(displayedLoad, 0.7));
      context.fillStyle = beamGradient;
      context.fillRect(beamX - 72, plotTop - 6, 77, plotHeight + 12);

      // Thin phosphor echoes linger behind the leading edge.
      for (const [offset, alpha] of [
        [12, 0.16],
        [28, 0.09],
        [48, 0.04],
      ] as const) {
        context.fillStyle = signalColor(displayedLoad, alpha);
        context.fillRect(beamX - offset, plotTop - 4, 1, plotHeight + 8);
      }

      context.fillStyle = signalColor(displayedLoad, 0.7);
      context.shadowBlur = 8;
      context.shadowColor = signalColor(displayedLoad);
      context.fillRect(beamX + 4, plotTop - 6, 1, plotHeight + 12);
      context.shadowBlur = 0;

      // Short-lived digital fragments break off only from genuine high peaks.
      for (let index = sparks.length - 1; index >= 0; index--) {
        const spark = sparks[index];
        spark.life -= 0.025;
        spark.x -= spark.drift * 0.016;
        spark.y += Math.sin(time * 8 + index) * 0.2;
        if (spark.life <= 0) {
          sparks.splice(index, 1);
          continue;
        }
        context.fillStyle = signalColor(1, spark.life * 0.8);
        context.shadowBlur = 6;
        context.shadowColor = signalColor(1);
        context.fillRect(spark.x, spark.y, 1 + spark.life * 3, 1);
      }
      context.shadowBlur = 0;

      // Terminal-style current value and compact telemetry rail.
      context.textAlign = "right";
      context.fillStyle =
        active && available ? signalColor(displayedLoad) : "rgba(90, 100, 134, 0.8)";
      context.font = "700 24px JetBrains Mono, ui-monospace, monospace";
      context.fillText(
        active && available ? `${Math.round(displayedLoad * 100)}%` : "—",
        width - 10,
        27
      );
      context.fillStyle = "rgba(90, 100, 134, 0.9)";
      context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
      context.fillText("CURRENT LOAD", width - 10, 36);

      const stats = statsRef.current;
      const gib = 1024 ** 3;
      const metrics = [
        ["VRAM", `${(stats.mem_used / gib).toFixed(1)}/${(stats.mem_total / gib).toFixed(0)}G`],
        ["TEMP", `${Math.round(stats.temperature)}°C`],
        ["POWER", `${Math.round(stats.power_draw)}W`],
      ];
      const railY = height - 15;
      const columnWidth = width / metrics.length;
      metrics.forEach(([label, value], index) => {
        const x = columnWidth * index + columnWidth / 2;
        context.textAlign = "center";
        context.fillStyle = "rgba(90, 100, 134, 0.95)";
        context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
        context.fillText(label, x, railY - 9);
        context.fillStyle =
          active && available ? signalColor(displayedLoad, 0.95) : "rgba(90, 100, 134, 0.8)";
        context.font = "600 10px JetBrains Mono, ui-monospace, monospace";
        context.fillText(active && available ? value : "—", x, railY + 4);
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
    <div className="gpu-signal-scanner" aria-label="Live GPU utilization signal">
      <div className="gpu-signal-scanner__header">
        <span>GPU Signal</span>
        <span
          className={active && available ? "gpu-signal-scanner__live" : "gpu-signal-scanner__idle"}
        >
          {active && available ? "● Tracking" : "○ Standby"}
        </span>
      </div>
      <canvas ref={canvasRef} className="gpu-signal-scanner__canvas" />
    </div>
  );
}
