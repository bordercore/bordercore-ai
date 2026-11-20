#!/usr/bin/env node
/**
 * Bakes the head model for one of the projected-face visualizations
 * (Nova, Sable).
 *
 * Source: ICT-FaceKit (https://github.com/ICT-VGL/ICT-FaceKit), MIT licence,
 * Copyright (c) 2020 USC Institute for Creative Technologies. The kit ships
 * one OBJ for the neutral head, one per expression and one per identity
 * shape; this script fetches the ones it needs into a cache directory.
 *
 * The face is painted by projecting a reference picture onto the head, so
 * the script first fits the head to that picture: it solves for the pose,
 * the mix of identity shapes and the handful of expression weights that
 * bring the model's facial landmarks onto the ones marked on the picture
 * (faces/<face>.json). Seen from the fitted camera, the painted head then
 * reproduces the picture exactly; the geometry underneath is what lets it
 * blink, speak and turn.
 *
 * The GLB it writes holds:
 *
 *   - skin    face, skull and neck, plus the mouth and eye sockets
 *   - teeth
 *   - eyeL / eyeR   eyeballs as separate nodes pivoted at their centres.
 *                   The node extras give the direction of the cornea, and
 *                   how to turn the eyeball and size its iris so that the
 *                   drawn iris covers the one marked on the picture
 *
 * Expression shapes become sparse morph targets under their ARKit names
 * (eyeBlinkLeft, jawOpen, ...). Vertex data is quantised to keep the file
 * small. The skin carries two sets of UVs: the first is a cylindrical
 * projection of the front of the head, so glyphs can be laid out in
 * predictable face coordinates; the second is where each vertex falls in
 * the reference picture. The fitted pose and the 68 facial landmarks are
 * stored in the scene extras.
 *
 * The kit's eyelash cards, tear film and occlusion meshes are left out:
 * they depend on textures the kit does not include.
 *
 * Usage: node scripts/bake-face.mjs <face> [--cache <dir>] [--out <file.glb>]
 *                                          [--debug <file.json>]
 *
 * <face> names a file in scripts/faces, without its extension. The model
 * is written to static/models/<face>.glb unless --out says otherwise.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = "https://raw.githubusercontent.com/ICT-VGL/ICT-FaceKit/master";
const COPYRIGHT = "ICT-FaceKit (c) 2020 USC Institute for Creative Technologies, MIT licence";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const faceName = args[0] && !args[0].startsWith("--") ? args[0] : null;
if (!faceName) {
  console.error("Usage: node scripts/bake-face.mjs <face> [--cache <dir>] [--out <file.glb>]");
  process.exit(1);
}
const cacheDir = path.resolve(argValue("--cache", path.join(os.tmpdir(), "ict-facekit")));
const outFile = path.resolve(
  argValue("--out", path.join(__dirname, "..", "static", "models", `${faceName}.glb`))
);
const debugFile = argValue("--debug", null);
const faceFile = path.join(__dirname, "faces", `${faceName}.json`);

// Source units are centimetres; positions are stored as int16 at this many
// steps per centimetre and scaled back by the node transform.
const QUANT = 1500;
// One scene unit is ten centimetres.
const UNIT_SCALE = 0.1;
// Deltas smaller than this (cm) are dropped from the sparse morph targets.
const DELTA_EPSILON = 0.01;

// The camera the head is fitted to, and the one the visualization renders
// with: a long lens, looking down -z at the origin from this far away.
const FIT_FOV_DEG = 20;
const FIT_CAMERA_DISTANCE = 6;
// How many of the kit's identity shapes the fit may mix.
const FIT_IDENTITY_COUNT = 30;
// Expression shapes the fit may use to match the picture's parted lips,
// lid positions and brows.
const FIT_EXPRESSIONS = [
  "jawOpen",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "eyeWideLeft",
  "eyeWideRight",
  "browDownLeft",
  "browDownRight",
  "browInnerUpLeft",
  "browInnerUpRight",
  "browOuterUpLeft",
  "browOuterUpRight",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthFunnel",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
];
// Pull of each identity and expression weight toward zero, in the same
// units as the landmark error (fractions of the picture's width). The marks
// are only good to a pixel or two, so the fit must not chase them too hard.
const FIT_IDENTITY_PRIOR = 0.004;
const FIT_EXPRESSION_PRIOR = 0.012;

// The projection that lays the front of the head out flat for the glyph
// texture: angle about a vertical axis through the ears, by height.
const UV_AXIS_Z = 0;
const UV_Y_MIN = -11;
const UV_Y_MAX = 14;

// Resolution of the depth buffer used to find which parts of the head the
// reference picture actually shows.
const VISIBILITY_SIZE = 640;

// ─── Fetching ───────────────────────────────────────────────────

async function fetchCached(relativePath) {
  const target = path.join(cacheDir, path.basename(relativePath));
  if (!fs.existsSync(target)) {
    const response = await fetch(`${SOURCE_URL}/${relativePath}`);
    if (!response.ok) throw new Error(`Failed to fetch ${relativePath}: ${response.status}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  return target;
}

// ─── OBJ parsing ────────────────────────────────────────────────

function parseObjPositions(file) {
  const text = fs.readFileSync(file, "utf8");
  const positions = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = text.indexOf("\n", cursor);
    if (end < 0) end = text.length;
    if (text.charCodeAt(cursor) === 118 && text.charCodeAt(cursor + 1) === 32) {
      const parts = text
        .slice(cursor + 2, end)
        .trim()
        .split(/\s+/);
      positions.push(+parts[0], +parts[1], +parts[2]);
    }
    cursor = end + 1;
  }
  return new Float64Array(positions);
}

function parseObjTopology(file) {
  const text = fs.readFileSync(file, "utf8");
  const uvs = [];
  const groups = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("vt ")) {
      const parts = line.slice(3).trim().split(/\s+/);
      uvs.push(+parts[0], +parts[1]);
    } else if (line.startsWith("usemtl ")) {
      const name = line.slice(7).trim();
      if (!groups.has(name)) groups.set(name, []);
      current = groups.get(name);
    } else if (line.startsWith("f ")) {
      const corners = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map(corner => {
          const [v, vt] = corner.split("/");
          return { v: +v - 1, vt: vt ? +vt - 1 : -1 };
        });
      // Fan-triangulate quads.
      for (let i = 1; i + 1 < corners.length; i++) {
        current.push(corners[0], corners[i], corners[i + 1]);
      }
    }
  }
  return { uvs: new Float64Array(uvs), groups };
}

// ─── Geometry helpers ───────────────────────────────────────────

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Area-weighted vertex normals over the source vertex indices. */
function computeNormals(positions, corners) {
  const normals = new Float64Array(positions.length);
  for (let i = 0; i < corners.length; i += 3) {
    const a = corners[i].v * 3;
    const b = corners[i + 1].v * 3;
    const c = corners[i + 2].v * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const index of [a, b, c]) {
      normals[index] += nx;
      normals[index + 1] += ny;
      normals[index + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function faceUv(x, y, z) {
  const angle = Math.atan2(x, z - UV_AXIS_Z);
  return [
    Math.max(0, Math.min(1, 0.5 + angle / Math.PI)),
    Math.max(0, Math.min(1, (y - UV_Y_MIN) / (UV_Y_MAX - UV_Y_MIN))),
  ];
}

// ARKit names the sides Left/Right; the kit uses _L/_R suffixes.
function arkitName(name) {
  return name.replace(/_L$/, "Left").replace(/_R$/, "Right");
}

// ─── GLB writer ─────────────────────────────────────────────────

const COMPONENT = { BYTE: 5120, UBYTE: 5121, SHORT: 5122, USHORT: 5123, UINT: 5125, FLOAT: 5126 };

class GlbBuilder {
  constructor() {
    this.chunks = [];
    this.byteLength = 0;
    this.bufferViews = [];
    this.accessors = [];
  }

  addView(typedArray, { stride, target } = {}) {
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padding = (4 - (this.byteLength % 4)) % 4;
    if (padding) {
      this.chunks.push(Buffer.alloc(padding));
      this.byteLength += padding;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (stride) view.byteStride = stride;
    if (target) view.target = target;
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  addAccessor(definition) {
    this.accessors.push(definition);
    return this.accessors.length - 1;
  }

  write(file, json) {
    json.buffers = [{ byteLength: this.byteLength }];
    json.bufferViews = this.bufferViews;
    json.accessors = this.accessors;

    let jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
    const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
    if (jsonPadding) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);

    let binary = Buffer.concat(this.chunks);
    const binaryPadding = (4 - (binary.length % 4)) % 4;
    if (binaryPadding) binary = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binary.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBytes.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binaryHeader = Buffer.alloc(8);
    binaryHeader.writeUInt32LE(binary.length, 0);
    binaryHeader.writeUInt32LE(0x004e4942, 4);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonBytes, binaryHeader, binary]));
  }
}

function minMax(values, itemSize) {
  const min = new Array(itemSize).fill(Infinity);
  const max = new Array(itemSize).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const k = i % itemSize;
    if (values[i] < min[k]) min[k] = values[i];
    if (values[i] > max[k]) max[k] = values[i];
  }
  return { min, max };
}

/**
 * Adds one mesh to the builder.
 *
 * `part` holds per-vertex arrays already expanded to the mesh's own vertex
 * numbering: positions (cm, relative to `origin`), normals, optional uvs and
 * colours, triangle indices, and `sourceIndex` mapping each vertex back to
 * the kit's numbering so expression deltas can be looked up.
 */
function addMesh(builder, part, expressions) {
  const count = part.positions.length / 3;

  const positions = new Int16Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      positions[i * 4 + k] = Math.round(part.positions[i * 3 + k] * QUANT);
    }
  }
  const quantised = new Int16Array(count * 3);
  for (let i = 0; i < count; i++) {
    quantised.set(positions.subarray(i * 4, i * 4 + 3), i * 3);
  }
  const attributes = {
    POSITION: builder.addAccessor({
      bufferView: builder.addView(positions, { stride: 8, target: 34962 }),
      componentType: COMPONENT.SHORT,
      count,
      type: "VEC3",
      ...minMax(quantised, 3),
    }),
  };

  const normals = new Int8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      normals[i * 4 + k] = Math.round(part.normals[i * 3 + k] * 127);
    }
  }
  attributes.NORMAL = builder.addAccessor({
    bufferView: builder.addView(normals, { stride: 4, target: 34962 }),
    componentType: COMPONENT.BYTE,
    normalized: true,
    count,
    type: "VEC3",
  });

  if (part.uvs) {
    const uvs = new Uint16Array(count * 2);
    for (let i = 0; i < uvs.length; i++) uvs[i] = Math.round(part.uvs[i] * 65535);
    attributes.TEXCOORD_0 = builder.addAccessor({
      bufferView: builder.addView(uvs, { stride: 4, target: 34962 }),
      componentType: COMPONENT.USHORT,
      normalized: true,
      count,
      type: "VEC2",
    });
  }

  if (part.pictureUvs) {
    const uvs = new Uint16Array(count * 2);
    for (let i = 0; i < uvs.length; i++) {
      uvs[i] = Math.round(Math.max(0, Math.min(1, part.pictureUvs[i])) * 65535);
    }
    attributes.TEXCOORD_1 = builder.addAccessor({
      bufferView: builder.addView(uvs, { stride: 4, target: 34962 }),
      componentType: COMPONENT.USHORT,
      normalized: true,
      count,
      type: "VEC2",
    });
  }

  if (part.colors) {
    const colors = new Uint8Array(count * 4);
    for (let i = 0; i < colors.length; i++) colors[i] = Math.round(part.colors[i] * 255);
    attributes.COLOR_0 = builder.addAccessor({
      bufferView: builder.addView(colors, { stride: 4, target: 34962 }),
      componentType: COMPONENT.UBYTE,
      normalized: true,
      count,
      type: "VEC4",
    });
  }

  const indexArray = count > 65535 ? new Uint32Array(part.indices) : new Uint16Array(part.indices);
  const indices = builder.addAccessor({
    bufferView: builder.addView(indexArray, { target: 34963 }),
    componentType: count > 65535 ? COMPONENT.UINT : COMPONENT.USHORT,
    count: indexArray.length,
    type: "SCALAR",
  });

  const targets = [];
  const targetNames = [];
  if (part.sourceIndex) {
    for (const expression of expressions) {
      const sparseIndices = [];
      const sparseValues = [];
      for (let i = 0; i < count; i++) {
        const source = part.sourceIndex[i] * 3;
        const dx = expression.deltas[source];
        const dy = expression.deltas[source + 1];
        const dz = expression.deltas[source + 2];
        if (Math.hypot(dx, dy, dz) < DELTA_EPSILON) continue;
        sparseIndices.push(i);
        sparseValues.push(Math.round(dx * QUANT), Math.round(dy * QUANT), Math.round(dz * QUANT));
      }
      if (sparseIndices.length === 0) continue;

      const indexView = builder.addView(
        count > 65535 ? new Uint32Array(sparseIndices) : new Uint16Array(sparseIndices)
      );
      const valueView = builder.addView(new Int16Array(sparseValues));
      const bounds = minMax(sparseValues, 3);
      targets.push({
        POSITION: builder.addAccessor({
          componentType: COMPONENT.SHORT,
          count,
          type: "VEC3",
          // Vertices outside the sparse set are zero.
          min: bounds.min.map(value => Math.min(0, value)),
          max: bounds.max.map(value => Math.max(0, value)),
          sparse: {
            count: sparseIndices.length,
            indices: {
              bufferView: indexView,
              componentType: count > 65535 ? COMPONENT.UINT : COMPONENT.USHORT,
            },
            values: { bufferView: valueView },
          },
        }),
      });
      targetNames.push(expression.name);
    }
  }

  const primitive = { attributes, indices, mode: 4 };
  const mesh = { name: part.name, primitives: [primitive] };
  if (targets.length) {
    primitive.targets = targets;
    mesh.weights = targets.map(() => 0);
    mesh.extras = { targetNames };
  }
  return mesh;
}

// ─── Part assembly ──────────────────────────────────────────────

/**
 * Collects the triangles of the given material groups into a mesh with its
 * own vertex numbering. Vertices are shared by position index only, so
 * normals stay smooth across UV seams.
 */
function buildPart(name, groupNames, topology, positions, normals, options = {}) {
  const origin = options.origin || [0, 0, 0];
  const remap = new Map();
  const part = { name, positions: [], normals: [], indices: [], sourceIndex: [] };
  if (options.uv) part.uvs = [];
  if (options.color) part.colors = [];

  for (const groupName of groupNames) {
    const corners = topology.groups.get(groupName);
    if (!corners) throw new Error(`Missing material group ${groupName}`);
    for (let i = 0; i < corners.length; i += 3) {
      const triangle = [corners[i], corners[i + 1], corners[i + 2]];
      if (options.keepTriangle && !options.keepTriangle(triangle)) continue;
      for (const corner of triangle) {
        let index = remap.get(corner.v);
        if (index === undefined) {
          index = part.sourceIndex.length;
          remap.set(corner.v, index);
          part.sourceIndex.push(corner.v);
          const p = corner.v * 3;
          const x = positions[p];
          const y = positions[p + 1];
          const z = positions[p + 2];
          part.positions.push(x - origin[0], y - origin[1], z - origin[2]);
          part.normals.push(normals[p], normals[p + 1], normals[p + 2]);
          if (options.uv) part.uvs.push(...options.uv(corner, x, y, z));
          if (options.color) part.colors.push(...options.color(corner, x, y, z));
        }
        part.indices.push(index);
      }
    }
  }
  return part;
}

/**
 * Centre of an eyeball and the direction of its corneal bulge.
 *
 * The centre is taken from the bounding box because the mesh is denser at
 * the front, which drags the vertex average forward. The cornea is the
 * point farthest from that centre.
 */
function eyeFrame(groupName, topology, positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const corners = topology.groups.get(groupName);
  for (const corner of corners) {
    for (let k = 0; k < 3; k++) {
      const value = positions[corner.v * 3 + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  const origin = min.map((value, k) => (value + max[k]) / 2);
  let axis = [0, 0, 1];
  let farthest = 0;
  for (const corner of corners) {
    const offset = origin.map((value, k) => positions[corner.v * 3 + k] - value);
    const distance = Math.hypot(...offset);
    if (offset[2] > 0 && distance > farthest) {
      farthest = distance;
      axis = offset.map(value => value / distance);
    }
  }
  return { origin, axis };
}

/**
 * How an eyeball has to be turned, and how large its iris drawn, for the
 * drawn iris to cover the one marked on the picture.
 *
 * The line of sight through the marked centre is followed to the surface of
 * the eyeball as it sits in the fitted head; the direction from the middle
 * of the eyeball to that point is where the cornea has to face. Returns the
 * turn in degrees from the eyeball's own forward axis (yaw toward the
 * viewer's right, pitch up, applied yaw first) and half the angle the iris
 * covers on the eyeball, in radians.
 *
 * `centre` is the middle of the eyeball in the fitted camera's world,
 * `radius` its radius there, `axis` the cornea's direction in the head's own
 * space and `rotation` the fitted head rotation.
 */
function irisPlacement(iris, centre, radius, axis, rotation) {
  const focal = 1 / Math.tan((FIT_FOV_DEG * Math.PI) / 360);
  // A point on the line of sight at a given depth in front of the camera.
  const sight = depth => [
    ((iris.x - 0.5) * 2 * depth) / focal,
    (-(iris.y - 0.5) * 2 * depth) / focal,
    FIT_CAMERA_DISTANCE - depth,
  ];
  // The line is p(depth) = eye + depth * step, with step = sight(1) - eye.
  const eye = [0, 0, FIT_CAMERA_DISTANCE];
  const step = sight(1).map((value, k) => value - eye[k]);
  const offset = eye.map((value, k) => value - centre[k]);
  const a = step.reduce((sum, value) => sum + value * value, 0);
  const b = 2 * step.reduce((sum, value, k) => sum + value * offset[k], 0);
  const c = offset.reduce((sum, value) => sum + value * value, 0) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  // Where the line meets the near side of the eyeball, or passes closest.
  const depth = discriminant > 0 ? (-b - Math.sqrt(discriminant)) / (2 * a) : -b / (2 * a);
  const outward = sight(depth).map((value, k) => value - centre[k]);
  const length = Math.hypot(...outward);
  // Back into the head's own space: the transpose of its rotation.
  const target = [0, 1, 2].map(
    col =>
      (rotation[col] * outward[0] +
        rotation[3 + col] * outward[1] +
        rotation[6 + col] * outward[2]) /
      length
  );

  const yawOf = direction => Math.atan2(direction[0], direction[2]);
  const pitchOf = direction => Math.asin(Math.max(-1, Math.min(1, direction[1])));
  // The eyeball turns by pitch about x, then by yaw about y.
  const turned = (yaw, pitch) => {
    const y = axis[1] * Math.cos(pitch) + axis[2] * Math.sin(pitch);
    const z = -axis[1] * Math.sin(pitch) + axis[2] * Math.cos(pitch);
    return [
      axis[0] * Math.cos(yaw) + z * Math.sin(yaw),
      y,
      -axis[0] * Math.sin(yaw) + z * Math.cos(yaw),
    ];
  };
  let yaw = yawOf(target) - yawOf(axis);
  let pitch = pitchOf(target) - pitchOf(axis);
  for (let pass = 0; pass < 20; pass++) {
    const now = turned(yaw, pitch);
    yaw += yawOf(target) - yawOf(now);
    pitch += pitchOf(target) - pitchOf(now);
  }

  const irisRadius = (iris.radius * 2 * depth) / focal;
  return {
    yawDeg: (yaw * 180) / Math.PI,
    pitchDeg: (pitch * 180) / Math.PI,
    irisAngle: Math.asin(Math.min(0.95, irisRadius / radius)),
  };
}

// ─── Fitting the head to the reference picture ──────────────────

/** Head rotation as a row-major 3x3: roll, then pitch (up positive), then yaw. */
function rotationMatrix(yaw, pitch, roll) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const multiply = (a, b) => {
    const out = new Array(9).fill(0);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        for (let k = 0; k < 3; k++) out[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
      }
    }
    return out;
  };
  return multiply(ry, multiply(rx, rz));
}

function rotate(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

function quaternionFromMatrix(m) {
  const trace = m[0] + m[4] + m[8];
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[7] - m[5]) * s;
    y = (m[2] - m[6]) * s;
    z = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/**
 * Where a point in scene units lands in the picture: x and y as fractions
 * of its width and height from the top-left corner, plus the distance from
 * the camera along its axis.
 */
function projectToPicture(x, y, z) {
  const focal = 1 / Math.tan((FIT_FOV_DEG * Math.PI) / 360);
  const depth = FIT_CAMERA_DISTANCE - z;
  return [0.5 + (0.5 * focal * x) / depth, 0.5 - (0.5 * focal * y) / depth, depth];
}

/** Solves the square system a·x = b in place by Gaussian elimination. */
function solveLinear(a, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    const diagonal = a[col][col] || 1e-12;
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / diagonal;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / (a[row][row] || 1e-12);
  }
  return x;
}

/**
 * Fits pose, identity and a few expression weights to the marked landmarks
 * with Levenberg-Marquardt.
 *
 * `identities` and `fitExpressions` are lists of full-mesh offsets (cm) from
 * the neutral head. Returns the solution and the remaining landmark error.
 */
function fitHead(marks, landmarkVertex, neutral, identities, fitExpressions) {
  const identityCount = identities.length;
  const expressionCount = fitExpressions.length;
  const POSE = 6;
  const parameterCount = POSE + identityCount + expressionCount;

  // Only the landmark vertices matter here; pull them out once.
  const at = (array, vertex) => [array[vertex * 3], array[vertex * 3 + 1], array[vertex * 3 + 2]];
  const points = marks.map(mark => {
    const vertex = landmarkVertex[mark.index];
    return {
      mark,
      base: at(neutral, vertex),
      identity: identities.map(deltas => at(deltas, vertex)),
      expression: fitExpressions.map(expression => at(expression.deltas, vertex)),
    };
  });

  const clamp = parameters => {
    for (let j = 0; j < expressionCount; j++) {
      const k = POSE + identityCount + j;
      parameters[k] = Math.max(0, Math.min(1, parameters[k]));
    }
    return parameters;
  };

  const residuals = parameters => {
    const matrix = rotationMatrix(parameters[0], parameters[1], parameters[2]);
    const out = [];
    for (const point of points) {
      const p = [...point.base];
      for (let k = 0; k < identityCount; k++) {
        const weight = parameters[POSE + k];
        for (let c = 0; c < 3; c++) p[c] += point.identity[k][c] * weight;
      }
      for (let j = 0; j < expressionCount; j++) {
        const weight = parameters[POSE + identityCount + j];
        for (let c = 0; c < 3; c++) p[c] += point.expression[j][c] * weight;
      }
      const world = rotate(matrix, p[0] * UNIT_SCALE, p[1] * UNIT_SCALE, p[2] * UNIT_SCALE);
      const [x, y] = projectToPicture(
        world[0] + parameters[3],
        world[1] + parameters[4],
        world[2] + parameters[5]
      );
      out.push((x - point.mark.x) * point.mark.weight, (y - point.mark.y) * point.mark.weight);
    }
    for (let k = 0; k < identityCount; k++) out.push(parameters[POSE + k] * FIT_IDENTITY_PRIOR);
    for (let j = 0; j < expressionCount; j++) {
      out.push(parameters[POSE + identityCount + j] * FIT_EXPRESSION_PRIOR);
    }
    return out;
  };
  const cost = values => values.reduce((sum, value) => sum + value * value, 0);

  let parameters = new Array(parameterCount).fill(0);
  let current = residuals(parameters);
  let currentCost = cost(current);
  let damping = 1e-3;

  for (let iteration = 0; iteration < 120; iteration++) {
    // Numerical Jacobian.
    const jacobian = [];
    for (let k = 0; k < parameterCount; k++) {
      const stepped = [...parameters];
      stepped[k] += 1e-5;
      const moved = residuals(stepped);
      jacobian.push(moved.map((value, row) => (value - current[row]) / 1e-5));
    }
    const normal = [];
    const gradient = [];
    for (let a = 0; a < parameterCount; a++) {
      normal.push(new Array(parameterCount).fill(0));
      gradient.push(-jacobian[a].reduce((sum, value, row) => sum + value * current[row], 0));
      for (let b = 0; b <= a; b++) {
        let sum = 0;
        for (let row = 0; row < current.length; row++) sum += jacobian[a][row] * jacobian[b][row];
        normal[a][b] = sum;
      }
    }
    for (let a = 0; a < parameterCount; a++) {
      for (let b = a + 1; b < parameterCount; b++) normal[a][b] = normal[b][a];
    }

    let improved = false;
    for (let attempt = 0; attempt < 10 && !improved; attempt++) {
      const damped = normal.map((row, a) =>
        row.map((value, b) => (a === b ? value * (1 + damping) + 1e-12 : value))
      );
      const step = solveLinear(damped, [...gradient]);
      const candidate = clamp(parameters.map((value, k) => value + step[k]));
      const candidateResiduals = residuals(candidate);
      const candidateCost = cost(candidateResiduals);
      if (candidateCost < currentCost) {
        improved = currentCost - candidateCost > 1e-14;
        parameters = candidate;
        current = candidateResiduals;
        currentCost = candidateCost;
        damping = Math.max(1e-9, damping / 3);
        if (!improved) break;
      } else {
        damping *= 4;
      }
    }
    if (!improved) break;
  }

  // Unweighted landmark error, as a fraction of the picture's width.
  const unweighted = residuals(parameters).slice(0, points.length * 2);
  let squared = 0;
  points.forEach((point, index) => {
    const dx = unweighted[index * 2] / point.mark.weight;
    const dy = unweighted[index * 2 + 1] / point.mark.weight;
    squared += dx * dx + dy * dy;
  });

  return {
    yaw: parameters[0],
    pitch: parameters[1],
    roll: parameters[2],
    translation: [parameters[3], parameters[4], parameters[5]],
    identityWeights: parameters.slice(POSE, POSE + identityCount),
    expressionWeights: parameters.slice(POSE + identityCount),
    error: Math.sqrt(squared / points.length),
  };
}

// ─── Projecting the picture onto the head ───────────────────────

/**
 * Works out where each skin vertex falls in the reference picture, and how
 * far that can be trusted.
 *
 * A vertex is trusted where the picture really shows it: it faces the
 * camera and nothing is in front of it. Elsewhere (the far side of the
 * nose, under the chin, the back of the head) the straight projection would
 * pick up whatever lies behind, so those vertices instead take coordinates
 * spread outward from their trusted neighbours, which extends the painted
 * skin around the corner.
 *
 * `world` holds the fitted positions of every source vertex in scene units.
 */
function projectPicture(part, world, worldNormals) {
  const count = part.sourceIndex.length;
  const projected = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const source = part.sourceIndex[i] * 3;
    projected.set(projectToPicture(world[source], world[source + 1], world[source + 2]), i * 3);
  }

  // Depth buffer from the fitted camera.
  const size = VISIBILITY_SIZE;
  const depthBuffer = new Float32Array(size * size).fill(Infinity);
  for (let t = 0; t < part.indices.length; t += 3) {
    const a = part.indices[t] * 3;
    const b = part.indices[t + 1] * 3;
    const c = part.indices[t + 2] * 3;
    const ax = projected[a] * size;
    const ay = projected[a + 1] * size;
    const bx = projected[b] * size;
    const by = projected[b + 1] * size;
    const cx = projected[c] * size;
    const cy = projected[c + 1] * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const wa = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
        const wb = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const depth = wa * projected[a + 2] + wb * projected[b + 2] + wc * projected[c + 2];
        if (depth < depthBuffer[y * size + x]) depthBuffer[y * size + x] = depth;
      }
    }
  }

  const trust = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const source = part.sourceIndex[i] * 3;
    // Direction from the vertex to the camera.
    const toCamera = [-world[source], -world[source + 1], FIT_CAMERA_DISTANCE - world[source + 2]];
    const length = Math.hypot(...toCamera);
    const facing =
      (worldNormals[source] * toCamera[0] +
        worldNormals[source + 1] * toCamera[1] +
        worldNormals[source + 2] * toCamera[2]) /
      length;
    const px = Math.floor(projected[i * 3] * size);
    const py = Math.floor(projected[i * 3 + 1] * size);
    let hidden = false;
    if (px >= 0 && py >= 0 && px < size && py < size) {
      // 4 mm of slack, so a surface does not hide itself.
      hidden = projected[i * 3 + 2] > depthBuffer[py * size + px] + 0.04;
    }
    trust[i] = hidden ? 0 : smoothstep(0.1, 0.38, facing);
  }

  // Spread coordinates outward from the fully trusted vertices.
  const neighbours = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }
  let spread = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    spread[i * 2] = projected[i * 3];
    spread[i * 2 + 1] = projected[i * 3 + 1];
  }
  for (let pass = 0; pass < 400; pass++) {
    const next = Float64Array.from(spread);
    for (let i = 0; i < count; i++) {
      if (trust[i] >= 0.999 || neighbours[i].size === 0) continue;
      let u = 0;
      let v = 0;
      for (const other of neighbours[i]) {
        u += spread[other * 2];
        v += spread[other * 2 + 1];
      }
      next[i * 2] = u / neighbours[i].size;
      next[i * 2 + 1] = v / neighbours[i].size;
    }
    spread = next;
  }

  const uvs = new Array(count * 2);
  for (let i = 0; i < count; i++) {
    const weight = trust[i];
    uvs[i * 2] = projected[i * 3] * weight + spread[i * 2] * (1 - weight);
    // glTF texture coordinates run down from the top, as the picture does.
    uvs[i * 2 + 1] = projected[i * 3 + 1] * weight + spread[i * 2 + 1] * (1 - weight);
  }
  return { uvs, trust, projected };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const indexFile = await fetchCached("FaceXModel/vertex_indices.json");
  const vertexIndex = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const neutralFile = await fetchCached("FaceXModel/generic_neutral_mesh.obj");
  const landmarkVertex = vertexIndex.idx_to_landmark_verts;

  const neutral = parseObjPositions(neutralFile);
  const topology = parseObjTopology(neutralFile);

  const loadOffsets = async name => {
    const shape = parseObjPositions(await fetchCached(`FaceXModel/${name}.obj`));
    if (shape.length !== neutral.length) throw new Error(`Vertex count mismatch in ${name}`);
    const deltas = new Float32Array(shape.length);
    for (let i = 0; i < shape.length; i++) deltas[i] = shape[i] - neutral[i];
    return deltas;
  };

  // The model is linear: a head is the neutral mesh plus weighted identity
  // offsets plus weighted expression offsets.
  const identities = [];
  for (let index = 0; index < FIT_IDENTITY_COUNT; index++) {
    identities.push(await loadOffsets(`identity${String(index).padStart(3, "0")}`));
  }
  const expressions = [];
  for (const name of vertexIndex.expressions) {
    expressions.push({ name: arkitName(name), deltas: await loadOffsets(name) });
  }

  // Fit the head to the picture.
  const face = JSON.parse(fs.readFileSync(faceFile, "utf8"));
  const marks = face.landmarks;
  const fitExpressions = FIT_EXPRESSIONS.map(name => {
    const expression = expressions.find(candidate => candidate.name === name);
    if (!expression) throw new Error(`Unknown expression ${name}`);
    return expression;
  });
  const fit = fitHead(marks, landmarkVertex, neutral, identities, fitExpressions);
  const rotation = rotationMatrix(fit.yaw, fit.pitch, fit.roll);

  const positions = Float64Array.from(neutral);
  fit.identityWeights.forEach((weight, index) => {
    for (let i = 0; i < positions.length; i++) positions[i] += identities[index][i] * weight;
  });

  // The head as the picture shows it: restyled, in the fitted expression.
  const posed = Float64Array.from(positions);
  fit.expressionWeights.forEach((weight, index) => {
    if (weight === 0) return;
    const { deltas } = fitExpressions[index];
    for (let i = 0; i < posed.length; i++) posed[i] += deltas[i] * weight;
  });

  // The fitted eyes need not be as tall as the neutral ones, so the kit's
  // blink may no longer bring the lids together. Rescale each blink until
  // the lid landmarks meet, so a weight of 1 is a closed eye again.
  const lidPairs = {
    eyeBlinkLeft: [
      [43, 47],
      [44, 46],
    ],
    eyeBlinkRight: [
      [37, 41],
      [38, 40],
    ],
  };
  const restWeights = {};
  fit.expressionWeights.forEach((weight, index) => {
    if (weight > 0.001) restWeights[fitExpressions[index].name] = weight;
  });
  for (const expression of expressions) {
    const pairs = lidPairs[expression.name];
    if (!pairs) continue;
    let open = 0;
    let closed = 0;
    for (const [upper, lower] of pairs) {
      const a = landmarkVertex[upper] * 3 + 1;
      const b = landmarkVertex[lower] * 3 + 1;
      open += positions[a] - positions[b];
      closed += positions[a] + expression.deltas[a] - (positions[b] + expression.deltas[b]);
    }
    const stretch = open / (open - closed);
    for (let i = 0; i < expression.deltas.length; i++) expression.deltas[i] *= stretch;
    if (restWeights[expression.name]) restWeights[expression.name] /= stretch;
  }

  const skinGroups = ["M_Face", "M_BackHead"];
  const skinCorners = skinGroups.flatMap(groupName => topology.groups.get(groupName));
  const skinNormals = computeNormals(positions, skinCorners);

  // Positions and normals of the posed head in the fitted camera's world.
  const world = new Float64Array(posed.length);
  for (let i = 0; i < posed.length; i += 3) {
    const turned = rotate(
      rotation,
      posed[i] * UNIT_SCALE,
      posed[i + 1] * UNIT_SCALE,
      posed[i + 2] * UNIT_SCALE
    );
    world[i] = turned[0] + fit.translation[0];
    world[i + 1] = turned[1] + fit.translation[1];
    world[i + 2] = turned[2] + fit.translation[2];
  }
  const posedNormals = computeNormals(posed, skinCorners);
  const worldNormals = new Float64Array(posedNormals.length);
  for (let i = 0; i < posedNormals.length; i += 3) {
    worldNormals.set(
      rotate(rotation, posedNormals[i], posedNormals[i + 1], posedNormals[i + 2]),
      i
    );
  }

  // The first 9409 + 1839 vertices are the face and the skull/neck; the
  // rest of the skin material is the mouth and eye sockets.
  const SOCKET_START = 11248;

  const skin = buildPart("skin", skinGroups, topology, positions, skinNormals, {
    uv: (_corner, x, y, z) => faceUv(x, y, z),
  });
  const picture = projectPicture(skin, world, worldNormals);
  skin.pictureUvs = picture.uvs;
  // How far each vertex travels in a blink, relative to the lid margin,
  // which travels furthest. It tells the renderer which skin is eyelid.
  const blinks = expressions.filter(expression => lidPairs[expression.name]);
  const lidTravel = new Float64Array(skin.sourceIndex.length);
  let furthest = 0;
  for (let i = 0; i < lidTravel.length; i++) {
    const source = skin.sourceIndex[i] * 3;
    for (const { deltas } of blinks) {
      lidTravel[i] += Math.hypot(deltas[source], deltas[source + 1], deltas[source + 2]);
    }
    furthest = Math.max(furthest, lidTravel[i]);
  }

  skin.colors = [];
  for (let i = 0; i < skin.sourceIndex.length; i++) {
    const socket = skin.sourceIndex[i] >= SOCKET_START ? 1 : 0;
    // Glyphs only belong on the front of the head.
    const front = smoothstep(-0.5, 1.5, skin.positions[i * 3 + 2] - UV_AXIS_Z);
    skin.colors.push(socket, picture.trust[i], front, lidTravel[i] / furthest);
  }

  const teeth = buildPart(
    "teeth",
    ["M_Teeth"],
    topology,
    positions,
    computeNormals(positions, topology.groups.get("M_Teeth"))
  );

  // Only the outer shell of each eyeball is kept; the iris is drawn in the
  // shader, so the kit's inner iris layer is not needed.
  const eyes = [
    { name: "eyeL", group: "M_ScleraLeft" },
    { name: "eyeR", group: "M_ScleraRight" },
  ].map(eye => {
    const { origin } = eyeFrame(eye.group, topology, positions);
    // Read the cornea direction off the undeformed eyeball, where the bulge
    // is cleanest.
    const { axis } = eyeFrame(eye.group, topology, neutral);
    const corners = topology.groups.get(eye.group);
    const part = buildPart(
      eye.name,
      [eye.group],
      topology,
      positions,
      computeNormals(positions, corners),
      { origin }
    );
    // Eyeballs turn rigidly on their nodes rather than through morphs.
    delete part.sourceIndex;

    // Where this eyeball sits in the fitted camera's world, and its radius
    // there: the usual distance of its surface from its middle.
    const turned = rotate(rotation, ...origin.map(value => value * UNIT_SCALE));
    const centre = turned.map((value, k) => value + fit.translation[k]);
    const distances = [];
    for (let i = 0; i < part.positions.length; i += 3) {
      distances.push(Math.hypot(part.positions[i], part.positions[i + 1], part.positions[i + 2]));
    }
    distances.sort((a, b) => a - b);
    const radius = distances[distances.length >> 1] * UNIT_SCALE;
    // The marked iris that belongs to this eye is the one nearest to it in
    // the picture.
    const [centreX, centreY] = projectToPicture(...centre);
    const iris = face.irises.reduce((best, candidate) =>
      Math.hypot(candidate.x - centreX, candidate.y - centreY) <
      Math.hypot(best.x - centreX, best.y - centreY)
        ? candidate
        : best
    );
    const placement = irisPlacement(iris, centre, radius, axis, rotation);

    const round = value => Math.round(value * 10000) / 10000;
    return {
      part,
      origin,
      extras: {
        axis: axis.map(round),
        // The turn and iris size that put the drawn iris over the marked one.
        iris: {
          yawDeg: round(placement.yawDeg),
          pitchDeg: round(placement.pitchDeg),
          angle: round(placement.irisAngle),
        },
      },
    };
  });

  const builder = new GlbBuilder();
  const scale = UNIT_SCALE / QUANT;
  const meshes = [];
  const nodes = [];
  const addNode = (part, origin = [0, 0, 0], extras = undefined) => {
    meshes.push(addMesh(builder, part, expressions));
    nodes.push({
      name: part.name,
      mesh: meshes.length - 1,
      translation: origin.map(value => value * UNIT_SCALE),
      scale: [scale, scale, scale],
      ...(extras ? { extras } : {}),
    });
  };
  addNode(skin);
  addNode(teeth);
  for (const eye of eyes) addNode(eye.part, eye.origin, eye.extras);

  const round = value => Math.round(value * 10000) / 10000;
  const landmarks = landmarkVertex.map(vertex => {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const [u, v] = faceUv(x, y, z);
    return [
      round(u),
      round(v),
      round(x * UNIT_SCALE),
      round(y * UNIT_SCALE),
      round(z * UNIT_SCALE),
    ];
  });

  // Which way the fitted head faces, for aiming the eyes.
  const forward = rotate(rotation, 0, 0, 1);
  const degrees = radians => (radians * 180) / Math.PI;

  builder.write(outFile, {
    asset: { version: "2.0", generator: "bake-face.mjs", copyright: COPYRIGHT },
    extensionsUsed: ["KHR_mesh_quantization"],
    extensionsRequired: ["KHR_mesh_quantization"],
    scene: 0,
    scenes: [
      {
        name: faceName[0].toUpperCase() + faceName.slice(1),
        nodes: nodes.map((_node, index) => index),
        extras: {
          // 68-point facial landmarks as [u, v, x, y, z]: glyph-texture
          // coordinates followed by the position in scene units.
          landmarks,
          // The pose in which the head matches the reference picture, seen
          // by a camera `cameraDistance` up the z axis looking at the origin.
          fit: {
            fovDeg: FIT_FOV_DEG,
            cameraDistance: FIT_CAMERA_DISTANCE,
            rotation: quaternionFromMatrix(rotation).map(round),
            translation: fit.translation.map(round),
            yawDeg: round(degrees(Math.atan2(forward[0], forward[2]))),
            pitchDeg: round(degrees(Math.asin(forward[1]))),
            // Expression weights that complete the match.
            restWeights: Object.fromEntries(
              Object.entries(restWeights).map(([name, weight]) => [name, round(weight)])
            ),
          },
        },
      },
    ],
    nodes,
    meshes,
  });

  const size = fs.statSync(outFile).size;
  console.log(`Wrote ${outFile} (${(size / 1024).toFixed(0)} kB)`);
  for (const mesh of meshes) {
    const primitive = mesh.primitives[0];
    console.log(
      `  ${mesh.name.padEnd(7)} ${String(builder.accessors[primitive.attributes.POSITION].count).padStart(6)} vertices, ` +
        `${builder.accessors[primitive.indices].count / 3} triangles, ` +
        `${primitive.targets ? primitive.targets.length : 0} morph targets`
    );
  }
  console.log(
    `  fit: yaw ${degrees(fit.yaw).toFixed(1)}°, pitch ${degrees(fit.pitch).toFixed(1)}°, ` +
      `roll ${degrees(fit.roll).toFixed(1)}°, landmark error ${(fit.error * 100).toFixed(2)}% of width`
  );
  console.log(`  identity: ${fit.identityWeights.map(weight => weight.toFixed(1)).join(" ")}`);
  console.log(
    `  expression: ${
      Object.entries(restWeights)
        .map(([name, weight]) => `${name} ${weight.toFixed(2)}`)
        .join(", ") || "neutral"
    }`
  );

  if (debugFile) {
    // Enough to draw the fit over the picture and judge it by eye.
    const matrixed = marks.map(mark => {
      const source = landmarkVertex[mark.index] * 3;
      const [x, y] = projectToPicture(world[source], world[source + 1], world[source + 2]);
      return { index: mark.index, marked: [mark.x, mark.y], fitted: [round(x), round(y)] };
    });
    const edges = [];
    for (let t = 0; t < skin.indices.length; t += 3) {
      const corners = [skin.indices[t], skin.indices[t + 1], skin.indices[t + 2]];
      if (corners.some(corner => picture.trust[corner] < 0.5)) continue;
      if (skin.sourceIndex[corners[0]] >= SOCKET_START) continue;
      for (let k = 0; k < 3; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 3];
        if (a < b) {
          edges.push([
            round(picture.projected[a * 3]),
            round(picture.projected[a * 3 + 1]),
            round(picture.projected[b * 3]),
            round(picture.projected[b * 3 + 1]),
          ]);
        }
      }
    }
    fs.writeFileSync(debugFile, JSON.stringify({ landmarks: matrixed, edges }));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
