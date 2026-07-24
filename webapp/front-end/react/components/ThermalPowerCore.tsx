import React, { useEffect, useRef } from "react";
import useGpuStats from "../hooks/useGpuStats";

interface ThermalPowerCoreProps {
  active: boolean;
}

const HISTORY_SIZE = 60;

function energyColor(load: number, alpha = 1) {
  if (load < 0.55) return `rgba(0, 234, 255, ${alpha})`;
  if (load < 0.82) return `rgba(168, 85, 247, ${alpha})`;
  return `rgba(196, 92, 255, ${alpha})`;
}

export default function ThermalPowerCore({ active }: ThermalPowerCoreProps) {
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

    function roundedRect(x: number, y: number, w: number, h: number, radius: number) {
      context.beginPath();
      context.roundRect(x, y, w, h, radius);
    }

    function drawRail(
      x: number,
      top: number,
      railHeight: number,
      value: number,
      label: string,
      reading: string
    ) {
      context.strokeStyle = "rgba(100, 120, 180, 0.2)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, top + railHeight);
      context.stroke();

      const fillHeight = railHeight * Math.min(Math.max(value, 0), 1);
      const gradient = context.createLinearGradient(0, top + railHeight, 0, top);
      gradient.addColorStop(0, "rgba(0, 234, 255, 0.9)");
      gradient.addColorStop(0.7, "rgba(168, 85, 247, 0.9)");
      gradient.addColorStop(1, "rgba(196, 92, 255, 1)");
      context.fillStyle = gradient;
      context.shadowBlur = 7;
      context.shadowColor = energyColor(value);
      context.fillRect(x - 1, top + railHeight - fillHeight, 3, fillHeight);
      context.shadowBlur = 0;

      context.textAlign = "center";
      context.fillStyle = "rgba(90, 100, 134, 0.95)";
      context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
      context.fillText(label, x, top + railHeight + 12);
      context.fillStyle =
        active && available ? energyColor(value, 0.95) : "rgba(90, 100, 134, 0.8)";
      context.font = "600 9px JetBrains Mono, ui-monospace, monospace";
      context.fillText(active && available ? reading : "—", x, top + railHeight + 24);
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
      const time = timestamp / 1000;
      const chamberWidth = 66;
      const chamberHeight = 122;
      const chamberX = width / 2 - chamberWidth / 2;
      const chamberY = 37;
      const chamberBottom = chamberY + chamberHeight;
      const color = energyColor(displayedLoad);

      // Ghosted history bands sit behind the glass containment tube.
      history.forEach((sample, index) => {
        if (sample < 0.02) return;
        const age = 1 - index / (HISTORY_SIZE - 1);
        const y = chamberBottom - sample * chamberHeight;
        const bandWidth = chamberWidth + 20 + Math.sin(index * 1.7) * 8;
        const x = width / 2 - bandWidth / 2;
        const gradient = context.createLinearGradient(x, 0, x + bandWidth, 0);
        gradient.addColorStop(0, energyColor(sample, 0));
        gradient.addColorStop(0.5, energyColor(sample, age * 0.12));
        gradient.addColorStop(1, energyColor(sample, 0));
        context.fillStyle = gradient;
        context.fillRect(x, y - 1, bandWidth, 2);
      });

      // Outer clamps and glass body.
      context.strokeStyle = "rgba(0, 234, 255, 0.22)";
      context.lineWidth = 1.2;
      roundedRect(chamberX, chamberY, chamberWidth, chamberHeight, chamberWidth / 2);
      context.stroke();
      context.strokeStyle = "rgba(255, 255, 255, 0.08)";
      roundedRect(chamberX + 5, chamberY + 5, chamberWidth - 10, chamberHeight - 10, 24);
      context.stroke();
      for (const y of [chamberY + 12, chamberBottom - 12]) {
        context.fillStyle = "rgba(13, 19, 49, 0.95)";
        context.fillRect(chamberX - 9, y - 3, chamberWidth + 18, 6);
        context.fillStyle = "rgba(0, 234, 255, 0.28)";
        context.fillRect(chamberX - 7, y - 1, chamberWidth + 14, 1);
      }

      // Energy rises from the base according to current utilization.
      const innerX = chamberX + 8;
      const innerWidth = chamberWidth - 16;
      const innerBottom = chamberBottom - 8;
      const maxFillHeight = chamberHeight - 16;
      const fillHeight = Math.max(3, displayedLoad * maxFillHeight);
      const fillTop = innerBottom - fillHeight;
      const fillGradient = context.createLinearGradient(0, innerBottom, 0, fillTop);
      fillGradient.addColorStop(0, energyColor(displayedLoad, 0.88));
      fillGradient.addColorStop(0.55, energyColor(displayedLoad, 0.42));
      fillGradient.addColorStop(1, energyColor(displayedLoad, 0.08));
      roundedRect(innerX, fillTop, innerWidth, fillHeight, 20);
      context.fillStyle = fillGradient;
      context.shadowBlur = 18 + displayedLoad * 18;
      context.shadowColor = color;
      context.fill();
      context.shadowBlur = 0;

      // A bright energy surface ripples at the current load level.
      context.beginPath();
      for (let index = 0; index <= 24; index++) {
        const x = innerX + (index / 24) * innerWidth;
        const y = fillTop + Math.sin(time * 3 + index * 0.65) * (1 + displayedLoad * 2);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = energyColor(displayedLoad, 0.9);
      context.lineWidth = 1.4;
      context.shadowBlur = 9;
      context.shadowColor = color;
      context.stroke();
      context.shadowBlur = 0;

      // At low load, slow coolant particles drift through the chamber.
      if (displayedLoad < 0.55) {
        for (let index = 0; index < 11; index++) {
          const phase = (time * (5 + (index % 3)) + index * 17) % maxFillHeight;
          const x = innerX + 5 + ((index * 19) % Math.max(1, innerWidth - 10));
          const y = innerBottom - phase;
          context.fillStyle = `rgba(0, 234, 255, ${0.08 + (index % 3) * 0.035})`;
          context.fillRect(x, y, 1, 5);
        }
      }

      // High-load arcs jump between alternating points on the containment wall.
      if (displayedLoad > 0.8) {
        const arcCount = displayedLoad > 0.93 ? 3 : 2;
        for (let arc = 0; arc < arcCount; arc++) {
          const startY = chamberY + 25 + ((time * 31 + arc * 37) % (chamberHeight - 50));
          context.beginPath();
          context.moveTo(chamberX + 3, startY);
          for (let step = 1; step <= 5; step++) {
            const progress = step / 5;
            const x = chamberX + 3 + progress * (chamberWidth - 6);
            const jitter = Math.sin(time * 18 + arc * 4 + step * 2.3) * 7;
            context.lineTo(x, startY + jitter);
          }
          context.strokeStyle = energyColor(1, 0.45 + displayedLoad * 0.4);
          context.lineWidth = 1;
          context.shadowBlur = 10;
          context.shadowColor = energyColor(1);
          context.stroke();
        }
        context.shadowBlur = 0;
      }

      context.textAlign = "center";
      context.fillStyle = active && available ? color : "rgba(90, 100, 134, 0.8)";
      context.font = "700 20px JetBrains Mono, ui-monospace, monospace";
      context.fillText(
        active && available ? `${Math.round(displayedLoad * 100)}%` : "—",
        width / 2,
        20
      );
      context.fillStyle = "rgba(90, 100, 134, 0.9)";
      context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
      context.fillText("CORE OUTPUT", width / 2, 29);

      const stats = statsRef.current;
      const gib = 1024 ** 3;
      const memoryRatio = stats.mem_total ? stats.mem_used / stats.mem_total : 0;
      drawRail(
        chamberX - 27,
        chamberY + 14,
        chamberHeight - 30,
        memoryRatio,
        "VRAM",
        `${(stats.mem_used / gib).toFixed(1)}G`
      );
      drawRail(
        chamberX + chamberWidth + 27,
        chamberY + 14,
        chamberHeight - 30,
        Math.max(0, (stats.temperature - 30) / 60),
        "TEMP",
        `${Math.round(stats.temperature)}°C`
      );

      context.textAlign = "center";
      context.fillStyle = "rgba(90, 100, 134, 0.95)";
      context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
      context.fillText("POWER DRAW", width / 2, height - 19);
      context.fillStyle =
        active && available ? energyColor(displayedLoad, 0.95) : "rgba(90, 100, 134, 0.8)";
      context.font = "600 10px JetBrains Mono, ui-monospace, monospace";
      context.fillText(
        active && available ? `${Math.round(stats.power_draw)}W` : "—",
        width / 2,
        height - 7
      );

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
    <div className="thermal-power-core" aria-label="Live GPU thermal power core">
      <div className="thermal-power-core__header">
        <span>Thermal Core</span>
        <span
          className={active && available ? "thermal-power-core__live" : "thermal-power-core__idle"}
        >
          {active && available ? "● Contained" : "○ Cold"}
        </span>
      </div>
      <canvas ref={canvasRef} className="thermal-power-core__canvas" />
    </div>
  );
}
