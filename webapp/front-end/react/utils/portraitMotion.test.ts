import { describe, expect, it } from "vitest";
import { createPortraitMotion, MAX_GAZE_PITCH_DEG, MAX_GAZE_YAW_DEG } from "./portraitMotion";

const DT = 1 / 60;

/** Small deterministic PRNG so runs are repeatable. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("createPortraitMotion", () => {
  it("starts with the eyes closed and keeps them closed while idle", () => {
    const motion = createPortraitMotion(seededRandom(1));
    for (let i = 0; i < 600; i++) {
      const pose = motion.step(DT, false);
      expect(pose.lidLeft).toBeGreaterThan(0.99);
      expect(pose.lidRight).toBeGreaterThan(0.99);
      expect(Math.abs(pose.yawDeg)).toBeLessThan(0.01);
      expect(pose.pitchDeg).toBeLessThan(-MAX_GAZE_PITCH_DEG);
    }
  });

  it("opens the eyes shortly after becoming active", () => {
    const motion = createPortraitMotion(seededRandom(2));
    let pose = motion.step(DT, false);
    for (let i = 0; i < 60; i++) pose = motion.step(DT, true);
    expect(pose.lidLeft).toBeLessThan(0.05);
    expect(pose.lidRight).toBeLessThan(0.05);
  });

  it("looks around within a subtle range and blinks while active", () => {
    const motion = createPortraitMotion(seededRandom(3));
    let minYaw = 0;
    let maxYaw = 0;
    let blinked = false;

    for (let i = 0; i < 60 * 60; i++) {
      const pose = motion.step(DT, true);
      minYaw = Math.min(minYaw, pose.yawDeg);
      maxYaw = Math.max(maxYaw, pose.yawDeg);
      expect(Math.abs(pose.yawDeg)).toBeLessThan(MAX_GAZE_YAW_DEG + 2);
      // The first moments are spent lifting the head out of its rest pose.
      if (i > 180) expect(Math.abs(pose.pitchDeg)).toBeLessThan(MAX_GAZE_PITCH_DEG + 2);
      expect(Math.abs(pose.gazeX)).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.gazeY)).toBeLessThanOrEqual(1);
      if (i > 120 && pose.lidLeft > 0.8) blinked = true;
    }

    expect(maxYaw - minYaw).toBeGreaterThan(4);
    expect(blinked).toBe(true);
  });

  it("closes the eyes and returns to rest when activity stops", () => {
    const motion = createPortraitMotion(seededRandom(4));
    for (let i = 0; i < 60 * 10; i++) motion.step(DT, true);
    let pose = motion.step(DT, false);
    for (let i = 0; i < 60 * 6; i++) pose = motion.step(DT, false);

    expect(pose.lidLeft).toBeGreaterThan(0.99);
    expect(Math.abs(pose.yawDeg)).toBeLessThan(0.1);
    expect(pose.pitchDeg).toBeLessThan(-MAX_GAZE_PITCH_DEG);
    expect(Math.abs(pose.gazeX)).toBeLessThan(0.01);
  });

  it("tolerates long frame gaps without overshooting", () => {
    const motion = createPortraitMotion(seededRandom(5));
    for (let i = 0; i < 200; i++) {
      const pose = motion.step(2.5, true);
      expect(Number.isFinite(pose.yawDeg)).toBe(true);
      expect(Math.abs(pose.yawDeg)).toBeLessThan(MAX_GAZE_YAW_DEG + 2);
    }
  });
});
