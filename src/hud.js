// HUD: marcadores proyectados de los cuerpos + paneles de telemetría.
import * as THREE from 'three';
import { AU } from './ephemeris.js';
import { C } from './ship.js';

export function fmtDist(m) {
  const a = Math.abs(m);
  if (a < 1000) return `${a.toFixed(0)} m`;
  if (a < 1e9) return `${(a / 1000).toLocaleString('es-AR', { maximumFractionDigits: a < 1e5 ? 1 : 0 })} km`;
  if (a < 0.05 * AU) return `${(a / 1e9).toFixed(2)} M km`;
  return `${(a / AU).toFixed(3)} UA`;
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
  return `${(s / 86400).toFixed(1)} días`;
}

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
    this.el = id => document.getElementById(id);
    this.vstick = document.getElementById('vstick');
    this.vdot = this.vstick.querySelector('.dot');
    this.vline = document.getElementById('vstick-line');
    this.cruiseEl = document.getElementById('cruise');
    this.vignette = document.getElementById('warp-vignette');
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
    const w = innerWidth, h = innerHeight;
    const ship = this.ship;
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

    // paneles
    const near = ship.nearest;
    this.el('t-date').textContent = simDate.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    this.el('t-warp').textContent = paused ? 'PAUSA' : `×${warp.toLocaleString('es-AR')}`;
    this.el('t-frame').textContent = ship.frame.name;
    this.el('t-near').textContent = `${near.body.name} · ${fmtDist(near.alt)}`;
    this.el('t-sun').textContent = fmtDist(ship.world.length());
    this.el('t-speed').textContent = fmtSpeed(spd);
    this.el('t-vmax').textContent = fmtSpeed(ship.vmax);
    const mode = ship.cruise === 'on' ? 'SUPERCRUCERO' : charging ? 'CARGANDO…' : 'NORMAL';
    this.el('t-mode').textContent = mode + (ship.boost > 0.5 ? ' · BOOST' : '');
    this.el('t-light').textContent = fmtTime(ship.world.length() / C);
    const thr = ship.autopilot ? 'AUTO' : `${Math.round(ship.throttle * 100)}%`;
    this.el('t-throttle').textContent = thr;
    this.el('throttle-fill').style.width = `${Math.max(0, ship.throttle) * 100}%`;
    this.el('throttle-fill').classList.toggle('reverse', ship.throttle < 0);
    if (t) {
      const d = ship.world.distanceTo(t.pos) - t.R;
      const closing = ship.vel.dot(new THREE.Vector3().subVectors(t.pos, ship.world).normalize());
      this.el('tg-name').textContent = t.name;
      this.el('tg-dist').textContent = fmtDist(d);
      this.el('tg-radius').textContent = `${Math.round(t.radius).toLocaleString('es-AR')} km`;
      this.el('tg-eta').textContent = closing > 1 ? fmtTime(d / closing) : '—';
      this.el('tg-ap').textContent = ship.autopilot ? 'ACTIVO' : 'G para activar';
      this.el('tg-ap').classList.toggle('on', ship.autopilot);
    }
    this.el('status').textContent = ship.status;
  }
}
