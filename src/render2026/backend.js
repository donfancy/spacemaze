// 2026-Engine: der EINZIGE Three.js-Animations-Teil (Gegenstueck zu
// render/renderer.js, das der einzige 2D-Canvas-Teil bleibt). Wird von main.js
// NUR bei ?engine=2026 dynamisch importiert und als game.renderBackend
// injiziert -- der Core und die Tests beruehren Three.js nie.
//
// Stand Stufe 1 (PLAN2026.md): die Ego-Ansicht ist ECHT -- Kamera aus der
// walk.js-Pose (Lese-Schnittstelle playing.viewState()), Welt aus
// world3d.js (Flaechen + Neon-Kanten, Spiegelboden, Nebel, Sterne, Ziel-
// Leuchtfeuer), Level-Farbe aus levelColor. Bump-Feedback: Kamera-Impuls +
// Licht-Blitz an der Wand (die 1980-Wellen bleiben 1980). Falling/Rising/
// Karte zeigen als harten Schnitt eine Draufsicht der 3D-Welt (die Schwenks
// und die echte Karte kommen in Stufe 3); Startscreen und MazeGen behalten
// den Stufe-0-Platzhalter (Sternenhimmel + Draht-Wuerfel).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { State } from '../core/states.js';
import { levelColor } from '../core/levels.js';
import { PHOSPHOR_GREEN, ARCADE_YELLOW } from '../render/colors.js';
import { EYE_RATIO } from '../scenes/mazeView.js';
import { burstSegments } from '../world/burst.js';
import { createRng } from '../util/rng.js';
import {
  buildWorld, applyTheme, disposeWorld, hdr,
  UNITS_PER_CELL, FOG_DENSITY, HEADLIGHT_INTENSITY,
} from './world3d.js';

const EYE = EYE_RATIO * UNITS_PER_CELL; // Augenhoehe: halbe Gangbreite

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

export function createBackend2026(container = document.body) {
  // --- Renderer + Bloom-Kette (Rezept aus public/proto2026/) ------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;display:block;';
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  camera.rotation.order = 'YXZ'; // erst Gieren (yaw), dann Nicken, dann Rollen

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4, type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);
  // Die RenderPass-Szene wird pro Frame umgehaengt (Platzhalter vs. Welt).
  const renderPass = new RenderPass(null, camera);
  composer.addPass(renderPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.45, 0.85));
  composer.addPass(new OutputPass());

  // --- HUD-Zeile + Fade-Flaeche (DOM-Overlay, Platzhalter bis zur HUD-Frage
  //     in Stufe 6; der Fade ersetzt renderer.fillBlack) ------------------------
  const label = document.createElement('div');
  label.style.cssText =
    'position:fixed;left:14px;bottom:12px;color:#9fffc0;' +
    'font:12px/1.5 "SF Mono",Menlo,Consolas,monospace;' +
    'text-shadow:0 0 8px rgba(80,255,140,.7);user-select:none;pointer-events:none;';
  container.appendChild(label);

  const fade = document.createElement('div');
  fade.style.cssText =
    'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;';
  container.appendChild(fade);

  // --- Platzhalter-Szene (Stufe 0): Sternenhimmel + Draht-Wuerfel -------------
  // Bleibt fuer Startscreen und MazeGen, bis Stufe 3 sie echt zeichnet.
  const phScene = new THREE.Scene();
  const rng = createRng(42);
  const starPos = [];
  for (let i = 0; i < 4000; i++) {
    const az = rng() * Math.PI * 2;
    const el = Math.asin(rng() * 2 - 1); // ganze Kugel, gleichverteilt
    starPos.push(
      600 * Math.cos(el) * Math.cos(az),
      600 * Math.sin(el),
      600 * Math.cos(el) * Math.sin(az)
    );
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  phScene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 2.5, sizeAttenuation: false,
    transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending,
  })));
  const cubeMat = new THREE.LineBasicMaterial({ color: hdr(PHOSPHOR_GREEN) });
  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 3, 3)), cubeMat
  );
  cube.position.set(0, 0, -8);
  phScene.add(cube);

  // --- Labyrinth-Welt: pro Maze einmal gebaut, bei Wechsel entsorgt -----------
  let world = null;
  let worldMaze = null;  // Maze-Objekt, fuer das `world` gebaut wurde
  let themeHex = null;   // zuletzt angewandte Level-Farbe

  function ensureWorld(maze, color) {
    if (maze !== worldMaze) {
      if (world) disposeWorld(world);
      world = buildWorld(maze);
      worldMaze = maze;
      themeHex = null;
    }
    if (color !== themeHex) {
      applyTheme(world, color);
      themeHex = color;
    }
    renderPass.scene = world.scene;
  }

  // Gemeinsame Welt-Animation: Sterne funkeln, Leuchtfeuer pulsiert -- und am
  // Ziel strahlt es weiss auf und erlischt (wie die 1980-Strahlen). `view`
  // kommt aus playing.viewState() (null in der Draufsicht: dort entscheidet
  // game.reachedGoal, ob das Leuchtfeuer noch brennt).
  function animateWorld(game, view) {
    world.starGroups.forEach((mat, i) => {
      mat.opacity = 0.75 + 0.25 * Math.sin(game.time * (1.3 + i * 0.7) + i * 2.1);
    });

    const done = view ? view.reached : game.reachedGoal;
    const flashAge = view?.reached ? view.sceneT - view.reachedAt : Infinity;
    if (!done) {
      // Atmen wie das Ziel-Leuchtfeuer im Spiel.
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 2.1);
      world.beaconLines.material.color.copy(BEACON_COLOR);
      world.beaconLines.material.opacity = 0.7 + 0.3 * pulse;
      world.beaconCone.material.opacity = 0.06 + 0.07 * pulse;
      world.beaconMirrorMat.opacity = (0.7 + 0.3 * pulse) * 0.45;
      world.beaconLight.intensity = 350 + 400 * pulse;
      world.beaconLines.visible = world.beaconCone.visible = true;
    } else if (flashAge < GOAL_FLASH_TIME) {
      // Weisses Aufstrahlen + Erloeschen (Dauer wie 1980).
      const a = 1 - flashAge / GOAL_FLASH_TIME;
      world.beaconLines.material.color.copy(FLASH_COLOR);
      world.beaconLines.material.opacity = a;
      world.beaconCone.material.opacity = 0.2 * a;
      world.beaconMirrorMat.opacity = 0.5 * a;
      world.beaconLight.intensity = 1600 * a;
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

  // --- Szenen-Zeichner ---------------------------------------------------------

  // Platzhalter (Startscreen, MazeGen): Wuerfel dreht, Himmel zieht vorbei.
  // Alle Animation haengt an game.time (deterministisch, keine eigene Uhr).
  function drawPlaceholder(game, color) {
    renderPass.scene = phScene;
    cubeMat.color.copy(hdr(color));
    cube.rotation.set(game.time * 0.4, game.time * 0.55, 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, game.time * 0.03, 0);
  }

  // Ego-Ansicht (Playing): Kamera aus dem ECHTEN Spielzustand.
  function drawEgo(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game, color);
    ensureWorld(view.maze, color);
    world.scene.fog.density = FOG_DENSITY;
    world.headlight.intensity = HEADLIGHT_INTENSITY;

    // Spielerlage (lokale Flaechen-Einheiten) -> 3D (Gangbreite = UNITS_PER_CELL).
    const k = UNITS_PER_CELL / view.cell;
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

  // Draufsicht (Falling/Rising/Karte, Stufe-1-Platzhalter fuer Schwenks und
  // Karte): die gebaute Welt senkrecht von oben, Norden oben (kleines gz),
  // ohne Nebel (die Karte ist ein Diagramm, kein Raum).
  function drawTopDown(game, color) {
    if (!game.maze) return drawPlaceholder(game, color);
    ensureWorld(game.maze, color);
    world.scene.fog.density = 0;
    world.headlight.intensity = 0;
    world.bumpLight.intensity = 0;
    if (world.sparks) world.sparks.visible = false;

    const c = world.total / 2;
    camera.position.set(c, world.total * 0.85, c);
    camera.up.set(0, 0, -1);
    camera.lookAt(c, 0, c);
    camera.up.set(0, 1, 0); // Standard zuruecksetzen (Ego setzt rotation direkt)

    animateWorld(game, null);
  }

  const drawers = {
    [State.STARTSCREEN]: drawPlaceholder,
    [State.MAZE_GEN]: drawPlaceholder,
    [State.FALLING]: drawTopDown,
    [State.PLAYING]: drawEgo,
    [State.RISING]: drawTopDown,
    [State.MAP]: drawTopDown,
  };

  // HUD-Zeile (DOM-Platzhalter): dieselben Hinweise wie die 1980-Texte.
  function labelText(game) {
    switch (game.stateKey) {
      case State.PLAYING: {
        const view = game.current.viewState?.();
        if (view?.reached) return 'YOU MADE IT';
        return view?.drive
          ? 'FIND THE EXIT · LEFT/RIGHT STEER · Q MAP'
          : 'FIND THE EXIT · ARROWS MOVE · Q MAP';
      }
      case State.MAP:
        return game.reachedGoal ? 'YOU MADE IT · X LAUNCH' : 'Q RESUME · X LAUNCH';
      case State.FALLING:
      case State.RISING:
        return '';
      default:
        return `ENGINE 2026 · SZENE ${game.stateKey} (PLATZHALTER) · LEVEL ${game.level}`;
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

      label.textContent = labelText(game);

      // Fade-Uebergang analog renderer.fillBlack in game.render().
      const tr = game.transition;
      fade.style.opacity = tr.active
        ? String(tr.t < 0.5 ? tr.t * 2 : (1 - tr.t) * 2)
        : '0';
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
