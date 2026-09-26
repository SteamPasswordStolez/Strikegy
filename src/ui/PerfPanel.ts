import type * as THREE from 'three';

const HISTORY = 240;
/** Frame intervals above this missed a 60 Hz refresh. */
const MISS_MS = 20;

export interface FrameTimings {
  /** Interval since the previous frame (what the player feels). */
  frameMs: number;
  /** CPU time spent in the fixed-step simulation. */
  simMs: number;
  /** CPU time spent on per-frame updates (camera, effects, HUD). */
  updateMs: number;
  /** CPU time spent issuing draw calls. */
  renderMs: number;
}

/**
 * F3 performance panel: frame-time graph, 1% lows, missed frames, CPU split,
 * GPU time (timer queries, when the driver exposes them), draw stats and the
 * GPU in use. Helps find where drops come from on the player's own machine.
 */
export class PerfPanel {
  readonly root: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frames = new Float32Array(HISTORY);
  private head = 0;
  private sums = { sim: 0, update: 0, render: 0, gpu: 0, gpuN: 0, n: 0 };
  private textTimer = 0;
  private shadowUpdates = 0;
  private visible = false;

  private readonly gl2: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(
    parent: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly gpu: string,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'perf-panel';
    this.canvas = document.createElement('canvas');
    this.canvas.width = HISTORY;
    this.canvas.height = 60;
    this.ctx = this.canvas.getContext('2d')!;
    this.text = document.createElement('pre');
    this.root.append(this.canvas, this.text);
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.gl2 = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl2.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
    // Totals per frame (several passes each reset the counters otherwise).
    this.renderer.info.autoReset = !v;
  }

  /** Wraps the frame's draw submission in a GPU timer query. */
  beginGpu(): void {
    if (!this.visible || !this.timer || this.active || this.pending.length > 4) return;
    this.active = this.gl2.createQuery();
    if (this.active) this.gl2.beginQuery(this.timer.TIME_ELAPSED_EXT, this.active);
  }

  endGpu(): void {
    if (!this.active || !this.timer) return;
    this.gl2.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  onShadowUpdate(): void {
    this.shadowUpdates++;
  }

  record(t: FrameTimings, label: string): void {
    this.frames[this.head] = t.frameMs;
    this.head = (this.head + 1) % HISTORY;
    if (!this.visible) return;
    const s = this.sums;
    s.sim += t.simMs;
    s.update += t.updateMs;
    s.render += t.renderMs;
    s.n++;
    this.collectGpu();
    this.drawGraph();
    this.textTimer += t.frameMs / 1000;
    if (this.textTimer >= 0.5) {
      this.writeText(label);
      this.textTimer = 0;
    }
    this.renderer.info.reset();
  }

  private collectGpu(): void {
    if (!this.timer) return;
    const gl = this.gl2;
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      this.pending.shift();
      if (!disjoint) {
        this.sums.gpu += ns / 1e6;
        this.sums.gpuN++;
      }
    }
  }

  private drawGraph(): void {
    const c = this.ctx;
    const H = this.canvas.height;
    const scale = H / 50; // 50 ms full height
    c.clearRect(0, 0, HISTORY, H);
    for (let i = 0; i < HISTORY; i++) {
      const ms = this.frames[(this.head + i) % HISTORY]!;
      c.fillStyle = ms > 33.4 ? '#ff5a4a' : ms > MISS_MS ? '#ffc34a' : '#6fdc7f';
      const h = Math.min(H, ms * scale);
      c.fillRect(i, H - h, 1, h);
    }
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(0, H - 16.7 * scale, HISTORY, 1);
    c.fillRect(0, H - 33.3 * scale, HISTORY, 1);
  }

  private writeText(label: string): void {
    const sorted = Array.from(this.frames).filter((v) => v > 0).sort((a, b) => a - b);
    const n = sorted.length || 1;
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))] ?? 0;
    const worst = sorted[n - 1] ?? 0;
    const missed = sorted.filter((v) => v > MISS_MS).length;
    const s = this.sums;
    const k = Math.max(1, s.n);
    const info = this.renderer.info;
    const gpuMs = s.gpuN ? (s.gpu / s.gpuN).toFixed(1) : this.timer ? '…' : 'n/a';
    this.text.textContent = [
      `${label}`,
      `${(1000 / avg).toFixed(0)} fps · 1% low ${(1000 / p99).toFixed(0)} · worst ${worst.toFixed(0)} ms`,
      `missed frames (>${MISS_MS} ms): ${missed} / ${HISTORY}`,
      `CPU sim ${(s.sim / k).toFixed(2)} · update ${(s.update / k).toFixed(2)} · draw ${(s.render / k).toFixed(2)} ms`,
      `GPU ${gpuMs} ms · calls ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `shadow redraws ${this.shadowUpdates} /0.5s`,
      this.gpu,
    ].join('\n');
    this.sums = { sim: 0, update: 0, render: 0, gpu: 0, gpuN: 0, n: 0 };
    this.shadowUpdates = 0;
  }
}
