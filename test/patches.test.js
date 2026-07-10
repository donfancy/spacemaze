// Tests fuer die Sound-Patches (sound/patches.js): reine Daten-Beschreibungen.
// Geprueft werden die Invarianten, auf die sich audio.js verlaesst (Huellkurven
// klickfrei bei 0 beginnend/endend, Zeiten aufsteigend innerhalb der Dauer)
// und der musikalische Inhalt (Fanfare aufsteigend, Wucht skaliert, Motor-
// Parameter monoton im Tempo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bumpPatch, sizzlePatch, fanfarePatch, fallPatch, risePatch, gnawPatch, engineParams,
  shotPatch, poofPatch, boomPatch, crashPatch,
} from '../src/sound/patches.js';

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
  for (const dur of [1.0, 1.7, 3.0]) {
    checkPatch(fallPatch(dur), `fall(${dur})`);
    checkPatch(risePatch(dur), `rise(${dur})`);
    checkPatch(gnawPatch(dur), `gnaw(${dur})`);
  }
  checkPatch(shotPatch(), 'shot');
  checkPatch(poofPatch(), 'poof');
  checkPatch(boomPatch(), 'boom');
  checkPatch(crashPatch(), 'crash');
});

test('Schuss kurz und leise, Verpuffen weich, Crash kracht am laengsten und lautesten', () => {
  const shot = shotPatch();
  assert.ok(shot.duration <= 0.15, 'Schuss ist knapp (Dauerfeuer 5/s)');
  assert.ok(peakGain(shot) <= 0.2, 'Schuss bleibt leise');
  const osc = shot.voices.find((v) => v.type === 'osc');
  assert.ok(osc.freq[0][1] > osc.freq[osc.freq.length - 1][1] * 3, 'Pew: Gleitton faellt deutlich');

  const poof = poofPatch();
  assert.ok(poof.voices.every((v) => v.type === 'noise'), 'Verpuffen ist reines Rauschen');
  assert.equal(poof.voices[0].filter.type, 'lowpass', 'weich, kein Zischen');
  assert.ok(peakGain(poof) <= 0.2, 'Verpuffen bleibt leise');

  const boom = boomPatch();
  const crash = crashPatch();
  // Steigerung: Abschuss kracht lauter als das Wand-Brutzeln, der Game-Over-
  // Crash uebertrifft alles -- und trudelt am laengsten aus.
  assert.ok(peakGain(boom) > peakGain(sizzlePatch(1)), 'Abschuss > Wand-Brutzeln');
  assert.ok(peakGain(crash) > peakGain(boom), 'Crash ist der lauteste Knall');
  assert.ok(crash.duration > 2 * boom.duration, 'Crash trudelt lange aus');
  // Beide mit gezackter Rausch-Huellkurve (Truemmer-Wellen, kein glatter Puff).
  for (const [p, name] of [[boom, 'boom'], [crash, 'crash']]) {
    const noise = p.voices.find((v) => v.type === 'noise');
    const vals = noise.gain.map(([, v]) => v);
    assert.ok(vals.some((v, i) => i > 1 && v > vals[i - 1]), `${name}: Pegel zackt`);
    // Tiefer Koerper: ein Oszillator faellt in den Keller.
    const body = p.voices.find((v) => v.type === 'osc' && v.shape === 'sine');
    assert.ok(body.freq[body.freq.length - 1][1] < 50, `${name}: Bass faellt in den Keller`);
  }
});

test('fall faellt, rise steigt, beide schwellen zur Mitte an', () => {
  for (const [make, name] of [[fallPatch, 'fall'], [risePatch, 'rise']]) {
    const p = make(1.7);
    const osc = p.voices.find((v) => v.type === 'osc');
    const first = osc.freq[0][1];
    const last = osc.freq[osc.freq.length - 1][1];
    if (name === 'fall') assert.ok(last < first / 3, 'Gleitton faellt deutlich');
    else assert.ok(last > first * 3, 'Gleitton steigt deutlich');
    for (const v of p.voices) {
      const [peakT] = v.gain.reduce((a, b) => (b[1] > a[1] ? b : a));
      assert.ok(peakT > 0.3 * p.duration && peakT < 0.7 * p.duration,
        `${name}: lauteste Stelle um die Mitte (Schwenk-Maximum)`);
    }
  }
  // Schweben ist sanfter als Stuerzen.
  const peak = (p) => Math.max(...p.voices.flatMap((v) => v.gain.map(([, val]) => val)));
  assert.ok(peak(risePatch(1.7)) < peak(fallPatch(1.7)), 'rise leiser als fall');
});

test('gnaw: viele getrennte Bisse, leise und ungleichmaessig', () => {
  const p = gnawPatch(2.6);
  const env = p.voices[0].gain;
  // Bisse = lokale Spitzen (Pegel > 0 zwischen Nullen).
  const levels = env.filter(([, val]) => val > 0).map(([, val]) => val);
  assert.ok(levels.length >= 20, `~10 Bisse/s (${levels.length} bei 2.6 s)`);
  assert.ok(Math.max(...levels) <= 0.25, 'Nagen bleibt leise (Hintergrund)');
  assert.ok(new Set(levels.map((v) => v.toFixed(4))).size > levels.length / 2,
    'Pegel variieren (kein Maschinen-Takt)');
  // Zwischen den Bissen ist Stille (getrennte Knusper, kein Dauerrauschen).
  const zeros = env.filter(([, val]) => val === 0).length;
  assert.ok(zeros >= levels.length, 'jeder Biss ist von Stille umgeben');
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
  // walk bleibt hoerbar leiser als drive; der Abstand ist aber bewusst
  // moderat -- der drive-Grundton selbst ist zurueckgenommen (war zu laut).
  assert.ok(walk.motor.gain + walk.rumble.gain < (drive.motor.gain + drive.rumble.gain) * 0.7,
    'walk ist hoerbar leiser als drive');
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
