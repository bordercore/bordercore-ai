/**
 * Glyph model for the projected-face visualizations (Nova, Sable).
 *
 * The neon symbols on the skin are laid out in the head model's glyph
 * texture space: u runs across the front of the face from the viewer's left
 * (0) to right (1) and v runs up it, so a constant v is a level line across
 * the face. The layout hangs off the model's 68 facial landmarks and is
 * rebuilt for every query:
 *
 *   - a constellation whose points join up one by one across a cheekbone
 *   - circuit traces that grow from the temple along the jaw, carrying
 *     travelling pulses
 *   - columns of hex and katakana that run parallel to the edge of the face
 *   - a scan line that sweeps down the face now and then
 *
 * How much of the layout is showing depends on a density clock that runs
 * while a query is in flight. When the query ends the glyphs dissolve.
 *
 * `createGlyphField` is pure and takes its randomness as an argument;
 * `drawGlyphFrame` paints a frame onto a 2D canvas.
 */

import type { FaceState } from "./faceMotion";

export type GlyphColor = "cyan" | "magenta" | "amber";

export interface Landmark {
  u: number;
  v: number;
}

export interface GlyphLine {
  /** Flat list of u, v pairs. */
  points: number[];
  color: GlyphColor;
  alpha: number;
  /** Stroke width in texture pixels at a 1024-pixel texture. */
  width: number;
}

export interface GlyphDot {
  u: number;
  v: number;
  /** Radius as a fraction of the texture size. */
  radius: number;
  color: GlyphColor;
  alpha: number;
}

export interface GlyphChar {
  u: number;
  v: number;
  char: string;
  /** Glyph height as a fraction of the texture size. */
  size: number;
  /** Rotation in radians, counter-clockwise as seen on the face. */
  angle: number;
  color: GlyphColor;
  alpha: number;
}

export interface GlyphFrame {
  lines: GlyphLine[];
  dots: GlyphDot[];
  chars: GlyphChar[];
  /** Height of the scan line, or -1 when none is sweeping. */
  scanV: number;
  /** 0 while the glyphs are intact, rising to 1 as they dissolve. */
  dissolve: number;
  /** Overall brightness multiplier. */
  gain: number;
  /** How far the glyphs have grown, in seconds of waiting. */
  density: number;
}

export interface GlyphInput {
  state: FaceState;
  /** Chunks of response text that arrived since the previous step. */
  chunks: number;
  /** Fixed glyph density, 0 to 1, or null to let it grow with time. */
  intensity: number | null;
}

export interface GlyphOptions {
  /** Fix the cheek the constellation appears on; random when omitted. */
  constellationSide?: "left" | "right";
}

export interface GlyphField {
  step(dtSec: number, input: GlyphInput): GlyphFrame;
}

/** Seconds of waiting after which every glyph in the layout is showing. */
export const FULL_DENSITY_SEC = 26;
export const DISSOLVE_SEC = 1.3;

/** Stroke width of the constellation's edges. */
export const CONSTELLATION_WIDTH = 1.6;
const EDGE_GROW_SEC = 0.4;
const POINT_INTERVAL_SEC = 0.75;
const CHAR_INTERVAL_SEC = 0.22;
const SCAN_SWEEP_SEC = 1.7;
const SCAN_MIN_GAP_SEC = 7;
const SCAN_MAX_GAP_SEC = 14;
const SCAN_TOP_V = 0.9;
const SCAN_BOTTOM_V = 0.1;
const IDLE_PULSE_PERIOD_SEC = 2.6;
const MAX_CHUNK_PULSES = 5;

const HEX = "0123456789ABCDEF";
const KATAKANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";

interface Point {
  u: number;
  v: number;
}

interface Constellation {
  points: Point[];
  /** Pairs of point indices, in the order they connect. */
  edges: [number, number][];
  startAt: number;
}

interface Trace {
  points: Point[];
  /** Distance along the trace at each point, normalised to 0..1. */
  along: number[];
  startAt: number;
  growSec: number;
  color: GlyphColor;
  /** Phase offset of the looping idle pulse, 0..1. */
  phase: number;
  chunkPulses: number[];
}

interface Column {
  rows: { u: number; v: number; angle: number }[];
  startAt: number;
  alphabet: string;
  color: GlyphColor;
  size: number;
  seed: number;
}

interface Spark {
  u: number;
  v: number;
  at: number;
  color: GlyphColor;
  radius: number;
}

export interface GlyphLayout {
  constellation: Constellation;
  traces: Trace[];
  columns: Column[];
  sparks: Spark[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Cheap repeatable hash of three integers to 0..1. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Turns a run of waypoints into a circuit-board path: each hop becomes a
 * 45-degree diagonal plus a straight run, alternating which comes first.
 */
function circuitPath(waypoints: Point[]): Point[] {
  const path: Point[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const du = to.u - from.u;
    const dv = to.v - from.v;
    const diagonal = Math.min(Math.abs(du), Math.abs(dv));
    if (diagonal > 0.004 && Math.abs(Math.abs(du) - Math.abs(dv)) > 0.004) {
      const stepU = Math.sign(du) * diagonal;
      const stepV = Math.sign(dv) * diagonal;
      path.push(
        i % 2 === 0
          ? { u: from.u + stepU, v: from.v + stepV }
          : { u: to.u - stepU, v: to.v - stepV }
      );
    }
    path.push(to);
  }
  return path;
}

function makeTrace(
  waypoints: Point[],
  startAt: number,
  growSec: number,
  color: GlyphColor,
  phase: number
): Trace {
  const points = circuitPath(waypoints);
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(
      along[i - 1] + Math.hypot(points[i].u - points[i - 1].u, points[i].v - points[i - 1].v)
    );
  }
  const total = along[along.length - 1] || 1;
  return {
    points,
    along: along.map(distance => distance / total),
    startAt,
    growSec,
    color,
    phase,
    chunkPulses: [],
  };
}

function pointAlong(trace: Trace, s: number): Point {
  const { points, along } = trace;
  for (let i = 1; i < points.length; i++) {
    if (s <= along[i]) {
      const span = along[i] - along[i - 1] || 1;
      const t = (s - along[i - 1]) / span;
      return {
        u: points[i - 1].u + (points[i].u - points[i - 1].u) * t,
        v: points[i - 1].v + (points[i].v - points[i - 1].v) * t,
      };
    }
  }
  return points[points.length - 1];
}

/**
 * Builds the glyph layout for one query from the 68 facial landmarks.
 *
 * The constellation and the sparks under the eye go on one cheek; the
 * traces and the cheek columns go on the other. Which cheek is which is
 * random unless `options` says, so successive queries differ.
 */
export function buildGlyphLayout(
  landmarks: Landmark[],
  random: () => number,
  options: GlyphOptions = {}
): GlyphLayout {
  const constellationOnLeft = options.constellationSide
    ? options.constellationSide === "left"
    : random() < 0.5;
  // Everything is worked out for the viewer's right-hand side and mirrored
  // as needed; the landmarks are symmetric, so the right-hand ones serve
  // both sides.
  const mirror = (point: Point): Point => ({ u: 1 - point.u, v: point.v });
  const onConstellationSide = (point: Point): Point =>
    constellationOnLeft ? mirror(point) : point;
  const onTraceSide = (point: Point): Point => (constellationOnLeft ? point : mirror(point));
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;

  // u of the jaw outline at height v, on the viewer's right. Landmarks 8..16
  // run from the chin up to the ear.
  const jawU = (v: number): number => {
    for (let i = 9; i <= 16; i++) {
      const lower = landmarks[i - 1];
      const upper = landmarks[i];
      if (v <= upper.v || i === 16) {
        const t = clamp01((v - lower.v) / (upper.v - lower.v || 1));
        return lower.u + (upper.u - lower.u) * t;
      }
    }
    return landmarks[16].u;
  };

  // Height on the face as a fraction of the way from the chin (0) up to
  // the top of the jaw outline by the ear (1).
  const faceV = (t: number): number => landmarks[8].v + (landmarks[16].v - landmarks[8].v) * t;

  // ── Constellation across the cheekbone ──
  const eyeOuter = landmarks[45];
  const nostril = landmarks[35];
  const cheekTop = eyeOuter.v - 0.045;
  const cheekBottom = nostril.v - 0.02;
  const candidates: Point[] = [];
  let attempts = 0;
  const pointCount = 8 + Math.floor(random() * 3);
  while (candidates.length < pointCount && attempts < 400) {
    attempts++;
    const v = cheekBottom + random() * (cheekTop - cheekBottom);
    const inner = nostril.u + 0.05;
    const outer = jawU(v) - 0.05;
    const candidate = { u: inner + random() * (outer - inner), v };
    if (candidates.every(p => Math.hypot(p.u - candidate.u, p.v - candidate.v) > 0.036)) {
      candidates.push(candidate);
    }
  }
  // Start high on the cheekbone and walk to the nearest unvisited point.
  const ordered: Point[] = [];
  const remaining = [...candidates];
  let cursor: Point = { u: eyeOuter.u - 0.01, v: cheekTop };
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (
        Math.hypot(remaining[i].u - cursor.u, remaining[i].v - cursor.v) <
        Math.hypot(remaining[best].u - cursor.u, remaining[best].v - cursor.v)
      ) {
        best = i;
      }
    }
    cursor = remaining.splice(best, 1)[0];
    ordered.push(cursor);
  }
  const edges: [number, number][] = [];
  for (let i = 1; i < ordered.length; i++) edges.push([i - 1, i]);
  // A few cross-links close the chain into facets.
  for (let i = 2; i < ordered.length; i++) {
    const gap = Math.hypot(ordered[i].u - ordered[i - 2].u, ordered[i].v - ordered[i - 2].v);
    if (gap < 0.085 && random() < 0.6) edges.push([i, i - 2]);
  }
  const constellation: Constellation = {
    points: ordered.map(onConstellationSide),
    edges,
    startAt: 0,
  };

  // ── Circuit traces from the temple along the jaw ──
  const inset = (v: number, amount: number): Point => ({ u: jawU(v) - amount, v });
  const templeV = landmarks[26].v + 0.02;
  const outerWaypoints = [
    { u: jawU(templeV) - 0.05, v: templeV + jitter(0.01) },
    inset(faceV(0.96) + jitter(0.012), 0.045),
    inset(faceV(0.78) + jitter(0.012), 0.04),
    inset(faceV(0.61) + jitter(0.012), 0.042),
    inset(faceV(0.43) + jitter(0.012), 0.045),
    inset(faceV(0.28) + jitter(0.01), 0.05),
    inset(faceV(0.15) + jitter(0.008), 0.055),
    { u: landmarks[9].u + 0.015, v: landmarks[9].v + 0.04 },
  ];
  const innerWaypoints = [
    { u: jawU(templeV) - 0.09, v: templeV - 0.02 },
    inset(faceV(0.92) + jitter(0.01), 0.085),
    inset(faceV(0.74) + jitter(0.01), 0.08),
    inset(faceV(0.58) + jitter(0.01), 0.1),
  ];
  const stubFrom = inset(faceV(0.61), 0.042);
  const stubWaypoints = [
    stubFrom,
    { u: stubFrom.u - 0.03, v: stubFrom.v - 0.03 },
    { u: stubFrom.u - 0.07, v: stubFrom.v - 0.03 },
  ];
  const traces = [
    makeTrace(outerWaypoints.map(onTraceSide), 1.6, 7.5, "cyan", random()),
    makeTrace(innerWaypoints.map(onTraceSide), 4.5, 4, "magenta", random()),
    makeTrace(stubWaypoints.map(onTraceSide), 6.2, 1.6, "cyan", random()),
  ];

  // ── Hex and katakana columns parallel to the edge of the face ──
  const columns: Column[] = [];
  const addColumn = (
    rowPoint: (row: number) => Point,
    rowCount: number,
    startAt: number,
    color: GlyphColor,
    size: number
  ) => {
    const rows = [];
    for (let row = 0; row < rowCount; row++) {
      const here = onTraceSide(rowPoint(row));
      const next = onTraceSide(rowPoint(row + 1));
      // Lean each glyph so the column follows the contour it runs along.
      const angle = Math.atan2(next.u - here.u, -(next.v - here.v));
      rows.push({ u: here.u, v: here.v, angle });
    }
    columns.push({
      rows,
      startAt,
      alphabet: random() < 0.5 ? HEX : KATAKANA,
      color,
      size,
      seed: Math.floor(random() * 100000),
    });
  };
  const rowStep = 0.027;
  // Down the cheek, inside the traces.
  [0.135, 0.17, 0.205].forEach((offset, index) => {
    const top = faceV(0.62) - index * 0.03 + jitter(0.012);
    addColumn(
      row => {
        const v = top - row * rowStep;
        return { u: jawU(v) - offset, v };
      },
      6 + Math.floor(random() * 2) - index,
      3.5 + index * 3.2 + random(),
      index === 1 ? "magenta" : "cyan",
      0.023
    );
  });
  // Short columns on the forehead.
  const browTop = landmarks[24].v;
  [0, 1].forEach(index => {
    const u = 0.56 + index * 0.05 + jitter(0.012);
    addColumn(
      row => ({ u, v: browTop + 0.115 - row * rowStep }),
      4 + Math.floor(random() * 2),
      14 + index * 3.5 + random(),
      "amber",
      0.021
    );
  });

  // ── Sparks under the eye ──
  const sparks: Spark[] = [];
  const lowerLid = { u: (landmarks[46].u + landmarks[47].u) / 2, v: landmarks[46].v };
  const sparkCount = 4 + Math.floor(random() * 3);
  for (let i = 0; i < sparkCount; i++) {
    const t = i / (sparkCount - 1) - 0.5;
    sparks.push({
      ...onConstellationSide({
        u: lowerLid.u + t * 0.085,
        v: lowerLid.v - 0.022 - (0.25 - t * t) * 0.03,
      }),
      at: 0.5 + i * 0.35 + random() * 0.2,
      color: i % 2 ? "cyan" : "magenta",
      radius: 0.0028 + random() * 0.0015,
    });
  }

  return { constellation, traces, columns, sparks };
}

function emptyFrame(): GlyphFrame {
  return {
    lines: [],
    dots: [],
    chars: [],
    scanV: -1,
    dissolve: 0,
    gain: 1,
    density: 0,
  };
}

export function createGlyphField(
  landmarks: Landmark[],
  random: () => number = Math.random,
  options: GlyphOptions = {}
): GlyphField {
  let layout: GlyphLayout | null = null;
  let state: FaceState = "idle";
  let time = 0;
  let clock = 0;
  let dissolve = 0;
  let dissolving = false;
  let kick = 0;
  let scanStartedAt = -Infinity;
  let nextScanAt = Infinity;
  let wasPinned = false;

  const compose = (density: number): GlyphFrame => {
    const frame = emptyFrame();
    if (!layout) return frame;

    // Constellation.
    const { points, edges } = layout.constellation;
    const constellationAge = density - layout.constellation.startAt;
    points.forEach((point, index) => {
      const age = constellationAge - index * POINT_INTERVAL_SEC;
      if (age < 0) return;
      // Each point sparks on, then settles.
      const flash = Math.exp(-age * 5);
      frame.dots.push({
        u: point.u,
        v: point.v,
        radius: 0.0034 + flash * (index === 0 ? 0.012 : 0.006),
        color: index % 3 === 2 ? "cyan" : "magenta",
        alpha: 0.85 + 0.15 * flash,
      });
    });
    edges.forEach(([from, to], index) => {
      // Chain edges follow their end point; cross-links come afterwards.
      const isChain = index < points.length - 1;
      const startsAt = isChain
        ? Math.max(from, to) * POINT_INTERVAL_SEC - EDGE_GROW_SEC
        : (points.length - 1) * POINT_INTERVAL_SEC + (index - points.length + 2) * 0.5;
      const grown = clamp01((constellationAge - startsAt) / EDGE_GROW_SEC);
      if (grown <= 0) return;
      const a = points[from];
      const b = points[to];
      frame.lines.push({
        points: [a.u, a.v, a.u + (b.u - a.u) * grown, a.v + (b.v - a.v) * grown],
        color: "magenta",
        alpha: isChain ? 0.8 : 0.5,
        width: CONSTELLATION_WIDTH,
      });
    });

    // Traces.
    for (const trace of layout.traces) {
      const grown = clamp01((density - trace.startAt) / trace.growSec);
      if (grown <= 0) continue;
      const linePoints: number[] = [];
      for (let i = 0; i < trace.points.length; i++) {
        if (trace.along[i] <= grown) {
          linePoints.push(trace.points[i].u, trace.points[i].v);
          // Solder points at the bends.
          if (i > 0 && i < trace.points.length - 1) {
            frame.dots.push({
              u: trace.points[i].u,
              v: trace.points[i].v,
              radius: 0.0032,
              color: trace.color,
              alpha: 0.7,
            });
          }
        } else {
          const tip = pointAlong(trace, grown);
          linePoints.push(tip.u, tip.v);
          break;
        }
      }
      frame.lines.push({ points: linePoints, color: trace.color, alpha: 0.75, width: 1.8 });

      const tip = pointAlong(trace, grown);
      frame.dots.push({
        u: tip.u,
        v: tip.v,
        radius: grown < 1 ? 0.006 : 0.0045,
        color: trace.color,
        alpha: 1,
      });

      // Travelling pulses: one that loops, plus one per recent chunk.
      const loop = (time / IDLE_PULSE_PERIOD_SEC + trace.phase) % 1;
      for (const position of [loop, ...trace.chunkPulses]) {
        if (position > grown || position < 0) continue;
        const head = pointAlong(trace, position);
        const tail = pointAlong(trace, Math.max(0, position - 0.05));
        frame.lines.push({
          points: [tail.u, tail.v, head.u, head.v],
          color: "amber",
          alpha: 0.9,
          width: 3.4,
        });
        frame.dots.push({ u: head.u, v: head.v, radius: 0.0055, color: "amber", alpha: 1 });
      }
    }

    // Columns.
    layout.columns.forEach(column => {
      const shown = Math.floor((density - column.startAt) / CHAR_INTERVAL_SEC) + 1;
      for (let row = 0; row < column.rows.length && row < shown; row++) {
        // Each glyph flips to another now and then, at its own pace.
        const rate = 0.5 + hash(column.seed, row, 1) * 2.2;
        const tick = Math.floor(time * rate + hash(column.seed, row, 2) * 10);
        const index = Math.floor(hash(column.seed, row, tick) * column.alphabet.length);
        const isHead = row === Math.min(shown, column.rows.length) - 1;
        frame.chars.push({
          u: column.rows[row].u,
          v: column.rows[row].v,
          char: column.alphabet[index % column.alphabet.length],
          size: column.size,
          angle: column.rows[row].angle,
          color: column.color,
          alpha: isHead ? 1 : 0.5 + 0.3 * hash(column.seed, row, tick + 7),
        });
      }
    });

    // Sparks.
    for (const spark of layout.sparks) {
      const age = density - spark.at;
      if (age < 0) continue;
      frame.dots.push({
        u: spark.u,
        v: spark.v,
        radius: spark.radius * (1 + 2 * Math.exp(-age * 6)),
        color: spark.color,
        alpha: 0.9,
      });
    }

    return frame;
  };

  const step = (dtSec: number, input: GlyphInput): GlyphFrame => {
    const dt = Math.max(0, Math.min(0.1, dtSec));
    time += dt;

    if (input.state !== state) {
      const previous = state;
      state = input.state;
      if (state === "submit" || (previous === "idle" && state !== "done")) {
        layout = buildGlyphLayout(landmarks, random, options);
        clock = 0;
        dissolve = 0;
        dissolving = false;
        nextScanAt = time + 2.5 + random() * 4;
        scanStartedAt = -Infinity;
      } else if (state === "done" || state === "idle") {
        dissolving = true;
      }
    }
    if (input.intensity !== null && !layout) layout = buildGlyphLayout(landmarks, random, options);

    const running = state === "submit" || state === "waiting" || state === "streaming";
    // A pinned intensity keeps the glyphs up regardless of the lifecycle.
    const pinned = input.intensity !== null;
    if (pinned) {
      // Carry the pinned density on the clock, so that releasing it picks
      // up from what is showing.
      clock = clamp01(input.intensity as number) * FULL_DENSITY_SEC;
    } else if (running) {
      clock = Math.min(FULL_DENSITY_SEC, clock + dt);
    } else if (wasPinned && layout && !dissolving) {
      // Released with no query in flight: let them go.
      dissolving = true;
    }
    wasPinned = pinned;
    const density = clock;

    // Chunks send a pulse down each trace and lift the brightness briefly.
    if (layout) {
      for (const trace of layout.traces) {
        trace.chunkPulses = trace.chunkPulses
          .map(position => position + dt / 0.9)
          .filter(position => position <= 1);
      }
      if (input.chunks > 0) {
        kick = Math.min(1, kick + 0.5);
        for (const trace of layout.traces) {
          const newest = trace.chunkPulses[trace.chunkPulses.length - 1];
          // Keep pulses apart so a burst of chunks reads as a stream.
          if (
            trace.chunkPulses.length < MAX_CHUNK_PULSES &&
            (newest === undefined || newest > 0.12)
          ) {
            trace.chunkPulses.push(0);
          }
        }
      }
    }
    kick *= Math.exp(-dt * 4);

    if (dissolving) dissolve = Math.min(1, dissolve + dt / DISSOLVE_SEC);
    if (pinned) {
      dissolve = 0;
      dissolving = false;
    }
    if (!pinned && dissolve >= 1) {
      layout = null;
      return emptyFrame();
    }

    const frame = compose(density);
    frame.dissolve = dissolve;
    frame.gain = 1 + kick * 0.6;
    frame.density = density;

    if (running || pinned) {
      if (time >= nextScanAt) {
        scanStartedAt = time;
        nextScanAt =
          time +
          SCAN_SWEEP_SEC +
          SCAN_MIN_GAP_SEC +
          random() * (SCAN_MAX_GAP_SEC - SCAN_MIN_GAP_SEC);
      }
      const sweep = (time - scanStartedAt) / SCAN_SWEEP_SEC;
      if (sweep >= 0 && sweep <= 1) {
        frame.scanV = SCAN_TOP_V + (SCAN_BOTTOM_V - SCAN_TOP_V) * sweep;
      }
    }

    return frame;
  };

  return { step };
}

// ─── Canvas rendering ───────────────────────────────────────────

const CORE: Record<GlyphColor, string> = {
  cyan: "#54f0ff",
  magenta: "#ff4fd8",
  amber: "#ffb44a",
};

/** Paints a frame onto a square 2D canvas of `size` pixels. */
export function drawGlyphFrame(
  ctx: CanvasRenderingContext2D,
  size: number,
  frame: GlyphFrame
): void {
  const scale = size / 1024;
  const fade = 1 - frame.dissolve * 0.5;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const line of frame.lines) {
    ctx.strokeStyle = CORE[line.color];
    ctx.beginPath();
    for (let i = 0; i < line.points.length; i += 2) {
      const x = line.points[i] * size;
      const y = (1 - line.points[i + 1]) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // A soft halo under a bright core.
    ctx.globalAlpha = line.alpha * 0.22 * fade;
    ctx.lineWidth = line.width * 3.2 * scale;
    ctx.stroke();
    ctx.globalAlpha = line.alpha * fade;
    ctx.lineWidth = line.width * scale;
    ctx.stroke();
  }

  for (const dot of frame.dots) {
    const x = dot.u * size;
    const y = (1 - dot.v) * size;
    ctx.fillStyle = CORE[dot.color];
    ctx.globalAlpha = dot.alpha * 0.25 * fade;
    ctx.beginPath();
    ctx.arc(x, y, dot.radius * size * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = dot.alpha * fade;
    ctx.beginPath();
    ctx.arc(x, y, dot.radius * size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = 0;
  for (const char of frame.chars) {
    const px = Math.round(char.size * size);
    if (px !== fontSize) {
      fontSize = px;
      ctx.font = `600 ${px}px "DejaVu Sans Mono", "Noto Sans Mono CJK JP", Menlo, Consolas, monospace`;
    }
    ctx.fillStyle = CORE[char.color];
    ctx.globalAlpha = char.alpha * fade;
    ctx.setTransform(1, 0, 0, 1, char.u * size, (1 - char.v) * size);
    ctx.rotate(-char.angle);
    ctx.fillText(char.char, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
