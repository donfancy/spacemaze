import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, GameEvent, nextState, isValidState } from '../src/core/states.js';

test('voller Zyklus Startscreen -> MazeGen -> Playing -> Startscreen', () => {
  assert.equal(nextState(State.STARTSCREEN, GameEvent.START), State.MAZE_GEN);
  assert.equal(nextState(State.MAZE_GEN, GameEvent.MAZE_READY), State.PLAYING);
  assert.equal(nextState(State.PLAYING, GameEvent.EXIT), State.STARTSCREEN);
});

test('ungueltige Uebergaenge liefern null', () => {
  assert.equal(nextState(State.STARTSCREEN, GameEvent.EXIT), null);
  assert.equal(nextState(State.PLAYING, GameEvent.START), null);
  assert.equal(nextState(State.MAZE_GEN, GameEvent.START), null);
  assert.equal(nextState('NONSENSE', GameEvent.START), null);
});

test('isValidState erkennt gueltige Zustaende', () => {
  assert.ok(isValidState(State.STARTSCREEN));
  assert.ok(isValidState(State.PLAYING));
  assert.ok(!isValidState('FOO'));
});
