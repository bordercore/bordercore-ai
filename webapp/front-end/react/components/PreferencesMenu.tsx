import React from "react";
import Slider from "./Slider";

interface PreferencesMenuProps {
  show: boolean;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  audioSpeed: number;
  onAudioSpeedChange: (value: number) => void;
  ttsHost: string;
  onTtsHostChange: (value: string) => void;
}

export default function PreferencesMenu({
  show,
  temperature,
  onTemperatureChange,
  audioSpeed,
  onAudioSpeedChange,
  ttsHost,
  onTtsHostChange,
}: PreferencesMenuProps) {
  if (!show) return null;

  return (
    <div id="menu">
      <h4 style={{ color: "var(--accent-cyan)", fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: "1rem" }}>
        Preferences
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>Temperature</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Slider
              value={temperature}
              onChange={onTemperatureChange}
              min={0.0}
              max={1.0}
              step={0.1}
              showInput={false}
            />
            <span className="pref-hint">0 (Predictable) to 1 (Random)</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>Audio Speed</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Slider
              value={audioSpeed}
              onChange={onAudioSpeedChange}
              min={0}
              max={2}
              step={0.1}
              showInput={false}
            />
            <span className="pref-hint">0 (Slow) to 2 (Fast)</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>TTS Host</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="text"
              className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-txt-primary focus:border-accent-cyan focus:outline-none"
              value={ttsHost}
              onChange={(e) => onTtsHostChange(e.target.value)}
              size={20}
            />
            <span className="pref-hint">Hostname and port for TTS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
