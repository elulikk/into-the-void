import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SolarSystem } from './system.js';
import { Ship } from './ship.js';
import { ChaseCamera } from './camera.js';
import { SpaceDust } from './dust.js';
import { HUD } from './hud.js';
import { julianDate, poleToEcliptic } from './ephemeris.js';
import { eclToThree } from './system.js';

// ---------- renderer y cámaras
const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
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

// ---------- post-proceso: HDR + bloom (el Sol y los motores brillan)
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
const bgPass = new RenderPass(bgScene, bgCam);
const mainPass = new RenderPass(scene, camera);
mainPass.clear = false;
mainPass.clearDepth = true;
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.55, 2.2);
// Saneado: un solo píxel NaN/Inf se convierte en un cuadrado negro al pasar por el bloom.
// Los reemplaza por negro y limita el brillo máximo antes del bloom.
const sanitize = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = !(c.r < 1e4 && c.r > -1e4) || !(c.g < 1e4 && c.g > -1e4) || !(c.b < 1e4 && c.b > -1e4);
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }`,
});
composer.addPass(bgPass);
composer.addPass(mainPass);
composer.addPass(sanitize);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  for (const c of [camera, bgCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

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
system.renderer = renderer; // para precalcular las tablas de las atmósferas
const ship = new Ship(scene);
const cam = new ChaseCamera(65);
const dust = new SpaceDust(scene);
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
  ship.status = 'Objetivo: Luna. T = modo de motor · G = piloto automático · J = supercrucero · H = controles';
}

// módulos opcionales (sonido y gamepad): si no están o fallan, el juego sigue igual
let audio = null, pad = null;
import('./audio.js').then(m => { audio = new m.ShipAudio(); }).catch(e => console.warn('Sin sonido:', e.message));
import('./gamepad.js').then(m => { pad = new m.GamepadInput(); }).catch(e => console.warn('Sin gamepad:', e.message));

window.__game = { ship, system, renderer, scene, camera, cam, composer, bloom }; // para depurar desde la consola
const hud = new HUD(system, ship, b => { ship.target = b; ship.status = `Objetivo: ${b.name}`; });
loading.classList.add('done');

// ---------- entrada
const canvas = renderer.domElement;
let rightHeld = false, altHeld = false;
canvas.addEventListener('click', () => { canvas.requestPointerLock(); audio?.resume(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => { if (e.button === 2) rightHeld = true; audio?.resume(); });
addEventListener('mouseup', e => { if (e.button === 2) rightHeld = false; });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
  if (!locked) ship.recenter();
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  if (cam.freelook) cam.freelookInput(e.movementX, e.movementY);
  else { ship.mouse.dx += e.movementX; ship.mouse.dy += e.movementY; }
});
addEventListener('wheel', e => {
  ship.speedFactor = Math.min(20, Math.max(0.05, ship.speedFactor * (e.deltaY > 0 ? 0.85 : 1.18)));
  ship.status = `Factor de velocidad ×${ship.speedFactor.toFixed(2)}`;
}, { passive: true });

const ORDER = system.bodies;
const PLANET_KEYS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
function setTarget(b) { ship.target = b; ship.status = `Objetivo: ${b.name}`; if (ship.autopilot) ship.engage(); }

function action(name, shift = false) {
  switch (name) {
    case 'nextTarget': case 'prevTarget': {
      const i = ORDER.indexOf(ship.target);
      const dir = name === 'prevTarget' || shift ? -1 : 1;
      setTarget(ORDER[(i + dir + ORDER.length) % ORDER.length]);
      break;
    }
    case 'autopilot': ship.autopilot ? ship.disengage('manual') : ship.engage(); break;
    case 'engineMode': ship.cycleEngineMode(); break;
    case 'engineAtmo': ship.setEngineMode('atmo'); break;
    case 'engineImpulse': ship.setEngineMode('impulse'); break;
    case 'cruise': ship.toggleCruise(); if (ship.autopilot && ship.cruise === 'off') ship.disengage('supercrucero'); break;
    case 'brake':
      ship.throttle = 0; ship.disengage('freno'); ship.dropCruise('freno'); ship.recenter(); ship.status = 'Detenido';
      break;
    case 'camera': ship.thirdPerson = !ship.thirdPerson; break;
    case 'labels': hud.showLabels = !hud.showLabels; break;
    case 'help': document.getElementById('help').classList.toggle('show'); break;
  }
}

addEventListener('keydown', e => {
  if (e.repeat && !/^(Arrow|Key[WSADRFQE])/.test(e.code)) return;
  ship.keys.add(e.code);
  if (e.code === 'AltLeft' || e.code === 'AltRight') { e.preventDefault(); altHeld = true; }
  if (e.code === 'Tab') { e.preventDefault(); action('nextTarget', e.shiftKey); }
  if (/^Digit[0-8]$/.test(e.code)) setTarget(system.byId[PLANET_KEYS[+e.code.slice(5)]]);
  if (e.code === 'KeyN' && ship.target) {
    // siguiente luna del sistema del objetivo
    const host = ship.target.parentBody && ship.target.parentBody.id !== 'sun' ? ship.target.parentBody : ship.target;
    const list = [host, ...host.children];
    if (list.length > 1) setTarget(list[(list.indexOf(ship.target) + 1) % list.length]);
  }
  if (e.code === 'KeyG') action('autopilot');
  if (e.code === 'KeyJ') action('cruise');
  if (e.code === 'KeyT') action('engineMode');
  if (e.code === 'KeyY') action('engineAtmo');
  if (e.code === 'KeyU') action('engineImpulse');
  if (e.code === 'KeyX') action('brake');
  if (e.code === 'KeyC') action('camera');
  if (e.code === 'KeyL') action('labels');
  if (e.code === 'KeyH') action('help');
  if (e.code === 'KeyO') system.orbitGroup.visible = !system.orbitGroup.visible;
  if (e.code === 'KeyV') {
    ship.mouseMode = ship.mouseMode === 'stick' ? 'direct' : 'stick';
    ship.recenter();
    ship.status = ship.mouseMode === 'stick' ? 'Mouse: joystick virtual' : 'Mouse: directo';
  }
  if (e.code === 'KeyB') { bloom.enabled = !bloom.enabled; ship.status = `Bloom ${bloom.enabled ? 'activado' : 'desactivado'}`; }
  if (e.code === 'KeyM' && audio) { audio.muted = !audio.muted; audio.setMuted(audio.muted); ship.status = audio.muted ? 'Sonido silenciado' : 'Sonido activado'; }
  if (e.code === 'Period') warpIdx = Math.min(WARPS.length - 1, warpIdx + 1);
  if (e.code === 'Comma') warpIdx = Math.max(0, warpIdx - 1);
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'Backspace') { simMs = Date.now(); warpIdx = 0; ship.status = 'Fecha reiniciada a ahora'; }
});
addEventListener('keyup', e => {
  ship.keys.delete(e.code);
  if (e.code === 'AltLeft' || e.code === 'AltRight') altHeld = false;
});
addEventListener('blur', () => { ship.keys.clear(); rightHeld = altHeld = false; });

// ---------- bucle
const clock = new THREE.Clock();
const renderQuat = new THREE.Quaternion();
let frameCount = 0;
function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  // texturas pendientes: una cada ~10 cuadros para no trabar
  if (system.textureQueue.length && (frameCount++ % 10 === 0)) system.generateNextTexture();
  if (!paused) simMs += dt * 1000 * WARPS[warpIdx];
  system.update(julianDate(simMs));

  // gamepad
  let padState = null;
  if (pad) {
    const s = pad.poll();
    if (pad.connected) {
      padState = s;
      for (const [name, on] of Object.entries(s.pressed || {})) if (on) action(name);
    }
  }
  cam.freelook = rightHeld || altHeld || !!padState?.freelookHeld;

  // re-anclar la nave a su marco con las posiciones nuevas antes de moverla
  ship.world.copy(ship.frame.pos).add(ship.local);
  ship.update(dt, system, padState);
  cam.update(dt, ship);

  // cámara: posición absoluta en doubles → todo se dibuja relativo a ella
  const camWorld = cam.world;
  camera.position.set(0, 0, 0);
  camera.quaternion.copy(cam.quat);
  if (Math.abs(camera.fov - cam.fov) > 0.01) {
    camera.fov = bgCam.fov = cam.fov;
    camera.updateProjectionMatrix(); bgCam.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
  ship.model.position.subVectors(ship.world, camWorld);
  ship.model.quaternion.copy(ship.renderQuat(renderQuat));
  ship.model.visible = ship.thirdPerson;
  system.syncRender(camWorld, camera, ship.world, ship.frame);

  const speed01 = Math.min(1, ship.vel.length() / Math.max(1, ship.vmax));
  dust.update(dt, ship.vel, speed01, ship.cruise === 'on' ? 1 : 0);

  bgCam.quaternion.copy(camera.quaternion);
  composer.render(dt);

  audio?.update(ship.audioState(), dt);
  hud.update(camera, new Date(simMs), WARPS[warpIdx], paused);
  ship.events.length = 0;
  requestAnimationFrame(frame);
}
frame();
