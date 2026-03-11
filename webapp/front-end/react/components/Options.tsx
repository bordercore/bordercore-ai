import React from "react";
import Switch from "react-switch";
import { Switches } from "../stores/ChatStoreContext";

interface OptionsProps {
  switches: Switches;
  onToggle: (key: keyof Switches) => void;
  onSensorToggle: () => void;
}

export default function Options({ switches, onToggle, onSensorToggle }: OptionsProps) {
  return (
    <section className="grid mt-0" aria-label="Control Panels">
      {/* Voice Features */}
      <article className="panel" aria-labelledby="voice-title">
        <h3 id="voice-title">VOICE FEATURES</h3>
        <div className="group">
          <ToggleItem
            label="Text to Speech"
            checked={switches.text2speech}
            onToggle={() => onToggle("text2speech")}
            ariaLabel="Enable Text to Speech"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M13 4v16l-5-4H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h4l5-4zm6.5 8a3.5 3.5 0 0 0-2.05-3.17l.7-1.87A5.5 5.5 0 0 1 21.5 12a5.5 5.5 0 0 1-3.35 5.03l-.7-1.87A3.5 3.5 0 0 0 19.5 12zm-3-1.8A2 2 0 0 1 17.5 12a2 2 0 0 1-1.05 1.78l-.7-1.86.7-1.72z" />
              </svg>
            }
          />
          <ToggleItem
            label="Speech to Text"
            checked={switches.speech2text}
            onToggle={() => onToggle("speech2text")}
            ariaLabel="Enable Speech to Text"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm-7-3a1 1 0 1 0-2 0 9 9 0 0 0 8 8v3h2v-3a9 9 0 0 0 8-8 1 1 0 1 0-2 0 7 7 0 0 1-14 0z" />
              </svg>
            }
          />
          <ToggleItem
            label="VAD"
            checked={switches.vad}
            onToggle={() => onToggle("vad")}
            ariaLabel="Enable Speech Detection"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M3 12h2v6H3v-6Zm4-8h2v14H7V4Zm4 4h2v10h-2V8Zm4 6h2v4h-2v-4Zm4-9h2v13h-2V5Z" />
              </svg>
            }
          />
        </div>
      </article>

      {/* Reasoning */}
      <article className="panel" aria-labelledby="reason-title">
        <h3 id="reason-title">REASONING</h3>
        <div className="group">
          <ToggleItem
            label="Wolfram Alpha"
            checked={switches.wolframAlpha}
            onToggle={() => onToggle("wolframAlpha")}
            ariaLabel="Enable Wolfram Alpha"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            }
          />
          <ToggleItem
            label="Enable Thinking"
            checked={switches.enableThinking}
            onToggle={() => onToggle("enableThinking")}
            ariaLabel="Enable Thinking"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm9 4a7.7 7.7 0 0 0-.08-1l2-1.55-2-3.46-2.42.7a7.9 7.9 0 0 0-1.7-.99l-.36-2.5H9.56l-.36 2.5c-.6.25-1.17.57-1.7.98L5.08 4.0 3.08 7.5 5 9.05A7.7 7.7 0 0 0 4.92 12c0 .34.03.68.08 1L3.08 14.55l2 3.45 2.42-.7c.52.41 1.1.74 1.7.99l.36 2.5h4.88l.36-2.5c.6-.25 1.17-.58 1.7-.99l2.42.7 2-3.45L20.92 13c.05-.32.08-.66.08-1Z" />
              </svg>
            }
          />
        </div>
      </article>

      {/* Sensors */}
      <article className="panel" aria-labelledby="sensor-title">
        <h3 id="sensor-title">SENSORS</h3>
        <div className="group">
          <ToggleItem
            label="Enable Sensor"
            checked={false}
            onToggle={onSensorToggle}
            ariaLabel="Enable Sensor"
            icon={
              <svg viewBox="0 0 24 24">
                <path d="M12 3a9 9 0 0 0-9 9h2a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18Zm0 5a4 4 0 0 0-4 4h2a2 2 0 1 1 2 2v2a4 4 0 0 0 0-8Z" />
              </svg>
            }
          />
        </div>
      </article>
    </section>
  );
}

interface ToggleItemProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  icon: React.ReactNode;
}

function ToggleItem({ label, checked, onToggle, ariaLabel, icon }: ToggleItemProps) {
  return (
    <div className="item" style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.4rem 0" }}>
      <div className="badge" style={{ display: "flex", flexShrink: 0 }} aria-hidden="true">
        {icon}
      </div>
      <div className="label" style={{ flex: 1 }}>{label}</div>
      <Switch
        checked={checked}
        onChange={onToggle}
        aria-label={ariaLabel}
        onColor="#0a2026"
        onHandleColor="#67f3ff"
        offColor="#071319"
        offHandleColor="#556"
        handleDiameter={20}
        uncheckedIcon={false}
        checkedIcon={false}
        boxShadow="0 0 4px rgba(0,255,255,.4)"
        activeBoxShadow="0 0 8px rgba(0,255,255,.8)"
        height={26}
        width={50}
        className="toggle"
      />
    </div>
  );
}
