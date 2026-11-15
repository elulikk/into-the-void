// Datos físicos de los cuerpos. Radios y SOI en km, rotación en horas
// (negativa = retrógrada), polo = [RA, Dec] IAU J2000 en grados.
// Lunas: órbita en el plano ecuatorial del planeta; a en km, período en días,
// M0 = anomalía media en J2000 (aproximada para la mayoría).

// Atmósferas (scattering): β en 1/m (R, G, B), alturas de escala en m.
//   rayleigh/hR: moléculas · mie/mieAbs/hM/g: aerosoles, polvo, neblina
//   abs/absCenter/absWidth: absorción (ozono; si absWidth = 0 sigue la densidad de Rayleigh, p. ej. metano)
const E6 = a => a.map(x => x * 1e-6);
export const ATMOSPHERES = {
  earth: { top: 80e3, rayleigh: E6([5.802, 13.558, 33.1]), hR: 8000,
    mie: E6([3.996, 3.996, 3.996]), mieAbs: E6([0.44, 0.44, 0.44]), hM: 1200, g: 0.8,
    abs: E6([0.65, 1.881, 0.085]), absCenter: 25e3, absWidth: 15e3 },
  // Marte: aire finísimo, cielo color caramelo por el polvo (que absorbe el azul)
  mars: { top: 90e3, rayleigh: E6([0.06, 0.14, 0.33]), hR: 11000,
    mie: E6([16, 11, 6.5]), mieAbs: E6([2, 5, 11]), hM: 11000, g: 0.76 },
  // Venus: el "suelo" visible es el tope de las nubes; encima, neblina amarillenta y CO2 denso
  venus: { top: 120e3, rayleigh: E6([12, 28, 68]), hR: 15000,
    mie: E6([14, 12, 7]), mieAbs: E6([1, 2, 6]), hM: 6000, g: 0.7 },
  // Titán: neblina orgánica naranja muy alta, absorbe el azul
  titan: { top: 600e3, rayleigh: E6([0.4, 0.9, 2.2]), hR: 60000,
    mie: E6([5, 3, 1.2]), mieAbs: E6([0.8, 2, 4.5]), hM: 45000, g: 0.65 },
  jupiter: { top: 400e3, rayleigh: E6([0.35, 0.8, 1.9]), hR: 27000,
    mie: E6([0.6, 0.55, 0.45]), mieAbs: E6([0.1, 0.15, 0.25]), hM: 20000, g: 0.7 },
  saturn: { top: 500e3, rayleigh: E6([0.3, 0.7, 1.6]), hR: 60000,
    mie: E6([0.5, 0.45, 0.3]), mieAbs: E6([0.05, 0.1, 0.2]), hM: 40000, g: 0.7 },
  // Urano y Neptuno: Rayleigh fuerte + metano que absorbe el rojo
  uranus: { top: 300e3, rayleigh: E6([0.9, 2.1, 5.0]), hR: 28000,
    abs: E6([1.6, 0.25, 0.05]), hM: 10000 },
  neptune: { top: 300e3, rayleigh: E6([1.0, 2.4, 5.6]), hR: 20000,
    abs: E6([2.2, 0.5, 0.05]), hM: 10000 },
};

export const BODIES = [
  { id: 'sun', name: 'Sol', radius: 695700, soi: Infinity, pole: [286.13, 63.87], rot: 609.12,
    color: '#ffd27a', tex: 'sun' },

  { id: 'mercury', name: 'Mercurio', parent: 'sun', radius: 2439.7, soi: 1.12e5, pole: [281.01, 61.45], rot: 1407.6,
    color: '#b9b2a8', tex: 'mercury' },
  { id: 'venus', name: 'Venus', parent: 'sun', radius: 6051.8, soi: 6.16e5, pole: [272.76, 67.16], rot: -5832.5,
    color: '#e8cf96', tex: 'venus', atmo: '#f3d9a0' },
  { id: 'earth', name: 'Tierra', parent: 'sun', radius: 6371, soi: 9.25e5, pole: [0, 90], rot: 23.9345,
    color: '#6fa8ff', tex: 'earth', atmo: '#7fb4ff' },
  { id: 'mars', name: 'Marte', parent: 'sun', radius: 3389.5, soi: 5.77e5, pole: [317.68, 52.89], rot: 24.6229,
    color: '#e07a4f', tex: 'mars', atmo: '#e8a27c' },
  { id: 'jupiter', name: 'Júpiter', parent: 'sun', radius: 69911, soi: 4.82e7, pole: [268.06, 64.50], rot: 9.925,
    color: '#e3c49c', tex: 'jupiter' },
  { id: 'saturn', name: 'Saturno', parent: 'sun', radius: 58232, soi: 5.48e7, pole: [40.59, 83.54], rot: 10.656,
    color: '#ecd9a6', tex: 'saturn', rings: [74500, 140220] },
  { id: 'uranus', name: 'Urano', parent: 'sun', radius: 25362, soi: 5.18e7, pole: [257.31, -15.18], rot: -17.24,
    color: '#a8e4ea', tex: 'uranus' },
  { id: 'neptune', name: 'Neptuno', parent: 'sun', radius: 24622, soi: 8.66e7, pole: [299.36, 43.46], rot: 16.11,
    color: '#5b7cff', tex: 'neptune' },

  // Lunas
  { id: 'moon', name: 'Luna', parent: 'earth', radius: 1737.4, soi: 66100, pole: [269.99, 66.54], rot: 655.72,
    color: '#cfcfcf', tex: 'moon', orbit: 'luna' },
  { id: 'phobos', name: 'Fobos', parent: 'mars', radius: 11.27, soi: 60, rot: 7.654, color: '#a89f94', tex: 'rock',
    orbit: { a: 9376, e: 0.0151, i: 1.08, P: 0.31891, M0: 92 } },
  { id: 'deimos', name: 'Deimos', parent: 'mars', radius: 6.2, soi: 120, rot: 30.3, color: '#b8a998', tex: 'rock',
    orbit: { a: 23463, e: 0.00033, i: 1.79, P: 1.26244, M0: 296 } },
  { id: 'io', name: 'Ío', parent: 'jupiter', radius: 1821.6, soi: 7836, rot: 42.46, color: '#f1dc6a', tex: 'io',
    orbit: { a: 421700, e: 0.0041, i: 0.05, P: 1.769138, M0: 342 } },
  { id: 'europa', name: 'Europa', parent: 'jupiter', radius: 1560.8, soi: 9723, rot: 85.23, color: '#e6dccb', tex: 'europa',
    orbit: { a: 671034, e: 0.009, i: 0.47, P: 3.551181, M0: 171 } },
  { id: 'ganymede', name: 'Ganimedes', parent: 'jupiter', radius: 2634.1, soi: 24351, rot: 171.7, color: '#b5a896', tex: 'ganymede',
    orbit: { a: 1070412, e: 0.0013, i: 0.2, P: 7.154553, M0: 317 } },
  { id: 'callisto', name: 'Calisto', parent: 'jupiter', radius: 2410.3, soi: 37684, rot: 400.5, color: '#8c7f70', tex: 'callisto',
    orbit: { a: 1882709, e: 0.0074, i: 0.2, P: 16.689017, M0: 181 } },
  { id: 'enceladus', name: 'Encélado', parent: 'saturn', radius: 252.1, soi: 483, rot: 32.9, color: '#f4f6f8', tex: 'ice',
    orbit: { a: 237948, e: 0.0047, i: 0.02, P: 1.370218, M0: 199 } },
  { id: 'rhea', name: 'Rea', parent: 'saturn', radius: 763.8, soi: 3500, rot: 108.4, color: '#d8d4cc', tex: 'rock',
    orbit: { a: 527108, e: 0.0013, i: 0.35, P: 4.518212, M0: 31 } },
  { id: 'titan', name: 'Titán', parent: 'saturn', radius: 2574.7, soi: 43300, rot: 382.7, color: '#e3a94f', tex: 'titan',
    atmo: '#e8b060', orbit: { a: 1221870, e: 0.0288, i: 0.35, P: 15.945, M0: 163 } },
  { id: 'titania', name: 'Titania', parent: 'uranus', radius: 788.4, soi: 7500, rot: 208.9, color: '#c9bfb4', tex: 'rock',
    orbit: { a: 435910, e: 0.0011, i: 0.34, P: 8.706234, M0: 24 } },
  { id: 'oberon', name: 'Oberón', parent: 'uranus', radius: 761.4, soi: 9000, rot: 323.1, color: '#b0a49a', tex: 'rock',
    orbit: { a: 583520, e: 0.0014, i: 0.06, P: 13.463234, M0: 283 } },
  { id: 'triton', name: 'Tritón', parent: 'neptune', radius: 1353.4, soi: 22000, rot: 141.0, color: '#e9c9c0', tex: 'triton',
    // retrógrada: inclinación > 90°
    orbit: { a: 354759, e: 0.000016, i: 156.885, P: 5.876854, M0: 352 } },
];
