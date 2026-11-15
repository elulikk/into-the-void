// Pool de partículas en el espacio LOCAL de la nave (coordenadas chicas, en metros).
// La simulación es en la CPU (unas pocas miles de partículas, barato) y se dibuja con
// un único THREE.Points con shader: tamaño en metros, disco suave, blending aditivo.
// Nunca se usan coordenadas del mundo: el objeto cuelga del grupo de la nave.
import * as THREE from 'three';

const vertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aColor;     // rgb (HDR) + alpha
  attribute float aSize;     // diámetro en metros
  uniform float uPx;         // alto del viewport en píxeles / 2
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = max(0.05, -mv.z);
    gl_PointSize = clamp(aSize * uPx * projectionMatrix[1][1] / d, 0.0, 256.0);
    #include <logdepthbuf_vertex>
  }`;
const fragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  varying vec4 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a = vColor.a * (1.0 - r2) * (1.0 - r2);
    gl_FragColor = vec4(vColor.rgb * a, a);
  }`;

export class ParticlePool {
  constructor(max = 1024, { blending = THREE.AdditiveBlending } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);     // tiempo restante (s)
    this.life0 = new Float32Array(max);    // vida total
    this.base = new Float32Array(max * 4); // color inicial rgb + alpha
    this.grow = new Float32Array(max * 2); // tamaño inicial, final
    this.drag = new Float32Array(max);
    this.next = 0;
    this.alive = 0;

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    this.uniforms = { uPx: { value: 500 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  // p, v: arrays/Vector3 en espacio local; color: THREE.Color (puede ser > 1 para el bloom)
  emit(p, v, life, color, alpha, size0, size1, drag = 0) {
    if (!(life > 0) || !Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z)) return;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = this.life0[i] = life;
    this.base[i * 4] = color.r; this.base[i * 4 + 1] = color.g; this.base[i * 4 + 2] = color.b; this.base[i * 4 + 3] = alpha;
    this.grow[i * 2] = size0; this.grow[i * 2 + 1] = size1;
    this.drag[i] = drag;
  }

  update(dt, pxHalfHeight) {
    this.uniforms.uPx.value = pxHalfHeight;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      let l = this.life[i];
      if (l <= 0) { if (this.col[i * 4 + 3] !== 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; } continue; }
      l -= dt;
      this.life[i] = l;
      if (l <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      alive++;
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k; this.vel[j + 1] *= k; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = 1 - l / this.life0[i];             // 0 → 1 a lo largo de la vida
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      const cool = 1 - 0.6 * t;                     // se enfría: pierde brillo HDR
      this.col[i * 4] = this.base[i * 4] * cool;
      this.col[i * 4 + 1] = this.base[i * 4 + 1] * cool * cool;
      this.col[i * 4 + 2] = this.base[i * 4 + 2] * cool * cool;
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * fade;
      this.size[i] = this.grow[i * 2] + (this.grow[i * 2 + 1] - this.grow[i * 2]) * t;
    }
    this.alive = alive;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

// Textura de brillo radial (para sprites de toberas, luces de navegación, destellos)
let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

// Sprite aditivo con brillo HDR (color × intensidad) que respeta el depth logarítmico
export function glowSprite(color, size) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 11;
  return s;
}
