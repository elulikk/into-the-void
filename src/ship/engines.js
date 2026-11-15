// Motores de la nave: tres modos con su propio rango de velocidad y manejo.
//
//   'atmo'    ATMOSFÉRICO: vuelo bajo sobre una ciudad o terreno. De 0 (hover/VTOL)
//             a ~Mach 2,5–3. Se maneja como un jet: alabea al girar, la nariz arrastra
//             la velocidad (poca deriva) y el arrastre crece con la densidad del aire.
//             Sólo dentro de la atmósfera (o cerca de la superficie si no hay aire).
//   'impulse' IMPULSO: maniobras en el espacio y en órbita. De m/s a 3.000 km/s,
//             escalado con la altitud. Inercia y deriva; el strafe es RCS (aceleración).
//   'cruise'  SUPERCRUCERO: viajes interplanetarios. Carga de 1,5 s, vmax = 0,75 × altitud,
//             salida automática (interdicción) al acercarse a un cuerpo, con velocidad segura.
//
// Este módulo concentra toda la lógica de modos; ship.js sólo llama a:
//   engineEnv(near)                      → entorno (aire, zona atmosférica, altura mínima de crucero)
//   stepEngines(ship, dt, env)           → cambios automáticos, transición, carga del crucero, vmax objetivo
//   rotationTarget(ship, env, inp, dir)  → velocidad angular objetivo y respuesta por eje
//   manualDesired(ship, env, axes)       → velocidad deseada con los controles
//   integrateVelocity(ship, dt, desired, env, axes)
// y expone requestMode / cycleMode / toggleCruise / dropCruise para las teclas.
import * as THREE from 'three';
import { airAt, RHO_EARTH } from '../air.js';

export const ENGINE_MODES = ['atmo', 'impulse', 'cruise'];
export const ENGINE_NAMES = { atmo: 'ATMOSFÉRICO', impulse: 'IMPULSO', cruise: 'SUPERCRUCERO' };

const SPOOL = 0.45;            // s de spool-up/down al cambiar de modo
const CRUISE_CHARGE = 1.5;     // s de carga del supercrucero
const ATMO_VCAP = 950;         // m/s tope del modo atmosférico (≈ 3.400 km/h)
const ATMO_VSEA = 800;         // m/s tope a nivel del mar en la Tierra (≈ Mach 2,35)
const AFTERBURNER = 0.15;      // + 15 % con Shift en atmósfera (≈ Mach 2,7)
const IMPULSE_MIN = 500;       // m/s
const IMPULSE_MAX = 3e6;       // 3.000 km/s
const IMPULSE_K = 0.02;        // vmax de impulso = 0,02 × altitud
const VTOL_CLIMB = 60;         // m/s de ascenso/descenso vertical (R/F) en atmósfera
const VTOL_SLIDE = 40;         // m/s de desplazamiento lateral (A/D) a baja velocidad

const expK = (k, dt) => 1 - Math.exp(-k * dt);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion();

// ---------------------------------------------------------------- entorno

export function engineEnv(near) {
  const body = near.body, alt = near.alt;
  const air = airAt(body, alt);
  let top = 0;
  if (body && body.id !== 'sun') top = air.hasAir ? air.top : Math.min(20e3, 0.1 * body.R);
  const cruiseMinAlt = body ? Math.max(air.hasAir ? air.top * 1.5 : 0, 0.03 * body.R, 20e3) : 0;
  return { body, alt, ...air, zoneTop: top, inZone: alt < top, cruiseMinAlt };
}

// velocidad tope en atmósfera: baja con aire denso (Venus ~300 m/s), sube con aire fino
export function atmoTopSpeed(env, boost = 0) {
  const v = env.rho > 1e-6 ? ATMO_VSEA * Math.pow(RHO_EARTH / env.rho, 0.25) : ATMO_VCAP;
  return clamp(v, 150, ATMO_VCAP) * (1 + AFTERBURNER * boost);
}

export function impulseTopSpeed(env, speedFactor = 1, boost = 0) {
  let v = clamp(env.alt * IMPULSE_K, IMPULSE_MIN, IMPULSE_MAX) * speedFactor;
  if (env.inZone && env.rho > 0) v = Math.min(v, atmoTopSpeed(env) * 2.5); // el aire frena
  return v * (1 + 2 * boost);
}

export function cruiseTopSpeed(env, speedFactor = 1, boost = 0) {
  return Math.max(40, env.alt * 0.75) * speedFactor * (1 + 3 * boost);
}

// ---------------------------------------------------------------- cambios de modo

function setMode(ship, mode, msg) {
  if (ship.engineMode === mode) return;
  const prev = ship.engineMode;
  ship.engineMode = mode;
  ship.engineTransition = 0;
  ship.events.push('mode-change');
  if (mode === 'cruise') { ship.cruise = 'charging'; ship.cruiseCharge = 0; }
  else if (prev === 'cruise') {
    if (ship.cruise === 'on') ship.events.push('cruise-drop');
    ship.cruise = 'off'; ship.cruiseCharge = 0;
  }
  if (msg) ship.status = msg;
}

function km(m) { return m >= 1e4 ? `${Math.round(m / 1e3).toLocaleString('es-AR')} km` : `${Math.round(m)} m`; }

// Pedido del jugador (o del piloto automático). Devuelve true si el modo quedó activo.
export function requestMode(ship, mode, env = ship.engineEnv) {
  if (!env || ship.engineMode === mode) return ship.engineMode === mode;
  const name = env.body ? env.body.name : '';
  if (mode === 'atmo' && !env.inZone) {
    ship.status = env.zoneTop > 0
      ? `Motores atmosféricos: bajá de ${km(env.zoneTop)} sobre ${name}`
      : 'Motores atmosféricos: sólo dentro de una atmósfera o cerca de la superficie';
    return false;
  }
  if (mode === 'cruise' && (env.inZone || env.alt < env.cruiseMinAlt * 1.1)) {
    ship.status = `Supercrucero bloqueado: demasiado cerca de ${name} (mín. ${km(env.cruiseMinAlt * 1.1)})`;
    return false;
  }
  // impulso dentro de la atmósfera: elegido a mano, no se vuelve a atmosférico solo
  ship._impulseLock = mode === 'impulse' && env.inZone;
  setMode(ship, mode, mode === 'cruise' ? 'Supercrucero: cargando…' : `Motores: ${ENGINE_NAMES[mode].toLowerCase()}`);
  return true;
}

export function cycleMode(ship) {
  const env = ship.engineEnv;
  const i = ENGINE_MODES.indexOf(ship.engineMode);
  for (let s = 1; s < ENGINE_MODES.length; s++) {
    const m = ENGINE_MODES[(i + s) % ENGINE_MODES.length];
    // probar en orden; saltear los no disponibles en silencio (salvo que ninguno lo esté)
    if (m === 'atmo' && env && !env.inZone) continue;
    if (m === 'cruise' && env && (env.inZone || env.alt < env.cruiseMinAlt * 1.1)) continue;
    return requestMode(ship, m);
  }
  ship.status = `Motores: ${ENGINE_NAMES[ship.engineMode].toLowerCase()} (no hay otro modo disponible acá)`;
  return false;
}

export function toggleCruise(ship) {
  if (ship.engineMode === 'cruise') dropCruise(ship, 'manual');
  else requestMode(ship, 'cruise');
}

// Salir del supercrucero a impulso (o a atmosférico si ya estamos en el aire),
// recortando la velocidad a una de salida segura.
export function dropCruise(ship, reason) {
  if (ship.engineMode !== 'cruise') return;
  const env = ship.engineEnv;
  const toAtmo = env && env.inZone;
  setMode(ship, toAtmo ? 'atmo' : 'impulse', `Supercrucero desactivado (${reason})`);
  if (env) {
    const safe = impulseTopSpeed(env, ship.speedFactor);
    // en atmósfera no se recorta: el arrastre la frena (reentrada)
    if (!toAtmo && ship.vel.length() > safe) ship.vel.setLength(safe);
    if (!toAtmo) ship.vmax = Math.min(ship.vmax, safe);
  }
}

// ---------------------------------------------------------------- paso por cuadro

export function stepEngines(ship, dt, env) {
  ship.engineEnv = env;
  const speed = ship.vel.length();
  const radial = env.body ? _v.subVectors(ship.world, env.body.pos).normalize().dot(ship.vel) : 0;
  if (!env.inZone) ship._impulseLock = false;

  // ---- cambios automáticos
  if (ship.engineMode === 'atmo' && env.alt > env.zoneTop * 1.02) {
    setMode(ship, 'impulse', `Saliste de la atmósfera de ${env.body?.name ?? ''} → impulso`);
  } else if (ship.engineMode === 'cruise' && (env.inZone || env.alt < env.cruiseMinAlt)) {
    ship.events.push('interdiction');
    const name = env.body?.name ?? '';
    if (env.inZone && env.hasAir) {
      dropCruise(ship, `entrada atmosférica en ${name}`);
      if (speed > atmoTopSpeed(env) * 1.5) reentry(ship, env);
    } else dropCruise(ship, `interdicción: cerca de ${name}`);
  } else if (ship.engineMode === 'impulse' && env.inZone && !ship._impulseLock && (radial < 0 || speed < 1)) {
    if (env.hasAir && speed > atmoTopSpeed(env) * 1.5) {
      setMode(ship, 'atmo');
      reentry(ship, env);
    } else {
      setMode(ship, 'atmo', `${env.hasAir ? 'Entrando en la atmósfera' : 'Cerca de la superficie'} de ${env.body.name} → atmosférico`);
    }
  }

  // ---- piloto automático: elige el modo solo
  if (ship.autopilot && ship.target) {
    const dist = ship.world.distanceTo(ship.target.pos) - ship.target.R;
    if (env.inZone && ship.engineMode !== 'atmo' && ship.engineMode !== 'impulse') requestMode(ship, 'atmo', env);
    else if (!env.inZone && ship.engineMode !== 'cruise' && env.alt > env.cruiseMinAlt * 1.2 &&
      dist > Math.max(env.cruiseMinAlt * 4, ship.target.R * 4)) requestMode(ship, 'cruise', env);
  }

  // ---- transición (spool) y carga del crucero
  if (ship.engineMode === 'cruise') {
    if (ship.cruise === 'charging') {
      ship.cruiseCharge = Math.min(1, ship.cruiseCharge + dt / CRUISE_CHARGE);
      if (ship.cruiseCharge >= 1) {
        ship.cruise = 'on';
        ship.events.push('cruise-on');
        if (!ship.autopilot) ship.status = 'Supercrucero activo';
      }
    }
    ship.engineTransition = ship.cruise === 'on' ? 1 : ship.cruiseCharge;
  } else {
    ship.engineTransition = Math.min(1, ship.engineTransition + dt / SPOOL);
  }

  // ---- calor de reentrada / buffeting (0..1): para cámara y sonido
  let heat = 0;
  if (env.inZone && env.rho > 0) {
    const vt = atmoTopSpeed(env, 1);   // con postcombustión no cuenta como reentrada
    heat = clamp((speed - vt) / (3 * vt), 0, 1) * Math.min(1, 0.3 + 4 * Math.sqrt(env.rho01));
  }
  ship.reentry += (heat - ship.reentry) * expK(heat > ship.reentry ? 8 : 1.5, dt);
  ship.mach = env.sound > 0 ? speed / env.sound : 0;

  // ---- vmax objetivo del modo
  const b = ship.boost;
  if (ship.engineMode === 'atmo') return atmoTopSpeed(env, b);
  if (ship.engineMode === 'impulse') return impulseTopSpeed(env, ship.speedFactor, b);
  return ship.cruise === 'on' ? cruiseTopSpeed(env, ship.speedFactor, b)
    : Math.min(cruiseTopSpeed(env, ship.speedFactor, b), impulseTopSpeed(env, ship.speedFactor, b));
}

function reentry(ship, env) {
  ship.events.push('reentry');
  ship.status = `¡Reentrada en ${env.body.name}! Motores atmosféricos forzados`;
}

// ---------------------------------------------------------------- rotación

const RATE = {
  atmo:    { pitch: 1.2, yaw: 0.55, roll: 1.9 },
  impulse: { pitch: 1.3, yaw: 1.1, roll: 2.3 },
  cruise:  { pitch: 0.9, yaw: 0.8, roll: 1.8 },
};
const RESP = {
  atmo:    { pitch: 3.5, yaw: 2.5, roll: 4 },
  impulse: { pitch: 3.5, yaw: 3, roll: 5 },
  cruise:  { pitch: 2.5, yaw: 2.2, roll: 4 },
};

// inp = { pitch, yaw, roll } en -1..1. Devuelve { target: Vector3 (rad/s, ejes locales), resp }
export function rotationTarget(ship, env, inp) {
  const mode = ship.engineMode;
  const R = RATE[mode];
  const speed = ship.vel.length();
  const target = new THREE.Vector3();
  const b = env.body;
  // vertical local en ejes de la nave
  const up = b ? _up.subVectors(ship.world, b.pos).normalize().applyQuaternion(_q.copy(ship.quat).invert()) : null;

  if (mode === 'atmo') {
    // límite de carga (~9 g): a más velocidad, giros más abiertos
    const g = clamp(160 / Math.max(1, speed), 0.35, 1);
    target.x = inp.pitch * R.pitch * g;
    // guiñada alrededor de la vertical del lugar (el rumbo gira sin hundir la nariz)
    const yawRate = -inp.yaw * R.yaw * Math.max(0.45, g);
    if (up && Math.abs(up.z) < 0.92) target.addScaledVector(up, yawRate);
    else target.y += yawRate;
    target.z = -inp.roll * R.roll;
    // alabeo natural: la nave se inclina hacia el giro (nada en hover: VTOL plano)
    if (up && Math.abs(inp.roll) < 0.05 && Math.abs(up.z) < 0.92) {
      const bank = inp.yaw * 1.0 * smooth(speed, 25, 150);
      const err = Math.atan2(-up.x, up.y) - bank;
      target.z += clamp(err * 2.2, -1.6, 1.6);
    }
  } else {
    target.set(inp.pitch * R.pitch, -inp.yaw * R.yaw, -inp.roll * R.roll);
    // auto-nivelación suave cerca de un planeta (más débil en el espacio)
    if (b && b.id !== 'sun' && up && Math.abs(inp.roll) < 0.05) {
      const s = (1 - smooth(env.alt, b.R * 0.3, b.R * 1.5)) * (mode === 'impulse' ? 0.6 : 0.3);
      if (s > 0 && Math.abs(up.z) < 0.92) target.z += clamp(Math.atan2(-up.x, up.y) * 1.5, -1.2, 1.2) * s;
    }
  }
  // durante el spool el manejo pasa suave de un modo al otro
  const t = 0.5 + 0.5 * ship.engineTransition;
  const r = RESP[mode];
  return { target, resp: { pitch: r.pitch * t, yaw: r.yaw * t, roll: r.roll * t } };
}

// ---------------------------------------------------------------- velocidad

// axes = { fwd, right, up } (vectores del mundo)
export function manualDesired(ship, env, axes) {
  const desired = axes.fwd.clone().multiplyScalar(ship.throttle * ship.vmax);
  if (ship.engineMode === 'atmo') {
    // VTOL: R/F sube/baja por la vertical del lugar; A/D desliza de costado (se apaga con la velocidad)
    const vUp = env.body ? _v.subVectors(ship.world, env.body.pos).normalize() : axes.up;
    desired.addScaledVector(vUp, ship.strafe.y * VTOL_CLIMB);
    const slide = 1 - smooth(ship.vel.length(), 60, 300) * 0.8;
    desired.addScaledVector(axes.right, ship.strafe.x * VTOL_SLIDE * slide);
    if (ship.throttle < 0) desired.copy(axes.fwd).multiplyScalar(ship.throttle * 120).addScaledVector(vUp, ship.strafe.y * VTOL_CLIMB);
  } else if (ship.engineMode === 'cruise') {
    const sv = 0.35 * Math.min(ship.vmax, 3000 * ship.speedFactor);
    desired.addScaledVector(axes.right, ship.strafe.x * sv).addScaledVector(axes.up, ship.strafe.y * sv);
  }
  // impulso: el strafe es RCS (aceleración), se aplica en integrateVelocity
  return desired;
}

export function integrateVelocity(ship, dt, desired, env, axes) {
  const mode = ship.engineMode;
  const auth = 0.3 + 0.7 * ship.engineTransition;   // autoridad del motor durante el spool
  const fwd = axes.fwd;
  const vel = ship.vel;
  const diff = _v.subVectors(desired, vel);
  const along = diff.dot(fwd);
  const lateral = _v2.copy(diff).addScaledVector(fwd, -along);
  const speed0 = vel.length();

  if (mode === 'atmo') {
    // empuje limitado (≈ 2,5 g, 4 g con postcombustión) y frenado con aerofrenos + arrastre
    const aAcc = 25 * (1 + 0.6 * ship.boost) * auth;
    const aDec = 18 + 45 * Math.min(1, env.rho01 + 0.2) * Math.pow(Math.min(1, speed0 / Math.max(1, ship.vmax)), 2);
    const dv = clamp(along * expK(1.4 * auth, dt), -aDec * dt, aAcc * dt);
    vel.addScaledVector(fwd, dv);
    // la nariz arrastra la velocidad: poca deriva, más agarre con aire denso
    const kLat = (ship.autopilot ? 3.5 : 2.2 + 3 * Math.min(1, env.rho01 * 1.5)) * auth;
    vel.addScaledVector(lateral, expK(kLat, dt));
    // exceso de velocidad (reentrada): lo come el arrastre en unos segundos, sin recorte seco
    const s = vel.length();
    if (s > ship.vmax * 1.02) vel.setLength(ship.vmax + (s - ship.vmax) * (1 - expK(0.8 + 2.5 * env.rho01, dt)));
    return;
  }

  if (mode === 'impulse') {
    vel.addScaledVector(fwd, along * expK((along > 0 ? 0.9 : 1.4) * auth, dt));
    // asistencia de vuelo parcial: la deriva lateral se amortigua lento (el piloto automático corrige fuerte)
    vel.addScaledVector(lateral, expK(ship.autopilot ? 4 : 0.45, dt));
    // RCS: el strafe acelera, no fija la velocidad
    const aRcs = 0.15 * Math.min(ship.vmax, 20e3) * auth;
    vel.addScaledVector(axes.right, ship.strafe.x * aRcs * dt).addScaledVector(axes.up, ship.strafe.y * aRcs * dt);
  } else {
    vel.addScaledVector(fwd, along * expK(along > 0 ? 1.6 : 2.4, dt));
    vel.addScaledVector(lateral, expK(5, dt));
  }
  const spd = vel.length();
  if (spd > ship.vmax * 1.05) {
    if (spd > ship.vmax * 3 && spd > 3000) ship.events.push('slam');  // frenada brusca
    vel.setLength(ship.vmax * 1.05);
  }
}
