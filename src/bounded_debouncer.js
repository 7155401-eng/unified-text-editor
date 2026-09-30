export class BoundedDebouncer {
  constructor(callback, {
    delayMs,
    maxWaitMs,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (typeof callback !== 'function') {
      throw new TypeError('BoundedDebouncer requires a callback');
    }
    this.callback = callback;
    this.delayMs = Math.max(0, Number(delayMs) || 0);
    this.maxWaitMs = Math.max(this.delayMs, Number(maxWaitMs) || this.delayMs);
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.delayTimer = null;
    this.maxTimer = null;
  }

  get pending() {
    return this.delayTimer !== null || this.maxTimer !== null;
  }

  schedule() {
    if (this.delayTimer !== null) {
      this.clearTimer(this.delayTimer);
    }

    this.delayTimer = this.setTimer(() => this._fire(), this.delayMs);

    // The deadline is deliberately non-sliding. Continuous schedule() calls
    // replace only the short debounce timer, never this first-edit deadline.
    if (this.maxTimer === null) {
      this.maxTimer = this.setTimer(() => this._fire(), this.maxWaitMs);
    }
  }

  flush() {
    if (!this.pending) return false;
    this._fire();
    return true;
  }

  cancel() {
    if (this.delayTimer !== null) {
      this.clearTimer(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.maxTimer !== null) {
      this.clearTimer(this.maxTimer);
      this.maxTimer = null;
    }
  }

  _fire() {
    if (!this.pending) return;
    // Clear both before callback execution. If the callback itself schedules
    // new work, that must start a fresh debounce/deadline window.
    this.cancel();
    this.callback();
  }
}
