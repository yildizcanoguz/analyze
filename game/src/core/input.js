// Input service: keyboard + mouse + pointer lock + gamepad. Owned by integration.

const DEFAULT_BINDINGS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ControlLeft: 'crouch', KeyC: 'crouch',
  ShiftLeft: 'sprint',
  KeyR: 'reload',
  KeyV: 'melee', KeyF: 'melee',
  KeyE: 'use',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3',
  KeyG: 'grenade',
  KeyQ: 'lean_l', KeyZ: 'lean_r',
  Escape: 'pause',
  KeyI: 'inspect',
  KeyB: 'firemode',
  KeyT: 'photo',
};

export default class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.bindings = { ...DEFAULT_BINDINGS };
    this._down = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, x: 0, y: 0 };
    this.locked = false;
    this.enabled = true;
    this._accum = { dx: 0, dy: 0, wheel: 0 };

    this._onKeyDown = (e) => {
      if (e.code === 'F5' || (e.ctrlKey && e.code === 'KeyR')) return;
      const a = this.bindings[e.code];
      if (a) {
        e.preventDefault();
        if (!this._down.has(a)) this._pressed.add(a);
        this._down.add(a);
      }
    };
    this._onKeyUp = (e) => {
      const a = this.bindings[e.code];
      if (a) { this._down.delete(a); this._released.add(a); }
    };
    this._onMouseDown = (e) => {
      const a = e.button === 0 ? 'fire' : e.button === 2 ? 'ads' : e.button === 1 ? 'melee' : null;
      if (a) { if (!this._down.has(a)) this._pressed.add(a); this._down.add(a); }
    };
    this._onMouseUp = (e) => {
      const a = e.button === 0 ? 'fire' : e.button === 2 ? 'ads' : e.button === 1 ? 'melee' : null;
      if (a) { this._down.delete(a); this._released.add(a); }
    };
    this._onMouseMove = (e) => {
      if (this.locked) { this._accum.dx += e.movementX || 0; this._accum.dy += e.movementY || 0; }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    };
    this._onWheel = (e) => { this._accum.wheel += Math.sign(e.deltaY); e.preventDefault(); };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this._down.clear(); }
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => { this._down.clear(); };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('contextmenu', this._onContext);
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }
  exitLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  down(a) { return this.enabled && this._down.has(a); }
  pressed(a) { return this.enabled && this._pressed.has(a); }
  released(a) { return this.enabled && this._released.has(a); }

  // Synthetic input for automated capture/testing.
  press(a) { if (!this._down.has(a)) this._pressed.add(a); this._down.add(a); }
  release(a) { this._down.delete(a); this._released.add(a); }
  look(dx, dy) { this._accum.dx += dx; this._accum.dy += dy; }

  beginFrame() {
    this.mouse.dx = this._accum.dx;
    this.mouse.dy = this._accum.dy;
    this.mouse.wheel = this._accum.wheel;
    this._accum.dx = 0; this._accum.dy = 0; this._accum.wheel = 0;
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }
}
