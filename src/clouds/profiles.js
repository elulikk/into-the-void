// Parámetros de las nubes por planeta. Todo en kilómetros (alturas sobre el radio medio).
//   base/top      : altitud de la base y el tope de la capa
//   sigma         : extinción (1/km) con densidad 1
//   coverage      : 'map' (mapa horneado, sólo la Tierra) o 'noise' (procedural)
//   covBias/covVar: cobertura base y cuánto varía con el ruido de escala media
//   profile       : 0 = cúmulos (base plana, torres), 1 = cubierta densa (Venus), 2 = neblina
//   shapeTile/detailTile: tamaño (km) de un período del ruido de forma / detalle
//   albedo        : color del scattering (Venus absorbe azul: se pone más naranja en profundidad)
//   absorb        : extinción relativa por canal en el camino hacia el Sol
//   ambient       : luz del cielo (multiplica a la intensidad del Sol)
//   shadowK/shadowFloor: sombra de las nubes sobre lo que está abajo (y piso de luz difusa)
//   skyDim        : 1 = desde abajo de la capa también se oscurece el cielo (Venus)
//   adapt         : "adaptación del ojo" (exposición) al quedar debajo de la capa
//   wind          : km/s en el marco del planeta
export const CLOUDS = {
  earth: {
    base: 1.0, top: 12.0, maxDist: 260,
    sigma: 18, coverage: 'map', covBias: -0.3, covScale: 1.0, covVar: 0.6, type: 0.5,
    profile: 0, shapeTile: 52, detailTile: 5, erosion: 0.4, warp: 0.0,
    albedo: [0.98, 0.98, 0.98], absorb: [1, 1, 1],
    ambient: [0.07, 0.09, 0.13], ambBottom: 0.45,
    lightLen: 2.2, g: [0.82, -0.22, 0.28], bright: 2.6, powder: 0.6,
    shadowK: 3.5, shadowFloor: [0.42, 0.45, 0.52], skyDim: 0, adapt: 1.0,
    wind: [0.012, 0, 0.005],
  },
  // Venus: capa continua de ácido sulfúrico de ~45 a ~70 km, superrotación de ~100 m/s.
  // Por dentro la luz se va apagando y poniendo naranja; abajo, penumbra anaranjada.
  venus: {
    base: 45, top: 70, maxDist: 600,
    sigma: 1.5, coverage: 'noise', covBias: 0.9, covScale: 1, covVar: 0.25, type: 1,
    profile: 1, shapeTile: 70, detailTile: 9, erosion: 0.3, warp: 0.8,
    albedo: [1.0, 0.9, 0.66], absorb: [1.0, 1.05, 1.22],
    ambient: [0.09, 0.065, 0.035], ambBottom: 0.1,
    lightLen: 9, g: [0.75, -0.2, 0.3], bright: 2.4, powder: 0.4,
    shadowK: 28, shadowFloor: [0.15, 0.08, 0.032], skyDim: 1, adapt: 2.4,
    wind: [0.1, 0, 0.01],
  },
  // Marte: neblina de polvo suave y baja
  mars: {
    base: 0.0, top: 11, maxDist: 300,
    sigma: 0.06, coverage: 'noise', covBias: 0.55, covScale: 1, covVar: 0.6, type: 0.5,
    profile: 2, shapeTile: 40, detailTile: 6, erosion: 0.2, warp: 0.4,
    albedo: [0.9, 0.66, 0.46], absorb: [1, 1.1, 1.3],
    ambient: [0.05, 0.035, 0.025], ambBottom: 0.6,
    lightLen: 4, g: [0.7, -0.2, 0.2], bright: 2.0, powder: 0.2,
    shadowK: 0.6, shadowFloor: [0.8, 0.75, 0.7], skyDim: 0, adapt: 1.0,
    wind: [0.02, 0, 0.004],
  },
  // Titán: nubes dispersas de metano debajo de la neblina naranja
  titan: {
    base: 15, top: 40, maxDist: 400,
    sigma: 0.8, coverage: 'noise', covBias: 0.32, covScale: 1, covVar: 0.7, type: 0.4,
    profile: 0, shapeTile: 45, detailTile: 6, erosion: 0.35, warp: 0.5,
    albedo: [0.96, 0.78, 0.5], absorb: [1, 1.08, 1.25],
    ambient: [0.05, 0.03, 0.012], ambBottom: 0.4,
    lightLen: 6, g: [0.75, -0.2, 0.25], bright: 2.2, powder: 0.4,
    shadowK: 1.5, shadowFloor: [0.6, 0.5, 0.4], skyDim: 0, adapt: 1.0,
    wind: [0.008, 0, 0.0],
  },
};
