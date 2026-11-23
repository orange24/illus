import paper from 'paper';
import type { Editor } from '../editor';
import type { TraceImage, TraceOptions, TraceResult } from './tracer';

export interface TraceSettings extends TraceOptions {
  /** Longest side (px) the image is resampled to before tracing. */
  resolution: number;
  /** Keep the original image (hidden) underneath the result. */
  keepOriginal: boolean;
}

export interface TracePreset {
  id: string;
  label: string;
  settings: Partial<TraceSettings>;
}

export const DEFAULT_SETTINGS: TraceSettings = {
  mode: 'color',
  threshold: 128,
  colors: 6,
  paths: 55,
  corners: 55,
  noise: 16,
  method: 'overlapping',
  ignoreWhite: false,
  resolution: 1000,
  keepOriginal: false,
};

export const PRESETS: TracePreset[] = [
  { id: 'bw-logo', label: 'โลโก้ขาวดำ', settings: { mode: 'bw', threshold: 128, paths: 55, corners: 65, noise: 20, ignoreWhite: true } },
  { id: 'sketch', label: 'ภาพสเก็ตช์ / ลายเส้น', settings: { mode: 'bw', threshold: 170, paths: 45, corners: 35, noise: 30, ignoreWhite: true } },
  { id: 'silhouette', label: 'ภาพเงา (Silhouette)', settings: { mode: 'bw', threshold: 225, paths: 35, corners: 45, noise: 60, ignoreWhite: true } },
  { id: 'color-3', label: '3 สี', settings: { mode: 'color', colors: 3, paths: 55, corners: 60, noise: 25, ignoreWhite: false } },
  { id: 'color-6', label: '6 สี', settings: { mode: 'color', colors: 6, paths: 55, corners: 55, noise: 16, ignoreWhite: false } },
  { id: 'color-16', label: '16 สี', settings: { mode: 'color', colors: 16, paths: 60, corners: 50, noise: 10, ignoreWhite: false } },
  { id: 'gray', label: 'โทนสีเทา', settings: { mode: 'gray', colors: 8, paths: 55, corners: 45, noise: 12, ignoreWhite: false } },
  { id: 'photo-low', label: 'ภาพถ่าย (ละเอียดต่ำ)', settings: { mode: 'color', colors: 12, paths: 40, corners: 30, noise: 40, ignoreWhite: false, resolution: 700 } },
  { id: 'photo-high', label: 'ภาพถ่าย (ละเอียดสูง)', settings: { mode: 'color', colors: 32, paths: 75, corners: 30, noise: 8, ignoreWhite: false, resolution: 1400 } },
];

export function presetSettings(id: string): TraceSettings {
  const p = PRESETS.find((x) => x.id === id);
  return { ...DEFAULT_SETTINGS, ...(p?.settings ?? {}) };
}

/** Rasters in the current selection, including ones nested in groups / clip groups. */
export function selectedRasters(ed: Editor): paper.Raster[] {
  const out = new Set<paper.Raster>();
  for (const it of ed.selection) {
    if (it instanceof paper.Raster) out.add(it);
    else if (it.children) for (const r of it.getItems({ class: paper.Raster }) as paper.Raster[]) out.add(r);
  }
  return [...out].filter((r) => r.width > 0 && r.height > 0);
}

export interface RasterPixels {
  image: TraceImage;
  /** Processing pixels per source pixel. */
  scale: number;
  /** Data URL of the processed image, for previews. */
  previewUrl: string;
}

/** Reads the raster's pixels, resampled for tracing (see below). */
export function rasterPixels(raster: paper.Raster, resolution: number): RasterPixels {
  const w = raster.width;
  const h = raster.height;
  // Downscale large images to the requested size. Small images are doubled (an integer factor keeps
  // the pixel grid regular), which gives the curve fitter smoother edges to work with.
  const big = Math.max(w, h);
  const scale = big > resolution ? resolution / big : big * 2 <= resolution ? 2 : 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const src = (raster.image ?? raster.canvas) as CanvasImageSource;
  ctx.drawImage(src, 0, 0, cw, ch);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, cw, ch);
  } catch {
    throw new Error('อ่านพิกเซลของภาพนี้ไม่ได้ (ภาพมาจากโดเมนอื่น)');
  }
  return { image: { width: cw, height: ch, data: data.data }, scale: cw / w, previewUrl: canvas.toDataURL('image/png') };
}

/** Runs traces in a Web Worker so the UI stays responsive. A new request cancels the running one. */
export class TraceRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; reject: (e: Error) => void } | null = null;

  run(image: TraceImage, opts: TraceOptions): Promise<TraceResult> {
    if (this.pending) {
      // Abandon the in-flight trace: restarting the worker is the only way to stop it.
      this.pending.reject(new Error('cancelled'));
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
    const worker = (this.worker ??= new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, reject };
      worker.onmessage = (e: MessageEvent<{ id: number; result?: TraceResult; error?: string }>) => {
        if (e.data.id !== id) return;
        this.pending = null;
        if (e.data.result) resolve(e.data.result);
        else reject(new Error(e.data.error || 'trace failed'));
      };
      worker.onerror = (e) => {
        this.pending = null;
        reject(new Error(e.message || 'trace failed'));
      };
      // Copy the pixels: the caller keeps its buffer for later runs.
      const data = new Uint8ClampedArray(image.data);
      worker.postMessage({ id, image: { width: image.width, height: image.height, data }, opts }, [data.buffer]);
    });
  }

  dispose() {
    this.pending?.reject(new Error('cancelled'));
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

export function toTraceOptions(s: TraceSettings): TraceOptions {
  const { mode, threshold, colors, paths, corners, noise, method, ignoreWhite } = s;
  return { mode, threshold, colors, paths, corners, noise, method, ignoreWhite };
}

/** SVG markup for previews (coordinates in processing pixels). */
export function resultToSvg(r: TraceResult, outline = false): string {
  const body = r.layers
    .map((l) =>
      l.paths
        .map((d) =>
          outline
            ? `<path d="${d}" fill="none" stroke="#1e90ff" stroke-width="1" vector-effect="non-scaling-stroke"/>`
            : `<path d="${d}" fill="${l.color}"/>`,
        )
        .join(''),
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

/**
 * Replaces `raster` with editable vector paths built from `result`, placed exactly over the image.
 * Returns the new group.
 */
export function applyTraceResult(raster: paper.Raster, result: TraceResult, scale: number, keepOriginal: boolean): paper.Group {
  const group = new paper.Group({ name: 'Image Trace', insert: false });
  for (const layer of result.layers) {
    for (const d of layer.paths) {
      const item = paper.PathItem.create(d);
      item.fillColor = new paper.Color(layer.color);
      item.strokeColor = null;
      group.addChild(item);
    }
  }
  // processing px → raster local coords (raster is centred on its origin) → raster's transform
  const m = raster.matrix
    .clone()
    .append(new paper.Matrix().translate(-raster.width / 2, -raster.height / 2))
    .append(new paper.Matrix().scale(1 / scale));
  group.transform(m);
  group.opacity = raster.opacity;
  group.blendMode = raster.blendMode;
  group.insertAbove(raster);
  if (keepOriginal) {
    raster.visible = false;
    raster.selected = false;
  } else raster.remove();
  return group;
}

/** Traces every selected image with `settings` and replaces it with vector paths. */
export async function traceSelection(ed: Editor, settings: TraceSettings, runner = new TraceRunner()): Promise<paper.Group[]> {
  const rasters = selectedRasters(ed);
  const groups: paper.Group[] = [];
  try {
    for (const raster of rasters) {
      const px = rasterPixels(raster, settings.resolution);
      const result = await runner.run(px.image, { ...toTraceOptions(settings), upscale: px.scale });
      groups.push(applyTraceResult(raster, result, px.scale, settings.keepOriginal));
    }
  } finally {
    runner.dispose();
  }
  if (groups.length) {
    ed.commit();
    ed.setSelection(groups);
  }
  return groups;
}
