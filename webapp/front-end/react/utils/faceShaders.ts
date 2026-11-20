/**
 * GLSL for the projected-face visualizations (Nova, Sable).
 *
 * The face is a reference picture projected onto a head model: each skin
 * vertex carries the place it occupies in that picture, so the painted
 * features stay on the skin as it moves. The lighting is therefore already
 * in the paint. What these shaders add is the part that has to move: glyphs
 * that come and go, and eyes that turn.
 *
 * Picture coordinates run from the top-left corner, x across and y down.
 * Colours are linear; values above one are what the bloom pass picks up.
 */

const COMMON = /* glsl */ `
const vec3 C_CYAN = vec3(0.06, 0.62, 1.0);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

// ─── Skin ───────────────────────────────────────────────────────
// uv is the glyph layout space, uv1 the vertex's place in the picture.
// Vertex colours carry masks baked into the model: r marks the mouth and
// eye sockets, g how far the picture can be trusted there, b the front of
// the head where glyphs may appear, and a how far the vertex travels in a
// blink (1 at the lid margin).

export const skinVertexShader = /* glsl */ `
#include <morphtarget_pars_vertex>
attribute vec4 color;
attribute vec2 uv1;
uniform float uUnit;
uniform float uNeckTop;
uniform float uNeckBottom;
uniform float uBlinkLeft;
uniform float uBlinkRight;
uniform vec4 uEyeRight;
uniform vec4 uEyeLeft;
uniform vec4 uLidLineRight;
uniform vec4 uLidLineLeft;
uniform vec2 uLidSag;
// Takes a point on the moving skin to where it falls in the picture.
uniform mat4 uPictureMatrix;
varying vec2 vUv;
varying vec2 vPictureUv;
varying vec3 vMask;
varying float vNeck;
varying float vLidTravel;
varying float vBlink;
varying vec4 vEye;
varying vec4 vLidLine;
varying float vLidSag;
varying vec4 vPictureNow;

void main() {
  vUv = uv;
  vPictureUv = uv1;
  vMask = color.rgb;
  vLidTravel = color.a;
  // Which eye this vertex belongs to; her left eye is at +x.
  bool isLeft = position.x > 0.0;
  vBlink = isLeft ? uBlinkLeft : uBlinkRight;
  vEye = isLeft ? uEyeLeft : uEyeRight;
  vLidLine = isLeft ? uLidLineLeft : uLidLineRight;
  vLidSag = isLeft ? uLidSag.y : uLidSag.x;
  // Fade the neck out by its height on the unposed model.
  vNeck = smoothstep(uNeckBottom, uNeckTop, position.y * uUnit);
  vec3 transformed = vec3(position);
  #include <morphtarget_vertex>
  vPictureNow = uPictureMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const skinFragmentShader = /* glsl */ `
uniform sampler2D uPicture;
uniform sampler2D uPictureGlyphs;
uniform sampler2D uGlyphMap;
uniform float uGlyphGain;
uniform float uScanV;
uniform float uDissolve;
uniform float uReveal;
uniform vec2 uRevealFrom;
uniform float uPaintedGain;
uniform float uLidBlur;
uniform float uLidShade;
uniform float uLidCover;
uniform float uGlow;

varying vec2 vUv;
varying vec2 vPictureUv;
varying vec3 vMask;
varying float vNeck;
varying float vLidTravel;
varying float vBlink;
varying vec4 vEye;
varying vec4 vLidLine;
varying float vLidSag;
varying vec4 vPictureNow;

${COMMON}

void main() {
  float socket = vMask.r;
  float front = vMask.b * (1.0 - socket);

  vec3 col = texture2D(uPicture, vPictureUv).rgb;

  // In the picture the eyes are open. The painted eye is a little larger
  // than the opening in the head model, so the skin around that opening
  // carries its edges: lash lines, and slivers of the white and the iris.
  // Left alone, those would stay in place when the lids close and the open
  // eye would still show on them. So as an eye closes, the skin over the
  // whole painted eye (vEye: its centre and radii in the picture) is
  // repainted to run smoothly from the skin above the eye to the skin
  // beneath it, both taken from a blurred level of the picture (uLidBlur)
  // and shaded a little (uLidShade), as a lid no longer lit by the eye.
  vec2 fromEye = (vPictureUv - vEye.xy) / vEye.zw;
  float overEye = 1.0 - smoothstep(0.45, 1.0, length(fromEye));
  // The lids themselves are repainted whole (uLidCover). Folded away under
  // the brow in the picture, they carry whatever lay along the lash line,
  // drawn out into streaks once they unfold.
  float onLid = uLidCover * smoothstep(0.15, 0.5, vLidTravel);
  float closing = vBlink * max(overEye, onLid);
  vec3 above = texture2D(uPicture, vec2(vPictureUv.x, vEye.y - vEye.w * 1.2), uLidBlur).rgb;
  vec3 beneath = texture2D(uPicture, vec2(vPictureUv.x, vEye.y + vEye.w * 1.35), uLidBlur).rgb;
  vec3 lidTone = mix(above, beneath, smoothstep(-0.8, 0.9, fromEye.y)) * uLidShade;
  col = mix(col, lidTone, closing);

  // The lash line of the closed eye: a dark stroke along the lower lid
  // (vLidLine: its two corners in the picture; vLidSag: how far it dips
  // between them), placed by where the skin is now, not where it started.
  vec2 now = vPictureNow.xy / vPictureNow.w * 0.5 + 0.5;
  now.y = 1.0 - now.y;
  float across = (now.x - vLidLine.x) / (vLidLine.z - vLidLine.x);
  float lineY = mix(vLidLine.y, vLidLine.w, across) + vLidSag * 4.0 * across * (1.0 - across);
  float within = smoothstep(-0.1, 0.03, across) * (1.0 - smoothstep(0.97, 1.12, across));
  float lashes = exp(-pow((now.y - lineY) / 0.0064, 2.0)) * within;
  col *= 1.0 - 0.92 * lashes * smoothstep(0.6, 1.0, vBlink);

  // Inside the mouth and behind the eyes.
  col = mix(col, vec3(0.02, 0.0, 0.012), socket);

  // Glyphs dissolve in grains rather than fading.
  float grain = hash21(floor(vUv * 420.0));
  float kept = step(uDissolve * 1.15, grain + 0.001);

  // The glyphs that came painted on the picture, drawn in outward from one
  // point as the reveal grows.
  float reach = uReveal * 1.1 - distance(vPictureUv, uRevealFrom);
  float drawn = smoothstep(0.0, 0.05, reach);
  // The stroke flares where it is being drawn.
  float tip = drawn * (1.0 - smoothstep(0.05, 0.16, reach));
  vec3 painted = texture2D(uPictureGlyphs, vPictureUv).rgb * (1.0 - socket);
  col += painted * drawn * kept * (uPaintedGain + 2.0 * tip);

  // Glyphs drawn live, in the glyph layout space.
  float scan = uScanV < 0.0 ? 0.0 : exp(-pow((vUv.y - uScanV) / 0.011, 2.0));
  vec3 glyph = texture2D(uGlyphMap, vUv).rgb;
  col += glyph * front * kept * uGlyphGain * (1.0 + 3.5 * scan);
  col += painted * drawn * kept * scan * 2.5;
  // The scan line itself, faint on bare skin.
  col += C_CYAN * scan * front * 0.16 * uGlow;

  // Where the picture does not really show the surface (the turn of the
  // cheek, the crown, the far side of the nose) the head gives way to the
  // backplate, so its outline never shows against the hair.
  float shown = smoothstep(0.04, 0.5, vMask.g);
  // Not the eyelids, though: they tuck under the brow, so the picture
  // barely shows them, but they have to hide the eye when they close.
  float lid = smoothstep(0.0, 0.04, vLidTravel);
  gl_FragColor = vec4(col, vNeck * max(shown, max(socket, lid)));
}
`;

// ─── Backplate ──────────────────────────────────────────────────
// The picture itself, standing behind the head and turning with it. It
// supplies everything the head model does not have: hair, ear, collar and
// background.

export const plateVertexShader = /* glsl */ `
uniform float uOverscan;
varying vec2 vPictureUv;

void main() {
  // The plate is larger than the picture; its border repeats the edge
  // pixels so nothing empty shows when the head moves.
  vPictureUv = (uv - 0.5) * uOverscan + 0.5;
  vPictureUv.y = 1.0 - vPictureUv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const plateFragmentShader = /* glsl */ `
uniform sampler2D uPicture;
varying vec2 vPictureUv;

void main() {
  gl_FragColor = vec4(texture2D(uPicture, clamp(vPictureUv, 0.0, 1.0)).rgb, 1.0);
}
`;

// ─── Eyes ───────────────────────────────────────────────────────
// The picture supplies the white of each eye, the lashes across it and the
// shadow they cast, sampled where the eyeball's surface currently is within
// the head. That layer therefore stays put while the eye turns. The iris has
// been painted out of the picture and is drawn here instead, around the
// eyeball's own forward axis, so it is the one part that moves.

export const eyeVertexShader = /* glsl */ `
uniform float uDepthBias;
// Takes a point on the turned eyeball to where it falls in the picture.
uniform mat4 uPictureMatrix;
varying vec3 vLocal;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vPictureClip;

void main() {
  vLocal = position;
  vPictureClip = uPictureMatrix * vec4(position, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  // Morphed lids travel in straight lines and so cut slightly through the
  // curve of the eyeball. Depth-test the eye as if it sat a little further
  // back, without moving it on screen, so the lids always win.
  vec4 pushed = projectionMatrix * (mvPosition - vec4(0.0, 0.0, uDepthBias, 0.0));
  gl_Position.z = pushed.z / pushed.w * gl_Position.w;
}
`;

export const eyeFragmentShader = /* glsl */ `
uniform sampler2D uPicture;
uniform vec3 uAxis;
uniform float uIrisAngle;
uniform vec3 uIrisInner;
uniform vec3 uIrisOuter;
uniform float uPupil;
uniform float uLimbal;
uniform float uExposure;
uniform float uCatchlight;
uniform vec3 uPupilColor;
uniform float uGlow;
uniform float uOpen;

varying vec3 vLocal;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vPictureClip;

void main() {
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(-vViewPos);
  vec3 dir = normalize(vLocal);
  float r = acos(clamp(dot(dir, uAxis), -1.0, 1.0)) / uIrisAngle;

  // Iris: fibres radiating from the pupil, shading from one colour next to
  // it to another at the rim, inside a dark limbal ring.
  vec3 tangent = normalize(cross(uAxis, vec3(0.0, 1.0, 0.0)));
  vec3 bitangent = cross(uAxis, tangent);
  float around = atan(dot(dir, bitangent), dot(dir, tangent));
  float fibres = 0.78 + 0.22 * sin(around * 34.0 + sin(around * 9.0) * 2.0);
  vec3 iris = mix(uIrisInner, uIrisOuter, smoothstep(0.35, 0.95, r));
  iris *= fibres * (0.6 + 0.5 * uGlow);
  iris *= 1.0 - uLimbal * smoothstep(0.8, 1.0, r);
  iris = mix(iris, uPupilColor, smoothstep(uPupil, uPupil - 0.07, r));

  // What the picture shows at this spot with the iris taken away.
  vec2 pictureUv = vPictureClip.xy / vPictureClip.w * 0.5 + 0.5;
  pictureUv.y = 1.0 - pictureUv.y;
  vec3 painted = texture2D(uPicture, pictureUv).rgb;

  // Light the iris by how bright the picture is there, so the lashes'
  // shadow falls across it too.
  float lit = clamp(dot(painted, vec3(0.3, 0.5, 0.2)) / uExposure, 0.2, 1.6);
  vec3 col = mix(iris * lit, painted, smoothstep(0.9, 1.04, r));

  // A catchlight that stays put while the eye turns beneath it.
  vec3 lamp = normalize(vec3(-0.3, 0.38, 1.0));
  float catchlight = pow(clamp(dot(N, normalize(lamp + V)), 0.0, 1.0), 260.0);
  col += vec3(1.5, 1.5, 1.9) * catchlight * uCatchlight * uOpen;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Teeth ──────────────────────────────────────────────────────

export const teethVertexShader = /* glsl */ `
#include <morphtarget_pars_vertex>
varying vec3 vNormalView;

void main() {
  vec3 transformed = vec3(position);
  #include <morphtarget_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const teethFragmentShader = /* glsl */ `
varying vec3 vNormalView;

void main() {
  vec3 N = normalize(vNormalView);
  float fill = clamp(dot(N, normalize(vec3(0.1, 0.3, 1.0))), 0.0, 1.0);
  // Just inside the lips, so lit only from the front and tinted by them.
  gl_FragColor = vec4(vec3(0.32, 0.15, 0.36) * (0.04 + 0.24 * fill * fill), 1.0);
}
`;
