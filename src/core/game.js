// Spiel-Orchestrierung: haelt den aktuellen Zustand, leitet update/render/Eingaben
// an die jeweilige Szene weiter und animiert die Uebergaenge (Fade ueber Schwarz).
//
// Die reine Uebergangslogik (welcher Zustand folgt auf welches Ereignis) liegt in
// states.js und ist dort getestet. Hier kommt das Timing/Animation dazu.

import { State, GameEvent, nextState } from './states.js';
import { createStartscreen } from '../scenes/startscreen.js';
import { createMazeGen } from '../scenes/mazegen.js';
import { createPlaying } from '../scenes/playing.js';

const TRANSITION_DURATION = 0.7; // Sekunden fuer den gesamten Fade out+in

export class Game {
  constructor(options = {}) {
    this.debug = options.debug ?? null;
    this.time = 0;

    // Szenen-Handler. Jede Szene: { enter?, exit?, update?(dt), render?(r), onKey?(key) }.
    this.scenes = {
      [State.STARTSCREEN]: createStartscreen(this),
      [State.MAZE_GEN]: createMazeGen(this),
      [State.PLAYING]: createPlaying(this),
    };

    this.stateKey = State.STARTSCREEN;
    this.transition = { active: false, t: 0, toState: null, switched: false };

    this.current.enter?.();
    this.debug?.log('enter ' + this.stateKey);
  }

  get current() {
    return this.scenes[this.stateKey];
  }

  // Ereignis ausloesen: startet einen animierten Uebergang, falls in diesem
  // Zustand definiert. Waehrend eines laufenden Uebergangs werden Ereignisse ignoriert.
  dispatch(event, opts = {}) {
    if (this.transition.active) return false;
    const target = nextState(this.stateKey, event);
    if (!target) return false;
    if (opts.fade === false) {
      // Nahtloser, sofortiger Wechsel (z.B. Andocken -> Labyrinth: gleiche Kamera).
      this.current.exit?.();
      this.stateKey = target;
      this.current.enter?.();
      this.debug?.log(`${event} -> ${target} (instant)`);
      return true;
    }
    this.transition = { active: true, t: 0, toState: target, switched: false };
    this.debug?.log(`${event} -> ${target}`);
    return true;
  }

  handleKey(key) {
    if (this.transition.active) return;
    this.current.onKey?.(key);
  }

  update(dt) {
    this.time += dt;

    if (this.transition.active) {
      const tr = this.transition;
      tr.t += dt / TRANSITION_DURATION;

      // Bei Halbzeit ist der Bildschirm voll schwarz -> Zustand tatsaechlich wechseln.
      if (!tr.switched && tr.t >= 0.5) {
        tr.switched = true;
        this.current.exit?.();
        this.stateKey = tr.toState;
        this.current.enter?.();
        this.debug?.log('enter ' + this.stateKey);
      }
      if (tr.t >= 1) {
        this.transition = { active: false, t: 0, toState: null, switched: false };
      }
    }

    this.current.update?.(dt);
  }

  render(renderer) {
    this.current.render?.(renderer);

    if (this.transition.active) {
      // Deckkraft 0 -> 1 (erste Haelfte) -> 0 (zweite Haelfte).
      const t = this.transition.t;
      const alpha = t < 0.5 ? t * 2 : (1 - t) * 2;
      renderer.fillBlack(alpha);
    }
  }
}

export { State, GameEvent };
