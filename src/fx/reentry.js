// Entrada atmosférica: plasma sobre el borde de ataque (una "cáscara" que copia la
// geometría de la nave, apenas inflada), onda de choque delante y chispas/estelas.
// La intensidad sale de la densidad del aire × velocidad³ (calentamiento aerodinámico).
import * as THREE from 'three';
import { airAt, RHO_EARTH } from '../air.js';

// Densidad relativa a la Tierra al nivel del mar (≈1,2 kg/m³), del modelo físico único (src/air.js).
export function atmoDensity(nearest) {
  const b = nearest?.body;
  if (!b || !Number.isFinite(nearest.alt)) return 0;
  return Math.min(2, airAt(b, nearest.alt).rho / RHO_EARTH);
}

// intensidad del plasma 0..1: densidad × (v / 1 km/s)³
export function heatLevel(density, speed) {
  const q = density * Math.pow(Math.max(0, speed) / 1000, 3);
  const x = Math.max(0, q - 0.004) / 0.08;
  return Math.min(1, Math.pow(x, 0.7));
}

const shellVertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uInflate;
  uniform vec3 uVelW;
  varying float vLead;
  varying vec3 vNw, vVw;
  void main() {
    vec3 p = position + normal * uInflate;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNw = normalize(mat3(modelMatrix) * normal);
    vVw = cameraPosition - wp.xyz;
    vLead = dot(vNw, uVelW);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const shellFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uI, uTime;
  varying float vLead;
  varying vec3 vNw, vVw;
  void main() {
    #include <logdepthbuf_fragment>
    float lead = clamp(vLead, 0.0, 1.0);
    float rim = 1.0 - abs(dot(normalize(vNw), normalize(vVw)));
    float n = 0.75 + 0.25 * sin(vLead * 40.0 - uTime * 25.0) * sin(gl_FragCoord.x * 0.05 + uTime * 9.0);
    float k = (pow(lead, 2.5) * 2.0 + pow(rim, 3.0) * 0.6 * lead) * n;
    vec3 col = mix(vec3(1.0, 0.35, 0.12), vec3(1.0, 0.75, 0.55), lead) * 3.0;
    col = mix(col, vec3(1.0, 0.4, 0.8) * 3.0, smoothstep(0.6, 1.0, uI) * 0.4);
    float a = clamp(k * uI, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
  }`;

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();

export class Reentry {
  // root: grupo de la nave (para la orientación); box: caja del modelo en espacio local
  constructor(root, pool) {
    this.root = root;
    this.pool = pool;
    this.uniforms = { uInflate: { value: 0.15 }, uVelW: { value: new THREE.Vector3(0, 0, -1) }, uI: { value: 0 }, uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: shellVertex, fragmentShader: shellFragment, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.shells = [];
    this.I = 0;
    this.acc = 0;
    // onda de choque: casquete delante de la nave, orientado según la velocidad
    const g = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
    g.rotateX(-Math.PI / 2);                      // el polo mira a -Z
    this.bow = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: shellVertex.replace('position + normal * uInflate', 'position'),
      fragmentShader: shellFragment, uniforms: { ...this.uniforms, uInflate: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.bow.frustumCulled = false;
    this.bow.visible = false;
    root.add(this.bow);
  }

  // Crea las cáscaras de plasma sobre las mallas del modelo (comparten geometría)
  attach(model, box) {
    for (const s of this.shells) s.parent?.remove(s);
    this.shells = [];
    this.box = box.clone();
    this.size = box.getSize(new THREE.Vector3());
    this.center = box.getCenter(new THREE.Vector3());
    this.uniforms.uInflate.value = 0.012 * this.size.length();
    const meshes = [];
    model.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.geometry?.attributes.normal) meshes.push(o); });
    for (const o of meshes) {
      const s = new THREE.Mesh(o.geometry, this.material);
      s.frustumCulled = false;
      s.renderOrder = 8;
      s.visible = false;
      o.add(s);
      this.shells.push(s);
    }
  }

  update(st, dt, time) {
    const target = heatLevel(st.atmoDensity, st.speed);
    this.I += (target - this.I) * (1 - Math.exp(-4 * dt));
    const I = this.I;
    const on = I > 0.01 && st.velLocal && st.speed > 1;
    for (const s of this.shells) s.visible = on;
    this.bow.visible = on;
    if (!on || !this.size) return;
    const u = this.uniforms;
    u.uI.value = I;
    u.uTime.value = time;
    // dirección de la velocidad en el espacio "mundo" de la escena (relativo a la cámara)
    const dirL = _v.copy(st.velLocal).normalize();
    this.root.getWorldQuaternion(_q);
    u.uVelW.value.copy(dirL).applyQuaternion(_q);

    // onda de choque: delante de la nariz (en la dirección de la velocidad)
    const R = Math.max(this.size.x, this.size.y) * 0.6;
    const ahead = this.size.z * 0.5 + R * 0.2;
    this.bow.position.copy(this.center).addScaledVector(dirL, ahead);
    this.bow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dirL);
    this.bow.scale.set(R * (1 + I * 0.3), R * (1 + I * 0.3), R * 0.8);

    // chispas desde el borde de ataque y estelas desde las puntas de las alas
    this.acc += I * 260 * dt;
    const back = _p;
    while (this.acc >= 1) {
      this.acc -= 1;
      const ember = Math.random() < 0.25;
      // punto al azar sobre la cara delantera de la caja
      back.set(
        this.center.x + (Math.random() - 0.5) * this.size.x * (ember ? 1 : 0.6),
        this.center.y + (Math.random() - 0.5) * this.size.y * 0.6,
        this.center.z,
      ).addScaledVector(dirL, this.size.z * (0.2 + Math.random() * 0.3));
      const sp = 120 + Math.random() * 180;
      const vel = new THREE.Vector3().copy(dirL).multiplyScalar(-sp);
      vel.x += (Math.random() - 0.5) * 30; vel.y += (Math.random() - 0.5) * 30;
      if (ember) _c.setRGB(4, 1.6, 0.6); else _c.setRGB(3, 1.2, 0.5).lerp(new THREE.Color(2.5, 1.2, 2.2), I * 0.5);
      this.pool.emit(back, vel, ember ? 0.5 : 0.25, _c, 0.9, ember ? 0.25 : 0.6, ember ? 0.1 : 3.5, ember ? 0.3 : 2);
    }
    // estela continua en las puntas de las alas
    for (const sx of [-1, 1]) {
      if (Math.random() > I * 1.5) continue;
      back.set(this.center.x + sx * this.size.x * 0.48, this.center.y, this.box.max.z * 0.3);
      const vel = new THREE.Vector3().copy(dirL).multiplyScalar(-200);
      _c.setRGB(2.5, 1.0, 0.45);
      this.pool.emit(back, vel, 0.6, _c, 0.5 * I, 0.8, 5, 0.5);
    }
  }
}
