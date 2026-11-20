import type { Editor } from '../editor';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const NATIVE_NS = 'https://illus.app/ns/document/1.0/';

/** Build a standalone SVG of the artboard containing every visible user layer. */
export function buildSVG(ed: Editor): SVGSVGElement {
  const { width, height } = ed.artboard;
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('version', '1.1');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const layer of ed.userLayers()) {
    if (!layer.visible) continue;
    const g = layer.exportSVG({ asString: false, precision: 3, matchShapes: false }) as SVGElement;
    cleanAttrs(g);
    g.setAttribute('id', sanitizeId(layer.name || 'Layer'));
    g.setAttribute('data-name', layer.name || 'Layer');
    svg.appendChild(g);
  }
  return svg;
}

/** Paper writes placeholder values such as font-family="none" on layers; strip them. */
function cleanAttrs(root: Element) {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const a of Array.from(el.attributes)) {
      if (a.value === 'none' && !['fill', 'stroke', 'stroke-dasharray', 'display'].includes(a.name)) el.removeAttribute(a.name);
    }
    if (el.getAttribute('stroke-dasharray') === '') el.removeAttribute('stroke-dasharray');
    if ((el.getAttribute('style') ?? '').trim() === 'mix-blend-mode: normal') el.removeAttribute('style');
  }
}

function sanitizeId(name: string) {
  const id = name.replace(/[^A-Za-z0-9_-]+/g, '_');
  return /^[A-Za-z_]/.test(id) ? id : `_${id}`;
}

export function svgString(ed: Editor) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(buildSVG(ed));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function baseName(ed: Editor) {
  return (ed.fileName || 'Untitled').replace(/\.(ai|svg|pdf|png|json|eps)$/i, '');
}

export async function exportSVG(ed: Editor) {
  download(new Blob([svgString(ed)], { type: 'image/svg+xml' }), `${baseName(ed)}.svg`);
}

export async function renderPNG(ed: Editor, scale = 2, transparent = true): Promise<Blob> {
  const { width, height } = ed.artboard;
  const svgText = svgString(ed);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('ไม่สามารถเรนเดอร์ภาพได้'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPNG(ed: Editor, scale = 2, transparent = true) {
  download(await renderPNG(ed, scale, transparent), `${baseName(ed)}.png`);
}

// ---------- PDF / AI ----------

const FONT_BASE = `${import.meta.env.BASE_URL}fonts/`;
const fontCache = new Map<string, string | null>();

function needsUnicodeFont(svg: SVGElement) {
  return Array.from(svg.querySelectorAll('text')).some((t) => /[^\u0000-\u00ff]/.test(t.textContent ?? ''));
}

/** Load a bundled TTF (Sarabun covers Thai + Latin) as base64 for jsPDF. */
async function loadFont(file: string): Promise<string | null> {
  if (fontCache.has(file)) return fontCache.get(file)!;
  try {
    const res = await fetch(FONT_BASE + file);
    const data = res.ok ? bytesToBase64(new Uint8Array(await res.arrayBuffer())) : null;
    fontCache.set(file, data);
    return data;
  } catch {
    return null;
  }
}

export function bytesToBase64(bytes: Uint8Array) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function streamBytes(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function packNative(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64(await streamBytes(bytes, new CompressionStream('gzip')));
}

export async function unpackNative(b64: string): Promise<string> {
  const bytes = await streamBytes(base64ToBytes(b64.replace(/\s+/g, '')), new DecompressionStream('gzip'));
  return new TextDecoder().decode(bytes);
}

/**
 * Render the artboard into a PDF. With `embedNative`, the editable document is also stored
 * (gzip + base64) in the XMP metadata so this app can reopen the file losslessly.
 */
export async function buildPDF(ed: Editor, opts: { embedNative?: boolean; title?: string } = {}): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const { width, height } = ed.artboard;
  const doc = new jsPDF({
    unit: 'pt',
    format: [width, height],
    orientation: width > height ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({ title: opts.title ?? baseName(ed), creator: 'Illus Vector Editor' });
  const svg = buildSVG(ed);
  // jsPDF only knows its standard fonts unless one is embedded; map families sensibly.
  svg.querySelectorAll('text, tspan').forEach((t) => {
    const fam = (t.getAttribute('font-family') ?? '').toLowerCase();
    const std = /courier|mono/.test(fam) ? 'courier' : /times|georgia|serif/.test(fam) && !/sans/.test(fam) ? 'times' : 'helvetica';
    if (t.hasAttribute('font-family')) t.setAttribute('font-family', std);
    const w = t.getAttribute('font-weight') ?? '';
    if (w) {
      if (/italic/.test(w)) t.setAttribute('font-style', 'italic');
      t.setAttribute('font-weight', /bold|[6-9]00/.test(w) ? 'bold' : 'normal');
    }
  });
  if (needsUnicodeFont(svg)) {
    const [regular, bold] = await Promise.all([loadFont('Sarabun-Regular.ttf'), loadFont('Sarabun-Bold.ttf')]);
    if (regular) {
      doc.addFileToVFS('Sarabun-Regular.ttf', regular);
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
      doc.addFileToVFS('Sarabun-Bold.ttf', bold ?? regular);
      doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
      svg.querySelectorAll('text, tspan').forEach((t) => {
        t.setAttribute('font-family', 'Sarabun');
        (t as SVGElement).style.fontFamily = 'Sarabun';
      });
    }
  }
  // svg2pdf needs the element in the DOM to resolve computed styles.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    await doc.svg(svg, { x: 0, y: 0, width, height });
  } finally {
    host.remove();
  }
  if (opts.embedNative) {
    const packed = await packNative(ed.snapshot());
    doc.addMetadata(packed, NATIVE_NS);
  }
  return doc.output('blob');
}

export async function exportPDF(ed: Editor) {
  download(await buildPDF(ed, { embedNative: true }), `${baseName(ed)}.pdf`);
}

/**
 * Export as .ai: a PDF-compatible Illustrator file. Illustrator opens it as editable vector
 * artwork; this app restores the full editable document from the embedded data.
 */
export async function buildAI(ed: Editor): Promise<Blob> {
  const pdf = await buildPDF(ed, { embedNative: true });
  return new Blob([await pdf.arrayBuffer()], { type: 'application/postscript' });
}

export async function exportAI(ed: Editor) {
  download(await buildAI(ed), `${baseName(ed)}.ai`);
}
