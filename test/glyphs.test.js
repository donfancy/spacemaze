import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, getGlyph, GLYPH_W, GLYPH_H } from '../src/render/glyphs.js';

test('alle Buchstaben A-Z und Ziffern 0-9 sind definiert', () => {
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    assert.ok(GLYPHS[ch], `Buchstabe ${ch} fehlt`);
  }
  for (let d = 0; d <= 9; d++) {
    assert.ok(GLYPHS[String(d)], `Ziffer ${d} fehlt`);
  }
});

test('Space ist definiert und leer', () => {
  assert.deepEqual(getGlyph(' '), []);
});

test('alle Glyphen-Punkte liegen im Raster [0..W] x [0..H+1]', () => {
  for (const [ch, strokes] of Object.entries(GLYPHS)) {
    for (const stroke of strokes) {
      assert.ok(stroke.length >= 2 || strokes.length === 0,
        `Stroke in '${ch}' braucht mind. 2 Punkte`);
      for (const [x, y] of stroke) {
        assert.ok(x >= 0 && x <= GLYPH_W, `'${ch}': x=${x} ausserhalb`);
        // Unterlaengen (z.B. Komma) duerfen knapp unter die Grundlinie reichen.
        assert.ok(y >= 0 && y <= GLYPH_H + 1, `'${ch}': y=${y} ausserhalb`);
      }
    }
  }
});

test('getGlyph faellt fuer Unbekanntes auf leer zurueck', () => {
  assert.deepEqual(getGlyph('§'), []);
  assert.deepEqual(getGlyph(undefined), []);
});

test('Kleinbuchstaben werden auf Grossbuchstaben gemappt', () => {
  assert.deepEqual(getGlyph('a'), GLYPHS['A']);
});
