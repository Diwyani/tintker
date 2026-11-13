"use client";

import { Braces, Copy, Download, Hash, ImageDown, ImagePlus, Mail, RectangleVertical, RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { looksLikeHeic } from "@/lib/heic";
import { hexOf, labsOf, linearCss, linearSvg, meshCss, meshSvg, radialCss, radialSvg, renderGradient, sharesOf, type Colour, type Kind } from "@/lib/gradients";
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
const XIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3Z" />
  </svg>
);
const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.83 3.37-1.83 3.6 0 4.27 2.37 4.27 5.46v6.26ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
);

/** Where "Email" in the who-made-this popover goes. Empty hides it. */
const EMAIL = "diwyani.vajpayee@gmail.com";

const KIND_LABEL: Record<Kind, string> = { mesh: "Mesh", linear: "Linear", radial: "Radial" };
const KIND_HINT: Record<Kind, string> = {
  radial: "Radial: rings from the middle out, every colour the same width",
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
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-hand").trim() || "Georgia, serif";
  await document.fonts.load(`64px ${family}`).catch(() => {});
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
  ctx.font = `400 46px ${family}`;
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
  const meMenu = useRef<HTMLDivElement>(null);
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
  // PNG or SVG for gradient downloads, remembered in this browser.
  const [peek, setPeek] = useState<Kind>();
  const [format, setFormat] = useState<"png" | "svg">(() => {
    try { return localStorage.getItem("tintker-format") === "svg" ? "svg" : "png"; } catch { return "png"; }
  });
  const chooseFormat = (value: "png" | "svg") => {
    setFormat(value);
    try { localStorage.setItem("tintker-format", value); } catch { /* private mode: just not remembered */ }
  };
  const [order, setOrder] = useState(0);
  const [title, setTitle] = useState("");
  const [active, setActive] = useState<number>();
  const [open, setOpen] = useState<"save" | "me" | null>(null);
  const saveOpen = open === "save";
  const setSaveOpen = (value: boolean) => setOpen(value ? "save" : null);
  const [fileOver, setFileOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const src = photo?.src;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => { request.current++; cancelAnimationFrame(frame.current); clearTimeout(noteTimer.current); }, []);

  // A popover closes on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    const box = open === "save" ? saveMenu : meMenu;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [open]);

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

  /** Mesh: Shuffle moves each colour to another colour's spot, for a new arrangement. */
  const meshColours = useMemo(() => {
    const n = colours.length, k = n ? order % n : 0;
    return k ? colours.map((c, i) => ({ ...c, x: colours[(i + k) % n].x, y: colours[(i + k) % n].y })) : colours;
  }, [colours, order]);

  const previews = useMemo(() => {
    if (!photo || !colours.length) return null;
    const w = 200, h = Math.round(200 * Math.min(1.6, Math.max(0.6, photo.height / photo.width)));
    return {
      mesh: renderGradient("mesh", meshColours, w, h, grain / 100).toDataURL(),
      linear: renderGradient("linear", linearColours, w, h, grain / 100).toDataURL(),
      radial: renderGradient("radial", linearColours, w, h, grain / 100).toDataURL(),
    };
  }, [photo, colours, meshColours, linearColours, grain]);

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

  /** A gradient in the chosen file type. SVG has no grain, except Mesh's, which shows in browsers. */
  async function downloadGradient(which: Kind) {
    if (!photo) return;
    const ratio = photo.height / photo.width, ordered = which === "mesh" ? meshColours : linearColours;
    if (format === "png") {
      const long = 2048, w = ratio > 1 ? long / ratio : long, h = ratio > 1 ? long : long * ratio;
      download(await encode(renderGradient(which, ordered, w, h, grain / 100), "image/png"), `${slug(title)}-${which}.png`);
      setOpen(null);
      say(`Saved the ${which} gradient`);
      return;
    }
    const w = ratio > 1 ? Math.round(1024 / ratio) : 1024, h = ratio > 1 ? 1024 : Math.round(1024 * ratio);
    const svg = which === "mesh" ? meshSvg(ordered, w, h, grain / 100) : which === "radial" ? radialSvg(ordered, w, h) : linearSvg(ordered, w, h);
    download(new Blob([svg], { type: "image/svg+xml" }), `${slug(title)}-${which}.svg`);
    setOpen(null);
    say(which === "mesh" ? "Saved the SVG (grain shows in browsers only)" : "Saved the SVG (no grain)");
  }

  async function saveCard() {
    if (!photo) return;
    const canvas = await drawCard(photo.src, colours, title);
    download(await encode(canvas, "image/png"), `${slug(title)}-card.png`);
    setSaveOpen(false);
    say("Saved the card");
  }

  const browse = () => input.current?.click();
  const changed = !!photo && picks.some((p, i) => p.hex !== photo.palettes[mode][i]?.hex || p.x !== photo.palettes[mode][i]?.x || p.y !== photo.palettes[mode][i]?.y);
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
            <button type="button" className={styles.copyAll} aria-label="Copy all colours" title="Copy all colours"
              onClick={() => void copy(colours.map(c => c.hex).join(", "), "Copied all colours")}><Copy size={15} /></button>
            {/* Shows once a colour has been moved: puts every pin back where Tintker found it. */}
            {changed && <button type="button" className={styles.copyAll} aria-label="Reset colours" title="Reset colours"
              onClick={() => { choose(photo, mode); say("Colours reset"); }}><RotateCcw size={15} /></button>}
          </div>
          <div className={styles.modes} role="group" aria-label="Which colours">
            {(["Scene", "Accent"] as const).map(value => (
              <button key={value} type="button" aria-pressed={mode === value} disabled={busy} title={MODE_HINT[value]}
                onClick={() => { if (mode !== value) { setMode(value); choose(photo, value); say(MODE_HINT[value]); } }}>{value}</button>
            ))}
          </div>
          <p className={styles.caption} role="status">{caption}</p>

          {/* The dock: only what you make from the colours. */}
          <div className={styles.dock}>
            <button type="button" className={styles.round} onClick={browse} aria-label="New image" title="New image"><ImagePlus size={17} /></button>
            <div className={styles.pill} role="group" aria-label="Gradient">
              {(["mesh", "linear", "radial"] as const).map(value => (
                <button key={value} type="button" className={styles.kind} aria-pressed={kind === value}
                  aria-label={`${KIND_LABEL[value]} gradient`} title={KIND_HINT[value]}
                  style={{ backgroundImage: previews ? `url(${previews[value]})` : undefined }}
                  onClick={() => { setKind(value); say(KIND_HINT[value]); }} />
              ))}
              <button type="button" className={styles.iconButton} aria-label="Shuffle" title={kind === "mesh" ? "Shuffle where the colours glow" : kind === "radial" ? "Shuffle which colour is in the middle" : "Shuffle the order"}
                onClick={() => setOrder(o => o + 1)}><Shuffle size={14} /></button>
            </div>
            <div className={styles.popWrap} ref={saveMenu}>
              <button type="button" className={styles.round} aria-expanded={saveOpen} aria-haspopup="menu" aria-label="Save" title="Save"
                onClick={() => setOpen(saveOpen ? null : "save")}><Download size={16} /></button>
              <div className={styles.menu} role="menu" data-open={saveOpen} inert={!saveOpen}>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated preview */}
                {previews && <img className={styles.menuPreview} src={previews[peek ?? kind]} alt="" />}
                <label className={styles.grain}>
                  <span>Grain</span>
                  <input type="range" min="0" max="100" value={grain} onChange={event => setGrain(event.currentTarget.valueAsNumber)} />
                </label>
                <div className={styles.formatRow}>
                  <span>File type</span>
                  <div className={styles.format} role="radiogroup" aria-label="File type">
                    {(["png", "svg"] as const).map(value => (
                      <button key={value} type="button" role="radio" aria-checked={format === value} onClick={() => chooseFormat(value)}>{value.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                {(["mesh", "linear", "radial"] as const).map(value => (
                  <button key={value} type="button" role="menuitem" onClick={() => void downloadGradient(value)}
                    onPointerEnter={() => setPeek(value)} onPointerLeave={() => setPeek(undefined)}
                    onFocus={() => setPeek(value)} onBlur={() => setPeek(undefined)}>
                    <ImageDown size={15} aria-hidden="true" />{KIND_LABEL[value]} gradient<Download size={13} aria-hidden="true" className={styles.trail} />
                  </button>
                ))}
                <span className={styles.menuRule} aria-hidden="true" />
                <button type="button" role="menuitem" onClick={() => {
                  setOpen(null);
                  const css = kind === "mesh" ? meshCss(meshColours) : kind === "linear" ? linearCss(linearColours) : radialCss(linearColours);
                  void copy(`background: ${css};`, "Copied the CSS");
                }}><Braces size={15} aria-hidden="true" />Copy CSS<small className={styles.trail}>{KIND_LABEL[kind]}</small></button>
                <button type="button" role="menuitem" onClick={() => { setOpen(null); void copy(colours.map(c => c.hex).join(", "), "Copied the hex codes"); }}>
                  <Hash size={15} aria-hidden="true" />Copy hex codes
                </button>
                <button type="button" role="menuitem" onClick={() => void saveCard()}><RectangleVertical size={15} aria-hidden="true" />Palette card</button>
              </div>
            </div>
            <span className={styles.rule} aria-hidden="true" />
            <div className={styles.popWrap} ref={meMenu}>
              <button type="button" className={`${styles.round} ${styles.me}`} aria-expanded={open === "me"} aria-haspopup="menu"
                aria-label="Who made this" title="Who made this" onClick={() => setOpen(open === "me" ? null : "me")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a small drawing */}
                <img src="/diwyani.png" alt="" />
              </button>
              <div className={`${styles.menu} ${styles.meMenu}`} role="menu" data-open={open === "me"} inert={open !== "me"}>
                <p className={styles.meName}>Made by Diwyani</p>
                <a role="menuitem" href="https://x.com/DiwyaniVajpayee" target="_blank" rel="noreferrer"><XIcon />Twitter</a>
                <a role="menuitem" href="https://in.linkedin.com/in/diwyani-vajpayee-9b2270213" target="_blank" rel="noreferrer"><LinkedInIcon />LinkedIn</a>
                {EMAIL && <a role="menuitem" href={`mailto:${EMAIL}`}><Mail size={12} aria-hidden="true" />Email</a>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <section className={styles.drop} aria-label="Choose an image" aria-busy={busy}>
          <div className={styles.dropBox}>
          <svg className={styles.sketch} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
            <filter id="pencil"><feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" result="t" /><feDisplacementMap in="SourceGraphic" in2="t" scale="2.5" /></filter>
            <g filter="url(#pencil)">
              <path strokeWidth="1.3" d="M-8 14C300 10 650 18 1008 11M988-6C992 200 985 420 991 608M1006 588C700 592 300 584-6 590M12 606C8 400 15 200 9-8" />
              <path className={styles.soft} strokeWidth="0.9" d="M6 9C350 15 700 7 996 16M993 8C989 250 995 450 987 596M990 584C650 589 320 581 10 587M7 590C12 380 6 180 14 10" />
            </g>
          </svg>
          <ImagePlus className={styles.dropIcon} size={22} aria-hidden="true" />
          <h1>Find the colours in a photo or film still</h1>
          <p>Drop an image anywhere</p>
          <button type="button" className={styles.browse} onClick={browse} disabled={busy}>{busy ? "Reading…" : "Choose an image"}</button>
          </div>
        </section>
      )}

      {fileOver && <div className={styles.dragOverlay}>Drop to find its colours</div>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <footer className={styles.footer}>
        <a className={styles.wordmark} href="https://github.com/Diwyani/tintker" target="_blank" rel="noreferrer" title="Tintker on GitHub">Tintker</a>
        <span aria-hidden="true">·</span>
        <details className={styles.credits}>
          <summary>Credits</summary>
          <div className={styles.footerPanel}>
            <p>iPhone photos (HEIC) are opened with <a href="https://github.com/hoppergee/heic-to" target="_blank" rel="noreferrer">heic-to</a> and <a href="https://github.com/strukturag/libheif" target="_blank" rel="noreferrer">libheif</a>, under the <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noreferrer">LGPL-3.0</a>.</p>
            <p>Lettering in <a href="https://fonts.google.com/specimen/Homemade+Apple" target="_blank" rel="noreferrer">Homemade Apple</a> (Apache 2.0).</p>
            <p className={styles.quiet}>Built with Next.js and React (MIT).</p>
            <p className={styles.quiet}>© 2026 Diwyani Vajpayee. All rights reserved.</p>
          </div>
        </details>
      </footer>
    </main>
  );
}
