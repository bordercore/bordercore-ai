import React from "react";

import {
  averageTtsRealTimeFactor,
  durationBetween,
  VoiceTurnMetric,
} from "../hooks/useVoiceMetrics";

interface VoiceLatencyPanelProps {
  turns: VoiceTurnMetric[];
}

function milliseconds(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

export default function VoiceLatencyPanel({ turns }: VoiceLatencyPanelProps) {
  const turn = turns[turns.length - 1];
  if (!turn) {
    return (
      <div className="voice-latency-panel">
        <div className="voice-latency-empty">Complete a voice turn to see latency.</div>
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
        <span>Voice latency</span>
        <span className={`voice-latency-outcome voice-latency-outcome--${turn.outcome}`}>
          {turn.outcome}
        </span>
      </div>
      <div className="voice-latency-grid">
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
      <div className="voice-latency-counts" aria-label="Voice turn outcomes this session">
        <span>{outcomes.completed} complete</span>
        <span>{outcomes.interrupted} interrupted</span>
        <span>{outcomes.cancelled} cancelled</span>
        <span>{outcomes.failed} failed</span>
        <span>{outcomes.discarded} discarded</span>
        <span>{outcomes.misfire} VAD misfires</span>
      </div>
    </div>
  );
}
