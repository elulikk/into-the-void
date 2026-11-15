// Atmósferas con scattering físico (single scattering): Rayleigh + Mie + absorción
// (ozono en la Tierra, metano en Urano/Neptuno, neblina en Titán…).
// Se dibuja como una cáscara esférica; cada píxel hace raymarching a través del aire,
// se corta contra la superficie del planeta y calcula luz dispersada + transmitancia.
// Todo el cálculo va en "radios del planeta" para que float32 alcance.
import * as THREE from 'three';

const vertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

const fragment = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCenter;      // centro del planeta relativo a la cámara, en radios
  uniform float uTop;        // radio del tope de la atmósfera (planeta = 1)
  uniform vec3 uSunDir;
  uniform float uSun;
  uniform vec3 uBetaR;   uniform float uHR;
  uniform vec3 uBetaM;   uniform vec3 uBetaMExt; uniform float uHM; uniform float uG;
  uniform vec3 uBetaA;   uniform float uAC; uniform float uAW;   // absorción (uAW = 0: sigue a Rayleigh)
  uniform sampler2D uTransLUT;   // transmitancia hacia el tope de la atmósfera (mu_sol, altura)
  varying vec3 vWorld;

  const int STEPS = 20;

  // intersección estable rayo-esfera centrada en el origen; devuelve (t0, t1) o (-1,-1)
  vec2 sphere(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    vec3 p = o - b * d;
    float disc = r * r - dot(p, p);
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  vec3 densities(float h) {
    float dR = exp(-h / uHR);
    float dM = exp(-h / uHM);
    float dA = uAW > 0.0 ? max(0.0, 1.0 - abs(h - uAC) / uAW) : dR;
    return vec3(dR, dM, dA);
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 o = -uCenter;
    vec3 d = normalize(vWorld);
    vec2 ta = sphere(o, d, uTop);
    if (ta.y <= 0.0) discard;
    float t0 = max(ta.x, 0.0);
    float t1 = ta.y;
    vec2 tp = sphere(o, d, 1.0);
    bool ground = tp.x > 0.0;
    if (ground) t1 = min(t1, tp.x);
    float ds = (t1 - t0) / float(STEPS);
    float jitter = hash(gl_FragCoord.xy);

    float mu = dot(d, uSunDir);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g2 = uG * uG;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) /
                ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * uG * mu, 1e-4), 1.5));

    vec3 od = vec3(0.0);          // profundidad óptica acumulada (R, M, A) hacia la cámara
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + jitter) * ds;
      vec3 p = o + d * t;
      float h = length(p) - 1.0;
      vec3 dn = densities(h) * ds;
      od += dn;
      // camino hacia el Sol: si lo tapa el planeta, no hay luz directa
      float r = length(p);
      vec3 up = p / r;
      if (sphere(p, uSunDir, 1.0).x > 0.0) continue;
      vec3 tSun = textureLod(uTransLUT, vec2(dot(up, uSunDir) * 0.5 + 0.5, (r - 1.0) / (uTop - 1.0)), 0.0).rgb;
      vec3 tau = uBetaR * od.x + uBetaMExt * od.y + uBetaA * od.z;
      vec3 tr = exp(-tau) * tSun;
      sumR += tr * dn.x;
      sumM += tr * dn.y;
    }
    vec3 col = uSun * (sumR * uBetaR * phR + sumM * uBetaM * phM);
    vec3 tv = exp(-(uBetaR * od.x + uBetaMExt * od.y + uBetaA * od.z));
    float alpha = 1.0 - dot(tv, vec3(0.3333));
    gl_FragColor = vec4(col, alpha);
  }`;

const lutFragment = /* glsl */`
  uniform float uTop;
  uniform vec3 uBetaR; uniform float uHR;
  uniform vec3 uBetaMExt; uniform float uHM;
  uniform vec3 uBetaA; uniform float uAC; uniform float uAW;
  varying vec2 vUv;
  void main() {
    float mu = vUv.x * 2.0 - 1.0;
    float h = vUv.y * (uTop - 1.0);
    vec3 o = vec3(0.0, 1.0 + h, 0.0);
    vec3 d = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
    float b = dot(o, d);
    vec3 pc = o - b * d;
    float t1 = -b + sqrt(max(0.0, uTop * uTop - dot(pc, pc)));
    const int N = 64;
    float ds = t1 / float(N);
    vec3 od = vec3(0.0);
    for (int i = 0; i < N; i++) {
      float hh = length(o + d * (float(i) + 0.5) * ds) - 1.0;
      float dR = exp(-hh / uHR);
      float dM = exp(-hh / uHM);
      float dA = uAW > 0.0 ? max(0.0, 1.0 - abs(hh - uAC) / uAW) : dR;
      od += vec3(dR, dM, dA) * ds;
    }
    gl_FragColor = vec4(exp(-(uBetaR * od.x + uBetaMExt * od.y + uBetaA * od.z)), 1.0);
  }`;

// Precalcula la transmitancia hacia el Sol (una vez por planeta)
function bakeTransmittance(renderer, uniforms) {
  const rt = new THREE.WebGLRenderTarget(256, 64, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: lutFragment,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}

// p: parámetros físicos en unidades SI (β en 1/m, alturas en m)
export function createAtmosphere(body, p, renderer) {
  const R = body.R;
  const k = R; // β por metro → β por radio
  const v3 = a => new THREE.Vector3(a[0], a[1], a[2]).multiplyScalar(k);
  const mieSc = v3(p.mie || [0, 0, 0]);
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTop: { value: 1 + p.top / R },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSun: { value: p.sun ?? 3.2 },   // igual a la intensidad de la luz del Sol en la escena
    uBetaR: { value: v3(p.rayleigh || [0, 0, 0]) },
    uHR: { value: (p.hR || 8000) / R },
    uBetaM: { value: mieSc },
    uBetaMExt: { value: mieSc.clone().add(v3(p.mieAbs || [0, 0, 0])) },
    uHM: { value: (p.hM || 1200) / R },
    uG: { value: p.g ?? 0.76 },
    uBetaA: { value: v3(p.abs || [0, 0, 0]) },
    uAC: { value: (p.absCenter || 0) / R },
    uAW: { value: (p.absWidth || 0) / R },
    uTransLUT: { value: null },
  };
  uniforms.uTransLUT.value = bakeTransmittance(renderer, uniforms);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, uniforms,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat);
  mesh.scale.setScalar(R * uniforms.uTop.value);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms, mat };
}

// rel: centro del planeta relativo a la cámara (m); sunDir: dirección planeta → Sol (mundo)
export function updateAtmosphere(atm, body, rel, sunDir) {
  const u = atm.uniforms;
  u.uCenter.value.copy(rel).divideScalar(body.R);
  u.uSunDir.value.copy(sunDir);
  const inside = rel.length() / body.R < u.uTop.value * 1.001;
  // desde afuera: caras frontales con test de profundidad (la nave o una luna delante la tapan)
  // desde adentro: caras traseras (el cielo)
  const side = inside ? THREE.BackSide : THREE.FrontSide;
  if (atm.mat.side !== side) { atm.mat.side = side; atm.mat.needsUpdate = true; }
}
