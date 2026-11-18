import { hexOfLab, labOf, labOfHex, type Lab } from "@/lib/color";

export type Swatch = { hex: string; x: number; y: number; lab: Lab };
type Colour = Lab;

const GRID = 24;

/**
 * Two palettes from the pixels. `p3`: the pixels come from a Display P3 canvas.
 * Scene: the setting, so pixels near the frame's edges (sky, walls, ground) count more.
 * Accent: the subjects, so pixels that stand out from what's around them count more, and each colour
 * must come from a different place in the frame (six things, not three shades of one coat).
 * Each pin sits in the heart of its colour: the densest patch of it, not a stray pixel.
 */
export function extractPalettes(data: Uint8ClampedArray, width: number, height: number, p3 = false) {
  const count = width * height, labs = new Float32Array(count * 3), alpha = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    alpha[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    labs.set(labOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], p3), i * 3);
  }

  // Where a pixel stands out: its distance from the average colour of the area around it (a coarse
  // grid, each cell averaged with its neighbours), a little more in the middle of the frame.
  const cols = GRID, rows = Math.max(1, Math.round(GRID * height / width));
  const cellOf = (x: number, y: number) => Math.min(rows - 1, Math.floor(y / height * rows)) * cols + Math.min(cols - 1, Math.floor(x / width * cols));
  const cellSum = new Float64Array(cols * rows * 4);
  for (let i = 0; i < count; i++) {
    if (!alpha[i]) continue;
    const c = cellOf(i % width, Math.floor(i / width)) * 4;
    cellSum[c] += labs[i * 3]; cellSum[c + 1] += labs[i * 3 + 1]; cellSum[c + 2] += labs[i * 3 + 2]; cellSum[c + 3]++;
  }
  const around = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const acc = [0, 0, 0, 0];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      for (let k = 0; k < 4; k++) acc[k] += cellSum[(rr * cols + cc) * 4 + k];
    }
    for (let k = 0; k < 3; k++) around[(r * cols + c) * 3 + k] = acc[3] ? acc[k] / acc[3] : 0;
  }

  type Bucket = { sum: Colour; samples: { colour: Colour; offset: number }[]; scene: number; accent: number; cells: Map<number, number> };
  const buckets = new Map<string, Bucket>();
  let opaque = 0, standOutTotal = 0;
  const standOut = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (!alpha[i]) continue;
    const x = i % width, y = Math.floor(i / width), a = cellOf(x, y) * 3;
    const centred = Math.min(x / width, 1 - x / width, y / height, 1 - y / height) * 2; // 0 at an edge, 1 in the middle
    standOut[i] = Math.hypot((labs[i * 3] - around[a]) * 0.55, labs[i * 3 + 1] - around[a + 1], labs[i * 3 + 2] - around[a + 2]) * (0.7 + 0.6 * centred);
    standOutTotal += standOut[i];
  }
  const meanStandOut = standOutTotal / Math.max(1, count) || 1;

  for (let i = 0; i < count; i++) {
    if (!alpha[i]) continue;
    opaque++;
    const offset = i * 4, colour: Colour = [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]];
    const x = i % width, y = Math.floor(i / width);
    const edge = Math.min(x / width, 1 - x / width, y / height, 1 - y / height); // 0 at an edge, 0.5 in the middle
    const scene = edge < 0.15 ? 1.7 : edge < 0.28 ? 1 : 0.45;
    const accent = 0.25 + Math.min(3, standOut[i] / meanStandOut);
    const key = colour.map((value, axis) => Math.round(value / (axis === 0 ? 0.08 : 0.035))).join("/");
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = { sum: [0, 0, 0], samples: [], scene: 0, accent: 0, cells: new Map() });
    for (let axis = 0; axis < 3; axis++) bucket.sum[axis] += colour[axis];
    bucket.samples.push({ colour, offset });
    bucket.scene += scene;
    bucket.accent += accent;
    const cell = cellOf(x, y);
    bucket.cells.set(cell, (bucket.cells.get(cell) ?? 0) + 1);
  }

  const distance = (a: Colour, b: Colour) =>
    Math.hypot((a[0] - b[0]) * 0.55, a[1] - b[1], a[2] - b[2]);

  const ranked = [...buckets.values()].map(({ sum, samples, scene, accent, cells }) => {
    const count = samples.length;
    const centre: Colour = [sum[0] / count, sum[1] / count, sum[2] / count];
    // The heart of the colour: the grid cell where it's densest (with its neighbours), and in it
    // the pixel nearest the colour's average.
    let heart = 0, heartScore = -1;
    for (const cell of cells.keys()) {
      const r = Math.floor(cell / cols), c = cell % cols;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) n += cells.get((r + dr) * cols + c + dc) ?? 0;
      if (n > heartScore) { heartScore = n; heart = cell; }
    }
    let representative = samples[0], best = Infinity;
    for (const sample of samples) {
      const pixel = sample.offset / 4;
      if (cellOf(pixel % width, Math.floor(pixel / width)) !== heart) continue;
      const d = distance(sample.colour, centre);
      if (d < best) { best = d; representative = sample; }
    }
    const pixel = representative.offset / 4;
    return { ...representative, count, scene, accent, chroma: Math.hypot(centre[1], centre[2]),
      x: (pixel % width + 0.5) / width, y: (Math.floor(pixel / width) + 0.5) / height };
  }).sort((a, b) => b.count - a.count);

  type Candidate = typeof ranked[number];
  function select(accent: boolean) {
    const chosen: Candidate[] = [];
    const supported = ranked.filter(candidate => candidate.count >= Math.max(3, opaque * 0.001));
    const candidates = supported.length ? supported : ranked;
    const weight = (c: Candidate) => accent ? c.accent : c.scene;
    // Accent: how far a colour's heart is from the pins already chosen (different subjects).
    const apart = (c: Candidate) => chosen.length ? Math.min(...chosen.map(o => Math.hypot(c.x - o.x, (c.y - o.y) * height / width))) : 1;

    // Accent starts with the subject colour that stands out most, then always keeps the most vivid colour
    // in the picture (colourful and light: the yellow, the neon), so a bright accent is never crowded out.
    const vivid = (c: Candidate) => c.chroma * (0.2 + c.colour[0]) ** 1.5;
    // Looks past the noise filter: a flame or a neon sign is small and spread over many tiny buckets.
    const pool = ranked.filter(c => c.count >= Math.max(3, opaque * 0.0001));
    const brightest = accent ? (pool.length ? pool : ranked).reduce((a, b) => vivid(b) > vivid(a) ? b : a) : undefined;

    while (chosen.length < 6) {
      if (brightest && chosen.length === 1 && !chosen.includes(brightest)
        && Math.min(...chosen.map(other => distance(brightest.colour, other.colour))) >= 0.063) {
        chosen.push(brightest);
        continue;
      }
      let best: Candidate | undefined;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const separation = Math.min(...chosen.map(other => distance(candidate.colour, other.colour)));
        if (separation < 0.063) continue;
        const chromaWeight = Math.min(candidate.chroma / 0.16, 1.5);
        const sameHue = chosen.some(other => {
          const [, a, b] = candidate.colour;
          const [, c, d] = other.colour;
          // Same hue only if also close in lightness: yellow and orange share a hue angle but aren't the same colour.
          return Math.min(candidate.chroma, other.chroma) > 0.045
            && Math.abs(candidate.chroma - other.chroma) < 0.075
            && Math.abs(candidate.colour[0] - other.colour[0]) < 0.15
            && (a * c + b * d) / (Math.hypot(a, b) * Math.hypot(c, d)) > 0.92;
        });
        const coverage = weight(candidate) ** (accent ? 0.36 : 0.85);
        const saturation = accent ? 0.38 + 5 * chromaWeight ** 1.65 : 1 + 0.65 * chromaWeight;
        const diversity = Math.min(1, separation / 0.12) * (sameHue ? (accent ? 0.14 : 0.48) : 1);
        const place = accent ? 0.25 + 0.75 * Math.min(1, apart(candidate) / 0.18) : 1;
        const score = coverage * saturation * diversity * place;
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen;
  }

  const swatch = ({ colour, x, y }: Candidate): Swatch => ({ hex: hexOfLab(colour), lab: colour, x, y });

  return { Scene: select(false).map(swatch), Accent: select(true).map(swatch) };
}

/** Rank paths through the extracted palette. With six swatches there are at most 720 orders. */
export function gradientOrders(hexes: string[]) {
  const colours = hexes.map(labOfHex);
  const paths: { colours: string[]; cost: number; ascending: boolean }[] = [];

  function visit(path: number[], remaining: number[], cost: number) {
    if (!remaining.length) {
      const first = colours[path[0]];
      const last = colours[path[path.length - 1]];
      paths.push({ colours: path.map(index => hexes[index]), cost, ascending: !first || first[0] <= last[0] });
      return;
    }

    const previous = colours[path[path.length - 1]];
    for (const index of remaining) {
      const next = colours[index];
      // Squared perceptual distance penalizes a single abrupt jump more than several small ones.
      const jump = previous ? next.reduce((sum, value, axis) => sum + (value - previous[axis]) ** 2, 0) : 0;
      visit([...path, index], remaining.filter(other => other !== index), cost + jump);
    }
  }

  visit([], hexes.map((_, index) => index), 0);
  return paths.sort((a, b) => {
    const difference = a.cost - b.cost;
    // A path and its reverse can differ slightly due to floating-point addition order.
    return Math.abs(difference) > 1e-12 ? difference : Number(b.ascending) - Number(a.ascending);
  });
}
