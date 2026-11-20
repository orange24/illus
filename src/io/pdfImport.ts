import paper from 'paper';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { NATIVE_NS, unpackNative } from './export';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const { OPS, Util } = pdfjs;

type Matrix = number[];

interface ClipNode {
  path: paper.PathItem;
  parent: ClipNode | null;
  groups: Map<paper.Item, paper.Group>;
}

interface GState {
  ctm: Matrix;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dash: number[];
  fillAlpha: number;
  strokeAlpha: number;
  clip: ClipNode | null;
}

export interface PdfImportResult {
  /** Present when the file was written by this app: the original editable document. */
  native?: string;
  width: number;
  height: number;
  layers: paper.Layer[];
  pageCount: number;
  warnings: string[];
}

const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];

/** Load the editable document embedded by this app's PDF/AI export, if present. */
async function readNative(pdf: pdfjs.PDFDocumentProxy): Promise<string | undefined> {
  try {
    const meta = await pdf.getMetadata();
    const raw = (meta.metadata as unknown as { getRaw(): string } | null)?.getRaw?.();
    if (!raw || !raw.includes(NATIVE_NS)) return undefined;
    const m = raw.match(/<jspdf:metadata>([\s\S]*?)<\/jspdf:metadata>/);
    if (!m) return undefined;
    return await unpackNative(m[1].trim());
  } catch (err) {
    console.warn('native data not readable', err);
    return undefined;
  }
}

/**
 * Convert a PDF (or PDF-compatible .ai) page into editable Paper.js items by walking
 * pdf.js' operator list: paths, fills, strokes, clipping, transparency, layers (OCGs),
 * images and text.
 */
export async function importPDF(data: ArrayBuffer, name: string, pageNumber = 1): Promise<PdfImportResult> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const warnings: string[] = [];
  const native = await readNative(pdf);
  const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
  const vp = page.getViewport({ scale: 1 });
  const width = vp.width;
  const height = vp.height;
  if (native) {
    return { native, width, height, layers: [], pageCount: pdf.numPages, warnings };
  }

  const ocConfig = await pdf.getOptionalContentConfig().catch(() => null);
  const opList = await page.getOperatorList();
  const base = vp.transform as Matrix;

  const defaultLayer = new paper.Layer({ name: name.replace(/\.[^.]+$/, '') || 'Imported', insert: false });
  const layers: paper.Layer[] = [defaultLayer];
  const layerByName = new Map<string, paper.Layer>();
  const markedStack: (paper.Layer | null)[] = [];
  let currentLayer = defaultLayer;

  const pageRect = new paper.Rectangle(0, 0, width, height);
  let state: GState = {
    ctm: [1, 0, 0, 1, 0, 0],
    fill: '#000000',
    stroke: '#000000',
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dash: [],
    fillAlpha: 1,
    strokeAlpha: 1,
    clip: null,
  };
  const stack: GState[] = [];
  let pendingClip: 'nonzero' | 'evenodd' | null = null;
  let imageCount = 0;
  let shadingCount = 0;
  const textColors: string[] = [];

  const deviceMatrix = () => Util.transform(base, state.ctm) as Matrix;
  const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  const targetFor = (clip: ClipNode | null): paper.Item => {
    if (!clip) return currentLayer;
    let g = clip.groups.get(currentLayer);
    if (g && g.parent) return g;
    const parent = targetFor(clip.parent);
    g = new paper.Group({ insert: false });
    parent.addChild(g);
    const mask = clip.path.clone({ insert: false }) as paper.PathItem;
    mask.clipMask = true;
    g.addChild(mask);
    g.clipped = true;
    clip.groups.set(currentLayer, g);
    return g;
  };

  const emit = (item: paper.Item) => targetFor(state.clip).addChild(item);

  const color = (hex: string | null, alpha: number) => {
    if (!hex) return null;
    const c = new paper.Color(hex);
    if (alpha < 1) c.alpha = alpha;
    return c;
  };

  const buildPath = (d: ArrayLike<number>, m: Matrix): paper.PathItem | null => {
    const tp = (x: number, y: number) => new paper.Point(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    const paths: paper.Path[] = [];
    let cur: paper.Path | null = null;
    let start: paper.Point | null = null;
    const ensure = () => {
      if (!cur) {
        cur = new paper.Path({ insert: false });
        paths.push(cur);
        if (start) cur.add(start);
      }
      return cur;
    };
    for (let i = 0; i < d.length; ) {
      const op = d[i++];
      if (op === 0) {
        start = tp(d[i++], d[i++]);
        cur = new paper.Path({ insert: false });
        paths.push(cur);
        cur.add(start);
      } else if (op === 1) {
        ensure().add(tp(d[i++], d[i++]));
      } else if (op === 2) {
        const p = ensure();
        const c1 = tp(d[i++], d[i++]);
        const c2 = tp(d[i++], d[i++]);
        const p3 = tp(d[i++], d[i++]);
        const last = p.lastSegment;
        if (last) last.handleOut = c1.subtract(last.point);
        p.add(new paper.Segment(p3, c2.subtract(p3)));
      } else if (op === 3) {
        const p = ensure();
        const q = tp(d[i++], d[i++]);
        const p3 = tp(d[i++], d[i++]);
        const last = p.lastSegment;
        const p0 = last ? last.point : q;
        if (last) last.handleOut = q.subtract(p0).multiply(2 / 3);
        p.add(new paper.Segment(p3, q.subtract(p3).multiply(2 / 3)));
      } else if (op === 4) {
        const p: paper.Path | null = cur;
        if (p && p.segments.length > 1) {
          const f = p.firstSegment;
          const l = p.lastSegment;
          if (f.point.getDistance(l.point) < 1e-3) {
            f.handleIn = l.handleIn;
            l.remove();
          }
          p.closed = true;
        }
        cur = null;
      } else {
        break;
      }
    }
    const valid = paths.filter((p) => p.segments.length > 1);
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0];
    return new paper.CompoundPath({ children: valid, insert: false });
  };

  const isPageClip = (p: paper.PathItem) => {
    const b = p.bounds;
    return (
      p instanceof paper.Path &&
      p.segments.length <= 5 &&
      b.left <= pageRect.left + 1 &&
      b.top <= pageRect.top + 1 &&
      b.right >= pageRect.right - 1 &&
      b.bottom >= pageRect.bottom - 1
    );
  };

  const paint = (paintOp: number, d: ArrayLike<number> | null) => {
    const clipRule = pendingClip;
    pendingClip = null;
    if (!d) return;
    const m = deviceMatrix();
    let fill = false;
    let stroke = false;
    let evenodd = false;
    let close = false;
    switch (paintOp) {
      case OPS.fill:
        fill = true;
        break;
      case OPS.eoFill:
        fill = true;
        evenodd = true;
        break;
      case OPS.stroke:
        stroke = true;
        break;
      case OPS.closeStroke:
        stroke = true;
        close = true;
        break;
      case OPS.fillStroke:
        fill = stroke = true;
        break;
      case OPS.eoFillStroke:
        fill = stroke = evenodd = true;
        break;
      case OPS.closeFillStroke:
        fill = stroke = close = true;
        break;
      case OPS.closeEOFillStroke:
        fill = stroke = close = evenodd = true;
        break;
      default:
        break; // endPath: no painting
    }
    if (fill || stroke) {
      const path = buildPath(d, m);
      if (path) {
        if (close) {
          if (path instanceof paper.Path) path.closed = true;
          else path.children.forEach((c) => ((c as paper.Path).closed = true));
        }
        path.fillColor = fill ? color(state.fill, state.fillAlpha) : null;
        if (fill) path.fillRule = evenodd ? 'evenodd' : 'nonzero';
        if (stroke && state.stroke) {
          const s = scaleOf(m);
          path.strokeColor = color(state.stroke, state.strokeAlpha);
          path.strokeWidth = Math.max(state.lineWidth, 0) * s || s * 0.25;
          path.strokeCap = CAPS[state.lineCap] ?? 'butt';
          path.strokeJoin = JOINS[state.lineJoin] ?? 'miter';
          path.miterLimit = state.miterLimit;
          if (state.dash.length) path.dashArray = state.dash.map((v) => v * s);
        }
        emit(path);
      }
    }
    if (clipRule) {
      const clipPath = buildPath(d, m);
      if (clipPath && !isPageClip(clipPath)) {
        if (clipPath instanceof paper.Path) clipPath.closed = true;
        clipPath.fillRule = clipRule;
        state.clip = { path: clipPath, parent: state.clip, groups: new Map() };
      }
    }
  };

  const paintImage = (objId: string, inline?: { width: number; height: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap }) => {
    try {
      const obj =
        inline ??
        ((objId.startsWith('g_') ? page.commonObjs : page.objs).has(objId)
          ? (objId.startsWith('g_') ? page.commonObjs : page.objs).get(objId)
          : null);
      if (!obj) return;
      const { width: w, height: h } = obj as { width: number; height: number };
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const o = obj as { bitmap?: ImageBitmap; data?: Uint8ClampedArray; kind?: number };
      if (o.bitmap) ctx.drawImage(o.bitmap, 0, 0);
      else if (o.data) {
        const img = ctx.createImageData(w, h);
        const src = o.data;
        if (src.length === w * h * 4) img.data.set(src);
        else if (src.length === w * h * 3) {
          for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
            img.data[j] = src[i];
            img.data[j + 1] = src[i + 1];
            img.data[j + 2] = src[i + 2];
            img.data[j + 3] = 255;
          }
        } else return;
        ctx.putImageData(img, 0, 0);
      } else return;
      const raster = new paper.Raster({ source: canvas.toDataURL('image/png'), insert: false });
      const m = deviceMatrix();
      const a = [1 / w, 0, 0, -1 / h, 0.5, 0.5];
      const f = Util.transform(m, a) as Matrix;
      raster.matrix = new paper.Matrix(f[0], f[1], f[2], f[3], f[4], f[5]);
      raster.opacity = state.fillAlpha;
      emit(raster);
      imageCount++;
    } catch (err) {
      console.warn('image import failed', err);
    }
  };

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as any[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...state, dash: [...state.dash] });
        break;
      case OPS.restore:
        if (stack.length) state = stack.pop()!;
        break;
      case OPS.transform:
        state.ctm = Util.transform(state.ctm, args) as Matrix;
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...state, dash: [...state.dash] });
        if (args?.[0]) state.ctm = Util.transform(state.ctm, args[0]) as Matrix;
        break;
      case OPS.paintFormXObjectEnd:
        if (stack.length) state = stack.pop()!;
        break;
      case OPS.setLineWidth:
        state.lineWidth = args[0];
        break;
      case OPS.setLineCap:
        state.lineCap = args[0];
        break;
      case OPS.setLineJoin:
        state.lineJoin = args[0];
        break;
      case OPS.setMiterLimit:
        state.miterLimit = args[0];
        break;
      case OPS.setDash:
        state.dash = Array.from(args[0] ?? []);
        break;
      case OPS.setFillRGBColor:
        state.fill = toHex(args);
        break;
      case OPS.setStrokeRGBColor:
        state.stroke = toHex(args);
        break;
      case OPS.setFillTransparent:
        state.fill = null;
        break;
      case OPS.setStrokeTransparent:
        state.stroke = null;
        break;
      case OPS.setGState:
        for (const [key, value] of args[0] ?? []) {
          if (key === 'LW') state.lineWidth = value;
          else if (key === 'LC') state.lineCap = value;
          else if (key === 'LJ') state.lineJoin = value;
          else if (key === 'ML') state.miterLimit = value;
          else if (key === 'D') state.dash = Array.from(value?.[0] ?? []);
          else if (key === 'CA') state.strokeAlpha = value;
          else if (key === 'ca') state.fillAlpha = value;
        }
        break;
      case OPS.clip:
        pendingClip = 'nonzero';
        break;
      case OPS.eoClip:
        pendingClip = 'evenodd';
        break;
      case OPS.constructPath: {
        const [paintOp, payload] = args;
        const d = Array.isArray(payload) ? payload[0] : payload;
        paint(paintOp, d ?? null);
        break;
      }
      case OPS.endPath:
        pendingClip = null;
        break;
      case OPS.beginMarkedContentProps: {
        let layer: paper.Layer | null = null;
        if (args[0] === 'OC' && args[1]?.type === 'OCG' && ocConfig) {
          const group = ocConfig.getGroup(args[1].id);
          const lname = group?.name || 'Layer';
          layer = layerByName.get(lname) ?? null;
          if (!layer) {
            layer = new paper.Layer({ name: lname, insert: false });
            layerByName.set(lname, layer);
            layers.push(layer);
          }
        }
        markedStack.push(layer ? currentLayer : null);
        if (layer) currentLayer = layer;
        break;
      }
      case OPS.beginMarkedContent:
        markedStack.push(null);
        break;
      case OPS.endMarkedContent: {
        const prev = markedStack.pop();
        if (prev) currentLayer = prev;
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintImageXObjectRepeat:
        paintImage(args[0]);
        break;
      case OPS.paintInlineImageXObject:
        paintImage('', args[0]);
        break;
      case OPS.shadingFill:
        shadingCount++;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        textColors.push(state.fill ?? '#000000');
        break;
      default:
        break;
    }
  }

  // Text: pdf.js text content gives positioned runs we turn into editable point text.
  try {
    const tc = await page.getTextContent();
    const textLayer = new paper.Layer({ name: 'Text', insert: false });
    const runs = (tc.items as any[]).filter((it) => typeof it.str === 'string' && it.str.length > 0);
    // pdf.js emits one text item per show-text operator in simple files; use that to recover colors.
    const colorsMatch = runs.length === textColors.length;
    for (const item of tc.items as any[]) {
      const runIndex = runs.indexOf(item);
      if (!item.str || !item.str.trim()) continue;
      const tx = Util.transform(base, item.transform) as Matrix;
      const fontSize = Math.hypot(tx[2], tx[3]);
      if (fontSize < 0.5) continue;
      const style = tc.styles[item.fontName];
      const family = style?.fontFamily && style.fontFamily !== 'sans-serif' ? `${style.fontFamily}, sans-serif` : 'sans-serif';
      const t = new paper.PointText({
        point: [0, 0],
        content: item.str,
        fontSize,
        fontFamily: family,
        fillColor: colorsMatch ? textColors[runIndex] : 'black',
        insert: false,
      });
      const angle = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;
      t.translate(new paper.Point(tx[4], tx[5]));
      if (Math.abs(angle) > 0.1) t.rotate(angle, new paper.Point(tx[4], tx[5]));
      textLayer.addChild(t);
    }
    if (textLayer.children.length) layers.push(textLayer);
  } catch (err) {
    console.warn('text import failed', err);
  }

  if (imageCount) warnings.push(`นำเข้าภาพ raster ${imageCount} ภาพ`);
  if (shadingCount) warnings.push(`Gradient/Shading ${shadingCount} จุดยังไม่รองรับ`);
  const nonEmpty = layers.filter((l) => l.children.length > 0);
  return { width, height, layers: nonEmpty, pageCount: pdf.numPages, warnings };
}

function toHex(args: any[]): string {
  const v = args[0];
  if (typeof v === 'string') return v;
  if (args.length >= 3 && typeof args[0] === 'number') {
    const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(args[0])}${h(args[1])}${h(args[2])}`;
  }
  return '#000000';
}
