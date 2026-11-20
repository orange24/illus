import paper from 'paper';
import { Tool, ToolEvent, CURSORS, constrain45 } from './base';
import { nudge } from './select';
import { editText } from './text';

type Mode = 'none' | 'points' | 'handle' | 'marquee' | 'item';

interface HandleHit {
  segment: paper.Segment;
  which: 'handleIn' | 'handleOut';
}

/** Find a visible bezier handle of a selected segment under the cursor. */
export function hitHandle(ed: import('../editor').Editor, e: ToolEvent): HandleHit | null {
  const v = ed.view;
  for (const p of ed.allPaths()) {
    if (!p.selected) continue;
    for (const s of p.segments) {
      if (!s.selected) continue;
      for (const which of ['handleIn', 'handleOut'] as const) {
        const h = s[which];
        if (h.isZero()) continue;
        const hp = v.projectToView(s.point.add(h));
        if (hp.getDistance(e.viewPoint) <= 5) return { segment: s, which };
      }
    }
  }
  return null;
}

export function isSmooth(s: paper.Segment) {
  if (s.handleIn.isZero() || s.handleOut.isZero()) return false;
  return Math.abs(s.handleIn.normalize().add(s.handleOut.normalize()).length) < 0.05;
}

/** Direct Selection tool (A): select and edit anchor points and handles. */
export class DirectSelectTool extends Tool {
  readonly id = 'direct';
  readonly label = 'Direct Selection';
  readonly shortcut = 'A';
  cursor = CURSORS.direct;
  private mode: Mode = 'none';
  private moved = false;
  private handle: HandleHit | null = null;
  private keepSmooth = false;
  private applied = new paper.Point(0, 0);

  activate() {
    this.ed.drawSelection();
  }

  deactivate() {
    this.ed.clearOverlay('marquee');
  }

  private sync() {
    const items: paper.Item[] = [];
    for (const p of this.ed.allPaths()) {
      if (p.segments.some((s) => s.selected) || p.fullySelected) items.push(p);
    }
    for (const it of this.ed.selection) if (!(it instanceof paper.Path) && it.parent && !items.includes(it)) items.push(it);
    this.ed.setSelection(items, { keepSegments: true });
  }

  onDown(e: ToolEvent) {
    const ed = this.ed;
    this.moved = false;
    this.applied = new paper.Point(0, 0);
    const h = hitHandle(ed, e);
    if (h) {
      this.mode = 'handle';
      this.handle = h;
      this.keepSmooth = isSmooth(h.segment) && !e.alt;
      return;
    }
    const hit = ed.hitTest(e.point, { segments: true });
    if (hit && hit.type === 'segment' && hit.segment) {
      const s = hit.segment;
      if (e.shift) s.selected = !s.selected;
      else if (!s.selected) {
        ed.clearSegmentSelection();
        ed.selection = [];
        s.selected = true;
      }
      this.mode = 'points';
      this.sync();
      return;
    }
    if (hit) {
      const item = hit.item;
      if (item instanceof paper.Path) {
        if (e.shift) item.fullySelected = !item.fullySelected;
        else if (!item.fullySelected) {
          ed.clearSegmentSelection();
          item.fullySelected = true;
          ed.selection = [];
        }
        this.mode = 'points';
        this.sync();
      } else {
        // Text, rasters and other non-path items move as a whole.
        if (e.shift) ed.setSelection([...ed.selection, item], { keepSegments: true });
        else if (!ed.selection.includes(item)) ed.setSelection([item]);
        this.mode = 'item';
      }
      return;
    }
    if (!e.shift) ed.clearSelection();
    this.mode = 'marquee';
  }

  onDrag(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'points' || this.mode === 'item') {
      this.moved = true;
      const target = e.shift ? constrain45(e.downPoint, e.point) : e.point;
      const total = target.subtract(e.downPoint);
      const step = total.subtract(this.applied);
      this.applied = total;
      if (this.mode === 'item') {
        for (const it of ed.selection) it.translate(step);
      } else {
        for (const p of ed.allPaths()) for (const s of p.segments) if (s.selected) s.point = s.point.add(step);
        for (const it of ed.selection) if (!(it instanceof paper.Path)) it.translate(step);
      }
      ed.drawSelection();
    } else if (this.mode === 'handle' && this.handle) {
      this.moved = true;
      const { segment: s, which } = this.handle;
      const other = which === 'handleIn' ? 'handleOut' : 'handleIn';
      const vec = e.point.subtract(s.point);
      s[which] = vec;
      if (this.keepSmooth && !e.alt) {
        const len = s[other].length;
        s[other] = vec.normalize(-len);
      }
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
          insert: false,
        }),
      );
    }
  }

  onUp(e: ToolEvent) {
    const ed = this.ed;
    if (this.mode === 'marquee') {
      ed.clearOverlay('marquee');
      const rect = new paper.Rectangle(e.downPoint, e.point);
      if (rect.width > 1 || rect.height > 1) {
        for (const p of ed.allPaths()) for (const s of p.segments) if (rect.contains(s.point)) s.selected = true;
        this.sync();
      }
    } else if (this.moved) {
      ed.commit();
      this.sync();
    }
    this.mode = 'none';
    this.handle = null;
  }

  onDblClick(e: ToolEvent) {
    const hit = this.ed.hitTest(e.point);
    if (hit && hit.item instanceof paper.PointText) editText(this.ed, hit.item);
  }

  onKeyDown(e: KeyboardEvent) {
    return nudge(this.ed, e);
  }

  onViewChange() {
    this.ed.drawSelection();
  }
}

/** Anchor Point tool (Shift+C): click to make a corner, drag to pull out smooth handles. */
export class AnchorPointTool extends Tool {
  readonly id = 'anchor';
  readonly label = 'Anchor Point';
  readonly shortcut = 'Shift+C';
  cursor = CURSORS.direct;
  private seg: paper.Segment | null = null;
  private handle: HandleHit | null = null;
  private moved = false;

  onDown(e: ToolEvent) {
    this.moved = false;
    this.handle = hitHandle(this.ed, e);
    if (this.handle) return;
    const hit = this.ed.hitTest(e.point, { segments: true, fill: false });
    this.seg = hit?.type === 'segment' && hit.segment ? hit.segment : null;
    if (!this.seg && hit?.item instanceof paper.Path) {
      this.ed.clearSegmentSelection();
      hit.item.selected = true;
      this.ed.setSelection([hit.item], { keepSegments: true });
    }
  }

  onDrag(e: ToolEvent) {
    if (this.handle) {
      // Move one handle independently (breaks smoothness).
      this.handle.segment[this.handle.which] = e.point.subtract(this.handle.segment.point);
      this.moved = true;
      return;
    }
    if (!this.seg) return;
    const v = e.point.subtract(this.seg.point);
    this.seg.handleOut = v;
    this.seg.handleIn = v.multiply(-1);
    this.seg.selected = true;
    this.moved = true;
  }

  onUp() {
    if (this.seg && !this.moved) {
      this.seg.handleIn = new paper.Point(0, 0);
      this.seg.handleOut = new paper.Point(0, 0);
      this.moved = true;
    }
    if (this.moved) this.ed.commit();
    this.seg = null;
    this.handle = null;
  }
}
