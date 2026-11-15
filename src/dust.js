// Polvo espacial: partículas alrededor de la cámara que se estiran en líneas según
// la velocidad. Da sensación de movimiento en el vacío, a cualquier escala:
// el tamaño de la caja de partículas crece con la velocidad, así a 30 m/s y a
// 3000 km/s el efecto se ve parecido.
import * as THREE from 'three';

const vertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 seed;
  attribute float tail;
  uniform vec3 uOdo;
  uniform float uL;
  uniform vec3 uStreak;
  uniform float uAlpha;
  varying float vA;
  void main() {
    vec3 p = (fract(seed - uOdo) - 0.5) * uL;
    p += uStreak * tail;
    float d = length(p) / (0.5 * uL);
    float nearFade = smoothstep(0.02, 0.08, d);
    vA = uAlpha * (1.0 - smoothstep(0.45, 1.0, d)) * nearFade * (1.0 - tail * 0.85);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const fragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  varying float vA;
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor * vA, vA);
  }`;

export class SpaceDust {
  constructor(scene, n = 900) {
    const seed = new Float32Array(n * 6), tail = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seed.set(s, i * 6); seed.set(s, i * 6 + 3);
      tail[i * 2] = 0; tail[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    this.uniforms = {
      uOdo: { value: new THREE.Vector3() },
      uL: { value: 60 },
      uStreak: { value: new THREE.Vector3() },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0.75, 0.85, 1.0) },
    };
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.odo = new THREE.Vector3();
  }

  // vel: velocidad de la nave (m/s) relativa a su marco; cruise: 0..1
  update(dt, vel, speed01, cruise) {
    const spd = vel.length();
    const L = Math.max(60, spd * 1.2);
    this.odo.addScaledVector(vel, dt / L);
    this.odo.set(this.odo.x - Math.floor(this.odo.x), this.odo.y - Math.floor(this.odo.y), this.odo.z - Math.floor(this.odo.z));
    const u = this.uniforms;
    u.uOdo.value.copy(this.odo);
    u.uL.value = L;
    const exposure = 0.04 + cruise * 0.22;
    const len = Math.max(spd * exposure, L * 0.004);
    if (spd > 1e-3) u.uStreak.value.copy(vel).multiplyScalar(len / spd);
    else u.uStreak.value.set(0, L * 0.004, 0);
    const a = spd < 5 ? spd / 5 : 1;
    u.uAlpha.value = a * (0.35 + 0.45 * speed01 + 0.5 * cruise);
  }
}
