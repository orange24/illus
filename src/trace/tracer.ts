/**
 * Image Trace: converts raster pixels into filled vector shapes.
 *
 * Pipeline (pure functions, no DOM — runs inside a Web Worker):
 *   1. Quantize the image to a small palette (threshold, gray levels or k-means colours).
 *   2. Remove speckles: regions smaller than `noise` pixels are merged into their neighbour.
 *   3. For every palette colour build a mask (abutting = only that colour, overlapping = that
 *      colour plus everything stacked above it, so shapes tuck underneath and leave no gaps).
 *   4. Trace the pixel-edge boundaries of each 4-connected region (outer contour + holes).
 *   5. Smooth the staircase, detect corners and fit cubic Béziers (Schneider's algorithm).
 *
 * Coordinates in the result are in the pixel space of the input image (0..width, 0..height).
 */

export type TraceMode = 'bw' | 'gray' | 'color';

export interface TraceOptions {
  mode: TraceMode;
  /** Black & white: luminance below this becomes black (0–255). */
  threshold: number;
  /** Number of colours / gray levels (2–64). */
  colors: number;
  /** Path fidelity 0–100: low = smoother with fewer anchors, high = follows pixels tightly. */
  paths: number;
  /** Corner amount 0–100: high = more sharp corners. */
  corners: number;
  /** Regions smaller than this many pixels are ignored / merged into their neighbours. */
  noise: number;
  method: 'abutting' | 'overlapping';
  /** Drop white (and near-white) areas instead of creating white shapes. */
  ignoreWhite: boolean;
  /** How much the image was enlarged before tracing (anti-aliased edges get this much wider). */
  upscale?: number;
}

export interface TraceImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface TraceLayer {
  color: string;
  /** SVG path data, one entry per shape (outer contour plus its holes). */
  paths: string[];
}

export interface TraceResult {
  width: number;
  height: number;
  /** Bottom-most layer first. */
  layers: TraceLayer[];
  pathCount: number;
  anchorCount: number;
}

type RGB = [number, number, number];

export function traceImage(img: TraceImage, o: TraceOptions): TraceResult {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const R = new Uint8Array(N);
  const G = new Uint8Array(N);
  const B = new Uint8Array(N);
  const opaque = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) continue;
    opaque[i] = 1;
    // Composite semi-transparent pixels over white.
    const k = a / 255;
    R[i] = data[i * 4] * k + 255 * (1 - k);
    G[i] = data[i * 4 + 1] * k + 255 * (1 - k);
    B[i] = data[i * 4 + 2] * k + 255 * (1 - k);
  }

  // ---- 1. quantize ----
  const idx = new Int16Array(N).fill(-1);
  let palette: RGB[];
  if (o.mode === 'bw') {
    palette = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    for (let i = 0; i < N; i++) if (opaque[i]) idx[i] = lum(R[i], G[i], B[i]) < o.threshold ? 0 : 1;
  } else if (o.mode === 'gray') {
    const levels = grayLevels(R, G, B, opaque, clamp(Math.round(o.colors), 2, 64));
    palette = levels.map((v) => [v, v, v] as RGB);
    const lut = new Int16Array(256);
    for (let v = 0; v < 256; v++) lut[v] = nearest1d(levels, v);
    for (let i = 0; i < N; i++) if (opaque[i]) idx[i] = lut[Math.round(lum(R[i], G[i], B[i]))];
  } else {
    palette = kmeansColors(R, G, B, opaque, clamp(Math.round(o.colors), 2, 64));
    const cache = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      if (!opaque[i]) continue;
      const key = (R[i] << 16) | (G[i] << 8) | B[i];
      let c = cache.get(key);
      if (c === undefined) {
        c = nearestColor(palette, R[i], G[i], B[i]);
        cache.set(key, c);
      }
      idx[i] = c;
    }
  }
  // Use the real average colour of each cluster (more faithful than the sampled centres).
  if (o.mode !== 'bw') {
    const sum = new Float64Array(palette.length * 4);
    for (let i = 0; i < N; i++) {
      const c = idx[i];
      if (c < 0) continue;
      sum[c * 4] += R[i];
      sum[c * 4 + 1] += G[i];
      sum[c * 4 + 2] += B[i];
      sum[c * 4 + 3]++;
    }
    palette = palette.map((p, c) => {
      const n = sum[c * 4 + 3];
      if (!n) return p;
      const avg: RGB = [Math.round(sum[c * 4] / n), Math.round(sum[c * 4 + 1] / n), Math.round(sum[c * 4 + 2] / n)];
      if (o.mode === 'gray') {
        const v = Math.round(lum(...avg));
        return [v, v, v] as RGB;
      }
      return avg;
    });
  }

  // ---- 2. clean up anti-aliasing slivers and speckles ----
  if (o.mode !== 'bw') dissolveThin(idx, R, G, B, palette, W, H, 1.4 * Math.max(1, o.upscale ?? 1));
  const minArea = Math.max(1, Math.round(o.noise));
  if (minArea > 1) {
    for (let pass = 0; pass < 4; pass++) if (!despeckle(idx, W, H, minArea)) break;
  }

  // ---- ignore white ----
  if (o.ignoreWhite) {
    const white = palette.map(([r, g, b]) => Math.min(r, g, b) >= 235);
    for (let i = 0; i < N; i++) if (idx[i] >= 0 && white[idx[i]]) idx[i] = -1;
  }

  // ---- 3. stacking order ----
  const area = new Float64Array(palette.length);
  for (let i = 0; i < N; i++) if (idx[i] >= 0) area[idx[i]]++;
  const order = palette.map((_, c) => c).filter((c) => area[c] > 0);
  if (o.mode === 'color') order.sort((a, b) => area[b] - area[a]);
  else order.sort((a, b) => lum(...palette[b]) - lum(...palette[a])); // light at the bottom, dark on top
  const rank = new Int16Array(palette.length).fill(-1);
  order.forEach((c, r) => (rank[c] = r));

  // ---- 4/5. trace each layer ----
  const tol = lerp(2.4, 0.3, clamp(o.paths, 0, 100) / 100);
  const cornerDeg = 120 - clamp(o.corners, 0, 100);
  const layers: TraceLayer[] = [];
  let pathCount = 0;
  let anchorCount = 0;
  const pr = new Int16Array(N); // stacking rank per pixel, -1 = transparent
  for (let i = 0; i < N; i++) pr[i] = idx[i] >= 0 ? rank[idx[i]] : -1;
  const mask = new Uint8Array(N);
  for (let r = 0; r < order.length; r++) {
    for (let i = 0; i < N; i++) mask[i] = pr[i] === r ? 1 : 0;
    if (o.method === 'overlapping') overlapMask(mask, pr, r, W, H);
    const shapes = traceMask(mask, W, H, minArea);
    const paths: string[] = [];
    for (const loops of shapes) {
      let d = '';
      for (const loop of loops) {
        const [ld, anchors] = fitLoop(loop, tol, cornerDeg);
        d += ld;
        anchorCount += anchors;
      }
      if (d) paths.push(d);
    }
    if (!paths.length) continue;
    pathCount += paths.length;
    layers.push({ color: hex(palette[order[r]]), paths });
  }
  return { width: W, height: H, layers, pathCount, anchorCount };
}

// ---------------------------------------------------------------- colour helpers

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function nearest1d(levels: number[], v: number) {
  let best = 0;
  for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i] - v) < Math.abs(levels[best] - v)) best = i;
  return best;
}

/** 1-D k-means over the luminance histogram. */
function grayLevels(R: Uint8Array, G: Uint8Array, B: Uint8Array, opaque: Uint8Array, k: number): number[] {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < R.length; i++)
    if (opaque[i]) {
      hist[Math.round(lum(R[i], G[i], B[i]))]++;
      total++;
    }
  if (!total) return [0, 255];
  // Initialise at histogram quantiles.
  const centers: number[] = [];
  let acc = 0;
  let q = 0;
  for (let v = 0; v < 256 && centers.length < k; v++) {
    acc += hist[v];
    while (centers.length < k && acc >= ((q + 0.5) / k) * total) {
      centers.push(v);
      q++;
    }
  }
  for (let it = 0; it < 30; it++) {
    const s = new Float64Array(centers.length);
    const n = new Float64Array(centers.length);
    for (let v = 0; v < 256; v++) {
      if (!hist[v]) continue;
      const c = nearest1d(centers, v);
      s[c] += v * hist[v];
      n[c] += hist[v];
    }
    let moved = false;
    for (let c = 0; c < centers.length; c++) {
      if (!n[c]) continue;
      const nv = s[c] / n[c];
      if (Math.abs(nv - centers[c]) > 0.1) moved = true;
      centers[c] = nv;
    }
    if (!moved) break;
  }
  return [...new Set(centers.map((c) => Math.round(c)))].sort((a, b) => a - b);
}

function colorDist(a: RGB, r: number, g: number, b: number) {
  const dr = a[0] - r;
  const dg = a[1] - g;
  const db = a[2] - b;
  // Perceptual-ish weighting ("redmean" approximation).
  const rm = (a[0] + r) / 2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

function nearestColor(palette: RGB[], r: number, g: number, b: number) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = colorDist(palette[i], r, g, b);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** k-means++ on a deterministic sample of the opaque pixels. */
function kmeansColors(R: Uint8Array, G: Uint8Array, B: Uint8Array, opaque: Uint8Array, k: number): RGB[] {
  const N = R.length;
  let count = 0;
  for (let i = 0; i < N; i++) count += opaque[i];
  if (!count) return [[0, 0, 0]];
  const step = Math.max(1, Math.floor(count / 40000));
  const sr: number[] = [];
  const sg: number[] = [];
  const sb: number[] = [];
  for (let i = 0, j = 0; i < N; i++) {
    if (!opaque[i]) continue;
    if (j++ % step) continue;
    sr.push(R[i]);
    sg.push(G[i]);
    sb.push(B[i]);
  }
  const S = sr.length;
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const centers: RGB[] = [];
  const dist = new Float64Array(S).fill(Infinity);
  let pick = Math.floor(rand() * S);
  for (let c = 0; c < k; c++) {
    centers.push([sr[pick], sg[pick], sb[pick]]);
    let total = 0;
    for (let i = 0; i < S; i++) {
      const d = colorDist(centers[c], sr[i], sg[i], sb[i]);
      if (d < dist[i]) dist[i] = d;
      total += dist[i];
    }
    if (total === 0) break; // fewer distinct colours than k
    let t = rand() * total;
    pick = S - 1;
    for (let i = 0; i < S; i++) {
      t -= dist[i];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
  }
  const assign = new Int32Array(S);
  for (let it = 0; it < 16; it++) {
    const sum = new Float64Array(centers.length * 4);
    for (let i = 0; i < S; i++) {
      const c = nearestColor(centers, sr[i], sg[i], sb[i]);
      assign[i] = c;
      sum[c * 4] += sr[i];
      sum[c * 4 + 1] += sg[i];
      sum[c * 4 + 2] += sb[i];
      sum[c * 4 + 3]++;
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      const n = sum[c * 4 + 3];
      if (!n) continue;
      const nc: RGB = [sum[c * 4] / n, sum[c * 4 + 1] / n, sum[c * 4 + 2] / n];
      moved = Math.max(moved, Math.abs(nc[0] - centers[c][0]) + Math.abs(nc[1] - centers[c][1]) + Math.abs(nc[2] - centers[c][2]));
      centers[c] = nc;
    }
    if (moved < 0.5) break;
  }
  return centers.map((c) => c.map((v) => Math.round(v)) as RGB);
}

// ---------------------------------------------------------------- despeckle

/** 4-connected labelling of same-index regions. */
function labelRegions(idx: Int16Array, W: number, H: number) {
  const N = W * H;
  const labels = new Int32Array(N).fill(-1);
  const areas: number[] = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (labels[p] >= 0) continue;
    const lab = areas.length;
    const c = idx[p];
    let sp = 0;
    let n = 0;
    stack[sp++] = p;
    labels[p] = lab;
    while (sp) {
      const q = stack[--sp];
      n++;
      const x = q % W;
      if (x > 0 && labels[q - 1] < 0 && idx[q - 1] === c) (labels[q - 1] = lab), (stack[sp++] = q - 1);
      if (x < W - 1 && labels[q + 1] < 0 && idx[q + 1] === c) (labels[q + 1] = lab), (stack[sp++] = q + 1);
      if (q >= W && labels[q - W] < 0 && idx[q - W] === c) (labels[q - W] = lab), (stack[sp++] = q - W);
      if (q < N - W && labels[q + W] < 0 && idx[q + W] === c) (labels[q + W] = lab), (stack[sp++] = q + W);
    }
    areas.push(n);
  }
  return { labels, areas };
}

/**
 * Anti-aliasing leaves thin bands of in-between colours along every edge; quantization turns
 * them into ragged slivers. Regions whose average thickness (2·area / perimeter) is about one
 * pixel are dissolved: each pixel joins the neighbouring region with the closest colour.
 */
function dissolveThin(idx: Int16Array, R: Uint8Array, G: Uint8Array, B: Uint8Array, palette: RGB[], W: number, H: number, maxThickness: number) {
  const N = W * H;
  const { labels, areas } = labelRegions(idx, W, H);
  const perim = new Float64Array(areas.length);
  for (let p = 0; p < N; p++) {
    const l = labels[p];
    const x = p % W;
    if (x === 0 || labels[p - 1] !== l) perim[l]++;
    if (x === W - 1 || labels[p + 1] !== l) perim[l]++;
    if (p < W || labels[p - W] !== l) perim[l]++;
    if (p >= N - W || labels[p + W] !== l) perim[l]++;
  }
  const thin = new Uint8Array(areas.length);
  let any = false;
  for (let l = 0; l < areas.length; l++) {
    if (areas.length > 1 && (2 * areas[l]) / perim[l] < maxThickness) {
      thin[l] = 1;
      any = true;
    }
  }
  if (!any) return;
  const pending = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (thin[labels[p]] && idx[p] >= 0) pending[p] = 1;
  for (let pass = 0; pass < 4; pass++) {
    const next: [number, number][] = [];
    for (let p = 0; p < N; p++) {
      if (!pending[p]) continue;
      const x = p % W;
      let best = -1;
      let bd = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = (p - x) / W + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (pending[q] || idx[q] < 0) continue;
          const d = colorDist(palette[idx[q]], R[p], G[p], B[p]);
          if (d < bd) (bd = d), (best = idx[q]);
        }
      }
      if (best >= 0) next.push([p, best]);
    }
    if (!next.length) break;
    for (const [p, c] of next) {
      idx[p] = c;
      pending[p] = 0;
    }
  }
}

/**
 * Merges 4-connected same-colour regions smaller than `minArea` into the neighbouring colour they
 * share the longest border with (preferring large neighbours). Returns true if anything changed.
 */
function despeckle(idx: Int16Array, W: number, H: number, minArea: number): boolean {
  const N = W * H;
  const { labels, areas } = labelRegions(idx, W, H);
  if (areas.length <= 1) return false;

  // neighbour colour votes for each small region: [votesFromLarge, votesFromAny]
  const votes = new Map<number, Map<number, [number, number]>>();
  const vote = (lab: number, q: number) => {
    const ql = labels[q];
    if (ql === lab) return;
    let m = votes.get(lab);
    if (!m) votes.set(lab, (m = new Map()));
    const v = m.get(idx[q]) ?? [0, 0];
    if (areas[ql] >= minArea) v[0]++;
    v[1]++;
    m.set(idx[q], v);
  };
  for (let p = 0; p < N; p++) {
    const lab = labels[p];
    if (areas[lab] >= minArea) continue;
    const x = p % W;
    if (x > 0) vote(lab, p - 1);
    if (x < W - 1) vote(lab, p + 1);
    if (p >= W) vote(lab, p - W);
    if (p < N - W) vote(lab, p + W);
  }
  const target = new Map<number, number>();
  for (const [lab, m] of votes) {
    let best = -2;
    let bl = -1;
    let ba = -1;
    for (const [c, [l, a]] of m) {
      if (l > bl || (l === bl && a > ba)) {
        best = c;
        bl = l;
        ba = a;
      }
    }
    if (best !== -2) target.set(lab, best);
  }
  let changed = false;
  for (let p = 0; p < N; p++) {
    const t = target.get(labels[p]);
    if (t !== undefined && t !== idx[p]) {
      idx[p] = t;
      changed = true;
    }
  }
  return changed;
}

/**
 * "Overlapping" stacking: a shape may extend underneath shapes stacked above it, so neighbouring
 * colours never show a hairline gap. The mask grows 1px into higher-ranked pixels and fills any
 * hole that only contains higher-ranked colours (e.g. a background behind a logo has no cut-outs).
 */
function overlapMask(mask: Uint8Array, pr: Int16Array, r: number, W: number, H: number) {
  const N = W * H;
  const grow: number[] = [];
  for (let p = 0; p < N; p++) {
    if (mask[p] || pr[p] <= r) continue;
    const x = p % W;
    if ((x > 0 && mask[p - 1]) || (x < W - 1 && mask[p + 1]) || (p >= W && mask[p - W]) || (p < N - W && mask[p + W])) grow.push(p);
  }
  for (const p of grow) mask[p] = 1;

  // Background regions (8-connected, matching 4-connected foreground) not touching the border.
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const region: number[] = [];
  for (let start = 0; start < N; start++) {
    if (mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let border = false;
    let fillable = true;
    region.length = 0;
    while (sp) {
      const q = stack[--sp];
      region.push(q);
      const x = q % W;
      const y = (q - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (pr[q] <= r) fillable = false;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const n = ny * W + nx;
          if (!mask[n] && !seen[n]) {
            seen[n] = 1;
            stack[sp++] = n;
          }
        }
      }
    }
    if (!border && fillable) for (const q of region) mask[q] = 1;
  }
}

// ---------------------------------------------------------------- contour tracing

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Traces the boundaries of every 4-connected foreground region of `mask`.
 * Returns one entry per region: its loops as flat [x0, y0, x1, y1, …] vertex lists on the pixel
 * grid. Outer contours run clockwise (on screen), holes counter-clockwise.
 */
function traceMask(mask: Uint8Array, W: number, H: number, minArea: number): number[][][] {
  const N = W * H;
  // 4-connected labelling
  const labels = new Int32Array(N).fill(-1);
  const areas: number[] = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (!mask[p] || labels[p] >= 0) continue;
    const lab = areas.length;
    let sp = 0;
    let n = 0;
    stack[sp++] = p;
    labels[p] = lab;
    while (sp) {
      const q = stack[--sp];
      n++;
      const x = q % W;
      if (x > 0 && mask[q - 1] && labels[q - 1] < 0) (labels[q - 1] = lab), (stack[sp++] = q - 1);
      if (x < W - 1 && mask[q + 1] && labels[q + 1] < 0) (labels[q + 1] = lab), (stack[sp++] = q + 1);
      if (q >= W && mask[q - W] && labels[q - W] < 0) (labels[q - W] = lab), (stack[sp++] = q - W);
      if (q < N - W && mask[q + W] && labels[q + W] < 0) (labels[q + W] = lab), (stack[sp++] = q + W);
    }
    areas.push(n);
  }

  // Directed boundary edges, foreground on the right-hand side (screen coords, y down).
  // bit 0 = +x, bit 1 = +y, bit 2 = -x, bit 3 = -y
  const VW = W + 1;
  const out = new Uint8Array(VW * (H + 1));
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (!mask[p]) continue;
      if (y === 0 || !mask[p - W]) out[y * VW + x] |= 1;
      if (x === W - 1 || !mask[p + 1]) out[y * VW + x + 1] |= 2;
      if (y === H - 1 || !mask[p + W]) out[(y + 1) * VW + x + 1] |= 4;
      if (x === 0 || !mask[p - 1]) out[(y + 1) * VW + x] |= 8;
    }
  }

  const byLabel = new Map<number, number[][]>();
  for (let v = 0; v < out.length; v++) {
    while (out[v]) {
      let d = out[v] & 1 ? 0 : out[v] & 2 ? 1 : out[v] & 4 ? 2 : 3;
      const sx = v % VW;
      const sy = (v - sx) / VW;
      // pixel on the right of the first edge
      const px = d === 0 || d === 3 ? sx : sx - 1;
      const py = d === 0 || d === 1 ? sy : sy - 1;
      const lab = labels[py * W + px];
      const pts: number[] = [];
      let x = sx;
      let y = sy;
      for (;;) {
        pts.push(x, y);
        out[y * VW + x] &= ~(1 << d);
        x += DX[d];
        y += DY[d];
        if (x === sx && y === sy) break;
        const o = out[y * VW + x];
        const r = (d + 1) & 3;
        const l = (d + 3) & 3;
        // Prefer turning right: keeps diagonal pixels apart (4-connectivity).
        if (o & (1 << r)) d = r;
        else if (o & (1 << d)) {
          /* straight */
        } else if (o & (1 << l)) d = l;
        else break;
      }
      if (areas[lab] < minArea) continue;
      let list = byLabel.get(lab);
      if (!list) byLabel.set(lab, (list = []));
      list.push(pts);
    }
  }
  return [...byLabel.values()];
}

// ---------------------------------------------------------------- curve fitting

interface Pt {
  x: number;
  y: number;
}
type Seg = [Pt, Pt, Pt, Pt] | [Pt, Pt]; // cubic (p0, c1, c2, p3) or line (p0, p3)

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const fmt = (v: number) => String(Math.round(v * 100) / 100);

function lineIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return add(a, mul(r, t));
}

/** Converts one pixel-grid loop into path data. Returns [pathData, anchorCount]. */
function fitLoop(v: number[], tol: number, cornerDeg: number): [string, number] {
  const n = v.length / 2;
  // Midpoints of the unit edges remove the 1px staircase.
  const M: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    M[i] = { x: (v[2 * i] + v[2 * j]) / 2, y: (v[2 * i + 1] + v[2 * j + 1]) / 2 };
  }
  if (n < 12) {
    const keep = rdpClosed(M, 0.5);
    return [polygon(keep), keep.length];
  }

  // ---- corners ----
  const k = 3;
  const at = (i: number) => M[((i % n) + n) % n];
  // Turn angle measured at a small and a larger scale; a real corner is sharp at both, while a
  // 1px notch from pixel noise only looks sharp at the small scale.
  const k2 = Math.max(k, Math.min(7, Math.floor(n / 8)));
  const turn = (i: number, s: number) => {
    const d1 = sub(at(i - 1), at(i - 1 - s));
    const d2 = sub(at(i + 1 + s), at(i + 1));
    const c = dot(d1, d2) / (len(d1) * len(d2) || 1);
    return (Math.acos(clamp(c, -1, 1)) * 180) / Math.PI;
  };
  const ang = new Float64Array(n);
  for (let i = 0; i < n; i++) ang[i] = Math.min(turn(i, k), turn(i, k2) * 1.1);
  const cornerIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (ang[i] < cornerDeg) continue;
    let isMax = true;
    for (let j = 1; j <= k && isMax; j++) {
      if (ang[(i - j + n) % n] >= ang[i]) isMax = false;
      if (ang[(i + j) % n] > ang[i]) isMax = false;
    }
    if (isMax) cornerIdx.push(i);
  }
  const cornerPt = (i: number): Pt => {
    const p = lineIntersect(at(i - 1 - k), at(i - 1), at(i + 1), at(i + 1 + k));
    return p && len(sub(p, M[i])) < 1.6 ? p : M[i];
  };

  const segs: Seg[] = [];
  if (!cornerIdx.length) {
    const pts = smooth([...M, M[0]], true);
    const t = norm(sub(pts[Math.min(4, n - 1)], pts[n - 1 - Math.min(4, n - 1)]));
    fitChain(pts, t, mul(t, -1), tol, segs, true);
  } else {
    const cps = cornerIdx.map(cornerPt);
    for (let c = 0; c < cornerIdx.length; c++) {
      const i0 = cornerIdx[c];
      const i1 = cornerIdx[(c + 1) % cornerIdx.length];
      const span = (i1 - i0 + n) % n || n;
      const pts: Pt[] = [cps[c]];
      for (let j = 1; j < span; j++) pts.push(at(i0 + j));
      pts.push(cps[(c + 1) % cornerIdx.length]);
      smooth(pts, false);
      const last = pts.length - 1;
      const t1 = norm(sub(pts[Math.min(3, last)], pts[0]));
      const t2 = norm(sub(pts[Math.max(0, last - 3)], pts[last]));
      fitChain(pts, t1, t2, tol, segs);
    }
  }
  const final = straighten(segs);
  let d = `M${fmt(final[0][0].x)} ${fmt(final[0][0].y)}`;
  for (const s of final) {
    if (s.length === 2) d += `L${fmt(s[1].x)} ${fmt(s[1].y)}`;
    else d += `C${fmt(s[1].x)} ${fmt(s[1].y)} ${fmt(s[2].x)} ${fmt(s[2].y)} ${fmt(s[3].x)} ${fmt(s[3].y)}`;
  }
  return [d + 'Z', final.length];
}

/** Two passes of [1 2 1] smoothing to flatten the remaining pixel staircase. Ends stay fixed unless closed. */
function smooth(pts: Pt[], closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 4) return pts;
  for (let pass = 0; pass < 2; pass++) {
    const src = pts.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < n; i++) {
      let a: Pt;
      let b: Pt;
      if (closed) {
        // pts[n-1] duplicates pts[0]
        a = src[i === 0 ? n - 2 : i - 1];
        b = src[i === n - 1 ? 1 : i + 1];
      } else {
        if (i === 0 || i === n - 1) continue;
        a = src[i - 1];
        b = src[i + 1];
      }
      pts[i] = { x: (a.x + 2 * src[i].x + b.x) / 4, y: (a.y + 2 * src[i].y + b.y) / 4 };
    }
  }
  return pts;
}

/**
 * Turns cubics whose handles lie on the chord into lines, then merges runs of collinear lines,
 * so straight edges get one segment instead of several.
 */
function straighten(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    let seg = s;
    if (s.length === 4) {
      const [p0, c1, c2, p3] = s;
      const l = len(sub(p3, p0));
      if (l > 1e-6 && distToSegment(c1, p0, p3) < 0.15 && distToSegment(c2, p0, p3) < 0.15) seg = [p0, p3];
    }
    const prev = out[out.length - 1];
    if (seg.length === 2 && prev && prev.length === 2) {
      const a = prev[0];
      const b = seg[1];
      if (distToSegment(prev[1], a, b) < 0.15) {
        out[out.length - 1] = [a, b];
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

function polygon(pts: Pt[]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + 'Z';
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (!l2) return len(sub(p, a));
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return len(sub(p, add(a, mul(ab, t))));
}

function rdpClosed(pts: Pt[], eps: number): Pt[] {
  // Split the loop at the point farthest from pts[0], then simplify both halves.
  let far = 0;
  let fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = len(sub(pts[i], pts[0]));
    if (d > fd) (fd = d), (far = i);
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const rec = (a: number, b: number) => {
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i % pts.length], pts[a % pts.length], pts[b % pts.length]);
      if (d > md) (md = d), (mi = i);
    }
    if (md > eps && mi >= 0) {
      keep[mi % pts.length] = 1;
      rec(a, mi);
      rec(mi, b);
    }
  };
  rec(0, far);
  rec(far, pts.length);
  return pts.filter((_, i) => keep[i]);
}

/**
 * Fits one corner-to-corner chain. Long straight runs are found first and emitted as lines; the
 * curved pieces between them are fitted with tangents that continue the lines, so a rounded
 * corner flows cleanly into a straight edge instead of wobbling around it.
 */
function fitChain(pts: Pt[], t1: Pt, t2: Pt, tol: number, out: Seg[], closed = false) {
  const n = pts.length;
  const minLen = 18;
  const runs: Run[] = [];
  let i = 0;
  while (i < n - 1) {
    const run = straightRun(pts, i, minLen);
    if (run) {
      // Snap runs that stop just short of a chain end (a corner) onto it.
      if (!closed && run.a <= 3) run.a = 0;
      if (!closed && run.b >= n - 4) run.b = n - 1;
      runs.push(run);
      i = run.b;
    } else i++;
  }
  // Reject runs that are really facets of a gentle arc: the path keeps turning the same way on
  // both sides of a short run, or two runs meet at a shallow angle.
  const cross = (u: Pt, v: Pt) => u.x * v.y - u.y * v.x;
  // In a closed loop (no corners) the chain wraps: pts[n-1] repeats pts[0].
  const at = (k: number) => (closed ? pts[(((k % (n - 1)) + (n - 1)) % (n - 1))] : pts[clamp(k, 0, n - 1)]);
  const curvy = (r: Run) => {
    const L = len(sub(pts[r.b], pts[r.a]));
    if (L >= minLen * 3 || !(closed || (r.a > 0 && r.b < n - 1))) return false;
    const half = Math.max(8, Math.round((r.b - r.a) / 2));
    const before = norm(sub(at(r.a), at(r.a - half)));
    const after = norm(sub(at(r.b + half), at(r.b)));
    const c1 = cross(before, r.d);
    const c2 = cross(r.d, after);
    return Math.sign(c1) === Math.sign(c2) && Math.abs(c1) + Math.abs(c2) > 0.08;
  };
  const keep: Run[] = [];
  for (const r of runs.filter((r) => !curvy(r))) {
    const prev = keep[keep.length - 1];
    if (prev && prev.b === r.a && dot(prev.d, r.d) > 0) {
      const c = Math.abs(cross(prev.d, r.d));
      if (c < 0.05) {
        // practically collinear: one longer line
        keep[keep.length - 1] = lsRun(pts, prev.a, r.b);
        continue;
      }
      if (c < 0.26) {
        // shallow bend: keep only the longer piece
        if (r.b - r.a > prev.b - prev.a) keep[keep.length - 1] = r;
        continue;
      }
    }
    keep.push(r);
  }
  runs.length = 0;
  runs.push(...keep);
  if (!runs.length) {
    fitCubic(pts, 0, n - 1, t1, t2, tol, out);
    return;
  }
  // Move interior run ends onto their fitted lines (or onto the intersection of two touching runs)
  // so the lines are truly straight and neighbouring curves join them without a step.
  const P = pts.slice();
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const prev = runs[r - 1];
    const next = runs[r + 1];
    if (run.a > 0) {
      const x = prev && prev.b === run.a ? lineIntersect(prev.p, add(prev.p, prev.d), run.p, add(run.p, run.d)) : null;
      P[run.a] = x && len(sub(x, pts[run.a])) < 3 ? x : project(pts[run.a], run);
    }
    if (run.b < n - 1 && !(next && next.a === run.b)) P[run.b] = project(pts[run.b], run);
  }
  let pos = 0;
  let inTan = t1;
  for (const r of runs) {
    if (r.a > pos) fitCubic(P, pos, r.a, inTan, mul(r.d, -1), tol, out, false);
    out.push([P[r.a], P[r.b]]);
    pos = r.b;
    inTan = r.d;
  }
  if (pos < n - 1) fitCubic(P, pos, n - 1, inTan, t2, tol, out, false);
}

interface Run {
  a: number;
  b: number;
  /** point on the fitted line and its unit direction (pointing from a to b) */
  p: Pt;
  d: Pt;
}

function lsRun(pts: Pt[], a: number, b: number): Run {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let m = a; m <= b; m++) {
    const q = pts[m];
    sx += q.x;
    sy += q.y;
    sxx += q.x * q.x;
    syy += q.y * q.y;
    sxy += q.x * q.y;
  }
  const cnt = b - a + 1;
  const mx = sx / cnt;
  const my = sy / cnt;
  const th = 0.5 * Math.atan2(2 * (sxy / cnt - mx * my), sxx / cnt - mx * mx - (syy / cnt - my * my));
  let d = { x: Math.cos(th), y: Math.sin(th) };
  if (dot(d, sub(pts[b], pts[a])) < 0) d = mul(d, -1);
  return { a, b, p: { x: mx, y: my }, d };
}

const project = (q: Pt, r: Run): Pt => add(r.p, mul(r.d, dot(sub(q, r.p), r.d)));

/**
 * Longest straight run starting at `i`, judged against a least-squares line (pixel staircases
 * scatter ±0.5px around the true edge, so a chord test would reject them). An arc is rejected by
 * its bow: the middle of the run sits on the other side of the line from its ends.
 */
function straightRun(pts: Pt[], i: number, minLen: number): Run | null {
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let j = i;
  const fit = (cnt: number) => {
    const mx = sx / cnt;
    const my = sy / cnt;
    const a = sxx / cnt - mx * mx;
    const c = syy / cnt - my * my;
    const b = sxy / cnt - mx * my;
    const lam = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
    const th = 0.5 * Math.atan2(2 * b, a - c);
    return { p: { x: mx, y: my }, d: { x: Math.cos(th), y: Math.sin(th) }, rms: Math.sqrt(Math.max(0, lam)) };
  };
  // Grow while the residual stays small.
  for (; j < n; j++) {
    const q = pts[j];
    sx += q.x;
    sy += q.y;
    sxx += q.x * q.x;
    syy += q.y * q.y;
    sxy += q.x * q.y;
    if (j - i >= 3 && fit(j - i + 1).rms > 0.38) {
      sx -= q.x;
      sy -= q.y;
      sxx -= q.x * q.x;
      syy -= q.y * q.y;
      sxy -= q.x * q.y;
      break;
    }
  }
  let b = j - 1;
  // Shrink until it passes the max-deviation and bow tests.
  while (b > i && len(sub(pts[b], pts[i])) >= minLen) {
    const cnt = b - i + 1;
    const f = fit(cnt);
    const nrm = { x: -f.d.y, y: f.d.x };
    let maxDev = 0;
    const third = Math.max(1, Math.floor(cnt / 3));
    let ends = 0;
    let endsN = 0;
    let mid = 0;
    let midN = 0;
    for (let m = i; m <= b; m++) {
      const r = dot(sub(pts[m], f.p), nrm);
      maxDev = Math.max(maxDev, Math.abs(r));
      if (m - i < third || b - m < third) (ends += r), endsN++;
      else (mid += r), midN++;
    }
    const bow = midN && endsN ? Math.abs(mid / midN - ends / endsN) : 0;
    if (maxDev <= 0.9 && bow <= 0.18) {
      let d = f.d;
      if (dot(d, sub(pts[b], pts[i])) < 0) d = mul(d, -1);
      return { a: i, b, p: f.p, d };
    }
    // Recompute sums for a shorter run.
    const nb = b - Math.max(1, Math.floor((b - i) / 6));
    for (let m = nb + 1; m <= b; m++) {
      const q = pts[m];
      sx -= q.x;
      sy -= q.y;
      sxx -= q.x * q.x;
      syy -= q.y * q.y;
      sxy -= q.x * q.y;
    }
    b = nb;
  }
  return null;
}

// Schneider, "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems, 1990).
function fitCubic(pts: Pt[], first: number, last: number, t1: Pt, t2: Pt, tol: number, out: Seg[], top = true) {
  const p0 = pts[first];
  const p3 = pts[last];
  if (last - first === 1) {
    out.push([p0, p3]);
    return;
  }
  // A straight run between two corners becomes a line segment (only for a whole chain: inside a
  // smooth curve a line would break tangent continuity and show as a kink).
  if (top) {
    let dev = 0;
    for (let i = first + 1; i < last; i++) dev = Math.max(dev, distToSegment(pts[i], p0, p3));
    if (dev <= Math.min(tol * 0.5, 0.6)) {
      out.push([p0, p3]);
      return;
    }
  }

  let u = chordParam(pts, first, last);
  let bez = generateBezier(pts, first, last, u, t1, t2);
  let [err, split] = maxError(pts, first, last, bez, u);
  const tol2 = tol * tol;
  if (err < tol2) {
    out.push(bez);
    return;
  }
  if (err < tol2 * 16) {
    for (let it = 0; it < 6; it++) {
      u = reparameterize(pts, first, last, u, bez);
      bez = generateBezier(pts, first, last, u, t1, t2);
      [err, split] = maxError(pts, first, last, bez, u);
      if (err < tol2) {
        out.push(bez);
        return;
      }
    }
  }
  split = clamp(split, first + 1, last - 1);
  let tc = sub(pts[split - 1], pts[split + 1]);
  if (len(tc) < 1e-9) tc = sub(pts[split - 1], pts[split]);
  tc = norm(tc);
  fitCubic(pts, first, split, t1, tc, tol, out, false);
  fitCubic(pts, split, last, mul(tc, -1), t2, tol, out, false);
}

function chordParam(pts: Pt[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(pts: Pt[], first: number, last: number, u: number[], t1: Pt, t2: Pt): [Pt, Pt, Pt, Pt] {
  const p0 = pts[first];
  const p3 = pts[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i <= last - first; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * t * mt * mt;
    const b2 = 3 * t * t * mt;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0;
  let ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps || al > segLen * 1.5 || ar > segLen * 1.5) {
    al = ar = segLen / 3;
  }
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function bezPoint(b: [Pt, Pt, Pt, Pt], t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const c = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return { x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x, y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y };
}

function maxError(pts: Pt[], first: number, last: number, bez: [Pt, Pt, Pt, Pt], u: number[]): [number, number] {
  let maxD = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const p = bezPoint(bez, u[i - first]);
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2;
    if (d >= maxD) {
      maxD = d;
      split = i;
    }
  }
  return [maxD, split];
}

function reparameterize(pts: Pt[], first: number, last: number, u: number[], bez: [Pt, Pt, Pt, Pt]): number[] {
  // One Newton–Raphson step per point.
  const q1 = [mul(sub(bez[1], bez[0]), 3), mul(sub(bez[2], bez[1]), 3), mul(sub(bez[3], bez[2]), 3)];
  const q2 = [mul(sub(q1[1], q1[0]), 2), mul(sub(q1[2], q1[1]), 2)];
  const res = u.slice();
  for (let i = 0; i <= last - first; i++) {
    const t = u[i];
    const mt = 1 - t;
    const p = bezPoint(bez, t);
    const d1 = add(add(mul(q1[0], mt * mt), mul(q1[1], 2 * mt * t)), mul(q1[2], t * t));
    const d2 = add(mul(q2[0], mt), mul(q2[1], t));
    const diff = sub(p, pts[first + i]);
    const num = dot(diff, d1);
    const den = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(den) > 1e-12) res[i] = clamp(t - num / den, 0, 1);
  }
  return res;
}
