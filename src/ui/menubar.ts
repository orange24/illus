import type { Editor } from '../editor';
import { Command, displayKeys } from '../commands';

const MENUS: [string, (string | '-')[]][] = [
  ['ไฟล์', ['file.new', 'file.open', 'file.import', '-', 'file.save', 'file.export', '-', 'file.exportSvg', 'file.exportPng', 'file.exportPdf', 'file.exportAi']],
  [
    'แก้ไข',
    ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteFront', 'edit.pasteBack', 'edit.pasteInPlace', 'edit.duplicate', 'edit.delete', '-', 'edit.selectAll', 'edit.deselect'],
  ],
  [
    'Object',
    [
      'object.group',
      'object.ungroup',
      '-',
      'object.front',
      'object.forward',
      'object.backward',
      'object.back',
      '-',
      'object.compound',
      'object.releaseCompound',
      'object.clip',
      'object.releaseClip',
      '-',
      'object.flipH',
      'object.flipV',
      '-',
      'object.lock',
      'object.unlockAll',
      'object.hide',
      'object.showAll',
    ],
  ],
  ['Pathfinder', ['path.unite', 'path.minusFront', 'path.minusBack', 'path.intersect', 'path.exclude', 'path.divide']],
  ['มุมมอง', ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual']],
  ['ช่วยเหลือ', ['help.shortcuts']],
];

export function buildMenubar(ed: Editor, commands: Map<string, Command>) {
  const bar = document.getElementById('menubar')!;
  bar.innerHTML = `<div class="brand"><span class="logo">Il</span><span class="name">Illus</span></div>`;
  const menus = document.createElement('nav');
  menus.className = 'menus';
  bar.appendChild(menus);
  const title = document.createElement('div');
  title.className = 'doc-title';
  bar.appendChild(title);
  const updateTitle = () => {
    title.textContent = `${ed.fileName} · ${ed.artboard.width} × ${ed.artboard.height}`;
    document.title = `${ed.fileName} — Illus`;
  };
  ed.on('file', updateTitle);
  ed.on('change', updateTitle);
  updateTitle();

  let openMenu: HTMLElement | null = null;
  const closeAll = () => {
    openMenu?.classList.remove('open');
    openMenu = null;
  };

  for (const [label, items] of MENUS) {
    const m = document.createElement('div');
    m.className = 'menu';
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = label;
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    const render = () => {
      dd.innerHTML = '';
      for (const id of items) {
        if (id === '-') {
          dd.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
          continue;
        }
        const cmd = commands.get(id);
        if (!cmd) continue;
        const it = document.createElement('button');
        it.className = 'item';
        const enabled = cmd.enabled ? cmd.enabled() : true;
        it.disabled = !enabled;
        it.innerHTML = `<span>${cmd.label}</span><kbd>${displayKeys(cmd.keys ?? '')}</kbd>`;
        it.onclick = () => {
          closeAll();
          cmd.run();
        };
        dd.appendChild(it);
      }
    };
    btn.onmousedown = (e) => {
      e.preventDefault();
      if (openMenu === m) return closeAll();
      closeAll();
      render();
      m.classList.add('open');
      openMenu = m;
    };
    btn.onmouseenter = () => {
      if (openMenu && openMenu !== m) {
        closeAll();
        render();
        m.classList.add('open');
        openMenu = m;
      }
    };
    m.append(btn, dd);
    menus.appendChild(m);
  }
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
}
