import React, { useMemo } from "react";

interface NexusVizProps {
  size?: number;
  active?: boolean;
}

export default function NexusViz({
  size = 64,
  active = false,
}: NexusVizProps) {
  const sizePx = `${size}px`;

  const ticks = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * 2 * Math.PI;
        const inner = i % 6 === 0 ? 41 : 42.5;
        return (
          <line
            key={i}
            x1={50 + inner * Math.cos(angle)}
            y1={50 + inner * Math.sin(angle)}
            x2={50 + 44 * Math.cos(angle)}
            y2={50 + 44 * Math.sin(angle)}
            stroke="#00fff0"
            strokeWidth={i % 6 === 0 ? "1.2" : "0.5"}
            opacity={i % 6 === 0 ? "0.5" : "0.2"}
          />
        );
      }),
    []
  );

  return (
    <div
      className="nexus-viz"
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
          <radialGradient id="nexusCoreGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00fff0" />
            <stop offset="50%" stopColor="#7a00ff" />
            <stop offset="100%" stopColor="#001a33" stopOpacity="0" />
          </radialGradient>
          <filter id="nexusGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="nexusGlowStrong" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <path id="nexusOrbit" d="M 15,50 A 35,14 0 1,1 85,50 A 35,14 0 1,1 15,50" />
        </defs>

        {/* Outer frame */}
        <circle cx="50" cy="50" r="44" fill="none" stroke="#00fff0" strokeWidth="0.5" opacity="0.2" />
        <g>{ticks}</g>

        {/* HUD brackets */}
        <g className="nexus-brackets">
          <path d="M 43,7 L 43,3 L 57,3 L 57,7" fill="none" stroke="#00fff0" strokeWidth="0.8" />
          <path d="M 43,93 L 43,97 L 57,97 L 57,93" fill="none" stroke="#00fff0" strokeWidth="0.8" />
          <path d="M 7,43 L 3,43 L 3,57 L 7,57" fill="none" stroke="#ff00e6" strokeWidth="0.8" />
          <path d="M 93,43 L 97,43 L 97,57 L 93,57" fill="none" stroke="#ff00e6" strokeWidth="0.8" />
        </g>

        {/* Scanner sweep */}
        <line
          className="nexus-scanner"
          x1="50" y1="50" x2="50" y2="8"
          stroke="#00fff0" strokeWidth="0.8"
        />

        {/* Ring 1 — horizontal */}
        <g className="nexus-ring-anim nexus-ring-1-anim" style={{ transformOrigin: "50px 50px" }}>
          <ellipse cx="50" cy="50" rx="35" ry="14"
            fill="none" stroke="#00fff0" strokeWidth="1.2" opacity="0.6"
            strokeDasharray="6 3" className="nexus-ring-stroke" />
          <circle r="2.2" fill="#00fff0" filter="url(#nexusGlow)">
            {active && (
              <animateMotion dur="3s" repeatCount="indefinite"
                keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                <mpath xlinkHref="#nexusOrbit" />
              </animateMotion>
            )}
          </circle>
        </g>

        {/* Ring 2 — tilted 60° */}
        <g className="nexus-ring-anim nexus-ring-2-anim" style={{ transformOrigin: "50px 50px" }}>
          <g transform="rotate(60, 50, 50)">
            <ellipse cx="50" cy="50" rx="35" ry="14"
              fill="none" stroke="#ff00e6" strokeWidth="1.2" opacity="0.6"
              strokeDasharray="6 3" className="nexus-ring-stroke" />
            <circle r="1.8" fill="#ff00e6" filter="url(#nexusGlow)">
              {active && (
                <animateMotion dur="4.2s" repeatCount="indefinite"
                  keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath xlinkHref="#nexusOrbit" />
                </animateMotion>
              )}
            </circle>
          </g>
        </g>

        {/* Ring 3 — tilted -60° */}
        <g className="nexus-ring-anim nexus-ring-3-anim" style={{ transformOrigin: "50px 50px" }}>
          <g transform="rotate(-60, 50, 50)">
            <ellipse cx="50" cy="50" rx="35" ry="14"
              fill="none" stroke="#7a00ff" strokeWidth="1.2" opacity="0.6"
              strokeDasharray="6 3" className="nexus-ring-stroke" />
            <circle r="1.6" fill="#7a00ff" filter="url(#nexusGlow)">
              {active && (
                <animateMotion dur="5.4s" repeatCount="indefinite"
                  keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath xlinkHref="#nexusOrbit" />
                </animateMotion>
              )}
            </circle>
          </g>
        </g>

        {/* Core glow */}
        <circle cx="50" cy="50" r="10" fill="url(#nexusCoreGrad)"
          filter="url(#nexusGlowStrong)" className="nexus-core"
          style={{ transformOrigin: "50px 50px" }} />

        {/* Core bright center */}
        <circle cx="50" cy="50" r="3" fill="#00fff0" opacity="0.9"
          filter="url(#nexusGlow)" className="nexus-core-inner"
          style={{ transformOrigin: "50px 50px" }} />
      </svg>
    </div>
  );
}
