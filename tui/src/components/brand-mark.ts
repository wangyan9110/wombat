import { ImageRenderable, NativeImage, RGBA, TextRenderable, type RenderContext } from '@opentui/core';
import { visualAssets, visualMonochromeAssets } from './visual-styles.generated.js';

// Compact brand mask, shared with the 10-column startup artwork.
// Keep ears, eye cutouts and muzzle; do not substitute unrelated glyphs.
const mask = visualAssets.brand;

export function brandMark(ctx: RenderContext, color?: string): ImageRenderable | TextRenderable {
  if (!color) return new TextRenderable(ctx, { id: 'header-mark', content: visualMonochromeAssets.brand, width: 5, height: 2, flexShrink: 0, fg: RGBA.defaultForeground(), bg: RGBA.defaultBackground() });
  const pixels = new Uint8Array(10 * 8 * 4), rgba = RGBA.fromHex(color).toInts();
  mask.forEach((line, y) => Array.from(line).forEach((pixel, x) => {
    if (pixel === '#') pixels.set(rgba, (y * 10 + x) * 4);
  }));
  const source = NativeImage.fromPixels(pixels, 10, 8);
  try {
    // OpenTUI owns protocol selection and block fallback. Two rows keep the
    // compact mark's aspect ratio and retain more detail than a one-cell icon.
    return new ImageRenderable(ctx, { id: 'header-mark', source, width: 5, height: 2, flexShrink: 0, fit: 'fit', protocol: 'auto' });
  } finally { source.dispose(); }
}
