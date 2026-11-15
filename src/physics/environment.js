// Entorno físico alrededor de la nave: atmósfera (presión, temperatura, densidad, sonido),
// irradiancia solar y temperatura de equilibrio en el vacío. Todo en SI.
// Funciones puras (sin three.js) para poder probarlas sueltas.
import { PHYS, ATMO_MODEL } from './bodydata.js';

export const RGAS = 8.314462618;     // J/(mol·K)
export const SIGMA = 5.670374e-8;    // Stefan–Boltzmann, W/(m²·K⁴)
export const SOLAR_1AU = 1361;       // constante solar, W/m²
export const AU_M = 149597870700;
export const G0 = 9.80665;
export const T_CMB = 2.725;          // fondo cósmico

const tables = new Map();

// T(h) lineal por tramos y M(h) interpolada
function profileT(m, h) {
  if (h < 0) return Math.max(2, m.T0 + m.deep * h);
  let T = m.T0, base = 0, lapse = m.layers[0][1];
  for (let i = 1; i < m.layers.length; i++) {
    const [b, l] = m.layers[i];
    if (h < b) break;
    T += lapse * (b - base); base = b; lapse = l;
  }
  return Math.max(2, T + lapse * (h - base));
}
function profileM(m, h) {
  const P = m.Mprof;
  if (!P || h <= P[0][0]) return m.M;
  for (let i = 1; i < P.length; i++) {
    if (h < P[i][0]) {
      const t = (h - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
      return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
    }
  }
  return P[P.length - 1][1];
}
function layerName(m, h) {
  if (h < 0) return 'bajo la referencia';
  let name = m.layers[0][2];
  for (const [b, , n] of m.layers) if (h >= b) name = n;
  return name;
}

// Tabla precalculada integrando el equilibrio hidrostático con g(h) = μ/(R+h)²
function buildTable(id, R) {
  const m = ATMO_MODEL[id], mu = PHYS[id].mu;
  const gas = R > 2e7;
  const hMin = gas ? -600e3 : -30e3;
  const hMax = Math.max(m.top * 1.6, m.layers[m.layers.length - 1][0] + 200e3);
  const N = 4000;
  const step = (hMax - hMin) / N;
  const i0 = Math.round(-hMin / step);
  const lnp = new Float64Array(N + 1);
  const dlnp = h => {
    const g = mu / ((R + h) * (R + h));
    return -profileM(m, h) * g / (RGAS * profileT(m, h));
  };
  lnp[i0] = Math.log(m.p0) + dlnp(0) * (i0 * step + hMin);  // i0·step + hMin ≈ 0
  for (let i = i0 + 1; i <= N; i++) lnp[i] = lnp[i - 1] + dlnp(hMin + (i - 0.5) * step) * step;
  for (let i = i0 - 1; i >= 0; i--) lnp[i] = lnp[i + 1] - dlnp(hMin + (i + 0.5) * step) * step;
  const t = { m, hMin, hMax, step, N, lnp };
  tables.set(id, t);
  return t;
}

export function hasAtmosphere(id) { return !!ATMO_MODEL[id]; }
export function atmoModel(id) { return ATMO_MODEL[id] || null; }

// Atmósfera a una altitud h (m) sobre la superficie de referencia del cuerpo de radio R.
// Devuelve null si el cuerpo no tiene atmósfera.
export function atmosphereAt(id, R, h, out = {}) {
  const m = ATMO_MODEL[id];
  if (!m) return null;
  const t = tables.get(id) || buildTable(id, R);
  const x = (h - t.hMin) / t.step;
  let lnp;
  if (x <= 0) lnp = t.lnp[0] + (t.lnp[1] - t.lnp[0]) * x;
  else if (x >= t.N) lnp = t.lnp[t.N] + (t.lnp[t.N] - t.lnp[t.N - 1]) * (x - t.N);
  else { const i = Math.floor(x), f = x - i; lnp = t.lnp[i] + (t.lnp[i + 1] - t.lnp[i]) * f; }
  const T = profileT(m, h);
  const M = profileM(m, h);
  const p = Math.exp(lnp);
  out.p = p < 1e-12 ? 0 : p;
  out.T = T;
  out.M = M;
  out.rho = out.p * M / (RGAS * T);
  out.sound = Math.sqrt(m.gamma * RGAS * T / M);
  out.gamma = m.gamma;
  out.layer = layerName(m, h);
  out.inside = h < m.top;
  out.top = m.top;
  out.comp = m.comp;
  return out;
}

// Irradiancia solar (W/m²) a una distancia r (m) del Sol
export function solarIrradiance(r) { return SOLAR_1AU * (AU_M / Math.max(r, 7e8)) ** 2; }

// Flujo infrarrojo de un cuerpo a distancia r de su centro (W/m²)
export function planetIR(id, R, r) {
  const T = PHYS[id]?.teff ?? 0;
  return SIGMA * T ** 4 * Math.min(1, (R / Math.max(r, R)) ** 2);
}

// Temperatura de equilibrio de un cuerpo esférico gris (K) bajo flujo solar S e infrarrojo F
export function equilibriumTemp(S, F, absorb = 0.6, emis = 0.85) {
  const q = (absorb * S + emis * F) / (4 * emis * SIGMA);
  return Math.max(T_CMB, Math.pow(q + T_CMB ** 4, 0.25));
}

export const muOf = id => PHYS[id]?.mu ?? 0;
