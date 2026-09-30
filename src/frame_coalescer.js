// Coalesce repeated high-frequency work into at most one callback per frame.
// Falls back to a short timer outside browsers and supports explicit cancel.
export class FrameCoalescer {
  constructor(env = globalThis) {
    this.env = env;
    this._handle = null;
    this._kind = null;
  }

  get pending() {
    return this._handle !== null;
  }

  schedule(task) {
    if (this.pending) return false;
    if (typeof task !== "function") return false;

    const run = () => {
      this._handle = null;
      this._kind = null;
      task();
    };

    if (typeof this.env?.requestAnimationFrame === "function") {
      this._kind = "raf";
      this._handle = this.env.requestAnimationFrame(run);
    } else if (typeof this.env?.setTimeout === "function") {
      this._kind = "timeout";
      this._handle = this.env.setTimeout(run, 16);
    } else {
      // Extremely small non-browser test hosts may have neither primitive.
      task();
      return true;
    }
    return true;
  }

  cancel() {
    if (!this.pending) return false;
    const handle = this._handle;
    const kind = this._kind;
    this._handle = null;
    this._kind = null;

    if (kind === "raf" && typeof this.env?.cancelAnimationFrame === "function") {
      this.env.cancelAnimationFrame(handle);
    } else if (typeof this.env?.clearTimeout === "function") {
      this.env.clearTimeout(handle);
    }
    return true;
  }
}
