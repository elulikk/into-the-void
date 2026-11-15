// Propulsores de maniobra (RCS): soplidos cortos de gas cuando la nave gira o se
// desplaza de costado. Cada propulsor tiene posición y dirección de escape en el
// espacio local de la nave; se disparan según la aceleración angular y el strafe.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _v = new THREE.Vector3();
const GAS = new THREE.Color(1.6, 1.7, 1.9);

// Arma los propulsores a partir de la caja del modelo (o de la config del modelo).
// box: THREE.Box3 del modelo ya escalado/orientado.
export function defaultThrusters(box) {
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const zN = box.min.z + s.z * 0.18, zT = box.max.z - s.z * 0.12;
  const bx = s.x * 0.1, by = s.y * 0.3;
  const tip = s.x * 0.46;
  const T = (x, y, z, dx, dy, dz, tag) => ({ pos: new THREE.Vector3(c.x + x, c.y + y, z), dir: new THREE.Vector3(dx, dy, dz), tag });
  return [
    T(0, by, zN, 0, 1, 0, 'nose-top'), T(0, -by, zN, 0, -1, 0, 'nose-bottom'),
    T(bx, 0, zN, 1, 0, 0, 'nose-right'), T(-bx, 0, zN, -1, 0, 0, 'nose-left'),
    T(0, by, zT, 0, 1, 0, 'tail-top'), T(0, -by, zT, 0, -1, 0, 'tail-bottom'),
    T(bx * 1.5, 0, zT, 1, 0, 0, 'tail-right'), T(-bx * 1.5, 0, zT, -1, 0, 0, 'tail-left'),
    T(tip, 0, c.z + s.z * 0.1, 0, 1, 0, 'tipR-up'), T(tip, 0, c.z + s.z * 0.1, 0, -1, 0, 'tipR-down'),
    T(-tip, 0, c.z + s.z * 0.1, 0, 1, 0, 'tipL-up'), T(-tip, 0, c.z + s.z * 0.1, 0, -1, 0, 'tipL-down'),
  ];
}

export class RCS {
  constructor(thrusters, pool, scale = 1) {
    this.th = thrusters.map(t => ({ ...t, acc: 0 }));
    this.byTag = Object.fromEntries(this.th.map(t => [t.tag, t]));
    this.pool = pool;
    this.scale = scale;                 // tamaño de los soplidos según el tamaño de la nave
    this.prev = new THREE.Vector3();
    this.acc = new THREE.Vector3();
  }

  update(st, dt) {
    if (!(dt > 0)) return;
    const w = st.angVel;
    // aceleración angular suavizada (lo que realmente pide fuerza a los RCS)
    const a = _v.set((w.x - this.prev.x) / dt, (w.y - this.prev.y) / dt, (w.z - this.prev.z) / dt);
    if (!Number.isFinite(a.x + a.y + a.z)) a.set(0, 0, 0);
    this.prev.copy(w);
    this.acc.lerp(a, 1 - Math.exp(-20 * dt));
    const ax = this.acc.x * 0.6, ay = this.acc.y * 0.6, az = this.acc.z * 0.3;
    const fire = {};
    const add = (tag, v) => { if (v > 0) fire[tag] = (fire[tag] || 0) + v; };
    // cabeceo: nariz arriba → escape abajo en la nariz, arriba en la cola
    add('nose-bottom', ax); add('tail-top', ax); add('nose-top', -ax); add('tail-bottom', -ax);
    // guiñada (angVel.y > 0 = a la izquierda)
    add('nose-right', ay); add('tail-left', ay); add('nose-left', -ay); add('tail-right', -ay);
    // alabeo (angVel.z > 0 = el ala derecha sube)
    add('tipR-down', az); add('tipL-up', az); add('tipR-up', -az); add('tipL-down', -az);
    // desplazamiento lateral: el escape sale del lado contrario al movimiento
    const sx = st.strafe.x, sy = st.strafe.y;
    add('nose-left', sx * 0.7); add('tail-left', sx * 0.7); add('nose-right', -sx * 0.7); add('tail-right', -sx * 0.7);
    add('nose-bottom', sy * 0.7); add('tail-bottom', sy * 0.7); add('nose-top', -sy * 0.7); add('tail-top', -sy * 0.7);

    const S = this.scale;
    for (const t of this.th) {
      const f = Math.min(1.5, fire[t.tag] || 0);
      if (f < 0.04) { t.acc = 0; continue; }
      // ráfagas: pulsos de ~40 Hz, más soplidos cuanto más fuerte
      t.acc += f * 55 * dt;
      while (t.acc >= 1) {
        t.acc -= 1;
        _p.copy(t.pos).addScaledVector(t.dir, 0.2 * S);
        const sp = (14 + Math.random() * 10) * S;
        _v.copy(t.dir).multiplyScalar(sp);
        _v.x += (Math.random() - 0.5) * 4 * S; _v.y += (Math.random() - 0.5) * 4 * S; _v.z += (Math.random() - 0.5) * 4 * S;
        this.pool.emit(_p, _v, 0.18 + Math.random() * 0.15, GAS, 0.35 * Math.min(1, f), 0.25 * S, 1.6 * S, 4);
      }
    }
  }
}
