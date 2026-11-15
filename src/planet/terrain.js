// Terreno con LOD: cubo esferizado con 6 quadtrees por cuerpo rocoso.
//
// - Cada nodo es un chunk de 33×33 vértices generado en un worker (chunkWorker.js).
// - Un nodo se subdivide si la cámara (en coordenadas locales del cuerpo, doubles)
//   está a menos de K × su lado. Sólo se pasa a los hijos cuando los 4 están listos
//   (los que no se ven cuentan como listos); mientras tanto se sigue dibujando el padre.
// - Culling por horizonte y por frustum a nivel de nodo; caché con poda de los nodos
//   que no se usan; cola de pedidos priorizada por nivel y distancia que se rearma
//   cada cuadro (los pedidos viejos que no se mandaron se descartan solos).
// - Precisión: cada chunk es una malla en la escena con
//     position = b.rel + qBody · centro   (doubles en JS)
//     quaternion = qBody                  (qBody = tilt · Ry(spin))
//   y sus vértices relativos al centro en float32.
// - Material: MeshStandardMaterial con onBeforeCompile. El albedo es la textura del
//   cuerpo (procedural o real) muestreada con UV equirectangular desde la dirección
//   del vértice (misma convención que SphereGeometry), sin costura (método de Tarini
//   con textureGrad), × shade. Canal emisivo listo para la lava (fase 4/5).
import * as THREE from 'three';
import { getRecipe, hasTerrain } from './recipes.js';
import { FACES, cubeDir, N } from './faces.js';

const K_SPLIT = 4;            // subdividir si distancia < K × lado del nodo
const ON_R = 6, OFF_R = 7;    // encender/apagar el terreno (en radios), con histéresis
const PRUNE_MS = 4000;        // nodos sin usar durante este tiempo se liberan
const MAX_CHUNKS = 2500;      // por encima de esto se poda más agresivo
const TARGET_SPACING = 1;     // separación de vértices buscada en el nivel máximo (m)

// ---------------- pool de workers ----------------
class WorkerPool {
  constructor(n) {
    this.workers = [];
    this.cb = new Map();
    this.nextId = 1;
    this.inflight = 0;
    this.msTotal = 0; this.msCount = 0; this.msMax = 0;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = e => this.done(w, e.data);
      w.onerror = e => console.error('Worker de terreno:', e.message);
      this.workers.push(w);
    }
    this.perWorker = 2;
  }
  get free() { return this.workers.length * this.perWorker - this.inflight; }
  run(job, cb) {
    let best = null;
    for (const w of this.workers) if (w.busy < this.perWorker && (!best || w.busy < best.busy)) best = w;
    if (!best) return false;
    job.id = this.nextId++;
    this.cb.set(job.id, cb);
    best.busy++; this.inflight++;
    best.postMessage(job);
    return true;
  }
  done(w, data) {
    w.busy--; this.inflight--;
    const cb = this.cb.get(data.id);
    this.cb.delete(data.id);
    if (data.error) { console.error('Chunk de terreno:', data.error); cb?.(null); return; }
    this.msTotal += data.ms; this.msCount++; this.msMax = Math.max(this.msMax, data.ms);
    cb?.(data);
  }
}

// ---------------- material ----------------
function terrainMaterial(fallbackColor) {
  const fallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  fallback.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.color.set(fallbackColor);
  const uniforms = { uAlbedo: { value: fallback }, uLava: { value: new THREE.Color(4, 1.3, 0.25) } };
  mat.userData.uniforms = uniforms;
  mat.userData.fallback = fallback;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 pdir; attribute vec2 surf;
        varying vec3 vPdir; varying vec2 vSurf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPdir = pdir; vSurf = surf;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAlbedo; uniform vec3 uLava;
        varying vec3 vPdir; varying vec2 vSurf;`)
      .replace('#include <map_fragment>', `
        {
          // UV equirectangular como SphereGeometry: u = atan2(z, -x)/2π, v = 1 - acos(y)/π.
          // Dos parametrizaciones de u con la costura en lugares distintos; se usa la que
          // no salta en este píxel (Tarini) y se pasan sus derivadas a textureGrad.
          vec3 pd = normalize(vPdir);
          float ph = atan(pd.z, -pd.x) * (0.5 / PI);
          float uA = fract(ph);
          float uB = fract(ph + 0.5) - 0.5;
          vec2 dA = vec2(dFdx(uA), dFdy(uA));
          vec2 dB = vec2(dFdx(uB), dFdy(uB));
          float v = 1.0 - acos(clamp(pd.y, -1.0, 1.0)) / PI;
          bool useA = abs(dA.x) + abs(dA.y) <= abs(dB.x) + abs(dB.y);
          float u = useA ? uA : uB;
          vec2 du = useA ? dA : dB;
          vec4 tc = textureGrad(uAlbedo, vec2(fract(u), v), vec2(du.x, dFdx(v)), vec2(du.y, dFdy(v)));
          diffuseColor.rgb *= tc.rgb * vSurf.x;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uLava * vSurf.y;`);
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

// ---------------- nodos ----------------
const _d = [0, 0, 0];
class Node {
  constructor(tb, face, x0, y0, size, level, parent) {
    this.tb = tb; this.face = face; this.x0 = x0; this.y0 = y0; this.size = size; this.level = level;
    this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.pending = false;
    this.dead = false;
    this.lastUsed = 0;
    const F = FACES[face], R = tb.R;
    cubeDir(F, x0 + size / 2, y0 + size / 2, _d);
    this.dir = new THREE.Vector3(_d[0], _d[1], _d[2]);
    this.center = this.dir.clone().multiplyScalar(R);        // doubles, local al cuerpo
    // radio angular: ángulo máximo entre el centro y las esquinas
    let maxA = 0;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      cubeDir(F, x0 + a * size, y0 + b * size, _d);
      maxA = Math.max(maxA, Math.acos(Math.min(1, _d[0] * this.dir.x + _d[1] * this.dir.y + _d[2] * this.dir.z)));
    }
    this.angRad = maxA;
    this.edgeM = size * R * Math.PI / 4;
    this.hMin = tb.recipe.minH; this.hMax = tb.recipe.maxH;
  }
  split() {
    const h = this.size / 2, L = this.level + 1;
    this.children = [
      new Node(this.tb, this.face, this.x0, this.y0, h, L, this),
      new Node(this.tb, this.face, this.x0 + h, this.y0, h, L, this),
      new Node(this.tb, this.face, this.x0, this.y0 + h, h, L, this),
      new Node(this.tb, this.face, this.x0 + h, this.y0 + h, h, L, this),
    ];
  }
  // radio de una esfera (centrada en this.center) que contiene al chunk
  boundRadius() {
    if (this.mesh) return this.mesh.geometry.boundingSphere.radius;
    const R = this.tb.R;
    return 2 * R * Math.sin(this.angRad / 2) * 1.05 + Math.max(Math.abs(this.hMin), Math.abs(this.hMax));
  }
}

// ---------------- terreno de un cuerpo ----------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _qi = new THREE.Quaternion(), _sph = new THREE.Sphere();

class BodyTerrain {
  constructor(mgr, b) {
    this.mgr = mgr; this.b = b; this.R = b.R;
    this.recipe = getRecipe(b.id, b.R);
    this.maxLevel = Math.max(1, Math.round(Math.log2((Math.PI / 2) * b.R / (N - 1) / TARGET_SPACING)));
    this.material = terrainMaterial(b.color);
    this.group = new THREE.Group();
    this.group.visible = false;
    mgr.scene.add(this.group);
    this.roots = null;
    this.active = false;
    this.ready = false;
    this.drawn = [];
    this.meshCount = 0;
  }

  activate() {
    this.active = true;
    this.roots = FACES.map((_, f) => new Node(this, f, -1, -1, 2, 0, null));
  }

  deactivate() {
    this.active = false; this.ready = false;
    for (const r of this.roots || []) this.disposeTree(r, true);
    this.roots = null;
    this.drawn.length = 0;
    this.group.visible = false;
    this.b.mesh.visible = true;
  }

  disposeTree(node, self) {
    if (node.children) { for (const c of node.children) this.disposeTree(c, true); node.children = null; }
    if (self) {
      node.dead = true;
      if (node.mesh) { this.group.remove(node.mesh); node.mesh.geometry.dispose(); node.mesh = null; this.meshCount--; }
    }
  }

  request(node) {
    node.pending = true;
    const ok = this.mgr.pool.run({ body: this.b.id, R: this.R, face: node.face, x0: node.x0, y0: node.y0, size: node.size }, res => {
      node.pending = false;
      if (!res || node.dead || !this.active) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(res.nor, 3));
      g.setAttribute('pdir', new THREE.BufferAttribute(res.pdir, 3));
      g.setAttribute('surf', new THREE.BufferAttribute(res.surf, 2));
      g.setIndex(new THREE.BufferAttribute(res.index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius);
      const m = new THREE.Mesh(g, this.material);
      m.visible = false;
      m.matrixAutoUpdate = true;
      node.mesh = m;
      node.hMin = res.hMin; node.hMax = res.hMax;
      this.group.add(m);
      this.meshCount++;
      this.mgr.stats.generated++;
    });
    if (!ok) node.pending = false;
    return ok;
  }

  // Radio de la esfera que tapa lo que está detrás del horizonte. Tiene que quedar por
  // debajo del terreno en la zona que puede tapar (el casquete alrededor del nadir hasta
  // el horizonte). Por defecto es R + minH de la receta (seguro pero flojo: a 50 m de la
  // Luna daría un horizonte de ~200 km). Se ajusta con la altura mínima de los chunks
  // dibujados el cuadro anterior dentro de ese casquete (los que importan para tapar
  // algo visible están en el frustum, o sea entre esos chunks).
  occluderRadius() {
    const R = this.R, r = this.camR;
    let Ro = R + this.recipe.minH;
    if (r <= Ro || !this.drawn.length) return Ro;
    const cx = this.camLocal.x / r, cy = this.camLocal.y / r, cz = this.camLocal.z / r;
    // margen: los niveles más finos pueden bajar un poco más que el chunk dibujado
    const margin = 50 + 0.02 * (this.recipe.maxH - this.recipe.minH);
    for (const n of this.drawn) n.ang = Math.acos(Math.min(1, n.dir.x * cx + n.dir.y * cy + n.dir.z * cz));
    // Iteración: si el terreno en el casquete de Ro está por encima de Ro', Ro' también es
    // válido (su casquete es más chico), así que se puede achicar varias veces.
    for (let it = 0; it < 4; it++) {
      const cap = Math.acos(Math.min(1, Ro / r));
      let hm = Infinity;
      for (const n of this.drawn) if (n.ang < cap + n.angRad && n.hMin < hm) hm = n.hMin;
      if (hm === Infinity) break;
      const next = Math.min(r - 1, R + hm - margin);
      if (next <= Ro + 1) break;
      Ro = next;
    }
    return Ro;
  }

  // ¿se ve el nodo? (horizonte + frustum)
  visible(node) {
    const R = this.R, rec = this.recipe;
    // horizonte: la esfera de radio Ro (por debajo del terreno más bajo) tapa lo que está detrás
    const r = this.camR;
    const Ro = this.Ro;
    if (r > Ro + 1) {
      const top = Math.max(Ro + 1, R + node.hMax);
      const lim = Math.acos(Ro / r) + Math.acos(Ro / top) + node.angRad;
      const cosA = node.dir.dot(this.camLocal) / r;
      if (lim < Math.PI && cosA < Math.cos(lim)) return false;
    }
    // frustum (esfera relativa a la cámara)
    _sph.center.copy(node.center).applyQuaternion(this.b.qBody).add(this.b.rel);
    _sph.radius = node.boundRadius();
    return this.mgr.frustum.intersectsSphere(_sph);
  }

  visit(node, now) {
    node.lastUsed = now;
    if (!this.visible(node)) return;
    const hMid = (node.hMin + node.hMax) / 2;
    const dist = _v.copy(node.dir).multiplyScalar(this.R + hMid).distanceTo(this.camLocal);
    if (node.level < this.maxLevel && dist < K_SPLIT * node.edgeM) {
      if (!node.children) node.split();
      let ready = true;
      for (const c of node.children) {
        c.lastUsed = now;
        c.vis = this.visible(c);
        if (c.vis && !c.mesh) {
          ready = false;
          if (!c.pending) this.mgr.want(this, c, dist);
        }
      }
      if (ready) {
        for (const c of node.children) if (c.vis) this.visit(c, now);
        return;
      }
    }
    if (node.mesh) this.drawn.push(node);
    else if (!node.pending) this.mgr.want(this, node, dist);
  }

  prune(node, now, maxAge) {
    if (!node.children) return;
    let used = false;
    for (const c of node.children) { this.prune(c, now, maxAge); if (now - c.lastUsed < maxAge || c.children) used = true; }
    if (!used) this.disposeTree(node, false);
  }

  update(camWorld, now) {
    const b = this.b;
    const d = _v2.subVectors(camWorld, b.pos).length();
    if (!this.active && d < ON_R * b.R) this.activate();
    else if (this.active && d > OFF_R * b.R) { this.deactivate(); return; }
    if (!this.active) return;

    // cámara en coordenadas locales del cuerpo (doubles)
    _qi.copy(b.qBody).invert();
    this.camLocal = (this.camLocal || new THREE.Vector3()).subVectors(camWorld, b.pos).applyQuaternion(_qi);
    this.camR = this.camLocal.length();

    this.Ro = this.occluderRadius();
    for (const n of this.drawn) n.mesh.visible = false;
    this.drawn.length = 0;

    const rootsReady = this.roots.every(r => r.mesh);
    if (!rootsReady) {
      for (const r of this.roots) { r.lastUsed = now; if (!r.mesh && !r.pending) this.mgr.want(this, r, 0); }
      this.ready = false;
    } else {
      this.ready = true;
      for (const r of this.roots) this.visit(r, now);
    }

    // uniforms: textura actual del cuerpo (puede cambiar al cargar la real)
    const map = b.mesh.material.map || b.mesh.material.uniforms?.map?.value;
    const u = this.material.userData.uniforms;
    if (map) {
      if (!map.userData.terrainWrap) { map.userData.terrainWrap = true; map.wrapS = THREE.RepeatWrapping; map.needsUpdate = true; }
      if (u.uAlbedo.value !== map) { u.uAlbedo.value = map; this.material.color.set(0xffffff); }
    }

    // ubicar los chunks dibujados relativos a la cámara
    for (const n of this.drawn) {
      const m = n.mesh;
      m.position.copy(n.center).applyQuaternion(b.qBody).add(b.rel);
      m.quaternion.copy(b.qBody);
      m.visible = true;
    }
    this.group.visible = this.ready;
    b.mesh.visible = !this.ready;

    // poda
    if ((this.mgr.frame % 30) === 0 && this.roots) {
      const maxAge = this.mgr.totalChunks() > MAX_CHUNKS ? 500 : PRUNE_MS;
      for (const r of this.roots) this.prune(r, now, maxAge);
    }
  }
}

// ---------------- administrador ----------------
export class TerrainManager {
  constructor(scene, system) {
    this.scene = scene;
    this.system = system;
    const n = Math.min(6, Math.max(3, (navigator.hardwareConcurrency || 4) - 2));
    this.pool = new WorkerPool(n);
    this.bodies = system.bodies.filter(b => hasTerrain(b.id)).map(b => new BodyTerrain(this, b));
    this.byId = Object.fromEntries(this.bodies.map(t => [t.b.id, t]));
    for (const t of this.bodies) t.b.terrain = t;
    this.frustum = new THREE.Frustum();
    this.projView = new THREE.Matrix4();
    this.queue = [];
    this.frame = 0;
    this.stats = { drawn: 0, chunks: 0, queue: 0, inflight: 0, generated: 0, avgMs: 0, maxMs: 0, tris: 0, workers: n };
  }

  want(tb, node, dist) { this.queue.push({ tb, node, level: node.level, dist }); }

  totalChunks() { let s = 0; for (const t of this.bodies) s += t.meshCount; return s; }

  update(camWorld, camera) {
    this.frame++;
    const now = performance.now();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.queue.length = 0;
    for (const t of this.bodies) t.update(camWorld, now);

    // pedidos: primero los niveles gruesos, después los más cercanos
    this.queue.sort((a, b) => a.level - b.level || a.dist - b.dist);
    for (const q of this.queue) {
      if (this.pool.free <= 0) break;
      if (q.node.pending || q.node.mesh || q.node.dead) continue;
      q.tb.request(q.node);
    }

    const s = this.stats;
    s.drawn = 0;
    for (const t of this.bodies) s.drawn += t.drawn.length;
    s.tris = s.drawn * ((N - 1) * (N - 1) + 4 * (N - 1)) * 2;
    s.chunks = this.totalChunks();
    s.queue = this.queue.length;
    s.inflight = this.pool.inflight;
    s.avgMs = this.pool.msCount ? this.pool.msTotal / this.pool.msCount : 0;
    s.maxMs = this.pool.msMax;
  }

  // ¿el terreno de este cuerpo está dibujándose?
  isActive(b) { return !!b.terrain?.ready; }
}
