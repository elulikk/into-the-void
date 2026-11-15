/**
 * gamepad.js — Gamepad API input (standard mapping: Xbox / PlayStation). No dependencies.
 *
 * Usage:
 *   const pad = new GamepadInput();
 *   // each frame:
 *   const s = pad.poll();   // returns pad.state
 *
 * MAPPING (standard layout; PlayStation names in brackets)
 *   Right stick Y ........ pitch  (inverted like a plane: stick up = nose down; see GamepadInput.invertY)
 *   Right stick X ........ yaw
 *   LB / RB (L1 / R1) .... roll left / right  (LB = -1, RB = +1)
 *   Left stick X, Y ...... strafeX / strafeY  (strafeY: stick up = +1)
 *   RT (R2) .............. throttle +  (accelerate)
 *   LT (L2) .............. throttle -  (brake / reverse)
 *   A (Cross) ............ boost (held)
 *   L3 (left stick click)  pressed.cruise (edge) — supercruise
 *   Back / View (Share) .. pressed.engineMode (edge) — cycle engine mode (atmo/impulse/cruise)
 *   B (Circle) ........... pressed.brake        (edge)
 *   X (Square) ........... pressed.autopilot     (edge)
 *   Y (Triangle) ......... pressed.camera        (edge)
 *   R3 (right stick click) pressed.freelook (edge) + freelookHeld (held)
 *   D-pad Right .......... pressed.nextTarget    (edge)
 *   D-pad Left ........... pressed.prevTarget    (edge)
 *   D-pad Up ............. pressed.labels        (edge)
 *   D-pad Down ........... pressed.help          (edge)
 *
 * All axes go through a radial deadzone (DEADZONE, rescaled so output starts at 0)
 * and a response curve sign(v)*|v|^EXPONENT.
 * `pressed.*` are true only for the single poll() in which the button goes down.
 */

const DEADZONE = 0.15;
const EXPONENT = 1.6;
const TRIGGER_DEADZONE = 0.05;

// standard-mapping button indices
const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const EDGE_MAP = {
  autopilot: BTN.X,
  brake: BTN.B,
  camera: BTN.Y,
  freelook: BTN.R3,
  nextTarget: BTN.RIGHT,
  prevTarget: BTN.LEFT,
  labels: BTN.UP,
  help: BTN.DOWN,
  cruise: BTN.L3,
  engineMode: BTN.BACK,
};

function curve(v) {
  return Math.sign(v) * Math.pow(Math.abs(v), EXPONENT);
}

/** Radial deadzone + rescale + response curve on a 2D stick. */
function stick(x, y, deadzone = DEADZONE) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return [0, 0];
  const m = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const k = curve(m) / mag;
  return [x * k, y * k];
}

function makeState() {
  const pressed = {};
  for (const k of Object.keys(EDGE_MAP)) pressed[k] = false;
  return {
    pitch: 0, yaw: 0, roll: 0,
    throttle: 0,
    strafeX: 0, strafeY: 0,
    boost: false,
    pressed,
    freelookHeld: false,
  };
}

export class GamepadInput {
  /** true: stick up = nose down (plane-style). false: stick up = nose up. */
  static invertY = true;

  constructor() {
    this.connected = false;
    this.name = '';
    this.index = -1;
    this.state = makeState();
    this._prev = {};          // previous button states for edge detection
    this._supported = typeof navigator !== 'undefined' && !!navigator.getGamepads;

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        if (this.index < 0 || !this._pad(this.index)) this._attach(e.gamepad);
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index === this.index) this._detach();
      });
    }
  }

  _pad(index) {
    const list = this._supported ? navigator.getGamepads() : [];
    return list && list[index] ? list[index] : null;
  }

  _attach(gp) {
    this.index = gp.index;
    this.connected = true;
    this.name = gp.id;
    this._prev = {};
  }

  _detach() {
    this.index = -1;
    this.connected = false;
    this.name = '';
    this._prev = {};
    this.state = makeState();
  }

  /** Call once per frame. Returns this.state. */
  poll() {
    if (!this._supported) return this.state;

    let gp = this.index >= 0 ? this._pad(this.index) : null;
    if (!gp) {
      if (this.connected) this._detach();
      // Some browsers only expose pads after the first button press and may
      // not fire the event for pads already connected: scan for one.
      for (const p of navigator.getGamepads() || []) {
        if (p && p.connected) { this._attach(p); gp = p; break; }
      }
      if (!gp) return this.state;
    }

    const a = gp.axes;
    const b = gp.buttons;
    const val = (i) => (b[i] ? b[i].value : 0);
    const down = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
    const s = this.state;

    // Right stick: pitch / yaw
    const [rx, ry] = stick(a[2] || 0, a[3] || 0);
    s.yaw = rx;
    s.pitch = GamepadInput.invertY ? ry : -ry; // ry>0 = stick down. Inverted: stick up (ry<0) = nose down (pitch<0)

    // Left stick: strafe (up = +1)
    const [lx, ly] = stick(a[0] || 0, a[1] || 0);
    s.strafeX = lx;
    s.strafeY = -ly;

    // Roll on bumpers
    s.roll = (down(BTN.RB) ? 1 : 0) - (down(BTN.LB) ? 1 : 0);

    // Throttle: RT accelerates, LT brakes/reverses (analog triggers, small deadzone)
    const tz = (v) => (v < TRIGGER_DEADZONE ? 0 : (v - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE));
    s.throttle = Math.max(-1, Math.min(1, tz(val(BTN.RT)) - tz(val(BTN.LT))));

    s.boost = down(BTN.A);

    // Edge-detected buttons
    for (const [name, idx] of Object.entries(EDGE_MAP)) {
      const now = down(idx);
      s.pressed[name] = now && !this._prev[idx];
      this._prev[idx] = now;
    }
    s.freelookHeld = down(BTN.R3);

    return s;
  }
}
