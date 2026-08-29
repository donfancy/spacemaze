// 2026-Engine: Szenen-AUFBAU des Startscreens (Stufe 3) -- das Gegenstueck
// zum 1980-Drahtwuerfel, in Prototyp-Optik: dunkle Wuerfel-Flaechen mit
// Neon-Leuchtkanten (Bloom), voller Sternenhimmel (Kugel -- die Kamera
// umtanzt den Wuerfel) und Farb-Dunst. Nur AUFBAU; animiert (Kamera-Pose aus
// startscreen.viewState(), Funkeln, Kantenfarbe beim An-/Abdocken) wird in
// backend.js. Der Wuerfel ist exakt so gross wie im Core (CUBE_SIZE 2.4),
// damit die Posen der Orbit-/Dock-Bahnen unveraendert gelten.

import * as THREE from 'three';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import { hdr, buildStarField, ACCENT_LIGHTS } from './world3d.js';
import { bakeSkybox } from './skybox.js';
import { startscreenSkyTheme } from './skyTheme.js';

import { CUBE_SIZE } from '../scenes/mazeView.js'; // eine Quelle fuer beide Engines
const STAR_SEED = 1980;   // fester Himmel (kein Maze-Seed auf dem Startscreen)

export function buildStartscreenScene(renderer) {
  const scene = new THREE.Scene();

  const { mats: starMats } = buildStarField(scene, {
    seed: STAR_SEED, center: [0, 0], hemisphere: false,
  });
  // Nebel-Skybox (volle Kugel, dezentes Gruen -- der Anfang des Crescendos);
  // disposeWorld(start) gibt skyRT beim Teardown frei.
  let skyRT = null;
  if (renderer) {
    skyRT = bakeSkybox(renderer, startscreenSkyTheme());
    scene.background = skyRT.texture;
  }

  // Wuerfel: dunkle Flaechen (wie die Labyrinth-Waende) + HDR-Leuchtkanten.
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x4a5a78, roughness: 0.55, metalness: 0.15,
    emissive: 0x0a0e1a, emissiveIntensity: 1,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const box = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  scene.add(new THREE.Mesh(box, faceMat));

  const edgeMat = new THREE.LineBasicMaterial({ color: hdr(PHOSPHOR_GREEN) });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMat);
  // Minimal groesser als der Wuerfel: die Kanten liegen sonst exakt IN den
  // Flaechen und "perlen" durch Z-Fighting (Sichtpruefungs-Befund; 1.004
  // reichte an den Ecken noch nicht).
  edges.scale.setScalar(1.01);
  scene.add(edges);

  // Licht: Grundschimmer + zwei farbige Lichter schraeg gegenueber -- die
  // Flaechen bekommen einen psychedelischen Verlauf, wie die Flutlichter im
  // Labyrinth. Abstand gross genug gegen den Bloom-Blowout (decay-2-Falle).
  // Definition in world3d.js (ACCENT_LIGHTS): die Platine projiziert
  // DIESELBEN Lichter auf die Andock-Flaeche -- der Verlauf laeuft beim
  // Wechsel in die Draufsicht nahtlos weiter.
  scene.add(new THREE.HemisphereLight(0x50506e, 0x101018, 2.0));
  for (const { color, pos, intensity } of ACCENT_LIGHTS) {
    const light = new THREE.PointLight(color, intensity, 40, 2);
    light.position.set(pos[0], pos[1], pos[2]);
    scene.add(light);
  }

  return { scene, edgeMat, faceMat, starMats, skyRT };
}
