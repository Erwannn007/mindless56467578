// Keyboard + mouse (pointer lock) for desktop, virtual joystick + drag-look for touch.

const LOOK_MOUSE = 0.0022;
const LOOK_TOUCH = 0.0055;
const MAX_PITCH = 1.45;

export class Input {
  constructor(canvas, touchLayer, player) {
    this.player = player;
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.runToggle = false;
    this.sensitivity = 1;
    this.enabled = false;
    this.keys = new Set();
    this.joy = null;   // { id, ox, oy }
    this.look = null;  // { id, x, y }
    this.joyRadius = 60;

    this.joyBase = document.getElementById('joy-base');
    this.joyKnob = document.getElementById('joy-knob');

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this._rotate(e.movementX * LOOK_MOUSE, e.movementY * LOOK_MOUSE);
    });

    touchLayer.addEventListener('pointerdown', (e) => this._down(e));
    touchLayer.addEventListener('pointermove', (e) => this._moveEv(e));
    touchLayer.addEventListener('pointerup', (e) => this._up(e));
    touchLayer.addEventListener('pointercancel', (e) => this._up(e));
    // iOS: block page zoom / scroll gestures
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.target === touchLayer) e.preventDefault(); }, { passive: false });
  }

  _rotate(dx, dy) {
    const p = this.player;
    p.yaw -= dx * this.sensitivity;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch - dy * this.sensitivity));
  }

  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()?.catch?.(() => {});
      return;
    }
    e.preventDefault();
    const leftSide = e.clientX < innerWidth * 0.42;
    if (leftSide && !this.joy) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.joyRadius = Math.max(45, Math.min(80, Math.min(innerWidth, innerHeight) * 0.13));
      this._showJoy(e.clientX, e.clientY, 0, 0);
    } else if (!this.look) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  _moveEv(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const r = this.joyRadius, l = Math.hypot(dx, dy);
      if (l > r) { dx *= r / l; dy *= r / l; }
      this.move.x = dx / r;
      this.move.y = -dy / r;
      this._showJoy(this.joy.ox, this.joy.oy, dx, dy);
    } else if (this.look && e.pointerId === this.look.id) {
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
      this._rotate(dx * LOOK_TOUCH, dy * LOOK_TOUCH);
    }
  }

  _up(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.move.x = this.move.y = 0;
      this.joyBase.style.opacity = '0';
    }
    if (this.look && e.pointerId === this.look.id) this.look = null;
  }

  _showJoy(x, y, dx, dy) {
    const b = this.joyBase, k = this.joyKnob, r = this.joyRadius;
    b.style.width = b.style.height = r * 2 + 'px';
    b.style.transform = `translate(${x - r}px, ${y - r}px)`;
    b.style.opacity = '1';
    k.style.transform = `translate(${r - 22 + dx}px, ${r - 22 + dy}px)`;
  }

  releaseAll() {
    this.joy = null; this.look = null;
    this.move.x = this.move.y = 0;
    this.keys.clear();
    if (this.joyBase) this.joyBase.style.opacity = '0';
  }

  update() {
    if (!this.joy) {
      const k = this.keys;
      let x = 0, y = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
      this.move.x = x; this.move.y = y;
    }
    this.run = this.runToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!this.enabled) { this.move.x = this.move.y = 0; }
  }
}
