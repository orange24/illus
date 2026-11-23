import type { Editor } from './editor';
import type { Ops } from './ops';
import { exportAI, exportPDF, exportSVG, exportPNG, download, buildAI, baseName } from './io/export';
import { loadFile, pickFile, OPEN_ACCEPT, IMPORT_ACCEPT } from './io/files';
import { showExportDialog, showShortcuts, showNewDocDialog, toast } from './ui/dialogs';
import { showTraceDialog } from './ui/traceDialog';
import { selectedRasters } from './trace/imageTrace';

export interface Command {
  id: string;
  label: string;
  /** Display shortcut, using "Mod" for Ctrl/⌘. */
  keys?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function displayKeys(keys: string) {
  if (!keys) return '';
  if (isMac) {
    return keys
      .replace(/Mod\+/g, '⌘')
      .replace(/Shift\+/g, '⇧')
      .replace(/Alt\+/g, '⌥')
      .replace(/Ctrl\+/g, '⌃');
  }
  return keys.replace(/Mod/g, 'Ctrl');
}

async function guard(fn: () => Promise<unknown>, okMsg?: string) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (err) {
    console.error(err);
    toast(`เกิดข้อผิดพลาด: ${(err as Error).message}`, 'error');
  }
}

export function buildCommands(ed: Editor, ops: Ops): Map<string, Command> {
  const hasSel = () => ed.selection.length > 0;
  const multi = () => ed.selection.length > 1;
  const list: Command[] = [
    // File
    { id: 'file.new', label: 'เอกสารใหม่…', keys: 'Mod+Alt+N', run: () => showNewDocDialog(ed) },
    {
      id: 'file.open',
      label: 'เปิด… (.ai, .pdf, .svg)',
      keys: 'Mod+O',
      run: async () => {
        const f = await pickFile(OPEN_ACCEPT);
        if (f) await openFile(ed, f, 'open');
      },
    },
    {
      id: 'file.import',
      label: 'นำเข้า / วางไฟล์…',
      keys: 'Mod+Shift+P',
      run: async () => {
        const f = await pickFile(IMPORT_ACCEPT);
        if (f) await openFile(ed, f, 'import');
      },
    },
    {
      id: 'file.save',
      label: 'บันทึกเป็น .ai',
      keys: 'Mod+S',
      run: () => guard(async () => download(await buildAI(ed), `${baseName(ed)}.ai`), 'บันทึกไฟล์ .ai แล้ว'),
    },
    { id: 'file.export', label: 'Export…', keys: 'Mod+E', run: () => showExportDialog(ed) },
    { id: 'file.exportSvg', label: 'Export เป็น SVG', run: () => guard(() => exportSVG(ed), 'Export SVG แล้ว') },
    { id: 'file.exportPng', label: 'Export เป็น PNG (2x)', run: () => guard(() => exportPNG(ed, 2, false), 'Export PNG แล้ว') },
    { id: 'file.exportPdf', label: 'Export เป็น PDF', run: () => guard(() => exportPDF(ed), 'Export PDF แล้ว') },
    { id: 'file.exportAi', label: 'Export เป็น .ai', run: () => guard(() => exportAI(ed), 'Export .ai แล้ว') },
    // Edit
    { id: 'edit.undo', label: 'Undo', keys: 'Mod+Z', run: () => ed.undo(), enabled: () => ed.canUndo },
    { id: 'edit.redo', label: 'Redo', keys: 'Mod+Shift+Z', run: () => ed.redo(), enabled: () => ed.canRedo },
    { id: 'edit.cut', label: 'ตัด', keys: 'Mod+X', run: () => void ops.cut(), enabled: hasSel },
    { id: 'edit.copy', label: 'คัดลอก', keys: 'Mod+C', run: () => void ops.copy(), enabled: hasSel },
    { id: 'edit.paste', label: 'วาง', keys: 'Mod+V', run: () => ops.paste('offset'), enabled: () => ops.hasClipboard() },
    { id: 'edit.pasteFront', label: 'วางด้านหน้า', keys: 'Mod+F', run: () => ops.paste('front'), enabled: () => ops.hasClipboard() },
    { id: 'edit.pasteBack', label: 'วางด้านหลัง', keys: 'Mod+B', run: () => ops.paste('back'), enabled: () => ops.hasClipboard() },
    { id: 'edit.pasteInPlace', label: 'วางตำแหน่งเดิม', keys: 'Mod+Shift+V', run: () => ops.paste('inPlace'), enabled: () => ops.hasClipboard() },
    { id: 'edit.duplicate', label: 'ทำสำเนา', keys: 'Mod+D', run: () => ops.duplicate(), enabled: hasSel },
    { id: 'edit.delete', label: 'ลบ', keys: 'Delete', run: () => ops.delete(), enabled: hasSel },
    { id: 'edit.selectAll', label: 'เลือกทั้งหมด', keys: 'Mod+A', run: () => ops.selectAll() },
    { id: 'edit.deselect', label: 'ยกเลิกการเลือก', keys: 'Mod+Shift+A', run: () => ops.deselect(), enabled: hasSel },
    // Object
    { id: 'object.group', label: 'จัดกลุ่ม', keys: 'Mod+G', run: () => ops.group(), enabled: hasSel },
    { id: 'object.ungroup', label: 'ยกเลิกกลุ่ม', keys: 'Mod+Shift+G', run: () => ops.ungroup(), enabled: hasSel },
    { id: 'object.front', label: 'นำไปหน้าสุด', keys: 'Mod+Shift+]', run: () => ops.bringToFront(), enabled: hasSel },
    { id: 'object.forward', label: 'เลื่อนไปข้างหน้า', keys: 'Mod+]', run: () => ops.bringForward(), enabled: hasSel },
    { id: 'object.backward', label: 'เลื่อนไปข้างหลัง', keys: 'Mod+[', run: () => ops.sendBackward(), enabled: hasSel },
    { id: 'object.back', label: 'ส่งไปหลังสุด', keys: 'Mod+Shift+[', run: () => ops.sendToBack(), enabled: hasSel },
    { id: 'object.compound', label: 'สร้าง Compound Path', keys: 'Mod+8', run: () => ops.makeCompound(), enabled: multi },
    { id: 'object.releaseCompound', label: 'แยก Compound Path', keys: 'Mod+Alt+Shift+8', run: () => ops.releaseCompound(), enabled: hasSel },
    { id: 'object.clip', label: 'สร้าง Clipping Mask', keys: 'Mod+7', run: () => ops.makeClippingMask(), enabled: multi },
    { id: 'object.releaseClip', label: 'ปลด Clipping Mask', keys: 'Mod+Alt+7', run: () => ops.releaseClippingMask(), enabled: hasSel },
    {
      id: 'object.imageTrace',
      label: 'Image Trace — แปลงภาพเป็นเวกเตอร์…',
      keys: 'Mod+Alt+T',
      run: () => showTraceDialog(ed),
      enabled: () => selectedRasters(ed).length > 0,
    },
    { id: 'object.flipH', label: 'พลิกแนวนอน', run: () => ops.flip('h'), enabled: hasSel },
    { id: 'object.flipV', label: 'พลิกแนวตั้ง', run: () => ops.flip('v'), enabled: hasSel },
    { id: 'object.lock', label: 'ล็อก', keys: 'Mod+2', run: () => ops.lock(), enabled: hasSel },
    { id: 'object.unlockAll', label: 'ปลดล็อกทั้งหมด', keys: 'Mod+Alt+2', run: () => ops.unlockAll() },
    { id: 'object.hide', label: 'ซ่อน', keys: 'Mod+3', run: () => ops.hide(), enabled: hasSel },
    { id: 'object.showAll', label: 'แสดงทั้งหมด', keys: 'Mod+Alt+3', run: () => ops.showAll() },
    // Pathfinder
    { id: 'path.unite', label: 'Unite', run: () => ops.pathfinder('unite'), enabled: multi },
    { id: 'path.minusFront', label: 'Minus Front', run: () => ops.pathfinder('minusFront'), enabled: multi },
    { id: 'path.minusBack', label: 'Minus Back', run: () => ops.pathfinder('minusBack'), enabled: multi },
    { id: 'path.intersect', label: 'Intersect', run: () => ops.pathfinder('intersect'), enabled: multi },
    { id: 'path.exclude', label: 'Exclude', run: () => ops.pathfinder('exclude'), enabled: multi },
    { id: 'path.divide', label: 'Divide', run: () => ops.pathfinder('divide'), enabled: multi },
    // View
    { id: 'view.zoomIn', label: 'ซูมเข้า', keys: 'Mod+=', run: () => ed.zoomBy(1.25) },
    { id: 'view.zoomOut', label: 'ซูมออก', keys: 'Mod+-', run: () => ed.zoomBy(0.8) },
    { id: 'view.fit', label: 'พอดีหน้าจอ', keys: 'Mod+0', run: () => ed.fitArtboard() },
    { id: 'view.actual', label: 'ขนาดจริง 100%', keys: 'Mod+1', run: () => ed.zoomTo(1, ed.artboardBounds.center) },
    // Help
    { id: 'help.shortcuts', label: 'คีย์ลัดทั้งหมด', keys: 'F1', run: () => showShortcuts() },
  ];
  return new Map(list.map((c) => [c.id, c]));
}

export async function openFile(ed: Editor, file: File, mode: 'open' | 'import') {
  ed.setStatus(`กำลังเปิด ${file.name}…`);
  try {
    const res = await loadFile(ed, file, mode);
    toast(res.message, res.ok ? 'info' : 'error');
    ed.setStatus(res.message);
  } catch (err) {
    console.error(err);
    toast(`เปิดไฟล์ไม่สำเร็จ: ${(err as Error).message}`, 'error');
    ed.setStatus('เปิดไฟล์ไม่สำเร็จ');
  }
}
