import React, { useState, useMemo, useEffect, useRef } from "react";

interface ThinkingIconProps {
  size?: number;
  active?: boolean;
  showGrid?: boolean;
}

export default function ThinkingIcon({
  size = 64,
  active = false,
  showGrid = false,
}: ThinkingIconProps) {
  const sizePx = `${size}px`;
  const [dashOffset, setDashOffset] = useState(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      const speed = 0.08 * (64 / size);
      let prevTime: number | null = null;

      function animateRing(tsNow: number) {
        const prev = prevTime ?? tsNow;
        const dt = Math.min(32, tsNow - prev);
        prevTime = tsNow;
        setDashOffset((prev) => (prev + speed * dt) % 120);
        rafIdRef.current = requestAnimationFrame(animateRing);
      }

      rafIdRef.current = requestAnimationFrame(animateRing);
      return () => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      };
    } else {
      setDashOffset(0);
    }
  }, [active, size]);

  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    return (
      <g opacity="0.12">
        {Array.from({ length: 9 }, (_, i) => (
          <React.Fragment key={i}>
            <path d={`M10 ${10 * (i + 1)} H 90`} stroke="#00fff0" strokeWidth="0.3" />
            <path d={`M ${10 * (i + 1)} 10 V 90`} stroke="#7a00ff" strokeWidth="0.3" />
          </React.Fragment>
        ))}
      </g>
    );
  }, [showGrid]);

  const blips = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => (
        <circle
          key={i}
          cx={50 + Math.cos((i / 6) * 2 * Math.PI) * 8}
          cy={50 + Math.sin((i / 6) * 2 * Math.PI) * 8}
          r="1.6"
          fill="#ffffff"
          opacity="0.0"
        />
      )),
    []
  );

  const tickMarks = useMemo(
    () =>
      Array.from({ length: 12 }, (_, n) => (
        <line
          key={n}
          x1="50"
          y1="18"
          x2="50"
          y2="22"
          stroke="#00fff0"
          strokeWidth="1.4"
          opacity="0.9"
          transform={`rotate(${(360 / 12) * (n + 1)},50,50)`}
        />
      )),
    []
  );

  return (
    <div
      className="neon-thinking-icon"
      style={{ width: sizePx, height: sizePx }}
      aria-busy={active ? "true" : "false"}
      role="img"
      aria-label={active ? "AI thinking" : "AI idle"}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        className={active ? "active" : ""}
      >
        <defs>
          <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00fff0" />
            <stop offset="45%" stopColor="#00bcd4" />
            <stop offset="100%" stopColor="#001a33" />
          </radialGradient>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff00e6" />
            <stop offset="50%" stopColor="#00fff0" />
            <stop offset="100%" stopColor="#7a00ff" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="outerGlow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <path id="orbitPath" d="M50,10 A40,40 0 1,1 49.99,10" />
        </defs>

        {gridLines}

        {/* Pulsing core */}
        <circle cx="50" cy="50" r="16" fill="url(#coreGrad)" filter="url(#softGlow)" className="core" />

        {/* Rotating circuit ring */}
        <g className="ring" filter="url(#softGlow)">
          <circle
            cx="50"
            cy="50"
            r="30"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="40 20"
            strokeDashoffset={dashOffset}
          />
          <g>{tickMarks}</g>
        </g>

        {/* Scanning arcs */}
        <g className="scanner" filter="url(#softGlow)">
          <path d="M80,50 A30,30 0 0,0 20,50" fill="none" stroke="#ff00e6" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          <path d="M78,50 A28,28 0 0,0 22,50" fill="none" stroke="#00fff0" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
        </g>

        {/* Orbiting particles */}
        <g className="particles">
          <circle r="2.2" fill="#00fff0" filter="url(#outerGlow)">
            {active && (
              <animateMotion dur="2.8s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                <mpath xlinkHref="#orbitPath" />
              </animateMotion>
            )}
          </circle>
          <circle r="1.8" fill="#ff00e6" filter="url(#outerGlow)">
            {active && (
              <animateMotion dur="3.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                <mpath xlinkHref="#orbitPath" />
              </animateMotion>
            )}
          </circle>
          <circle r="1.6" fill="#7a00ff" filter="url(#outerGlow)">
            {active && (
              <animateMotion dur="4.2s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                <mpath xlinkHref="#orbitPath" />
              </animateMotion>
            )}
          </circle>
        </g>

        {/* Subtle data blips */}
        <g className="blips">{blips}</g>
      </svg>
    </div>
  );
}
