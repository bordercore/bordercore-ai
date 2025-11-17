<!-- ./src/components/Slider.vue -->
<script setup>
    import { computed, ref, watch } from "vue";

    const props = defineProps({
        min: {
            type: Number,
            default: 0,
        },
        max: {
            type: Number,
            default: 100,
        },
        step: {
            type: Number,
            default: 1,
        },
        modelValue: {
            type: Number,
            default: 1,
        },
        showInput: {
            type: Boolean,
            default: true,
        },
    });

    const emit = defineEmits(["update:modelValue"]);

    /**
     * rawSliderValue
     *   = the actual thumb position (continuous, smooth).
     * snappedValue
     *   = the discrete value exposed to the outside world.
     */
    const rawSliderValue = ref(props.modelValue ?? props.min);

    const stepDecimals = computed(() => {
        const step = props.step || 1;
        const stepStr = String(step);
        const dotIndex = stepStr.indexOf(".");
        return dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1;
    });

    function roundToStepPrecision(value) {
        const decimals = stepDecimals.value;
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
    }

    const snappedValue = computed(() => {
        const min = props.min;
        const max = props.max;
        const step = props.step || 1;

        const raw = rawSliderValue.value ?? min;
        const clampedRaw = Math.min(max, Math.max(min, raw));

        const stepsFromMin = Math.round((clampedRaw - min) / step);
        const snapped = min + stepsFromMin * step;

        // Re-clamp and round to avoid 1.7000000000000002
        const clampedSnapped = Math.min(max, Math.max(min, snapped));
        return roundToStepPrecision(clampedSnapped);
    });

    // Keep local state in sync when parent changes v-model
    watch(
        () => props.modelValue,
        (value) => {
            const fallback = props.min;
            const next = value ?? fallback;

            // Only update if we're out of sync to avoid loops
            if (next !== snappedValue.value) {
                rawSliderValue.value = next;
            }
        }
    );

    // Emit discrete value whenever snappedValue changes
    watch(
        snappedValue,
        (value) => {
            emit("update:modelValue", value);
        }
    );

    // Map current slider position (continuous) to 0-100 for the CSS --val variable
    const sliderValPercent = computed(() => {
        const range = props.max - props.min;
        if (!range) {
            return 0;
        }

        const raw = rawSliderValue.value ?? props.min;
        const clamped = Math.min(props.max, Math.max(props.min, raw));

        return ((clamped - props.min) / range) * 100;
    });

    function onRangeInput(event) {
        rawSliderValue.value = Number(event.target.value);
    }

    function onNumberInput(event) {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) {
            rawSliderValue.value = value;
        }
    }
</script>

<template>
    <div class="custom-slider">
        <input
            ref="slider"
            type="range"
            :min="min"
            :max="max"
            step="any"
            :value="rawSliderValue"
            :style="{ '--val': sliderValPercent }"
            class="slider-glow"
            @input="onRangeInput"
        />

        <input
            v-if="showInput"
            type="number"
            class="slider-value-input input ms-3"
            :min="min"
            :max="max"
            :step="step"
            :value="snappedValue"
            @input="onNumberInput"
        />
        <span v-else class="slider-value ms-2">
            <strong>{{ snappedValue }}</strong>
        </span>
    </div>
</template>

<style scoped>
.custom-slider {
  display: flex;
  align-items: center;
}

.custom-slider {
  display: flex;
  align-items: center;
}

/* Fixed-width span for the value */
.slider-value {
  display: inline-block;
  min-width: 3ch;         /* adjust as needed for your longest value */
  text-align: right;
  font-variant-numeric: tabular-nums; /* keeps digits visually consistent */
}

/* Fixed-width for the numeric input version too */
.slider-value-input {
  width: 3ch;             /* same width as .slider-value for consistency */
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ---------- Glow slider styles wired to --val ---------- */
.slider-glow {
  /* --val is provided by Vue inline style */
  --c: hsl(160deg 80% 50% / calc(0.25 + var(--val) / 125));
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  width: 15rem;
  position: relative;
}

/* Filled glowing portion behind the track */
.slider-glow::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: calc((var(--val) - 1) * 1%);
  min-width: 0.5em;
  height: 100%;
  background: var(--c);
  box-shadow:
    0 0 0.2em 0 hsl(0 0% 0%) inset,
    -0.1em 0.1em 0.1em -0.1em hsl(0 0% 100% / 0.5),
    0 0 calc(1em + 0.001em * var(--val))
      calc(0.1em + 0.00025em * var(--val)) var(--c);
  border-radius: 1em 0 0 1em;
  opacity: calc(0.2 + var(--val) * 0.01);
}

/***** Track Styles *****/
/* Chrome, Safari, Opera, Edge Chromium */
.slider-glow::-webkit-slider-runnable-track {
  box-shadow:
    0 0 0.2em 0 hsl(0 0% 0%) inset,
    -0.1em 0.1em 0.1em -0.1em hsl(0 0% 100% / 0.5);
  background:
    linear-gradient(to bottom right, #0001, #0000),
    #343133;
  border-radius: 1em;
  height: 1em;
}

/* Firefox track */
.slider-glow::-moz-range-track {
  box-shadow:
    0 0 2px 0 hsl(0 0% 0%) inset,
    -1px 1px 1px -1px hsl(0 0% 100% / 0.5);
  background:
    linear-gradient(var(--c) 0 0) 0 0 / calc(var(--val) * 1%) 100% no-repeat,
    linear-gradient(to bottom right, #0001, #0000),
    #343133;
  border-radius: 1em;
  height: 1em;
}

/* Chrome, Safari, Opera, Edge Chromium */
.slider-glow::-webkit-slider-thumb {
  --d: rgb(from var(--c) r g b / calc(0.35 * var(--val) * 1%));
  -webkit-appearance: none;
  appearance: none;
  transform: translateY(calc(-50% + 0.5em));
  width: 2em;
  aspect-ratio: 1;
  border-radius: 50%;

  /* Make the thumb more understated */
  background:
    radial-gradient(#0000 40%, #343133 41%, #545153 55%),
    #545153;

  /* Only keep subtle internal shading, no external glow */
  box-shadow:
    inset -0.15em -0.15em 0.2em #0008,
    inset 0.15em 0.15em 0.2em #ffffff22;
}

/* Firefox thumb */
.slider-glow::-moz-range-thumb {
  border: none;
  -webkit-appearance: none;
  appearance: none;
  width: 2em;
  height: 2em;
  aspect-ratio: 1;
  border-radius: 50%;

  background:
    radial-gradient(#0000 40%, #343133 41%, #545153 55%),
    #545153;

  box-shadow:
    inset -0.15em -0.15em 0.2em #0008,
    inset 0.15em 0.15em 0.2em #ffffff22;
}
</style>
