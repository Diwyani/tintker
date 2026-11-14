import { bytesOf, ctx2d, hexOfLab, labOf, wideColor, type Lab } from "./color";

/**
 * Gradients from a palette. Colours are blended in OKLab (so blue into orange stays bright, not grey),
 * weighted by how much of the image each covers, with optional film grain.
 * Mesh: each colour glows from where it sits in the image. Linear: even bands at a slight diagonal.
 */
export type Colour = { hex: string; x: number; y: number; area: number; lab: Lab };
export type Kind = "mesh" | "linear" | "radial";
export { hexOf } from "./color";

/** Every pixel of an image in OKLab, three numbers per pixel. */
export function labsOf(data: Uint8ClampedArray, p3 = false) {
  const out = new Float32Array(data.length / 4 * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) out.set(labOf(data[i], data[i + 1], data[i + 2], p3), j);
  return out;
}

/** How much of the image each colour covers: the share of pixels nearest to it. */
export function sharesOf(labs: Float32Array, centres: Lab[]) {
  const counts = centres.map(() => 0);
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

/** Linear's angle, as in CSS (180 = top to bottom). A slight diagonal: reads as a gradient, not a flag. */
export const LINEAR_ANGLE = 160;

/** Linear: colours evenly spaced from one end to the other, the first at the start, the last at the end. */
const evenStops = (n: number) => Array.from({ length: n }, (_, i) => n > 1 ? i / (n - 1) : 0.5);

/** The start and end of the CSS gradient line for `angle` across a w × h box (same maths as CSS). */
function lineOf(w: number, h: number, angle = LINEAR_ANGLE) {
  const r = angle * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return { dx, dy, half, x1: w / 2 - dx * half, y1: h / 2 - dy * half, x2: w / 2 + dx * half, y2: h / 2 + dy * half };
}


/** The colour at t (0–1) along stops at `mids`, blended in OKLab at a steady rate (no flat bands, no sudden steps). */
function rampAt(labs: Lab[], mids: number[], t: number): Lab {
  if (t <= mids[0]) return labs[0];
  if (t >= mids[mids.length - 1]) return labs[labs.length - 1];
  let k = 0;
  while (k < mids.length - 2 && t > mids[k + 1]) k++;
  const u = (t - mids[k]) / (mids[k + 1] - mids[k]);
  return labs[k].map((v, i) => v + (labs[k + 1][i] - v) * u) as Lab;
}

/** Every colour the same width, blending at a steady rate (no flat bands, no sudden steps), at LINEAR_ANGLE. */
function drawLinear(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[]) {
  const labs = colours.map(c => c.lab), mids = evenStops(colours.length), p3 = wideColor();
  const steps = 1024, ramp = Array.from({ length: steps }, (_, i) => bytesOf(rampAt(labs, mids, i / (steps - 1)), p3));
  const { dx, dy, half } = lineOf(w, h), image = ctx.createImageData(w, h, { colorSpace: p3 ? "display-p3" : "srgb" }), d = image.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = ((x + 0.5 - w / 2) * dx + (y + 0.5 - h / 2) * dy) / (2 * half) + 0.5;
    const c = ramp[Math.max(0, Math.min(steps - 1, Math.round(t * (steps - 1))))], o = (y * w + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Rings from the middle out, evenly spaced, blending at a steady rate (no flat disc, no hard ring); the first colour is in the centre, the last reaches the corners. */
function drawRadial(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[]) {
  const labs = colours.map(c => c.lab), mids = evenStops(colours.length), p3 = wideColor();
  const steps = 512, ramp = Array.from({ length: steps }, (_, i) => bytesOf(rampAt(labs, mids, i / (steps - 1)), p3));
  const image = ctx.createImageData(w, h, { colorSpace: p3 ? "display-p3" : "srgb" }), d = image.data, cx = w / 2, cy = h / 2, reach = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = ramp[Math.min(steps - 1, Math.round(Math.hypot(x - cx, y - cy) / reach * (steps - 1)))], o = (y * w + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function drawMesh(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[]) {
  const long = Math.max(w, h), sw = Math.max(8, Math.round(40 * w / long)), sh = Math.max(8, Math.round(40 * h / long));
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sctx = ctx2d(small), image = sctx.createImageData(sw, sh, { colorSpace: wideColor() ? "display-p3" : "srgb" });
  const labs = colours.map(c => c.lab), p3 = wideColor(), sig = 0.18, ax = w / long, ay = h / long;
  // How far each colour reaches: bigger for colours that cover more, and for vivid ones (colourful
  // and light), so blacks and greys don't spread mud through the blend.
  const pull = colours.map((c, k) => Math.max(c.area, 0.04) ** 0.3 * (0.25 + Math.hypot(labs[k][1], labs[k][2]) * (0.4 + labs[k][0]) / 0.1));
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    const u = i / (sw - 1), v = j / (sh - 1), acc = [0, 0, 0];
    let total = 0, chroma = 0;
    colours.forEach((c, k) => {
      const d2 = ((u - c.x) * ax) ** 2 + ((v - c.y) * ay) ** 2;
      const wt = pull[k] * Math.exp(-d2 / (2 * sig * sig)) + 1e-6;
      total += wt;
      chroma += Math.hypot(labs[k][1], labs[k][2]) * wt;
      for (let a = 0; a < 3; a++) acc[a] += labs[k][a] * wt;
    });
    // Averaging different hues cancels their colour out (red + green → grey). Keep the blend as
    // colourful as the colours it came from: same hue and lightness, chroma restored.
    const mix = acc.map(a => a / total) as Lab, now = Math.hypot(mix[1], mix[2]), want = chroma / total;
    if (now > 1e-4) { mix[1] *= want / now; mix[2] *= want / now; }
    const rgb = bytesOf(mix, p3), o = (j * sw + i) * 4;
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
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  if (!ctx || !colours.length) return canvas;
  if (kind === "mesh") drawMesh(ctx, canvas.width, canvas.height, colours);
  else if (kind === "radial") drawRadial(ctx, canvas.width, canvas.height, colours);
  else drawLinear(ctx, canvas.width, canvas.height, colours);
  addGrain(ctx, canvas.width, canvas.height, grain);
  return canvas;
}

/** The linear gradient as CSS and SVG (no grain: neither can carry it). */
export function linearCss(colours: Colour[]) {
  const mids = evenStops(colours.length);
  return `linear-gradient(${LINEAR_ANGLE}deg, ${colours.map((c, i) => `${c.hex} ${Math.round(mids[i] * 100)}%`).join(", ")})`;
}
export function linearSvg(colours: Colour[], w: number, h: number) {
  const mids = evenStops(colours.length), { x1, y1, x2, y2 } = lineOf(w, h), r = (v: number) => Math.round(v * 10) / 10;
  const stops = colours.map((c, i) => `<stop offset="${Math.round(mids[i] * 100)}%" stop-color="${c.hex}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}">${stops}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}

/**
 * The mesh as SVG: each colour a soft radial glow where it sits in the photo, sized by how much it
 * covers, over the colours' average. Soft even where blur and noise filters are ignored (Figma,
 * Illustrator); browsers add the extra blur and the grain. Blends in RGB, so a little less clean than the PNG.
 */
export function meshSvg(colours: Colour[], w: number, h: number, grain: number) {
  const long = Math.max(w, h), total = colours.reduce((s, c) => s + Math.max(c.area, 0.02), 0);
  const avg = colours.reduce((acc, c) => {
    const lab = c.lab, k = Math.max(c.area, 0.02) / total;
    return acc.map((v, i) => v + lab[i] * k) as Lab;
  }, [0, 0, 0] as Lab);
  const base = hexOfLab(avg);
  // Big colours first, so small accents glow on top.
  const order = [...colours].sort((a, b) => b.area - a.area);
  const r2 = (v: number) => Math.round(v * 10) / 10;
  const defs = order.map((c, i) => {
    const r = long * (0.1 + Math.sqrt(Math.max(c.area, 0.02)) * 0.75);
    return `<radialGradient id="c${i}" gradientUnits="userSpaceOnUse" cx="${r2(c.x * w)}" cy="${r2(c.y * h)}" r="${r2(r)}">`
      + `<stop offset="0" stop-color="${c.hex}"/><stop offset=".4" stop-color="${c.hex}" stop-opacity=".7"/>`
      + `<stop offset="1" stop-color="${c.hex}" stop-opacity="0"/></radialGradient>`;
  }).join("");
  const glows = order.map((_, i) => `<rect width="${w}" height="${h}" fill="url(#c${i})"/>`).join("");
  const noise = grain > 0
    ? `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`
      + `</defs><rect width="${w}" height="${h}" fill="${base}"/><g filter="url(#soft)">${glows}</g>`
      + `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${r2(grain * 0.35 * 10) / 10}" style="mix-blend-mode:overlay"/>`
    : `</defs><rect width="${w}" height="${h}" fill="${base}"/><g filter="url(#soft)">${glows}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}`
    + `<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${r2(long / 30)}"/></filter>`
    + `${noise}</svg>`;
}

/** The radial gradient as CSS and SVG (no grain): equal rings, the first colour in the centre. */
export function radialCss(colours: Colour[]) {
  const mids = evenStops(colours.length);
  return `radial-gradient(circle farthest-corner, ${colours.map((c, i) => `${c.hex} ${Math.round(mids[i] * 100)}%`).join(", ")})`;
}
export function radialSvg(colours: Colour[], w: number, h: number) {
  const mids = evenStops(colours.length), r = Math.hypot(w / 2, h / 2);
  const stops = colours.map((c, i) => `<stop offset="${Math.round(mids[i] * 100)}%" stop-color="${c.hex}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${h / 2}" r="${Math.round(r)}">${stops}</radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}

/**
 * The mesh as CSS: one soft radial glow per colour at its spot (small colours on top), over the
 * colours' average. Close to the PNG, smoother, no grain.
 */
export function meshCss(colours: Colour[]) {
  const total = colours.reduce((sum, c) => sum + Math.max(c.area, 0.02), 0);
  const avg = colours.reduce((acc, c) => {
    const lab = c.lab, k = Math.max(c.area, 0.02) / total;
    return acc.map((v, i) => v + lab[i] * k) as Lab;
  }, [0, 0, 0] as Lab);
  const glows = [...colours].sort((a, b) => a.area - b.area).map(c => {
    const r = Math.round(10 + Math.sqrt(Math.max(c.area, 0.02)) * 75);
    return `radial-gradient(circle at ${Math.round(c.x * 100)}% ${Math.round(c.y * 100)}%, ${c.hex} 0%, ${c.hex}b3 ${Math.round(r * 0.4)}%, ${c.hex}00 ${r}%)`;
  });
  return [...glows, hexOfLab(avg)].join(", ");
}
