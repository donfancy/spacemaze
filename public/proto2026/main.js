// SPACE MAZE 2026 -- Prototyp: Render-Loop, Autopilot-Flug, Effekt-Toggles, HUD.
// Diskussionsgrundlage fuer die "2026-Variante": gleiche Maze-Logik wie das
// Spiel (echter Generator, echte Metrik, echter Loesungsweg), aber GPU-Rendering
// mit Flaechen, Bloom, Nebel, Spiegelung und Sternenhimmel.
//
// Tasten: B Bloom, R Spiegelung, N Nebel, F Freiflug (Klick faengt die Maus,
// WASD + Maus, Shift = Boost), 1/2/3 Farbthemen, H psychedelischer Farbzyklus.
// URL-Parameter: ?seed=123 fuer ein bestimmtes Labyrinth.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { generateMaze, findPath } from '/src/world/maze.js';
import { buildWorld, hdr, PALETTE } from './world3d.js';

// ---------- Welt aus dem echten Generator ----------

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 20260825;
const maze = generateMaze(25, { seed, straight: 0.7, metric: { wall: 1, corridor: 5 } });
const world = buildWorld(maze);
const { scene, metric } = world;

const EYE = world.H * 0.5;      // Augenhoehe wie im Spiel: halbe Gangbreite
const CRUISE = 1.5 * metric.corridor; // Reisetempo 1.5 Gangbreiten/s

// Loesungsweg -> weiche Flugkurve durch die Zellmitten.
const path = findPath(maze, maze.start, maze.goal);
const waypoints = path.map(([x, y]) => new THREE.Vector3(
  metric.toUnits(x + 0.5), EYE, metric.toUnits(y + 0.5)
));
const curve = new THREE.CatmullRomCurve3(waypoints, false, 'centripetal', 0.5);
const curveLen = curve.getLength();

// ---------- Renderer + Bloom-Kette ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.info.autoReset = false; // wir summieren die Draw-Calls ueber alle Paesse
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);
camera.position.copy(curve.getPointAt(0));

// HalfFloat + MSAA-Samples: HDR fuer den Bloom, Kantenglaettung fuer die Linien.
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const target = new THREE.WebGLRenderTarget(size.x, size.y, {
  samples: 4, type: THREE.HalfFloatType,
});
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.45, 0.85);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- Zustand: Toggles, Themen, Autopilot, Freiflug ----------

const FOG_BASE = 0.016;
const state = {
  bloom: true, mirror: true, fog: true, free: false, hueCycle: false,
  themeHex: PALETTE.PHOSPHOR_GREEN, themeName: 'Phosphor',
  // ?t0=0.5 startet den Autopiloten mitten auf der Kurve (Debug/Screenshots)
  t: Math.max(0, Math.min(1, Number(params.get('t0')) || 0)),
  dir: 1, hold: 0, bank: 0,              // Autopilot entlang der Kurve
  yaw: 0, pitch: 0,                       // Freiflug
  keys: new Set(),
};

function setTheme(hex, name) {
  state.themeHex = hex;
  state.themeName = name;
  applyThemeColor(new THREE.Color(hex));
}

function applyThemeColor(col) {
  world.lineMat.color.copy(col).multiplyScalar(2.2);
  world.gridMat.color.copy(col).multiplyScalar(0.3);
  world.headlight.color.copy(col);
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  state.keys.add(k);
  if (k === 'b') { state.bloom = !state.bloom; bloomPass.enabled = state.bloom; }
  if (k === 'r') {
    state.mirror = !state.mirror;
    world.reflector.visible = state.mirror;
    world.floorOverlay.material.opacity = state.mirror ? 0.68 : 1.0;
  }
  if (k === 'n') { state.fog = !state.fog; scene.fog.density = state.fog ? FOG_BASE : 1e-7; }
  if (k === 'f') {
    state.free = !state.free;
    if (state.free) {
      // Blickrichtung der Kamera als Start-Yaw/Pitch uebernehmen.
      const d = camera.getWorldDirection(new THREE.Vector3());
      state.yaw = Math.atan2(-d.x, -d.z);
      state.pitch = Math.asin(d.y);
    }
  }
  if (k === 'h') state.hueCycle = !state.hueCycle;
  if (k === '1') { state.hueCycle = false; setTheme(PALETTE.PHOSPHOR_GREEN, 'Phosphor'); }
  if (k === '2') { state.hueCycle = false; setTheme(PALETTE.TEMPEST_BLUE, 'Tempest'); }
  if (k === '3') { state.hueCycle = false; setTheme(PALETTE.ARCADE_RED, 'Arcade'); }
});
addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));

renderer.domElement.addEventListener('click', () => {
  if (state.free) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (!state.free || document.pointerLockElement !== renderer.domElement) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch - e.movementY * 0.0022));
});

// ---------- Autopilot: Flug entlang des Loesungswegs mit Kurvenneigung ----------

const HOLD = 1.6; // Verweil-Sekunden an Start/Ziel (Kamera schwingt herum)
const _look = new THREE.Matrix4();
const _qDesired = new THREE.Quaternion();
const _qBank = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _fwd2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function autopilotStep(dt, time) {
  if (state.hold > 0) state.hold -= dt;
  else {
    state.t += state.dir * (CRUISE / curveLen) * dt;
    if (state.t >= 1) { state.t = 1; state.dir = -1; state.hold = HOLD; }
    if (state.t <= 0) { state.t = 0; state.dir = 1; state.hold = HOLD; }
  }

  const pos = curve.getPointAt(state.t);
  pos.y += 0.07 * Math.sin(time * 2.3); // dezentes Schweben
  camera.position.copy(pos);

  // Vorausschau fuer die Kurvenneigung: Winkel zwischen jetziger und
  // kommender Flugrichtung -> Bank-Ziel, weich nachgefuehrt (Rampen-Idee).
  _fwd.copy(curve.getTangentAt(state.t)).multiplyScalar(state.dir).normalize();
  const tAhead = Math.max(0, Math.min(1, state.t + state.dir * 0.01));
  _fwd2.copy(curve.getTangentAt(tAhead)).multiplyScalar(state.dir).normalize();
  const cross = _fwd.x * _fwd2.z - _fwd.z * _fwd2.x; // Vorzeichen der Kurve
  const turn = Math.asin(Math.max(-1, Math.min(1, cross)));
  const bankTarget = state.hold > 0 ? 0 : Math.max(-0.32, Math.min(0.32, turn * 22));
  state.bank += (bankTarget - state.bank) * (1 - Math.exp(-3 * dt));

  _look.lookAt(pos, _fwd.clone().add(pos), UP);
  _qDesired.setFromRotationMatrix(_look);
  _qBank.setFromAxisAngle(_fwd, state.bank);
  _qDesired.premultiply(_qBank);
  // Weiches Nachschwenken -- glaettet auch die 180-Grad-Wende an Start/Ziel.
  camera.quaternion.slerp(_qDesired, 1 - Math.exp(-4 * dt));
}

function freeFlightStep(dt) {
  camera.quaternion.setFromEuler(new THREE.Euler(state.pitch, state.yaw, 0, 'YXZ'));
  const speed = (state.keys.has('shift') ? 3 : 1) * 14 * dt;
  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  if (state.keys.has('w')) camera.position.addScaledVector(fwd, speed);
  if (state.keys.has('s')) camera.position.addScaledVector(fwd, -speed);
  if (state.keys.has('a')) camera.position.addScaledVector(right, -speed);
  if (state.keys.has('d')) camera.position.addScaledVector(right, speed);
}

// ---------- HUD ----------

const hud = document.getElementById('hud');
let fpsEma = 60, msEma = 16, hudTimer = 0;

function updateHud(dt) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.25;
  const i = renderer.info.render;
  const an = (on) => (on ? 'AN ' : 'aus');
  hud.innerHTML =
    `<b>SPACE MAZE 2026 — PROTOTYP</b>  (Seed ${maze.seed})\n` +
    `${fpsEma.toFixed(0)} FPS  ${msEma.toFixed(1)} ms  |  Draws ${i.calls}  Tris ${(i.triangles / 1000).toFixed(1)}k\n` +
    `[B] Bloom ${an(state.bloom)}   [R] Spiegelung ${an(state.mirror)}   [N] Nebel ${an(state.fog)}   [F] Freiflug ${an(state.free)}\n` +
    `[1] Phosphor  [2] Tempest  [3] Arcade  [H] Farbzyklus ${an(state.hueCycle)}   Thema: ${state.hueCycle ? 'psychedelisch' : state.themeName}\n` +
    (state.free ? 'Freiflug: Klick = Maus fangen, WASD + Maus, Shift = Boost' : 'Autopilot fliegt den Loesungsweg (F fuer Freiflug)');
}

// ---------- Animationen der Welt ----------

const _hueColor = new THREE.Color();

function animateWorld(dt, time) {
  // Scheinwerfer schwebt UEBER der Kamera (Mindestabstand zu den Waenden,
  // sonst Bloom-Blowout an naher Wand, siehe world3d.js).
  world.headlight.position.copy(camera.position);
  world.headlight.position.y += 2;

  // Sterne funkeln gruppenweise phasenversetzt.
  world.starGroups.forEach((mat, i) => {
    mat.opacity = 0.75 + 0.25 * Math.sin(time * (1.3 + i * 0.7) + i * 2.1);
  });

  // Leuchtfeuer pulsiert (Atmen wie das Ziel-Leuchtfeuer im Spiel).
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.1);
  world.beaconCone.material.opacity = 0.06 + 0.07 * pulse;
  world.beaconLines.material.opacity = 0.7 + 0.3 * pulse;
  world.beaconLight.intensity = 350 + 400 * pulse;

  // Tanker: pulsieren wie im Spiel, drehen langsam, schweben leicht.
  for (const t of world.tankers) {
    const p = t.userData.phase;
    const s = 1 + 0.13 * Math.sin(time * 2.6 + p);
    t.scale.set(1.1 * s, 1.9 * s, 1.1 * s);
    t.rotation.y += dt * 0.7;
    t.position.y = world.H * 0.45 + 0.25 * Math.sin(time * 1.1 + p);
  }

  // Psychedelischer Farbzyklus: Linien, Raster und Scheinwerfer wandern
  // gemeinsam durchs Spektrum.
  if (state.hueCycle) {
    _hueColor.setHSL((time * 0.04) % 1, 1, 0.62);
    applyThemeColor(_hueColor);
  }
}

// ---------- Haupt-Loop ----------

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (state.free) freeFlightStep(dt);
  else autopilotStep(dt, time);
  animateWorld(dt, time);

  renderer.info.reset();
  composer.render();

  // ?probe: Autopilot-Telemetrie fuer Headless-Tests (1x pro Sekunde,
  // gesammelt in einem versteckten DOM-Knoten, auslesbar via --dump-dom).
  if (params.has('probe') && Math.floor(time) > Math.floor(time - dt)) {
    let node = document.getElementById('probe');
    if (!node) {
      node = document.createElement('pre');
      node.id = 'probe';
      node.style.display = 'none';
      document.body.appendChild(node);
    }
    const d = camera.getWorldDirection(new THREE.Vector3());
    node.textContent += 'PROBE ' + JSON.stringify({
      sec: Math.floor(time), t: +state.t.toFixed(3), bank: +state.bank.toFixed(3),
      x: +camera.position.x.toFixed(1), z: +camera.position.z.toFixed(1),
      dx: +d.x.toFixed(2), dz: +d.z.toFixed(2),
    }) + '\n';
  }

  const ms = performance.now() - now;
  msEma += (ms - msEma) * 0.05;
  fpsEma += (1 / Math.max(dt, 1e-4) - fpsEma) * 0.05;
  updateHud(dt);

  requestAnimationFrame(frame);
}

setTheme(PALETTE.PHOSPHOR_GREEN, 'Phosphor');
requestAnimationFrame(frame);
