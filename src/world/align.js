// Lenk-Assistent "AUSRICHTEN" (Pfeil runter im Fahrt-Modus, ab Level 6):
// solange gehalten, lenkt er das Schiff weich auf die MITTE des GANG-ENDES
// in Blickrichtung -- wer seitlich versetzt fliegt, bekommt dadurch einen
// leichten Schraegkurs zur Gangmitte hin und hoert auf, von Wand zu Wand zu
// federn (Boris' Spec, 30.8.2026). Er liefert nur eine LENK-EINGABE in
// [-1,1]; Rampen und Drehrate macht driveStep wie bei Handarbeit -- der
// Assistent kann also nichts, was der Spieler nicht auch koennte.
//
// "Ungefaehr in die richtige Richtung": massgeblich ist die naechstgelegene
// Achsen-Richtung zur Blickrichtung (immer <= 45 Grad entfernt). Fuehrt sie
// direkt in eine Wand (quer zum Gang unterwegs), greift der Assistent NICHT
// (null). Reine Berechnung, kein Canvas -> headless testbar.

import { isOpenCell } from './maze.js';
import { cellAt, cellCenter } from './mazeWorld.js';
import { shortestRoll } from './gyro.js';

export const ALIGN = {
  soft: 0.35,   // rad: darunter lenkt der Assistent proportional statt voll
                // (weiches Einschwenken ohne Ueberschiessen)
  minDist: 0.6, // Gangbreiten: dichter am Zielpunkt greift er nicht mehr
                // (sonst schlaegt der Zielwinkel auf den letzten Zentimetern um)
};

// Lenk-Eingabe des Assistenten oder null (keine sinnvolle Ausricht-Lage).
// pose = {px,pz,yaw}, opts = { unit, cell } wie ueberall.
export function alignTurn(maze, pose, { unit, cell }) {
  // Naechstgelegene Achsen-Richtung zur Blickrichtung (Vorwaerts-Konvention
  // forward = (-sin yaw, -cos yaw); yaw akkumuliert frei, Rundung aufs
  // 90-Grad-Raster braucht kein Modulo).
  const snapYaw = Math.round(pose.yaw / (Math.PI / 2)) * (Math.PI / 2);
  const sx = Math.round(-Math.sin(snapYaw));
  const sy = Math.round(-Math.cos(snapYaw));
  // Dem Gang Zelle fuer Zelle folgen, bis eine Wand kommt: die letzte offene
  // Zelle ist das Gangende (der Rand des Labyrinths ist immer Wand).
  const [gx, gy] = cellAt(maze, pose.px, pose.pz, unit);
  let ex = gx, ey = gy;
  while (isOpenCell(maze, ex + sx, ey + sy)) { ex += sx; ey += sy; }
  if (ex === gx && ey === gy) return null; // Wand direkt voraus: quer im Gang
  const [tx, tz] = cellCenter(maze, ex, ey, unit);
  const dx = tx - pose.px;
  const dz = tz - pose.pz;
  if (Math.hypot(dx, dz) < ALIGN.minDist * cell) return null; // schon dort
  const diff = shortestRoll(Math.atan2(-dx, -dz) - pose.yaw);
  return Math.max(-1, Math.min(1, diff / ALIGN.soft));
}
