// 2026-Engine: Szenen-AUFBAU der Labyrinth-Welt (Teil der Render-Schicht,
// Gegenstueck zu proto2026/world3d.js -- von dort uebernommen und an das echte
// Spiel angedockt). Baut aus dem Maze des Spiels eine Three.js-Szene: dunkle
// Flaechen mit Neon-Leuchtkanten (der Bloom-Pass in backend.js macht daraus
// das Gluehen), Spiegel-Boden, Nebel, Sternenhimmel, Ziel-Leuchtfeuer und
// farbige Flutlichter. Dieses Modul baut nur AUF -- animiert wird in backend.js.
//
// MASSSTAB: die GANG-Breite ist immer UNITS_PER_CELL 3D-Einheiten gross,
// egal welche Metrik das Level hat (Blockwelt oder schmale Waende). So gelten
// alle im Prototyp ertasteten Konstanten (Nebeldichte, Licht-Intensitaeten,
// Sternen-Radius) unveraendert; backend.js rechnet die Spielerlage mit
// k = UNITS_PER_CELL / cellSize um. Gelernte GPU-Fallen: public/proto2026/README.md.

import * as THREE from 'three';
import { OPEN } from '../world/maze.js';
import { corridorOutline, mergeCollinear } from '../world/mazeGeometry.js';
import { mazeMetric } from '../world/metric.js';
import { createRng } from '../util/rng.js';
import {
  PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_RED, ARCADE_YELLOW, NEON_MAGENTA,
} from '../render/colors.js';
import { WALL_RATIO } from '../scenes/mazeView.js';

export const UNITS_PER_CELL = 5;        // 3D-Einheiten pro Gangbreite
export const FOG_DENSITY = 0.028;       // pro 3D-Einheit (Prototyp-Wert; die
                                        // Draufsicht schaltet den Nebel ab)
export const HEADLIGHT_INTENSITY = 12;  // Kamera-Scheinwerfer (Draufsicht: 0)
const MIRROR_DIM = 0.7;                 // Deck-Opazitaet des Bodens (Spiegel-Staerke)
const FOG_COLOR = 0x0d0618;

// HDR-Farbe: ueber Weiss hinaus verstaerkt, damit der Bloom-Schwellwert (0.85)
// sie aufnimmt -- alles unter ~1.0 bleibt matt, alles darueber glueht.
export function hdr(hex, boost = 2.2) {
  return new THREE.Color(hex).multiplyScalar(boost);
}

// Baut die komplette Welt fuer EIN Labyrinth. Rueckgabe: alles, was backend.js
// animieren will (Materialien, Leuchtfeuer, Lichter) + Masse (k, total, H).
export function buildWorld(maze) {
  const metric = mazeMetric(maze);
  const k = UNITS_PER_CELL / metric.corridor; // 3D-Einheiten pro Metrik-Einheit
  const total = metric.total(maze.n) * k;     // Kantenlaenge der Welt
  const H = WALL_RATIO * UNITS_PER_CELL;      // Wandhoehe wie 1980: 1.2 Gangbreiten

  const scene = new THREE.Scene();
  // Dichte + sichtbare Eigenfarbe: bei den kurzen Sichtweiten im Gang braucht
  // der Nebel beides, sonst ist er unsichtbar (Boris' Befund im Prototyp).
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  const world = { scene, metric, k, total, H, u: (g) => metric.toUnits(g) * k };

  buildWallsAndLines(world, maze);
  buildFloor(world, maze);
  buildSky(world, maze);
  buildBeacon(world, maze);
  buildMirror(world);
  buildFloodlights(world, maze);

  // Licht: Himmel/Boden-Schimmer + dezenter "Scheinwerfer" an der Kamera.
  // FALLE: ein Punktlicht mit decay=2 explodiert an nahen Waenden (1/d^2)
  // ins Bloom-Weiss. Darum klein halten, und backend.js haengt es 2 Einheiten
  // UEBER die Kamera (Mindestabstand zur Wand). Intensitaet DEUTLICH unter
  // dem Prototyp-Wert (30): der Autopilot blieb in der Gangmitte, der echte
  // Spieler steht an der Wand -- da wusch 30 das ganze Bild weiss-gruen aus.
  scene.add(new THREE.HemisphereLight(0x50506e, 0x101018, 2.0));
  world.headlight = new THREE.PointLight(0xffffff, HEADLIGHT_INTENSITY, 40, 1);
  scene.add(world.headlight);

  // Bump-Blitz (Stufe 1): kurzer Licht-Puls an der getroffenen Wand.
  // Intensitaet 0 = aus; backend.js positioniert und pulst ihn.
  world.bumpLight = new THREE.PointLight(0xffffff, 0, 30, 2);
  scene.add(world.bumpLight);

  return world;
}

// Level-Farbe auf alle Thema-Materialien anwenden (Leuchtkanten HDR, Spiegel-
// Kanten bewusst OHNE HDR -- kein Bloom im Spiegelbild, wirkt matt-reflektiert).
export function applyTheme(world, hex) {
  const col = new THREE.Color(hex);
  world.lineMat.color.copy(col).multiplyScalar(2.2);
  world.mirrorLineMat.color.copy(col).multiplyScalar(0.85);
  world.gridMat.color.copy(col).multiplyScalar(0.3);
  world.wallGridMat.color.copy(col).multiplyScalar(0.3);
  world.headlight.color.copy(col);
}

// Welt wegwerfen (Levelwechsel): GPU-Ressourcen freigeben, sonst leckt jedes
// neue Labyrinth Geometrie- und Textur-Speicher.
export function disposeWorld(world) {
  const seen = new Set();
  world.scene.traverse((obj) => {
    if (obj.geometry && !seen.has(obj.geometry)) { seen.add(obj.geometry); obj.geometry.dispose(); }
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.map?.dispose();
      m.dispose();
    }
  });
  world.scene.clear();
}

// Wandflaechen + Leuchtkanten aus der 2D-Kontur der puren Geometrie-Module.
function buildWallsAndLines(world, maze) {
  const { H, scene, u } = world;
  const segs = mergeCollinear(corridorOutline(maze));

  // Flaechen: pro Kontur-Segment ein senkrechtes Quad (Boden bis Wandkrone).
  const pos = [], norm = [], idx = [];
  for (const [[x1, y1], [x2, y2]] of segs) {
    const ax = u(x1), az = u(y1), bx = u(x2), bz = u(y2);
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len, nz = (bx - ax) / len; // senkrecht zum Segment
    const base = pos.length / 3;
    pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, H, az);
    for (let i = 0; i < 4; i++) norm.push(nx, 0, nz);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  wallGeo.setIndex(idx);
  // Albedo bewusst hell waehlen: sRGB 0x1a ist linear nur ~1% Reflexion,
  // solche Waende schlucken jedes Licht (Falle aus dem Prototyp).
  world.wallMat = new THREE.MeshStandardMaterial({
    color: 0x4a5a78, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide,
    emissive: 0x0a0e1a, emissiveIntensity: 1, // Flaechen bleiben auch ohne Licht lesbar
    // Flaechen minimal nach hinten schieben, damit die aufliegenden Kanten-
    // Linien sauber gewinnen (kein Z-Fighting).
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  scene.add(new THREE.Mesh(wallGeo, world.wallMat));

  // Leuchtkanten: Ober-/Unterkante jedes Wandzugs + senkrechte Eck-Pfosten.
  const lp = [];
  const corners = new Map(); // "x,y" -> [ux, uz], Ecken nur einmal
  for (const [[x1, y1], [x2, y2]] of segs) {
    const ax = u(x1), az = u(y1), bx = u(x2), bz = u(y2);
    lp.push(ax, H, az, bx, H, bz);          // Wandkrone
    lp.push(ax, 0.05, az, bx, 0.05, bz);    // Bodenlinie (knapp ueber dem Boden)
    corners.set(x1 + ',' + y1, [ax, az]);
    corners.set(x2 + ',' + y2, [bx, bz]);
  }
  for (const [, [cx, cz]] of corners) lp.push(cx, 0, cz, cx, H, cz);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  world.lineMat = new THREE.LineBasicMaterial({ color: hdr(PHOSPHOR_GREEN) });
  scene.add(new THREE.LineSegments(lineGeo, world.lineMat));

  // Zellgrenzen-Pfosten AUF den Wandflaechen (dezent, ohne HDR -- wie das
  // Boden-Raster): das 2026-Pendant zu den 1980-Pfosten an jeder Zellgrenze.
  // Ohne sie ist eine nahe Blockwand eine strukturlose Flaeche, die den
  // ganzen Bildschirm fuellt -- man verliert beim Wand-Anlaufen jede
  // Orientierung (Befund der Stufe-1-Sichtpruefung). Die Linien liegen in
  // der Flaechen-Ebene; der polygonOffset der Waende laesst sie gewinnen.
  const wg = [];
  for (const [[x1, y1], [x2, y2]] of segs) {
    const horizontal = y1 === y2;                  // Segment laeuft entlang x
    const [lo, hi] = horizontal ? [x1, x2] : [y1, y2];
    for (let i = Math.min(lo, hi) + 1; i < Math.max(lo, hi); i++) {
      const px = horizontal ? u(i) : u(x1);
      const pz = horizontal ? u(y1) : u(i);
      wg.push(px, 0.05, pz, px, H, pz);
    }
  }
  const wallGridGeo = new THREE.BufferGeometry();
  wallGridGeo.setAttribute('position', new THREE.Float32BufferAttribute(wg, 3));
  world.wallGridMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(PHOSPHOR_GREEN).multiplyScalar(0.3),
    transparent: true, opacity: 0.8,
  });
  scene.add(new THREE.LineSegments(wallGridGeo, world.wallGridMat));

  // Geometrien fuers Spiegelbild aufheben (buildMirror).
  world.wallGeo = wallGeo;
  world.lineGeo = lineGeo;
}

// Boden: halbtransparente dunkle Flaeche, durch die das SPIEGELBILD der Welt
// schimmert (buildMirror), + dezentes Neon-Raster auf den Zellgrenzen.
function buildFloor(world, maze) {
  const { total, scene, u } = world;

  // Die Deck-Opazitaet regelt die Staerke der Spiegelung ("nasser Asphalt").
  world.floorOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(total, total),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: MIRROR_DIM })
  );
  world.floorOverlay.rotation.x = -Math.PI / 2;
  world.floorOverlay.position.set(total / 2, 0.02, total / 2);
  scene.add(world.floorOverlay);

  const gp = [];
  for (let i = 0; i <= maze.n; i++) {
    const t = u(i);
    gp.push(0, 0.04, t, total, 0.04, t);
    gp.push(t, 0.04, 0, t, 0.04, total);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  world.gridMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(PHOSPHOR_GREEN).multiplyScalar(0.3),
    transparent: true, opacity: 0.8,
  });
  scene.add(new THREE.LineSegments(gridGeo, world.gridMat));
}

// Sternenhimmel + Nebel-Sprites. Deterministisch aus maze.seed (wie im Spiel),
// Flaechen-Gleichverteilung auf der Halbkugel (el = asin(u)).
// Drei Punktwolken mit Phasenversatz -> unabhaengiges Funkeln in backend.js.
function buildSky(world, maze) {
  const { scene, total } = world;
  const rng = createRng(maze.seed);
  const R = 600;
  const cx = total / 2, cz = total / 2;
  const tints = [PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_YELLOW, NEON_MAGENTA, ARCADE_RED];

  world.starGroups = [];
  world.starGeos = [];
  for (let g = 0; g < 3; g++) {
    const pts = [], cols = [];
    for (let i = 0; i < 2000; i++) {
      const az = rng() * Math.PI * 2;
      const el = Math.asin(rng());
      pts.push(
        cx + R * Math.cos(el) * Math.cos(az),
        R * Math.sin(el),
        cz + R * Math.cos(el) * Math.sin(az)
      );
      const c = rng() < 0.16
        ? new THREE.Color(tints[Math.floor(rng() * tints.length)])
        : new THREE.Color(0xffffff);
      c.multiplyScalar(0.35 + rng() * 0.65);
      cols.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.5, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 1, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    scene.add(new THREE.Points(geo, mat));
    world.starGroups.push(mat);
    world.starGeos.push(geo);
  }

  // Psychedelischer Weltraum-Dunst: grosse additive Glow-Sprites am Horizont.
  const tex = glowTexture();
  const clouds = [
    { hex: NEON_MAGENTA, az: 0.7, el: 0.18, s: 700, o: 0.07 },
    { hex: TEMPEST_BLUE, az: 2.9, el: 0.30, s: 900, o: 0.06 },
    { hex: PHOSPHOR_GREEN, az: 4.6, el: 0.12, s: 600, o: 0.05 },
  ];
  for (const { hex, az, el, s, o } of clouds) {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(hex), transparent: true, opacity: o,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(
      cx + 900 * Math.cos(el) * Math.cos(az),
      900 * Math.sin(el),
      cz + 900 * Math.cos(el) * Math.sin(az)
    );
    sp.scale.set(s, s, 1);
    scene.add(sp);
  }
}

// Weicher radialer Glow als Canvas-Textur (Render-Schicht, kein Spielzustand).
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// Ziel-Leuchtfeuer: Ring aus HDR-Lichtsaeulen + additiver Lichtkegel + Punktlicht.
// backend.js laesst es pulsieren und am Ziel weiss aufstrahlen/erloeschen.
function buildBeacon(world, maze) {
  const { scene, u } = world;
  const gx = u(maze.goal[0] + 0.5);
  const gz = u(maze.goal[1] + 0.5);
  const height = 40, r = 0.34 * UNITS_PER_CELL, N = 14;

  const bp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = gx + r * Math.cos(a), z = gz + r * Math.sin(a);
    bp.push(x, 0, z, x, height, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  world.beaconLines = new THREE.LineSegments(
    geo, new THREE.LineBasicMaterial({ color: hdr(ARCADE_YELLOW, 2.6), transparent: true })
  );
  scene.add(world.beaconLines);

  world.beaconCone = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.6, r + 0.6, height, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: ARCADE_YELLOW, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
  );
  world.beaconCone.position.set(gx, height / 2, gz);
  scene.add(world.beaconCone);

  world.beaconLight = new THREE.PointLight(ARCADE_YELLOW, 600, 80, 2);
  world.beaconLight.position.set(gx, 3, gz);
  scene.add(world.beaconLight);
}

// Spiegelbild der Welt unter dem Boden (klassischer Trick statt Echtzeit-
// Reflector, siehe Prototyp-README): Waende, Kanten, Leuchtfeuer und Sterne
// einmal mit y -> -y, die halbtransparente Bodenplatte dimmt alles
// gleichmaessig. Flaechen bleiben im Spiegel SICHTBAR, die Kanten dort
// bewusst OHNE HDR (kein Bloom-Gluehen im Spiegel), und es kostet keinen
// zweiten Render-Pass.
function buildMirror(world) {
  const { scene } = world;
  const g = new THREE.Group();
  g.scale.y = -1; // spiegelt alle Kinder an der Bodenebene

  g.add(new THREE.Mesh(world.wallGeo, world.wallMat)); // DoubleSide vertraegt die Spiegelung
  world.mirrorLineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(PHOSPHOR_GREEN).multiplyScalar(0.85),
  });
  g.add(new THREE.LineSegments(world.lineGeo, world.mirrorLineMat));

  world.beaconMirrorMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(ARCADE_YELLOW), transparent: true, opacity: 0.5,
  });
  g.add(new THREE.LineSegments(world.beaconLines.geometry, world.beaconMirrorMat));

  for (const geo of world.starGeos) {
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.5, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.3, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    })));
  }

  world.mirror = g;
  scene.add(g);
}

// Drei farbige Flutlichter ueber dem Labyrinth: psychedelischer Widerschein
// auf Wandkronen und Boeden, macht die Flaechen als Flaechen lesbar. Sie
// schweben ueber den Wandkronen (Mindestabstand -> kein Bloom-Blowout).
function buildFloodlights(world, maze) {
  const { H, scene, u } = world;
  const cells = pickChambers(maze, 3, 13, 4);
  const colors = [NEON_MAGENTA, TEMPEST_BLUE, ARCADE_YELLOW];
  world.floods = [];
  for (let i = 0; i < cells.length; i++) {
    const light = new THREE.PointLight(colors[i % colors.length], 160, 70, 2);
    light.position.set(u(cells[i][0] + 0.5), H + 4, u(cells[i][1] + 0.5));
    scene.add(light);
    world.floods.push(light);
  }
}

// Waehlt `count` offene Kammern, deterministisch aus maze.seed (+offset),
// mit Schutzabstand zu Start und Ziel (wie die Schutzzone im Spiel).
function pickChambers(maze, count, seedOffset, guard) {
  const { n, grid, start, goal } = maze;
  const rng = createRng(maze.seed + seedOffset);
  const candidates = [];
  for (let y = 1; y < n; y += 2) {
    for (let x = 1; x < n; x += 2) {
      if (grid[y][x] !== OPEN) continue;
      const dS = Math.abs(x - start[0]) + Math.abs(y - start[1]);
      const dG = Math.abs(x - goal[0]) + Math.abs(y - goal[1]);
      if (dS > guard && dG > guard) candidates.push([x, y]);
    }
  }
  const picked = [];
  while (picked.length < count && candidates.length > 0) {
    const i = Math.floor(rng() * candidates.length);
    picked.push(candidates.splice(i, 1)[0]);
  }
  return picked;
}
