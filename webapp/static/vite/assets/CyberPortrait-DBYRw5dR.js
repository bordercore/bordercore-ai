import{r as z,j as oe}from"../dist/js/chatbot-DQb4K9hI.js";import{W as ae,S as se,P as ie,G as le,a as ne,V as X,M as re,T as ce,b as pe,c as ue,N as fe,L as F}from"./three-orRY4Bzt.js";import"./highlight.js-tT4pTLLQ.js";import"./markdown-it-D9jXLlIe.js";import"./katex-9YTe8vPf.js";import"../dist/css/styles-DQElkeND.js";const he=13,me=7,O=-8,de=3.2,ve=1.8,ge=2.1,H=16,Me=7,we=4.5,Ce=170,Ee=3.4,ye=.18,Se=1.2,xe=3.5,Re=3,Le=8,W=1.2,_e=3,ke=2.4,Pe=1.4,Ae=.4;function R(t,e,a){return Math.max(e,Math.min(a,t))}function b(t,e,a,i){return t+(e-t)*(1-Math.exp(-a*i))}function be(t){const e=t<.38?Math.sin(t/.38*Math.PI*.5):Math.cos((t-.38)/.62*Math.PI*.5);return Math.pow(Math.max(0,e),.85)}function Ye(t=Math.random){let e=0,a=0,i=O,o=0,c=0,g=0,n=0,p=0,h=0,f=0,m=0,s=1,u=[],L=0,S=!1,C=0,M=0,x=0,k=0,P=0;const d=(y,l)=>{P=e+y+t()*(l-y)},r=y=>{const l=Ce/1e3;y?(u.push({startSec:e,durationSec:l*.9}),u.push({startSec:e+l*1.15,durationSec:l})):u.push({startSec:e,durationSec:l})},E=()=>{L=e+Math.max(1.1,Ee+(t()-.4)*2.4)},Y=()=>{const y=n,l=p;t()<.3?(n=(t()-.5)*3,p=(t()-.5)*2):(n=(t()*2-1)*he,p=(t()*2-1)*me),h=e+1.4+t()*t()*4.5,Math.hypot(n-y,p-l)>6&&t()<Ae&&(r(!1),E())};return{step:(y,l)=>{const w=R(y,0,.05);e+=w,l&&!S&&(n=0,p=0,h=e+.9+t()*.8,E(),d(Se,xe)),!l&&S&&(u=[],M=0),S=l;let B=0,G=O;l&&(e>=h&&Y(),B=n+Math.sin(e*.53)*.7+Math.sin(e*1.31+1.7)*.3,G=p+Math.sin(e*.41+.6)*.5);const _=l?de:ve;o+=(_*_*(B-a)-2*_*o)*w,c+=(_*_*(G-i)-2*_*c)*w,a+=o*w,i+=c*w,g=b(g,a,ge,w);const J=l?R(a/22+(B-a)/9,-1,1):0,Q=l?R(-i/18-(G-i)/7,-1,1):0;f=b(f,J,H,w),m=b(m,Q,H,w),s=b(s,l?0:1,l?Me:we,w);let N=0;if(l){e>=L&&s<.1&&(r(t()<ye),E()),u=u.filter(A=>e-A.startSec<=A.durationSec);for(const A of u){const V=e-A.startSec;V>=0&&(N=Math.max(N,be(V/A.durationSec)))}}const T=R(Math.max(s,N),0,1);l&&(M===0&&e>=P?(M=.45+t()*.55,x=(t()*2-1)*.3,k=e+W+t()*(_e-W)):M>0&&e>=k&&(M=0,d(Re,Le))),C=b(C,M,M>C?ke:Pe,w);const $=l?.12*(1+Math.sin(e*.37+2.1)*Math.sin(e*.83)):0,ee=R(C*.6+$*(1-s),0,1),te=l?1.4:.9;return{yawDeg:a,pitchDeg:i,rollDeg:a*.12,swayYawDeg:g,lidLeft:T,lidRight:T,gazeX:f,gazeY:m,smileLeft:R(C*(1+x),0,1),smileRight:R(C*(1-x),0,1),lipPress:ee,floatY:Math.sin(e*te)*.014}}}}const Ie="/static/img/cyber-portrait-open.jpg",De="/static/img/cyber-portrait-closed.jpg",K=1024/801,q=3.15,Be=q/K,U=200,Ge=.85,I=Math.PI/180;function v(t,e,a,i,o,c,g){const n=t-a,p=e-i,h=Math.cos(g),f=Math.sin(g),m=n*h+p*f,s=-n*f+p*h,u=m*m/(o*o)+s*s/(c*c);return u>16?0:Math.exp(-u)}function Z(t,e,a){const i=Math.max(0,Math.min(1,(a-t)/(e-t)));return i*i*(3-2*i)}function Ne(t,e){const a=(t-.495)/.52,i=(e-.46)/.56;let o=.36*Math.exp(-.55*(a*a+i*i));o+=.11*v(t,e,.49,.48,.26,.34,-.03),o+=.055*v(t,e,.495,.865,.095,.065,0),o+=.055*v(t,e,.485,.155,.34,.13,-.04),o+=.032*v(t,e,.32,.275,.11,.04,.06),o+=.034*v(t,e,.61,.245,.11,.04,-.1),o+=.05*v(t,e,.285,.485,.12,.1,.18),o+=.052*v(t,e,.655,.465,.12,.1,-.18);const c=Z(.26,.54,e),g=.468-.008*c,n=.062+.022*c,p=(t-g)/n,h=Math.exp(-Math.pow((e-.445)/.115,2));o+=.075*Math.exp(-p*p)*h,o+=.07*v(t,e,.462,.528,.068,.058,0),o+=.048*v(t,e,.484,.69,.095,.038,-.04),o+=.055*v(t,e,.486,.752,.092,.042,-.04),o+=.028*v(t,e,.318,.362,.068,.045,.05),o+=.028*v(t,e,.612,.336,.07,.045,-.08);const f=Z(.86,.98,e),m=(t-.495)/.22,s=Math.exp(-m*m*1.2);o=o*(1-.38*f)+.06*s*f;const u=Math.pow((t-.5)*2,4),L=Math.pow((e-.5)*2,4);return o*Math.exp(-.35*(u+L))-.18}const ze=`
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
`,Te=`
uniform sampler2D uMap;
uniform sampler2D uClosedMap;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform vec2 uGazeOffset;
uniform vec2 uSmile;
uniform float uLipPress;
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

// Offset to add to a sample position so the photograph appears to move its
// mouth: each corner is drawn up and slightly outward, and the parted lips
// are drawn toward the line between them.
vec2 mouthWarp(vec2 imgCoord) {
  vec2 leftCorner = vec2(0.385, 0.735);
  vec2 rightCorner = vec2(0.595, 0.715);
  vec2 cornerRadius = vec2(0.055, 0.050);

  vec2 dl = (imgCoord - leftCorner) / cornerRadius;
  vec2 dr = (imgCoord - rightCorner) / cornerRadius;
  vec2 lift = exp(-dot(dl, dl)) * uSmile.x * vec2(-0.004, -0.009)
    + exp(-dot(dr, dr)) * uSmile.y * vec2(0.004, -0.009);

  vec2 mouthCenter = vec2(0.490, 0.725);
  float lipLineY = mouthCenter.y - 0.095 * (imgCoord.x - mouthCenter.x);
  vec2 dm = (imgCoord - vec2(mouthCenter.x, lipLineY)) / vec2(0.085, 0.040);
  float press = exp(-dot(dm, dm)) * uLipPress * 0.16 * (imgCoord.y - lipLineY);

  // Moving the picture by an offset means sampling from the opposite side.
  return vec2(-lift.x, -lift.y + press);
}

void main() {
  vec2 imgCoord = vec2(vUv.x, 1.0 - vUv.y);
  vec2 warpedCoord = imgCoord + mouthWarp(imgCoord);
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
  vec2 openSampleCoord = warpedCoord;
  if (openEyeMask > 0.01) {
    openSampleCoord -= uGazeOffset * openEyeMask * 0.012;
  }
  vec2 openUv = vec2(openSampleCoord.x, 1.0 - openSampleCoord.y);

  vec3 openCol = texture2D(uMap, openUv).rgb;
  vec3 closedCol = texture2D(uClosedMap, vec2(warpedCoord.x, 1.0 - warpedCoord.y)).rgb;
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
`;function Ve(){const t=new pe(q,Be,U,U),e=t.attributes.position,a=t.attributes.uv,i=new Float32Array(e.count);for(let o=0;o<e.count;o++){const c=Ne(a.getX(o),1-a.getY(o));i[o]=c,e.setZ(o,c)}return t.setAttribute("aBaseDepth",new ue(i,1)),t.computeVertexNormals(),t}function j(t,e){return t.loadAsync(e).then(a=>(a.colorSpace=fe,a.minFilter=F,a.magFilter=F,a.generateMipmaps=!1,a))}function Ze({size:t=282,active:e=!1}){const a=z.useRef(null),i=z.useRef(e);i.current=e;const o=t,c=Math.round(t/K);return z.useEffect(()=>{const g=a.current;if(!g)return;let n;try{n=new ae({canvas:g,antialias:!0,alpha:!0})}catch{return}n.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),n.setSize(o,c,!1),n.setClearColor(0,0);const p=new se,h=new ie(34,o/c,.1,100);h.position.set(0,.03,4.25),h.lookAt(0,.02,0);const f=new le;p.add(f);const m=Ve(),s={uMap:{value:null},uClosedMap:{value:null},uDepthScale:{value:Ge},uBlinkLeft:{value:1},uBlinkRight:{value:1},uYawRad:{value:0},uPitchRad:{value:0},uRollRad:{value:0},uSwayYawRad:{value:0},uGazeOffset:{value:new X(0,0)},uSmile:{value:new X(0,0)},uLipPress:{value:0},uIrisGlow:{value:1.25},uRimLight:{value:1.15}},u=new ne({vertexShader:ze,fragmentShader:Te,uniforms:s,transparent:!0,premultipliedAlpha:!0});f.add(new re(m,u));const L=Ye(),S=[];let C=!1,M=0,x=performance.now();const k=d=>{M=requestAnimationFrame(k);const r=L.step((d-x)/1e3,i.current);x=d;const E=r.yawDeg*I,Y=r.pitchDeg*I,D=r.rollDeg*I;f.rotation.set(Y*.18,E*.18,D*.22),f.position.y=r.floatY,s.uYawRad.value=E*.82,s.uPitchRad.value=Y*.82,s.uRollRad.value=D*.78,s.uSwayYawRad.value=r.swayYawDeg*I*.82,s.uBlinkLeft.value=r.lidLeft,s.uBlinkRight.value=r.lidRight,s.uGazeOffset.value.set(r.gazeX,r.gazeY),s.uSmile.value.set(r.smileLeft,r.smileRight),s.uLipPress.value=r.lipPress,n.render(p,h)},P=new ce;return Promise.all([j(P,Ie),j(P,De)]).then(([d,r])=>{if(S.push(d,r),C){S.forEach(E=>E.dispose());return}s.uMap.value=d,s.uClosedMap.value=r,x=performance.now(),M=requestAnimationFrame(k)}).catch(d=>{console.error("Cyber Portrait textures failed to load",d)}),()=>{C=!0,cancelAnimationFrame(M),S.forEach(d=>d.dispose()),m.dispose(),u.dispose(),n.dispose()}},[o,c]),oe.jsx("canvas",{ref:a,className:"cyber-portrait",style:{width:o,height:c},"aria-busy":e?"true":"false",role:"img","aria-label":e?"AI working":"AI idle"})}export{Ze as default};
