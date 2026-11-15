// Worker de chunks de terreno (módulo, sin THREE).
// Chunk = cara del cubo + (x0, y0, size) en [-1, 1]. Grilla de N×N vértices sobre el
// cubo "esferizado", más un anillo extra (sólo para las normales, así los bordes de
// chunks vecinos calculan exactamente las mismas normales) y faldones (skirts) que
// tapan las grietas entre niveles distintos.
//
// Devuelve, en float32 y relativo al centro del chunk (precisión):
//   position (vec3), normal (vec3), pdir (vec3, dirección unitaria → UV de la textura),
//   surf (vec2: shade = oscurecimiento por pendiente + ruido fino, emisivo para lava).
// El centro (doubles) se calcula igual en el hilo principal (cubeDir de faces.js).
import { getRecipe } from './recipes.js';
import { FACES, cubeDir, N } from './faces.js';

const G = N + 2;                         // con el anillo de borde
let indexCache = null;

function buildIndices() {
  // (N-1)² quads + 4 faldones de N-1 quads cada uno
  const quads = (N - 1) * (N - 1) + 4 * (N - 1);
  const idx = new Uint16Array(quads * 6);
  let k = 0;
  const quad = (a, b, c, d) => { idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = a; idx[k++] = c; idx[k++] = d; };
  const V = (i, j) => j * N + i;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) quad(V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1));
  // faldones: vértices extra después de la grilla, en el orden de skirtEdges()
  const base = N * N;
  const S = (e, t) => base + e * N + t;
  for (let t = 0; t < N - 1; t++) {
    quad(V(t, 0), S(0, t), S(0, t + 1), V(t + 1, 0));                 // borde j = 0
    quad(V(t + 1, N - 1), S(1, t + 1), S(1, t), V(t, N - 1));         // borde j = N-1
    quad(V(0, t + 1), S(2, t + 1), S(2, t), V(0, t));                 // borde i = 0
    quad(V(N - 1, t), S(3, t), S(3, t + 1), V(N - 1, t + 1));         // borde i = N-1
  }
  return idx;
}

function edgeVertex(e, t) {
  if (e === 0) return [t, 0];
  if (e === 1) return [t, N - 1];
  if (e === 2) return [0, t];
  return [N - 1, t];
}

const dir = [0, 0, 0];

function build(job) {
  const t0 = performance.now();
  const { body, R, face, x0, y0, size } = job;
  const rec = getRecipe(body, R);
  const F = FACES[face];
  const step = size / (N - 1);
  const spacing = step * R * Math.PI / 4;        // separación aproximada entre vértices (m)
  const minWl = spacing * 1.5;

  // centro del chunk en doubles (sobre la esfera de radio R)
  cubeDir(F, x0 + size / 2, y0 + size / 2, dir);
  const cx = dir[0] * R, cy = dir[1] * R, cz = dir[2] * R;

  // posiciones (doubles, relativas al centro) y direcciones de toda la grilla con borde
  const P = new Float64Array(G * G * 3);
  const D = new Float64Array(G * G * 3);
  let hMin = Infinity, hMax = -Infinity;
  const H = new Float64Array(G * G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      cubeDir(F, x0 + (i - 1) * step, y0 + (j - 1) * step, dir);
      const h = rec.heightAt(-dir[0], dir[1], dir[2], minWl);
      const r = R + h;
      const k = (j * G + i) * 3;
      D[k] = dir[0]; D[k + 1] = dir[1]; D[k + 2] = dir[2];
      P[k] = dir[0] * r - cx; P[k + 1] = dir[1] * r - cy; P[k + 2] = dir[2] * r - cz;
      H[j * G + i] = h;
      if (i > 0 && j > 0 && i <= N && j <= N) { if (h < hMin) hMin = h; if (h > hMax) hMax = h; }
    }
  }

  const NV = N * N + 4 * N;
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), pdir = new Float32Array(NV * 3);
  const surf = new Float32Array(NV * 2);
  let rad2 = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const g = ((j + 1) * G + (i + 1)) * 3;
      const gl = g - 3, gr = g + 3, gd = g - G * 3, gu = g + G * 3;
      // normal = (derecha - izquierda) × (arriba - abajo); u × v apunta hacia afuera
      const ax = P[gr] - P[gl], ay = P[gr + 1] - P[gl + 1], az = P[gr + 2] - P[gl + 2];
      const bx = P[gu] - P[gd], by = P[gu + 1] - P[gd + 1], bz = P[gu + 2] - P[gd + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const v = j * N + i;
      pos[v * 3] = P[g]; pos[v * 3 + 1] = P[g + 1]; pos[v * 3 + 2] = P[g + 2];
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      const dx = D[g], dy = D[g + 1], dz = D[g + 2];
      pdir[v * 3] = dx; pdir[v * 3 + 1] = dy; pdir[v * 3 + 2] = dz;
      const r2 = P[g] * P[g] + P[g + 1] * P[g + 1] + P[g + 2] * P[g + 2];
      if (r2 > rad2) rad2 = r2;
      // sombreado: pendientes un poco más oscuras + ruido fino de albedo
      const slope = 1 - (nx * dx + ny * dy + nz * dz);
      const sl = Math.min(1, Math.max(0, (slope - 0.03) / 0.4));
      const fine = rec.shadeNoise(-dx, dy, dz, minWl);
      surf[v * 2] = Math.max(0.2, (1 - 0.3 * sl) * (1 + 0.18 * fine));
      surf[v * 2 + 1] = rec.emissive(-dx, dy, dz, H[(j + 1) * G + (i + 1)]);
    }
  }
  // faldones: copia del borde hundida hacia el centro del cuerpo
  const skirt = Math.max(2, spacing * 3) + (hMax - hMin) * 0.05;
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < N; t++) {
      const [i, j] = edgeVertex(e, t);
      const src = j * N + i, dst = N * N + e * N + t;
      const dx = pdir[src * 3], dy = pdir[src * 3 + 1], dz = pdir[src * 3 + 2];
      pos[dst * 3] = pos[src * 3] - dx * skirt;
      pos[dst * 3 + 1] = pos[src * 3 + 1] - dy * skirt;
      pos[dst * 3 + 2] = pos[src * 3 + 2] - dz * skirt;
      for (let c = 0; c < 3; c++) { nor[dst * 3 + c] = nor[src * 3 + c]; pdir[dst * 3 + c] = pdir[src * 3 + c]; }
      surf[dst * 2] = surf[src * 2]; surf[dst * 2 + 1] = surf[src * 2 + 1];
    }
  }
  const index = (indexCache ||= buildIndices()).slice();
  return {
    id: job.id, pos, nor, pdir, surf, index,
    radius: Math.sqrt(rad2) + skirt, hMin, hMax, ms: performance.now() - t0,
  };
}

self.onmessage = e => {
  const job = e.data;
  try {
    const r = build(job);
    self.postMessage(r, [r.pos.buffer, r.nor.buffer, r.pdir.buffer, r.surf.buffer, r.index.buffer]);
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err && err.stack || err) });
  }
};
