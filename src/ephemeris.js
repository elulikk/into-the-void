// Efemérides aproximadas.
// Planetas: elementos keplerianos de JPL "Approximate Positions of the Planets"
// (Standish, válidos 1800–2050, error de unos pocos minutos de arco).
// Todas las posiciones se devuelven en METROS, en coordenadas eclípticas J2000
// (x hacia el equinoccio vernal, z hacia el polo norte de la eclíptica).

export const AU = 1.495978707e11;
const DEG = Math.PI / 180;

// [a (UA), e, I, L, long.perihelio, long.nodo]  y sus tasas por siglo
export const PLANET_ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  emb:     [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

export function julianDate(ms) {
  return ms / 86400000 + 2440587.5;
}

function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Elementos clásicos (a en metros, ángulos en radianes) → posición eclíptica
export function orbitalPosition(a, e, I, Omega, omega, M, out = [0, 0, 0]) {
  const E = solveKepler(M, e);
  return positionFromE(a, e, I, Omega, omega, E, out);
}

export function positionFromE(a, e, I, Omega, omega, E, out = [0, 0, 0]) {
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cO = Math.cos(Omega), sO = Math.sin(Omega);
  const cI = Math.cos(I), sI = Math.sin(I);
  out[0] = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  out[1] = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  out[2] = (sw * sI) * xp + (cw * sI) * yp;
  return out;
}

// Elementos de un planeta en la fecha (T = siglos julianos desde J2000)
export function planetElements(id, jd) {
  const T = (jd - 2451545.0) / 36525;
  const [b, r] = PLANET_ELEMENTS[id];
  const a = (b[0] + r[0] * T) * AU;
  const e = b[1] + r[1] * T;
  const I = (b[2] + r[2] * T) * DEG;
  const L = b[3] + r[3] * T;
  const varpi = b[4] + r[4] * T;
  const Omega = (b[5] + r[5] * T) * DEG;
  const omega = varpi * DEG - Omega;
  let M = ((L - varpi) % 360 + 540) % 360 - 180;
  return { a, e, I, Omega, omega, M: M * DEG };
}

export function planetPosition(id, jd, out) {
  const el = planetElements(id, jd);
  return orbitalPosition(el.a, el.e, el.I, el.Omega, el.omega, el.M, out);
}

// Luna: elementos medios con precesión del nodo y del perigeo (error de ~1–3°).
export function moonElements(jd) {
  const d = jd - 2451545.0;
  const Omega = (125.045 - 0.0529539 * d) * DEG;
  const varpi = (83.353 + 0.11140353 * d) * DEG;
  const M = (134.963 + 13.064993 * d) * DEG;
  return { a: 384400e3, e: 0.0549, I: 5.145 * DEG, Omega, omega: varpi - Omega, M };
}

// Polo (RA/Dec ecuatorial J2000, grados) → vector unitario eclíptico
const EPS = 23.4392911 * DEG;
export function poleToEcliptic(raDeg, decDeg) {
  const a = raDeg * DEG, d = decDeg * DEG;
  const x = Math.cos(d) * Math.cos(a);
  const y = Math.cos(d) * Math.sin(a);
  const z = Math.sin(d);
  return [x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS)];
}
