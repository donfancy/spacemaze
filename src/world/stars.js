// Sternenhimmel ueber dem Labyrinth (ab Level 4 -- die Level 1-3 bleiben
// "legacy 1974", sagt Boris): weltfeste Sterne in der Level-Farbe am
// sichtbaren Himmel der Ego-Ansicht. Weil die Sterne an ihren WELT-
// Richtungen kleben, macht ihr Vorbeiziehen jede Drehung spuerbar.
// Reine Daten + Berechnung, kein Canvas -> headless testbar.
//
// Verdeckung: Sterne stehen "im Unendlichen" -- sichtbar ist ein Stern nur,
// wenn seine Elevation UEBER der Wand-Silhouette in seiner Richtung liegt
// (skylineElevation: EXAKTER Grid-DDA zur naechsten Wand; deren Oberkante
// begrenzt den Himmel). So gehen Sterne hinter nahen Waenden unter und
// tauchen beim Fahren wieder auf, statt durch die Waende zu scheinen.
// FALLE (14.7.2026 gefixt): ein abtastender Raycast (feste Schrittweite)
// trifft die Wandflaeche systematisch ZU SPAET und ueberspringt schraeg
// gestreifte 1-Einheit-Waende ganz -- die Silhouette war in 95% der
// Richtungen zu niedrig, Sterne schienen durch die Wand. Der DDA springt
// von Zellkante zu Zellkante (Metrik: ungleiche Breiten!) und liefert die
// exakte Eintritts-Distanz.

import { OPEN } from './maze.js';
import { mazeMetric } from './metric.js';

export const STARS = {
  count: 250,         // Sterne am Himmel (im Sichtfeld steht davon ein Bruchteil)
  minLevel: 4,        // ab diesem Level funkelt es (1-3 "legacy 1974")
  minElevation: 0.12, // rad ueber dem Horizont -- tiefere Sterne gibt es nicht
  margin: 0.02,       // rad Sicherheitsabstand ueber der Wand-Silhouette
  range: 6,           // Sichtweite des DDA (Gangbreiten, wie FAR_RATIO) --
                      // fernere Waende sind niedriger als minElevation
  dist: 60,           // Abstand der Sternpunkte (Gangbreiten, quasi unendlich)
  twinkle: 1.1,       // Funkel-Grundfrequenz (Hz)
  maxSize: 1.6,       // groesste Stern-Halbgroesse (Bildschirm-Pixel)
};

// Deterministischer Hash 0..1 (wie fireworks.js) -- gleiche Karte, gleicher Himmel.
function hash(i, salt, seed) {
  const s = Math.sin(i * 127.1 + salt * 311.7 + (seed % 9973) * 0.618) * 43758.5453;
  return s - Math.floor(s);
}

// Erzeugt den Sternhimmel eines Levels: [{ az, el, size, phase }].
// az = Azimut (Welt, rad), el = Elevation ueber dem Horizont, size in Pixeln.
// Gleichverteilt nach FLAECHE auf der Halbkugel oberhalb minElevation
// (el = asin(u) -- sonst draengeln sich die Sterne am Zenit).
export function createStars(seed, opts = {}) {
  const count = opts.count ?? STARS.count;
  const u0 = Math.sin(STARS.minElevation);
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      az: hash(i, 1, seed) * 2 * Math.PI,
      el: Math.asin(u0 + (1 - u0) * hash(i, 2, seed)),
      size: STARS.maxSize * (0.45 + 0.55 * hash(i, 3, seed)),
      phase: hash(i, 4, seed) * 2 * Math.PI,
    });
  }
  return stars;
}

// Richtungsvektor eines Sterns (lokale Flaechen-Welt: x/z horizontal, y hoch).
export function starDirection(az, el) {
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

// Elevation der Wand-Silhouette in Richtung az von (px,pz) aus gesehen:
// exakter Grid-DDA -- von Zellkante zu Zellkante springen (die Metrik
// liefert die Kanten-Positionen, Zellbreiten sind ungleich!), jede
// durchquerte Zelle pruefen. Die Oberkante der ersten Wand (wallHeight
// ueber dem Boden, Auge auf eye) begrenzt den Himmel; naehere Waende
// stehen steiler, fernere flacher -- die erste ist darum die Silhouette.
// Ohne Wand in Reichweite (oder jenseits des Randes): 0, offener Horizont.
// opts = { unit, cell, eye, wallHeight, range? }.
export function skylineElevation(maze, px, pz, az, opts) {
  const { unit, cell, eye, wallHeight, range = STARS.range } = opts;
  const { toGrid, toUnits } = mazeMetric(maze);
  const dx = Math.sin(az);
  const dz = Math.cos(az);
  const max = range * cell;
  let gx = Math.floor(toGrid(px / unit));
  let gz = Math.floor(toGrid(pz / unit));
  // Naechste Zellkante voraus: bei positiver Richtung die Kante der
  // naechsten Zelle, bei negativer die eigene Vorderkante.
  const edge = (g, dir) => (dir > 0 ? g + 1 : g);
  for (let guard = 0; guard < 4 * maze.n; guard++) {
    const tx = Math.abs(dx) > 1e-12
      ? (toUnits(edge(gx, dx)) * unit - px) / dx : Infinity;
    const tz = Math.abs(dz) > 1e-12
      ? (toUnits(edge(gz, dz)) * unit - pz) / dz : Infinity;
    const d = Math.min(tx, tz);
    if (d > max) break;
    if (tx <= tz) gx += dx > 0 ? 1 : -1;
    else gz += dz > 0 ? 1 : -1;
    if (gx < 0 || gx >= maze.n || gz < 0 || gz >= maze.n) break;
    if (maze.grid[gz][gx] !== OPEN) return Math.atan2(wallHeight - eye, d);
  }
  return 0;
}

// Funkeln: sanfte, deterministische Helligkeit ~0.3..0.9 -- zwei nicht
// harmonische Sinus-Wellen, jede Phase individuell (kein Gleichtakt).
export function starTwinkle(star, time) {
  const w = Math.sin(2 * Math.PI * STARS.twinkle * time + star.phase)
    + 0.6 * Math.sin(2 * Math.PI * 2.7 * STARS.twinkle * time + 2.3 * star.phase);
  return 0.6 + 0.1875 * w;
}
