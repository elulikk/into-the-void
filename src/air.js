// Aire para los motores (src/ship/engines.js) y para el plasma de reentrada (src/fx/reentry.js).
// Ya no tiene tabla propia: sale del modelo físico del HUD (src/physics/environment.js,
// equilibrio hidrostático por cuerpo), así motores, efectos e instrumentos coinciden.
import { atmosphereAt } from './physics/environment.js';

export const RHO_EARTH = 1.225;

const NONE = { rho: 0, rho0: 0, rho01: 0, H: 1, top: 0, sound: 0, hasAir: false };
const _a = {}, _b = {}, _c = {};

// Aire a una altitud dada (m) sobre un cuerpo. Fuera del tope, ρ = 0.
// rho0 = densidad a nivel de referencia; H = altura de escala local (m).
export function airAt(body, alt) {
  if (!body || !atmosphereAt(body.id, body.R, 0, _a)) return NONE;
  const rho0 = _a.rho, top = _a.top;
  const h = Math.max(0, alt);
  if (h > top) return { rho: 0, rho0, rho01: 0, H: 1, top, sound: _a.sound, hasAir: true };
  atmosphereAt(body.id, body.R, h, _b);
  atmosphereAt(body.id, body.R, h + 100, _c);
  const rho = _b.rho;
  const H = _c.rho > 0 && rho > _c.rho ? 100 / Math.log(rho / _c.rho) : 8000;
  return { rho, rho0, rho01: rho / rho0, H, top, sound: _b.sound, hasAir: true };
}
