import * as THREE from 'three';
import { SolarSystem } from './system.js';
import { Ship } from './ship.js';
import { HUD } from './hud.js';
import { julianDate, poleToEcliptic } from './ephemeris.js';
import { eclToThree } from './system.js';

// ---------- renderer y cámaras
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app').appendChild(renderer.domElement);

// La cámara está SIEMPRE en el origen; el mundo se dibuja relativo a ella.
// Depth buffer logarítmico: permite near = 0,5 m y far = 10^15 m a la vez.
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 1e15);
const scene = new THREE.Scene();

// fondo estelar: escena aparte que sólo comparte la rotación de la cámara
const bgScene = new THREE.Scene();
const bgCam = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 1, 5000);
buildStars(bgScene);

addEventListener('resize', () => {
  for (const c of [camera, bgCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight);
});

function buildStars(target) {
  // Distribución: estrellas al azar + concentración en el plano galáctico
  const gp = eclToThree(poleToEcliptic(192.859, 27.128)).normalize();
  const ga = new THREE.Vector3(1, 0, 0).cross(gp).normalize();
  const gb = gp.clone().cross(ga);
  const palette = [[0.75, 0.82, 1], [0.9, 0.93, 1], [1, 1, 1], [1, 0.95, 0.85], [1, 0.85, 0.65], [1, 0.72, 0.55]];
  const layers = [
    { n: 5000, size: 1.2, band: 0.3, bright: [0.25, 0.7] },
    { n: 1600, size: 1.8, band: 0.2, bright: [0.5, 0.95] },
    { n: 220, size: 2.8, band: 0.1, bright: [0.8, 1.0] },
    { n: 40000, size: 1.0, band: 1.0, bright: [0.05, 0.16], spread: 0.09 },
  ];
  for (const L of layers) {
    const pos = new Float32Array(L.n * 3), col = new Float32Array(L.n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < L.n; i++) {
      if (Math.random() < L.band) {
        const lon = Math.random() * Math.PI * 2;
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * (L.spread ?? 0.18);
        v.copy(ga).multiplyScalar(Math.cos(lon)).addScaledVector(gb, Math.sin(lon)).addScaledVector(gp, g).normalize();
      } else {
        v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) { i--; continue; }
        v.normalize();
      }
      pos.set([v.x * 1000, v.y * 1000, v.z * 1000], i * 3);
      const c = palette[(Math.random() * palette.length) | 0];
      const b = L.bright[0] + Math.random() * (L.bright[1] - L.bright[0]);
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    target.add(new THREE.Points(g, new THREE.PointsMaterial({
      size: L.size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false,
    })));
  }
}

// ---------- estado del tiempo
let simMs = Date.now();
const WARPS = [1, 10, 100, 1000, 10000, 100000, 1000000];
let warpIdx = 0;
let paused = false;

// ---------- construir
const system = new SolarSystem(scene);
const ship = new Ship(scene);
const loading = document.getElementById('loading');
await system.build((name, p) => {
  loading.querySelector('.bar i').style.width = `${p * 100}%`;
  loading.querySelector('.what').textContent = p >= 1 ? 'Listo' : `Generando ${name}…`;
});
system.update(julianDate(simMs));

// posición inicial: a 22.000 km de la Tierra, del lado iluminado, mirándola
{
  const earth = system.byId.earth;
  const toSun = earth.pos.clone().negate().normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(toSun).normalize();
  const offset = toSun.multiplyScalar(0.8).addScaledVector(side, 0.5).add(new THREE.Vector3(0, 0.25, 0))
    .normalize().multiplyScalar(22000e3);
  ship.place(earth, offset, earth.pos);
  ship.target = system.byId.moon;
  ship.status = 'Objetivo: Luna. Pulsá G para el piloto automático, o H para ver los controles.';
}

window.__game = { ship, system, renderer, scene, camera }; // para depurar desde la consola
const hud = new HUD(system, ship, b => { ship.target = b; ship.status = `Objetivo: ${b.name}`; });
loading.classList.add('done');

// ---------- entrada
const canvas = renderer.domElement;
canvas.addEventListener('click', () => canvas.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('locked', document.pointerLockElement === canvas);
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) { ship.mouse.dx += e.movementX; ship.mouse.dy += e.movementY; }
});
addEventListener('wheel', e => {
  ship.speedFactor = Math.min(20, Math.max(0.05, ship.speedFactor * (e.deltaY > 0 ? 0.85 : 1.18)));
  ship.status = `Factor de supercrucero ×${ship.speedFactor.toFixed(2)}`;
}, { passive: true });

const ORDER = system.bodies;
const PLANET_KEYS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
function setTarget(b) { ship.target = b; ship.status = `Objetivo: ${b.name}`; if (ship.autopilot) ship.engage(); }

addEventListener('keydown', e => {
  ship.keys.add(e.code);
  if (e.code === 'Tab') {
    e.preventDefault();
    const i = ORDER.indexOf(ship.target);
    setTarget(ORDER[(i + (e.shiftKey ? -1 : 1) + ORDER.length) % ORDER.length]);
  }
  if (/^Digit[0-8]$/.test(e.code)) setTarget(system.byId[PLANET_KEYS[+e.code.slice(5)]]);
  if (e.code === 'KeyN' && ship.target) {
    // siguiente luna del sistema del objetivo
    const host = ship.target.parentBody && ship.target.parentBody.id !== 'sun' ? ship.target.parentBody : ship.target;
    const list = [host, ...host.children];
    if (list.length > 1) setTarget(list[(list.indexOf(ship.target) + 1) % list.length]);
  }
  if (e.code === 'KeyG') ship.autopilot ? ship.disengage('manual') : ship.engage();
  if (e.code === 'KeyX') { ship.throttle = 0; ship.disengage('freno'); ship.status = 'Detenido'; }
  if (e.code === 'KeyC') ship.thirdPerson = !ship.thirdPerson;
  if (e.code === 'KeyL') hud.showLabels = !hud.showLabels;
  if (e.code === 'KeyO') system.orbitGroup.visible = !system.orbitGroup.visible;
  if (e.code === 'KeyH') document.getElementById('help').classList.toggle('show');
  if (e.code === 'Period') warpIdx = Math.min(WARPS.length - 1, warpIdx + 1);
  if (e.code === 'Comma') warpIdx = Math.max(0, warpIdx - 1);
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'Backspace') { simMs = Date.now(); warpIdx = 0; ship.status = 'Fecha reiniciada a ahora'; }
});
addEventListener('keyup', e => ship.keys.delete(e.code));
addEventListener('blur', () => ship.keys.clear());

// ---------- bucle
const clock = new THREE.Clock();
const camWorld = new THREE.Vector3();
let frameCount = 0;
function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  // texturas pendientes: una cada ~10 cuadros para no trabar
  if (system.textureQueue.length && (frameCount++ % 10 === 0)) system.generateNextTexture();
  if (!paused) simMs += dt * 1000 * WARPS[warpIdx];
  system.update(julianDate(simMs));
  // re-anclar la nave a su marco con las posiciones nuevas antes de moverla
  ship.world.copy(ship.frame.pos).add(ship.local);
  ship.update(dt, system);

  // cámara: posición absoluta en doubles → todo se dibuja relativo a ella
  camWorld.copy(ship.cameraOffset()).applyQuaternion(ship.quat).add(ship.world);
  camera.position.set(0, 0, 0);
  camera.quaternion.copy(ship.quat);
  camera.updateMatrixWorld();
  ship.model.position.subVectors(ship.world, camWorld);
  ship.model.quaternion.copy(ship.quat);
  ship.model.visible = ship.thirdPerson;
  system.syncRender(camWorld, camera, ship.world, ship.frame);

  bgCam.quaternion.copy(camera.quaternion);
  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.clearDepth();
  renderer.render(scene, camera);

  hud.update(camera, new Date(simMs), WARPS[warpIdx], paused);
  requestAnimationFrame(frame);
}
frame();
