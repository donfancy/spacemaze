// 2026-Engine: der EINZIGE Three.js-Animations-Teil (Gegenstueck zu
// render/renderer.js, das der einzige 2D-Canvas-Teil bleibt). Wird von main.js
// bei Bedarf dynamisch importiert und als game.renderBackend injiziert -- der
// Core und die Tests beruehren Three.js nie.
//
// Stand Stufe 3 (PLAN2026.md): der VOLLE Zyklus ist echt -- Startscreen in
// Prototyp-Optik (startscreen3d.js, Orbit/Andocken/Abdocken aus
// startscreen.viewState()), Maze-Wachstum als wachsende Boden-Kontur in der
// Draufsicht, Reinfallen/Rueckschwenk als echte Kamera-Schwenks (Quaternion-
// Slerp, dieselben Zeitkurven wie 1980; die Waende wachsen/schrumpfen mit),
// Karte als Draufsicht mit Weg, S/G-/Kompass-Markern und Feind-Kreuzen.
// Ego-Ansicht (Stufe 1+2): Kamera aus playing.viewState(), Bump-Blitz +
// Funken. Kampf (Stufe 4): Tanker als Okta-Rauten in Prototyp-Optik
// (dunkler Koerper, Glut-Kanten, drehen/schweben), Schuesse als weisse
// Stern-Billboards, Fadenkreuz in der Welt, Splitter-Explosionen aus
// burst.js; Crash = Splitter + echter Kamera-Shake (rollOsc/pitchOsc
// kommen ueber roll/pitch) + weisser Blitz -- das 1980-Bild-Zerbersten
// bleibt 1980. Stufe 5: Spinner-Spiralen/Flipper-X/Pulsar-Zacken als
// HDR-Linien direkt aus den puren Segment-Funktionen, sirrende Spinner-
// Schuesse (flirrende Farben), Ziel-Feuerwerk, bunte Sterne ab 26 -- und
// der Gyro-Roll als ECHTER Kamera-Roll (steckt in view.roll, auch als
// 90/180/270-Grad-Dauerzustand). Texte laufen als DOM-Overlay
// (Platzhalter bis zur HUD-Frage in Stufe 6). Alle Animation haengt an
// game.time / den Szenen-Uhren.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { State } from '../core/states.js';
import {
  playHint, mapHint, replayHint, replayStatus, gameOverColor, blinkOn, displayLevel,
} from '../core/hud.js';
import { hasRecording } from '../core/recorder.js';
import { levelColor, levelConfig, enemyColor, spinnerColor } from '../core/levels.js';
import { PHOSPHOR_GREEN, ARCADE_YELLOW, NEON_MAGENTA, diagramBoost } from '../render/colors.js';
import { EYE_RATIO, cellSize } from '../scenes/mazeView.js';
import { burstSegments, burstShards, burstGlow } from '../world/burst.js';
import { ENEMY } from '../world/enemies.js';
import { SHOTS, aimYaw, shotSegments } from '../world/shots.js';
import { FIREWORK, FIREWORK_COLORS, fireworkBeams } from '../world/fireworks.js';
import { growthOutline } from '../world/mazeGeometry.js';
import {
  SPINNER, spinnerMarkers, spinnerSegments, spinnerShotSegments, spinnerShotPos,
} from '../world/spinners.js';
import { flipperMarkers, flipperSegments, flipperTriangles } from '../world/flippers.js';
import { pulsarMarkers, pulsarSegments } from '../world/pulsars.js';
import { GLIDER } from '../world/glider.js';
import {
  buildWorld, applyTheme, disposeWorld, hdr, setWallHeight, setMarkerFade,
  UNITS_PER_CELL, FOG_DENSITY, HEADLIGHT_INTENSITY, EGO_BOOST, MIRROR_LINE_DIM,
} from './world3d.js';
import { buildStartscreenScene } from './startscreen3d.js';
import { skyTheme } from './skyTheme.js';
import {
  MINIMAP, PLAYER_MARK, minimapWalls, cellCenterCells, minimapModel,
} from './minimap.js';

const EYE = EYE_RATIO * UNITS_PER_CELL; // Augenhoehe: halbe Gangbreite

// Blickwinkel: die Ego-Ansicht behaelt die Prototyp-70; Draufsichten und der
// Startscreen nutzen die 1980-Optik (PI/2.4 = 75 Grad), damit die Core-Posen
// (Andock-Abstand, fill 0.85) unveraendert stimmen. Die Schwenks blenden
// zwischen beiden -- ein sanfter Zoom, der beide Enden exakt trifft.
const EGO_FOV = 70;
const TOP_FOV = 75;
const TOP_FILL = 0.85; // vertikaler Fuellgrad der Karte (wie faceDockPose)

// Bump-Feedback (Stufe 1): dezenter Kamera-Impuls + Licht-Blitz an der Wand.
const BUMP_TIME = 0.45;      // s: Impuls und Blitz klingen aus
const BUMP_RECOIL = 0.10;    // Kamera-Rueckstoss (Anteil der Gangbreite)
const BUMP_ROLL = 0.045;     // rad: mechanisches Zittern um die Blickachse
const BUMP_LIGHT = 220;      // Spitzen-Intensitaet des Wand-Blitzes
const BUMP_WALL_DIST = 0.4;  // Blitz-Abstand vom Spieler Richtung Wand (Gangbreiten)
                             // -- Mindestabstand zur Wandflaeche (decay-2-Falle!)
const BUMP_LIGHT_CAP = 25;   // Deckel: Intensitaet <= CAP * Kamera-Abstand^2.
                             // Die decay-2-Falle in neuer Form (Stufe 2): beim
                             // FRONTAL-Aufprall der Fahrt sitzt der Blitz am
                             // Auftreffpunkt < 1 Einheit vor der Kamera -- ohne
                             // Deckel brannte das ganze Bild weiss aus.

const GOAL_FLASH_TIME = 1.0; // s: weisses Aufstrahlen + Erloeschen wie 1980
const BEACON_COLOR = hdr(ARCADE_YELLOW, 2.6); // einmal alloziert (pro Frame kopiert)
const FLASH_COLOR = hdr('#ffffff', 2.6);

// Funken beim Fahrt-Aufprall (Stufe 2, statt der 1980-Wellen): dieselbe pure
// Splitter-Mathematik wie die 1980-Explosionen (world/burst.js), als kleine
// weisse HDR-Segmente an der Wand. Masse in Gangbreiten (Face-Einheiten).
const SPARK_COUNT = 14;
const SPARK_SPEED = 2.2;     // Flugtempo (Gangbreiten/s)
const SPARK_LIFE = 0.5;      // s
const SPARK_SIZE = 0.09;     // Splitter-Halblaenge (Gangbreiten)
const SPARK_OFF = 0.1;       // Abstand des Ursprungs von der Wandflaeche
                             // (Gangbreiten) -- sonst halb IN der Wand geboren

const FOE_MARK_RATIO = 0.22; // Kreuz-Halbarm der Feind-Marker (Gangbreiten)

// Kampf (Stufe 4). Tanker in Prototyp-Optik: Groesse/Puls aus ENEMY (wie die
// 1980-Raute), Drehen und Schweben aus dem Prototyp (dort ertastete Werte).
const TANKER_WIDTH = 0.75;      // Breite relativ zur Hoehe (wie die 1980-Raute)
const TANKER_SPIN = 0.7;        // rad/s Drehung um die Hochachse
const TANKER_HOVER = 0.25;      // Schwebe-Hub (3D-Einheiten)
const TANKER_HOVER_FREQ = 1.1;  // rad/s des Schwebens
const TANKER_BODY_DIM = 0.13;   // Koerper-Farbe = Feind-Farbe stark abgedunkelt
const TANKER_GLOW = 0.16;       // Emissiv-Glut des Koerpers
const TANKER_EDGE_HDR = 3.2;    // Kanten-Boost (Bloom-Glut wie im Prototyp)
const CROSSHAIR_DIST = 2.5;     // Fadenkreuz-Anker (Gangbreiten voraus, wie 1980)
const CROSSHAIR_SIZE = 0.12;    // Fadenkreuz-Halbarm (Gangbreiten)
const CROSSHAIR_GAP = 0.4;      // Luecke in der Mitte (Anteil des Halbarms)
const SHOT_HDR = 2.4;           // Schuss-Stern-Farben leicht in den Bloom geboostet
// Splitter/Truemmer-Helligkeit (Boris: "erst blitzen, dann abdunkeln"): der
// pure Verlauf burstGlow startet UEBER der Feind-Glut (Tanker-Kanten 3.2)
// und verglimmt beim Verblassen unter die Feind-Helligkeit.
const BURST_GLOW = { flash: 3.4, dim: 0.4 };  // Linien-Splitter
const SHARD_GLOW = { flash: 2.0, dim: 0.25 }; // flaechige Truemmer-Platten

// Schuesse: groesser und schneller rotierend als die 1980-Defaults, damit
// sie sich klar von den Kollisionsfunken abheben (Boris' Punkt); dazu
// FLIRRENDE Arcade-Farben zum Weiss gemischt (harte Schaltung wie 1981).
const SHOT_PARAMS = { size: 0.12, spin: 18 };
const SKY_DRIFT = 0.004;        // rad/s: kaum merkliche Drehung der Nebel-Skybox
const SHOT_FLICKER = 12;        // Farb-Schaltrate (Hz)
const SHOT_WHITE_MIX = 0.55;    // Weiss-Anteil der Arcade-Farben
const NEAR_STAR = 0.6;          // Gangbreiten: der Stern-Radius waechst erst mit
                                // der Kamera-Distanz auf ("Muendung"). FALLE:
                                // ein Schuss-Stern AN der Kamera (frisch
                                // abgefeuert, oder ein ankommender Spinner-
                                // Schuss) malt sonst Riesen-Strahlen uebers
                                // Bild bis zum Bloom-Blowout -- die 1980-
                                // Pipeline hat das per Near-Clipping
                                // verschluckt, der 3D-Renderer nicht.

// Death-Crash (Stufe-4-Politur, "spektakulaerer"): laengerer weisser
// Vollbild-Blitz + greller Licht-Puls am Einschlag, dazu die grossen
// Truemmer-Platten aus burstShards (Spezifikation kommt aus der Szene).
const CRASH_FLASH = 0.4;        // s: weisser Einschlag-Blitz (quadratisch ausklingend)
const CRASH_LIGHT = 3200;       // Spitzen-Intensitaet des Crash-Lichts
const CRASH_LIGHT_TIME = 0.7;   // s: Licht-Puls klingt aus
const CRASH_LIGHT_CAP = 60;     // Deckel: Intensitaet <= CAP * Kamera-Abstand^2
                                // (decay-2-Falle -- der Crash ist direkt vor der Kamera)

// Stufe 5: Spinner-Spiralen, Flipper-X und Pulsar-Zacken kommen als fertige
// Liniensegmente aus den puren Modulen (spinnerSegments & Co.) -- die Engine
// zeichnet sie nur, als leuchtende HDR-Linien pro Feindart. Dazu die
// sirrenden Spinner-Schuesse (flirrende Arcade-Farben, 12 Hz wie 1980)
// und das Ziel-FEUERWERK (fireworkBeams, Masse wie in playing.js).
const FOE_LINE_HDR = 2.6;       // Feind-Konturen gluehen etwas staerker (Gefahr)
const FOE_SHOT_FLICKER = 12;    // Farb-Schaltrate der Spinner-Schuesse (Hz, wie 1980)
// MIRROR_LINE_DIM und EGO_BOOST kommen aus world3d.js -- eine Quelle fuer
// beide Engines-Haelften, sonst driftet die setLineGlow-Normierung.
const MIRROR_SHOT_OPACITY = 0.35; // Spiegel-Schuesse/-Feuerwerk: vertexColors sind
                                // HDR-geboostet, die Opazitaet dimmt sie stattdessen
const FLIPPER_FILL_DIM = 0.3;   // Flaechen-Fuellung des Flipper-X (dunkler Koerper,
                                // die Glut sitzt in der Kontur -- wie beim Tanker)
const FLIPPER_FILL_OPACITY = 0.85;

// Licht-Widerschein der Schuesse an den Waenden (Boris' Punkt 5): ein FESTER
// Pool kleiner Punktlichter, die den naechsten Schuessen folgen. FALLE: eine
// WECHSELNDE Licht-Anzahl liesse Three.js alle Shader neu kompilieren
// (Ruckler mitten im Kampf) -- darum immer alle im Baum (intensity 0 = aus)
// und nur in Schiess-Levels ueberhaupt angelegt (buildWorld opts.shoot).
const SHOT_LIGHT_COUNT = 4;     // folgt den 4 naechsten Schuessen (eigene + Feind)
const SHOT_LIGHT = 8;           // Intensitaet pro Schuss-Licht (dezent)
const SHOT_LIGHT_DIST = 15;     // Reichweite (3 Gangbreiten)
const FIREWORK_SPREAD = 2.2;    // Feuerwerk-Radius um die Zielmitte (Gangbreiten)
const FIREWORK_HEIGHT = 8;      // maximale Strahlhoehe (Gangbreiten, wie 1980)
const FIREWORK_HDR = 2.4;       // Strahlen bloomen in ihrer Arcade-Farbe

// Karten-Glow (Boris' Punkt "Overglow ab Level 11"): der Bloom-Schwellwert
// (0.85) arbeitet auf LUMINANZ im linearen Farbraum -- Phosphor-Gruen
// (linear ~0.745) landet mit dem festen HDR-Boost x2.2 weit darueber und
// ueberglueht die dichte Karte, Tempest-Blau (linear ~0.227) bleibt am
// Ego-Deckel. In den DIAGRAMM-Ansichten wird der Boost deshalb LUMINANZ-
// NORMIERT (Ziel knapp ueberm Schwellwert), die Schwenks blenden zum vollen
// Ego-Boost; die Ego-Ansicht bleibt unveraendert.
const DIAGRAM_LINE_LUM = 1.0;   // Ziel-Luminanz der Karten-Linien
const DIAGRAM_MARKER_LUM = 1.0; // Buchstaben: ueberall ein LEICHTER Glow
                                // (1.15 machte um S/G runde Bloom-Flecken)
const MARKER_BOOST_MAX = 3.0;   // Deckel fuer dunkle Farben (Blau braucht mehr Boost)
// Die Normierungs-Formel selbst (diagramBoost) lebt pur in render/colors.js.

// Leuchtfeuer in der Draufsicht: BLASSE Lichtsaeule am Ziel (Boris' Punkt 4,
// 26.8.2026 -- "macht alles verstehbarer"), die Schwenks blenden von dort
// zur vollen Ego-Helligkeit. Der additive KEGEL bleibt im Diagramm aus
// (von oben laengs durchblickt = Blowout, Stufe-3-Falle).
const DIAGRAM_BEACON = 0.25;

// MINI-MAP (Stufe 6, ersetzt die 1980-Kompass-Rose in der Ego-Ansicht):
// runde, MITDREHENDE Ausschnitts-Karte rechts unten -- Modell pur in
// minimap.js (Scheiben-Koordinaten, heading up), hier nur Puffer + eine
// kamera-verankerte Gruppe IN der Welt-Szene: sie laeuft durch dieselbe
// Bloom-Kette (2026-Look gratis) und bleibt screen-fest, weil sie die
// Kamera-Pose 1:1 uebernimmt -- auch beim Gyro-Roll (der Bildschirm dreht,
// die Scheibe nicht; heading up bleibt korrekt, vorwaerts ist vorwaerts).
// REPLAY-Wiedergabe (Replay-Modus): Zusatz-Kameras + Gleiter-Avatar --
// nur hier gibt es freie Kamerawinkel (die 1980-Wiedergabe bleibt Ego,
// Hidden-Lines-Regel). Masse in GANGBREITEN (x UNITS_PER_CELL).
const RCAM = {
  chaseBack: 2.0, chaseUp: 1.2, chaseAhead: 2.0, // Verfolger: hinter/ueber dem Gleiter
  birdBack: 2.6, birdUp: 6.0,                    // schraeg von oben, mitfahrend
  orbitRadius: 3.2, orbitUp: 1.8, orbitRate: 0.3, // Beauty-Shot: kreist um den Spieler
  totalUp: 1.0, totalBack: 0.45,                 // Totale: Anteile von world.total
};
const RCAM_FOV = { ego: EGO_FOV, chase: EGO_FOV, bird: 60, total: 55, orbit: 65 };
// Hohe Kameras sehen VIEL gruene Linie auf einmal: der Ego-Boost ueberglueht
// dort (Karten-Glow-Regel) -- der Glow blendet Richtung Diagramm-Normierung.
const RCAM_GLOW = { ego: 0, chase: 0, bird: 0.6, total: 1, orbit: 0.25 };
const GLIDER_EDGE_HDR = 2.8;   // Kanten-Glut des Gleiters (etwas ueber den Waenden)
const GLIDER_BODY_DIM = 0.13;  // dunkler Koerper (Tanker-Prinzip)

const MM_DIST = 1.2;        // Abstand vor der Kamera (3D-Einheiten, > near 0.1)
const MM_SCREEN = 0.14;     // Scheiben-Radius als Anteil der BildHOEHE
const MM_MARGIN = 0.035;    // Randabstand rechts/unten (Anteil der Bildhoehe)
const MM_BG_OPACITY = 0.55; // dunkle Scheibe unter den Linien (Lesbarkeit)
const MM_CROSS = 0.055;     // Feind-Kreuz-Halbarm in Scheiben-Einheiten
const MM_LETTER = 0.24;     // S/G-Sprite-Groesse in Scheiben-Einheiten
const MM_NORTH = 0.2;       // N-Sprite-Groesse
const MM_RIM_SEGS = 64;     // Kreis-Aufloesung des Rands

export function createBackend2026(container = document.body) {
  // Alles DOM (Canvas + Overlays) lebt in EINEM Wurzel-Element -- der Live-
  // Engine-Schalter (Stufe 3) blendet damit die ganze 2026-Ausgabe ein/aus.
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;';
  container.appendChild(root);

  // --- Renderer + Bloom-Kette (Rezept aus public/proto2026/) ------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;';
  root.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(EGO_FOV, 1, 0.1, 2000);
  camera.rotation.order = 'YXZ'; // erst Gieren (yaw), dann Nicken, dann Rollen
  let curFov = EGO_FOV;
  function setFov(f) {
    if (Math.abs(f - curFov) < 1e-3) return;
    curFov = f;
    camera.fov = f;
    camera.updateProjectionMatrix();
  }

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4, type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);
  // Die RenderPass-Szene wird pro Frame umgehaengt (Startscreen vs. Welt).
  const renderPass = new RenderPass(null, camera);
  composer.addPass(renderPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.45, 0.85));
  composer.addPass(new OutputPass());

  // --- DOM-Overlays (Platzhalter bis zur HUD-Frage in Stufe 6) ----------------
  // label: Hinweiszeile unten links. title/switchLine/press: Startscreen-Texte.
  // headline: GAME OVER auf der Karte.
  const FONT = '"SF Mono",Menlo,Consolas,monospace';
  function overlay(css) {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;color:#9fffc0;user-select:none;pointer-events:none;' +
      `font-family:${FONT};text-shadow:0 0 10px rgba(80,255,140,.6);` + css;
    root.appendChild(el);
    return el;
  }
  const label = overlay('left:14px;bottom:12px;font-size:12px;line-height:1.5;');
  const title = overlay('left:0;right:0;top:9vh;text-align:center;' +
    'font-size:min(5vh,42px);letter-spacing:.18em;');
  const switchLine = overlay('left:0;right:0;top:calc(9vh + min(6.5vh,54px));' +
    'text-align:center;font-size:min(2.6vh,22px);letter-spacing:.18em;');
  const press = overlay('left:0;right:0;bottom:9vh;text-align:center;' +
    'font-size:min(5vh,42px);letter-spacing:.18em;');
  const headline = overlay('left:0;right:0;top:12vh;text-align:center;' +
    'font-size:min(7vh,52px);letter-spacing:.18em;');

  // Weisser Einschlag-Blitz des Crashs (Stufe 4) -- das 2026-Pendant zu
  // renderer.flash; liegt UNTER dem Fade (der Szenen-Uebergang deckt alles).
  const flashEl = document.createElement('div');
  flashEl.style.cssText =
    'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;';
  root.appendChild(flashEl);

  // Fortschritts-Linie der Wiedergabe (Replay-Modus): gedimmte Gesamtspur
  // mit heller Fuellung bis zum Zeiger; nur im REPLAY-Zustand sichtbar.
  const progressEl = document.createElement('div');
  progressEl.style.cssText =
    'position:absolute;left:14px;right:14px;bottom:34px;height:2px;' +
    'background:rgba(80,255,140,.18);display:none;pointer-events:none;';
  const progressBar = document.createElement('div');
  progressBar.style.cssText =
    'height:100%;width:0;background:#9fffc0;box-shadow:0 0 8px rgba(80,255,140,.8);';
  progressEl.appendChild(progressBar);
  root.appendChild(progressEl);

  // Nur bei Aenderung ins DOM schreiben (kein Layout-Gezerre pro Frame).
  function setText(el, text) {
    if (el._t !== text) { el._t = text; el.textContent = text; }
  }
  function setHtml(el, html) {
    if (el._t !== html) { el._t = html; el.innerHTML = html; }
  }

  // --- Startscreen-Szene (Prototyp-Optik), einmal lazy gebaut -----------------
  let start = null;
  function useStartScene() {
    if (!start) start = buildStartscreenScene(renderer);
    renderPass.scene = start.scene;
  }

  // --- Labyrinth-Welt: pro Maze einmal gebaut, bei Wechsel entsorgt -----------
  let world = null;
  let worldMaze = null;  // Maze-Objekt, fuer das `world` gebaut wurde
  let themeHex = null;   // zuletzt angewandte Level-Farbe

  function ensureWorld(game, maze, color) {
    if (maze !== worldMaze) {
      if (world) disposeWorld(world);
      // Level 26+ (rainbowStars): der Himmel funkelt BUNT; Kampf-Levels
      // bekommen den festen Schuss-Licht-Pool (Wand-Widerschein).
      const cfg = levelConfig(game.level);
      world = buildWorld(maze, {
        rainbow: !!cfg?.rainbowStars,
        shotLights: cfg?.shoot ? SHOT_LIGHT_COUNT : 0,
        // Nebel-Skybox: einmaliger Cubemap-Bake beim Weltaufbau (skybox.js);
        // das Thema (Level-Palette + Crescendo) ist pur in skyTheme.js.
        renderer,
        sky: skyTheme(game.level, maze.seed),
        // Andock-Flaeche: die Platine projiziert die Startscreen-Lichter
        // darauf (nahtloser Licht-Verlauf beim Wechsel in die Draufsicht).
        dockFace: game.dockFace,
      });
      // Umrechnung lokale Flaechen-Einheiten (px/pz, trail, Feinde) -> 3D.
      world.kLocal = UNITS_PER_CELL / cellSize(maze);
      worldMaze = maze;
      themeHex = null;
    }
    if (color !== themeHex) {
      applyTheme(world, color);
      themeHex = color;
    }
    renderPass.scene = world.scene;
  }

  // Grundzustand pro Frame (jeder Zeichner setzt danach nur, was er braucht --
  // sonst schleppt ein Szenenwechsel die Sichtbarkeiten der Vorszene mit).
  function resetWorldFrame() {
    world.scene.fog.density = 0;
    world.headlight.intensity = 0;
    world.bumpLight.intensity = 0;
    world.gridMat.opacity = 0.8;
    world.outlineMat.opacity = 1;
    world.outlineLines.visible = true;
    world.plate.visible = false;
    world.mill.visible = false;
    for (const light of world.plateLights) light.intensity = 0;
    world.sheenLight.intensity = 0;
    world.growth?.buf?.hide();
    // Kampf-Objekte (Stufe 4): nur die Ego-Ansicht schaltet sie sichtbar --
    // in den Draufsichten stehen stattdessen die Feind-Kreuze.
    if (world.tankers?.group) {
      world.tankers.group.visible = false;
      world.tankers.mirrorGroup.visible = false;
    }
    // Alle wachsenden Puffer (makeBuffer) verstecken sich einheitlich.
    world.sparks?.hide();
    world.shotLines?.hide();
    world.crosshair?.hide();
    if (world.burstPool) {
      for (const p of world.burstPool) {
        p.line.hide();
        p.shard?.hide();
      }
    }
    world.crashLight.intensity = 0;
    for (const light of world.shotLights) light.intensity = 0;
    for (const m of world.foeLines ?? []) m?.hide();
    world.flipperFill?.hide();
    world.foeShotLines?.hide();
    world.fireworkLines?.hide();
    for (const m of world.foeMarks ?? []) m?.hide();
    if (world.minimap) world.minimap.group.visible = false;
    if (world.wallCaps) world.wallCaps.visible = false;
    if (world.glider) {
      world.glider.group.visible = false;
      world.glider.mirrorObj.visible = false;
    }
  }

  // Wachsender Geometrie-Puffer (LineSegments oder Dreiecks-Mesh) mit
  // optionalem SPIEGELBILD unter world.mirror -- kapselt das Muster, das
  // vorher achtfach kopiert war: Kapazitaets-Wachstum, needsUpdate,
  // setDrawRange und die heikle Dispose-Reihenfolge an EINER Stelle.
  // Materialien werden EINMAL uebergeben und beim Wachsen NIE weggeworfen
  // (sie haengen nicht an der Kapazitaet); waechst der Puffer, wird nur
  // die Geometrie getauscht (alte disposed) -- kein Material-/Szenen-Churn.
  // opts: { world, triangles, vertexColors, material, mirrorMaterial, parent }
  // (mirrorMaterial weglassen = kein Spiegelbild; dasselbe Material
  // uebergeben = geteiltes Material wie bei der Flipper-Fuellung;
  // parent haengt den Puffer statt in die Szene z.B. in die Mini-Map-Gruppe).
  function makeBuffer({ world, triangles = false, vertexColors = false, material, mirrorMaterial = null, parent = null }) {
    const buf = {
      mesh: null, mirror: null, cap: 0,
      // Puffer fuer `floats` Positions-Floats bereitstellen (waechst nur).
      ensure(floats) {
        if (buf.mesh && buf.cap >= floats) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
        if (vertexColors) {
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floats), 3));
        }
        if (!buf.mesh) {
          const make = (mat) => {
            const obj = triangles ? new THREE.Mesh(geo, mat) : new THREE.LineSegments(geo, mat);
            obj.frustumCulled = false; // Positionen aendern sich pro Frame
            return obj;
          };
          buf.mesh = make(material);
          (parent ?? world.scene).add(buf.mesh);
          if (mirrorMaterial) {
            buf.mirror = make(mirrorMaterial);
            world.mirror.add(buf.mirror);
          }
        } else {
          buf.mesh.geometry.dispose();
          buf.mesh.geometry = geo;
          if (buf.mirror) buf.mirror.geometry = geo;
        }
        buf.cap = floats;
      },
      get pos() { return buf.mesh.geometry.attributes.position; },
      get col() { return buf.mesh.geometry.attributes.color; },
      hide() {
        if (buf.mesh) buf.mesh.visible = false;
        if (buf.mirror) buf.mirror.visible = false;
      },
      // Nach dem Fuellen: die ersten `count` Punkte zeichnen, Rest ignorieren.
      show(count) {
        buf.mesh.geometry.attributes.position.needsUpdate = true;
        if (vertexColors) buf.mesh.geometry.attributes.color.needsUpdate = true;
        buf.mesh.geometry.setDrawRange(0, count);
        buf.mesh.visible = true;
        if (buf.mirror) buf.mirror.visible = true;
      },
    };
    return buf;
  }

  // Platine + gefraeste Gaenge (Stufe 6, world3d.buildPlate): in den
  // Draufsichten ist die Wuerfelflaeche eine deckende Platte, die Gaenge
  // schwarze Kanaele mit Leuchtkante (outlineLines). `count` = Zahl der
  // gefraesten Zellen in Grab-Reihenfolge (maze.order; Infinity = alle),
  // die Opazitaeten blenden in den Schwenks und beim Karten-Exit.
  function setPlate(plateA, millA, count = Infinity) {
    world.plate.visible = plateA > 0.01;
    world.mill.visible = millA > 0.01;
    setFade(world.plateMat, plateA);
    setFade(world.millMat, millA);
    const cells = Math.min(count, worldMaze.order.length);
    world.mill.geometry.setDrawRange(0, cells * 6);
    // Platten-Lichter (die projizierten Startscreen-Akzente) blenden mit der
    // Platte -- in der Ego-Welt sind sie aus (resetWorldFrame laesst die
    // Platte unsichtbar, jeder Draufsicht-/Schwenk-Zeichner ruft setPlate).
    world.plateLights.forEach((light, i) => {
      light.intensity = world.plateLightIntensity[i] * plateA;
    });
  }

  // Glanzlicht (Boris' Wunsch "smooth ankommen"): ein weisses Punktlicht
  // wischt einmal diagonal ueber die Platte -- beim Ankommen in der
  // Draufsicht von Nordwest nach Suedost (dir 1), beim Karten-Exit
  // zurueck (dir -1). Sinus-Huellkurve: bei p 0 und 1 ist es aus, der
  // Szenenschnitt selbst traegt also NIE Glanz -- die Bewegung direkt
  // danach/davor kaschiert ihn.
  function sweepSheen(p, dir = 1) {
    if (p <= 0.001 || p >= 0.999) return; // resetWorldFrame hat es schon aus
    const T = world.total;
    const q = dir > 0 ? p : 1 - p;
    const s = (-0.2 + 1.4 * q) * T; // von knapp ausserhalb bis knapp drueber
    world.sheenLight.position.set(s, 0.35 * T, s);
    world.sheenLight.intensity = world.sheenIntensity * Math.sin(Math.PI * p);
  }

  // Voll deckend OPAK zeichnen (Tiefentest sortiert Marker/Weg/Kreuze dann
  // von selbst darueber), nur waehrend einer Blende transparent -- und dort
  // ohne depthWrite, sonst loecherte die halb sichtbare Platte den Puffer.
  // FALLE: der transparent-Wechsel braucht needsUpdate -- opake Materialien
  // tragen ein OPAQUE-Define im Shader (Alpha hart 1), ohne Rebuild bleibt
  // die Flaeche trotz opacity voll deckend (Sichtpruefungs-Befund). Nur bei
  // ECHTEM Wechsel setzen, sonst kompiliert jeder Frame den Shader neu.
  function setFade(mat, a) {
    mat.opacity = a;
    const solid = a > 0.999;
    if (mat.transparent === !solid) return;
    mat.transparent = !solid;
    mat.depthWrite = solid;
    mat.needsUpdate = true;
  }

  // Sternen-Funkeln (eine Formel fuer Welt und Startscreen).
  function twinkleMats(mats, time) {
    mats.forEach((mat, i) => {
      mat.opacity = 0.75 + 0.25 * Math.sin(time * (1.3 + i * 0.7) + i * 2.1);
    });
  }

  // Karten-Glow dosieren (s. Konstanten oben): mix 0 = Ego (voller Boost
  // x2.2 wie applyTheme), mix 1 = Diagramm (luminanz-normiert knapp ueberm
  // Bloom-Schwellwert -- Gruen wird zahmer, Blau bleibt praktisch gleich,
  // die Buchstaben gluehen in JEDER Farbe leicht). Die Schwenks blenden.
  function setLineGlow(mix) {
    const key = mix.toFixed(3) + '|' + themeHex;
    if (world.glowKey === key) return;
    world.glowKey = key;
    const col = new THREE.Color(themeHex);
    const lineBoost = diagramBoost(themeHex, mix,
      { ego: EGO_BOOST, targetLum: DIAGRAM_LINE_LUM });
    world.lineMat.color.copy(col).multiplyScalar(lineBoost);
    world.outlineMat.color.copy(col).multiplyScalar(lineBoost);
    const markerBoost = diagramBoost(themeHex, mix,
      { ego: EGO_BOOST, targetLum: DIAGRAM_MARKER_LUM, maxBoost: MARKER_BOOST_MAX });
    for (const { mat } of world.markerMats) mat.color.copy(col).multiplyScalar(markerBoost);
  }

  // Gemeinsame Welt-Animation: Sterne funkeln, Leuchtfeuer pulsiert -- und am
  // Ziel strahlt es weiss auf und erlischt (wie die 1980-Strahlen). `view`
  // kommt aus playing.viewState() (null in der Draufsicht: dort entscheidet
  // game.reachedGoal, ob das Leuchtfeuer noch brennt). `dim` blendet das
  // Leuchtfeuer mit (Maze-Wachstum, Karten-Exit).
  function animateWorld(game, view, dim = 1) {
    twinkleMats(world.starGroups, game.time);
    // Kaum merkliche Drift der Nebel-Skybox (backgroundRotation kostet pro
    // Frame nichts -- nur eine Matrix-Uniform; die Punkt-Sterne bleiben fest).
    world.scene.backgroundRotation.y = game.time * SKY_DRIFT;

    const done = view ? view.reached : game.reachedGoal;
    const flashAge = view?.reached ? view.sceneT - view.reachedAt : Infinity;
    if (!done) {
      // Atmen wie das Ziel-Leuchtfeuer im Spiel.
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 2.1);
      world.beaconLines.material.color.copy(BEACON_COLOR);
      world.beaconLines.material.opacity = (0.7 + 0.3 * pulse) * dim;
      world.beaconCone.material.opacity = (0.06 + 0.07 * pulse) * dim;
      world.beaconMirrorMat.opacity = (0.7 + 0.3 * pulse) * 0.45 * dim;
      world.beaconLight.intensity = (350 + 400 * pulse) * dim;
      world.beaconLines.visible = world.beaconCone.visible = dim > 0.01;
    } else if (flashAge < GOAL_FLASH_TIME) {
      // Weisses Aufstrahlen + Erloeschen (Dauer wie 1980).
      const a = (1 - flashAge / GOAL_FLASH_TIME) * dim;
      world.beaconLines.material.color.copy(FLASH_COLOR);
      world.beaconLines.material.opacity = a;
      world.beaconCone.material.opacity = 0.2 * a;
      world.beaconMirrorMat.opacity = 0.5 * a;
      world.beaconLight.intensity = 1600 * a;
      world.beaconLines.visible = world.beaconCone.visible = a > 0.01;
    } else {
      // Erloschen (auch auf der Karte nach dem Ziel).
      world.beaconLines.visible = world.beaconCone.visible = false;
      world.beaconMirrorMat.opacity = 0;
      world.beaconLight.intensity = 0;
    }
  }

  // Funken beim Fahrt-Aufprall: pro Frame aus der Bump-Flanke berechnet
  // (world/burst.js ist eine reine Funktion des Alters -- kein Partikel-
  // Zustand, deterministisch wie die 1980-Splitter). Ein wiederverwendetes
  // LineSegments-Objekt pro Welt; ohne aktiven Wurf unsichtbar.
  function updateSparks(view, b, k) {
    if (!world.sparks) {
      world.sparks = makeBuffer({
        world,
        material: new THREE.LineBasicMaterial({
          color: hdr('#ffffff', 2.5), transparent: true, opacity: 1,
        }),
      });
      world.sparks.ensure(SPARK_COUNT * 6);
    }
    const s = world.sparks;
    // Nur Fahrt-Kollisionen (b.point) funken; Geh-Bumps bleiben Blitz+Impuls.
    const spec = b && b.point ? {
      center: [
        b.point[0] - (b.axis === 'x' ? b.side * SPARK_OFF * view.cell : 0),
        EYE_RATIO * view.cell,
        b.point[1] - (b.axis === 'z' ? b.side * SPARK_OFF * view.cell : 0)],
      count: SPARK_COUNT, speed: SPARK_SPEED * view.cell, life: SPARK_LIFE,
      size: SPARK_SIZE * view.cell, seed: b.at,
    } : null;
    const burst = spec ? burstSegments(view.sceneT - b.at, spec) : null;
    if (!burst) {
      s.hide();
      return;
    }
    const pos = s.pos;
    for (let i = 0; i < burst.segments.length; i++) {
      const [a, c] = burst.segments[i];
      pos.setXYZ(i * 2, a[0] * k, a[1] * k, a[2] * k);
      pos.setXYZ(i * 2 + 1, c[0] * k, c[1] * k, c[2] * k);
    }
    s.mesh.material.opacity = burst.fade;
    s.show(burst.segments.length * 2);
  }

  // --- Kampf (Stufe 4): Tanker, Schuesse, Fadenkreuz, Explosionen -------------

  // Tanker in Prototyp-Optik: dunkler Okta-Koerper mit Glut-Kanten (der
  // Bloom macht das Gluehen). Gebaut pro Feind-LISTE (game.enemies): Retry
  // wuerfelt eine neue Liste, Resume behaelt sie samt Abschuessen -- die
  // Identitaet der Liste ist genau der richtige Rebuild-Schluessel.
  // Geometrie und Materialien werden von allen Tankern geteilt.
  function ensureTankers(game) {
    if (!world.tankers) {
      // src mit null initialisieren: Levels ohne Tanker (game.enemies null)
      // laufen sonst einmal durch einen leeren Rebuild.
      world.tankers = { src: null, group: null, mirrorGroup: null, items: [] };
    }
    const t = world.tankers;
    if (t.src === game.enemies) return t;
    t.src = game.enemies;
    if (t.group) {
      world.scene.remove(t.group);
      world.mirror.remove(t.mirrorGroup);
      t.geo.dispose();
      t.edgeGeo.dispose();
      t.bodyMat.dispose();
      t.edgeMat.dispose();
      t.mirrorEdgeMat.dispose();
    }
    t.group = new THREE.Group();
    t.mirrorGroup = new THREE.Group();
    t.items = [];
    t.geo = new THREE.OctahedronGeometry(1);
    t.edgeGeo = new THREE.EdgesGeometry(t.geo);
    const col = new THREE.Color(enemyColor(game.level));
    t.bodyMat = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(TANKER_BODY_DIM),
      roughness: 0.6, metalness: 0.1,
      emissive: col, emissiveIntensity: TANKER_GLOW,
      side: THREE.DoubleSide, // die Spiegelung (scale.y=-1) invertiert das Winding
      // Der Nebel wusch den dunklen Koerper auf die Hintergrund-Farbe der
      // Waende -- von weitem blieben nur die HDR-Kanten uebrig (Boris'
      // Punkt: "flaechig" muss auf jede Distanz gelten). fog: false haelt
      // die Flaeche lesbar; die Kanten behalten den Nebel als Tiefen-Hinweis.
      fog: false,
    });
    t.edgeMat = new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(TANKER_EDGE_HDR) });
    // Spiegel-Kanten wie ueberall OHNE HDR (kein Bloom im Spiegelbild).
    t.mirrorEdgeMat = new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(0.85) });
    for (const foe of game.enemies ?? []) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(t.geo, t.bodyMat));
      g.add(new THREE.LineSegments(t.edgeGeo, t.edgeMat));
      t.group.add(g);
      const m = new THREE.Group();
      m.add(new THREE.Mesh(t.geo, t.bodyMat));
      m.add(new THREE.LineSegments(t.edgeGeo, t.mirrorEdgeMat));
      t.mirrorGroup.add(m);
      t.items.push({ foe, obj: g, mirrorObj: m });
    }
    world.scene.add(t.group);
    // Unter die Spiegel-Wurzel (scale.y=-1): gleiche Transformationen wie das
    // Original erscheinen automatisch unter dem Boden (Boris' Punkt 2).
    world.mirror.add(t.mirrorGroup);
    return t;
  }

  // Pro Frame: Puls wie die 1980-Raute (ENEMY.pulseFreq/Amp an der Szenenzeit,
  // individuelle Phase), Drehen und Schweben wie im Prototyp (game.time --
  // laeuft ueber Szenen hinweg weiter). Position folgt der Patrouille live;
  // das Spiegelbild bekommt dieselbe Transformation (Parent spiegelt).
  function updateTankers(game, view) {
    const t = ensureTankers(game);
    if (!t.items.length) return;
    t.group.visible = true;
    t.mirrorGroup.visible = true;
    const k = world.kLocal;
    const s = ENEMY.size * UNITS_PER_CELL; // Rauten-Halbhoehe in 3D-Einheiten
    for (const { foe, obj, mirrorObj } of t.items) {
      obj.visible = mirrorObj.visible = foe.alive;
      if (!foe.alive) continue;
      const pulse = 1 + ENEMY.pulseAmp
        * Math.sin(2 * Math.PI * ENEMY.pulseFreq * view.sceneT + foe.phase);
      obj.scale.set(TANKER_WIDTH * s * pulse, s * pulse, TANKER_WIDTH * s * pulse);
      obj.position.set(foe.x * k,
        EYE + TANKER_HOVER * Math.sin(game.time * TANKER_HOVER_FREQ + foe.phase),
        foe.z * k);
      obj.rotation.y = game.time * TANKER_SPIN + foe.phase;
      mirrorObj.position.copy(obj.position);
      mirrorObj.scale.copy(obj.scale);
      mirrorObj.rotation.copy(obj.rotation);
    }
  }

  // Projektile: dieselbe pure Stern-Geometrie wie 1980 (world/shots.js,
  // rotierende Billboards) in EINEM wiederverwendeten LineSegments -- die
  // Tempest-Regel deckelt die Puffergroesse (max 8). Abgrenzung zu den
  // Kollisionsfunken (Boris' Punkt 3): groesser + schneller rotierend
  // (SHOT_PARAMS) und in FLIRRENDEN Arcade-Farben zum Weiss gemischt
  // (harte Schaltung mit SHOT_FLICKER, pro Stern-Linie eine Farbe).
  const shotColor = new THREE.Color();
  const shotWhite = new THREE.Color('#ffffff');
  const SHOT_PARAMS_SCALED = { ...SHOT_PARAMS }; // wiederverwendet (size pro Schuss gesetzt)
  function updateShots(view, k) {
    if (!view.shots.length) return; // resetWorldFrame hat schon versteckt
    if (!world.shotLines) {
      // Spiegelbild: gleiche Geometrie, per Opazitaet gedimmt (die HDR-
      // Farben stecken im vertexColors-Attribut).
      world.shotLines = makeBuffer({
        world, vertexColors: true,
        material: new THREE.LineBasicMaterial({ vertexColors: true }),
        mirrorMaterial: new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: MIRROR_SHOT_OPACITY,
        }),
      });
      world.shotLines.ensure(SHOTS.max * 3 * 6); // Tempest-Regel deckelt
    }
    const { pos, col } = world.shotLines;
    const tick = Math.floor(view.sceneT * SHOT_FLICKER);
    let j = 0;
    let n = 0;
    for (const sh of view.shots) {
      n++;
      // Muendungs-Skalierung (NEAR_STAR): frisch abgefeuert sitzt der Stern
      // AN der Kamera -- er waechst mit der Distanz auf volle Groesse.
      const scale = Math.min(1,
        Math.hypot(sh.x - view.px, sh.z - view.pz) / (NEAR_STAR * view.cell));
      if (scale < 0.01) continue;
      SHOT_PARAMS_SCALED.size = SHOT_PARAMS.size * scale;
      const segs = shotSegments(sh, view.sceneT, {
        cell: view.cell, yaw: view.yaw, height: EYE_RATIO * view.cell,
        params: SHOT_PARAMS_SCALED,
      });
      for (let i = 0; i < segs.length; i++) {
        const [a, b] = segs[i];
        shotColor.set(FIREWORK_COLORS[(tick + n * 3 + i) % FIREWORK_COLORS.length])
          .lerp(shotWhite, SHOT_WHITE_MIX)
          .multiplyScalar(SHOT_HDR);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, b[0] * k, b[1] * k, b[2] * k);
      }
    }
    world.shotLines.show(j);
  }

  // Licht-Widerschein der Schuesse an den Waenden: der feste Licht-Pool
  // (world.shotLights, nur in Schiess-Levels angelegt) folgt den ersten
  // Schuessen -- eigene zuerst, dann die sirrenden Spinner-Schuesse.
  function updateShotLights(view, k) {
    const lights = world.shotLights;
    if (!lights || !lights.length) return;
    let i = 0;
    for (const sh of view.shots) {
      if (i >= lights.length) break;
      lights[i].position.set(sh.x * k, EYE, sh.z * k);
      lights[i].intensity = SHOT_LIGHT;
      i++;
    }
    for (const s of view.foeShots ?? []) {
      if (i >= lights.length) break;
      const [sx, sz] = spinnerShotPos(s);
      lights[i].position.set(sx * k, SPINNER.height * view.cell * k, sz * k);
      lights[i].intensity = SHOT_LIGHT;
      i++;
    }
  }

  // Fadenkreuz: haengt an der ZIELRICHTUNG (aimYaw = Blick + gerampter
  // Lenk-Ausschlag) und sitzt als kleines Kreuz IN DER WELT 2.5 Gangbreiten
  // voraus -- es atmet mit der Perspektive und rollt mit der Kamera mit
  // (das 1980-Pendant zeichnet im Sway). Querarme in der Bildebene des
  // Blicks (Rechts-Richtung aus yaw, wie shotSegments).
  function updateCrosshair(view, k) {
    if (!view.shoot || view.crash || view.reached) return;
    if (!world.crosshair) {
      world.crosshair = makeBuffer({
        world,
        material: new THREE.LineBasicMaterial({
          color: hdr('#ffffff', 1.1), transparent: true, opacity: 0.85, fog: false,
        }),
      });
      world.crosshair.ensure(4 * 6);
    }
    const aim = aimYaw(view.yaw, view.steer);
    const d = CROSSHAIR_DIST * view.cell;
    const cx = (view.px - Math.sin(aim) * d) * k;
    const cy = EYE;
    const cz = (view.pz - Math.cos(aim) * d) * k;
    const r = CROSSHAIR_SIZE * view.cell * k;
    const g = r * CROSSHAIR_GAP;
    const rx = Math.cos(view.yaw); // Rechts-Richtung der Bildebene (xz)
    const rz = -Math.sin(view.yaw);
    const pos = world.crosshair.pos;
    let j = 0;
    const put = (x1, y1, z1, x2, y2, z2) => {
      pos.setXYZ(j++, x1, y1, z1);
      pos.setXYZ(j++, x2, y2, z2);
    };
    put(cx, cy + g, cz, cx, cy + r, cz);
    put(cx, cy - r, cz, cx, cy - g, cz);
    put(cx - rx * r, cy, cz - rz * r, cx - rx * g, cy, cz - rz * g);
    put(cx + rx * g, cy, cz + rz * g, cx + rx * r, cy, cz + rz * r);
    world.crosshair.show(j);
  }

  // Splitter-Explosionen (Verpuffen an der Wand, Tanker-Abschuss, Crash):
  // dieselben puren burst.js-Spezifikationen, die die Szene fuehrt
  // (view.bursts) -- reine Funktion des Alters, deterministisch. Kleiner
  // Pool aus LineSegments mit eigener Farbe pro Explosion (die Farben
  // unterscheiden sich: Feind-Farbe, Schuss-Weiss). Traegt die
  // Spezifikation `shardCount` (Tanker-Abschuss, Crash), fliegen
  // zusaetzlich FLAECHIGE Truemmer-Dreiecke mit (burstShards, Boris'
  // Punkt 4) -- gluehende Platten in der Explosionsfarbe, taumelnd.
  // Helligkeit als BLITZ-Verlauf (burstGlow: erst ueber der Feind-Glut,
  // dann dunkler verglimmen); Splitter UND Truemmer spiegeln sich wie der
  // Feind selbst -- der Glow im Spiegel gedeckelt (kein Bloom im Spiegel).
  function updateBursts(view, k) {
    if (!world.burstPool) world.burstPool = [];
    const pool = world.burstPool;
    let used = 0;
    for (const b of view.bursts) {
      const geo = burstSegments(view.sceneT - b.born, b);
      if (!geo) continue;
      let p = pool[used];
      if (!p) {
        p = pool[used] = {
          line: makeBuffer({
            world,
            material: new THREE.LineBasicMaterial({ transparent: true }),
            mirrorMaterial: new THREE.LineBasicMaterial({ transparent: true }),
          }),
          shard: null,
        };
      }
      p.line.ensure(geo.segments.length * 6);
      const pos = p.line.pos;
      let j = 0;
      for (const [a, c] of geo.segments) {
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        pos.setXYZ(j++, c[0] * k, c[1] * k, c[2] * k);
      }
      const glow = burstGlow(geo.fade, BURST_GLOW);
      p.line.mesh.material.opacity = geo.fade;
      p.line.mesh.material.color.set(b.color ?? '#ffffff').multiplyScalar(glow);
      p.line.mirror.material.opacity = geo.fade;
      p.line.mirror.material.color.set(b.color ?? '#ffffff')
        .multiplyScalar(Math.min(glow, MIRROR_LINE_DIM));
      p.line.show(j);

      const shards = b.shardCount ? burstShards(view.sceneT - b.born, b) : null;
      if (shards) {
        if (!p.shard) {
          const shardMat = () => new THREE.MeshBasicMaterial({
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
          });
          p.shard = makeBuffer({
            world, triangles: true, material: shardMat(), mirrorMaterial: shardMat(),
          });
        }
        p.shard.ensure(shards.triangles.length * 9);
        const sPos = p.shard.pos;
        let sj = 0;
        for (const tri of shards.triangles) {
          for (const [x, y, z] of tri) sPos.setXYZ(sj++, x * k, y * k, z * k);
        }
        const sGlow = burstGlow(shards.fade, SHARD_GLOW);
        p.shard.mesh.material.opacity = shards.fade;
        p.shard.mesh.material.color.set(b.color ?? '#ffffff').multiplyScalar(sGlow);
        p.shard.mirror.material.opacity = shards.fade;
        p.shard.mirror.material.color.set(b.color ?? '#ffffff')
          .multiplyScalar(Math.min(sGlow, MIRROR_LINE_DIM));
        p.shard.show(sj);
      }
      used++;
    }
  }

  // --- Stufe 5: Spinner, Flipper, Pulsare, Spinner-Schuesse, Feuerwerk --------

  // Generischer Feind-Linien-Renderer: pro Feindart EIN dynamisches
  // LineSegments (Puffer waechst bei Bedarf -- der Spinner-Spike aendert
  // seine Segmentzahl beim Wachsen). Die Geometrie kommt FERTIG aus den
  // puren Modulen (lokale Flaechen-Koordinaten -> x kLocal), die Engine
  // zeichnet nur: leuchtende HDR-Konturen in der Feindart-Farbe. Jede Art
  // bekommt ein SPIEGELBILD unter world.mirror -- dieselbe Geometrie-
  // Instanz (der Parent spiegelt mit scale.y=-1), nur ein mattes Material
  // ohne HDR (Regel: kein Bloom im Spiegel).
  // Die drei Feindarten (aus der Funktion gehoben -- kein Closure-Bau pro
  // Frame); Listen und Farben haengen an game/view und kommen als Argumente.
  const FOE_KINDS = [
    { list: (game) => game.spinners, color: (game) => spinnerColor(game.level),
      segs: (s, view) => spinnerSegments(s, view.sceneT, { cell: view.cell }) },
    { list: (game) => game.flippers, color: () => NEON_MAGENTA,
      segs: (f, view) => flipperSegments(f, { cell: view.cell }) },
    { list: (game) => game.pulsars, color: () => ARCADE_YELLOW,
      segs: (p, view) => pulsarSegments(p, view.sceneT, { cell: view.cell }) },
  ];

  function updateFoeLines(game, view) {
    if (!world.foeLines) world.foeLines = FOE_KINDS.map(() => null);
    const k = world.kLocal;
    FOE_KINDS.forEach((kind, i) => {
      const alive = (kind.list(game) ?? []).filter((f) => f.alive);
      let m = world.foeLines[i];
      if (!alive.length) {
        if (m) m.hide();
        return;
      }
      if (!m) {
        m = world.foeLines[i] = makeBuffer({
          world,
          material: new THREE.LineBasicMaterial({}),
          mirrorMaterial: new THREE.LineBasicMaterial({}),
        });
      }
      const segs = [];
      for (const f of alive) segs.push(...kind.segs(f, view));
      m.ensure(segs.length * 6);
      const pos = m.pos;
      let j = 0;
      for (const [a, b] of segs) {
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        pos.setXYZ(j++, b[0] * k, b[1] * k, b[2] * k);
      }
      m.mesh.material.color.set(kind.color(game)).multiplyScalar(FOE_LINE_HDR);
      m.mirror.material.color.set(kind.color(game)).multiplyScalar(MIRROR_LINE_DIM);
      m.show(j);
    });

    updateFlipperFill(game, view, k);
  }

  // Flaechen-Fuellung der Flipper (Boris: "flaechig, nicht nur Kontur"):
  // die vier Schmetterlings-Dreiecke aus flipperTriangles als dunkler
  // Koerper unter der Glut-Kontur (Tanker-Prinzip); das Spiegelbild teilt
  // die Geometrie (DoubleSide vertraegt die Spiegelung).
  function updateFlipperFill(game, view, k) {
    const alive = (game.flippers ?? []).filter((f) => f.alive);
    let m = world.flipperFill;
    if (!alive.length) {
      if (m) m.hide();
      return;
    }
    if (!m) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(NEON_MAGENTA).multiplyScalar(FLIPPER_FILL_DIM),
        transparent: true, opacity: FLIPPER_FILL_OPACITY,
        side: THREE.DoubleSide, depthWrite: false, // die Glut-Kontur gewinnt
        fog: false, // wie der Tanker-Koerper: flaechig auch von weitem
      });
      // Spiegel teilt das Material (DoubleSide vertraegt die Spiegelung).
      m = world.flipperFill = makeBuffer({ world, triangles: true, material: mat, mirrorMaterial: mat });
    }
    const tris = [];
    for (const f of alive) tris.push(...flipperTriangles(f, { cell: view.cell }));
    m.ensure(tris.length * 9);
    const pos = m.pos;
    let j = 0;
    for (const tri of tris) {
      for (const [x, y, z] of tri) pos.setXYZ(j++, x * k, y * k, z * k);
    }
    m.show(j);
  }

  // Sirrende Spinner-Schuesse (ab Level 21): gezackte Stern-Ringe quer zum
  // Gang in FLIRRENDEN Arcade-Farben -- harte 12-Hz-Schaltung pro Schuss
  // (Phase versetzt), wie 1980. Ein Puffer mit vertexColors fuer alle.
  function updateFoeShots(view, k) {
    const shots = view.foeShots;
    if (!shots || !shots.length) return; // resetWorldFrame hat schon versteckt
    let m = world.foeShotLines;
    if (!m) {
      m = world.foeShotLines = makeBuffer({
        world, vertexColors: true,
        material: new THREE.LineBasicMaterial({ vertexColors: true }),
        mirrorMaterial: new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: MIRROR_SHOT_OPACITY,
        }),
      });
    }
    m.ensure(shots.length * 6 * 6); // 6 Ring-Segmente pro Schuss
    const { pos, col } = m;
    let j = 0;
    for (const s of shots) {
      // Er fliegt AUF den Spieler zu: kurz vor dem (toedlichen) Kreuzen
      // schrumpft der Stern statt das Bild zu fuellen (NEAR_STAR-Falle).
      const [sx, sz] = spinnerShotPos(s);
      const scale = Math.min(1,
        Math.hypot(sx - view.px, sz - view.pz) / (NEAR_STAR * view.cell));
      if (scale < 0.01) continue;
      const cy = SPINNER.height * view.cell;
      shotColor.set(FIREWORK_COLORS[
        Math.floor(view.sceneT * FOE_SHOT_FLICKER + (s.phase ?? 0)) % FIREWORK_COLORS.length])
        .multiplyScalar(SHOT_HDR);
      for (const [a, b] of spinnerShotSegments(s, view.sceneT, { cell: view.cell })) {
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, (sx + (a[0] - sx) * scale) * k,
          (cy + (a[1] - cy) * scale) * k, (sz + (a[2] - sz) * scale) * k);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, (sx + (b[0] - sx) * scale) * k,
          (cy + (b[1] - cy) * scale) * k, (sz + (b[2] - sz) * scale) * k);
      }
    }
    m.show(j);
  }

  // Ziel-FEUERWERK: waehrend die Leuchtfeuer-Strahlen weiss verloeschen,
  // spriessen rund ums Ziel senkrechte Strahlen und schalten hart durch
  // die Arcade-Palette nach Weiss (fireworkBeams, pur -- Masse wie 1980).
  // Ein Puffer mit vertexColors, Kapazitaet = FIREWORK.count.
  function updateFireworks(view) {
    if (!view.reached) return;
    const beams = fireworkBeams(view.sceneT - view.reachedAt, {
      seed: view.maze.seed,
      center: [world.u(view.maze.goal[0] + 0.5), world.u(view.maze.goal[1] + 0.5)],
      spread: FIREWORK_SPREAD * UNITS_PER_CELL,
      height: FIREWORK_HEIGHT * UNITS_PER_CELL,
    });
    if (!beams.length) return;
    let m = world.fireworkLines;
    if (!m) {
      m = world.fireworkLines = makeBuffer({
        world, vertexColors: true,
        material: new THREE.LineBasicMaterial({ vertexColors: true, fog: false }),
        mirrorMaterial: new THREE.LineBasicMaterial({
          vertexColors: true, fog: false, transparent: true, opacity: MIRROR_SHOT_OPACITY,
        }),
      });
      m.ensure(FIREWORK.count * 6);
    }
    const { pos, col } = m;
    let j = 0;
    for (const b of beams) {
      shotColor.set(b.color).multiplyScalar(FIREWORK_HDR * b.intensity);
      col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
      pos.setXYZ(j++, b.x, 0, b.z);
      col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
      pos.setXYZ(j++, b.x, b.top, b.z);
    }
    m.show(j);
  }

  // --- Karten-Diagramm: Wachstums-Kontur, Weg, Feind-Kreuze -------------------

  // Teil-Kontur des wachsenden Labyrinths (MazeGen): nur bei geaendertem
  // Zell-Stand neu gebaut (growthOutline ist pur; ~1 Rebuild pro Frame
  // waehrend der 2.6s Wachstum, danach nie wieder).
  function updateGrowth(maze, count) {
    if (!world.growth) world.growth = { buf: null, count: -1, drawCount: 0 };
    const g = world.growth;
    if (count <= 0) {
      g.buf?.hide();
      return;
    }
    if (!g.buf) g.buf = makeBuffer({ world, material: world.lineMat });
    if (count !== g.count) {
      g.count = count;
      const segs = growthOutline(maze, count);
      g.buf.ensure(segs.length * 6); // waechst nur bei neuem Maximum
      const pos = g.buf.pos;
      let i = 0;
      for (const [[x1, y1], [x2, y2]] of segs) {
        pos.setXYZ(i++, world.u(x1), 0.1, world.u(y1));
        pos.setXYZ(i++, world.u(x2), 0.1, world.u(y2));
      }
      g.drawCount = i;
      g.buf.show(i);
    } else {
      g.buf.mesh.visible = true; // unveraendert: nur wieder einblenden
    }
  }

  // Abgelaufener Weg (game.trail, praezise lokale Flaechenpunkte): nur bei
  // Aenderung neu gebaut, halbgedimmt wie die 1980-Weglinie.
  function updateTrail(trail, fadeT) {
    if (!world.trailObj) world.trailObj = { line: null, src: null, len: -1 };
    const t = world.trailObj;
    if (!trail || trail.length < 2 || fadeT <= 0.01) {
      if (t.line) t.line.visible = false;
      return;
    }
    if (trail !== t.src || trail.length !== t.len) {
      t.src = trail;
      t.len = trail.length;
      const k = world.kLocal;
      const pos = new Float32Array(trail.length * 3);
      for (let i = 0; i < trail.length; i++) {
        pos[i * 3] = trail[i][0] * k;
        pos[i * 3 + 1] = 0.12;
        pos[i * 3 + 2] = trail[i][1] * k;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (t.line) {
        t.line.geometry.dispose();
        t.line.geometry = geo;
      } else {
        t.line = new THREE.Line(geo, world.trailMat);
        t.line.frustumCulled = false;
        world.scene.add(t.line);
      }
    }
    t.line.visible = true;
    world.trailMat.opacity = 0.5 * fadeT;
  }

  // Kleine Kreuze an den Positionen der LEBENDEN Feinde, pro Feindart eine
  // eigene Farbe (wie drawEnemyMarkers in mazeView). Patrouillen bewegen
  // sich -> Positionen pro Frame nachgefuehrt (kleine Puffer).
  // Feindart -> Marker-Liste + Farbe (gehoben wie FOE_KINDS).
  const MARK_KINDS = [
    { list: (game) => game.enemies, color: (game) => enemyColor(game.level) },
    { list: (game) => spinnerMarkers(game.spinners), color: (game) => spinnerColor(game.level) },
    { list: (game) => flipperMarkers(game.flippers), color: () => NEON_MAGENTA },
    { list: (game) => pulsarMarkers(game.pulsars), color: () => ARCADE_YELLOW },
  ];

  function updateFoeMarkers(game, fadeF) {
    if (!world.foeMarks) world.foeMarks = MARK_KINDS.map(() => null);
    const k = world.kLocal;
    const r = FOE_MARK_RATIO * UNITS_PER_CELL;
    MARK_KINDS.forEach((kind, i) => {
      const alive = (kind.list(game) ?? []).filter((f) => f.alive);
      let m = world.foeMarks[i];
      if (fadeF <= 0.01 || alive.length === 0) {
        if (m) m.hide();
        return;
      }
      if (!m) {
        m = world.foeMarks[i] = makeBuffer({
          world,
          material: new THREE.LineBasicMaterial({ transparent: true, fog: false }),
        });
      }
      m.ensure(alive.length * 12); // 2 Kreuz-Segmente x 2 Punkte x xyz
      const pos = m.pos;
      let j = 0;
      for (const f of alive) {
        const x = f.x * k, z = f.z * k;
        pos.setXYZ(j++, x - r, 0.14, z);
        pos.setXYZ(j++, x + r, 0.14, z);
        pos.setXYZ(j++, x, 0.14, z - r);
        pos.setXYZ(j++, x, 0.14, z + r);
      }
      m.mesh.material.opacity = fadeF;
      m.mesh.material.color.set(kind.color(game)).multiplyScalar(1.6);
      m.show(j);
    });
  }

  // --- Mini-Map (Stufe 6): runde, mitdrehende Ausschnitts-Karte im Ego --------

  // Buchstaben-Sprite fuer die Mini-Map (N/S/G): wie textSprite in world3d,
  // aber BEWUSST NICHT in world.markerMats -- die Ego-Ansicht blendet die
  // Karten-Beschriftung mit setMarkerFade(0) aus, die Mini-Map-Buchstaben
  // muessen stehen bleiben. depthTest aus: die Scheibe liegt IMMER ueber der
  // Welt (renderOrder staffelt die Lagen).
  function minimapSprite(group, text, size, order) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 96px "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 64, 70);
    const mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true,
      depthTest: false, depthWrite: false, fog: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(size, size, 1);
    sp.renderOrder = order;
    sp.visible = false;
    group.add(sp);
    return sp;
  }

  function minimapLineMat(opacity = 1) {
    return new THREE.LineBasicMaterial({
      transparent: true, opacity, depthTest: false, depthWrite: false, fog: false,
    });
  }

  function ensureMinimap() {
    if (world.minimap) return world.minimap;
    const group = new THREE.Group();
    group.visible = false;
    world.scene.add(group);

    // Dunkle Scheibe als Grund (Lesbarkeit ueber der hellen Ego-Welt).
    const bg = new THREE.Mesh(
      new THREE.CircleGeometry(1, MM_RIM_SEGS),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: MM_BG_OPACITY,
        depthTest: false, depthWrite: false, fog: false,
      }));
    bg.renderOrder = 40;
    group.add(bg);

    // Rand-Kreis (LineLoop) in der Level-Farbe.
    const rimPts = [];
    for (let i = 0; i < MM_RIM_SEGS; i++) {
      const a = (i / MM_RIM_SEGS) * 2 * Math.PI;
      rimPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rimPts), minimapLineMat(0.7));
    rim.renderOrder = 44;
    group.add(rim);

    // Spieler-Pfeil: fest im Zentrum, zeigt nach oben (heading up).
    const pp = [];
    for (const [[x1, y1], [x2, y2]] of PLAYER_MARK) pp.push(x1, y1, 0, x2, y2, 0);
    const player = new THREE.LineSegments(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)),
      minimapLineMat(1));
    player.material.color.copy(hdr('#ffffff', 1.2));
    player.renderOrder = 45;
    group.add(player);

    // Dynamische Puffer (wachsen bei Bedarf): Waende, Trail, Ziel-Pfeil,
    // Feind-Kreuze pro Feindart (Farben wie die Karten-Kreuze).
    const mm = world.minimap = {
      group, rim, player,
      walls: makeBuffer({ world, parent: group, material: minimapLineMat(0.9) }),
      trail: makeBuffer({ world, parent: group, material: minimapLineMat(0.45) }),
      arrow: makeBuffer({ world, parent: group, material: minimapLineMat(1) }),
      foes: MARK_KINDS.map(() => makeBuffer({ world, parent: group, material: minimapLineMat(1) })),
      letterS: minimapSprite(group, 'S', MM_LETTER, 46),
      letterG: minimapSprite(group, 'G', MM_LETTER, 46),
      north: minimapSprite(group, 'N', MM_NORTH, 46),
      mazeSrc: null, themeKey: null,
    };
    mm.walls.ensure(6); mm.walls.mesh.renderOrder = 42;
    mm.trail.ensure(6); mm.trail.mesh.renderOrder = 41;
    mm.arrow.ensure(2 * 6); mm.arrow.mesh.renderOrder = 44;
    mm.arrow.mesh.material.color.set(ARCADE_YELLOW).multiplyScalar(1.6);
    mm.foes.forEach((b) => { b.ensure(6); b.mesh.renderOrder = 43; });
    mm.north.material.opacity = 0.7; // gedimmt wie die Kompass-Buchstaben
    return mm;
  }

  // Segmentliste [x1,y1,x2,y2] (Scheiben-Koordinaten) in einen Puffer giessen.
  function fillDiscSegs(buf, segs) {
    if (!segs.length) { buf.hide(); return; }
    buf.ensure(segs.length * 6);
    const pos = buf.pos;
    let j = 0;
    for (const [x1, y1, x2, y2] of segs) {
      pos.setXYZ(j++, x1, y1, 0);
      pos.setXYZ(j++, x2, y2, 0);
    }
    buf.show(j);
  }

  function updateMinimap(game, view) {
    const mm = ensureMinimap();
    // Beim Crash verschwindet das Instrument (das Bild zerbirst) -- 1980
    // scherbt die Rose mit, hier ist Ausblenden das Pendant.
    if (view.crash) { mm.group.visible = false; return; }
    mm.group.visible = true;

    // Pro Maze einmal: Wand-Kontur + S/G-Zentren in LOKALE Einheiten bringen
    // (minimap.js rechnet in Gangbreiten, die Szene in Flaechen-Einheiten --
    // ein fester Faktor view.cell, einmal beim Cachen multipliziert).
    if (mm.mazeSrc !== view.maze) {
      mm.mazeSrc = view.maze;
      const c = view.cell;
      mm.wallSegs = minimapWalls(view.maze)
        .map(([[x1, y1], [x2, y2]]) => [[x1 * c, y1 * c], [x2 * c, y2 * c]]);
      const sc = cellCenterCells(view.maze, view.maze.start[0], view.maze.start[1]);
      const gc = cellCenterCells(view.maze, view.maze.goal[0], view.maze.goal[1]);
      mm.startAt = [sc[0] * c, sc[1] * c];
      mm.goalAt = [gc[0] * c, gc[1] * c];
    }

    // Farben folgen dem Level-Thema, luminanz-normiert wie die grosse Karte
    // (sonst ueberglueht Gruen die kleine Scheibe, Karten-Glow-Regel).
    if (mm.themeKey !== themeHex) {
      mm.themeKey = themeHex;
      const col = new THREE.Color(themeHex);
      const lineBoost = diagramBoost(themeHex, 1, { ego: EGO_BOOST, targetLum: DIAGRAM_LINE_LUM });
      mm.walls.mesh.material.color.copy(col).multiplyScalar(lineBoost);
      mm.rim.material.color.copy(col).multiplyScalar(lineBoost);
      mm.trail.mesh.material.color.copy(col).multiplyScalar(0.9);
      const markerBoost = diagramBoost(themeHex, 1,
        { ego: EGO_BOOST, targetLum: DIAGRAM_MARKER_LUM, maxBoost: MARKER_BOOST_MAX });
      for (const sp of [mm.letterS, mm.letterG, mm.north]) {
        sp.material.color.copy(col).multiplyScalar(markerBoost);
      }
    }

    // Modell pur berechnen (heading up, an den Kreis geclippt).
    const foes = [];
    MARK_KINDS.forEach((kind, i) => {
      for (const f of kind.list(game) ?? []) {
        if (f.alive) foes.push({ x: f.x, z: f.z, kind: i });
      }
    });
    const model = minimapModel({
      walls: mm.wallSegs, trail: game.trail, foes,
      start: mm.startAt, goal: mm.goalAt,
      px: view.px, pz: view.pz, yaw: view.yaw,
      radius: MINIMAP.viewCells * view.cell,
    });

    fillDiscSegs(mm.walls, model.walls);
    fillDiscSegs(mm.trail, model.trail);

    // Feind-Kreuze pro Feindart (Scheiben-feste Groesse, Farbe wie die Kreuze
    // der grossen Karte).
    MARK_KINDS.forEach((kind, i) => {
      const segs = [];
      for (const f of model.foes) {
        if (f.kind !== i) continue;
        segs.push([f.x - MM_CROSS, f.y, f.x + MM_CROSS, f.y],
          [f.x, f.y - MM_CROSS, f.x, f.y + MM_CROSS]);
      }
      fillDiscSegs(mm.foes[i], segs);
      if (segs.length) {
        mm.foes[i].mesh.material.color.set(kind.color(game)).multiplyScalar(1.6);
      }
    });

    // S/G-Buchstaben nur, wenn sie im Ausschnitt liegen; das Ziel ausserhalb
    // zeigt stattdessen den gelben Richtungspfeil am Rand (pulst wie das
    // Leuchtfeuer; nach dem Ziel-Erreichen ist er erloschen).
    for (const [sp, label] of [[mm.letterS, 'S'], [mm.letterG, 'G']]) {
      const hit = model.letters.find((l) => l.label === label);
      sp.visible = !!hit;
      if (hit) sp.position.set(hit.x, hit.y, 0);
    }
    if (model.goalArrow && !view.reached) {
      fillDiscSegs(mm.arrow, model.goalArrow);
      mm.arrow.mesh.material.opacity = 0.7 + 0.3 * Math.sin(game.time * 2.1);
    } else {
      mm.arrow.hide();
    }

    // N-Marke dreht mit der Scheibe (Kompass-Erbe).
    mm.north.visible = true;
    mm.north.position.set(model.north.x, model.north.y, 0);

    // Kamera-Verankerung: Pose 1:1 uebernehmen und die Scheibe rechts unten
    // in den Sichtkegel legen (Radius als fester Anteil der Bildhoehe).
    const hh = Math.tan((curFov * Math.PI) / 360) * MM_DIST; // halbe Bildhoehe bei MM_DIST
    const r = MM_SCREEN * 2 * hh;
    const margin = MM_MARGIN * 2 * hh;
    mmOffset.set(hh * camera.aspect - r - margin, -(hh - r - margin), -MM_DIST)
      .applyQuaternion(camera.quaternion);
    mm.group.position.copy(camera.position).add(mmOffset);
    mm.group.quaternion.copy(camera.quaternion);
    mm.group.scale.setScalar(r);
  }
  const mmOffset = new THREE.Vector3();

  // --- Kameras: Draufsicht und Schwenk ----------------------------------------

  const scratchCam = new THREE.PerspectiveCamera(); // nur fuer lookAt-Quaternionen
  const qTop = new THREE.Quaternion();
  const qEgo = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const eEgo = new THREE.Euler(0, 0, 0, 'YXZ');
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  function topDownDist() {
    return world.total / (2 * Math.tan((TOP_FOV * Math.PI) / 360) * TOP_FILL);
  }

  // Draufsicht-Quaternion: senkrecht nach unten, Norden (kleines gz) oben.
  function topQuaternion() {
    const c = world.total / 2;
    scratchCam.position.set(c, 1, c);
    scratchCam.up.set(0, 0, -1);
    scratchCam.lookAt(c, 0, c);
    return qTop.copy(scratchCam.quaternion);
  }

  function setTopDownCamera() {
    const c = world.total / 2;
    camera.position.set(c, topDownDist(), c);
    camera.quaternion.copy(topQuaternion());
    setFov(TOP_FOV);
  }

  // Schwenk-Kamera (Reinfallen/Rueckschwenk): a=0 Draufsicht, a=1 Ego-Lage
  // `pose` ({px,pz,yaw}, lokale Flaechen-Einheiten). Position linear (wie
  // blendPose), Orientierung per Quaternion-Slerp -- der 1980-Kameratrick
  // ist in Three.js eingebaut. Der fov blendet 75 (Karte) -> 70 (Ego).
  // `rollExtra` dreht eine Rest-Verdrehung (Pulsar, Sway-Konvention) mit aus.
  function swoopCamera(pose, a, rollExtra = 0) {
    const c = world.total / 2;
    const dist = topDownDist();
    const k = world.kLocal;
    const ex = pose.px * k, ez = pose.pz * k;
    camera.position.set(c + (ex - c) * a, dist + (EYE - dist) * a, c + (ez - c) * a);
    eEgo.set(0, pose.yaw, 0);
    qEgo.setFromEuler(eEgo);
    camera.quaternion.copy(topQuaternion()).slerp(qEgo, a);
    if (Math.abs(rollExtra) > 1e-4) {
      qRoll.setFromAxisAngle(Z_AXIS, -rollExtra); // Sway: roll > 0 = nach rechts
      camera.quaternion.multiply(qRoll);
    }
    setFov(TOP_FOV + (EGO_FOV - TOP_FOV) * a);
  }

  // --- Szenen-Zeichner ---------------------------------------------------------

  // Rueckfall (Szene ohne viewState/Maze, z.B. Direkteinstieg in Tests):
  // langsamer Orbit um den Startscreen-Wuerfel.
  function drawPlaceholder(game) {
    useStartScene();
    setFov(TOP_FOV);
    const t = game.time * 0.2;
    camera.position.set(6 * Math.sin(t), 2, 6 * Math.cos(t));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }

  // Startscreen: Orbit/Andocken/Abdocken mit der ECHTEN Pose der Szene
  // (startscreen.viewState() -- dieselbe Bahn wie 1980). Die Kantenfarbe
  // blendet beim An-/Abdocken zwischen Gruen und der Level-Farbe.
  function drawStartscreen(game, color, view) {
    if (!view) return drawPlaceholder(game);
    // Auf dem Startscreen wird die letzte Labyrinth-Welt nie mehr gezeichnet
    // -- freigeben, statt sie (samt GPU-Puffern) unbegrenzt stehenzulassen.
    if (world) {
      disposeWorld(world);
      world = null;
      worldMaze = null;
      themeHex = null;
    }
    useStartScene();
    setFov(TOP_FOV);
    const [px, py, pz] = view.pose.position;
    camera.position.set(px, py, pz);
    camera.rotation.set(view.pose.pitch, view.pose.yaw, 0);
    start.edgeMat.color.set(view.color ?? PHOSPHOR_GREEN).multiplyScalar(EGO_BOOST);
    twinkleMats(start.starMats, game.time);
    start.scene.backgroundRotation.y = game.time * SKY_DRIFT;
  }

  // Maze-Wachstum: Draufsicht, die Boden-Kontur frisst sich in der
  // Grab-Reihenfolge hinein (wachsende Teil-Kontur statt voller Umriss).
  function drawMazeGen(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    // Der Rahmen kommt mit dem VOLLEN Kanten-Glow der Wuerfelkante an
    // (Andock-Ende) und blendet mit den Markern zur Diagramm-Normierung --
    // ein springender Rahmen-Glow war Teil des "Umschaltens".
    setLineGlow(view.markerFade);
    setTopDownCamera();
    setWallHeight(world, 0);
    world.gridMat.opacity = 0; // kein Raster: die Platte ist die Wuerfelflaeche
    setPlate(1, 1, view.growCount); // die Fraese frisst die Kanaele in Grab-Reihenfolge
    sweepSheen(view.markerFade); // Glanzlicht wischt beim Ankommen ueber die Platte
    world.outlineLines.visible = false; // stattdessen die Teil-Kontur
    updateGrowth(view.maze, view.growCount);
    setMarkerFade(world, view.markerFade);
    updateFoeMarkers(game, view.foeFade);
    updateTrail(null, 0);
    animateWorld(game, null, DIAGRAM_BEACON * view.markerFade); // blendet mit G ein
    world.beaconCone.visible = false;
  }

  // Reinfallen: Schwenk Draufsicht -> Ego; Waende, Nebel und Scheinwerfer
  // wachsen mit e auf, das Karten-Diagramm blendet aus.
  function drawFalling(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    const e = view.e;
    setLineGlow(1 - e);
    world.scene.fog.density = FOG_DENSITY * e;
    world.headlight.intensity = HEADLIGHT_INTENSITY * e;
    setWallHeight(world, e);
    // Crossfade statt Cut: Platte + Gang-Schwarz weichen dem Bodenraster,
    // waehrend die Waende aufwachsen (Boris' "smooth"-Eintauchen, Stufe 6).
    setPlate(1 - e, 1 - e);
    world.gridMat.opacity = 0.8 * e;
    setMarkerFade(world, 1 - e);
    updateFoeMarkers(game, 1 - e);
    updateTrail(view.resume ? game.trail : null, 1 - e);
    swoopCamera(view.target, e);
    world.headlight.position.set(camera.position.x, camera.position.y + 2, camera.position.z);
    // Leuchtfeuer: von der blassen Karten-Saeule zur vollen Ego-Helligkeit;
    // der Kegel kommt erst mit der Ego-Naehe dazu (end-on = Blowout).
    animateWorld(game, null, DIAGRAM_BEACON + (1 - DIAGRAM_BEACON) * e);
    world.beaconCone.material.opacity *= e;
  }

  // Rueckschwenk: dasselbe rueckwaerts; eine Rest-Verdrehung (Pulsar,
  // game.viewRoll) dreht mit dem Ease sanft aus.
  function drawRising(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    const a = 1 - view.e;
    setLineGlow(view.e);
    world.scene.fog.density = FOG_DENSITY * a;
    world.headlight.intensity = HEADLIGHT_INTENSITY * a;
    setWallHeight(world, a);
    setPlate(view.e, view.e); // symmetrisch zum Reinfallen: Platte kommt zurueck
    world.gridMat.opacity = 0.8 * a;
    setMarkerFade(world, view.e);
    updateFoeMarkers(game, view.e);
    updateTrail(game.trail, view.e);
    swoopCamera(view.origin, a, (game.viewRoll ?? 0) * a);
    world.headlight.position.set(camera.position.x, camera.position.y + 2, camera.position.z);
    animateWorld(game, null, DIAGRAM_BEACON + (1 - DIAGRAM_BEACON) * a); // hin zur blassen Karten-Saeule
    world.beaconCone.material.opacity *= a;
  }

  // Karte: Draufsicht auf das flache Labyrinth mit Weg, Markern und Feind-
  // Kreuzen. Beim Verlassen (X) blendet der Inhalt aus, der Rahmen bleibt --
  // er wird zur Wuerfelflaeche des Abdock-Flugs.
  function drawMap(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    // Beim Verlassen laedt sich der Rahmen zum vollen Kanten-Glow auf --
    // exakt der Wert, mit dem die Wuerfelkante des Abdock-Flugs uebernimmt.
    setLineGlow(view.fade);
    setTopDownCamera();
    setWallHeight(world, 0);
    const f = view.fade;
    world.outlineMat.opacity = f;
    world.outlineLines.visible = f > 0.01;
    world.gridMat.opacity = 0;
    // Beim Verlassen "heilt" die Flaeche: die schwarzen Kanaele blenden mit f
    // aus, die Platte bleibt voll -- sie wird zur Wuerfelflaeche des Abdock-Flugs.
    setPlate(1, f);
    sweepSheen(1 - f, -1); // Glanzlicht wischt beim Abschied zurueck
    setMarkerFade(world, f);
    updateFoeMarkers(game, f);
    updateTrail(game.trail, f);
    animateWorld(game, null, DIAGRAM_BEACON * f); // blasse Saeule, blendet mit aus
    world.beaconCone.visible = false;
  }

  // Ego-Ansicht (Playing): Kamera aus dem ECHTEN Spielzustand.
  function drawEgo(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    setLineGlow(0);
    setFov(EGO_FOV);
    world.scene.fog.density = FOG_DENSITY;
    world.headlight.intensity = HEADLIGHT_INTENSITY;
    setWallHeight(world, 1);
    setMarkerFade(world, 0);
    updateFoeMarkers(game, 0);
    updateTrail(null, 0);

    // Spielerlage (lokale Flaechen-Einheiten) -> 3D (Gangbreite = UNITS_PER_CELL).
    const k = world.kLocal;
    let x = view.px * k;
    let z = view.pz * k;
    let shakeRoll = 0;

    // Bump-Feedback: Licht-Blitz an der Wand, dazu je nach Modus --
    //   Gehen (kein `point`): Kamera-Rueckstoss + kurzes Zittern (die
    //     Physik kennt keinen Abpraller, also spielt ihn die Kamera);
    //   Fahrt (`point` aus drive.js): der Feder-Impuls steckt schon in der
    //     Pose und rollOsc/pitchOsc kommen echt ueber view.roll/pitch --
    //     hier nur Blitz + FUNKEN am exakten Auftreffpunkt (statt Wellen).
    // Alles reine Funktionen des Alters -> deterministisch.
    const b = view.bump;
    const age = b ? view.sceneT - b.at : Infinity;
    if (b && age < BUMP_TIME) {
      const decay = Math.exp(-age * 9);
      const d = BUMP_WALL_DIST * UNITS_PER_CELL; // Mindestabstand zur Wand (decay-2-Falle)
      if (b.point) {
        // Blitz KURZ VOR der Wandebene, vom Auftreffpunkt in den Gang gerueckt.
        world.bumpLight.position.set(
          b.point[0] * k - (b.axis === 'x' ? b.side * d : 0), EYE,
          b.point[1] * k - (b.axis === 'z' ? b.side * d : 0));
      } else {
        const push = b.impact * BUMP_RECOIL * UNITS_PER_CELL * decay;
        if (b.axis === 'x') x -= b.side * push;
        else z -= b.side * push;
        shakeRoll = b.impact * BUMP_ROLL * Math.sin(age * 45) * decay;
        world.bumpLight.position.set(
          b.x * k + (b.axis === 'x' ? b.side * d : 0), EYE,
          b.z * k + (b.axis === 'z' ? b.side * d : 0));
      }
      const lp = world.bumpLight.position;
      const dc2 = (lp.x - x) ** 2 + (lp.y - EYE) ** 2 + (lp.z - z) ** 2;
      world.bumpLight.intensity =
        Math.min(BUMP_LIGHT * b.impact * decay, BUMP_LIGHT_CAP * dc2);
    } else {
      world.bumpLight.intensity = 0;
    }
    updateSparks(view, b, k);

    // Kampf (Stufe 4): Tanker, Projektile, Fadenkreuz, Splitter-Explosionen.
    // Der Crash bringt seine Splitter + Truemmer ueber view.bursts mit, der
    // Kamera-Shake kommt echt ueber view.roll/pitch (rollOsc/pitchOsc), den
    // weissen Vollbild-Blitz setzt render() aufs Bild -- hier kommt nur der
    // grelle LICHT-Puls am Einschlag dazu (mit Abstands-Deckel: der Crash
    // ist direkt vor der Kamera, decay-2-Falle).
    updateTankers(game, view);
    updateShots(view, k);
    updateCrosshair(view, k);
    updateBursts(view, k);
    // Stufe 5: Spinner/Flipper/Pulsare als HDR-Konturen aus den puren
    // Modulen, sirrende Spinner-Schuesse, Ziel-Feuerwerk. Der Gyro-Roll
    // steckt schon in view.roll (echter Kamera-Roll, s.u.).
    updateFoeLines(game, view);
    updateFoeShots(view, k);
    updateShotLights(view, k);
    updateFireworks(view);
    if (view.crash && view.crash.t < CRASH_LIGHT_TIME) {
      const lp = world.crashLight.position;
      lp.set(view.crash.x * k, EYE, view.crash.z * k);
      const d2 = (lp.x - x) ** 2 + (lp.z - z) ** 2;
      const fadeL = (1 - view.crash.t / CRASH_LIGHT_TIME) ** 2;
      world.crashLight.intensity =
        Math.min(CRASH_LIGHT * fadeL, CRASH_LIGHT_CAP * Math.max(d2, 1));
    }

    camera.position.set(x, EYE, z);
    // Kamera-Konvention wie im Core: forward = (-sin yaw, 0, -cos yaw) --
    // exakt Three.js' Blick nach -z, um yaw gegiert. Roll/Nick sind hier
    // ERLAUBT (echter 3D-Renderer; die Bildraum-Sway-Falle gilt nur der
    // 1980-Occlusion). Sway-Konvention: roll > 0 = Kamera nach rechts =
    // negative Drehung um die Three.js-Blickachse; pitch passt direkt.
    camera.rotation.set(view.pitch, view.yaw, -(view.roll + shakeRoll));

    // Scheinwerfer schwebt UEBER der Kamera (Mindestabstand zu den Waenden,
    // sonst Bloom-Blowout an naher Wand, siehe world3d.js).
    world.headlight.position.set(x, EYE + 2, z);

    // Mini-Map NACH dem Kamera-Setzen: die Scheibe uebernimmt die Pose
    // DIESES Frames (sonst haengt sie einen Frame nach und "schwimmt").
    updateMinimap(game, view);

    animateWorld(game, view);
  }

  // --- REPLAY (Replay-Modus): Wiedergabe mit Zusatz-Kameras + Gleiter ---------

  // Der Gleiter (world/glider.js, pures Modell): statische Geometrie, pro
  // Frame nur Position/Drehung -- dunkler Koerper unter Glut-Kanten wie der
  // Tanker, plus Spiegelbild unter world.mirror (Transformationen kopiert).
  function ensureGlider(color) {
    if (!world.glider) {
      const U = UNITS_PER_CELL;
      const lineGeo = new THREE.BufferGeometry();
      const lp = [];
      for (const [a, b] of GLIDER.segments) lp.push(...a.map((v) => v * U), ...b.map((v) => v * U));
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const triGeo = new THREE.BufferGeometry();
      const tp = [];
      for (const tri of GLIDER.triangles) for (const p of tri) tp.push(...p.map((v) => v * U));
      triGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      const bodyMat = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide, fog: false, // flaechig auf jede Distanz (Tanker-Regel)
      });
      const edgeMat = new THREE.LineBasicMaterial({});
      const mirrorEdgeMat = new THREE.LineBasicMaterial({}); // ohne HDR (kein Bloom im Spiegel)
      const make = (em) => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(triGeo, bodyMat));
        g.add(new THREE.LineSegments(lineGeo, em));
        g.rotation.order = 'YXZ';
        return g;
      };
      const group = make(edgeMat);
      const mirrorObj = make(mirrorEdgeMat);
      world.scene.add(group);
      world.mirror.add(mirrorObj);
      world.glider = { group, mirrorObj, bodyMat, edgeMat, mirrorEdgeMat, colorKey: null };
    }
    const g = world.glider;
    if (g.colorKey !== color) {
      g.colorKey = color;
      const col = new THREE.Color(color);
      g.bodyMat.color.copy(col).multiplyScalar(GLIDER_BODY_DIM);
      g.edgeMat.color.copy(col).multiplyScalar(GLIDER_EDGE_HDR);
      g.mirrorEdgeMat.color.copy(col).multiplyScalar(0.85);
    }
    return g;
  }

  // gameLike-Fassade fuer die Wiedergabe: dieselben Zeichner (Tanker,
  // Feind-Linien, animateWorld) lesen Feinde/Zeit sonst vom echten game --
  // hier kommen sie aus den aufgezeichneten Puppen (view.foes). EIN stabiles
  // Objekt: die Tanker-Meshes haengen an der Identitaet der enemies-Liste.
  const replayGame = {
    level: 1, time: 0, reachedGoal: false,
    enemies: null, spinners: null, flippers: null, pulsars: null, trail: null,
  };
  function replayGameLike(game, view) {
    replayGame.level = game.level;
    replayGame.time = game.time;
    replayGame.reachedGoal = view.reached;
    replayGame.enemies = view.foes.enemies;
    replayGame.spinners = view.foes.spinners;
    replayGame.flippers = view.foes.flippers;
    replayGame.pulsars = view.foes.pulsars;
    replayGame.trail = game.trail;
    return replayGame;
  }

  // Kamera-Pose EINES Wiedergabe-Modus (Position + Quaternion in pos/quat,
  // Rueckgabe: fov). Reine Funktion der (interpolierten) Pose und der
  // Wiedergabe-Zeit -- damit spult die Kamera deterministisch mit UND die
  // weichen Blenden (C-Wechsel, Rein-/Rausschwenk) koennen zwei Posen
  // mischen, ohne die echte Kamera anzufassen.
  const rcEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const rcPosA = new THREE.Vector3();
  const rcQuatA = new THREE.Quaternion();
  const rcPosB = new THREE.Vector3();
  const rcQuatB = new THREE.Quaternion();

  function computeReplayCamera(view, cam, pos, quat) {
    const U = UNITS_PER_CELL;
    const k = world.kLocal;
    const px = view.px * k;
    const pz = view.pz * k;
    const yaw = view.yaw;
    if (cam === 'ego') {
      // Ego: exakt die Spiel-Kamera (inkl. Gyro-Roll als echtem Roll).
      pos.set(px, EYE, pz);
      rcEuler.set(view.pitch, yaw, -view.roll);
      quat.setFromEuler(rcEuler);
      return RCAM_FOV.ego;
    }
    scratchCam.up.set(0, 1, 0);
    if (cam === 'chase') {
      // Hinter (+forward-Gegenrichtung) und ueber dem Gleiter, Blick voraus.
      scratchCam.position.set(
        px + Math.sin(yaw) * RCAM.chaseBack * U,
        EYE + RCAM.chaseUp * U,
        pz + Math.cos(yaw) * RCAM.chaseBack * U);
      scratchCam.lookAt(
        px - Math.sin(yaw) * RCAM.chaseAhead * U, EYE,
        pz - Math.cos(yaw) * RCAM.chaseAhead * U);
    } else if (cam === 'bird') {
      scratchCam.position.set(
        px + Math.sin(yaw) * RCAM.birdBack * U,
        EYE + RCAM.birdUp * U,
        pz + Math.cos(yaw) * RCAM.birdBack * U);
      scratchCam.lookAt(px, EYE, pz);
    } else if (cam === 'total') {
      const c = world.total / 2;
      scratchCam.position.set(c, RCAM.totalUp * world.total, c + RCAM.totalBack * world.total);
      scratchCam.lookAt(c, 0, c);
    } else { // 'orbit'
      const a = view.sceneT * RCAM.orbitRate;
      scratchCam.position.set(
        px + Math.cos(a) * RCAM.orbitRadius * U,
        EYE + RCAM.orbitUp * U,
        pz + Math.sin(a) * RCAM.orbitRadius * U);
      scratchCam.lookAt(px, EYE, pz);
    }
    pos.copy(scratchCam.position);
    quat.copy(scratchCam.quaternion);
    return RCAM_FOV[cam] ?? EGO_FOV;
  }

  // Nebel pro Kamera: nah an der Ego-Hoehe voll, hohe Kameras klarer
  // (die Totale saehe sonst nur Waschgrau).
  const RCAM_FOG = { ego: 1, chase: 1, bird: 0.45, total: 0, orbit: 0.8 };
  // Naeher als das darf die Kamera dem Gleiter nicht kommen, sonst blendet
  // er aus (Gangbreiten) -- die Ego-Kamera sitzt IN ihm, und die Blenden
  // Richtung Ego fliegen durch ihn hindurch.
  const GLIDER_HIDE_DIST = 1.0;

  function drawReplay(game, color, view) {
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    const gameLike = replayGameLike(game, view);
    const rp = view.replay;
    const lerp = (a, b, f) => a + (b - a) * f;

    // Ziel-Kamera in rcPosB/rcQuatB -- inkl. laufender Kamera-Modus-Blende
    // (C): Position lerpt, Orientierung slerpt, fov/Nebel/Glow blenden mit.
    let fov = computeReplayCamera(view, rp.cam, rcPosB, rcQuatB);
    let glow = RCAM_GLOW[rp.cam] ?? 0;
    let fogF = RCAM_FOG[rp.cam] ?? 1;
    if (rp.camPrev && rp.camE < 1) {
      const fovA = computeReplayCamera(view, rp.camPrev, rcPosA, rcQuatA);
      rcPosB.lerpVectors(rcPosA, rcPosB, rp.camE);
      // ALIASING-FALLE: slerpQuaternions(a, b, t) kopiert ZUERST a nach
      // this -- mit this === b waere das Ziel zerstoert und die Blende
      // stuende still (Cut am Ende). Darum a IN PLACE slerpen, dann kopieren.
      rcQuatB.copy(rcQuatA.slerp(rcQuatB, rp.camE));
      fov = lerp(fovA, fov, rp.camE);
      glow = lerp(RCAM_GLOW[rp.camPrev] ?? 0, glow, rp.camE);
      fogF = lerp(RCAM_FOG[rp.camPrev] ?? 1, fogF, rp.camE);
    }

    // Rein-/Rausschwenk (viewE < 1): von der Karten-Draufsicht zur
    // Wiedergabe-Kamera -- dieselbe Rezeptur wie Falling/Rising (Waende
    // wachsen, Platte/Kanaele und Karten-Kleid blenden gegenlaeufig).
    const e = rp.viewE ?? 1;
    if (e < 1) {
      const c = world.total / 2;
      rcPosA.set(c, topDownDist(), c);
      rcPosB.lerpVectors(rcPosA, rcPosB, e);
      // Gleiche Aliasing-Falle wie bei der Kamera-Blende (s.o.):
      // Draufsicht-Quat in place zum Ziel slerpen, dann uebernehmen.
      rcQuatB.copy(topQuaternion().slerp(rcQuatB, e));
      fov = lerp(TOP_FOV, fov, e);
      glow = lerp(1, glow, e); // Karten-Glow (Diagramm-Normierung) -> Kamera-Glow
      fogF *= e;
      setPlate(1 - e, 1 - e);
      world.gridMat.opacity = 0.8 * e;
    }
    setLineGlow(glow);
    world.scene.fog.density = FOG_DENSITY * fogF;
    world.headlight.intensity = HEADLIGHT_INTENSITY * e;
    setWallHeight(world, e);
    // Von oben sind die Waende sonst hohl (offene Kaesten): in der
    // Wiedergabe tragen sie Deckel (world3d.js, wallCaps) -- erst ab etwas
    // Hoehe, ganz flach laegen sie auf der Platte (Z-Fighting).
    world.wallCaps.visible = e > 0.05;
    setMarkerFade(world, 1 - e);
    updateFoeMarkers(gameLike, 1 - e);
    updateTrail(game.trail, 1 - e);

    camera.position.copy(rcPosB);
    camera.quaternion.copy(rcQuatB);
    setFov(fov);
    world.headlight.position.set(camera.position.x, camera.position.y + 2, camera.position.z);

    // Welt-Inhalt (Feinde, Schuesse, Effekte, Gleiter) erst, wenn die
    // Kamera angekommen ist -- waehrend der Schwenks stehen wie bei
    // Falling/Rising die Feind-Kreuze (gleiche Bildsprache).
    if (e < 1) {
      animateWorld(gameLike, view, DIAGRAM_BEACON + (1 - DIAGRAM_BEACON) * e);
      world.beaconCone.material.opacity *= e;
      return;
    }

    const k = world.kLocal;
    updateTankers(gameLike, view);
    updateShots(view, k);
    updateBursts(view, k);
    updateFoeLines(gameLike, view);
    updateFoeShots(view, k);
    updateShotLights(view, k);
    updateFireworks(view);
    updateSparks(view, view.bump, k); // Fahrt-Aufpraelle funken wie live

    // Crash in der Aufnahme: greller Licht-Puls am Einschlag (der weisse
    // Vollbild-Blitz kommt in render(), wie im Spiel).
    if (view.crash && view.crash.t < CRASH_LIGHT_TIME) {
      const lp = world.crashLight.position;
      lp.set(view.crash.x * k, EYE, view.crash.z * k);
      const d2 = (lp.x - view.px * k) ** 2 + (lp.z - view.pz * k) ** 2;
      const fadeL = (1 - view.crash.t / CRASH_LIGHT_TIME) ** 2;
      world.crashLight.intensity =
        Math.min(CRASH_LIGHT * fadeL, CRASH_LIGHT_CAP * Math.max(d2, 1));
    }

    // Der Gleiter fliegt in den Aussen-Kameras; Kurvenneigung aus dem
    // aufgezeichneten bank-Kanal. Sichtbarkeit per KAMERA-ABSTAND statt
    // Modus-Name: die Blenden Richtung Ego fliegen in ihn hinein -- kurz
    // davor blendet er aus (und im Crash-Moment verschwindet er sowieso).
    const glider = ensureGlider(color);
    glider.group.position.set(view.px * k, GLIDER.height * UNITS_PER_CELL, view.pz * k);
    glider.group.rotation.set(0, view.yaw, -(view.bank ?? 0) * GLIDER.bankGain);
    glider.mirrorObj.position.copy(glider.group.position);
    glider.mirrorObj.rotation.copy(glider.group.rotation);
    const showGlider = !view.crash
      && camera.position.distanceTo(glider.group.position) > GLIDER_HIDE_DIST * UNITS_PER_CELL;
    glider.group.visible = showGlider;
    glider.mirrorObj.visible = showGlider;

    animateWorld(gameLike, view);
  }

  const drawers = {
    [State.STARTSCREEN]: drawStartscreen,
    [State.MAZE_GEN]: drawMazeGen,
    [State.FALLING]: drawFalling,
    [State.PLAYING]: drawEgo,
    [State.RISING]: drawRising,
    [State.MAP]: drawMap,
    [State.REPLAY]: drawReplay,
  };

  // --- DOM-Texte pro Frame (Platzhalter-HUD) ----------------------------------
  // `view` ist der von render() EINMAL pro Frame geholte viewState der Szene.
  function labelText(game, view) {
    switch (game.stateKey) {
      case State.PLAYING: {
        if (view?.crash) return '';
        if (view?.reached) return 'YOU MADE IT';
        // In der Demo keine Steuer-Zeile (keine Controls).
        if (game.demo) return 'FIND THE EXIT';
        // Steuer-Zeile aus core/hud.js -- Wortlaut und Lenk-Tasten-Mapping
        // (Pulsar-Rotation) identisch mit der 1980-Engine.
        return 'FIND THE EXIT - ' + playHint(view ?? {});
      }
      case State.MAP:
        if (game.demo) return ''; // Demo: keine Karten-Controls
        // Wortlaut wie 1980; blendet per Opacity mit aus. R nur, wenn eine
        // Aufzeichnung abspielbar ist (core/recorder.js).
        return mapHint({
          reachedGoal: game.reachedGoal, gameOver: game.gameOver,
          replay: hasRecording(game.recording),
        });
      case State.REPLAY:
        // HUD erst, wenn der Reinschwenk angekommen ist (wie 1980).
        return view?.replay && view.replay.viewE >= 0.999
          ? replayStatus(view.replay) + '  -  ' + replayHint({ cams: true })
          : '';
      default:
        return '';
    }
  }

  function updateOverlays(game, sceneView) {
    const mapView = game.stateKey === State.MAP ? sceneView : null;
    setText(label, labelText(game, sceneView));
    // Der Karten-Hinweis blendet mit der Karte aus (wie 1980: intensity*fade).
    label.style.opacity = mapView ? String(mapView.fade) : '1';

    // Fortschritts-Linie der Wiedergabe (nur im REPLAY-Zustand, nicht
    // waehrend der Rein-/Rausschwenks).
    const rpView = game.stateKey === State.REPLAY ? sceneView?.replay : null;
    const rp = rpView && rpView.viewE >= 0.999 ? rpView : null;
    progressEl.style.display = rp ? '' : 'none';
    if (rp) {
      const p = rp.duration > 1e-9 ? rp.t / rp.duration : 0;
      progressBar.style.width = (100 * Math.max(0, Math.min(1, p))).toFixed(2) + '%';
    }

    // Startscreen-Texte: waehrend des Umtanzens (wie 1980) -- und im
    // Attract-Mode bleiben sie ueber JEDER Szene stehen (Demo-Overlay:
    // Level-AUSWAHL, Engine-Schalter, blinkendes PRESS S).
    const view = game.stateKey === State.STARTSCREEN ? sceneView : null;
    const orbiting = view?.phase === 'orbiting';
    const overlayOn = orbiting || game.demo;
    const blink = orbiting ? view.blink : blinkOn(game.time);
    setText(title, overlayOn ? `LEVEL ${displayLevel(game)}` : '');
    setText(press, overlayOn && blink ? 'PRESS S TO START' : '');
    if (overlayOn) {
      const dim = (eng) => (game.engine === eng ? 1 : 0.3);
      setHtml(switchLine,
        `<span style="opacity:${dim('1980')}">1980</span>` +
        '<span style="opacity:.3"> / </span>' +
        `<span style="opacity:${dim('2026')}">2026</span>`);
    } else {
      setHtml(switchLine, '');
    }

    // GAME OVER auf der Karte: Farb-Puls rot<->weiss aus core/hud.js
    // (wie 1980 -- Helligkeits-Pulsieren wirkte "durchgestrichen").
    if (mapView && game.gameOver && mapView.fade > 0.01) {
      setText(headline, 'GAME OVER');
      headline.style.color = gameOverColor(mapView.t);
      headline.style.opacity = String(mapView.fade);
      headline.style.textShadow = '0 0 14px rgba(255,60,50,.7)';
    } else {
      setText(headline, '');
    }
  }

  return {
    // Wird von game.render() pro Frame gerufen (Naht der Engines).
    render(game) {
      // viewState EINMAL pro Frame holen -- Zeichner, Overlays und der
      // Crash-Blitz teilen sich denselben Schnappschuss.
      const view = game.current.viewState?.() ?? null;
      // Gleiche Farb-Regel wie game.render() fuer die 1980-Engine.
      const color = game.stateKey === State.STARTSCREEN
        ? PHOSPHOR_GREEN
        : levelColor(game.level);
      (drawers[game.stateKey] ?? drawPlaceholder)(game, color, view);
      composer.render();

      updateOverlays(game, view);

      // Crash-Einschlag (Stufe 4): weisser Vollbild-Blitz, quadratisch
      // ausklingend (haerter Einschlag, weiches Verglimmen), waehrend
      // Splitter + Truemmer fliegen (analog renderer.flash in 1980) --
      // auch in der Wiedergabe (dort haengt crash.t am Replay-Zeiger).
      const pv = game.stateKey === State.PLAYING || game.stateKey === State.REPLAY
        ? view : null;
      flashEl.style.opacity = pv?.crash && pv.crash.t < CRASH_FLASH
        ? String(0.95 * (1 - pv.crash.t / CRASH_FLASH) ** 2)
        : '0';
    },

    // Live-Engine-Schalter (Stufe 3): main.js blendet die ganze 2026-Ausgabe
    // (Canvas + Overlays) ein/aus, ohne sie wegzuwerfen.
    setVisible(v) {
      root.style.display = v ? '' : 'none';
    },

    // Debug-Haken fuer die CDP-Sichtpruefung: Kamera-Pose des letzten
    // Frames -- damit laesst sich die STETIGKEIT der Schwenks/Blenden
    // numerisch messen (ein Cut ist ein Sprung in der Zeitreihe).
    debugCamera() {
      return {
        pos: camera.position.toArray(),
        quat: camera.quaternion.toArray(),
        fov: curFov,
      };
    },

    resize(cssWidth, cssHeight, dpr = 1) {
      renderer.setPixelRatio(dpr); // Deckelung (max 2) macht der Aufrufer
      renderer.setSize(cssWidth, cssHeight);
      composer.setSize(cssWidth, cssHeight);
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
    },

    // Hartes Lebensende (kompletter Rueckbau): Welt, Startscreen-Szene,
    // Composer-Targets und GL-Kontext freigeben, DOM-Wurzel entfernen.
    // Der Live-Schalter nutzt weiter setVisible (bewusst ohne Wegwerfen);
    // dispose ist fuer einen kuenftigen "harten" Schalter bzw. Teardown.
    dispose() {
      if (world) {
        disposeWorld(world);
        world = null;
        worldMaze = null;
        themeHex = null;
      }
      if (start) {
        disposeWorld(start); // traversiert start.scene genauso
        start = null;
      }
      composer.dispose(); // inkl. eigener RenderTargets
      target.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
