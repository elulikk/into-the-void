// Modelo simple de aire por planeta: densidad exponencial ρ = ρ0 · exp(-h / H).
// Lo usan los motores (src/ship/engines.js) para el arrastre y la velocidad tope en
// modo atmosférico. Está aparte a propósito: el HUD (modelo físico del entorno) lo
// puede unificar o reemplazar sin tocar los motores.
//
// ρ0 en kg/m³ a "nivel del suelo" (en los gigantes gaseosos, el nivel de 1 bar),
// H = altura de escala en m, sound = velocidad del sonido cerca del suelo en m/s.
// El tope de la atmósfera sale de ATMOSPHERES (src/bodies.js).
import { ATMOSPHERES } from './bodies.js';

export const RHO_EARTH = 1.225;

export const AIR = {
  earth:   { rho0: 1.225, H: 8500,  sound: 340 },
  mars:    { rho0: 0.020, H: 11100, sound: 240 },
  venus:   { rho0: 65,    H: 15900, sound: 410 },
  titan:   { rho0: 5.4,   H: 40000, sound: 195 },
  jupiter: { rho0: 0.16,  H: 27000, sound: 1100 },
  saturn:  { rho0: 0.19,  H: 59500, sound: 800 },
  uranus:  { rho0: 0.42,  H: 27700, sound: 900 },
  neptune: { rho0: 0.45,  H: 19700, sound: 850 },
};

const NONE = { rho: 0, rho0: 0, rho01: 0, H: 1, top: 0, sound: 0, hasAir: false };

// Aire a una altitud dada (m) sobre un cuerpo. Fuera del tope, ρ = 0.
export function airAt(body, alt) {
  const a = body && AIR[body.id];
  const atm = body && ATMOSPHERES[body.id];
  if (!a || !atm) return NONE;
  const h = Math.max(0, alt);
  const rho = h > atm.top ? 0 : a.rho0 * Math.exp(-h / a.H);
  return { rho, rho0: a.rho0, rho01: rho / a.rho0, H: a.H, top: atm.top, sound: a.sound, hasAir: true };
}
