// Spiel-Orchestrierung: haelt den aktuellen Zustand, leitet update/render/Eingaben
// an die jeweilige Szene weiter und animiert die Uebergaenge (Fade ueber Schwarz).
//
// Die reine Uebergangslogik (welcher Zustand folgt auf welches Ereignis) liegt in
// states.js und ist dort getestet. Hier kommt das Timing/Animation dazu.

import { State, GameEvent, nextState } from './states.js';
import { levelColor, levelConfig } from './levels.js';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import { createEnemies } from '../world/enemies.js';
import { createSpinners } from '../world/spinners.js';
import { createFlippers } from '../world/flippers.js';
import { createRng } from '../util/rng.js';
import { unitSize, cellSize } from '../scenes/mazeView.js';
import { createStartscreen } from '../scenes/startscreen.js';
import { createMazeGen } from '../scenes/mazegen.js';
import { createFalling } from '../scenes/falling.js';
import { createPlaying } from '../scenes/playing.js';
import { createRising } from '../scenes/rising.js';
import { createMap } from '../scenes/map.js';

const TRANSITION_DURATION = 0.7; // Sekunden fuer den gesamten Fade out+in

export class Game {
  constructor(options = {}) {
    this.debug = options.debug ?? null;
    this.audio = options.audio ?? null; // Sound-Ausgabe (sound/audio.js); null = stumm (Tests)
    this.time = 0;
    this.level = 1;       // im Startscreen gewaehltes Level (bestimmt die Maze-Groesse)
    this.dockFace = null; // vom Startscreen gewaehlte Andock-Flaeche (fuer MazeGen)
    this.maze = null;     // von MazeGen erzeugt, von Playing weiterverwendet
    this.keys = new Set(); // aktuell gedrueckte Tasten (fuer kontinuierliche Steuerung)
    this.trail = [];      // abgelaufener Weg (praezise Flaechenpunkte [x,z]), von Playing aufgezeichnet
    this.playerState = null; // letzte Spielerlage {px,pz,yaw} fuer den Rueckschwenk
    this.resume = false;     // Q auf der Karte: naechstes Reinfallen kehrt zur Spielerlage zurueck
    this.undock = false;     // X auf der Karte: Startscreen beginnt mit dem Abdock-Flug
    this.reachedGoal = false; // Ziel erreicht? (steuert Q/X-Angebot auf der Karte)
    this.enemies = null;      // Tanker (rote Rauten, ab 11), von Playing verwaltet -- bleiben ueber Karte/Resume erhalten
    this.spinners = null;     // Spiral-Spinner (ab 16), gleiche Lebensdauer-Regeln wie enemies
    this.flippers = null;     // X-Flipper (ab 21), gleiche Lebensdauer-Regeln wie enemies
    this.gameOver = false;    // Feindberuehrung: Karte zeigt GAME OVER, Q startet den Level neu

    // Szenen-Handler. Jede Szene: { enter?, exit?, update?(dt), render?(r), onKey?(key) }.
    this.scenes = {
      [State.STARTSCREEN]: createStartscreen(this),
      [State.MAZE_GEN]: createMazeGen(this),
      [State.FALLING]: createFalling(this),
      [State.PLAYING]: createPlaying(this),
      [State.RISING]: createRising(this),
      [State.MAP]: createMap(this),
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

  // Feinde des Levels fuer dieses Labyrinth (neu) wuerfeln -- deterministisch
  // aus dem Maze-Seed, ein Retry landet also bei denselben Positionen.
  // Aufrufer: MazeGen bei der Geburt der Karte (so zeigen Start-Karte und
  // Reinfall-Schwenk die Feind-Kreuze schon vor dem Spiel), Falling bei
  // jedem frischen Anlauf (Retry nach Game Over) und Playing als Fallback
  // fuer den Direkteinstieg (Tests).
  spawnFoes(maze) {
    const cfg = levelConfig(this.level);
    const unit = unitSize(maze);
    const cell = cellSize(maze);
    this.enemies = cfg?.enemies ? createEnemies(maze, cfg.enemies, {
      unit, cell, rng: createRng((maze.seed ^ 0x5bd1e995) >>> 0),
    }) : null;
    this.spinners = cfg?.spinners ? createSpinners(maze, cfg.spinners, {
      unit, cell, rng: createRng((maze.seed ^ 0x9e3779b9) >>> 0),
    }) : null;
    // Flipper NACH den Spinnern: deren Gangstuecke bleiben flipperfrei.
    this.flippers = cfg?.flippers ? createFlippers(maze, cfg.flippers, {
      unit, cell, rng: createRng((maze.seed ^ 0x85ebca6b) >>> 0),
      avoid: this.spinners ?? [],
    }) : null;
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
    // Theme-Farbe des Levels fuer alles ohne explizite Farbe (Kanten, Marker,
    // Beschriftung). Der Startscreen bleibt gruen und blendet beim An-/Abdocken
    // selbst zwischen Gruen und der Level-Farbe (explizite color-Option).
    renderer.color = this.stateKey === State.STARTSCREEN
      ? PHOSPHOR_GREEN
      : levelColor(this.level);
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
