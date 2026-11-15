// Nave: modelo, controles y "supercrucero" adaptativo.
// La posición se guarda RELATIVA al cuerpo dominante (marco de referencia),
// así la nave acompaña a la Tierra/Luna/etc. aunque aceleres el tiempo.
import * as THREE from 'three';

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

  const flameMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8,
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
    this.speedFactor = 1;                  // multiplicador del supercrucero
    this.vmax = 0;
    this.autopilot = false;
    this.target = null;
    this.thirdPerson = true;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.angVel = new THREE.Vector3();
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

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  update(dt, system) {
    this.system = system;
    const k = this.keys;
    // ---- rotación (mouse + Q/E, o flechas)
    const inp = new THREE.Vector3(
      -this.mouse.dy * 0.0022 + ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 1.2 * dt,
      -this.mouse.dx * 0.0022 + ((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * 1.2 * dt,
      ((k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0)) * 1.6 * dt,
    );
    this.mouse.dx = this.mouse.dy = 0;
    const manualTurn = inp.lengthSq() > 1e-7;
    if (manualTurn && this.autopilot && inp.lengthSq() > 1e-4) this.disengage('rumbo manual');
    this.angVel.lerp(inp, Math.min(1, dt * 18));
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.angVel.x, this.angVel.y, this.angVel.z, 'YXZ'));
    this.quat.multiply(dq).normalize();

    // ---- acelerador
    if (k.has('KeyW')) { this.throttle = Math.min(1, this.throttle + dt * 0.6); if (this.autopilot) this.disengage('acelerador'); }
    if (k.has('KeyS')) { this.throttle = Math.max(-0.25, this.throttle - dt * 0.6); if (this.autopilot) this.disengage('acelerador'); }

    // ---- supercrucero: la velocidad máxima escala con la altitud al cuerpo más cercano
    const near = system.nearestSurface(this.world);
    this.nearest = near;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
    this.vmax = Math.max(30, near.alt * 0.75) * this.speedFactor * boost;

    const fwd = this.forward();
    let desired = new THREE.Vector3();
    if (this.autopilot && this.target) {
      desired = this.autopilotStep(dt, fwd);
    } else {
      desired.copy(fwd).multiplyScalar(this.throttle * this.vmax);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
      const strafe = 0.35 * this.vmax;
      if (k.has('KeyD')) desired.addScaledVector(right, strafe);
      if (k.has('KeyA')) desired.addScaledVector(right, -strafe);
      if (k.has('KeyR')) desired.addScaledVector(up, strafe);
      if (k.has('KeyF')) desired.addScaledVector(up, -strafe);
    }
    // asistencia de vuelo: la velocidad converge a la deseada
    this.vel.lerp(desired, Math.min(1, dt * 3));
    if (this.vel.length() > this.vmax * 1.05) this.vel.setLength(this.vmax * 1.05);

    this.local.addScaledVector(this.vel, dt);
    this.world.copy(this.frame.pos).add(this.local);

    // ---- colisión simple con superficies
    for (const b of system.bodies) {
      const d = this.world.distanceTo(b.pos);
      const minD = b.R + 15;
      if (d < minD) {
        const n = new THREE.Vector3().subVectors(this.world, b.pos).normalize();
        this.world.copy(b.pos).addScaledVector(n, minD);
        const vn = this.vel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -vn);
        this.local.subVectors(this.world, this.frame.pos);
      }
    }

    // ---- cambio de marco de referencia (SOI)
    const dom = system.dominantBody(this.world);
    if (dom !== this.frame) {
      this.frame = dom;
      this.local.subVectors(this.world, dom.pos);
    }

    // ---- efectos de motor
    const thrust = Math.max(0, this.autopilot ? this.vel.length() / Math.max(1, this.vmax) : this.throttle);
    for (const f of this.model.userData.flames) {
      f.scale.set(1, 0.3 + thrust * 6 * (0.9 + Math.random() * 0.2), 1);
      f.position.z = 7 + f.scale.y * 0.5;
    }
    this.model.userData.flameMat.opacity = 0.2 + thrust * 0.7;
    this.model.userData.engineLight.intensity = thrust * 40;
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
      const along = rel.dot(dir);
      if (along <= 0 || along >= dist) continue;
      const closest = this.world.clone().addScaledVector(dir, along);
      const off = new THREE.Vector3().subVectors(closest, b.pos);
      if (off.length() > b.R * 1.6) continue;
      if (off.lengthSq() < 1) off.set(0, 1, 0).applyQuaternion(this.quat);
      aim = b.pos.clone().addScaledVector(off.normalize(), b.R * 2.5);
      dir = new THREE.Vector3().subVectors(aim, this.world).normalize();
      break;
    }
    // orientar hacia el objetivo (o el punto de desvío)
    const m = new THREE.Matrix4().lookAt(this.world, aim, new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.quat.slerp(q, Math.min(1, dt * 2.5));
    const align = fwd.dot(dir);
    if (remaining < Math.max(20, t.R * 0.02) && this.vel.length() < Math.max(50, remaining)) {
      this.disengage(`llegada a ${t.name}`);
      this.vel.set(0, 0, 0);
      return new THREE.Vector3();
    }
    const speed = Math.min(this.vmax, Math.max(0, remaining) * 1.2) * Math.max(0, (align - 0.9) * 10);
    this.status = `Piloto automático → ${t.name}`;
    return dir.multiplyScalar(speed * Math.sign(remaining));
  }

  engage() {
    if (!this.target) return;
    this.autopilot = true;
    this.throttle = 0;
    this.status = `Piloto automático → ${this.target.name}`;
  }

  disengage(reason) {
    this.autopilot = false;
    this.status = `Piloto automático desactivado (${reason})`;
  }

  cameraOffset() {
    return this.thirdPerson ? new THREE.Vector3(0, 9, 42) : new THREE.Vector3(0, 1.2, -5.5);
  }
}
