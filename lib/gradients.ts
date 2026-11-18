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

/** Mesh styles, in the order Shuffle steps through them. */
export const MESH_STYLES = ["Soft blobs", "Grid", "Flow"] as const;

/**
 * Mesh: soft areas of colour that blend into each other, in three styles (Shuffle steps through them):
 * - 0 Soft blobs: each colour starts at its pin and is pushed apart from the others; round, calm.
 * - 1 Grid: the colours sit on a 2 × 3 grid (3 × 2 for wide frames), each in the slot nearest its pin,
 *   with a gentle wobble: the classic mesh-gradient look.
 * - 2 Flow: like Soft blobs, but the space is swirled, so the colours sweep and flow.
 * Each point mixes the colours by a soft Gaussian falloff in OKLab, and gets back the colourfulness
 * that mixing different hues takes away (capped, so hues never snap). Worked out directly at up to
 * 640 px on the long side and scaled up smoothly (no canvas blur filter, which Safari ignores).
 */
function drawMesh(ctx: CanvasRenderingContext2D, w: number, h: number, colours: Colour[], style = 0) {
  const long = Math.max(w, h), scale = Math.min(1, 640 / long);
  const sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(h * scale));
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const p3 = wideColor(), sctx = ctx2d(small), image = sctx.createImageData(sw, sh, { colorSpace: p3 ? "display-p3" : "srgb" });
  const ax = w / long, ay = h / long, short = Math.min(ax, ay);
  const kind = style % MESH_STYLES.length;
  const sig = [0.17, 0.2, 0.15][kind], cap = [1.8, 1.6, 1.8][kind];

  // Where each colour sits.
  let spots: { x: number; y: number; lab: Lab }[];
  if (kind === 1) {
    const tall = h >= w;
    const slots = tall
      ? [[0.15, 0.12], [0.85, 0.12], [0.15, 0.5], [0.85, 0.5], [0.15, 0.88], [0.85, 0.88]]
      : [[0.12, 0.15], [0.5, 0.15], [0.88, 0.15], [0.12, 0.85], [0.5, 0.85], [0.88, 0.85]];
    const left = [...colours];
    spots = slots.slice(0, colours.length).map(([x, y]) => {
      let best = 0, bestD = Infinity;
      left.forEach((c, i) => { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bestD) { bestD = d; best = i; } });
      return { x, y, lab: left.splice(best, 1)[0].lab };
    });
  } else {
    // Push the spots apart until none is closer than `spread` (measured in short sides of the frame).
    const spread = kind === 0 ? 0.75 : 0.65;
    spots = colours.map(c => ({ x: c.x, y: c.y, lab: c.lab }));
    for (let pass = 0; pass < 120; pass++) {
      for (const a of spots) for (const b of spots) {
        if (a === b) continue;
        const dx = (a.x - b.x) * ax / short, dy = (a.y - b.y) * ay / short, d = Math.hypot(dx, dy) || 1e-3;
        if (d >= spread) continue;
        const k = (spread - d) * 0.04 / d;
        a.x = Math.min(0.9, Math.max(0.1, a.x + dx * k * short / ax));
        a.y = Math.min(0.92, Math.max(0.08, a.y + dy * k * short / ay));
      }
    }
  }
  const chromas = spots.map(s => Math.hypot(s.lab[1], s.lab[2]));

  const d = image.data;
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    let u = (i + 0.5) / sw, v = (j + 0.5) / sh;
    if (kind === 2) {
      // Flow: two layers of gentle waves bend the space.
      for (let layer = 0; layer < 2; layer++) {
        const du = 0.2 * Math.sin(2.3 * v + 1.7 * u + 0.9) + 0.1 * Math.sin(4.1 * v - 2.6 * u + 2.2);
        const dv = 0.2 * Math.sin(2.1 * u - 1.3 * v + 0.3) + 0.1 * Math.sin(3.7 * u + 2.9 * v - 1.1);
        u += du; v += dv;
      }
    } else if (kind === 1) {
      // Grid: a slight wobble so the edges aren't straight.
      const wu = u + 0.06 * Math.sin(5.1 * v + 1.3) * Math.cos(3.3 * u), wv = v + 0.06 * Math.sin(4.7 * u - 0.7) * Math.cos(2.9 * v);
      u = wu; v = wv;
    }
    let total = 0, chroma = 0, L = 0, A = 0, B = 0;
    for (let k = 0; k < spots.length; k++) {
      const d2 = ((u - spots[k].x) * ax) ** 2 + ((v - spots[k].y) * ay) ** 2; // in long sides
      const wt = Math.exp(-d2 / (2 * sig * sig)) + 1e-9;
      total += wt; chroma += chromas[k] * wt;
      L += spots[k].lab[0] * wt; A += spots[k].lab[1] * wt; B += spots[k].lab[2] * wt;
    }
    L /= total; A /= total; B /= total;
    const now = Math.hypot(A, B), lift = now > 1e-4 ? Math.min(cap, (chroma / total) / now) : 1;
    const rgb = bytesOf([L, A * lift, B * lift], p3), o = (j * sw + i) * 4;
    // A whisper of noise (under one level) so smooth blends never show 8-bit bands.
    const n = Math.random() - 0.5;
    d[o] = rgb[0] + n; d[o + 1] = rgb[1] + n; d[o + 2] = rgb[2] + n; d[o + 3] = 255;
  }
  sctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w, h);
}

/** A gradient as a canvas. `grain`: 0–1. Linear uses the colours in the order given. */
/** A gradient as a canvas. `grain`: 0–1. Linear uses the colours in the order given. `meshStyle`: see MESH_STYLES. */
export function renderGradient(kind: Kind, colours: Colour[], w: number, h: number, grain: number, meshStyle = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  if (!ctx || !colours.length) return canvas;
  if (kind === "mesh") drawMesh(ctx, canvas.width, canvas.height, colours, meshStyle);
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
