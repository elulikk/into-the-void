// Sistema solar: estado (posiciones en metros, doubles de JS) + objetos de render.
// Clave de la escala: la simulación vive en doubles; al renderizar, cada objeto se
// ubica RELATIVO A LA CÁMARA (la cámara está siempre en el origen), así la GPU
// (float32) sólo recibe números chicos para lo que está cerca.
import * as THREE from 'three';
import { BODIES, ATMOSPHERES } from './bodies.js';
import { createAtmosphere, updateAtmosphere } from './atmosphere.js';
import { planetElements, planetPosition, moonElements, orbitalPosition, positionFromE, poleToEcliptic } from './ephemeris.js';
import { proceduralTexture, tryRealTexture, ringTexture, glowTexture } from './textures.js';

const DEG = Math.PI / 180;
const KM = 1000;
const EARTH_MOON_MASS_RATIO = 0.0121505856; // m_luna / (m_tierra + m_luna)

// eclíptica (x, y, z-norte) → three.js (x, y-arriba, z)
export function eclToThree(a, out = new THREE.Vector3()) {
  return out.set(a[0], a[2], -a[1]);
}

// Sol: textura en HDR (alimenta el bloom) con oscurecimiento al borde (limb darkening):
// en el borde se ven capas más altas y frías de la fotósfera → más oscuro y rojizo.
function sunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, uIntensity: { value: 7 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map; uniform float uIntensity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        vec3 tex = texture2D(map, vUv).rgb;
        tex = tex * tex; // sRGB aproximado → lineal
        float limb = 1.0 - 0.62 * (1.0 - mu) - 0.2 * (1.0 - mu * mu);
        vec3 tint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), pow(mu, 0.35));
        gl_FragColor = vec4(tex * tint * limb * uIntensity, 1.0);
      }`,
  });
}

export class SolarSystem {
  constructor(scene) {
    this.scene = scene;
    this.bodies = BODIES.map(b => ({
      ...b,
      R: b.radius * KM,
      soiM: b.soi * KM,
      pos: new THREE.Vector3(),      // posición absoluta (heliocéntrica), metros
      rel: new THREE.Vector3(),      // posición relativa a la cámara
      children: [],
    }));
    this.byId = Object.fromEntries(this.bodies.map(b => [b.id, b]));
    for (const b of this.bodies) {
      if (b.parent) this.byId[b.parent].children.push(b);
      b.parentBody = b.parent ? this.byId[b.parent] : null;
      // orientación del eje (Y local → polo)
      const pole = b.pole ? eclToThree(poleToEcliptic(b.pole[0], b.pole[1])) : null;
      b.tilt = new THREE.Quaternion();
      if (pole) b.tilt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole.normalize());
      else if (b.parentBody) b.tilt.copy(b.parentBody.tilt); // lunas sin polo: el de su planeta
    }
    this.lastOrbitJd = null;
  }

  async build(onProgress) {
    const sphere = new THREE.SphereGeometry(1, 128, 64);
    const smallSphere = new THREE.SphereGeometry(1, 64, 32);
    // Texturas reales disponibles (textures/manifest.json), si las hay
    let real = [];
    try { real = await (await fetch('textures/manifest.json')).json(); } catch { /* sin texturas reales */ }
    this.textureQueue = [];
    for (const b of this.bodies) {
      const group = new THREE.Group();          // posición + inclinación del eje
      group.quaternion.copy(b.tilt);
      const mat = b.id === 'sun'
        ? sunMaterial()
        : new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.95, metalness: 0 });
      if (real.includes(b.id)) tryRealTexture(b.id, mat);
      else this.textureQueue.push({ b, mat });
      const mesh = new THREE.Mesh(b.R > 1e6 ? sphere : smallSphere, mat);
      mesh.scale.setScalar(b.R);
      group.add(mesh);
      b.group = group; b.mesh = mesh;

      if (ATMOSPHERES[b.id]) {
        b.atm = createAtmosphere(b, ATMOSPHERES[b.id], this.renderer);
        group.add(b.atm.mesh);
      }
      if (b.rings) {
        const [ri, ro] = b.rings.map(r => r * KM);
        const g = new THREE.RingGeometry(ri, ro, 256, 1);
        const uv = g.attributes.uv, p = g.attributes.position;
        for (let k = 0; k < uv.count; k++) {
          const r = Math.hypot(p.getX(k), p.getY(k));
          uv.setXY(k, (r - ri) / (ro - ri), 0.5);
        }
        // los anillos dispersan luz hacia ambas caras: material sin sombreado
        const rm = new THREE.MeshBasicMaterial({
          map: ringTexture(), color: 0xd8d0c0, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
        const ring = new THREE.Mesh(g, rm);
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);
      }
      if (b.id === 'sun') {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        }));
        this.sunGlow = glow;
        this.scene.add(glow);
      }
      this.scene.add(group);
    }

    // Luz puntual en el Sol (sin atenuación) + algo de ambiente
    this.sunLight = new THREE.PointLight(0xfff4e6, 3.2, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x404858, 0.12));

    // Puntos para que todo cuerpo sea visible aunque mida < 1 píxel
    const n = this.bodies.length;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const cols = new Float32Array(n * 3);
    this.bodies.forEach((b, k) => { const c = new THREE.Color(b.color); cols.set([c.r, c.g, c.b], k * 3); });
    pg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.dots = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true }));
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);

    this.orbitGroup = new THREE.Group();
    this.scene.add(this.orbitGroup);

    // Las texturas de los cuerpos iniciales se generan antes de arrancar;
    // el resto, de a una por cuadro mientras ya se juega.
    const first = ['sun', 'earth', 'moon'];
    const prio = j => { const k = first.indexOf(j.b.id); return k < 0 ? 99 : k; };
    this.textureQueue.sort((x, y) => prio(x) - prio(y));
    let i = 0;
    while (this.textureQueue.length && first.includes(this.textureQueue[0].b.id)) {
      onProgress?.(this.textureQueue[0].b.name, i++ / first.length);
      await new Promise(r => setTimeout(r, 0)); // deja que se pinte la barra de progreso
      this.generateNextTexture();
    }
    onProgress?.('listo', 1);
  }

  generateNextTexture() {
    const job = this.textureQueue.shift();
    if (!job) return false;
    const tex = proceduralTexture(job.b.tex);
    if (job.mat.uniforms?.map) { job.mat.uniforms.map.value = tex; return true; }
    job.mat.map = tex;
    job.mat.color.set(0xffffff);
    job.mat.needsUpdate = true;
    return true;
  }

  // Líneas de órbita (se regeneran si la fecha cambia mucho)
  buildOrbits(jd) {
    this.orbitGroup.clear();
    for (const b of this.bodies) {
      if (!b.parent) continue;
      const pts = [];
      const tmp = [0, 0, 0];
      const N = 512;
      let el, local = false;
      if (b.parent === 'sun') el = planetElements(b.id === 'earth' ? 'emb' : b.id, jd);
      else if (b.orbit === 'luna') el = moonElements(jd);
      else { const o = b.orbit; el = { a: o.a * KM, e: o.e, I: o.i * DEG, Omega: 0, omega: 0 }; local = true; }
      for (let k = 0; k <= N; k++) {
        positionFromE(el.a, el.e, el.I, el.Omega, el.omega, (k / N) * Math.PI * 2, tmp);
        pts.push(eclToThree(tmp));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const col = new THREE.Color(b.color).multiplyScalar(0.55);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
      line.userData = { body: b, local };
      if (local) line.quaternion.copy(b.parentBody.tilt);
      line.frustumCulled = false;
      this.orbitGroup.add(line);
    }
    this.lastOrbitJd = jd;
  }

  update(jd) {
    const tmp = [0, 0, 0];
    const v = new THREE.Vector3();
    this.byId.sun.pos.set(0, 0, 0);
    for (const b of this.bodies) {
      if (b.parent !== 'sun') continue;
      if (b.id === 'earth') continue;
      eclToThree(planetPosition(b.id, jd, tmp), b.pos);
    }
    // Tierra y Luna alrededor del baricentro
    const emb = eclToThree(planetPosition('emb', jd, tmp));
    const me = moonElements(jd);
    const moonRel = eclToThree(orbitalPosition(me.a, me.e, me.I, me.Omega, me.omega, me.M, tmp));
    this.byId.earth.pos.copy(emb).addScaledVector(moonRel, -EARTH_MOON_MASS_RATIO);
    this.byId.moon.pos.copy(this.byId.earth.pos).add(moonRel);
    // Resto de lunas: plano ecuatorial del planeta
    const d = jd - 2451545.0;
    for (const b of this.bodies) {
      if (!b.parent || b.parent === 'sun' || b.orbit === 'luna') continue;
      const o = b.orbit;
      const M = (o.M0 + 360 * d / o.P) * DEG;
      orbitalPosition(o.a * KM, o.e, o.i * DEG, 0, 0, M % (Math.PI * 2), tmp);
      eclToThree(tmp, v).applyQuaternion(b.parentBody.tilt);
      b.pos.copy(b.parentBody.pos).add(v);
    }
    // Rotación propia
    const hours = d * 24;
    for (const b of this.bodies) {
      b.spin = ((hours / b.rot) % 1) * Math.PI * 2;
    }
    if (this.lastOrbitJd === null || Math.abs(jd - this.lastOrbitJd) > 30) this.buildOrbits(jd);
  }

  // Ubica todo relativo a la cámara (camPos en metros, doubles)
  syncRender(camPos, camera, shipPos, frameBody) {
    const sun = this.byId.sun;
    const dotPos = this.dots.geometry.attributes.position;
    const sunRel = new THREE.Vector3().subVectors(sun.pos, camPos);
    const sunDirTmp = new THREE.Vector3();
    this.bodies.forEach((b, k) => {
      b.rel.subVectors(b.pos, camPos);
      b.group.position.copy(b.rel);
      b.mesh.rotation.y = b.spin;
      dotPos.setXYZ(k, b.rel.x, b.rel.y, b.rel.z);
      if (b.atm) {
        updateAtmosphere(b.atm, b, b.rel, sunDirTmp.subVectors(sunRel, b.rel).normalize());
      }
    });
    dotPos.needsUpdate = true;
    this.sunLight.position.copy(sunRel);
    const sd = sunRel.length();
    this.sunGlow.position.copy(sunRel);
    this.sunGlow.scale.setScalar(Math.max(sun.R * 7, sd * 0.03));
    // "adaptación del ojo": de cerca el Sol baja de intensidad y el halo se atenúa,
    // así se ve la superficie con su oscurecimiento al borde en vez de una mancha blanca
    const near = THREE.MathUtils.smoothstep(sun.R / sd, 0.02, 0.25);
    sun.mesh.material.uniforms.uIntensity.value = THREE.MathUtils.lerp(7, 1.6, near);
    this.sunGlow.material.opacity = THREE.MathUtils.lerp(1, 0.25, near);

    for (const line of this.orbitGroup.children) {
      const b = line.userData.body;
      const center = b.parentBody;
      line.position.subVectors(center.pos, camPos);
      const distToCenter = shipPos.distanceTo(center.pos);
      let op;
      if (center.id === 'sun') {
        // se atenúa al estar dentro de la esfera de influencia del propio planeta
        const near = shipPos.distanceTo(b.pos) / b.soiM;
        op = 0.55 * Math.min(1, Math.max(0, (near - 0.3) / 2));
      } else {
        op = 0.6 * Math.min(1, Math.max(0, 1.5 - distToCenter / (center.soiM * 2)));
      }
      line.material.opacity = op;
      line.visible = op > 0.01;
    }
  }

  // Marco de referencia: el cuerpo con la SOI más chica que contiene al punto
  dominantBody(p) {
    let best = this.byId.sun;
    for (const b of this.bodies) {
      if (b.id === 'sun') continue;
      if (p.distanceTo(b.pos) < b.soiM && b.soiM < best.soiM) best = b;
    }
    return best;
  }

  // Cuerpo con la superficie más cercana
  nearestSurface(p) {
    let best = null, alt = Infinity;
    for (const b of this.bodies) {
      const a = p.distanceTo(b.pos) - b.R;
      if (a < alt) { alt = a; best = b; }
    }
    return { body: best, alt };
  }
}
