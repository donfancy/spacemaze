// SPACE MAZE 2026 -- Prototyp: Szenen-Aufbau.
// Baut aus dem ECHTEN Maze-Generator (src/world/maze.js, metric.js,
// mazeGeometry.js) und der ECHTEN Farb-Palette (src/render/colors.js) eine
// Three.js-Szene: dunkle Flaechen mit Neon-Leuchtkanten (der Bloom-Pass in
// main.js macht daraus das Gluehen), Spiegel-Boden, Nebel, Sternenhimmel,
// Ziel-Leuchtfeuer und pulsierende Tanker als Feind-Vorgeschmack.
// Dieses Modul baut nur AUF -- die Animation steuert main.js.

import * as THREE from 'three';
import { OPEN } from '/src/world/maze.js';
import { corridorOutline, mergeCollinear } from '/src/world/mazeGeometry.js';
import { mazeMetric } from '/src/world/metric.js';
import { createRng } from '/src/util/rng.js';
import {
  PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_RED, ARCADE_YELLOW, NEON_MAGENTA, TANKER_RED,
} from '/src/render/colors.js';

export const PALETTE = { PHOSPHOR_GREEN, TEMPEST_BLUE, ARCADE_RED, ARCADE_YELLOW, NEON_MAGENTA, TANKER_RED };

// HDR-Farbe: ueber Weiss hinaus verstaerkt, damit der Bloom-Schwellwert sie
// aufnimmt (alles unter ~1.0 bleibt matt, alles darueber glueht).
export function hdr(hex, boost = 2.2) {
  return new THREE.Color(hex).multiplyScalar(boost);
}

// Baut die komplette Szene. Rueckgabe: alles, was main.js animieren oder
// umschalten will (Materialien, Reflector, Leuchtfeuer, Tanker ...).
export function buildWorld(maze) {
  const metric = mazeMetric(maze);
  const total = metric.total(maze.n);          // Kantenlaenge der Welt in Einheiten
  const H = metric.corridor;                   // Wandhoehe = 1 Gangbreite

  const scene = new THREE.Scene();
  // Dichte + sichtbare Eigenfarbe: bei den kurzen Sichtweiten im Gang braucht
  // der Nebel beides, sonst ist der N-Toggle unsichtbar (Boris' Befund).
  scene.fog = new THREE.FogExp2(0x0d0618, 0.028);

  const world = { scene, metric, total, H };

  buildWallsAndLines(world, maze);
  buildFloor(world, maze);
  buildSky(world, maze);
  buildBeacon(world, maze);
  buildMirror(world);
  buildTankers(world, maze);
  buildFloodlights(world, maze);

  // Licht: Himmel/Boden-Schimmer + dezenter "Scheinwerfer" an der Kamera.
  // FALLE aus dem ersten Wurf: ein Punktlicht mit decay=2 explodiert an nahen
  // Waenden (1/d^2, d -> 0) ins Bloom-Weiss. Darum: klein, decay=1, und
  // main.js haengt es 2 Einheiten UEBER die Kamera (Mindestabstand zur Wand).
  scene.add(new THREE.HemisphereLight(0x50506e, 0x101018, 2.0));
  world.headlight = new THREE.PointLight(0xffffff, 30, 40, 1);
  scene.add(world.headlight);

  return world;
}

// Wandflaechen + Leuchtkanten aus der 2D-Kontur der puren Geometrie-Module.
function buildWallsAndLines(world, maze) {
  const { metric, H, scene } = world;
  const segs = mergeCollinear(corridorOutline(maze));
  const u = (g) => metric.toUnits(g);

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
  // solche Waende schlucken jedes Licht (Falle aus dem zweiten Wurf).
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

  // Geometrien fuers Spiegelbild aufheben (buildMirror).
  world.wallGeo = wallGeo;
  world.lineGeo = lineGeo;
}

// Boden: halbtransparente dunkle Flaeche, durch die das SPIEGELBILD der Welt
// schimmert (buildMirror), + dezentes Neon-Raster auf den Zellgrenzen.
function buildFloor(world, maze) {
  const { metric, total, scene } = world;

  // Die Deck-Opazitaet regelt die Staerke der Spiegelung ("nasser Asphalt").
  world.floorOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(total, total),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 })
  );
  world.floorOverlay.rotation.x = -Math.PI / 2;
  world.floorOverlay.position.set(total / 2, 0.02, total / 2);
  scene.add(world.floorOverlay);

  const gp = [];
  for (let i = 0; i <= maze.n; i++) {
    const t = metric.toUnits(i);
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
// Drei Punktwolken mit Phasenversatz -> unabhaengiges Funkeln in main.js.
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
function buildBeacon(world, maze) {
  const { metric, scene } = world;
  const gx = metric.toUnits(maze.goal[0] + 0.5);
  const gz = metric.toUnits(maze.goal[1] + 0.5);
  const height = 40, r = 1.7, N = 14;

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
// Reflector): Waende, Kanten, Leuchtfeuer und Sterne einmal mit y -> -y,
// die halbtransparente Bodenplatte dimmt alles gleichmaessig. Vorteile:
// Flaechen bleiben im Spiegel SICHTBAR, die Kanten sind dort bewusst OHNE
// HDR (kein Bloom-Gluehen im Spiegel -> wirkt wie echte matte Reflexion),
// und es kostet keinen zweiten Render-Pass.
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
  const { metric, H, scene } = world;
  const cells = pickChambers(maze, 3, 13, 4);
  const colors = [NEON_MAGENTA, TEMPEST_BLUE, ARCADE_YELLOW];
  world.floods = [];
  for (let i = 0; i < cells.length; i++) {
    const light = new THREE.PointLight(colors[i % colors.length], 160, 70, 2);
    light.position.set(
      metric.toUnits(cells[i][0] + 0.5), H + 4, metric.toUnits(cells[i][1] + 0.5)
    );
    scene.add(light);
    world.floods.push(light);
  }
}

// Drei Tanker (rote Rauten) als Feind-Vorgeschmack: dunkle Flaechen mit
// Emissiv-Glut + Leuchtkanten, schwebend in Kammern entlang des Loesungswegs.
// Rein dekorativ -- pulsieren und drehen macht main.js.
function buildTankers(world, maze) {
  const { metric, H, scene } = world;
  const cells = pickChambers(maze, 3, 7, 6);

  world.tankers = [];
  const geo = new THREE.OctahedronGeometry(1);
  const edgeGeo = new THREE.EdgesGeometry(geo);
  for (let i = 0; i < cells.length; i++) {
    const [cxg, cyg] = cells[i];
    const group = new THREE.Group();
    // Vektor-Geist: dunkler Koerper, die Glut sitzt in den KANTEN (Bloom).
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x2a0a10, roughness: 0.6, metalness: 0.1,
      emissive: new THREE.Color(TANKER_RED), emissiveIntensity: 0.16,
    }));
    const edges = new THREE.LineSegments(
      edgeGeo, new THREE.LineBasicMaterial({ color: hdr(TANKER_RED, 3.2) })
    );
    group.add(body, edges);
    group.scale.set(1.1, 1.9, 1.1);
    group.position.set(
      metric.toUnits(cxg + 0.5), H * 0.45, metric.toUnits(cyg + 0.5)
    );
    group.userData.phase = i * 2.1;
    scene.add(group);
    world.tankers.push(group);
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
