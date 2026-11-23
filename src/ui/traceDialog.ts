import type { Editor } from '../editor';
import { modal, toast } from './dialogs';
import {
  DEFAULT_SETTINGS,
  PRESETS,
  TraceRunner,
  applyTraceResult,
  presetSettings,
  rasterPixels,
  resultToSvg,
  selectedRasters,
  toTraceOptions,
  traceSelection,
  type RasterPixels,
  type TraceSettings,
} from '../trace/imageTrace';
import type { TraceResult } from '../trace/tracer';

const STORE_KEY = 'illus.imageTrace.v1';

function loadSettings(): { preset: string; settings: TraceSettings } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return { preset: v.preset ?? 'custom', settings: { ...DEFAULT_SETTINGS, ...v.settings } };
    }
  } catch {
    /* storage unavailable */
  }
  return { preset: 'color-6', settings: presetSettings('color-6') };
}

function saveSettings(preset: string, settings: TraceSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ preset, settings }));
  } catch {
    /* ignore */
  }
}

/** Quick trace from the options bar, using a preset without opening the dialog. */
export async function quickTrace(ed: Editor, presetId: string) {
  const settings = { ...presetSettings(presetId), keepOriginal: loadSettings().settings.keepOriginal };
  ed.setStatus('กำลัง Image Trace…');
  try {
    const groups = await traceSelection(ed, settings);
    const n = groups.reduce((a, g) => a + g.children.length, 0);
    toast(`Image Trace เสร็จแล้ว: ${n} path`);
    ed.setStatus(`Image Trace: ${n} path`);
  } catch (err) {
    console.error(err);
    toast(`Image Trace ไม่สำเร็จ: ${(err as Error).message}`, 'error');
  }
}

const slider = (name: string, label: string, min: number, max: number, step = 1, hint = '') => `
  <label class="tr-slider" data-for="${name}">
    <span class="tr-head"><span>${label}</span><output></output></span>
    <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" />
    ${hint ? `<span class="tr-hint">${hint}</span>` : ''}
  </label>`;

export function showTraceDialog(ed: Editor) {
  const rasters = selectedRasters(ed);
  if (!rasters.length) {
    toast('เลือกภาพ (raster) ที่ต้องการแปลงเป็นเวกเตอร์ก่อน', 'error');
    return;
  }
  const raster = rasters[0];
  const saved = loadSettings();
  let presetId = saved.preset;
  const s: TraceSettings = { ...saved.settings };

  const body = document.createElement('div');
  body.className = 'trace-dialog';
  body.innerHTML = `
    <div class="tr-controls form">
      <label>ค่าสำเร็จรูป (Preset)
        <select name="preset">
          ${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
          <option value="custom">กำหนดเอง</option>
        </select>
      </label>
      <div class="tr-modes" role="radiogroup">
        <button type="button" data-mode="bw">ขาวดำ</button>
        <button type="button" data-mode="gray">โทนเทา</button>
        <button type="button" data-mode="color">สี</button>
      </div>
      ${slider('threshold', 'เกณฑ์ขาว/ดำ (Threshold)', 0, 255, 1, 'ค่ามาก = พื้นที่สีดำมากขึ้น')}
      ${slider('colors', 'จำนวนสี', 2, 64)}
      ${slider('paths', 'ความแม่นยำของเส้น (Paths)', 0, 100, 1, 'น้อย = เส้นเรียบ จุดน้อย · มาก = ตามภาพละเอียด')}
      ${slider('corners', 'มุม (Corners)', 0, 100, 1, 'มาก = มุมแหลมมากขึ้น')}
      ${slider('noise', 'ตัดจุดรบกวน (Noise, px)', 1, 200, 1, 'พื้นที่เล็กกว่านี้จะถูกรวมกับบริเวณข้างเคียง')}
      <div class="row">
        <label>ความละเอียดที่ใช้ trace
          <select name="resolution">
            <option value="500">500 px (เร็ว)</option>
            <option value="700">700 px</option>
            <option value="1000">1000 px</option>
            <option value="1400">1400 px</option>
            <option value="2000">2000 px (ละเอียด)</option>
          </select>
        </label>
        <label>วิธีสร้างรูปทรง
          <select name="method">
            <option value="overlapping">ซ้อนกัน (ไม่มีรอยต่อ)</option>
            <option value="abutting">ชนกันพอดี</option>
          </select>
        </label>
      </div>
      <label class="check"><input type="checkbox" name="ignoreWhite" /> ไม่สร้างพื้นที่สีขาว (Ignore White)</label>
      <label class="check"><input type="checkbox" name="keepOriginal" /> เก็บภาพต้นฉบับไว้ (ซ่อนไว้ใต้ผลลัพธ์)</label>
    </div>
    <div class="tr-preview-col">
      <div class="tr-views" role="tablist">
        <button type="button" data-view="result" class="on">ผลลัพธ์</button>
        <button type="button" data-view="outline">เส้นขอบ</button>
        <button type="button" data-view="original">ต้นฉบับ</button>
      </div>
      <div class="tr-preview">
        <div class="tr-stage"></div>
        <div class="tr-busy"><span class="spinner"></span>กำลัง trace…</div>
      </div>
      <div class="tr-stats"></div>
      ${rasters.length > 1 ? `<p class="note">เลือกไว้ ${rasters.length} ภาพ · พรีวิวภาพแรก และจะใช้ค่าเดียวกันกับทุกภาพ</p>` : ''}
    </div>`;

  const q = <T extends HTMLElement>(sel: string) => body.querySelector<T>(sel)!;
  const presetSel = q<HTMLSelectElement>('[name=preset]');
  const stage = q<HTMLDivElement>('.tr-stage');
  const busy = q<HTMLDivElement>('.tr-busy');
  const stats = q<HTMLDivElement>('.tr-stats');
  const ranges = ['threshold', 'colors', 'paths', 'corners', 'noise'] as const;

  const runner = new TraceRunner();
  let pixels: RasterPixels | null = null;
  let pixelsRes = 0;
  let result: TraceResult | null = null;
  let resultKey = '';
  let view: 'result' | 'outline' | 'original' = 'result';
  let timer = 0;
  let closed = false;

  const keyOf = () => JSON.stringify({ ...toTraceOptions(s), resolution: s.resolution });

  const syncControls = () => {
    presetSel.value = presetId;
    body.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
    for (const name of ranges) {
      const inp = q<HTMLInputElement>(`[name=${name}]`);
      inp.value = String(s[name]);
      q<HTMLOutputElement>(`[data-for=${name}] output`).textContent = String(s[name]);
    }
    q<HTMLElement>('[data-for=threshold]').style.display = s.mode === 'bw' ? '' : 'none';
    q<HTMLElement>('[data-for=colors]').style.display = s.mode === 'bw' ? 'none' : '';
    q<HTMLElement>('[data-for=colors] .tr-head span').textContent = s.mode === 'gray' ? 'จำนวนระดับสีเทา' : 'จำนวนสี';
    q<HTMLSelectElement>('[name=resolution]').value = String(s.resolution);
    q<HTMLSelectElement>('[name=method]').value = s.method;
    q<HTMLInputElement>('[name=ignoreWhite]').checked = s.ignoreWhite;
    q<HTMLInputElement>('[name=keepOriginal]').checked = s.keepOriginal;
  };

  const render = () => {
    body.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'original' || !result) {
      stage.innerHTML = pixels ? `<img src="${pixels.previewUrl}" alt="" />` : '';
    } else {
      stage.innerHTML = resultToSvg(result, view === 'outline');
    }
  };

  const showStats = (ms: number) => {
    if (!result) return;
    stats.innerHTML = `<span><b>${result.pathCount.toLocaleString()}</b> path</span><span><b>${result.anchorCount.toLocaleString()}</b> จุด anchor</span><span><b>${result.layers.length}</b> สี</span><span class="dim">${(ms / 1000).toFixed(1)} วินาที</span>`;
  };

  const runPreview = async () => {
    if (closed) return;
    try {
      if (!pixels || pixelsRes !== s.resolution) {
        pixels = rasterPixels(raster, s.resolution);
        pixelsRes = s.resolution;
      }
      const key = keyOf();
      if (key === resultKey && result) return;
      busy.classList.add('on');
      const t0 = performance.now();
      const r = await runner.run(pixels.image, { ...toTraceOptions(s), upscale: pixels.scale });
      if (closed) return;
      result = r;
      resultKey = key;
      busy.classList.remove('on');
      render();
      showStats(performance.now() - t0);
    } catch (err) {
      if ((err as Error).message === 'cancelled') return;
      busy.classList.remove('on');
      console.error(err);
      stats.textContent = `trace ไม่สำเร็จ: ${(err as Error).message}`;
    }
  };

  const schedule = (delay = 220) => {
    clearTimeout(timer);
    timer = window.setTimeout(runPreview, delay);
  };

  const changed = () => {
    presetId = 'custom';
    syncControls();
    schedule();
  };

  presetSel.onchange = () => {
    presetId = presetSel.value;
    if (presetId !== 'custom') Object.assign(s, presetSettings(presetId), { keepOriginal: s.keepOriginal });
    syncControls();
    schedule(0);
  };
  body.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.onclick = () => {
      s.mode = b.dataset.mode as TraceSettings['mode'];
      s.ignoreWhite = s.mode === 'bw';
      changed();
    };
  });
  for (const name of ranges) {
    const inp = q<HTMLInputElement>(`[name=${name}]`);
    inp.oninput = () => {
      s[name] = Number(inp.value);
      q<HTMLOutputElement>(`[data-for=${name}] output`).textContent = inp.value;
      presetId = 'custom';
      presetSel.value = presetId;
      schedule(350);
    };
  }
  q<HTMLSelectElement>('[name=resolution]').onchange = (e) => {
    s.resolution = Number((e.target as HTMLSelectElement).value);
    changed();
  };
  q<HTMLSelectElement>('[name=method]').onchange = (e) => {
    s.method = (e.target as HTMLSelectElement).value as TraceSettings['method'];
    changed();
  };
  q<HTMLInputElement>('[name=ignoreWhite]').onchange = (e) => {
    s.ignoreWhite = (e.target as HTMLInputElement).checked;
    changed();
  };
  q<HTMLInputElement>('[name=keepOriginal]').onchange = (e) => {
    s.keepOriginal = (e.target as HTMLInputElement).checked;
  };
  body.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.onclick = () => {
      view = b.dataset.view as typeof view;
      render();
    };
  });
  // Hold the mouse on the preview to compare with the original.
  const preview = q<HTMLDivElement>('.tr-preview');
  preview.onpointerdown = () => {
    if (view === 'original') return;
    const prev = view;
    view = 'original';
    render();
    const up = () => {
      view = prev;
      render();
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointerup', up);
  };
  preview.title = 'กดค้างเพื่อดูภาพต้นฉบับ';

  syncControls();

  modal(
    'Image Trace — แปลงภาพเป็นเวกเตอร์',
    body,
    [
      { label: 'ยกเลิก' },
      {
        label: 'Trace',
        primary: true,
        run: async () => {
          saveSettings(presetId, s);
          const btn = document.querySelector<HTMLButtonElement>('.modal.trace-modal .modal-actions button.primary');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'กำลัง trace…';
          }
          try {
            let n = 0;
            if (rasters.length === 1 && result && pixels && resultKey === keyOf()) {
              // The preview is up to date: reuse it.
              const g = applyTraceResult(raster, result, pixels.scale, s.keepOriginal);
              ed.commit();
              ed.setSelection([g]);
              n = g.children.length;
            } else {
              const groups = await traceSelection(ed, s);
              n = groups.reduce((a, g) => a + g.children.length, 0);
            }
            toast(`Image Trace เสร็จแล้ว: ${n.toLocaleString()} path (Ungroup เพื่อแก้ไขทีละชิ้น)`);
            ed.setStatus(`Image Trace: ${n} path`);
          } catch (err) {
            console.error(err);
            toast(`Image Trace ไม่สำเร็จ: ${(err as Error).message}`, 'error');
          }
        },
      },
    ],
    {
      className: 'trace-modal',
      onClose: () => {
        closed = true;
        clearTimeout(timer);
        runner.dispose();
      },
    },
  );
  try {
    pixels = rasterPixels(raster, s.resolution);
    pixelsRes = s.resolution;
    render();
  } catch (err) {
    stats.textContent = (err as Error).message;
    return;
  }
  schedule(0);
}
