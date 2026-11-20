import paper from 'paper';
import { Tool, ToolEvent } from './base';
import type { Editor } from '../editor';

let active: { text: paper.PointText; isNew: boolean; finish: (keep?: boolean) => void } | null = null;

export function isEditingText() {
  return !!active;
}

export function finishTextEditing() {
  active?.finish();
}

/** Opens an in-place textarea over a PointText item. */
export function editText(ed: Editor, text: paper.PointText, isNew = false) {
  finishTextEditing();
  const ta = document.getElementById('text-editor') as HTMLTextAreaElement;
  const place = () => {
    const z = ed.zoom;
    const scale = Math.sqrt(Math.abs(text.matrix.a * text.matrix.d - text.matrix.b * text.matrix.c)) || 1;
    const fontSize = Number(text.fontSize) * z * scale;
    const leading = Number(text.leading) * z * scale;
    const origin = ed.view.projectToView(text.matrix.transform(new paper.Point(0, 0)));
    ta.style.left = `${origin.x - 2}px`;
    ta.style.top = `${origin.y - fontSize * 0.92 - 2}px`;
    ta.style.fontSize = `${fontSize}px`;
    ta.style.lineHeight = `${leading}px`;
    ta.style.fontFamily = String(text.fontFamily);
    ta.style.fontWeight = String(text.fontWeight);
    ta.style.color = text.fillColor ? text.fillColor.toCSS(true) : '#000';
    ta.style.textAlign = String(text.justification);
    const lines = ta.value.split('\n');
    ta.rows = Math.max(1, lines.length);
    ta.style.width = '10px';
    ta.style.height = 'auto';
    ta.style.width = `${Math.max(40, ta.scrollWidth + fontSize)}px`;
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.value = text.content;
  ta.hidden = false;
  text.visible = false;
  ed.setSelection([text]);
  place();
  const focus = () => {
    ta.focus();
    if (isNew) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  };
  focus();
  requestAnimationFrame(() => {
    if (document.activeElement !== ta && active?.text === text) focus();
  });

  const onInput = () => {
    text.content = ta.value;
    place();
  };
  const onKey = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) {
      ev.preventDefault();
      finish();
      ed.setTool('select');
      if (text.parent) ed.setSelection([text]);
    }
  };
  const onBlur = () => finish();
  const unView = ed.on('view', place);

  function finish(keep = true) {
    if (!active || active.text !== text) return;
    active = null;
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('keydown', onKey);
    ta.removeEventListener('blur', onBlur);
    unView();
    ta.hidden = true;
    text.visible = true;
    if (!keep || !ta.value.trim()) {
      text.remove();
      ed.clearSelection();
      if (!isNew) ed.commit();
    } else {
      text.content = ta.value;
      ed.commit();
      ed.setSelection([text]);
    }
  }
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('blur', onBlur);
  active = { text, isNew, finish };
}

/** Type tool (T): click to place point text, click existing text to edit it. */
export class TextTool extends Tool {
  readonly id = 'text';
  readonly label = 'Type';
  readonly shortcut = 'T';
  cursor = 'text';

  onDown(e: ToolEvent) {
    const hit = this.ed.hitTest(e.point);
    if (hit && hit.item instanceof paper.PointText) {
      editText(this.ed, hit.item);
      return;
    }
    if (isEditingText()) {
      finishTextEditing();
      return;
    }
    this.ed.prepareInsert();
    const s = this.ed.style;
    const t = new paper.PointText({
      point: e.point,
      content: '',
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fillColor: s.fill && s.fill.toLowerCase() !== '#ffffff' ? s.fill : '#000000',
      strokeColor: null,
    });
    editText(this.ed, t, true);
  }

  deactivate() {
    finishTextEditing();
  }
}
