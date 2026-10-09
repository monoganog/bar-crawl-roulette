const COLORS = ["#ff3d7f", "#ffb703", "#2ee6a6", "#4cc9f0", "#b388ff", "#ff7b39", "#f72585", "#90e0ef"];
const TAU = Math.PI * 2;

export class Wheel {
  private ctx: CanvasRenderingContext2D;
  private rotation = 0;
  private audio: AudioContext | null = null;
  /** Finishes the spin in progress immediately, if there is one. */
  private finishNow: (() => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private names: string[],
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.rotation = Math.random() * TAU;
    this.resize();
  }

  resize() {
    const size = this.canvas.clientWidth || 480;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /** Jump a spin in progress straight to where it would stop. */
  skip() {
    this.finishNow?.();
  }

  /** Spin and land on `winner` (an index into names). Resolves when it stops. */
  spin(winner: number, durationMs = 4500): Promise<void> {
    const n = this.names.length;
    const seg = TAU / n;
    // The pointer sits at the top. Segment i is under it when
    // (-rotation mod TAU) falls inside [i*seg, (i+1)*seg).
    const offset = (0.15 + Math.random() * 0.7) * seg;
    const target = mod(-(winner * seg + offset), TAU);
    const start = this.rotation;
    const delta = mod(target - mod(start, TAU), TAU) + TAU * (5 + Math.floor(Math.random() * 2));
    const t0 = performance.now();
    let lastSeg = this.segmentAtPointer();

    return new Promise((resolve) => {
      let done = false;
      // Don't wait for the next animation frame: snap and resolve right away.
      this.finishNow = () => {
        if (done) return;
        done = true;
        this.finishNow = null;
        this.rotation = start + delta;
        this.draw();
        resolve();
      };
      const frame = (now: number) => {
        if (done) return;
        const p = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - Math.pow(1 - p, 4);
        this.rotation = start + delta * eased;
        this.draw();
        const s = this.segmentAtPointer();
        if (s !== lastSeg) {
          lastSeg = s;
          this.tick();
        }
        if (p < 1) requestAnimationFrame(frame);
        else this.finishNow?.();
      };
      requestAnimationFrame(frame);
    });
  }

  private segmentAtPointer(): number {
    const n = this.names.length;
    return Math.floor(mod(-this.rotation, TAU) / (TAU / n)) % n;
  }

  private tick() {
    try {
      this.audio ??= new AudioContext();
      const a = this.audio;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.frequency.value = 1400;
      gain.gain.setValueAtTime(0.05, a.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.04);
      osc.connect(gain).connect(a.destination);
      osc.start();
      osc.stop(a.currentTime + 0.05);
    } catch {}
  }

  draw() {
    const ctx = this.ctx;
    const size = this.canvas.clientWidth || 480;
    const c = size / 2;
    const r = c - 14;
    const n = Math.max(1, this.names.length);
    const seg = TAU / n;
    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < n; i++) {
      const a0 = this.rotation + i * seg - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, r, a0, a0 + seg);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      // Avoid two neighbouring segments sharing a colour when wrapping round.
      if (n > 1 && i === n - 1 && (n - 1) % COLORS.length === 0) ctx.fillStyle = COLORS[3];
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#0d0b14";
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      const mid = mod(a0 + seg / 2, TAU);
      // Labels on the left half would read upside-down, so flip them.
      const flip = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.textAlign = flip ? "left" : "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#0d0b14";
      const label = this.names[i] ?? "";
      let fontSize = Math.min(34, r / 5.5);
      ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
      while (ctx.measureText(label).width > r * 0.72 && fontSize > 12) {
        fontSize -= 1;
        ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
      }
      ctx.fillText(label, flip ? -(r - 20) : r - 20, 0);
      ctx.restore();
    }

    // Hub
    ctx.beginPath();
    ctx.arc(c, c, r * 0.13, 0, TAU);
    ctx.fillStyle = "#0d0b14";
    ctx.fill();
    ctx.font = `${r * 0.14}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🍺", c, c + 2);

    // Pointer at the top
    ctx.beginPath();
    ctx.moveTo(c - 18, 2);
    ctx.lineTo(c + 18, 2);
    ctx.lineTo(c, 40);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#0d0b14";
    ctx.stroke();
  }
}

function mod(a: number, m: number) {
  return ((a % m) + m) % m;
}
