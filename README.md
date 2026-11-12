# Tintker

Turn a photo or film still into a colour palette.

Drop in an image, and Tintker finds its colours. Move the sample point to pick your own, copy the hex codes, or export the palette as a gradient. It runs entirely in your browser; nothing is uploaded.

<!-- Add a screenshot: a still with its palette, e.g. docs/screenshot.png -->

**Try it:** [add the Vercel link here]

## What it does

- **Opens JPEG, PNG, WebP and iPhone photos (HEIC).** Choose a file, or drop one anywhere on the page.
- **Two ways to read a picture.** **Scene** gives the colours that fill the frame; **Accent** the ones that stand out, even small ones. Each colour shows how much of the image it covers.
- **Pick by hand.** Every colour is a pin on the photo. Drag a pin, or use the arrow keys, and it takes the colour under it.
- **Two gradients.** **Mesh**: each colour glows from where it is in the photo (best for a single frame). **Linear**: bands sized by how much each colour covers (best for collages), with Shuffle. Both blend in OKLab, so colours stay bright, and have adjustable film grain.
- **Export** the gradient as PNG (linear also as SVG or CSS), a palette card (the image, its colours and their hex codes) for sharing, or copy the hex codes.
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
