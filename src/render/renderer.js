// Der EINZIGE Teil der Engine, der das 2D-Canvas anfasst. Alles 3D-/Layout-Rechnen
// passiert in den reinen Modulen (math/, projection, vectorText) und wird hier nur
// noch als Linien gezeichnet -- im gruenen Phosphor-Look mit Glow.

import { worldToView } from '../math/camera.js';
import { project, clipNear } from './projection.js';
import { layoutText } from './vectorText.js';

const PHOSPHOR = '#4dff7a';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.color = PHOSPHOR;
    this.glow = 8;       // shadowBlur in CSS-Pixeln
    this.near = 0.1;
  }

  // Setzt Canvas-Aufloesung passend zu CSS-Groesse und Pixeldichte (scharfe Linien).
  resize(cssWidth, cssHeight, dpr = 1) {
    this.dpr = dpr;
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // Bildschirm komplett loeschen (Full-Redraw-Ansatz).
  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // Bildraum-Schwenk (siehe render/sway.js): dreht/verschiebt alles bis popSway
  // um die Bildmitte -- fuer Kurvenneigung und Kollisions-Schwingungen, ohne die
  // (horizontale) 3D-Kamera anzutasten. Immer mit popSway paaren.
  pushSway({ angle = 0, dy = 0 } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(angle);
    ctx.translate(-this.width / 2, -this.height / 2 + dy);
  }

  popSway() {
    this.ctx.restore();
  }

  // Schwarzes Overlay mit gegebener Deckkraft -- fuer Fade-Uebergaenge.
  fillBlack(alpha) {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  // Zeichnet eine Liste von Polylinien (Bildschirm-Pixelkoordinaten) in einem Zug.
  drawPolylines(polylines, opts = {}) {
    const ctx = this.ctx;
    const color = opts.color ?? this.color;
    ctx.save();
    ctx.globalAlpha = opts.intensity ?? 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.lineWidth ?? 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = opts.glow ?? this.glow;
    ctx.beginPath();
    for (const poly of polylines) {
      if (!poly || poly.length < 2) continue;
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Zeichnet Text als Vektorlinien (fixes 2D-Overlay, unabhaengig von der Kamera).
  // opts: x, y, size, align, baseline, tracking, lineGap, angle, intensity, color, glow, lineWidth
  drawText(text, opts = {}) {
    const polylines = layoutText(text, opts);
    this.drawPolylines(polylines, opts);
  }

  // Projiziert eine 3D-Szene durch die Kamera und zeichnet sie als Drahtgitter.
  // scene.segments: Array von [aWorld, bWorld] Liniensegmenten.
  // opts.near: Near-Plane-Override -- WICHTIG fuer Geometrie nah am Auge (z.B.
  // Kollisionswellen auf der Wand direkt vor der Kamera): die Near-Plane muss
  // wie ueberall mit der Zellgroesse skalieren, sonst clippt der Standardwert
  // die Linien weg.
  renderScene(scene, camera, opts = {}) {
    const near = opts.near ?? this.near;
    const viewport = {
      width: this.width,
      height: this.height,
      fov: camera.fov,
      near,
    };
    const polylines = [];
    for (const seg of scene.segments) {
      const va = worldToView(camera, seg[0]);
      const vb = worldToView(camera, seg[1]);
      const clipped = clipNear(va, vb, near);
      if (!clipped) continue;
      const pa = project(clipped[0], viewport);
      const pb = project(clipped[1], viewport);
      if (!pa || !pb) continue;
      polylines.push([[pa.x, pa.y], [pb.x, pb.y]]);
    }
    this.drawPolylines(polylines, {
      intensity: scene.intensity ?? opts.intensity ?? 1,
      lineWidth: opts.lineWidth ?? 2,
      color: opts.color ?? this.color,
      glow: opts.glow ?? this.glow,
    });
  }

  // Projiziert einen Weltpunkt auf Bildschirm-Pixel ({x,y}) oder null, wenn er
  // hinter der Near-Plane liegt. Nuetzlich, um 2D-Marker an 3D-Positionen zu setzen.
  worldToScreen(worldPoint, camera) {
    const v = worldToView(camera, worldPoint);
    return project(v, { width: this.width, height: this.height, fov: camera.fov, near: this.near });
  }
}
