import{r as _,j as U}from"../dist/js/chatbot-KyomVGNA.js";import{W as Z,S as j,P as K,G as q,a as J,V as Q,M as $,T as ee,b as te,c as oe,N as ae,L as G}from"./three-orRY4Bzt.js";import"./highlight.js-tT4pTLLQ.js";import"./markdown-it-D9jXLlIe.js";import"./katex-9YTe8vPf.js";import"../dist/css/styles-CSmeZcdm.js";const se=13,ie=7,z=-8,le=3.2,ne=1.8,re=2.1,N=16,ce=7,fe=4.5,pe=170,ue=3.4,he=.18,me=.4;function L(t,e,a){return Math.max(e,Math.min(a,t))}function b(t,e,a,l){return t+(e-t)*(1-Math.exp(-a*l))}function de(t){const e=t<.38?Math.sin(t/.38*Math.PI*.5):Math.cos((t-.38)/.62*Math.PI*.5);return Math.pow(Math.max(0,e),.85)}function ge(t=Math.random){let e=0,a=0,l=z,o=0,c=0,g=0,r=0,f=0,h=0,u=0,m=0,n=1,p=[],C=0,y=!1;const E=M=>{const s=pe/1e3;M?(p.push({startSec:e,durationSec:s*.9}),p.push({startSec:e+s*1.15,durationSec:s})):p.push({startSec:e,durationSec:s})},x=()=>{C=e+Math.max(1.1,ue+(t()-.4)*2.4)},k=()=>{const M=r,s=f;t()<.3?(r=(t()-.5)*3,f=(t()-.5)*2):(r=(t()*2-1)*se,f=(t()*2-1)*ie),h=e+1.4+t()*t()*4.5,Math.hypot(r-M,f-s)>6&&t()<me&&(E(!1),x())};return{step:(M,s)=>{const i=L(M,0,.05);e+=i,s&&!y&&(r=0,f=0,h=e+.9+t()*.8,x()),!s&&y&&(p=[]),y=s;let w=0,R=z;s&&(e>=h&&k(),w=r+Math.sin(e*.53)*.7+Math.sin(e*1.31+1.7)*.3,R=f+Math.sin(e*.41+.6)*.5);const v=s?le:ne;o+=(v*v*(w-a)-2*v*o)*i,c+=(v*v*(R-l)-2*v*c)*i,a+=o*i,l+=c*i,g=b(g,a,re,i);const O=s?L(a/22+(w-a)/9,-1,1):0,H=s?L(-l/18-(R-l)/7,-1,1):0;u=b(u,O,N,i),m=b(m,H,N,i),n=b(n,s?0:1,s?ce:fe,i);let Y=0;if(s){e>=C&&n<.1&&(E(t()<he),x()),p=p.filter(S=>e-S.startSec<=S.durationSec);for(const S of p){const D=e-S.startSec;D>=0&&(Y=Math.max(Y,de(D/S.durationSec)))}}const A=L(Math.max(n,Y),0,1),W=s?1.4:.9;return{yawDeg:a,pitchDeg:l,rollDeg:a*.12,swayYawDeg:g,lidLeft:A,lidRight:A,gazeX:u,gazeY:m,floatY:Math.sin(e*W)*.014}}}}const ve="/static/img/cyber-portrait-open.jpg",Me="/static/img/cyber-portrait-closed.jpg",X=1024/801,F=3.15,we=F/X,I=200,ye=.85,P=Math.PI/180;function d(t,e,a,l,o,c,g){const r=t-a,f=e-l,h=Math.cos(g),u=Math.sin(g),m=r*h+f*u,n=-r*u+f*h,p=m*m/(o*o)+n*n/(c*c);return p>16?0:Math.exp(-p)}function T(t,e,a){const l=Math.max(0,Math.min(1,(a-t)/(e-t)));return l*l*(3-2*l)}function xe(t,e){const a=(t-.495)/.52,l=(e-.46)/.56;let o=.36*Math.exp(-.55*(a*a+l*l));o+=.11*d(t,e,.49,.48,.26,.34,-.03),o+=.055*d(t,e,.495,.865,.095,.065,0),o+=.055*d(t,e,.485,.155,.34,.13,-.04),o+=.032*d(t,e,.32,.275,.11,.04,.06),o+=.034*d(t,e,.61,.245,.11,.04,-.1),o+=.05*d(t,e,.285,.485,.12,.1,.18),o+=.052*d(t,e,.655,.465,.12,.1,-.18);const c=T(.26,.54,e),g=.468-.008*c,r=.062+.022*c,f=(t-g)/r,h=Math.exp(-Math.pow((e-.445)/.115,2));o+=.075*Math.exp(-f*f)*h,o+=.07*d(t,e,.462,.528,.068,.058,0),o+=.048*d(t,e,.484,.69,.095,.038,-.04),o+=.055*d(t,e,.486,.752,.092,.042,-.04),o+=.028*d(t,e,.318,.362,.068,.045,.05),o+=.028*d(t,e,.612,.336,.07,.045,-.08);const u=T(.86,.98,e),m=(t-.495)/.22,n=Math.exp(-m*m*1.2);o=o*(1-.38*u)+.06*n*u;const p=Math.pow((t-.5)*2,4),C=Math.pow((e-.5)*2,4);return o*Math.exp(-.35*(p+C))-.18}const Ce=`
uniform float uDepthScale;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform float uYawRad;
uniform float uPitchRad;
uniform float uRollRad;
uniform float uSwayYawRad;
attribute float aBaseDepth;
varying vec2 vUv;
varying vec3 vViewPos;
varying vec3 vNormalView;

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
}
mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
}

void main() {
  vUv = uv;
  float imgX = uv.x;
  float imgY = 1.0 - uv.y;

  // Flatten the corneal bulge slightly as each lid closes.
  float leftEyeBulge = exp(-pow((imgX - 0.318) / 0.045, 2.0) - pow((imgY - 0.362) / 0.028, 2.0));
  float rightEyeBulge = exp(-pow((imgX - 0.612) / 0.046, 2.0) - pow((imgY - 0.336) / 0.028, 2.0));
  float lidFlatten = -0.012 * (leftEyeBulge * uBlinkLeft + rightEyeBulge * uBlinkRight);

  vec3 p = position;
  p.z = (aBaseDepth + lidFlatten) * uDepthScale;

  float neckBaseMask = smoothstep(0.76, 0.99, imgY) * exp(-pow((imgX - 0.495) / 0.28, 2.0));
  float borderSoftX = 1.0 - 0.55 * pow(abs((imgX - 0.5) * 2.0), 3.2);
  float borderSoftY = 1.0 - 0.45 * pow(abs((imgY - 0.5) * 2.0), 3.6);
  float cranialWeight = (1.0 - 0.78 * neckBaseMask) * borderSoftX * borderSoftY;

  float sideHairZone = smoothstep(0.42, 0.85, imgY) * smoothstep(0.16, 0.36, abs(imgX - 0.495));
  float effYaw = (uYawRad * cranialWeight) + (uSwayYawRad - uYawRad) * 0.32 * sideHairZone;
  float effPitch = uPitchRad * cranialWeight;
  float effRoll = uRollRad * cranialWeight;

  vec3 pivot = vec3(0.0, -0.32, -0.45);
  mat3 R = rotZ(effRoll) * rotX(effPitch) * rotY(effYaw);
  vec3 rotatedPos = pivot + R * (p - pivot);

  // Damp depth change so the cheeks don't stretch at the ends of a turn.
  rotatedPos.z = mix(p.z, rotatedPos.z, 0.72);

  vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
  vViewPos = -mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normalize(R * normal));
  gl_Position = projectionMatrix * mvPosition;
}
`,Re=`
uniform sampler2D uMap;
uniform sampler2D uClosedMap;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform vec2 uGazeOffset;
uniform float uIrisGlow;
uniform float uRimLight;

varying vec2 vUv;
varying vec3 vViewPos;
varying vec3 vNormalView;

void evaluateEyeCurtain(
  in vec2 imgCoord,
  in float cx,
  in float cy,
  in float rx,
  in float ryTop,
  in float ryBot,
  in float slope,
  in float blink,
  inout float closedMix,
  inout float movingLashLine,
  inout float openEyeMask
) {
  float dx = imgCoord.x - cx;
  float nx = dx / rx;
  if (abs(nx) >= 1.05) return;

  float clampedNx = clamp(nx, -1.0, 1.0);
  float arch = pow(max(0.0, 1.0 - clampedNx * clampedNx), 0.56);
  float yc = cy + slope * dx;
  float yTop = yc - ryTop * arch;
  float yBot = yc + ryBot * arch;

  if (imgCoord.y < yTop - 0.015 || imgCoord.y > yBot + 0.015) return;

  float v = clamp((imgCoord.y - yTop) / max(0.0001, yBot - yTop), 0.0, 1.0);
  float horizFeather = smoothstep(1.05, 0.82, abs(nx));
  float vertFeather = smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);
  float socketMask = horizFeather * vertFeather;

  float b = clamp(blink, 0.0, 1.0);

  if (b > 0.002) {
    float curtainV = mix(0.08, 1.04, smoothstep(0.0, 0.96, b));
    float revealCurtain = smoothstep(curtainV + 0.08, curtainV - 0.08, v);
    float fullClosed = smoothstep(0.75, 0.98, b);
    float localClosed = mix(revealCurtain * smoothstep(0.0, 0.18, b), 1.0, fullClosed);

    closedMix = max(closedMix, localClosed * socketMask);

    // Lash shadow on the leading edge of the lid, mid-blink only; the
    // closed-eye photograph already carries the resting lash line.
    float midBlinkWeight = sin(b * 3.14159265) * (1.0 - fullClosed);
    float edgeBand = exp(-pow((v - curtainV) / 0.055, 2.0));
    movingLashLine = max(movingLashLine, edgeBand * midBlinkWeight * socketMask * 0.72);
  }

  float openV = smoothstep(0.32, 0.52, v) * smoothstep(0.95, 0.75, v);
  openEyeMask = max(openEyeMask, openV * arch * (1.0 - smoothstep(0.15, 0.75, b)));
}

void main() {
  vec2 imgCoord = vec2(vUv.x, 1.0 - vUv.y);
  float closedMix = 0.0;
  float movingLashLine = 0.0;
  float openEyeMask = 0.0;

  evaluateEyeCurtain(
    imgCoord, 0.316, 0.362, 0.092, 0.076, 0.055, 0.11,
    uBlinkLeft, closedMix, movingLashLine, openEyeMask
  );
  evaluateEyeCurtain(
    imgCoord, 0.614, 0.330, 0.096, 0.085, 0.055, -0.21,
    uBlinkRight, closedMix, movingLashLine, openEyeMask
  );

  // Shift the iris within the open eye to follow the gaze.
  vec2 openSampleCoord = imgCoord;
  if (openEyeMask > 0.01) {
    openSampleCoord -= uGazeOffset * openEyeMask * 0.012;
  }
  vec2 openUv = vec2(openSampleCoord.x, 1.0 - openSampleCoord.y);

  vec3 openCol = texture2D(uMap, openUv).rgb;
  vec3 closedCol = texture2D(uClosedMap, vUv).rgb;
  vec3 col = mix(openCol, closedCol, clamp(closedMix, 0.0, 1.0));

  if (movingLashLine > 0.001) {
    col = mix(col, vec3(0.04, 0.03, 0.06), movingLashLine);
  }

  // Lift the violet iris glow while the eyes are open.
  float isMagentaIris = clamp((openCol.r + openCol.b - 1.75 * openCol.g) * 1.4, 0.0, 1.0)
    * openEyeMask * (1.0 - closedMix);
  col += vec3(0.28, 0.04, 0.34) * isMagentaIris * (uIrisGlow - 1.0);

  // Corneal catchlights that track the gaze.
  if (openEyeMask > 0.15 && closedMix < 0.5) {
    vec2 leftSpecPos = vec2(0.312, 0.354) + uGazeOffset * 0.011;
    vec2 rightSpecPos = vec2(0.606, 0.326) + uGazeOffset * 0.011;
    float dLeft = length((imgCoord - leftSpecPos) * vec2(1.0, 1.45));
    float dRight = length((imgCoord - rightSpecPos) * vec2(1.0, 1.45));
    float catchLight = smoothstep(0.009, 0.002, dLeft) * (1.0 - uBlinkLeft)
      + smoothstep(0.009, 0.002, dRight) * (1.0 - uBlinkRight);
    col += vec3(0.85, 0.95, 1.0) * catchLight * 0.50 * (1.0 - closedMix);
  }

  // Neon speculars that slide across the relief as the head turns.
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(vViewPos);
  float specCyan = pow(max(dot(N, normalize(normalize(vec3(-0.65, 0.25, 0.72)) + V)), 0.0), 28.0);
  float specMag = pow(max(dot(N, normalize(normalize(vec3(0.70, 0.35, 0.62)) + V)), 0.0), 24.0);
  float specAmb = pow(max(dot(N, normalize(normalize(vec3(0.0, -0.78, 0.62)) + V)), 0.0), 20.0);

  float lipGloss = exp(-pow((imgCoord.x - 0.485) / 0.085, 2.0) - pow((imgCoord.y - 0.735) / 0.055, 2.0));
  float noseGloss = exp(-pow((imgCoord.x - 0.460) / 0.045, 2.0) - pow((imgCoord.y - 0.528) / 0.045, 2.0));
  float surfaceGloss = 0.10 + 0.28 * (lipGloss + noseGloss) + 0.22 * openEyeMask * (1.0 - closedMix);

  col += (
    vec3(0.18, 0.82, 1.0) * specCyan * 0.50 +
    vec3(0.96, 0.32, 0.92) * specMag * 0.50 +
    vec3(1.0, 0.52, 0.12) * specAmb * 0.45
  ) * surfaceGloss * uRimLight;

  // Fade to transparent at the frame so the portrait sits on the panel.
  float edgeX = smoothstep(0.495, 0.42, abs(vUv.x - 0.5));
  float edgeY = smoothstep(0.495, 0.43, abs(vUv.y - 0.5));
  float alphaMask = edgeX * edgeY;

  gl_FragColor = vec4(col * alphaMask, alphaMask);
}
`;function Ee(){const t=new te(F,we,I,I),e=t.attributes.position,a=t.attributes.uv,l=new Float32Array(e.count);for(let o=0;o<e.count;o++){const c=xe(a.getX(o),1-a.getY(o));l[o]=c,e.setZ(o,c)}return t.setAttribute("aBaseDepth",new oe(l,1)),t.computeVertexNormals(),t}function V(t,e){return t.loadAsync(e).then(a=>(a.colorSpace=ae,a.minFilter=G,a.magFilter=G,a.generateMipmaps=!1,a))}function Ye({size:t=282,active:e=!1}){const a=_.useRef(null),l=_.useRef(e);l.current=e;const o=t,c=Math.round(t/X);return _.useEffect(()=>{const g=a.current;if(!g)return;let r;try{r=new Z({canvas:g,antialias:!0,alpha:!0})}catch{return}r.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),r.setSize(o,c,!1),r.setClearColor(0,0);const f=new j,h=new K(34,o/c,.1,100);h.position.set(0,.03,4.25),h.lookAt(0,.02,0);const u=new q;f.add(u);const m=Ee(),n={uMap:{value:null},uClosedMap:{value:null},uDepthScale:{value:ye},uBlinkLeft:{value:1},uBlinkRight:{value:1},uYawRad:{value:0},uPitchRad:{value:0},uRollRad:{value:0},uSwayYawRad:{value:0},uGazeOffset:{value:new Q(0,0)},uIrisGlow:{value:1.25},uRimLight:{value:1.15}},p=new J({vertexShader:Ce,fragmentShader:Re,uniforms:n,transparent:!0,premultipliedAlpha:!0});u.add(new $(m,p));const C=ge(),y=[];let E=!1,x=0,k=performance.now();const B=s=>{x=requestAnimationFrame(B);const i=C.step((s-k)/1e3,l.current);k=s;const w=i.yawDeg*P,R=i.pitchDeg*P,v=i.rollDeg*P;u.rotation.set(R*.18,w*.18,v*.22),u.position.y=i.floatY,n.uYawRad.value=w*.82,n.uPitchRad.value=R*.82,n.uRollRad.value=v*.78,n.uSwayYawRad.value=i.swayYawDeg*P*.82,n.uBlinkLeft.value=i.lidLeft,n.uBlinkRight.value=i.lidRight,n.uGazeOffset.value.set(i.gazeX,i.gazeY),r.render(f,h)},M=new ee;return Promise.all([V(M,ve),V(M,Me)]).then(([s,i])=>{if(y.push(s,i),E){y.forEach(w=>w.dispose());return}n.uMap.value=s,n.uClosedMap.value=i,k=performance.now(),x=requestAnimationFrame(B)}).catch(s=>{console.error("Cyber Portrait textures failed to load",s)}),()=>{E=!0,cancelAnimationFrame(x),y.forEach(s=>s.dispose()),m.dispose(),p.dispose(),r.dispose()}},[o,c]),U.jsx("canvas",{ref:a,className:"cyber-portrait",style:{width:o,height:c},"aria-busy":e?"true":"false",role:"img","aria-label":e?"AI working":"AI idle"})}export{Ye as default};
