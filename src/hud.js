// HUD: marcadores proyectados de los cuerpos, instrumentos (canvas) y paneles de telemetría
// con datos físicos reales. Tres estilos (U): sci-fi, aviónica y minimalista.
import * as THREE from 'three';
import { AU } from './ephemeris.js';
import { C } from './ship.js';
import { Telemetry, HULL } from './hud/telemetry.js';
import { Instruments } from './hud/instruments.js';
import { Alerts } from './hud/alerts.js';

function frameSkip(h) { h._f = ((h._f ?? 0) + 1) % 15; return h._f === 0; }

export function fmtDist(m) {
  const a = Math.abs(m);
  const s = m < 0 ? '−' : '';
  if (a < 1000) return `${s}${a.toFixed(0)} m`;
  if (a < 1e9) return `${s}${(a / 1000).toLocaleString('es-AR', { maximumFractionDigits: a < 1e5 ? 1 : 0 })} km`;
  if (a < 0.05 * AU) return `${s}${(a / 1e9).toFixed(2)} M km`;
  return `${s}${(a / AU).toFixed(3)} UA`;
}
export function fmtSpeed(v) {
  if (v < 1000) return `${v.toFixed(0)} m/s`;
  if (v < 0.01 * C) return `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km/s`;
  return `${(v / C).toLocaleString('es-AR', { maximumFractionDigits: v < 10 * C ? 2 : 0 })} c`;
}
export function fmtTime(s) {
  if (!isFinite(s)) return '—';
  if (s < 60) return `${s.toFixed(0)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s < 86400 * 365.25 * 2) return `${(s / 86400).toLocaleString('es-AR', { maximumFractionDigits: 1 })} días`;
  return `${(s / (86400 * 365.25)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} años`;
}

// Equivalencias para el velocímetro (km/h)
const REFS = [
  { kmh: 5, name: 'caminando' },
  { kmh: 120, name: 'un auto en la ruta' },
  { kmh: 900, name: 'un avión de línea' },
  { kmh: 3600, name: 'una bala de fusil' },
  { kmh: 27600, name: 'la Estación Espacial' },
  { kmh: 40320, name: 'escape de la Tierra' },
  { kmh: 107000, name: 'la Tierra alrededor del Sol' },
  { kmh: 692000, name: 'la sonda Parker' },
  { kmh: 828000, name: 'el Sol en la galaxia' },
];
const C_KMH = 299792.458 * 3600;
const nf = (v, d = 0) => v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtX = x => (x >= 100 ? nf(x) : x >= 10 ? nf(x, 1) : nf(x, 2));

// soundKmh: velocidad del sonido local (km/h) si hay aire; si no, Mach a nivel del mar terrestre
export function speedEquivalences(kmh, soundKmh = null) {
  const parts = [];
  if (kmh < 1) return '';
  if (soundKmh) parts.push(`Mach local <b>${fmtX(kmh / soundKmh)}</b>`);
  else if (kmh >= 60) parts.push(`Mach <b>${fmtX(kmh / 1235)}</b>`);
  // la referencia más grande que estás superando (o la primera, si vas más lento)
  let ref = REFS[0];
  for (const r of REFS) if (kmh >= r.kmh) ref = r;
  parts.push(`<b>${fmtX(kmh / ref.kmh)}×</b> ${ref.name}`);
  const c = kmh / C_KMH;
  if (c >= 1e-4) parts.push(c >= 1 ? `<b>${fmtX(c)}×</b> la luz` : `<b>${nf(c * 100, c < 0.01 ? 3 : 1)} %</b> de la luz`);
  return parts.join(' · ');
}

// ---------- formatos de magnitudes físicas
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function fmtSci(x, d = 1) {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / 10 ** e;
  return `${nf(m, d)}×10${String(e).replace(/./g, ch => SUP[ch])}`;
}
export function fmtPressure(p) {
  if (p <= 0) return '0 Pa';
  if (p < 0.01) return `${fmtSci(p)} Pa`;
  if (p < 1000) return `${nf(p, p < 10 ? 2 : 0)} Pa`;
  if (p < 1e6) return `${nf(p / 1000, p < 1e4 ? 2 : 1)} kPa`;
  return `${nf(p / 1e6, 2)} MPa`;
}
function fmtAtm(p) {
  const a = p / 101325;
  if (a >= 10) return `${nf(a, 1)} atm`;
  if (a >= 0.01) return `${nf(a, 3)} atm`;
  return `${fmtSci(a)} atm`;
}
const fmtC = T => `${nf(T - 273.15, Math.abs(T - 273.15) < 100 ? 1 : 0)} °C`;
const fmtRho = r => (r <= 0 ? '0' : r < 0.01 ? fmtSci(r, 2) : nf(r, r < 1 ? 4 : 2)) + ' kg/m³';
const fmtFlux = q => (q < 1e3 ? `${nf(q, 0)} W/m²` : q < 1e6 ? `${nf(q / 1e3, 1)} kW/m²` : `${nf(q / 1e6, 2)} MW/m²`);
const fmtPow = w => (Math.abs(w) < 1e6 ? `${nf(w / 1e3, 1)} kW` : `${nf(w / 1e6, 2)} MW`);
const fmtAngle = a => `${nf(a, 0)}°`;

const STYLES = ['scifi', 'avionics', 'minimal'];
const STYLE_NAME = { scifi: 'sci-fi', avionics: 'aviónica', minimal: 'minimalista' };
const TEXT_DT = 1 / 16;   // los textos se actualizan a ~16 Hz

const _v = new THREE.Vector3();

export class HUD {
  constructor(system, ship, onSelect) {
    this.system = system;
    this.ship = ship;
    this.layer = document.getElementById('markers');
    this.markers = new Map();
    this.showLabels = true;
    for (const b of system.bodies) {
      const el = document.createElement('div');
      el.className = 'marker' + (b.parent && b.parent !== 'sun' ? ' moon' : '');
      el.innerHTML = `<i style="border-color:${b.color}"></i><span class="name">${b.name}</span><span class="dist"></span>`;
      el.addEventListener('click', e => { e.stopPropagation(); onSelect(b); });
      this.layer.appendChild(el);
      this.markers.set(b, { el, dist: el.querySelector('.dist') });
    }
    this.arrow = document.getElementById('target-arrow');
    this.prograde = document.getElementById('prograde');
    this.ids = new Map();
    this.el = id => { let e = this.ids.get(id); if (!e) { e = document.getElementById(id); this.ids.set(id, e); } return e; };
    this.cache = new Map();
    this.vstick = document.getElementById('vstick');
    this.vdot = this.vstick.querySelector('.dot');
    this.vline = document.getElementById('vstick-line');
    this.cruiseEl = document.getElementById('cruise');
    this.vignette = document.getElementById('warp-vignette');

    this.telemetry = new Telemetry(system, ship);
    this.instruments = new Instruments(document.getElementById('hud-canvas'));
    this.alerts = new Alerts(document.getElementById('alerts'));
    this.minSlots = [...document.querySelectorAll('#min .mstat')].map(el => ({
      el, label: el.querySelector('span'), value: el.querySelector('b'),
    }));
    this.lastTime = performance.now();
    this.textAcc = TEXT_DT;

    let st = 'scifi';
    try { st = localStorage.getItem('hud.style') || st; } catch { /* sin almacenamiento */ }
    this.setStyle(STYLES.includes(st) ? st : 'scifi');
    addEventListener('keydown', e => {
      if (e.code !== 'KeyU' || e.repeat) return;
      this.setStyle(STYLES[(STYLES.indexOf(this.style) + 1) % STYLES.length]);
      ship.status = `HUD: ${STYLE_NAME[this.style]}`;
    });
  }

  setStyle(s) {
    this.style = s;
    for (const k of STYLES) document.body.classList.toggle(`hud-${k}`, k === s);
    try { localStorage.setItem('hud.style', s); } catch { /* sin almacenamiento */ }
    this.cache.clear();
    this.textAcc = TEXT_DT;
  }

  // escribir en el DOM sólo si cambió (evita trabajo de layout)
  set(id, text) {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    this.el(id).textContent = text;
  }
  setHTML(id, html) {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    this.el(id).innerHTML = html;
  }
  setStyleProp(id, prop, val) {
    const k = id + '|' + prop;
    if (this.cache.get(k) === val) return;
    this.cache.set(k, val);
    this.el(id).style[prop] = val;
  }
  setClass(id, cls) {
    const k = id + '|class';
    if (this.cache.get(k) === cls) return;
    this.cache.set(k, cls);
    this.el(id).dataset.level = cls;
  }

  project(rel, camera, w, h) {
    const v = rel.clone().applyQuaternion(camera.quaternion.clone().invert());
    const inFront = v.z < 0;
    const p = rel.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, inFront, view: v };
  }

  // ¿Hay un cuerpo más cercano tapando a b desde la cámara?
  occluded(b) {
    const d = b.rel.length();
    for (const o of this.system.bodies) {
      if (o === b) continue;
      const od = o.rel.length();
      if (od >= d || od <= o.R) continue;
      if (b.rel.angleTo(o.rel) < Math.asin(o.R / od)) return true;
    }
    return false;
  }

  update(camera, simDate, warp, paused) {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const w = innerWidth, h = innerHeight;
    const ship = this.ship;
    const tl = this.telemetry.update(dt, camera);
    const screen = new Map();
    for (const [b, m] of this.markers) {
      const s = this.project(b.rel, camera, w, h);
      screen.set(b, s);
      const dist = ship.world.distanceTo(b.pos) - b.R;
      const isTarget = b === ship.target;
      let visible = s.inFront && this.showLabels;
      // ocultar lunas pegadas a su planeta en pantalla (salvo el objetivo)
      if (visible && b.parentBody && b.parentBody.id !== 'sun' && !isTarget) {
        const ps = screen.get(b.parentBody);
        if (ps && Math.hypot(ps.x - s.x, ps.y - s.y) < 28) visible = false;
      }
      // ocultar el marcador cuando el cuerpo ocupa mucho de la pantalla
      const angular = b.R / Math.max(1, b.rel.length());
      if (angular > 0.25 && !isTarget) visible = false;
      if (visible && this.occluded(b)) visible = false;
      if (isTarget && s.inFront) visible = true;
      m.el.style.display = visible ? 'block' : 'none';
      if (visible) {
        m.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
        m.el.classList.toggle('target', isTarget);
        m.dist.textContent = fmtDist(Math.max(0, dist));
      }
    }

    // flecha hacia el objetivo si está fuera de pantalla
    const t = ship.target;
    if (t) {
      const s = screen.get(t);
      const off = !s.inFront || s.x < 0 || s.x > w || s.y < 0 || s.y > h;
      this.arrow.style.display = off ? 'block' : 'none';
      if (off) {
        const ang = Math.atan2(-s.view.y, s.view.x);
        const r = Math.min(w, h) * 0.4;
        this.arrow.style.transform =
          `translate(${w / 2 + Math.cos(ang) * r}px, ${h / 2 + Math.sin(ang) * r}px) rotate(${ang}rad)`;
      }
    } else this.arrow.style.display = 'none';

    // vector de velocidad (prógrado)
    const spd = ship.vel.length();
    if (spd > 1) {
      const s = this.project(ship.vel.clone().normalize().multiplyScalar(1e6), camera, w, h);
      this.prograde.style.display = s.inFront ? 'block' : 'none';
      this.prograde.style.transform = `translate(${s.x}px, ${s.y}px)`;
    } else this.prograde.style.display = 'none';

    // joystick virtual
    const stickOn = ship.mouseMode === 'stick';
    this.vstick.classList.toggle('on', stickOn);
    if (stickOn) {
      const x = ship.stick.x * 60, y = ship.stick.y * 60;
      this.vdot.style.transform = `translate(${x}px, ${y}px)`;
      this.vline.setAttribute('x2', 60 + x); this.vline.setAttribute('y2', 60 + y);
    }

    // supercrucero
    const charging = ship.cruise === 'charging';
    this.cruiseEl.style.display = charging ? 'block' : 'none';
    if (charging) {
      this.el('cruise-fill').style.width = `${ship.cruiseCharge * 100}%`;
      this.el('cruise-text').textContent = 'SUPERCRUCERO · CARGANDO';
    }
    const vig = charging ? ship.cruiseCharge * 0.8 : ship.cruise === 'on' ? 0.35 * Math.min(1, spd / Math.max(1, ship.vmax)) : 0;
    this.vignette.style.opacity = vig.toFixed(3);

    // marcación del objetivo (para la cinta de rumbo)
    let targetBearing = null;
    if (t) {
      const tm = this.telemetry;
      const d = _v.subVectors(t.pos, ship.world);
      const dn = d.dot(tm.N), de = d.dot(tm.E);
      if (dn * dn + de * de > 1e-6 * d.lengthSq()) targetBearing = (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
    }

    // instrumentos fluidos: cada cuadro
    this.instruments.draw(this.style, tl, {
      targetBearing,
      throttle: ship.autopilot ? Math.min(1, spd / Math.max(1, ship.vmax)) : ship.throttle,
      speed01: Math.min(1, spd / Math.max(1, ship.vmax)),
      cruise: ship.cruise,
    }, dt);

    this.updateAlerts(tl);

    // velocímetro grande en km/h
    const kmh = spd * 3.6;
    const sound = tl.flight.mach != null ? tl.env.atm.sound * 3.6 : null;
    if (Math.abs(kmh - (this._lastKmh ?? -1)) >= Math.max(1, kmh * 0.002) || frameSkip(this)) {
      this._lastKmh = kmh;
      this.setHTML('spd-kmh', `${nf(Math.round(kmh))}<small>km/h</small>`);
      this.setHTML('spd-eq', speedEquivalences(kmh, sound));
    }

    // textos: ~16 Hz
    this.textAcc += dt;
    if (this.textAcc >= TEXT_DT) {
      this.textAcc = 0;
      this.updateText(tl, simDate, warp, paused);
    }
  }

  updateAlerts(tl) {
    const A = this.alerts;
    const { env, flight, orbit, craft } = tl;
    const b = env.body;
    if (A.edge('atmo-in', env.inside)) A.flash('atmo', `ENTRANDO EN LA ATMÓSFERA · ${b.name.toUpperCase()}`, 'info', 4);
    if (A.edge('atmo-out', !env.inside) && this._wasInside === b) A.flash('atmo', 'SALIENDO DE LA ATMÓSFERA', 'info', 3);
    if (env.inside) this._wasInside = b;
    if (A.edge('esc', orbit.escaping)) A.flash('esc', `VELOCIDAD DE ESCAPE ALCANZADA · ${orbit.body.name.toUpperCase()}`, 'info', 4);
    A.hold('hull-crit', craft.hullState === 'crit', `TEMPERATURA DEL CASCO CRÍTICA · ${nf(craft.hullT, 0)} K`, 'crit');
    A.hold('hull-warn', craft.hullState === 'warn', `CALENTAMIENTO DEL CASCO · ${nf(craft.hullT, 0)} K`, 'warn');
    const low = b.id !== 'sun' && (flight.alt < 150 || (flight.alt < 2000 && flight.vs < -Math.max(40, flight.alt / 8)));
    A.hold('low-alt', low, `ALTITUD BAJA · ${fmtDist(flight.alt)}`, flight.vs < -50 ? 'crit' : 'warn');
    A.hold('pres', env.p > 5e6, `PRESIÓN EXTERNA EXTREMA · ${fmtPressure(env.p)}`, 'warn');
    A.hold('energy', craft.energy < 0.1, `ENERGÍA BAJA · ${nf(craft.energy * 100, 0)} %`, 'warn');
    A.tick();
  }

  updateText(tl, simDate, warp, paused) {
    const ship = this.ship;
    const { env, flight: fl, orbit: o, craft: cr } = tl;
    const spd = fl.speed;
    const b = env.body;

    // tiempo
    this.set('t-date', simDate.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    this.set('t-warp', paused ? 'PAUSA' : `×${warp.toLocaleString('es-AR')}`);

    // ---------- entorno
    this.set('e-title', `ENTORNO · ${b.name.toUpperCase()}`);
    const atm = env.atm;
    if (atm && atm.p > 1e-6) {
      this.set('e-p', `${fmtPressure(env.p)} · ${fmtAtm(env.p)}`);
      this.set('e-rho', fmtRho(env.rho));
      this.set('e-comp', atm.comp);
      this.set('e-layer', `${atm.layer}${env.inside ? '' : ' · alta'}`);
    } else {
      this.set('e-p', '0 Pa · vacío');
      this.set('e-rho', '0 kg/m³');
      this.set('e-comp', b.id === 'sun' ? 'plasma H · He (corona)' : '—');
      this.set('e-layer', 'espacio');
    }
    this.set('e-t', env.airT != null ? `${fmtC(env.airT)} · aire`
      : `${fmtC(env.Teq)} · vacío · ${env.sunFrac > 0.5 ? 'sol' : 'sombra'}`);
    this.set('e-g', `${nf(env.g, env.g < 0.01 ? 4 : 2)} g`);
    this.set('e-sun', `${fmtFlux(env.irradiance)}${env.shadowBy ? ` · sombra de ${env.shadowBy.name}` : ''}`);
    this.set('e-day', env.sunElev == null ? '—' : `${env.daylight} · Sol a ${nf(env.sunElev, 0)}°`);
    this.set('e-dsun', `${fmtDist(ship.world.length())} · luz ${fmtTime(ship.world.length() / C)}`);

    // ---------- vuelo
    this.set('f-alt', fmtDist(fl.alt));
    this.set('f-vs', `${fl.vs >= 0 ? '+' : '−'}${fmtSpeed(Math.abs(fl.vs))}`);
    this.set('f-mach', fl.mach != null ? `${nf(fl.mach, 2)} · sonido ${nf(env.atm.sound, 0)} m/s` : '— (sin aire)');
    this.set('f-q', fl.q > 0 ? fmtPressure(fl.q) : '0 Pa');
    this.set('f-g', fl.dampened ? 'amortiguada (supercrucero)'
      : `${nf(fl.gTotal, 2)} g · normal ${nf(fl.gNormal, 1)} g`);
    this.set('f-hdg', `${String(Math.round(fl.heading) % 360).padStart(3, '0')}°`);
    this.set('f-att', `${fmtAngle(fl.pitch)} / ${fmtAngle(fl.roll)}`);
    this.set('f-speed', `${fmtSpeed(spd)} / ${fmtSpeed(ship.vmax)}`);
    this.set('f-frame', `${ship.frame.name} · cerca: ${b.name}`);

    // ---------- órbita
    this.set('o-title', `ÓRBITA · ${o.body.name.toUpperCase()}`);
    this.set('o-state', o.state);
    this.setClass('o-state', o.escaping ? 'warn' : o.state === 'en órbita' ? 'good' : o.pe < 0 ? 'warn' : '');
    this.set('o-ap', isFinite(o.ap) ? fmtDist(o.ap) : '∞ (no ligada)');
    this.set('o-pe', o.pe < -o.body.R * 0.999 ? '— (radial)' : fmtDist(o.pe));
    this.set('o-per', fmtTime(o.period));
    this.set('o-ecc', nf(o.e, 3));
    this.set('o-inc', o.inc == null ? '—' : `${nf(o.inc, 1)}°`);
    this.set('o-vc', fmtSpeed(o.vCirc));
    this.set('o-ve', fmtSpeed(o.vEsc));
    const scale = Math.max(o.vEsc * 1.25, spd);
    this.setStyleProp('o-bar-v', 'width', `${Math.min(100, spd / scale * 100)}%`);
    this.setStyleProp('o-bar-c', 'left', `${o.vCirc / scale * 100}%`);
    this.setStyleProp('o-bar-e', 'left', `${o.vEsc / scale * 100}%`);

    // ---------- nave
    this.set('s-hull', `${nf(cr.hullT, 0)} K · ${fmtC(cr.hullT)}`);
    this.setClass('s-hull', cr.hullState);
    this.setClass('s-hull-bar', cr.hullState);
    this.setStyleProp('s-hull-fill', 'width', `${Math.min(100, cr.hullT / (HULL.crit * 1.2) * 100)}%`);
    this.set('s-flux', cr.heatFlux > 1 ? fmtFlux(cr.heatFlux) : '—');
    this.set('s-energy', `${nf(cr.energy * 100, 1)} %`);
    this.setClass('s-energy', cr.energy < 0.1 ? 'crit' : cr.energy < 0.25 ? 'warn' : '');
    this.setStyleProp('s-energy-fill', 'width', `${cr.energy * 100}%`);
    this.set('s-power', `${cr.net >= 0 ? '+' : '−'}${fmtPow(Math.abs(cr.net))} · ${cr.net >= 0 ? 'llena en' : 'vacía en'} ${cr.energy >= 0.999 && cr.net >= 0 ? '—' : fmtTime(cr.eta)}`);
    const charging = ship.cruise === 'charging';
    this.set('s-cruise', ship.cruise === 'on' ? 'ACTIVO' : charging ? `CARGANDO ${Math.round(ship.cruiseCharge * 100)} %` : 'listo (J)');
    this.setClass('s-cruise', ship.cruise === 'on' ? 'good' : charging ? 'warn' : '');
    const mode = ship.autopilot ? 'PILOTO AUTOMÁTICO' : ship.cruise === 'on' ? 'SUPERCRUCERO' : 'NORMAL';
    this.set('t-mode', mode + (ship.boost > 0.5 ? ' · BOOST' : ''));
    const thr = ship.autopilot ? 'AUTO' : `${Math.round(ship.throttle * 100)}%`;
    this.set('t-throttle', thr);
    this.setStyleProp('throttle-fill', 'width', `${Math.max(0, ship.throttle) * 100}%`);
    this.el('throttle-fill').classList.toggle('reverse', ship.throttle < 0);

    // ---------- objetivo
    const t = ship.target;
    if (t) {
      const d = ship.world.distanceTo(t.pos) - t.R;
      const closing = ship.vel.dot(new THREE.Vector3().subVectors(t.pos, ship.world).normalize());
      this.set('tg-name', t.name);
      this.set('tg-dist', fmtDist(d));
      this.set('tg-radius', `${Math.round(t.radius).toLocaleString('es-AR')} km`);
      this.set('tg-eta', closing > 1 ? fmtTime(d / closing) : '—');
      this.set('tg-ap', ship.autopilot ? 'ACTIVO' : 'G para activar');
      this.el('tg-ap').classList.toggle('on', ship.autopilot);
    }
    this.set('status', ship.status);

    if (this.style === 'minimal') this.updateMinimal(tl);
  }

  // minimalista: pocos números grandes, sólo cuando importan
  updateMinimal(tl) {
    const { env, flight: fl, orbit: o, craft: cr } = tl;
    const b = env.body;
    const items = [];
    if (b.id !== 'sun' && fl.alt < b.R * 3) {
      items.push(['ALTITUD', fmtDist(fl.alt), '']);
      if (Math.abs(fl.vs) > 5) items.push(['VERTICAL', `${fl.vs >= 0 ? '+' : '−'}${fmtSpeed(Math.abs(fl.vs))}`, fl.vs < -300 ? 'warn' : '']);
    }
    if (env.atm && env.p > 1) {
      items.push(['PRESIÓN', fmtPressure(env.p), env.p > 5e6 ? 'warn' : '']);
      items.push(['TEMP.', fmtC(env.airT ?? env.T), '']);
      if (fl.mach > 0.3) items.push(['MACH', nf(fl.mach, 2), '']);
    }
    if (cr.hullState !== 'ok' || cr.hullT > 500) items.push(['CASCO', `${nf(cr.hullT, 0)} K`, cr.hullState === 'ok' ? '' : cr.hullState]);
    if (o.body.id !== 'sun' && o.alt < o.body.R * 20 && fl.speed > o.vCirc * 0.5) {
      if (isFinite(o.ap)) items.push(['AP / PE', `${fmtDist(o.ap)} / ${fmtDist(o.pe)}`, '']);
      else items.push(['ÓRBITA', o.state, 'warn']);
    }
    if (cr.energy < 0.25) items.push(['ENERGÍA', `${nf(cr.energy * 100, 0)} %`, cr.energy < 0.1 ? 'crit' : 'warn']);
    if (!fl.dampened && fl.gTotal > 2.5) items.push(['G', nf(fl.gTotal, 1), fl.gTotal > 6 ? 'warn' : '']);
    this.minSlots.forEach((s, i) => {
      const it = items[i];
      const k = 'min' + i;
      const key = it ? it.join('|') : '';
      if (this.cache.get(k) === key) return;
      this.cache.set(k, key);
      s.el.classList.toggle('show', !!it);
      if (it) { s.label.textContent = it[0]; s.value.textContent = it[1]; s.el.dataset.level = it[2]; }
    });
  }
}
