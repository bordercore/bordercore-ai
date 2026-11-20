import { describe, expect, it } from "vitest";
import {
  buildGlyphLayout,
  CONSTELLATION_WIDTH,
  createGlyphField,
  DISSOLVE_SEC,
  FULL_DENSITY_SEC,
  GlyphFrame,
  GlyphInput,
  Landmark,
} from "./faceGlyphs";

const DT = 1 / 20;

/** Small deterministic PRNG so runs are repeatable. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// The 68 facial landmarks of the baked head model, as glyph-texture u, v.
const LANDMARKS: Landmark[] = (
  [
    [0.146, 0.595],
    [0.153, 0.515],
    [0.175, 0.441],
    [0.205, 0.366],
    [0.259, 0.279],
    [0.338, 0.211],
    [0.398, 0.176],
    [0.454, 0.159],
    [0.499, 0.15],
    [0.543, 0.16],
    [0.599, 0.177],
    [0.659, 0.211],
    [0.739, 0.279],
    [0.794, 0.366],
    [0.825, 0.441],
    [0.847, 0.516],
    [0.855, 0.596],
    [0.292, 0.635],
    [0.339, 0.666],
    [0.385, 0.675],
    [0.429, 0.672],
    [0.465, 0.661],
    [0.535, 0.661],
    [0.571, 0.673],
    [0.615, 0.675],
    [0.662, 0.665],
    [0.709, 0.635],
    [0.5, 0.582],
    [0.5, 0.541],
    [0.5, 0.502],
    [0.5, 0.458],
    [0.465, 0.399],
    [0.483, 0.399],
    [0.499, 0.397],
    [0.515, 0.399],
    [0.534, 0.398],
    [0.336, 0.572],
    [0.371, 0.595],
    [0.41, 0.595],
    [0.441, 0.564],
    [0.413, 0.559],
    [0.37, 0.555],
    [0.56, 0.565],
    [0.59, 0.596],
    [0.629, 0.595],
    [0.664, 0.573],
    [0.63, 0.555],
    [0.588, 0.559],
    [0.429, 0.307],
    [0.453, 0.336],
    [0.48, 0.355],
    [0.499, 0.353],
    [0.519, 0.355],
    [0.545, 0.336],
    [0.569, 0.306],
    [0.548, 0.283],
    [0.526, 0.269],
    [0.499, 0.264],
    [0.471, 0.269],
    [0.45, 0.283],
    [0.437, 0.308],
    [0.474, 0.316],
    [0.499, 0.314],
    [0.524, 0.316],
    [0.561, 0.308],
    [0.527, 0.31],
    [0.499, 0.307],
    [0.471, 0.31],
  ] as [number, number][]
).map(([u, v]) => ({ u, v }));

function elementCount(frame: GlyphFrame): number {
  return frame.lines.length + frame.dots.length + frame.chars.length;
}

function input(state: GlyphInput["state"], overrides: Partial<GlyphInput> = {}): GlyphInput {
  return { state, chunks: 0, intensity: null, ...overrides };
}

/** Steps a field for `seconds`, returning the last frame. */
function run(
  field: ReturnType<typeof createGlyphField>,
  seconds: number,
  state: GlyphInput["state"],
  onFrame?: (frame: GlyphFrame, time: number) => void
): GlyphFrame {
  let frame = field.step(DT, input(state));
  onFrame?.(frame, DT);
  for (let t = 2 * DT; t <= seconds + 1e-9; t += DT) {
    frame = field.step(DT, input(state));
    onFrame?.(frame, t);
  }
  return frame;
}

describe("buildGlyphLayout", () => {
  it("keeps every glyph on the face", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const layout = buildGlyphLayout(LANDMARKS, seededRandom(seed));
      const points = [
        ...layout.constellation.points,
        ...layout.traces.flatMap(trace => trace.points),
        ...layout.columns.flatMap(column => column.rows),
        ...layout.sparks,
      ];
      expect(layout.constellation.points.length).toBeGreaterThanOrEqual(8);
      for (const point of points) {
        // Inside the jaw outline, between the chin and the hairline.
        expect(point.u).toBeGreaterThan(LANDMARKS[0].u - 0.01);
        expect(point.u).toBeLessThan(LANDMARKS[16].u + 0.01);
        expect(point.v).toBeGreaterThan(LANDMARKS[8].v);
        expect(point.v).toBeLessThan(0.83);
      }
    }
  });

  it("puts the constellation on one cheek and varies the side between queries", () => {
    const sides = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      // Spread the seeds out: nearby ones start this generator off alike.
      const random = seededRandom(seed * 987654321);
      const { points } = buildGlyphLayout(LANDMARKS, random).constellation;
      const right = points.every(point => point.u > 0.5);
      const left = points.every(point => point.u < 0.5);
      expect(right || left).toBe(true);
      sides.add(right ? "right" : "left");
      for (const point of points) {
        // Below the eye and above the mouth.
        expect(point.v).toBeLessThan(LANDMARKS[45].v);
        expect(point.v).toBeGreaterThan(LANDMARKS[54].v);
      }
    }
    expect(sides.size).toBe(2);
  });

  it("puts the traces and cheek columns on the other cheek", () => {
    for (const side of ["left", "right"] as const) {
      const layout = buildGlyphLayout(LANDMARKS, seededRandom(5), { constellationSide: side });
      const onLeft = (point: { u: number }) => point.u < 0.5;
      expect(layout.constellation.points.every(onLeft)).toBe(side === "left");
      expect(layout.sparks.every(onLeft)).toBe(side === "left");
      for (const trace of layout.traces) {
        expect(trace.points.every(onLeft)).toBe(side === "right");
      }
      // The first three columns run down the cheek; the rest are on the forehead.
      for (const column of layout.columns.slice(0, 3)) {
        expect(column.rows.every(onLeft)).toBe(side === "right");
      }
    }
  });

  it("runs a trace from the temple down along the jaw", () => {
    const layout = buildGlyphLayout(LANDMARKS, seededRandom(3));
    const jawTrace = layout.traces[0];
    const first = jawTrace.points[0];
    const last = jawTrace.points[jawTrace.points.length - 1];
    expect(first.v).toBeGreaterThan(LANDMARKS[16].v);
    expect(last.v).toBeLessThan(LANDMARKS[12].v);
    expect(jawTrace.along[0]).toBe(0);
    expect(jawTrace.along[jawTrace.along.length - 1]).toBeCloseTo(1, 6);
    // Circuit-style: every segment is horizontal, vertical or diagonal.
    for (let i = 1; i < jawTrace.points.length; i++) {
      const du = Math.abs(jawTrace.points[i].u - jawTrace.points[i - 1].u);
      const dv = Math.abs(jawTrace.points[i].v - jawTrace.points[i - 1].v);
      const straight = du < 0.005 || dv < 0.005;
      const diagonal = Math.abs(du - dv) < 0.005;
      expect(straight || diagonal).toBe(true);
    }
  });
});

describe("createGlyphField", () => {
  it("shows nothing while idle", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(1));
    run(field, 5, "idle", frame => {
      expect(elementCount(frame)).toBe(0);
      expect(frame.scanV).toBe(-1);
    });
  });

  it("sparks the first glyph on at submit", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(2));
    run(field, 1, "idle");
    const first = field.step(DT, input("submit"));
    expect(first.dots.length).toBe(1);
    expect(first.lines.length).toBe(0);
    expect(first.chars.length).toBe(0);

    // It flares, then settles to its resting size.
    const settled = run(field, 0.6, "submit");
    expect(first.dots[0].radius).toBeGreaterThan(settled.dots[0].radius * 2);
  });

  it("grows denser the longer the wait", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(3));
    field.step(DT, input("submit"));
    const counts: number[] = [];
    let lastCount = 0;
    run(field, FULL_DENSITY_SEC + 4, "waiting", (frame, time) => {
      if (Math.abs(time % 5) < DT / 2 || Math.abs((time % 5) - 5) < DT / 2) {
        counts.push(elementCount(frame));
      }
      lastCount = elementCount(frame);
    });
    expect(counts.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < counts.length; i++) {
      // Pulses come and go, so allow a little slack around the trend.
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] - 6);
    }
    expect(counts[1]).toBeGreaterThan(counts[0] + 5);
    // The reported density is the time spent waiting, up to its ceiling.
    const full = field.step(DT, input("waiting"));
    expect(full.density).toBeCloseTo(FULL_DENSITY_SEC, 5);
    expect(lastCount).toBeGreaterThan(counts[0] * 2);
    expect(lastCount).toBeGreaterThan(60);
  });

  it("joins the constellation one point at a time", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(4));
    field.step(DT, input("submit"));
    let previous = 0;
    const increases: number[] = [];
    run(field, 5, "waiting", frame => {
      const edges = frame.lines.filter(
        line => line.color === "magenta" && line.width === CONSTELLATION_WIDTH
      );
      if (edges.length > previous) increases.push(edges.length - previous);
      previous = edges.length;
    });
    expect(increases.length).toBeGreaterThanOrEqual(4);
    for (const step of increases) expect(step).toBe(1);
  });

  it("keeps every drawn element inside the texture", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(5));
    field.step(DT, input("submit"));
    run(field, FULL_DENSITY_SEC + 2, "waiting", frame => {
      for (const line of frame.lines) {
        for (const value of line.points) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
      for (const dot of frame.dots) {
        expect(dot.u).toBeGreaterThan(0);
        expect(dot.u).toBeLessThan(1);
        expect(dot.v).toBeGreaterThan(0);
        expect(dot.v).toBeLessThan(1);
      }
      for (const char of frame.chars) {
        expect(char.char.length).toBe(1);
        expect(char.alpha).toBeGreaterThan(0);
        expect(char.alpha).toBeLessThanOrEqual(1);
      }
    });
  });

  it("sweeps a scan line down the face now and then", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(6));
    field.step(DT, input("submit"));
    const sweeps: number[][] = [];
    let current: number[] | null = null;
    run(field, 60, "waiting", frame => {
      if (frame.scanV >= 0) {
        if (!current) {
          current = [];
          sweeps.push(current);
        }
        current.push(frame.scanV);
      } else {
        current = null;
      }
    });
    expect(sweeps.length).toBeGreaterThanOrEqual(3);
    expect(sweeps.length).toBeLessThanOrEqual(9);
    for (const sweep of sweeps) {
      // Each one travels from the forehead to the chin.
      expect(sweep[0]).toBeGreaterThan(0.8);
      expect(sweep[sweep.length - 1]).toBeLessThan(0.2);
      for (let i = 1; i < sweep.length; i++) expect(sweep[i]).toBeLessThan(sweep[i - 1]);
    }
  });

  it("sends a pulse down the traces for each chunk and brightens briefly", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(7));
    field.step(DT, input("submit"));
    const before = run(field, 15, "waiting");
    const pulsesBefore = before.lines.filter(line => line.color === "amber").length;
    expect(before.gain).toBeCloseTo(1, 2);

    const kicked = field.step(DT, input("streaming", { chunks: 1 }));
    const after = field.step(DT, input("streaming"));
    expect(kicked.gain).toBeGreaterThan(1.15);
    expect(after.lines.filter(line => line.color === "amber").length).toBeGreaterThan(pulsesBefore);

    // The extra pulses run off the end and the brightness settles.
    const later = run(field, 2, "streaming");
    expect(later.gain).toBeLessThan(1.02);
    expect(later.lines.filter(line => line.color === "amber").length).toBeLessThanOrEqual(
      pulsesBefore + 1
    );
  });

  it("dissolves when the query ends", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(8));
    field.step(DT, input("submit"));
    const dense = run(field, 20, "waiting");

    // The glyphs that were showing stay up while they dissolve.
    const first = field.step(DT, input("done"));
    expect(elementCount(first)).toBe(elementCount(dense));
    expect(first.dissolve).toBeGreaterThan(0);

    let previous = first.dissolve;
    const last = run(field, DISSOLVE_SEC + 0.3, "done", frame => {
      if (elementCount(frame) > 0) expect(frame.dissolve).toBeGreaterThanOrEqual(previous);
      previous = frame.dissolve;
    });
    expect(elementCount(last)).toBe(0);
    expect(elementCount(run(field, 2, "idle"))).toBe(0);
  });

  it("lays out fresh glyphs for the next query", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(9));
    const firstDot = (frame: GlyphFrame) => `${frame.dots[0].u},${frame.dots[0].v}`;
    const starts = new Set<string>();
    for (let query = 0; query < 6; query++) {
      starts.add(firstDot(field.step(DT, input("submit"))));
      run(field, 3, "waiting");
      run(field, DISSOLVE_SEC + 0.5, "done");
      run(field, 1, "idle");
    }
    expect(starts.size).toBeGreaterThan(3);
  });

  it("follows a fixed intensity instead of the clock", () => {
    const field = createGlyphField(LANDMARKS, seededRandom(10));
    const at = (intensity: number) => elementCount(field.step(DT, input("idle", { intensity })));
    const none = at(0);
    const half = at(0.5);
    const full = at(1);
    // At zero only the first spark is up.
    expect(none).toBeLessThanOrEqual(2);
    expect(half).toBeGreaterThan(none + 20);
    expect(full).toBeGreaterThan(half);

    // Released while idle, the glyphs that were showing dissolve away.
    const released = field.step(DT, input("idle"));
    expect(elementCount(released)).toBe(full);
    expect(released.dissolve).toBeGreaterThan(0);
    expect(elementCount(run(field, DISSOLVE_SEC + 2, "idle"))).toBe(0);
  });
});
