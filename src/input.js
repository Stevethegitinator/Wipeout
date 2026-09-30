// Keyboard and gamepad input with edge detection for menus.
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  thrust: ['KeyX', 'KeyW', 'ArrowUp'],
  noseUp: ['ArrowDown', 'KeyS'],
  brakeL: ['KeyZ', 'KeyQ'],
  brakeR: ['KeyC', 'KeyE'],
  fire: ['Space', 'ShiftLeft', 'ShiftRight'],
  view: ['KeyV'],
  pause: ['Escape', 'KeyP'],
  // menu
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  ok: ['Enter', 'Space', 'KeyX'],
  back: ['Escape', 'Backspace'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.hits = new Set(); // keys pressed since the last poll, so quick taps are never missed
    this.prev = {};
    this.state = {};
    this.touch = {};
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.hits.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  poll() {
    const s = {};
    for (const [action, codes] of Object.entries(KEYMAP)) s[action] = codes.some((c) => this.keys.has(c) || this.hits.has(c)) ? 1 : 0;
    this.hits.clear();
    s.steer = s.right - s.left;
    s.pitch = s.noseUp;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i) => (gp.buttons[i] && gp.buttons[i].pressed ? 1 : 0);
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.abs(ax) > 0.15) s.steer = Math.max(-1, Math.min(1, ax * 1.1));
      s.steer = s.steer || b(15) - b(14);
      if (ay > 0.4) s.pitch = 1;
      s.thrust ||= b(0);
      s.fire ||= b(1) || b(2);
      s.brakeL ||= b(4) || (gp.buttons[6] && gp.buttons[6].value > 0.3 ? 1 : 0);
      s.brakeR ||= b(5) || (gp.buttons[7] && gp.buttons[7].value > 0.3 ? 1 : 0);
      s.view ||= b(3);
      s.pause ||= b(9);
      s.up ||= b(12) || (ay < -0.6 ? 1 : 0);
      s.down ||= b(13) || (ay > 0.6 ? 1 : 0);
      s.left ||= b(14) || (ax < -0.6 ? 1 : 0);
      s.right ||= b(15) || (ax > 0.6 ? 1 : 0);
      s.ok ||= b(0) || b(9);
      s.back ||= b(1) || b(8);
    }
    for (const [k, v] of Object.entries(this.touch)) if (v) s[k] = k === 'steer' ? v : 1;
    this.prev = this.state;
    this.state = s;
    return s;
  }

  pressed(action) { return this.state[action] && !this.prev[action]; }
}
