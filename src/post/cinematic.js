// Look cinematográfico, liviano y configurable. Dos pasadas:
//  - CinematicHDR (antes del bloom, en HDR): rayos de luz (god rays) hacia el Sol y lens flare sutil.
//    La visibilidad del Sol se calcula de forma ANALÍTICA contra las esferas de los cuerpos
//    (no con el depth buffer), así el flare se apaga suave en un eclipse/ocultación.
//  - CinematicLDR (después del OutputPass, ya en sRGB): curva de color suave, viñeta y grano fino.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const hdrFS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uSunUV;
  uniform float uSunVis, uShafts, uFlare, uAspect, uSunAng;
  varying vec2 vUv;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  vec3 ghost(vec2 uv, vec2 c, float k, float size, vec3 tint) {
    vec2 p = c + (uSunUV - c) * k;
    vec2 d = (uv - p) * vec2(uAspect, 1.0);
    float r = length(d) / size;
    float ring = exp(-pow((r - 1.0) * 3.0, 2.0)) * 0.5 + exp(-r * r * 1.5) * 0.5;
    return tint * ring;
  }

  void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    float vis = uSunVis;
    if (vis > 0.001) {
      // ---- god rays: se integra el brillo a lo largo de la línea píxel → Sol
      if (uShafts > 0.0) {
        vec2 dv = (uSunUV - vUv);
        float len = length(dv * vec2(uAspect, 1.0));
        const int N = 28;
        vec2 stepv = dv * min(1.0, 0.9) / float(N);
        vec2 uv = vUv + stepv * hash(gl_FragCoord.xy);
        vec3 acc = vec3(0.0); float w = 1.0;
        for (int i = 0; i < N; i++) {
          vec3 s = texture2D(tDiffuse, uv).rgb;
          float l = lum(s);
          acc += s * smoothstep(1.6, 4.0, l) * min(l, 6.0) / max(l, 1e-3) * w;
          w *= 0.955;
          uv += stepv;
        }
        float fall = exp(-len * 1.6);
        col += acc / float(N) * uShafts * 0.9 * fall * vis;
      }
      // ---- lens flare sutil
      if (uFlare > 0.0) {
        vec2 c = vec2(0.5);
        vec3 f = vec3(0.0);
        f += ghost(vUv, c, -0.35, 0.05, vec3(0.9, 0.7, 0.45)) * 0.45;
        f += ghost(vUv, c, -0.9, 0.11, vec3(0.5, 0.65, 1.0)) * 0.25;
        f += ghost(vUv, c, 0.45, 0.035, vec3(1.0, 0.8, 0.5)) * 0.4;
        f += ghost(vUv, c, 1.6, 0.16, vec3(0.6, 0.9, 0.8)) * 0.12;
        // halo anular alrededor del Sol y estría anamórfica horizontal
        vec2 d = (vUv - uSunUV) * vec2(uAspect, 1.0);
        float r = length(d);
        f += vec3(1.0, 0.85, 0.65) * exp(-pow((r - 0.17) * 22.0, 2.0)) * 0.1;
        f += vec3(0.7, 0.8, 1.0) * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 2.2) * 0.22;
        // se desvanece hacia el borde de la pantalla y con el Sol chico (muy lejos)
        vec2 e = abs(uSunUV - 0.5) * 2.0;
        float edge = 1.0 - smoothstep(0.7, 1.15, max(e.x, e.y));
        col += f * uFlare * vis * edge;
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const ldrFS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uGrade, uVignette, uGrain, uTime, uAspect;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    // curva S suave (contraste) + tinte sutil: sombras levemente frías, luces levemente cálidas
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 s = c * c * (3.0 - 2.0 * c);
    vec3 g = mix(c, s, 0.55);
    g = mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, 1.06);          // saturación +6 %
    g *= mix(vec3(0.97, 1.0, 1.04), vec3(1.03, 1.0, 0.97), smoothstep(0.15, 0.85, l));
    c = mix(c, clamp(g, 0.0, 1.0), uGrade);
    // viñeta
    vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
    // grano fino (más visible en medios tonos)
    float n = hash(vUv * 1731.0) + hash(vUv * 977.0 + 3.7) - 1.0;
    c += n * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Cinematic {
  constructor() {
    this.enabled = true;
    this.settings = { shafts: 0.8, flare: 0.6, grade: 0.8, vignette: 0.28, grain: 0.012 };
    this.hdr = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
        uSunVis: { value: 0 }, uShafts: { value: 0 }, uFlare: { value: 0 }, uAspect: { value: 1 }, uSunAng: { value: 0 },
      },
      vertexShader: VS, fragmentShader: hdrFS,
    });
    this.ldr = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, uGrade: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 },
        uTime: { value: 0 }, uAspect: { value: 1 },
      },
      vertexShader: VS, fragmentShader: ldrFS,
    });
    this.sunVisibility = 1;
    this._d = new THREE.Vector3(); this._p = new THREE.Vector3();
  }

  setEnabled(on) { this.enabled = on; this.hdr.enabled = on; this.ldr.enabled = on; }

  // sun/bodies: cuerpos con .rel (relativo a la cámara, m) y .R; dim: luz solar que llega
  // (por debajo de la capa de Venus ≈ 0: se apagan rayos y flare)
  update(camera, bodies, sun, dim = 1, time = 0) {
    const s = this.settings, H = this.hdr.uniforms, L = this.ldr.uniforms;
    L.uGrade.value = s.grade; L.uVignette.value = s.vignette; L.uGrain.value = s.grain; L.uTime.value = time % 100;
    L.uAspect.value = H.uAspect.value = camera.aspect;
    H.uShafts.value = s.shafts; H.uFlare.value = s.flare;

    const sd = sun.rel.length();
    const dir = this._d.copy(sun.rel).divideScalar(sd);
    const sunAng = Math.asin(Math.min(1, sun.R / sd));
    // posición del Sol en pantalla
    const p = this._p.copy(sun.rel).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    const vz = this._p.copy(sun.rel).applyMatrix4(camera.matrixWorldInverse).z;   // < 0 = delante
    H.uSunUV.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    // visibilidad analítica: fracción del disco solar no tapada por otros cuerpos
    let vis = 1;
    for (const b of bodies) {
      if (b === sun) continue;
      const bd = b.rel.length();
      if (bd > sd) continue;
      const ar = Math.asin(Math.min(1, b.R / bd));
      const sep = Math.acos(Math.min(1, Math.max(-1, dir.dot(b.rel) / bd)));
      vis = Math.min(vis, THREE.MathUtils.clamp((sep - ar + sunAng) / (2 * sunAng), 0, 1));
    }
    this.sunVisibility = vis;
    H.uSunVis.value = vz < 0 ? vis * dim : 0;
    H.uSunAng.value = sunAng;
  }
}
