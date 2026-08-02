// Hair metrics.
//
// Be honest about the ceiling here: a front-facing selfie shows the outer
// surface of a hairstyle, not the hair. Porosity, protein damage and scalp
// condition are simply not in the image, and no amount of processing will
// recover them. What IS legitimately measurable from this view is curl family,
// surface shine, and how ragged the silhouette is. Those three are enough to
// route a product recommendation; anything beyond them would be invention.

import { rgbToLab, rgbToHsv, luma } from './color.js';
import { CALIBRATION, score01 } from './calibration.js';
import { SEG_CLASS, maskClassAt } from './regions.js';

const lab = [0, 0, 0];
const hsv = [0, 0, 0];

function median(arr) {
  if (!arr.length) return null;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Builds a dense hair mask over its own bounding box at frame resolution.
function extractHairMask(mask, frameW, frameH) {
  let x0 = frameW, y0 = frameH, x1 = -1, y1 = -1, total = 0;
  const flags = new Uint8Array(frameW * frameH);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      if (maskClassAt(mask, x, y, frameW, frameH) !== SEG_CLASS.HAIR) continue;
      flags[y * frameW + x] = 1;
      total++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { flags, bbox: { x0, y0, x1, y1 }, count: total };
}

// Erodes the hair mask inward, dropping any pixel with a non-hair neighbour
// within `radius`. The silhouette is where background bleeds in — a dark chair
// behind dark hair contributes gradients that belong to neither. Curl, shine
// and colour are all read from the solid core; only frizz wants the edge.
function erodeMask(hair, frameW, frameH, radius) {
  const { flags, bbox } = hair;
  const core = new Uint8Array(flags.length);
  let count = 0;
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      if (!flags[y * frameW + x]) continue;
      let solid = true;
      for (let dy = -radius; dy <= radius && solid; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= frameW || ny >= frameH || !flags[ny * frameW + nx]) {
            solid = false; break;
          }
        }
      }
      if (solid) { core[y * frameW + x] = 1; count++; }
    }
  }
  return { flags: core, bbox, count };
}

// Structure-tensor coherence.
//
// Straight hair gives a dense field of gradients all pointing the same way, so
// the tensor's two eigenvalues are far apart. The tighter the curl, the more
// directions coexist inside any given patch and the closer the eigenvalues get.
// This is the one hair property that falls straight out of classical CV without
// a trained model.
function orientationCoherence(data, hair, frameW, blockPx) {
  const { flags, bbox } = hair;
  const coherences = [];
  const g = (x, y) => {
    const i = (y * frameW + x) * 4;
    return luma(data[i], data[i + 1], data[i + 2]);
  };

  for (let by = bbox.y0 + 1; by + blockPx < bbox.y1; by += blockPx) {
    for (let bx = bbox.x0 + 1; bx + blockPx < bbox.x1; bx += blockPx) {
      let Jxx = 0, Jxy = 0, Jyy = 0, n = 0;
      for (let y = by; y < by + blockPx; y++) {
        for (let x = bx; x < bx + blockPx; x++) {
          if (!flags[y * frameW + x]) continue;
          // Sobel
          const ix = (g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1))
                   - (g(x - 1, y - 1) + 2 * g(x - 1, y) + g(x - 1, y + 1));
          const iy = (g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1))
                   - (g(x - 1, y - 1) + 2 * g(x, y - 1) + g(x + 1, y - 1));
          Jxx += ix * ix; Jxy += ix * iy; Jyy += iy * iy;
          n++;
        }
      }
      if (n < blockPx * blockPx * 0.6) continue;
      const trace = Jxx + Jyy;
      if (trace < n * 40) continue; // flat, textureless block — no orientation to read
      const diff = Math.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy * Jxy);
      coherences.push(diff / trace);
    }
  }
  return { coherence: median(coherences), blocks: coherences.length };
}

// Curl family, from the coherence-versus-scale profile.
//
// Two signals, because neither works alone. Measured against synthetic hair
// drawn as real strands following a sinusoidal path:
//
//   straight  profile [0.80, 0.83, 0.84]  retention 1.05
//   wavy      profile [0.36, 0.26, 0.21]  retention 0.59
//   curly     profile [0.33, 0.33, 0.33]  retention 1.02
//   coily     profile [0.37, 0.38, 0.42]  retention 1.14
//
// Absolute coherence at the finest scale separates straight from everything
// else cleanly. It cannot separate wavy from curly — all three curled types sit
// around 0.35. Decay does that: a wave is wider than the finest window, so
// coherence falls as the window grows. A tight curl is already smaller than the
// finest window, so it starts collapsed and stays flat — which is why decay
// alone called curly "straight".
//
// Curly and coily are NOT separable this way; both read as flat-and-low. They
// are reported as one class rather than guessed between.
function curlFromProfile(profile) {
  const fine = profile.find((p) => p.coherence !== null);
  const coarse = [...profile].reverse().find((p) => p.coherence !== null);
  if (!fine || !coarse || fine === coarse || fine.coherence < 0.05) return null;

  const retention = coarse.coherence / fine.coherence;
  const H = CALIBRATION.hair;
  let type, typeNumber;
  if (fine.coherence >= H.straightCoherence && retention >= H.straightRetention) {
    type = 'straight'; typeNumber = 1;
  } else if (retention < H.wavyRetention) {
    type = 'wavy'; typeNumber = 2;
  } else {
    type = 'curly'; typeNumber = 3;   // covers coily; see note above
  }
  return { type, typeNumber, retention, fine: fine.coherence, coarse: coarse.coherence };
}

// Flyaway detection. Rather than measuring silhouette compactness (which mostly
// tells you the haircut), this counts pixels sitting in sparse neighbourhoods —
// strands separated from the mass — and compares them to the solid core.
function fuzzRatio(hair, frameW, radius) {
  const { flags, bbox } = hair;
  let sparse = 0, solid = 0;
  const win = (2 * radius + 1) ** 2;
  for (let y = bbox.y0 + radius; y <= bbox.y1 - radius; y++) {
    for (let x = bbox.x0 + radius; x <= bbox.x1 - radius; x++) {
      if (!flags[y * frameW + x]) continue;
      let c = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (flags[(y + dy) * frameW + (x + dx)]) c++;
        }
      }
      const density = c / win;
      if (density < 0.55) sparse++;
      else solid++;
    }
  }
  return solid > 0 ? sparse / solid : null;
}

function shadeName(L, a, b) {
  if (L < 22) return 'black';
  if (L > 68 && Math.abs(a) < 6) return 'grey/white';
  if (L > 55 && b > 18) return 'blonde';
  if (a > 12 && b > 14) return 'red/auburn';
  if (L < 40) return 'dark-brown';
  return 'brown';
}

export function analyseHair(imageData, mask, mmPerPx, { sharpness = null } = {}) {
  const { width: frameW, height: frameH, data } = imageData;
  const H = CALIBRATION.hair;
  const notes = [];

  if (!mask) {
    return { ok: false, reason: 'no-segmentation-mask', scores: {}, raw: {} };
  }

  const hair = extractHairMask(mask, frameW, frameH);
  const coverage = hair ? hair.count / (frameW * frameH) : 0;
  if (!hair || coverage < H.minMaskFraction) {
    // Covered head, shaved head, or hair pulled back out of frame. Saying so is
    // far better than emitting a curl type from forty stray pixels.
    return { ok: false, reason: 'hair-not-visible', coverage: round(coverage, 4), scores: {}, raw: {} };
  }

  // Read curl, shine and colour from the eroded core; frizz still uses the edge.
  const erodeRadius = Math.max(1, Math.round(1.0 / mmPerPx));
  const core = erodeMask(hair, frameW, frameH, erodeRadius);
  const readFrom = core.count > hair.count * 0.25 ? core : hair;
  if (readFrom === hair) notes.push('hair mask too thin to erode — edge pixels included');

  // Three scales spanning plausible curl radii.
  const profile = CALIBRATION.hair.scalesMm.map((mm) => {
    const blockPx = Math.max(6, Math.round(mm / mmPerPx));
    const r = orientationCoherence(data, readFrom, frameW, blockPx);
    return { mm, blockPx, coherence: r.coherence, blocks: r.blocks };
  });
  const coherence = profile[0].coherence;
  const blocks = profile[0].blocks;
  if (blocks < 8) notes.push('few usable hair blocks — curl type is a guess');

  const fuzzRadius = Math.max(2, Math.round(1.5 / mmPerPx));
  const fuzz = fuzzRatio(hair, frameW, fuzzRadius);

  // Shine and colour, over the solid core only so flyaways and the background
  // showing through do not pollute the average.
  let L = 0, A = 0, B = 0, n = 0, spec = 0;
  const vals = [];
  for (let y = readFrom.bbox.y0; y <= readFrom.bbox.y1; y++) {
    for (let x = readFrom.bbox.x0; x <= readFrom.bbox.x1; x++) {
      if (!readFrom.flags[y * frameW + x]) continue;
      const i = (y * frameW + x) * 4;
      rgbToLab(data[i], data[i + 1], data[i + 2], lab);
      rgbToHsv(data[i], data[i + 1], data[i + 2], hsv);
      L += lab[0]; A += lab[1]; B += lab[2];
      vals.push(hsv[2]);
      n++;
    }
  }
  const vMedian = median(vals);
  for (const v of vals) if (v > vMedian + 0.16) spec++;
  const shine = n ? spec / n : null;

  // Sharpness gate. This is the real confound, and it is what made one head
  // read straight on a webcam and curly on a phone: blur destroys individual
  // strands, so the gradients that survive belong to the large-scale shape of
  // the hairstyle, which is coherent. A soft frame therefore inflates coherence
  // and fakes straight hair. You cannot sharpen the softness away, so the only
  // honest move is to decline.
  const sharpEnough = sharpness === null || sharpness >= H.minSharpnessForCurl;
  const curl = sharpEnough ? curlFromProfile(profile) : null;
  if (!sharpEnough) notes.push('frame too soft to read curl type — blur inflates coherence');
  const shineScore = shine === null ? null : score01(shine, H.shineLo, H.shineHi);
  const frizz = fuzz === null ? null : score01(fuzz, H.frizzLo, H.frizzHi);
  // Dry-looking hair reads as low shine plus a ragged silhouette together;
  // either alone is normal for plenty of healthy hair types.
  const dryness = shineScore !== null && frizz !== null
    ? Math.max(0, Math.min(1, (1 - shineScore) * 0.5 + frizz * 0.5))
    : null;

  return {
    ok: true,
    scores: prune({ frizz, dryness, shine: shineScore }),
    detail: prune({
      curlType: curl?.type,
      curlTypeNumber: curl?.typeNumber,
      shade: n ? shadeName(L / n, A / n, B / n) : null,
    }),
    confidenceModifiers: { curlType: blocks >= 8 && curl ? 0.8 : 0.4, dryness: 0.5 },
    raw: prune({
      coverage: round(coverage, 4),
      coherence: round(coherence, 4),
      coherenceBlocks: blocks,
      // The whole decay curve, so a wrong curl call is diagnosable rather than
      // just wrong. Straight hair should stay flat across these.
      coherenceProfile: profile.map((p) => ({ mm: p.mm, coherence: round(p.coherence, 3), blocks: p.blocks })),
      curlRetention: round(curl?.retention, 3),
      sharpnessUsed: sharpness,
      corePixels: core.count,
      fuzzRatio: round(fuzz, 4),
      specularFraction: round(shine, 4),
      meanLab: n ? [round(L / n, 1), round(A / n, 2), round(B / n, 2)] : null,
      hairPixels: hair.count,
    }),
    notes,
  };
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
