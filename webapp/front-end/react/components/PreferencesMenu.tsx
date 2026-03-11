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
    <div id="menu" className="p-3 fadein">
      <h4 className="text-info">Preferences</h4>
      <hr />
      <div className="row g-3 align-items-center mb-3">
        <div className="col-auto">
          <label className="col-form-label">Temperature</label>
        </div>
        <div className="col-auto">
          <Slider
            value={temperature}
            onChange={onTemperatureChange}
            min={0.0}
            max={1.0}
            step={0.1}
            showInput={false}
          />
        </div>
        <div className="col-auto ms-2">
          <span className="form-text">0 (Predictable) to 1 (Random)</span>
        </div>
      </div>
      <div className="row g-3 align-items-center mb-3">
        <div className="col-auto">
          <label className="col-form-label">Audio Speed</label>
        </div>
        <div className="col-auto">
          <Slider
            value={audioSpeed}
            onChange={onAudioSpeedChange}
            min={0}
            max={2}
            step={0.1}
            showInput={false}
          />
        </div>
        <div className="col-auto ms-2">
          <span className="form-text">0 (Slow) to 2 (Fast)</span>
        </div>
      </div>
      <div className="row align-items-center mt-2 mb-3">
        <div className="col-auto">
          <label className="col-form-label">TTS Host</label>
        </div>
        <div className="col-auto">
          <input
            type="text"
            className="form-control"
            value={ttsHost}
            onChange={(e) => onTtsHostChange(e.target.value)}
            size={20}
          />
        </div>
        <div className="col-auto">
          <span className="form-text">Hostname and port for TTS server</span>
        </div>
      </div>
    </div>
  );
}
