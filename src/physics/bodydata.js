// Datos físicos de los cuerpos para los instrumentos (no afectan el vuelo, que es arcade).
// Va aparte de bodies.js para no pisarse con otras ramas que editan esa tabla.
//
//   mu    parámetro gravitatorio G·M (m³/s²), valores JPL/IAU
//   teff  temperatura efectiva de emisión infrarroja (K): calienta lo que está cerca
//
// Atmósferas (modelo para los instrumentos, no para el render):
//   p0, T0  presión (Pa) y temperatura (K) en la "superficie": radio medio en los rocosos,
//           nivel de 1 bar en los gigantes gaseosos (su R). Por debajo la presión sigue subiendo.
//   M       masa molar (kg/mol); Mprof = [[altitud m, M], …] si cambia con la altura (Tierra)
//   gamma   cociente de calores específicos (velocidad del sonido)
//   layers  [[altitud base m, gradiente K/m, nombre], …]: T(h) lineal por tramos, continua
//   deep    gradiente bajo la superficie de referencia (K/m, negativo = más caliente al bajar)
//   top     interfaz de entrada (m): desde acá cuenta "dentro de la atmósfera"
//   comp    composición principal
const km = 1e3;

export const PHYS = {
  sun:       { mu: 1.32712440018e20, teff: 5772 },
  mercury:   { mu: 2.2031868e13, teff: 440 },
  venus:     { mu: 3.24858592e14, teff: 230 },
  earth:     { mu: 3.986004418e14, teff: 255 },
  mars:      { mu: 4.282837e13, teff: 210 },
  jupiter:   { mu: 1.26686534e17, teff: 124 },
  saturn:    { mu: 3.7931187e16, teff: 95 },
  uranus:    { mu: 5.793939e15, teff: 59 },
  neptune:   { mu: 6.836529e15, teff: 59 },
  moon:      { mu: 4.9048695e12, teff: 270 },
  phobos:    { mu: 7.087e5, teff: 233 },
  deimos:    { mu: 9.6e4, teff: 233 },
  io:        { mu: 5.959916e12, teff: 110 },
  europa:    { mu: 3.202739e12, teff: 102 },
  ganymede:  { mu: 9.887834e12, teff: 110 },
  callisto:  { mu: 7.179289e12, teff: 134 },
  enceladus: { mu: 7.211e9, teff: 75 },
  rhea:      { mu: 1.539e11, teff: 76 },
  titan:     { mu: 8.978138e12, teff: 94 },
  titania:   { mu: 2.27e11, teff: 70 },
  oberon:    { mu: 2.05e11, teff: 75 },
  triton:    { mu: 1.4276e12, teff: 38 },
};

export const ATMO_MODEL = {
  // Atmósfera estándar EE.UU. 1976 (simplificada arriba de 86 km)
  earth: {
    p0: 101325, T0: 288.15, M: 0.0289644, gamma: 1.4, top: 100 * km, deep: -0.0065,
    Mprof: [[86 * km, 0.0289644], [200 * km, 0.0215], [450 * km, 0.0160], [900 * km, 0.0080]],
    layers: [
      [0, -0.0065, 'tropósfera'], [11 * km, 0, 'tropopausa'], [20 * km, 0.001, 'estratósfera'],
      [32 * km, 0.0028, 'estratósfera'], [47 * km, 0, 'estratopausa'], [51 * km, -0.0028, 'mesósfera'],
      [71 * km, -0.002, 'mesósfera'], [86 * km, 0, 'mesopausa'], [91 * km, 0.002, 'termósfera'],
      [110 * km, 0.012, 'termósfera'], [120 * km, 0.005, 'termósfera'], [200 * km, 0.0015, 'termósfera'],
      [300 * km, 0, 'termósfera'], [600 * km, 0, 'exósfera'],
    ],
    comp: 'N₂ 78,1 % · O₂ 20,9 % · Ar 0,9 %',
  },
  // Venus: 9,2 MPa y 464 °C en la superficie; ~1 bar y ~75 °C a 50 km
  venus: {
    p0: 9.2e6, T0: 737, M: 0.04345, gamma: 1.2, top: 200 * km, deep: -0.0077,
    layers: [[0, -0.0077, 'tropósfera'], [60 * km, -0.0025, 'mesósfera'], [100 * km, 0, 'mesósfera'],
      [130 * km, 0.0005, 'termósfera']],
    comp: 'CO₂ 96,5 % · N₂ 3,5 %',
  },
  // Marte: ~0,6 kPa y −63 °C de media
  mars: {
    p0: 636, T0: 210, M: 0.04334, gamma: 1.29, top: 125 * km, deep: -0.0018,
    layers: [[0, -0.0018, 'tropósfera'], [40 * km, -0.0005, 'mesósfera'], [100 * km, 0.001, 'termósfera'],
      [180 * km, 0, 'termósfera']],
    comp: 'CO₂ 95,3 % · N₂ 2,6 % · Ar 1,9 %',
  },
  // Titán: 146,7 kPa y −179 °C (Huygens, 2005); entrada a 1270 km como la sonda
  titan: {
    p0: 146700, T0: 93.7, M: 0.0278, gamma: 1.4, top: 1270 * km, deep: -0.00054,
    layers: [[0, -0.00054, 'tropósfera'], [44 * km, 0, 'tropopausa'], [55 * km, 0.0005, 'estratósfera'],
      [250 * km, 0, 'estratósfera'], [500 * km, -0.0002, 'mesósfera'], [700 * km, 0.0001, 'termósfera']],
    comp: 'N₂ 98,4 % · CH₄ 1,4 % · H₂ 0,2 %',
  },
  // Gigantes: superficie de referencia = nivel de 1 bar
  jupiter: {
    p0: 1e5, T0: 165, M: 0.00222, gamma: 1.43, top: 450 * km, deep: -0.002,
    layers: [[0, -0.0011, 'tropósfera'], [50 * km, 0, 'tropopausa'], [70 * km, 0.0008, 'estratósfera'],
      [320 * km, 0.003, 'termósfera'], [600 * km, 0, 'termósfera']],
    comp: 'H₂ 89,8 % · He 10,2 % · CH₄ 0,3 %',
  },
  saturn: {
    p0: 1e5, T0: 134, M: 0.00207, gamma: 1.43, top: 600 * km, deep: -0.00085,
    layers: [[0, -0.00043, 'tropósfera'], [120 * km, 0, 'tropopausa'], [150 * km, 0.0003, 'estratósfera'],
      [500 * km, 0.0015, 'termósfera'], [900 * km, 0, 'termósfera']],
    comp: 'H₂ 96,3 % · He 3,3 % · CH₄ 0,4 %',
  },
  uranus: {
    p0: 1e5, T0: 76, M: 0.00264, gamma: 1.45, top: 400 * km, deep: -0.0007,
    layers: [[0, -0.00046, 'tropósfera'], [50 * km, 0, 'tropopausa'], [60 * km, 0.0005, 'estratósfera'],
      [300 * km, 0.0015, 'termósfera'], [700 * km, 0, 'termósfera']],
    comp: 'H₂ 82,5 % · He 15,2 % · CH₄ 2,3 %',
  },
  neptune: {
    p0: 1e5, T0: 72, M: 0.00253, gamma: 1.45, top: 400 * km, deep: -0.00085,
    layers: [[0, -0.00042, 'tropósfera'], [40 * km, 0, 'tropopausa'], [55 * km, 0.0006, 'estratósfera'],
      [300 * km, 0.0012, 'termósfera'], [700 * km, 0, 'termósfera']],
    comp: 'H₂ 80 % · He 19 % · CH₄ 1,5 %',
  },
};
