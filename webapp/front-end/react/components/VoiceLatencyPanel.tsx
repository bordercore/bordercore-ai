import React, { useState } from "react";

import {
  averageTtsRealTimeFactor,
  durationBetween,
  summarizeVoiceTurn,
  VoiceTurnMetric,
} from "../hooks/useVoiceMetrics";
import { identifyVadPreset, VadConfig, VAD_PRESETS } from "../utils/vadConfig";
import { VadRuntimeState } from "../utils/vadRuntime";

interface VoiceLatencyPanelProps {
  turns: VoiceTurnMetric[];
  vadConfig: VadConfig;
  vadEnabled: boolean;
  vadRuntimeState: VadRuntimeState;
}

function milliseconds(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

export function describeVoiceStatus(
  turn: VoiceTurnMetric | undefined,
  vadEnabled: boolean,
  runtimeState: VadRuntimeState = vadEnabled ? { status: "ready" } : { status: "off" }
): string {
  if (runtimeState.status === "error") return "Startup failed";
  if (runtimeState.status === "starting") return "Starting VAD…";
  if (!vadEnabled) return "Off";
  if (!turn) return "Ready";
  if (turn.outcome !== "active") {
    const labels = {
      completed: "Completed",
      interrupted: "Interrupted",
      cancelled: "Cancelled",
      failed: "Failed",
      discarded: "Transcript discarded",
      misfire: "Misfire discarded",
    };
    return labels[turn.outcome];
  }
  if (turn.firstAudioAt !== undefined) return "Responding";
  if (turn.llmRequestedAt !== undefined) return "Thinking";
  if (turn.asrStartedAt !== undefined) return "Transcribing";
  if (turn.vadConfirmedAt !== undefined) return "Listening";
  return "Speech detected";
}

export default function VoiceLatencyPanel({
  turns,
  vadConfig,
  vadEnabled,
  vadRuntimeState,
}: VoiceLatencyPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const turn = turns[turns.length - 1];
  const presetKey = identifyVadPreset(vadConfig);
  const preset = presetKey === "custom" ? "Custom" : VAD_PRESETS[presetKey].label;
  const status = describeVoiceStatus(turn, vadEnabled, vadRuntimeState);

  const copyDiagnostics = async () => {
    const outcomes = turns.reduce<Record<string, number>>((counts, candidate) => {
      counts[candidate.outcome] = (counts[candidate.outcome] ?? 0) + 1;
      return counts;
    }, {});
    const report = {
      generatedAt: new Date().toISOString(),
      vad: {
        enabled: vadEnabled,
        status,
        runtimeState: vadRuntimeState,
        preset,
        config: vadConfig,
      },
      latestTurn: turn ? { status, ...summarizeVoiceTurn(turn) } : null,
      sessionOutcomes: outcomes,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  if (!turn) {
    return (
      <div className="voice-latency-panel">
        <div className="voice-latency-header">
          <span>Voice diagnostics</span>
          <span className="voice-latency-outcome">{status}</span>
        </div>
        {vadRuntimeState.status === "error" && (
          <div className="voice-diagnostics-reason">
            <span>VAD startup</span>
            <strong>{vadRuntimeState.message}</strong>
          </div>
        )}
        <div className="voice-latency-empty">Complete a voice turn to see latency.</div>
        <button className="voice-diagnostics-copy" type="button" onClick={copyDiagnostics}>
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed"
              : "Copy diagnostics"}
        </button>
      </div>
    );
  }

  const rtf = averageTtsRealTimeFactor(turn);
  const outcomes = turns.reduce(
    (counts, candidate) => {
      if (candidate.outcome !== "active") counts[candidate.outcome] += 1;
      return counts;
    },
    { completed: 0, interrupted: 0, cancelled: 0, failed: 0, discarded: 0, misfire: 0 }
  );
  const rows = [
    ["ASR", durationBetween(turn.speechEndedAt, turn.transcriptionReadyAt)],
    ["VAD confirmation", durationBetween(turn.startedAt, turn.vadConfirmedAt)],
    ["VAD endpoint", turn.vadEndpointDelayMs],
    ["First token", durationBetween(turn.llmRequestedAt, turn.firstTokenAt)],
    ["First sentence", durationBetween(turn.firstTokenAt, turn.firstSentenceAt)],
    ["First audio", durationBetween(turn.speechEndedAt ?? turn.llmRequestedAt, turn.firstAudioAt)],
    ["Total turn", durationBetween(turn.startedAt, turn.completedAt)],
  ] as const;

  return (
    <div className="voice-latency-panel">
      <div className="voice-latency-header">
        <span>Voice diagnostics</span>
        <span className={`voice-latency-outcome voice-latency-outcome--${turn.outcome}`}>
          {status}
        </span>
      </div>
      <div className="voice-latency-grid">
        <span>VAD preset</span>
        <strong>{preset}</strong>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <span>{label}</span>
            <strong>{milliseconds(value)}</strong>
          </React.Fragment>
        ))}
        <span>TTS RTF</span>
        <strong>{rtf === null ? "—" : `${rtf.toFixed(2)}×`}</strong>
        <span>Queue / buffer</span>
        <strong>
          {turn.maxQueueDepth} / {milliseconds(turn.maxBufferedAudioMs)}
        </strong>
        <span>VAD confidence</span>
        <strong>
          {turn.vadAverageSpeechProbability === null
            ? "—"
            : `${Math.round(turn.vadAverageSpeechProbability * 100)}% avg / ${Math.round(
                (turn.vadPeakSpeechProbability ?? 0) * 100
              )}% peak`}
        </strong>
        <span>VAD speech frames</span>
        <strong>
          {turn.vadFrameCount
            ? `${turn.vadSpeechFrameCount} / ${turn.vadFrameCount} (${Math.round(
                (turn.vadSpeechFrameCount / turn.vadFrameCount) * 100
              )}%)`
            : "—"}
        </strong>
      </div>
      {turn.outcomeReason && (
        <div className="voice-diagnostics-reason">
          <span>Latest result</span>
          <strong>{turn.outcomeReason}</strong>
        </div>
      )}
      {vadRuntimeState.status === "error" && (
        <div className="voice-diagnostics-reason">
          <span>VAD startup</span>
          <strong>{vadRuntimeState.message}</strong>
        </div>
      )}
      <div className="voice-latency-counts" aria-label="Voice turn outcomes this session">
        <span>{outcomes.completed} complete</span>
        <span>{outcomes.interrupted} interrupted</span>
        <span>{outcomes.cancelled} cancelled</span>
        <span>{outcomes.failed} failed</span>
        <span>{outcomes.discarded} discarded</span>
        <span>{outcomes.misfire} VAD misfires</span>
      </div>
      <button className="voice-diagnostics-copy" type="button" onClick={copyDiagnostics}>
        {copyState === "copied"
          ? "Copied"
          : copyState === "error"
            ? "Copy failed"
            : "Copy diagnostics"}
      </button>
    </div>
  );
}
