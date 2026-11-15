// Alertas contextuales con fundido: las de "evento" duran unos segundos,
// las de "condición" quedan mientras se cumpla la condición.
export class Alerts {
  constructor(container) {
    this.box = container;
    this.items = new Map();   // key → { el, until, on }
    this.prev = {};
  }

  el(key, text, level) {
    let it = this.items.get(key);
    if (!it) {
      const el = document.createElement('div');
      el.className = `alert ${level}`;
      this.box.appendChild(el);
      it = { el, until: 0, on: false, text: '' };
      this.items.set(key, it);
    }
    if (it.text !== text) { it.el.textContent = text; it.text = text; }
    return it;
  }

  // evento puntual (se muestra `secs` segundos)
  flash(key, text, level = 'info', secs = 4) {
    const it = this.el(key, text, level);
    it.until = performance.now() + secs * 1000;
  }

  // condición sostenida
  hold(key, on, text, level = 'warn') {
    if (!on && !this.items.has(key)) return;
    const it = this.el(key, text, level);
    if (on) it.until = performance.now() + 600;
  }

  // flanco de subida de una condición booleana
  edge(key, now) { const was = this.prev[key]; this.prev[key] = now; return now && was === false; }

  tick() {
    const t = performance.now();
    for (const it of this.items.values()) {
      const on = t < it.until;
      if (on !== it.on) { it.on = on; it.el.classList.toggle('show', on); }
    }
  }

  clearEdges() { this.prev = {}; }
}
