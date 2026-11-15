// Geometría del cubo esferizado (sin THREE, compartida por el worker y el quadtree).
// Cada cara: normal n y ejes u, v con u × v = n (así los triángulos (i,j)→(i+1,j)→(i+1,j+1)
// quedan en sentido antihorario vistos desde afuera).
export const N = 33;   // vértices por lado de un chunk

export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

// (a, b) en [-1, 1] sobre la cara → dirección unitaria. Mapeo "cubo → esfera" que
// reparte el área mejor que normalizar (x·sqrt(1 - y²/2 - z²/2 + y²z²/3)).
export function cubeDir(F, a, b, out) {
  const x = F.n[0] + a * F.u[0] + b * F.v[0];
  const y = F.n[1] + a * F.u[1] + b * F.v[1];
  const z = F.n[2] + a * F.u[2] + b * F.v[2];
  const x2 = x * x, y2 = y * y, z2 = z * z;
  const sx = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + y2 * z2 / 3));
  const sy = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + z2 * x2 / 3));
  const sz = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + x2 * y2 / 3));
  const l = Math.hypot(sx, sy, sz);
  out[0] = sx / l; out[1] = sy / l; out[2] = sz / l;
  return out;
}
