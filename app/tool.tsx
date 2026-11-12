"use client";

import { ChevronDown, ImagePlus, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { looksLikeHeic } from "@/lib/heic";
import { hexOf, labsOf, linearCss, linearSvg, renderGradient, sharesOf, type Colour, type Kind } from "@/lib/gradients";
import { extractPalettes, gradientOrders } from "./palette";
import styles from "./tool.module.css";

type Mode = keyof ReturnType<typeof extractPalettes>;
type Swatch = { hex: string; x: number; y: number };
type Photo = {
  pixels: ImageData; labs: Float32Array; name: string; src: string;
  width: number; height: number; palettes: ReturnType<typeof extractPalettes>;
};

const MODE_HINT: Record<Mode, string> = {
  Scene: "Colours that fill the frame",
  Accent: "Colours that stand out, even small ones",
};
const KIND_HINT: Record<Kind, string> = {
  mesh: "Mesh: each colour glows from where it is in the photo",
  linear: "Linear: bands sized by how much each colour covers",
};

async function decode(file: File) {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    if (!looksLikeHeic(file)) throw error;
    const { heicTo } = await import("heic-to/next");
    return heicTo({ blob: file, type: "bitmap" });
  }
}

function draw(bitmap: ImageBitmap, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

const encode = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image encoding failed.")), type, 0.94));

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A readable title from a file name; phone and download names (codes, dates) give none. */
function titleOf(name: string) {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").trim();
  if (!base || /^[0-9a-f-]{16,}/i.test(base) || /\d{4}-\d\d-\d\dT/.test(base) || /^(img|dsc|pxl|image)[ _-]?\d+/i.test(base) || /^[-\s]*$/.test(base)) return "";
  return base.replace(/\s*[-–|]\s*colou?r palette.*$/i, "").replace(/\s*\(\d+\)$/, "").trim().slice(0, 60);
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tintker";

/** The average colour of a small patch of the image around a point (0–1). */
function sampleAt({ data, width, height }: ImageData, x: number, y: number): Swatch {
  const cx = Math.round(x * (width - 1)), cy = Math.round(y * (height - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = Math.max(0, cy - 2); j <= Math.min(height - 1, cy + 2); j++) {
    for (let i = Math.max(0, cx - 2); i <= Math.min(width - 1, cx + 2); i++) {
      const o = (j * width + i) * 4;
      r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
    }
  }
  return { hex: hexOf(r / n, g / n, b / n), x, y };
}

/**
 * The polaroid card: the image in a paper frame, the palette printed under it like a caption,
 * hex codes, and the title. 1080 × 1350, light paper grain.
 */
async function drawCard(src: string, colours: Colour[], title: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const W = 1080, H = 1350, pad = 64, canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#F6F3EA";
  ctx.fillRect(0, 0, W, H);
  // The photo, cropped to fill its window.
  const iw = W - pad * 2, ih = 880;
  const scale = Math.max(iw / image.naturalWidth, ih / image.naturalHeight);
  const sw = iw / scale, sh = ih / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, pad, pad, iw, ih);
  // The palette, printed as the caption.
  const top = pad + ih + 28, bandH = 160, bw = iw / colours.length;
  colours.forEach((c, i) => {
    ctx.fillStyle = c.hex;
    ctx.fillRect(Math.round(pad + i * bw), top, Math.ceil(bw), bandH);
    ctx.fillStyle = "#8A867C";
    ctx.font = "500 21px ui-monospace, Menlo, monospace";
    ctx.fillText(c.hex.slice(1), pad + i * bw + 2, top + bandH + 34);
  });
  ctx.fillStyle = "#24231F";
  ctx.font = "italic 400 46px Georgia, 'Times New Roman', serif";
  ctx.fillText(title || "Untitled", pad, H - pad - 4);
  ctx.fillStyle = "#A3A095";
  ctx.font = "500 22px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("tintker", W - pad, H - pad - 4);
  // Paper grain.
  const paper = ctx.getImageData(0, 0, W, H), d = paper.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(paper, 0, 0);
  return canvas;
}

export default function ColourTool() {
  const input = useRef<HTMLInputElement>(null);
  const imageBox = useRef<HTMLDivElement>(null);
  const saveMenu = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const dragDepth = useRef(0);
  const frame = useRef(0);
  const held = useRef<{ index: number; pointer: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [photo, setPhoto] = useState<Photo>();
  const [mode, setMode] = useState<Mode>("Accent");
  const [picks, setPicks] = useState<Swatch[]>([]);
  const [kind, setKind] = useState<Kind>("mesh");
  const [grain, setGrain] = useState(35);
  const [order, setOrder] = useState(0);
  const [title, setTitle] = useState("");
  const [active, setActive] = useState<number>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const src = photo?.src;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => { request.current++; cancelAnimationFrame(frame.current); clearTimeout(noteTimer.current); }, []);

  // The Save menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!saveOpen) return;
    const away = (event: PointerEvent) => { if (!saveMenu.current?.contains(event.target as Node)) setSaveOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSaveOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [saveOpen]);

  /** The palette with each colour's share of the image. */
  const colours: Colour[] = useMemo(() => {
    if (!photo || !picks.length) return [];
    const shares = sharesOf(photo.labs, picks.map(p => p.hex));
    return picks.map((p, i) => ({ ...p, area: shares[i] }));
  }, [photo, picks]);

  /** Linear runs through the colours in the smoothest order; Shuffle steps through the next-best ones. */
  const linearColours = useMemo(() => {
    if (colours.length < 2) return colours;
    const paths = gradientOrders(colours.map(c => c.hex)).slice(0, 6);
    const path = paths[order % paths.length];
    const used = new Set<number>();
    return path.colours.map(hex => {
      const i = colours.findIndex((c, k) => !used.has(k) && c.hex === hex);
      used.add(i);
      return colours[i];
    });
  }, [colours, order]);

  const previews = useMemo(() => {
    if (!photo || !colours.length) return null;
    const w = 200, h = Math.round(200 * Math.min(1.6, Math.max(0.6, photo.height / photo.width)));
    return {
      mesh: renderGradient("mesh", colours, w, h, grain / 100).toDataURL(),
      linear: renderGradient("linear", linearColours, w, h, grain / 100).toDataURL(),
    };
  }, [photo, colours, linearColours, grain]);

  function say(message: string) {
    setNote(message);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 2200);
  }

  function choose(next: Photo, nextMode: Mode) {
    setPicks(next.palettes[nextMode].map(({ hex, x, y }) => ({ hex, x, y })));
    setOrder(0);
    setActive(undefined);
  }

  async function load(file: File) {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      if (!looksLikeHeic(file) && !/\.(jpe?g|png|webp)$/i.test(file.name) && !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        throw new Error("Choose a JPEG, PNG or HEIC image.");
      }
      const bitmap = await decode(file);
      try {
        const { canvas, context } = draw(bitmap, 256);
        const { width, height } = canvas;
        const pixels = context.getImageData(0, 0, width, height);
        const palettes = extractPalettes(pixels.data, width, height);
        if (!palettes.Scene.length) throw new Error("This image has no opaque colours to sample.");
        const preview = draw(bitmap, 2200).canvas;
        const blob = await encode(preview, file.type === "image/png" || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
        if (id !== request.current) return;
        const next = { name: file.name, src: URL.createObjectURL(blob), width, height, pixels, labs: labsOf(pixels.data), palettes };
        setPhoto(next);
        setTitle(titleOf(file.name));
        choose(next, mode);
      } finally {
        bitmap.close();
      }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error && /^(Choose|This image)/.test(cause.message)
        ? cause.message : "Couldn’t read that image. Try another JPEG, PNG or HEIC.");
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      say(message);
    } catch {
      say("Your browser didn’t allow copying");
    }
  }

  /** Moves a pin and takes the colour under it. */
  function movePin(index: number, x: number, y: number) {
    if (!photo) return;
    const point = sampleAt(photo.pixels, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
    setPicks(previous => previous.map((p, i) => i === index ? point : p));
  }

  async function saveGradient() {
    if (!photo) return;
    const long = 2048, ratio = photo.height / photo.width;
    const w = ratio > 1 ? long / ratio : long, h = ratio > 1 ? long : long * ratio;
    const canvas = renderGradient(kind, kind === "mesh" ? colours : linearColours, w, h, grain / 100);
    download(await encode(canvas, "image/png"), `${slug(title)}-${kind}.png`);
    setSaveOpen(false);
    say(`Saved the ${kind} gradient`);
  }

  async function saveCard() {
    if (!photo) return;
    const canvas = await drawCard(photo.src, colours, title);
    download(await encode(canvas, "image/png"), `${slug(title)}-card.png`);
    setSaveOpen(false);
    say("Saved the card");
  }

  const browse = () => input.current?.click();
  const ambient = previews?.[kind];
  const shown = active === undefined ? undefined : colours[active];
  const caption = note || (shown ? `${shown.hex} · ${Math.max(1, Math.round(shown.area * 100))}% of the photo` : "Click a colour to copy it. Drag a dot on the photo to pick another.");

  return (
    <main
      className={styles.page}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setFileOver(true);
      }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setFileOver(false); } }}
      onDrop={event => {
        event.preventDefault();
        dragDepth.current = 0;
        setFileOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void load(file);
      }}
    >
      {/* The chosen gradient, softly behind everything: the page is the gradient you'd save. */}
      <div className={styles.ambient} style={{ backgroundImage: ambient ? `url(${ambient})` : undefined, opacity: ambient ? 1 : 0 }} aria-hidden="true" />
      <header className={styles.header}><span className={styles.wordmark}>Tintker</span></header>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void load(file);
        }} />

      {photo ? (
        <div className={styles.stage} aria-busy={busy}>
          <input className={styles.title} value={title} placeholder="Name this palette" maxLength={60} aria-label="Palette name"
            onChange={event => setTitle(event.currentTarget.value)} />
          <div className={styles.photo} ref={imageBox}
            style={{ aspectRatio: `${photo.width} / ${photo.height}`, width: `min(100%, calc((100svh - 18.5rem) * ${(photo.width / photo.height).toFixed(4)}))` } as CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local image the visitor chose */}
            <img src={photo.src} alt="" draggable={false} />
            {picks.map((p, i) => (
              <button key={i} type="button" className={styles.pin} data-active={active === i}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: p.hex }}
                aria-label={`Colour ${i + 1}, ${p.hex}. Drag or use arrow keys to pick another colour`}
                onPointerEnter={() => setActive(i)} onPointerLeave={() => { if (!held.current) setActive(undefined); }}
                onFocus={() => setActive(i)} onBlur={() => setActive(undefined)}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  held.current = { index: i, pointer: event.pointerId };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setActive(i);
                }}
                onPointerMove={event => {
                  const h = held.current, box = imageBox.current?.getBoundingClientRect();
                  if (!h || h.pointer !== event.pointerId || !box) return;
                  const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
                  cancelAnimationFrame(frame.current);
                  frame.current = requestAnimationFrame(() => movePin(h.index, x, y));
                }}
                onLostPointerCapture={() => { held.current = null; }}
                onKeyDown={event => {
                  const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                  const d = step[event.key];
                  if (!d) return;
                  event.preventDefault();
                  const k = event.shiftKey ? 0.08 : 0.02;
                  movePin(i, p.x + d[0] * k, p.y + d[1] * k);
                }} />
            ))}
          </div>

          <div className={styles.dots} role="group" aria-label="Colours">
            {colours.map((c, i) => (
              <button key={i} type="button" className={styles.dot} data-active={active === i} style={{ background: c.hex }}
                aria-label={`Copy ${c.hex}, ${Math.max(1, Math.round(c.area * 100))}% of the photo`}
                onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(undefined)}
                onFocus={() => setActive(i)} onBlur={() => setActive(undefined)}
                onClick={() => void copy(c.hex, `Copied ${c.hex}`)} />
            ))}
          </div>
          <p className={styles.caption} role="status">{caption}</p>

          {/* The dock: everything else, in plain words. */}
          <div className={styles.dock}>
            <div className={styles.modes} role="group" aria-label="Which colours">
              {(["Scene", "Accent"] as const).map(value => (
                <button key={value} type="button" aria-pressed={mode === value} disabled={busy} title={MODE_HINT[value]}
                  onClick={() => { if (mode !== value) { setMode(value); choose(photo, value); say(MODE_HINT[value]); } }}>{value}</button>
              ))}
            </div>
            <span className={styles.rule} aria-hidden="true" />
            <div className={styles.kinds} role="group" aria-label="Gradient">
              {(["mesh", "linear"] as const).map(value => (
                <button key={value} type="button" className={styles.kind} aria-pressed={kind === value}
                  aria-label={value === "mesh" ? "Mesh gradient" : "Linear gradient"} title={KIND_HINT[value]}
                  style={{ backgroundImage: previews ? `url(${previews[value]})` : undefined }}
                  onClick={() => { setKind(value); say(KIND_HINT[value]); }} />
              ))}
              {kind === "linear" && <button type="button" className={styles.iconButton} aria-label="Shuffle the order" title="Shuffle the order"
                onClick={() => setOrder(o => o + 1)}><Shuffle size={15} /></button>}
            </div>
            <span className={styles.rule} aria-hidden="true" />
            <button type="button" className={styles.iconButton} onClick={browse} aria-label="New image" title="New image"><ImagePlus size={16} /></button>
            <div className={styles.saveWrap} ref={saveMenu}>
              <button type="button" className={styles.save} aria-expanded={saveOpen} aria-haspopup="true" onClick={() => setSaveOpen(o => !o)}>
                Save <ChevronDown size={14} aria-hidden="true" />
              </button>
              {saveOpen && (
                <div className={styles.menu} role="menu">
                  {/* eslint-disable-next-line @next/next/no-img-element -- generated preview */}
                  {previews && <img className={styles.menuPreview} src={previews[kind]} alt="" />}
                  <label className={styles.grain}>
                    <span>Grain</span>
                    <input type="range" min="0" max="100" value={grain} onChange={event => setGrain(event.currentTarget.valueAsNumber)} />
                  </label>
                  <button type="button" role="menuitem" onClick={() => void saveGradient()}>{kind === "mesh" ? "Mesh" : "Linear"} gradient <small>PNG</small></button>
                  <button type="button" role="menuitem" onClick={() => void saveCard()}>Palette card <small>PNG</small></button>
                  <button type="button" role="menuitem" onClick={() => { setSaveOpen(false); void copy(colours.map(c => c.hex).join(", "), "Copied all colours"); }}>Copy colours</button>
                  {kind === "linear" && <>
                    <button type="button" role="menuitem" onClick={() => { setSaveOpen(false); void copy(`background: ${linearCss(linearColours)};`, "Copied the CSS"); }}>Copy CSS</button>
                    <button type="button" role="menuitem" onClick={() => {
                      download(new Blob([linearSvg(linearColours, 1024, 1024)], { type: "image/svg+xml" }), `${slug(title)}-linear.svg`);
                      setSaveOpen(false);
                      say("Saved the SVG (no grain)");
                    }}>Linear gradient <small>SVG</small></button>
                  </>}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <section className={styles.drop} aria-label="Choose an image" aria-busy={busy}>
          <ImagePlus size={26} aria-hidden="true" />
          <h1>Find the colours in a photo or film still</h1>
          <p>Drop an image anywhere, or choose one. It never leaves your browser.</p>
          <button type="button" className={styles.browse} onClick={browse} disabled={busy}>{busy ? "Reading…" : "Choose an image"}</button>
          <small>JPEG · PNG · HEIC</small>
        </section>
      )}

      {fileOver && <div className={styles.dragOverlay}>Drop to find its colours</div>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <footer className={styles.footer}>
        <details>
          <summary>Built by Diwyani</summary>
          <div className={styles.footerPanel}>
            <a href="https://in.linkedin.com/in/diwyani-vajpayee-9b2270213" target="_blank" rel="noreferrer">LinkedIn</a>
            <a href="https://x.com/DiwyaniVajpayee" target="_blank" rel="noreferrer">Twitter</a>
          </div>
        </details>
        <span aria-hidden="true">·</span>
        <details className={styles.credits}>
          <summary>Credits</summary>
          <div className={styles.footerPanel}>
            <p>iPhone photos (HEIC) are opened with <a href="https://github.com/hoppergee/heic-to" target="_blank" rel="noreferrer">heic-to</a> and <a href="https://github.com/strukturag/libheif" target="_blank" rel="noreferrer">libheif</a>, under the <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noreferrer">LGPL-3.0</a>.</p>
            <p className={styles.quiet}>Built with Next.js and React (MIT).</p>
            <p className={styles.quiet}>© 2026 Diwyani Vajpayee. All rights reserved.</p>
          </div>
        </details>
      </footer>
    </main>
  );
}
