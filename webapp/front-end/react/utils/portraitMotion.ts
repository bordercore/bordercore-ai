/**
 * Motion model for the Cyber Portrait visualization.
 *
 * While active the face behaves like someone idly looking around: the eyes
 * dart to a new point of interest first, the head follows on a damped
 * spring, the gaze holds for a few seconds, the lids blink at irregular
 * intervals, and now and then a faint smile comes and goes. While idle the head settles to a slightly bowed rest pose and
 * the eyes stay closed, with only slow breathing left.
 *
 * The model is pure (no DOM, no three.js) and takes its randomness as an
 * argument so it can be stepped deterministically.
 */

export interface PortraitPose {
  /** Head turn, degrees. Positive looks toward the viewer's right. */
  yawDeg: number;
  /** Head nod, degrees. Positive looks up. */
  pitchDeg: number;
  /** Head tilt, degrees. */
  rollDeg: number;
  /** Lagging copy of the yaw that drives hair and earring follow-through. */
  swayYawDeg: number;
  /** Eyelid closure per eye, 0 (open) to 1 (closed). */
  lidLeft: number;
  lidRight: number;
  /** Iris offset within the eye socket, each axis -1 to 1. */
  gazeX: number;
  gazeY: number;
  /** Lift of each mouth corner into a thin smile, 0 (neutral) to 1. */
  smileLeft: number;
  smileRight: number;
  /** How far the parted lips draw together, 0 (neutral) to 1. */
  lipPress: number;
  /** Vertical breathing offset in scene units. */
  floatY: number;
}

export interface PortraitMotion {
  /** Advance the model by `dtSec` seconds and return the current pose. */
  step(dtSec: number, active: boolean): PortraitPose;
}

// Range of the points of interest the gaze wanders between.
export const MAX_GAZE_YAW_DEG = 13;
export const MAX_GAZE_PITCH_DEG = 7;

// Rest pose while idle: head bowed slightly, as if dozing.
const REST_PITCH_DEG = -8;

const HEAD_SPRING_ACTIVE = 3.2; // rad/s, critically damped
const HEAD_SPRING_IDLE = 1.8;
const SWAY_RATE = 2.1;
const EYE_RATE = 16;
const LID_OPEN_RATE = 7;
const LID_CLOSE_RATE = 4.5;

const BLINK_MS = 170;
const BLINK_INTERVAL_SEC = 3.4;
const DOUBLE_BLINK_CHANCE = 0.18;

// A faint smile surfaces now and then, holds briefly, and fades.
// Responses are often over within a few seconds, so the first smile comes
// soon after waking and later ones follow at short intervals.
const SMILE_FIRST_MIN_DELAY_SEC = 1.2;
const SMILE_FIRST_MAX_DELAY_SEC = 3.5;
const SMILE_MIN_GAP_SEC = 3;
const SMILE_MAX_GAP_SEC = 8;
const SMILE_MIN_HOLD_SEC = 1.2;
const SMILE_MAX_HOLD_SEC = 3;
const SMILE_RISE_RATE = 2.4;
const SMILE_FADE_RATE = 1.4;
const BLINK_ON_GAZE_SHIFT_CHANCE = 0.4;

interface Blink {
  startSec: number;
  durationSec: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Frame-rate independent exponential approach. */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Fast close over the first 38% of a blink, slower reopen over the rest. */
function blinkEnvelope(progress: number): number {
  const raw =
    progress < 0.38
      ? Math.sin((progress / 0.38) * Math.PI * 0.5)
      : Math.cos(((progress - 0.38) / 0.62) * Math.PI * 0.5);
  return Math.pow(Math.max(0, raw), 0.85);
}

export function createPortraitMotion(random: () => number = Math.random): PortraitMotion {
  let time = 0;

  let yaw = 0;
  let pitch = REST_PITCH_DEG;
  let yawVel = 0;
  let pitchVel = 0;
  let swayYaw = 0;

  // Point of interest the eyes and head are heading toward.
  let targetYaw = 0;
  let targetPitch = 0;
  let nextGazeShiftAt = 0;

  let gazeX = 0;
  let gazeY = 0;

  let restLid = 1;
  let blinks: Blink[] = [];
  let nextBlinkAt = 0;
  let wasActive = false;

  let smile = 0;
  let smileGoal = 0;
  // One corner leads a little, so the smile is never perfectly even.
  let smileSkew = 0;
  let smileEndsAt = 0;
  let nextSmileAt = 0;

  const scheduleSmile = (minDelay: number, maxDelay: number) => {
    nextSmileAt = time + minDelay + random() * (maxDelay - minDelay);
  };

  const queueBlink = (double: boolean) => {
    const duration = BLINK_MS / 1000;
    if (double) {
      blinks.push({ startSec: time, durationSec: duration * 0.9 });
      blinks.push({ startSec: time + duration * 1.15, durationSec: duration });
    } else {
      blinks.push({ startSec: time, durationSec: duration });
    }
  };

  const scheduleBlink = () => {
    nextBlinkAt = time + Math.max(1.1, BLINK_INTERVAL_SEC + (random() - 0.4) * 2.4);
  };

  const pickGazeTarget = () => {
    const previousYaw = targetYaw;
    const previousPitch = targetPitch;

    if (random() < 0.3) {
      // Come back to roughly facing the viewer.
      targetYaw = (random() - 0.5) * 3;
      targetPitch = (random() - 0.5) * 2;
    } else {
      targetYaw = (random() * 2 - 1) * MAX_GAZE_YAW_DEG;
      targetPitch = (random() * 2 - 1) * MAX_GAZE_PITCH_DEG;
    }

    // Short glances are more common than long stares.
    nextGazeShiftAt = time + 1.4 + random() * random() * 4.5;

    // People tend to blink as they redirect their gaze.
    const shift = Math.hypot(targetYaw - previousYaw, targetPitch - previousPitch);
    if (shift > 6 && random() < BLINK_ON_GAZE_SHIFT_CHANCE) {
      queueBlink(false);
      scheduleBlink();
    }
  };

  const step = (dtSec: number, active: boolean): PortraitPose => {
    const dt = clamp(dtSec, 0, 0.05);
    time += dt;

    if (active && !wasActive) {
      // Waking up: look ahead first, then start wandering.
      targetYaw = 0;
      targetPitch = 0;
      nextGazeShiftAt = time + 0.9 + random() * 0.8;
      scheduleBlink();
      scheduleSmile(SMILE_FIRST_MIN_DELAY_SEC, SMILE_FIRST_MAX_DELAY_SEC);
    }
    if (!active && wasActive) {
      blinks = [];
      smileGoal = 0;
    }
    wasActive = active;

    let goalYaw = 0;
    let goalPitch = REST_PITCH_DEG;
    if (active) {
      if (time >= nextGazeShiftAt) pickGazeTarget();
      // Slow drift so a held gaze never looks frozen.
      goalYaw = targetYaw + Math.sin(time * 0.53) * 0.7 + Math.sin(time * 1.31 + 1.7) * 0.3;
      goalPitch = targetPitch + Math.sin(time * 0.41 + 0.6) * 0.5;
    }

    // Critically damped spring: the head eases in and out of each turn.
    const omega = active ? HEAD_SPRING_ACTIVE : HEAD_SPRING_IDLE;
    yawVel += (omega * omega * (goalYaw - yaw) - 2 * omega * yawVel) * dt;
    pitchVel += (omega * omega * (goalPitch - pitch) - 2 * omega * pitchVel) * dt;
    yaw += yawVel * dt;
    pitch += pitchVel * dt;
    swayYaw = approach(swayYaw, yaw, SWAY_RATE, dt);

    // The eyes reach the target ahead of the head, then recenter as it
    // catches up.
    const eyeGoalX = active ? clamp(yaw / 22 + (goalYaw - yaw) / 9, -1, 1) : 0;
    const eyeGoalY = active ? clamp(-pitch / 18 - (goalPitch - pitch) / 7, -1, 1) : 0;
    gazeX = approach(gazeX, eyeGoalX, EYE_RATE, dt);
    gazeY = approach(gazeY, eyeGoalY, EYE_RATE, dt);

    restLid = approach(restLid, active ? 0 : 1, active ? LID_OPEN_RATE : LID_CLOSE_RATE, dt);

    let blink = 0;
    if (active) {
      if (time >= nextBlinkAt && restLid < 0.1) {
        queueBlink(random() < DOUBLE_BLINK_CHANCE);
        scheduleBlink();
      }
      blinks = blinks.filter(b => time - b.startSec <= b.durationSec);
      for (const b of blinks) {
        const elapsed = time - b.startSec;
        if (elapsed >= 0) blink = Math.max(blink, blinkEnvelope(elapsed / b.durationSec));
      }
    }
    const lid = clamp(Math.max(restLid, blink), 0, 1);

    if (active) {
      if (smileGoal === 0 && time >= nextSmileAt) {
        smileGoal = 0.45 + random() * 0.55;
        smileSkew = (random() * 2 - 1) * 0.3;
        smileEndsAt =
          time + SMILE_MIN_HOLD_SEC + random() * (SMILE_MAX_HOLD_SEC - SMILE_MIN_HOLD_SEC);
      } else if (smileGoal > 0 && time >= smileEndsAt) {
        smileGoal = 0;
        scheduleSmile(SMILE_MIN_GAP_SEC, SMILE_MAX_GAP_SEC);
      }
    }
    smile = approach(smile, smileGoal, smileGoal > smile ? SMILE_RISE_RATE : SMILE_FADE_RATE, dt);

    // The lips draw together with a smile, and shift faintly on their own
    // in between so the mouth is never perfectly still.
    const lipIdle = active ? 0.12 * (1 + Math.sin(time * 0.37 + 2.1) * Math.sin(time * 0.83)) : 0;
    const lipPress = clamp(smile * 0.6 + lipIdle * (1 - restLid), 0, 1);

    const breathRate = active ? 1.4 : 0.9;
    return {
      yawDeg: yaw,
      pitchDeg: pitch,
      rollDeg: yaw * 0.12,
      swayYawDeg: swayYaw,
      lidLeft: lid,
      lidRight: lid,
      gazeX,
      gazeY,
      smileLeft: clamp(smile * (1 + smileSkew), 0, 1),
      smileRight: clamp(smile * (1 - smileSkew), 0, 1),
      lipPress,
      floatY: Math.sin(time * breathRate) * 0.014,
    };
  };

  return { step };
}
