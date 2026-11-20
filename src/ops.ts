import paper from 'paper';
import { importItem, type Editor } from './editor';

/** Object-level commands used by menus, panels and keyboard shortcuts. */
export class Ops {
  private clipboard: string[] = [];
  private pasteCount = 0;
  lastCopiedSvg = '';

  constructor(private ed: Editor) {}

  private done(items: paper.Item[], status?: string) {
    this.ed.commit();
    this.ed.setSelection(items);
    if (status) this.ed.setStatus(status);
  }

  selectAll() {
    if (this.ed.tool.id === 'direct') {
      for (const p of this.ed.allPaths()) p.fullySelected = true;
      this.ed.setSelection(this.ed.allPaths(), { keepSegments: true });
    } else {
      this.ed.setSelection(this.ed.allTopItems());
    }
  }

  deselect() {
    this.ed.clearSelection();
  }

  delete() {
    const ed = this.ed;
    if (!ed.selection.length) return;
    if (ed.tool.id === 'direct') {
      // Delete selected anchor points; remove paths that end up too small.
      let touched = false;
      for (const p of ed.allPaths()) {
        const sel = p.segments.filter((s) => s.selected);
        if (!sel.length) continue;
        touched = true;
        if (sel.length === p.segments.length) p.remove();
        else {
          sel.forEach((s) => s.remove());
          if (p.segments.length < 2) p.remove();
        }
      }
      if (!touched) ed.selection.forEach((i) => i.remove());
    } else {
      ed.selection.forEach((i) => i.remove());
    }
    this.done([], 'ลบแล้ว');
  }

  // ----- clipboard -----
  copy(): string {
    const items = this.ed.sortedSelection().map((i) => (this.ed.tool.id === 'direct' ? this.ed.topLevel(i) : i));
    const uniq = [...new Set(items)];
    this.clipboard = uniq.map((i) => i.exportJSON());
    this.pasteCount = 0;
    // Also provide SVG text so the artwork can be pasted into other apps.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const b = this.ed.selectionBounds();
    if (b) svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    for (const i of uniq) svg.appendChild(i.exportSVG({ asString: false }) as SVGElement);
    this.lastCopiedSvg = new XMLSerializer().serializeToString(svg);
    return this.lastCopiedSvg;
  }

  cut(): string {
    const s = this.copy();
    this.ed.selection.forEach((i) => i.remove());
    this.done([], 'ตัดแล้ว');
    return s;
  }

  hasClipboard() {
    return this.clipboard.length > 0;
  }

  paste(mode: 'offset' | 'inPlace' | 'front' | 'back' = 'offset') {
    if (!this.clipboard.length) return;
    const ed = this.ed;
    const layer = ed.prepareInsert();
    const anchor = mode === 'front' || mode === 'back' ? ed.sortedSelection() : [];
    const items = this.clipboard.map((j) => importItem(j));
    if (mode === 'front' && anchor.length) {
      const top = anchor[anchor.length - 1];
      items.forEach((it, i) => it.insertAbove(i === 0 ? top : items[i - 1]));
    } else if (mode === 'back' && anchor.length) {
      const bottom = anchor[0];
      items.forEach((it) => it.insertBelow(bottom));
    } else {
      items.forEach((it) => layer.addChild(it));
    }
    if (mode === 'offset') {
      this.pasteCount++;
      const d = new paper.Point(10, 10).multiply(this.pasteCount);
      items.forEach((it) => it.translate(d));
    }
    this.done(items, 'วางแล้ว');
  }

  duplicate() {
    const clones = this.ed.sortedSelection().map((it) => {
      const c = it.clone();
      c.translate(new paper.Point(10, 10));
      return c;
    });
    if (clones.length) this.done(clones, 'ทำสำเนาแล้ว');
  }

  // ----- grouping -----
  group() {
    const items = this.ed.sortedSelection().map((i) => this.ed.topLevel(i));
    const uniq = [...new Set(items)];
    if (!uniq.length) return;
    const g = new paper.Group({ insert: false });
    g.insertAbove(uniq[uniq.length - 1]);
    g.addChildren(uniq);
    this.done([g], 'จัดกลุ่มแล้ว');
  }

  ungroup() {
    const out: paper.Item[] = [];
    let changed = false;
    for (const it of this.ed.selection) {
      if (it instanceof paper.Group) {
        const kids = it.removeChildren();
        for (const k of kids) {
          if (k.clipMask) {
            k.clipMask = false;
          }
          // Keep group opacity/transform visible on children.
          k.opacity *= it.opacity;
        }
        it.parent.insertChildren(it.index, kids);
        it.remove();
        out.push(...kids);
        changed = true;
      } else out.push(it);
    }
    if (changed) this.done(out, 'ยกเลิกกลุ่มแล้ว');
  }

  makeCompound() {
    const sel = this.ed.sortedSelection();
    const paths: paper.Path[] = [];
    for (const it of sel) {
      if (it instanceof paper.Path) paths.push(it);
      else if (it instanceof paper.CompoundPath) paths.push(...(it.children as paper.Path[]));
    }
    if (paths.length < 2) return;
    const styleSrc = sel[0];
    const cp = new paper.CompoundPath({ insert: false });
    cp.insertAbove(sel[sel.length - 1]);
    cp.addChildren(paths.slice());
    cp.fillRule = 'evenodd';
    cp.fillColor = styleSrc.fillColor;
    cp.strokeColor = styleSrc.strokeColor;
    cp.strokeWidth = styleSrc.strokeWidth;
    sel.forEach((s) => s.parent && s !== cp && s.isEmpty() && s.remove());
    for (const s of sel) if (s instanceof paper.CompoundPath && s.children.length === 0) s.remove();
    this.done([cp], 'สร้าง Compound Path แล้ว');
  }

  releaseCompound() {
    const out: paper.Item[] = [];
    for (const it of this.ed.selection) {
      if (it instanceof paper.CompoundPath) {
        const kids = it.removeChildren() as paper.Path[];
        for (const k of kids) {
          k.fillColor = it.fillColor;
          k.strokeColor = it.strokeColor;
          k.strokeWidth = it.strokeWidth;
        }
        it.parent.insertChildren(it.index, kids);
        it.remove();
        out.push(...kids);
      } else out.push(it);
    }
    this.done(out);
  }

  makeClippingMask() {
    const sel = this.ed.sortedSelection().map((i) => this.ed.topLevel(i));
    if (sel.length < 2) {
      this.ed.setStatus('เลือกอย่างน้อย 2 ชิ้น (ชิ้นบนสุดเป็น mask)');
      return;
    }
    const g = new paper.Group({ insert: false });
    g.insertAbove(sel[sel.length - 1]);
    const mask = sel[sel.length - 1];
    g.addChild(mask);
    g.insertChildren(0, sel.slice(0, -1));
    mask.sendToBack();
    g.clipped = true;
    this.done([g], 'สร้าง Clipping Mask แล้ว');
  }

  releaseClippingMask() {
    const out: paper.Item[] = [];
    for (const it of this.ed.selection) {
      if (it instanceof paper.Group && it.clipped) {
        it.clipped = false;
        const mask = it.firstChild;
        mask.clipMask = false;
        mask.fillColor = null;
        mask.strokeColor = new paper.Color('#888');
        out.push(it);
      }
    }
    if (out.length) this.done(out);
  }

  // ----- arrange -----
  bringToFront() {
    this.ed.sortedSelection().forEach((i) => i.bringToFront());
    this.done(this.ed.selection);
  }
  sendToBack() {
    this.ed.sortedSelection().reverse().forEach((i) => i.sendToBack());
    this.done(this.ed.selection);
  }
  bringForward() {
    for (const i of this.ed.sortedSelection().reverse()) {
      const next = i.nextSibling;
      if (next && !this.ed.selection.includes(next)) i.insertAbove(next);
    }
    this.done(this.ed.selection);
  }
  sendBackward() {
    for (const i of this.ed.sortedSelection()) {
      const prev = i.previousSibling;
      if (prev && !this.ed.selection.includes(prev)) i.insertBelow(prev);
    }
    this.done(this.ed.selection);
  }

  moveToLayer(layer: paper.Layer) {
    const sel = this.ed.sortedSelection().map((i) => this.ed.topLevel(i));
    sel.forEach((i) => layer.addChild(i));
    this.done(sel);
  }

  // ----- lock / hide -----
  lock() {
    this.ed.selection.forEach((i) => (i.locked = true));
    this.done([], 'ล็อกแล้ว (Ctrl+Alt+2 เพื่อปลดล็อกทั้งหมด)');
  }
  unlockAll() {
    const unlocked: paper.Item[] = [];
    for (const l of this.ed.userLayers()) {
      l.getItems({ recursive: true, match: (i: paper.Item) => i.locked }).forEach((i) => {
        i.locked = false;
        unlocked.push(i);
      });
    }
    this.done(unlocked.filter((i) => i.parent instanceof paper.Layer));
  }
  hide() {
    this.ed.selection.forEach((i) => (i.visible = false));
    this.done([], 'ซ่อนแล้ว (Ctrl+Alt+3 เพื่อแสดงทั้งหมด)');
  }
  showAll() {
    const shown: paper.Item[] = [];
    for (const l of this.ed.userLayers()) {
      l.getItems({ recursive: true, match: (i: paper.Item) => !i.visible }).forEach((i) => {
        i.visible = true;
        shown.push(i);
      });
    }
    this.done(shown.filter((i) => i.parent instanceof paper.Layer));
  }

  // ----- align / distribute -----
  align(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const sel = this.ed.selection;
    if (!sel.length) return;
    const ref = sel.length === 1 ? this.ed.artboardBounds : this.ed.selectionBounds()!;
    for (const it of sel) {
      const b = it.bounds;
      const d = new paper.Point(0, 0);
      if (kind === 'left') d.x = ref.left - b.left;
      if (kind === 'hcenter') d.x = ref.center.x - b.center.x;
      if (kind === 'right') d.x = ref.right - b.right;
      if (kind === 'top') d.y = ref.top - b.top;
      if (kind === 'vcenter') d.y = ref.center.y - b.center.y;
      if (kind === 'bottom') d.y = ref.bottom - b.bottom;
      it.translate(d);
    }
    this.done(sel);
  }

  distribute(axis: 'h' | 'v') {
    const sel = [...this.ed.selection];
    if (sel.length < 3) return;
    const c = (i: paper.Item) => (axis === 'h' ? i.bounds.center.x : i.bounds.center.y);
    sel.sort((a, b) => c(a) - c(b));
    const first = c(sel[0]);
    const step = (c(sel[sel.length - 1]) - first) / (sel.length - 1);
    sel.forEach((it, idx) => {
      const delta = first + step * idx - c(it);
      it.translate(axis === 'h' ? new paper.Point(delta, 0) : new paper.Point(0, delta));
    });
    this.done(this.ed.selection);
  }

  flip(axis: 'h' | 'v') {
    const b = this.ed.selectionBounds();
    if (!b) return;
    for (const it of this.ed.selection) it.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1, b.center);
    this.done(this.ed.selection);
  }

  // ----- pathfinder -----
  private pathItems(): paper.PathItem[] {
    const out: paper.PathItem[] = [];
    for (const it of this.ed.sortedSelection()) {
      const p = toPathItem(it);
      if (p) out.push(p);
    }
    return out;
  }

  pathfinder(op: 'unite' | 'minusFront' | 'minusBack' | 'intersect' | 'exclude' | 'divide') {
    const items = this.pathItems();
    if (items.length < 2) {
      this.ed.setStatus('Pathfinder: เลือก shape อย่างน้อย 2 ชิ้น');
      return;
    }
    const top = items[items.length - 1];
    const bottom = items[0];
    const results: paper.PathItem[] = [];
    const opts = { insert: false };
    if (op === 'unite' || op === 'intersect' || op === 'exclude') {
      let acc: paper.PathItem = bottom;
      for (const it of items.slice(1)) {
        acc = op === 'unite' ? acc.unite(it, opts) : op === 'intersect' ? acc.intersect(it, opts) : acc.exclude(it, opts);
      }
      copyStyle(top, acc);
      results.push(acc);
    } else if (op === 'minusFront') {
      let acc: paper.PathItem = bottom;
      for (const it of items.slice(1)) acc = acc.subtract(it, opts);
      copyStyle(bottom, acc);
      results.push(acc);
    } else if (op === 'minusBack') {
      let acc: paper.PathItem = top;
      for (const it of items.slice(0, -1)) acc = acc.subtract(it, opts);
      copyStyle(top, acc);
      results.push(acc);
    } else if (op === 'divide') {
      // Split every shape into the non-overlapping pieces formed by all the others.
      let pieces: { path: paper.PathItem; src: paper.PathItem }[] = [];
      for (const it of items) {
        const next: typeof pieces = [];
        let rest: paper.PathItem = it.clone({ insert: false }) as paper.PathItem;
        for (const pc of pieces) {
          const inter = pc.path.intersect(it, opts);
          const diff = pc.path.subtract(it, opts);
          if (!isEmptyPath(inter)) next.push({ path: inter, src: it });
          if (!isEmptyPath(diff)) next.push({ path: diff, src: pc.src });
          rest = rest.subtract(pc.path, opts);
        }
        if (!isEmptyPath(rest)) next.push({ path: rest, src: it });
        pieces = next;
      }
      for (const pc of pieces) {
        copyStyle(pc.src, pc.path);
        for (const part of splitCompound(pc.path)) results.push(part);
      }
    }
    const valid = results.filter((r) => !isEmptyPath(r));
    if (op === 'divide' && valid.length) {
      const g = new paper.Group({ insert: false });
      g.insertAbove(top);
      g.addChildren(valid);
      this.removeSources(items);
      this.done([g], 'Divide');
      return;
    }
    valid.forEach((r) => r.insertAbove(top));
    this.removeSources(items);
    this.done(valid, 'Pathfinder เสร็จแล้ว');
  }

  private removeSources(items: paper.PathItem[]) {
    for (const s of this.ed.selection) s.remove();
    for (const s of items) s.remove();
  }
}

function isEmptyPath(p: paper.PathItem | null | undefined) {
  if (!p) return true;
  if (p.isEmpty()) return true;
  return Math.abs((p as paper.Path).area ?? 0) < 0.01 && p.bounds.width * p.bounds.height < 0.01;
}

function splitCompound(p: paper.PathItem): paper.PathItem[] {
  return [p];
}

function copyStyle(from: paper.Item, to: paper.Item) {
  to.fillColor = from.fillColor;
  to.strokeColor = from.strokeColor;
  to.strokeWidth = from.strokeWidth;
  to.strokeJoin = from.strokeJoin;
  to.strokeCap = from.strokeCap;
  to.dashArray = from.dashArray;
  to.opacity = from.opacity;
  if (from.fillRule) to.fillRule = from.fillRule;
}

/** Convert shapes and groups of paths into a single PathItem usable by boolean ops. */
export function toPathItem(item: paper.Item): paper.PathItem | null {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) return item;
  if (item instanceof paper.Shape) {
    const p = item.toPath(false);
    p.insertAbove(item);
    item.remove();
    return p;
  }
  if (item instanceof paper.Group) {
    const paths = item.getItems({ class: paper.Path, recursive: true }) as paper.Path[];
    if (!paths.length) return null;
    let acc: paper.PathItem = paths[0];
    for (const p of paths.slice(1)) acc = acc.unite(p, { insert: false });
    copyStyle(paths[0], acc);
    acc.insertAbove(item);
    item.remove();
    return acc;
  }
  return null;
}
