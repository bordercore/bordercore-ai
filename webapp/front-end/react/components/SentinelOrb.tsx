import React, { useEffect, useRef } from "react";

export type SentinelOrbAccent = "cyan" | "violet" | "purple";

interface SentinelOrbProps {
  /** Square edge length in px. Omit to fill the parent container. */
  size?: number;
  /** Activity level. Faster spin / brighter core / more glances when true. */
  working?: boolean;
  /** Palette. */
  accent?: SentinelOrbAccent;
  /** Global motion multiplier, 0.3–2. */
  speed?: number;
  /** Number of orbital tendril rings, 1–5. */
  tendrils?: number;
  /** Render the blinking eyes. */
  showEyes?: boolean;
  /** "low" reduces point/link counts for small avatar instances. */
  quality?: "high" | "low";
}

interface OrbOpts {
  working: boolean;
  speed: number;
  accent: SentinelOrbAccent;
  tendrils: number;
  showEyes: boolean;
  quality: "high" | "low";
}

interface Palette {
  dot: number[];
  link: number[];
  core: number[][];
  halo: number[];
  tendril: number[][];
  node: number[];
}

interface Projected {
  x: number;
  y: number;
  z: number;
  d: number;
}

interface Ring {
  tiltX: number;
  zTilt: number;
  spinR: number;
  nodeA: number;
  rad: number;
  col: number[];
}

const PAL: Record<SentinelOrbAccent, Palette> = {
  cyan: {
    dot: [120, 200, 255],
    link: [76, 194, 255],
    core: [
      [233, 248, 255],
      [76, 194, 255],
      [26, 111, 208],
    ],
    halo: [70, 150, 255],
    tendril: [
      [76, 194, 255],
      [124, 127, 255],
    ],
    node: [185, 228, 255],
  },
  violet: {
    dot: [150, 160, 255],
    link: [124, 127, 255],
    core: [
      [234, 240, 255],
      [124, 127, 255],
      [74, 61, 240],
    ],
    halo: [110, 120, 255],
    tendril: [
      [124, 127, 255],
      [76, 194, 255],
    ],
    node: [190, 205, 255],
  },
  purple: {
    dot: [190, 140, 255],
    link: [160, 110, 255],
    core: [
      [244, 232, 255],
      [179, 107, 255],
      [120, 50, 230],
    ],
    halo: [150, 90, 255],
    tendril: [
      [179, 107, 255],
      [124, 127, 255],
    ],
    node: [214, 180, 255],
  },
};

/**
 * Self-contained Canvas 2D animation engine. Ported verbatim from the design
 * handoff prototype: a point-network sphere with a pulsing plasma core, orbital
 * comet tendrils, and blinking eyes that perform periodic saccades. All drawing
 * is additive ("lighter") over a transparent clear, so it composites over any
 * dark background. Per-frame state lives in this closure — never in React state.
 */
function makeOrb(canvas: HTMLCanvasElement, getOpts: () => OrbOpts) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { start() {}, stop() {} };

  let dpr = 1;
  let W = 300;
  let H = 300;
  let R = 90;
  let cx = 150;
  let cy = 150;
  let raf: number | null = null;
  let last = 0;
  let spin = 0;
  let nodePhase = 0;
  let precession = 0;
  let clock = 0;
  let nextBlink = 1.5 + Math.random() * 2.5;
  let blinkStart = -10;
  let lookX = 0;
  let lookY = 0;
  let tgtX = 0;
  let tgtY = 0;
  let nextLook = 0.8 + Math.random() * 1.5;

  const o0 = getOpts();
  const low = o0.quality === "low";
  const N = low ? 210 : 360;
  const K = low ? 2 : 3;

  // ── fibonacci sphere ──
  const baseSphere: number[][] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    baseSphere.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  // ── nearest-neighbour links (computed once) ──
  const seen = new Set<string>();
  const L: number[][] = [];
  for (let i = 0; i < N; i++) {
    const d: number[][] = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const dx = baseSphere[i][0] - baseSphere[j][0];
      const dy = baseSphere[i][1] - baseSphere[j][1];
      const dz = baseSphere[i][2] - baseSphere[j][2];
      d.push([dx * dx + dy * dy + dz * dz, j]);
    }
    d.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < K; k++) {
      const j = d[k][1];
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = a + "_" + b;
      if (!seen.has(key)) {
        seen.add(key);
        L.push([a, b]);
      }
    }
  }

  const proj: Projected[] = new Array(N);
  const camTilt = -0.32;
  const cT = Math.cos(camTilt);
  const sT = Math.sin(camTilt);

  function cam(x: number, y: number, z: number): Projected {
    const y2 = y * cT - z * sT;
    const z2 = y * sT + z * cT;
    const persp = 1 + z2 * 0.16;
    return { x: cx + x * R * persp, y: cy - y2 * R * persp, z: z2, d: (z2 + 1) / 2 };
  }

  function ringPoint(
    a: number,
    tiltX: number,
    zTilt: number,
    spinR: number,
    rad: number
  ): Projected {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let x = ca * rad;
    let y = 0;
    let z = sa * rad;
    const y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
    const z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
    y = y1;
    z = z1;
    const x1 = x * Math.cos(zTilt) - y * Math.sin(zTilt);
    const yy = x * Math.sin(zTilt) + y * Math.cos(zTilt);
    x = x1;
    y = yy;
    const x2 = x * Math.cos(spinR) + z * Math.sin(spinR);
    const z2 = -x * Math.sin(spinR) + z * Math.cos(spinR);
    x = x2;
    z = z2;
    return cam(x, y, z);
  }

  function rgba(c: number[], a: number): string {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  function rr(x: number, y: number, w: number, h: number, r: number): void {
    r = Math.min(r, w / 2, h / 2);
    ctx!.beginPath();
    ctx!.moveTo(x + r, y);
    ctx!.arcTo(x + w, y, x + w, y + h, r);
    ctx!.arcTo(x + w, y + h, x, y + h, r);
    ctx!.arcTo(x, y + h, x, y, r);
    ctx!.arcTo(x, y, x + w, y, r);
    ctx!.closePath();
  }

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    W = cw;
    H = ch;
    cx = cw / 2;
    cy = ch / 2;
    R = Math.min(cw, ch) * 0.27;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }

  function drawRing(rg: Ring, back: boolean): void {
    const SEG = 80;
    for (let k = 0; k < SEG; k++) {
      const p0 = ringPoint((k / SEG) * 6.2832, rg.tiltX, rg.zTilt, rg.spinR, rg.rad);
      const p1 = ringPoint(((k + 1) / SEG) * 6.2832, rg.tiltX, rg.zTilt, rg.spinR, rg.rad);
      if ((p0.z + p1.z) / 2 < 0 !== back) continue;
      const dd = (p0.d + p1.d) / 2;
      ctx!.strokeStyle = rgba(rg.col, 0.06 + dd * dd * 0.5);
      ctx!.lineWidth = 0.6 + dd * 1.5;
      ctx!.beginPath();
      ctx!.moveTo(p0.x, p0.y);
      ctx!.lineTo(p1.x, p1.y);
      ctx!.stroke();
    }
  }

  function drawNode(rg: Ring, pal: Palette): void {
    for (let tr = 9; tr >= 0; tr--) {
      const p = ringPoint(rg.nodeA - tr * 0.05, rg.tiltX, rg.zTilt, rg.spinR, rg.rad);
      const fade = 1 - tr / 10;
      const rad = R * 0.012 * (1 + p.d * 1.4) * (0.4 + fade * 0.8);
      const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 4);
      g.addColorStop(0, rgba(pal.node, (0.06 + p.d * 0.5) * fade));
      g.addColorStop(1, rgba(pal.node, 0));
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, rad * 4, 0, 6.2832);
      ctx!.fill();
    }
    const p = ringPoint(rg.nodeA, rg.tiltX, rg.zTilt, rg.spinR, rg.rad);
    ctx!.fillStyle = rgba([255, 255, 255], 0.5 + p.d * 0.5);
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, R * 0.02 * (0.7 + p.d), 0, 6.2832);
    ctx!.fill();
  }

  function drawEyes(work: boolean, dt: number): void {
    ctx!.globalCompositeOperation = "source-over";
    // periodic saccades — glance to a new spot, hold, return
    if (clock > nextLook) {
      if (Math.random() < 0.35) {
        tgtX = 0;
        tgtY = 0;
      } else {
        tgtX = (Math.random() * 2 - 1) * R * 0.08;
        tgtY = (Math.random() * 2 - 1) * R * 0.05;
      }
      nextLook = clock + (work ? 0.7 : 1.3) + Math.random() * (work ? 1.8 : 3.0);
    }
    const ease = Math.min(1, dt * 14); // fast snap, then hold
    lookX += (tgtX - lookX) * ease;
    lookY += (tgtY - lookY) * ease;
    const look = lookX;
    const bob = Math.sin(clock * 1.4) * R * 0.012 + lookY;
    if (clock > nextBlink && clock > blinkStart + 0.4) {
      blinkStart = clock;
      nextBlink = clock + (work ? 1.2 : 2.6) + Math.random() * 2.5;
    }
    let open = 1;
    const bt = (clock - blinkStart) / 0.15;
    if (bt >= 0 && bt <= 1) open = Math.abs(Math.cos(bt * Math.PI));
    open = Math.max(0.08, open);
    const eyeW = R * 0.135;
    const eyeH = R * 0.4 * open;
    const gap = R * 0.165;
    const ey = cy - R * 0.02 + bob;
    ctx!.save();
    ctx!.shadowColor = "rgba(190,230,255,0.9)";
    ctx!.shadowBlur = R * 0.16;
    ctx!.fillStyle = "#eaf6ff";
    for (const dir of [-1, 1]) {
      const exc = cx + dir * gap + look;
      rr(exc - eyeW / 2, ey - eyeH / 2, eyeW, eyeH, eyeW / 2);
      ctx!.fill();
    }
    ctx!.restore();
    ctx!.globalCompositeOperation = "lighter";
  }

  function frame(ts: number): void {
    const o = getOpts();
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    clock += dt;
    const pal = PAL[o.accent] || PAL.cyan;
    const work = o.working;
    const sp = (o.speed || 1) * (work ? 1 : 0.42);
    spin += dt * 0.5 * sp;
    nodePhase += dt * 1.0 * sp;
    precession += dt * 0.16 * sp;

    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, W, H);
    ctx!.globalCompositeOperation = "lighter";
    ctx!.lineCap = "round";

    // halo
    const haloP = work ? 0.5 + 0.12 * Math.sin(clock * 2) : 0.32;
    const hg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
    hg.addColorStop(0, rgba(pal.halo, 0.1 * haloP));
    hg.addColorStop(0.5, rgba(pal.halo, 0.05 * haloP));
    hg.addColorStop(1, rgba(pal.halo, 0));
    ctx!.fillStyle = hg;
    ctx!.fillRect(0, 0, W, H);

    // project sphere
    const cY = Math.cos(spin);
    const sY = Math.sin(spin);
    for (let i = 0; i < N; i++) {
      const p = baseSphere[i];
      proj[i] = cam(p[0] * cY + p[2] * sY, p[1], -p[0] * sY + p[2] * cY);
    }

    // build tendril rings
    const count = Math.max(1, Math.min(5, o.tendrils || 3));
    const rings: Ring[] = [];
    for (let m = 0; m < count; m++) {
      rings.push({
        tiltX: 0.3 + m * 0.52 * (m % 2 ? 1 : -1),
        zTilt: m * 0.6,
        spinR: precession * (0.7 + 0.22 * m) + m * 1.25,
        nodeA: nodePhase * (1.0 + 0.28 * m) + m * 2.0,
        rad: 1.3 + 0.085 * m,
        col: pal.tendril[m % 2],
      });
    }

    for (const rg of rings) drawRing(rg, true);

    // links
    for (let li = 0; li < L.length; li++) {
      const a = proj[L[li][0]];
      const b = proj[L[li][1]];
      const dd = (a.d + b.d) / 2;
      const al = dd * dd * 0.45;
      if (al < 0.02) continue;
      ctx!.strokeStyle = rgba(pal.link, al);
      ctx!.lineWidth = 0.5 + dd * 0.7;
      ctx!.beginPath();
      ctx!.moveTo(a.x, a.y);
      ctx!.lineTo(b.x, b.y);
      ctx!.stroke();
    }
    // dots
    for (let i = 0; i < N; i++) {
      const p = proj[i];
      ctx!.fillStyle = rgba(pal.dot, 0.2 + p.d * 0.8);
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, R * 0.012 * (0.5 + p.d * 1.5) + 0.4, 0, 6.2832);
      ctx!.fill();
    }

    // core plasma
    const pulse = work ? 0.85 + 0.15 * Math.sin(clock * 3.2) : 0.6;
    const cg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R);
    cg.addColorStop(0, rgba(pal.core[0], 0.95 * pulse));
    cg.addColorStop(0.28, rgba(pal.core[1], 0.6 * pulse));
    cg.addColorStop(0.6, rgba(pal.core[1], 0.18 * pulse));
    cg.addColorStop(1, rgba(pal.core[2], 0));
    ctx!.fillStyle = cg;
    ctx!.beginPath();
    ctx!.arc(cx, cy, R, 0, 6.2832);
    ctx!.fill();

    for (const rg of rings) drawRing(rg, false);
    for (const rg of rings) drawNode(rg, pal);

    if (o.showEyes !== false) drawEyes(work, dt);

    raf = requestAnimationFrame(frame);
  }

  let ro: ResizeObserver | null = null;
  function start(): void {
    resize();
    if (window.ResizeObserver) {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    }
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
  }
  return { start, stop };
}

/**
 * Ambient "working / thinking" indicator: a glowing point-network sphere with a
 * pulsing plasma core, precessing comet tendrils, and blinking eyes. Plain
 * Canvas 2D + requestAnimationFrame, no 3D dependencies.
 *
 * The `working` prop is read live every frame through a ref, so flipping it
 * crossfades the motion without restarting the animation. `quality` and `size`
 * are read at mount; changing them remounts the canvas.
 */
export default function SentinelOrb({
  size,
  working = true,
  accent = "cyan",
  speed = 1,
  tendrils = 3,
  showEyes = true,
  quality = "high",
}: SentinelOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optsRef = useRef<OrbOpts>({ working, speed, accent, tendrils, showEyes, quality });

  // Keep the latest props readable from inside the rAF loop without restarting it.
  optsRef.current = { working, speed, accent, tendrils, showEyes, quality };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = makeOrb(canvas, () => optsRef.current);
    engine.start();
    return () => engine.stop();
    // quality is fixed at init (drives sphere/link counts), so remount on change.
  }, [quality]);

  return (
    <div
      style={{
        width: size ? `${size}px` : "100%",
        height: size ? `${size}px` : "100%",
        aspectRatio: size ? undefined : "1 / 1",
      }}
      aria-busy={working ? "true" : "false"}
      role="img"
      aria-label={working ? "AI working" : "AI idle"}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
