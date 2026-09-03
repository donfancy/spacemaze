// Tests fuer die Touch-/Mobile-Aufteilung (input/layout.js): Hochformat =
// Mini-Automat (Welt oben, Deck unten), Querformat = durchsichtiges Deck;
// das Bedien-Modell pro Spielzustand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  screenLayout, deckModel, inRect, VIEW_SHARE, KEY_MIRROR,
} from '../src/input/layout.js';
import { State } from '../src/core/states.js';

const PHONE_P = { width: 390, height: 844 };
const PHONE_L = { width: 844, height: 390 };

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function inside(inner, outer) {
  return inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9
    && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;
}

test('ohne Touch: Welt fuellt alles, kein Deck (Desktop unveraendert)', () => {
  const l = screenLayout({ ...PHONE_P, touch: false });
  assert.equal(l.portrait, true);
  assert.deepEqual(l.view, { x: 0, y: 0, w: 390, h: 844 });
  assert.equal(l.deck, null);
});

test('Hochformat + Touch: Welt oben (VIEW_SHARE), Deck darunter, luecken- und ueberlappungsfrei', () => {
  const l = screenLayout({ ...PHONE_P, touch: true });
  assert.equal(l.view.h, Math.round(844 * VIEW_SHARE));
  assert.equal(l.deck.overlay, false);
  assert.equal(l.deck.y, l.view.h);
  assert.equal(l.deck.y + l.deck.h, 844);
  assert.ok(!overlaps(l.view, l.deck));
});

test('Querformat + Touch: Welt voll, Deck als Overlay ueber allem', () => {
  const l = screenLayout({ ...PHONE_L, touch: true });
  assert.equal(l.portrait, false);
  assert.deepEqual(l.view, { x: 0, y: 0, w: 844, h: 390 });
  assert.equal(l.deck.overlay, true);
  assert.deepEqual([l.deck.x, l.deck.y, l.deck.w, l.deck.h], [0, 0, 844, 390]);
});

test('sichere Raender (Notch/Home-Indikator) halten das Deck frei, die Welt nicht', () => {
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  const p = screenLayout({ ...PHONE_P, touch: true, insets });
  assert.equal(p.view.y, 0, 'die Welt darf unter die Notch (schwarz)');
  assert.equal(p.deck.y + p.deck.h, 844 - 34);
  const l = screenLayout({ ...PHONE_L, touch: true, insets: { top: 0, right: 47, bottom: 21, left: 47 } });
  assert.equal(l.deck.x, 47);
  assert.equal(l.deck.w, 844 - 94);
});

const base = {
  state: State.PLAYING, demo: false, info: false, shoot: true, drive: false, active: true,
  reached: false, gameOver: false, hasReplay: false, cams: false, engine: '1980',
  arrows: { left: true, right: true, up: true, down: false }, mirror: false,
};

test('Begehung: Pad links, FIRE rechts, MAP-Chip; alles im Deck (Hochformat)', () => {
  const l = screenLayout({ ...PHONE_P, touch: true });
  const m = deckModel(l, base);
  assert.ok(m.pad && m.fire);
  assert.ok(m.pad.cx < m.fire.cx, 'Lenken links, Feuern rechts (Touch-Konvention)');
  assert.ok(!overlaps(m.pad.zone, m.fire.zone), 'Zonen ueberlappen nicht');
  assert.ok(inside(m.pad.zone, l.deck) && inside(m.fire.zone, l.deck));
  for (const c of m.chips) {
    assert.ok(inside(c, l.deck), 'Chip ' + c.label + ' liegt im Deck');
    assert.ok(!overlaps(c, m.pad.zone) && !overlaps(c, m.fire.zone), 'Chip ' + c.label + ' frei von den Zonen');
  }
  assert.ok(m.chips.some((c) => c.key === 'X' && c.label === 'MAP'));
  assert.ok(m.chips.some((c) => c.key === KEY_MIRROR));
  assert.ok(m.pad.r > 30, 'Pad gross genug fuer den Daumen: ' + m.pad.r);
  assert.equal(m.gesture, null, 'keine Wisch-Flaeche im Spiel');
});

test('Spiegel-Schalter tauscht Pad und FIRE', () => {
  const l = screenLayout({ ...PHONE_L, touch: true });
  const a = deckModel(l, base);
  const b = deckModel(l, { ...base, mirror: true });
  assert.ok(b.pad.cx > b.fire.cx);
  assert.ok(Math.abs(a.pad.cx + b.pad.cx - 844) < 1e-6, 'Pad-Mitte gespiegelt');
  assert.deepEqual(b.pad.zone, a.fire.zone);
});

test('ohne Schiessen kein FIRE; ohne aktive Controls (Crash/Ziel) kein Pad', () => {
  const l = screenLayout({ ...PHONE_L, touch: true });
  assert.equal(deckModel(l, { ...base, shoot: false }).fire, null);
  const m = deckModel(l, { ...base, active: false });
  assert.equal(m.pad, null);
  assert.equal(m.fire, null);
});

test('Chips folgen dem Zustand (Karte, Replay, Schwenks)', () => {
  const l = screenLayout({ ...PHONE_P, touch: true });
  const keys = (ui) => deckModel(l, ui).chips.map((c) => c.key);
  assert.deepEqual(keys({ ...base, state: State.MAP }), ['S', 'X', 'M']);
  assert.deepEqual(keys({ ...base, state: State.MAP, hasReplay: true, gameOver: true }), ['S', 'R', 'X', 'M']);
  assert.ok(deckModel(l, { ...base, state: State.MAP, gameOver: true }).chips[0].label === 'RETRY');
  assert.deepEqual(keys({ ...base, state: State.MAP, reached: true, hasReplay: true }), ['R', 'X', 'M']);
  assert.deepEqual(keys({ ...base, state: State.REPLAY }), [' ', 'ArrowLeft', 'ArrowRight', 'X', 'M']);
  assert.deepEqual(keys({ ...base, state: State.REPLAY, cams: true }), [' ', 'ArrowLeft', 'ArrowRight', 'C', 'X', 'M']);
  assert.deepEqual(keys({ ...base, state: State.FALLING }), ['M']);
});

test('Startscreen (und Demo): Level-Pfeile, START, Engine, INFO; Wisch-Flaeche + Tipp-Baender auf der Welt', () => {
  const l = screenLayout({ ...PHONE_P, touch: true });
  const m = deckModel(l, { ...base, state: State.STARTSCREEN });
  const keys = m.chips.map((c) => c.key);
  assert.deepEqual(keys, ['ArrowLeft', 'S', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'I', 'M']);
  assert.equal(m.chips.find((c) => c.key === 'ArrowDown').dim, true, 'gewaehlte Engine 1980 gedimmt');
  assert.equal(m.chips.find((c) => c.key === 'ArrowLeft').dim, false);
  assert.equal(deckModel(l, { ...base, state: State.STARTSCREEN, arrows: { left: false, right: true } })
    .chips.find((c) => c.key === 'ArrowLeft').dim, true, 'Level 1: links gedimmt');
  assert.deepEqual(m.gesture, { ...l.view, tapKey: 'S' });
  assert.equal(m.taps.length, 4);
  for (const b of m.taps) assert.ok(inside(b, l.view));
  // Demo in der Begehung: dieselbe Auswahl, KEIN Pad (Autopilot faehrt).
  const d = deckModel(l, { ...base, demo: true });
  assert.equal(d.pad, null);
  assert.deepEqual(d.chips.map((c) => c.key), keys);
  // Info offen: nur schliessen, Tipp = X.
  const i = deckModel(l, { ...base, state: State.STARTSCREEN, info: true });
  assert.deepEqual(i.chips.map((c) => c.key), ['X', 'M']);
  assert.equal(i.gesture.tapKey, 'X');
  assert.equal(i.taps.length, 0);
});

test('Querformat-Startscreen: nur kleine Chips oben rechts, die Auswahl laeuft ueber Baender/Wischen', () => {
  const l = screenLayout({ ...PHONE_L, touch: true });
  const m = deckModel(l, { ...base, state: State.STARTSCREEN });
  assert.deepEqual(m.chips.map((c) => c.key), ['I', 'M'], 'Engine-Wahl per Band/Wischen, nicht als Chip');
  for (const c of m.chips) assert.ok(c.x > 844 * 0.6 && c.y < 80, 'oben rechts: ' + c.label);
  assert.ok(m.gesture);
});

test('inRect: halboffen (rechte/untere Kante ausgeschlossen)', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  assert.ok(inRect(r, 10, 10) && inRect(r, 29.9, 29.9));
  assert.ok(!inRect(r, 30, 20) && !inRect(r, 9.9, 20));
});

test('Chip-Reihen passen in die Deck-Breite (Hochformat 390 px: Karte, Startscreen, Replay)', () => {
  const l = screenLayout({ ...PHONE_P, touch: true });
  for (const ui of [
    { ...base, state: State.MAP, hasReplay: true },
    { ...base, state: State.STARTSCREEN },
    { ...base, state: State.REPLAY, cams: true },
  ]) {
    const m = deckModel(l, ui);
    for (const c of m.chips) assert.ok(inside(c, l.deck), ui.state + ': Chip ' + c.label + ' ragt raus');
    assert.ok(m.chips.every((c) => c.h >= 20), ui.state + ': Chips bleiben tippbar (>= 20 px)');
  }
  // Querformat: die Reihe oben rechts laesst die Bildmitte frei.
  const ll = screenLayout({ ...PHONE_L, touch: true });
  const m = deckModel(ll, { ...base, state: State.REPLAY, cams: true });
  for (const c of m.chips) assert.ok(c.x >= 844 * 0.38, 'Replay-Chip ' + c.label + ' bleibt rechts');
});

test('Querformat-Karte: Chips stapeln sich im freien Seitenrand neben dem Quadrat', () => {
  const l = screenLayout({ ...PHONE_L, touch: true });
  const m = deckModel(l, { ...base, state: State.MAP, hasReplay: true });
  const main = m.chips.filter((c) => c.key !== 'M');
  assert.equal(main.length, 3);
  const squareRight = 844 / 2 + 390 * 0.85 / 2; // Karte fuellt 85 % der Hoehe, zentriert
  for (const c of main) assert.ok(c.x > squareRight, c.label + ' liegt rechts neben der Karte');
  for (let i = 1; i < main.length; i++) assert.ok(main[i].y >= main[i - 1].y + main[i - 1].h, 'untereinander');
});
