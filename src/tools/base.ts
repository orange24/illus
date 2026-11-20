import paper from 'paper';
import type { Editor } from '../editor';

export interface ToolEvent {
  point: paper.Point;
  downPoint: paper.Point;
  lastPoint: paper.Point;
  /** Movement since the previous event, in project coordinates. */
  delta: paper.Point;
  viewPoint: paper.Point;
  viewDelta: paper.Point;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  button: number;
  native: MouseEvent;
}

export abstract class Tool {
  abstract readonly id: string;
  abstract readonly label: string;
  /** Shortcut shown in tooltips. */
  readonly shortcut: string = '';
  cursor = 'default';
  constructor(protected ed: Editor) {}
  activate(): void {}
  deactivate(): void {}
  onDown(_e: ToolEvent): void {}
  onDrag(_e: ToolEvent): void {}
  onUp(_e: ToolEvent): void {}
  onMove(_e: ToolEvent): void {}
  onDblClick(_e: ToolEvent): void {}
  /** Return true when the key was consumed. */
  onKeyDown(_e: KeyboardEvent): boolean {
    return false;
  }
  onViewChange?(): void;
  /** Abort any in-progress interaction (used before undo/redo). */
  cancel?(): void;
  setCursor(c: string) {
    this.ed.canvas.style.cursor = c;
  }
}

export function constrain45(from: paper.Point, to: paper.Point): paper.Point {
  const v = to.subtract(from);
  const angle = Math.round(v.angle / 45) * 45;
  const rad = (angle * Math.PI) / 180;
  const dir = new paper.Point(Math.cos(rad), Math.sin(rad));
  return from.add(dir.multiply(v.dot(dir)));
}

export function rectFromDrag(down: paper.Point, pt: paper.Point, square: boolean, fromCenter: boolean) {
  let dx = pt.x - down.x;
  let dy = pt.y - down.y;
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = m * (Math.sign(dx) || 1);
    dy = m * (Math.sign(dy) || 1);
  }
  if (fromCenter) {
    return new paper.Rectangle(new paper.Point(down.x - dx, down.y - dy), new paper.Point(down.x + dx, down.y + dy));
  }
  return new paper.Rectangle(down, new paper.Point(down.x + dx, down.y + dy));
}

export const svgCursor = (svg: string, x: number, y: number, fallback = 'crosshair') =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

export const CURSORS = {
  pen: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21 L6 12 L14 4 L20 10 L12 18 Z" fill="white" stroke="black" stroke-width="1.3" stroke-linejoin="round"/><circle cx="10" cy="14" r="1.6" fill="black"/></svg>',
    3,
    21,
  ),
  rotate: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 14 A7 7 0 1 1 13 19" fill="none" stroke="white" stroke-width="4"/><path d="M6 14 A7 7 0 1 1 13 19" fill="none" stroke="black" stroke-width="1.6"/><path d="M2 12 L6 17 L10 12 Z" fill="black" stroke="white"/></svg>',
    12,
    12,
    'grab',
  ),
  zoomIn: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="white" stroke="black" stroke-width="1.6"/><path d="M15 15 L22 22" stroke="black" stroke-width="3"/><path d="M7 10 H13 M10 7 V13" stroke="black" stroke-width="1.6"/></svg>',
    10,
    10,
    'zoom-in',
  ),
  zoomOut: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="white" stroke="black" stroke-width="1.6"/><path d="M15 15 L22 22" stroke="black" stroke-width="3"/><path d="M7 10 H13" stroke="black" stroke-width="1.6"/></svg>',
    10,
    10,
    'zoom-out',
  ),
  eyedropper: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21 L4 17 L14 7 L17 10 L7 20 Z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 5 L16 2 L22 8 L19 11 Z" fill="black"/></svg>',
    3,
    21,
  ),
  direct: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 21.5 L14 20.4 L11 14 L17 14 Z" fill="white" stroke="black" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    4,
    2,
    'default',
  ),
};
