/**
 * Lifecycle and motion model for the projected-face visualizations (Nova,
 * Sable).
 *
 * The lifecycle turns the two signals the chat provides (a response is being
 * generated; a chunk of text just arrived) into the phases the face acts
 * out. The motion model turns the current phase into a pose: eyes that lead
 * and a head that follows, irregular blinks, a few degrees of layered head
 * noise over a breathing bob, and lips that part, mutter silently while she
 * waits, and move with the text as it streams.
 *
 * Both are pure (no DOM, no three.js) and take their randomness as an
 * argument so they can be stepped deterministically.
 */

export type FaceState = "idle" | "submit" | "waiting" | "streaming" | "done";

export const FACE_STATES: FaceState[] = ["idle", "submit", "waiting", "streaming", "done"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Frame-rate independent exponential approach. */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// ─── Lifecycle ──────────────────────────────────────────────────

// How long she holds eye contact after a query is submitted.
export const SUBMIT_HOLD_SEC = 1.1;
// How long the closing beat lasts before she comes to rest.
export const DONE_HOLD_SEC = 2.6;
// A stream that goes quiet for this long counts as waiting again.
const STREAM_STALL_SEC = 2.5;
// Characters per second at which the lips are about two thirds as lively
// as they get.
const SPEAK_RATE_SCALE = 70;
const TOKEN_RATE_WINDOW_SEC = 0.45;

export interface LifecycleSnapshot {
  state: FaceState;
  /** Seconds spent in the current state. */
  stateTime: number;
  /** Seconds since the query was submitted; frozen once it ends. */
  queryTime: number;
  /** Smoothed arrival rate of visible text, characters per second. */
  tokenRate: number;
  /** Lip activity derived from the token rate, 0 to 1. */
  speak: number;
  /** Chunks that arrived since the previous step. */
  chunks: number;
  /** True on the step in which the state changed. */
  entered: boolean;
}

export interface FaceLifecycle {
  /** Advance by `dtSec` seconds. `active` is true while a response is being generated. */
  step(dtSec: number, active: boolean): LifecycleSnapshot;
  /** Report that `chars` characters of visible text just arrived. */
  notifyChunk(chars: number): void;
  /** Pin the state, or pass null to follow `active` again. */
  setState(state: FaceState | null): void;
}

export function createFaceLifecycle(): FaceLifecycle {
  let state: FaceState = "idle";
  let pinned = false;
  let stateTime = 0;
  let queryTime = 0;
  let tokenRate = 0;
  let pendingChars = 0;
  let pendingChunks = 0;
  let sinceChunk = Infinity;
  let wasActive = false;
  let entered = false;

  const enter = (next: FaceState) => {
    if (next === state) return;
    if (next === "submit") queryTime = 0;
    state = next;
    stateTime = 0;
    entered = true;
  };

  const step = (dtSec: number, active: boolean): LifecycleSnapshot => {
    const dt = clamp(dtSec, 0, 0.1);
    stateTime += dt;
    sinceChunk += dt;

    const chunks = pendingChunks;
    const chars = pendingChars;
    pendingChunks = 0;
    pendingChars = 0;
    if (chunks > 0) sinceChunk = 0;

    // Leaky integrator: settles on the arrival rate in characters per second.
    tokenRate = tokenRate * Math.exp(-dt / TOKEN_RATE_WINDOW_SEC) + chars / TOKEN_RATE_WINDOW_SEC;
    if (tokenRate < 0.01) tokenRate = 0;

    if (!pinned) {
      if (active && !wasActive) {
        enter("submit");
      } else if (!active && wasActive) {
        enter("done");
      } else if (active) {
        if (chunks > 0 && state !== "streaming") {
          enter("streaming");
        } else if (state === "submit" && stateTime >= SUBMIT_HOLD_SEC) {
          enter("waiting");
        } else if (state === "streaming" && sinceChunk >= STREAM_STALL_SEC) {
          enter("waiting");
        } else if (state === "idle" || state === "done") {
          // Released from a pinned state mid-response.
          enter("waiting");
        }
      } else if (state === "done" && stateTime >= DONE_HOLD_SEC) {
        enter("idle");
      } else if (state !== "done" && state !== "idle") {
        enter("done");
      }
    }
    wasActive = active;

    if (state !== "idle" && state !== "done") queryTime += dt;

    const snapshot: LifecycleSnapshot = {
      state,
      stateTime,
      queryTime,
      tokenRate,
      speak: state === "streaming" ? 1 - Math.exp(-tokenRate / SPEAK_RATE_SCALE) : 0,
      chunks,
      entered,
    };
    entered = false;
    return snapshot;
  };

  return {
    step,
    notifyChunk(chars: number) {
      pendingChunks += 1;
      pendingChars += Math.max(0, chars);
    },
    setState(next: FaceState | null) {
      pinned = next !== null;
      if (next !== null) enter(next);
    },
  };
}

// ─── Motion ─────────────────────────────────────────────────────

export interface MouthPose {
  jawOpen: number;
  funnel: number;
  pucker: number;
  press: number;
  stretch: number;
  /** Lower lip drawn down, baring a little of the lower teeth. */
  lowerDown: number;
}

export interface FacePose {
  /** Head turn, degrees. Positive turns toward the viewer's right. */
  headYawDeg: number;
  /** Head nod, degrees. Positive looks up. */
  headPitchDeg: number;
  /** Head tilt, degrees. */
  headRollDeg: number;
  /** Lagging copy of the yaw, for hair follow-through. */
  swayYawDeg: number;
  /** Vertical breathing offset, scene units. */
  bobY: number;
  /** Rotation of the eyes within the head, degrees, same sign convention. */
  eyeYawDeg: number;
  eyePitchDeg: number;
  /** Eyelid closure per eye, 0 (open) to 1 (closed). */
  lidLeft: number;
  lidRight: number;
  /** Lift of the brows, 0 (neutral) to 1. */
  browRaise: number;
  mouth: MouthPose;
  /** 0 when she is at rest between queries, 1 when fully present. */
  presence: number;
}

export interface MotionInput {
  state: FaceState;
  /** Lip activity, 0 to 1. */
  speak: number;
  /** Fixed gaze direction in degrees, or null to let her look around. */
  lookAt: { yawDeg: number; pitchDeg: number } | null;
  /**
   * Whether the lips move by themselves while she waits: the slight idle
   * parting and the silent muttering. On unless set to false, which leaves
   * the mouth at rest except while `speak` is above zero.
   */
  idleMouth?: boolean;
}

export interface FaceMotion {
  step(dtSec: number, input: MotionInput): FacePose;
  /** Blink now; `double` adds a second blink straight after. */
  blink(double?: boolean): void;
}

export const BLINK_MIN_INTERVAL_SEC = 2;
export const BLINK_MAX_INTERVAL_SEC = 6;
const BLINK_CLOSE_SEC = 0.07;
const BLINK_HOLD_SEC = 0.03;
const BLINK_OPEN_SEC = 0.17;
const DOUBLE_BLINK_CHANCE = 0.16;
const BLINK_ON_GAZE_SHIFT_CHANCE = 0.6;
const GAZE_SHIFT_BLINK_MIN_DEG = 8;

// How far the gaze wanders from the viewer, degrees.
export const MAX_GAZE_YAW_DEG = 20;
export const MAX_GAZE_PITCH_DEG = 10;
// The share of a gaze shift the head eventually takes up. Kept small: the
// face is a picture wrapped over a head, and holds up for small turns only.
const HEAD_FOLLOW_YAW = 0.26;
const HEAD_FOLLOW_PITCH = 0.22;
// Layered noise amplitude on each head axis, degrees.
export const HEAD_NOISE_YAW_DEG = 1.6;
export const HEAD_NOISE_PITCH_DEG = 1.1;
export const HEAD_NOISE_ROLL_DEG = 0.9;
const HEAD_SPRING = 2.7; // rad/s, critically damped
const EYE_RATE = 22;
const MAX_EYE_YAW_DEG = 30;
const MAX_EYE_PITCH_DEG = 20;
const REST_PITCH_DEG = -3;

const LID_OPEN_RATE = 9;
const LID_CLOSE_RATE = 2.4;
const PRESENCE_RISE_RATE = 5;
const PRESENCE_FALL_RATE = 1.5;
const MOUTH_RATE = 20;

const MUTTER_MIN_GAP_SEC = 3.5;
const MUTTER_MAX_GAP_SEC = 9;
const MUTTER_AMPLITUDE = 0.34;

// Mouth shapes the lips cycle through; each is a rough viseme.
const VISEMES: MouthPose[] = [
  { jawOpen: 0.5, funnel: 0, pucker: 0, press: 0, stretch: 0.1, lowerDown: 0.3 }, // ah
  { jawOpen: 0.18, funnel: 0, pucker: 0, press: 0, stretch: 0.5, lowerDown: 0.15 }, // ee
  { jawOpen: 0.34, funnel: 0.6, pucker: 0, press: 0, stretch: 0, lowerDown: 0.1 }, // oh
  { jawOpen: 0.14, funnel: 0.15, pucker: 0.7, press: 0, stretch: 0, lowerDown: 0 }, // oo
  { jawOpen: 0.02, funnel: 0, pucker: 0, press: 0.6, stretch: 0, lowerDown: 0 }, // mm
  { jawOpen: 0.1, funnel: 0, pucker: 0, press: 0, stretch: 0.3, lowerDown: 0.25 }, // ss
  { jawOpen: 0.26, funnel: 0.2, pucker: 0, press: 0, stretch: 0.2, lowerDown: 0.2 }, // eh
];
const MOUTH_KEYS: (keyof MouthPose)[] = [
  "jawOpen",
  "funnel",
  "pucker",
  "press",
  "stretch",
  "lowerDown",
];

function emptyMouth(): MouthPose {
  return { jawOpen: 0, funnel: 0, pucker: 0, press: 0, stretch: 0, lowerDown: 0 };
}

/** Closure over one blink: quick to shut, a brief hold, slower to reopen. */
export function blinkEnvelope(elapsedSec: number): number {
  if (elapsedSec < 0) return 0;
  if (elapsedSec < BLINK_CLOSE_SEC) {
    const t = elapsedSec / BLINK_CLOSE_SEC;
    return t * t * (3 - 2 * t);
  }
  if (elapsedSec < BLINK_CLOSE_SEC + BLINK_HOLD_SEC) return 1;
  const t = (elapsedSec - BLINK_CLOSE_SEC - BLINK_HOLD_SEC) / BLINK_OPEN_SEC;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

const BLINK_TOTAL_SEC = BLINK_CLOSE_SEC + BLINK_HOLD_SEC + BLINK_OPEN_SEC;

/** Smooth 1-D value noise in -1..1 built from a fixed random table. */
function createNoise(random: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, () => random() * 2 - 1);
  return (x: number) => {
    const cell = Math.floor(x);
    const t = x - cell;
    const a = table[((cell % 64) + 64) % 64];
    const b = table[(((cell + 1) % 64) + 64) % 64];
    return a + (b - a) * t * t * (3 - 2 * t);
  };
}

export function createFaceMotion(random: () => number = Math.random): FaceMotion {
  const noiseYaw = createNoise(random);
  const noisePitch = createNoise(random);
  const noiseRoll = createNoise(random);
  const noiseLips = createNoise(random);

  let time = 0;
  let state: FaceState = "idle";

  // Where she is looking, relative to the viewer.
  let gazeYaw = 0;
  let gazePitch = 0;
  let nextGazeShiftAt = 0;

  let headYaw = 0;
  let headPitch = REST_PITCH_DEG;
  let headYawVel = 0;
  let headPitchVel = 0;
  let swayYaw = 0;

  let eyeYaw = 0;
  let eyePitch = 0;

  let restLid = 1;
  let presence = 0;
  let browRaise = 0;
  let blinkStarts: number[] = [];
  let nextBlinkAt = 0;

  const mouth = emptyMouth();
  const mouthGoal = emptyMouth();
  let syllablesLeft = 0;
  let syllableEndsAt = 0;
  let syllableGain = 0;
  let nextMutterAt = 0;

  const scheduleBlink = () => {
    nextBlinkAt =
      time + BLINK_MIN_INTERVAL_SEC + random() * (BLINK_MAX_INTERVAL_SEC - BLINK_MIN_INTERVAL_SEC);
  };

  const queueBlink = (double: boolean) => {
    blinkStarts.push(time);
    if (double) blinkStarts.push(time + BLINK_TOTAL_SEC + 0.06);
    scheduleBlink();
  };

  const scheduleMutter = () => {
    nextMutterAt = time + MUTTER_MIN_GAP_SEC + random() * (MUTTER_MAX_GAP_SEC - MUTTER_MIN_GAP_SEC);
  };

  const setGaze = (yaw: number, pitch: number, allowBlink: boolean) => {
    const shift = Math.hypot(yaw - gazeYaw, pitch - gazePitch);
    gazeYaw = yaw;
    gazePitch = pitch;
    // People tend to blink as they redirect their gaze.
    if (allowBlink && shift > GAZE_SHIFT_BLINK_MIN_DEG && random() < BLINK_ON_GAZE_SHIFT_CHANCE) {
      queueBlink(false);
    }
  };

  const pickGaze = () => {
    // While waiting she looks away, as if thinking; while the answer
    // streams she mostly addresses the viewer.
    const towardViewerChance = state === "streaming" ? 0.6 : 0.14;
    if (random() < towardViewerChance) {
      setGaze((random() - 0.5) * 4, (random() - 0.5) * 3, true);
      nextGazeShiftAt = time + 1.2 + random() * 2.2;
      return;
    }
    const reach = state === "streaming" ? 0.5 : 1;
    const side = random() < 0.5 ? -1 : 1;
    const yaw = side * (8 + random() * (MAX_GAZE_YAW_DEG - 8)) * reach;
    // Up and away more often than down.
    const pitch = (random() * 1.5 - 0.5) * MAX_GAZE_PITCH_DEG * reach;
    setGaze(yaw, clamp(pitch, -MAX_GAZE_PITCH_DEG, MAX_GAZE_PITCH_DEG), true);
    nextGazeShiftAt = time + 1.5 + random() * random() * 4;
  };

  const startSyllable = (gain: number, minSec: number, maxSec: number) => {
    const viseme = VISEMES[Math.floor(random() * VISEMES.length) % VISEMES.length];
    for (const key of MOUTH_KEYS) mouthGoal[key] = viseme[key] * gain;
    syllableEndsAt = time + minSec + random() * (maxSec - minSec);
  };

  const step = (dtSec: number, input: MotionInput): FacePose => {
    const dt = clamp(dtSec, 0, 0.05);
    time += dt;

    if (input.state !== state) {
      const previous = state;
      state = input.state;
      if (state === "submit") {
        // Wake up looking straight at the viewer.
        setGaze(0, 0, false);
        blinkStarts = [];
        scheduleBlink();
        scheduleMutter();
        nextGazeShiftAt = Infinity;
      } else if (state === "waiting") {
        // Let the eye contact linger a moment before drifting off.
        nextGazeShiftAt = time + (previous === "submit" ? 0.1 : 0.6);
        scheduleMutter();
      } else if (state === "streaming") {
        nextGazeShiftAt = time + 0.4 + random() * 0.6;
        if (previous === "idle") scheduleBlink();
      } else if (state === "done") {
        setGaze(0, 0, true);
        nextGazeShiftAt = Infinity;
        syllablesLeft = 0;
      } else {
        blinkStarts = [];
        syllablesLeft = 0;
      }
    }

    const awake = state !== "idle";

    if (input.lookAt) {
      gazeYaw = clamp(input.lookAt.yawDeg, -45, 45);
      gazePitch = clamp(input.lookAt.pitchDeg, -30, 30);
    } else if ((state === "waiting" || state === "streaming") && time >= nextGazeShiftAt) {
      pickGaze();
    }

    // Head: a share of the gaze shift on a slow spring, under layered noise.
    const goalYaw = awake ? gazeYaw * HEAD_FOLLOW_YAW : 0;
    const goalPitch = awake ? gazePitch * HEAD_FOLLOW_PITCH : REST_PITCH_DEG;
    headYawVel +=
      (HEAD_SPRING * HEAD_SPRING * (goalYaw - headYaw) - 2 * HEAD_SPRING * headYawVel) * dt;
    headPitchVel +=
      (HEAD_SPRING * HEAD_SPRING * (goalPitch - headPitch) - 2 * HEAD_SPRING * headPitchVel) * dt;
    headYaw += headYawVel * dt;
    headPitch += headPitchVel * dt;

    const noiseGain = awake ? 1 : 0.25;
    const yawNoise =
      (noiseYaw(time * 0.23) * 0.7 + noiseYaw(time * 0.71 + 11) * 0.3) * HEAD_NOISE_YAW_DEG;
    const pitchNoise =
      (noisePitch(time * 0.19 + 5) * 0.7 + noisePitch(time * 0.63 + 23) * 0.3) *
      HEAD_NOISE_PITCH_DEG;
    const rollNoise =
      (noiseRoll(time * 0.17 + 9) * 0.75 + noiseRoll(time * 0.52 + 31) * 0.25) *
      HEAD_NOISE_ROLL_DEG;
    const breath = Math.sin(time * (awake ? 1.5 : 1.0));

    const outYaw = headYaw + yawNoise * noiseGain;
    const outPitch = headPitch + pitchNoise * noiseGain + breath * 0.35;
    const outRoll = rollNoise * noiseGain + headYaw * 0.08;
    swayYaw = approach(swayYaw, outYaw, 2.1, dt);

    // Eyes: they reach the target almost at once and counter-rotate as the
    // head catches up, so the gaze stays put while the head moves.
    const eyeGoalYaw = awake ? clamp(gazeYaw - outYaw, -MAX_EYE_YAW_DEG, MAX_EYE_YAW_DEG) : 0;
    const eyeGoalPitch = awake
      ? clamp(gazePitch - outPitch, -MAX_EYE_PITCH_DEG, MAX_EYE_PITCH_DEG)
      : 0;
    eyeYaw = approach(eyeYaw, eyeGoalYaw, EYE_RATE, dt);
    eyePitch = approach(eyePitch, eyeGoalPitch, EYE_RATE, dt);

    // Lids and presence.
    presence = approach(
      presence,
      awake ? 1 : 0,
      awake ? PRESENCE_RISE_RATE : PRESENCE_FALL_RATE,
      dt
    );
    restLid = approach(restLid, awake ? 0 : 1, awake ? LID_OPEN_RATE : LID_CLOSE_RATE, dt);
    browRaise = approach(browRaise, state === "submit" ? 0.5 : state === "done" ? 0.2 : 0, 6, dt);

    let blink = 0;
    if (awake) {
      if (time >= nextBlinkAt && restLid < 0.1) queueBlink(random() < DOUBLE_BLINK_CHANCE);
      blinkStarts = blinkStarts.filter(start => time - start <= BLINK_TOTAL_SEC);
      for (const start of blinkStarts) blink = Math.max(blink, blinkEnvelope(time - start));
    }
    const lid = clamp(Math.max(restLid, blink), 0, 1);

    // Lips.
    const speak = clamp(input.speak, 0, 1);
    if (speak > 0.02) {
      // Speech: one syllable after another, livelier as the text comes faster.
      if (time >= syllableEndsAt) {
        startSyllable(0.25 + 0.45 * speak, 0.09 + 0.1 * (1 - speak), 0.16 + 0.12 * (1 - speak));
      }
      syllablesLeft = 0;
    } else if (syllablesLeft > 0) {
      if (time >= syllableEndsAt) {
        syllablesLeft -= 1;
        if (syllablesLeft > 0) startSyllable(syllableGain, 0.11, 0.2);
      }
    } else {
      // Idle parting that never quite holds still.
      const restless = awake && input.idleMouth !== false;
      const parting = restless ? 0.03 + 0.02 * noiseLips(time * 0.4) : 0;
      for (const key of MOUTH_KEYS) mouthGoal[key] = 0;
      mouthGoal.jawOpen = parting;
      mouthGoal.lowerDown = parting * 0.5;
      if (restless && (state === "waiting" || state === "submit") && time >= nextMutterAt) {
        // A short silent mutter, as if reading under her breath.
        syllablesLeft = 3 + Math.floor(random() * 4);
        syllableGain = MUTTER_AMPLITUDE * (0.7 + random() * 0.6);
        startSyllable(syllableGain, 0.11, 0.2);
        scheduleMutter();
      }
    }
    for (const key of MOUTH_KEYS) mouth[key] = approach(mouth[key], mouthGoal[key], MOUTH_RATE, dt);

    return {
      headYawDeg: outYaw,
      headPitchDeg: outPitch,
      headRollDeg: outRoll,
      swayYawDeg: swayYaw,
      bobY: breath * 0.011,
      eyeYawDeg: eyeYaw,
      eyePitchDeg: eyePitch,
      lidLeft: lid,
      lidRight: lid,
      browRaise,
      mouth: { ...mouth },
      presence,
    };
  };

  return {
    step,
    blink(double = false) {
      queueBlink(double);
    },
  };
}
