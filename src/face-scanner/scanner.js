// Orchestrator. This is the only file the rest of the app should import.
//
// Everything upstream of here produces measurements; everything downstream
// consumes `concerns`. The product-matching side never sees a pixel, a landmark
// or a colour space — it sees a list of concern ids with scores and
// confidences, which is the entire contract. See CONTRACT.md.

import { toPixels, buildRegions, sampleAll, buildFaceSkinSample, millimetresPerPixel, faceFrame } from './regions.js';
import { assessCapture } from './quality.js';
import { analyseSkin } from './metrics-skin.js';
import { analyseHair } from './metrics-hair.js';
import { CALIBRATION } from './calibration.js';

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';

// Long edge the frame is resampled to before analysis. Texture metrics need
// real detail, so this cannot go much below 800 without the pore band
// collapsing into noise. Above ~1200 it costs time for nothing.
export const WORKING_LONG_EDGE = 960;

export const CONTRACT_VERSION = '1.0';

export async function createScanner({ frames = 5, frameDelayMs = 90 } = {}) {
  const vision = await import(/* @vite-ignore */ `${TASKS_VISION}`);
  const { FilesetResolver, FaceLandmarker, ImageSegmenter } = vision;
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);

  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
  });

  // The segmenter is a real accuracy upgrade but not a hard dependency: without
  // it the ellipses still land on skin most of the time, they just occasionally
  // catch an eyebrow. Degrade rather than fail.
  let segmenter = null;
  try {
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  } catch (err) {
    console.warn('[scanner] segmenter unavailable, continuing without masks:', err);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function grab(source) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) throw new Error('source has no dimensions yet');
    const scale = Math.min(1, WORKING_LONG_EDGE / Math.max(sw, sh));
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function analyseOne(imageData) {
    const faceResult = landmarker.detect(canvas);
    const landmarks = faceResult?.faceLandmarks?.[0];
    if (!landmarks) return { ok: false, reason: 'no-face-detected' };

    let mask = null;
    if (segmenter) {
      const segResult = segmenter.segment(canvas);
      const cat = segResult?.categoryMask;
      if (cat) {
        mask = { data: cat.getAsUint8Array().slice(), width: cat.width, height: cat.height };
        cat.close();
      }
    }

    const P = toPixels(landmarks, imageData.width, imageData.height);
    const capture = assessCapture(imageData, P, mask);

    // Iris width gives a real millimetre scale. Without iris points, fall back
    // to mean outer-canthal distance (~92mm), which is coarser but keeps the
    // physical-units property of the texture metrics alive.
    const mmPerPx = millimetresPerPixel(P) ?? (92 / faceFrame(P).eyeSpan);
    const usedIris = millimetresPerPixel(P) !== null;

    const regions = buildRegions(P);
    const samples = sampleAll(regions, mask, imageData.width, imageData.height);
    // Underscore-prefixed: consumed by lesion counting, skipped by the debug
    // overlay and by every group-based metric.
    samples._faceSkin = buildFaceSkinSample(P, mask, imageData.width, imageData.height);

    return {
      ok: true,
      capture,
      skin: analyseSkin(imageData, samples, mmPerPx, P),
      hair: analyseHair(imageData, mask, mmPerPx, { sharpness: capture.raw.sharpness }),
      geometry: { mmPerPx, usedIris, regions, landmarkCount: landmarks.length },
      _debug: { P, samples, mask },
    };
  }

  // Multi-frame capture with a per-metric median. One frame is one sample of a
  // noisy process — autofocus hunting, a blink, a flicker from mains lighting
  // all move the numbers. Taking the median of five costs half a second and
  // removes most of it.
  async function scan(source, { debug = false } = {}) {
    const passes = [];
    for (let i = 0; i < frames; i++) {
      const imageData = grab(source);
      const one = analyseOne(imageData);
      if (one.ok) passes.push(one);
      if (i < frames - 1) await sleep(frameDelayMs);
    }

    if (!passes.length) {
      return {
        version: CONTRACT_VERSION, ok: false, reason: 'no-face-detected',
        concerns: [], confidence: 0, warnings: [], notes: [],
      };
    }

    return assemble(passes, debug);
  }

  // Single-shot path for batch-processing a validation set of stills.
  function scanImage(source, { debug = false } = {}) {
    const imageData = grab(source);
    const one = analyseOne(imageData);
    if (!one.ok) {
      return { version: CONTRACT_VERSION, ok: false, reason: one.reason, concerns: [], confidence: 0, warnings: [], notes: [] };
    }
    return assemble([one], debug);
  }

  function close() {
    landmarker?.close();
    segmenter?.close();
  }

  return { scan, scanImage, close, hasSegmenter: () => !!segmenter };
}

// --- aggregation ------------------------------------------------------------

function medianOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function medianScores(passes, area) {
  const keys = new Set();
  for (const p of passes) for (const k of Object.keys(p[area]?.scores ?? {})) keys.add(k);
  const out = {};
  for (const k of keys) {
    const m = medianOf(passes.map((p) => p[area]?.scores?.[k]));
    if (m !== null) out[k] = Number(m.toFixed(3));
  }
  return out;
}

// Categorical fields (curl type, dark-circle cause, tone band) get a plurality
// vote across frames instead of a median.
function voteDetail(passes, area) {
  const tally = {};
  for (const p of passes) {
    for (const [k, v] of Object.entries(p[area]?.detail ?? {})) {
      if (typeof v === 'number') {
        (tally[k] ??= { numeric: [] }).numeric.push(v);
      } else {
        (tally[k] ??= { votes: {} }).votes[v] = ((tally[k].votes ?? {})[v] ?? 0) + 1;
      }
    }
  }
  const out = {};
  for (const [k, t] of Object.entries(tally)) {
    if (t.numeric) out[k] = Number(medianOf(t.numeric).toFixed(2));
    else out[k] = Object.entries(t.votes).sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

// Every metric this module is supposed to produce. Anything absent from a
// result is absent for a REASON, and silent absence is the failure mode that
// bit us twice: eyeAreaLines vanished when its region got over-excluded, and
// lesions vanished when the face was too far away. Both looked like "no problem
// found" to anyone reading the scores.
const EXPECTED = {
  skin: ['oiliness', 'dryness', 'redness', 'texture', 'unevenTone', 'darkCircles',
         'blemishes', 'darkSpots', 'congestion', 'fineLines', 'eyeAreaLines'],
  hair: ['frizz', 'dryness', 'shine'],
};

function completenessOf(skinScores, hairScores, notes) {
  const report = (expected, actual) => {
    const ran = expected.filter((k) => actual[k] !== undefined);
    return { ran, missing: expected.filter((k) => actual[k] === undefined) };
  };
  const skin = report(EXPECTED.skin, skinScores);
  const hair = report(EXPECTED.hair, hairScores);
  const total = EXPECTED.skin.length + EXPECTED.hair.length;
  return {
    ...{ skin, hair },
    ratio: Number(((skin.ran.length + hair.ran.length) / total).toFixed(2)),
    // The notes already say why; surfaced here so a consumer does not have to
    // correlate two fields to find out what went missing and why.
    reasons: notes,
  };
}

function severityOf(score) {
  if (score >= 0.80) return 'marked';
  if (score >= 0.65) return 'moderate';
  return 'mild';
}

function assemble(passes, debug) {
  const best = passes.reduce((a, b) => (b.capture.confidence > a.capture.confidence ? b : a));
  const captureConfidence = medianOf(passes.map((p) => p.capture.confidence)) ?? 0;

  const skinScores = medianScores(passes, 'skin');
  const hairScores = medianScores(passes, 'hair');
  const skinDetail = voteDetail(passes, 'skin');
  const hairDetail = voteDetail(passes, 'hair');

  const warnings = dedupe(passes.flatMap((p) => p.capture.warnings), (w) => w.code);
  const notes = dedupe([
    ...passes.flatMap((p) => p.skin?.notes ?? []),
    ...passes.flatMap((p) => p.hair?.notes ?? []),
  ], (n) => n);

  const modifiers = {
    ...(best.skin?.confidenceModifiers ?? {}),
    ...(best.hair?.confidenceModifiers ?? {}),
  };

  const concerns = [];
  const push = (id, area, score, key) => {
    const threshold = CALIBRATION.flag[key ?? id];
    if (score === undefined || threshold === undefined || score < threshold) return;
    concerns.push({
      id,
      area,
      score,
      severity: severityOf(score),
      // Capture quality bounds every claim: a hedged photo cannot produce a
      // confident finding no matter how strong the raw signal looks.
      confidence: Number((captureConfidence * (modifiers[key ?? id] ?? 1)).toFixed(3)),
    });
  };

  push('oiliness', 'skin', skinScores.oiliness);
  push('dryness', 'skin', skinScores.dryness);
  push('redness', 'skin', skinScores.redness);
  push('texture', 'skin', skinScores.texture);
  push('unevenTone', 'skin', skinScores.unevenTone);
  push('darkCircles', 'skin', skinScores.darkCircles);
  push('blemishes', 'skin', skinScores.blemishes);
  push('darkSpots', 'skin', skinScores.darkSpots);
  push('congestion', 'skin', skinScores.congestion);
  push('fineLines', 'skin', skinScores.fineLines);
  push('eyeAreaLines', 'skin', skinScores.eyeAreaLines);
  push('hairFrizz', 'hair', hairScores.frizz, 'hairFrizz');
  push('hairDryness', 'hair', hairScores.dryness, 'hairDryness');

  concerns.sort((a, b) => b.score * b.confidence - a.score * a.confidence);

  // Distance is the single most common reason half the metrics go missing, and
  // it is invisible to the user: the face detects fine, it is simply too small
  // to resolve a pore or a spot. Say so explicitly rather than silently
  // dropping lesion and texture scores.
  const mmPerPx = best.geometry?.mmPerPx;
  if (mmPerPx && mmPerPx > CALIBRATION.lesions.maxUsableMmPerPx) {
    warnings.push({
      code: 'too-far-for-detail',
      hint: 'Move closer — your face needs to fill about half the frame before spots, pores and fine lines can be measured.',
    });
  }

  const result = {
    version: CONTRACT_VERSION,
    ok: true,
    confidence: Number(captureConfidence.toFixed(3)),
    framesUsed: passes.length,
    capture: { ...best.capture.raw, warnings: warnings.map((w) => w.code) },
    skin: {
      available: !!best.skin?.ok,
      reason: best.skin?.ok ? undefined : best.skin?.reason,
      scores: skinScores,
      ...skinDetail,
      // The measurements the scores were derived from. Always present, not
      // debug-gated: without these a saturated score is uncalibratable, and
      // calibration is the one open task on this module.
      raw: stripBulk(best.skin?.raw),
    },
    hair: {
      available: !!best.hair?.ok,
      reason: best.hair?.ok ? undefined : best.hair?.reason,
      scores: hairScores,
      ...hairDetail,
      raw: best.hair?.raw,
    },
    concerns,
    completeness: completenessOf(skinScores, hairScores, notes),
    warnings,
    notes,
  };

  if (debug) result._debug = { ...best._debug, geometry: best.geometry, raw: { skin: best.skin?.raw, hair: best.hair?.raw } };
  return result;
}

// Drops the per-lesion catalogue, which is long and only useful in debug.
function stripBulk(raw) {
  if (!raw) return undefined;
  const out = { ...raw };
  if (out.lesions) out.lesions = { ...out.lesions, catalogue: undefined };
  return out;
}

function dedupe(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
