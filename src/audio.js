// Audio procedural de la nave (WebAudio puro, sin archivos ni dependencias).
//
// Uso:
//   const audio = new ShipAudio();
//   window.addEventListener('pointerdown', () => audio.resume(), { once: true });
//   // cada frame:
//   audio.update({ throttle, speed01, boost, cruiseCharge, cruiseActive, turnRate, rcs, atmoDensity,
//                  engineMode, engineTransition, reentry }, dt);
//
// Cada modo de motor suena distinto (src/ship/engines.js):
//   'atmo'    turbina de jet: silbido agudo que sube con el empuje + rugido de ruido (postcombustión con Shift)
//   'impulse' rumor grave del motor principal (osciladores + ruido marrón)
//   'cruise'  drone de supercrucero

const MASTER_LEVEL = 0.5;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (Number.isFinite(v) ? v : 0));

export class ShipAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._prevCruiseActive = false;
    this._t = 0;
    this.n = null; // nodos
  }

  /** Crea (la primera vez) o reanuda el AudioContext. Llamar desde un gesto del usuario. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.n) this._smooth(this.n.master.gain, this.muted ? 0 : MASTER_LEVEL, 0.05);
  }

  // ---------------------------------------------------------------- helpers

  _smooth(param, value, tc = 0.08) {
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  _noiseBuffer(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else { // pink (Paul Kellet)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  _noiseSource(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = buf.duration;
    // arranque en punto aleatorio para que varias fuentes no estén en fase
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  // ------------------------------------------------------------------ grafo

  _build() {
    const ctx = this.ctx;
    const n = (this.n = {});

    // master -> compresor -> salida
    n.master = ctx.createGain();
    n.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -20;
    n.comp.knee.value = 24;
    n.comp.ratio.value = 4;
    n.comp.attack.value = 0.01;
    n.comp.release.value = 0.25;
    n.master.connect(n.comp);
    n.comp.connect(ctx.destination);

    const pink = this._noiseBuffer('pink');
    const brown = this._noiseBuffer('brown');

    // ---- Motor: 3 osciladores + ruido marrón, filtrados pasa-bajos
    n.engGain = ctx.createGain(); n.engGain.gain.value = 0;
    n.engFilter = ctx.createBiquadFilter();
    n.engFilter.type = 'lowpass'; n.engFilter.frequency.value = 300; n.engFilter.Q.value = 0.7;
    n.engFilter.connect(n.engGain); n.engGain.connect(n.master);

    n.engSaw = this._osc('sawtooth', 55);
    n.engSaw2 = this._osc('sawtooth', 55.6);
    n.engTri = this._osc('triangle', 55);
    n.engSub = this._osc('sine', 27.5);
    const mix = (o, g) => { const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(n.engFilter); };
    mix(n.engSaw, 0.18); mix(n.engSaw2, 0.18); mix(n.engTri, 0.3); mix(n.engSub, 0.45);

    const rumble = this._noiseSource(brown);
    const rumbleG = ctx.createGain(); rumbleG.gain.value = 0.5;
    rumble.connect(rumbleG); rumbleG.connect(n.engFilter);

    // ---- Boost: whoosh de ruido rosa con band-pass que sube
    n.boostGain = ctx.createGain(); n.boostGain.gain.value = 0;
    n.boostFilter = ctx.createBiquadFilter();
    n.boostFilter.type = 'bandpass'; n.boostFilter.frequency.value = 300; n.boostFilter.Q.value = 0.6;
    this._noiseSource(pink).connect(n.boostFilter);
    n.boostFilter.connect(n.boostGain); n.boostGain.connect(n.master);
    // tono grave de empuje
    n.boostOsc = this._osc('sawtooth', 70);
    n.boostOscF = ctx.createBiquadFilter(); n.boostOscF.type = 'lowpass'; n.boostOscF.frequency.value = 400;
    n.boostOscG = ctx.createGain(); n.boostOscG.gain.value = 0;
    n.boostOsc.connect(n.boostOscF); n.boostOscF.connect(n.boostOscG); n.boostOscG.connect(n.master);

    // ---- Supercrucero: tono ascendente de carga
    n.chargeGain = ctx.createGain(); n.chargeGain.gain.value = 0;
    n.chargeFilter = ctx.createBiquadFilter();
    n.chargeFilter.type = 'lowpass'; n.chargeFilter.frequency.value = 1500; n.chargeFilter.Q.value = 0.5;
    n.chargeA = this._osc('sine', 110);
    n.chargeB = this._osc('triangle', 110.8);
    const cb = ctx.createGain(); cb.gain.value = 0.5;
    n.chargeA.connect(n.chargeFilter); n.chargeB.connect(cb); cb.connect(n.chargeFilter);
    n.chargeFilter.connect(n.chargeGain); n.chargeGain.connect(n.master);
    // vibrato suave
    n.chargeLfo = this._osc('sine', 5);
    n.chargeLfoG = ctx.createGain(); n.chargeLfoG.gain.value = 3;
    n.chargeLfo.connect(n.chargeLfoG);
    n.chargeLfoG.connect(n.chargeA.frequency); n.chargeLfoG.connect(n.chargeB.frequency);

    // ---- Drone de supercrucero activo
    n.droneGain = ctx.createGain(); n.droneGain.gain.value = 0;
    n.droneFilter = ctx.createBiquadFilter();
    n.droneFilter.type = 'lowpass'; n.droneFilter.frequency.value = 220; n.droneFilter.Q.value = 0.8;
    n.droneA = this._osc('sawtooth', 41.2);
    n.droneB = this._osc('sawtooth', 41.9);
    n.droneC = this._osc('sine', 61.8);
    const dg = ctx.createGain(); dg.gain.value = 0.35;
    n.droneA.connect(dg); n.droneB.connect(dg); dg.connect(n.droneFilter);
    const dc = ctx.createGain(); dc.gain.value = 0.5;
    n.droneC.connect(dc); dc.connect(n.droneFilter);
    const dn = this._noiseSource(brown); const dng = ctx.createGain(); dng.gain.value = 0.4;
    dn.connect(dng); dng.connect(n.droneFilter);
    n.droneFilter.connect(n.droneGain); n.droneGain.connect(n.master);
    // lenta modulación del filtro
    n.droneLfo = this._osc('sine', 0.23);
    n.droneLfoG = ctx.createGain(); n.droneLfoG.gain.value = 40;
    n.droneLfo.connect(n.droneLfoG); n.droneLfoG.connect(n.droneFilter.frequency);

    // ---- RCS: siseo de ruido filtrado
    n.rcsGain = ctx.createGain(); n.rcsGain.gain.value = 0;
    n.rcsFilter = ctx.createBiquadFilter();
    n.rcsFilter.type = 'bandpass'; n.rcsFilter.frequency.value = 1600; n.rcsFilter.Q.value = 0.9;
    const rcsLp = ctx.createBiquadFilter(); rcsLp.type = 'lowpass'; rcsLp.frequency.value = 3500;
    this._noiseSource(pink).connect(n.rcsFilter);
    n.rcsFilter.connect(rcsLp); rcsLp.connect(n.rcsGain); n.rcsGain.connect(n.master);

    // ---- Viento atmosférico
    n.windGain = ctx.createGain(); n.windGain.gain.value = 0;
    n.windFilter = ctx.createBiquadFilter();
    n.windFilter.type = 'bandpass'; n.windFilter.frequency.value = 400; n.windFilter.Q.value = 0.5;
    const windLp = ctx.createBiquadFilter(); windLp.type = 'lowpass'; windLp.frequency.value = 2200;
    this._noiseSource(pink).connect(n.windFilter);
    n.windFilter.connect(windLp); windLp.connect(n.windGain); n.windGain.connect(n.master);

    // ---- Turbina (modo atmosférico): silbido + armónico, filtrados en banda, y rugido de ruido
    n.jetGain = ctx.createGain(); n.jetGain.gain.value = 0;
    n.jetFilter = ctx.createBiquadFilter();
    n.jetFilter.type = 'bandpass'; n.jetFilter.frequency.value = 1200; n.jetFilter.Q.value = 3;
    n.jetA = this._osc('sawtooth', 600);
    n.jetB = this._osc('sine', 1206);
    const ja = ctx.createGain(); ja.gain.value = 0.35; n.jetA.connect(ja); ja.connect(n.jetFilter);
    const jb = ctx.createGain(); jb.gain.value = 0.5; n.jetB.connect(jb); jb.connect(n.jetFilter);
    n.jetFilter.connect(n.jetGain); n.jetGain.connect(n.master);
    n.roarGain = ctx.createGain(); n.roarGain.gain.value = 0;
    n.roarFilter = ctx.createBiquadFilter();
    n.roarFilter.type = 'lowpass'; n.roarFilter.frequency.value = 500; n.roarFilter.Q.value = 0.6;
    this._noiseSource(pink).connect(n.roarFilter);
    const roarLow = this._noiseSource(brown); const rlg = ctx.createGain(); rlg.gain.value = 0.6;
    roarLow.connect(rlg); rlg.connect(n.roarFilter);
    n.roarFilter.connect(n.roarGain); n.roarGain.connect(n.master);

    // pesos de cada modo (se mezclan con suavidad al cambiar)
    n.mode = { atmo: 0, impulse: 1, cruise: 0 };

    n.pink = pink; n.brown = brown;
  }

  // -------------------------------------------------------------- one-shots

  _thump(up) {
    const ctx = this.ctx, n = this.n, t = ctx.currentTime;
    // golpe grave: seno que cae en frecuencia
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    const f0 = up ? 110 : 70, f1 = up ? 32 : 45;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(up ? 0.9 : 0.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (up ? 0.9 : 0.6));
    o.connect(g); g.connect(n.master);
    o.start(t); o.stop(t + 1.0);

    // ráfaga de ruido que se cierra
    const s = ctx.createBufferSource(); s.buffer = n.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(up ? 1800 : 900, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(up ? 0.9 : 0.4, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    s.connect(f); f.connect(ng); ng.connect(n.master);
    s.start(t, Math.random() * 2); s.stop(t + 0.9);
  }

  // ----------------------------------------------------------------- update

  update(state, dt) {
    if (!this.ctx || !this.n || this.ctx.state !== 'running') return;
    const n = this.n;
    this._t += dt || 0;

    const throttle = clamp01(state.throttle);
    const speed = clamp01(state.speed01);
    const boost = clamp01(state.boost);
    const charge = clamp01(state.cruiseCharge);
    const active = !!state.cruiseActive;
    const turn = clamp01(state.turnRate);
    const rcs = clamp01(state.rcs);
    const atmo = clamp01(state.atmoDensity);
    const heat = clamp01(state.reentry);
    const spool = state.engineTransition === undefined ? 1 : clamp01(state.engineTransition);

    // pesos de cada modo, con crossfade de ~0,4 s
    const em = state.engineMode || (active ? 'cruise' : 'impulse');
    const w = n.mode;
    const k = 1 - Math.exp(-(dt || 0.016) / 0.35);
    for (const m of ['atmo', 'impulse', 'cruise']) w[m] += ((em === m ? 1 : 0) - w[m]) * k;
    const lvl = 0.35 + 0.65 * spool;  // el motor nuevo entra con su spool-up

    // Turbina: el silbido sigue al acelerador con retraso (inercia del rotor)
    const drive0 = Math.max(throttle, speed * 0.6);
    const jf = 420 + drive0 * 900 + boost * 250;
    this._smooth(n.jetA.frequency, jf * (0.6 + 0.4 * spool), 0.5);
    this._smooth(n.jetB.frequency, jf * 2.01 * (0.6 + 0.4 * spool), 0.5);
    this._smooth(n.jetFilter.frequency, jf * 1.9, 0.5);
    this._smooth(n.jetGain.gain, w.atmo * lvl * (0.05 + drive0 * 0.1), 0.15);
    this._smooth(n.roarFilter.frequency, 300 + drive0 * 1400 + boost * 1500, 0.2);
    this._smooth(n.roarGain.gain, w.atmo * lvl * (0.06 + drive0 * 0.25 + boost * 0.3) + heat * 0.5, 0.15);

    // Motor
    const drive = Math.max(throttle, speed * 0.6);
    // en impulso suena más grave y pesado; en atmósfera queda de fondo bajo la turbina
    const pitch = (52 + throttle * 38 + speed * 60 + boost * 30 + (active ? 15 : 0)) * (1 - 0.18 * w.impulse);
    this._smooth(n.engSaw.frequency, pitch, 0.12);
    this._smooth(n.engSaw2.frequency, pitch * 1.006, 0.12);
    this._smooth(n.engTri.frequency, pitch, 0.12);
    this._smooth(n.engSub.frequency, pitch * 0.5, 0.12);
    this._smooth(n.engFilter.frequency, 220 + drive * 650 + boost * 500 + turn * 120, 0.15);
    const engVol = (0.1 + drive * 0.28 + boost * 0.08) * (active ? 0.6 : 1) *
      (w.impulse * lvl * 1.15 + w.atmo * 0.3 + w.cruise * 0.8);
    this._smooth(n.engGain.gain, engVol, 0.15);

    // Boost
    this._smooth(n.boostGain.gain, boost * 0.32, 0.12);
    this._smooth(n.boostFilter.frequency, 250 + boost * 1300, 0.15);
    this._smooth(n.boostOsc.frequency, 60 + boost * 40, 0.15);
    this._smooth(n.boostOscG.gain, boost * 0.12, 0.12);

    // Carga de supercrucero (se apaga al activarse)
    const chargeOn = active ? 0 : charge;
    const cf = 110 * Math.pow(8, charge); // 110 -> 880 Hz
    this._smooth(n.chargeA.frequency, cf, 0.06);
    this._smooth(n.chargeB.frequency, cf * 1.007, 0.06);
    this._smooth(n.chargeFilter.frequency, 600 + charge * 1800, 0.1);
    this._smooth(n.chargeGain.gain, chargeOn * chargeOn * 0.16, active ? 0.05 : 0.1);
    this._smooth(n.chargeLfoG.gain, 2 + charge * 10, 0.2);

    // Thump al encender / apagar
    if (active !== this._prevCruiseActive) {
      this._thump(active);
      this._prevCruiseActive = active;
    }

    // Drone continuo
    this._smooth(n.droneGain.gain, active ? 0.3 : 0, active ? 0.4 : 0.25);

    // RCS: siseo con ligero parpadeo para que suene a ráfagas
    const flutter = 0.75 + 0.25 * Math.sin(this._t * 31) * Math.sin(this._t * 17.3);
    this._smooth(n.rcsGain.gain, rcs * 0.2 * flutter, 0.025);
    this._smooth(n.rcsFilter.frequency, 1300 + rcs * 900, 0.05);

    // Viento
    const wind = Math.min(1, atmo * speed + heat);
    this._smooth(n.windGain.gain, wind * 0.55, 0.2);
    this._smooth(n.windFilter.frequency, 250 + wind * 1100, 0.25);
    this._smooth(n.windFilter.Q,0.4 + wind * 0.5, 0.3);
  }
}
