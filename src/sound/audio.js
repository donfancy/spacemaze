// Sound-Ausgabe: der EINZIGE Teil, der die Web Audio API anfasst (analog zu
// renderer.js beim Canvas). Baut aus reinen Patch-Daten (sound/patches.js)
// die Audio-Knoten und haelt die drei stehenden Motor-Stimmen.
//
// Browser-Falle (Autoplay-Policy): der AudioContext darf erst nach einer
// User-Geste laufen -- unlock() wird bei jedem Tastendruck aufgerufen und
// erzeugt/weckt den Context lazy. Vorher sind play()/engine() stumme No-Ops.

const ENGINE_TAU = 0.08; // s: Nachfuehr-Zeitkonstante der Motor-Parameter (zipperfrei)

export function createAudioOutput() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let engineNodes = null;
  let muted = false;

  function ensure() {
    if (ctx) return;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return; // kein Web Audio: dauerhaft stumm, aber funktionsfaehig
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }

  function ready() {
    return !!ctx && ctx.state === 'running';
  }

  // 1 s weisses Rauschen, geloopt -- eine Quelle fuer alle Rausch-Stimmen.
  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Huellkurve [[t, wert]...] auf einen AudioParam legen (linear interpoliert).
  function applyEnvelope(param, points, t0) {
    param.setValueAtTime(points[0][1], t0 + points[0][0]);
    for (let i = 1; i < points.length; i++) {
      param.linearRampToValueAtTime(points[i][1], t0 + points[i][0]);
    }
  }

  // Einen Ereignis-Patch abspielen: pro Stimme Quelle (+ Filter) + Huellkurve,
  // raeumt sich nach Patch-Dauer selbst auf.
  function play(patch) {
    if (!ready()) return;
    const t0 = ctx.currentTime;
    for (const v of patch.voices) {
      let src;
      if (v.type === 'noise') {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer();
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        src.type = v.shape;
        applyEnvelope(src.frequency, v.freq, t0);
      }
      let node = src;
      if (v.filter) {
        const f = ctx.createBiquadFilter();
        f.type = v.filter.type;
        if (v.filter.q) f.Q.value = v.filter.q;
        applyEnvelope(f.frequency, v.filter.freq, t0);
        node = node.connect(f);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0); // Patch-Invariante: Huellkurve beginnt bei 0
      for (const [t, val] of v.gain) g.gain.linearRampToValueAtTime(val, t0 + t);
      node.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + patch.duration);
      src.onended = () => g.disconnect();
    }
  }

  // Die drei stehenden Motor-Stimmen (laufen dauerhaft, Gain 0 = still).
  function ensureEngine() {
    if (engineNodes) return;
    const motorOsc = ctx.createOscillator();
    motorOsc.type = 'triangle';
    motorOsc.frequency.value = 40;
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0;
    motorOsc.connect(motorGain).connect(master);
    motorOsc.start();

    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = noiseBuffer();
    rumbleSrc.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 150;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(master);
    rumbleSrc.start();

    const whineOsc = ctx.createOscillator();
    whineOsc.type = 'triangle';
    whineOsc.frequency.value = 200;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whineOsc.connect(whineGain).connect(master);
    whineOsc.start();

    engineNodes = { motorOsc, motorGain, rumbleFilter, rumbleGain, whineOsc, whineGain };
  }

  // Motor-Parameter nachfuehren (engineParams aus patches.js); null = ausblenden.
  // Wird pro Frame aufgerufen -- setTargetAtTime glaettet die Uebergaenge.
  function engine(params) {
    if (!ready()) return;
    const t = ctx.currentTime;
    if (!params) {
      if (!engineNodes) return;
      for (const g of [engineNodes.motorGain, engineNodes.rumbleGain, engineNodes.whineGain]) {
        g.gain.setTargetAtTime(0, t, ENGINE_TAU);
      }
      return;
    }
    ensureEngine();
    const n = engineNodes;
    n.motorOsc.type = params.motor.shape;
    n.motorOsc.frequency.setTargetAtTime(params.motor.freq, t, ENGINE_TAU);
    n.motorGain.gain.setTargetAtTime(params.motor.gain, t, ENGINE_TAU);
    n.rumbleFilter.frequency.setTargetAtTime(params.rumble.cutoff, t, ENGINE_TAU);
    n.rumbleGain.gain.setTargetAtTime(params.rumble.gain, t, ENGINE_TAU);
    n.whineOsc.frequency.setTargetAtTime(params.whine.freq, t, ENGINE_TAU);
    n.whineGain.gain.setTargetAtTime(params.whine.gain, t, ENGINE_TAU);
  }

  // Bei jeder User-Geste aufrufen: erzeugt/weckt den Context (Autoplay-Policy).
  function unlock() {
    ensure();
    if (ctx && ctx.state !== 'running') ctx.resume();
  }

  function toggleMuted() {
    muted = !muted;
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
    return muted;
  }

  return { unlock, play, engine, toggleMuted, get muted() { return muted; } };
}
