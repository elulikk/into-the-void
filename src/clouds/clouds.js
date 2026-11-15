// Nubes volumétricas por raymarching, como pasada de post-proceso con acceso al depth buffer.
//
// Pipeline (por cuadro, sólo para el planeta con nubes más grande en pantalla):
//  1. march   (resolución reducida, MRT): luz de las nubes + transmitancia, y en un segundo
//             target la distancia de entrada, la distancia de la escena usada y la distancia media.
//  2. temporal (resolución reducida): reproyección con la distancia media + clamp de vecindario.
//  3. composite (resolución completa): upsample bilateral contra la profundidad real,
//             sombra de las nubes sobre lo que está debajo (suelo, nave, neblina) y
//             "adaptación del ojo" debajo de la capa (Venus).
//
// Precisión: todo se calcula en el marco local del planeta (rotación incluida) y en km.
// La profundidad es logarítmica: w = 2^(d·log2(far+1)) − 1 (ver logdepthbuf de three).
// No se asume suelo esférico: el suelo/relieve sale siempre del depth buffer.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { bakeCloudNoise } from './noise.js';
import { CLOUDS } from './profiles.js';

export { CLOUDS };

// ---------- GLSL compartido entre march, composite y (a futuro) el shader del terreno
export const CLOUD_COMMON = /* glsl */`
  precision highp sampler3D;
  uniform sampler3D uShape;
  uniform sampler3D uDetail;
  uniform sampler2D uCovMap;
  uniform float uR, uRb, uRt, uThick;      // km: radio, radio de la base, del tope, espesor
  uniform vec3 uSunL;                       // dirección al Sol (marco local del planeta)
  uniform int uCovMode;                     // 0 = mapa, 1 = ruido
  uniform float uCovBias, uCovScale, uCovVar, uCovTexel, uType;
  uniform int uProfile;
  uniform float uShapeTile, uDetailTile, uErosion, uWarp;
  uniform vec3 uWindShape, uWindDetail;
  uniform float uShadowK;
  uniform vec3 uShadowFloor;

  vec2 sphereHit(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    vec3 q = o - b * d;
    float disc = r * r - dot(q, q);
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }
  float remap(float v, float a, float b, float c, float d) { return c + (v - a) / max(b - a, 1e-5) * (d - c); }

  // cobertura (x) y "tipo" de nube (y: 0 estratos … 1 torres) en el punto p (km, marco local)
  vec2 coverageAt(vec3 p, float fp) {
    float w = textureLod(uShape, p / (uShapeTile * 11.0) + uWindShape * 0.08, 6.0).r;
    if (uCovMode == 0) {
      vec3 n = p / max(length(p), 1e-3);
      // marco local de la malla → coordenadas de la función de textura: (-x, y, z)
      float lon = atan(n.z, -n.x);
      vec2 uv = vec2(fract(lon / 6.2831853), asin(clamp(n.y, -1.0, 1.0)) / 3.14159265 + 0.5);
      vec4 m = textureLod(uCovMap, uv, clamp(log2(max(fp / uCovTexel, 1.0)), 0.0, 10.0));
      float cov = clamp(uCovBias + m.r * uCovScale + (w - 0.5) * uCovVar, 0.0, 1.0);
      float type = clamp(m.r * 0.7 + (m.g - 0.45) * 2.0 + (w - 0.5), 0.0, 1.0);
      return vec2(cov, type);
    }
    return vec2(clamp(uCovBias + (w - 0.5) * uCovVar, 0.0, 1.0), uType);
  }

  float heightProfile(float h, float type) {
    if (uProfile == 0) {         // cúmulos: base plana, tope redondeado; la altura depende del tipo
      float top = mix(0.14, 1.0, type);
      return smoothstep(0.0, 0.035, h) * (1.0 - smoothstep(top * 0.5, top, h));
    } else if (uProfile == 1) {  // cubierta de Venus: densa abajo y al medio, tope convectivo
      return smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.72, 1.0, h)) * mix(1.0, 0.7, h);
    }
    return exp(-h * 3.0) * smoothstep(0.0, 0.02, h) * (1.0 - smoothstep(0.85, 1.0, h)); // neblina
  }

  // densidad (0..1) en p; lod = mip del ruido de forma según el tamaño del píxel
  float cloudDensity(vec3 p, float h, vec2 cw, float lod, bool detail) {
    float prof = heightProfile(h, cw.y);
    if (prof <= 0.0 || cw.x <= 0.0) return 0.0;
    vec3 q = p / uShapeTile + uWindShape;
    if (uWarp > 0.0) q += (textureLod(uShape, p / (uShapeTile * 4.0), lod + 1.0).gba - 0.5) * uWarp;
    vec4 n = textureLod(uShape, q, lod);
    float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    float base = remap(n.r, wf - 1.0, 1.0, 0.0, 1.0) * prof;
    float c = clamp(remap(base, 1.0 - cw.x, 1.0, 0.0, 1.0), 0.0, 1.0) * cw.x;
    if (c <= 0.0) return 0.0;
    if (detail) {
      vec3 dn = textureLod(uDetail, p / uDetailTile + uWindDetail, max(lod - 1.0, 0.0)).rgb;
      float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
      float m = mix(df, 1.0 - df, clamp(h * 6.0, 0.0, 1.0));
      c = clamp(remap(c, m * uErosion, 1.0, 0.0, 1.0), 0.0, 1.0);
    }
    return c;
  }

  // Sombra 2D de las nubes sobre un punto P (km, marco local): transmitancia de luz solar.
  // Gancho para el terreno: alcanza con incluir CLOUD_COMMON y llamar a cloudShadow(P).
  vec3 cloudShadow(vec3 P) {
    float r = length(P);
    if (r > uRt) return vec3(1.0);
    if (sphereHit(P, uSunL, uR * 0.995).x > 0.0) return vec3(1.0); // de noche no importa
    vec2 it = sphereHit(P, uSunL, uRt);
    vec2 ib = sphereHit(P, uSunL, uRb);
    float tIn = r < uRb ? max(ib.y, 0.0) : 0.0;
    float L = max(it.y - tIn, 0.0);
    vec3 q = P + uSunL * (tIn + 0.5 * min(L, uThick * 2.0));
    vec2 cw = coverageAt(q, 40.0);
    float od = uShadowK * cw.x * cw.x * min(L, uThick * 3.0) / uThick;
    return mix(uShadowFloor, vec3(1.0), exp(-od));
  }
`;

// ---------- atmósfera (mismo modelo que atmosphere.js, en radios) para la perspectiva aérea
const AERIAL_GLSL = /* glsl */`
  uniform float uAtmTop, uSunI;
  uniform vec3 uBetaR; uniform float uHR;
  uniform vec3 uBetaM; uniform vec3 uBetaMExt; uniform float uHM; uniform float uG;
  uniform vec3 uBetaA; uniform float uAC; uniform float uAW;
  uniform sampler2D uTransLUT;

  vec3 atmDens(float h) {
    float dR = exp(-h / uHR), dM = exp(-h / uHM);
    float dA = uAW > 0.0 ? max(0.0, 1.0 - abs(h - uAC) / uAW) : dR;
    return vec3(dR, dM, dA);
  }
  // transmitancia de la atmósfera desde p (radios) hacia el Sol
  vec3 sunTrans(vec3 pR) {
    float r = length(pR);
    float mu = dot(pR / r, uSunL);
    return textureLod(uTransLUT, vec2(mu * 0.5 + 0.5, clamp((r - 1.0) / (uAtmTop - 1.0), 0.0, 1.0)), 0.0).rgb;
  }
  // luz dispersada (L) y transmitancia (T) entre la cámara y la distancia tR (radios)
  void aerial(vec3 oR, vec3 d, float tR, out vec3 L, out vec3 T) {
    L = vec3(0.0); T = vec3(1.0);
    vec2 ta = sphereHit(oR, d, uAtmTop);
    float t0 = max(ta.x, 0.0), t1 = min(ta.y, tR);
    if (t1 <= t0) return;
    float mu = dot(d, uSunL);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g2 = uG * uG;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * uG * mu, 1e-4), 1.5));
    const int N = 6;
    float ds = (t1 - t0) / float(N);
    vec3 od = vec3(0.0), sR = vec3(0.0), sM = vec3(0.0);
    for (int i = 0; i < N; i++) {
      vec3 p = oR + d * (t0 + (float(i) + 0.5) * ds);
      vec3 dn = atmDens(length(p) - 1.0) * ds;
      od += dn;
      vec3 tr = exp(-(uBetaR * od.x + uBetaMExt * od.y + uBetaA * od.z)) * sunTrans(p);
      sR += tr * dn.x; sM += tr * dn.y;
    }
    L = uSunI * (sR * uBetaR * phR + sM * uBetaM * phM);
    T = exp(-(uBetaR * od.x + uBetaMExt * od.y + uBetaA * od.z));
  }
`;

const quadVS3 = 'out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quadVS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// profundidad logarítmica → distancia a lo largo del rayo (km); cielo = 1e9
const DEPTH_GLSL = /* glsl */`
  uniform float uLogFar;   // log2(far + 1)
  uniform vec2 uTan;       // tan(fov/2)·aspect, tan(fov/2)
  vec3 viewRay(vec2 uv) { return vec3((uv * 2.0 - 1.0) * uTan, -1.0); } // sin normalizar (z = -1)
  float depthToDist(float d, vec3 vr) {
    if (d >= 0.999999) return 1e9;
    float w = exp2(d * uLogFar) - 1.0;   // metros, eje de la vista
    return w * length(vr) * 0.001;
  }
`;

// ---------- 1) raymarch
const marchFS = /* glsl */`
  #define PI 3.14159265
  ${CLOUD_COMMON}
  ${AERIAL_GLSL}
  ${DEPTH_GLSL}
  in vec2 vUv;
  layout(location = 0) out vec4 oColor;
  layout(location = 1) out vec4 oAux;
  uniform sampler2D tDepth;
  uniform mat3 uViewToLocal;
  uniform vec3 uCamL;
  uniform float uMaxDist, uSigma, uLightLen, uBright, uPowder, uAmbBottom, uPixAngle, uFrame;
  uniform int uSteps, uLightSteps;
  uniform bool uUseDetail;
  uniform vec3 uAlbedo, uAbsorb, uAmbient, uGs;

  float hg(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  }
  float phase(float mu, float k) { return mix(hg(mu, uGs.x * k), hg(mu, uGs.y * k), uGs.z); }

  float lightOD(vec3 p, vec2 cw, float lod) {
    float od = 0.0, prevB = 0.0;
    float den = exp2(float(uLightSteps)) - 1.0;
    for (int j = 0; j < 8; j++) {
      if (j >= uLightSteps) break;
      float b = uLightLen * (exp2(float(j + 1)) - 1.0) / den;
      vec3 q = p + uSunL * (0.5 * (prevB + b));
      float hq = (length(q) - uRb) / uThick;
      if (hq > 1.0) break;
      od += cloudDensity(q, hq, cw, lod + 0.5 + float(j) * 0.6, false) * (b - prevB);
      prevB = b;
    }
    return od * uSigma;
  }

  void main() {
    // profundidad: la más lejana del bloque 2×2 (los objetos de adelante los resuelve el composite)
    ivec2 fs = textureSize(tDepth, 0);
    ivec2 base = ivec2(vUv * vec2(fs));
    float dmax = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 c = clamp(base + ivec2(k & 1, k >> 1) - 1, ivec2(0), fs - 1);
      dmax = max(dmax, texelFetch(tDepth, c, 0).r);
    }
    vec3 vr = viewRay(vUv);
    float sceneDist = depthToDist(dmax, vr);
    vec3 d = normalize(uViewToLocal * vr);
    vec3 o = uCamL;

    oColor = vec4(0.0, 0.0, 0.0, 1.0);
    oAux = vec4(1e9, sceneDist, 1e5, 0.0);

    float r0 = length(o);
    vec2 it = sphereHit(o, d, uRt);
    if (it.y <= 0.0) return;
    vec2 ib = sphereHit(o, d, uRb);
    float tS, tE;
    if (r0 > uRt) { tS = it.x; tE = ib.x > 0.0 ? ib.x : it.y; }
    else if (r0 > uRb) { tS = 0.0; tE = ib.x > 0.0 ? ib.x : it.y; }
    else { tS = max(ib.y, 0.0); tE = it.y; }
    tE = min(min(tE, sceneDist), tS + uMaxDist);
    if (tE <= tS) return;
    float L = tE - tS;

    // pasos: menos cuanto más grande es el píxel (desde el espacio basta con pocos)
    float fpS = max(tS, 0.05) * uPixAngle;
    // (las nubes tienen estructura de ~1 km: nunca muestrear más grueso que thick/24, o aparece un patrón de puntos)
    int n = int(clamp(ceil(L / max(uThick / 24.0, fpS * 0.5)), 12.0, float(uSteps)));
    // dentro de la capa: pasos concentrados cerca de la cámara (distribución cuadrática)
    float kq = tS < 1e-3 ? 1.0 : smoothstep(uThick * 2.0, uThick * 20.0, L);
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);

    float mu = dot(d, uSunL);
    float shapeVox = uShapeTile / 128.0;
    float T = 1.0, tEntry = 1e9, sumW = 0.0, sumTW = 0.0;
    vec3 Lc = vec3(0.0);
    float fn = float(n);
    for (int i = 0; i < 160; i++) {
      if (i >= n) break;
      float x = (float(i) + jitter) / fn;
      float t = tS + L * mix(x, x * x, kq);
      float dt = L * (1.0 + kq * (2.0 * x - 1.0)) / fn;
      vec3 p = o + d * t;
      float r = length(p);
      float h = (r - uRb) / uThick;
      if (h < 0.0 || h > 1.0) continue;
      float fp = max(t, 0.02) * uPixAngle;
      float lod = clamp(log2(max(fp / shapeVox, 1.0)), 0.0, 7.0);
      vec2 cw = coverageAt(p, fp);
      bool det = uUseDetail && fp < uDetailTile * 0.12;
      float dens = cloudDensity(p, h, cw, lod, det);
      if (dens <= 0.002) continue;

      float sigE = dens * uSigma;
      float od = lightOD(p, cw, lod);
      vec3 pR = p / uR;
      vec3 sunC = uSunI * sunTrans(pR);
      // dispersión múltiple aproximada (octavas): cada octava atraviesa menos, con menos
      // anisotropía y un albedo más; así lo profundo se vuelve más difuso y (en Venus) más naranja
      vec3 S = vec3(0.0), alb = uAlbedo;
      float a = 1.0, b = 1.0, c = 1.0;
      for (int k = 0; k < 3; k++) {
        S += b * phase(mu, c) * exp(-od * a * uAbsorb) * alb;
        a *= 0.42; b *= 0.6; c *= 0.6; alb *= uAlbedo;
      }
      // Beer-Powder: bordes oscurecidos cuando el Sol está detrás de la cámara
      float powder = 1.0 - exp(-2.0 * sigE * uPowder);
      S *= mix(1.0, powder, uPowder * (0.5 - 0.5 * mu));
      float sunUp = smoothstep(-0.2, 0.3, dot(p / r, uSunL));
      vec3 amb = uAmbient * uSunI * sunUp * mix(uAmbBottom, 1.0, h) * uAlbedo;
      vec3 src = sunC * S * uBright + amb;

      float Ts = exp(-sigE * dt);
      Lc += T * src * (1.0 - Ts);
      float dT = T * (1.0 - Ts);
      sumW += dT; sumTW += dT * t;
      if (tEntry > 1e8) tEntry = t - 0.5 * dt;   // primera muestra con densidad (con nubes muy densas T cae a 0 de una)
      T *= Ts;
      if (T < 0.008) { T = 0.0; break; }
    }
    float tW = sumW > 1e-4 ? sumTW / sumW : tE;

    // perspectiva aérea entre la cámara y la nube (y su luz, bajo la sombra de la capa)
    vec3 La, Ta;
    aerial(o / uR, d, tW / uR, La, Ta);
    if (r0 < uRt) La *= cloudShadow(o);
    vec3 col = Lc * Ta + La * (1.0 - T);
    oColor = vec4(clamp(col, 0.0, 1e3), T);
    oAux = vec4(tEntry, sceneDist, tW, 0.0);
  }
`;

// ---------- 2) acumulación temporal con reproyección
const temporalFS = /* glsl */`
  ${DEPTH_GLSL}
  in vec2 vUv;
  layout(location = 0) out vec4 oColor;
  uniform sampler2D tCur, tAux, tHist;
  uniform mat3 uViewToLocal;
  uniform vec3 uCamDelta;     // cámara actual − cámara anterior (km, marco local)
  uniform mat4 uPrevClip;     // marco local (relativo a la cámara anterior) → clip anterior
  uniform float uBlend;
  uniform bool uReset;
  void main() {
    vec4 cur = texture(tCur, vUv);
    if (uReset) { oColor = cur; return; }
    ivec2 sz = textureSize(tCur, 0), px = ivec2(vUv * vec2(sz));
    vec4 mn = cur, mx = cur;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec4 c = texelFetch(tCur, clamp(px + ivec2(x, y), ivec2(0), sz - 1), 0);
      mn = min(mn, c); mx = max(mx, c);
    }
    float dist = texture(tAux, vUv).z;
    vec3 P = uCamDelta + normalize(uViewToLocal * viewRay(vUv)) * dist;
    vec4 clip = uPrevClip * vec4(P, 1.0);
    vec2 puv = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
    bool ok = clip.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
    vec4 hist = clamp(texture(tHist, puv), mn, mx);
    vec4 o = mix(hist, cur, ok ? uBlend : 1.0);
    // saneado: nada de NaN hacia el historial
    if (!(o.r >= 0.0 && o.g >= 0.0 && o.b >= 0.0 && o.a >= 0.0)) o = cur;
    oColor = o;
  }
`;

// ---------- 3) composición a resolución completa
const compositeFS = /* glsl */`
  ${CLOUD_COMMON}
  ${DEPTH_GLSL}
  varying vec2 vUv;
  uniform sampler2D tScene, tDepth, tCloud, tAux;
  uniform mat3 uViewToLocal;
  uniform vec3 uCamL;
  uniform float uSkyDim, uAdapt;
  void main() {
    vec4 scene = texture2D(tScene, vUv);
    vec3 vr = viewRay(vUv);
    float sd = depthToDist(texture2D(tDepth, vUv).r, vr);
    ivec2 hs = textureSize(tCloud, 0);
    vec2 hp = vUv * vec2(hs) - 0.5;
    ivec2 i0 = ivec2(floor(hp));
    vec2 f = hp - vec2(i0);
    vec4 acc = vec4(0.0); float wsum = 0.0;
    float lsd = log(sd + 1e-3);
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1);
      ivec2 c = clamp(i0 + o, ivec2(0), hs - 1);
      vec4 cl = texelFetch(tCloud, c, 0);
      vec4 ax = texelFetch(tAux, c, 0);
      float bil = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
      float w = bil * (exp(-abs(lsd - log(ax.y + 1e-3)) * 4.0) + 1e-3);
      // el objeto está claramente delante de las nubes de ese texel (con margen: sd y tEntry no coinciden al metro)
      if (sd < ax.x - max(0.1, 0.08 * ax.x)) cl = vec4(0.0, 0.0, 0.0, 1.0);
      acc += cl * w; wsum += w;
    }
    vec4 cloud = acc / max(wsum, 1e-6);
    vec3 dL = normalize(uViewToLocal * vr);
    vec3 sh;
    if (sd < 1e8) sh = cloudShadow(uCamL + dL * sd);
    else sh = mix(vec3(1.0), cloudShadow(uCamL), uSkyDim);
    vec3 col = (scene.rgb * sh * cloud.a + cloud.rgb) * uAdapt;
    gl_FragColor = vec4(col, scene.a);
  }
`;

const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _m4 = new THREE.Matrix4(),
  _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

// Pasada mínima: guarda la profundidad de la escena para las pasadas siguientes
// (la paridad de los swaps del composer cambia al prender/apagar pasadas).
export class DepthTapPass extends Pass {
  constructor() { super(); this.needsSwap = false; this.texture = null; }
  render(renderer, writeBuffer, readBuffer) { this.texture = readBuffer.depthTexture; }
}

export class CloudPass extends Pass {
  constructor(renderer, camera, depthTap) {
    super();
    this.renderer = renderer; this.camera = camera; this.depthTap = depthTap;
    this.noise = bakeCloudNoise(renderer);
    this.quality = { scale: 0.5, steps: 48, lightSteps: 5, detail: true, temporal: 0.15 };
    this.body = null; this.cfg = null; this.active = false; this.frame = 0;
    this.wind = new THREE.Vector3();
    this.prevCamL = new THREE.Vector3(); this.prevClip = new THREE.Matrix4(); this.hasPrev = false;
    this.adapt = 1;          // exposición actual (suavizada)
    this.coverDim = 1;       // para el pase cinematográfico: cuánto llega el Sol (debajo de Venus ~0)

    const t = this.noise;
    const U = this.uniforms = {
      uShape: { value: t.shape }, uDetail: { value: t.detail }, uCovMap: { value: t.earthCoverage },
      uR: { value: 1 }, uRb: { value: 1 }, uRt: { value: 1 }, uThick: { value: 1 },
      uSunL: { value: new THREE.Vector3(1, 0, 0) },
      uCovMode: { value: 0 }, uCovBias: { value: 0 }, uCovScale: { value: 1 }, uCovVar: { value: 0 },
      uCovTexel: { value: 1 }, uType: { value: 0.5 }, uProfile: { value: 0 },
      uShapeTile: { value: 10 }, uDetailTile: { value: 1 }, uErosion: { value: 0.3 }, uWarp: { value: 0 },
      uWindShape: { value: new THREE.Vector3() }, uWindDetail: { value: new THREE.Vector3() },
      uShadowK: { value: 1 }, uShadowFloor: { value: new THREE.Vector3(1, 1, 1) },
      // atmósfera (se copian las referencias de la del planeta)
      uAtmTop: { value: 1.01 }, uSunI: { value: 3.2 },
      uBetaR: { value: new THREE.Vector3() }, uHR: { value: 1 }, uBetaM: { value: new THREE.Vector3() },
      uBetaMExt: { value: new THREE.Vector3() }, uHM: { value: 1 }, uG: { value: 0.76 },
      uBetaA: { value: new THREE.Vector3() }, uAC: { value: 0 }, uAW: { value: 0 }, uTransLUT: { value: null },
      // cámara / profundidad
      uLogFar: { value: 1 }, uTan: { value: new THREE.Vector2(1, 1) },
      tDepth: { value: null }, uViewToLocal: { value: new THREE.Matrix3() }, uCamL: { value: new THREE.Vector3() },
      // march
      uMaxDist: { value: 100 }, uSigma: { value: 1 }, uLightLen: { value: 1 }, uBright: { value: 1 },
      uPowder: { value: 0.5 }, uAmbBottom: { value: 0.5 }, uPixAngle: { value: 0.001 }, uFrame: { value: 0 },
      uSteps: { value: 48 }, uLightSteps: { value: 5 }, uUseDetail: { value: true },
      uAlbedo: { value: new THREE.Vector3(1, 1, 1) }, uAbsorb: { value: new THREE.Vector3(1, 1, 1) },
      uAmbient: { value: new THREE.Vector3() }, uGs: { value: new THREE.Vector3(0.8, -0.2, 0.3) },
      // temporal
      tCur: { value: null }, tAux: { value: null }, tHist: { value: null },
      uCamDelta: { value: new THREE.Vector3() }, uPrevClip: { value: new THREE.Matrix4() },
      uBlend: { value: 0.15 }, uReset: { value: true },
      // composite
      tScene: { value: null }, tCloud: { value: null }, uSkyDim: { value: 0 }, uAdapt: { value: 1 },
    };
    const mk = (fs, glsl3) => new THREE.ShaderMaterial({
      uniforms: U, vertexShader: glsl3 ? quadVS3 : quadVS, fragmentShader: fs,
      glslVersion: glsl3 ? THREE.GLSL3 : null, depthTest: false, depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(mk(marchFS, true));
    this.temporalQuad = new FullScreenQuad(mk(temporalFS, true));
    this.compositeQuad = new FullScreenQuad(mk(compositeFS, false));

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.mrt = new THREE.WebGLMultipleRenderTargets(1, 1, 2, rtOpts);
    for (const tx of this.mrt.texture) { tx.type = THREE.HalfFloatType; tx.minFilter = tx.magFilter = THREE.LinearFilter; }
    // la distancia necesita float32 (km hasta 1e9)
    this.mrt.texture[1].type = THREE.FloatType;
    this.mrt.texture[1].minFilter = this.mrt.texture[1].magFilter = THREE.NearestFilter;
    this.hist = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
    this.histIdx = 0;
    this.fullW = 1; this.fullH = 1;
  }

  setQuality(q) {
    Object.assign(this.quality, q);
    this.setSize(this.fullW, this.fullH);
  }

  setSize(w, h) {
    this.fullW = w; this.fullH = h;
    const s = this.quality.scale;
    const hw = Math.max(1, Math.round(w * s)), hh = Math.max(1, Math.round(h * s));
    this.mrt.setSize(hw, hh);
    for (const r of this.hist) r.setSize(hw, hh);
    this.hasPrev = false;
  }

  // Elige el planeta, ubica todo en su marco local. Llamar después de system.syncRender.
  update(dt, system, camera) {
    let best = null, score = 0;
    for (const id in CLOUDS) {
      const b = system.byId[id];
      if (!b || !b.atm) continue;
      const s = b.R / Math.max(b.rel.length(), 1);
      if (s > score) { score = s; best = b; }
    }
    // activo cuando el planeta mide más de ~0,15° en pantalla
    this.active = !!best && score > 0.0013;
    this.enabled = this.active;
    if (!this.active) { this.coverDim = 1; this.adapt = 1; this.hasPrev = false; return; }
    if (best !== this.body) { this.body = best; this.cfg = CLOUDS[best.id]; this.applyBody(); this.hasPrev = false; }
    const b = best, c = this.cfg, U = this.uniforms;
    const Rkm = b.R / 1000;

    // rotación del planeta: local → mundo = tilt · Ry(spin)
    _q.copy(b.tilt).multiply(_qs.setFromAxisAngle(Y, b.spin));
    const localToWorld = _m4.makeRotationFromQuaternion(_q);
    const l2w3 = new THREE.Matrix3().setFromMatrix4(localToWorld);
    const w2l3 = l2w3.clone().transpose();
    U.uCamL.value.copy(b.rel).negate().multiplyScalar(0.001).applyMatrix3(w2l3);
    const sunRel = _v.subVectors(system.byId.sun.rel, b.rel).normalize();
    U.uSunL.value.copy(sunRel).applyMatrix3(w2l3).normalize();
    const camRot = new THREE.Matrix3().setFromMatrix4(camera.matrixWorld);
    U.uViewToLocal.value.multiplyMatrices(w2l3, camRot);

    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    U.uTan.value.set(tanH * camera.aspect, tanH);
    U.uLogFar.value = Math.log2(camera.far + 1);
    U.uPixAngle.value = 2 * tanH / Math.max(1, this.fullH * this.quality.scale);

    // viento (en espacio de ruido, envuelto para no perder precisión)
    this.wind.addScaledVector(_v2.fromArray(c.wind), dt);
    const wrap = (v, tile, out, k = 1) => out.set(
      ((v.x * k / tile) % 1 + 1) % 1, ((v.y * k / tile) % 1 + 1) % 1, ((v.z * k / tile) % 1 + 1) % 1);
    wrap(this.wind, c.shapeTile, U.uWindShape.value);
    wrap(this.wind, c.detailTile, U.uWindDetail.value, 1.6);

    // temporal: matriz de clip del cuadro anterior en el marco local
    const curClip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(localToWorld);
    U.uCamDelta.value.subVectors(U.uCamL.value, this.prevCamL);
    U.uPrevClip.value.copy(this.prevClip);
    U.uReset.value = !this.hasPrev || this.quality.temporal >= 1;
    U.uBlend.value = this.quality.temporal;
    this.prevClip.copy(curClip); this.prevCamL.copy(U.uCamL.value); this.hasPrev = true;
    U.uFrame.value = (this.frame++) % 1024;
    U.uSteps.value = this.quality.steps;
    U.uLightSteps.value = this.quality.lightSteps;
    U.uUseDetail.value = this.quality.detail;

    // debajo de la capa: adaptación del ojo y cuánto Sol llega (para el flare / god rays)
    const alt = U.uCamL.value.length() - Rkm;
    const under = THREE.MathUtils.smoothstep(alt, c.base, c.top);          // 0 abajo … 1 arriba
    const target = THREE.MathUtils.lerp(c.adapt, 1, under);
    this.adapt += (target - this.adapt) * (1 - Math.exp(-dt * 1.5));
    U.uAdapt.value = this.adapt;
    this.coverDim = c.skyDim > 0 ? under : 1;
  }

  applyBody() {
    const b = this.body, c = this.cfg, U = this.uniforms, a = b.atm.uniforms;
    const Rkm = b.R / 1000;
    U.uR.value = Rkm; U.uRb.value = Rkm + c.base; U.uRt.value = Rkm + c.top; U.uThick.value = c.top - c.base;
    U.uCovMode.value = c.coverage === 'map' ? 0 : 1;
    U.uCovBias.value = c.covBias; U.uCovScale.value = c.covScale; U.uCovVar.value = c.covVar; U.uType.value = c.type;
    U.uCovTexel.value = 2 * Math.PI * Rkm / 2048;
    U.uProfile.value = c.profile; U.uShapeTile.value = c.shapeTile; U.uDetailTile.value = c.detailTile;
    U.uErosion.value = c.erosion; U.uWarp.value = c.warp;
    U.uShadowK.value = c.shadowK; U.uShadowFloor.value.fromArray(c.shadowFloor);
    U.uMaxDist.value = c.maxDist; U.uSigma.value = c.sigma; U.uLightLen.value = c.lightLen;
    U.uBright.value = c.bright; U.uPowder.value = c.powder; U.uAmbBottom.value = c.ambBottom;
    U.uAlbedo.value.fromArray(c.albedo); U.uAbsorb.value.fromArray(c.absorb);
    U.uAmbient.value.fromArray(c.ambient); U.uGs.value.fromArray(c.g);
    U.uSkyDim.value = c.skyDim;
    for (const k of ['uBetaR', 'uHR', 'uBetaM', 'uBetaMExt', 'uHM', 'uG', 'uBetaA', 'uAC', 'uAW', 'uTransLUT']) U[k].value = a[k].value;
    U.uAtmTop.value = a.uTop.value; U.uSunI.value = a.uSun.value;
    this.wind.set(0, 0, 0);
  }

  render(renderer, writeBuffer, readBuffer) {
    const U = this.uniforms;
    U.tDepth.value = readBuffer.depthTexture;
    // 1) march
    renderer.setRenderTarget(this.mrt);
    this.marchQuad.render(renderer);
    // 2) temporal
    const src = this.hist[this.histIdx], dst = this.hist[1 - this.histIdx];
    U.tCur.value = this.mrt.texture[0]; U.tAux.value = this.mrt.texture[1]; U.tHist.value = src.texture;
    renderer.setRenderTarget(dst);
    this.temporalQuad.render(renderer);
    this.histIdx = 1 - this.histIdx;
    // 3) composite
    U.tScene.value = readBuffer.texture; U.tCloud.value = dst.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  // transmitancia de las nubes (para el pase cinematográfico)
  get cloudTexture() { return this.hist[this.histIdx].texture; }
}
