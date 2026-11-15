// Nave: modelo, modelo de vuelo arcade y supercrucero.
// La posición se guarda RELATIVA al cuerpo dominante (marco de referencia),
// así la nave acompaña a la Tierra/Luna/etc. aunque aceleres el tiempo.
import * as THREE from 'three';
import * as engines from './ship/engines.js';

export const C = 299792458;

function buildModel() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.6, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.5, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe0612b, metalness: 0.3, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223b55, metalness: 0.9, roughness: 0.1, emissive: 0x0a1a2a });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 12, 16), hull);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 16), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -8.5;
  g.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), glass);
  canopy.scale.set(0.9, 0.7, 2.0);
  canopy.position.set(0, 1.2, -4.5);
  g.add(canopy);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.35, 4.5), hull);
    wing.position.set(s * 4.8, -0.3, 2);
    wing.rotation.y = s * 0.35;
    g.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 3), accent);
    tip.position.set(s * 8.2, 0.4, 3.2);
    g.add(tip);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 5, 12), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 2.6, -0.5, 4.5);
    g.add(pod);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 3.5), accent);
  fin.position.set(0, 2.3, 4.5);
  g.add(fin);

  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x66ccff).multiplyScalar(2.5), transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (const x of [-2.6, 0, 2.6]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(x === 0 ? 1.2 : 0.7, 1, 12, 1, true), flameMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, x === 0 ? 0 : -0.5, 7);
    g.add(f);
    flames.push(f);
  }
  g.userData.flames = flames;
  g.userData.flameMat = flameMat;
  const engineLight = new THREE.PointLight(0x66ccff, 0, 40, 2);
  engineLight.position.set(0, 0, 9);
  g.add(engineLight);
  g.userData.engineLight = engineLight;
  return g;
}

// ---- parámetros de manejo: los rates y la respuesta por modo están en src/ship/engines.js
const ROLL_RATE = 2.6;                                  // sólo para normalizar el RCS del sonido
const STICK_PX = 260;                                   // px de mouse para llegar al tope del joystick virtual
const DEAD = 0.05;
const CLEARANCE = 10;                                  // m sobre el terreno real
const COROT_R = 3;                                      // co-rotar con el cuerpo por debajo de 3 R

const expK = (k, dt) => 1 - Math.exp(-k * dt);
function shape(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.pow((a - DEAD) / (1 - DEAD), 1.5);
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Ship {
  constructor(scene) {
    this.model = buildModel();
    scene.add(this.model);
    this.frame = null;                     // cuerpo de referencia
    this.local = new THREE.Vector3();      // posición relativa al marco (m)
    this.world = new THREE.Vector3();      // posición absoluta (m)
    this.vel = new THREE.Vector3();        // velocidad relativa al marco (m/s)
    this.quat = new THREE.Quaternion();
    this.throttle = 0;                     // -0.25 .. 1
    this.speedFactor = 1;                  // multiplicador (rueda del mouse)
    this.vmax = 0;
    this.autopilot = false;
    this.target = null;
    this.thirdPerson = true;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.mouseMode = 'stick';              // 'stick' (joystick virtual) | 'direct'
    this.stick = new THREE.Vector2();      // -1..1, posición del joystick virtual
    this.angVel = new THREE.Vector3();     // rad/s en ejes locales (x cabeceo, y guiñada, z alabeo)
    this.boost = 0;                        // 0..1 con rampa
    this.cruise = 'off';                   // 'off' | 'charging' | 'on'
    this.cruiseCharge = 0;                 // 0..1
    this.engineMode = 'impulse';           // 'atmo' | 'impulse' | 'cruise' (ver src/ship/engines.js)
    this.engineTransition = 1;             // 0..1: spool del modo actual (en crucero = carga)
    this.engineEnv = null;                 // entorno del último cuadro (aire, zona atmosférica…)
    this.reentry = 0;                      // 0..1: calor de reentrada / buffeting
    this.mach = 0;                         // velocidad / velocidad del sonido local (0 sin aire)
    this.events = [];                      // eventos para cámara/sonido ('cruise-on', 'cruise-drop', ...)
    this.strafe = new THREE.Vector2();
    this.visualTilt = new THREE.Vector3(); // inclinación cosmética del modelo
    this.status = '';
  }

  place(frame, localPos, lookAtWorld) {
    this.frame = frame;
    this.local.copy(localPos);
    this.world.copy(frame.pos).add(localPos);
    const m = new THREE.Matrix4().lookAt(this.world, lookAtWorld, new THREE.Vector3(0, 1, 0));
    this.quat.setFromRotationMatrix(m);
    this.vel.set(0, 0, 0);
  }

  // Co-rotación: cerca de un cuerpo con terreno, la nave gira con él (si no, el suelo
  // "patina" por debajo: 460 m/s en el ecuador terrestre, y peor con aceleración temporal).
  // Devuelve el cuaternión aplicado (o null) para que la cámara gire igual.
  coRotate() {
    const b = this.frame;
    if (!b?.recipe || !b.dSpin || this.local.length() > COROT_R * b.R) return null;
    _q.setFromAxisAngle(b.poleWorld, b.dSpin);
    this.local.applyQuaternion(_q);
    this.vel.applyQuaternion(_q);
    this.quat.premultiply(_q).normalize();
    this.world.copy(b.pos).add(this.local);
    return _q;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  recenter() { this.stick.set(0, 0); }

  toggleCruise() { engines.toggleCruise(this); }
  dropCruise(reason) { engines.dropCruise(this, reason); }
  setEngineMode(mode) { return engines.requestMode(this, mode); }
  cycleEngineMode() { return engines.cycleMode(this); }

  update(dt, system, pad = null) {
    this.system = system;
    const k = this.keys;
    const key = c => (k.has(c) ? 1 : 0);

    // ================= rotación =================
    let pitchIn = key('ArrowUp') - key('ArrowDown');   // + = nariz arriba
    let yawIn = key('ArrowRight') - key('ArrowLeft');   // + = a la derecha
    let rollIn = key('KeyE') - key('KeyQ');             // + = alabeo a la derecha
    let directRate = null;
    if (this.mouseMode === 'stick') {
      this.stick.x += this.mouse.dx / STICK_PX;
      this.stick.y += this.mouse.dy / STICK_PX;
      if (this.stick.lengthSq() > 1) this.stick.normalize();
      pitchIn += -shape(this.stick.y);
      yawIn += shape(this.stick.x);
    } else if (dt > 0) {
      // mouse directo: el desplazamiento se convierte en velocidad angular
      directRate = new THREE.Vector2(-this.mouse.dy * 0.0022 / dt, -this.mouse.dx * 0.0022 / dt);
    }
    this.mouse.dx = this.mouse.dy = 0;
    if (pad) { pitchIn += pad.pitch; yawIn += pad.yaw; rollIn += pad.roll; }
    pitchIn = THREE.MathUtils.clamp(pitchIn, -1, 1);
    yawIn = THREE.MathUtils.clamp(yawIn, -1, 1);
    rollIn = THREE.MathUtils.clamp(rollIn, -1, 1);

    const steering = Math.abs(pitchIn) + Math.abs(yawIn) + Math.abs(rollIn) > 0.02 ||
      (directRate && directRate.lengthSq() > 1e-4);
    if (steering && this.autopilot) this.disengage('rumbo manual');

    const near = system.nearestSurface(this.world);
    this.nearest = near;

    const env = engines.engineEnv(near);
    const vTarget = engines.stepEngines(this, dt, env);

    if (!this.autopilot) {
      const { target, resp } = engines.rotationTarget(this, env, { pitch: pitchIn, yaw: yawIn, roll: rollIn });
      if (directRate) { target.x += directRate.x; target.y += directRate.y; }
      const r = directRate ? 25 : 0;
      this.angVel.x += (target.x - this.angVel.x) * expK(r || resp.pitch, dt);
      this.angVel.y += (target.y - this.angVel.y) * expK(r || resp.yaw, dt);
      this.angVel.z += (target.z - this.angVel.z) * expK(resp.roll, dt);
      _q.setFromEuler(_e.set(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'YXZ'));
      this.quat.multiply(_q).normalize();
    }

    // ================= acelerador y boost (la carga del crucero está en engines.js) =================
    const thrUp = key('KeyW') + (pad && pad.throttle > 0.1 ? pad.throttle : 0);
    const thrDn = key('KeyS') + (pad && pad.throttle < -0.1 ? -pad.throttle : 0);
    if (thrUp || thrDn) {
      this.throttle = THREE.MathUtils.clamp(this.throttle + (thrUp - thrDn) * dt * 0.8, -0.25, 1);
      if (this.autopilot) this.disengage('acelerador');
    }
    const boosting = key('ShiftLeft') || key('ShiftRight') || (pad && pad.boost);
    this.boost += ((boosting ? 1 : 0) - this.boost) * expK(boosting ? 2.5 : 1.5, dt);

    // subir suave (no hay saltos al cambiar de cuerpo), bajar inmediato (no chocar)
    if (!this.vmax || vTarget < this.vmax) this.vmax = vTarget;
    else this.vmax += (vTarget - this.vmax) * expK(1.5, dt);

    // ================= velocidad (según el modo de motor, ver engines.js) =================
    const fwd = this.forward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    this.strafe.set(key('KeyD') - key('KeyA'), key('KeyR') - key('KeyF'));
    if (pad) { this.strafe.x += pad.strafeX; this.strafe.y += pad.strafeY; }
    this.strafe.clampScalar(-1, 1);

    const axes = { fwd, right, up: upV };
    const desired = this.autopilot && this.target ? this.autopilotStep(dt, fwd)
      : engines.manualDesired(this, env, axes);
    engines.integrateVelocity(this, dt, desired, env, axes);

    this.local.addScaledVector(this.vel, dt);
    this.world.copy(this.frame.pos).add(this.local);

    // ================= colisión con superficies (relieve real si el cuerpo tiene terreno) =================
    for (const b of system.bodies) {
      const d = this.world.distanceTo(b.pos);
      if (d > b.R + (b.recipe ? b.recipe.maxH : 0) + 1000) continue;
      const minD = b.recipe ? system.surfaceRadius(b, this.world) + CLEARANCE : b.R + 15;
      if (d < minD) {
        const n = new THREE.Vector3().subVectors(this.world, b.pos).normalize();
        this.world.copy(b.pos).addScaledVector(n, minD);
        const vn = this.vel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -vn);
        this.local.subVectors(this.world, this.frame.pos);
        if (this.cruise !== 'off') this.dropCruise('superficie');
      }
    }

    // ================= cambio de marco de referencia (SOI) =================
    const dom = system.dominantBody(this.world);
    if (dom !== this.frame) {
      this.frame = dom;
      this.local.subVectors(this.world, dom.pos);
    }

    // ================= inclinación cosmética del modelo =================
    const tilt = new THREE.Vector3(
      this.angVel.x * 0.12,
      0,
      this.angVel.y * 0.45 - this.strafe.x * 0.18,
    );
    this.visualTilt.lerp(tilt, expK(6, dt));

    // ================= efectos de motor =================
    const thrust = Math.max(0, this.autopilot ? this.vel.length() / Math.max(1, this.vmax) : this.throttle);
    const fl = 0.3 + thrust * 6 * (1 + this.boost * 0.8);
    for (const f of this.model.userData.flames) {
      f.scale.set(1 + this.boost * 0.3, fl * (0.9 + Math.random() * 0.2), 1 + this.boost * 0.3);
      f.position.z = 7 + f.scale.y * 0.5;
    }
    this.model.userData.flameMat.opacity = 0.2 + thrust * 0.7;
    this.model.userData.engineLight.intensity = thrust * 40 * (1 + this.boost);
  }

  // cuaternión con el que se dibuja el modelo (física + inclinación cosmética)
  renderQuat(out = new THREE.Quaternion()) {
    _q.setFromEuler(_e.set(this.visualTilt.x, 0, this.visualTilt.z, 'YXZ'));
    return out.copy(this.quat).multiply(_q);
  }

  autopilotStep(dt, fwd) {
    const t = this.target;
    const toT = new THREE.Vector3().subVectors(t.pos, this.world);
    const dist = toT.length();
    const stopDist = t.R * 3 + 200;
    const remaining = dist - stopDist;
    let dir = toT.clone().normalize();
    // desvío: si un cuerpo se interpone en la línea recta, apuntar a un punto a su costado
    let aim = t.pos;
    for (const b of this.system.bodies) {
      if (b === t) continue;
      const rel = new THREE.Vector3().subVectors(b.pos, this.world);
      const al = rel.dot(dir);
      if (al <= 0 || al >= dist) continue;
      const closest = this.world.clone().addScaledVector(dir, al);
      const off = new THREE.Vector3().subVectors(closest, b.pos);
      if (off.length() > b.R * 1.6) continue;
      if (off.lengthSq() < 1) off.set(0, 1, 0).applyQuaternion(this.quat);
      aim = b.pos.clone().addScaledVector(off.normalize(), b.R * 2.5);
      dir = new THREE.Vector3().subVectors(aim, this.world).normalize();
      break;
    }
    // orientar hacia el objetivo (o el punto de desvío), guardando la velocidad angular para la cámara
    const m = new THREE.Matrix4().lookAt(this.world, aim, new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const before = this.quat.clone();
    this.quat.slerp(q, expK(2.5, dt));
    const dq = before.invert().multiply(this.quat);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
    const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
    if (axis.lengthSq() > 1e-12 && dt > 0) this.angVel.copy(axis.normalize().multiplyScalar(Math.sign(dq.w) * ang / dt));
    else this.angVel.set(0, 0, 0);

    const align = fwd.dot(dir);
    if (remaining < Math.max(20, t.R * 0.02) && this.vel.length() < Math.max(50, remaining)) {
      this.disengage(`llegada a ${t.name}`);
      this.dropCruise('llegada');
      this.status = `Llegada a ${t.name}`;
      this.vel.set(0, 0, 0);
      return new THREE.Vector3();
    }
    const speed = Math.min(this.vmax, Math.max(0, remaining) * 1.2) * Math.max(0, (align - 0.9) * 10);
    this.status = this.cruise === 'charging' ? `Piloto automático → ${t.name} · cargando supercrucero…`
      : `Piloto automático → ${t.name}`;
    return dir.multiplyScalar(speed * Math.sign(remaining));
  }

  engage() {
    if (!this.target) return;
    this.autopilot = true;
    this.throttle = 0;
    this.recenter();
    this.status = `Piloto automático → ${this.target.name}`;
  }

  disengage(reason) {
    this.autopilot = false;
    this.status = `Piloto automático desactivado (${reason})`;
  }

  // estado para el sonido (src/audio.js)
  audioState() {
    const b = this.nearest?.body;
    const atmo = b && b.atmo ? Math.exp(-Math.max(0, this.nearest.alt) / (b.R * 0.0015)) : 0;
    return {
      throttle: Math.max(0, this.throttle),
      speed01: Math.min(1, this.vel.length() / Math.max(1, this.vmax)),
      boost: this.boost,
      cruiseCharge: this.cruise === 'charging' ? this.cruiseCharge : 0,
      cruiseActive: this.cruise === 'on',
      turnRate: Math.min(1, this.angVel.length() / 2),
      rcs: Math.min(1, this.strafe.length() + Math.abs(this.angVel.z) / ROLL_RATE * 0.5),
      atmoDensity: Math.min(1, atmo),
      engineMode: this.engineMode,             // 'atmo' | 'impulse' | 'cruise'
      engineTransition: this.engineTransition, // 0..1
      reentry: this.reentry,                   // 0..1
      mach: this.mach,
    };
  }
}
