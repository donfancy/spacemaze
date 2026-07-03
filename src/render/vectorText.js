// Text-Layout: wandelt einen String in eine Liste von Polylinien in Bildschirm-
// Pixelkoordinaten um. Rein geometrisch, kein Canvas -> headless testbar.
//
// Der Renderer zeichnet die zurueckgegebenen Polylinien danach nur noch (mit Glow).

import { getGlyph, GLYPH_W, GLYPH_H } from './glyphs.js';

// Misst die Pixelmasse eines (einzeiligen) Textes bei gegebener Glyphenhoehe `size`.
// `size` ist die Hoehe einer Glyphe in Pixeln; Monospace-Zellenbreite folgt daraus.
export function measureText(text, opts = {}) {
  const size = opts.size ?? 24;
  const tracking = opts.tracking ?? 1.2; // Abstand zwischen Zellen, in "x-Rastereinheiten" (luftiger, klebt nicht)
  const unit = size / GLYPH_H;            // Pixel pro Rastereinheit
  const cellW = (GLYPH_W + tracking) * unit;

  const lines = String(text).split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const lineGap = opts.lineGap ?? 0.6;    // Zeilenabstand als Anteil von size
  const lineH = size * (1 + lineGap);

  return {
    width: longest > 0 ? longest * cellW - tracking * unit : 0,
    height: lines.length * lineH - (lineH - size),
    cellW,
    lineH,
    unit,
  };
}

// Erzeugt die Polylinien fuer `text`.
// opts:
//   x, y      Ankerposition in Pixeln
//   size      Glyphenhoehe in Pixeln (Default 24)
//   align     'left' | 'center' | 'right'  (horizontale Ausrichtung um x)
//   baseline  'top' | 'middle' | 'bottom'  (vertikale Ausrichtung um y)
//   tracking  Zell-Zusatzabstand in Rastereinheiten (Default 0.4)
//   lineGap   Zeilenabstand als Anteil von size (Default 0.6)
//   angle     Rotation um den Anker (x,y) in Radiant; positiv = im Uhrzeigersinn
//             (Bildschirm-y zeigt nach unten). Default 0.
export function layoutText(text, opts = {}) {
  const size = opts.size ?? 24;
  const align = opts.align ?? 'left';
  const baseline = opts.baseline ?? 'top';
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;

  const m = measureText(text, opts);
  const { cellW, lineH, unit } = m;

  const lines = String(text).split('\n');
  const polylines = [];

  // Vertikaler Startoffset (oberste Zeile, Glyphen-Oberkante).
  let topY = y;
  if (baseline === 'middle') topY = y - m.height / 2;
  else if (baseline === 'bottom') topY = y - m.height;

  lines.forEach((line, lineIndex) => {
    const lineWidth = line.length > 0 ? line.length * cellW - (cellW - GLYPH_W * unit) : 0;

    // Horizontaler Startoffset dieser Zeile.
    let startX = x;
    if (align === 'center') startX = x - lineWidth / 2;
    else if (align === 'right') startX = x - lineWidth;

    const lineTop = topY + lineIndex * lineH;

    for (let i = 0; i < line.length; i++) {
      const glyph = getGlyph(line[i]);
      const cellX = startX + i * cellW;
      for (const stroke of glyph) {
        const poly = stroke.map(([gx, gy]) => [cellX + gx * unit, lineTop + gy * unit]);
        polylines.push(poly);
      }
    }
  });

  // Optionale Rotation der fertigen Polylinien um den Anker (z.B. Kompass-Scheibe).
  const angle = opts.angle ?? 0;
  if (angle !== 0) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return polylines.map((poly) => poly.map(([px, py]) => [
      x + (px - x) * c - (py - y) * s,
      y + (px - x) * s + (py - y) * c,
    ]));
  }

  return polylines;
}
