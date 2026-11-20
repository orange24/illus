import type { Editor } from '../editor';
import { exportAI, exportPDF, exportPNG, exportSVG } from '../io/export';

export function toast(message: string, kind: 'info' | 'error' = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), kind === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), kind === 'error' ? 6500 : 3500);
}

function modal(title: string, body: HTMLElement, actions: { label: string; primary?: boolean; run?: () => boolean | void | Promise<boolean | void> }[]) {
  const root = document.getElementById('modal-root')!;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<div class="modal-title">${title}</div>`;
  box.appendChild(body);
  const bar = document.createElement('div');
  bar.className = 'modal-actions';
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.onclick = async () => {
      const keepOpen = a.run ? await a.run() : false;
      if (keepOpen !== true) close();
    };
    bar.appendChild(b);
  }
  box.appendChild(bar);
  backdrop.appendChild(box);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      const primary = bar.querySelector<HTMLButtonElement>('button.primary');
      primary?.click();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.appendChild(backdrop);
  requestAnimationFrame(() => box.querySelector<HTMLElement>('input, select, button.primary')?.focus());
  return close;
}

export function showExportDialog(ed: Editor) {
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>รูปแบบไฟล์
      <select name="format">
        <option value="svg">SVG — เวกเตอร์สำหรับเว็บ</option>
        <option value="png">PNG — ภาพ raster</option>
        <option value="pdf">PDF — สำหรับพิมพ์</option>
        <option value="ai">AI — เปิดใน Adobe Illustrator ได้</option>
      </select>
    </label>
    <label class="png-only">ความละเอียด
      <select name="scale"><option value="1">1x</option><option value="2" selected>2x</option><option value="3">3x</option><option value="4">4x</option></select>
    </label>
    <label class="png-only check"><input type="checkbox" name="transparent" /> พื้นหลังโปร่งใส</label>
    <p class="note ai-only">ไฟล์ .ai นี้เป็นแบบ PDF-compatible: Illustrator เปิดและแก้ไข path, สี, ข้อความ และ layer ได้ ส่วนโปรแกรมนี้จะเปิดกลับมาได้ครบทุกอย่าง</p>
  `;
  const fmt = body.querySelector<HTMLSelectElement>('[name=format]')!;
  const sync = () => {
    body.querySelectorAll<HTMLElement>('.png-only').forEach((el) => (el.style.display = fmt.value === 'png' ? '' : 'none'));
    body.querySelectorAll<HTMLElement>('.ai-only').forEach((el) => (el.style.display = fmt.value === 'ai' ? '' : 'none'));
  };
  fmt.onchange = sync;
  sync();
  modal('Export', body, [
    { label: 'ยกเลิก' },
    {
      label: 'Export',
      primary: true,
      run: async () => {
        try {
          const scale = Number(body.querySelector<HTMLSelectElement>('[name=scale]')!.value);
          const transparent = body.querySelector<HTMLInputElement>('[name=transparent]')!.checked;
          if (fmt.value === 'svg') await exportSVG(ed);
          else if (fmt.value === 'png') await exportPNG(ed, scale, transparent);
          else if (fmt.value === 'pdf') await exportPDF(ed);
          else await exportAI(ed);
          toast(`Export ${fmt.value.toUpperCase()} แล้ว`);
        } catch (err) {
          console.error(err);
          toast(`Export ไม่สำเร็จ: ${(err as Error).message}`, 'error');
        }
      },
    },
  ]);
}

export function showNewDocDialog(ed: Editor) {
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>ขนาดสำเร็จรูป
      <select name="preset">
        <option value="800x600">800 × 600 px</option>
        <option value="1920x1080">1920 × 1080 px (Full HD)</option>
        <option value="1080x1080">1080 × 1080 px (โพสต์ Social)</option>
        <option value="595x842">A4 แนวตั้ง (595 × 842 pt)</option>
        <option value="842x595">A4 แนวนอน (842 × 595 pt)</option>
        <option value="612x792">Letter (612 × 792 pt)</option>
        <option value="custom">กำหนดเอง</option>
      </select>
    </label>
    <div class="row"><label>กว้าง <input type="number" name="w" value="800" min="1"/></label><label>สูง <input type="number" name="h" value="600" min="1"/></label></div>
    <p class="note">งานที่ยังไม่บันทึกจะถูกแทนที่</p>
  `;
  const preset = body.querySelector<HTMLSelectElement>('[name=preset]')!;
  const w = body.querySelector<HTMLInputElement>('[name=w]')!;
  const h = body.querySelector<HTMLInputElement>('[name=h]')!;
  preset.onchange = () => {
    if (preset.value === 'custom') return;
    const [pw, ph] = preset.value.split('x');
    w.value = pw;
    h.value = ph;
  };
  modal('เอกสารใหม่', body, [
    { label: 'ยกเลิก' },
    { label: 'สร้าง', primary: true, run: () => ed.newDocument(Math.max(1, Number(w.value) || 800), Math.max(1, Number(h.value) || 600)) },
  ]);
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'เครื่องมือ',
    [
      ['V', 'Selection'],
      ['A', 'Direct Selection'],
      ['P', 'Pen'],
      ['Shift+C', 'Anchor Point'],
      ['N', 'Pencil'],
      ['M', 'Rectangle'],
      ['L', 'Ellipse'],
      ['\\', 'Line Segment'],
      ['T', 'Type'],
      ['I', 'Eyedropper'],
      ['R', 'Rotate'],
      ['O', 'Reflect'],
      ['H / Space ค้าง', 'Hand'],
      ['Z', 'Zoom (Alt = ซูมออก)'],
    ],
  ],
  [
    'สี',
    [
      ['X', 'สลับ Fill / Stroke ที่ใช้งาน'],
      ['Shift+X', 'สลับสี Fill กับ Stroke'],
      ['D', 'สีเริ่มต้น (ขาว / ดำ)'],
      ['/', 'ไม่มีสี (None)'],
    ],
  ],
  [
    'แก้ไข',
    [
      ['Mod+Z / Mod+Shift+Z', 'Undo / Redo'],
      ['Mod+C / X / V', 'คัดลอก / ตัด / วาง'],
      ['Mod+F / Mod+B', 'วางด้านหน้า / ด้านหลัง'],
      ['Mod+D', 'ทำสำเนา'],
      ['Mod+A / Mod+Shift+A', 'เลือกทั้งหมด / ยกเลิก'],
      ['Delete', 'ลบ'],
      ['ลูกศร (+Shift)', 'เลื่อน 1px (10px)'],
      ['Alt+ลาก', 'ลากเพื่อทำสำเนา'],
      ['Shift+ลาก', 'ล็อกแนว 45° / คงสัดส่วน'],
    ],
  ],
  [
    'Object',
    [
      ['Mod+G / Mod+Shift+G', 'จัดกลุ่ม / ยกเลิกกลุ่ม'],
      ['Mod+] / Mod+[', 'เลื่อนหน้า / หลัง'],
      ['Mod+Shift+] / [', 'หน้าสุด / หลังสุด'],
      ['Mod+8', 'Compound Path'],
      ['Mod+7', 'Clipping Mask'],
      ['Mod+2 / Mod+3', 'ล็อก / ซ่อน'],
    ],
  ],
  [
    'ไฟล์และมุมมอง',
    [
      ['Mod+O', 'เปิดไฟล์'],
      ['Mod+S', 'บันทึกเป็น .ai'],
      ['Mod+E', 'Export'],
      ['Mod+Shift+P', 'นำเข้า / วางไฟล์'],
      ['Mod+= / Mod+-', 'ซูมเข้า / ออก'],
      ['Mod+0 / Mod+1', 'พอดีหน้าจอ / 100%'],
      ['Mod+Scroll', 'ซูมที่ตำแหน่งเมาส์'],
    ],
  ],
];

export function showShortcuts() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const fmt = (k: string) => k.replace(/Mod/g, mac ? '⌘' : 'Ctrl').replace(/Alt/g, mac ? '⌥' : 'Alt');
  const body = document.createElement('div');
  body.className = 'shortcuts';
  body.innerHTML = SHORTCUTS.map(
    ([title, rows]) =>
      `<section><h4>${title}</h4>${rows.map(([k, d]) => `<div class="sc"><kbd>${fmt(k)}</kbd><span>${d}</span></div>`).join('')}</section>`,
  ).join('');
  modal('คีย์ลัด', body, [{ label: 'ปิด', primary: true }]);
}
