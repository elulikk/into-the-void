// Ruido para las nubes, horneado una sola vez en la GPU:
//  - forma (128³, RGBA8): R = Perlin-Worley, G/B/A = Worley fbm a 3 frecuencias
//  - detalle (32³, RGBA8): Worley fbm a 3 frecuencias (erosión de bordes)
//  - cobertura de la Tierra (equirectangular): el MISMO patrón de nubes que tenía
//    pintado la textura de la Tierra (mismo hash entero, mismo fbm), así las nubes
//    volumétricas caen donde antes estaban las pintadas.
// Los volúmenes se hornean en un atlas 2D, se leen a la CPU y se suben como
// Data3DTexture: así three genera los mipmaps 3D (el render target 3D no los genera).
import * as THREE from 'three';

const quadVS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// ---- ruido periódico (tileable) en GLSL
const NOISE_GLSL = /* glsl */`
  uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }
  vec3 hash3(vec3 c) { return vec3(pcg3d(uvec3(ivec3(c) + 4096))) / 4294967295.0; }

  // Worley periódico: p en celdas, período en celdas. Devuelve 1 - distancia (0..1)
  float worley(vec3 p, float period) {
    vec3 id = floor(p), f = fract(p);
    float d = 1e9;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(x, y, z);
      vec3 pt = o + hash3(mod(id + o, period));
      vec3 r = f - pt;
      d = min(d, dot(r, r));
    }
    return clamp(1.0 - sqrt(d), 0.0, 1.0);
  }
  float worleyFbm(vec3 uvw, float freq) {
    return worley(uvw * freq, freq) * 0.625 + worley(uvw * freq * 2.0, freq * 2.0) * 0.25 +
           worley(uvw * freq * 4.0, freq * 4.0) * 0.125;
  }

  // Perlin (ruido de gradiente) periódico
  float gradN(vec3 p, float period) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n[8];
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
      vec3 g = normalize(hash3(mod(i + o, period)) * 2.0 - 1.0 + 1e-4);
      n[k] = dot(g, f - o);
    }
    return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
               mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
  }
  float perlinFbm(vec3 uvw, float freq, int oct) {
    float v = 0.0, a = 0.5, norm = 0.0;
    for (int k = 0; k < 8; k++) {
      if (k >= oct) break;
      v += a * gradN(uvw * freq, freq);
      norm += a; a *= 0.5; freq *= 2.0;
    }
    return v / norm * 0.5 + 0.5;
  }
  float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

const atlasFS = (size, cols) => /* glsl */`
  ${NOISE_GLSL}
  uniform int uKind;
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    int slice = (px.y / ${size}) * ${cols} + px.x / ${size};
    vec3 uvw = (vec3(px.x % ${size}, px.y % ${size}, slice) + 0.5) / ${size}.0;
    vec4 o;
    if (uKind == 0) {
      float pf = perlinFbm(uvw, 4.0, 6);
      float wf = worleyFbm(uvw, 4.0);
      float pw = clamp(remap(pf, 0.0, 1.0, wf, 1.0), 0.0, 1.0);   // Perlin "dilatado" con Worley
      o = vec4(pw, wf, worleyFbm(uvw, 8.0), worleyFbm(uvw, 16.0));
    } else {
      o = vec4(worleyFbm(uvw, 2.0), worleyFbm(uvw, 4.0), worleyFbm(uvw, 8.0), 1.0);
    }
    gl_FragColor = o;
  }`;

function fsQuad(material) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return scene;
}

function bakeVolume(renderer, size, kind) {
  const cols = size === 128 ? 16 : 8;
  const rows = size / cols;
  const W = size * cols, H = size * rows;
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, type: THREE.UnsignedByteType });
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: atlasFS(size, cols), uniforms: { uKind: { value: kind } } });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(fsQuad(mat), new THREE.Camera());
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prev);
  rt.dispose(); mat.dispose();
  // atlas → volumen [z][y][x]
  const data = new Uint8Array(size * size * size * 4);
  for (let z = 0; z < size; z++) {
    const ox = (z % cols) * size, oy = Math.floor(z / cols) * size;
    for (let y = 0; y < size; y++) {
      const src = ((oy + y) * W + ox) * 4;
      data.set(px.subarray(src, src + size * 4), (z * size + y) * size * 4);
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ---- cobertura de la Tierra: port exacto del hash/fbm de textures.js (STYLES.earth)
const earthCoverageFS = /* glsl */`
  varying vec2 vUv;
  float hashI(ivec3 c, int s) {
    uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + uint(c.z) * 1274126177u + uint(s) * 144665u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    return float(h) / 4294967295.0;
  }
  float vnoise(vec3 p, int s) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    ivec3 c = ivec3(i);
    return mix(
      mix(mix(hashI(c, s), hashI(c + ivec3(1,0,0), s), u.x), mix(hashI(c + ivec3(0,1,0), s), hashI(c + ivec3(1,1,0), s), u.x), u.y),
      mix(mix(hashI(c + ivec3(0,0,1), s), hashI(c + ivec3(1,0,1), s), u.x), mix(hashI(c + ivec3(0,1,1), s), hashI(c + ivec3(1,1,1), s), u.x), u.y), u.z);
  }
  float fbm(vec3 p, int oct, int s) {
    float v = 0.0, amp = 0.5, f = 1.0, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      v += amp * vnoise(p * f, s + i * 17);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return v / norm;
  }
  void main() {
    float lat = (vUv.y - 0.5) * 3.14159265;
    float lon = vUv.x * 6.28318531;
    vec3 q = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    float cl = fbm(vec3(q.x * 2.5 + 10.0, q.y * 5.0, q.z * 2.5), 6, 11);
    float cov = smoothstep(0.52, 0.72, cl);
    // G: variación de escala media (más tormentas donde la cobertura es alta)
    float storm = fbm(q * 9.0, 4, 5);
    gl_FragColor = vec4(cov, storm, cl, 1.0);
  }`;

function bakeEarthCoverage(renderer) {
  const rt = new THREE.WebGLRenderTarget(2048, 1024, {
    depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: earthCoverageFS });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(fsQuad(mat), new THREE.Camera());
  renderer.setRenderTarget(prev);
  mat.dispose();
  return rt.texture;
}

let cache = null;
export function bakeCloudNoise(renderer) {
  if (cache) return cache;
  const t0 = performance.now();
  cache = {
    shape: bakeVolume(renderer, 128, 0),
    detail: bakeVolume(renderer, 32, 1),
    earthCoverage: bakeEarthCoverage(renderer),
  };
  cache.bakeMs = performance.now() - t0;
  return cache;
}
