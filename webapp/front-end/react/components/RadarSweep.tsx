import React from "react";

export default function RadarSweep() {
  return (
    <div className="radar-sweep" role="status" aria-label="AI scanning">
      <svg viewBox="0 0 60 60" width="36" height="36" aria-hidden="true">
        <defs>
          <linearGradient id="radar-sweep-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00eaff" stopOpacity="0" />
            <stop offset="100%" stopColor="#00eaff" stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id="radar-core-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0, 234, 255, 0.35)" />
            <stop offset="100%" stopColor="rgba(0, 234, 255, 0)" />
          </radialGradient>
        </defs>

        <circle cx="30" cy="30" r="26" fill="url(#radar-core-gradient)" />
        <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(0, 234, 255, 0.45)" strokeWidth="1" />
        <circle cx="30" cy="30" r="17" fill="none" stroke="rgba(0, 234, 255, 0.22)" strokeWidth="0.6" />
        <circle cx="30" cy="30" r="9" fill="none" stroke="rgba(0, 234, 255, 0.2)" strokeWidth="0.6" />

        <line x1="4" y1="30" x2="56" y2="30" stroke="rgba(0, 234, 255, 0.15)" strokeWidth="0.5" />
        <line x1="30" y1="4" x2="30" y2="56" stroke="rgba(0, 234, 255, 0.15)" strokeWidth="0.5" />

        <g className="radar-sweep-arm">
          <path d="M30 30 L56 30 A26 26 0 0 0 48 11 Z" fill="url(#radar-sweep-gradient)" />
        </g>

        <circle className="radar-blip radar-blip-1" cx="42" cy="20" r="1.4" fill="#00ffaa" />
        <circle className="radar-blip radar-blip-2" cx="18" cy="38" r="1.2" fill="#a855f7" />
        <circle className="radar-blip radar-blip-3" cx="36" cy="44" r="1.3" fill="#ec4899" />

        <circle cx="30" cy="30" r="1.5" fill="#00eaff" />
      </svg>
    </div>
  );
}
