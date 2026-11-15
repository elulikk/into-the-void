// Caza procedural pulido (~19 m, adelante = -Z): fuselaje por secciones, alas en delta con
// bisel, timones canteados, góndolas con toberas, cabina de vidrio y tiras emisivas.
// Los mapas de color, normal y rugosidad se generan en un canvas (paneles, remaches,
// ranuras, suciedad), así no hay archivos ni licencias.
import * as THREE from 'three';

// ---- RNG determinista (la nave se ve igual en cada carga)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---- texturas de casco
function hullTextures() {
  const N = 1024, R = rng(7);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const col = mk(), hgt = mk(), rgh = mk();
  const cc = col.getContext('2d'), ch = hgt.getContext('2d'), cr = rgh.getContext('2d');
  cc.fillStyle = '#aeb5c0'; cc.fillRect(0, 0, N, N);
  ch.fillStyle = '#808080'; ch.fillRect(0, 0, N, N);
  cr.fillStyle = '#6a6a6a'; cr.fillRect(0, 0, N, N);

  // paneles: rectángulos con tono propio, ranura oscura y rugosidad distinta
  const panels = [];
  for (let i = 0; i < 90; i++) {
    const w = 60 + R() * 220, h = 40 + R() * 160;
    panels.push([R() * N, R() * N, w, h, (R() - 0.5) * 34, R() < 0.18]);
  }
  for (const [x, y, w, h, tone, hatch] of panels) {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const X = x + ox, Y = y + oy;
      if (X > N || Y > N || X + w < 0 || Y + h < 0) continue;
      const v = 174 + tone;
      cc.fillStyle = `rgb(${v},${v + 4},${v + 12})`; cc.fillRect(X, Y, w, h);
      cr.fillStyle = `rgb(${90 + tone * 2},${90 + tone * 2},${90 + tone * 2})`; cr.fillRect(X, Y, w, h);
      ch.fillStyle = '#888'; ch.fillRect(X, Y, w, h);
      cc.strokeStyle = 'rgba(30,34,42,0.8)'; cc.lineWidth = 2; cc.strokeRect(X, Y, w, h);
      ch.strokeStyle = '#303030'; ch.lineWidth = 4; ch.strokeRect(X, Y, w, h);
      cr.strokeStyle = '#d0d0d0'; cr.lineWidth = 4; cr.strokeRect(X, Y, w, h);
      if (hatch) {  // escotilla de mantenimiento con remaches
        cc.strokeStyle = 'rgba(40,44,52,0.7)'; cc.lineWidth = 1.5; cc.strokeRect(X + 8, Y + 8, w - 16, h - 16);
        for (let k = 0; k < 6; k++) {
          const rx = X + 12 + ((w - 24) * k) / 5;
          for (const ry of [Y + 12, Y + h - 12]) {
            cc.fillStyle = 'rgba(40,44,52,0.9)'; cc.beginPath(); cc.arc(rx, ry, 2.2, 0, 7); cc.fill();
            ch.fillStyle = '#b0b0b0'; ch.beginPath(); ch.arc(rx, ry, 2.5, 0, 7); ch.fill();
          }
        }
      }
    }
  }
  // franjas de color (naranja) y marcas
  cc.fillStyle = '#d9541e'; cc.fillRect(0, N * 0.42, N, 46);
  cc.fillStyle = '#f2f2f2'; cc.fillRect(0, N * 0.42 + 46, N, 8);
  cc.fillStyle = '#1b2230'; cc.fillRect(0, N * 0.78, N, 70);
  // suciedad y rayones
  for (let i = 0; i < 2500; i++) {
    const x = R() * N, y = R() * N, a = R() * 0.07;
    cc.fillStyle = `rgba(20,18,16,${a})`; cc.fillRect(x, y, 2 + R() * 30, 1 + R() * 3);
    cr.fillStyle = `rgba(255,255,255,${a * 2})`; cr.fillRect(x, y, 2 + R() * 30, 1 + R() * 3);
  }
  for (let i = 0; i < 40; i++) {
    const g = cc.createRadialGradient(R() * N, R() * N, 0, R() * N, R() * N, 120);
    cc.fillStyle = 'rgba(25,22,20,0.05)'; cc.beginPath(); cc.arc(R() * N, R() * N, 60 + R() * 90, 0, 7); cc.fill();
  }

  // mapa de normales a partir de la altura (Sobel)
  const hd = ch.getImageData(0, 0, N, N).data;
  const nrm = mk(), cn = nrm.getContext('2d'), out = cn.createImageData(N, N);
  const H = (x, y) => hd[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * 2.2, ny = dy * 2.2, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  cn.putImageData(out, 0, 0);

  const T = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: T(col, true), normalMap: T(nrm, false), roughnessMap: T(rgh, false) };
}

// UV por proyección según la normal dominante (metros → texturas que se repiten cada 18 m)
function projectUV(geo) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  const S = 1 / 18;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * S; uv[i * 2 + 1] = v * S;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---- fuselaje por secciones
function fuselage() {
  const SEC = 48, SIDES = 28, z0 = -9.2, z1 = 7.2;
  const pos = [], idx = [];
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i <= SEC; i++) {
    const s = i / SEC, z = z0 + (z1 - z0) * s;
    const nose = Math.pow(Math.sin(Math.min(1, s / 0.5) * Math.PI / 2), 0.75);
    const taper = 1 - 0.22 * sstep(0.72, 1, s);
    const w = 1.55 * nose * taper, h = 0.95 * nose * taper;
    const bump = 0.42 * Math.exp(-Math.pow((s - 0.33) / 0.12, 2)) * nose;   // cabina
    const keel = -0.25 * sstep(0.3, 0.6, s) * (1 - sstep(0.8, 1, s));       // quilla
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), e = 2 / 2.7;
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), e);
      let y = h * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      if (y > 0) y += bump; else y += keel * 0.8;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < SEC; i++) for (let j = 0; j < SIDES; j++) {
    const a = i * SIDES + j, b = i * SIDES + (j + 1) % SIDES, c = a + SIDES, d = b + SIDES;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return projectUV(g);
}

function extrude(shape, depth, bevel = 0.06) {
  return projectUV(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 4 }));
}

function wingGeo(side) {
  // en planta (x, z): raíz en el fuselaje, flecha hacia atrás, punta recortada
  const sh = new THREE.Shape();
  const P = [[1.0, -2.2], [3.2, 0.4], [8.6, 4.4], [8.9, 6.6], [7.0, 6.9], [1.0, 6.6]];
  P.forEach(([x, z], k) => (k ? sh.lineTo(x * side, z) : sh.moveTo(x * side, z)));
  const g = extrude(sh, 0.22, 0.07);          // extrusión en +z de shape
  // el shape está en (x, y=z_mundo); se lleva al plano XZ
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.15, 0);
  return side < 0 ? flipFaces(g) : g;
}
function flipFaces(g) {
  // el espejo (x → -x) invierte el orden de los triángulos
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, g.attributes.uv]) {
      const s = a.itemSize;
      for (let k = 0; k < s; k++) { const t = a.array[(i + 1) * s + k]; a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k]; a.array[(i + 2) * s + k] = t; }
    }
  }
  g.computeVertexNormals();
  return g;
}

function finGeo() {
  const sh = new THREE.Shape();   // (sx = -z_mundo, y)
  sh.moveTo(-2.6, 0); sh.lineTo(-7.2, 0); sh.lineTo(-7.0, 2.6); sh.lineTo(-5.4, 3.3); sh.lineTo(-3.6, 1.2); sh.lineTo(-2.6, 0);
  const g = extrude(sh, 0.16, 0.05);
  g.translate(0, 0, -0.08);
  g.rotateY(Math.PI / 2);
  return g;
}

export function buildProcedural() {
  const root = new THREE.Group();
  const tex = hullTextures();
  const hull = new THREE.MeshStandardMaterial({ ...tex, color: 0xffffff, metalness: 0.65, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20252e, metalness: 0.7, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b727d, metalness: 0.95, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1522, metalness: 1, roughness: 0.04, emissive: 0x06223a, emissiveIntensity: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x55ccff, emissiveIntensity: 3 });
  const warm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff7a2a, emissiveIntensity: 2.5 });
  const add = (geo, mat, f) => { const m = new THREE.Mesh(geo, mat); f?.(m); root.add(m); return m; };

  add(fuselage(), hull);
  for (const s of [-1, 1]) {
    add(wingGeo(s), hull);
    // tira emisiva en el borde de ataque del ala y pilón de punta
    add(new THREE.BoxGeometry(0.07, 0.05, 6.4), glow, m => { m.position.set(s * 5.1, 0.15, 2.5); m.rotation.y = -s * 0.55; });
    add(new THREE.BoxGeometry(0.5, 0.3, 1.9), dark, m => { m.position.set(s * 8.55, 0.15, 5.6); });
    // góndola del motor
    add(new THREE.CylinderGeometry(0.85, 0.78, 6.8, 20), hull, m => { m.rotation.x = Math.PI / 2; m.position.set(s * 2.5, -0.25, 4.2); });
    add(new THREE.CylinderGeometry(0.88, 0.88, 0.3, 20), metal, m => { m.rotation.x = Math.PI / 2; m.position.set(s * 2.5, -0.25, 1.0); });
    add(new THREE.TorusGeometry(0.68, 0.09, 8, 24), metal, m => { m.position.set(s * 2.5, -0.25, 7.6); });
    add(new THREE.CircleGeometry(0.62, 20), warm, m => { m.position.set(s * 2.5, -0.25, 7.58); m.rotation.y = 0; m.rotation.x = 0; });
    // timón canteado
    add(finGeo(), hull, m => { m.position.set(s * 1.0, 0.5, 0); m.rotation.z = -s * 0.32; });
    // faro/antena en la punta del ala
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), metal, m => { m.position.set(s * 8.75, 0.15, 3.9); m.rotation.x = Math.PI / 2; });
  }
  // tobera central, mayor
  add(new THREE.CylinderGeometry(0.98, 0.9, 0.9, 24, 1, true), metal, m => { m.rotation.x = Math.PI / 2; m.position.set(0, 0, 7.55); });
  add(new THREE.TorusGeometry(0.98, 0.1, 8, 28), metal, m => { m.position.set(0, 0, 8.0); });
  add(new THREE.CircleGeometry(0.88, 24), warm, m => { m.position.set(0, 0, 7.4); m.rotation.y = Math.PI; });
  // cabina: vidrio sobre el fuselaje
  add(new THREE.SphereGeometry(1, 24, 14), glass, m => { m.scale.set(0.82, 0.55, 2.3); m.position.set(0, 0.88, -3.6); });
  add(new THREE.TorusGeometry(1, 0.06, 6, 28), dark, m => { m.scale.set(0.84, 0.0001, 2.35); m.position.set(0, 0.62, -3.6); m.rotation.x = Math.PI / 2; });
  // tiras luminosas en el fuselaje y sensor de nariz
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.05, 4.2), glow, m => { m.position.set(s * 1.18, 0.12, -1.0); });
  add(new THREE.CylinderGeometry(0.03, 0.09, 1.6, 8), metal, m => { m.rotation.x = Math.PI / 2; m.position.set(0, 0, -9.9); });
  // paneles de radiador oscuros en el lomo
  add(new THREE.BoxGeometry(1.1, 0.06, 3.4), dark, m => { m.position.set(0, 1.04, 3.2); });

  root.userData.config = {
    nozzles: [
      { pos: [-2.5, -0.25, 7.7], r: 0.62 }, { pos: [0, 0, 8.0], r: 0.85 }, { pos: [2.5, -0.25, 7.7], r: 0.62 },
    ],
    navLights: { red: [-8.9, 0.3, 3.9], green: [8.9, 0.3, 3.9], white: [0, 1.0, 7.0] },
  };
  return root;
}
