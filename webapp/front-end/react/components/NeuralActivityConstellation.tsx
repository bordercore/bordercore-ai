import React, { useEffect, useRef } from "react";
import useGpuStats from "../hooks/useGpuStats";

interface NeuralActivityConstellationProps {
  active: boolean;
}

interface NodeSeed {
  angle: number;
  radius: number;
  depth: number;
  drift: number;
  phase: number;
}

const HISTORY_SIZE = 60;
const NODE_COUNT = 54;

function activityColor(load: number, alpha = 1) {
  if (load < 0.55) return `rgba(0, 234, 255, ${alpha})`;
  if (load < 0.82) return `rgba(168, 85, 247, ${alpha})`;
  return `rgba(196, 92, 255, ${alpha})`;
}

function seededRandom(seed: number) {
  const value = Math.sin(seed * 999.91) * 43758.5453;
  return value - Math.floor(value);
}

const NODES: NodeSeed[] = Array.from({ length: NODE_COUNT }, (_, index) => ({
  angle: seededRandom(index + 1) * Math.PI * 2,
  radius: 0.18 + Math.sqrt(seededRandom(index + 71)) * 0.82,
  depth: seededRandom(index + 151) * 2 - 1,
  drift: 0.55 + seededRandom(index + 231) * 0.9,
  phase: seededRandom(index + 311) * Math.PI * 2,
}));

export default function NeuralActivityConstellation({ active }: NeuralActivityConstellationProps) {
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
      displayedLoad += (targetLoad - displayedLoad) * 0.075;
      if (timestamp - lastSample >= 1000) {
        history.shift();
        history.push(targetLoad);
        lastSample = timestamp;
      }

      context.clearRect(0, 0, width, height);
      const time = timestamp / 1000;
      const centerX = width / 2;
      const centerY = 102;
      const fieldRadius = Math.min(width * 0.34, 88);
      const expansion = 0.58 + displayedLoad * 0.42;
      const rotation = time * (0.055 + displayedLoad * 0.16);
      const visibleNodes = Math.round(20 + displayedLoad * (NODE_COUNT - 20));
      const wave = (time * (0.18 + displayedLoad * 0.65)) % 1.35;
      const color = activityColor(displayedLoad);

      // A dim, blurred ribbon stores the last minute behind the network.
      for (const [lineWidth, alpha, blur] of [
        [10, 0.025, 16],
        [4, 0.06, 10],
        [1, 0.14, 4],
      ] as const) {
        context.beginPath();
        history.forEach((sample, index) => {
          const x = 10 + (index / (HISTORY_SIZE - 1)) * (width - 20);
          const y = centerY + Math.sin(index * 0.31 + time * 0.18) * 13 + (0.5 - sample) * 24;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.lineWidth = lineWidth;
        context.lineJoin = "round";
        context.strokeStyle = activityColor(displayedLoad, alpha);
        context.shadowBlur = blur;
        context.shadowColor = color;
        context.stroke();
      }
      context.shadowBlur = 0;

      const points = NODES.slice(0, visibleNodes).map((node, index) => {
        const orbit = node.angle + rotation * node.drift;
        const depthPulse = 0.82 + (node.depth + 1) * 0.09;
        const activityJitter =
          displayedLoad > 0.55
            ? Math.sin(time * (0.9 + displayedLoad * 1.2) + node.phase) * displayedLoad * 0.9
            : 0;
        const radial = node.radius * fieldRadius * expansion * depthPulse;
        return {
          index,
          x: centerX + Math.cos(orbit) * radial + activityJitter,
          y: centerY + Math.sin(orbit) * radial * 0.76 + Math.sin(time * 0.35 + node.phase) * 2,
          radius: node.radius,
          depth: node.depth,
          phase: node.phase,
        };
      });

      // Connections become denser and brighter as load rises.
      const connectionDistance = 27 + displayedLoad * 18;
      for (let first = 0; first < points.length; first++) {
        for (let second = first + 1; second < points.length; second++) {
          const a = points[first];
          const b = points[second];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > connectionDistance) continue;
          const midpointRadius = (a.radius + b.radius) / 2;
          const waveEnergy = Math.max(0, 1 - Math.abs(midpointRadius - wave) * 8);
          const alpha =
            (1 - distance / connectionDistance) * (0.07 + displayedLoad * 0.24 + waveEnergy * 0.42);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.strokeStyle = activityColor(Math.max(displayedLoad, waveEnergy * 0.9), alpha);
          context.lineWidth = 0.5 + waveEnergy * 0.9;
          context.shadowBlur = waveEnergy * 8;
          context.shadowColor = color;
          context.stroke();
        }
      }
      context.shadowBlur = 0;

      // Nodes fire in expanding waves during inference.
      points.forEach(point => {
        const waveEnergy = Math.max(0, 1 - Math.abs(point.radius - wave) * 9);
        const twinkle = 0.65 + Math.sin(time * 2 + point.phase) * 0.18;
        const nodeRadius = 1 + (point.depth + 1) * 0.55 + displayedLoad * 0.7 + waveEnergy * 1.6;
        context.beginPath();
        context.arc(point.x, point.y, nodeRadius, 0, Math.PI * 2);
        context.fillStyle = activityColor(
          Math.max(displayedLoad, waveEnergy),
          twinkle + waveEnergy * 0.2
        );
        context.shadowBlur = 6 + displayedLoad * 7 + waveEnergy * 12;
        context.shadowColor = activityColor(Math.max(displayedLoad, waveEnergy));
        context.fill();
      });
      context.shadowBlur = 0;

      // Calm central intelligence remains visible even at idle.
      const corePulse = 1 + Math.sin(time * 1.4) * (0.06 + displayedLoad * 0.08);
      const coreGradient = context.createRadialGradient(
        centerX,
        centerY,
        1,
        centerX,
        centerY,
        17 * corePulse
      );
      coreGradient.addColorStop(0, "rgba(255, 255, 255, 0.92)");
      coreGradient.addColorStop(0.18, activityColor(displayedLoad, 0.8));
      coreGradient.addColorStop(1, activityColor(displayedLoad, 0));
      context.fillStyle = coreGradient;
      context.beginPath();
      context.arc(centerX, centerY, 17 * corePulse, 0, Math.PI * 2);
      context.fill();

      context.textAlign = "right";
      context.fillStyle = active && available ? color : "rgba(90, 100, 134, 0.8)";
      context.font = "700 20px JetBrains Mono, ui-monospace, monospace";
      context.fillText(
        active && available ? `${Math.round(displayedLoad * 100)}%` : "—",
        width - 9,
        20
      );
      context.fillStyle = "rgba(90, 100, 134, 0.9)";
      context.font = "600 7px JetBrains Mono, ui-monospace, monospace";
      context.fillText("NEURAL ACTIVITY", width - 9, 29);

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
          active && available ? activityColor(displayedLoad, 0.95) : "rgba(90, 100, 134, 0.8)";
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
    <div className="neural-activity-constellation" aria-label="Live GPU neural activity">
      <div className="neural-activity-constellation__header">
        <span>Neural Field</span>
        <span
          className={
            active && available
              ? "neural-activity-constellation__live"
              : "neural-activity-constellation__idle"
          }
        >
          {active && available ? "● Synchronized" : "○ Quiescent"}
        </span>
      </div>
      <canvas ref={canvasRef} className="neural-activity-constellation__canvas" />
    </div>
  );
}
