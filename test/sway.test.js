// Tests fuer den Bildraum-Schwenk (render/sway.js): Roll als exakte 2D-Rotation,
// Nicken als vertikale Verschiebung -- die 3D-Kamera bleibt horizontal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swayTransform } from '../src/render/sway.js';

const VP = { height: 600, fov: Math.PI / 2 }; // Brennweite = 300 px

test('in Ruhe: keine Drehung, keine Verschiebung', () => {
  const { angle, dy } = swayTransform(0, 0, VP);
  assert.ok(Math.abs(angle) === 0 && Math.abs(dy) === 0);
});

test('roll nach rechts dreht das Bild entgegen (Canvas-Winkel -roll)', () => {
  const { angle, dy } = swayTransform(0.2, 0, VP);
  assert.equal(angle, -0.2);
  assert.equal(Math.abs(dy), 0);
});

test('Blick hebt sich (pitch > 0) -> Szene wandert nach unten, skaliert mit der Brennweite', () => {
  const { angle, dy } = swayTransform(0, 0.05, VP);
  assert.equal(Math.abs(angle), 0);
  assert.ok(Math.abs(dy - Math.tan(0.05) * 300) < 1e-12);
  assert.ok(dy > 0, 'Canvas-y waechst nach unten');
  // Engeres Sichtfeld = laengere Brennweite = staerkere Verschiebung.
  const tele = swayTransform(0, 0.05, { height: 600, fov: Math.PI / 4 });
  assert.ok(tele.dy > dy);
});
