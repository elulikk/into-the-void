// Estilos de color por cuerpo (sin THREE: se usan en las texturas y sirven de base
// a las recetas de relieve, que reusan los mismos ruidos para coincidir con los colores).
// (x,y,z en la esfera unitaria en "espacio de estilo", lat en radianes, lon) → [r,g,b]
import { noise, fbm, mix, smooth } from './noise.js';

// ---- estilos: (x,y,z en la esfera unitaria, lat en radianes, lon) → [r,g,b]
export const STYLES = {
  sun(x, y, z) {
    const n = fbm(x * 18, y * 18, z * 18, 4, 1);
    const m = fbm(x * 3, y * 3, z * 3, 3, 2);
    return mix([255, 170, 60], [255, 245, 200], n * 0.9 + m * 0.3);
  },
  earth(x, y, z, lat) {
    const n = fbm(x * 1.6, y * 1.6, z * 1.6, 7, 3);
    const alat = Math.abs(lat);
    let c;
    if (n < 0.53) {
      c = mix([8, 28, 78], [28, 82, 140], smooth(0.35, 0.53, n));
    } else {
      const dry = fbm(x * 3, y * 3, z * 3, 4, 9);
      const desert = smooth(0.75, 0.15, Math.abs(Math.abs(lat) - 0.42) * 3) * smooth(0.4, 0.6, dry);
      c = mix([52, 92, 40], [96, 110, 58], smooth(0.53, 0.65, n));
      c = mix(c, [190, 160, 110], desert);
      c = mix(c, [120, 110, 100], smooth(0.66, 0.75, n));
    }
    const ice = smooth(1.12, 1.25, alat + (fbm(x * 4, y * 4, z * 4, 3, 5) - 0.5) * 0.3);
    c = mix(c, [240, 245, 250], ice);
    // las nubes ya no se pintan acá: son volumétricas (src/clouds, con el mismo patrón de cobertura)
    return c;
  },
  mars(x, y, z, lat) {
    const n = fbm(x * 2, y * 2, z * 2, 6, 21);
    const d = fbm(x * 6, y * 6, z * 6, 4, 22);
    let c = mix([120, 55, 32], [205, 110, 65], smooth(0.35, 0.65, n));
    c = mix(c, [90, 50, 38], smooth(0.55, 0.75, d) * 0.5);
    return mix(c, [245, 240, 235], smooth(1.30, 1.38, Math.abs(lat) + (n - 0.5) * 0.2));
  },
  venus(x, y, z, lat) {
    const n = fbm(x * 1.5, y * 6 + lat, z * 1.5, 5, 31);
    return mix([95, 70, 50], [150, 112, 80], n); // basalto: lo que se ve abajo de las nubes
  },
  mercury(x, y, z) {
    const n = fbm(x * 3, y * 3, z * 3, 6, 41);
    const r = Math.abs(fbm(x * 12, y * 12, z * 12, 3, 42) - 0.5) * 2;
    return mix([80, 76, 72], [180, 172, 162], n * 0.8 + r * 0.3);
  },
  moon(x, y, z) {
    const maria = fbm(x * 1.4, y * 1.4, z * 1.4, 4, 51);
    const n = fbm(x * 8, y * 8, z * 8, 5, 52);
    let c = mix([150, 148, 145], [205, 203, 198], n);
    return mix(c, [75, 75, 78], smooth(0.52, 0.6, maria) * 0.85);
  },
  rock(x, y, z) {
    const n = fbm(x * 4, y * 4, z * 4, 6, 61);
    return mix([70, 66, 62], [175, 168, 158], n);
  },
  ice(x, y, z) {
    const n = fbm(x * 5, y * 5, z * 5, 5, 62);
    return mix([200, 210, 220], [252, 252, 255], n);
  },
  io(x, y, z) {
    const n = fbm(x * 3, y * 3, z * 3, 5, 71);
    const s = fbm(x * 9, y * 9, z * 9, 3, 72);
    let c = mix([210, 180, 60], [245, 235, 140], n);
    c = mix(c, [200, 110, 40], smooth(0.62, 0.7, s));
    return mix(c, [40, 30, 20], smooth(0.72, 0.78, s));
  },
  europa(x, y, z) {
    const n = fbm(x * 3, y * 3, z * 3, 4, 81);
    const line = 1 - Math.abs(fbm(x * 5, y * 5, z * 5, 5, 82) - 0.5) * 2;
    let c = mix([215, 205, 185], [245, 240, 230], n);
    return mix(c, [140, 90, 60], smooth(0.9, 0.98, line) * 0.8);
  },
  ganymede(x, y, z) {
    const n = fbm(x * 2.5, y * 2.5, z * 2.5, 6, 91);
    return mix([95, 85, 75], [190, 180, 168], smooth(0.4, 0.6, n));
  },
  callisto(x, y, z) {
    const n = fbm(x * 4, y * 4, z * 4, 5, 101);
    const sp = noise(x * 60, y * 60, z * 60, 102);
    let c = mix([55, 48, 40], [120, 108, 92], n);
    return mix(c, [230, 225, 215], smooth(0.9, 0.97, sp));
  },
  titan(x, y, z, lat) {
    const n = fbm(x * 2, y * 4, z * 2, 4, 111);
    return mix([200, 135, 50], [235, 175, 85], n * 0.6 + lat * 0.1 + 0.2);
  },
  triton(x, y, z, lat) {
    const n = fbm(x * 4, y * 4, z * 4, 5, 121);
    let c = mix([170, 140, 135], [240, 220, 210], n);
    return mix(c, [245, 235, 230], smooth(-0.2, -0.6, lat));
  },
  jupiter(x, y, z, lat, lon) {
    const turb = fbm(x * 4, y * 4, z * 4, 5, 131);
    const t = lat * 7 + (turb - 0.5) * 1.1;
    const b = 0.5 + 0.5 * Math.sin(t * 3.0);
    const b2 = 0.5 + 0.5 * Math.sin(t * 7.3 + 1.3);
    let c = mix([160, 110, 75], [240, 228, 205], b);
    c = mix(c, [200, 160, 115], b2 * 0.35);
    // Gran Mancha Roja
    const dLat = (lat + 0.39) / 0.085, dLon = Math.atan2(Math.sin(lon - 1.0), Math.cos(lon - 1.0)) / 0.2;
    const spot = Math.exp(-(dLat * dLat + dLon * dLon) * 1.2);
    return mix(c, [185, 85, 55], spot);
  },
  saturn(x, y, z, lat) {
    const turb = fbm(x * 3, y * 3, z * 3, 4, 141);
    const t = lat * 9 + (turb - 0.5) * 0.6;
    const b = 0.5 + 0.5 * Math.sin(t * 2.5);
    return mix([195, 165, 115], [240, 225, 180], b * 0.7 + 0.3 * turb);
  },
  uranus(x, y, z, lat) {
    const n = fbm(x * 2, y * 8, z * 2, 3, 151);
    return mix([150, 210, 220], [185, 235, 240], n * 0.5 + 0.25 + lat * 0.05);
  },
  neptune(x, y, z, lat, lon) {
    const turb = fbm(x * 3, y * 3, z * 3, 4, 161);
    const b = 0.5 + 0.5 * Math.sin((lat * 8 + turb) * 2.0);
    let c = mix([45, 75, 190], [85, 125, 235], b * 0.6 + turb * 0.4);
    const dLat = (lat + 0.35) / 0.07, dLon = Math.atan2(Math.sin(lon - 2.5), Math.cos(lon - 2.5)) / 0.15;
    return mix(c, [25, 35, 110], Math.exp(-(dLat * dLat + dLon * dLon)));
  },
};
