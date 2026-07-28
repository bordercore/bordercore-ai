import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceTurnOutcome =
  | "active"
  | "completed"
  | "interrupted"
  | "cancelled"
  | "failed"
  | "discarded"
  | "misfire";
export type VoiceTurnSource = "vad" | "manual";

export interface TtsSegmentMetric {
  id: number;
  requestedAt: number;
  firstByteAt?: number;
  completedAt?: number;
  audioDurationMs?: number;
}

export interface VoiceTurnMetric {
  id: string;
  source: VoiceTurnSource;
  startedAt: number;
  speechEndedAt?: number;
  vadConfirmedAt?: number;
  asrStartedAt?: number;
  transcriptionReadyAt?: number;
  llmRequestedAt?: number;
  firstTokenAt?: number;
  firstSentenceAt?: number;
  firstAudioAt?: number;
  completedAt?: number;
  outcome: VoiceTurnOutcome;
  outcomeReason?: string;
  maxQueueDepth: number;
  maxBufferedAudioMs: number;
  vadFrameCount: number;
  vadSpeechFrameCount: number;
  vadAverageSpeechProbability: number | null;
  vadPeakSpeechProbability: number | null;
  vadEndpointDelayMs: number | null;
  ttsSegments: TtsSegmentMetric[];
}

export function durationBetween(start?: number, end?: number): number | null {
  return start === undefined || end === undefined ? null : Math.max(0, end - start);
}

export function asrHeadStart(turn: VoiceTurnMetric): number | null {
  if (turn.asrStartedAt === undefined || turn.speechEndedAt === undefined) return null;
  return Math.max(0, turn.speechEndedAt - turn.asrStartedAt);
}

export function averageTtsRealTimeFactor(turn: VoiceTurnMetric): number | null {
  const measured = turn.ttsSegments.filter(
    segment => segment.completedAt !== undefined && segment.audioDurationMs
  );
  if (!measured.length) return null;
  const synthesisMs = measured.reduce(
    (total, segment) => total + (segment.completedAt! - segment.requestedAt),
    0
  );
  const audioMs = measured.reduce((total, segment) => total + segment.audioDurationMs!, 0);
  return audioMs > 0 ? synthesisMs / audioMs : null;
}

export function summarizeVoiceTurn(turn: VoiceTurnMetric) {
  return {
    turnId: turn.id,
    source: turn.source,
    outcome: turn.outcome,
    outcomeReason: turn.outcomeReason ?? null,
    asrLatencyMs: durationBetween(turn.speechEndedAt, turn.transcriptionReadyAt),
    asrHeadStartMs: asrHeadStart(turn),
    firstTokenLatencyMs: durationBetween(turn.llmRequestedAt, turn.firstTokenAt),
    firstSentenceLatencyMs: durationBetween(turn.firstTokenAt, turn.firstSentenceAt),
    firstAudioLatencyMs: durationBetween(
      turn.speechEndedAt ?? turn.llmRequestedAt,
      turn.firstAudioAt
    ),
    totalDurationMs: durationBetween(turn.startedAt, turn.completedAt),
    ttsRealTimeFactor: averageTtsRealTimeFactor(turn),
    maxQueueDepth: turn.maxQueueDepth,
    maxBufferedAudioMs: turn.maxBufferedAudioMs,
    vadFrameCount: turn.vadFrameCount,
    vadSpeechFrameCount: turn.vadSpeechFrameCount,
    vadAverageSpeechProbability: turn.vadAverageSpeechProbability,
    vadPeakSpeechProbability: turn.vadPeakSpeechProbability,
    vadEndpointDelayMs: turn.vadEndpointDelayMs,
    vadConfirmationLatencyMs: durationBetween(turn.startedAt, turn.vadConfirmedAt),
    ttsSegmentCount: turn.ttsSegments.length,
    ttsSegments: turn.ttsSegments.map(segment => {
      const synthesisDurationMs = durationBetween(segment.requestedAt, segment.completedAt);
      return {
        id: segment.id,
        requestToFirstByteMs: durationBetween(segment.requestedAt, segment.firstByteAt),
        synthesisDurationMs,
        audioDurationMs: segment.audioDurationMs ?? null,
        realTimeFactor:
          synthesisDurationMs !== null && segment.audioDurationMs
            ? synthesisDurationMs / segment.audioDurationMs
            : null,
      };
    }),
  };
}

export default function useVoiceMetrics() {
  const [turns, setTurns] = useState<VoiceTurnMetric[]>([]);
  const sequenceRef = useRef(0);
  const segmentSequenceRef = useRef(0);
  const loggedTurnsRef = useRef(new Set<string>());
  const markedEventsRef = useRef(new Set<string>());
  const finishedTurnsRef = useRef(new Set<string>());
  const queueMaximumsRef = useRef(new Map<string, { depth: number; bufferedAudioMs: number }>());
  const vadSamplesRef = useRef(
    new Map<
      string,
      {
        frameCount: number;
        speechFrameCount: number;
        probabilityTotal: number;
        peak: number;
        lastSpeechAt: number | null;
      }
    >()
  );

  useEffect(() => {
    for (const turn of turns) {
      if (turn.outcome === "active" || loggedTurnsRef.current.has(turn.id)) continue;
      loggedTurnsRef.current.add(turn.id);
      const summary = summarizeVoiceTurn(turn);
      console.info("[Voice metrics]", summary);
      fetch("/metrics/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summary),
        keepalive: true,
      }).catch(error => console.debug("Unable to publish voice metrics", error));
    }
  }, [turns]);

  const update = useCallback((turnId: string, mutate: (turn: VoiceTurnMetric) => void) => {
    setTurns(previous =>
      previous.map(turn => {
        if (turn.id !== turnId) return turn;
        const updated = {
          ...turn,
          ttsSegments: turn.ttsSegments.map(segment => ({ ...segment })),
        };
        mutate(updated);
        return updated;
      })
    );
  }, []);

  const beginTurn = useCallback((source: VoiceTurnSource) => {
    const id = `voice-${Date.now()}-${++sequenceRef.current}`;
    const turn: VoiceTurnMetric = {
      id,
      source,
      startedAt: performance.now(),
      outcome: "active",
      maxQueueDepth: 0,
      maxBufferedAudioMs: 0,
      vadFrameCount: 0,
      vadSpeechFrameCount: 0,
      vadAverageSpeechProbability: null,
      vadPeakSpeechProbability: null,
      vadEndpointDelayMs: null,
      ttsSegments: [],
    };
    setTurns(previous => [...previous.slice(-9), turn]);
    return id;
  }, []);

  const mark = useCallback(
    (turnId: string | null, field: keyof VoiceTurnMetric, at = performance.now()) => {
      if (!turnId) return;
      const eventKey = `${turnId}:${field}`;
      if (markedEventsRef.current.has(eventKey)) return;
      markedEventsRef.current.add(eventKey);
      update(turnId, turn => {
        (turn as unknown as Record<string, unknown>)[field] = at;
      });
    },
    [update]
  );

  const finish = useCallback(
    (turnId: string | null, outcome: VoiceTurnOutcome, outcomeReason?: string) => {
      if (!turnId) return;
      if (finishedTurnsRef.current.has(turnId)) return;
      finishedTurnsRef.current.add(turnId);
      update(turnId, turn => {
        turn.outcome = outcome;
        turn.outcomeReason = outcomeReason;
        turn.completedAt = performance.now();
      });
    },
    [update]
  );

  const beginTtsSegment = useCallback(
    (turnId: string | null) => {
      if (!turnId) return null;
      const segmentId = ++segmentSequenceRef.current;
      update(turnId, turn => {
        turn.ttsSegments.push({
          id: segmentId,
          requestedAt: performance.now(),
        });
      });
      return segmentId;
    },
    [update]
  );

  const updateTtsSegment = useCallback(
    (turnId: string | null, segmentId: number | null, values: Partial<TtsSegmentMetric>) => {
      if (!turnId || segmentId === null) return;
      update(turnId, turn => {
        const segment = turn.ttsSegments.find(candidate => candidate.id === segmentId);
        if (segment) Object.assign(segment, values);
      });
    },
    [update]
  );

  const recordQueue = useCallback(
    (turnId: string | null, depth: number, bufferedAudioMs: number) => {
      if (!turnId) return;
      const previous = queueMaximumsRef.current.get(turnId) || {
        depth: 0,
        bufferedAudioMs: 0,
      };
      const increasedDepth = depth > previous.depth;
      const increasedBuffer = bufferedAudioMs >= previous.bufferedAudioMs + 100;
      if (!increasedDepth && !increasedBuffer) return;
      queueMaximumsRef.current.set(turnId, {
        depth: Math.max(previous.depth, depth),
        bufferedAudioMs: Math.max(previous.bufferedAudioMs, bufferedAudioMs),
      });
      update(turnId, turn => {
        turn.maxQueueDepth = Math.max(turn.maxQueueDepth, depth);
        turn.maxBufferedAudioMs = Math.max(turn.maxBufferedAudioMs, bufferedAudioMs);
      });
    },
    [update]
  );

  const recordVadFrame = useCallback((turnId: string | null, speechProbability: number) => {
    if (!turnId || !Number.isFinite(speechProbability)) return;
    const probability = Math.max(0, Math.min(1, speechProbability));
    const samples = vadSamplesRef.current.get(turnId) || {
      frameCount: 0,
      speechFrameCount: 0,
      probabilityTotal: 0,
      peak: 0,
      lastSpeechAt: null,
    };
    samples.frameCount += 1;
    if (probability >= 0.3) {
      samples.speechFrameCount += 1;
      samples.lastSpeechAt = performance.now();
    }
    samples.probabilityTotal += probability;
    samples.peak = Math.max(samples.peak, probability);
    vadSamplesRef.current.set(turnId, samples);
  }, []);

  const finalizeVad = useCallback(
    (turnId: string | null) => {
      if (!turnId) return;
      const samples = vadSamplesRef.current.get(turnId);
      vadSamplesRef.current.delete(turnId);
      if (!samples) return;
      update(turnId, turn => {
        turn.vadFrameCount = samples.frameCount;
        turn.vadSpeechFrameCount = samples.speechFrameCount;
        turn.vadAverageSpeechProbability =
          samples.frameCount > 0 ? samples.probabilityTotal / samples.frameCount : null;
        turn.vadPeakSpeechProbability = samples.frameCount > 0 ? samples.peak : null;
        turn.vadEndpointDelayMs =
          samples.lastSpeechAt === null
            ? null
            : Math.max(0, performance.now() - samples.lastSpeechAt);
      });
    },
    [update]
  );

  return {
    turns,
    beginTurn,
    markSpeechEnded: (id: string | null) => mark(id, "speechEndedAt"),
    markVadConfirmed: (id: string | null) => mark(id, "vadConfirmedAt"),
    markAsrStarted: (id: string | null) => mark(id, "asrStartedAt"),
    markTranscriptionReady: (id: string | null) => mark(id, "transcriptionReadyAt"),
    markLlmRequested: (id: string | null) => mark(id, "llmRequestedAt"),
    markFirstToken: (id: string | null) => mark(id, "firstTokenAt"),
    markFirstSentence: (id: string | null) => mark(id, "firstSentenceAt"),
    markFirstAudio: (id: string | null, delayMs = 0) =>
      mark(id, "firstAudioAt", performance.now() + delayMs),
    beginTtsSegment,
    markTtsFirstByte: (id: string | null, segmentId: number | null) =>
      updateTtsSegment(id, segmentId, { firstByteAt: performance.now() }),
    completeTtsSegment: (id: string | null, segmentId: number | null, audioDurationMs: number) =>
      updateTtsSegment(id, segmentId, {
        completedAt: performance.now(),
        audioDurationMs,
      }),
    recordQueue,
    recordVadFrame,
    finalizeVad,
    finish,
  };
}
