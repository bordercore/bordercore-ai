import { describe, expect, it } from "vitest";
import {
  blinkEnvelope,
  BLINK_MAX_INTERVAL_SEC,
  createFaceLifecycle,
  createFaceMotion,
  DONE_HOLD_SEC,
  FacePose,
  FaceState,
  HEAD_NOISE_PITCH_DEG,
  HEAD_NOISE_ROLL_DEG,
  HEAD_NOISE_YAW_DEG,
  MAX_GAZE_PITCH_DEG,
  MAX_GAZE_YAW_DEG,
  SUBMIT_HOLD_SEC,
} from "./faceMotion";

const DT = 1 / 60;

/** Small deterministic PRNG so runs are repeatable. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Where she is looking relative to the viewer: head turn plus eye turn. */
function gazeYaw(pose: FacePose): number {
  return pose.headYawDeg + pose.eyeYawDeg;
}

function gazePitch(pose: FacePose): number {
  return pose.headPitchDeg + pose.eyePitchDeg;
}

describe("createFaceLifecycle", () => {
  it("walks through submit, waiting, streaming and done", () => {
    const lifecycle = createFaceLifecycle();
    expect(lifecycle.step(DT, false).state).toBe("idle");

    const submitted = lifecycle.step(DT, true);
    expect(submitted.state).toBe("submit");
    expect(submitted.entered).toBe(true);
    expect(lifecycle.step(DT, true).entered).toBe(false);

    let snapshot = submitted;
    for (let t = 0; t < SUBMIT_HOLD_SEC + 0.1; t += DT) snapshot = lifecycle.step(DT, true);
    expect(snapshot.state).toBe("waiting");

    lifecycle.notifyChunk(20);
    snapshot = lifecycle.step(DT, true);
    expect(snapshot.state).toBe("streaming");
    expect(snapshot.chunks).toBe(1);
    expect(lifecycle.step(DT, true).chunks).toBe(0);

    snapshot = lifecycle.step(DT, false);
    expect(snapshot.state).toBe("done");
    for (let t = 0; t < DONE_HOLD_SEC + 0.1; t += DT) snapshot = lifecycle.step(DT, false);
    expect(snapshot.state).toBe("idle");
  });

  it("starts streaming straight away if text arrives during the submit beat", () => {
    const lifecycle = createFaceLifecycle();
    lifecycle.step(DT, true);
    lifecycle.notifyChunk(5);
    expect(lifecycle.step(DT, true).state).toBe("streaming");
  });

  it("falls back to waiting when the stream stalls", () => {
    const lifecycle = createFaceLifecycle();
    lifecycle.step(DT, true);
    lifecycle.notifyChunk(10);
    let snapshot = lifecycle.step(DT, true);
    for (let t = 0; t < 3; t += DT) snapshot = lifecycle.step(DT, true);
    expect(snapshot.state).toBe("waiting");
    expect(snapshot.speak).toBe(0);
  });

  it("moves the lips more the faster the text arrives", () => {
    const speakAt = (charsPerSecond: number) => {
      const lifecycle = createFaceLifecycle();
      let snapshot = lifecycle.step(DT, true);
      for (let i = 0; i < 180; i++) {
        // One chunk every sixth of a second.
        if (i % 10 === 0) lifecycle.notifyChunk(charsPerSecond / 6);
        snapshot = lifecycle.step(DT, true);
      }
      return snapshot;
    };
    const slow = speakAt(15);
    const fast = speakAt(150);
    expect(slow.speak).toBeGreaterThan(0.05);
    expect(fast.speak).toBeGreaterThan(slow.speak + 0.3);
    expect(fast.speak).toBeLessThanOrEqual(1);
    // The smoothed rate lands near the true rate.
    expect(fast.tokenRate).toBeGreaterThan(100);
    expect(fast.tokenRate).toBeLessThan(200);
  });

  it("counts the time since submit and freezes it once the query ends", () => {
    const lifecycle = createFaceLifecycle();
    let snapshot = lifecycle.step(DT, true);
    for (let i = 0; i < 300; i++) snapshot = lifecycle.step(DT, true);
    expect(snapshot.queryTime).toBeCloseTo(301 * DT, 3);
    const frozen = lifecycle.step(DT, false).queryTime;
    for (let i = 0; i < 60; i++) snapshot = lifecycle.step(DT, false);
    expect(snapshot.queryTime).toBe(frozen);

    // A new query starts the count again.
    expect(lifecycle.step(DT, true).queryTime).toBeLessThan(0.05);
  });

  it("holds a pinned state until released", () => {
    const lifecycle = createFaceLifecycle();
    lifecycle.setState("streaming");
    let snapshot = lifecycle.step(DT, false);
    for (let i = 0; i < 600; i++) snapshot = lifecycle.step(DT, false);
    expect(snapshot.state).toBe("streaming");

    lifecycle.setState(null);
    expect(lifecycle.step(DT, false).state).toBe("done");
  });
});

describe("blinkEnvelope", () => {
  it("closes fast and reopens more slowly", () => {
    const sample = (from: number, to: number) => {
      const values = [];
      for (let t = from; t <= to; t += 0.001) values.push(blinkEnvelope(t));
      return values;
    };
    const all = sample(0, 0.5);
    const firstClosed = all.findIndex(value => value >= 0.999);
    const lastClosed = all.length - 1 - [...all].reverse().findIndex(value => value >= 0.999);
    const reopened = all.findIndex((value, index) => index > lastClosed && value <= 0.001);
    const closingMs = firstClosed;
    const openingMs = reopened - lastClosed;
    expect(closingMs).toBeLessThan(openingMs * 0.6);
    expect(blinkEnvelope(-0.1)).toBe(0);
    expect(blinkEnvelope(1)).toBe(0);
  });
});

describe("createFaceMotion", () => {
  const run = (
    motion: ReturnType<typeof createFaceMotion>,
    seconds: number,
    state: FaceState,
    options: { speak?: number; lookAt?: { yawDeg: number; pitchDeg: number } | null } = {},
    onPose?: (pose: FacePose, time: number) => void
  ): FacePose => {
    let pose = motion.step(DT, {
      state,
      speak: options.speak ?? 0,
      lookAt: options.lookAt ?? null,
    });
    for (let t = DT; t < seconds; t += DT) {
      pose = motion.step(DT, { state, speak: options.speak ?? 0, lookAt: options.lookAt ?? null });
      onPose?.(pose, t);
    }
    return pose;
  };

  it("rests with the eyes closed while idle", () => {
    const motion = createFaceMotion(seededRandom(1));
    run(motion, 5, "idle", {}, pose => {
      expect(pose.lidLeft).toBeGreaterThan(0.99);
      expect(pose.lidRight).toBeGreaterThan(0.99);
      expect(pose.presence).toBeLessThan(0.01);
      expect(pose.mouth.jawOpen).toBe(0);
    });
  });

  it("opens the eyes and looks at the viewer on submit", () => {
    const motion = createFaceMotion(seededRandom(2));
    run(motion, 2, "idle");
    const pose = run(motion, 0.9, "submit");
    expect(pose.lidLeft).toBeLessThan(0.05);
    expect(pose.presence).toBeGreaterThan(0.95);
    expect(pose.browRaise).toBeGreaterThan(0.2);
    expect(Math.abs(gazeYaw(pose))).toBeLessThan(1.5);
    expect(Math.abs(gazePitch(pose))).toBeLessThan(1.5);
  });

  it("lets the gaze drift away while waiting, within its range", () => {
    const motion = createFaceMotion(seededRandom(3));
    run(motion, 1, "submit");
    let farthest = 0;
    let awayFrames = 0;
    let frames = 0;
    run(motion, 60, "waiting", {}, pose => {
      const yaw = gazeYaw(pose);
      farthest = Math.max(farthest, Math.abs(yaw));
      // A blink or two of slack for the eyes catching up with the head.
      expect(Math.abs(yaw)).toBeLessThan(MAX_GAZE_YAW_DEG + 3);
      expect(Math.abs(gazePitch(pose))).toBeLessThan(MAX_GAZE_PITCH_DEG + 3);
      frames++;
      if (Math.abs(yaw) > 5) awayFrames++;
    });
    expect(farthest).toBeGreaterThan(10);
    // Most of the wait is spent looking somewhere else.
    expect(awayFrames / frames).toBeGreaterThan(0.5);
  });

  it("addresses the viewer more while the answer streams", () => {
    const awayShare = (state: FaceState) => {
      const motion = createFaceMotion(seededRandom(4));
      run(motion, 1, "submit");
      let away = 0;
      let frames = 0;
      run(motion, 120, state, { speak: state === "streaming" ? 0.6 : 0 }, pose => {
        frames++;
        if (Math.abs(gazeYaw(pose)) > 5) away++;
      });
      return away / frames;
    };
    expect(awayShare("streaming")).toBeLessThan(awayShare("waiting") - 0.15);
  });

  it("leads with the eyes and lets the head follow", () => {
    const motion = createFaceMotion(seededRandom(5));
    run(motion, 1, "submit");
    const before = run(motion, 3, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } });

    const target = { yawDeg: 20, pitchDeg: 0 };
    const early = run(motion, 0.15, "waiting", { lookAt: target });
    const headMoveEarly = early.headYawDeg - before.headYawDeg;
    const eyeMoveEarly = early.eyeYawDeg - before.eyeYawDeg;
    // The eyes have nearly arrived; the head has barely started.
    expect(eyeMoveEarly).toBeGreaterThan(12);
    expect(headMoveEarly).toBeLessThan(3);

    const late = run(motion, 3, "waiting", { lookAt: target });
    // The head has taken up part of the turn and the eyes have eased back.
    expect(late.headYawDeg - before.headYawDeg).toBeGreaterThan(2);
    expect(late.eyeYawDeg).toBeLessThan(early.eyeYawDeg - 2);
    expect(gazeYaw(late)).toBeCloseTo(20, 0);
  });

  it("keeps the head moving by only a few degrees around a held gaze", () => {
    const motion = createFaceMotion(seededRandom(6));
    run(motion, 1, "submit");
    run(motion, 3, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } });
    let minYaw = Infinity;
    let maxYaw = -Infinity;
    let minBob = Infinity;
    let maxBob = -Infinity;
    run(motion, 90, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } }, pose => {
      minYaw = Math.min(minYaw, pose.headYawDeg);
      maxYaw = Math.max(maxYaw, pose.headYawDeg);
      minBob = Math.min(minBob, pose.bobY);
      maxBob = Math.max(maxBob, pose.bobY);
      expect(Math.abs(pose.headYawDeg)).toBeLessThan(HEAD_NOISE_YAW_DEG + 0.5);
      // Pitch also carries the breathing nod.
      expect(Math.abs(pose.headPitchDeg)).toBeLessThan(HEAD_NOISE_PITCH_DEG + 1);
      expect(Math.abs(pose.headRollDeg)).toBeLessThan(HEAD_NOISE_ROLL_DEG + 0.5);
    });
    // It does move, and the breathing bob is there.
    expect(maxYaw - minYaw).toBeGreaterThan(1);
    expect(maxBob - minBob).toBeGreaterThan(0.01);
  });

  it("blinks every two to six seconds, sometimes twice", () => {
    const motion = createFaceMotion(seededRandom(7));
    run(motion, 1, "submit");
    const onsets: number[] = [];
    let wasClosed = false;
    // Hold the gaze so that only the scheduled blinks occur.
    run(motion, 300, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } }, (pose, time) => {
      const closed = pose.lidLeft > 0.6;
      if (closed && !wasClosed) onsets.push(time);
      wasClosed = closed;
      expect(pose.lidLeft).toBe(pose.lidRight);
    });

    const gaps = onsets.slice(1).map((onset, index) => onset - onsets[index]);
    const doubles = gaps.filter(gap => gap < 0.6);
    const singles = gaps.filter(gap => gap >= 0.6);
    expect(doubles.length).toBeGreaterThan(0);
    expect(doubles.length).toBeLessThan(singles.length / 2);
    for (const gap of singles) {
      expect(gap).toBeGreaterThan(1.6);
      expect(gap).toBeLessThan(BLINK_MAX_INTERVAL_SEC + 0.5);
    }
  });

  it("often blinks as the gaze shifts", () => {
    const motion = createFaceMotion(seededRandom(8));
    run(motion, 1, "submit");
    run(motion, 2, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } });

    let previousGaze = 0;
    let shifts = 0;
    let blinksWithShift = 0;
    let sinceShift = Infinity;
    let counted = true;
    run(motion, 400, "waiting", {}, pose => {
      const gaze = gazeYaw(pose);
      // A saccade shows up as the gaze jumping within a frame or two.
      if (Math.abs(gaze - previousGaze) > 1.5 && sinceShift > 0.5) {
        shifts++;
        sinceShift = 0;
        counted = false;
      }
      previousGaze = gaze;
      sinceShift += DT;
      if (!counted && sinceShift < 0.25 && pose.lidLeft > 0.6) {
        blinksWithShift++;
        counted = true;
      }
    });
    expect(shifts).toBeGreaterThan(40);
    const share = blinksWithShift / shifts;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.9);
  });

  it("blinks on request", () => {
    const motion = createFaceMotion(seededRandom(9));
    run(motion, 1, "submit");
    const open = run(motion, 0.5, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } });
    expect(open.lidLeft).toBeLessThan(0.05);
    motion.blink();
    let peak = 0;
    run(motion, 0.2, "waiting", { lookAt: { yawDeg: 0, pitchDeg: 0 } }, pose => {
      peak = Math.max(peak, pose.lidLeft);
    });
    expect(peak).toBeGreaterThan(0.95);
  });

  it("parts the lips slightly and mutters now and then while waiting", () => {
    const motion = createFaceMotion(seededRandom(10));
    run(motion, 1, "submit");
    let quietFrames = 0;
    let mutterFrames = 0;
    let frames = 0;
    let peak = 0;
    run(motion, 120, "waiting", {}, pose => {
      const shape = pose.mouth.funnel + pose.mouth.pucker + pose.mouth.press + pose.mouth.stretch;
      frames++;
      if (shape > 0.05) mutterFrames++;
      else quietFrames++;
      peak = Math.max(peak, pose.mouth.jawOpen);
      expect(pose.mouth.jawOpen).toBeGreaterThanOrEqual(0);
      // Subtle: nothing like a spoken syllable.
      expect(pose.mouth.jawOpen).toBeLessThan(0.3);
    });
    expect(peak).toBeGreaterThan(0.05);
    expect(mutterFrames).toBeGreaterThan(0);
    // Short bursts, not constant chatter.
    expect(mutterFrames / frames).toBeLessThan(0.3);
    expect(quietFrames).toBeGreaterThan(mutterFrames);
  });

  it("keeps the mouth at rest when idle movement is switched off", () => {
    const motion = createFaceMotion(seededRandom(10));
    const still = { speak: 0, lookAt: null, idleMouth: false };
    for (let t = 0; t < 1; t += DT) motion.step(DT, { state: "submit", ...still });
    for (const state of ["waiting", "streaming", "done"] as const) {
      for (let t = 0; t < 60; t += DT) {
        const { mouth } = motion.step(DT, { state, ...still });
        for (const value of Object.values(mouth)) expect(value).toBe(0);
      }
    }

    // It can still be made to speak.
    let peak = 0;
    for (let t = 0; t < 3; t += DT) {
      const pose = motion.step(DT, { state: "streaming", ...still, speak: 0.8 });
      peak = Math.max(peak, pose.mouth.jawOpen);
    }
    expect(peak).toBeGreaterThan(0.1);
  });

  it("moves the lips more as the speak amount rises", () => {
    const activity = (speak: number) => {
      const motion = createFaceMotion(seededRandom(11));
      run(motion, 1, "submit");
      let total = 0;
      let previous = 0;
      run(motion, 30, "streaming", { speak }, pose => {
        total += Math.abs(pose.mouth.jawOpen - previous);
        previous = pose.mouth.jawOpen;
      });
      return total;
    };
    const quiet = activity(0.15);
    const lively = activity(1);
    expect(quiet).toBeGreaterThan(0);
    expect(lively).toBeGreaterThan(quiet * 1.5);
  });

  it("returns to eye contact when done, then comes to rest and closes her eyes", () => {
    const motion = createFaceMotion(seededRandom(12));
    run(motion, 1, "submit");
    run(motion, 20, "waiting");

    const done = run(motion, 1.8, "done");
    expect(Math.abs(gazeYaw(done))).toBeLessThan(1.5);
    expect(Math.abs(gazePitch(done))).toBeLessThan(1.5);
    expect(done.presence).toBeGreaterThan(0.95);

    const resting = run(motion, 6, "idle");
    expect(resting.presence).toBeLessThan(0.01);
    expect(resting.lidLeft).toBeGreaterThan(0.99);
  });
});
