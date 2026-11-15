// Parte visual de la nave: modelo 3D (glTF con respaldo de primitivas), luces de
// navegación y efectos (escape, RCS, supercrucero, plasma de reentrada).
// No toca la física: ship.js le pasa un "state" por cuadro.
//
//   const v = createShipVisual(scene);  →  { object3d, update(state, dt), ready }
//   state = { throttle, boost, speed, speed01, cruise, cruiseCharge, angVel, strafe,
//             engineMode, atmoDensity, velLocal }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ParticlePool, glowSprite } from '../fx/particles.js';
import { Exhaust } from '../fx/exhaust.js';
import { RCS, defaultThrusters } from '../fx/rcs.js';
import { Reentry } from '../fx/reentry.js';

// Modelo a cargar. Si falla, queda el de primitivas.
const SHIP_CONFIG_URL = 'assets/ships/irs/ship.json';

// ---------- mapa de entorno tenue (sin él, las partes metálicas PBR se ven negras)
let _env = null;
function spaceEnv() {
  if (_env) return _env;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#2a3446'); g.addColorStop(0.45, '#151a24'); g.addColorStop(0.55, '#0c0e14'); g.addColorStop(1, '#050608');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  // banda de la Vía Láctea y algunos brillos
  ctx.fillStyle = 'rgba(180,190,220,0.12)';
  ctx.beginPath(); ctx.ellipse(128, 60, 140, 10, -0.25, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 1, 1);
  }
  _env = new THREE.CanvasTexture(c);
  _env.mapping = THREE.EquirectangularReflectionMapping;
  _env.colorSpace = THREE.SRGBColorSpace;
  return _env;
}

// ---------- modelo de respaldo (primitivas), mismo largo aproximado (~19 m)
function buildFallback() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.6, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.5, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe0612b, metalness: 0.3, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223b55, metalness: 0.9, roughness: 0.1, emissive: 0x0a1a2a });
  const add = (geo, mat, f) => { const m = new THREE.Mesh(geo, mat); f(m); g.add(m); return m; };
  add(new THREE.CylinderGeometry(1.4, 2.0, 12, 16), hull, m => { m.rotation.x = Math.PI / 2; });
  add(new THREE.ConeGeometry(1.4, 5, 16), hull, m => { m.rotation.x = -Math.PI / 2; m.position.z = -8.5; });
  add(new THREE.SphereGeometry(1.1, 16, 12), glass, m => { m.scale.set(0.9, 0.7, 2.0); m.position.set(0, 1.2, -4.5); });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(7, 0.35, 4.5), hull, m => { m.position.set(s * 4.8, -0.3, 2); m.rotation.y = s * 0.35; });
    add(new THREE.BoxGeometry(0.4, 1.8, 3), accent, m => { m.position.set(s * 8.2, 0.4, 3.2); });
    add(new THREE.CylinderGeometry(0.8, 0.9, 5, 12), dark, m => { m.rotation.x = Math.PI / 2; m.position.set(s * 2.6, -0.5, 4.5); });
  }
  add(new THREE.BoxGeometry(0.3, 3, 3.5), accent, m => { m.position.set(0, 2.3, 4.5); });
  g.userData.config = {
    nozzles: [{ pos: [-2.6, -0.5, 7.0], r: 0.75 }, { pos: [0, 0, 6.0], r: 1.2 }, { pos: [2.6, -0.5, 7.0], r: 0.75 }],
    navLights: { red: [-8.4, 0.4, 3.2], green: [8.4, 0.4, 3.2], white: [0, 3.9, 6.0] },
  };
  return g;
}

// Escala el modelo a `length` metros, lo orienta (adelante = -Z) y lo centra.
function normalizeModel(model, cfg) {
  const holder = new THREE.Group();
  holder.add(model);
  if (cfg.rotation) model.rotation.set(...cfg.rotation.map(d => d * Math.PI / 180));
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = (cfg.length ?? 18) / Math.max(1e-6, size.z);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.sub(c);
  if (cfg.offset) model.position.add(new THREE.Vector3(...cfg.offset));
  return holder;
}

function prepMaterials(model, cfg) {
  const env = spaceEnv();
  model.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m.isMeshStandardMaterial) continue;
      m.envMap = env;
      m.envMapIntensity = cfg.envIntensity ?? 0.6;
      if (m.emissiveMap || m.emissive.getHex() !== 0) m.emissiveIntensity = cfg.emissiveIntensity ?? 3;
    }
  });
}

// puntos extremos del modelo (vértices reales) para ubicar luces si la config no las trae
function extremes(model) {
  const r = { minX: new THREE.Vector3(Infinity), maxX: new THREE.Vector3(-Infinity), maxY: new THREE.Vector3(0, -Infinity) };
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.parent?.matrixWorld ?? new THREE.Matrix4()).invert();
  model.traverse(o => {
    const p = o.isMesh && o.geometry.attributes.position;
    if (!p) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const step = Math.max(1, Math.floor(p.count / 20000));
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (v.x < r.minX.x) r.minX.copy(v);
      if (v.x > r.maxX.x) r.maxX.copy(v);
      if (v.y > r.maxY.y) r.maxY.copy(v);
    }
  });
  return r;
}

export function createShipVisual(scene) {
  const root = new THREE.Group();
  root.name = 'ship';
  scene.add(root);
  const pool = new ParticlePool(3000);
  root.add(pool.points);

  let model = null, fx = null, lights = [], time = 0;

  function install(holder, cfg) {
    if (model) root.remove(model);
    fx?.exhaust.dispose();
    for (const l of lights) root.remove(l.sprite);
    model = holder;
    root.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const len = box.getSize(new THREE.Vector3()).z;
    const nozzles = (cfg.nozzles ?? [{ pos: [0, box.getCenter(new THREE.Vector3()).y, box.max.z], r: len * 0.05 }])
      .map(n => ({ pos: new THREE.Vector3(...n.pos), r: n.r }));
    const exhaust = new Exhaust(root, nozzles, pool);
    const thrusters = cfg.thrusters
      ? cfg.thrusters.map(t => ({ pos: new THREE.Vector3(...t.pos), dir: new THREE.Vector3(...t.dir).normalize(), tag: t.tag }))
      : defaultThrusters(box);
    const rcs = new RCS(thrusters, pool, len / 18);
    const reentry = fx?.reentry ?? new Reentry(root, pool);
    reentry.attach(model, box);
    fx = { exhaust, rcs, reentry };

    // luces de navegación: roja a babor (izquierda), verde a estribor, estroboscópica blanca
    const ex = cfg.navLights ? null : extremes(model);
    const nl = cfg.navLights ?? { red: ex.minX.toArray(), green: ex.maxX.toArray(), white: ex.maxY.toArray() };
    const sz = len * 0.09;
    lights = [
      { kind: 'red', color: new THREE.Color(1, 0.08, 0.05), pos: nl.red },
      { kind: 'green', color: new THREE.Color(0.1, 1, 0.25), pos: nl.green },
      { kind: 'white', color: new THREE.Color(1, 1, 1), pos: nl.white },
    ].map(l => {
      const sprite = glowSprite(l.color.clone(), sz);
      sprite.position.set(...l.pos);
      root.add(sprite);
      return { ...l, sprite };
    });
  }

  const fb = buildFallback();
  install(fb, fb.userData.config);

  // carga del modelo glTF (asincrónica: mientras tanto se ve el de respaldo)
  const ready = (async () => {
    try {
      const res = await fetch(SHIP_CONFIG_URL);
      if (!res.ok) throw new Error(`sin ${SHIP_CONFIG_URL}`);
      const cfg = await res.json();
      const base = SHIP_CONFIG_URL.replace(/[^/]+$/, '');
      const gltf = await new GLTFLoader().loadAsync(base + cfg.file);
      const holder = normalizeModel(gltf.scene, cfg);
      prepMaterials(holder, cfg);
      install(holder, cfg);
      console.info(`Nave: modelo "${cfg.name ?? cfg.file}" cargado`);
      return true;
    } catch (e) {
      console.warn('Nave: uso el modelo de respaldo:', e.message);
      return false;
    }
  })();

  const px = () => Math.min(devicePixelRatio, 2) * innerHeight * 0.5;

  function update(st0, dt) {
    if (!(dt >= 0)) dt = 0;
    time += dt;
    const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
    const st = {
      throttle: fin(st0.throttle), boost: fin(st0.boost), speed: fin(st0.speed), speed01: fin(st0.speed01),
      cruise: st0.cruise ?? 'off', cruiseCharge: fin(st0.cruiseCharge),
      angVel: st0.angVel ?? new THREE.Vector3(), strafe: st0.strafe ?? new THREE.Vector2(),
      engineMode: st0.engineMode ?? 'impulse', atmoDensity: fin(st0.atmoDensity), velLocal: st0.velLocal,
    };
    // en main todavía no existe engineMode: el supercrucero usa los colores de crucero
    if (st0.engineMode == null && st.cruise === 'on') st.engineMode = 'cruise';

    fx.exhaust.update(st, dt, time);
    fx.rcs.update(st, dt);
    fx.reentry.update(st, dt, time);

    // parpadeo: rojo/verde fijos con un leve pulso; blanco con doble destello cada 1,2 s
    for (const l of lights) {
      let k;
      if (l.kind === 'white') { const t = time % 1.2; k = (t < 0.05 || (t > 0.15 && t < 0.2)) ? 6 : 0; }
      else { const t = (time + (l.kind === 'red' ? 0 : 0.5)) % 1.0; k = t < 0.5 ? 2.5 : 0.15; }
      l.sprite.material.color.copy(l.color).multiplyScalar(k);
      l.sprite.visible = k > 0;
    }
    pool.update(dt, px());
  }

  return { object3d: root, update, ready, get particles() { return pool.alive; } };
}
