/**
 * Image asset import + normalization (spec §10/§12).
 *
 * Browsers happily decode PNG/JPEG/WebP/GIF/SVG — but the three exporters
 * only embed PNG/JPEG reliably. Every imported image is therefore normalized
 * ONCE at import time:
 *   - decoded via an <img> element,
 *   - re-encoded to PNG (or JPEG for opaque photos, to save memory),
 *   - downscaled if larger than MAX_DIMENSION px,
 *   - measured (width/height) and stored as a self-contained data URL.
 *
 * The normalized asset travels inside the document model, so exports embed
 * real pixels — never a temporary blob URL that dies before the exporter runs.
 */

import type { ImageAsset } from '@/types';

/** Longest allowed side after normalization — keeps documents/exporters sane. */
export const MAX_IMAGE_DIMENSION = 1600;

/**
 * Image classification for the UPLOAD area (§16): files matching by MIME
 * prefix or extension are routed to the image library — never rejected as
 * "binary" source files.
 */
const IMAGE_FILE_EXTENSIONS = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;

export function isImageFile(file: { name: string; type?: string }): boolean {
  return Boolean(file.type?.startsWith('image/')) || IMAGE_FILE_EXTENSIONS.test(file.name);
}

/** Accepted input MIME types (decoded by the browser, then re-encoded). */
export const ACCEPTED_IMAGE_TYPES =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/bmp';

function genImageId(): string {
  return `img-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Normalize one image file into a storable asset.
 * JPEG is kept for opaque, photographic input (smaller); everything else
 * becomes PNG (lossless, alpha preserved).
 */
export async function normalizeImageFile(file: File): Promise<ImageAsset> {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error(`"${file.name}" is too large (over 15 MB).`);
  }
  const rawUrl = await readAsDataUrl(file);
  const img = await loadImageElement(rawUrl);

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error(`"${file.name}" has no usable dimensions.`);
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const opaqueInput =
    file.type === 'image/jpeg' ||
    /\.jpe?g$/i.test(file.name);
  let mime: 'image/png' | 'image/jpeg' = opaqueInput ? 'image/jpeg' : 'image/png';

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.drawImage(img, 0, 0, outW, outH);
  let dataUrl = canvas.toDataURL(mime, 0.92);

  // Safety net: if a JPEG re-encode somehow grew larger than the PNG would
  // be, prefer PNG (rare, but avoids pathological tiny photos).
  if (mime === 'image/jpeg') {
    const pngUrl = canvas.toDataURL('image/png');
    if (pngUrl.length < dataUrl.length) {
      mime = 'image/png';
      dataUrl = pngUrl;
    }
  }

  const base64 = dataUrl.split(',')[1] ?? '';
  return {
    id: genImageId(),
    name: file.name,
    dataUrl,
    mime,
    width: outW,
    height: outH,
    sizeBytes: Math.round((base64.length * 3) / 4),
    addedAt: Date.now(),
  };
}

/** Normalize several files; failures are reported per file. */
export async function normalizeImageFiles(
  files: File[],
): Promise<{ assets: ImageAsset[]; errors: string[] }> {
  const assets: ImageAsset[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      assets.push(await normalizeImageFile(f));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Could not import "${f.name}".`);
    }
  }
  return { assets, errors };
}

/** Parse a data URL into its binary bytes (for exporters). */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Aspect-fit an image into a box; returns draw dimensions in the same unit. */
export function fitImageBox(
  width: number,
  height: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: maxW, h: maxW };
  const scale = Math.min(maxW / width, maxH / height, 1);
  return { w: width * scale, h: height * scale };
}

/* ------------------------------------------------------------------ */
/* Exporter image geometry (spec §8/§12)                               */
/* ------------------------------------------------------------------ */

/**
 * Maximum share of the CONTENT area an embedded image may occupy:
 * 62% of the content width, 55% of the content height. Every exporter
 * computes its own content area (px / pt / cm) and applies these ratios.
 */
export const IMAGE_MAX_WIDTH_RATIO = 0.62;
export const IMAGE_MAX_HEIGHT_RATIO = 0.55;

/** px at 96 dpi ↔ cm (used to convert natural image px into print units). */
export const PX_TO_CM = 2.54 / 96;
