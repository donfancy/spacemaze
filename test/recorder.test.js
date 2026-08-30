import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORDER, createRecording, recordingStart, recordingDuration, hasRecording,
  recordFrame, recordEvent, sampleAt, eventsBetween, activeEvents, lastEventBefore,
} from '../src/core/recorder.js';

// Bequemer Spieler-Snapshot (nur die Kanaele, Rest darf fehlen).
function snap(px, extra = {}) {
  return {
    px, pz: 0, yaw: 0, roll: 0, pitch: 0, bank: 0, steer: 0, speed: 0,
    shots: [], foeShots: [], enemies: null, spinners: null, flippers: null, pulsars: null,
    ...extra,
  };
}

test('recordFrame tastet mit der Rate ab, nicht pro Frame', () => {
  const rec = createRecording();
  // 60-fps-Frames: nur jeder zweite darf ein Sample erzeugen (Rate 30).
  let stored = 0;
  for (let i = 0; i < 60; i++) {
    if (recordFrame(rec, 1 / 60, snap(i))) stored++;
  }
  assert.ok(stored >= 29 && stored <= 31, `~30 Samples je Sekunde, war ${stored}`);
  assert.ok(Math.abs(recordingDuration(rec) - 1) < 1e-9);
});

test('Snapshots werden geklont -- spaetere Mutation aendert die Aufnahme nicht', () => {
  const rec = createRecording();
  const enemies = [{ x: 1, z: 2, alive: true, phase: 0.5 }];
  recordFrame(rec, 0.1, snap(0, { enemies }));
  enemies[0].x = 99;
  enemies[0].alive = false;
  assert.equal(rec.samples[0].enemies[0].x, 1);
  assert.equal(rec.samples[0].enemies[0].alive, true);
});

test('sampleAt interpoliert die Spieler-Kanaele linear und klemmt die Raender', () => {
  const rec = createRecording();
  recordFrame(rec, 0.1, snap(0, { yaw: 0 }));
  recordFrame(rec, 0.1, snap(1, { yaw: 2 }));
  const mid = sampleAt(rec, 0.15);
  assert.ok(Math.abs(mid.px - 0.5) < 1e-9);
  assert.ok(Math.abs(mid.yaw - 1) < 1e-9);
  // Klemmen: vor dem Anfang -> erstes Sample, nach dem Ende -> letztes.
  assert.equal(sampleAt(rec, -5).px, 0);
  assert.equal(sampleAt(rec, 99).px, 1);
});

test('sampleAt ordnet Schuesse ueber phase zu und interpoliert x/z', () => {
  const rec = createRecording();
  recordFrame(rec, 0.1, snap(0, {
    shots: [{ x: 0, z: 0, dx: 0, dz: -1, age: 0, phase: 2.4 }],
  }));
  recordFrame(rec, 0.1, snap(1, {
    shots: [
      { x: 0, z: -1, dx: 0, dz: -1, age: 0.1, phase: 2.4 },
      { x: 5, z: 5, dx: 0, dz: -1, age: 0, phase: 4.8 }, // neu -- kein Partner davor
    ],
  }));
  const mid = sampleAt(rec, 0.15);
  assert.equal(mid.shots.length, 1, 'Basis ist das Davor-Sample');
  assert.ok(Math.abs(mid.shots[0].z - -0.5) < 1e-9);
  assert.ok(Math.abs(mid.shots[0].age - 0.05) < 1e-9);
});

test('Feind-Listen kommen aus dem Davor-Sample (alive-Stand exakt)', () => {
  const rec = createRecording();
  recordFrame(rec, 0.1, snap(0, { enemies: [{ x: 1, z: 1, alive: true, phase: 0 }] }));
  recordFrame(rec, 0.1, snap(1, { enemies: [{ x: 1, z: 1, alive: false, phase: 0 }] }));
  assert.equal(sampleAt(rec, 0.14).enemies[0].alive, true);
  assert.equal(sampleAt(rec, 0.2).enemies[0].alive, false);
});

test('Event-Spur: eventsBetween/activeEvents/lastEventBefore', () => {
  const rec = createRecording();
  recordFrame(rec, 0.5, snap(0));
  recordEvent(rec, 'bump', { impact: 0.7 });
  recordFrame(rec, 0.5, snap(1));
  recordEvent(rec, 'burst', { spec: { life: 0.8 } });
  recordFrame(rec, 0.5, snap(2));

  assert.equal(eventsBetween(rec, 0, 0.6).length, 1);
  assert.equal(eventsBetween(rec, 0, 2).length, 2);
  assert.equal(eventsBetween(rec, 0.5, 0.5).length, 0, 'Intervall ist (t0, t1]');

  // Der Burst lebt ab t=1: bei 1.5 aktiv (life 0.8), bei 2 nicht mehr.
  assert.equal(activeEvents(rec, 1.5, 'burst', 0.8).length, 1);
  assert.equal(activeEvents(rec, 1.9, 'burst', 0.8).length, 0);
  assert.equal(activeEvents(rec, 0.9, 'burst', 0.8).length, 0, 'vor dem Event nichts');

  assert.equal(lastEventBefore(rec, 2, 'bump').impact, 0.7);
  assert.equal(lastEventBefore(rec, 0.4, 'bump'), null);
});

test('Ringpuffer-Deckel: alte Samples und verwaiste Events fallen weg', () => {
  const rec = createRecording();
  const dt = 1 / RECORDER.rate;
  recordEvent(rec, 'bump', { impact: 1 }); // ganz am Anfang -- muss spaeter wegfallen
  for (let i = 0; i < RECORDER.maxSamples + 100; i++) {
    recordFrame(rec, dt, snap(i));
  }
  assert.equal(rec.samples.length, RECORDER.maxSamples);
  assert.ok(recordingStart(rec) > 0, 'Anfang ist abgeschnitten');
  assert.equal(lastEventBefore(rec, rec.t, 'bump'), null, 'verwaistes Event ist weg');
  // sampleAt klemmt auf den neuen Anfang.
  assert.equal(sampleAt(rec, 0).px, rec.samples[0].px);
});

test('hasRecording: erst ab zwei Samples abspielbar', () => {
  const rec = createRecording();
  assert.equal(hasRecording(rec), false);
  recordFrame(rec, 0.1, snap(0));
  assert.equal(hasRecording(rec), false);
  recordFrame(rec, 0.1, snap(1));
  assert.equal(hasRecording(rec), true);
  assert.equal(hasRecording(null), false);
});
