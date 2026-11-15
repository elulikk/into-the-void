// Ayudante de depuración para probar las nubes con el panel de preview oculto (rAF ~1 fps):
// await import('/tools/debug_nubes.js')  →  frena el bucle y expone __place / __f / __perf.
//   __place('earth', altKm, latGrados, lonGrados)  ubica la nave sobre el planeta
//   __f(n)                                         renderiza n cuadros a mano
const g = window.__game;
window.requestAnimationFrame = () => 0;
document.getElementById('loading').style.display = 'none';
const V = g.camera.position.constructor;
window.__place = (id, altKm, lat, lon, look) => {
  const { ship, system } = g, e = system.byId[id];
  let dir = ship.world.clone().sub(e.pos).normalize();
  if (lat !== undefined) {
    const r = Math.PI / 180;
    dir = new V(Math.cos(lat * r) * Math.cos(lon * r), Math.sin(lat * r), Math.cos(lat * r) * Math.sin(lon * r)).applyQuaternion(e.tilt).normalize();
  }
  ship.place(e, dir.multiplyScalar(e.R + altKm * 1000), look ?? e.pos);
  ship.vel.set(0, 0, 0); ship.throttle = 0;
  ship.world.copy(ship.frame.pos).add(ship.local);
  ship.update(0.016, system, null);
  g.cam.ready = false; g.cam.update(0.016, ship);
};
// Sobre el punto subsolar (az = 0) o desplazado az° hacia el este / el° hacia el norte (para ver amaneceres)
window.__placeSun = (id, altKm, az = 0, el = 0, look) => {
  const { system } = g, e = system.byId[id], r = Math.PI / 180;
  const toSun = e.pos.clone().negate().normalize();
  const up = new V(0, 1, 0), east = up.clone().cross(toSun).normalize(), north = toSun.clone().cross(east).normalize();
  const dir = toSun.clone().multiplyScalar(Math.cos(az * r) * Math.cos(el * r)).addScaledVector(east, Math.sin(az * r) * Math.cos(el * r)).addScaledVector(north, Math.sin(el * r)).normalize();
  window.__place2(e, dir, altKm, look);
};
window.__place2 = (e, dir, altKm, look) => {
  const { ship, system } = g;
  ship.place(e, dir.clone().multiplyScalar(e.R + altKm * 1000), look ?? e.pos);
  ship.vel.set(0, 0, 0); ship.throttle = 0;
  ship.world.copy(ship.frame.pos).add(ship.local);
  ship.update(0.016, system, null);
  g.cam.ready = false; g.cam.update(0.016, ship);
};
// Cabecea la nave (+ = sube la mirada) y alabea; sirve para mirar el horizonte
window.__look = (pitchDeg, yawDeg = 0) => {
  const Q = g.cam.quat.constructor, r = Math.PI / 180;
  g.ship.quat.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), pitchDeg * r));
  g.ship.quat.multiply(new Q().setFromAxisAngle(new V(0, 1, 0), yawDeg * r));
  g.cam.ready = false; g.cam.update(0.016, g.ship);
};
window.__frame = () => {
  const cam = g.cam, camera = g.camera;
  camera.position.set(0, 0, 0); camera.quaternion.copy(cam.quat); camera.updateMatrixWorld();
  g.ship.model.position.subVectors(g.ship.world, cam.world);
  g.ship.model.quaternion.copy(g.ship.renderQuat(new g.cam.quat.constructor()));
  g.system.syncRender(cam.world, camera, g.ship.world, g.ship.frame);
  g.cloudPass.update(0.016, g.system, camera);
  g.cine.update(camera, g.system.bodies, g.system.byId.sun, g.cloudPass.coverDim, performance.now() / 1000);
  g.composer.render(0.016);
};
window.__f = (n = 30) => { for (let i = 0; i < n; i++) window.__frame(); };
window.__perf = async (n = 60) => {
  window.__f(n); await new Promise(r => setTimeout(r, 400)); window.__f(n); await new Promise(r => setTimeout(r, 400));
  g.gpuTimer.poll(); return JSON.stringify(g.gpuTimer.ms);
};
