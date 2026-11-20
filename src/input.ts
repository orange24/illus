import paper from 'paper';
import type { Editor } from './editor';
import type { Ops } from './ops';
import type { Command } from './commands';
import type { Tool, ToolEvent } from './tools/base';
import { isEditingText } from './tools/text';
import { resetColors, swapColors } from './ui/toolbar';

const TOOL_KEYS: Record<string, string> = {
  v: 'select',
  a: 'direct',
  p: 'pen',
  n: 'pencil',
  m: 'rect',
  l: 'ellipse',
  '\\': 'line',
  t: 'text',
  i: 'eyedropper',
  h: 'hand',
  z: 'zoom',
  r: 'rotate',
  o: 'reflect',
};

/** Map a keyboard event to the "Mod+Shift+K" form used in command definitions. */
function chord(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  // Use physical key for digits/brackets so Shift/Alt variants still match.
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'BracketLeft') k = '[';
  else if (e.code === 'BracketRight') k = ']';
  else if (e.code === 'Equal' || e.key === '+') k = '=';
  else if (e.code === 'Minus') k = '-';
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (k === 'Backspace') k = 'Delete';
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

export function setupInput(ed: Editor, ops: Ops, commands: Map<string, Command>) {
  const canvas = ed.canvas;
  const keyMap = new Map<string, Command>();
  for (const c of commands.values()) {
    if (!c.keys) continue;
    for (const k of c.keys.split(' / ')) keyMap.set(k.replace(/(\+)([a-z])$/, (_m, p, l) => p + l.toUpperCase()), c);
  }
  keyMap.set('Mod+Shift+=', commands.get('view.zoomIn')!);
  keyMap.set('Mod+Y', commands.get('edit.redo')!);

  let spaceDown = false;
  let dragTool: Tool | null = null;
  let down: { point: paper.Point; viewPoint: paper.Point } | null = null;
  let last: { point: paper.Point; viewPoint: paper.Point } | null = null;

  const makeEvent = (e: MouseEvent): ToolEvent => {
    const rect = canvas.getBoundingClientRect();
    const viewPoint = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
    const point = ed.view.viewToProject(viewPoint);
    const lp = last ?? { point, viewPoint };
    return {
      point,
      viewPoint,
      downPoint: down?.point ?? point,
      lastPoint: lp.point,
      delta: point.subtract(lp.point),
      viewDelta: viewPoint.subtract(lp.viewPoint),
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      button: e.button,
      native: e,
    };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (dragTool) return;
    if (isEditingText()) (document.activeElement as HTMLElement)?.blur();
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const base = makeEvent(e);
    down = { point: base.point, viewPoint: base.viewPoint };
    last = { ...down };
    const ev = makeEvent(e);
    const isSelectTool = ed.tool.id === 'select' || ed.tool.id === 'direct';
    if (spaceDown || e.button === 1) dragTool = ed.tools.get('hand')!;
    else if (ev.mod && !isSelectTool && ed.tool.id !== 'zoom') dragTool = ed.tools.get(ed.previousSelectTool)!;
    else dragTool = ed.tool;
    if (e.button === 2) {
      dragTool = null;
      return;
    }
    if (dragTool.id === 'hand') canvas.style.cursor = 'grabbing';
    dragTool.onDown(ev);
  });

  canvas.addEventListener('pointermove', (e) => {
    const ev = makeEvent(e);
    if (dragTool && down) {
      dragTool.onDrag(ev);
    } else if (!spaceDown) {
      ed.tool.onMove(ev);
    }
    last = { point: ev.point, viewPoint: ev.viewPoint };
    cursorPos.x = ev.point.x;
    cursorPos.y = ev.point.y;
    ed.emit('status');
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragTool || !down) return;
    const ev = makeEvent(e);
    const t = dragTool;
    dragTool = null;
    t.onUp(ev);
    down = null;
    if (t !== ed.tool) {
      // Restore cursor after a temporary tool.
      canvas.style.cursor = spaceDown ? 'grab' : ed.tool.cursor;
      ed.drawSelection();
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => ed.tool.onDblClick(makeEvent(e)));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const vp = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025));
        ed.zoomBy(factor, ed.view.viewToProject(vp));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        ed.panBy(-dx, -dy);
      }
    },
    { passive: false },
  );

  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
  };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || isEditingText()) return;
    if (document.querySelector('.modal-backdrop')) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.code === 'Space' && !mod) {
      e.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        if (!dragTool) canvas.style.cursor = 'grab';
      }
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      commands.get('help.shortcuts')!.run();
      return;
    }

    // Tool gets first chance (Enter/Escape for pen, arrows for nudging, etc.).
    if (!mod && ed.tool.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (dragTool && dragTool !== ed.tool && dragTool.onKeyDown(e)) {
      e.preventDefault();
      return;
    }

    // Copy / cut / paste go through the native clipboard events below.
    if (mod && !e.altKey && ['KeyC', 'KeyX', 'KeyV'].includes(e.code) && !e.shiftKey) return;

    const c = keyMap.get(chord(e));
    if (c) {
      e.preventDefault();
      if (!c.enabled || c.enabled()) c.run();
      return;
    }
    if (mod || e.altKey) return;

    const key = e.key.toLowerCase();
    if (e.shiftKey && key === 'c') {
      ed.setTool('anchor');
      return;
    }
    if (e.shiftKey && key === 'x') {
      swapColors(ed);
      return;
    }
    if (!e.shiftKey && TOOL_KEYS[key]) {
      e.preventDefault();
      ed.setTool(TOOL_KEYS[key]);
      return;
    }
    if (key === 'x') {
      ed.activeColor = ed.activeColor === 'fill' ? 'stroke' : 'fill';
      ed.emit('style');
      return;
    }
    if (key === 'd') {
      resetColors(ed);
      return;
    }
    if (key === '/') {
      ed.applyStyle({ [ed.activeColor]: null });
      return;
    }
    if (e.key === 'Escape') {
      ed.clearSelection();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      if (!dragTool) canvas.style.cursor = ed.tool.cursor;
    }
  });
  window.addEventListener('blur', () => {
    spaceDown = false;
  });

  // Native clipboard integration (also lets you paste SVG markup copied from other apps).
  document.addEventListener('copy', (e) => {
    if (isTyping(e.target) || isEditingText() || !ed.selection.length) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', ops.copy());
    ed.setStatus('คัดลอกแล้ว');
  });
  document.addEventListener('cut', (e) => {
    if (isTyping(e.target) || isEditingText() || !ed.selection.length) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', ops.cut());
  });
  document.addEventListener('paste', async (e) => {
    if (isTyping(e.target) || isEditingText()) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const file = Array.from(e.clipboardData?.files ?? [])[0];
    if (text && text === ops.lastCopiedSvg && ops.hasClipboard()) {
      ops.paste("offset");
    } else if (/<svg[\s>]/i.test(text)) {
      const { importSVGText } = await import('./io/files');
      importSVGText(ed, text, 'pasted.svg', 'import');
    } else if (file) {
      const { openFile } = await import('./commands');
      await openFile(ed, file, 'import');
    } else if (ops.hasClipboard()) {
      ops.paste('offset');
    }
  });

  // Drag & drop files onto the canvas.
  const stage = document.getElementById('stage')!;
  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('dropping');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    stage.classList.remove('dropping');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const { openFile } = await import('./commands');
    const empty = ed.allTopItems().length === 0;
    await openFile(ed, f, empty && /\.(ai|pdf|svg|eps)$/i.test(f.name) ? 'open' : 'import');
  });
}

export const cursorPos = { x: 0, y: 0 };
