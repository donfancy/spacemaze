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
import { playHint, mapHint, gameOverColor } from '../core/hud.js';
import { levelColor, levelConfig, enemyColor, spinnerColor } from '../core/levels.js';
import { PHOSPHOR_GREEN, ARCADE_YELLOW, NEON_MAGENTA } from '../render/colors.js';
import { EYE_RATIO, cellSize } from '../scenes/mazeView.js';
import { burstSegments, burstShards } from '../world/burst.js';
import { ENEMY } from '../world/enemies.js';
import { SHOTS, aimYaw, shotSegments } from '../world/shots.js';
import { FIREWORK, FIREWORK_COLORS, fireworkBeams } from '../world/fireworks.js';
import { growthOutline } from '../world/mazeGeometry.js';
import {
  SPINNER, spinnerMarkers, spinnerSegments, spinnerShotSegments, spinnerShotPos,
} from '../world/spinners.js';
import { flipperMarkers, flipperSegments, flipperTriangles } from '../world/flippers.js';
import { pulsarMarkers, pulsarSegments } from '../world/pulsars.js';
import {
  buildWorld, applyTheme, disposeWorld, hdr, setWallHeight, setMarkerFade,
  UNITS_PER_CELL, FOG_DENSITY, HEADLIGHT_INTENSITY, EGO_BOOST, MIRROR_LINE_DIM,
} from './world3d.js';
import { buildStartscreenScene } from './startscreen3d.js';

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
const BURST_HDR = 2.4;          // Splitter-Farben leicht in den Bloom geboostet
const SHARD_HDR = 1.35;         // flaechige Truemmer: gluehende Platten, kein Voll-Bloom

// Schuesse: groesser und schneller rotierend als die 1980-Defaults, damit
// sie sich klar von den Kollisionsfunken abheben (Boris' Punkt); dazu
// FLIRRENDE Arcade-Farben zum Weiss gemischt (harte Schaltung wie 1981).
const SHOT_PARAMS = { size: 0.12, spin: 18 };
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
// (0.85) arbeitet auf LUMINANZ -- Phosphor-Gruen (lum ~0.81) landet mit dem
// festen HDR-Boost x2.2 weit darueber und ueberglueht die dichte Karte,
// Tempest-Blau (lum ~0.48) nur knapp. In den DIAGRAMM-Ansichten wird der
// Boost deshalb LUMINANZ-NORMIERT (Ziel knapp ueberm Schwellwert), die
// Schwenks blenden zum vollen Ego-Boost; die Ego-Ansicht bleibt unveraendert.
const DIAGRAM_LINE_LUM = 1.0;   // Ziel-Luminanz der Karten-Linien
const DIAGRAM_MARKER_LUM = 1.0; // Buchstaben: ueberall ein LEICHTER Glow
                                // (1.15 machte um S/G runde Bloom-Flecken)
const MARKER_BOOST_MAX = 3.0;   // Deckel fuer dunkle Farben (Blau braucht mehr Boost)
const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// Leuchtfeuer in der Draufsicht: BLASSE Lichtsaeule am Ziel (Boris' Punkt 4,
// 26.8.2026 -- "macht alles verstehbarer"), die Schwenks blenden von dort
// zur vollen Ego-Helligkeit. Der additive KEGEL bleibt im Diagramm aus
// (von oben laengs durchblickt = Blowout, Stufe-3-Falle).
const DIAGRAM_BEACON = 0.25;

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
    if (!start) start = buildStartscreenScene();
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
    if (world.sparks) world.sparks.visible = false;
    world.gridMat.opacity = 0.8;
    world.outlineMat.opacity = 1;
    world.outlineLines.visible = true;
    if (world.growth?.lines) world.growth.lines.visible = false;
    // Kampf-Objekte (Stufe 4): nur die Ego-Ansicht schaltet sie sichtbar --
    // in den Draufsichten stehen stattdessen die Feind-Kreuze.
    if (world.tankers?.group) {
      world.tankers.group.visible = false;
      world.tankers.mirrorGroup.visible = false;
    }
    if (world.shotLines) world.shotLines.visible = false;
    if (world.crosshair) world.crosshair.visible = false;
    if (world.burstPool) {
      for (const p of world.burstPool) {
        p.mesh.visible = false;
        if (p.shardMesh) p.shardMesh.visible = false;
      }
    }
    world.crashLight.intensity = 0;
    for (const light of world.shotLights) light.intensity = 0;
    if (world.foeLines) {
      for (const m of world.foeLines) {
        if (m) m.mesh.visible = m.mirror.visible = false;
      }
    }
    if (world.flipperFill) {
      world.flipperFill.mesh.visible = world.flipperFill.mirror.visible = false;
    }
    if (world.shotMirror) world.shotMirror.visible = false;
    if (world.foeShotLines) {
      world.foeShotLines.mesh.visible = world.foeShotLines.mirror.visible = false;
    }
    if (world.fireworkLines) {
      world.fireworkLines.mesh.visible = world.fireworkLines.mirror.visible = false;
    }
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
    const lum = Math.max(luminance(col), 1e-3);
    const lineBoost = EGO_BOOST + (Math.min(EGO_BOOST, DIAGRAM_LINE_LUM / lum) - EGO_BOOST) * mix;
    world.lineMat.color.copy(col).multiplyScalar(lineBoost);
    world.outlineMat.color.copy(col).multiplyScalar(lineBoost);
    const markerBoost = EGO_BOOST
      + (Math.min(MARKER_BOOST_MAX, DIAGRAM_MARKER_LUM / lum) - EGO_BOOST) * mix;
    for (const { mat } of world.markerMats) mat.color.copy(col).multiplyScalar(markerBoost);
  }

  // Gemeinsame Welt-Animation: Sterne funkeln, Leuchtfeuer pulsiert -- und am
  // Ziel strahlt es weiss auf und erlischt (wie die 1980-Strahlen). `view`
  // kommt aus playing.viewState() (null in der Draufsicht: dort entscheidet
  // game.reachedGoal, ob das Leuchtfeuer noch brennt). `dim` blendet das
  // Leuchtfeuer mit (Maze-Wachstum, Karten-Exit).
  function animateWorld(game, view, dim = 1) {
    world.starGroups.forEach((mat, i) => {
      mat.opacity = 0.75 + 0.25 * Math.sin(game.time * (1.3 + i * 0.7) + i * 2.1);
    });

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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 6), 3));
      world.sparks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: hdr('#ffffff', 2.5), transparent: true, opacity: 1,
      }));
      world.sparks.frustumCulled = false; // Positionen aendern sich pro Frame
      world.scene.add(world.sparks);
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
      s.visible = false;
      return;
    }
    s.visible = true;
    const pos = s.geometry.attributes.position;
    for (let i = 0; i < burst.segments.length; i++) {
      const [a, c] = burst.segments[i];
      pos.setXYZ(i * 2, a[0] * k, a[1] * k, a[2] * k);
      pos.setXYZ(i * 2 + 1, c[0] * k, c[1] * k, c[2] * k);
    }
    pos.needsUpdate = true;
    s.geometry.setDrawRange(0, burst.segments.length * 2);
    s.material.opacity = burst.fade;
  }

  // --- Kampf (Stufe 4): Tanker, Schuesse, Fadenkreuz, Explosionen -------------

  // Tanker in Prototyp-Optik: dunkler Okta-Koerper mit Glut-Kanten (der
  // Bloom macht das Gluehen). Gebaut pro Feind-LISTE (game.enemies): Retry
  // wuerfelt eine neue Liste, Resume behaelt sie samt Abschuessen -- die
  // Identitaet der Liste ist genau der richtige Rebuild-Schluessel.
  // Geometrie und Materialien werden von allen Tankern geteilt.
  function ensureTankers(game) {
    if (!world.tankers) {
      world.tankers = { src: undefined, group: null, mirrorGroup: null, items: [] };
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
  function updateShots(view, k) {
    if (!view.shots.length) return; // resetWorldFrame hat schon versteckt
    if (!world.shotLines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(SHOTS.max * 3 * 6), 3));
      geo.setAttribute('color',
        new THREE.BufferAttribute(new Float32Array(SHOTS.max * 3 * 6), 3));
      world.shotLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true,
      }));
      world.shotLines.frustumCulled = false;
      world.scene.add(world.shotLines);
      // Spiegelbild: gleiche Geometrie, per Opazitaet gedimmt (die HDR-
      // Farben stecken im vertexColors-Attribut).
      world.shotMirror = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: MIRROR_SHOT_OPACITY,
      }));
      world.shotMirror.frustumCulled = false;
      world.mirror.add(world.shotMirror);
    }
    const pos = world.shotLines.geometry.attributes.position;
    const col = world.shotLines.geometry.attributes.color;
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
      const segs = shotSegments(sh, view.sceneT, {
        cell: view.cell, yaw: view.yaw, height: EYE_RATIO * view.cell,
        params: { ...SHOT_PARAMS, size: SHOT_PARAMS.size * scale },
      });
      for (let i = 0; i < segs.length; i++) {
        const [a, b] = segs[i];
        shotColor.set(FIREWORK_COLORS[(tick + n * 3 + i) % FIREWORK_COLORS.length])
          .lerp(shotWhite, SHOT_WHITE_MIX)
          .multiplyScalar(BURST_HDR);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, b[0] * k, b[1] * k, b[2] * k);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    world.shotLines.geometry.setDrawRange(0, j);
    world.shotLines.visible = world.shotMirror.visible = true;
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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6), 3));
      world.crosshair = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: hdr('#ffffff', 1.1), transparent: true, opacity: 0.85, fog: false,
      }));
      world.crosshair.frustumCulled = false;
      world.scene.add(world.crosshair);
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
    const pos = world.crosshair.geometry.attributes.position;
    let j = 0;
    const put = (x1, y1, z1, x2, y2, z2) => {
      pos.setXYZ(j++, x1, y1, z1);
      pos.setXYZ(j++, x2, y2, z2);
    };
    put(cx, cy + g, cz, cx, cy + r, cz);
    put(cx, cy - r, cz, cx, cy - g, cz);
    put(cx - rx * r, cy, cz - rz * r, cx - rx * g, cy, cz - rz * g);
    put(cx + rx * g, cy, cz + rz * g, cx + rx * r, cy, cz + rz * r);
    pos.needsUpdate = true;
    world.crosshair.visible = true;
  }

  // Splitter-Explosionen (Verpuffen an der Wand, Tanker-Abschuss, Crash):
  // dieselben puren burst.js-Spezifikationen, die die Szene fuehrt
  // (view.bursts) -- reine Funktion des Alters, deterministisch. Kleiner
  // Pool aus LineSegments mit eigener Farbe pro Explosion (die Farben
  // unterscheiden sich: Feind-Farbe, Schuss-Weiss). Traegt die
  // Spezifikation `shardCount` (Tanker-Abschuss, Crash), fliegen
  // zusaetzlich FLAECHIGE Truemmer-Dreiecke mit (burstShards, Boris'
  // Punkt 4) -- gluehende Platten in der Explosionsfarbe, taumelnd.
  function updateBursts(view, k) {
    if (!world.burstPool) world.burstPool = [];
    const pool = world.burstPool;
    let used = 0;
    for (const b of view.bursts) {
      const geo = burstSegments(view.sceneT - b.born, b);
      if (!geo) continue;
      let p = pool[used];
      const floats = geo.segments.length * 6;
      if (!p || p.cap < floats) {
        if (p) {
          world.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          if (p.shardMesh) {
            world.scene.remove(p.shardMesh);
            p.shardMesh.geometry.dispose();
            p.shardMesh.material.dispose();
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
        const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ transparent: true }));
        mesh.frustumCulled = false;
        world.scene.add(mesh);
        p = pool[used] = { mesh, cap: floats, shardMesh: null, shardCap: 0 };
      }
      const pos = p.mesh.geometry.attributes.position;
      let j = 0;
      for (const [a, c] of geo.segments) {
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        pos.setXYZ(j++, c[0] * k, c[1] * k, c[2] * k);
      }
      pos.needsUpdate = true;
      p.mesh.geometry.setDrawRange(0, j);
      p.mesh.material.opacity = geo.fade;
      p.mesh.material.color.set(b.color ?? '#ffffff').multiplyScalar(BURST_HDR);
      p.mesh.visible = true;

      const shards = b.shardCount ? burstShards(view.sceneT - b.born, b) : null;
      if (shards) {
        const sFloats = shards.triangles.length * 9;
        if (!p.shardMesh || p.shardCap < sFloats) {
          if (p.shardMesh) {
            world.scene.remove(p.shardMesh);
            p.shardMesh.geometry.dispose();
            p.shardMesh.material.dispose();
          }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sFloats), 3));
          p.shardMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
          }));
          p.shardMesh.frustumCulled = false;
          world.scene.add(p.shardMesh);
          p.shardCap = sFloats;
        }
        const sPos = p.shardMesh.geometry.attributes.position;
        let sj = 0;
        for (const tri of shards.triangles) {
          for (const [x, y, z] of tri) sPos.setXYZ(sj++, x * k, y * k, z * k);
        }
        sPos.needsUpdate = true;
        p.shardMesh.geometry.setDrawRange(0, sj);
        p.shardMesh.material.opacity = shards.fade;
        p.shardMesh.material.color.set(b.color ?? '#ffffff').multiplyScalar(SHARD_HDR);
        p.shardMesh.visible = true;
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
  function updateFoeLines(game, view) {
    const kinds = [
      { list: game.spinners, color: spinnerColor(game.level),
        segs: (s) => spinnerSegments(s, view.sceneT, { cell: view.cell }) },
      { list: game.flippers, color: NEON_MAGENTA,
        segs: (f) => flipperSegments(f, { cell: view.cell }) },
      { list: game.pulsars, color: ARCADE_YELLOW,
        segs: (p) => pulsarSegments(p, view.sceneT, { cell: view.cell }) },
    ];
    if (!world.foeLines) world.foeLines = kinds.map(() => null);
    const k = world.kLocal;
    kinds.forEach((kind, i) => {
      const alive = (kind.list ?? []).filter((f) => f.alive);
      let m = world.foeLines[i];
      if (!alive.length) {
        if (m) m.mesh.visible = m.mirror.visible = false;
        return;
      }
      const segs = [];
      for (const f of alive) segs.push(...kind.segs(f));
      const floats = segs.length * 6;
      if (!m || m.cap < floats) {
        if (m) {
          world.scene.remove(m.mesh);
          world.mirror.remove(m.mirror);
          m.mesh.geometry.dispose();
          m.mesh.material.dispose();
          m.mirror.material.dispose();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
        const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({}));
        mesh.frustumCulled = false;
        world.scene.add(mesh);
        const mirror = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({}));
        mirror.frustumCulled = false;
        world.mirror.add(mirror);
        m = world.foeLines[i] = { mesh, mirror, cap: floats };
      }
      const pos = m.mesh.geometry.attributes.position;
      let j = 0;
      for (const [a, b] of segs) {
        pos.setXYZ(j++, a[0] * k, a[1] * k, a[2] * k);
        pos.setXYZ(j++, b[0] * k, b[1] * k, b[2] * k);
      }
      pos.needsUpdate = true;
      m.mesh.geometry.setDrawRange(0, j);
      m.mesh.material.color.set(kind.color).multiplyScalar(FOE_LINE_HDR);
      m.mirror.material.color.set(kind.color).multiplyScalar(MIRROR_LINE_DIM);
      m.mesh.visible = m.mirror.visible = true;
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
      if (m) m.mesh.visible = m.mirror.visible = false;
      return;
    }
    const tris = [];
    for (const f of alive) tris.push(...flipperTriangles(f, { cell: view.cell }));
    const floats = tris.length * 9;
    if (!m || m.cap < floats) {
      if (m) {
        world.scene.remove(m.mesh);
        world.mirror.remove(m.mirror);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(NEON_MAGENTA).multiplyScalar(FLIPPER_FILL_DIM),
        transparent: true, opacity: FLIPPER_FILL_OPACITY,
        side: THREE.DoubleSide, depthWrite: false, // die Glut-Kontur gewinnt
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      world.scene.add(mesh);
      const mirror = new THREE.Mesh(geo, mat);
      mirror.frustumCulled = false;
      world.mirror.add(mirror);
      m = world.flipperFill = { mesh, mirror, cap: floats };
    }
    const pos = m.mesh.geometry.attributes.position;
    let j = 0;
    for (const tri of tris) {
      for (const [x, y, z] of tri) pos.setXYZ(j++, x * k, y * k, z * k);
    }
    pos.needsUpdate = true;
    m.mesh.geometry.setDrawRange(0, j);
    m.mesh.visible = m.mirror.visible = true;
  }

  // Sirrende Spinner-Schuesse (ab Level 21): gezackte Stern-Ringe quer zum
  // Gang in FLIRRENDEN Arcade-Farben -- harte 12-Hz-Schaltung pro Schuss
  // (Phase versetzt), wie 1980. Ein Puffer mit vertexColors fuer alle.
  function updateFoeShots(view, k) {
    const shots = view.foeShots;
    if (!shots || !shots.length) return; // resetWorldFrame hat schon versteckt
    const floats = shots.length * 6 * 6; // 6 Ring-Segmente pro Schuss
    let m = world.foeShotLines;
    if (!m || m.cap < floats) {
      if (m) {
        world.scene.remove(m.mesh);
        world.mirror.remove(m.mirror);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
        m.mirror.material.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floats), 3));
      const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
      mesh.frustumCulled = false;
      world.scene.add(mesh);
      const mirror = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: MIRROR_SHOT_OPACITY,
      }));
      mirror.frustumCulled = false;
      world.mirror.add(mirror);
      m = world.foeShotLines = { mesh, mirror, cap: floats };
    }
    const pos = m.mesh.geometry.attributes.position;
    const col = m.mesh.geometry.attributes.color;
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
        .multiplyScalar(BURST_HDR);
      for (const [a, b] of spinnerShotSegments(s, view.sceneT, { cell: view.cell })) {
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, (sx + (a[0] - sx) * scale) * k,
          (cy + (a[1] - cy) * scale) * k, (sz + (a[2] - sz) * scale) * k);
        col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
        pos.setXYZ(j++, (sx + (b[0] - sx) * scale) * k,
          (cy + (b[1] - cy) * scale) * k, (sz + (b[2] - sz) * scale) * k);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    m.mesh.geometry.setDrawRange(0, j);
    m.mesh.visible = m.mirror.visible = true;
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
      const floats = FIREWORK.count * 6;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floats), 3));
      const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, fog: false,
      }));
      mesh.frustumCulled = false;
      world.scene.add(mesh);
      const mirror = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, fog: false, transparent: true, opacity: MIRROR_SHOT_OPACITY,
      }));
      mirror.frustumCulled = false;
      world.mirror.add(mirror);
      m = world.fireworkLines = { mesh, mirror };
    }
    const pos = m.mesh.geometry.attributes.position;
    const col = m.mesh.geometry.attributes.color;
    let j = 0;
    for (const b of beams) {
      shotColor.set(b.color).multiplyScalar(FIREWORK_HDR * b.intensity);
      col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
      pos.setXYZ(j++, b.x, 0, b.z);
      col.setXYZ(j, shotColor.r, shotColor.g, shotColor.b);
      pos.setXYZ(j++, b.x, b.top, b.z);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    m.mesh.geometry.setDrawRange(0, j);
    m.mesh.visible = m.mirror.visible = true;
  }

  // --- Karten-Diagramm: Wachstums-Kontur, Weg, Feind-Kreuze -------------------

  // Teil-Kontur des wachsenden Labyrinths (MazeGen): nur bei geaendertem
  // Zell-Stand neu gebaut (growthOutline ist pur; ~1 Rebuild pro Frame
  // waehrend der 2.6s Wachstum, danach nie wieder).
  function updateGrowth(maze, count) {
    if (!world.growth) world.growth = { lines: null, count: -1 };
    const g = world.growth;
    if (count <= 0) {
      if (g.lines) g.lines.visible = false;
      return;
    }
    if (count !== g.count) {
      g.count = count;
      const segs = growthOutline(maze, count);
      const pos = new Float32Array(segs.length * 6);
      let i = 0;
      for (const [[x1, y1], [x2, y2]] of segs) {
        pos[i++] = world.u(x1); pos[i++] = 0.1; pos[i++] = world.u(y1);
        pos[i++] = world.u(x2); pos[i++] = 0.1; pos[i++] = world.u(y2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (g.lines) {
        g.lines.geometry.dispose();
        g.lines.geometry = geo;
      } else {
        g.lines = new THREE.LineSegments(geo, world.lineMat);
        g.lines.frustumCulled = false;
        world.scene.add(g.lines);
      }
    }
    g.lines.visible = true;
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
  function updateFoeMarkers(game, fadeF) {
    const kinds = [
      { list: game.enemies, color: enemyColor(game.level) },
      { list: spinnerMarkers(game.spinners), color: spinnerColor(game.level) },
      { list: flipperMarkers(game.flippers), color: NEON_MAGENTA },
      { list: pulsarMarkers(game.pulsars), color: ARCADE_YELLOW },
    ];
    if (!world.foeMarks) world.foeMarks = kinds.map(() => null);
    const k = world.kLocal;
    const r = FOE_MARK_RATIO * UNITS_PER_CELL;
    kinds.forEach((kind, i) => {
      const alive = (kind.list ?? []).filter((f) => f.alive);
      let m = world.foeMarks[i];
      if (fadeF <= 0.01 || alive.length === 0) {
        if (m) m.mesh.visible = false;
        return;
      }
      const floats = alive.length * 12; // 2 Kreuz-Segmente x 2 Punkte x xyz
      if (!m || m.cap < floats) {
        if (m) {
          world.scene.remove(m.mesh);
          m.mesh.geometry.dispose();
          m.mesh.material.dispose();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
        const mesh = new THREE.LineSegments(geo,
          new THREE.LineBasicMaterial({ transparent: true, fog: false }));
        mesh.frustumCulled = false;
        world.scene.add(mesh);
        m = world.foeMarks[i] = { mesh, cap: floats };
      }
      const pos = m.mesh.geometry.attributes.position;
      let j = 0;
      for (const f of alive) {
        const x = f.x * k, z = f.z * k;
        pos.setXYZ(j++, x - r, 0.14, z);
        pos.setXYZ(j++, x + r, 0.14, z);
        pos.setXYZ(j++, x, 0.14, z - r);
        pos.setXYZ(j++, x, 0.14, z + r);
      }
      pos.needsUpdate = true;
      m.mesh.geometry.setDrawRange(0, j);
      m.mesh.material.opacity = fadeF;
      m.mesh.material.color.set(kind.color).multiplyScalar(1.6);
      m.mesh.visible = true;
    });
  }

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
  function drawStartscreen(game) {
    const view = game.current.viewState?.();
    if (!view) return drawPlaceholder(game);
    useStartScene();
    setFov(TOP_FOV);
    const [px, py, pz] = view.pose.position;
    camera.position.set(px, py, pz);
    camera.rotation.set(view.pose.pitch, view.pose.yaw, 0);
    start.edgeMat.color.copy(hdr(view.color ?? PHOSPHOR_GREEN));
    start.starMats.forEach((mat, i) => {
      mat.opacity = 0.75 + 0.25 * Math.sin(game.time * (1.3 + i * 0.7) + i * 2.1);
    });
  }

  // Maze-Wachstum: Draufsicht, die Boden-Kontur frisst sich in der
  // Grab-Reihenfolge hinein (wachsende Teil-Kontur statt voller Umriss).
  function drawMazeGen(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    setLineGlow(1);
    setTopDownCamera();
    setWallHeight(world, 0);
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
  function drawFalling(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    const e = view.e;
    setLineGlow(1 - e);
    world.scene.fog.density = FOG_DENSITY * e;
    world.headlight.intensity = HEADLIGHT_INTENSITY * e;
    setWallHeight(world, e);
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
  function drawRising(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    const a = 1 - view.e;
    setLineGlow(view.e);
    world.scene.fog.density = FOG_DENSITY * a;
    world.headlight.intensity = HEADLIGHT_INTENSITY * a;
    setWallHeight(world, a);
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
  function drawMap(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(game, view.maze, color);
    resetWorldFrame();
    setLineGlow(1);
    setTopDownCamera();
    setWallHeight(world, 0);
    const f = view.fade;
    world.outlineMat.opacity = f;
    world.outlineLines.visible = f > 0.01;
    world.gridMat.opacity = 0.8 * f;
    setMarkerFade(world, f);
    updateFoeMarkers(game, f);
    updateTrail(game.trail, f);
    animateWorld(game, null, DIAGRAM_BEACON * f); // blasse Saeule, blendet mit aus
    world.beaconCone.visible = false;
  }

  // Ego-Ansicht (Playing): Kamera aus dem ECHTEN Spielzustand.
  function drawEgo(game, color) {
    const view = game.current.viewState?.();
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

    animateWorld(game, view);
  }

  const drawers = {
    [State.STARTSCREEN]: drawStartscreen,
    [State.MAZE_GEN]: drawMazeGen,
    [State.FALLING]: drawFalling,
    [State.PLAYING]: drawEgo,
    [State.RISING]: drawRising,
    [State.MAP]: drawMap,
  };

  // --- DOM-Texte pro Frame (Platzhalter-HUD) ----------------------------------
  function labelText(game) {
    switch (game.stateKey) {
      case State.PLAYING: {
        const view = game.current.viewState?.();
        if (view?.crash) return '';
        if (view?.reached) return 'YOU MADE IT';
        // Steuer-Zeile aus core/hud.js -- Wortlaut und Lenk-Tasten-Mapping
        // (Pulsar-Rotation) identisch mit der 1980-Engine.
        return 'FIND THE EXIT - ' + playHint(view ?? {});
      }
      case State.MAP:
        return mapHint(game); // Wortlaut wie 1980; blendet per Opacity mit aus
      default:
        return '';
    }
  }

  function updateOverlays(game) {
    const mapView = game.stateKey === State.MAP ? game.current.viewState?.() : null;
    setText(label, labelText(game));
    // Der Karten-Hinweis blendet mit der Karte aus (wie 1980: intensity*fade).
    label.style.opacity = mapView ? String(mapView.fade) : '1';

    // Startscreen-Texte (nur waehrend des Umtanzens, wie 1980).
    const onStart = game.stateKey === State.STARTSCREEN;
    const view = onStart ? game.current.viewState?.() : null;
    const orbiting = view?.phase === 'orbiting';
    setText(title, orbiting ? `LEVEL ${game.level}` : '');
    setText(press, orbiting && view.blink ? 'PRESS S TO START' : '');
    if (orbiting) {
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
      // Gleiche Farb-Regel wie game.render() fuer die 1980-Engine.
      const color = game.stateKey === State.STARTSCREEN
        ? PHOSPHOR_GREEN
        : levelColor(game.level);
      (drawers[game.stateKey] ?? drawPlaceholder)(game, color);
      composer.render();

      updateOverlays(game);

      // Crash-Einschlag (Stufe 4): weisser Vollbild-Blitz, quadratisch
      // ausklingend (haerter Einschlag, weiches Verglimmen), waehrend
      // Splitter + Truemmer fliegen (analog renderer.flash in 1980).
      const pv = game.stateKey === State.PLAYING ? game.current.viewState?.() : null;
      flashEl.style.opacity = pv?.crash && pv.crash.t < CRASH_FLASH
        ? String(0.95 * (1 - pv.crash.t / CRASH_FLASH) ** 2)
        : '0';
    },

    // Live-Engine-Schalter (Stufe 3): main.js blendet die ganze 2026-Ausgabe
    // (Canvas + Overlays) ein/aus, ohne sie wegzuwerfen.
    setVisible(v) {
      root.style.display = v ? '' : 'none';
    },

    resize(cssWidth, cssHeight, dpr = 1) {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.setSize(cssWidth, cssHeight);
      composer.setSize(cssWidth, cssHeight);
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
    },
  };
}
