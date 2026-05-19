import React, { useEffect, useRef, useState } from "react";

interface WaveformVizProps {
  size?: number;
  active?: boolean;
}

const VB = 100;
const SAMPLES = 96;
const BAR_COUNT = 36;
const SPARKLE_COUNT = 14;

interface WaveDef {
  amp: number;
  freq: number;
  phaseSpeed: number;
  color: string;
  width: number;
  opacity: number;
}

const WAVES: WaveDef[] = [
  { amp: 18, freq: 2.0, phaseSpeed: 1.5, color: "#ec4899", width: 1.9, opacity: 0.95 },
  { amp: 14, freq: 2.8, phaseSpeed: -1.1, color: "#00eaff", width: 1.6, opacity: 0.9 },
  { amp: 12, freq: 2.4, phaseSpeed: 0.9, color: "#a855f7", width: 1.4, opacity: 0.85 },
  { amp: 10, freq: 3.4, phaseSpeed: -0.6, color: "#fb923c", width: 1.2, opacity: 0.8 },
  { amp: 8, freq: 4.2, phaseSpeed: 1.9, color: "#fde047", width: 0.9, opacity: 0.7 },
  { amp: 5, freq: 5.6, phaseSpeed: -2.4, color: "#ffffff", width: 0.6, opacity: 0.45 },
];

function buildPath(amp: number, freq: number, phase: number): string {
  const midY = VB / 2;
  let d = "";
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = t * VB;
    const env = Math.sin(Math.PI * t);
    const y = midY + amp * env * Math.sin(2 * Math.PI * freq * t + phase);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d;
}

export default function WaveformViz({ size = 140, active = false }: WaveformVizProps) {
  const [phase, setPhase] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }
    let prev: number | null = null;
    function tick(now: number) {
      const p = prev ?? now;
      const dt = Math.min(50, now - p) / 1000;
      prev = now;
      setPhase(prev => prev + dt);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const x = (i + 0.5) * (VB / BAR_COUNT);
    const env = Math.sin(Math.PI * (i / (BAR_COUNT - 1)));
    const wob = active ? 0.4 + 0.6 * Math.abs(Math.sin(phase * 2.4 + i * 0.55)) : 0.5;
    const h = VB * 0.55 * env * wob;
    return { x, y: VB / 2 - h / 2, h, key: i };
  });

  const sparkles = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
    const seed = i * 1.37;
    const t = active ? (((phase * 0.18 + i / SPARKLE_COUNT) % 1) + 1) % 1 : (i / SPARKLE_COUNT) % 1;
    const x = t * VB;
    const env = Math.sin(Math.PI * t);
    const y =
      VB / 2 +
      env * 14 * Math.sin(2 * Math.PI * 2.4 * t + phase * 1.7 + seed) +
      (i % 2 === 0 ? -4 : 4) * Math.sin(phase * 1.1 + seed);
    const opacity = active ? 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(phase * 3 + seed)) : 0.4;
    const color =
      i % 4 === 0 ? "#00eaff" : i % 4 === 1 ? "#ec4899" : i % 4 === 2 ? "#fde047" : "#a855f7";
    const r = 0.7 + 0.4 * Math.abs(Math.sin(phase * 2.2 + seed));
    return { x, y, opacity, color, r, key: i };
  });

  return (
    <div
      className="waveform-viz"
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-busy={active ? "true" : "false"}
      role="img"
      aria-label={active ? "AI thinking" : "AI idle"}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VB} ${VB}`}
        xmlns="http://www.w3.org/2000/svg"
        className={active ? "active" : ""}
      >
        <defs>
          <radialGradient id="waveform-bg" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(60, 20, 90, 0.55)" />
            <stop offset="60%" stopColor="rgba(10, 6, 28, 0.35)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
          </radialGradient>
          <linearGradient id="waveform-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0)" />
            <stop offset="50%" stopColor="rgba(168, 85, 247, 0.7)" />
            <stop offset="100%" stopColor="rgba(0, 234, 255, 0)" />
          </linearGradient>
          <filter id="waveform-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="0.9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="waveform-glow-strong" x="-30%" y="-50%" width="160%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width={VB} height={VB} rx="6" ry="6" fill="url(#waveform-bg)" />

        <g opacity="0.8">
          {bars.map(b => (
            <rect
              key={b.key}
              x={b.x - 0.35}
              y={b.y}
              width="0.7"
              height={b.h}
              fill="url(#waveform-bar)"
            />
          ))}
        </g>

        <g filter="url(#waveform-glow-strong)">
          {WAVES.slice(0, 3).map((w, i) => (
            <path
              key={`bg-${i}`}
              d={buildPath(w.amp, w.freq, phase * w.phaseSpeed)}
              stroke={w.color}
              strokeWidth={w.width * 1.6}
              strokeLinecap="round"
              fill="none"
              opacity={w.opacity * 0.45}
            />
          ))}
        </g>

        <g filter="url(#waveform-glow)">
          {WAVES.map((w, i) => (
            <path
              key={i}
              d={buildPath(w.amp, w.freq, phase * w.phaseSpeed)}
              stroke={w.color}
              strokeWidth={w.width}
              strokeLinecap="round"
              fill="none"
              opacity={w.opacity}
            />
          ))}
        </g>

        <g>
          {sparkles.map(s => (
            <circle key={s.key} cx={s.x} cy={s.y} r={s.r} fill={s.color} opacity={s.opacity} />
          ))}
        </g>
      </svg>
    </div>
  );
}
