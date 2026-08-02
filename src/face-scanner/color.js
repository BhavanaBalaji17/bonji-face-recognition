// Colour-space conversions. Inputs are 8-bit sRGB channels (0-255).

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// D65 reference white
const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;

function fLab(t) {
  return t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 16 / 116;
}

export function rgbToLab(r, g, b, out = [0, 0, 0]) {
  const R = LINEAR[r], G = LINEAR[g], B = LINEAR[b];
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / Xn;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / Yn;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / Zn;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

export function rgbToHsv(r, g, b, out = [0, 0, 0]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  out[0] = h;
  out[1] = max <= 0 ? 0 : d / max;
  out[2] = max;
  return out;
}

// Erythema index (Dawson et al. 1980) — log ratio of red to green reflectance.
// Haemoglobin absorbs green much more than red, so redder skin scores higher.
// This is a *relative* measure: only ever compare two regions of the same face.
export function erythemaIndex(r, g) {
  return 100 * Math.log10((r + 1) / (g + 1));
}

// Individual Typology Angle — the standard objective skin-tone measure.
// Higher = lighter. Used to normalise every other metric per tone band,
// because absolute colour thresholds do not transfer across skin tones.
export function ita(L, b) {
  return Math.atan2(L - 50, b) * (180 / Math.PI);
}

// ITA bands per Chardon et al. Not Fitzpatrick (that is a sun-reaction scale,
// not a colour scale) — do not label these as Fitzpatrick types in the UI.
export function itaBand(angle) {
  if (angle > 55) return 'very-light';
  if (angle > 41) return 'light';
  if (angle > 28) return 'intermediate';
  if (angle > 10) return 'tan';
  if (angle > -30) return 'brown';
  return 'dark';
}

export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
