import React from "react";
import Switch from "react-switch";
import Slider from "./Slider";

interface PreferencesMenuProps {
  show: boolean;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  audioSpeed: number;
  onAudioSpeedChange: (value: number) => void;
  ttsHost: string;
  onTtsHostChange: (value: string) => void;
  ttsVoice: string;
  onTtsVoiceChange: (value: string) => void;
  voiceList: string[];
  cursorEffect: boolean;
  onCursorEffectChange: (value: boolean) => void;
  cursorDensity: number;
  onCursorDensityChange: (value: number) => void;
  cursorSpeed: number;
  onCursorSpeedChange: (value: number) => void;
  auroraEnabled: boolean;
  onAuroraEnabledChange: (value: boolean) => void;
  panelOpacity: number;
  onPanelOpacityChange: (value: number) => void;
  starfieldEnabled: boolean;
  onStarfieldEnabledChange: (value: boolean) => void;
}

export default function PreferencesMenu({
  show,
  temperature,
  onTemperatureChange,
  audioSpeed,
  onAudioSpeedChange,
  ttsHost,
  onTtsHostChange,
  ttsVoice,
  onTtsVoiceChange,
  voiceList,
  cursorEffect,
  onCursorEffectChange,
  cursorDensity,
  onCursorDensityChange,
  cursorSpeed,
  onCursorSpeedChange,
  auroraEnabled,
  onAuroraEnabledChange,
  panelOpacity,
  onPanelOpacityChange,
  starfieldEnabled,
  onStarfieldEnabledChange,
}: PreferencesMenuProps) {
  if (!show) return null;

  return (
    <div id="menu">
      <h4
        style={{
          color: "var(--accent-cyan)",
          fontSize: "0.9rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          marginBottom: "1rem",
        }}
      >
        Preferences
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Temperature
          </div>
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
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Audio Speed
          </div>
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
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            TTS Host
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="text"
              className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-txt-primary focus:border-accent-cyan focus:outline-none"
              value={ttsHost}
              onChange={e => onTtsHostChange(e.target.value)}
              size={20}
            />
            <span className="pref-hint">Hostname and port for TTS</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Voice
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <select
              className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-txt-primary focus:border-accent-cyan focus:outline-none"
              value={ttsVoice}
              onChange={e => onTtsVoiceChange(e.target.value)}
            >
              {voiceList.length === 0 && <option value="">(no voices found)</option>}
              {ttsVoice && !voiceList.includes(ttsVoice) && (
                <option value={ttsVoice}>{ttsVoice}</option>
              )}
              {voiceList.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="pref-hint">Reference voice for cloning TTS (ignored by Kokoro)</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Aurora
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Switch
              checked={auroraEnabled}
              onChange={onAuroraEnabledChange}
              aria-label="Toggle aurora background"
              onColor="#0a2a30"
              onHandleColor="#00eaff"
              offColor="#0c1230"
              offHandleColor="#3a4060"
              handleDiameter={18}
              uncheckedIcon={false}
              checkedIcon={false}
              boxShadow="0 0 4px rgba(0,234,255,.3)"
              activeBoxShadow="0 0 8px rgba(0,234,255,.6)"
              height={24}
              width={46}
            />
            <span className="pref-hint">Drifting glow behind the UI</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Panel Opacity
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Slider
              value={panelOpacity}
              onChange={onPanelOpacityChange}
              min={0}
              max={1}
              step={0.1}
              showInput={false}
            />
            <span className="pref-hint">0 (Transparent) to 1 (Opaque)</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Starfield
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Switch
              checked={starfieldEnabled}
              onChange={onStarfieldEnabledChange}
              aria-label="Toggle floating starfield"
              onColor="#0a2a30"
              onHandleColor="#00eaff"
              offColor="#0c1230"
              offHandleColor="#3a4060"
              handleDiameter={18}
              uncheckedIcon={false}
              checkedIcon={false}
              boxShadow="0 0 4px rgba(0,234,255,.3)"
              activeBoxShadow="0 0 8px rgba(0,234,255,.6)"
              height={24}
              width={46}
            />
            <span className="pref-hint">Cyan and purple particles drifting in the foreground</span>
          </div>
        </div>
        <div>
          <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
            Cursor Effect
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Switch
              checked={cursorEffect}
              onChange={onCursorEffectChange}
              aria-label="Toggle cursor streak effect"
              onColor="#0a2a30"
              onHandleColor="#00eaff"
              offColor="#0c1230"
              offHandleColor="#3a4060"
              handleDiameter={18}
              uncheckedIcon={false}
              checkedIcon={false}
              boxShadow="0 0 4px rgba(0,234,255,.3)"
              activeBoxShadow="0 0 8px rgba(0,234,255,.6)"
              height={24}
              width={46}
            />
            <span className="pref-hint">Animated streaks that follow the cursor</span>
          </div>
        </div>
        {cursorEffect && (
          <>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Cursor Density
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Slider
                  value={cursorDensity}
                  onChange={onCursorDensityChange}
                  min={1}
                  max={40}
                  step={1}
                  showInput={false}
                />
                <span className="pref-hint">Number of streaks</span>
              </div>
            </div>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Cursor Speed
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Slider
                  value={cursorSpeed}
                  onChange={onCursorSpeedChange}
                  min={0}
                  max={1}
                  step={0.05}
                  showInput={false}
                />
                <span className="pref-hint">Motion intensity</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
