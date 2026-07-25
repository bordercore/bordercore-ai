import{u as g,j as e,r as u}from"../dist/js/chatbot-Bz-pZ_AG.js";import{C as w,u as y}from"./react-three-fiber.esm-D0BTkeT3.js";import{A as h,B as b}from"./three-Bnouvs2b.js";import"./highlight.js-tT4pTLLQ.js";import"./markdown-it-D5Txu6JT.js";import"./katex-BTvXRZlT.js";import"../dist/css/styles-DmDv8u4_.js";const z=`
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0,0.5,1.0,2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  f += 0.5000 * snoise(p); p *= 2.01;
  f += 0.2500 * snoise(p); p *= 2.02;
  f += 0.1250 * snoise(p); p *= 2.03;
  f += 0.0625 * snoise(p);
  return f / 0.9375;
}
`,j=`
${z}

uniform float uTime;
uniform float uGpuUtil;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
  float noiseScale = 1.5 + uGpuUtil * 2.0;
  float displacement = fbm(position * noiseScale + uTime * 0.4) * (0.05 + uGpuUtil * 0.25);
  vec3 newPosition = position + normal * displacement;

  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelViewMatrix * vec4(newPosition, 1.0)).xyz;
  vDisplacement = displacement;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`,C=`
uniform float uTemperature;
uniform float uMemPressure;
uniform float uPowerDraw;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;

void main() {
  // Temperature-driven color: electric blue (cool) → hot red (hot)
  float tempNorm = clamp((uTemperature - 30.0) / 60.0, 0.0, 1.0);
  vec3 coolColor = vec3(0.0, 0.55, 1.0);    // deep electric blue
  vec3 midColor  = vec3(0.95, 0.0, 0.7);    // hot magenta
  vec3 warmColor = vec3(1.0, 0.15, 0.0);    // intense red-orange

  // Two-stop gradient: blue → magenta → red
  vec3 baseColor = tempNorm < 0.5
    ? mix(coolColor, midColor, tempNorm * 2.0)
    : mix(midColor, warmColor, (tempNorm - 0.5) * 2.0);

  // Memory pressure → core brightness with higher floor
  float brightness = 0.6 + uMemPressure * 0.5;
  baseColor *= brightness;

  // Fresnel rim glow — high-contrast complementary: green-cyan vs warm gold
  vec3 viewDir = normalize(-vPosition);
  float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.0);
  float glowStrength = 0.5 + uPowerDraw * 0.7;
  vec3 rimColor = mix(vec3(0.0, 1.0, 0.6), vec3(1.0, 0.9, 0.0), tempNorm);

  vec3 finalColor = baseColor + rimColor * fresnel * glowStrength;

  // Displacement highlights — bright white on peaks
  finalColor += vec3(0.4, 0.35, 0.3) * smoothstep(0.0, 0.10, vDisplacement);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;function m(t,o,i,n){return t+(o-t)*Math.min(i*n,1)}function M({statsRef:t,available:o,active:i}){const n=u.useRef(null),s=u.useRef(null),f=u.useRef({gpuUtil:0,memPressure:0,temperature:30,powerDraw:0}),l=u.useMemo(()=>({uTime:{value:0},uGpuUtil:{value:0},uTemperature:{value:30},uMemPressure:{value:0},uPowerDraw:{value:0}}),[]);return y((a,p)=>{const c=Math.min(p,.05),r=f.current,x=s.current;if(x){if(x.uniforms.uTime.value+=c,o){const v=t.current;r.gpuUtil=m(r.gpuUtil,v.gpu_util/100,3,c),r.memPressure=m(r.memPressure,v.mem_percent/100,3,c),r.temperature=m(r.temperature,v.temperature,3,c);const d=v.power_limit||350;r.powerDraw=m(r.powerDraw,Math.min(v.power_draw/d,1),3,c)}else{const v=x.uniforms.uTime.value,d=i?.3+.3*Math.sin(v*1.5):.1;r.gpuUtil=m(r.gpuUtil,d,2,c),r.memPressure=m(r.memPressure,i?.4:.1,2,c),r.temperature=m(r.temperature,i?45:30,2,c),r.powerDraw=m(r.powerDraw,i?.3+.2*Math.sin(v*.8):.05,2,c)}x.uniforms.uGpuUtil.value=r.gpuUtil,x.uniforms.uMemPressure.value=r.memPressure,x.uniforms.uTemperature.value=r.temperature,x.uniforms.uPowerDraw.value=r.powerDraw,n.current&&(n.current.rotation.y+=c*.15,n.current.rotation.x+=c*.05)}}),e.jsxs("mesh",{ref:n,children:[e.jsx("icosahedronGeometry",{args:[1,32]}),e.jsx("shaderMaterial",{ref:s,vertexShader:j,fragmentShader:C,uniforms:l})]})}function P({statsRef:t,available:o,active:i}){const n=u.useRef(null),s=60,f=u.useMemo(()=>{const l=new Float32Array(s*3);for(let a=0;a<s;a++){const p=a/s*Math.PI*2;l[a*3]=Math.cos(p)*1.6,l[a*3+1]=(Math.random()-.5)*.2,l[a*3+2]=Math.sin(p)*1.6}return l},[]);return y((l,a)=>{if(!n.current)return;const p=o?.5+t.current.clock_mhz/2e3*2:i?.8:.2;n.current.rotation.y+=a*p}),e.jsx("group",{ref:n,children:e.jsxs("points",{children:[e.jsx("bufferGeometry",{children:e.jsx("bufferAttribute",{attach:"attributes-position",count:s,array:f,itemSize:3})}),e.jsx("pointsMaterial",{size:.04,color:"#00ffaa",transparent:!0,opacity:.8,sizeAttenuation:!0,blending:h,depthWrite:!1})]})})}function D({statsRef:t,available:o,active:i}){const n=u.useRef(null),s=u.useRef(.05);return y((f,l)=>{if(!n.current)return;const a=t.current.power_limit||350,p=o?.03+Math.min(t.current.power_draw/a,1)*.12:i?.06+.03*Math.sin(f.clock.elapsedTime):.02;s.current=m(s.current,p,2,l),n.current.opacity=s.current}),e.jsxs("mesh",{children:[e.jsx("sphereGeometry",{args:[1.8,32,32]}),e.jsx("meshBasicMaterial",{ref:n,color:"#0066ff",transparent:!0,opacity:.05,blending:h,depthWrite:!1,side:b})]})}function _({statsRef:t,available:o,active:i}){return e.jsxs(e.Fragment,{children:[e.jsx("ambientLight",{intensity:.15}),e.jsx("pointLight",{position:[3,3,3],intensity:1,color:"#0088ff"}),e.jsx("pointLight",{position:[-3,-2,2],intensity:.8,color:"#ff0066"}),e.jsx("pointLight",{position:[0,-3,1],intensity:.4,color:"#00ff99"}),e.jsx(M,{statsRef:t,available:o,active:i}),e.jsx(P,{statsRef:t,available:o,active:i}),e.jsx(D,{statsRef:t,available:o,active:i})]})}function L({size:t=140,active:o=!1}){const{statsRef:i,available:n}=g({active:o});return e.jsx("div",{style:{width:t,height:t,maskImage:"radial-gradient(circle, black 40%, transparent 70%)",WebkitMaskImage:"radial-gradient(circle, black 40%, transparent 70%)"},"aria-busy":o?"true":"false",role:"img","aria-label":o?"GPU activity visualization":"GPU idle",children:e.jsx(w,{camera:{position:[0,0,3.2],fov:45},dpr:[1,2],style:{background:"transparent"},gl:{alpha:!0,antialias:!0},onCreated:({gl:s})=>{s.setClearColor(0,0)},children:e.jsx(u.Suspense,{fallback:null,children:e.jsx(_,{statsRef:i,available:n,active:o})})})})}export{L as default};
