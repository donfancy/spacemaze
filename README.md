# SPACE MAZE

Ein 3D-Vektorlabyrinth im Browser, im Stil der frühen 80er-Atari-Arcade-Automaten
(Battlezone, Tempest, Star Wars) — grüner Phosphor-Look, alles nur Linien.
Plain Vanilla JavaScript, 2D-Canvas, selbstgerechnetes 3D.

## Starten

```bash
node server.js        # oder: npm start
```

Dann im Browser öffnen:

- Spiel:       http://localhost:3001/
- Debug-Modus: http://localhost:3001/?debug

Der Dev-Server (Port 3001) ist ein winziger statischer Datei-Server ohne
Abhängigkeiten und lädt die ES-Module direkt — kein Build-Schritt nötig.

## Tests

```bash
npm test
```

Nutzt den eingebauten `node:test`-Runner (keine externen Dependencies).

## Steuerung (aktueller Stand)

- `S` — Spiel starten (im Startbildschirm)
- `Q` — zurück zum Startbildschirm (im Spiel)

## Architektur

Strikte Trennung **Berechnung ↔ Rendering**, damit alles Rechnerische headless
testbar ist und Refactoring sicher bleibt:

```
src/
  math/
    vec3.js        Vektor-Mathematik (rein, getestet)
    camera.js      6-DOF-Kamera, worldToView (rein, getestet)
  render/
    projection.js  3D→2D-Projektion + Near-Clipping (rein, getestet)
    glyphs.js      eckiger Monospace-Vektorfont als Liniendaten (getestet)
    vectorText.js  Text-Layout → Polylinien in Pixeln (rein, getestet)
    renderer.js    EINZIGER Canvas-berührender Teil (Phosphor-Glow)
  world/
    shapes.js      Welt-Geometrie-Erzeuger: Würfel, Gitter (rein, getestet)
  core/
    states.js      Zustands-Automat als reine Funktion (getestet)
    game.js        Orchestrierung + animierte Übergänge
  scenes/
    startscreen.js / mazegen.js / playing.js   die einzelnen Zustände
  debug/
    debugConsole.js  Live-Werte + Log (per ?debug eingeblendet)
  main.js          Browser-Entry: Canvas, Eingabe, requestAnimationFrame-Loop

test/              node:test Unit- & Integrationstests
server.js          statischer Dev-Server (Port 3001)
public/            index.html + style.css
```

### Grundkonzept

Jeder Zustand hat (a) eine 3D-Szene, die durch die 6-DOF-Kamera projiziert wird,
und (b) ein **fixes 2D-Text-Overlay** (kameraunabhängig). Gerendert wird immer
voll: Canvas löschen, alles neu zeichnen, im `requestAnimationFrame`-Takt.

Zustände: `STARTSCREEN → MAZE_GEN → PLAYING → STARTSCREEN`, Übergänge als Fade.

## Deployment (später)

Für den Cloud-Server bündeln wir alle Module + HTML zu einer einzigen
`.html`-Datei. Bis dahin entwickeln wir modular über den Dev-Server.
