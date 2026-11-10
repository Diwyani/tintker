"use client";

import { Copy, Download, ImagePlus, Shuffle, SlidersHorizontal, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { looksLikeHeic } from "@/lib/heic";
import { extractPalettes, gradientOrders } from "./palette";
import styles from "./tool.module.css";

type Mode = keyof ReturnType<typeof extractPalettes>;
type Point = { x: number; y: number };
type Photo = { pixels: ImageData; name: string; src: string; width: number; height: number; palettes: ReturnType<typeof extractPalettes> };
type Stop = { colour: string; position: number };

function nearGuide(x: number, y: number, start: Point, end: Point, swatchWidth: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - start.x - progress * dx, y - start.y - progress * dy) <= 22 + swatchWidth / 2 * (1 - progress) ** 3;
}

function localColours({ data, width, height }: ImageData, point: Point) {
  const x = Math.floor(point.x * width);
  const y = Math.floor(point.y * height);
  const left = Math.max(0, x - 16);
  const top = Math.max(0, y - 16);
  const columns = Math.min(width, x + 17) - left;
  const rows = Math.min(height, y + 17) - top;
  const crop = new Uint8ClampedArray(columns * rows * 4);
  for (let row = 0; row < rows; row++) {
    const offset = ((top + row) * width + left) * 4;
    crop.set(data.subarray(offset, offset + columns * 4), row * columns * 4);
  }
  return extractPalettes(crop, columns, rows).Accent;
}

function makeStops(colours: string[]): Stop[] {
  const stops = colours.length === 1 ? [...colours, ...colours] : colours;
  return stops.map((colour, index) => ({ colour, position: Math.round(index * 100 / (stops.length - 1)) }));
}

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
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("Image encoding failed.")), type, 0.94,
  ));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ColourTool() {
  const guideGradient = useId();
  const imageArea = useRef<HTMLDivElement>(null);
  const swatchRow = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const frame = useRef(0);
  const [pinned, setPinned] = useState<Point>();
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const dragDepth = useRef(0);
  const [photo, setPhoto] = useState<Photo>();
  const [mode, setMode] = useState<Mode>("Accent");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [hover, setHover] = useState<number>();
  const [focus, setFocus] = useState<number>();
  const [angle, setAngle] = useState(180);
  const [stops, setStops] = useState<Stop[]>([]);
  const [undo, setUndo] = useState<Stop[][]>([]);
  const swatches = photo?.palettes[mode] ?? [];
  const active = hover ?? focus;
  const sample = active === undefined ? undefined : swatches[active];
  const ordered = [...stops].sort((a, b) => a.position - b.position);
  const gradient = `linear-gradient(${angle}deg, ${ordered.map(stop => `${stop.colour} ${stop.position}%`).join(", ")})`;
  const src = photo?.src;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => { request.current++; cancelAnimationFrame(frame.current); }, []);

  const samplerOpen = Boolean(pinned);
  useEffect(() => {
    if (!samplerOpen) return;
    function dismiss(event: globalThis.PointerEvent) {
      if ((event.target as Element).closest("button") && ring.current?.contains(event.target as Node)) return;
      cancelAnimationFrame(frame.current);
      drag.current = null;
      setPinned(undefined);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [samplerOpen]);

  function resetGradient(colours: string[]) {
    setStops(makeStops(gradientOrders(colours)[0].colours));
    setAngle(180);
    setUndo([]);
    setHover(undefined);
    setFocus(undefined);
    setPinned(undefined);
  }

  async function load(file: File) {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (!looksLikeHeic(file) && !/\.(jpe?g|png)$/i.test(file.name) && !/^image\/(jpeg|png)$/i.test(file.type)) {
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
        setPhoto({ name: file.name, src: URL.createObjectURL(blob), width, height, pixels, palettes });
        resetGradient(palettes[mode].map(swatch => swatch.hex));
        setStatus("Palette ready.");
      } finally {
        bitmap.close();
      }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error && cause.message.startsWith("Choose")
        ? cause.message : cause instanceof Error && cause.message.startsWith("This image")
          ? cause.message : "Couldn’t read that image. Try another JPEG, PNG or HEIC.");
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  async function copy(value: string, message: string) {
    setStatus("");
    try {
      await navigator.clipboard.writeText(value);
      setStatus(message);
    } catch {
      setStatus("Clipboard unavailable.");
    }
  }

  function shuffle() {
    const colours = swatches.map(swatch => swatch.hex);
    if (colours.length < 2) return;
    const alternatives = gradientOrders(colours)
      .filter(path => path.colours.some((colour, index) => colour.toLowerCase() !== ordered[index]?.colour.toLowerCase()))
      .slice(0, 6);
    const next = alternatives[Math.floor(Math.random() * alternatives.length)];
    if (!next) return;

    setUndo(previous => [...previous.slice(-19), stops]);
    setStops(ordered.map((stop, index) => ({ ...stop, colour: next.colours[index] })));
  }

  function undoShuffle() {
    const previous = undo.at(-1);
    if (!previous) return;
    setStops(previous);
    setUndo(undo.slice(0, -1));
  }

  function exportSvg() {
    const radians = angle * Math.PI / 180;
    const x = Math.sin(radians);
    const y = -Math.cos(radians);
    const half = (Math.abs(x) + Math.abs(y)) / 2;
    const marks = ordered.map(stop => `<stop offset="${stop.position}%" stop-color="${stop.colour}"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1 1"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${0.5 - x * half}" y1="${0.5 - y * half}" x2="${0.5 + x * half}" y2="${0.5 + y * half}">${marks}</linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>`;
    download(new Blob([svg], { type: "image/svg+xml" }), "palette-gradient.svg");
  }

  const openEditor = () => editor.current?.showModal();
  const browse = () => input.current?.click();
  const [sourceX, setSourceX] = useState(0);
  const shadowColour = swatches.find(({ hex }) => hex !== swatches[0]?.hex)?.hex ?? swatches[0]?.hex;

  function positionGuide(swatch: HTMLElement) {
    const box = imageArea.current?.getBoundingClientRect();
    const bounds = swatch.getBoundingClientRect();
    if (box?.width) setSourceX((bounds.left + bounds.width / 2 - box.left) / box.width);
  }

  const nearby = pinned && photo ? localColours(photo.pixels, pinned) : [];

  function openSampler(point: Point, source?: HTMLElement) {
    opener.current = source ?? null;
    setPinned(point);
    setHover(undefined);
    requestAnimationFrame(() => ring.current?.querySelector("button")?.focus({ preventScroll: true }));
  }

  function moveGuide(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !sample || !imageArea.current || swatchRow.current?.contains(event.target as Node)) return;
    const box = imageArea.current.getBoundingClientRect();
    const swatch = active === undefined ? undefined : swatchRow.current?.children[active];
    const bounds = swatch?.getBoundingClientRect();
    if (!nearGuide(event.clientX, event.clientY,
      { x: bounds ? bounds.left + bounds.width / 2 : box.left + sourceX * box.width, y: bounds?.top ?? box.bottom },
      { x: box.left + sample.x * box.width, y: box.top + sample.y * box.height }, bounds?.width ?? 0)) {
      setHover(undefined);
      setFocus(undefined);
    }
  }

  return (
    <main
      className={styles.page}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDrop={event => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void load(file);
      }}
    >
      <span className={styles.wordmark}>Tintker</span>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void load(file);
        }} />
      {photo ? (
        <section className={styles.workspace} aria-label="Image palette" aria-busy={busy}
          onPointerMove={moveGuide} onPointerLeave={event => {
            if (event.pointerType === "mouse") { setHover(undefined); setFocus(undefined); }
          }}
          onKeyDown={event => {
            if (event.key !== "Escape" || !pinned) return;
            cancelAnimationFrame(frame.current);
            drag.current = null;
            setPinned(undefined);
            opener.current?.focus({ preventScroll: true });
          }}
          style={{ "--photo-width": `min(72rem, ${Math.max(18, 58 * photo.width / photo.height)}svh)` } as CSSProperties}>
          <div className={styles.filename}>{photo.name}</div>
          <div className={styles.photo} ref={imageArea} style={{ "--photo-shadow": shadowColour } as CSSProperties}>
            {/* Local Blob URL is displayed at its original aspect ratio. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.src} width={photo.width} height={photo.height} alt="Uploaded photo" />
            {sample && !pinned && <svg className={styles.guide} data-glide={hover !== undefined} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={guideGradient} gradientUnits="userSpaceOnUse" x1="0" y1="1000" x2="0" y2="0">
                  <stop stopColor="white" stopOpacity=".35" />
                  <stop offset=".65" stopColor="white" stopOpacity=".9" />
                </linearGradient>
              </defs>
              <path stroke={`url(#${guideGradient})`} style={{ d: `path("M ${sourceX * 1000} 1000 L ${sample.x * 1000} ${sample.y * 1000}")` }} vectorEffect="non-scaling-stroke" />
            </svg>}
            {sample && !pinned && <span className={styles.marker} data-glide={hover !== undefined}
              style={{ transform: `translate(${sample.x * 100}%, ${sample.y * 100}%)` }}>
              <button type="button" className={styles.dot} aria-label="Explore nearby colours"
                style={{ "--sample-colour": sample.hex } as CSSProperties} onClick={() => openSampler(sample, swatchRow.current?.querySelectorAll<HTMLButtonElement>(`.${styles.chip}`)[active!])} />
            </span>}
            {pinned && <div ref={ring} className={styles.ring} role="group" aria-label="Nearby colours">
              <button type="button" className={styles.handle} style={{ left: `${pinned.x * 100}%`, top: `${pinned.y * 100}%` }} aria-label="Move sample point with arrow keys or drag"
                onPointerDown={event => {
                  if (event.button !== 0 || drag.current) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  drag.current = { id: event.pointerId, dx: event.clientX - rect.left - rect.width / 2, dy: event.clientY - rect.top - rect.height / 2 };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const held = drag.current;
                  const bounds = imageArea.current?.getBoundingClientRect();
                  if (!held || held.id !== event.pointerId || !bounds) return;
                  const x = Math.max(0, Math.min(1, (event.clientX - held.dx - bounds.left) / bounds.width));
                  const y = Math.max(0, Math.min(1, (event.clientY - held.dy - bounds.top) / bounds.height));
                  cancelAnimationFrame(frame.current);
                  frame.current = requestAnimationFrame(() => setPinned({ x, y }));
                }}
                onLostPointerCapture={() => { drag.current = null; }}
                onKeyDown={event => {
                  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                  const direction = directions[event.key];
                  if (!direction) return;
                  event.preventDefault();
                  setPinned({
                    x: Math.max(0, Math.min(1, pinned.x + direction[0] * 0.02)),
                    y: Math.max(0, Math.min(1, pinned.y + direction[1] * 0.02)),
                  });
                }} />
              <div className={styles.ringColours} style={{
                left: `clamp(min(78px, 50%), ${pinned.x * 100}%, max(50%, 100% - 78px))`,
                top: `clamp(min(78px, 50%), ${pinned.y * 100}%, max(50%, 100% - 78px))`,
              }}>
                {nearby.map(({ hex }, index) => {
                  const angle = index * 2 * Math.PI / nearby.length - Math.PI / 2;
                  return <button key={index} type="button" className={styles.ringColour} title={hex} aria-label={`Copy nearby colour ${hex}`}
                    style={{ background: hex, transform: `translate(calc(-50% + ${Math.cos(angle) * 54}px), calc(-50% + ${Math.sin(angle) * 54}px))` }}
                    onClick={() => void copy(hex, `Copied ${hex}`)} />;
                })}
              </div>
            </div>}

          </div>
          <button className={styles.rail} style={{ background: gradient }} aria-label="Edit gradient" title="Edit gradient" onClick={openEditor} />
          <div className={styles.swatches} ref={swatchRow}>
            {swatches.map(({ hex }, index) => <div className={styles.sample} key={hex}
              onPointerEnter={event => { if (event.pointerType === "mouse" && !drag.current) { positionGuide(event.currentTarget); setPinned(undefined); setFocus(undefined); setHover(index); } }}
              onFocus={event => { if (event.target.matches(":focus-visible")) { positionGuide(event.currentTarget); setFocus(index); } }} onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocus(undefined);
              }}>
              <button className={styles.chip} aria-label={`Copy ${hex}`}
                aria-keyshortcuts="ArrowUp"
                onKeyDown={event => {
                  if (event.key !== "ArrowUp") return;
                  event.preventDefault();
                  openSampler(swatches[index], event.currentTarget);
                }}
                onClick={event => {
                  if ((event.nativeEvent as globalThis.PointerEvent).pointerType === "touch") openSampler(swatches[index], event.currentTarget);
                  else void copy(hex, `Copied ${hex}`);
                }}>
                <span className={styles.chipFace} style={{ background: hex }}><Copy size={17} /></span>
              </button>
              <button className={styles.hex} onClick={() => void copy(hex, `Copied ${hex}`)}>{hex}</button>
            </div>)}
          </div>
          <button className={styles.shuffle} onClick={shuffle} disabled={swatches.length < 2} aria-label="Shuffle gradient" title="Shuffle gradient"><Shuffle size={16} /></button>
          <div className={styles.actions}>
            <div className={styles.modes} aria-label="Palette extraction mode">
              {(["Scene", "Accent"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy}
                onClick={() => {
                  if (mode === value) return;
                  setMode(value);
                  resetGradient(photo.palettes[value].map(swatch => swatch.hex));
                }}>{value}</button>)}
            </div>
            <div className={styles.pill}>
              <button onClick={browse} aria-label="Replace photo" title="Replace photo"><ImagePlus size={17} /></button>
              <button onClick={() => void copy(swatches.map(swatch => swatch.hex).join(", "), "Copied all hex codes.")}
                aria-label="Copy all hex codes" title="Copy all hex codes"><Copy size={17} /></button>
              <button onClick={openEditor} aria-label="Edit gradient" title="Edit gradient"><SlidersHorizontal size={17} /></button>
              <button onClick={exportSvg} aria-label="Download gradient SVG" title="Download gradient SVG"><Download size={17} /></button>
              {undo.length > 0 && <button onClick={undoShuffle} aria-label="Undo shuffle" title="Undo shuffle"><Undo2 size={17} /></button>}
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.drop} aria-label="Upload a photo" aria-busy={busy}>
          <ImagePlus size={22} aria-hidden="true" />
          <h1>Drop a photo or film still</h1>
          <button className={styles.browse} onClick={browse}>Browse files</button>
          <small>JPEG · PNG · HEIC</small>
        </section>
      )}
      {dragging && <div className={styles.dragOverlay}>Drop a photo or film still</div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className="sr-only" role="status">{busy ? "Reading image…" : status}</p>
      <footer className={styles.footer}>
        <details className={styles.social}>
          <summary>Made by Diwyani</summary>
          <div className={styles.footerPanel}>
            <a href="https://in.linkedin.com/in/diwyani-vajpayee-9b2270213" target="_blank" rel="noreferrer">LinkedIn</a>
            <a href="https://x.com/DiwyaniVajpayee" target="_blank" rel="noreferrer">Twitter</a>
          </div>
        </details>
        <span aria-hidden="true">·</span>
        <details>
          <summary>Credits</summary>
          <div className={styles.footerPanel}>HEIC decoding by <a href="https://github.com/hoppergee/heic-to">heic-to</a> and <a href="https://github.com/strukturag/libheif">libheif</a>.</div>
        </details>
      </footer>
      <dialog ref={editor} className={styles.editor} aria-labelledby="gradient-title">
        <div className={styles.editorHead}><h2 id="gradient-title">Gradient</h2><form method="dialog"><button>Done</button></form></div>
        <div className={styles.preview} style={{ background: gradient }} />
        <label className={styles.angle}>Angle <output>{angle}°</output><input type="range" min="0" max="360" value={angle} onChange={event => setAngle(event.currentTarget.valueAsNumber)} /></label>
        <div className={styles.stops}>
          {stops.map((stop, index) => <div className={styles.stop} key={index}>
            <input type="color" value={stop.colour} aria-label={`Stop ${index + 1} colour`}
              onChange={event => {
                const colour = event.currentTarget.value;
                setStops(previous => previous.map((item, i) => i === index ? { ...item, colour } : item));
              }} />
            <input type="range" min="0" max="100" value={stop.position} aria-label={`Stop ${index + 1} position`}
              onChange={event => {
                const position = event.currentTarget.valueAsNumber;
                setStops(previous => previous.map((item, i) => i === index ? { ...item, position } : item));
              }} />
            <output>{stop.position}%</output>
          </div>)}
        </div>
        <div className={styles.exports}>
          <button onClick={() => void copy(`background: ${gradient};`, "Copied gradient CSS.")}>Copy CSS</button>
          <button onClick={exportSvg}>Download SVG</button>
          <button disabled={!undo.length} onClick={undoShuffle}>Undo shuffle</button>
        </div>
        <p role="status">{status}</p>
      </dialog>
    </main>
  );
}
