// Fine line and wrinkle detection.
//
// The trick that separates a wrinkle from a pore: wrinkles are ANISOTROPIC.
// Pores, noise and skin grain scatter gradients in every direction, so the
// structure tensor's eigenvalues come out similar. A line runs one way, which
// pushes them apart. So the signal is not "how much fine detail is here" — that
// is the texture metric — it is "how much of the fine detail points the same
// way, and is that way the direction lines actually form here".
//
// The second half of that matters. Forehead lines run horizontally; the
// nasolabial fold runs nose-to-mouth-corner. Both expected directions are taken
// from the landmarks, so a tilted head does not turn a real wrinkle into a
// rejected one, and a stray hair lying diagonally across the forehead does not
// turn into one.

import { CHANNEL, extractPlane, bandPass, orientationOf } from './plane.js';
import { CALIBRATION, score01 } from './calibration.js';
import { GROUPS, expectedLineAngles } from './regions.js';

// Agreement between two undirected orientations. Doubling the angle makes it
// period-pi, so a line at 179 degrees and one at 1 degree count as parallel.
function orientationAgreement(a, b) {
  return Math.abs(Math.cos(2 * (a - b)));
}

export function analyseLines(imageData, samples, mmPerPx, P) {
  const C = CALIBRATION.lines;
  const expected = expectedLineAngles(P);
  const notes = [];

  const rIn = Math.max(1, Math.round(C.innerRadiusMm / mmPerPx));
  const rOut = Math.max(rIn + 1, Math.round(C.outerRadiusMm / mmPerPx));

  const perRegion = {};
  for (const name of GROUPS.lines) {
    const sample = samples[name];
    if (!sample?.reliable) continue;

    const plane = extractPlane(imageData, sample, CHANNEL.lightness);
    if (!plane) continue;
    const band = bandPass(plane, rIn, rOut);
    const orient = orientationOf(plane, band.residual);
    if (!orient) continue;

    // Ridges run perpendicular to the dominant gradient.
    const ridgeAngle = orient.gradientAngle + Math.PI / 2;
    const agreement = orientationAgreement(ridgeAngle, expected[name] ?? 0);

    // Strength needs all three: enough contrast, pointing one way, and pointing
    // the RIGHT way. Any of the three near zero kills the score, which is what
    // keeps hair strands and shadow edges out. On top of that, a coherence gate. A true wrinkle is strongly aligned — the synthetic ones
    // measure 0.94-0.97. A real capture produced 0.44 on the forehead and still
    // scored 0.87, because high ENERGY alone carried it: fringe strands and
    // shading are energetic but not aligned. Below the gate the region reads as
    // ordinary texture and contributes nothing at all.
    const strength = orient.coherence < C.minCoherence
      ? 0
      : orient.energy * orient.coherence * agreement;
    perRegion[name] = {
      score: score01(strength, C.lo, C.hi),
      strength,
      coherence: orient.coherence,
      energy: orient.energy,
      agreement,
      ridgeDegrees: (ridgeAngle * 180) / Math.PI,
    };
  }

  const names = Object.keys(perRegion);
  if (!names.length) return { ok: false, reason: 'no-usable-line-region' };

  // Report the worst area rather than the average: lines are local, and
  // averaging forehead lines against a smooth cheek hides both.
  const ranked = names.sort((a, b) => perRegion[b].score - perRegion[a].score);
  const worst = ranked[0];
  const overall = perRegion[worst].score;

  const eyeAreas = ['crowsFeetL', 'crowsFeetR'].filter((n) => perRegion[n]);
  const eyeScore = eyeAreas.length
    ? Math.max(...eyeAreas.map((n) => perRegion[n].score)) : null;

  if (mmPerPx > C.maxUsableMmPerPx) {
    notes.push('face too small in frame to resolve fine lines — move closer');
  }

  return {
    ok: true,
    scores: prune({
      fineLines: overall,
      eyeAreaLines: eyeScore,
    }),
    detail: prune({
      lineArea: overall >= CALIBRATION.flag.fineLines ? worst : null,
    }),
    // Expression lines show up and vanish with expression. One frame of a face
    // mid-smile reads as heavily lined. Hedged accordingly.
    confidenceModifiers: { fineLines: 0.55, eyeAreaLines: 0.55 },
    raw: {
      byRegion: Object.fromEntries(Object.entries(perRegion).map(([k, v]) => [k, {
        score: round(v.score, 3),
        coherence: round(v.coherence, 3),
        energy: round(v.energy, 5),
        agreement: round(v.agreement, 3),
        ridgeDegrees: round(v.ridgeDegrees, 1),
      }])),
      bandRadiiPx: [rIn, rOut],
    },
    notes,
  };
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
