// Capture-quality gates.
//
// This module exists because the failure mode of every consumer skin scanner is
// not a bad model, it is a bad photo. Warm indoor light reads as redness; a
// slightly turned head makes one cheek darker than the other; motion blur
// destroys any texture measurement. Rather than silently returning confident
// nonsense we measure the capture itself and refuse or downweight.

import { CALIBRATION } from './calibration.js';
import { LM, faceFrame, dist, maskClassAt, SEG_CLASS } from './regions.js';

const Q = CALIBRATION.quality;

function laplacianVariance(data, w, h, bbox) {
  const x0 = Math.max(1, bbox.x0), x1 = Math.min(w - 2, bbox.x1);
  const y0 = Math.max(1, bbox.y0), y1 = Math.min(h - 2, bbox.y1);
  let sum = 0, sumSq = 0, n = 0;
  const grey = (i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const lap = 4 * grey(i) - grey(i - 1) - grey(i + 1) - grey(i - w) - grey(i + w);
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n < 2) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function exposureStats(data, w, h, mask) {
  let clipped = 0, n = 0, rSum = 0, gSum = 0, bSum = 0;
  const step = 2; // every other pixel is plenty for a global statistic
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (maskClassAt(mask, x, y, w, h) !== SEG_CLASS.FACE_SKIN) continue;
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r <= 2 || g <= 2 || b <= 2 || r >= 253 || g >= 253 || b >= 253) clipped++;
      rSum += r; gSum += g; bSum += b; n++;
    }
  }
  if (!n) return { clippedFraction: 1, meanRGB: [0, 0, 0], sampled: 0 };
  return {
    clippedFraction: clipped / n,
    meanRGB: [rSum / n, gSum / n, bSum / n],
    sampled: n,
  };
}

export function assessCapture(imageData, P, mask) {
  const { width: w, height: h, data } = imageData;
  const f = faceFrame(P);
  const warnings = [];

  const faceWidthFraction = f.faceWidth / w;
  if (faceWidthFraction < Q.minFaceWidthFraction) {
    warnings.push({ code: 'face-too-small', hint: 'Move closer — the face should fill most of the frame.' });
  }

  const bbox = {
    x0: Math.max(0, Math.floor(P[LM.FACE_L][0])),
    x1: Math.min(w - 1, Math.ceil(P[LM.FACE_R][0])),
    y0: Math.max(0, Math.floor(P[LM.FOREHEAD_TOP][1])),
    y1: Math.min(h - 1, Math.ceil(P[LM.CHIN][1])),
  };

  const sharpness = laplacianVariance(data, w, h, bbox);
  if (sharpness < Q.minLaplacianVariance) {
    warnings.push({ code: 'blurry', hint: 'Hold still — the frame is too soft to read skin texture.' });
  }

  const exposure = exposureStats(data, w, h, mask);
  if (exposure.clippedFraction > Q.maxClippedFraction) {
    warnings.push({ code: 'clipped', hint: 'Blown highlights or crushed shadows — move out of direct light.' });
  }

  // Skin under any plausible illuminant is R > G > B. If it is not, the white
  // balance is far enough off that colour metrics are meaningless.
  const [mr, mg, mb] = exposure.meanRGB;
  if (!(mr > mg && mg > mb)) {
    warnings.push({ code: 'colour-cast', hint: 'Strong colour cast — try neutral daylight.' });
  }

  const dL = dist(P[LM.NOSE_TIP], P[LM.FACE_L]);
  const dR = dist(P[LM.NOSE_TIP], P[LM.FACE_R]);
  const yawAsymmetry = Math.abs(dL - dR) / (dL + dR);
  if (yawAsymmetry > Q.maxYawAsymmetry) {
    warnings.push({ code: 'head-turned', hint: 'Face the camera straight on — one cheek is in shadow.' });
  }

  let rollDegrees = (f.rollRadians * 180) / Math.PI;
  if (rollDegrees > 90) rollDegrees -= 180;
  if (rollDegrees < -90) rollDegrees += 180;
  if (Math.abs(rollDegrees) > Q.maxRollDegrees) {
    warnings.push({ code: 'head-tilted', hint: 'Level your head.' });
  }

  // Confidence degrades smoothly rather than passing or failing outright, so a
  // marginally soft photo still produces a usable ranking, just a hedged one.
  //
  // Each term is FLOORED before the product. Without the floor this is a
  // geometric mean, so a single term reaching zero annihilates the whole score
  // and every concern downstream reports confidence 0.00 — which is what a real
  // capture did on the first try. A bad head angle should discount the reading,
  // not delete it.
  const floor = (v) => Math.max(Q.termFloor, clamp01(v));
  const terms = {
    size: floor(faceWidthFraction / Q.minFaceWidthFraction),
    sharpness: floor(sharpness / (Q.minLaplacianVariance * 2)),
    exposure: floor(1 - exposure.clippedFraction / (Q.maxClippedFraction * 2)),
    yaw: floor(1 - yawAsymmetry / (Q.maxYawAsymmetry * 2)),
    roll: floor(1 - Math.abs(rollDegrees) / (Q.maxRollDegrees * 2)),
  };
  const values = Object.values(terms);
  const confidence = values.reduce((a, b) => a * b, 1) ** (1 / values.length);
  // Which term is dragging, so a low score is debuggable instead of mysterious.
  const weakest = Object.entries(terms).sort((a, b) => a[1] - b[1])[0];

  return {
    usable: warnings.every((wn) => wn.code !== 'face-too-small' && wn.code !== 'blurry'),
    confidence: round(confidence, 3),
    warnings,
    raw: {
      confidenceTerms: Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, round(v, 3)])),
      weakestTerm: `${weakest[0]} (${round(weakest[1], 2)})`,
      faceWidthFraction: round(faceWidthFraction, 3),
      sharpness: round(sharpness, 1),
      clippedFraction: round(exposure.clippedFraction, 4),
      yawAsymmetry: round(yawAsymmetry, 3),
      rollDegrees: round(rollDegrees, 1),
      meanRGB: exposure.meanRGB.map((v) => round(v, 1)),
      skinPixelsSampled: exposure.sampled,
    },
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v, d) => Number.isFinite(v) ? Number(v.toFixed(d)) : null;
