// Schlichte Debug-Konsole: haelt Live-Werte (stats) und die letzten Log-Zeilen.
// Reine Datenhaltung -> testbar; die Darstellung uebernimmt main.js via Renderer.

export class DebugConsole {
  constructor(maxLogLines = 6) {
    this.maxLogLines = maxLogLines;
    this.stats = new Map();   // geordnete Schluessel-Wert-Paare
    this.logLines = [];
  }

  // Live-Wert setzen (erscheint immer, Reihenfolge = Einfuegereihenfolge).
  set(key, value) {
    this.stats.set(key, value);
  }

  // Einzeiligen Log-Eintrag anhaengen (Ringpuffer der letzten N Zeilen).
  log(message) {
    this.logLines.push(String(message));
    while (this.logLines.length > this.maxLogLines) {
      this.logLines.shift();
    }
  }

  // Alle anzuzeigenden Zeilen (Stats zuerst, dann Logs), bereits formatiert.
  lines() {
    const out = [];
    for (const [k, v] of this.stats) out.push(`${k}: ${v}`);
    for (const l of this.logLines) out.push(l);
    return out;
  }
}
