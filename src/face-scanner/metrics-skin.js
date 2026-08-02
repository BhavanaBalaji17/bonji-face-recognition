// Skin metrics.
//
// Design rule for this whole file: every number that leaves here is a
// COMPARISON BETWEEN TWO REGIONS OF THE SAME FACE, never an absolute colour or
// brightness reading. T-zone shine minus cheek shine. Cheek redness minus
// forehead redness. Cheek lightness minus under-eye lightness. Differences
// cancel the illuminant, so the same face measures roughly the same under a
// window and under a warm bulb. Absolute readings do not survive the walk
// between two rooms, which is why mall skin scanners live inside a sealed box
// with fixed LEDs and this one does not have to.

import { rgbToLab, rgbToHsv, erythemaIndex, ita, itaBand } from './color.js';
import { CALIBRATION, score01 } from './calibration.js';
import { GROUPS, mergeSamples } from './regions.js';
import { boxBlur } from './plane.js';
import { analyseLesions } from './metrics-lesions.js';
import { analyseLines } from './metrics-lines.js';

const lab = [0, 0, 0];
const hsv = [0, 0, 0];

// One pass over a region, accumulating everything any metric might want.
//
// `excludeSpecularAbove` drops blown-out pixels before averaging. This matters
// more than it looks: a specular highlight is the colour of the lamp, not the
// colour of the skin, so leaving them in makes a shiny forehead measure paler
// AND less red. Since the forehead is the reference the cheeks are compared
// against, that manufactured redness out of nothing but oil. Every colour
// comparison in this file runs on matte pixels only.
export function regionStats(imageData, sample, excludeSpecularAbove = null) {
  const d = imageData.data;
  const total = sample.indices.length;
  if (!total) return null;

  let L = 0, A = 0, B = 0, S = 0, V = 0, EI = 0, n = 0, skipped = 0;
  const vHist = new Uint32Array(256);

  for (let k = 0; k < total; k++) {
    const i = sample.indices[k] * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    rgbToHsv(r, g, b, hsv);
    vHist[Math.min(255, (hsv[2] * 255) | 0)]++;
    if (excludeSpecularAbove !== null
        && hsv[2] > excludeSpecularAbove
        && hsv[1] < CALIBRATION.oiliness.maxSaturation) {
      skipped++;
      continue;
    }
    rgbToLab(r, g, b, lab);
    L += lab[0]; A += lab[1]; B += lab[2];
    S += hsv[1]; V += hsv[2];
    EI += erythemaIndex(r, g);
    n++;
  }

  if (!n) return null;
  return {
    count: n, skipped, total,
    L: L / n, a: A / n, b: B / n,
    S: S / n, V: V / n,
    EI: EI / n,
    vHist,
  };
}

function medianFromHist(hist, total) {
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total / 2) return i / 255;
  }
  return 0.5;
}

// Fraction of a region that is a specular highlight: much brighter than the
// face median AND desaturated, because light bouncing off sebum keeps the
// colour of the source rather than the colour of the skin.
function specularFraction(imageData, sample, vThreshold) {
  const d = imageData.data;
  const n = sample.indices.length;
  if (!n) return null;
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const i = sample.indices[k] * 4;
    rgbToHsv(d[i], d[i + 1], d[i + 2], hsv);
    if (hsv[2] > vThreshold && hsv[1] < CALIBRATION.oiliness.maxSaturation) hits++;
  }
  return hits / n;
}

// --- band-pass texture ------------------------------------------------------
// Extracts the L* channel over a region's bounding box, blurs it at two radii
// specified in millimetres, and measures the energy between them. Because the
// radii are physical and the residual is divided by the local mean, the result
// is independent of both camera distance and exposure.

function bandPassEnergy(imageData, sample, innerMm, outerMm, mmPerPx, spotSigma) {
  if (!sample.reliable || !sample.bbox) return null;
  const { x0, y0, x1, y1 } = sample.bbox;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 8 || h < 8) return null;

  const d = imageData.data;
  const plane = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  const frameW = imageData.width;

  let sum = 0;
  for (let k = 0; k < sample.indices.length; k++) {
    const p = sample.indices[k];
    const px = p % frameW, py = (p / frameW) | 0;
    const lx = px - x0, ly = py - y0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
    const i = p * 4;
    rgbToLab(d[i], d[i + 1], d[i + 2], lab);
    const local = ly * w + lx;
    plane[local] = lab[0];
    inside[local] = 1;
    sum += lab[0];
  }

  const count = inside.reduce((a, b) => a + b, 0);
  if (count < 64) return null;
  const mean = sum / count;
  // Masked-out pixels are filled with the region mean so the blur does not pull
  // in eyebrow or background values across the region boundary.
  for (let i = 0; i < plane.length; i++) if (!inside[i]) plane[i] = mean;

  const rIn = Math.max(1, Math.round(innerMm / mmPerPx));
  const rOut = Math.max(rIn + 1, Math.round(outerMm / mmPerPx));
  const fine = boxBlur(plane, w, h, rIn);
  const coarse = boxBlur(plane, w, h, rOut);

  let s = 0, s2 = 0, n = 0, dark = 0;
  const residual = new Float32Array(w * h);
  for (let i = 0; i < plane.length; i++) {
    if (!inside[i]) continue;
    const base = Math.max(1, coarse[i]);
    const rel = (fine[i] - coarse[i]) / base;
    residual[i] = rel;
    s += rel; s2 += rel * rel; n++;
  }
  const m = s / n;
  const sigma = Math.sqrt(Math.max(0, s2 / n - m * m));
  for (let i = 0; i < plane.length; i++) {
    if (inside[i] && residual[i] < m - spotSigma * sigma) dark++;
  }

  return { energy: sigma, spotFraction: dark / n, radiiPx: [rIn, rOut], pixels: n };
}

// --- public entry point -----------------------------------------------------

export function analyseSkin(imageData, samples, mmPerPx, P) {
  const C = CALIBRATION;
  const notes = [];

  const allSkin = mergeSamples(samples, GROUPS.allSkin);
  if (!allSkin.reliable) {
    return { ok: false, reason: 'no-usable-skin-region', scores: {}, raw: {} };
  }

  const faceStats = regionStats(imageData, allSkin);
  const vMedian = medianFromHist(faceStats.vHist, faceStats.count);
  const vThreshold = vMedian + C.oiliness.vOffsetAboveMedian;

  const tZone = mergeSamples(samples, GROUPS.tZone);
  const cheeks = mergeSamples(samples, GROUPS.cheeks);
  const underEye = mergeSamples(samples, GROUPS.underEye);
  const reference = mergeSamples(samples, GROUPS.rednessReference);

  // --- oiliness -------------------------------------------------------------
  const specT = tZone.reliable ? specularFraction(imageData, tZone, vThreshold) : null;
  const specC = cheeks.reliable ? specularFraction(imageData, cheeks, vThreshold) : null;
  const shineDelta = specT !== null && specC !== null ? specT - specC : null;
  const oiliness = shineDelta === null ? null : score01(shineDelta, C.oiliness.lo, C.oiliness.hi);
  if (shineDelta === null) notes.push('oiliness unavailable: T-zone or cheeks not sampled');

  // --- redness --------------------------------------------------------------
  // Matte-only stats: see the note on regionStats. Falls back to the full
  // sample if a region is so shiny that almost nothing survives the filter.
  const matte = (sample) => {
    if (!sample.reliable) return null;
    const filtered = regionStats(imageData, sample, vThreshold);
    if (filtered && filtered.count >= C.quality.minRegionPixels) return filtered;
    notes.push(`${sample.name}: too few matte pixels, colour read includes glare`);
    return regionStats(imageData, sample);
  };

  const cheekStats = matte(cheeks);
  const refStats = matte(reference);
  let redness = null, eiDelta = null, aDelta = null, rednessAgreement = 1;
  if (cheekStats && refStats) {
    eiDelta = cheekStats.EI - refStats.EI;
    aDelta = cheekStats.a - refStats.a;
    const fromEI = score01(eiDelta, C.redness.eiLo, C.redness.eiHi);
    const fromA = score01(aDelta, C.redness.aStarLo, C.redness.aStarHi);
    redness = (fromEI + fromA) / 2;
    // Two independent estimators of the same thing. When they disagree the
    // reading is being driven by something other than haemoglobin.
    rednessAgreement = 1 - Math.min(1, Math.abs(fromEI - fromA));
    if (rednessAgreement < 0.6) notes.push('redness estimators disagree — treat as low confidence');
  }

  // --- texture and evenness -------------------------------------------------
  const textureSrc = samples.cheekL?.reliable ? samples.cheekL : samples.cheekR;
  const fine = textureSrc
    ? bandPassEnergy(imageData, textureSrc, C.texture.innerRadiusMm, C.texture.outerRadiusMm, mmPerPx, C.evenness.spotSigma)
    : null;
  const coarse = textureSrc
    ? bandPassEnergy(imageData, textureSrc, C.evenness.innerRadiusMm, C.evenness.outerRadiusMm, mmPerPx, C.evenness.spotSigma)
    : null;

  const texture = fine ? score01(fine.energy, C.texture.lo, C.texture.hi) : null;
  const unevenTone = coarse ? score01(coarse.energy, C.evenness.lo, C.evenness.hi) : null;
  if (!fine) notes.push('texture unavailable: cheek region too small');

  // --- periorbital darkness -------------------------------------------------
  const eyeStats = matte(underEye);
  let darkCircles = null, lDelta = null, darkCircleType = null;
  if (eyeStats && cheekStats) {
    lDelta = cheekStats.L - eyeStats.L;
    darkCircles = score01(lDelta, C.darkCircles.lo, C.darkCircles.hi);
    // A brown shift points at pigmentation; a blue shift at visible vasculature.
    // Different causes, different products, so it is worth separating.
    darkCircleType = (eyeStats.b - cheekStats.b) > C.darkCircles.pigmentedBStarDelta ? 'pigmented' : 'vascular';
  }

  // --- dryness --------------------------------------------------------------
  // WEAKEST METRIC IN THE FILE. Genuine dryness is transepidermal water loss,
  // which a camera cannot see. What we can see is the co-occurrence of low
  // shine and raised fine texture, which correlates with it but also fires on
  // matte makeup. Flagged as low confidence permanently.
  let dryness = null;
  if (oiliness !== null && texture !== null) {
    dryness = Math.max(0, Math.min(1, (1 - oiliness) * 0.55 + texture * 0.45));
  }

  // Tone is read matte too, or a shiny face measures as a lighter one.
  const faceMatte = regionStats(imageData, allSkin, vThreshold) ?? faceStats;
  const toneAngle = ita(faceMatte.L, faceMatte.b);

  // --- discrete lesions and lines -------------------------------------------
  // Kept in their own modules because they answer a different question. The
  // metrics above describe the skin as a surface; these two count individual
  // things on it, which is what a user actually reads as "a problem".
  const lesions = analyseLesions(imageData, samples, mmPerPx);
  const lines = P ? analyseLines(imageData, samples, mmPerPx, P) : { ok: false, reason: 'no-landmarks' };
  if (!lesions.ok) notes.push(`lesion detection unavailable: ${lesions.reason}`);
  notes.push(...(lesions.notes ?? []), ...(lines.notes ?? []));

  return {
    ok: true,
    scores: prune({
      oiliness, dryness, redness, texture, unevenTone, darkCircles,
      ...(lesions.scores ?? {}),
      ...(lines.scores ?? {}),
    }),
    detail: prune({
      darkCircleType,
      toneITA: round(toneAngle, 1),
      toneBand: itaBand(toneAngle),
      spotFraction: coarse ? round(coarse.spotFraction, 4) : null,
      ...(lesions.detail ?? {}),
      ...(lines.detail ?? {}),
    }),
    confidenceModifiers: {
      redness: round(rednessAgreement, 3),
      dryness: 0.5,
      ...(lesions.confidenceModifiers ?? {}),
      ...(lines.confidenceModifiers ?? {}),
    },
    raw: prune({
      specularTZone: round(specT, 4),
      specularCheek: round(specC, 4),
      shineDelta: round(shineDelta, 4),
      erythemaDelta: round(eiDelta, 3),
      aStarDelta: round(aDelta, 3),
      fineTextureEnergy: fine ? round(fine.energy, 5) : null,
      coarseTextureEnergy: coarse ? round(coarse.energy, 5) : null,
      bandRadiiPx: fine ? fine.radiiPx : null,
      underEyeLightnessDelta: round(lDelta, 2),
      faceMeanLab: [round(faceMatte.L, 1), round(faceMatte.a, 2), round(faceMatte.b, 2)],
      skinPixels: faceStats.count,
      specularPixelsExcluded: faceMatte.skipped ?? 0,
      mmPerPixel: round(mmPerPx, 5),
      lesions: lesions.raw ?? null,
      lines: lines.raw ?? null,
    }),
    notes,
  };
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
