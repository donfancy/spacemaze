// Zeichnet das Bedien-Deck (input/layout.js) im Vektor-Look -- NUR ueber die
// Renderer-API (drawPolylines/drawText, Glow in der Level-Farbe), kein
// eigener Canvas-Zugriff. Ein Overlay-Canvas ueber BEIDEN Engines (main.js).

import { PAD_RANGE } from './touch.js';
import { CHIP_TEXT } from './layout.js';

function circle(cx, cy, r, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Chip-Rahmen mit abgeschraegten Ecken (Arcade-Taste).
function chipFrame(c) {
  const k = Math.min(8, c.h * 0.25);
  const { x, y, w, h } = c;
  return [[x + k, y], [x + w - k, y], [x + w, y + k], [x + w, y + h - k], [x + w - k, y + h],
    [x + k, y + h], [x, y + h - k], [x, y + k], [x + k, y]];
}

// Pfeilspitze (Dreieck) in Richtung (ux,uy) um (x,y).
function arrowHead(x, y, ux, uy, s) {
  const px = -uy;
  const py = ux;
  return [[x - ux * s * 0.5 + px * s * 0.6, y - uy * s * 0.5 + py * s * 0.6],
    [x + ux * s * 0.6, y + uy * s * 0.6],
    [x - ux * s * 0.5 - px * s * 0.6, y - uy * s * 0.5 - py * s * 0.6],
    [x - ux * s * 0.5 + px * s * 0.6, y - uy * s * 0.5 + py * s * 0.6]];
}

const DIRS = [
  ['ArrowUp', 0, -1], ['ArrowDown', 0, 1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0],
];

// pad = padState(st) (null in Ruhe), fire = firePressed(st).
export function drawDeck(renderer, model, pad, fire) {
  if (!model) return;
  const f = model.frame;
  if (!f.overlay) {
    // Deck-Kante: die Trennlinie zwischen Bildschirm und Bedienpult.
    renderer.drawPolylines([[[f.x, f.y + 0.5], [f.x + f.w, f.y + 0.5]]], { intensity: 0.35, lineWidth: 1.5 });
  }

  for (const c of model.chips) {
    const on = !c.dim;
    renderer.drawPolylines([chipFrame(c)], { intensity: on ? 0.55 : 0.2, lineWidth: 1.5 });
    renderer.drawText(c.label, {
      x: c.x + c.w / 2, y: c.y + c.h / 2, size: c.h * CHIP_TEXT,
      align: 'center', baseline: 'middle', intensity: on ? 0.9 : 0.3,
    });
  }

  for (const l of model.labels) {
    renderer.drawText(l.text, {
      x: l.x, y: l.y, size: 11, align: 'center', baseline: 'middle', intensity: 0.45,
    });
  }

  if (model.pad) {
    // Floating: aktiv steht das Kreuz am Aufsetzpunkt, der Knopf folgt dem
    // Daumen (geklemmt); in Ruhe ein dezentes Kreuz an der Standard-Mitte.
    const cx = pad ? pad.ox : model.pad.cx;
    const cy = pad ? pad.oy : model.pad.cy;
    const r = model.pad.r;
    const s = r * 0.28;
    const active = pad ? pad.keys : [];
    for (const [key, ux, uy] of DIRS) {
      const on = active.includes(key);
      renderer.drawPolylines([arrowHead(cx + ux * r * 0.78, cy + uy * r * 0.78, ux, uy, s)], {
        intensity: on ? 1 : (pad ? 0.5 : 0.35), lineWidth: on ? 2.5 : 1.5,
      });
    }
    renderer.drawPolylines([circle(cx, cy, r, 40)], { intensity: pad ? 0.45 : 0.22, lineWidth: 1.5 });
    const kr = Math.min(r * 0.32, PAD_RANGE * 0.6);
    const kx = cx + (pad ? pad.dx : 0);
    const ky = cy + (pad ? pad.dy : 0);
    renderer.drawPolylines([circle(kx, ky, kr, 24)], { intensity: pad ? 1 : 0.4, lineWidth: 2 });
  }

  if (model.fire) {
    const { cx, cy, r } = model.fire;
    renderer.drawPolylines([circle(cx, cy, r, 40)], { intensity: fire ? 1 : 0.4, lineWidth: fire ? 2.5 : 1.5 });
    if (fire) renderer.drawPolylines([circle(cx, cy, r * 0.8, 40)], { intensity: 0.7, lineWidth: 1.5 });
  }
}
