import paper from 'paper';
import { Tool, ToolEvent, CURSORS } from './base';
import { colorToHex, firstStyled } from '../editor';

/** Hand tool (H, or hold Space): pan the view. */
export class HandTool extends Tool {
  readonly id = 'hand';
  readonly label = 'Hand';
  readonly shortcut = 'H';
  cursor = 'grab';
  onDown() {
    this.setCursor('grabbing');
  }
  onDrag(e: ToolEvent) {
    this.ed.panBy(e.viewDelta.x, e.viewDelta.y);
  }
  onUp() {
    this.setCursor('grab');
  }
  onDblClick() {
    this.ed.fitArtboard();
  }
}

/** Zoom tool (Z): click to zoom in, Alt-click to zoom out, drag to zoom into an area. */
export class ZoomTool extends Tool {
  readonly id = 'zoom';
  readonly label = 'Zoom';
  readonly shortcut = 'Z';
  cursor = CURSORS.zoomIn;
  onMove(e: ToolEvent) {
    this.setCursor(e.alt ? CURSORS.zoomOut : CURSORS.zoomIn);
  }
  onDrag(e: ToolEvent) {
    const g = this.ed.overlay('marquee');
    g.removeChildren();
    g.addChild(
      new paper.Path.Rectangle({
        from: e.downPoint,
        to: e.point,
        strokeColor: '#333',
        strokeWidth: this.ed.px(1),
        dashArray: [this.ed.px(3), this.ed.px(3)],
        insert: false,
      }),
    );
  }
  onUp(e: ToolEvent) {
    this.ed.clearOverlay('marquee');
    const r = new paper.Rectangle(e.downPoint, e.point);
    if (r.width * this.ed.zoom > 6 && r.height * this.ed.zoom > 6 && !e.alt) {
      this.ed.zoomToRect(r, 10);
    } else {
      this.ed.zoomBy(e.alt ? 1 / 2 : 2, e.point);
    }
  }
  onDblClick() {
    this.ed.zoomTo(1);
  }
}

/** Eyedropper (I): copy fill, stroke and type styles from the clicked object to the selection. */
export class EyedropperTool extends Tool {
  readonly id = 'eyedropper';
  readonly label = 'Eyedropper';
  readonly shortcut = 'I';
  cursor = CURSORS.eyedropper;
  onDown(e: ToolEvent) {
    const hit = this.ed.project.hitTest(e.point, {
      fill: true,
      stroke: true,
      tolerance: 4 / this.ed.zoom,
      match: (r: paper.HitResult) => this.ed.isEditable(r.item) && !this.ed.selection.includes(this.ed.topLevel(r.item)),
    });
    if (!hit) return;
    const src = firstStyled(hit.item) ?? hit.item;
    const patch: Record<string, unknown> = {
      fill: colorToHex(src.fillColor),
      stroke: colorToHex(src.strokeColor),
      strokeWidth: src.strokeWidth,
    };
    if (src instanceof paper.PointText) {
      patch.fontFamily = String(src.fontFamily);
      patch.fontSize = Number(src.fontSize);
    }
    // Gradients are copied as-is onto the selected items.
    const grad = src.fillColor && src.fillColor.type === 'gradient' ? src.fillColor.clone() : null;
    this.ed.applyStyle(patch);
    if (grad) for (const it of this.ed.selection) it.fillColor = grad.clone();
    this.ed.setStatus('คัดลอกสไตล์แล้ว');
  }
}

/** Rotate tool (R): drag to rotate the selection around its center. */
export class RotateTool extends Tool {
  readonly id = 'rotate';
  readonly label = 'Rotate';
  readonly shortcut = 'R';
  cursor = CURSORS.rotate;
  private applied = 0;
  private center: paper.Point | null = null;
  onDown() {
    this.applied = 0;
    this.center = this.ed.selectionBounds()?.center ?? null;
  }
  onDrag(e: ToolEvent) {
    if (!this.center) return;
    let total = e.point.subtract(this.center).angle - e.downPoint.subtract(this.center).angle;
    if (e.shift) total = Math.round(total / 45) * 45;
    for (const it of this.ed.selection) it.rotate(total - this.applied, this.center);
    this.applied = total;
    this.ed.drawSelection();
    this.ed.setStatus(`หมุน ${total.toFixed(1)}°`);
  }
  onUp() {
    if (this.center && this.applied) this.ed.commit();
    this.center = null;
  }
}

/** Reflect tool (O): click to flip the selection horizontally, Alt-click flips vertically. */
export class ReflectTool extends Tool {
  readonly id = 'reflect';
  readonly label = 'Reflect';
  readonly shortcut = 'O';
  cursor = 'ew-resize';
  onUp(e: ToolEvent) {
    const b = this.ed.selectionBounds();
    if (!b) return;
    for (const it of this.ed.selection) it.scale(e.alt ? 1 : -1, e.alt ? -1 : 1, b.center);
    this.ed.drawSelection();
    this.ed.commit();
  }
}
