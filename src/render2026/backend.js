// 2026-Engine: der EINZIGE Three.js-Teil (Gegenstueck zu render/renderer.js,
// das der einzige 2D-Canvas-Teil bleibt). Wird von main.js NUR bei
// ?engine=2026 dynamisch importiert und als game.renderBackend injiziert --
// der Core und die Tests beruehren Three.js nie.
//
// Stand Stufe 0 (PLAN2026.md): Geruest + Platzhalter-Zeichnung fuer alle
// Szenen (Sternenhimmel, rotierender Draht-Wuerfel als Battlezone-Gruss,
// Szenen-Anzeige, Fade analog fillBlack). Ab Stufe 1 bekommt jede Szene in
// `drawers` ihren eigenen Zeichner, der den Spielzustand liest.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { State } from '../core/states.js';
import { levelColor } from '../core/levels.js';
import { PHOSPHOR_GREEN } from '../render/colors.js';
import { createRng } from '../util/rng.js';

// HDR-Farbe: ueber Weiss hinaus, damit der Bloom sie aufnimmt (Schwellwert 0.85).
function hdr(hex, boost = 2.2) {
  return new THREE.Color(hex).multiplyScalar(boost);
}

export function createBackend2026(container = document.body) {
  // --- Renderer + Bloom-Kette (Rezept aus public/proto2026/) ------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;display:block;';
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  const scene = new THREE.Scene();

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4, type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
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

  // --- Platzhalter-Szene: Sternenhimmel + Draht-Wuerfel -----------------------
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
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 2.5, sizeAttenuation: false,
    transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending,
  })));

  const cubeMat = new THREE.LineBasicMaterial({ color: hdr(PHOSPHOR_GREEN) });
  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 3, 3)), cubeMat
  );
  cube.position.set(0, 0, -8);
  scene.add(cube);

  // Platzhalter fuer alle Szenen: Wuerfel dreht, Himmel zieht langsam vorbei.
  // Alle Animation haengt an game.time (deterministisch, keine eigene Uhr).
  function drawPlaceholder(game, color) {
    cubeMat.color.copy(hdr(color));
    cube.rotation.set(game.time * 0.4, game.time * 0.55, 0);
    camera.rotation.set(0, game.time * 0.03, 0);
  }

  // Szenen-Zeichner der 2026-Engine. Ab Stufe 1 ersetzt jede Szene ihren
  // Platzhalter durch eine echte Zeichnung des Spielzustands.
  const drawers = {
    [State.STARTSCREEN]: drawPlaceholder,
    [State.MAZE_GEN]: drawPlaceholder,
    [State.FALLING]: drawPlaceholder,
    [State.PLAYING]: drawPlaceholder,
    [State.RISING]: drawPlaceholder,
    [State.MAP]: drawPlaceholder,
  };

  return {
    // Wird von game.render() pro Frame gerufen (Naht der Engines).
    render(game) {
      // Gleiche Farb-Regel wie game.render() fuer die 1980-Engine.
      const color = game.stateKey === State.STARTSCREEN
        ? PHOSPHOR_GREEN
        : levelColor(game.level);
      (drawers[game.stateKey] ?? drawPlaceholder)(game, color);
      composer.render();

      label.textContent =
        `ENGINE 2026 · STUFE 0 (PLATZHALTER) · ` +
        `SZENE ${game.stateKey} · LEVEL ${game.level}`;

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
