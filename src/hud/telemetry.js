// Telemetría: a partir del estado de la nave (sólo lectura) calcula todo lo que muestran
// los instrumentos: entorno, actitud, órbita kepleriana, temperatura del casco y energía.
// La nave vuela arcade (sin gravedad); acá se interpreta su vector de estado real como si
// fuera una órbita, que es justamente lo informativo.
import * as THREE from 'three';
import {
  atmosphereAt, atmoModel, solarIrradiance, planetIR, equilibriumTemp, muOf, SIGMA, G0, T_CMB,
} from '../physics/environment.js';

const DEG = 180 / Math.PI;
const expK = (k, dt) => 1 - Math.exp(-k * dt);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _h = new THREE.Vector3(), _e = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Casco / escudo térmico (modelo concentrado por unidad de área)
export const HULL = {
  warn: 1100, crit: 1500,   // K: ámbar y rojo (escudo cerámico tipo transbordador ~1.650 K)
  heatCap: 1.2e4,           // J/(m²·K)
  noseR: 2,                 // radio de la nariz para Sutton–Graves (m)
  absorb: 0.6, emis: 0.85,
};
// Energía (simulada): batería + paneles solares + RTG
export const POWER = {
  capacity: 100 * 3.6e6,    // 100 kWh en J
  panels: 40 * 0.3,         // m² × eficiencia
  rtg: 4e3,                 // W
  avionics: 3e3,            // W
  engine: 120e3,            // W a acelerador 100 %
  boost: 300e3,             // W extra con boost
  cruiseCharge: 2e6,        // W mientras carga el supercrucero
  cruise: 150e3,            // W sosteniendo el supercrucero
};

function attitude(quat, U, N, E, out) {
  const f = _v.set(0, 0, -1).applyQuaternion(quat);
  const r = _w.set(1, 0, 0).applyQuaternion(quat);
  const u = _h.set(0, 1, 0).applyQuaternion(quat);
  out.pitch = Math.asin(THREE.MathUtils.clamp(f.dot(U), -1, 1)) * DEG;
  out.roll = Math.atan2(-r.dot(U), u.dot(U)) * DEG;
  const fe = f.dot(E), fn = f.dot(N);
  // mirando casi a la vertical el rumbo queda indefinido: usar el "arriba" de la nave
  if (fe * fe + fn * fn > 1e-4) out.heading = (Math.atan2(fe, fn) * DEG + 360) % 360;
  else out.heading = (Math.atan2(u.dot(E), u.dot(N)) * DEG + (f.dot(U) > 0 ? 180 : 0) + 360) % 360;
  return out;
}

// Fracción visible del disco solar desde P (eclipses, con penumbra aproximada)
function sunVisibility(P, bodies, sun) {
  const dSun = P.length();
  if (dSun < 1) return { vis: 1, by: null };
  const s = _e.copy(P).multiplyScalar(-1 / dSun);
  const aS = sun.R / dSun;
  let vis = 1, by = null;
  for (const b of bodies) {
    if (b === sun) continue;
    const d = _w.subVectors(b.pos, P);
    const proj = d.dot(s);
    if (proj <= 0 || proj > dSun) continue;
    const perp = Math.sqrt(Math.max(0, d.lengthSq() - proj * proj));
    const aB = Math.asin(Math.min(1, b.R / Math.max(b.R, d.length())));
    const th = Math.atan2(perp, proj);
    if (th >= aB + aS) continue;
    let f;
    if (aB >= aS) f = THREE.MathUtils.clamp((th - (aB - aS)) / (2 * aS), 0, 1);
    else f = 1 - (aB * aB) / (aS * aS) * THREE.MathUtils.clamp((aB + aS - th) / (2 * aB), 0, 1);
    if (f < vis) { vis = f; by = b; }
  }
  return { vis, by };
}

export class Telemetry {
  constructor(system, ship) {
    this.system = system;
    this.ship = ship;
    this.prevVel = null;
    this.accel = new THREE.Vector3();
    this.felt = new THREE.Vector3();      // aceleración propia filtrada (m/s²)
    this.hullT = null;                    // K (se inicializa con la del entorno)
    this.energy = 0.85;                   // fracción de la batería
    this.prevQuatCam = null;
    this.atm = {};
    this.t = {
      env: {}, flight: {}, orbit: {}, craft: {}, cam: {},
    };
    this.U = new THREE.Vector3(); this.N = new THREE.Vector3(); this.E = new THREE.Vector3();
  }

  update(dt, camera) {
    const { ship, system } = this;
    const t = this.t;
    const near = ship.nearest || system.nearestSurface(ship.world);
    const body = near.body;
    const alt = near.alt;
    const sun = system.byId.sun;
    const P = ship.world;
    const rC = _v.subVectors(P, body.pos);
    const rLen = Math.max(1, rC.length());

    // ---------- marco local (vertical, norte, este) respecto del cuerpo más cercano
    const U = this.U.copy(rC).divideScalar(rLen);
    const pole = _w.copy(Y).applyQuaternion(body.tilt);
    const N = this.N.copy(pole).addScaledVector(U, -pole.dot(U));
    if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(U, -U.x);
    N.normalize();
    const E = this.E.crossVectors(N, U).normalize();

    // ---------- entorno
    const env = t.env;
    env.body = body;
    env.alt = alt;
    const atm = atmosphereAt(body.id, body.R, alt, this.atm);
    const sv = sunVisibility(P, system.bodies, sun);
    const S0 = body === sun ? solarIrradiance(rLen) : solarIrradiance(P.length());
    env.irradiance = S0 * sv.vis;
    env.shadowBy = sv.vis < 0.5 ? sv.by : null;
    env.sunFrac = sv.vis;
    const ir = body === sun ? 0 : planetIR(body.id, body.R, rLen);
    env.ir = ir;
    env.Teq = equilibriumTemp(env.irradiance, ir, HULL.absorb, HULL.emis);
    env.atm = atm && atm.p > 0 ? atm : null;
    env.inside = !!(atm && atm.inside);
    env.p = atm ? atm.p : 0;
    env.rho = atm ? atm.rho : 0;
    // con aire apreciable la temperatura es la del aire; en el vacío, la de equilibrio radiativo
    env.airT = atm && atm.p > 1 ? atm.T : null;
    env.T = env.airT ?? env.Teq;
    env.vacuum = !atm || atm.p < 1e-3;
    const mu = muOf(body.id);
    env.g = mu / (rLen * rLen) / G0;
    // día / noche en el punto bajo la nave (elevación del Sol sobre el horizonte local)
    if (body !== sun) {
      const sd = _h.copy(body.pos).negate().normalize();
      env.sunElev = Math.asin(THREE.MathUtils.clamp(U.dot(sd), -1, 1)) * DEG;
      const e = env.sunElev;
      const air = !!atm;
      env.daylight = e > -0.833 ? 'día' : !air ? 'noche'
        : e > -6 ? 'crepúsculo civil' : e > -12 ? 'crepúsculo náutico' : e > -18 ? 'crepúsculo astronómico' : 'noche';
    } else { env.sunElev = null; env.daylight = '—'; }

    // ---------- vuelo
    const fl = t.flight;
    const v = ship.vel;
    const spd = v.length();
    fl.alt = alt;
    fl.speed = spd;
    fl.vs = v.dot(U);
    attitude(ship.quat, U, N, E, fl);
    attitude(camera.quaternion, U, N, E, t.cam);
    t.cam.fov = camera.fov;
    fl.mach = atm && atm.p > 1e-3 ? spd / atm.sound : null;
    fl.q = 0.5 * env.rho * spd * spd;
    // fuerza G: aceleración respecto del marco menos la gravedad local (lo que "sentís")
    const frame = ship.frame;
    const rF = _w.copy(ship.local);
    const rFl = Math.max(1, rF.length());
    const muF = muOf(frame.id);
    if (this.prevVel && dt > 1e-4) this.accel.subVectors(v, this.prevVel).divideScalar(dt);
    else this.accel.set(0, 0, 0);
    (this.prevVel ||= new THREE.Vector3()).copy(v);
    const gvec = _h.copy(rF).multiplyScalar(-muF / (rFl * rFl * rFl));
    const feltNow = _e.subVectors(this.accel, gvec);
    if (feltNow.length() > 5000 * G0) feltNow.setLength(5000 * G0);  // saltos de teletransporte
    this.felt.lerp(feltNow, expK(5, dt));
    fl.gTotal = this.felt.length() / G0;
    fl.gNormal = this.felt.dot(_v.set(0, 1, 0).applyQuaternion(ship.quat)) / G0;
    fl.dampened = ship.cruise === 'on';

    // ---------- órbita alrededor del cuerpo dominante (marco)
    const o = t.orbit;
    o.body = frame;
    o.mu = muF;
    o.r = rFl;
    o.alt = rFl - frame.R;
    o.vCirc = Math.sqrt(muF / rFl);
    o.vEsc = Math.sqrt(2 * muF / rFl);
    o.v = spd;
    const eps = spd * spd / 2 - muF / rFl;
    const h = _h.crossVectors(rF, v);
    const hl = h.length();
    const evec = _e.crossVectors(v, h).divideScalar(muF).addScaledVector(rF, -1 / rFl);
    o.e = evec.length();
    o.vr = v.dot(rF) / rFl;
    const pAx = _v.copy(Y).applyQuaternion(frame.tilt);
    o.inc = hl > 1e-6 ? Math.acos(THREE.MathUtils.clamp(h.dot(pAx) / hl, -1, 1)) * DEG : null;
    const pr = hl * hl / muF / (1 + o.e);                  // radio de periapsis (vale para toda cónica)
    o.pe = pr - frame.R;
    if (eps < 0) {
      const a = -muF / (2 * eps);
      o.a = a;
      o.ap = a * (1 + o.e) - frame.R;
      o.period = 2 * Math.PI * Math.sqrt(a * a * a / muF);
    } else { o.a = null; o.ap = Infinity; o.period = Infinity; }
    const atmTop = atmoModel(frame.id)?.top ?? 0;
    if (frame.id === 'sun') o.state = eps >= 0 ? 'escapando del Sistema Solar' : 'órbita solar';
    else if (eps >= 0) o.state = o.vr >= 0 ? 'escapando' : 'trayectoria hiperbólica';
    else if (spd < 1) o.state = 'caída libre (sin velocidad)';
    else if (o.pe < 0) o.state = 'suborbital · cayendo';
    else if (o.pe < atmTop) o.state = 'periapsis en la atmósfera';
    else o.state = 'en órbita';
    o.escaping = eps >= 0 && o.vr >= 0 && frame.id !== 'sun';

    // ---------- nave: temperatura del casco
    const c = t.craft;
    if (this.hullT === null) this.hullT = env.T;
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    const h1 = dt / steps;
    let qConv = 0, Tr = env.T;
    if (atm && env.rho > 0) {
      const M2 = fl.mach * fl.mach;
      Tr = Math.min(9000, atm.T * (1 + 0.85 * (atm.gamma - 1) / 2 * M2));   // temperatura de recuperación
      const k = atm.M > 0.04 ? 1.9e-4 : atm.M > 0.02 ? 1.74e-4 : 0.65e-4;  // Sutton–Graves según el gas
      qConv = k * Math.sqrt(env.rho / HULL.noseR) * spd * spd * spd;
    }
    const hc = env.rho > 0 ? 2 + 10 * Math.pow(env.rho * (spd + 2), 0.6) : 0;
    const qRad = 0.25 * (HULL.absorb * env.irradiance + HULL.emis * ir);
    for (let i = 0; i < steps; i++) {
      const T = this.hullT;
      const net = qRad + qConv + hc * (Tr - T) - HULL.emis * SIGMA * (T ** 4 - T_CMB ** 4);
      this.hullT = Math.max(T_CMB, T + net / HULL.heatCap * h1);
    }
    c.hullT = this.hullT;
    c.heatFlux = qConv;
    c.hullState = this.hullT > HULL.crit ? 'crit' : this.hullT > HULL.warn ? 'warn' : 'ok';

    // ---------- nave: energía
    const thr = ship.autopilot ? Math.min(1, spd / Math.max(1, ship.vmax)) : Math.abs(ship.throttle);
    const load = POWER.avionics + POWER.engine * thr + POWER.boost * ship.boost
      + (ship.cruise === 'charging' ? POWER.cruiseCharge : ship.cruise === 'on' ? POWER.cruise : 0);
    const gen = POWER.rtg + POWER.panels * env.irradiance;
    c.load = load; c.gen = gen; c.net = gen - load;
    this.energy = THREE.MathUtils.clamp(this.energy + c.net * dt / POWER.capacity, 0, 1);
    c.energy = this.energy;
    c.eta = c.net < 0 ? this.energy * POWER.capacity / -c.net : (1 - this.energy) * POWER.capacity / Math.max(1, c.net);
    c.cruise = ship.cruise;
    c.cruiseCharge = ship.cruiseCharge;
    c.throttle = ship.throttle;
    c.boost = ship.boost;
    return t;
  }
}
