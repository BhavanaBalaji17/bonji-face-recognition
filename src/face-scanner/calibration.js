// ---------------------------------------------------------------------------
// EVERY TUNABLE NUMBER IN THE PIPELINE LIVES HERE.
//
// The values below are reasonable starting points, NOT measured truth. The job
// of whoever owns the validation set is to shoot ~50 labelled photos, run
// tools/sweep.html, and replace these with numbers that actually separate the
// labelled classes. Until that happens the scores are ordinal at best: they
// rank faces correctly relative to each other but the absolute 0-1 value means
// nothing.
// ---------------------------------------------------------------------------

// Maps a raw measurement onto 0..1. `lo` is the value that should read as 0,
// `hi` the value that should read as 1. lo > hi inverts the scale.
export function score01(raw, lo, hi) {
  if (!Number.isFinite(raw)) return null;
  const t = (raw - lo) / (hi - lo);
  return Math.max(0, Math.min(1, t));
}

export const CALIBRATION = {
  // --- capture quality gates -------------------------------------------------
  quality: {
    minFaceWidthFraction: 0.22,   // face must span >=22% of frame width
    minLaplacianVariance: 55,     // below this the frame is too blurry to trust
    maxClippedFraction: 0.06,     // fraction of face pixels at 0 or 255
    maxYawAsymmetry: 0.18,        // |left-right| / (left+right) of face halves
    maxRollDegrees: 12,
    minRegionPixels: 120,         // a region with fewer usable pixels is dropped
    termFloor: 0.20,              // no single quality term may zero out the whole score
  },

  // --- specular / oiliness ---------------------------------------------------
  oiliness: {
    // A pixel counts as specular if it is much brighter than the face median
    // AND desaturated (light bouncing off sebum is close to the source colour).
    vOffsetAboveMedian: 0.11,
    maxSaturation: 0.32,
    // Score is driven by T-zone specular fraction MINUS cheek specular fraction.
    // The subtraction is what cancels the room lighting.
    lo: -0.01,
    hi: 0.16,
  },

  // --- redness ---------------------------------------------------------------
  redness: {
    // Erythema index of cheeks+nose minus forehead (low-vascularity reference).
    eiLo: 0.4,
    eiHi: 4.5,
    // a* delta is the cross-check; disagreement between the two lowers confidence.
    aStarLo: 0.5,
    aStarHi: 6.0,
  },

  // --- texture / pores -------------------------------------------------------
  // Band-pass radii are in MILLIMETRES, converted to pixels using the iris
  // scale. This is what makes the metric independent of camera distance.
  texture: {
    innerRadiusMm: 0.28,
    outerRadiusMm: 1.10,
    lo: 0.008,
    hi: 0.055,
  },

  // --- pigmentation / evenness ----------------------------------------------
  evenness: {
    innerRadiusMm: 1.6,
    outerRadiusMm: 6.0,
    lo: 0.010,
    hi: 0.070,
    spotSigma: 1.9,   // pixels below mean - k*sigma count as spots
  },

  // --- periorbital darkness --------------------------------------------------
  darkCircles: {
    // L* of cheek minus L* of under-eye. Positive = under-eye is darker.
    // A real face measured 13.9 here, which the original hi of 11 pinned to a
    // flat 1.00 "marked". Widened so genuinely severe circles still have room.
    lo: 2.0,
    hi: 20.0,
    // b* delta separates the two causes: browner = pigmented, bluer = vascular.
    pigmentedBStarDelta: 1.2,
  },

  // --- discrete lesions ------------------------------------------------------
  lesions: {
    innerRadiusMm: 0.35,
    outerRadiusMm: 3.50,
    darknessSigma: 2.6,      // how far below local mean a pixel must sit
    minDepthSigma: 2.2,      // and how deep the blob is on AVERAGE, not at its rim
    minAbsolutePixels: 8,    // floor regardless of scale — fewer is never a lesion
    minDiameterMm: 0.60,     // physical size gates, via the iris scale
    maxDiameterMm: 8.0,
    comedoneMaxDiameterMm: 1.2,
    maxAspect: 2.6,          // long thin blobs are hairs and shadow edges
    minFill: 0.45,           // solid, not wispy
    maxLocalCoherence: 0.62, // above this the blob is part of a line, not a spot
    inflamedAStar: 0.8,      // local a* lift that marks a lesion as active
    // Densities per cm². A whole visible face is ~150-180 cm², so ~10 spots is
    // 0.06/cm² and ~50 is 0.28/cm². The first pass at these was set roughly 30x
    // too high, which pinned every score to zero — measured from the harness.
    inflamedLo: 0.005, inflamedHi: 0.090,
    pigmentedLo: 0.008, pigmentedHi: 0.120,
    comedoneLo: 0.500, comedoneHi: 8.000,  // per cm² of nose only
    maxSpecularFraction: 0.30, // more glare than this and we refuse rather than guess
    maxUsableMmPerPx: 0.28,  // beyond this the face is too small in frame
  },

  // --- fine lines ------------------------------------------------------------
  lines: {
    innerRadiusMm: 0.20,
    outerRadiusMm: 2.00,
    // Measured floor with no lines present is ~4e-4; strongly lined regions hit
    // ~3.2e-2. These sit just above the floor and below saturation so the score
    // grades rather than snapping between 0 and 1.
    lo: 0.0010,
    hi: 0.0250,
    minCoherence: 0.55,      // below this it is texture, not a line
    maxUsableMmPerPx: 0.25,
  },

  // --- hair ------------------------------------------------------------------
  hair: {
    minMaskFraction: 0.03,      // below this we assume hair is not visible
    // Curl is read from how coherence DECAYS across these three window sizes,
    // not from its absolute value at one of them. A ratio of two measurements
    // taken under identical conditions cancels exposure, sharpness and crop —
    // which is what made the same head read straight on a webcam and curly on
    // a phone.
    scalesMm: [2.0, 6.0, 14.0],
    straightCoherence: 0.60,   // fine-scale coherence above this = straight
    straightRetention: 0.85,   // ...and it must not decay
    wavyRetention: 0.75,       // decay present = curl wider than the finest window
    minSharpnessForCurl: 120,  // below this, blur fakes straight hair — decline
    shineLo: 0.02,
    shineHi: 0.20,
    // Ratio of sparse-neighbourhood hair pixels (flyaways) to solid core.
    // Deliberately not silhouette compactness — that measures the haircut.
    frizzLo: 0.06,
    frizzHi: 0.42,
  },

  // --- concern thresholds ----------------------------------------------------
  // A concern is emitted when its score crosses `flag`. These are what the
  // product-matching side keys off, so changing them changes recommendations.
  flag: {
    oiliness: 0.60,
    dryness: 0.60,
    redness: 0.55,
    texture: 0.58,
    unevenTone: 0.55,
    darkCircles: 0.55,
    blemishes: 0.50,
    darkSpots: 0.52,
    congestion: 0.55,
    fineLines: 0.55,
    eyeAreaLines: 0.55,
    hairFrizz: 0.58,
    hairDryness: 0.58,
  },
};
