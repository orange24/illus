// Simple original line icons (24x24 viewBox, currentColor).
const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  select: wrap('<path d="M5 3 L5 19 L9.5 15 L12.5 21 L15 20 L12 14 L18 14 Z" fill="currentColor" stroke="none"/>'),
  direct: wrap('<path d="M5 3 L5 19 L9.5 15 L12.5 21 L15 20 L12 14 L18 14 Z"/>'),
  pen: wrap('<path d="M4 20 L7 11 L14 4 L20 10 L13 17 Z"/><circle cx="10.5" cy="13.5" r="1.3" fill="currentColor"/><path d="M4 20 L9 15"/>'),
  pencil: wrap('<path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z"/><path d="M14 6 L18 10"/>'),
  anchor: wrap('<path d="M4 18 C8 6, 16 6, 20 18"/><rect x="10" y="7" width="4" height="4" fill="currentColor"/><path d="M5 9 L19 9"/>'),
  rect: wrap('<rect x="4" y="5" width="16" height="14" rx="0.5"/>'),
  roundrect: wrap('<rect x="4" y="5" width="16" height="14" rx="4"/>'),
  ellipse: wrap('<ellipse cx="12" cy="12" rx="8" ry="7"/>'),
  polygon: wrap('<path d="M12 3 L20 8 L20 16 L12 21 L4 16 L4 8 Z"/>'),
  star: wrap('<path d="M12 3 L14.6 9 L21 9.5 L16 13.6 L17.6 20 L12 16.6 L6.4 20 L8 13.6 L3 9.5 L9.4 9 Z"/>'),
  line: wrap('<path d="M5 19 L19 5"/>'),
  text: wrap('<path d="M5 6 V4 H19 V6"/><path d="M12 4 V20"/><path d="M9 20 H15"/>'),
  eyedropper: wrap('<path d="M4 20 L5 16 L13 8 L16 11 L8 19 Z"/><path d="M12 6 L15 3 L21 9 L18 12 Z" fill="currentColor"/>'),
  hand: wrap('<path d="M8 13 V6 a1.5 1.5 0 0 1 3 0 V11 V4.5 a1.5 1.5 0 0 1 3 0 V11 V6 a1.5 1.5 0 0 1 3 0 V14 c0 4 -2.5 7 -6 7 c-3 0 -4.5 -1.5 -6 -4 L3.5 13 a1.5 1.5 0 0 1 2.5 -1.6 Z"/>'),
  zoom: wrap('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/>'),
  rotate: wrap('<path d="M20 12 A8 8 0 1 1 16 5"/><path d="M16 2 V6 H20"/>'),
  reflect: wrap('<path d="M12 3 V21" stroke-dasharray="2 2"/><path d="M9 6 L3 18 H9 Z"/><path d="M15 6 L21 18 H15 Z" fill="currentColor"/>'),
  swap: wrap('<path d="M7 4 H15 a3 3 0 0 1 3 3 V13"/><path d="M15 10 L18 13 L21 10"/>'),
  reset: wrap('<rect x="4" y="4" width="8" height="8" fill="currentColor"/><rect x="10" y="10" width="8" height="8"/>'),
  none: wrap('<rect x="4" y="4" width="16" height="16"/><path d="M4 20 L20 4" stroke="#e5484d"/>'),
  eye: wrap('<path d="M2 12 C5 6, 19 6, 22 12 C19 18, 5 18, 2 12 Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: wrap('<path d="M2 12 C5 6, 19 6, 22 12 C19 18, 5 18, 2 12 Z" opacity="0.35"/><path d="M4 4 L20 20"/>'),
  lock: wrap('<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11 V7.5 a4 4 0 0 1 8 0 V11"/>'),
  unlock: wrap('<rect x="5" y="11" width="14" height="10" rx="1.5" opacity="0.35"/><path d="M8 11 V7.5 a4 4 0 0 1 7.5 -2" opacity="0.35"/>'),
  plus: wrap('<path d="M12 5 V19 M5 12 H19"/>'),
  trash: wrap('<path d="M4 7 H20"/><path d="M9 7 V4 H15 V7"/><path d="M6 7 L7 20 H17 L18 7"/>'),
  unite: wrap('<path d="M3 3 H14 V9 H21 V21 H9 V15 H3 Z" fill="currentColor"/>'),
  minusFront: wrap('<path d="M3 3 H14 V9 H9 V15 H3 Z" fill="currentColor"/><rect x="9" y="9" width="12" height="12" stroke-dasharray="2 2"/>'),
  minusBack: wrap('<rect x="3" y="3" width="11" height="12" stroke-dasharray="2 2"/><path d="M14 9 H21 V21 H9 V15 H14 Z" fill="currentColor"/>'),
  intersect: wrap('<rect x="3" y="3" width="11" height="12"/><rect x="9" y="9" width="12" height="12"/><rect x="9" y="9" width="5" height="6" fill="currentColor"/>'),
  exclude: wrap('<path d="M3 3 H14 V9 H9 V15 H3 Z" fill="currentColor"/><path d="M14 9 H21 V21 H9 V15 H14 Z" fill="currentColor"/><rect x="9" y="9" width="5" height="6"/>'),
  divide: wrap('<rect x="3" y="3" width="11" height="12"/><rect x="9" y="9" width="12" height="12"/><path d="M9 9 L14 15 M14 9 L9 15" />'),
  alignLeft: wrap('<path d="M4 3 V21"/><rect x="7" y="6" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/>'),
  alignHCenter: wrap('<path d="M12 3 V21"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>'),
  alignRight: wrap('<path d="M20 3 V21"/><rect x="5" y="6" width="12" height="4"/><rect x="10" y="14" width="7" height="4"/>'),
  alignTop: wrap('<path d="M3 4 H21"/><rect x="6" y="7" width="4" height="12"/><rect x="14" y="7" width="4" height="7"/>'),
  alignVCenter: wrap('<path d="M3 12 H21"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>'),
  alignBottom: wrap('<path d="M3 20 H21"/><rect x="6" y="5" width="4" height="12"/><rect x="14" y="10" width="4" height="7"/>'),
  distH: wrap('<path d="M4 3 V21 M20 3 V21"/><rect x="9" y="8" width="6" height="8"/>'),
  distV: wrap('<path d="M3 4 H21 M3 20 H21"/><rect x="8" y="9" width="8" height="6"/>'),
  flipH: wrap('<path d="M12 3 V21" stroke-dasharray="2 2"/><path d="M9 7 L4 12 L9 17 Z"/><path d="M15 7 L20 12 L15 17 Z"/>'),
  flipV: wrap('<path d="M3 12 H21" stroke-dasharray="2 2"/><path d="M7 9 L12 4 L17 9 Z"/><path d="M7 15 L12 20 L17 15 Z"/>'),
  group: wrap('<rect x="3" y="3" width="18" height="18" stroke-dasharray="2 2"/><rect x="6" y="6" width="6" height="6"/><circle cx="15" cy="15" r="3"/>'),
  chevron: wrap('<path d="M9 6 L15 12 L9 18"/>'),
};

export function icon(name: string) {
  return ICONS[name] ?? '';
}
