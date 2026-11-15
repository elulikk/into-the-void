// Presets de calidad, medidor de FPS y tiempos de GPU por pasada.
// Teclas: F3 = mostrar/ocultar FPS y tiempos · F4 = cambiar de preset · K = look cinematográfico · U = nubes.
export const PRESETS = {
  Bajo:   { scale: 0.35, steps: 28, lightSteps: 4, detail: false, temporal: 0.1 },
  Medio:  { scale: 0.5,  steps: 40, lightSteps: 5, detail: true,  temporal: 0.12 },
  Alto:   { scale: 0.5,  steps: 64, lightSteps: 6, detail: true,  temporal: 0.15 },
  Ultra:  { scale: 0.75, steps: 96, lightSteps: 7, detail: true,  temporal: 0.2 },
};
export const PRESET_NAMES = Object.keys(PRESETS);

// Tiempos de GPU con EXT_disjoint_timer_query_webgl2 (si el navegador lo expone)
export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = []; this.ms = {}; this.free = [];
  }
  wrap(name, pass) {
    const orig = pass.render.bind(pass);
    pass.render = (...a) => {
      if (!this.ext || this.busy) return orig(...a);
      const gl = this.gl;
      const q = this.free.pop() || gl.createQuery();
      this.busy = true;
      gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
      orig(...a);
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.busy = false;
      this.pending.push({ name, q });
    };
  }
  poll() {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const { name, q } = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.ms[name] = this.ms[name] === undefined ? ms : this.ms[name] * 0.9 + ms * 0.1;
      }
      this.free.push(q);
    }
  }
}

export class PerfOverlay {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:30;font:11px/1.5 ui-monospace,Consolas,monospace;' +
      'color:#bfe9ff;background:rgba(5,10,18,.62);padding:6px 9px;border:1px solid rgba(111,211,255,.25);' +
      'white-space:pre;pointer-events:none;display:none';
    document.body.appendChild(this.el);
    this.visible = false; this.fps = 60; this.acc = 0; this.n = 0; this.cpu = 0;
  }
  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? 'block' : 'none'; }
  frame(dt) { this.acc += dt; this.n++; if (this.acc >= 0.5) { this.fps = this.n / this.acc; this.acc = 0; this.n = 0; this.dirty = true; } }
  draw(info, timer) {
    if (!this.visible || !this.dirty) return;
    this.dirty = false;
    let s = `${this.fps.toFixed(0)} FPS  (${(1000 / this.fps).toFixed(1)} ms)\nCalidad: ${info.preset}  ·  Nubes: ${info.clouds}  ·  Cine: ${info.cine}`;
    if (timer.ext) {
      const names = Object.keys(timer.ms);
      if (names.length) s += '\n' + names.map(n => `${n.padEnd(8)} ${timer.ms[n].toFixed(2)} ms`).join('\n');
    } else s += '\n(sin timer de GPU)';
    this.el.textContent = s;
  }
}
