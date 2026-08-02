// Shared 2D scaffolding: pulling a single channel out of a masked region as a
// dense plane, blurring it, band-passing it, and finding connected blobs in it.
//
// Split out of metrics-skin.js once lesion and line detection needed the same
// machinery. Nothing here knows anything about skin.

import { rgbToLab } from './color.js';

const lab = [0, 0, 0];

// Channel pickers. Each receives r,g,b and returns one number.
export const CHANNEL = {
  lightness: (r, g, b) => rgbToLab(r, g, b, lab)[0],
  aStar: (r, g, b) => rgbToLab(r, g, b, lab)[1],
  luma: (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function boxBlur(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      acc += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

// Copies one channel of a masked region into a dense rectangle. Pixels the mask
// rejected are filled with the region mean so blurs do not drag eyebrow or
// background values in across the boundary.
export function extractPlane(imageData, sample, pick) {
  if (!sample?.bbox || !sample.indices.length) return null;
  const { x0, y0, x1, y1 } = sample.bbox;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 8 || h < 8) return null;

  const d = imageData.data;
  const frameW = imageData.width;
  const values = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  let sum = 0, count = 0;

  for (let k = 0; k < sample.indices.length; k++) {
    const p = sample.indices[k];
    const lx = (p % frameW) - x0;
    const ly = ((p / frameW) | 0) - y0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
    const i = p * 4;
    const v = pick(d[i], d[i + 1], d[i + 2]);
    const local = ly * w + lx;
    values[local] = v;
    inside[local] = 1;
    sum += v; count++;
  }
  if (count < 64) return null;

  const mean = sum / count;
  for (let i = 0; i < values.length; i++) if (!inside[i]) values[i] = mean;
  return { values, inside, w, h, x0, y0, mean, count };
}

// Difference of two box blurs, normalised by the coarse level so the result is
// a local contrast ratio rather than an absolute difference. `divide: false`
// keeps raw units, which is what a* wants (it is already a signed difference
// scale and dividing by a near-zero mean explodes).
export function bandPass(plane, rIn, rOut, { divide = true } = {}) {
  const { values, inside, w, h } = plane;
  const fine = boxBlur(values, w, h, Math.max(1, rIn));
  const coarse = boxBlur(values, w, h, Math.max(rIn + 1, rOut));
  const residual = new Float32Array(w * h);

  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    if (!inside[i]) continue;
    const v = divide ? (fine[i] - coarse[i]) / Math.max(1, Math.abs(coarse[i])) : fine[i] - coarse[i];
    residual[i] = v;
    s += v; s2 += v * v; n++;
  }
  const mean = s / n;
  return { residual, mean, sigma: Math.sqrt(Math.max(0, s2 / n - mean * mean)), n };
}

// 8-connected components over a boolean candidate mask.
export function findBlobs(w, h, candidate, minPx, maxPx) {
  const seen = new Uint8Array(w * h);
  const blobs = [];
  const stack = [];

  for (let start = 0; start < w * h; start++) {
    if (!candidate[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const pixels = [];
    let minx = w, maxx = 0, miny = h, maxy = 0;

    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (candidate[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }

    if (pixels.length < minPx || pixels.length > maxPx) continue;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    blobs.push({
      pixels, area: pixels.length,
      bw, bh,
      aspect: Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)),
      // Fill ratio separates a compact lesion from a wispy shadow edge that
      // happens to span the same bounding box.
      fill: pixels.length / (bw * bh),
      cx: minx + bw / 2, cy: miny + bh / 2,
    });
  }
  return blobs;
}

// Structure-tensor anisotropy in a window around one point.
//
// Used to tell a lesion from a piece of a wrinkle. Both are dark and compact
// once thresholding chops a groove into fragments, but the neighbourhood gives
// it away: around a line the gradients all point one way, around a spot they
// point outward in every direction.
export function localCoherence(residual, inside, w, h, cx, cy, half) {
  let Jxx = 0, Jxy = 0, Jyy = 0, n = 0;
  const x0 = Math.max(1, cx - half), x1 = Math.min(w - 2, cx + half);
  const y0 = Math.max(1, cy - half), y1 = Math.min(h - 2, cy + half);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!inside[i] || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w]) continue;
      const ix = residual[i + 1] - residual[i - 1];
      const iy = residual[i + w] - residual[i - w];
      Jxx += ix * ix; Jxy += ix * iy; Jyy += iy * iy;
      n++;
    }
  }
  if (n < 24) return 0;
  const trace = Jxx + Jyy;
  if (trace <= 1e-12) return 0;
  return Math.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy * Jxy) / trace;
}

// Structure-tensor anisotropy over a region. Returns how strongly the texture
// runs in one direction and which direction that is. Wrinkles are anisotropic;
// pores are not.
export function orientationOf(plane, residual) {
  const { inside, w, h } = plane;
  let Jxx = 0, Jxy = 0, Jyy = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!inside[i] || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w]) continue;
      const ix = residual[i + 1] - residual[i - 1];
      const iy = residual[i + w] - residual[i - w];
      Jxx += ix * ix; Jxy += ix * iy; Jyy += iy * iy;
      n++;
    }
  }
  if (n < 32) return null;
  const trace = Jxx + Jyy;
  if (trace <= 1e-12) return null;
  const diff = Math.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy * Jxy);
  return {
    coherence: diff / trace,
    energy: Math.sqrt(trace / n),
    // Dominant gradient direction; ridges run perpendicular to it.
    gradientAngle: 0.5 * Math.atan2(2 * Jxy, Jxx - Jyy),
    samples: n,
  };
}
