// Escape de los motores: penacho con núcleo caliente + halo frío, diamantes de choque
// al acelerar fuerte, brillo de tobera, chispas y la carga/estallido del supercrucero.
// Todo vive en el espacio local de la nave: +Z es hacia atrás (la nave mira a -Z).
import * as THREE from 'three';
import { glowSprite } from './particles.js';

// Colores por modo de motor: [núcleo, halo] (HDR, se multiplican por la intensidad)
const MODES = {
  atmo:    { core: new THREE.Color(1.0, 0.82, 0.55), halo: new THREE.Color(1.0, 0.38, 0.1), len: 0.75, diamonds: 1.0 },
  impulse: { core: new THREE.Color(0.85, 0.93, 1.0), halo: new THREE.Color(0.25, 0.55, 1.0), len: 1.0, diamonds: 0.7 },
  cruise:  { core: new THREE.Color(0.95, 0.9, 1.0), halo: new THREE.Color(0.55, 0.35, 1.0), len: 1.4, diamonds: 0.3 },
};

const plumeVertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uLen, uR0, uFlare, uDiamond, uDiamondN;
  varying float vT;
  varying vec3 vN, vV;
  void main() {
    float t = position.z;                         // 0 en la tobera, 1 en la punta
    float pinch = 1.0 - 0.28 * uDiamond * pow(abs(sin(t * 3.14159 * uDiamondN)), 2.0) * (1.0 - t);
    float r = uR0 * (1.0 + uFlare * t) * pinch * (1.0 - 0.85 * t * t);
    vec3 p = vec3(position.xy * r, t * uLen);
    vT = t;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * vec3(normal.xy, 0.0));
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const plumeFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCore, uHalo;
  uniform float uI, uTime, uDiamond, uDiamondN, uCoreMix;
  varying float vT;
  varying vec3 vN, vV;
  void main() {
    #include <logdepthbuf_fragment>
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float t = vT;
    float body = pow(facing, 1.6) * smoothstep(0.0, 0.04, t) * pow(1.0 - t, 1.4);
    // diamantes de choque: nudos brillantes y blancos que se repiten a lo largo del penacho
    float d = pow(abs(cos(t * 3.14159 * uDiamondN)), 14.0) * uDiamond * (1.0 - t) * facing;
    float flick = 0.85 + 0.15 * sin(t * 37.0 - uTime * 71.0) * sin(t * 13.0 - uTime * 43.0 + 1.7);
    vec3 col = mix(uHalo, uCore, clamp(uCoreMix * (1.0 - t) * facing, 0.0, 1.0));
    col = col * body * flick + vec3(1.0, 0.95, 0.9) * d * 2.5;
    float a = clamp(body * flick + d, 0.0, 1.0);
    gl_FragColor = vec4(col * uI, a * min(uI, 1.0));
  }`;

let _plumeGeo = null;
function plumeGeometry() {
  if (_plumeGeo) return _plumeGeo;
  // cilindro de radio 1 y z de 0 a 1 (el shader le da la forma)
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 24, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  _plumeGeo = g;
  return g;
}

function plumeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: plumeVertex, fragmentShader: plumeFragment,
    uniforms: {
      uLen: { value: 1 }, uR0: { value: 1 }, uFlare: { value: 0.4 }, uDiamond: { value: 0 }, uDiamondN: { value: 4 },
      uCore: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() }, uI: { value: 0 }, uTime: { value: 0 },
      uCoreMix: { value: 1 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const smooth = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

export class Exhaust {
  // nozzles: [{ pos: Vector3, r: radio de la tobera (m) }]
  constructor(parent, nozzles, pool) {
    this.pool = pool;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.core = new THREE.Color(); this.halo = new THREE.Color();
    this.core.copy(MODES.impulse.core); this.halo.copy(MODES.impulse.halo);
    this.lenMode = 1; this.diaMode = 0.7;
    this.thrust = 0; this.burst = 0; this.prevCruise = 'off';
    this.emitAcc = 0;
    this.nozzles = nozzles.map(n => {
      const halo = new THREE.Mesh(plumeGeometry(), plumeMaterial());
      const core = new THREE.Mesh(plumeGeometry(), plumeMaterial());
      for (const m of [halo, core]) { m.position.copy(n.pos); m.frustumCulled = false; m.renderOrder = 9; this.group.add(m); }
      const glow = glowSprite(new THREE.Color(), n.r * 4);
      glow.position.copy(n.pos);
      this.group.add(glow);
      return { ...n, halo, core, glow };
    });
    // luz del motor (ilumina la propia nave y lo que esté cerca)
    const c = new THREE.Vector3();
    for (const n of nozzles) c.add(n.pos);
    c.divideScalar(Math.max(1, nozzles.length));
    this.light = new THREE.PointLight(0x66ccff, 0, 60, 2);
    this.light.position.copy(c).add(new THREE.Vector3(0, 0, 3));
    this.group.add(this.light);
    // destello del arranque del supercrucero
    this.flash = glowSprite(new THREE.Color(), 1);
    this.flash.position.copy(c).add(new THREE.Vector3(0, 0, 2));
    this.flash.visible = false;
    this.group.add(this.flash);
  }

  dispose() { this.group.parent?.remove(this.group); }

  update(st, dt, time) {
    const mode = MODES[st.engineMode] || MODES.impulse;
    const k = 1 - Math.exp(-3 * dt);
    this.core.lerp(mode.core, k); this.halo.lerp(mode.halo, k);
    this.lenMode = smooth(this.lenMode, mode.len, 3, dt);
    this.diaMode = smooth(this.diaMode, mode.diamonds, 3, dt);

    // empuje con algo de inercia (los motores no se encienden instantáneo)
    const target = Math.max(0, Math.min(1, st.throttle));
    this.thrust = smooth(this.thrust, target, target > this.thrust ? 6 : 3, dt);
    const T = this.thrust, B = st.boost;
    const cruiseOn = st.cruise === 'on';
    const charge = st.cruise === 'charging' ? st.cruiseCharge : 0;

    // estallido al entrar en supercrucero
    if (cruiseOn && this.prevCruise !== 'on') this.burst = 1;
    this.prevCruise = st.cruise;
    this.burst = Math.max(0, this.burst - dt * 1.4);
    const burstE = this.burst * this.burst;

    // diamantes: aparecen con empuje alto, mucho más con boost
    const dia = this.diaMode * THREE.MathUtils.smoothstep(T + B * 0.5, 0.55, 1.2) * (0.6 + 0.4 * B);
    const idle = 0.08;
    const I = idle + T * (1.4 + B * 1.2) + (cruiseOn ? 0.6 * st.speed01 : 0) + charge * 0.8 + burstE * 3;

    for (const n of this.nozzles) {
      const L = n.r * (1.5 + T * 9 * this.lenMode * (1 + B * 0.7) + burstE * 10 + (cruiseOn ? 4 : 0));
      const flick = 0.94 + Math.random() * 0.12;
      for (const [m, rMul, lMul, coreMix, iMul] of [[n.halo, 1.25, 1.0, 0.25, 0.55], [n.core, 0.55, 0.55, 1.0, 1.3]]) {
        const u = m.material.uniforms;
        u.uLen.value = L * lMul * flick;
        u.uR0.value = n.r * rMul * (1 + B * 0.15);
        u.uFlare.value = 0.5 - T * 0.3;
        u.uDiamond.value = m === n.core ? dia : dia * 0.4;
        u.uDiamondN.value = 3.5 + T * 2;
        u.uCore.value.copy(this.core); u.uHalo.value.copy(this.halo);
        u.uCoreMix.value = coreMix;
        u.uI.value = I * iMul;
        u.uTime.value = time;
        m.visible = I > 0.01;
      }
      // brillo de la tobera: se carga con el supercrucero (pulsa) y sigue al empuje
      const pulse = charge > 0 ? 0.6 + 0.4 * Math.sin(time * (8 + charge * 30)) : 1;
      const gI = (0.25 + T * 1.2 + B * 0.8 + charge * 2.5 * pulse + burstE * 4);
      _c.copy(this.halo).lerp(this.core, 0.5).multiplyScalar(gI);
      n.glow.material.color.copy(_c);
      n.glow.scale.setScalar(n.r * (2.5 + T * 2 + charge * 3 * pulse + burstE * 8));
    }

    this.light.color.copy(this.halo).lerp(this.core, 0.3);
    this.light.intensity = (T * 60 + B * 60 + charge * 40 + burstE * 400) * (0.9 + Math.random() * 0.2);

    this.flash.visible = burstE > 0.01;
    if (this.flash.visible) {
      this.flash.material.color.copy(this.core).multiplyScalar(6 * burstE);
      this.flash.scale.setScalar(10 + (1 - this.burst) * 60);
    }

    this.emitParticles(st, dt, T, B, charge, burstE);
  }

  emitParticles(st, dt, T, B, charge, burstE) {
    const pool = this.pool;
    // chispas/calor que salen de la tobera
    const rate = (T * 90 + B * 120) * this.nozzles.length;
    this.emitAcc += rate * dt;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const n = this.nozzles[(Math.random() * this.nozzles.length) | 0];
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * n.r * 0.7;
      _p.set(n.pos.x + Math.cos(a) * rr, n.pos.y + Math.sin(a) * rr, n.pos.z + 0.2);
      const sp = 60 + T * 140 + B * 120;
      _v.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, sp * (0.7 + Math.random() * 0.6));
      _c.copy(this.core).lerp(this.halo, Math.random()).multiplyScalar(2 + B * 2);
      pool.emit(_p, _v, 0.12 + Math.random() * 0.18, _c, 0.8, n.r * 0.35, n.r * 0.9, 1.5);
    }
    // carga del supercrucero: partículas que espiralan hacia las toberas
    if (charge > 0) {
      const m = Math.floor(charge * 60 * dt * 10 + Math.random());
      for (let i = 0; i < m; i++) {
        const n = this.nozzles[(Math.random() * this.nozzles.length) | 0];
        const a = Math.random() * Math.PI * 2, R = n.r * (3 + Math.random() * 3);
        _p.set(n.pos.x + Math.cos(a) * R, n.pos.y + Math.sin(a) * R, n.pos.z + 1 + Math.random() * 3);
        const life = 0.35;
        // velocidad hacia el centro de la tobera con un giro tangencial
        _v.set(n.pos.x - _p.x, n.pos.y - _p.y, n.pos.z - _p.z).multiplyScalar(1 / life);
        _v.x += -Math.sin(a) * R * 4; _v.y += Math.cos(a) * R * 4;
        _c.copy(this.core).multiplyScalar(3);
        pool.emit(_p, _v, life, _c, 0.9, n.r * 0.25, n.r * 0.08, 0);
      }
    }
    // estallido: anillo de plasma que se expande desde la cola
    if (burstE > 0.95) {
      for (const n of this.nozzles) {
        for (let i = 0; i < 70; i++) {
          const a = (i / 70) * Math.PI * 2;
          _p.copy(n.pos);
          _v.set(Math.cos(a) * 45, Math.sin(a) * 45, 25 + Math.random() * 20);
          _c.copy(this.halo).lerp(this.core, 0.5).multiplyScalar(4);
          pool.emit(_p, _v, 0.7, _c, 1, n.r * 0.8, n.r * 3, 2.5);
        }
      }
    }
  }
}
