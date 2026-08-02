// Discrete lesion detection — spots, blemishes, blackheads.
//
// This is the difference between a scanner that says "texture variance 0.44"
// and one that says "9 spots, mostly on the chin, 6 of them inflamed". The
// second is what a user expects and what a product recommendation can actually
// key off, because inflamed and pigmented lesions want completely different
// ingredients: one wants an anti-inflammatory or BHA, the other wants a
// tyrosinase inhibitor and sunscreen.
//
// The iris-derived millimetre scale does real work here. Lesions are filtered
// by PHYSICAL size, so a blob only counts if it is between ~0.35 mm and 8 mm
// across on the actual face. Without that, the same threshold catches image
// noise on a close-up and misses everything on a wide shot.

import { CHANNEL, extractPlane, bandPass, findBlobs, localCoherence } from './plane.js';
import { rgbToHsv } from './color.js';
import { CALIBRATION, score01 } from './calibration.js';
import { GROUPS, mergeSamples, regionLookup } from './regions.js';

const LESION_REGIONS = ['forehead', 'glabella', 'nose', 'cheekL', 'cheekR', 'chin'];

function diameterToArea(mm, mmPerPx) {
  const px = mm / mmPerPx;
  return (Math.PI / 4) * px * px;
}

// Removes specular pixels from a sample. Threshold is the sample's own median
// brightness plus an offset, so it adapts to the exposure of this capture
// rather than assuming one.
function dropSpecular(imageData, sample) {
  const d = imageData.data;
  const hsv = [0, 0, 0];
  const hist = new Uint32Array(256);
  for (let k = 0; k < sample.indices.length; k++) {
    const i = sample.indices[k] * 4;
    rgbToHsv(d[i], d[i + 1], d[i + 2], hsv);
    hist[Math.min(255, (hsv[2] * 255) | 0)]++;
  }
  let acc = 0, median = 0.5;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= sample.indices.length / 2) { median = i / 255; break; }
  }
  const vCut = median + CALIBRATION.oiliness.vOffsetAboveMedian;
  const sCut = CALIBRATION.oiliness.maxSaturation;

  const kept = [];
  for (let k = 0; k < sample.indices.length; k++) {
    const i = sample.indices[k] * 4;
    rgbToHsv(d[i], d[i + 1], d[i + 2], hsv);
    if (hsv[2] > vCut && hsv[1] < sCut) continue;
    kept.push(sample.indices[k]);
  }
  return { ...sample, indices: Int32Array.from(kept) };
}

export function analyseLesions(imageData, samples, mmPerPx) {
  const C = CALIBRATION.lesions;
  const notes = [];

  // Whole face-skin mask when available; the sparse colour-comparison ellipses
  // are only a fallback and will undercount badly.
  const skin = samples._faceSkin?.reliable
    ? samples._faceSkin
    : mergeSamples(samples, GROUPS.allSkin);
  if (!skin.reliable) return { ok: false, reason: 'no-usable-skin-region' };

  // Hard resolution gate. Below this the smallest real lesion is about one
  // pixel across, so anything the blob finder returns is image noise wearing a
  // lesion's clothes. Refusing is the only honest option — an earlier build
  // reported 64 spots on a synthetic face that had none.
  if (mmPerPx > C.maxUsableMmPerPx) {
    return { ok: false, reason: 'face-too-small-to-resolve-lesions', mmPerPx };
  }

  // Specular highlights have to come out before anything else happens.
  //
  // They do not create false lesions by looking like lesions — they do it by
  // dragging the local mean upward, so ordinary skin next to a patch of glare
  // measures as "darker than its surroundings" and the blob finder obliges. On
  // a synthetic face with 22% of the T-zone blown out this produced 124 lesions
  // where 26 existed. Dropping the specular pixels from the plane entirely
  // (they get backfilled with the region mean) removes the effect.
  const matteSkin = dropSpecular(imageData, skin);
  const specularFraction = 1 - matteSkin.indices.length / skin.indices.length;
  if (specularFraction > C.maxSpecularFraction) {
    return { ok: false, reason: 'too-much-glare-for-lesion-detection', specularFraction: round(specularFraction, 3) };
  }

  // Lightness plane finds the blobs; a* plane says whether each one is angry.
  const lPlane = extractPlane(imageData, matteSkin, CHANNEL.lightness);
  if (!lPlane) return { ok: false, reason: 'region-too-small' };
  const aPlane = extractPlane(imageData, matteSkin, CHANNEL.aStar);

  const rIn = Math.max(1, Math.round(C.innerRadiusMm / mmPerPx));
  const rOut = Math.max(rIn + 1, Math.round(C.outerRadiusMm / mmPerPx));
  const dark = bandPass(lPlane, rIn, rOut);
  const red = aPlane ? bandPass(aPlane, rIn, rOut, { divide: false }) : null;

  // A lesion is a locally dark patch. Threshold is in units of the region's own
  // sigma, so it adapts to how noisy this particular capture is.
  const candidate = new Uint8Array(lPlane.w * lPlane.h);
  const cut = dark.mean - C.darknessSigma * dark.sigma;
  for (let i = 0; i < candidate.length; i++) {
    if (lPlane.inside[i] && dark.residual[i] < cut) candidate[i] = 1;
  }

  const minPx = Math.max(C.minAbsolutePixels, Math.round(diameterToArea(C.minDiameterMm, mmPerPx)));
  const maxPx = Math.round(diameterToArea(C.maxDiameterMm, mmPerPx));
  const depthCut = dark.mean - C.minDepthSigma * dark.sigma;

  const blobs = findBlobs(lPlane.w, lPlane.h, candidate, minPx, maxPx)
    // Lesions are roughly round and solid. Long thin blobs are stray hairs,
    // the shadow under a nostril, or the edge of a region — not spots.
    .filter((b) => b.aspect <= C.maxAspect && b.fill >= C.minFill)
    // And they are deep THROUGHOUT, not just a rim of pixels that squeaked past
    // the threshold. Averaging over the whole blob is what rejects noise clumps:
    // noise only ever grazes the cut, a real lesion sits well below it.
    .map((b) => {
      let sum = 0;
      for (const p of b.pixels) sum += dark.residual[p];
      const radius = Math.sqrt(b.area / Math.PI);
      return {
        ...b,
        depth: sum / b.pixels.length,
        localCoherence: localCoherence(
          dark.residual, lPlane.inside, lPlane.w, lPlane.h,
          Math.round(b.cx), Math.round(b.cy), Math.round(radius * 1.8) + 3,
        ),
      };
    })
    .filter((b) => b.depth < depthCut)
    // Reject fragments of linear structures. Thresholding chops a wrinkle into
    // pieces that pass every roundness test individually, so the discriminator
    // has to look at the neighbourhood rather than the blob.
    .filter((b) => b.localCoherence < C.maxLocalCoherence);

  const lookup = regionLookup(samples, LESION_REGIONS, imageData.width, imageData.height);
  const byRegion = Object.fromEntries(LESION_REGIONS.map((n) => [n, 0]));

  let inflamed = 0, pigmented = 0, comedones = 0;
  const catalogue = [];

  for (const b of blobs) {
    let aSum = 0;
    for (const p of b.pixels) aSum += red ? red.residual[p] : 0;
    const aMean = aSum / b.pixels.length;

    const diameterMm = 2 * Math.sqrt(b.area / Math.PI) * mmPerPx;
    const frameX = lPlane.x0 + Math.round(b.cx);
    const frameY = lPlane.y0 + Math.round(b.cy);
    const regionId = lookup.map[frameY * imageData.width + frameX];
    const region = regionId >= 0 ? lookup.names[regionId] : 'unassigned';
    if (byRegion[region] !== undefined) byRegion[region]++;

    // Small, dark, not red, and on the nose or glabella: reads as a comedone
    // rather than a spot. Elsewhere on the face the same signature is more
    // likely a pore or a freckle, so the region gate matters.
    let type;
    if (diameterMm <= C.comedoneMaxDiameterMm && aMean < C.inflamedAStar
        && (region === 'nose' || region === 'glabella')) {
      type = 'comedone'; comedones++;
    } else if (aMean >= C.inflamedAStar) {
      type = 'inflamed'; inflamed++;
    } else {
      type = 'pigmented'; pigmented++;
    }

    catalogue.push({ type, region, diameterMm: round(diameterMm, 2), redness: round(aMean, 2) });
  }

  // Densities, not raw counts — a count means nothing without knowing how much
  // skin was actually visible and sampled.
  const areaCm2 = (matteSkin.indices.length * mmPerPx * mmPerPx) / 100;
  const noseSample = samples.nose;
  const noseAreaCm2 = noseSample?.reliable
    ? (noseSample.indices.length * mmPerPx * mmPerPx) / 100 : null;

  const density = (n) => (areaCm2 > 0.5 ? n / areaCm2 : null);
  const inflamedDensity = density(inflamed);
  const pigmentedDensity = density(pigmented);
  const comedoneDensity = noseAreaCm2 && noseAreaCm2 > 0.15 ? comedones / noseAreaCm2 : null;

  if (mmPerPx > C.maxUsableMmPerPx) {
    notes.push('face too small in frame for reliable lesion detection — move closer');
  }

  return {
    ok: true,
    scores: prune({
      blemishes: inflamedDensity === null ? null : score01(inflamedDensity, C.inflamedLo, C.inflamedHi),
      darkSpots: pigmentedDensity === null ? null : score01(pigmentedDensity, C.pigmentedLo, C.pigmentedHi),
      congestion: comedoneDensity === null ? null : score01(comedoneDensity, C.comedoneLo, C.comedoneHi),
    }),
    detail: prune({
      lesionCount: blobs.length,
      inflamedCount: inflamed,
      pigmentedCount: pigmented,
      comedoneCount: comedones,
      // Where the trouble is. Useful copy ("mostly around your chin") and a
      // legitimate matching signal — chin and jaw clustering reads differently
      // from forehead clustering.
      worstArea: Object.entries(byRegion).sort((a, b) => b[1] - a[1])[0]?.[1] > 0
        ? Object.entries(byRegion).sort((a, b) => b[1] - a[1])[0][0] : null,
    }),
    // Permanently hedged: this is blob detection, not a trained detector. It
    // will catch moles, freckles and beard shadow alongside real lesions.
    confidenceModifiers: { blemishes: 0.6, darkSpots: 0.6, congestion: 0.45 },
    raw: prune({
      lesionsByRegion: byRegion,
      sampledSkinCm2: round(areaCm2, 2),
      inflamedPerCm2: round(inflamedDensity, 3),
      pigmentedPerCm2: round(pigmentedDensity, 3),
      comedonesPerCm2Nose: round(comedoneDensity, 3),
      blobSizeRangePx: [minPx, maxPx],
      darknessCut: round(cut, 5),
      catalogue: catalogue.slice(0, 40),
    }),
    notes,
  };
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
