// 2026-Engine: Szenen-AUFBAU des Startscreens (Stufe 3) -- das Gegenstueck
// zum 1980-Drahtwuerfel, in Prototyp-Optik: dunkle Wuerfel-Flaechen mit
// Neon-Leuchtkanten (Bloom), voller Sternenhimmel (Kugel -- die Kamera
// umtanzt den Wuerfel) und Farb-Dunst. Nur AUFBAU; animiert (Kamera-Pose aus
// startscreen.viewState(), Funkeln, Kantenfarbe beim An-/Abdocken) wird in
// backend.js. Der Wuerfel ist exakt so gross wie im Core (CUBE_SIZE 2.4),
// damit die Posen der Orbit-/Dock-Bahnen unveraendert gelten.

import * as THREE from 'three';
import { PHOSPHOR_GREEN, TEMPEST_BLUE, NEON_MAGENTA } from '../render/colors.js';
import { hdr, buildStarField, buildDust } from './world3d.js';

import { CUBE_SIZE } from '../scenes/mazeView.js'; // eine Quelle fuer beide Engines
const STAR_SEED = 1980;   // fester Himmel (kein Maze-Seed auf dem Startscreen)

export function buildStartscreenScene() {
  const scene = new THREE.Scene();

  const { mats: starMats } = buildStarField(scene, {
    seed: STAR_SEED, center: [0, 0], hemisphere: false,
  });
  buildDust(scene, [0, 0]);

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
  scene.add(new THREE.HemisphereLight(0x50506e, 0x101018, 2.0));
  const l1 = new THREE.PointLight(NEON_MAGENTA, 220, 40, 2);
  l1.position.set(5, 4, 6);
  scene.add(l1);
  const l2 = new THREE.PointLight(TEMPEST_BLUE, 220, 40, 2);
  l2.position.set(-6, -3, -5);
  scene.add(l2);

  return { scene, edgeMat, faceMat, starMats };
}
