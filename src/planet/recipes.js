// Recetas de relieve por cuerpo (sin THREE: las usan el worker y el hilo principal,
// así la colisión y la altitud de la nave coinciden con lo que se dibuja).
//
// heightAt(sx, sy, sz, minWl) → altura en metros sobre el radio medio R.
//   (sx, sy, sz) es la dirección unitaria en "espacio de estilo": el mismo espacio en
//   el que styles.js pinta las texturas. SphereGeometry pone en la dirección geométrica
//   d = (dx, dy, dz) el texel que el estilo calculó en (-dx, dy, dz), así que quien
//   llama tiene que pasar (-dx, dy, dz) (ver styleDir).
//   minWl: longitud de onda mínima en metros (LOD). Las octavas y los cráteres más
//   chicos que eso no se suman; el último nivel entra con un fundido.
//
// Cada receta tiene además:
//   minH / maxH: cotas (m) para el culling por horizonte y las cajas de los chunks.
//   emissive(sx, sy, sz, h): canal emisivo 0..1 (lava; fase 4/5). Por defecto 0.
//
// Para agregar un cuerpo nuevo: sumá una entrada en RECIPES (o en GENERIC).
import { fbm, smooth, ihash, fbmRange, ridgedRange, clamp01, perlin } from './noise.js';

// dirección geométrica (malla, local al cuerpo) → espacio de estilo
export const styleDir = (dx, dy, dz, out = [0, 0, 0]) => { out[0] = -dx; out[1] = dy; out[2] = dz; return out; };

// ---------------- cráteres multiescala ----------------
// Perfil radial: x = distancia / radio del borde. D = diámetro (m), Dt = diámetro de
// transición simple → complejo (depende de la gravedad). rnd en [0, 1] varía el borde.
function craterProfile(x, D, Dt, rnd) {
  if (x >= 1.8) return 0;
  const s = Math.pow(1 + D / Dt, -0.7);           // los grandes son más playos
  const depth = 0.2 * D * s;                      // profundidad/diámetro ≈ 0.2 en los chicos
  const rim = depth * (0.15 + 0.15 * rnd);        // altura del borde sobre el terreno
  if (x >= 1) { const t = (x - 1) / 0.8; return rim * (1 - t) * (1 - t); }  // manto de eyecta
  const cx = D / Dt;
  const xf = cx > 1 ? Math.min(0.55, 0.22 * Math.log2(cx) + 0.1) : 0;       // piso plano (complejos)
  const xx = x > xf ? x : xf;
  let h = rim + depth * (xx * xx - 1) / (1 - xf * xf);
  if (cx > 2) {                                   // pico central
    const pk = Math.min(1, Math.log2(cx / 2) * 0.5);
    h += depth * 0.4 * pk * Math.exp(-(x * x) / (0.03 + 0.02 * rnd));
  }
  return h;
}

// Campo de cráteres: celdas 3D de frecuencia f (celdas por radio) sobre la esfera,
// duplicando f en cada nivel. Cada celda tiene (con probabilidad p) un cráter con centro
// desplazado ±0.35 y radio ≤ 0.34 celda (influencia ≤ 1.8 radios < 0.65 celda), así alcanza
// con mirar las 8 celdas más cercanas. Cada nivel corre la grilla un vector al azar para que
// no se note la regularidad ni la alineación entre niveles.
// o: { f0, cellMin (m), p, Dt, seed, young (0..1), youngD (m) }
const OFFS = Array.from({ length: 16 }, (_, i) => [0, 1, 2].map(c => (ihash(i, c, 7, 999) >>> 0) / 4294967295));

export function craterField(sx, sy, sz, R, minWl, o) {
  let h = 0;
  let lvl = 0;
  for (let f = o.f0; R / f >= o.cellMin; f *= 2, lvl++) {
    const L = R / f;                         // tamaño de celda (m)
    const fadeW = (0.34 * L) / minWl - 1;    // "longitud de onda" del cráter ≈ D/2
    if (fadeW <= 0) break;
    const w = fadeW < 1 ? fadeW : 1;
    let p = o.p;
    if (o.young && 0.68 * L > o.youngD) p *= 1 - 0.85 * o.young;  // superficies jóvenes: menos cráteres grandes
    if (p <= 0) continue;
    const seed = o.seed + lvl * 101;
    // corrimiento de la grilla de este nivel (el centro de la esfera queda en ox, oy, oz)
    const ox = OFFS[lvl % 16][0], oy = OFFS[lvl % 16][1], oz = OFFS[lvl % 16][2];
    const qx = sx * f + ox, qy = sy * f + oy, qz = sz * f + oz;
    const bx = Math.floor(qx - 0.5), by = Math.floor(qy - 0.5), bz = Math.floor(qz - 0.5);
    for (let c = 0; c < 8; c++) {
      const ix = bx + (c & 1), iy = by + ((c >> 1) & 1), iz = bz + (c >> 2);
      if ((ihash(ix, iy, iz, seed) >>> 0) / 4294967295 > p) continue;
      const h1 = ihash(ix, iy, iz, seed + 1), h2 = ihash(ix, iy, iz, seed + 2);
      const cxp = ix + 0.5 + ((h1 & 1023) / 1023 - 0.5) * 0.7 - ox;   // centro relativo al cuerpo
      const cyp = iy + 0.5 + (((h1 >>> 10) & 1023) / 1023 - 0.5) * 0.7 - oy;
      const czp = iz + 0.5 + (((h1 >>> 20) & 1023) / 1023 - 0.5) * 0.7 - oz;
      const cl = Math.sqrt(cxp * cxp + cyp * cyp + czp * czp);
      const ds = Math.abs(cl - f);           // distancia del centro a la esfera
      if (ds > 0.5) continue;
      const r01 = (h2 & 65535) / 65535;
      const rc = (0.12 + 0.22 * r01 * r01) * Math.sqrt(1 - 4 * ds * ds);
      const k = f / cl;                      // centro proyectado sobre la esfera
      const ex = sx * f - cxp * k, ey = sy * f - cyp * k, ez = sz * f - czp * k;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= 3.24 * rc * rc) continue;
      h += w * craterProfile(Math.sqrt(d2) / rc, 2 * rc * L, o.Dt, ((h2 >>> 16) & 255) / 255);
    }
  }
  return h;
}

// ---------------- recetas ----------------
const RECIPES = {
  // Luna: maria (las mismas manchas oscuras de la textura) hundidas ~2 km, tierras altas
  // rugosas y cráteres en todas las escalas (menos cráteres grandes en los maria).
  moon: R => ({
    minH: -14000, maxH: 12000,
    heightAt(sx, sy, sz, minWl) {
      const maria = fbm(sx * 1.4, sy * 1.4, sz * 1.4, 4, 51);   // = estilo 'moon'
      const mare = smooth(0.5, 0.6, maria);
      let h = -2200 * mare;
      h += (1 - 0.7 * mare) * 3200 * (fbm(sx * 3, sy * 3, sz * 3, 4, 53) - 0.5);
      h += (1 - 0.6 * mare) * 900 * fbmRange(sx, sy, sz, 12, R, minWl, 0.58, 54);
      h += craterField(sx, sy, sz, R, minWl, { f0: 3, cellMin: 20, p: 0.6, Dt: 15000, seed: 55, young: mare, youngD: 12000 });
      return h;
    },
  }),

  // Tierra: continentes del mismo fbm que la textura; océano plano a 0 m (el océano de
  // verdad es de la fase 4) y tierra que sube hasta ~8–9 km con cordilleras "ridged".
  earth: R => ({
    minH: 0, maxH: 10000,
    heightAt(sx, sy, sz, minWl) {
      const n = fbm(sx * 1.6, sy * 1.6, sz * 1.6, 7, 3);      // = estilo 'earth'
      if (n < 0.53) return 0;
      const land = smooth(0.53, 0.82, n);
      const coast = smooth(0.53, 0.55, n);
      const mtn = smooth(0.4, 0.65, fbm(sx * 2.2 + 5, sy * 2.2, sz * 2.2, 4, 7)) * smooth(0.55, 0.7, n);
      let h = 20 + 1300 * land * land;
      // cordilleras: crestas de ~60 km de longitud de onda que se ramifican hacia abajo
      h += mtn * 4800 * ridgedRange(sx, sy, sz, 100, R, minWl, 0.55, 13);
      // colinas y rugosidad (más fuertes cerca de las montañas)
      h += (0.3 + 1.2 * mtn) * 550 * fbmRange(sx, sy, sz, 150, R, minWl, 0.56, 17);
      h *= coast;
      return h > 0 ? h : 0;
    },
  }),

  // Marte: el fbm del estilo (zonas claras altas, oscuras bajas) ±7 km + detalle + cráteres.
  mars: R => ({
    minH: -16000, maxH: 14000,
    heightAt(sx, sy, sz, minWl) {
      const n = fbm(sx * 2, sy * 2, sz * 2, 6, 21);             // = estilo 'mars'
      let h = 18000 * (n - 0.5);
      h += 700 * fbmRange(sx, sy, sz, 10, R, minWl, 0.58, 23);
      h += 600 * fbmRange(sx, sy, sz, 80, R, minWl, 0.56, 24);
      h += craterField(sx, sy, sz, R, minWl, { f0: 4, cellMin: 20, p: 0.3, Dt: 7000, seed: 25 });
      return h;
    },
  }),

  // Mercurio: muy craterizado, como la Luna pero sin maria marcados.
  mercury: R => ({
    minH: -14000, maxH: 10000,
    heightAt(sx, sy, sz, minWl) {
      const n = fbm(sx * 3, sy * 3, sz * 3, 6, 41);             // = estilo 'mercury'
      let h = 4000 * (n - 0.5);
      h += 800 * fbmRange(sx, sy, sz, 12, R, minWl, 0.58, 43);
      h += craterField(sx, sy, sz, R, minWl, { f0: 3, cellMin: 20, p: 0.45, Dt: 10000, seed: 45 });
      return h;
    },
  }),
};

// Lunas rocosas/heladas genéricas: amplitud escalada con el radio, densidad de cráteres
// según la edad de la superficie. ridge: amplitud (m) de crestas lineales (Europa).
const GENERIC = {
  io:        { p: 0.0,  amp: 1.0, seed: 300 },
  europa:    { p: 0.06, amp: 0.12, ridge: 180, seed: 310 },
  ganymede:  { p: 0.25, amp: 0.6, seed: 320 },
  callisto:  { p: 0.55, amp: 0.7, seed: 330 },
  enceladus: { p: 0.25, amp: 0.6, ridge: 120, seed: 340 },
  rhea:      { p: 0.5,  amp: 0.8, seed: 350 },
  titania:   { p: 0.4,  amp: 0.8, seed: 360 },
  oberon:    { p: 0.5,  amp: 0.8, seed: 370 },
  triton:    { p: 0.05, amp: 0.3, seed: 380 },
  phobos:    { p: 0.5,  amp: 1.0, seed: 390 },
  deimos:    { p: 0.4,  amp: 1.0, seed: 400 },
};

function genericRecipe(cfg, R) {
  const A = 8000 * Math.pow(R / 1.7374e6, 0.6) * cfg.amp;     // ~8 km en un cuerpo del tamaño de la Luna
  const Dt = 15000 * (1.7374e6 / R);                          // transición ∝ 1/g ∝ 1/R
  const crat = { f0: 3, cellMin: Math.min(20, R / 3000), p: cfg.p, Dt, seed: cfg.seed + 5 };
  const craterMax = 0.2 * (0.76 * R / 3) * Math.pow(1 + 0.76 * R / 3 / Dt, -0.7);
  return {
    minH: -1.5 * A - (cfg.p > 0 ? 2 * craterMax : 0) - (cfg.ridge || 0),
    maxH: 1.5 * A + craterMax + (cfg.ridge || 0) * 2,
    heightAt(sx, sy, sz, minWl) {
      let h = A * 1.5 * (fbm(sx * 3, sy * 3, sz * 3, 5, cfg.seed) - 0.5);
      h += A * 0.15 * fbmRange(sx, sy, sz, 10, R, minWl, 0.58, cfg.seed + 1);
      if (cfg.ridge) h += cfg.ridge * ridgedRange(sx, sy, sz, 6, R, minWl, 0.55, cfg.seed + 2);
      if (cfg.p > 0) h += craterField(sx, sy, sz, R, minWl, crat);
      return h;
    },
  };
}

// Venus y Titán todavía no tienen terreno (se ve el tope de las nubes; es la fase 5),
// ni tampoco los gigantes gaseosos ni el Sol.
export function hasTerrain(id) { return id in RECIPES || id in GENERIC; }

const cache = new Map();
export function getRecipe(id, R) {
  const key = id + ':' + R;
  let r = cache.get(key);
  if (r) return r;
  if (RECIPES[id]) r = RECIPES[id](R);
  else if (GENERIC[id]) r = genericRecipe(GENERIC[id], R);
  else return null;
  r.R = R;
  r.emissive ||= () => 0;
  // sombreado fino por vértice (variación de albedo a escalas menores que la textura)
  r.shadeNoise ||= (sx, sy, sz, minWl) => fbmRange(sx, sy, sz, R / 4000, R, minWl, 0.7, 777, 14) * 0.5;
  cache.set(key, r);
  return r;
}

export { clamp01, perlin };
