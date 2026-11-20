import paper from 'paper';
import type { Tool } from './tools/base';

export type ColorValue = string | null;

export interface StyleState {
  fill: ColorValue;
  stroke: ColorValue;
  strokeWidth: number;
  opacity: number;
  fontFamily: string;
  fontSize: number;
}

export type EditorEvent = 'selection' | 'change' | 'tool' | 'view' | 'style' | 'status' | 'file';

const SELECTION_COLOR = '#1e90ff';
const AUTOSAVE_KEY = 'illus.autosave.v1';
const MAX_HISTORY = 120;

/**
 * Central editor state. The document is a Paper.js project made of user layers,
 * sandwiched between a non-exported artboard layer (bottom) and an overlay layer (top)
 * used for selection handles, marquees and previews.
 */
export class Editor {
  readonly canvas: HTMLCanvasElement;
  readonly scope: paper.PaperScope;
  readonly artboardLayer: paper.Layer;
  readonly overlayLayer: paper.Layer;
  artboard = { width: 800, height: 600 };
  artboardRect!: paper.Path;

  selection: paper.Item[] = [];
  style: StyleState = {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
    fontFamily: 'Inter, "Noto Sans Thai", sans-serif',
    fontSize: 36,
  };
  activeColor: 'fill' | 'stroke' = 'fill';

  tools = new Map<string, Tool>();
  tool!: Tool;
  previousSelectTool = 'select';

  fileName = 'Untitled';
  statusText = '';
  readonly selectionColor = SELECTION_COLOR;

  private history: string[] = [];
  private historyIndex = -1;
  private listeners = new Map<EditorEvent, Set<() => void>>();
  private overlayGroups = new Map<string, paper.Group>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scope = new paper.PaperScope();
    this.scope.setup(canvas);
    this.scope.settings.handleSize = 7;
    this.scope.settings.hitTolerance = 0;
    this.scope.settings.insertItems = true;

    const project = this.scope.project;
    this.artboardLayer = project.activeLayer;
    this.artboardLayer.name = '__artboard';
    this.artboardLayer.locked = true;
    this.overlayLayer = new paper.Layer({ name: '__overlay' });
    this.overlayLayer.locked = true;
    this.drawArtboard();
    this.newLayer('Layer 1');
  }

  // ---------- events ----------
  on(evt: EditorEvent, fn: () => void) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt)!.add(fn);
    return () => this.listeners.get(evt)!.delete(fn);
  }
  emit(evt: EditorEvent) {
    this.listeners.get(evt)?.forEach((fn) => fn());
  }

  get project() {
    return this.scope.project;
  }
  get view() {
    return this.scope.view;
  }
  get zoom() {
    return this.view.zoom;
  }

  setStatus(text: string) {
    this.statusText = text;
    this.emit('status');
  }

  // ---------- layers ----------
  userLayers(): paper.Layer[] {
    return this.project.layers.filter((l) => l !== this.artboardLayer && l !== this.overlayLayer);
  }

  get currentLayer(): paper.Layer {
    let layer = this.project.activeLayer;
    if (!layer || layer === this.overlayLayer || layer === this.artboardLayer || !layer.parent) {
      const layers = this.userLayers();
      layer = layers[layers.length - 1] ?? this.newLayer('Layer 1', false);
      layer.activate();
    }
    return layer;
  }

  setCurrentLayer(layer: paper.Layer) {
    layer.activate();
    this.emit('change');
  }

  newLayer(name?: string, emit = true): paper.Layer {
    const n = name ?? `Layer ${this.userLayers().length + 1}`;
    const layer = new paper.Layer({ name: n });
    const cur = this.project.activeLayer;
    if (cur && cur !== this.overlayLayer && cur !== this.artboardLayer && cur.parent && cur !== layer) {
      layer.insertAbove(cur);
    } else {
      layer.insertBelow(this.overlayLayer);
    }
    layer.activate();
    if (emit) this.emit('change');
    return layer;
  }

  deleteLayer(layer: paper.Layer) {
    const layers = this.userLayers();
    if (layers.length <= 1) {
      layer.removeChildren();
    } else {
      const idx = layers.indexOf(layer);
      layer.remove();
      const rest = this.userLayers();
      rest[Math.max(0, idx - 1)]?.activate();
    }
    this.clearSelection();
    this.commit();
  }

  /** Ensure new items are created inside a user layer. */
  prepareInsert() {
    const layer = this.currentLayer;
    layer.activate();
    if (layer.locked || !layer.visible) {
      this.setStatus('เลเยอร์ปัจจุบันถูกล็อกหรือซ่อนอยู่');
    }
    return layer;
  }

  // ---------- artboard ----------
  drawArtboard() {
    this.artboardLayer.removeChildren();
    const r = new paper.Path.Rectangle({
      point: [0, 0],
      size: [this.artboard.width, this.artboard.height],
      fillColor: 'white',
      shadowColor: new paper.Color(0, 0, 0, 0.35),
      shadowBlur: 12,
      insert: false,
    });
    this.artboardLayer.addChild(r);
    this.artboardRect = r;
  }

  setArtboardSize(width: number, height: number, commit = true) {
    this.artboard = { width: Math.max(1, width), height: Math.max(1, height) };
    this.drawArtboard();
    if (commit) this.commit();
    this.emit('change');
  }

  get artboardBounds() {
    return new paper.Rectangle(0, 0, this.artboard.width, this.artboard.height);
  }

  // ---------- items / hit testing ----------
  isSpecial(item: paper.Item) {
    return item.layer === this.overlayLayer || item.layer === this.artboardLayer || item === this.overlayLayer || item === this.artboardLayer;
  }

  /** Item is inside a user layer and neither it nor an ancestor is locked or hidden. */
  isEditable(item: paper.Item | null): boolean {
    let it: paper.Item | null = item;
    while (it) {
      if (it === this.overlayLayer || it === this.artboardLayer) return false;
      if (!it.visible || it.locked) return false;
      if (it instanceof paper.Layer) return true;
      it = it.parent;
    }
    return false;
  }

  topLevel(item: paper.Item): paper.Item {
    let it = item;
    while (it.parent && !(it.parent instanceof paper.Layer)) it = it.parent;
    return it;
  }

  hitTest(point: paper.Point, opts: Record<string, unknown> = {}) {
    return this.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 5 / this.zoom,
      ...opts,
      match: (r: paper.HitResult) => this.isEditable(r.item) && !(r.item instanceof paper.Layer),
    });
  }

  /** All editable top-level items across user layers. */
  allTopItems(): paper.Item[] {
    const out: paper.Item[] = [];
    for (const layer of this.userLayers()) {
      if (!layer.visible || layer.locked) continue;
      for (const c of layer.children) if (c.visible && !c.locked) out.push(c);
    }
    return out;
  }

  /** Every editable Path inside user layers (recursive). */
  allPaths(): paper.Path[] {
    const out: paper.Path[] = [];
    const walk = (item: paper.Item) => {
      if (!item.visible || item.locked) return;
      if (item instanceof paper.Path) out.push(item);
      else if (item.children) item.children.forEach(walk);
    };
    for (const layer of this.userLayers()) walk(layer);
    return out;
  }

  // ---------- selection ----------
  setSelection(items: paper.Item[], opts: { keepSegments?: boolean } = {}) {
    if (!opts.keepSegments) this.clearSegmentSelection();
    const uniq: paper.Item[] = [];
    for (const it of items) if (it && !uniq.includes(it) && it.parent) uniq.push(it);
    this.selection = uniq;
    this.syncStyleFromSelection();
    this.drawSelection();
    this.emit('selection');
  }

  clearSelection() {
    this.setSelection([]);
  }

  clearSegmentSelection() {
    for (const layer of this.userLayers()) {
      layer.selected = false;
    }
  }

  /** Drop deleted items from the selection and redraw. */
  refreshSelection() {
    this.selection = this.selection.filter((i) => i.parent && i.project);
    this.drawSelection();
    this.emit('selection');
  }

  selectionBounds(): paper.Rectangle | null {
    let b: paper.Rectangle | null = null;
    for (const it of this.selection) {
      const ib = it.bounds;
      b = b ? b.unite(ib) : ib.clone();
    }
    return b;
  }

  /** Selected items sorted bottom-to-top in paint order. */
  sortedSelection(): paper.Item[] {
    const key = (item: paper.Item) => {
      const path: number[] = [];
      let it: paper.Item | null = item;
      while (it) {
        path.unshift(it.index);
        it = it.parent;
      }
      return path;
    };
    return [...this.selection].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return ka.length - kb.length;
    });
  }

  // ---------- overlay ----------
  overlay(name: string): paper.Group {
    let g = this.overlayGroups.get(name);
    if (!g || !g.parent) {
      g = new paper.Group({ insert: false, name });
      this.overlayLayer.addChild(g);
      this.overlayGroups.set(name, g);
    }
    return g;
  }

  clearOverlay(name: string) {
    this.overlayGroups.get(name)?.removeChildren();
  }

  px(n: number) {
    return n / this.zoom;
  }

  /** Draws the selection bounding box with transform handles (Selection tool). */
  drawSelection() {
    const g = this.overlay('selection');
    g.removeChildren();
    if (this.tool?.id === 'direct' || this.tool?.id === 'pen' || this.selection.length === 0) {
      // Direct selection uses Paper's built-in segment highlighting.
      if (this.tool?.id === 'direct' || this.tool?.id === 'pen') {
        for (const it of this.selection) {
          if (!it.parent) continue;
          if (!(it instanceof paper.Path || it instanceof paper.CompoundPath)) {
            this.addOutline(g, it);
          } else if (!it.selected) it.selected = true;
        }
      }
      return;
    }
    for (const it of this.selection) this.addOutline(g, it);
    const b = this.selectionBounds();
    if (!b) return;
    const box = new paper.Path.Rectangle({ rectangle: b, strokeColor: SELECTION_COLOR, strokeWidth: this.px(1), insert: false });
    g.addChild(box);
    if (this.tool?.id === 'select') {
      for (const h of this.handlePoints(b)) {
        const s = this.px(7);
        const r = new paper.Path.Rectangle({
          point: h.point.subtract(s / 2),
          size: [s, s],
          fillColor: 'white',
          strokeColor: SELECTION_COLOR,
          strokeWidth: this.px(1),
          insert: false,
        });
        g.addChild(r);
      }
    }
  }

  private addOutline(g: paper.Group, it: paper.Item) {
    const sw = this.px(1);
    if (it instanceof paper.Path || it instanceof paper.CompoundPath) {
      const c = it.clone({ insert: false, deep: true }) as paper.PathItem;
      c.fillColor = null;
      c.strokeColor = new paper.Color(SELECTION_COLOR);
      c.strokeWidth = sw;
      c.dashArray = [];
      c.opacity = 1;
      c.shadowColor = null;
      c.selected = false;
      g.addChild(c);
    } else {
      const r = new paper.Path.Rectangle({ rectangle: it.bounds, strokeColor: SELECTION_COLOR, strokeWidth: sw, insert: false });
      g.addChild(r);
    }
  }

  handlePoints(b: paper.Rectangle) {
    return [
      { id: 'nw', hx: -1, hy: -1, point: b.topLeft },
      { id: 'n', hx: 0, hy: -1, point: b.topCenter },
      { id: 'ne', hx: 1, hy: -1, point: b.topRight },
      { id: 'e', hx: 1, hy: 0, point: b.rightCenter },
      { id: 'se', hx: 1, hy: 1, point: b.bottomRight },
      { id: 's', hx: 0, hy: 1, point: b.bottomCenter },
      { id: 'sw', hx: -1, hy: 1, point: b.bottomLeft },
      { id: 'w', hx: -1, hy: 0, point: b.leftCenter },
    ];
  }

  // ---------- style ----------
  syncStyleFromSelection() {
    const it = this.selection[0];
    if (!it) {
      this.emit('style');
      return;
    }
    const leaf = firstStyled(it);
    if (leaf) {
      this.style.fill = colorToHex(leaf.fillColor);
      this.style.stroke = colorToHex(leaf.strokeColor);
      this.style.strokeWidth = leaf.strokeWidth ?? this.style.strokeWidth;
      if (leaf instanceof paper.PointText) {
        this.style.fontFamily = String(leaf.fontFamily);
        this.style.fontSize = Number(leaf.fontSize);
      }
    }
    this.style.opacity = it.opacity;
    this.emit('style');
  }

  /** Apply style properties to the default style and the selected items. */
  applyStyle(patch: Partial<StyleState>, commit = true) {
    Object.assign(this.style, patch);
    for (const it of this.selection) applyStyleTo(it, patch);
    if (this.selection.length) {
      this.drawSelection();
      if (commit) this.commit();
    }
    this.emit('style');
  }

  newItemStyle(opts: { forceNoFill?: boolean } = {}) {
    return {
      fillColor: opts.forceNoFill || !this.style.fill ? null : new paper.Color(this.style.fill),
      strokeColor: this.style.stroke ? new paper.Color(this.style.stroke) : null,
      strokeWidth: this.style.strokeWidth,
    };
  }

  // ---------- tools ----------
  registerTool(tool: Tool) {
    this.tools.set(tool.id, tool);
  }

  setTool(id: string) {
    const next = this.tools.get(id);
    if (!next || next === this.tool) return;
    this.tool?.deactivate();
    if (this.tool && (this.tool.id === 'select' || this.tool.id === 'direct')) this.previousSelectTool = this.tool.id;
    this.tool = next;
    // Translate selection between object mode and point mode.
    if (id === 'select') {
      const tops = this.selection.map((i) => this.topLevel(i));
      this.setSelection(tops);
    } else if (id === 'direct') {
      this.setSelection(this.selection, { keepSegments: true });
    } else {
      this.clearSegmentSelection();
      this.drawSelection();
    }
    next.activate();
    this.canvas.style.cursor = next.cursor;
    this.emit('tool');
  }

  // ---------- view ----------
  zoomTo(zoom: number, anchor?: paper.Point) {
    const v = this.view;
    const z = Math.min(64, Math.max(0.02, zoom));
    const a = anchor ?? v.center;
    const old = v.zoom;
    const c = v.center;
    v.zoom = z;
    v.center = a.add(c.subtract(a).multiply(old / z));
    this.afterViewChange();
  }

  zoomBy(factor: number, anchor?: paper.Point) {
    this.zoomTo(this.zoom * factor, anchor);
  }

  zoomToRect(rect: paper.Rectangle, padding = 40) {
    const v = this.view;
    const vs = v.viewSize;
    if (rect.width < 1 || rect.height < 1) return;
    const z = Math.min((vs.width - padding * 2) / rect.width, (vs.height - padding * 2) / rect.height);
    v.zoom = Math.min(64, Math.max(0.02, z));
    v.center = rect.center;
    this.afterViewChange();
  }

  fitArtboard() {
    this.zoomToRect(this.artboardBounds, 48);
  }

  panBy(dxView: number, dyView: number) {
    const v = this.view;
    v.center = v.center.subtract(new paper.Point(dxView, dyView).divide(v.zoom));
    this.emit('view');
  }

  afterViewChange() {
    this.drawSelection();
    this.tool?.onViewChange?.();
    this.emit('view');
  }

  // ---------- history ----------
  snapshot(): string {
    return JSON.stringify({
      v: 1,
      artboard: this.artboard,
      layers: this.userLayers().map((l) => JSON.parse(l.exportJSON({ precision: 4 }))),
      active: Math.max(0, this.userLayers().indexOf(this.currentLayer)),
    });
  }

  loadSnapshot(json: string) {
    const data = JSON.parse(json);
    this.clearSegmentSelection();
    for (const l of this.userLayers()) l.remove();
    if (data.artboard) {
      this.artboard = data.artboard;
      this.drawArtboard();
    }
    const layers: paper.Layer[] = [];
    for (const lj of data.layers ?? []) {
      let layer: paper.Layer;
      if (Array.isArray(lj) && lj[0] === 'Layer') {
        layer = new paper.Layer({ insert: false });
        layer.importJSON(lj as unknown as string);
      } else {
        layer = new paper.Layer({ name: 'Layer', insert: false });
        layer.addChild(importItem(lj));
      }
      layer.insertBelow(this.overlayLayer);
      layers.push(layer);
    }
    if (!layers.length) layers.push(this.newLayer('Layer 1', false));
    (layers[data.active] ?? layers[layers.length - 1]).activate();
    this.selection = [];
    this.drawSelection();
    this.emit('selection');
    this.emit('change');
  }

  commit() {
    const snap = this.snapshot();
    if (snap === this.history[this.historyIndex]) {
      this.emit('change');
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.autosave(snap);
    this.emit('change');
  }

  resetHistory() {
    this.history = [this.snapshot()];
    this.historyIndex = 0;
    this.autosave(this.history[0]);
  }

  get canUndo() {
    return this.historyIndex > 0;
  }
  get canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  undo() {
    this.tool?.cancel?.();
    if (!this.canUndo) return;
    this.historyIndex--;
    this.loadSnapshot(this.history[this.historyIndex]);
    this.autosave(this.history[this.historyIndex]);
    this.setStatus('Undo');
  }

  redo() {
    this.tool?.cancel?.();
    if (!this.canRedo) return;
    this.historyIndex++;
    this.loadSnapshot(this.history[this.historyIndex]);
    this.autosave(this.history[this.historyIndex]);
    this.setStatus('Redo');
  }

  private autosaveTimer = 0;
  autosave(snap: string) {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: this.fileName, snap }));
      } catch {
        /* storage full or blocked */
      }
    }, 400);
  }

  restoreAutosave(): boolean {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const { name, snap } = JSON.parse(raw);
      this.loadSnapshot(snap);
      this.fileName = name || 'Untitled';
      this.emit('file');
      return true;
    } catch {
      return false;
    }
  }

  newDocument(width = 800, height = 600) {
    this.tool?.cancel?.();
    for (const l of this.userLayers()) l.remove();
    this.artboard = { width, height };
    this.drawArtboard();
    this.newLayer('Layer 1', false);
    this.fileName = 'Untitled';
    this.selection = [];
    this.drawSelection();
    this.resetHistory();
    this.fitArtboard();
    this.emit('selection');
    this.emit('change');
    this.emit('file');
  }
}

// ---------- helpers ----------
export function colorToHex(c: paper.Color | null | undefined): ColorValue {
  if (!c) return null;
  if (c.type === 'gradient') return c.gradient?.stops?.[0]?.color ? colorToHex(c.gradient.stops[0].color) : null;
  if (c.alpha === 0) return null;
  return c.toCSS(true);
}

export function firstStyled(item: paper.Item): paper.Item | null {
  if (item instanceof paper.Group || item instanceof paper.Layer) {
    for (const c of item.children) {
      if (c.clipMask) continue;
      const r = firstStyled(c);
      if (r) return r;
    }
    return null;
  }
  return item;
}

export function applyStyleTo(item: paper.Item, patch: Partial<StyleState>) {
  if (patch.opacity !== undefined) item.opacity = patch.opacity;
  const leafPatch = { ...patch };
  delete leafPatch.opacity;
  if (!Object.keys(leafPatch).length) return;
  if (item instanceof paper.Group) {
    for (const c of item.children) if (!c.clipMask) applyStyleTo(c, leafPatch);
    return;
  }
  if (item instanceof paper.CompoundPath) {
    // style lives on the compound path itself
  }
  if ('fill' in leafPatch) item.fillColor = leafPatch.fill ? new paper.Color(leafPatch.fill) : null;
  if ('stroke' in leafPatch) item.strokeColor = leafPatch.stroke ? new paper.Color(leafPatch.stroke) : null;
  if (leafPatch.strokeWidth !== undefined) item.strokeWidth = leafPatch.strokeWidth;
  if (item instanceof paper.PointText) {
    if (leafPatch.fontFamily) item.fontFamily = leafPatch.fontFamily;
    if (leafPatch.fontSize) item.fontSize = leafPatch.fontSize;
  }
}

/** Deserialize a single item without Paper's "import into the active item" behaviour. */
export function importItem(json: unknown): paper.Item {
  const holder = new paper.Group({ insert: false });
  const r = holder.importJSON(json as string) as paper.Item;
  if (r === holder) return holder;
  r.remove();
  return r;
}
