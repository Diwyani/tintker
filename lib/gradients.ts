/**
 * Gradients from a palette. Colours are blended in OKLab (so blue into orange stays bright, not grey),
 * weighted by how much of the image each covers, with optional film grain.
 * Mesh: each colour glows from where it sits in the image. Linear: bands top to bottom.
 */
export type Colour = { hex: string; x: number; y: number; area: number };
export type Kind = "mesh" | "linear";
type Lab = [number, number, number];

const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function labOf(r: number, g: number, b: number): Lab {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function rgbOf([L, a, b]: Lab): Lab {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(v => Math.max(0, Math.min(255, gam(Math.max(0, v))))) as Lab;
}

export const hexOf = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const labOfHex = (hex: string) => labOf(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));

/** Every pixel of an image in OKLab, three numbers per pixel. */
export function labsOf(data: Uint8ClampedArray) {
  const out = new Float32Array(data.length / 4 * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) out.set(labOf(data[i], data[i + 1], data[i + 2]), j);
  return out;
}

/** How much of the image each colour covers: the share of pixels nearest to it. */
export function sharesOf(labs: Float32Array, hexes: string[]) {
  const centres = hexes.map(labOfHex), counts = hexes.map(() => 0);
  for (let j = 0; j < labs.length; j += 3) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < centres.length; k++) {
      const c = centres[k], d = (labs[j] - c[0]) ** 2 + (labs[j + 1] - c[1]) ** 2 + (labs[j + 2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    counts[best]++;
  }
  const total = labs.length / 3 || 1;
  return counts.map(n => n / total);
}

function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const image = ctx.getImageData(0, 0, w, h), d = image.data, size = amount * 36;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * size;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

/** Where each linear band sits (0–1, its middle): wider for colours that cover more, never vanishing. */
export function bandStops(colours: Colour[]) {
  const weights = colours.map(c => Math.sqrt(Math.max(c.area, 0.02)));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map(w => { const mid = (acc + w / 2) / total; acc += w; return mid; });
}

function drawLinear(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[]) {
  const labs = colours.map(c => labOfHex(c.hex)), mids = bandStops(colours);
  for (let y = 0; y < h; y++) {
    const t = h > 1 ? y / (h - 1) : 0;
    let col: Lab;
    if (t <= mids[0]) col = labs[0];
    else if (t >= mids[mids.length - 1]) col = labs[labs.length - 1];
    else {
      let k = 0;
      while (k < mids.length - 2 && t > mids[k + 1]) k++;
      let u = (t - mids[k]) / (mids[k + 1] - mids[k]);
      u = u * u * (3 - 2 * u);
      col = labs[k].map((v, i) => v + (labs[k + 1][i] - v) * u) as Lab;
    }
    ctx.fillStyle = `rgb(${rgbOf(col).join(",")})`;
    ctx.fillRect(0, y, w, 1);
  }
}

function drawMesh(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[]) {
  const long = Math.max(w, h), sw = Math.max(8, Math.round(40 * w / long)), sh = Math.max(8, Math.round(40 * h / long));
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sctx = small.getContext("2d")!, image = sctx.createImageData(sw, sh);
  const labs = colours.map(c => labOfHex(c.hex)), sig = 0.18, ax = w / long, ay = h / long;
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    const u = i / (sw - 1), v = j / (sh - 1), acc = [0, 0, 0];
    let total = 0;
    colours.forEach((c, k) => {
      const d2 = ((u - c.x) * ax) ** 2 + ((v - c.y) * ay) ** 2;
      const wt = Math.max(c.area, 0.04) ** 0.3 * Math.exp(-d2 / (2 * sig * sig)) + 1e-6;
      total += wt;
      for (let a = 0; a < 3; a++) acc[a] += labs[k][a] * wt;
    });
    const rgb = rgbOf(acc.map(a => a / total) as Lab), o = (j * sw + i) * 4;
    image.data[o] = rgb[0]; image.data[o + 1] = rgb[1]; image.data[o + 2] = rgb[2]; image.data[o + 3] = 255;
  }
  sctx.putImageData(image, 0, 0);
  const margin = long / 8;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `blur(${long / 20}px)`;
  ctx.drawImage(small, -margin, -margin, w + margin * 2, h + margin * 2);
  ctx.filter = "none";
}

/** A gradient as a canvas. `grain`: 0–1. Linear uses the colours in the order given. */
export function renderGradient(kind: Kind, colours: Colour[], w: number, h: number, grain: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !colours.length) return canvas;
  if (kind === "mesh") drawMesh(ctx, canvas.width, canvas.height, colours);
  else drawLinear(ctx, canvas.width, canvas.height, colours);
  addGrain(ctx, canvas.width, canvas.height, grain);
  return canvas;
}

/** The linear gradient as CSS and SVG (no grain: neither can carry it). */
export function linearCss(colours: Colour[]) {
  const mids = bandStops(colours);
  return `linear-gradient(180deg, ${colours.map((c, i) => `${c.hex} ${Math.round(mids[i] * 100)}%`).join(", ")})`;
}
export function linearSvg(colours: Colour[], w: number, h: number) {
  const mids = bandStops(colours);
  const stops = colours.map((c, i) => `<stop offset="${Math.round(mids[i] * 100)}%" stop-color="${c.hex}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1" color-interpolation="linearRGB">${stops}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}
