<template>
    <section class="grid mt-0" aria-label="Control Panels">

      <!-- Voice Features -->
      <article class="panel" aria-labelledby="voice-title">
        <h3 id="voice-title">VOICE FEATURES</h3>
        <div class="group">
          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- speaker icon -->
              <svg viewBox="0 0 24 24"><path d="M13 4v16l-5-4H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h4l5-4zm6.5 8a3.5 3.5 0 0 0-2.05-3.17l.7-1.87A5.5 5.5 0 0 1 21.5 12a5.5 5.5 0 0 1-3.35 5.03l-.7-1.87A3.5 3.5 0 0 0 19.5 12zm-3-1.8A2 2 0 0 1 17.5 12a2 2 0 0 1-1.05 1.78l-.7-1.86.7-1.72z"/></svg>
            </div>
            <div class="label">
              Text to Speech
                <!-- <div class="muted">Neural voice output</div> -->
            </div>
            <label class="toggle">
              <input type="checkbox" @click="handleToggle('text2speech')" aria-label="Enable Text to Speech">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>
          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- mic icon -->
              <svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm-7-3a1 1 0 1 0-2 0 9 9 0 0 0 8 8v3h2v-3a9 9 0 0 0 8-8 1 1 0 1 0-2 0 7 7 0 0 1-14 0z"/></svg>
            </div>
            <div class="label">
              Speech to Text
                <!-- <div class="muted">Transcribe mic input</div> -->
            </div>
            <label class="toggle">
              <input type="checkbox" @click="handleToggle('speech2text')" aria-label="Enable Speech to Text">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>
          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- VAD icon -->
              <svg viewBox="0 0 24 24"><path d="M3 12h2v6H3v-6Zm4-8h2v14H7V4Zm4 4h2v10h-2V8Zm4 6h2v4h-2v-4Zm4-9h2v13h-2V5Z"/></svg>
            </div>
            <div class="label">
              VAD
                <!-- <div class="muted">Auto start/stop listening</div> -->
            </div>
            <label class="toggle">
              <input @click="handleToggle('vad')" type="checkbox" aria-label="Enable Speech Detection">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>
        </div>
      </article>

      <!-- Reasoning -->
      <article class="panel" aria-labelledby="reason-title">
        <h3 id="reason-title">REASONING</h3>
        <div class="group">
          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- bolt icon -->
              <svg viewBox="0 0 24 24"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
            </div>
            <div class="label">
              Wolfram Alpha
                <!-- <div class="muted">Symbolic math & facts</div> -->
            </div>
            <label class="toggle">
              <input type="checkbox" @click="handleToggle('wolframAlpha')" aria-label="Enable Wolfram Alpha">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>

          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- cog icon -->
              <svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm9 4a7.7 7.7 0 0 0-.08-1l2-1.55-2-3.46-2.42.7a7.9 7.9 0 0 0-1.7-.99l-.36-2.5H9.56l-.36 2.5c-.6.25-1.17.57-1.7.98L5.08 4.0 3.08 7.5 5 9.05A7.7 7.7 0 0 0 4.92 12c0 .34.03.68.08 1L3.08 14.55l2 3.45 2.42-.7c.52.41 1.1.74 1.7.99l.36 2.5h4.88l.36-2.5c.6-.25 1.17-.58 1.7-.99l2.42.7 2-3.45L20.92 13c.05-.32.08-.66.08-1Z"/></svg>
            </div>
            <div class="label">
              Enable Thinking
                <!-- <div class="muted">Deliberative reasoning mode</div> -->
            </div>
            <label class="toggle">
              <input type="checkbox" @click="handleToggle('enableThinking')" aria-label="Enable Thinking">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>
        </div>
      </article>

      <!-- Sensors (spans full width on small screens) -->
      <article class="panel" aria-labelledby="sensor-title">
        <h3 id="sensor-title">SENSORS</h3>
        <div class="group">
          <div class="item">
            <div class="badge" aria-hidden="true">
              <!-- sensor icon -->
              <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9h2a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18Zm0 5a4 4 0 0 0-4 4h2a2 2 0 1 1 2 2v2a4 4 0 0 0 0-8Z"/></svg>
            </div>
            <div class="label">
              Enable Sensor
                <!-- <div class="muted">Device & env. inputs</div> -->
            </div>
            <label class="toggle">
              <input type="checkbox" @click="handleSensor()" aria-label="Enable Sensor">
              <span class="rail"></span><span class="thumb"></span>
            </label>
          </div>
        </div>
      </article>
    </section>

</template>

<script>

    import {emit, watch} from "vue";

    export default {
        name: "Options",
        props: {
            modelValue: {
                type: Object,
                default: () => ({})
            },
            sensorUri: {
                type: String,
                default: "",
            },
        },
        emits: ["update:modelValue", "sensor-data"],
        setup(props, ctx) {
            const connectionStatus = ref(null);
            const enableSensor = ref(false);
            let eventSource;
            const messages = ref([]);

            function closeConnection() {
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                    connectionStatus.value = "";
                }
            };

            function initEventSource() {
                eventSource = new EventSource(props.sensorUri);
                eventSource.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    ctx.emit("sensor-data", data);
                    messages.value.unshift(data); // Add new messages at the start

                    // Optional: Limit number of displayed messages
                    if (messages.value.length > 100) {
                        messages.value.pop();
                    }

                    if (debug.value) {
                        console.log(data);
                    }
                };

                eventSource.onopen = () => {
                    connectionStatus.value = "Connected";
                };

                eventSource.onerror = (error) => {
                    if (eventSource.readyState === EventSource.CLOSED) {
                        connectionStatus.value = "";
                    } else {
                        connectionStatus.value = "Error";
                        console.error("SSE error:", error);
                    }
                };
            };

            function handleSensor() {
                if (enableSensor.value) {
                    closeConnection();
                } else {
                    initEventSource();
                }
            }

            function handleToggle(key) {
                // Clone to ensure new reference for reactivity
                const next = { ...props.modelValue, [key]: !props.modelValue[key] };
                ctx.emit("update:modelValue", next);
            }

            return {
                handleSensor,
                handleToggle,
            };
        },
    };

</script>

<style scoped>
    /* :root{
       --bg:#0b0f14;
       --panel:#0e141b;
       --panel-2:#0b1219;
       --line:#0ff0ff;
       --line-dim:#099e9e;
       --text:#b9faff;
       --muted:#6dd9df;
       --shadow: 0 0 12px rgba(0,255,255,.45), 0 0 28px rgba(0,255,255,.15);
       } */

  /* Base */
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background: var(--bg);
    color:var(--text); font: 16px/1.4 Inter, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    /* simple circuit-esque background */
    background-image:
      radial-gradient(1200px 800px at 70% 10%, rgba(0,255,255,.08), transparent 60%),
      radial-gradient(900px 600px at 20% 30%, rgba(0,120,255,.08), transparent 60%),
      repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 80px),
      repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 1px, transparent 1px 64px);
  }

  .wrap{
    max-width:1200px; margin:40px auto; padding:0 20px;
  }

  /* Neon title */
  .title{
    display:inline-block;
    padding:14px 26px;
    border:2px solid var(--line);
    color:#cfffff;
    letter-spacing:.1em;
    font-weight:800;
    font-size: clamp(22px, 3vw, 36px);
    text-shadow: 0 0 8px rgba(0,255,255,.8);
    border-radius:12px;
    box-shadow: var(--shadow);
    background: linear-gradient(180deg, rgba(0,255,255,.06), rgba(0,255,255,.02));
  }

  /* Grid of panels */
  .grid{
    margin-top:28px;
    display:grid;
    grid-template-columns: repeat(2, minmax(280px, 1fr));
    gap:24px;
  }
  /* Stack columns on narrow screens where there isn't enough room */
  @media (max-width: 1200px){
    .grid{
      grid-template-columns: 1fr;
    }
  }

  /* Hex panel */
  .panel{
    position:relative;
    background: linear-gradient(180deg, var(--panel), var(--panel-2));
    padding:18px 18px 10px;
    clip-path: polygon(10% 0, 90% 0, 100% 18%, 100% 82%, 90% 100%, 10% 100%, 0 82%, 0 18%);
    border:2px solid var(--line);
    box-shadow: var(--shadow);
  }
  .panel:before{
    content:"";
    position:absolute; inset:6px;
    clip-path: inherit;
    border:1px solid var(--line-dim);
    opacity:.6;
    pointer-events:none;
  }
  .panel h3{
    margin:0 0 10px;
    font-size:18px; letter-spacing:.06em; color:#9dfbff;
    text-shadow:0 0 6px rgba(0,255,255,.7);
  }

  .group{
    display:grid; gap:12px; margin-top:8px;
  }

  /* Row items */
  .item{
    display:flex; align-items:center; gap:12px;
    padding:12px 12px;
    background: rgba(0,0,0,.22);
    border:1px solid rgba(0,255,255,.25);
    border-radius:12px;
  }
  .label{
      flex:1;
      font-size:14px;
      font-weight:600;
  }
  .muted{color:var(--muted); font-size:12px}

  /* Icon badge */
  .badge{
    width:36px; height:36px; display:grid; place-items:center;
    border-radius:10px;
    background: radial-gradient(circle at 30% 30%, rgba(0,255,255,.55), rgba(0,255,255,.12));
    border:1px solid rgba(0,255,255,.55);
    box-shadow: 0 0 12px rgba(0,255,255,.35) inset;
  }
  .badge svg{width:20px; height:20px; fill: #c8ffff}

  /* Neon toggle (accessible checkbox) */
  .toggle{
    --w: 54px; --h: 28px;
    position:relative; width:var(--w); height:var(--h);
  }
  .toggle input{appearance:none; -webkit-appearance:none; outline:none; width:100%; height:100%; margin:0}
  .toggle .rail{
    position:absolute; inset:0; border-radius:999px;
    background: linear-gradient(180deg, #071319, #0a2026);
    border:1px solid var(--line-dim);
    box-shadow: inset 0 0 8px rgba(0,255,255,.25);
    transition: box-shadow .25s ease, border-color .25s ease, background .25s ease;
  }
  .toggle .thumb{
    position:absolute; top:3px; left:3px;
    width:22px; height:22px; border-radius:50%;
    background: radial-gradient(circle at 30% 30%, #bfffff, #67f3ff);
    box-shadow: 0 0 12px rgba(0,255,255,.7);
    transition: transform .25s ease;
  }
    .toggle input:checked + .rail{
    background: linear-gradient(180deg, rgb(7 232 255 / 99%), rgba(0, 255, 255, .08));
    border-color: var(--line);
    box-shadow: 0 0 18px rgba(0,255,255,.6), inset 0 0 12px rgba(0,255,255,.45);
  }
  .toggle input:checked ~ .thumb{ transform: translateX(26px) }
  .toggle input:focus-visible + .rail{ outline:2px solid #fff; outline-offset:2px }

  /* Small “pill” model selector to mirror top-right chip */
  .model{
    margin-top:20px;
    display:inline-flex; align-items:center; gap:10px;
    padding:8px 12px; border-radius:999px;
    border:1px solid var(--line-dim); color:var(--text);
    background: rgba(0,255,255,.06);
    box-shadow: var(--shadow);
    font-size:14px;
  }
  .dot{width:8px; height:8px; border-radius:50%; background:#59ffff; box-shadow:0 0 8px #59ffff}
</style>
