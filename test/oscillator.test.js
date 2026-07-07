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

test('grosse dt-Schritte bleiben stabil (Regression: Bild-Springen bei Frame-Rucklern)', () => {
  // freq 8 = der Nick-Oszillator im Fahrt-Modus. Beim geclampten Maximal-dt
  // von 0.1 s ist omega*dt ~ 5 -- OHNE Teilschritte explodiert semi-implizites
  // Euler hier (Stabilitaetsgrenze omega*dt < 2) und die Kamera springt wild.
  const o = createOscillator({ freq: 8, damping: 0.3 });
  o.kick(0.8); // voller Kollisions-Impuls (SHAKE_PITCH)
  const bound = 0.8 / (2 * Math.PI * 8); // Amplituden-Schranke v0/omega (ungedaempft)
  let maxAbs = 0;
  for (let i = 0; i < 100; i++) {
    // Wilder Mix aus normalen und langsamen Frames, dazwischen neue Treffer.
    const dt = i % 7 === 0 ? 0.1 : i % 3 === 0 ? 0.05 : 1 / 60;
    if (i % 25 === 0) o.kick(0.8);
    maxAbs = Math.max(maxAbs, Math.abs(o.step(dt)));
  }
  assert.ok(maxAbs <= bound * 1.5, `Auslenkung bleibt beschraenkt (${maxAbs.toFixed(4)} <= ${(bound * 1.5).toFixed(4)})`);
  // Und sie klingt ab: nach 2 s Ruhe praktisch null.
  for (let i = 0; i < 120; i++) o.step(1 / 60);
  assert.ok(Math.abs(o.x) < 1e-4, 'klingt vollstaendig ab');
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
