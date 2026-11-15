// Cámara de persecución: sigue a la nave con resorte, se adelanta hacia el giro,
// tiembla con el boost/supercrucero y permite vista libre alrededor de la nave.
import * as THREE from 'three';

const expK = (k, dt) => 1 - Math.exp(-k * dt);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

export class ChaseCamera {
  constructor(baseFov = 65) {
    this.baseFov = baseFov;
    this.fov = baseFov;
    this.quat = new THREE.Quaternion();     // orientación final de la cámara
    this.lagQuat = new THREE.Quaternion();  // orientación con retraso (sin vista libre ni temblor)
    this.world = new THREE.Vector3();       // posición absoluta (doubles)
    this.offset = new THREE.Vector3(0, 9, 42);
    this.look = new THREE.Vector2();        // vista libre (yaw, pitch)
    this.freelook = false;
    this.shake = 0;
    this.time = 0;
    this.ready = false;
  }

  addShake(a) { this.shake = Math.max(this.shake, a); }

  freelookInput(dx, dy) {
    this.look.x = THREE.MathUtils.clamp(this.look.x - dx * 0.004, -Math.PI * 0.95, Math.PI * 0.95);
    this.look.y = THREE.MathUtils.clamp(this.look.y - dy * 0.004, -1.3, 1.3);
  }

  update(dt, ship) {
    this.time += dt;
    if (!this.ready) { this.lagQuat.copy(ship.quat); this.ready = true; }

    for (const ev of ship.events) {
      if (ev === 'cruise-on') this.addShake(0.9);
      if (ev === 'cruise-drop') this.addShake(0.7);
      if (ev === 'slam') this.addShake(0.5);
    }

    const third = ship.thirdPerson;
    this.lagQuat.slerp(ship.quat, expK(third ? 5 : 22, dt));

    // desplazamiento de la cámara en ejes de la cámara
    const av = ship.angVel;
    let target;
    if (third) {
      target = _v.set(
        -av.y * 7 + ship.strafe.x * 2,            // adelantarse hacia el lado del giro
        9 + av.x * 5 + ship.strafe.y * 1.5,
        42 + ship.boost * 10 + (ship.cruise === 'on' ? 6 : 0),
      );
    } else {
      target = _v.set(0, 1.2, -5.5);
    }
    this.offset.lerp(target, expK(third ? 4 : 30, dt));

    // vista libre: vuelve sola al centro al soltar
    if (!this.freelook) this.look.multiplyScalar(1 - expK(4, dt));

    this.quat.copy(this.lagQuat);
    if (Math.abs(this.look.x) + Math.abs(this.look.y) > 1e-4) {
      this.quat.multiply(_q.setFromEuler(_e.set(this.look.y, this.look.x, 0, 'YXZ')));
    }
    this.world.copy(this.offset).applyQuaternion(this.quat).add(ship.world);

    // temblor: carga del supercrucero, boost y eventos
    const charging = ship.cruise === 'charging' ? ship.cruiseCharge : 0;
    const sustained = charging * 0.5 + ship.boost * 0.12;
    this.shake *= 1 - expK(2.5, dt);
    const s = Math.max(this.shake, sustained);
    if (s > 0.002) {
      const t = this.time;
      const a = s * 0.006;
      this.quat.multiply(_q.setFromEuler(_e.set(
        Math.sin(t * 37.1) * a + Math.sin(t * 61.7) * a * 0.5,
        Math.sin(t * 43.3 + 1) * a,
        Math.sin(t * 29.9 + 2) * a * 0.7, 'YXZ')));
    }

    // FOV dinámico
    const speed01 = Math.min(1, ship.vel.length() / Math.max(1, ship.vmax));
    const fovT = this.baseFov + speed01 * Math.max(0, ship.throttle) * 6 + ship.boost * 12 +
      (ship.cruise === 'on' ? 8 * speed01 : 0) - charging * 4;
    this.fov += (fovT - this.fov) * expK(3, dt);
  }
}
