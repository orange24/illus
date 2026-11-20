import paper from 'paper';
import type { Editor } from '../editor';
import { importLegacyAI, looksLikeLegacyAI } from './aiLegacy';

export interface LoadResult {
  ok: boolean;
  message: string;
}

const readText = (buf: ArrayBuffer) => new TextDecoder('utf-8').decode(buf);
const latin1 = (buf: ArrayBuffer, n = 4096) => new TextDecoder('latin1').decode(buf.slice(0, n));

/** Open (replace document) or import (place into current document) a file. */
export async function loadFile(ed: Editor, file: File, mode: 'open' | 'import'): Promise<LoadResult> {
  const buf = await file.arrayBuffer();
  const head = latin1(buf, 1024);
  const name = file.name;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (head.includes('%PDF-')) {
    const { importPDF } = await import('./pdfImport');
    const res = await importPDF(buf, name);
    if (res.native) {
      if (mode === 'open') {
        ed.loadSnapshot(res.native);
        finishOpen(ed, name);
      } else {
        const data = JSON.parse(res.native);
        const layers = (data.layers ?? []).map((lj: unknown) => {
          const l = new paper.Layer({ insert: false });
          l.importJSON(lj as string);
          return l;
        });
        placeLayers(ed, layers, 'import');
      }
      return { ok: true, message: `เปิด ${name} (ข้อมูลแก้ไขได้ครบถ้วน)` };
    }
    const textOnly = res.layers.every((l) => l.children.every((c) => c instanceof paper.PointText));
    const allText = res.layers.flatMap((l) => l.children.map((c) => (c as paper.PointText).content ?? '')).join(' ');
    if (textOnly && /without PDF Content/i.test(allText)) {
      return {
        ok: false,
        message: 'ไฟล์ .ai นี้ถูกบันทึกโดยไม่ได้เปิด "Create PDF Compatible File" จึงไม่มีข้อมูลที่อ่านได้ กรุณาบันทึกใหม่ใน Illustrator โดยเปิดตัวเลือกนี้',
      };
    }
    if (mode === 'open') ed.newDocument(Math.round(res.width), Math.round(res.height));
    placeLayers(ed, res.layers, mode);
    if (mode === 'open') finishOpen(ed, name);
    const pages = res.pageCount > 1 ? ` (หน้า 1 จาก ${res.pageCount})` : '';
    return { ok: true, message: `นำเข้า ${name}${pages}${res.warnings.length ? ' · ' + res.warnings.join(' · ') : ''}` };
  }

  if (head.startsWith('%!PS-Adobe')) {
    const text = latin1(buf, buf.byteLength);
    if (!looksLikeLegacyAI(text) && ext !== 'ai' && ext !== 'eps') {
      return { ok: false, message: 'ไฟล์ PostScript นี้ไม่ใช่ไฟล์ Illustrator ที่รองรับ' };
    }
    const res = importLegacyAI(text, name);
    if (!res.count) return { ok: false, message: 'ไม่พบ artwork ที่อ่านได้ในไฟล์ .ai รุ่นเก่านี้' };
    if (mode === 'open') ed.newDocument(Math.round(res.width), Math.round(res.height));
    placeLayers(ed, res.layers, mode);
    if (mode === 'open') finishOpen(ed, name);
    return { ok: true, message: `นำเข้า ${name} (.ai รุ่นเก่า, ${res.count} วัตถุ)` };
  }

  if (ext === 'svg' || /<svg[\s>]/i.test(head)) {
    importSVGText(ed, readText(buf), name, mode);
    return { ok: true, message: `นำเข้า ${name}` };
  }

  if (ext === 'json' || ext === 'illus') {
    const text = readText(buf);
    if (mode === 'open') {
      ed.loadSnapshot(text);
      finishOpen(ed, name);
    }
    return { ok: true, message: `เปิด ${name}` };
  }

  if (/^image\//.test(file.type)) {
    const url = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });
    await placeImage(ed, url);
    return { ok: true, message: `วางภาพ ${name}` };
  }

  return { ok: false, message: `ไม่รองรับไฟล์ประเภทนี้: ${name}` };
}

function finishOpen(ed: Editor, name: string) {
  ed.fileName = name.replace(/\.[^.]+$/, '');
  ed.clearSelection();
  ed.resetHistory();
  ed.fitArtboard();
  ed.emit('file');
  ed.emit('change');
}

/** Insert imported layers into the document (open) or merge them into one new layer group (import). */
function placeLayers(ed: Editor, layers: paper.Layer[], mode: 'open' | 'import') {
  if (mode === 'open') {
    const existing = ed.userLayers();
    for (const l of layers) l.insertBelow(ed.overlayLayer);
    // Drop the blank default layer created by newDocument.
    for (const l of existing) if (!l.children.length && layers.length) l.remove();
    const all = ed.userLayers();
    all[all.length - 1]?.activate();
    ed.commit();
    return;
  }
  const target = ed.prepareInsert();
  const g = new paper.Group({ insert: false });
  for (const l of layers) {
    const kids = l.removeChildren();
    if (kids.length) {
      if (layers.length > 1) {
        const sub = new paper.Group({ children: kids, insert: false });
        sub.name = l.name;
        g.addChild(sub);
      } else g.addChildren(kids);
    }
  }
  target.addChild(g);
  ed.commit();
  ed.setSelection([g]);
}

export function importSVGText(ed: Editor, text: string, name: string, mode: 'open' | 'import') {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') throw new Error('ไฟล์ SVG ไม่ถูกต้อง');
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every((n) => !Number.isNaN(n));
  const parseLen = (v: string | null) => (v && !v.endsWith('%') ? parseFloat(v) : NaN);
  let w = parseLen(root.getAttribute('width'));
  let h = parseLen(root.getAttribute('height'));
  if (Number.isNaN(w)) w = hasVB ? vb[2] : 800;
  if (Number.isNaN(h)) h = hasVB ? vb[3] : 600;

  // Import without Paper's viewBox clip so the artwork stays freely editable.
  root.removeAttribute('viewBox');
  root.removeAttribute('width');
  root.removeAttribute('height');
  const imported = ed.project.importSVG(root as unknown as SVGElement, { expandShapes: true, insert: false }) as paper.Item;
  if (!imported) throw new Error('นำเข้า SVG ไม่สำเร็จ');
  if (hasVB) {
    imported.translate(new paper.Point(-vb[0], -vb[1]));
    if (vb[2] > 0 && vb[3] > 0 && (Math.abs(w - vb[2]) > 0.01 || Math.abs(h - vb[3]) > 0.01)) {
      imported.scale(w / vb[2], h / vb[3], new paper.Point(0, 0));
    }
  }
  if (imported instanceof paper.Group && imported.clipped) {
    imported.firstChild?.remove();
    imported.clipped = false;
  }

  if (mode === 'open') {
    ed.newDocument(Math.round(w), Math.round(h));
    const layers: paper.Layer[] = [];
    const loose = new paper.Layer({ name: 'Layer 1', insert: false });
    const children = imported instanceof paper.Group ? imported.removeChildren() : [imported];
    const groupMatrix = imported.matrix;
    for (const c of children) {
      if (!groupMatrix.isIdentity()) c.transform(groupMatrix);
      if (c instanceof paper.Group && c.name && !c.clipped) {
        const l = new paper.Layer({ name: c.name.replace(/_/g, ' '), insert: false });
        l.addChildren(c.removeChildren());
        l.opacity = c.opacity;
        layers.push(l);
      } else loose.addChild(c);
    }
    if (loose.children.length) layers.unshift(loose);
    placeLayers(ed, layers, 'open');
    finishOpen(ed, name);
  } else {
    const layer = ed.prepareInsert();
    layer.addChild(imported);
    ed.commit();
    ed.setSelection([imported]);
  }
}

async function placeImage(ed: Editor, url: string) {
  const layer = ed.prepareInsert();
  const raster = new paper.Raster({ source: url, insert: false });
  await new Promise<void>((resolve) => {
    raster.onLoad = () => resolve();
    raster.onError = () => resolve();
  });
  const ab = ed.artboardBounds;
  const s = Math.min(1, (ab.width * 0.8) / raster.width, (ab.height * 0.8) / raster.height);
  raster.scale(s);
  raster.position = ab.center;
  layer.addChild(raster);
  ed.commit();
  ed.setSelection([raster]);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const OPEN_ACCEPT = '.ai,.pdf,.svg,.eps,.json,.illus,image/svg+xml,application/pdf,application/postscript';
export const IMPORT_ACCEPT = OPEN_ACCEPT + ',image/png,image/jpeg,image/webp,image/gif';
