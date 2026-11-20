import paper from 'paper';
import { Tool, ToolEvent, CURSORS, constrain45 } from './base';

/** Pen tool (P): click for corner points, drag for smooth curves, click the first point to close. */
export class PenTool extends Tool {
  readonly id = 'pen';
  readonly label = 'Pen';
  readonly shortcut = 'P';
  cursor = CURSORS.pen;
  private path: paper.Path | null = null;
  private seg: paper.Segment | null = null;
  private closing = false;
  private dragging = false;
  private lastMove: paper.Point | null = null;

  deactivate() {
    this.finish();
  }

  cancel() {
    this.finish(false);
  }

  private hitFirst(e: ToolEvent) {
    if (!this.path || this.path.segments.length < 2) return false;
    const first = this.ed.view.projectToView(this.path.firstSegment.point);
    return first.getDistance(e.viewPoint) <= 7;
  }

  onDown(e: ToolEvent) {
    const ed = this.ed;
    this.dragging = false;
    if (!this.path) {
      // Editing an existing selected path: click a point to delete it, click the curve to add one.
      const sel = ed.selection.filter((i): i is paper.Path => i instanceof paper.Path);
      if (sel.length) {
        const hit = ed.hitTest(e.point, { segments: true, fill: false });
        if (hit && hit.item instanceof paper.Path && sel.includes(hit.item)) {
          const p = hit.item;
          if (hit.type === 'segment' && hit.segment) {
            const isEnd = !p.closed && (hit.segment === p.firstSegment || hit.segment === p.lastSegment);
            if (isEnd) {
              // Continue drawing from an open endpoint.
              if (hit.segment === p.firstSegment) p.reverse();
              this.path = p;
              this.seg = p.lastSegment;
              p.selected = true;
              this.seg = null;
              return;
            }
            if (p.segments.length > 2) {
              hit.segment.remove();
              ed.commit();
              ed.setSelection([p]);
              return;
            }
          } else if (hit.type === 'stroke' && hit.location) {
            p.divideAt(hit.location);
            ed.commit();
            ed.setSelection([p]);
            return;
          }
        }
      }
      ed.prepareInsert();
      this.path = new paper.Path({ ...ed.newItemStyle() });
      if (!this.path.strokeColor && !this.path.fillColor) this.path.strokeColor = new paper.Color('black');
      this.path.selected = true;
      ed.selection = [];
    }
    if (this.hitFirst(e)) {
      this.closing = true;
      this.path.closed = true;
      this.seg = this.path.firstSegment;
      return;
    }
    let pt = e.point;
    if (e.shift && this.path.lastSegment) pt = constrain45(this.path.lastSegment.point, pt);
    this.seg = this.path.add(pt) as paper.Segment;
    this.seg.selected = true;
    this.drawPreview(null);
  }

  onDrag(e: ToolEvent) {
    if (!this.seg) return;
    this.dragging = true;
    let pt = e.point;
    if (e.shift) pt = constrain45(this.seg.point, pt);
    const v = pt.subtract(this.seg.point);
    this.seg.handleOut = v;
    if (!e.alt) this.seg.handleIn = v.multiply(-1);
  }

  onUp() {
    if (this.closing) {
      this.closing = false;
      this.finish();
    }
  }

  onMove(e: ToolEvent) {
    this.lastMove = e.point;
    this.setCursor(this.hitFirst(e) ? CURSORS.pen.replace('crosshair', 'pointer') : CURSORS.pen);
    this.drawPreview(e);
  }

  private drawPreview(e: ToolEvent | null) {
    const g = this.ed.overlay('pen');
    g.removeChildren();
    if (!this.path || !this.path.lastSegment) return;
    const pt = e ? (e.shift ? constrain45(this.path.lastSegment.point, e.point) : e.point) : this.lastMove;
    if (!pt) return;
    const last = this.path.lastSegment;
    const preview = new paper.Path({
      segments: [new paper.Segment(last.point, undefined, last.handleOut), new paper.Segment(pt)],
      strokeColor: this.ed.selectionColor,
      strokeWidth: this.ed.px(1),
      insert: false,
    });
    g.addChild(preview);
  }

  onKeyDown(e: KeyboardEvent) {
    if (this.path && (e.key === 'Enter' || e.key === 'Escape')) {
      this.finish();
      return true;
    }
    if (this.path && (e.key === 'Backspace' || e.key === 'Delete')) {
      if (this.path.segments.length > 1) this.path.lastSegment.remove();
      else this.finish(false);
      this.drawPreview(null);
      return true;
    }
    return false;
  }

  finish(keep = true) {
    this.ed.clearOverlay('pen');
    const p = this.path;
    this.path = null;
    this.seg = null;
    if (!p) return;
    p.selected = false;
    if (!keep || p.segments.length < 2) {
      if (p.segments.length < 2 || !keep) {
        if (!p.parent) return;
        p.remove();
      }
      this.ed.refreshSelection();
      return;
    }
    this.ed.commit();
    this.ed.setSelection([p]);
  }

  get isDrawing() {
    return !!this.path || this.dragging;
  }
}

/** Pencil tool (N): freehand drawing simplified into smooth bezier curves. */
export class PencilTool extends Tool {
  readonly id = 'pencil';
  readonly label = 'Pencil';
  readonly shortcut = 'N';
  cursor = 'crosshair';
  private path: paper.Path | null = null;

  onDown(e: ToolEvent) {
    this.ed.prepareInsert();
    const style = this.ed.newItemStyle({ forceNoFill: true });
    this.path = new paper.Path({ ...style, strokeColor: style.strokeColor ?? new paper.Color('black'), segments: [e.point] });
  }

  onDrag(e: ToolEvent) {
    this.path?.add(e.point);
  }

  onUp() {
    const p = this.path;
    this.path = null;
    if (!p) return;
    if (p.segments.length < 2) {
      p.remove();
      return;
    }
    const closeDist = this.ed.px(8);
    if (p.segments.length > 4 && p.firstSegment.point.getDistance(p.lastSegment.point) < closeDist) {
      p.lastSegment.remove();
      p.closed = true;
    }
    p.simplify(2.5 / Math.sqrt(this.ed.zoom));
    this.ed.commit();
    this.ed.setSelection([p]);
  }
}
