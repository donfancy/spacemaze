// Tests fuer den gedaempften Oszillator (mechanische Kamera-Schwingungen).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOscillator } from '../src/math/oscillator.js';

test('ohne Anstoss bleibt der Oszillator in Ruhe', () => {
  const o = createOscillator();
  for (let i = 0; i < 100; i++) o.step(1 / 60);
  assert.equal(o.x, 0);
  assert.equal(o.v, 0);
});

test('kick loest eine abklingende Schwingung aus', () => {
  const o = createOscillator({ freq: 5, damping: 0.2 });
  o.kick(1);
  const xs = [];
  for (let i = 0; i < 600; i++) xs.push(o.step(1 / 120)); // 5 Sekunden
  const maxAbs = Math.max(...xs.map(Math.abs));
  assert.ok(maxAbs > 0.005, 'Auslenkung entsteht');
  // Es schwingt: mehrere Nulldurchgaenge.
  let flips = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.sign(xs[i]) !== Math.sign(xs[i - 1])) flips++;
  }
  assert.ok(flips >= 4, `schwingt (${flips} Nulldurchgaenge)`);
  // Es klingt ab: am Ende deutlich kleiner als das Maximum.
  const tail = Math.max(...xs.slice(-60).map(Math.abs));
  assert.ok(tail < maxAbs * 0.1, 'klingt ab');
});

test('staerkerer kick -> groessere Auslenkung; reset nullt', () => {
  const peak = (kick) => {
    const o = createOscillator({ freq: 6, damping: 0.3 });
    o.kick(kick);
    let m = 0;
    for (let i = 0; i < 240; i++) m = Math.max(m, Math.abs(o.step(1 / 120)));
    return m;
  };
  assert.ok(peak(2) > peak(0.5) * 2, 'Auslenkung skaliert mit dem Impuls');

  const o = createOscillator();
  o.kick(1);
  o.step(1 / 60);
  o.reset();
  assert.equal(o.x, 0);
  assert.equal(o.v, 0);
});
