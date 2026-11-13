export type Swatch = { hex: string; x: number; y: number };
type Colour = [number, number, number];

function lab(r: number, g: number, b: number): Colour {
  const linear = (channel: number) => channel <= 10.31475
    ? channel / 3294.6 : ((channel / 255 + 0.055) / 1.055) ** 2.4;
  [r, g, b] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.412221 * r + 0.536333 * g + 0.051446 * b);
  const m = Math.cbrt(0.211903 * r + 0.680700 * g + 0.107397 * b);
  const s = Math.cbrt(0.088302 * r + 0.281719 * g + 0.629979 * b);
  return [
    0.210454 * l + 0.793618 * m - 0.004072 * s,
    1.977998 * l - 2.428592 * m + 0.450594 * s,
    0.025904 * l + 0.782772 * m - 0.808676 * s,
  ];
}

export function extractPalettes(data: Uint8ClampedArray, width: number, height: number) {
  type Bucket = { sum: Colour; samples: { colour: Colour; offset: number }[] };
  const buckets = new Map<string, Bucket>();
  let opaque = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 128) continue;
    opaque++;
    const colour = lab(data[offset], data[offset + 1], data[offset + 2]);
    const key = colour.map((value, axis) => Math.round(value / (axis === 0 ? 0.08 : 0.035))).join("/");
    const bucket = buckets.get(key);
    if (bucket) {
      for (let axis = 0; axis < 3; axis++) bucket.sum[axis] += colour[axis];
      bucket.samples.push({ colour, offset });
    } else {
      buckets.set(key, { sum: [...colour], samples: [{ colour, offset }] });
    }
  }

  const distance = (a: Colour, b: Colour) =>
    Math.hypot((a[0] - b[0]) * 0.55, a[1] - b[1], a[2] - b[2]);

  const ranked = [...buckets.values()].map(({ sum, samples }) => {
    const count = samples.length;
    const centre: Colour = [sum[0] / count, sum[1] / count, sum[2] / count];
    const representative = samples.reduce((nearest, sample) =>
      distance(sample.colour, centre) < distance(nearest.colour, centre) ? sample : nearest);
    return { ...representative, count, chroma: Math.hypot(centre[1], centre[2]) };
  }).sort((a, b) => b.count - a.count);

  type Candidate = typeof ranked[number];
  function select(accent: boolean) {
    const chosen: Candidate[] = [];
    const supported = ranked.filter(candidate => candidate.count >= Math.max(3, opaque * 0.001));
    const candidates = supported.length ? supported : ranked;

    while (chosen.length < 6) {
      let best: Candidate | undefined;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const separation = Math.min(...chosen.map(other => distance(candidate.colour, other.colour)));
        if (separation < 0.063) continue;
        const chromaWeight = Math.min(candidate.chroma / 0.16, 1.5);
        const sameHue = chosen.some(other => {
          const [, a, b] = candidate.colour;
          const [, c, d] = other.colour;
          return Math.min(candidate.chroma, other.chroma) > 0.045
            && Math.abs(candidate.chroma - other.chroma) < 0.075
            && (a * c + b * d) / (Math.hypot(a, b) * Math.hypot(c, d)) > 0.92;
        });
        const coverage = candidate.count ** (accent && chosen.length ? 0.36 : 0.85);
        const saturation = accent && chosen.length ? 0.38 + 5 * chromaWeight ** 1.65 : 1 + 0.65 * chromaWeight;
        const diversity = Math.min(1, separation / 0.12) * (sameHue ? (accent ? 0.14 : 0.48) : 1);
        const score = coverage * saturation * diversity;
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

  function swatch({ offset }: typeof ranked[number]): Swatch {
    const pixel = offset / 4;
    const hex = Array.from(data.slice(offset, offset + 3), value => value.toString(16).padStart(2, "0")).join("");
    return { hex: "#" + hex.toUpperCase(), x: (pixel % width + 0.5) / width, y: (Math.floor(pixel / width) + 0.5) / height };
  }

  return { Scene: select(false).map(swatch), Accent: select(true).map(swatch) };
}

/** Rank paths through the extracted palette. With six swatches there are at most 720 orders. */
export function gradientOrders(hexes: string[]) {
  const colours = hexes.map(hex => lab(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ));
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
