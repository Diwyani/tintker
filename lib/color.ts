/*
  Wide colour (same approach as Flipbook). Phone photos are in Display P3, richer than the sRGB a
  canvas uses by default; drawing one onto an sRGB canvas squeezes its strongest colours. So canvases
  are Display P3 where the browser has it (Chrome, Edge, Safari) and stay sRGB elsewhere (Firefox).

  All colour maths is in OKLab, which holds P3 colours fine. Colours go out three ways:
  - on screen and in PNGs: Display P3 where available (`cssOf`, `bytesOf`), so they keep their punch;
  - hex codes, CSS and SVG: sRGB (that's all a hex can be), the nearest colour that fits, found by
    lowering chroma at the same lightness and hue, not by clipping channels (which shifts the hue).
*/
export type Lab = [number, number, number];

let wide: boolean | null = null;

/** Whether canvases can be Display P3 in this browser. */
export function wideColor(): boolean {
  if (wide === null) {
    try {
      const g = document.createElement("canvas").getContext("2d", { colorSpace: "display-p3" });
      wide = g?.getContextAttributes?.().colorSpace === "display-p3";
    } catch {
      wide = false;
    }
  }
  return wide;
}

/** A canvas's 2D context, in Display P3 where the browser has it. */
export function ctx2d(c: HTMLCanvasElement, settings: CanvasRenderingContext2DSettings = {}): CanvasRenderingContext2D {
  return c.getContext("2d", wideColor() ? { ...settings, colorSpace: "display-p3" } : settings)!;
}

// sRGB and Display P3 share the same transfer curve; only their primaries differ.
const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const p3ToSrgb = ([r, g, b]: Lab): Lab => [1.2249401 * r - 0.2249404 * g, -0.0420569 * r + 1.0420571 * g, -0.0196376 * r - 0.0786361 * g + 1.0982735 * b];
const srgbToP3 = ([r, g, b]: Lab): Lab => [0.8224621 * r + 0.177538 * g, 0.0331941 * r + 0.9668058 * g, 0.0170827 * r + 0.0723974 * g + 0.9105199 * b];

function labOfLinear([r, g, b]: Lab): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function linearOfLab([L, a, b]: Lab): Lab {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLab of a pixel's bytes; `p3` when they come from a Display P3 canvas. */
export function labOf(r: number, g: number, b: number, p3 = false): Lab {
  const rgb: Lab = [lin(r), lin(g), lin(b)];
  return labOfLinear(p3 ? p3ToSrgb(rgb) : rgb);
}

const inside = (v: Lab) => v.every(c => c >= -1e-4 && c <= 1 + 1e-4);

/** Linear channels (0–1) in sRGB or P3: the colour itself if it fits, else less chroma, same lightness and hue. */
function fit(lab: Lab, p3: boolean): Lab {
  const into = (v: Lab) => { const s = linearOfLab(v); return p3 ? srgbToP3(s) : s; };
  let out = into(lab);
  if (!inside(out)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const k = (lo + hi) / 2;
      if (inside(into([lab[0], lab[1] * k, lab[2] * k]))) lo = k; else hi = k;
    }
    out = into([lab[0], lab[1] * lo, lab[2] * lo]);
  }
  return out.map(c => Math.min(1, Math.max(0, c))) as Lab;
}

/**
 * 0–255 bytes for gradient pixels (P3 bytes when `p3`). Channels are simply clamped, as before the
 * P3 change: lowering chroma here would grey out the blends between colours and show as rings.
 */
export function bytesOf(lab: Lab, p3 = false) {
  const s = linearOfLab(lab), v = p3 ? srgbToP3(s) : s;
  return v.map(c => gam(Math.min(1, Math.max(0, c)))) as Lab;
}

export const hexOf = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** The sRGB hex code: the nearest a hex can get to the colour. */
export const hexOfLab = (lab: Lab) => hexOf(...(fit(lab, false).map(gam) as Lab));
export const labOfHex = (hex: string) => labOf(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));

/** A colour for CSS or a canvas fillStyle: Display P3 where the browser has it, else the hex. */
export function cssOf(lab: Lab) {
  if (!wideColor()) return hexOfLab(lab);
  const [r, g, b] = fit(lab, true).map(v => (gam(v) / 255).toFixed(4));
  return `color(display-p3 ${r} ${g} ${b})`;
}

export const chromaOf = (lab: Lab) => Math.hypot(lab[1], lab[2]);
