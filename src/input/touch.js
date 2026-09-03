// Touch-Automat (1.9.2026): uebersetzt Finger auf dem Bedien-Deck
// (input/layout.js) in TASTEN -- gehaltene (Pad-Pfeile, Feuer = Space) und
// getippte (Chips, Wisch-Gesten, Tipp-Baender). main.js speist beides genau
// wie keydown/keyup in game.keys/handleKey; die Spiellogik bleibt 1:1.
// Reine Zustandsmaschine ohne DOM -> headless testbar.
//
// FLOATING D-PAD (Boris' Wahl): das Kreuz entsteht dort, wo der Daumen
// aufsetzt; ab PAD_DEAD Pixeln Auslenkung gilt eine Richtung, 8 Sektoren
// (diagonal = zwei Pfeile, wie zwei gehaltene Tasten). Man muss nie
// hinschauen. Feuer: die ganze Zone haelt Space (Dauerfeuer).

import { inRect } from './layout.js';

export const PAD_DEAD = 14;   // px: ab hier zaehlt eine Richtung
export const PAD_RANGE = 44;  // px: max. Knopf-Auslenkung (Zeichnung)
export const SWIPE_MIN = 40;  // px: ab hier Wisch statt Tipp
export const TAP_MAX_T = 0.5; // s: laenger gehalten = kein Tipp

const DIAG = Math.tan(Math.PI / 8); // 22.5 Grad: Sektorgrenze

// Pfeiltasten aus der Pad-Auslenkung (Bildschirm-y nach unten).
export function padKeys(dx, dy) {
  if (Math.hypot(dx, dy) < PAD_DEAD) return [];
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const keys = [];
  if (ax >= ay * DIAG) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (ay >= ax * DIAG) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  return keys;
}

export function createTouch() {
  return { pointers: new Map() };
}

// Finger setzt auf. Reihenfolge: Chip > Pad-Zone > Feuer-Zone > Geste.
// Liefert sofort auszuloesende Tasten (Chips tippen beim Aufsetzen --
// Arcade-Knopf-Gefuehl).
export function touchDown(st, model, id, x, y, t = 0) {
  if (!model) return [];
  const chip = model.chips.find((c) => inRect(c, x, y));
  if (chip) {
    st.pointers.set(id, { role: 'chip', key: chip.key });
    return chip.dim ? [] : [chip.key];
  }
  if (model.pad && inRect(model.pad.zone, x, y)) {
    st.pointers.set(id, { role: 'pad', ox: x, oy: y, x, y });
    return [];
  }
  if (model.fire && inRect(model.fire.zone, x, y)) {
    st.pointers.set(id, { role: 'fire' });
    return [];
  }
  if (model.gesture && inRect(model.gesture, x, y)) {
    st.pointers.set(id, { role: 'gesture', ox: x, oy: y, x, y, t });
    return [];
  }
  return [];
}

export function touchMove(st, id, x, y) {
  const p = st.pointers.get(id);
  if (p) { p.x = x; p.y = y; }
}

// Finger hebt ab. Gesten entscheiden sich hier: Wisch (>= SWIPE_MIN) ->
// Pfeil in Wischrichtung, kurzer Tipp -> Band-Taste bzw. tapKey der Flaeche.
export function touchUp(st, model, id, t = 0) {
  const p = st.pointers.get(id);
  if (!p) return [];
  st.pointers.delete(id);
  if (p.role !== 'gesture' || !model?.gesture) return [];
  const dx = p.x - p.ox;
  const dy = p.y - p.oy;
  if (Math.hypot(dx, dy) >= SWIPE_MIN) {
    return [Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (dy > 0 ? 'ArrowDown' : 'ArrowUp')];
  }
  if (t - p.t > TAP_MAX_T) return [];
  const band = model.taps.find((b) => inRect(b, p.ox, p.oy));
  return [band ? band.key : model.gesture.tapKey];
}

export function touchCancel(st, id) {
  st.pointers.delete(id);
}

// Aktuell gehaltene Tasten (Pad-Pfeile + Space der Feuer-Zone).
export function heldKeys(st) {
  const keys = new Set();
  for (const p of st.pointers.values()) {
    if (p.role === 'pad') for (const k of padKeys(p.x - p.ox, p.y - p.oy)) keys.add(k);
    else if (p.role === 'fire') keys.add(' ');
  }
  return keys;
}

// Zeichen-Zustand des Pads: Ursprung + geklemmte Auslenkung, null in Ruhe.
export function padState(st) {
  for (const p of st.pointers.values()) {
    if (p.role !== 'pad') continue;
    let dx = p.x - p.ox;
    let dy = p.y - p.oy;
    const d = Math.hypot(dx, dy);
    if (d > PAD_RANGE) { dx *= PAD_RANGE / d; dy *= PAD_RANGE / d; }
    return { ox: p.ox, oy: p.oy, dx, dy, keys: padKeys(p.x - p.ox, p.y - p.oy) };
  }
  return null;
}

export function firePressed(st) {
  for (const p of st.pointers.values()) if (p.role === 'fire') return true;
  return false;
}
