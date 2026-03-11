import React, { useState, useMemo, useEffect, useCallback } from "react";

interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  showInput?: boolean;
}

export default function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  showInput = true,
}: SliderProps) {
  const [rawSliderValue, setRawSliderValue] = useState(value ?? min);

  const stepDecimals = useMemo(() => {
    const s = step || 1;
    const stepStr = String(s);
    const dotIndex = stepStr.indexOf(".");
    return dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1;
  }, [step]);

  const roundToStepPrecision = useCallback(
    (val: number) => {
      const factor = 10 ** stepDecimals;
      return Math.round(val * factor) / factor;
    },
    [stepDecimals]
  );

  const snappedValue = useMemo(() => {
    const s = step || 1;
    const raw = rawSliderValue ?? min;
    const clampedRaw = Math.min(max, Math.max(min, raw));
    const stepsFromMin = Math.round((clampedRaw - min) / s);
    const snapped = min + stepsFromMin * s;
    const clampedSnapped = Math.min(max, Math.max(min, snapped));
    return roundToStepPrecision(clampedSnapped);
  }, [rawSliderValue, min, max, step, roundToStepPrecision]);

  // Keep in sync with parent
  useEffect(() => {
    const next = value ?? min;
    if (next !== snappedValue) {
      setRawSliderValue(next);
    }
  }, [value]);

  // Emit discrete value
  useEffect(() => {
    onChange(snappedValue);
  }, [snappedValue]);

  const sliderValPercent = useMemo(() => {
    const range = max - min;
    if (!range) return 0;
    const raw = rawSliderValue ?? min;
    const clamped = Math.min(max, Math.max(min, raw));
    return ((clamped - min) / range) * 100;
  }, [rawSliderValue, min, max]);

  function onRangeInput(event: React.ChangeEvent<HTMLInputElement>) {
    setRawSliderValue(Number(event.target.value));
  }

  function onNumberInput(event: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(event.target.value);
    if (Number.isFinite(val)) {
      setRawSliderValue(val);
    }
  }

  return (
    <div className="custom-slider">
      <input
        type="range"
        min={min}
        max={max}
        step="any"
        value={rawSliderValue}
        style={{ "--val": sliderValPercent } as React.CSSProperties}
        className="slider-glow"
        onChange={onRangeInput}
      />
      {showInput ? (
        <input
          type="number"
          className="slider-value-input input ms-3"
          min={min}
          max={max}
          step={step}
          value={snappedValue}
          onChange={onNumberInput}
        />
      ) : (
        <span className="slider-value ms-2">
          <strong>{snappedValue}</strong>
        </span>
      )}
    </div>
  );
}
