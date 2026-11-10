# Tintker

Turn a photo or film still into a colour palette.

Drop in an image, and Tintker finds its colours. Move the sample point to pick your own, copy the hex codes, or export the palette as a gradient. It runs entirely in your browser; nothing is uploaded.

<!-- Add a screenshot: a still with its palette, e.g. docs/screenshot.png -->

**Try it:** [add the Vercel link here]

## What it does

- **Opens JPEG, PNG and iPhone photos (HEIC).** Choose a file, or drag one onto the page.
- **Two ways to read a picture.** **Scene** gives the colours that fill the frame. **Accent** gives the ones that stand out.
- **Pick by hand.** Drag the sample point around the image, and the swatch follows the colour under it. Arrow keys work too.
- **Shuffle** for a different set of colours from the same image.
- **Copy** the hex codes, **export** a gradient, and **undo** any change.
- **Private.** The image never leaves your device.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Built with

Next.js and React. iPhone photos are opened with [heic-to](https://github.com/hoppergee/heic-to) and [libheif](https://github.com/strukturag/libheif) (LGPL-3.0). Icons are from [Lucide](https://lucide.dev).

## Made by

[Diwyani Vajpayee](https://x.com/DiwyaniVajpayee), who also made [Flipbook](https://flipbook.diwyanivajpayee.in), a drawing, animation and collage studio in the browser.

© 2026 Diwyani Vajpayee. All rights reserved.
