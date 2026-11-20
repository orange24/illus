import './styles.css';
import paper from 'paper';
import { Editor } from './editor';
import { Ops } from './ops';
import { buildCommands } from './commands';
import { setupInput, cursorPos } from './input';
import { SelectTool } from './tools/select';
import { DirectSelectTool, AnchorPointTool } from './tools/direct';
import { PenTool, PencilTool } from './tools/pen';
import { RectangleTool, RoundedRectangleTool, EllipseTool, PolygonTool, StarTool, LineTool } from './tools/shapes';
import { TextTool } from './tools/text';
import { HandTool, ZoomTool, EyedropperTool, RotateTool, ReflectTool } from './tools/misc';
import { buildMenubar } from './ui/menubar';
import { buildToolbar } from './ui/toolbar';
import { buildPanels } from './ui/panels';
import { displayKeys } from './commands';

const HINTS: Record<string, string> = {
  select: 'คลิกเพื่อเลือก · Shift เพิ่ม · Alt+ลาก ทำสำเนา · ลากมุมเพื่อย่อขยาย · ลากนอกมุมเพื่อหมุน',
  direct: 'คลิกจุด anchor หรือ handle เพื่อแก้ไข · ลากกรอบเพื่อเลือกหลายจุด',
  pen: 'คลิก = มุม · คลิกลาก = เส้นโค้ง · คลิกจุดแรกเพื่อปิด · Enter/Esc จบเส้น · บน path ที่เลือก: คลิกเส้น = เพิ่มจุด, คลิกจุด = ลบ',
  anchor: 'คลิกจุดเพื่อเปลี่ยนเป็นมุม · ลากจุดเพื่อดึงเส้นโค้ง · ลาก handle เพื่อหักมุม',
  pencil: 'ลากเพื่อวาดเส้นอิสระ',
  rect: 'ลากเพื่อวาด · Shift = จัตุรัส · Alt = จากกึ่งกลาง · คลิก = 100×100',
  roundrect: 'ลากเพื่อวาด · ลูกศรขึ้น/ลง ปรับความมน',
  ellipse: 'ลากเพื่อวาด · Shift = วงกลม · Alt = จากกึ่งกลาง',
  polygon: 'ลากจากจุดกึ่งกลาง · ลูกศรขึ้น/ลง เพิ่ม/ลดจำนวนด้าน',
  star: 'ลากจากจุดกึ่งกลาง · ลูกศรขึ้น/ลง เพิ่ม/ลดแฉก',
  line: 'ลากเพื่อวาดเส้น · Shift = ล็อก 45°',
  text: 'คลิกเพื่อพิมพ์ · Esc เพื่อจบ',
  eyedropper: 'คลิกวัตถุเพื่อคัดลอกสีไปยังวัตถุที่เลือก',
  hand: 'ลากเพื่อเลื่อนมุมมอง · ดับเบิลคลิก = พอดีหน้าจอ',
  zoom: 'คลิก = ซูมเข้า · Alt+คลิก = ซูมออก · ลากกรอบเพื่อซูมพื้นที่',
  rotate: 'ลากเพื่อหมุนวัตถุที่เลือก · Shift = ทีละ 45°',
  reflect: 'คลิก = พลิกแนวนอน · Alt+คลิก = พลิกแนวตั้ง',
};

function boot() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ed = new Editor(canvas);
  const ops = new Ops(ed);
  (window as any).illus = { ed, ops, paper };

  for (const T of [
    SelectTool,
    DirectSelectTool,
    AnchorPointTool,
    PenTool,
    PencilTool,
    RectangleTool,
    RoundedRectangleTool,
    EllipseTool,
    PolygonTool,
    StarTool,
    LineTool,
    TextTool,
    EyedropperTool,
    HandTool,
    ZoomTool,
    RotateTool,
    ReflectTool,
  ]) {
    ed.registerTool(new T(ed));
  }

  const commands = buildCommands(ed, ops);
  (window as any).illus.run = (id: string) => commands.get(id)?.run();
  buildMenubar(ed, commands);
  ed.setTool('select');
  buildToolbar(ed);
  buildPanels(ed, ops);
  setupInput(ed, ops, commands);
  buildStatusbar(ed);
  buildOptionsBar(ed);

  // Keep the paper view sized to the stage.
  const stage = document.getElementById('stage')!;
  const resize = () => {
    const r = stage.getBoundingClientRect();
    ed.view.viewSize = new paper.Size(Math.max(1, r.width), Math.max(1, r.height));
    ed.emit('view');
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  if (!ed.restoreAutosave()) seedWelcome(ed);
  ed.resetHistory();
  requestAnimationFrame(() => ed.fitArtboard());
}

function buildStatusbar(ed: Editor) {
  const bar = document.getElementById('statusbar')!;
  bar.innerHTML = `
    <div class="zoom-ctl"><button data-z="out">−</button><input class="zoom-val" /><button data-z="in">+</button><button data-z="fit" title="พอดีหน้าจอ (${displayKeys('Mod+0')})">⤢</button></div>
    <span class="tool-name"></span>
    <span class="hint"></span>
    <span class="msg"></span>
    <span class="pos"></span>`;
  const zv = bar.querySelector<HTMLInputElement>('.zoom-val')!;
  bar.querySelector<HTMLButtonElement>('[data-z=out]')!.onclick = () => ed.zoomBy(0.8);
  bar.querySelector<HTMLButtonElement>('[data-z=in]')!.onclick = () => ed.zoomBy(1.25);
  bar.querySelector<HTMLButtonElement>('[data-z=fit]')!.onclick = () => ed.fitArtboard();
  zv.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const v = parseFloat(zv.value);
      if (v > 0) ed.zoomTo(v / 100);
      zv.blur();
    }
  };
  const toolName = bar.querySelector<HTMLElement>('.tool-name')!;
  const hint = bar.querySelector<HTMLElement>('.hint')!;
  const msg = bar.querySelector<HTMLElement>('.msg')!;
  const pos = bar.querySelector<HTMLElement>('.pos')!;
  ed.on('view', () => {
    if (document.activeElement !== zv) zv.value = `${Math.round(ed.zoom * 100)}%`;
  });
  ed.on('tool', () => {
    toolName.textContent = ed.tool.label;
    hint.textContent = HINTS[ed.tool.id] ?? '';
  });
  let msgTimer = 0;
  let lastStatus = '';
  ed.on('status', () => {
    pos.textContent = `X ${cursorPos.x.toFixed(1)}  Y ${cursorPos.y.toFixed(1)}`;
    if (ed.statusText !== lastStatus) {
      lastStatus = ed.statusText;
      msg.textContent = ed.statusText;
      clearTimeout(msgTimer);
      msgTimer = window.setTimeout(() => {
        msg.textContent = '';
        lastStatus = '';
        ed.statusText = '';
      }, 4000);
    }
  });
  ed.on('selection', () => {
    const n = ed.selection.length;
    if (n) ed.setStatus(`เลือก ${n} วัตถุ`);
  });
  toolName.textContent = ed.tool.label;
  hint.textContent = HINTS[ed.tool.id] ?? '';
  zv.value = `${Math.round(ed.zoom * 100)}%`;
}

/** Contextual options for the active tool. */
function buildOptionsBar(ed: Editor) {
  const bar = document.getElementById('optionsbar')!;
  const render = () => {
    const t = ed.tool as any;
    let extra = '';
    if (t.id === 'polygon') extra = `<label>จำนวนด้าน <input type="number" min="3" max="64" value="${t.sides}" data-k="sides"/></label>`;
    if (t.id === 'star') extra = `<label>จำนวนแฉก <input type="number" min="3" max="64" value="${t.points}" data-k="points"/></label>`;
    if (t.id === 'roundrect') extra = `<label>ความมน <input type="number" min="0" value="${t.radius}" data-k="radius"/></label>`;
    const n = ed.selection.length;
    bar.innerHTML = `<span class="opt-tool">${ed.tool.label}</span>${extra}<span class="opt-sel">${n ? `เลือก ${n} วัตถุ` : 'ไม่ได้เลือกวัตถุ'}</span>`;
    bar.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      inp.onkeydown = (e) => e.stopPropagation();
      inp.onchange = () => {
        t[inp.dataset.k!] = Number(inp.value);
      };
    });
  };
  ed.on('tool', render);
  ed.on('selection', render);
  render();
}

/** A small starter composition so the canvas isn't empty on first launch. */
function seedWelcome(ed: Editor) {
  const layer = ed.currentLayer;
  const { width, height } = ed.artboard;
  const sun = new paper.Path.Circle({ center: [width * 0.68, height * 0.36], radius: 90, fillColor: '#ffc53d' });
  const hill1 = new paper.Path({
    segments: [
      [0, height * 0.72],
      [[width * 0.35, height * 0.5], [-160, 0], [160, 0]],
      [width, height * 0.75],
      [width, height],
      [0, height],
    ],
    closed: true,
    fillColor: '#46a758',
  });
  const hill2 = new paper.Path({
    segments: [
      [0, height * 0.85],
      [[width * 0.7, height * 0.62], [-200, 0], [140, 0]],
      [width, height * 0.8],
      [width, height],
      [0, height],
    ],
    closed: true,
    fillColor: '#2f7d43',
  });
  const title = new paper.PointText({
    point: [48, 96],
    content: 'สวัสดี Illus',
    fontFamily: 'Inter, "Noto Sans Thai", sans-serif',
    fontSize: 48,
    fontWeight: 'bold',
    fillColor: '#1c2024',
  });
  const sub = new paper.PointText({
    point: [50, 132],
    content: 'ลองกด P เพื่อใช้ Pen tool หรือ F1 ดูคีย์ลัดทั้งหมด',
    fontFamily: 'Inter, "Noto Sans Thai", sans-serif',
    fontSize: 18,
    fillColor: '#60646c',
  });
  layer.addChildren([sun, hill1, hill2, title, sub]);
}

boot();
