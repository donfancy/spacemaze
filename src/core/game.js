// Spiel-Orchestrierung: haelt den aktuellen Zustand und leitet update/render/
// Eingaben an die jeweilige Szene weiter. Alle Uebergaenge sind von den Szenen
// selbst nahtlos inszeniert (Schwenks, Wachsen, An-/Abdocken) -- den fruehen
// generischen Fade ueber Schwarz gibt es nicht mehr (Git-Historie).
//
// Die reine Uebergangslogik (welcher Zustand folgt auf welches Ereignis) liegt in
// states.js und ist dort getestet.

import { State, GameEvent, nextState } from './states.js';
import { levelColor, levelConfig } from './levels.js';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import { createEnemies } from '../world/enemies.js';
import { createSpinners } from '../world/spinners.js';
import { createFlippers } from '../world/flippers.js';
import { createPulsars } from '../world/pulsars.js';
import { createRng } from '../util/rng.js';
import { unitSize, cellSize } from '../scenes/mazeView.js';
import { createStartscreen } from '../scenes/startscreen.js';
import { createMazeGen } from '../scenes/mazegen.js';
import { createFalling } from '../scenes/falling.js';
import { createPlaying } from '../scenes/playing.js';
import { createRising } from '../scenes/rising.js';
import { createMap } from '../scenes/map.js';

export class Game {
  constructor(options = {}) {
    this.debug = options.debug ?? null;
    this.audio = options.audio ?? null; // Sound-Ausgabe (sound/audio.js); null = stumm (Tests)
    this.engine = options.engine ?? '1980'; // Rendering-Engine (core/engine.js)
    // 2026-Backend (render2026/backend.js), von main.js injiziert -- wie audio
    // NIE direkt importiert (Three.js bleibt aus dem headless-Core draussen).
    this.renderBackend = options.renderBackend ?? null;
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
    this.pulsars = null;      // Pulsare (ab 26), gleiche Lebensdauer-Regeln (sterben aber nie)
    this.gameOver = false;    // Feindberuehrung: Karte zeigt GAME OVER, Q startet den Level neu
    this.viewRoll = 0;        // Rest-Verdrehung der Blickachse beim Abheben (Pulsar-
                              // Rotation, ab 26) -- der Rueckschwenk dreht sie aus

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

    this.current.enter?.();
    this.debug?.log('enter ' + this.stateKey);
  }

  get current() {
    return this.scenes[this.stateKey];
  }

  // Ereignis ausloesen: schaltet sofort auf den Folgezustand um, falls in
  // diesem Zustand definiert (nahtlos -- z.B. Andocken -> Labyrinth: gleiche
  // Kamera). Liefert false fuer im Zustand undefinierte Ereignisse.
  dispatch(event) {
    const target = nextState(this.stateKey, event);
    if (!target) return false;
    this.current.exit?.();
    this.stateKey = target;
    this.current.enter?.();
    this.debug?.log(`${event} -> ${target}`);
    return true;
  }

  handleKey(key) {
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
    // Pulsare zuletzt: Spinner- UND Flipper-Gangstuecke bleiben pulsarfrei.
    this.pulsars = cfg?.pulsars ? createPulsars(maze, cfg.pulsars, {
      unit, cell, rng: createRng((maze.seed ^ 0xc2b2ae35) >>> 0),
      avoid: [...(this.spinners ?? []), ...(this.flippers ?? [])],
    }) : null;
  }

  update(dt) {
    this.time += dt;
    this.current.update?.(dt);
  }

  render(renderer) {
    // Naht der beiden Engines (PLAN2026.md): 2026 zeichnet komplett selbst
    // aus dem Spielzustand; ohne injiziertes Backend faellt es sicher auf
    // die 1980-Zeichnung zurueck.
    if (this.engine === '2026' && this.renderBackend) {
      this.renderBackend.render(this);
      return;
    }

    // Theme-Farbe des Levels fuer alles ohne explizite Farbe (Kanten, Marker,
    // Beschriftung). Der Startscreen bleibt gruen und blendet beim An-/Abdocken
    // selbst zwischen Gruen und der Level-Farbe (explizite color-Option).
    renderer.color = this.stateKey === State.STARTSCREEN
      ? PHOSPHOR_GREEN
      : levelColor(this.level);
    this.current.render?.(renderer);
  }
}

export { State, GameEvent };
