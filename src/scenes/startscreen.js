// Startbildschirm in drei Phasen:
//   'orbiting'  - die Kamera umtanzt einen Drahtwuerfel, "PRESS S TO START" blinkt,
//                 oberhalb steht das per Pfeiltasten waehlbare Level.
//   'docking'   - nach S faehrt die Kamera harmonisch frontal vor die Wuerfelseite,
//                 die ihr beim Druck am meisten zugewandt ist (min Blick . Normale).
//                 Verdeckte Kanten faden von 30% auf 0%, sodass am Ende nur das
//                 Quadrat (diese Flaeche = das Grid) uebrig bleibt.
//   'undocking' - Rueckweg von der Karte (game.undock): das Andocken rueckwaerts.
//                 Die Kamera loest sich von der Flaeche, verdeckte Kanten faden
//                 von 0% auf 30% ein, und der Flug endet an der Stelle der
//                 Orbit-Bahn, die dieser Flaeche zugewandt ist -- dort laeuft
//                 das Umtanzen nahtlos weiter.
// C1-STETIGKEIT beider Fluege (31.8.2026): die Orbit-Uhr t laeuft waehrend
// der Fluege WEITER, und dockPose blendet gegen die BEWEGTE Orbit-Pose
// (Andocken: bewegter Start, Abdocken: bewegtes Ziel). Weil easeInOut an
// beiden Enden Steigung 0 hat, uebernimmt der Flug am Orbit-Ende exakt die
// Bahngeschwindigkeit und kommt an der Flaeche mit Tempo 0 an -- kein
// hartes Stehenbleiben des Himmels beim S-Druck, kein harter Ruck, wenn
// nach dem Abdocken das Umtanzen wieder einsetzt. Der Abdock-Flug startet
// die Uhr um UNDOCK_DURATION VOR dem zugewandten Bahnpunkt, damit die
// Landung trotz laufender Uhr dort ankommt.
// Nach Abschluss des Andockens uebernimmt MazeGen nahtlos dieselbe Flaeche.
//
// Tasten (Stufe 3): links/rechts = Level, hoch/runter = Engine-Schalter
// "1980 / 2026" (hoch = 2026, runter = 1980; main.js merkt die Wahl in
// localStorage und laedt/zeigt das 2026-Backend live).

import { GameEvent } from '../core/states.js';
import { blinkOn, copyrightLine, INFO_TITLE, INFO_LINES } from '../core/hud.js';
import { fitSize } from '../render/vectorText.js';
import { drawSelector } from './demoOverlay.js';
import { TITLE, TITLE_WORD, titleZoom, titleAlpha, titleColor, titleFlash } from '../world/title.js';
import { stepLevel, levelColor, MIN_LEVEL, MAX_LEVEL } from '../core/levels.js';
import { ENGINE_1980, ENGINE_2026 } from '../core/engine.js';
import { PHOSPHOR_GREEN, mixColors } from '../render/colors.js';
import { tickPatch, dockPatch } from '../sound/patches.js';
import { rampToward } from '../world/drive.js';
import { createCamera } from '../math/camera.js';
import { normalize } from '../math/vec3.js';
import { cubeMesh } from '../world/shapes.js';
import { orbitCamera, dockPose, orbitTimeFacing } from '../world/cameraPaths.js';
import { classifyEdges } from '../world/visibility.js';
import { pickDockFace, faceDockPose, SIDE_FACES } from '../world/cubeFaces.js';
import { CUBE_SIZE } from './mazeView.js';

const HIDDEN_DIM = 0.3;     // Grunddimmung verdeckter Kanten
// "PRESS S TO START"-Blinken: blinkOn kommt aus core/hud.js -- EINE Formel
// fuer render(), viewState() und das Demo-Overlay des Attract-Mode.
const DOCK_DURATION = 1.6;  // Sekunden fuer das Andocken
// Attract-Mode (Demo): ohne Tastendruck startet nach IDLE Sekunden eine
// Autopilot-Demo; laeuft der Demo-Zyklus schon (Rueckkehr in den Orbit),
// geht es nach der kurzen Schleifen-Pause weiter.
const DEMO_IDLE = 30;
// Attract-Pause im Orbit zwischen den Demos: erst RUHIGE Nur-Wuerfel-Zeit
// (ORBIT_CALM), dann TITEL (TITLE.dur) -> HOW TO PLAY (ATTRACT_INFO) ->
// naechste Demo dockt an. Die allererste Sequenz (nach DEMO_IDLE) beginnt
// direkt mit dem Titel -- die Ruhe davor war die Idle-Zeit selbst.
const ORBIT_CALM = 20; // Boris 1.9.2026: 7s wirkten wie ~4s reine Wuerfel-Zeit
const ATTRACT_INFO = 6;
// Feinschliff der Attract-Sequenz (Boris 1.9.2026, "How to play kommt
// hart"): 1s Luft zwischen Titel-Ende und Info, und die Info blendet in
// 2026 ein/aus (infoA-Rampe; 1980 schaltet hart -- Arcade-authentisch).
// Das Andocken wartet das Ausblenden ab.
const INFO_GAP = 1;
const INFO_FADE = 0.5;
const UNDOCK_DURATION = DOCK_DURATION; // Rueckflug symmetrisch gleich lang
// Hoehe leicht begrenzt (max ~31 Grad), damit immer eine SEITENflaeche zugewandt
// ist -- dort dockt die Kamera ohne Gimbal-Rollen an.
const ORBIT_OPTS = {
  center: [0, 0, 0], radius: 5.85, radiusVar: 1.6, azimuthSpeed: 0.36,
  elevation: 0.38, elevationVar: 0.17,
};

export function createStartscreen(game) {
  const camera = createCamera({ fov: Math.PI / 2.4 });
  const cube = cubeMesh([0, 0, 0], CUBE_SIZE);

  let t = 0;
  let phase = 'orbiting';
  let dockT = 0;
  let dockTarget = null;
  let undockT = 0;
  let undockStart = null;
  let idle = 0; // Sekunden ohne Tastendruck im Orbit (Attract-Mode-Uhr)
  // Info-Seite "HOW TO PLAY" (core/hud.js): I blendet sie im Orbit ueber
  // den (gedimmten) Wuerfel, I/X schliessen. Der Attract-Mode zeigt sie
  // automatisch waehrend der Orbit-Pause zwischen den Demos.
  let info = false;
  let infoA = 0;          // Info-Blende 0..1 (2026 zeichnet damit; Rampe s.u.)
  let attractHold = false; // Attract-Sequenz laeuft (Titel/Luecke/Info/Fade):
                           // die Mitte-Texte bleiben durchgehend verdraengt
  // Titel-Display "MAZESTORM" (world/title.js): einmal beim allerersten
  // Laden (bootPlayed) und als Auftakt jeder Attract-Pause; jede Taste
  // raeumt ihn weg. attractWait = die erste Attract-Sequenz laeuft schon
  // im Orbit, bevor game.beginDemo() die Demo uebernimmt.
  let title = false;
  let titleT = 0;
  let bootPlayed = false;
  let attractWait = false;
  let pauseT = 0;

  // Andocken einleiten (S bzw. Demo-Start): zugewandte Flaeche waehlen und
  // den Flug beginnen -- aus onKey gehoben, der Attract-Mode braucht ihn auch.
  function startDock() {
    const o = orbitCamera(t, ORBIT_OPTS);
    // Blickrichtung zur Wuerfelmitte -> zugewandte Seitenflaeche waehlen.
    const viewDir = normalize([-o.position[0], -o.position[1], -o.position[2]]);
    const face = pickDockFace(viewDir);
    game.dockFace = face;
    dockTarget = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
    phase = 'docking';
    dockT = 0;
    info = false;
    title = false;
    game.audio?.play(dockPatch(DOCK_DURATION)); // dezentes Herangleiten
  }

  function applyPose(pose) {
    camera.position = pose.position;
    camera.yaw = pose.yaw;
    camera.pitch = pose.pitch;
  }

  // Aktueller Blick auf den Wuerfel, fuer BEIDE Engines dieselbe Quelle:
  // Pose auf der Bahn, Dimmung der verdeckten Kanten und die Blend-Farbe
  // (null = Renderer-Grundfarbe gruen). p ist der Flug-Fortschritt (0..1).
  function look() {
    if (phase === 'undocking') {
      // Bewegtes ZIEL: die Orbit-Uhr laeuft, der Flug landet mit der
      // Bahngeschwindigkeit des Orbits (C1 -- kein Ruck beim Uebergang).
      const p = Math.min(undockT / UNDOCK_DURATION, 1);
      return {
        phase, p, pose: dockPose(p, undockStart, orbitCamera(t, ORBIT_OPTS)),
        hiddenDim: HIDDEN_DIM * p,
        color: mixColors(levelColor(game.level), PHOSPHOR_GREEN, p),
      };
    }
    if (phase === 'orbiting') {
      return { phase, p: 0, pose: orbitCamera(t, ORBIT_OPTS), hiddenDim: HIDDEN_DIM, color: null };
    }
    // 'docking' (und der Moment 'docked'): Blende Richtung Level-Farbe.
    // Bewegter START: der Orbit tanzt unter dem anwachsenden Ease weiter,
    // der S-Druck friert nichts ein (C1 -- der Himmel bleibt in Fahrt).
    const p = Math.min(dockT / DOCK_DURATION, 1);
    return {
      phase, p, pose: dockPose(p, orbitCamera(t, ORBIT_OPTS), dockTarget),
      hiddenDim: HIDDEN_DIM * (1 - p),
      color: mixColors(PHOSPHOR_GREEN, levelColor(game.level), p),
    };
  }

  // `color` null = Renderer-Grundfarbe (Orbit); beim An-/Abdocken die
  // Blend-Farbe Richtung Level-Thema. `dim` blendet den ganzen Wuerfel ab
  // (Info-Seite: der Text steht im Vordergrund).
  function drawCube(renderer, hiddenDim, color, dim = 1) {
    const opts = { color: color ?? undefined };
    const { visible, hidden } = classifyEdges(cube, camera.position);
    renderer.renderScene({ segments: hidden, intensity: hiddenDim * dim }, camera, opts);
    renderer.renderScene({ segments: visible, intensity: dim }, camera, opts);
  }

  // Titel-Display (1980, Tempest-Stil): MAZESTORM fliegt aus der Tiefe
  // heran (titleZoom skaliert die Schrift), dahinter 2 Echo-Konturen in den
  // Nachbarfarben der Palette (der "Tunnel"-Look), harte Farbwechsel
  // (titleColor), am Ende weisser Blitz (renderer.flash) + Ausblenden.
  function drawTitle(renderer) {
    const alpha = titleAlpha(titleT);
    if (alpha <= 0) return;
    const w = renderer.width;
    const h = renderer.height;
    const cy = h * 0.44;
    // Schriftgroesse bei Zoom 1: klein genug, dass auch die aeusserste
    // Echo-Kontur (+48%) noch aufs Bild passt.
    const full = Math.min(w / 11, h / 4.5);
    for (let ring = 2; ring >= 0; ring--) {
      const size = full * titleZoom(titleT) * (1 + 0.24 * ring);
      renderer.drawText(TITLE_WORD, {
        x: w / 2, y: cy, size, align: 'center', baseline: 'middle',
        color: titleColor(titleT, ring),
        intensity: alpha * (ring === 0 ? 1 : 0.4 / ring),
        lineWidth: ring === 0 ? 2.5 : 1.5,
        glow: ring === 0 ? 14 : 6,
      });
    }
    const flash = titleFlash(titleT);
    if (flash > 0) renderer.flash(flash * 0.6, '#ffffff');
    // Arcade-Copyright unterm Titelzug (Boris 1.9.2026, "(C) 1980 ATARI"-
    // Hommage): steht fest, waehrend der Titel heranzoomt; die Jahreszahl
    // folgt der gewaehlten Engine (core/hud.js).
    renderer.drawText(copyrightLine(game.engine), {
      x: w / 2, y: cy + full * 1.05, size: full * 0.22,
      align: 'center', baseline: 'middle', intensity: alpha * 0.7,
    });
  }

  // Info-Seite (1980): Titel + zweispaltige Tasten-Tabelle, mittig ueber
  // dem gedimmten Wuerfel; "PRESS S TO START" blinkt darunter weiter.
  function drawInfo(renderer) {
    const w = renderer.width;
    const h = renderer.height;
    const size = Math.max(18, Math.min(42, h * 0.05));
    const gutter = size * 0.6;             // Luft zwischen Tasten- und Text-Spalte
    // Hochformat: die laengste Zeile muss rechts der Mitte Platz haben.
    const longest = INFO_LINES.reduce((m, [, t]) => (t.length > m.length ? t : m), '');
    const rowSize = fitSize(longest, size * 0.5, w / 2 - gutter - 16);
    const rowH = rowSize * 1.8;
    const top = Math.max(48, h * 0.14) + size * 2.6;

    renderer.drawText(INFO_TITLE, {
      x: w / 2, y: top, size: size * 0.8,
      align: 'center', baseline: 'middle',
    });
    for (let i = 0; i < INFO_LINES.length; i++) {
      const [key, text] = INFO_LINES[i];
      const y = top + size * 1.4 + i * rowH;
      if (key) {
        renderer.drawText(key, {
          x: w / 2 - gutter, y, size: rowSize,
          align: 'right', baseline: 'middle',
        });
      }
      renderer.drawText(text, {
        x: w / 2 + gutter, y, size: rowSize,
        align: 'left', baseline: 'middle', intensity: key ? 1 : 0.6,
      });
    }
  }

  return {
    enter() {
      t = 0;
      phase = 'orbiting';
      dockT = 0;
      dockTarget = null;
      undockT = 0;
      undockStart = null;
      idle = 0;
      info = false;
      infoA = 0;
      attractHold = false;
      title = false;
      attractWait = false;
      pauseT = 0;
      // Automat eingeschaltet: beim allerersten Orbit laeuft der Titel
      // sofort einmal (danach nur noch im Attract-Zyklus).
      if (!game.undock && !bootPlayed) {
        bootPlayed = true;
        title = true;
        titleT = 0;
      }

      if (game.undock) {
        // Rueckweg von der Karte: Abdock-Flug von der Andock-Pose auf die
        // LAUFENDE Orbit-Bahn. Die Uhr startet UNDOCK_DURATION vor dem
        // Bahnpunkt, der dieser Flaeche zugewandt ist -- so landet der Flug
        // trotz mitlaufender Uhr genau dort, und das Umtanzen laeuft mit
        // uebernommener Bahngeschwindigkeit nahtlos weiter (C1).
        game.undock = false;
        const face = game.dockFace ?? SIDE_FACES[0];
        t = orbitTimeFacing(face.normal, ORBIT_OPTS) - UNDOCK_DURATION;
        if (t < 0) t += 2 * Math.PI / ORBIT_OPTS.azimuthSpeed; // Uhr positiv halten
        undockStart = faceDockPose(face, CUBE_SIZE, camera.fov, 0.85);
        phase = 'undocking';
        game.audio?.play(dockPatch(UNDOCK_DURATION, true)); // dezentes Weggleiten
      }
    },

    update(dt) {
      // Info-Blende (2026): infoA folgt info als lineare Rampe -- laeuft in
      // JEDER Phase (S bei offener Info blendet sie im Abflug aus).
      infoA = rampToward(infoA, info && phase === 'orbiting' ? 1 : 0, 1 / INFO_FADE, dt);
      if (phase === 'undocking') {
        t += dt; // Orbit-Uhr laeuft mit -- der Flug zielt auf die bewegte Bahn
        undockT += dt;
        if (undockT >= UNDOCK_DURATION) {
          phase = 'orbiting'; // t steht schon richtig (Start war vorverlegt)
          idle = 0;
          pauseT = 0; // Attract-Pause (Titel -> Info) beginnt von vorn
        }
        return;
      }
      t += dt;
      // Attract-Mode: nach IDLE Sekunden ohne Taste startet die Demo (bzw.
      // die naechste Runde des laufenden Demo-Zyklus nach kurzer Pause).
      if (phase === 'orbiting') {
        if (game.demo || attractWait) {
          // Attract-Sequenz (wie am Automaten): Ruhe -> TITEL -> HOW TO
          // PLAY -> naechste Demo. attractWait ueberbrueckt die erste
          // Runde, in der game.demo erst beim Andocken gesetzt wird --
          // sie beginnt ohne Ruhe-Phase direkt mit dem Titel.
          pauseT += dt;
          const seq = pauseT - (attractWait ? 0 : ORBIT_CALM);
          title = seq >= 0 && seq < TITLE.dur;
          titleT = Math.max(seq, 0);
          // 1s Luft nach dem Titel, dann die Info; nach ihr wartet das
          // Andocken die Ausblende ab (INFO_FADE) -- kein "Ausknipsen".
          info = seq >= TITLE.dur + INFO_GAP
            && seq < TITLE.dur + INFO_GAP + ATTRACT_INFO;
          attractHold = seq >= 0; // Titel/Luecke/Info/Fade: Mitte bleibt frei
          if (seq >= TITLE.dur + INFO_GAP + ATTRACT_INFO + INFO_FADE) {
            attractWait = false;
            game.beginDemo();
            startDock();
          }
        } else {
          attractHold = false;
          // Boot-Titel laeuft einmal durch; danach normale Idle-Uhr.
          if (title) {
            titleT += dt;
            if (titleT >= TITLE.dur) title = false;
          }
          // Manuell geoeffnete Info (I) haelt die Attract-Uhr an --
          // Lesen soll keine Demo lostreten.
          if (!info) idle += dt;
          if (idle >= DEMO_IDLE) {
            attractWait = true;
            pauseT = 0;
            info = false;
          }
        }
      }
      if (phase === 'docking') {
        dockT += dt;
        if (dockT >= DOCK_DURATION) {
          dockT = DOCK_DURATION;
          phase = 'docked';
          // Nahtlos (ohne Fade) ins Labyrinth: MazeGen uebernimmt dieselbe Flaeche.
          game.dispatch(GameEvent.START);
        }
      }
    },

    render(renderer) {
      const { phase: ph, pose, hiddenDim, color } = look();
      applyPose(pose);
      const overlaid = ph === 'orbiting' && (info || title || attractHold);
      drawCube(renderer, hiddenDim, color, overlaid ? (title ? 0.15 : 0.25) : 1);
      if (ph !== 'orbiting') return; // waehrend der Fluege keine Texte

      const w = renderer.width;
      const h = renderer.height;
      const size = Math.max(18, Math.min(42, h * 0.05));

      // Titel-Display: ersetzt alle Mitte-Texte, "PRESS S" blinkt weiter.
      if (title) {
        drawTitle(renderer);
        if (blinkOn(t)) {
          renderer.drawText('PRESS S TO START', {
            x: w / 2, y: h - Math.max(48, h * 0.14), size,
            align: 'center', baseline: 'middle',
          });
        }
        return;
      }

      // Info-Seite: ersetzt Level-Auswahl + Engine-Schalter in der Mitte,
      // "PRESS S TO START" blinkt darunter weiter.
      if (info) {
        drawInfo(renderer);
        if (blinkOn(t)) {
          renderer.drawText('PRESS S TO START', {
            x: w / 2, y: h - Math.max(48, h * 0.14), size,
            align: 'center', baseline: 'middle',
          });
        }
        return;
      }

      // Luecke/Fade der Attract-Sequenz (zwischen Titel und Info bzw. vor
      // dem Andocken): ruhiger Wuerfel + blinkendes PRESS S -- die
      // Mitte-Texte blitzen NICHT fuer eine Sekunde ein.
      if (attractHold) {
        if (blinkOn(t)) {
          renderer.drawText('PRESS S TO START', {
            x: w / 2, y: h - Math.max(48, h * 0.14), size,
            align: 'center', baseline: 'middle',
          });
        }
        return;
      }

      // Level-Auswahl + Engine-Schalter samt Pfeil-Hinweisen: EIN Layout
      // mit dem Demo-Overlay (drawSelector in demoOverlay.js).
      drawSelector(renderer, game);

      if (blinkOn(t)) {
        renderer.drawText('PRESS S TO START', {
          x: w / 2,
          y: h - Math.max(48, h * 0.14),
          size,
          align: 'center',
          baseline: 'middle',
        });
      }

      // Dezenter Hinweis auf die Info-Seite, ganz unten.
      renderer.drawText('I INFO', {
        x: w / 2, y: h - Math.max(20, h * 0.05), size: size * 0.4,
        align: 'center', baseline: 'middle', intensity: 0.5,
      });
    },

    onKey(key) {
      idle = 0; // jede Taste haelt den Attract-Mode fern
      // ... und raeumt Titel/Attract-Warteschleife weg (der Spieler ist da;
      // waehrend der DEMO kommt keine Taste hier an -- game.demoKey schluckt).
      title = false;
      attractWait = false;
      if (phase !== 'orbiting') return;
      if (key === 'I') {
        info = !info;
        return;
      }
      if (key === 'X' && info) {
        info = false; // X = Exit: schliesst auch die Info-Seite
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        // Level waehlen; nur ein ECHTER Wechsel tickt (an den Raendern still).
        // Die Tick-Tonhoehe steigt mit dem Level -- man hoert die Leiter.
        const next = stepLevel(game.level, key === 'ArrowRight' ? +1 : -1);
        if (next !== game.level) {
          game.level = next;
          game.audio?.play(tickPatch((next - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)));
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Engine-Schalter: hoch = 2026, runter = 1980 (wie die Level-Wahl
        // tickt nur ein echter Wechsel -- 2026 hoch, 1980 tief). main.js
        // sieht die Aenderung an game.engine und schaltet live um.
        const next = key === 'ArrowUp' ? ENGINE_2026 : ENGINE_1980;
        if (next !== game.engine) {
          game.engine = next;
          game.audio?.play(tickPatch(next === ENGINE_2026 ? 1 : 0));
        }
      } else if (key === 'S') {
        startDock();
      }
    },

    // Lese-Schnittstelle fuer die 2026-Engine (Stufe 3): Pose auf der Bahn,
    // Phase, Flug-Fortschritt, Kanten-Dimmung und Blend-Farbe -- dieselbe
    // Quelle wie die 1980-Zeichnung (look()). blink steuert "PRESS S",
    // info die "HOW TO PLAY"-Seite, titleT (null = aus) das Titel-Display.
    // infoA = Blende der Info-Seite (2026 zeichnet Opacity damit, 1980
    // schaltet weiter hart auf `info`); hold = Attract-Sequenz laeuft
    // (Titel/Luecke/Info/Fade) -- die Mitte-Texte bleiben verdraengt.
    viewState() {
      const orbiting = phase === 'orbiting';
      return {
        ...look(), t, blink: blinkOn(t),
        info: info && orbiting, infoA,
        hold: attractHold && orbiting,
        titleT: title && orbiting ? titleT : null,
      };
    },
  };
}
