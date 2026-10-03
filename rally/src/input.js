// Keyboard, gamepad and touch input, merged into one driving state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    this.steerSmooth = 0;
    this.lastPad = [];
    this.padPressed = new Set();
    this.usingPad = false;
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  k(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)) || codes.some((c) => this.padPressed.has(c)); }
  poll(dt) {
    this.padPressed.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    if (pad) {
      const b = pad.buttons.map((x) => x.pressed);
      const map = { 0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY', 4: 'PadLB', 5: 'PadRB', 8: 'PadBack', 9: 'PadStart', 12: 'PadUp', 13: 'PadDown', 14: 'PadLeft', 15: 'PadRight' };
      for (const [i, name] of Object.entries(map)) if (b[i] && !this.lastPad[i]) { this.padPressed.add(name); this.usingPad = true; }
      if (Math.abs(pad.axes[0]) > 0.3 || (pad.buttons[7]?.value || 0) > 0.2) this.usingPad = true;
      this.lastPad = b;
    }
  }
  endFrame() { this.pressed.clear(); }

  // Driving controls (keyboard steering is smoothed so you can feather it).
  drive(dt) {
    const pad = this.pad;
    let steerTarget = (this.k('ArrowRight', 'KeyD') ? 1 : 0) - (this.k('ArrowLeft', 'KeyA') ? 1 : 0);
    let throttle = this.k('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.k('ArrowDown', 'KeyS') ? 1 : 0;
    let handbrake = this.k('Space') ? 1 : 0;
    let analog = false;
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.08) { steerTarget = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.4); analog = true; }
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt, pad.buttons[2]?.pressed ? 1 : 0);
      handbrake = Math.max(handbrake, pad.buttons[1]?.pressed || pad.buttons[5]?.pressed ? 1 : 0);
    }
    const t = this.touch;
    if (t.active) { steerTarget = t.steer; throttle = Math.max(throttle, t.throttle); brake = Math.max(brake, t.brake); handbrake = Math.max(handbrake, t.handbrake); analog = true; }
    if (analog) this.steerSmooth = steerTarget;
    else {
      // Keyboard: ramp in, faster when returning or reversing direction.
      const rate = steerTarget === 0 ? 7 : Math.sign(steerTarget) !== Math.sign(this.steerSmooth) && this.steerSmooth !== 0 ? 9 : 4.2;
      const d = steerTarget - this.steerSmooth;
      this.steerSmooth += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    return {
      steer: this.steerSmooth, throttle, brake, handbrake,
      shiftUp: this.hit('KeyE'),
      shiftDown: this.hit('KeyQ'),
    };
  }
}
