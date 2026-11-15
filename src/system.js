// Sistema solar: estado (posiciones en metros, doubles de JS) + objetos de render.
// Clave de la escala: la simulación vive en doubles; al renderizar, cada objeto se
// ubica RELATIVO A LA CÁMARA (la cámara está siempre en el origen), así la GPU
// (float32) sólo recibe números chicos para lo que está cerca.
import * as THREE from 'three';
import { BODIES, ATMOSPHERES } from './bodies.js';
import { createAtmosphere, updateAtmosphere } from './atmosphere.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { planetElements, planetPosition, moonElements, orbitalPosition, positionFromE, solveKepler, poleToEcliptic } from './ephemeris.js';
import { getRecipe } from './planet/recipes.js';
import { proceduralTexture, tryRealTexture, ringTexture, glowTexture } from './textures.js';

const DEG = Math.PI / 180;
const _sv = new THREE.Vector3(), _sq = new THREE.Quaternion();
const KM = 1000;
// Muestreo de las órbitas: vértices por línea y offset de anomalía excéntrica (rad) en función
// de s ∈ [-1, 1]: casi lineal en 0 (muy denso) y cada vez más espaciado hacia la otra punta.
const ORBIT_NV = 1201;
const ORBIT_D = s => Math.PI * Math.sign(s) * (0.01 * Math.abs(s) + 0.99 * s ** 4);
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
      b.qBody = new THREE.Quaternion();                     // tilt · Ry(spin): orientación de la superficie
      b.poleWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(b.tilt);
      b.recipe = getRecipe(b.id, b.R);                      // relieve (null si no tiene terreno)
      b.spin = 0; b.dSpin = 0;
    }
    this.lastOrbitJd = null;
    this.jd = 0;
    this.tmpV = new THREE.Vector3();
    this.orbitRes = new THREE.Vector2(1, 1);
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

  // Elementos keplerianos del cuerpo en la fecha: { a, e, I, Omega, omega, M }
  orbitElements(b, jd) {
    if (b.parent === 'sun') return planetElements(b.id === 'earth' ? 'emb' : b.id, jd);
    if (b.orbit === 'luna') return moonElements(jd);
    const o = b.orbit;
    const M = ((o.M0 + 360 * (jd - 2451545.0) / o.P) % 360) * DEG;
    return { a: o.a * KM, e: o.e, I: o.i * DEG, Omega: 0, omega: 0, M };
  }

  // Material de las órbitas: línea gruesa en píxeles, con bordes suaves (no hay MSAA),
  // alfa por vértice (cola de cometa) y profundidad logarítmica (LineMaterial ya la trae).
  orbitMaterial(color) {
    const mat = new LineMaterial({ color, linewidth: 2, transparent: true, opacity: 0.6, depthWrite: false });
    mat.uniforms.resolution.value = this.orbitRes; // compartido: se actualiza una vez por cuadro
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('attribute vec3 instanceEnd;', 'attribute vec3 instanceEnd;\nattribute vec2 instanceAlpha;\nvarying float vAlpha;')
        .replace('void main() {', 'void main() {\n vAlpha = ( position.y < 0.5 ) ? instanceAlpha.x : instanceAlpha.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('varying float vLineDistance;', 'varying float vLineDistance;\nvarying float vAlpha;')
        .replace('float alpha = opacity;', `
          // sin tapas (los segmentos se pegan sin superponerse) y borde suave de ~1 px a lo ancho
          if ( abs( vUv.y ) > 1.0 ) discard;
          float aa = fwidth( vUv.x );
          float alpha = opacity * vAlpha * clamp( ( 1.0 - abs( vUv.x ) ) / ( 1.5 * aa ), 0.0, 1.0 );`);
    };
    return mat;
  }

  // Líneas de órbita: una por cuerpo, con ORBIT_NV vértices que se regeneran alrededor de la
  // posición actual del cuerpo (ver updateOrbitLine). Se crean de nuevo si la fecha cambia mucho.
  buildOrbits(jd) {
    for (const l of this.orbitGroup.children) { l.geometry.dispose(); l.material.dispose(); }
    this.orbitGroup.clear();
    const NV = ORBIT_NV, h = (NV - 1) / 2;
    // Alfa por vértice (fijo, depende sólo del índice): la cola es larga y brillante detrás
    // del cuerpo (E menor: ya lo recorrió) y se apaga rápido por delante. Piso tenue en el resto.
    const alpha = new Float32Array((NV - 1) * 2);
    const va = k => {
      const s = (k - h) / h, t = Math.abs(ORBIT_D(s)) / Math.PI;
      const f = s < 0 ? Math.pow(1 - t, 2.2) : Math.pow(1 - t, 14);
      return 0.05 + 0.95 * f;
    };
    for (let k = 0; k < NV - 1; k++) { alpha[2 * k] = va(k); alpha[2 * k + 1] = va(k + 1); }
    for (const b of this.bodies) {
      if (!b.parent) continue;
      const geo = new LineSegmentsGeometry();
      geo.setPositions(new Float32Array((NV - 1) * 6));
      geo.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(alpha, 2));
      const col = new THREE.Color(b.color).multiplyScalar(0.55);
      const line = new LineSegments2(geo, this.orbitMaterial(col));
      const local = !(b.parent === 'sun' || b.orbit === 'luna');
      line.userData = { body: b, local, origin: new THREE.Vector3(), built: false };
      if (local) line.quaternion.copy(b.parentBody.tilt);
      line.frustumCulled = false;
      this.orbitGroup.add(line);
    }
    this.lastOrbitJd = jd;
  }

  // Regenera los vértices de la órbita con el cuerpo en el vértice central. Se muestrea por
  // anomalía excéntrica con densidad concentrada cerca del cuerpo (ORBIT_D), y las
  // coordenadas son RELATIVAS al cuerpo (restadas en doubles: floats chicos cerca de él).
  updateOrbitLine(line) {
    const b = line.userData.body;
    const { a, e, I, Omega, omega, M } = this.orbitElements(b, this.jd);
    const E0 = solveKepler(M, e);
    const bq = a * Math.sqrt(1 - e * e);
    const cw = Math.cos(omega), sw = Math.sin(omega), cO = Math.cos(Omega), sO = Math.sin(Omega);
    const cI = Math.cos(I), sI = Math.sin(I);
    const m11 = cw * cO - sw * sO * cI, m12 = -sw * cO - cw * sO * cI;
    const m21 = cw * sO + sw * cO * cI, m22 = -sw * sO + cw * cO * cI;
    const m31 = sw * sI, m32 = cw * sI;
    // punto del cuerpo (eclíptica → three: (x, z, -y))
    const pe = (E, out) => {
      const xp = a * (Math.cos(E) - e), yp = bq * Math.sin(E);
      out[0] = m11 * xp + m12 * yp; out[1] = m31 * xp + m32 * yp; out[2] = -(m21 * xp + m22 * yp);
    };
    const c = [0, 0, 0], q = [0, 0, 0];
    pe(E0, c);
    const NV = ORBIT_NV, h = (NV - 1) / 2;
    const arr = line.geometry.attributes.instanceStart.data.array;
    for (let k = 0; k < NV; k++) {
      pe(E0 + ORBIT_D((k - h) / h), q);
      const x = q[0] - c[0], y = q[1] - c[1], z = q[2] - c[2];
      if (k > 0) { const o = (k - 1) * 6 + 3; arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; }
      if (k < NV - 1) { const o = k * 6; arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; }
    }
    line.geometry.attributes.instanceStart.data.needsUpdate = true;
    // la Tierra orbita alrededor del baricentro: el vértice central se ancla al cuerpo real
    line.userData.origin.subVectors(b.pos, b.parentBody.pos);
    line.userData.built = true;
  }

  update(jd) {
    this.jd = jd;
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
    const _qs = new THREE.Quaternion();
    for (const b of this.bodies) {
      const spin = ((hours / b.rot) % 1) * Math.PI * 2;
      // delta de rotación desde el cuadro anterior (para la co-rotación de la nave), en ±π
      let ds = spin - b.spin;
      ds -= Math.round(ds / (Math.PI * 2)) * Math.PI * 2;
      b.dSpin = this.spinInit ? ds : 0;
      b.spin = spin;
      _qs.set(0, Math.sin(spin / 2), 0, Math.cos(spin / 2));
      b.qBody.multiplyQuaternions(b.tilt, _qs);
    }
    this.spinInit = true;
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

    // Órbitas: resolución del framebuffer (la línea mide px reales) y ancho en px
    this.renderer.getDrawingBufferSize(this.orbitRes);
    const lw = 2 * this.renderer.getPixelRatio();
    for (const line of this.orbitGroup.children) {
      const b = line.userData.body;
      const center = b.parentBody;
      const distToCenter = shipPos.distanceTo(center.pos);
      let op;
      if (center.id === 'sun') {
        // se atenúa al estar dentro de la esfera de influencia del propio planeta
        const near = shipPos.distanceTo(b.pos) / b.soiM;
        op = 0.8 * Math.min(1, Math.max(0, (near - 0.3) / 2));
      } else {
        op = 0.85 * Math.min(1, Math.max(0, 1.5 - distToCenter / (center.soiM * 2)));
      }
      line.material.opacity = op;
      line.material.linewidth = lw;
      line.visible = op > 0.01;
      if (!line.visible) { line.userData.built = false; continue; }
      // regenerar sólo si el cuerpo se corrió de su vértice más de ~2 px (o ~1/50 de su radio)
      const u = line.userData;
      const rel = this.tmpV.subVectors(b.pos, center.pos);
      if (!u.built || rel.distanceTo(u.origin) > Math.max(0.002 * b.rel.length(), 0.02 * b.R)) {
        this.updateOrbitLine(line);
      }
      // centro (móvil, p. ej. la Tierra para la Luna) + origen de la línea, relativo a la cámara
      line.position.subVectors(center.pos, camPos).add(u.origin);
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

  // Radio de la superficie real (R + relieve) bajo el punto p (absoluto, m).
  // Usa la misma receta que el worker, con detalle de ~minWl metros.
  surfaceRadius(b, p, minWl = 0.5) {
    if (!b.recipe) return b.R;
    const v = _sv.subVectors(p, b.pos);
    const d = v.length();
    if (d < 1) return b.R;
    v.applyQuaternion(_sq.copy(b.qBody).invert()).multiplyScalar(1 / d);
    return b.R + b.recipe.heightAt(-v.x, v.y, v.z, minWl);   // (-x, y, z): espacio de estilo
  }

  // Cuerpo con la superficie más cercana (con el relieve real si está cerca)
  nearestSurface(p) {
    let best = null, alt = Infinity;
    for (const b of this.bodies) {
      const a = p.distanceTo(b.pos) - b.R;
      if (a < alt) { alt = a; best = b; }
    }
    if (best?.recipe && alt < best.R * 2) alt = p.distanceTo(best.pos) - this.surfaceRadius(best, p, Math.max(0.5, alt * 0.01));
    return { body: best, alt };
  }
}
