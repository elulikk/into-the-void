// Ruido sin THREE (sirve en el hilo principal y en los workers).
// - noise/fbm: ruido de valor (el que usan las texturas procedurales; NO cambiar,
//   las recetas de relieve lo reusan para que el relieve coincida con los colores).
// - perlin/fbmRange/ridgedRange: ruido de gradiente 3D y fbm con rango de octavas
//   limitado por la longitud de onda mínima (LOD).

// hash entero de una celda (int32)
export function ihash(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h ^ (h >>> 16);
}

// hash en [0, 1]
export function hash(x, y, z, s) {
  return (ihash(x, y, z, s) >>> 0) / 4294967295;
}

const fade = t => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

// ruido de valor en [0, 1]
export function noise(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c000 = hash(xi, yi, zi, s), c100 = hash(xi + 1, yi, zi, s);
  const c010 = hash(xi, yi + 1, zi, s), c110 = hash(xi + 1, yi + 1, zi, s);
  const c001 = hash(xi, yi, zi + 1, s), c101 = hash(xi + 1, yi, zi + 1, s);
  const c011 = hash(xi, yi + 1, zi + 1, s), c111 = hash(xi + 1, yi + 1, zi + 1, s);
  return lerp(
    lerp(lerp(c000, c100, xf), lerp(c010, c110, xf), yf),
    lerp(lerp(c001, c101, xf), lerp(c011, c111, xf), yf), zf);
}

export function fbm(x, y, z, oct = 5, s = 0) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f, z * f, s + i * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

export const mix = (c1, c2, t) => {
  t = Math.min(1, Math.max(0, t));
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
};
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------- ruido de gradiente (Perlin mejorado, hash por celda) ----------------
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
const quint = t => t * t * t * (t * (t * 6 - 15) + 10);

// Perlin 3D en ~[-1, 1]
export function perlin(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = quint(xf), v = quint(yf), w = quint(zf);
  const x1 = xi + 1, y1 = yi + 1, z1 = zi + 1;
  const n000 = grad(ihash(xi, yi, zi, s), xf, yf, zf);
  const n100 = grad(ihash(x1, yi, zi, s), xf - 1, yf, zf);
  const n010 = grad(ihash(xi, y1, zi, s), xf, yf - 1, zf);
  const n110 = grad(ihash(x1, y1, zi, s), xf - 1, yf - 1, zf);
  const n001 = grad(ihash(xi, yi, z1, s), xf, yf, zf - 1);
  const n101 = grad(ihash(x1, yi, z1, s), xf - 1, yf, zf - 1);
  const n011 = grad(ihash(xi, y1, z1, s), xf, yf - 1, zf - 1);
  const n111 = grad(ihash(x1, y1, z1, s), xf - 1, yf - 1, zf - 1);
  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w);
}

// fbm de Perlin sobre la esfera unitaria (sx, sy, sz), con octavas desde la
// frecuencia f0 (ciclos por radio) hasta la longitud de onda minWl (m) en un cuerpo
// de radio R. La última octava entra con un fundido (sin saltos al cambiar de LOD).
// Devuelve la suma con amplitud 1 en la primera octava.
export function fbmRange(sx, sy, sz, f0, R, minWl, gain = 0.57, seed = 0, maxOct = 40) {
  let v = 0, amp = 1, f = f0;
  for (let i = 0; i < maxOct; i++) {
    const wl = R / f;
    if (wl < minWl) break;
    const w = Math.min(1, wl / minWl - 1);
    v += amp * w * perlin(sx * f, sy * f, sz * f, seed + i * 31);
    amp *= gain; f *= 2;
  }
  return v;
}

// multifractal "ridged" (cordilleras): crestas afiladas que se ramifican, en [0, ~1.6]
export function ridgedRange(sx, sy, sz, f0, R, minWl, gain = 0.5, seed = 0, maxOct = 40) {
  let v = 0, amp = 1, f = f0, weight = 1;
  for (let i = 0; i < maxOct; i++) {
    const wl = R / f;
    if (wl < minWl) break;
    const w = Math.min(1, wl / minWl - 1);
    let o = 1 - Math.abs(perlin(sx * f, sy * f, sz * f, seed + i * 31));
    o *= o;
    o *= weight;
    weight = Math.min(1, Math.max(0, o * 2));
    v += o * amp * w;
    amp *= gain; f *= 2;
  }
  return v;
}
