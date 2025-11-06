<template>
  <div
    class="neon-thinking-icon"
    :style="{ width: sizePx, height: sizePx }"
    :aria-busy="active ? 'true' : 'false'"
    role="img"
    :aria-label="active ? 'AI thinking' : 'AI idle'"
  >
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      :class="{ active }"
    >
      <!-- defs: gradients + glow -->
      <defs>
        <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#00fff0" />
          <stop offset="45%" stop-color="#00bcd4" />
          <stop offset="100%" stop-color="#001a33" />
        </radialGradient>

        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff00e6"/>
          <stop offset="50%" stop-color="#00fff0"/>
          <stop offset="100%" stop-color="#7a00ff"/>
        </linearGradient>

        <!-- soft neon glow -->
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <!-- heavy outer glow for accent particles -->
        <filter id="outerGlow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge>
            <feMergeNode in="b"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <!-- path for orbiting particles -->
        <path id="orbitPath" d="M50,10 A40,40 0 1,1 49.99,10" />
      </defs>

      <!-- faint grid backdrop -->
      <g opacity="0.12" v-if="showGrid">
        <path v-for="i in 9" :key="'h'+i" :d="`M10 ${10*i} H 90`" stroke="#00fff0" stroke-width="0.3"/>
        <path v-for="i in 9" :key="'v'+i" :d="`M ${10*i} 10 V 90`" stroke="#7a00ff" stroke-width="0.3"/>
      </g>

      <!-- pulsing core -->
      <circle cx="50" cy="50" r="16" fill="url(#coreGrad)" filter="url(#softGlow)" class="core" />

      <!-- rotating circuit ring -->
      <g class="ring" filter="url(#softGlow)">
        <circle
          cx="50" cy="50" r="30"
          fill="none"
          stroke="url(#ringGrad)"
          stroke-width="2.5"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
          :stroke-dashoffset="dashOffset"
        />
        <g>
          <line v-for="n in 12" :key="'t'+n"
            :x1="50" :y1="18" :x2="50" :y2="22"
            stroke="#00fff0" stroke-width="1.4" opacity="0.9"
            :transform="`rotate(${(360/12)*n},50,50)`"
          />
        </g>
      </g>

      <!-- scanning arcs -->
      <g class="scanner" filter="url(#softGlow)">
        <path d="M80,50 A30,30 0 0,0 20,50" fill="none" stroke="#ff00e6" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
        <path d="M78,50 A28,28 0 0,0 22,50" fill="none" stroke="#00fff0" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>
      </g>

      <!-- orbiting particles -->
      <g class="particles">
        <circle r="2.2" fill="#00fff0" filter="url(#outerGlow)">
          <animateMotion v-if="active" dur="2.8s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
            <mpath xlink:href="#orbitPath" />
          </animateMotion>
        </circle>
        <circle r="1.8" fill="#ff00e6" filter="url(#outerGlow)">
          <animateMotion v-if="active" dur="3.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
            <mpath xlink:href="#orbitPath" />
          </animateMotion>
        </circle>
        <circle r="1.6" fill="#7a00ff" filter="url(#outerGlow)">
          <animateMotion v-if="active" dur="4.2s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
            <mpath xlink:href="#orbitPath" />
          </animateMotion>
        </circle>
      </g>

      <!-- subtle data blips on the core -->
      <g class="blips">
        <circle v-for="(b, i) in 6" :key="i"
          :cx="50 + Math.cos((i/6)*2*Math.PI)*8"
          :cy="50 + Math.sin((i/6)*2*Math.PI)*8"
          r="1.6" fill="#ffffff" opacity="0.0"
        />
      </g>
    </svg>
  </div>
</template>

<script>
import { defineComponent, ref, computed, watch, onUnmounted } from "vue";

export default defineComponent({
  name: "ThinkingIcon",
  props: {
    size: { type: Number, default: 64 },
    active: { type: Boolean, default: false },
    showGrid: { type: Boolean, default: false },
  },
  setup(props) {
    const sizePx = computed(() => props.size + "px");
    const size = computed(() => props.size);

    // Ring dash animation driven by rAF (smooth at tiny sizes)
    const dashArray = ref("40 20");
    const dashOffset = ref(0);

    let rafId = null;
    const speed = ref(0);

    function animateRing(tsNow, tsPrev) {
      if (!props.active) return;
      const now = tsNow;
      const prev = tsPrev ?? now;
      const dt = Math.min(32, now - prev); // clamp
      dashOffset.value = (dashOffset.value + speed.value * dt) % 120;
      rafId = requestAnimationFrame((t) => animateRing(t, now));
    }

    watch(
      () => props.active,
      (on) => {
        if (on) {
          speed.value = 0.08 * (64 / props.size);
          rafId = requestAnimationFrame((t) => animateRing(t));
        } else {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = null;
          dashOffset.value = 0;
        }
      },
      { immediate: true }
    );

    onUnmounted(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    });

    return {
      sizePx,
      size,
      dashArray,
      dashOffset,
    };
  },
});
</script>

<style scoped>
.neon-thinking-icon {
  display: inline-grid;
  place-items: center;
  border-radius: 12px;
  padding: 2px;
}

svg {
  overflow: visible;
  transition: filter 200ms ease, transform 200ms ease, opacity 200ms ease;
  filter: drop-shadow(0 0 4px rgba(0, 255, 240, 0.25));
  opacity: 0.95;
}
svg.active {
  transform: translateZ(0) scale(1.02);
  filter:
    drop-shadow(0 0 6px rgba(0, 255, 240, 0.35))
    drop-shadow(0 0 10px rgba(122, 0, 255, 0.25));
}

/* Core pulse */
.core {
  transform-origin: 50px 50px;
  animation: corePulse 1.4s ease-in-out infinite;
  animation-play-state: paused;
}
svg.active .core { animation-play-state: running; }
@keyframes corePulse {
  0%, 100% { transform: scale(1); opacity: 0.95; }
  50%      { transform: scale(1.12); opacity: 1; }
}

/* Scanner sweep */
.scanner {
  transform-origin: 50px 50px;
  animation: sweep 2.2s ease-in-out infinite;
  animation-play-state: paused;
}
svg.active .scanner { animation-play-state: running; }
@keyframes sweep {
  0%   { transform: rotate(0deg);   opacity: 0.75; }
  50%  { transform: rotate(22deg);  opacity: 1; }
  100% { transform: rotate(0deg);   opacity: 0.75; }
}

/* Ring spin */
.ring {
  transform-origin: 50px 50px;
  animation: ringSpin 6s linear infinite;
  animation-play-state: paused;
}
svg.active .ring { animation-play-state: running; }
@keyframes ringSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Blips */
.blips circle {
  animation: blip 1.2s ease-in-out infinite;
  animation-play-state: paused;
}
svg.active .blips circle { animation-play-state: running; }
.blips circle:nth-child(2) { animation-delay: 0.12s; }
.blips circle:nth-child(3) { animation-delay: 0.24s; }
.blips circle:nth-child(4) { animation-delay: 0.36s; }
.blips circle:nth-child(5) { animation-delay: 0.48s; }
.blips circle:nth-child(6) { animation-delay: 0.60s; }
@keyframes blip {
  0%, 100% { opacity: 0.0; transform: scale(0.8); }
  50%      { opacity: 0.9; transform: scale(1.25); }
}
</style>
