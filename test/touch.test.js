// Tests fuer den Touch-Automaten (input/touch.js): Floating-D-Pad in acht
// Sektoren, Feuer-Zone, Chips beim Aufsetzen, Wisch/Tipp beim Loslassen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  padKeys, createTouch, touchDown, touchMove, touchUp, touchCancel,
  heldKeys, padState, firePressed, PAD_DEAD, PAD_RANGE, SWIPE_MIN,
} from '../src/input/touch.js';
import { screenLayout, deckModel } from '../src/input/layout.js';
import { State } from '../src/core/states.js';

const UI = {
  state: State.PLAYING, demo: false, info: false, shoot: true, drive: false, active: true,
  reached: false, gameOver: false, hasReplay: false, cams: false, engine: '1980',
  arrows: { left: true, right: true, up: true, down: false }, mirror: false,
};
const LAYOUT = screenLayout({ width: 390, height: 844, touch: true });
const MODEL = deckModel(LAYOUT, UI);

test('padKeys: Totzone, vier Hauptrichtungen, Diagonalen = zwei Pfeile', () => {
  assert.deepEqual(padKeys(0, 0), []);
  assert.deepEqual(padKeys(PAD_DEAD - 1, 0), []);
  assert.deepEqual(padKeys(30, 0), ['ArrowRight']);
  assert.deepEqual(padKeys(-30, 0), ['ArrowLeft']);
  assert.deepEqual(padKeys(0, -30), ['ArrowUp'], 'Bildschirm-y nach unten: oben = negativ');
  assert.deepEqual(padKeys(0, 30), ['ArrowDown']);
  assert.deepEqual(padKeys(30, -30), ['ArrowRight', 'ArrowUp']);
  assert.deepEqual(padKeys(-30, 30), ['ArrowLeft', 'ArrowDown']);
  // Sektorgrenzen bei 22.5 Grad: 20 Grad = nur waagerecht, 25 Grad = beides.
  const at = (deg) => padKeys(50 * Math.cos(deg * Math.PI / 180), -50 * Math.sin(deg * Math.PI / 180));
  assert.deepEqual(at(20), ['ArrowRight']);
  assert.deepEqual(at(25), ['ArrowRight', 'ArrowUp']);
  assert.deepEqual(at(70), ['ArrowUp']);
});

test('Floating-Pad: Ursprung = Aufsetzpunkt, Ziehen haelt Pfeile, Loslassen loest', () => {
  const st = createTouch();
  const z = MODEL.pad.zone;
  const x0 = z.x + 20;
  const y0 = z.y + z.h - 20; // irgendwo in der Zone, NICHT auf der Ruhe-Mitte
  assert.deepEqual(touchDown(st, MODEL, 1, x0, y0), []);
  assert.deepEqual([...heldKeys(st)], [], 'ohne Auslenkung nichts');
  touchMove(st, 1, x0 + 40, y0);
  assert.deepEqual([...heldKeys(st)], ['ArrowRight']);
  const ps = padState(st);
  assert.equal(ps.ox, x0);
  assert.equal(ps.oy, y0);
  assert.equal(ps.dx, 40);
  touchMove(st, 1, x0 + 200, y0 - 200);
  assert.deepEqual([...heldKeys(st)], ['ArrowRight', 'ArrowUp']);
  const clamped = padState(st);
  assert.ok(Math.abs(Math.hypot(clamped.dx, clamped.dy) - PAD_RANGE) < 1e-9, 'Knopf-Auslenkung geklemmt');
  assert.deepEqual(touchUp(st, MODEL, 1), []);
  assert.deepEqual([...heldKeys(st)], []);
  assert.equal(padState(st), null);
});

test('Feuer-Zone haelt Space; zwei Finger gleichzeitig (Pad + Feuer)', () => {
  const st = createTouch();
  const f = MODEL.fire.zone;
  touchDown(st, MODEL, 7, f.x + f.w - 5, f.y + 5);
  assert.ok(firePressed(st));
  assert.deepEqual([...heldKeys(st)], [' ']);
  const z = MODEL.pad.zone;
  touchDown(st, MODEL, 8, z.x + z.w / 2, z.y + z.h / 2);
  touchMove(st, 8, z.x + z.w / 2, z.y + z.h / 2 - 50);
  assert.deepEqual([...heldKeys(st)].sort(), [' ', 'ArrowUp']);
  touchCancel(st, 7);
  assert.deepEqual([...heldKeys(st)], ['ArrowUp']);
});

test('Chips tippen beim Aufsetzen (nicht beim Loslassen), gedimmte nicht', () => {
  const st = createTouch();
  const map = MODEL.chips.find((c) => c.key === 'X');
  assert.deepEqual(touchDown(st, MODEL, 1, map.x + 1, map.y + 1), ['X']);
  assert.deepEqual(touchUp(st, MODEL, 1), []);
  const start = deckModel(LAYOUT, { ...UI, state: State.STARTSCREEN });
  const dim = start.chips.find((c) => c.key === 'ArrowDown');
  assert.equal(dim.dim, true);
  assert.deepEqual(touchDown(st, start, 2, dim.x + 2, dim.y + 2), []);
});

test('Startscreen-Gesten: Wisch = Pfeil in Wischrichtung, Tipp = S, Band-Tipp = Zeilen-Taste', () => {
  const start = deckModel(LAYOUT, { ...UI, state: State.STARTSCREEN });
  const v = LAYOUT.view;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2; // Wuerfel-Mitte, kein Band
  const st = createTouch();
  touchDown(st, start, 1, cx, cy, 0);
  touchMove(st, 1, cx + SWIPE_MIN + 5, cy + 3);
  assert.deepEqual(touchUp(st, start, 1, 0.2), ['ArrowRight']);
  touchDown(st, start, 2, cx, cy, 0);
  touchMove(st, 2, cx - 2, cy - SWIPE_MIN - 10);
  assert.deepEqual(touchUp(st, start, 2, 0.2), ['ArrowUp'], 'rauf = 2026');
  touchDown(st, start, 3, cx, cy, 0);
  touchMove(st, 3, cx + 5, cy + 4);
  assert.deepEqual(touchUp(st, start, 3, 0.2), ['S'], 'kurzer Tipp auf den Wuerfel startet');
  touchDown(st, start, 4, cx, cy, 0);
  assert.deepEqual(touchUp(st, start, 4, 2.0), [], 'lange gehalten = kein Tipp');
  // Tipp-Baender: LEVEL-Zeile links/rechts, Engine-Zeile unten/oben.
  const band = (key) => start.taps.find((b) => b.key === key);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp']) {
    const b = band(key);
    touchDown(st, start, 5, b.x + b.w / 2, b.y + b.h / 2, 0);
    assert.deepEqual(touchUp(st, start, 5, 0.1), [key]);
  }
  // Info offen: Tipp schliesst (X).
  const info = deckModel(LAYOUT, { ...UI, state: State.STARTSCREEN, info: true });
  touchDown(st, info, 6, cx, cy, 0);
  assert.deepEqual(touchUp(st, info, 6, 0.1), ['X']);
});

test('ausserhalb aller Zonen passiert nichts; ohne Modell ebenso', () => {
  const st = createTouch();
  assert.deepEqual(touchDown(st, MODEL, 1, 5, 5), []); // Welt-Bereich, im Spiel keine Geste
  assert.deepEqual(touchUp(st, MODEL, 1), []);
  assert.deepEqual(touchDown(st, null, 2, 5, 5), []);
  assert.deepEqual([...heldKeys(st)], []);
});
