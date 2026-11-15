// Texturas procedurales (ruido 3D muestreado sobre la esfera → sin costuras).
// Si existe textures/<id>.jpg (p. ej. de Solar System Scope, CC BY 4.0), se usa esa.
import * as THREE from 'three';

import { noise, mix, smooth } from './planet/noise.js';
import { STYLES } from './planet/styles.js';

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
    if (material.uniforms?.map) material.uniforms.map.value = tex;
    else { material.map = tex; material.needsUpdate = true; }
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
