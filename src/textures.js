// Texturas procedurales (ruido 3D muestreado sobre la esfera → sin costuras).
// Si existe textures/<id>.jpg (p. ej. de Solar System Scope, CC BY 4.0), se usa esa.
import * as THREE from 'three';

function hash(x, y, z, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function noise(x, y, z, s = 0) {
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

function fbm(x, y, z, oct = 5, s = 0) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f, z * f, s + i * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

const mix = (c1, c2, t) => {
  t = Math.min(1, Math.max(0, t));
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- estilos: (x,y,z en la esfera unitaria, lat en radianes, lon) → [r,g,b]
const STYLES = {
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
    const cl = fbm(x * 2.5 + 10, y * 5, z * 2.5, 6, 11);
    return mix(c, [250, 250, 252], smooth(0.52, 0.72, cl) * 0.9);
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
    return mix([200, 160, 100], [245, 220, 165], n);
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

const BIG = new Set(['earth', 'jupiter', 'saturn']);

export function proceduralTexture(style) {
  const fn = STYLES[style] || STYLES.rock;
  const w = BIG.has(style) ? 1024 : 512, h = w / 2;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - (j + 0.5) / h * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) / w * Math.PI * 2;
      const c = fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat, lon);
      const k = (j * w + i) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Intenta reemplazar la textura procedural por una real en textures/<id>.jpg
export function tryRealTexture(id, material) {
  new THREE.TextureLoader().load(`textures/${id}.jpg`, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    material.map = tex;
    material.needsUpdate = true;
  }, undefined, () => {});
}

export function ringTexture() {
  const w = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = 4;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, 4);
  const inner = 74500, outer = 140220;
  for (let i = 0; i < w; i++) {
    const r = inner + (outer - inner) * (i / (w - 1));
    let a = 0;
    if (r < 92000) a = 0.12 + 0.08 * smooth(74500, 92000, r);           // anillo C
    else if (r < 117580) a = 0.75 + 0.2 * noise(r / 900, 0, 0, 7);         // anillo B
    else if (r < 122170) a = 0.05;                                          // división de Cassini
    else if (r < 136775) a = 0.5 + 0.15 * noise(r / 700, 0, 0, 8);         // anillo A
    else if (r > 140000) a = 0.3;                                          // anillo F
    if (Math.abs(r - 133590) < 160) a = 0.02;                              // división de Encke
    a *= 0.85 + 0.3 * noise(r / 120, 0, 0, 9);
    const c = mix([150, 130, 100], [235, 220, 190], noise(r / 2500, 0, 0, 10));
    for (let j = 0; j < 4; j++) {
      const k = (j * w + i) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2];
      img.data[k + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function glowTexture(inner = 'rgba(255,240,200,1)', mid = 'rgba(255,190,90,0.35)') {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.12, inner);
  g.addColorStop(0.25, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
