// Spiel-Orchestrierung: haelt den aktuellen Zustand und leitet update/render/
// Eingaben an die jeweilige Szene weiter. Alle Uebergaenge sind von den Szenen
// selbst nahtlos inszeniert (Schwenks, Wachsen, An-/Abdocken) -- den fruehen
// generischen Fade ueber Schwarz gibt es nicht mehr (Git-Historie).
//
// Die reine Uebergangslogik (welcher Zustand folgt auf welches Ereignis) liegt in
// states.js und ist dort getestet.

import { State, GameEvent, nextState } from './states.js';
import { levelColor, levelConfig, stepLevel } from './levels.js';
import { ENGINE_1980, ENGINE_2026 } from './engine.js';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import { drawDemoOverlay } from '../scenes/demoOverlay.js';
import { createEnemies } from '../world/enemies.js';
import { createSpinners } from '../world/spinners.js';
import { createPulsars } from '../world/pulsars.js';
import { createRng } from '../util/rng.js';
import { unitSize, cellSize } from '../scenes/mazeView.js';
import { createStartscreen } from '../scenes/startscreen.js';
import { createMazeGen } from '../scenes/mazegen.js';
import { createFalling } from '../scenes/falling.js';
import { createPlaying } from '../scenes/playing.js';
import { createRising } from '../scenes/rising.js';
import { createMap } from '../scenes/map.js';
import { createReplay } from '../scenes/replay.js';

// Demo-Rotation des Attract-Mode: ein "cooles Spiel" pro Spielstufe --
// Blockwelt, Fahrt, Kampf, Spinner, Flipper, Pulsare (Seeds wuerfelt
// MazeGen ohnehin frisch, jede Demo sieht anders aus).
const DEMO_LEVELS = [3, 7, 12, 17, 22, 27];

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
    this.resume = false;     // S auf der Karte: naechstes Reinfallen kehrt zur Spielerlage zurueck
    this.undock = false;     // X auf der Karte: Startscreen beginnt mit dem Abdock-Flug
    this.reachedGoal = false; // Ziel erreicht? (steuert S/X-Angebot auf der Karte)
    this.enemies = null;      // Tanker (rote Rauten, ab 11), von Playing verwaltet -- bleiben ueber Karte/Resume erhalten
    this.spinners = null;     // Spiral-Spinner (ab 16), gleiche Lebensdauer-Regeln wie enemies
    this.flippers = null;     // X-Flipper (Paare aus Tanker-Abschuessen), gleiche Lebensdauer-Regeln
    this.pulsars = null;      // Pulsare (ab 26), gleiche Lebensdauer-Regeln (sterben aber nie)
    this.gameOver = false;    // Feindberuehrung: Karte zeigt GAME OVER, S startet den Level neu
    this.crashKind = null;    // Todesursache des letzten Crashs (tanker/spinner/impale/foeShot/flipper)
    this.zapper = true;       // Superzapper verfuegbar (einer pro Leben = pro Anlauf; Playing laedt
                              // bei jedem frischen Anlauf nach, Resume behaelt den Verbrauch)
    this.viewRoll = 0;        // Rest-Verdrehung der Blickachse beim Abheben (Pulsar-
                              // Rotation, ab 26) -- der Rueckschwenk dreht sie aus
    this.crashScreen = null;  // Einschlagpunkt am Bildschirm ({cx,cy}) beim Crash --
                              // rising haelt damit die Scherben-Flugbahnen nahtlos
    this.recording = null;    // Replay-Aufzeichnung des Laufs (core/recorder.js) --
                              // Playing schreibt sie, R auf der Karte spielt sie ab;
                              // ein frischer Anlauf (auch Retry) beginnt eine neue
    this.replayCam = 0;       // Kamera-Modus der Wiedergabe (REPLAY_CAMS, nur 2026)
    this.demo = false;        // Attract-Mode: Autopilot spielt, ohne Ton, das
                              // Startscreen-Overlay (PRESS S / Level-Wahl) bleibt
    this.demoSavedLevel = null; // die AUSWAHL des Spielers waehrend der Demo
                              // (game.level traegt derweil das Demo-Level)
    this.demoIndex = 0;       // rotiert durch DEMO_LEVELS
    this.demoStart = false;   // S in der Demo: zur Karte, Flaeche heilen, Fraesen

    // Szenen-Handler. Jede Szene: { enter?, exit?, update?(dt), render?(r), onKey?(key) }.
    this.scenes = {
      [State.STARTSCREEN]: createStartscreen(this),
      [State.MAZE_GEN]: createMazeGen(this),
      [State.FALLING]: createFalling(this),
      [State.PLAYING]: createPlaying(this),
      [State.RISING]: createRising(this),
      [State.MAP]: createMap(this),
      [State.REPLAY]: createReplay(this),
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
    // Attract-Mode: die Demo hat KEINE Controls -- nur die Level-Wahl
    // (links/rechts), der Engine-Schalter (hoch/runter) und S wirken.
    if (this.demo) {
      this.demoKey(key);
      return;
    }
    this.current.onKey?.(key);
  }

  // --- Attract-Mode (Animate): Autopilot-Demos aus dem Startscreen heraus ---

  // Startet die naechste Demo-Runde: die Spieler-AUSWAHL bleibt gemerkt
  // (Anzeige + das, was S startet), game.level traegt derweil das Demo-Level
  // aus der Rotation. Ton komplett aus (unabhaengig vom M-Mute).
  beginDemo() {
    if (!this.demo) this.demoSavedLevel = this.level;
    this.demo = true;
    this.demoStart = false;
    this.keys.clear(); // dem Autopiloten gehoeren die Tasten
    this.level = DEMO_LEVELS[this.demoIndex++ % DEMO_LEVELS.length];
    this.audio?.setSuppressed?.(true);
  }

  // S in der Demo: zurueck zur gemerkten Auswahl, Demo beenden und -- je
  // nach Zustand -- den nahtlosen Weg ins normale Fraesen einleiten:
  // aus der Ego-Demo hinauf zur Karte, die Flaeche heilt zu, dann waechst
  // das gewaehlte Level (Boris' Spec). Ton wieder an.
  startFromDemo() {
    this.level = this.demoSavedLevel ?? this.level;
    this.demoSavedLevel = null;
    this.demo = false;
    this.audio?.setSuppressed?.(false);
    if (this.stateKey === State.STARTSCREEN) {
      // Demo-Pause im Orbit: ganz normaler Andock-Start.
      this.current.onKey?.('S');
    } else if (this.stateKey === State.MAZE_GEN) {
      this.dispatch(GameEvent.START); // Re-Enter: frisches Maze im Wahl-Level
    } else {
      // Ego/Schwenk/Karte: die Szenen leiten ueber die Karte zum Fraesen
      // (playing hebt ab, map heilt die Flaeche und dispatcht START).
      this.demoStart = true;
      if (this.stateKey === State.PLAYING) this.dispatch(GameEvent.EXIT);
    }
  }

  demoKey(key) {
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Auswahl aendern -- die Demo laeuft ungestoert weiter.
      this.demoSavedLevel = stepLevel(this.demoSavedLevel ?? this.level,
        key === 'ArrowRight' ? +1 : -1);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      this.engine = key === 'ArrowUp' ? ENGINE_2026 : ENGINE_1980; // live umblenden
    } else if (key === 'S') {
      this.startFromDemo();
    }
  }

  // Feinde des Levels fuer dieses Labyrinth (neu) wuerfeln -- deterministisch
  // aus dem Maze-Seed, ein Retry landet also bei denselben Positionen.
  // Aufrufer: MazeGen bei der Geburt der Karte (so zeigen Start-Karte und
  // Reinfall-Schwenk die Feind-Kreuze schon vor dem Spiel), Falling bei
  // jedem frischen Anlauf (Retry nach Game Over) und Playing als Fallback
  // fuer den Direkteinstieg (Tests). Beim allerersten frischen Anlauf
  // wuerfeln MazeGen UND Falling (bewusst doppelt: deterministisch gleiches
  // Ergebnis, nur doppelte Spawn-Arbeit -- ein fresh-Flag lohnte nicht).
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
    // Flipper werden NICHT platziert: sie entstehen nur paarweise aus
    // Tanker-Abschuessen (Sturm-Branch) -- die Liste steht bereit.
    this.flippers = cfg?.enemies ? [] : null;
    // Pulsare OHNE Gang-Sperre: in langen Gaengen tauchen alle Feinde auf
    // (Boris' "shooting alley", 3.9.2026).
    this.pulsars = cfg?.pulsars ? createPulsars(maze, cfg.pulsars, {
      unit, cell, rng: createRng((maze.seed ^ 0xc2b2ae35) >>> 0),
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

    // Attract-Mode: das Startscreen-Overlay (LEVEL-Auswahl, Engine-Schalter,
    // PRESS S TO START) bleibt waehrend der GANZEN Demo sichtbar -- ausser
    // im Startscreen selbst, der zeichnet es ohnehin.
    if (this.demo && this.stateKey !== State.STARTSCREEN) {
      drawDemoOverlay(renderer, this);
    }
  }
}

export { State, GameEvent };
