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
// Funken. Texte laufen als DOM-Overlay (Platzhalter bis zur HUD-Frage in
// Stufe 6). Alle Animation haengt an game.time / den Szenen-Uhren.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { State } from '../core/states.js';
import { levelColor, enemyColor, spinnerColor } from '../core/levels.js';
import { PHOSPHOR_GREEN, ARCADE_YELLOW, NEON_MAGENTA } from '../render/colors.js';
import { EYE_RATIO, cellSize } from '../scenes/mazeView.js';
import { burstSegments } from '../world/burst.js';
import { growthOutline } from '../world/mazeGeometry.js';
import { spinnerMarkers } from '../world/spinners.js';
import { flipperMarkers } from '../world/flippers.js';
import { pulsarMarkers } from '../world/pulsars.js';
import {
  buildWorld, applyTheme, disposeWorld, hdr, setWallHeight, setMarkerFade,
  UNITS_PER_CELL, FOG_DENSITY, HEADLIGHT_INTENSITY,
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
  // headline: GAME OVER auf der Karte. fade: ersetzt renderer.fillBlack.
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

  const fade = document.createElement('div');
  fade.style.cssText =
    'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;';
  root.appendChild(fade);

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

  function ensureWorld(maze, color) {
    if (maze !== worldMaze) {
      if (world) disposeWorld(world);
      world = buildWorld(maze);
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
    ensureWorld(view.maze, color);
    resetWorldFrame();
    setTopDownCamera();
    setWallHeight(world, 0);
    world.outlineLines.visible = false; // stattdessen die Teil-Kontur
    updateGrowth(view.maze, view.growCount);
    setMarkerFade(world, view.markerFade);
    updateFoeMarkers(game, view.foeFade);
    updateTrail(null, 0);
    // dim 0: das Leuchtfeuer bleibt im Diagramm GANZ aus (wie 1980 -- von
    // oben wirken die 40 Einheiten hohen Saeulen sonst als gelber "Komet"
    // quer ueber die Karte, der Kegel als Vollbild-Blowout).
    animateWorld(game, null, 0);
  }

  // Reinfallen: Schwenk Draufsicht -> Ego; Waende, Nebel und Scheinwerfer
  // wachsen mit e auf, das Karten-Diagramm blendet aus.
  function drawFalling(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(view.maze, color);
    resetWorldFrame();
    const e = view.e;
    world.scene.fog.density = FOG_DENSITY * e;
    world.headlight.intensity = HEADLIGHT_INTENSITY * e;
    setWallHeight(world, e);
    setMarkerFade(world, 1 - e);
    updateFoeMarkers(game, 1 - e);
    updateTrail(view.resume ? game.trail : null, 1 - e);
    swoopCamera(view.target, e);
    world.headlight.position.set(camera.position.x, camera.position.y + 2, camera.position.z);
    animateWorld(game, null, e); // Leuchtfeuer blendet mit der Ego-Naehe ein
  }

  // Rueckschwenk: dasselbe rueckwaerts; eine Rest-Verdrehung (Pulsar,
  // game.viewRoll) dreht mit dem Ease sanft aus.
  function drawRising(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(view.maze, color);
    resetWorldFrame();
    const a = 1 - view.e;
    world.scene.fog.density = FOG_DENSITY * a;
    world.headlight.intensity = HEADLIGHT_INTENSITY * a;
    setWallHeight(world, a);
    setMarkerFade(world, view.e);
    updateFoeMarkers(game, view.e);
    updateTrail(game.trail, view.e);
    swoopCamera(view.origin, a, (game.viewRoll ?? 0) * a);
    world.headlight.position.set(camera.position.x, camera.position.y + 2, camera.position.z);
    animateWorld(game, null, a); // Leuchtfeuer blendet zur Karte hin aus
  }

  // Karte: Draufsicht auf das flache Labyrinth mit Weg, Markern und Feind-
  // Kreuzen. Beim Verlassen (X) blendet der Inhalt aus, der Rahmen bleibt --
  // er wird zur Wuerfelflaeche des Abdock-Flugs.
  function drawMap(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(view.maze, color);
    resetWorldFrame();
    setTopDownCamera();
    setWallHeight(world, 0);
    const f = view.fade;
    world.outlineMat.opacity = f;
    world.outlineLines.visible = f > 0.01;
    world.gridMat.opacity = 0.8 * f;
    setMarkerFade(world, f);
    updateFoeMarkers(game, f);
    updateTrail(game.trail, f);
    animateWorld(game, null, 0); // Leuchtfeuer im Diagramm aus (wie MazeGen)
  }

  // Ego-Ansicht (Playing): Kamera aus dem ECHTEN Spielzustand.
  function drawEgo(game, color) {
    const view = game.current.viewState?.();
    if (!view?.maze) return drawPlaceholder(game);
    ensureWorld(view.maze, color);
    resetWorldFrame();
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
        if (view?.reached) return 'YOU MADE IT';
        return view?.drive
          ? 'FIND THE EXIT · LEFT/RIGHT STEER · Q MAP'
          : 'FIND THE EXIT · ARROWS MOVE · Q MAP';
      }
      case State.MAP: {
        if (game.current.viewState?.()?.fade < 0.99) return '';
        if (game.reachedGoal) return 'YOU MADE IT · X LAUNCH';
        return game.gameOver ? 'Q RETRY · X LAUNCH' : 'Q RESUME · X LAUNCH';
      }
      default:
        return '';
    }
  }

  function updateOverlays(game) {
    setText(label, labelText(game));

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

    // GAME OVER auf der Karte: Farb-Puls rot<->weiss (wie 1980 -- Helligkeits-
    // Pulsieren wirkte ueber den Linien "durchgestrichen").
    const mapView = game.stateKey === State.MAP ? game.current.viewState?.() : null;
    if (mapView && game.gameOver && mapView.fade > 0.01) {
      setText(headline, 'GAME OVER');
      const kP = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.2 * mapView.t);
      const ch = (v) => Math.round(v + (255 - v) * kP);
      headline.style.color = `rgb(255,${ch(0x3b)},${ch(0x30)})`;
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

      // Fade-Uebergang analog renderer.fillBlack in game.render().
      const tr = game.transition;
      fade.style.opacity = tr.active
        ? String(tr.t < 0.5 ? tr.t * 2 : (1 - tr.t) * 2)
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
