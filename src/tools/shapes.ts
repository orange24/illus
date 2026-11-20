import paper from 'paper';
import { Tool, ToolEvent, rectFromDrag, constrain45 } from './base';

abstract class DragShapeTool extends Tool {
  cursor = 'crosshair';
  protected preview: paper.Item | null = null;
  protected lastEvent: ToolEvent | null = null;
  protected abstract build(e: ToolEvent): paper.Item | null;
  protected noFill = false;

  onDown(e: ToolEvent) {
    this.ed.prepareInsert();
    this.lastEvent = e;
  }

  onDrag(e: ToolEvent) {
    this.lastEvent = e;
    this.rebuild();
  }

  protected rebuild() {
    const e = this.lastEvent;
    if (!e) return;
    this.preview?.remove();
    this.preview = this.build(e);
    if (this.preview) {
      Object.assign(this.preview, this.ed.newItemStyle({ forceNoFill: this.noFill }));
      if (!this.preview.strokeColor && !this.preview.fillColor) this.preview.strokeColor = new paper.Color('black');
      const b = this.preview.bounds;
      this.ed.setStatus(`W: ${b.width.toFixed(1)}  H: ${b.height.toFixed(1)}`);
    }
  }

  onUp(e: ToolEvent) {
    if (!this.preview && e.downPoint.getDistance(e.point) * this.ed.zoom < 3) {
      // Simple click: create a default-sized shape at the click position.
      this.lastEvent = { ...e, point: e.downPoint.add(new paper.Point(100, 100)) };
      this.rebuild();
    }
    const item = this.preview;
    this.preview = null;
    this.lastEvent = null;
    if (!item) return;
    if (item.bounds.width < 0.5 && item.bounds.height < 0.5) {
      item.remove();
      return;
    }
    this.ed.commit();
    this.ed.setSelection([item]);
  }

  cancel() {
    this.preview?.remove();
    this.preview = null;
  }
}

export class RectangleTool extends DragShapeTool {
  readonly id = 'rect';
  readonly label = 'Rectangle';
  readonly shortcut = 'M';
  protected build(e: ToolEvent) {
    const r = rectFromDrag(e.downPoint, e.point, e.shift, e.alt);
    return new paper.Path.Rectangle(r);
  }
}

export class RoundedRectangleTool extends DragShapeTool {
  readonly id = 'roundrect';
  readonly label = 'Rounded Rectangle';
  radius = 12;
  protected build(e: ToolEvent) {
    const r = rectFromDrag(e.downPoint, e.point, e.shift, e.alt);
    const rad = Math.min(this.radius, r.width / 2, r.height / 2);
    return new paper.Path.Rectangle(r, new paper.Size(rad, rad));
  }
  onKeyDown(e: KeyboardEvent) {
    if (!this.lastEvent) return false;
    if (e.key === 'ArrowUp') this.radius += 2;
    else if (e.key === 'ArrowDown') this.radius = Math.max(0, this.radius - 2);
    else return false;
    this.rebuild();
    return true;
  }
}

export class EllipseTool extends DragShapeTool {
  readonly id = 'ellipse';
  readonly label = 'Ellipse';
  readonly shortcut = 'L';
  protected build(e: ToolEvent) {
    const r = rectFromDrag(e.downPoint, e.point, e.shift, e.alt);
    return new paper.Path.Ellipse(r);
  }
}

export class PolygonTool extends DragShapeTool {
  readonly id = 'polygon';
  readonly label = 'Polygon';
  sides = 6;
  protected build(e: ToolEvent) {
    const radius = e.point.getDistance(e.downPoint);
    if (radius < 0.5) return null;
    const p = new paper.Path.RegularPolygon(e.downPoint, this.sides, radius);
    if (!e.shift) p.rotate(e.point.subtract(e.downPoint).angle + 90, e.downPoint);
    return p;
  }
  onKeyDown(e: KeyboardEvent) {
    if (!this.lastEvent) return false;
    if (e.key === 'ArrowUp') this.sides = Math.min(64, this.sides + 1);
    else if (e.key === 'ArrowDown') this.sides = Math.max(3, this.sides - 1);
    else return false;
    this.rebuild();
    return true;
  }
}

export class StarTool extends DragShapeTool {
  readonly id = 'star';
  readonly label = 'Star';
  points = 5;
  protected build(e: ToolEvent) {
    const radius = e.point.getDistance(e.downPoint);
    if (radius < 0.5) return null;
    const p = new paper.Path.Star(e.downPoint, this.points, radius * 0.5, radius);
    if (!e.shift) p.rotate(e.point.subtract(e.downPoint).angle + 90, e.downPoint);
    return p;
  }
  onKeyDown(e: KeyboardEvent) {
    if (!this.lastEvent) return false;
    if (e.key === 'ArrowUp') this.points = Math.min(64, this.points + 1);
    else if (e.key === 'ArrowDown') this.points = Math.max(3, this.points - 1);
    else return false;
    this.rebuild();
    return true;
  }
}

export class LineTool extends DragShapeTool {
  readonly id = 'line';
  readonly label = 'Line Segment';
  readonly shortcut = '\\';
  protected noFill = true;
  protected build(e: ToolEvent) {
    let to = e.point;
    if (e.shift) to = constrain45(e.downPoint, to);
    let from = e.downPoint;
    if (e.alt) from = from.subtract(to.subtract(from));
    return new paper.Path.Line(from, to);
  }
}
