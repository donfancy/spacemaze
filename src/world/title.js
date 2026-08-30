// Titel-Display "SPACE MAZE" (Boot + Attract-Zyklus) als reine Daten und
// Funktionen fuer BEIDE Engines -- Vorbild: das Tempest-Titel-Display.
//   1980: der Schriftzug fliegt aus der Tiefe heran (titleZoom), haelt mit
//         harten Arcade-Farbwechseln (titleColor, Echo-Konturen in den
//         Nachbarfarben) und verglimmt im weissen Blitz (titleFlash).
//   2026: dicke Block-Buchstaben aus VOXELN (titleCells, 5x7-Schrift), die
//         von der Wuerfel-Oberflaeche (voxelOrigin) gestaffelt in den
//         Schriftzug fliegen (voxelProgress), die Farben durchlaufen und im
//         Goal-Glanz zerbersten (voxelBurst).
// Alles deterministisch (Hash je Voxel), ohne Canvas/DOM -> headless testbar.

import { FIREWORK_COLORS } from './fireworks.js';

export const TITLE_WORD = 'SPACE MAZE';

// Phasen in Sekunden: Aufbau -> Halten (Farb-Zyklus) -> Finale (weiss).
export const TITLE = { assemble: 3.0, hold: 3.4, finale: 1.6, dur: 8.0 };

// 5x7-Blockschrift der Titel-Buchstaben ('#' = Voxel).
const FONT = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};
const LETTER_STEP = 6;  // 5 Spalten Buchstabe + 1 Spalte Luecke
const HALF_SPACE = 3;   // Boris: nur ein HALBES Blank zwischen den Woertern

// Voxel-Zellen des Schriftzugs, zentriert um (0,0): x nach rechts in
// Spalten, y nach OBEN in Zeilen.
export function titleCells(word = TITLE_WORD) {
  const cells = [];
  let cursor = 0;
  for (const ch of word) {
    if (ch === ' ') {
      cursor += HALF_SPACE;
      continue;
    }
    const rows = FONT[ch];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === '#') cells.push({ x: cursor + c, y: rows.length - 1 - r });
      }
    }
    cursor += LETTER_STEP;
  }
  const width = cursor - 1; // letzte Buchstaben-Luecke zaehlt nicht
  for (const cell of cells) {
    cell.x -= (width - 1) / 2;
    cell.y -= 3;
  }
  return cells;
}

// Deterministischer Hash je Voxel -> stabile Streuung ueber alle Frames.
function hash01(i, salt) {
  let h = (i * 2654435761 + salt * 340573321) >>> 0;
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  return ((h >>> 8) & 0xffff) / 0x10000;
}

// Startpunkt eines Voxels AUF der Wuerfel-Oberflaeche (Einheitswuerfel
// -1..1; der Renderer skaliert mit der halben Kantenlaenge): eine der sechs
// Flaechen plus zwei Flaechen-Koordinaten, alles aus dem Hash.
export function voxelOrigin(i) {
  const face = Math.floor(hash01(i, 3) * 6);
  const u = hash01(i, 4) * 2 - 1;
  const v = hash01(i, 5) * 2 - 1;
  const axis = face >> 1;
  const sign = (face & 1) ? -1 : 1;
  const p = [0, 0, 0];
  p[axis] = sign;
  p[(axis + 1) % 3] = u;
  p[(axis + 2) % 3] = v;
  return { x: p[0], y: p[1], z: p[2] };
}

// Aufbau-Fortschritt eines Voxels (0 = am Wuerfel, 1 = im Schriftzug):
// gestaffelter Start + weiches Ease-out -- die Buchstaben "rieseln" zusammen.
export function voxelProgress(t, i) {
  const delay = hash01(i, 1) * (TITLE.assemble * 0.55);
  const rise = TITLE.assemble * 0.45;
  const p = Math.min(1, Math.max(0, (t - delay) / rise));
  return 1 - (1 - p) ** 3;
}

// Groessen-Anteil eines Voxels (0..1): UNSICHTBAR bis zum eigenen Start --
// sonst steht der komplette Schriftzug vorab als Mini-Voxel-Teppich auf
// der Wuerfel-Oberflaeche (Boris' Befund) -- dann schnelles Aufpoppen
// beim Abheben und Wachsen auf dem Flug zur vollen Groesse.
export function voxelSize(t, i) {
  const p = voxelProgress(t, i);
  return Math.min(1, p * 6) * (0.35 + 0.65 * p);
}

// Finale: radiales Zerbersten in der Schrift-Ebene (Einheiten = Voxelraster)
// + Ausblenden. Vor dem Finale ruht alles (fade 1, kein Versatz).
export function voxelBurst(t, i, cell) {
  const ft = t - TITLE.assemble - TITLE.hold;
  if (ft <= 0) return { dx: 0, dy: 0, dz: 0, fade: 1 };
  const e = Math.min(1, ft / TITLE.finale);
  const speed = (8 + 14 * hash01(i, 2)) * e;
  const len = Math.hypot(cell.x, cell.y) || 1;
  return {
    dx: (cell.x / len) * speed,
    dy: (cell.y / len) * speed + 2 * e * (hash01(i, 6) - 0.3),
    dz: (hash01(i, 7) - 0.5) * 6 * e,
    fade: (1 - e) ** 2,
  };
}

// Farb-Zyklus: harte Arcade-Wechsel durch die Feuerwerks-Palette; im Finale
// WEISS (Goal-Glanz). `ring` verschiebt im Zyklus (Echo-Konturen 1980).
export function titleColor(t, ring = 0) {
  if (t >= TITLE.assemble + TITLE.hold) return '#ffffff';
  const idx = Math.floor(t * 7) + ring;
  return FIREWORK_COLORS[((idx % FIREWORK_COLORS.length) + FIREWORK_COLORS.length) % FIREWORK_COLORS.length];
}

// Weisser Glanz-Blitz am Finale-Beginn (0..1, klingt schnell ab).
export function titleFlash(t) {
  const ft = t - TITLE.assemble - TITLE.hold;
  if (ft < 0) return 0;
  return Math.max(0, 1 - ft / (TITLE.finale * 0.6)) ** 2;
}

// 1980: Groessen-Anteil des Zooms aus der Tiefe (0.06 -> 1, Ease-out).
export function titleZoom(t) {
  const p = Math.min(1, t / TITLE.assemble);
  return 0.06 + 0.94 * (1 - (1 - p) ** 3);
}

// 1980: Deckkraft -- im Finale blendet der Titel mit dem Blitz aus.
export function titleAlpha(t) {
  const ft = t - TITLE.assemble - TITLE.hold;
  if (ft <= 0) return 1;
  return Math.max(0, 1 - ft / TITLE.finale);
}
