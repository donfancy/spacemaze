import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, GameEvent, nextState } from '../src/core/states.js';

test('voller Zyklus Startscreen -> MazeGen -> Falling -> Playing -> Rising -> Map -> Startscreen', () => {
  assert.equal(nextState(State.STARTSCREEN, GameEvent.START), State.MAZE_GEN);
  assert.equal(nextState(State.MAZE_GEN, GameEvent.MAZE_READY), State.FALLING);
  assert.equal(nextState(State.FALLING, GameEvent.FALL_DONE), State.PLAYING);
  assert.equal(nextState(State.PLAYING, GameEvent.EXIT), State.RISING);
  assert.equal(nextState(State.RISING, GameEvent.RISE_DONE), State.MAP);
  assert.equal(nextState(State.MAP, GameEvent.EXIT), State.STARTSCREEN);
});

test('RESUME: von der Karte zurueck ins Reinfallen (Weiterspielen mit Q)', () => {
  assert.equal(nextState(State.MAP, GameEvent.RESUME), State.FALLING);
  assert.equal(nextState(State.PLAYING, GameEvent.RESUME), null, 'RESUME gibt es nur auf der Karte');
});

test('REPLAY: von der Karte in die Wiedergabe und zurueck', () => {
  assert.equal(nextState(State.MAP, GameEvent.REPLAY), State.REPLAY);
  assert.equal(nextState(State.REPLAY, GameEvent.EXIT), State.MAP);
  assert.equal(nextState(State.PLAYING, GameEvent.REPLAY), null, 'REPLAY gibt es nur auf der Karte');
  assert.equal(nextState(State.REPLAY, GameEvent.RESUME), null, 'zurueck ins Spiel nur ueber die Karte');
});

test('Demo-START: Karte und MazeGen springen direkt ins (neue) Fraesen', () => {
  assert.equal(nextState(State.MAP, GameEvent.START), State.MAZE_GEN);
  assert.equal(nextState(State.MAZE_GEN, GameEvent.START), State.MAZE_GEN, 'Re-Enter mit frischem Maze');
});

test('ungueltige Uebergaenge liefern null', () => {
  assert.equal(nextState(State.STARTSCREEN, GameEvent.EXIT), null);
  assert.equal(nextState(State.PLAYING, GameEvent.START), null);
  assert.equal(nextState(State.FALLING, GameEvent.START), null);
  assert.equal(nextState('NONSENSE', GameEvent.START), null);
});

