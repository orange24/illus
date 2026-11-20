import paper from 'paper';
import { Tool, ToolEvent, constrain45, CURSORS } from './base';
import { editText } from './text';

type Mode = 'none' | 'move' | 'marquee' | 'scale' | 'rotate';

const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Selection tool (V): select, move, duplicate, scale and rotate whole objects. */
export class SelectTool extends Tool {
  readonly id = 'select';
  readonly label = 'Selection';
  readonly shortcut = 'V';
  private mode: Mode = 'none';
  private moved = false;
  private applied = new paper.Point(0, 0);
  private duplicated = false;
  private handle: { hx: number; hy: number } | null = null;
  private origBounds: paper.Rectangle | null = null;
  private appliedScale = new paper.Point(1, 1);
  private rotateApplied = 0;
  private center = new paper.Point(0, 0);
  private hovered: paper.Item | null = null;

  activate() {
    this.ed.drawSelection();
  }

  deactivate() {
    this.ed.clearOverlay('marquee');
    this.ed.clearOverlay('hover');
    this.hovered = null;
  }

  /** Returns the handle under a view point, or 'rotate' when just outside a corner. */
  private hitHandle(e: ToolEvent): { id: string; hx: number; hy: number } | 'rotate' | null {
    const b = this.ed.selectionBounds();
    if (!b || !this.ed.selection.length) return null;
    const v = this.ed.view;
    for (const h of this.ed.handlePoints(b)) {
      const hp = v.projectToView(h.point);
      if (Math.abs(hp.x - e.viewPoint.x) <= 6 && Math.abs(hp.y - e.viewPoint.y) <= 6) return h;
    }
    for (const corner of [b.topLeft, b.topRight, b.bottomLeft, b.bottomRight]) {
      const d = v.projectToView(corner).getDistance(e.viewPoint);
      const insideBox = b.contains(e.point);
      if (d > 6 && d < 22 && !insideBox) return 'rotate';
    }
    return null;
  }

  onMove(e: ToolEvent) {
    const h = this.hitHandle(e);
    if (h === 'rotate') this.setCursor(CURSORS.rotate);
    else if (h) this.setCursor(HANDLE_CURSORS[h.id]);
    else this.setCursor('default');
    this.updateHover(h ? null : this.pick(e.point));
  }

  private updateHover(item: paper.Item | null) {
    if (item && this.ed.selection.includes(item)) item = null;
    if (item === this.hovered) return;
    this.hovered = item;
    const g = this.ed.overlay('hover');
    g.removeChildren();
    if (!item) return;
    if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
      const c = item.clone({ insert: false, deep: true }) as paper.PathItem;
      c.fillColor = null;
      c.strokeColor = new paper.Color(this.ed.selectionColor);
      c.strokeWidth = this.ed.px(1.5);
      c.opacity = 1;
      c.dashArray = [];
      g.addChild(c);
    } else {
      g.addChild(new paper.Path.Rectangle({ rectangle: item.bounds, strokeColor: this.ed.selectionColor, strokeWidth: this.ed.px(1), insert: false }));
    }
  }

  private pick(point: paper.Point): paper.Item | null {
    const hit = this.ed.hitTest(point);
    return hit ? this.ed.topLevel(hit.item) : null;
  }

  onDown(e: ToolEvent) {
    this.moved = false;
    this.duplicated = false;
    this.applied = new paper.Point(0, 0);
    this.ed.clearOverlay('hover');
    this.hovered = null;
    const h = this.hitHandle(e);
    if (h) {
      this.origBounds = this.ed.selectionBounds();
      this.center = this.origBounds!.center;
      if (h === 'rotate') {
        this.mode = 'rotate';
        this.rotateApplied = 0;
      } else {
        this.mode = 'scale';
        this.handle = h;
        this.appliedScale = new paper.Point(1, 1);
      }
      return;
    }
    const item = this.pick(e.point);
    if (item) {
      const sel = this.ed.selection;
      if (e.shift) {
        if (sel.includes(item)) {
          this.ed.setSelection(sel.filter((i) => i !== item));
          this.mode = 'none';
          return;
        }
        this.ed.setSelection([...sel, item]);
      } else if (!sel.includes(item)) {
        this.ed.setSelection([item]);
      }
      this.mode = 'move';
      this.setCursor('move');
    } else {
      if (!e.shift) this.ed.clearSelection();
      this.mode = 'marquee';
    }
  }

  onDrag(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'move') {
      if (!this.moved && e.alt && !this.duplicated) {
        // Alt-drag duplicates the selection.
        const clones = ed.selection.map((it) => {
          const c = it.clone();
          c.insertAbove(it);
          return c;
        });
        this.duplicated = true;
        ed.setSelection(clones);
      }
      this.moved = true;
      let target = e.point;
      if (e.shift) target = constrain45(e.downPoint, e.point);
      const total = target.subtract(e.downPoint);
      const step = total.subtract(this.applied);
      for (const it of ed.selection) it.translate(step);
      this.applied = total;
      ed.drawSelection();
      ed.emit('selection');
    } else if (this.mode === 'marquee') {
      const g = ed.overlay('marquee');
      g.removeChildren();
      g.addChild(
        new paper.Path.Rectangle({
          from: e.downPoint,
          to: e.point,
          strokeColor: ed.selectionColor,
          strokeWidth: ed.px(1),
          dashArray: [ed.px(4), ed.px(3)],
          fillColor: new paper.Color(0.12, 0.56, 1, 0.08),
          insert: false,
        }),
      );
    } else if (this.mode === 'scale' && this.handle && this.origBounds) {
      this.moved = true;
      this.scaleTo(e);
    } else if (this.mode === 'rotate') {
      this.moved = true;
      const a0 = e.downPoint.subtract(this.center).angle;
      const a1 = e.point.subtract(this.center).angle;
      let total = a1 - a0;
      if (e.shift) total = Math.round(total / 15) * 15;
      const step = total - this.rotateApplied;
      for (const it of ed.selection) it.rotate(step, this.center);
      this.rotateApplied = total;
      ed.drawSelection();
      ed.setStatus(`หมุน ${total.toFixed(1)}°`);
    }
  }

  private scaleTo(e: ToolEvent) {
    const b = this.origBounds!;
    const { hx, hy } = this.handle!;
    const alt = e.alt;
    const anchor = new paper.Point(
      alt || hx === 0 ? b.center.x : hx > 0 ? b.left : b.right,
      alt || hy === 0 ? b.center.y : hy > 0 ? b.top : b.bottom,
    );
    const mult = alt ? 2 : 1;
    let sx = hx !== 0 && b.width > 0 ? ((e.point.x - anchor.x) * hx * mult) / b.width : 1;
    let sy = hy !== 0 && b.height > 0 ? ((e.point.y - anchor.y) * hy * mult) / b.height : 1;
    if (e.shift) {
      if (hx !== 0 && hy !== 0) {
        const s = Math.max(Math.abs(sx), Math.abs(sy));
        sx = s * (Math.sign(sx) || 1);
        sy = s * (Math.sign(sy) || 1);
      } else if (hx !== 0) sy = Math.abs(sx);
      else sx = Math.abs(sy);
    }
    const clamp = (v: number) => (Math.abs(v) < 0.005 ? 0.005 * (Math.sign(v) || 1) : v);
    sx = clamp(sx);
    sy = clamp(sy);
    const fx = sx / this.appliedScale.x;
    const fy = sy / this.appliedScale.y;
    for (const it of this.ed.selection) it.scale(fx, fy, anchor);
    this.appliedScale = new paper.Point(sx, sy);
    this.ed.drawSelection();
    this.ed.setStatus(`W: ${(b.width * Math.abs(sx)).toFixed(1)}  H: ${(b.height * Math.abs(sy)).toFixed(1)}`);
  }

  onUp(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'marquee') {
      const rect = new paper.Rectangle(e.downPoint, e.point);
      ed.clearOverlay('marquee');
      if (rect.width > 1 || rect.height > 1) {
        const hits = ed.allTopItems().filter((it) => rect.intersects(it.bounds) && intersectsGeometry(it, rect));
        const base = e.shift ? ed.selection : [];
        ed.setSelection([...base, ...hits]);
      }
    } else if (this.moved || this.duplicated) {
      ed.commit();
      ed.emit('selection');
    }
    this.mode = 'none';
    this.handle = null;
    this.setCursor('default');
  }

  onDblClick(e: ToolEvent) {
    const hit = this.ed.hitTest(e.point);
    if (hit && hit.item instanceof paper.PointText) {
      editText(this.ed, hit.item);
    } else if (hit && this.ed.topLevel(hit.item) instanceof paper.Group) {
      // Double-click a group: drop into it by selecting the leaf with the Direct Selection tool.
      this.ed.setTool('direct');
      this.ed.setSelection([hit.item]);
      if (hit.item instanceof paper.Path) hit.item.fullySelected = true;
    }
  }

  onKeyDown(e: KeyboardEvent) {
    return nudge(this.ed, e);
  }

  onViewChange() {
    this.ed.clearOverlay('hover');
    this.hovered = null;
  }
}

/** True when the marquee rectangle touches the item's geometry, not only its bounding box. */
function intersectsGeometry(item: paper.Item, rect: paper.Rectangle): boolean {
  if (rect.contains(item.bounds)) return true;
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    const r = new paper.Path.Rectangle({ rectangle: rect, insert: false });
    const res = item.intersects(r) || item.contains(rect.center) || r.contains(item.bounds.center);
    return res;
  }
  return true;
}

/** Arrow-key nudging, shared by the selection tools. */
export function nudge(ed: import('../editor').Editor, e: KeyboardEvent): boolean {
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = dirs[e.key];
  if (!d || !ed.selection.length || e.metaKey || e.ctrlKey) return false;
  const step = e.shiftKey ? 10 : 1;
  const v = new paper.Point(d[0] * step, d[1] * step);
  if (ed.tool.id === 'direct') {
    let movedAny = false;
    for (const p of ed.allPaths()) {
      for (const s of p.segments) {
        if (s.selected) {
          s.point = s.point.add(v);
          movedAny = true;
        }
      }
    }
    if (!movedAny) for (const it of ed.selection) it.translate(v);
  } else {
    for (const it of ed.selection) it.translate(v);
  }
  ed.drawSelection();
  ed.commit();
  ed.emit('selection');
  return true;
}

