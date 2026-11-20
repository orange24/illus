import paper from 'paper';

/**
 * Minimal importer for legacy PostScript-based Adobe Illustrator files (AI 3 – AI 8 style art
 * sections), and for the PostScript "Illustrator art" section many newer files still carry
 * when saved without PDF compatibility. It understands paths, compound paths, groups,
 * CMYK / RGB / gray fills and strokes, and line widths.
 */
export function importLegacyAI(text: string, name: string) {
  const bboxMatch =
    text.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) ??
    text.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  const artboard = text.match(/%AI5_ArtboardRect:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  let left = 0;
  let top = 792;
  let right = 612;
  let bottom = 0;
  if (artboard) {
    [left, top, right, bottom] = artboard.slice(1).map(Number);
    if (top < bottom) [top, bottom] = [bottom, top];
  } else if (bboxMatch) {
    [left, bottom, right, top] = bboxMatch.slice(1).map(Number);
  }
  const width = Math.max(1, right - left);
  const height = Math.max(1, top - bottom);
  const tp = (x: number, y: number) => new paper.Point(x - left, top - y);

  // Only parse the artwork section when present.
  let body = text;
  const setupEnd = text.indexOf('%%EndSetup');
  if (setupEnd >= 0) body = text.slice(setupEnd + 10);
  const trailer = body.indexOf('%%PageTrailer');
  if (trailer >= 0) body = body.slice(0, trailer);

  const layer = new paper.Layer({ name: name.replace(/\.[^.]+$/, '') || 'Imported', insert: false });
  const layers: paper.Layer[] = [layer];
  const containers: paper.Item[] = [layer];
  let fill: paper.Color | null = new paper.Color('black');
  let stroke: paper.Color | null = new paper.Color('black');
  let lineWidth = 1;
  let path: paper.Path | null = null;
  let compound: paper.CompoundPath | null = null;
  let count = 0;

  const stackNums: number[] = [];
  const cmyk = (c: number, m: number, y: number, k: number) =>
    new paper.Color((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  const parent = () => containers[containers.length - 1];
  const cur = () => {
    if (!path) path = new paper.Path({ insert: false });
    return path;
  };
  const finish = (doFill: boolean, doStroke: boolean, close: boolean) => {
    if (!path) return;
    const p: paper.Path = path;
    path = null;
    if (close) p.closed = true;
    if (p.segments.length < 2) return;
    if (compound) {
      compound.addChild(p);
      if (doFill) compound.fillColor = fill;
      if (doStroke) {
        compound.strokeColor = stroke;
        compound.strokeWidth = lineWidth;
      }
      return;
    }
    p.fillColor = doFill ? fill : null;
    p.strokeColor = doStroke ? stroke : null;
    p.strokeWidth = lineWidth;
    parent().addChild(p);
    count++;
  };

  const lines = body.split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%')) {
      if (line.startsWith('%AI5_BeginLayer')) {
        // New layer: the name follows in a "Ln" line; create lazily.
        const l = new paper.Layer({ name: `Layer ${layers.length}`, insert: false });
        layers.push(l);
        containers.length = 0;
        containers.push(l);
      }
      continue;
    }
    if (line.endsWith(' Ln')) {
      const m = line.match(/\((.*)\)\s*Ln$/);
      if (m) (containers[0] as paper.Layer).name = m[1];
      continue;
    }
    const tokens = line.match(/\([^)]*\)|[^\s]+/g) ?? [];
    for (const tok of tokens) {
      const n = Number(tok);
      if (!Number.isNaN(n) && /^[-+.\d]/.test(tok)) {
        stackNums.push(n);
        continue;
      }
      if (tok.startsWith('(') || tok.startsWith('[') || tok.startsWith('/')) continue;
      const a = stackNums;
      switch (tok) {
        case 'm':
          if (path && !compound) finish(false, false, false);
          cur().moveTo(tp(a[a.length - 2], a[a.length - 1]));
          break;
        case 'l':
        case 'L':
          cur().lineTo(tp(a[a.length - 2], a[a.length - 1]));
          break;
        case 'c':
        case 'C': {
          const [x1, y1, x2, y2, x3, y3] = a.slice(-6);
          cur().cubicCurveTo(tp(x1, y1), tp(x2, y2), tp(x3, y3));
          break;
        }
        case 'v':
        case 'V': {
          const [x2, y2, x3, y3] = a.slice(-4);
          const p = cur();
          const c1 = p.lastSegment ? p.lastSegment.point : tp(x2, y2);
          p.cubicCurveTo(c1, tp(x2, y2), tp(x3, y3));
          break;
        }
        case 'y':
        case 'Y': {
          const [x1, y1, x3, y3] = a.slice(-4);
          cur().cubicCurveTo(tp(x1, y1), tp(x3, y3), tp(x3, y3));
          break;
        }
        case 'f':
          finish(true, false, true);
          break;
        case 'F':
          finish(true, false, false);
          break;
        case 's':
          finish(false, true, true);
          break;
        case 'S':
          finish(false, true, false);
          break;
        case 'b':
          finish(true, true, true);
          break;
        case 'B':
          finish(true, true, false);
          break;
        case 'n':
        case 'N':
          path = null;
          break;
        case 'k':
          fill = cmyk(...(a.slice(-4) as [number, number, number, number]));
          break;
        case 'K':
          stroke = cmyk(...(a.slice(-4) as [number, number, number, number]));
          break;
        case 'x':
        case 'X': {
          // c m y k (name) tint x
          const nums = a.slice(-5);
          const col = cmyk(nums[0], nums[1], nums[2], nums[3]);
          if (tok === 'x') fill = col;
          else stroke = col;
          break;
        }
        case 'Xa':
        case 'XA': {
          const [r, g, b] = a.slice(-3);
          if (tok === 'Xa') fill = new paper.Color(r, g, b);
          else stroke = new paper.Color(r, g, b);
          break;
        }
        case 'g':
          fill = new paper.Color(a[a.length - 1]);
          break;
        case 'G':
          stroke = new paper.Color(a[a.length - 1]);
          break;
        case 'w':
          lineWidth = a[a.length - 1];
          break;
        case 'u': {
          const g = new paper.Group({ insert: false });
          parent().addChild(g);
          containers.push(g);
          break;
        }
        case 'U':
          if (containers.length > 1) {
            const g = containers.pop()!;
            if (!g.children?.length) g.remove();
          }
          break;
        case '*u':
          compound = new paper.CompoundPath({ insert: false });
          break;
        case '*U':
          if (compound) {
            compound.fillRule = 'evenodd';
            if (compound.children.length) {
              parent().addChild(compound);
              count++;
            }
            compound = null;
          }
          break;
        default:
          break;
      }
      stackNums.length = 0;
    }
  }
  return { width, height, layers: layers.filter((l) => l.children.length), count };
}

/** Quick check: does this look like a PostScript-based AI file with an art section? */
export function looksLikeLegacyAI(text: string) {
  return text.startsWith('%!PS-Adobe') && /%%Creator:.*Illustrator/i.test(text.slice(0, 4000));
}
