// Face region geometry.
//
// Regions are defined as rotated ellipses anchored to a handful of landmarks we
// can rely on, rather than as polygons over the full 478-point mesh. Two
// reasons: the anchor points are stable across head pose, and the ellipses get
// intersected with the segmenter's face-skin mask anyway, so eyebrows, lips and
// stray hair are removed automatically. Anything the mask rejects never reaches
// a metric.

import { CALIBRATION } from './calibration.js';

// MediaPipe names sides in IMAGE space: L is the viewer's left, which is the
// subject's right. Kept as image space throughout so it matches the canvas.
export const LM = {
  FOREHEAD_TOP: 10,
  NASION: 168,
  NOSE_TIP: 1,
  CHIN: 152,
  EYE_L_OUT: 33,
  EYE_L_IN: 133,
  EYE_R_IN: 362,
  EYE_R_OUT: 263,
  MOUTH_L: 61,
  MOUTH_R: 291,
  FACE_L: 234,
  FACE_R: 454,
  IRIS_L: [468, 469, 470, 471, 472],
  IRIS_R: [473, 474, 475, 476, 477],
};

export const SEG_CLASS = {
  BACKGROUND: 0,
  HAIR: 1,
  BODY_SKIN: 2,
  FACE_SKIN: 3,
  CLOTHES: 4,
  OTHER: 5,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Converts MediaPipe's normalised landmarks into pixel coordinates.
export function toPixels(landmarks, width, height) {
  return landmarks.map((p) => [p.x * width, p.y * height]);
}

// Horizontal iris diameter is ~11.7mm in adults and barely varies with age,
// ethnicity or sex, which makes it the cheapest real-world ruler available in a
// selfie. Everything measured in millimetres downstream depends on this.
const IRIS_DIAMETER_MM = 11.7;

export function millimetresPerPixel(P) {
  const radii = [];
  for (const ring of [LM.IRIS_L, LM.IRIS_R]) {
    const [c, ...edge] = ring;
    if (!P[c] || edge.some((i) => !P[i])) continue;
    for (const i of edge) radii.push(dist(P[c], P[i]));
  }
  if (!radii.length) return null;
  const meanRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
  return IRIS_DIAMETER_MM / (meanRadius * 2);
}

export function faceFrame(P) {
  const up = norm(sub(P[LM.FOREHEAD_TOP], P[LM.CHIN]));
  const right = norm(sub(P[LM.FACE_R], P[LM.FACE_L]));
  return {
    up,
    down: mul(up, -1),
    right,
    eyeSpan: dist(P[LM.EYE_L_OUT], P[LM.EYE_R_OUT]),
    faceHeight: dist(P[LM.FOREHEAD_TOP], P[LM.CHIN]),
    faceWidth: dist(P[LM.FACE_L], P[LM.FACE_R]),
    rollRadians: Math.atan2(right[1], right[0]),
  };
}

function insideEllipse(r, x, y) {
  const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
  const dx = x - r.cx, dy = y - r.cy;
  const u = (dx * cos - dy * sin) / r.rx;
  const v = (dx * sin + dy * cos) / r.ry;
  return u * u + v * v <= 1;
}

// Features the segmenter happily labels "face skin" that are not skin, or are
// skin that no lesion metric should look at: eyes, brows, lips, nostrils. Left
// in, each one reads as a large dark blob — the eyes alone would dominate every
// spot count on the face.
function buildExclusions(P) {
  const f = faceFrame(P);
  const e = f.eyeSpan;
  const eyeMidL = mid(P[LM.EYE_L_OUT], P[LM.EYE_L_IN]);
  const eyeMidR = mid(P[LM.EYE_R_OUT], P[LM.EYE_R_IN]);
  const browBand = mid(add(eyeMidL, mul(f.up, e * 0.11)), add(eyeMidR, mul(f.up, e * 0.11)));
  const mouthMid = mid(P[LM.MOUTH_L], P[LM.MOUTH_R]);
  const rot = f.rollRadians;
  return [
    ellipse('exEyeL', eyeMidL, dist(P[LM.EYE_L_OUT], P[LM.EYE_L_IN]) * 0.85, e * 0.085, rot),
    ellipse('exEyeR', eyeMidR, dist(P[LM.EYE_R_OUT], P[LM.EYE_R_IN]) * 0.85, e * 0.085, rot),
    ellipse('exBrows', browBand, e * 0.46, e * 0.075, rot),
    ellipse('exMouth', mouthMid, dist(P[LM.MOUTH_L], P[LM.MOUTH_R]) * 0.80, e * 0.11, rot),
    ellipse('exNostrils', add(P[LM.NOSE_TIP], mul(f.down, e * 0.035)), e * 0.10, e * 0.05, rot),
  ];
}

function ellipse(name, center, rx, ry, rot, requires) {
  return { name, cx: center[0], cy: center[1], rx, ry, rot, requires };
}

export function buildRegions(P) {
  const f = faceFrame(P);
  const e = f.eyeSpan;
  const h = f.faceHeight;
  const skin = SEG_CLASS.FACE_SKIN;
  const down = (k) => mul(f.down, k);

  const eyeMidL = mid(P[LM.EYE_L_OUT], P[LM.EYE_L_IN]);
  const eyeMidR = mid(P[LM.EYE_R_OUT], P[LM.EYE_R_IN]);
  const mouthMid = mid(P[LM.MOUTH_L], P[LM.MOUTH_R]);

  const regions = [
    ellipse('forehead', lerp(P[LM.NASION], P[LM.FOREHEAD_TOP], 0.60), e * 0.30, h * 0.070, f.rollRadians, skin),
    ellipse('glabella', lerp(P[LM.NASION], P[LM.FOREHEAD_TOP], 0.12), e * 0.12, h * 0.035, f.rollRadians, skin),
    ellipse('nose', lerp(P[LM.NASION], P[LM.NOSE_TIP], 0.78), e * 0.13, h * 0.055, f.rollRadians, skin),
    ellipse('cheekL', lerp(mid(P[LM.EYE_L_OUT], P[LM.MOUTH_L]), P[LM.FACE_L], 0.28), e * 0.15, h * 0.085, f.rollRadians, skin),
    ellipse('cheekR', lerp(mid(P[LM.EYE_R_OUT], P[LM.MOUTH_R]), P[LM.FACE_R], 0.28), e * 0.15, h * 0.085, f.rollRadians, skin),
    ellipse('underEyeL', add(eyeMidL, down(e * 0.085)), dist(P[LM.EYE_L_OUT], P[LM.EYE_L_IN]) * 0.44, e * 0.038, f.rollRadians, skin),
    ellipse('underEyeR', add(eyeMidR, down(e * 0.085)), dist(P[LM.EYE_R_OUT], P[LM.EYE_R_IN]) * 0.44, e * 0.038, f.rollRadians, skin),
    ellipse('chin', lerp(P[LM.CHIN], mouthMid, 0.38), e * 0.14, h * 0.050, f.rollRadians, skin),

    // Line regions. Narrow patches placed where expression lines actually form,
    // each rotated so its long axis follows the direction the lines run — the
    // nasolabial ellipses take their angle from the landmarks themselves rather
    // than from a hardcoded guess.
    ellipse('crowsFeetL', add(add(P[LM.EYE_L_OUT], mul(f.right, -e * 0.080)), down(e * 0.020)), e * 0.042, e * 0.046, f.rollRadians, skin),
    ellipse('crowsFeetR', add(add(P[LM.EYE_R_OUT], mul(f.right, e * 0.080)), down(e * 0.020)), e * 0.042, e * 0.046, f.rollRadians, skin),
    ellipse('nasolabialL', add(lerp(P[LM.NOSE_TIP], P[LM.MOUTH_L], 0.55), mul(f.right, -e * 0.02)), e * 0.060, e * 0.028, angleOf(sub(P[LM.MOUTH_L], P[LM.NOSE_TIP])), skin),
    ellipse('nasolabialR', add(lerp(P[LM.NOSE_TIP], P[LM.MOUTH_R], 0.55), mul(f.right, e * 0.02)), e * 0.060, e * 0.028, angleOf(sub(P[LM.MOUTH_R], P[LM.NOSE_TIP])), skin),
  ];

  // The segmenter labels eyelids and lashes as "face skin", and lashes are the
  // most anisotropic thing on a face — exactly what the line detector hunts for.
  // Left unguarded they read as severe crow's feet on a completely unlined face,
  // which is what the first real capture did. Same for lips against nasolabial.
  // Targeted, not blanket. Applying all five exclusion zones to every line
  // region deleted the crow's-feet samples outright — the wide brow band
  // swallowed them, and a region under ~120 usable pixels is dropped, so
  // eyeAreaLines silently vanished from the output. Each region now rejects
  // only the features that can actually contaminate it.
  const zones = Object.fromEntries(buildExclusions(P).map((z) => [z.name, z]));
  const byRegion = {
    crowsFeetL: [zones.exEyeL, zones.exEyeR],
    crowsFeetR: [zones.exEyeL, zones.exEyeR],
    nasolabialL: [zones.exMouth, zones.exNostrils],
    nasolabialR: [zones.exMouth, zones.exNostrils],
    forehead: [zones.exBrows],
  };
  for (const r of regions) {
    if (byRegion[r.name]) r.excludeZones = byRegion[r.name];
  }
  return regions;
}

export const angleOf = (v) => Math.atan2(v[1], v[0]);

// Every pixel of visible facial skin, minus the exclusions above.
//
// Lesion counting needs this rather than the region ellipses. The ellipses
// exist to support region-VERSUS-region colour comparisons and deliberately
// cover only small representative patches; counting spots over them misses most
// of the face. Measured directly: recall went from 38% to full coverage purely
// by changing what area was searched.
export function buildFaceSkinSample(P, mask, frameW, frameH) {
  const f = faceFrame(P);
  const centre = mid(P[LM.FOREHEAD_TOP], P[LM.CHIN]);
  const oval = ellipse('faceOval', centre, f.faceWidth * 0.54, f.faceHeight * 0.56, f.rollRadians);
  const exclusions = buildExclusions(P);

  const reach = Math.hypot(oval.rx, oval.ry);
  const x0 = Math.max(0, Math.floor(oval.cx - reach));
  const x1 = Math.min(frameW - 1, Math.ceil(oval.cx + reach));
  const y0 = Math.max(0, Math.floor(oval.cy - reach));
  const y1 = Math.min(frameH - 1, Math.ceil(oval.cy + reach));

  const idx = [];
  let bx0 = frameW, by0 = frameH, bx1 = 0, by1 = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!insideEllipse(oval, x, y)) continue;
      if (maskClassAt(mask, x, y, frameW, frameH) !== SEG_CLASS.FACE_SKIN) continue;
      if (classNearby(mask, x, y, frameW, frameH, SEG_CLASS.HAIR)) continue;
      if (exclusions.some((ex) => insideEllipse(ex, x, y))) continue;
      idx.push(y * frameW + x);
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }

  return {
    name: 'faceSkin',
    indices: Int32Array.from(idx),
    bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    reliable: idx.length >= CALIBRATION.quality.minRegionPixels * 8,
    exclusions,
  };
}

// Direction the lines are expected to run in each region, in image space, so
// head tilt does not turn a real wrinkle into a rejected one.
export function expectedLineAngles(P) {
  const f = faceFrame(P);
  const horizontal = angleOf(f.right);
  return {
    forehead: horizontal,
    crowsFeetL: horizontal,
    crowsFeetR: horizontal,
    nasolabialL: angleOf(sub(P[LM.MOUTH_L], P[LM.NOSE_TIP])),
    nasolabialR: angleOf(sub(P[LM.MOUTH_R], P[LM.NOSE_TIP])),
  };
}

export const GROUPS = {
  tZone: ['forehead', 'glabella', 'nose'],
  cheeks: ['cheekL', 'cheekR'],
  underEye: ['underEyeL', 'underEyeR'],
  // Forehead doubles as the low-vascularity reference for redness: it has the
  // fewest superficial capillaries of any large flat patch on the face.
  rednessReference: ['forehead'],
  allSkin: ['forehead', 'glabella', 'nose', 'cheekL', 'cheekR', 'chin'],
  lines: ['forehead', 'crowsFeetL', 'crowsFeetR', 'nasolabialL', 'nasolabialR'],
};

// Reads the segmenter mask, which may be at a different resolution than the
// frame, at frame coordinates.
export function maskClassAt(mask, x, y, frameW, frameH) {
  if (!mask) return SEG_CLASS.FACE_SKIN; // no mask -> accept everything
  const mx = Math.min(mask.width - 1, Math.max(0, (x * mask.width / frameW) | 0));
  const my = Math.min(mask.height - 1, Math.max(0, (y * mask.height / frameH) | 0));
  return mask.data[my * mask.width + mx];
}

// True if any pixel within `radius` mask-cells is the given class.
//
// The segmenter runs at 256x256, far too coarse to resolve an individual hair.
// Wispy fringe strands lying across the forehead therefore come back labelled
// "face skin", and fine strands are the most line-like texture on a face — they
// drove a false fineLines 0.87 on a real capture. Rejecting skin pixels that sit
// NEAR hair costs one cheap neighbourhood check and removes the whole class of
// error, for lines and lesions alike.
export function classNearby(mask, x, y, frameW, frameH, cls, radius = 1) {
  if (!mask) return false;
  const mx = (x * mask.width / frameW) | 0;
  const my = (y * mask.height / frameH) | 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = mx + dx, ny = my + dy;
      if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
      if (mask.data[ny * mask.width + nx] === cls) return true;
    }
  }
  return false;
}

// Collects the frame-buffer indices of every pixel inside an ellipse that the
// mask also agrees is the right material.
export function sampleRegion(region, mask, frameW, frameH) {
  const { cx, cy, rx, ry, rot, requires } = region;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const reach = Math.hypot(rx, ry);
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(frameW - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(frameH - 1, Math.ceil(cy + reach));

  const idx = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const u = (dx * cos - dy * sin) / rx;
      const v = (dx * sin + dy * cos) / ry;
      if (u * u + v * v > 1) continue;
      if (requires !== undefined && maskClassAt(mask, x, y, frameW, frameH) !== requires) continue;
      if (requires === SEG_CLASS.FACE_SKIN && classNearby(mask, x, y, frameW, frameH, SEG_CLASS.HAIR)) continue;
      if (region.excludeZones?.some((z) => insideEllipse(z, x, y))) continue;
      idx.push(y * frameW + x);
    }
  }

  return {
    name: region.name,
    indices: Int32Array.from(idx),
    bbox: { x0, y0, x1, y1 },
    reliable: idx.length >= CALIBRATION.quality.minRegionPixels,
  };
}

export function sampleAll(regions, mask, frameW, frameH) {
  const out = {};
  for (const r of regions) out[r.name] = sampleRegion(r, mask, frameW, frameH);
  return out;
}

export function mergeSamples(samples, names) {
  const parts = names.map((n) => samples[n]).filter((s) => s && s.reliable);
  if (!parts.length) return { name: names.join('+'), indices: new Int32Array(0), reliable: false };
  const total = parts.reduce((a, p) => a + p.indices.length, 0);
  const merged = new Int32Array(total);
  let o = 0;
  for (const p of parts) { merged.set(p.indices, o); o += p.indices.length; }
  const bbox = {
    x0: Math.min(...parts.map((p) => p.bbox.x0)),
    y0: Math.min(...parts.map((p) => p.bbox.y0)),
    x1: Math.max(...parts.map((p) => p.bbox.x1)),
    y1: Math.max(...parts.map((p) => p.bbox.y1)),
  };
  return { name: names.join('+'), indices: merged, bbox, reliable: true };
}

// Maps every sampled pixel back to the region it came from, so a lesion found
// on the merged skin plane can report where on the face it actually is.
export function regionLookup(samples, names, frameW, frameH) {
  const map = new Int8Array(frameW * frameH).fill(-1);
  names.forEach((name, id) => {
    const s = samples[name];
    if (!s?.reliable) return;
    for (let k = 0; k < s.indices.length; k++) map[s.indices[k]] = id;
  });
  return { map, names };
}
