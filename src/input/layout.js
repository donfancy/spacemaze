// Bildschirm-Aufteilung + Bedien-Deck fuer Touch/Mobile (1.9.2026, Boris'
// Entscheid "Mini-Automat"): im HOCHFORMAT zeigt der obere Teil die 3D-Welt
// mit Querformat-aehnlichen Bildseiten, darunter liegt ein Steuerdeck
// (D-Pad links, FIRE rechts, Aktions-Chips) -- das Handy wird zum kleinen
// Arcade-Automaten. Im QUERFORMAT fuellt die Welt alles, das Deck liegt
// durchsichtig darueber (Zonen an den Raendern, Chips oben rechts).
// Reine Geometrie + Zustands-Tabelle, kein DOM -> headless testbar. Die
// Touch-Eingabe erzeugt daraus exakt die TASTEN der Tastatur (input/touch.js),
// die Spiellogik kennt keine Beruehrung.

import { State } from '../core/states.js';
import { ENGINE_1980, ENGINE_2026 } from '../core/engine.js';
import { measureText } from '../render/vectorText.js';

export const VIEW_SHARE = 0.6; // Hochformat: Anteil der Hoehe fuer die Welt
export const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

// Aktions-"Tasten" jenseits des Spiels (main.js behandelt sie selbst).
export const KEY_MIRROR = 'MIRROR'; // Pad/FIRE-Seiten tauschen

const rect = (x, y, w, h) => ({ x, y, w, h });

// Welt-Ausschnitt (`view`) und Deck-Rechteck (`deck`, null ohne Touch).
// `insets` = sichere Raender (Notch, Home-Indikator) -- die Welt darf
// darunter liegen (schwarz), Bedienelemente nicht.
export function screenLayout({ width, height, touch = false, insets = NO_INSETS }) {
  const portrait = height > width;
  const full = rect(0, 0, width, height);
  if (!touch) return { portrait, view: full, deck: null };
  const innerW = width - insets.left - insets.right;
  if (portrait) {
    const viewH = Math.round(height * VIEW_SHARE);
    return {
      portrait,
      view: rect(0, 0, width, viewH),
      deck: { ...rect(insets.left, viewH, innerW, height - viewH - insets.bottom), overlay: false },
    };
  }
  return {
    portrait,
    view: full,
    deck: { ...rect(insets.left, insets.top, innerW, height - insets.top - insets.bottom), overlay: true },
  };
}

// Chip-Saetze pro Spielzustand: [Taste, Beschriftung, gedimmt?]. Die
// Beschriftung folgt den Hinweiszeilen aus core/hud.js (S = START/RETURN/
// RETRY, X = EXIT/MAP, ...). Demo/Startscreen: Level-Wahl + Engine-Schalter
// + START (die Tasten laufen ueber game.handleKey -> demoKey, wie am Keyboard).
function chipSets(ui) {
  const small = [['M', 'SOUND']];
  const startLike = ui.state === State.STARTSCREEN || ui.demo;
  if (startLike) {
    if (ui.info) return { main: [['X', 'CLOSE']], small };
    const a = ui.arrows ?? {};
    return {
      main: [['ArrowLeft', '←', a.left === false], ['S', 'START'], ['ArrowRight', '→', a.right === false]],
      small: [
        ['ArrowDown', ENGINE_1980, ui.engine === ENGINE_1980],
        ['ArrowUp', ENGINE_2026, ui.engine === ENGINE_2026],
        ['I', 'INFO'], ...small,
      ],
    };
  }
  switch (ui.state) {
    case State.PLAYING:
      return { main: [['X', 'MAP']], small: [...small, [KEY_MIRROR, 'SWAP']] };
    case State.MAP:
      return {
        main: [
          ...(ui.reached ? [] : [['S', ui.gameOver ? 'RETRY' : 'RETURN']]),
          ...(ui.hasReplay ? [['R', 'REPLAY']] : []),
          ['X', 'EXIT'],
        ],
        small,
      };
    case State.REPLAY:
      return {
        main: [[' ', 'PAUSE'], ['ArrowLeft', '←'], ['ArrowRight', '→'],
          ...(ui.cams ? [['C', 'CAM']] : []), ['X', 'MAP']],
        small,
      };
    default:
      return { main: [], small };
  }
}

// Chips einer Reihe nebeneinander legen; `anchor` 'center' (um cx) oder
// 'right' (rechtsbuendig an cx). Breite aus der GEMESSENEN Vektorschrift
// (touchDraw zeichnet mit CHIP_TEXT * h); passt die Reihe nicht in `maxW`,
// schrumpft sie als Ganzes (Hochformat: "RETURN REPLAY EXIT" auf 390 px).
export const CHIP_TEXT = 0.42;
function layoutRow(items, cx, cy, h, anchor, maxW = Infinity) {
  const rowWidth = (hh) => {
    const widths = items.map(([, label]) =>
      Math.max(hh * 1.3, measureText(label, { size: hh * CHIP_TEXT }).width + hh * 0.9));
    const total = widths.reduce((a, b) => a + b, 0) + hh * 0.3 * Math.max(0, items.length - 1);
    return { widths, total };
  };
  let { widths, total } = rowWidth(h);
  if (total > maxW) {
    h *= maxW / total; // Text und Rahmen skalieren mit -> die Reihe passt exakt
    ({ widths, total } = rowWidth(h));
  }
  const gap = h * 0.3;
  let x = anchor === 'right' ? cx - total : cx - total / 2;
  return items.map(([key, label, dim], i) => {
    const w = widths[i];
    const chip = { key, label, dim: !!dim, x, y: cy - h / 2, w, h };
    x += w + gap;
    return chip;
  });
}

// Das Bedien-Modell fuer den aktuellen Zustand -- alles in FENSTER-Pixeln:
//   pad     Floating-D-Pad: Ruhe-Mitte (cx,cy), Radius r, Trefferzone `zone`
//   fire    Feuer-Ring (cx,cy,r) + Zone (die ganze Zone feuert)
//   chips   sichtbare Tasten (Tipp beim Aufsetzen)
//   taps    unsichtbare Tipp-Baender ueber den Startscreen-Zeilen (beim Loslassen)
//   gesture Wisch-/Tipp-Flaeche (Startscreen: Wischen = Pfeile, Tipp = S/X)
//   labels  Beschriftungen unter Pad/Ring
// ui: { state, demo, info, shoot, drive, active, reached, gameOver, hasReplay,
//       cams, engine, arrows, mirror }
export function deckModel(layout, ui) {
  const deck = layout.deck;
  if (!deck) return null;
  const { main, small } = chipSets(ui);
  const model = { frame: deck, pad: null, fire: null, chips: [], taps: [], gesture: null, labels: [] };
  const startLike = ui.state === State.STARTSCREEN || ui.demo;
  const playing = ui.state === State.PLAYING && !ui.demo && ui.active;

  let rowsBottom;
  if (deck.overlay) {
    // Querformat: Chips oben rechts (dort ist in jeder Szene Luft), im
    // Startscreen nur die kleinen -- die grosse Auswahl bedient man per
    // Tipp-Baendern auf den Zeilen selbst und per Wischen.
    const h = Math.max(30, Math.min(44, deck.h * 0.1));
    const right = deck.x + deck.w - 14;
    const top = deck.y + 14;
    // Startscreen: Engine-Chips entfallen auch (Band + Wischen), sonst
    // laege die Reihe ueber der LEVEL-Zeile der 2026-Engine.
    const mainRow = startLike ? [] : main;
    const smallRow = startLike ? small.filter(([k]) => k === 'I' || k === 'M') : small;
    let y = top;
    const maxW = deck.w * 0.6; // rechts oben; die Mitte bleibt der Szene
    if (ui.state === State.MAP && !ui.demo) {
      // Karte: das Quadrat fuellt die Hoehe, frei ist nur der Seitenrand --
      // die Chips stapeln sich dort untereinander.
      for (const item of mainRow) {
        model.chips.push(layoutRow([item], right, y + h / 2, h, 'right')[0]);
        y += h + 8;
      }
    } else if (mainRow.length) {
      model.chips.push(...layoutRow(mainRow, right, y + h / 2, h, 'right', maxW));
      y += h + 8;
    }
    const sh = h * 0.75;
    model.chips.push(...layoutRow(smallRow, right, y + sh / 2, sh, 'right', maxW));
    rowsBottom = y + sh;
  } else {
    // Hochformat-Deck: grosse Reihe, darunter die kleine, darunter Pad/FIRE.
    const h = Math.max(36, Math.min(56, deck.h * 0.15));
    const cx = deck.x + deck.w / 2;
    let y = deck.y + 12;
    const maxW = deck.w - 16;
    if (main.length) { model.chips.push(...layoutRow(main, cx, y + h / 2, h, 'center', maxW)); y += h + 10; }
    const sh = h * 0.7;
    model.chips.push(...layoutRow(small, cx, y + sh / 2, sh, 'center', maxW));
    rowsBottom = y + sh;
  }

  if (playing) {
    let padZone, fireZone, padC, fireC, r;
    if (deck.overlay) {
      const zoneY = deck.y + deck.h * 0.3;
      const zoneH = deck.h * 0.7;
      padZone = rect(deck.x, zoneY, deck.w * 0.45, zoneH);
      fireZone = rect(deck.x + deck.w * 0.55, zoneY, deck.w * 0.45, zoneH);
      r = Math.min(deck.h * 0.17, deck.w * 0.09);
      padC = [deck.x + deck.w * 0.15, deck.y + deck.h * 0.66];
      fireC = [deck.x + deck.w * 0.86, deck.y + deck.h * 0.52];
    } else {
      const areaY = rowsBottom + 8;
      const areaH = deck.y + deck.h - areaY;
      padZone = rect(deck.x, areaY, deck.w / 2, areaH);
      fireZone = rect(deck.x + deck.w / 2, areaY, deck.w / 2, areaH);
      r = Math.min(deck.w * 0.5, areaH) * 0.36;
      padC = [padZone.x + padZone.w / 2, areaY + areaH / 2];
      fireC = [fireZone.x + fireZone.w / 2, areaY + areaH / 2];
    }
    if (ui.mirror) {
      // Spiegel-Schalter (Boris' Frage "Lenken links?"): Seiten tauschen.
      [padZone, fireZone] = [fireZone, padZone];
      const mx = (c) => [2 * (deck.x + deck.w / 2) - c[0], c[1]];
      padC = mx(padC);
      fireC = mx(fireC);
    }
    model.pad = { cx: padC[0], cy: padC[1], r, zone: padZone };
    model.labels.push({ text: ui.drive ? 'STEER' : 'MOVE', x: padC[0], y: padC[1] + r * 1.25 });
    if (ui.shoot) {
      model.fire = { cx: fireC[0], cy: fireC[1], r: r * 0.72, zone: fireZone };
      model.labels.push({ text: 'FIRE', x: fireC[0], y: fireC[1] });
    }
  }

  if (startLike) {
    // Wischen auf der Welt: links/rechts = Level, rauf/runter = Engine;
    // Tipp = S (Info offen: X). Tipp-Baender ueber der LEVEL-Zeile und dem
    // Engine-Schalter (Halbseiten), die "PRESS S"-Zeile ist ein S-Band.
    const v = layout.view;
    model.gesture = { ...v, tapKey: ui.info ? 'X' : 'S' };
    if (!ui.info) {
      const half = v.w / 2;
      model.taps.push(
        { key: 'ArrowLeft', ...rect(v.x, v.y + v.h * 0.06, half, v.h * 0.1) },
        { key: 'ArrowRight', ...rect(v.x + half, v.y + v.h * 0.06, half, v.h * 0.1) },
        { key: 'ArrowDown', ...rect(v.x, v.y + v.h * 0.16, half, v.h * 0.11) },
        { key: 'ArrowUp', ...rect(v.x + half, v.y + v.h * 0.16, half, v.h * 0.11) },
      );
    }
  }
  return model;
}

export function inRect(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
