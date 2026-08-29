// 2026-Engine: SKYBOX-Thema (pur, headless testbar -- kein Three.js).
// Leitet aus Level + Maze-Seed die Zutaten des prozeduralen Himmels ab:
// Nebel-Farbschichten aus der Level-Palette, Galaxien-Band, Sternenstaub
// und die CRESCENDO-Staerke (Boris' Regel: das ganze Spiel ist ein
// Crescendo -- Level 1 hat den dezentesten Himmel, das Arcade-Finale den
// vollsten). Gebacken wird in skybox.js (einmalig in eine Cubemap).

import {
  TEMPEST_BLUE, ARCADE_RED, NEON_MAGENTA, mixColors,
} from '../render/colors.js';
import { levelColor, MIN_LEVEL, MAX_LEVEL } from '../core/levels.js';
import { FIREWORK_COLORS } from '../world/fireworks.js';
import { createRng } from '../util/rng.js';

// Crescendo-Spanne der Nebel-Helligkeit (1.0 = das Maximum, das skybox.js
// unter der Bloom-Schwelle deckelt).
export const SKY_GAIN_MIN = 0.35;
export const SKY_GAIN_MAX = 1.0;

// Akzent zu Tempest-Blau (das Feuerwerks-Cyan; Gruen-Levels nehmen Magenta).
const CYAN = '#00eeff';

// Linear von dezent (Level 1) nach voll (letztes Level).
export function skyGain(level) {
  const t = Math.min(1, Math.max(0, (level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)));
  return SKY_GAIN_MIN + (SKY_GAIN_MAX - SKY_GAIN_MIN) * t;
}

// Bake-Seed: Maze-Seed mit dem Level versalzen -- jedes Level hat seinen
// EIGENEN Himmel, aber Retry (gleiche Maze) zeigt denselben.
function skySeed(level, seed) {
  return ((seed >>> 0) ^ Math.imul(level, 0x9e3779b9)) >>> 0;
}

// Das komplette Himmel-Rezept eines Levels. `layers` sind die FBM-Nebel-
// Schichten (hex + Noise-Frequenz), `band` das blasse Galaxien-Band,
// `horizonFade` 1 = unter dem Horizont ausgeblendet (Welt sitzt auf der
// Wuerfelflaeche), `dust` = Anzahl gebackener Hintergrund-Sterne.
export function skyTheme(level, seed) {
  const base = levelColor(level);
  const rng = createRng(skySeed(level, seed));

  let layers;
  if (base === ARCADE_RED) {
    // Arcade-Finale (26+): Regenbogen-Nebel -- drei VERSCHIEDENE
    // Feuerwerks-Farben, per Seed gemischt (Fisher-Yates).
    const pick = FIREWORK_COLORS.slice();
    for (let i = pick.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
    layers = [
      { hex: pick[0], scale: 2.2 },
      { hex: pick[1], scale: 3.2 },
      { hex: pick[2], scale: 4.0 },
    ];
  } else {
    // Zwei Schichten: Level-Farbe grob, Akzentfarbe feiner.
    const accent = base === TEMPEST_BLUE ? CYAN : NEON_MAGENTA;
    layers = [
      { hex: base, scale: 2.2 },
      { hex: accent, scale: 3.6 },
    ];
  }

  const gain = skyGain(level);
  return {
    seed: skySeed(level, seed),
    gain,
    layers,
    band: { hex: mixColors(base, '#ffffff', 0.5), strength: 0.5 },
    horizonFade: 1,
    dust: Math.round(2000 + 1500 * gain),
  };
}

// Startscreen: wie der Anfang des Crescendos (Level 1, dezentes Gruen),
// fester Seed (kein Maze), volle Kugel -- die Kamera umtanzt den Wuerfel.
export function startscreenSkyTheme() {
  return { ...skyTheme(MIN_LEVEL, 1980), horizonFade: 0 };
}
