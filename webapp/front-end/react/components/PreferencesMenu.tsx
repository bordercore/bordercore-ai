import React, { useState } from "react";
import Switch from "react-switch";
import Slider from "./Slider";
import {
  GpuTelemetryVisualization,
  VisualizationType,
  WaitingAnimation,
} from "../stores/ChatStoreContext";
import { TtsCapabilityState } from "../utils/ttsCapabilities";
import {
  DEFAULT_VAD_CONFIG,
  identifyVadPreset,
  normalizeVadConfig,
  VadConfig,
  VadPreset,
  VAD_PRESETS,
} from "../utils/vadConfig";

const VISUALIZATION_OPTIONS: { value: VisualizationType; label: string }[] = [
  { value: "gpuOrb", label: "GPU Orb" },
  { value: "thinkingIcon", label: "Thinking" },
  { value: "nexus", label: "Nexus" },
  { value: "waveform", label: "Waveform" },
  { value: "sentinelOrb", label: "Sentinel Orb" },
];

const WAITING_ANIMATION_OPTIONS: { value: WaitingAnimation; label: string }[] = [
  { value: "spinner", label: "Spinner" },
  { value: "tokenStream", label: "Token Stream" },
  { value: "scramble", label: "Scramble Glyphs" },
  { value: "typingDots", label: "Typing Dots" },
  { value: "shimmerBubble", label: "Shimmer Bubble" },
  { value: "travelingBorder", label: "Traveling Border" },
  { value: "eqBars", label: "EQ Bars" },
  { value: "radarSweep", label: "Radar Sweep" },
];

const GPU_TELEMETRY_OPTIONS: { value: GpuTelemetryVisualization; label: string }[] = [
  { value: "neonPulseReactor", label: "Neon Pulse Reactor" },
  { value: "gpuSignalScanner", label: "GPU Signal Scanner" },
  { value: "thermalPowerCore", label: "Thermal Power Core" },
  { value: "neuralActivityConstellation", label: "Neural Activity Constellation" },
];

interface PreferencesMenuProps {
  show: boolean;
  temperature: number | null;
  onTemperatureChange: (value: number | null) => void;
  audioSpeed: number;
  onAudioSpeedChange: (value: number) => void;
  ttsHost: string;
  ttsManagedEngine: string;
  onTtsPresetChange: (preset: TtsHostPreset) => void;
  ttsHostPresets: TtsHostPreset[];
  ttsVoice: string;
  onTtsVoiceChange: (value: string) => void;
  ttsCapabilities: TtsCapabilityState;
  onRefreshTtsCapabilities: () => void;
  asrIdleTimeoutMinutes: number | null;
  onAsrIdleTimeoutChange: (value: number | null) => void;
  vadConfig: VadConfig;
  onVadConfigChange: React.Dispatch<React.SetStateAction<VadConfig>>;
  voiceList: string[];
  visualization: VisualizationType;
  onVisualizationChange: (value: VisualizationType) => void;
  gpuTelemetryVisualization: GpuTelemetryVisualization;
  onGpuTelemetryVisualizationChange: (value: GpuTelemetryVisualization) => void;
  waitingAnimation: WaitingAnimation;
  onWaitingAnimationChange: (value: WaitingAnimation) => void;
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

export interface TtsHostPreset {
  label: string;
  host: string;
  managed_engine?: string;
}

export default function PreferencesMenu({
  show,
  temperature,
  onTemperatureChange,
  audioSpeed,
  onAudioSpeedChange,
  ttsHost,
  ttsManagedEngine,
  onTtsPresetChange,
  ttsHostPresets,
  ttsVoice,
  onTtsVoiceChange,
  ttsCapabilities,
  onRefreshTtsCapabilities,
  asrIdleTimeoutMinutes,
  onAsrIdleTimeoutChange,
  vadConfig,
  onVadConfigChange,
  voiceList,
  visualization,
  onVisualizationChange,
  gpuTelemetryVisualization,
  onGpuTelemetryVisualizationChange,
  waitingAnimation,
  onWaitingAnimationChange,
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
  const [activeTab, setActiveTab] = useState<"general" | "appearance" | "vad">("general");
  if (!show) return null;

  const temperaturePreset =
    temperature === null
      ? "default"
      : temperature === 0.2
        ? "precise"
        : temperature === 0.7
          ? "balanced"
          : temperature === 1
            ? "creative"
            : "custom";
  const updateVadConfig = (patch: Partial<VadConfig>) => {
    onVadConfigChange(current => {
      const next = normalizeVadConfig({ ...current, ...patch });
      return Object.keys(next).every(
        key => next[key as keyof VadConfig] === current[key as keyof VadConfig]
      )
        ? current
        : next;
    });
  };
  const vadPreset = identifyVadPreset(vadConfig);
  const vadPresetDefinition = vadPreset === "custom" ? null : VAD_PRESETS[vadPreset];
  const selectedTtsPreset = ttsHostPresets.findIndex(
    preset => preset.host === ttsHost && (preset.managed_engine || "") === ttsManagedEngine
  );

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
      <div className="preferences-tabs" role="tablist" aria-label="Preference categories">
        {[
          ["general", "General"],
          ["appearance", "Appearance"],
          ["vad", "VAD"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            className={activeTab === value ? "preferences-tab is-active" : "preferences-tab"}
            onClick={() => setActiveTab(value as typeof activeTab)}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {activeTab === "general" && (
          <>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Speech Recognition Idle Timeout
              </div>
              <select
                className="waiting-animation-select"
                value={asrIdleTimeoutMinutes === null ? "none" : asrIdleTimeoutMinutes}
                onChange={event =>
                  onAsrIdleTimeoutChange(
                    event.target.value === "none" ? null : Number(event.target.value)
                  )
                }
                aria-label="Speech recognition idle timeout"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value="none">No timeout</option>
              </select>
              <div className="pref-hint" style={{ marginTop: "0.35rem" }}>
                Releases Whisper GPU memory after this much inactivity
              </div>
            </div>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Temperature
              </div>
              <select
                className="waiting-animation-select"
                value={temperaturePreset}
                onChange={event => {
                  const preset = event.target.value;
                  if (preset === "default") onTemperatureChange(null);
                  else if (preset === "precise") onTemperatureChange(0.2);
                  else if (preset === "balanced") onTemperatureChange(0.7);
                  else if (preset === "creative") onTemperatureChange(1);
                  else onTemperatureChange(0.8);
                }}
                aria-label="Model temperature preset"
              >
                <option value="default">Model default</option>
                <option value="precise">Precise (0.2)</option>
                <option value="balanced">Balanced (0.7)</option>
                <option value="creative">Creative (1.0)</option>
                <option value="custom">Custom</option>
              </select>
              {temperaturePreset === "custom" && temperature !== null && (
                <div style={{ marginTop: "0.55rem" }}>
                  <Slider
                    value={temperature}
                    onChange={onTemperatureChange}
                    min={0}
                    max={2}
                    step={0.1}
                    showInput
                  />
                </div>
              )}
              <div className="pref-hint" style={{ marginTop: "0.35rem" }}>
                Model default uses the selected model&apos;s native temperature
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
                TTS Engine
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <select
                  className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-sm text-txt-primary focus:border-accent-cyan focus:outline-none"
                  value={selectedTtsPreset >= 0 ? String(selectedTtsPreset) : "custom"}
                  onChange={event => {
                    const preset = ttsHostPresets[Number(event.target.value)];
                    if (preset) onTtsPresetChange(preset);
                  }}
                >
                  {ttsHostPresets.length === 0 && <option value="">(no presets configured)</option>}
                  {ttsHost && selectedTtsPreset < 0 && <option value="custom">{ttsHost}</option>}
                  {ttsHostPresets.map((p, index) => (
                    <option key={`${p.host}:${p.managed_engine || index}`} value={index}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="pref-hint">Switches managed engines when needed</span>
              </div>
              <div
                className="pref-hint"
                role="status"
                aria-live="polite"
                style={{
                  alignItems: "center",
                  color:
                    ttsCapabilities.readiness === "ready"
                      ? "var(--accent-green)"
                      : ttsCapabilities.readiness === "failed"
                        ? "var(--accent-pink)"
                        : "var(--text-muted)",
                  display: "flex",
                  gap: "0.45rem",
                  marginTop: "0.35rem",
                }}
              >
                <span>{ttsCapabilities.message}</span>
                <button
                  type="button"
                  onClick={onRefreshTtsCapabilities}
                  aria-label="Restart or refresh TTS engine"
                  title="Restart or refresh TTS engine"
                  style={{
                    background: "transparent",
                    border: 0,
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ↻
                </button>
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
                  disabled={ttsCapabilities.readiness === "loading" || voiceList.length === 0}
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
                <span className="pref-hint">
                  {ttsCapabilities.capabilities?.supports_cloning
                    ? "Voice-cloning profile reported by this server"
                    : "Built-in voice reported by this server"}
                </span>
              </div>
            </div>
          </>
        )}
        {activeTab === "appearance" && (
          <>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Visualization
              </div>
              <select
                className="waiting-animation-select"
                value={visualization}
                onChange={e => onVisualizationChange(e.target.value as VisualizationType)}
                aria-label="Visualization style"
              >
                {VISUALIZATION_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                GPU Telemetry
              </div>
              <select
                className="waiting-animation-select"
                value={gpuTelemetryVisualization}
                onChange={e =>
                  onGpuTelemetryVisualizationChange(e.target.value as GpuTelemetryVisualization)
                }
                aria-label="GPU telemetry visualization"
              >
                {GPU_TELEMETRY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Waiting Animation
              </div>
              <select
                className="waiting-animation-select"
                value={waitingAnimation}
                onChange={e => onWaitingAnimationChange(e.target.value as WaitingAnimation)}
                aria-label="Waiting animation style"
              >
                {WAITING_ANIMATION_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="pref-label" style={{ marginBottom: "0.4rem" }}>
                Cyberspace
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Switch
                  checked={auroraEnabled}
                  onChange={onAuroraEnabledChange}
                  aria-label="Toggle cyberspace flythrough"
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
                <span className="pref-hint">Slow flythrough between towering data vaults</span>
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
                <span className="pref-hint">
                  Cyan and purple particles drifting in the foreground
                </span>
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
          </>
        )}
        {activeTab === "vad" && (
          <>
            <div className="pref-hint">
              Changes are saved in this browser and applied automatically when VAD is running.
            </div>
            <div>
              <div className="pref-label vad-preset-label" style={{ marginBottom: "0.4rem" }}>
                <span>Preset</span>
                <button className="vad-preset-tooltip" type="button" aria-label="About VAD presets">
                  ?
                  <span role="tooltip">
                    Presets tune how quickly speech starts and ends. Begin with Balanced, then
                    choose a specialized preset if turns feel clipped, slow, or noise-triggered.
                  </span>
                </button>
              </div>
              <select
                className="waiting-animation-select"
                value={vadPreset}
                onChange={event => {
                  if (event.target.value === "custom") return;
                  onVadConfigChange(VAD_PRESETS[event.target.value as VadPreset].config);
                }}
                aria-label="VAD preset"
              >
                {(
                  Object.entries(VAD_PRESETS) as [VadPreset, (typeof VAD_PRESETS)[VadPreset]][]
                ).map(([value, preset]) => (
                  <option
                    key={value}
                    value={value}
                    title={`${preset.bestFor} Tradeoff: ${preset.tradeoff}`}
                  >
                    {preset.label}
                  </option>
                ))}
                {vadPreset === "custom" && <option value="custom">Custom</option>}
              </select>
              <div className="vad-preset-guidance" aria-live="polite">
                {vadPresetDefinition ? (
                  <>
                    <div>
                      <strong>Best for:</strong> {vadPresetDefinition.bestFor}
                    </div>
                    <div>
                      <strong>Tradeoff:</strong> {vadPresetDefinition.tradeoff}
                    </div>
                  </>
                ) : (
                  <div>
                    <strong>Custom:</strong> One or more controls differ from a preset.
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="pref-label">Speech Start Threshold</div>
              <Slider
                value={vadConfig.positiveSpeechThreshold}
                onChange={value => updateVadConfig({ positiveSpeechThreshold: value })}
                min={0.1}
                max={0.9}
                step={0.05}
                showInput
              />
              <div className="pref-hint">Higher values reject more noise.</div>
            </div>
            <div>
              <div className="pref-label">Speech End Threshold</div>
              <Slider
                value={vadConfig.negativeSpeechThreshold}
                onChange={value => updateVadConfig({ negativeSpeechThreshold: value })}
                min={0.05}
                max={Math.max(0.05, vadConfig.positiveSpeechThreshold - 0.05)}
                step={0.05}
                showInput
              />
              <div className="pref-hint">Must remain below the speech-start threshold.</div>
            </div>
            <div>
              <div className="pref-label">End-of-Turn Silence</div>
              <Slider
                value={vadConfig.redemptionMs}
                onChange={value => updateVadConfig({ redemptionMs: value })}
                min={300}
                max={3000}
                step={100}
                showInput
              />
              <div className="pref-hint">Milliseconds of silence before submitting a turn.</div>
            </div>
            <div>
              <div className="pref-label">Minimum Speech</div>
              <Slider
                value={vadConfig.minSpeechMs}
                onChange={value => updateVadConfig({ minSpeechMs: value })}
                min={100}
                max={1000}
                step={50}
                showInput
              />
              <div className="pref-hint">Shorter detections are counted as misfires.</div>
            </div>
            <div>
              <div className="pref-label">Pre-Speech Padding</div>
              <Slider
                value={vadConfig.preSpeechPadMs}
                onChange={value => updateVadConfig({ preSpeechPadMs: value })}
                min={0}
                max={1500}
                step={50}
                showInput
              />
              <div className="pref-hint">Audio retained before detected speech begins.</div>
            </div>
            <button
              type="button"
              className="preferences-reset"
              onClick={() => onVadConfigChange(DEFAULT_VAD_CONFIG)}
            >
              Reset VAD defaults
            </button>
          </>
        )}
      </div>
    </div>
  );
}
