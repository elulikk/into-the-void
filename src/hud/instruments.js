// Instrumentos fluidos (se dibujan en un canvas 2D cada cuadro): horizonte artificial,
// escalera de cabeceo conforme, cintas de velocidad y altitud, brújula y arcos.
// Un estilo por función: sci-fi, aviónica y minimalista.
const RAD = Math.PI / 180;
const wrap360 = a => ((a % 360) + 360) % 360;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
const nf = (v, d = 0) => v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d });

const PALETTE = {
  scifi: { main: '111,211,255', warn: '255,179,92', crit: '255,90,80', font: '600 11px "JetBrains Mono", monospace' },
  avionics: { main: '120,255,150', warn: '255,220,90', crit: '255,90,80', font: '600 12px "JetBrains Mono", monospace' },
  minimal: { main: '235,242,250', warn: '255,190,110', crit: '255,100,90', font: '400 11px "JetBrains Mono", monospace' },
};

// paso "lindo" (1, 2, 5 × 10ⁿ) para que el rango de una cinta quede en ~n divisiones
function niceStep(span, n = 8) {
  const raw = span / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export class Instruments {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.time = 0;
  }

  resize() {
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const w = innerWidth, h = innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
  }

  draw(style, t, extra, dt) {
    this.resize();
    this.time += dt;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this.pal = PALETTE[style];
    c.font = this.pal.font;
    c.lineCap = 'round';
    if (style === 'scifi') this.drawSciFi(t, extra);
    else if (style === 'avionics') this.drawAvionics(t, extra);
    else this.drawMinimal(t, extra);
  }

  col(a = 1, which = 'main') { return `rgba(${this.pal[which]},${a})`; }

  // píxeles por radián (focal de la cámara)
  focal(fov) { return (this.h / 2) / Math.tan(fov * RAD / 2); }

  // ¿tiene sentido un horizonte? (cerca de un cuerpo)
  nearBody(t) { const b = t.env.body; return b && b.id !== 'sun' && t.flight.alt < b.R * 6; }

  // ---------------------------------------------------------------- escalera de cabeceo conforme
  pitchLadder(t, { spanX, step = 10, clipH, labels = true, dip = true }) {
    const c = this.ctx, cam = t.cam;
    const f = this.focal(cam.fov);
    const cx = this.w / 2, cy = this.h / 2;
    c.save();
    c.beginPath();
    c.rect(cx - spanX * 1.3, cy - clipH / 2, spanX * 2.6, clipH);
    c.clip();
    c.translate(cx, cy);
    c.rotate(-cam.roll * RAD);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let p = -90; p <= 90; p += step / 2) {
      const d = cam.pitch - p;
      if (Math.abs(d) > 70) continue;
      const y = f * Math.tan(d * RAD);
      if (Math.abs(y) > clipH * 0.75) continue;
      const major = p % step === 0;
      if (p === 0) {
        c.strokeStyle = this.col(0.95); c.lineWidth = 2;
        c.beginPath(); c.moveTo(-spanX * 1.25, y); c.lineTo(-spanX * 0.18, y);
        c.moveTo(spanX * 0.18, y); c.lineTo(spanX * 1.25, y); c.stroke();
        continue;
      }
      const half = major ? spanX * 0.5 : spanX * 0.22, gap = spanX * 0.14;
      c.strokeStyle = this.col(major ? 0.85 : 0.45); c.lineWidth = major ? 1.5 : 1;
      c.setLineDash(p < 0 ? [6, 5] : []);
      const tick = p > 0 ? 7 : -7;
      c.beginPath();
      c.moveTo(-half, y + (major ? tick : 0)); c.lineTo(-half, y); c.lineTo(-gap, y);
      c.moveTo(gap, y); c.lineTo(half, y); c.lineTo(half, y + (major ? tick : 0));
      c.stroke();
      c.setLineDash([]);
      if (major && labels) {
        c.fillStyle = this.col(0.85);
        c.textAlign = 'right'; c.fillText(Math.abs(p), -half - 6, y);
        c.textAlign = 'left'; c.fillText(Math.abs(p), half + 6, y);
      }
    }
    // horizonte visible (más abajo que el horizontal por la curvatura): depresión = acos(R/(R+h))
    const b = t.env.body;
    if (dip && b && b.id !== 'sun' && t.flight.alt > 500) {
      const dp = -Math.acos(Math.min(1, b.R / (b.R + t.flight.alt))) / RAD;
      const d = cam.pitch - dp;
      if (Math.abs(d) < 70) {
        const y = f * Math.tan(d * RAD);
        c.strokeStyle = this.col(0.35); c.setLineDash([2, 6]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(-spanX * 1.2, y); c.lineTo(spanX * 1.2, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = this.col(0.5); c.textAlign = 'left';
        c.fillText(`HZ −${nf(-dp, 1)}°`, spanX * 0.62, y - 9);
      }
    }
    c.restore();
  }

  // ---------------------------------------------------------------- cinta de rumbo
  headingTape(t, extra, { y, width, ppd, boxed = true }) {
    const c = this.ctx;
    const cx = this.w / 2;
    const hd = t.flight.heading;
    c.save();
    const g = c.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
    g.addColorStop(0, this.col(0)); g.addColorStop(0.15, this.col(0.9));
    g.addColorStop(0.85, this.col(0.9)); g.addColorStop(1, this.col(0));
    c.strokeStyle = g; c.fillStyle = g; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    const range = width / 2 / ppd;
    c.beginPath(); c.moveTo(cx - width / 2, y); c.lineTo(cx + width / 2, y); c.stroke();
    for (let a = Math.ceil((hd - range) / 5) * 5; a <= hd + range; a += 5) {
      const x = cx + (a - hd) * ppd;
      const A = wrap360(a);
      const major = A % 10 === 0;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - (major ? 8 : 4)); c.stroke();
      if (A % 30 === 0 || CARD[A]) c.fillText(CARD[A] ?? String(A / 10).padStart(2, '0'), x, y - 10);
    }
    // marca del objetivo
    if (extra.targetBearing != null) {
      const d = angDiff(extra.targetBearing, hd);
      const x = cx + THREE_clamp(d, -range, range) * ppd;
      c.fillStyle = this.col(Math.abs(d) > range ? 0.5 : 1, 'warn');
      c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x - 5, y + 10); c.lineTo(x + 5, y + 10); c.closePath(); c.fill();
    }
    c.fillStyle = this.col(1); c.strokeStyle = this.col(1);
    if (boxed) {
      c.lineWidth = 1.2;
      c.beginPath(); c.rect(cx - 24, y + 4, 48, 18); c.stroke();
      c.textBaseline = 'middle';
      c.fillText(String(Math.round(hd) % 360).padStart(3, '0') + '°', cx, y + 13.5);
    } else {
      c.beginPath(); c.moveTo(cx, y + 2); c.lineTo(cx - 4, y + 9); c.lineTo(cx + 4, y + 9); c.closePath(); c.fill();
    }
    c.restore();
  }

  // ---------------------------------------------------------------- cinta vertical (velocidad / altitud)
  tape(x, value, { height, side, unit, minSpan, fmt, label, bug }) {
    const c = this.ctx;
    const cy = this.h / 2;
    const span = Math.max(minSpan, Math.abs(value) * 0.6);
    const step = niceStep(span);
    const ppu = height / span;
    c.save();
    c.beginPath(); c.rect(x - 70, cy - height / 2, 140, height); c.clip();
    c.strokeStyle = this.col(0.8); c.fillStyle = this.col(0.85); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, cy - height / 2); c.lineTo(x, cy + height / 2); c.stroke();
    c.textBaseline = 'middle';
    c.textAlign = side < 0 ? 'right' : 'left';
    const start = Math.floor((value - span / 2) / step) * step;
    for (let v = start; v <= value + span / 2 + step; v += step / 2) {
      const y = cy - (v - value) * ppu;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + side * (major ? 12 : 6), y); c.stroke();
      if (major) c.fillText(fmt(v), x + side * 16, y);
    }
    if (bug != null) {
      const y = cy - (bug.value - value) * ppu;
      if (Math.abs(y - cy) < height / 2) {
        c.strokeStyle = this.col(0.9, 'warn'); c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - side * 2, y - 6); c.lineTo(x + side * 6, y); c.lineTo(x - side * 2, y + 6); c.stroke();
        c.fillStyle = this.col(0.9, 'warn'); c.fillText(bug.label, x + side * 16, y - 12);
      }
    }
    c.restore();
    // ventana con el valor actual
    c.save();
    c.fillStyle = 'rgba(0,10,4,0.75)'; c.strokeStyle = this.col(1); c.lineWidth = 1.5;
    const bw = 92, bx = side < 0 ? x - bw - 4 : x + 4;
    c.beginPath(); c.rect(bx, cy - 13, bw, 26); c.fill(); c.stroke();
    c.font = '600 15px "JetBrains Mono", monospace';
    c.fillStyle = this.col(1); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(fmt(value, true), bx + bw / 2, cy + 1);
    c.font = this.pal.font;
    c.fillStyle = this.col(0.75);
    c.fillText(`${label} ${unit}`, bx + bw / 2, cy - height / 2 - 12);
    c.restore();
  }

  // indicador de velocidad vertical (escala logarítmica)
  vsi(x, vs, height) {
    const c = this.ctx, cy = this.h / 2;
    const k = v => Math.sign(v) * Math.min(1, Math.log10(1 + Math.abs(v)) / 4); // ±10 km/s a tope
    c.save();
    c.strokeStyle = this.col(0.5); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, cy - height / 2); c.lineTo(x, cy + height / 2); c.stroke();
    for (const v of [-1000, -100, -10, 0, 10, 100, 1000]) {
      const y = cy - k(v) * height / 2;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (v === 0 ? 8 : 4), y); c.stroke();
    }
    const y = cy - k(vs) * height / 2;
    c.strokeStyle = this.col(1, Math.abs(vs) > 300 && vs < 0 ? 'warn' : 'main'); c.lineWidth = 3;
    c.beginPath(); c.moveTo(x + 2, cy); c.lineTo(x + 2, y); c.stroke();
    c.fillStyle = this.col(0.9); c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`${vs >= 0 ? '+' : '−'}${fmtVS(Math.abs(vs))}`, x + 10, y);
    c.restore();
  }

  // ================================================================ AVIÓNICA
  drawAvionics(t, extra) {
    const { w, h } = this;
    const near = this.nearBody(t);
    if (near) this.pitchLadder(t, { spanX: Math.min(170, w * 0.12), clipH: h * 0.62 });
    this.headingTape(t, extra, { y: 132, width: Math.min(520, w * 0.42), ppd: Math.min(5, w / 300) });
    const tx = Math.max(220, w * 0.25);
    const th = Math.min(420, h * 0.5);
    const kmh = t.flight.speed * 3.6;
    this.tape(w / 2 - tx, kmh, {
      height: th, side: -1, unit: 'km/h', label: 'VEL', minSpan: 400,
      fmt: (v, big) => nf(Math.round(v)),
      bug: t.orbit.body.id !== 'sun' ? { value: t.orbit.vCirc * 3.6, label: 'ORB' } : null,
    });
    const alt = t.flight.alt;
    this.tape(w / 2 + tx, alt, {
      height: th, side: 1, unit: alt >= 1e4 ? 'km' : 'm', label: 'ALT', minSpan: 400,
      fmt: (v, big) => (Math.abs(alt) >= 1e4 ? nf(v / 1000, big ? 1 : 0) : nf(Math.round(v))),
    });
    this.vsi(w / 2 + tx + 104, t.flight.vs, th * 0.7);
    // Mach y G bajo la cinta de velocidad
    const c = this.ctx;
    c.fillStyle = this.col(0.95); c.textAlign = 'right'; c.textBaseline = 'top';
    const y0 = h / 2 + th / 2 + 10;
    c.fillText(t.flight.mach != null ? `M ${nf(t.flight.mach, 2)}` : 'M —', w / 2 - tx - 4, y0);
    c.fillText(t.flight.dampened ? 'G amort.' : `G ${nf(t.flight.gTotal, 1)}`, w / 2 - tx - 4, y0 + 16);
    c.textAlign = 'left';
    c.fillText(`CAB ${nf(t.flight.pitch, 0)}°  ALB ${nf(t.flight.roll, 0)}°`, w / 2 + tx + 4, y0);
  }

  // ================================================================ SCI-FI
  drawSciFi(t, extra) {
    const c = this.ctx, { w, h } = this;
    const cx = w / 2, cy = h / 2;
    this.headingTape(t, extra, { y: 128, width: Math.min(560, w * 0.4), ppd: Math.min(4, w / 360), boxed: false });
    c.fillStyle = this.col(1); c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText(String(Math.round(t.flight.heading) % 360).padStart(3, '0') + '°', cx, 141);

    // arcos alrededor del retículo: acelerador (izq.) y velocidad / máx. (der.)
    const R = Math.min(130, h * 0.16);
    const arc = (a0, a1, frac, a = 0.9, which = 'main', lw = 3) => {
      c.strokeStyle = this.col(0.14); c.lineWidth = lw;
      c.beginPath(); c.arc(cx, cy, R, a0, a1, a1 < a0); c.stroke();
      c.strokeStyle = this.col(a, which);
      c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, frac)), a1 < a0); c.stroke();
    };
    const thr = extra.throttle;
    arc(Math.PI * 0.72, Math.PI * 1.28, Math.abs(thr), 0.9, thr < 0 ? 'warn' : 'main');
    arc(Math.PI * 0.28, -Math.PI * 0.28, extra.speed01, 0.9, extra.cruise === 'on' ? 'warn' : 'main');
    c.fillStyle = this.col(0.7); c.textBaseline = 'middle';
    c.textAlign = 'right'; c.fillText(`${Math.round(thr * 100)}%`, cx - R - 10, cy);
    c.textAlign = 'left'; c.fillText(t.flight.dampened ? 'G —' : `${nf(t.flight.gTotal, 1)} G`, cx + R + 10, cy);
    // anillo punteado que gira despacio
    c.save();
    c.translate(cx, cy); c.rotate(this.time * 0.15);
    c.strokeStyle = this.col(0.16); c.lineWidth = 1; c.setLineDash([2, 10]);
    c.beginPath(); c.arc(0, 0, R + 14, 0, Math.PI * 2); c.stroke();
    c.restore();

    // marcas de horizonte conformes a los costados
    if (this.nearBody(t)) {
      const cam = t.cam, f = this.focal(cam.fov);
      const d = cam.pitch;
      if (Math.abs(d) < 70) {
        const y = f * Math.tan(d * RAD);
        c.save(); c.translate(cx, cy); c.rotate(-cam.roll * RAD);
        c.strokeStyle = this.col(0.75); c.lineWidth = 1.5;
        const x0 = R + 40, x1 = R + 110;
        c.beginPath(); c.moveTo(-x1, y); c.lineTo(-x0, y); c.lineTo(-x0 + 8, y + 6);
        c.moveTo(x1, y); c.lineTo(x0, y); c.lineTo(x0 - 8, y + 6); c.stroke();
        c.restore();
      }
    }

    // horizonte artificial (esfera) abajo al centro, con la actitud de la nave
    const ar = Math.min(64, h * 0.085);
    const ax = cx, ay = h - ar - 104;
    c.save();
    c.beginPath(); c.arc(ax, ay, ar, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(8,14,22,0.55)'; c.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
    c.translate(ax, ay); c.rotate(-t.flight.roll * RAD);
    const ppd = ar / 40;
    const hy = t.flight.pitch * ppd;
    c.fillStyle = this.col(0.12); c.fillRect(-ar * 2, -ar * 2, ar * 4, ar * 2 + hy);           // cielo
    c.fillStyle = 'rgba(255,179,92,0.10)'; c.fillRect(-ar * 2, hy, ar * 4, ar * 2);             // suelo
    c.strokeStyle = this.col(0.95); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-ar * 2, hy); c.lineTo(ar * 2, hy); c.stroke();
    c.lineWidth = 1; c.fillStyle = this.col(0.6); c.textAlign = 'left'; c.textBaseline = 'middle';
    for (let p = -80; p <= 80; p += 10) {
      if (!p) continue;
      const y = hy - p * ppd;
      if (Math.abs(y) > ar) continue;
      const half = p % 20 === 0 ? ar * 0.32 : ar * 0.16;
      c.strokeStyle = this.col(0.55);
      c.beginPath(); c.moveTo(-half, y); c.lineTo(half, y); c.stroke();
      if (p % 20 === 0) c.fillText(Math.abs(p), half + 3, y);
    }
    c.restore();
    c.save();
    c.strokeStyle = this.col(0.6); c.lineWidth = 1;
    c.beginPath(); c.arc(ax, ay, ar, 0, Math.PI * 2); c.stroke();
    // arco de alabeo
    c.translate(ax, ay);
    c.strokeStyle = this.col(0.5);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r0 = ar + 3, r1 = ar + (a % 30 === 0 ? 10 : 6);
      const an = (a - 90) * RAD;
      c.beginPath(); c.moveTo(Math.cos(an) * r0, Math.sin(an) * r0); c.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); c.stroke();
    }
    c.rotate(-t.flight.roll * RAD);
    c.fillStyle = this.col(1);
    c.beginPath(); c.moveTo(0, -ar + 1); c.lineTo(-5, -ar + 10); c.lineTo(5, -ar + 10); c.closePath(); c.fill();
    c.restore();
    // símbolo de la nave
    c.strokeStyle = this.col(1, 'warn'); c.lineWidth = 2;
    c.beginPath(); c.moveTo(ax - ar * 0.55, ay); c.lineTo(ax - ar * 0.18, ay); c.lineTo(ax - ar * 0.1, ay + 6);
    c.moveTo(ax + ar * 0.55, ay); c.lineTo(ax + ar * 0.18, ay); c.lineTo(ax + ar * 0.1, ay + 6); c.stroke();
    c.fillStyle = this.col(0.8); c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText(`CAB ${nf(t.flight.pitch, 0)}°  ·  ALB ${nf(t.flight.roll, 0)}°`, ax, ay + ar + 12);
  }

  // ================================================================ MINIMALISTA
  drawMinimal(t) {
    if (!this.nearBody(t)) return;
    const c = this.ctx, { w, h } = this;
    const cam = t.cam, f = this.focal(cam.fov);
    if (Math.abs(cam.pitch) > 70) return;
    const y = f * Math.tan(cam.pitch * RAD);
    c.save(); c.translate(w / 2, h / 2); c.rotate(-cam.roll * RAD);
    c.strokeStyle = this.col(0.55); c.lineWidth = 1;
    const x0 = Math.min(220, w * 0.18), x1 = x0 + 60;
    c.beginPath(); c.moveTo(-x1, y); c.lineTo(-x0, y); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    c.restore();
  }
}

function THREE_clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function fmtVS(v) {
  if (v < 1000) return `${Math.round(v)} m/s`;
  return `${nf(v / 1000, 1)} km/s`;
}
