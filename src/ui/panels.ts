import paper from 'paper';
import type { Editor } from '../editor';
import type { Ops } from '../ops';
import { icon } from './icons';

const SWATCHES = [
  '#000000', '#3c3c3c', '#7a7a7a', '#bdbdbd', '#ffffff',
  '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594',
  '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#a18072',
  '#ffdcdc', '#ffe8d1', '#fff3c4', '#d6f1df', '#d5efff',
];

const FONTS = [
  'Inter, "Noto Sans Thai", sans-serif',
  'Arial, sans-serif',
  'Helvetica, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  '"Courier New", monospace',
  'Tahoma, sans-serif',
  'Verdana, sans-serif',
  '"Noto Sans Thai", sans-serif',
  'Sarabun, sans-serif',
];

function section(title: string, cls = '') {
  const s = document.createElement('section');
  s.className = `panel ${cls}`;
  s.innerHTML = `<header><span class="chev">${icon('chevron')}</span>${title}</header><div class="panel-body"></div>`;
  s.querySelector('header')!.addEventListener('click', () => s.classList.toggle('collapsed'));
  return { el: s, body: s.querySelector<HTMLElement>('.panel-body')! };
}

function numField(label: string, onCommit: (v: number) => void, opts: { step?: number; min?: number; suffix?: string } = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'num';
  wrap.innerHTML = `<span>${label}</span><input type="number" step="${opts.step ?? 1}" ${opts.min !== undefined ? `min="${opts.min}"` : ''}/>${opts.suffix ? `<em>${opts.suffix}</em>` : ''}`;
  const input = wrap.querySelector('input')!;
  const commit = () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onCommit(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commit();
      input.blur();
    }
  });
  return { wrap, input };
}

function iconButtons(defs: [string, string, () => void][]) {
  const row = document.createElement('div');
  row.className = 'icon-row';
  for (const [ic, title, fn] of defs) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.title = title;
    b.innerHTML = icon(ic);
    b.onclick = fn;
    row.appendChild(b);
  }
  return row;
}

export function buildPanels(ed: Editor, ops: Ops) {
  const host = document.getElementById('panels')!;
  host.innerHTML = '';

  // ---------- Properties: transform ----------
  const tr = section('Transform');
  const grid = document.createElement('div');
  grid.className = 'grid2';
  const applyBounds = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    const b = ed.selectionBounds();
    if (!b) return;
    if (patch.x !== undefined || patch.y !== undefined) {
      const d = new paper.Point((patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y);
      ed.selection.forEach((i) => i.translate(d));
    }
    if (patch.w !== undefined || patch.h !== undefined) {
      const sx = patch.w !== undefined && b.width > 0 ? Math.max(0.01, patch.w) / b.width : 1;
      const sy = patch.h !== undefined && b.height > 0 ? Math.max(0.01, patch.h) / b.height : 1;
      const lock = lockBtn.classList.contains('on');
      const fx = lock ? (patch.w !== undefined ? sx : sy) : sx;
      const fy = lock ? (patch.h !== undefined ? sy : sx) : sy;
      ed.selection.forEach((i) => i.scale(fx, fy, b.topLeft));
    }
    ed.drawSelection();
    ed.commit();
    ed.emit('selection');
  };
  const fx = numField('X', (v) => applyBounds({ x: v }), { step: 1 });
  const fy = numField('Y', (v) => applyBounds({ y: v }), { step: 1 });
  const fw = numField('W', (v) => applyBounds({ w: v }), { step: 1, min: 0 });
  const fh = numField('H', (v) => applyBounds({ h: v }), { step: 1, min: 0 });
  const rot = numField('↻', (v) => {
    const b = ed.selectionBounds();
    if (!b || !v) return;
    ed.selection.forEach((i) => i.rotate(v, b.center));
    rot.input.value = '';
    ed.drawSelection();
    ed.commit();
  }, { step: 15, suffix: '°' });
  rot.input.placeholder = 'หมุน';
  const lockBtn = document.createElement('button');
  lockBtn.className = 'icon-btn small lock-ratio';
  lockBtn.title = 'คงสัดส่วน W/H';
  lockBtn.innerHTML = '⛓';
  lockBtn.onclick = () => lockBtn.classList.toggle('on');
  grid.append(fx.wrap, fy.wrap, fw.wrap, fh.wrap, rot.wrap, lockBtn);
  tr.body.append(grid);
  tr.body.append(
    iconButtons([
      ['flipH', 'พลิกแนวนอน', () => ops.flip('h')],
      ['flipV', 'พลิกแนวตั้ง', () => ops.flip('v')],
      ['group', 'จัดกลุ่ม (Ctrl+G)', () => ops.group()],
    ]),
  );

  // ---------- Document (no selection) ----------
  const docSec = section('เอกสาร (Artboard)');
  const docGrid = document.createElement('div');
  docGrid.className = 'grid2';
  const dw = numField('W', (v) => ed.setArtboardSize(v, ed.artboard.height), { min: 1 });
  const dh = numField('H', (v) => ed.setArtboardSize(ed.artboard.width, v), { min: 1 });
  docGrid.append(dw.wrap, dh.wrap);
  const fitBtn = document.createElement('button');
  fitBtn.className = 'text-btn';
  fitBtn.textContent = 'ปรับ artboard ให้พอดีกับ artwork';
  fitBtn.onclick = () => {
    const items = ed.allTopItems();
    if (!items.length) return;
    let b = items[0].bounds.clone();
    items.forEach((i) => (b = b.unite(i.bounds)));
    items.forEach((i) => i.translate(b.topLeft.multiply(-1)));
    ed.setArtboardSize(Math.ceil(b.width), Math.ceil(b.height));
    ed.fitArtboard();
  };
  docSec.body.append(docGrid, fitBtn);

  // ---------- Appearance ----------
  const ap = section('Appearance');
  ap.body.innerHTML = `
    <div class="color-row" data-k="fill"><span class="lbl">Fill</span><button class="chip"><i></i></button><input type="color"/><input class="hex" spellcheck="false"/><button class="icon-btn small none-btn" title="ไม่มีสี">${icon('none')}</button></div>
    <div class="color-row" data-k="stroke"><span class="lbl">Stroke</span><button class="chip"><i></i></button><input type="color"/><input class="hex" spellcheck="false"/><button class="icon-btn small none-btn" title="ไม่มีสี">${icon('none')}</button></div>
  `;
  const rows: Record<'fill' | 'stroke', { chip: HTMLElement; color: HTMLInputElement; hex: HTMLInputElement; row: HTMLElement }> = {} as any;
  for (const k of ['fill', 'stroke'] as const) {
    const row = ap.body.querySelector<HTMLElement>(`.color-row[data-k=${k}]`)!;
    const chip = row.querySelector<HTMLElement>('.chip')!;
    const color = row.querySelector<HTMLInputElement>('input[type=color]')!;
    const hex = row.querySelector<HTMLInputElement>('.hex')!;
    rows[k] = { chip, color, hex, row };
    chip.onclick = () => {
      ed.activeColor = k;
      color.value = ed.style[k] ?? '#000000';
      color.click();
      ed.emit('style');
    };
    color.oninput = () => ed.applyStyle({ [k]: color.value }, false);
    color.onchange = () => ed.applyStyle({ [k]: color.value }, true);
    hex.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') hex.blur();
    };
    hex.onchange = () => {
      let v = hex.value.trim();
      if (!v || v.toLowerCase() === 'none') return ed.applyStyle({ [k]: null });
      if (!v.startsWith('#')) v = `#${v}`;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) ed.applyStyle({ [k]: v });
    };
    row.querySelector<HTMLButtonElement>('.none-btn')!.onclick = () => ed.applyStyle({ [k]: null });
  }
  const sw = numField('เส้น', (v) => ed.applyStyle({ strokeWidth: Math.max(0, v) }), { step: 0.5, min: 0, suffix: 'pt' });
  const op = document.createElement('label');
  op.className = 'range';
  op.innerHTML = `<span>Opacity</span><input type="range" min="0" max="100"/><output></output>`;
  const opInput = op.querySelector('input')!;
  const opOut = op.querySelector('output')!;
  opInput.oninput = () => {
    opOut.textContent = `${opInput.value}%`;
    ed.applyStyle({ opacity: Number(opInput.value) / 100 }, false);
  };
  opInput.onchange = () => ed.applyStyle({ opacity: Number(opInput.value) / 100 }, true);
  const strokeOpts = document.createElement('div');
  strokeOpts.className = 'stroke-opts';
  strokeOpts.innerHTML = `
    <select class="cap" title="ปลายเส้น"><option value="butt">ปลายตัด</option><option value="round">ปลายมน</option><option value="square">ปลายเหลี่ยม</option></select>
    <select class="join" title="มุมเส้น"><option value="miter">มุมแหลม</option><option value="round">มุมมน</option><option value="bevel">มุมตัด</option></select>
    <label class="check"><input type="checkbox" class="dash"/> เส้นประ</label>`;
  const capSel = strokeOpts.querySelector<HTMLSelectElement>('.cap')!;
  const joinSel = strokeOpts.querySelector<HTMLSelectElement>('.join')!;
  const dashChk = strokeOpts.querySelector<HTMLInputElement>('.dash')!;
  const forLeaves = (fn: (i: paper.Item) => void) => {
    const walk = (i: paper.Item) => {
      if (i instanceof paper.Group) i.children.forEach(walk);
      else fn(i);
    };
    ed.selection.forEach(walk);
    ed.commit();
  };
  capSel.onchange = () => forLeaves((i) => (i.strokeCap = capSel.value));
  joinSel.onchange = () => forLeaves((i) => (i.strokeJoin = joinSel.value));
  dashChk.onchange = () => forLeaves((i) => (i.dashArray = dashChk.checked ? [i.strokeWidth * 4 || 4, i.strokeWidth * 2 || 2] : []));
  const swatchGrid = document.createElement('div');
  swatchGrid.className = 'swatches';
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.onclick = () => ed.applyStyle({ [ed.activeColor]: c });
    swatchGrid.appendChild(b);
  }
  const noneSw = document.createElement('button');
  noneSw.className = 'none';
  noneSw.title = 'ไม่มีสี';
  noneSw.onclick = () => ed.applyStyle({ [ed.activeColor]: null });
  swatchGrid.prepend(noneSw);
  ap.body.append(sw.wrap, strokeOpts, op, swatchGrid);

  // ---------- Character ----------
  const ch = section('Character');
  ch.body.innerHTML = `
    <select class="font">${FONTS.map((f) => `<option value='${f}'>${f.split(',')[0].replace(/"/g, '')}</option>`).join('')}</select>
    <div class="grid2"></div>
    <div class="icon-row just">
      <button class="icon-btn" data-j="left" title="ชิดซ้าย">⟸</button>
      <button class="icon-btn" data-j="center" title="กึ่งกลาง">≡</button>
      <button class="icon-btn" data-j="right" title="ชิดขวา">⟹</button>
      <button class="icon-btn" data-w="bold" title="ตัวหนา"><b>B</b></button>
      <button class="icon-btn" data-w="italic" title="ตัวเอียง"><i>I</i></button>
    </div>`;
  const fontSel = ch.body.querySelector<HTMLSelectElement>('.font')!;
  fontSel.onchange = () => ed.applyStyle({ fontFamily: fontSel.value });
  const fs = numField('ขนาด', (v) => ed.applyStyle({ fontSize: Math.max(1, v) }), { min: 1, suffix: 'pt' });
  const lead = numField('↕', (v) => {
    texts().forEach((t) => (t.leading = Math.max(1, v)));
    ed.commit();
  }, { min: 1 });
  ch.body.querySelector('.grid2')!.append(fs.wrap, lead.wrap);
  const texts = () => ed.selection.filter((i): i is paper.PointText => i instanceof paper.PointText);
  ch.body.querySelectorAll<HTMLButtonElement>('[data-j]').forEach((b) => {
    b.onclick = () => {
      texts().forEach((t) => {
        const before = t.bounds.clone();
        t.justification = b.dataset.j!;
        // keep the visual position stable
        t.translate(before.topLeft.subtract(t.bounds.topLeft));
      });
      ed.drawSelection();
      ed.commit();
    };
  });
  ch.body.querySelector<HTMLButtonElement>('[data-w=bold]')!.onclick = () => {
    texts().forEach((t) => (t.fontWeight = String(t.fontWeight).includes('bold') ? 'normal' : 'bold'));
    ed.drawSelection();
    ed.commit();
  };
  ch.body.querySelector<HTMLButtonElement>('[data-w=italic]')!.onclick = () => {
    texts().forEach((t) => {
      const w = String(t.fontWeight);
      t.fontWeight = w.includes('italic') ? w.replace('italic', '').trim() || 'normal' : `italic ${w === 'normal' ? '' : w}`.trim();
    });
    ed.drawSelection();
    ed.commit();
  };

  // ---------- Align ----------
  const al = section('Align');
  al.body.append(
    iconButtons([
      ['alignLeft', 'ชิดซ้าย', () => ops.align('left')],
      ['alignHCenter', 'กึ่งกลางแนวนอน', () => ops.align('hcenter')],
      ['alignRight', 'ชิดขวา', () => ops.align('right')],
      ['alignTop', 'ชิดบน', () => ops.align('top')],
      ['alignVCenter', 'กึ่งกลางแนวตั้ง', () => ops.align('vcenter')],
      ['alignBottom', 'ชิดล่าง', () => ops.align('bottom')],
      ['distH', 'กระจายแนวนอน', () => ops.distribute('h')],
      ['distV', 'กระจายแนวตั้ง', () => ops.distribute('v')],
    ]),
  );
  const alNote = document.createElement('p');
  alNote.className = 'note';
  alNote.textContent = 'เลือกชิ้นเดียว = จัดเทียบ artboard';
  al.body.append(alNote);

  // ---------- Pathfinder ----------
  const pf = section('Pathfinder');
  pf.body.append(
    iconButtons([
      ['unite', 'Unite — รวมรูปทรง', () => ops.pathfinder('unite')],
      ['minusFront', 'Minus Front — ลบด้วยรูปด้านหน้า', () => ops.pathfinder('minusFront')],
      ['minusBack', 'Minus Back — ลบด้วยรูปด้านหลัง', () => ops.pathfinder('minusBack')],
      ['intersect', 'Intersect — เก็บส่วนที่ซ้อนกัน', () => ops.pathfinder('intersect')],
      ['exclude', 'Exclude — ตัดส่วนที่ซ้อนกันออก', () => ops.pathfinder('exclude')],
      ['divide', 'Divide — แบ่งเป็นชิ้นตามรอยตัด', () => ops.pathfinder('divide')],
    ]),
  );

  // ---------- Layers ----------
  const ly = section('Layers', 'layers');
  const layerList = document.createElement('div');
  layerList.className = 'layer-list';
  const layerActions = iconButtons([
    ['plus', 'เพิ่มเลเยอร์', () => {
      ed.newLayer();
      ed.commit();
    }],
    ['trash', 'ลบเลเยอร์ปัจจุบัน', () => ed.deleteLayer(ed.currentLayer)],
  ]);
  layerActions.classList.add('layer-actions');
  ly.body.append(layerList, layerActions);

  host.append(tr.el, docSec.el, ap.el, ch.el, al.el, pf.el, ly.el);

  // ---------- sync ----------
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const syncProps = () => {
    const b = ed.selectionBounds();
    const has = !!b && ed.selection.length > 0;
    tr.el.style.display = has ? '' : 'none';
    docSec.el.style.display = has ? 'none' : '';
    if (has && b) {
      if (document.activeElement !== fx.input) fx.input.value = fmt(b.x);
      if (document.activeElement !== fy.input) fy.input.value = fmt(b.y);
      if (document.activeElement !== fw.input) fw.input.value = fmt(b.width);
      if (document.activeElement !== fh.input) fh.input.value = fmt(b.height);
    }
    dw.input.value = String(ed.artboard.width);
    dh.input.value = String(ed.artboard.height);
    const t = texts();
    ch.el.style.display = t.length || ed.tool?.id === 'text' ? '' : 'none';
    if (t[0]) {
      lead.input.value = fmt(Number(t[0].leading));
    }
  };
  const syncStyle = () => {
    for (const k of ['fill', 'stroke'] as const) {
      const c = ed.style[k];
      const r = rows[k];
      r.chip.classList.toggle('is-none', !c);
      (r.chip.firstElementChild as HTMLElement).style.background = c ?? 'transparent';
      if (document.activeElement !== r.hex) r.hex.value = c ? c.toUpperCase() : 'None';
      r.row.classList.toggle('active', ed.activeColor === k);
    }
    if (document.activeElement !== sw.input) sw.input.value = fmt(ed.style.strokeWidth);
    opInput.value = String(Math.round(ed.style.opacity * 100));
    opOut.textContent = `${opInput.value}%`;
    fontSel.value = FONTS.includes(ed.style.fontFamily) ? ed.style.fontFamily : fontSel.value;
    if (document.activeElement !== fs.input) fs.input.value = fmt(ed.style.fontSize);
    const leaf = ed.selection[0];
    if (leaf && !(leaf instanceof paper.Group)) {
      capSel.value = String(leaf.strokeCap ?? 'butt');
      joinSel.value = String(leaf.strokeJoin ?? 'miter');
      dashChk.checked = !!leaf.dashArray?.length;
    }
  };

  let dragLayer: paper.Layer | null = null;
  const syncLayers = () => {
    layerList.innerHTML = '';
    const layers = ed.userLayers().slice().reverse();
    const current = ed.currentLayer;
    const selectedTops = new Set(ed.selection.map((i) => ed.topLevel(i)));
    for (const layer of layers) {
      const row = document.createElement('div');
      row.className = 'layer-row';
      if (layer === current) row.classList.add('current');
      row.draggable = true;
      row.innerHTML = `
        <button class="lv" title="แสดง/ซ่อน">${icon(layer.visible ? 'eye' : 'eyeOff')}</button>
        <button class="ll" title="ล็อก/ปลดล็อก">${icon(layer.locked ? 'lock' : 'unlock')}</button>
        <span class="lname"></span>
        <span class="lcount">${layer.children.length}</span>`;
      row.querySelector('.lname')!.textContent = layer.name || 'Layer';
      row.querySelector<HTMLButtonElement>('.lv')!.onclick = (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        ed.clearSelection();
        ed.commit();
      };
      row.querySelector<HTMLButtonElement>('.ll')!.onclick = (e) => {
        e.stopPropagation();
        layer.locked = !layer.locked;
        ed.clearSelection();
        ed.commit();
      };
      row.onclick = () => ed.setCurrentLayer(layer);
      row.ondblclick = () => {
        const nameEl = row.querySelector<HTMLElement>('.lname')!;
        const input = document.createElement('input');
        input.value = layer.name;
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const done = () => {
          layer.name = input.value.trim() || layer.name;
          ed.commit();
        };
        input.onblur = done;
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') {
            input.value = layer.name;
            input.blur();
          }
        };
      };
      row.ondragstart = () => (dragLayer = layer);
      row.ondragover = (e) => {
        e.preventDefault();
        row.classList.add('drop');
      };
      row.ondragleave = () => row.classList.remove('drop');
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove('drop');
        if (dragLayer && dragLayer !== layer) {
          dragLayer.insertAbove(layer);
          ed.commit();
        }
        dragLayer = null;
      };
      layerList.appendChild(row);
      // Object rows (top-level items, topmost first)
      const kids = layer.children.slice().reverse();
      const MAX = 60;
      for (const item of kids.slice(0, MAX)) {
        const ir = document.createElement('div');
        ir.className = 'item-row';
        if (selectedTops.has(item)) ir.classList.add('selected');
        if (!item.visible) ir.classList.add('hidden-item');
        ir.innerHTML = `<button class="lv" title="แสดง/ซ่อน">${icon(item.visible ? 'eye' : 'eyeOff')}</button><button class="ll" title="ล็อก">${icon(item.locked ? 'lock' : 'unlock')}</button><span class="iname"></span>`;
        ir.querySelector('.iname')!.textContent = itemLabel(item);
        ir.querySelector<HTMLButtonElement>('.lv')!.onclick = (e) => {
          e.stopPropagation();
          item.visible = !item.visible;
          ed.setSelection(ed.selection.filter((s) => s !== item));
          ed.commit();
        };
        ir.querySelector<HTMLButtonElement>('.ll')!.onclick = (e) => {
          e.stopPropagation();
          item.locked = !item.locked;
          ed.setSelection(ed.selection.filter((s) => s !== item));
          ed.commit();
        };
        ir.onclick = (e) => {
          if (!ed.isEditable(item)) return;
          layer.activate();
          if (ed.tool.id !== 'select') ed.setTool('select');
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            const sel = ed.selection.includes(item) ? ed.selection.filter((s) => s !== item) : [...ed.selection, item];
            ed.setSelection(sel);
          } else ed.setSelection([item]);
        };
        layerList.appendChild(ir);
      }
      if (kids.length > MAX) {
        const more = document.createElement('div');
        more.className = 'item-row more';
        more.textContent = `… อีก ${kids.length - MAX} วัตถุ`;
        layerList.appendChild(more);
      }
    }
  };

  let raf = 0;
  const scheduleLayers = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(syncLayers);
  };
  ed.on('selection', () => {
    syncProps();
    scheduleLayers();
  });
  ed.on('change', () => {
    syncProps();
    scheduleLayers();
  });
  ed.on('tool', syncProps);
  ed.on('style', syncStyle);
  syncProps();
  syncStyle();
  syncLayers();
}

export function itemLabel(item: paper.Item): string {
  if (item.name) return item.name;
  if (item instanceof paper.PointText) return `"${item.content.slice(0, 24)}"`;
  if (item instanceof paper.CompoundPath) return '<Compound Path>';
  if (item instanceof paper.Path) return item.closed ? '<Path>' : '<Open Path>';
  if (item instanceof paper.Group) return item.clipped ? '<Clip Group>' : `<Group> (${item.children.length})`;
  if (item instanceof paper.Raster) return '<Image>';
  if (item instanceof paper.Shape) return '<Shape>';
  return `<${item.className}>`;
}
