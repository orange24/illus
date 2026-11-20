import type { Editor } from '../editor';
import { icon } from './icons';
import { displayKeys } from '../commands';

/** Tool groups: the first id is shown; others are available from a flyout on long-press / right-click. */
const GROUPS: string[][] = [
  ['select'],
  ['direct'],
  ['pen', 'anchor'],
  ['pencil'],
  ['text'],
  ['line'],
  ['rect', 'roundrect', 'ellipse', 'polygon', 'star'],
  ['rotate', 'reflect'],
  ['eyedropper'],
  ['hand'],
  ['zoom'],
];

export function buildToolbar(ed: Editor) {
  const bar = document.getElementById('toolbar')!;
  bar.innerHTML = '';
  const shown = new Map<number, string>();
  const buttons: HTMLButtonElement[] = [];
  let flyout: HTMLElement | null = null;

  const closeFlyout = () => {
    flyout?.remove();
    flyout = null;
  };

  GROUPS.forEach((group, gi) => {
    shown.set(gi, group[0]);
    const btn = document.createElement('button');
    btn.className = 'tool';
    if (group.length > 1) btn.classList.add('has-more');
    const render = () => {
      const id = shown.get(gi)!;
      const t = ed.tools.get(id)!;
      btn.dataset.tool = id;
      btn.innerHTML = icon(id);
      btn.title = `${t.label}${t.shortcut ? ` (${displayKeys(t.shortcut)})` : ''}${group.length > 1 ? ' — คลิกขวาเพื่อดูเครื่องมืออื่น' : ''}`;
    };
    render();
    (btn as any)._render = render;
    (btn as any)._group = gi;
    btn.onclick = () => ed.setTool(shown.get(gi)!);
    const openFlyout = (e: Event) => {
      e.preventDefault();
      if (group.length < 2) return;
      closeFlyout();
      flyout = document.createElement('div');
      flyout.className = 'flyout';
      for (const id of group) {
        const t = ed.tools.get(id)!;
        const b = document.createElement('button');
        b.innerHTML = `${icon(id)}<span>${t.label}</span><kbd>${displayKeys(t.shortcut)}</kbd>`;
        b.onclick = () => {
          shown.set(gi, id);
          render();
          ed.setTool(id);
          closeFlyout();
        };
        flyout.appendChild(b);
      }
      const r = btn.getBoundingClientRect();
      flyout.style.left = `${r.right + 4}px`;
      flyout.style.top = `${r.top}px`;
      document.body.appendChild(flyout);
    };
    btn.oncontextmenu = openFlyout;
    let pressTimer = 0;
    btn.onpointerdown = (e) => {
      pressTimer = window.setTimeout(() => openFlyout(e), 450);
    };
    btn.onpointerup = btn.onpointerleave = () => clearTimeout(pressTimer);
    bar.appendChild(btn);
    buttons.push(btn);
  });
  document.addEventListener('mousedown', (e) => {
    if (flyout && !flyout.contains(e.target as Node)) closeFlyout();
  });

  // Fill / stroke widget
  const colors = document.createElement('div');
  colors.className = 'fillstroke';
  colors.innerHTML = `
    <div class="swatch-stack">
      <button class="sw stroke" title="Stroke (X เพื่อสลับ)"><span></span></button>
      <button class="sw fill" title="Fill (X เพื่อสลับ)"><span></span></button>
    </div>
    <div class="fs-mini">
      <button class="mini reset" title="สีเริ่มต้น (D)">${icon('reset')}</button>
      <button class="mini swap" title="สลับ Fill/Stroke (Shift+X)">${icon('swap')}</button>
      <button class="mini none" title="ไม่มีสี (/)">${icon('none')}</button>
    </div>
    <input type="color" class="hidden-color" tabindex="-1" />
  `;
  bar.appendChild(colors);
  const fillBtn = colors.querySelector<HTMLButtonElement>('.sw.fill')!;
  const strokeBtn = colors.querySelector<HTMLButtonElement>('.sw.stroke')!;
  const picker = colors.querySelector<HTMLInputElement>('.hidden-color')!;
  let pickerTarget: 'fill' | 'stroke' = 'fill';

  const paint = (el: HTMLElement, c: string | null) => {
    el.classList.toggle('is-none', !c);
    (el.firstElementChild as HTMLElement).style.background = c ?? 'transparent';
  };
  const sync = () => {
    paint(fillBtn, ed.style.fill);
    paint(strokeBtn, ed.style.stroke);
    fillBtn.classList.toggle('active', ed.activeColor === 'fill');
    strokeBtn.classList.toggle('active', ed.activeColor === 'stroke');
  };
  const choose = (which: 'fill' | 'stroke') => {
    if (ed.activeColor !== which) {
      ed.activeColor = which;
      sync();
      ed.emit('style');
      return;
    }
    pickerTarget = which;
    picker.value = ed.style[which] ?? '#000000';
    picker.click();
  };
  fillBtn.onclick = () => choose('fill');
  strokeBtn.onclick = () => choose('stroke');
  picker.oninput = () => ed.applyStyle({ [pickerTarget]: picker.value }, false);
  picker.onchange = () => ed.applyStyle({ [pickerTarget]: picker.value }, true);
  colors.querySelector<HTMLButtonElement>('.reset')!.onclick = () => resetColors(ed);
  colors.querySelector<HTMLButtonElement>('.swap')!.onclick = () => swapColors(ed);
  colors.querySelector<HTMLButtonElement>('.none')!.onclick = () => ed.applyStyle({ [ed.activeColor]: null });

  const syncTools = () => {
    for (const b of buttons) {
      const gi = (b as any)._group as number;
      if (GROUPS[gi].includes(ed.tool.id) && shown.get(gi) !== ed.tool.id) {
        shown.set(gi, ed.tool.id);
        (b as any)._render();
      }
      b.classList.toggle('active', b.dataset.tool === ed.tool.id);
    }
  };
  ed.on('tool', syncTools);
  ed.on('style', sync);
  syncTools();
  sync();
}

export function resetColors(ed: Editor) {
  ed.applyStyle({ fill: '#ffffff', stroke: '#000000', strokeWidth: ed.selection.length ? 1 : ed.style.strokeWidth });
}

export function swapColors(ed: Editor) {
  ed.applyStyle({ fill: ed.style.stroke, stroke: ed.style.fill });
}
