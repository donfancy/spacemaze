// Tests fuer die Sound-Patches (sound/patches.js): reine Daten-Beschreibungen.
// Geprueft werden die Invarianten, auf die sich audio.js verlaesst (Huellkurven
// klickfrei bei 0 beginnend/endend, Zeiten aufsteigend innerhalb der Dauer)
// und der musikalische Inhalt (Fanfare aufsteigend, Wucht skaliert, Motor-
// Parameter monoton im Tempo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch, sizzlePatch, fanfarePatch, engineParams } from '../src/sound/patches.js';

const EPS = 1e-9;

// Gemeinsame Invarianten fuer Ereignis-Patches.
function checkPatch(patch, name) {
  assert.ok(patch.duration > 0, `${name}: Dauer positiv`);
  assert.ok(patch.voices.length > 0, `${name}: hat Stimmen`);
  for (const [i, v] of patch.voices.entries()) {
    const tag = `${name} Stimme ${i}`;
    assert.ok(v.type === 'osc' || v.type === 'noise', `${tag}: bekannter Typ`);
    // Huellkurven: Zeiten aufsteigend und innerhalb der Dauer.
    for (const env of [v.gain, v.freq, v.filter?.freq].filter(Boolean)) {
      for (let k = 0; k < env.length; k++) {
        assert.ok(env[k][0] >= -EPS && env[k][0] <= patch.duration + EPS, `${tag}: Zeit in [0, duration]`);
        if (k > 0) assert.ok(env[k][0] > env[k - 1][0], `${tag}: Zeiten streng aufsteigend`);
      }
    }
    // Klickfrei: Lautstaerke beginnt und endet bei 0, bleibt in [0, 1].
    assert.equal(v.gain[0][1], 0, `${tag}: Gain beginnt bei 0`);
    assert.equal(v.gain[v.gain.length - 1][1], 0, `${tag}: Gain endet bei 0`);
    for (const [, val] of v.gain) assert.ok(val >= 0 && val <= 1, `${tag}: Gain in [0,1]`);
    // Tonhoehen/Filterfrequenzen positiv.
    if (v.type === 'osc') for (const [, hz] of v.freq) assert.ok(hz > 0, `${tag}: Frequenz positiv`);
    if (v.filter) for (const [, hz] of v.filter.freq) assert.ok(hz > 0, `${tag}: Filterfrequenz positiv`);
  }
}

function peakGain(patch) {
  return Math.max(...patch.voices.flatMap((v) => v.gain.map(([, val]) => val)));
}

test('bump/sizzle/fanfare erfuellen die Patch-Invarianten', () => {
  for (const impact of [0, 0.5, 1]) {
    checkPatch(bumpPatch(impact), `bump(${impact})`);
    checkPatch(sizzlePatch(impact), `sizzle(${impact})`);
  }
  checkPatch(fanfarePatch(), 'fanfare');
});

test('bump ist dumpf, sizzle brutzelt elektrisch', () => {
  const bump = bumpPatch(1);
  // Nur tiefpass-gefiltertes Rauschen, keine hohen Frequenzen.
  for (const v of bump.voices) {
    if (v.filter) assert.equal(v.filter.type, 'lowpass');
    if (v.type === 'osc') for (const [, hz] of v.freq) assert.ok(hz < 200, 'bump bleibt im Keller');
  }
  const sizzle = sizzlePatch(1);
  const noise = sizzle.voices.find((v) => v.type === 'noise');
  assert.equal(noise.filter.type, 'bandpass', 'Entladungs-Knistern durch Bandpass');
  assert.ok(noise.filter.freq[0][1] > 1000, 'startet hoch (elektrisch)');
  // "Gezackte" Huellkurve: der Pegel steigt zwischendurch wieder an (Knistern).
  const vals = noise.gain.map(([, val]) => val);
  assert.ok(vals.some((val, i) => i > 1 && val > vals[i - 1]), 'Pegel zackt (steigt zwischendurch)');
  assert.ok(peakGain(sizzle) > peakGain(bump), 'sizzle kracht lauter als bump');
});

test('Aufprallwucht skaliert die Lautstaerke monoton', () => {
  for (const make of [bumpPatch, sizzlePatch]) {
    assert.ok(peakGain(make(0.3)) < peakGain(make(1)), 'mehr Wucht = lauter');
    assert.ok(peakGain(make(0)) > 0, 'auch minimale Wucht ist hoerbar');
  }
  assert.ok(sizzlePatch(1).duration > sizzlePatch(0).duration, 'voller Einschlag brutzelt laenger');
});

test('Fanfare: drei aufsteigende Toene, der letzte klingt laenger', () => {
  const f = fanfarePatch();
  assert.equal(f.voices.length, 3);
  const starts = f.voices.map((v) => v.gain[0][0]);
  const freqs = f.voices.map((v) => v.freq[0][1]);
  for (let i = 1; i < 3; i++) {
    assert.ok(starts[i] > starts[i - 1], 'Toene folgen aufeinander');
    assert.ok(freqs[i] > freqs[i - 1], 'Tonhoehe steigt');
  }
  const lens = f.voices.map((v) => v.gain[v.gain.length - 1][0] - v.gain[0][0]);
  assert.ok(lens[2] > lens[0] * 1.5, 'Schlusston klingt aus');
});

test('Motor-Parameter: walk kaum merklich und im Stand still, drive deutlich', () => {
  const still = engineParams('walk', { speed: 0, steer: 0 });
  assert.equal(still.motor.gain, 0, 'stehend: Motor still');
  assert.equal(still.rumble.gain, 0, 'stehend: Rauschen still');
  assert.equal(still.whine.gain, 0, 'walk: nie Sirren');
  const walk = engineParams('walk', { speed: 1 });
  const drive = engineParams('drive', { speed: 1 });
  assert.ok(walk.motor.gain + walk.rumble.gain < (drive.motor.gain + drive.rumble.gain) / 2,
    'walk ist deutlich leiser als drive');
  assert.ok(walk.motor.gain + walk.rumble.gain + walk.whine.gain < 0.1, 'walk: kaum merklich');
  // Drehen im Stand ist als leises Servo-Rauschen hoerbar.
  const turning = engineParams('walk', { speed: 0, steer: 1 });
  assert.ok(turning.rumble.gain > 0 && turning.rumble.gain < walk.rumble.gain, 'Servo leiser als Fahrt');
});

test('Motor-Parameter: Tonhoehe folgt dem Tempo, Sirren der Kurvenneigung', () => {
  const slow = engineParams('drive', { speed: 0.2, bank: 0 });
  const fast = engineParams('drive', { speed: 1, bank: 0 });
  assert.ok(fast.motor.freq > slow.motor.freq, 'schneller = hoeher');
  assert.ok(fast.motor.gain > slow.motor.gain, 'schneller = lauter');
  assert.equal(slow.whine.gain, 0, 'geradeaus: kein Sirren');
  const banked = engineParams('drive', { speed: 1, bank: 1 });
  const light = engineParams('drive', { speed: 1, bank: 0.3 });
  assert.ok(banked.whine.gain > light.whine.gain && light.whine.gain > 0, 'Sirren waechst mit der Neigung');
  assert.ok(banked.whine.freq > light.whine.freq, 'Sirren steigt in der Tonhoehe');
  // Alle Pegel mit Headroom -- Dauerklang darf nie aufdringlich werden.
  for (const p of [slow, fast, banked]) {
    for (const part of [p.motor, p.rumble, p.whine]) assert.ok(part.gain <= 0.15, 'Dauerklang leise');
  }
});
