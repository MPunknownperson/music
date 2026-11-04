/**
 * Sympathetic string resonance.
 *
 * With the damper pedal down every undamped string is free to vibrate. A bank
 * of narrow band-passes tuned to the open strings is fed from the piano bus,
 * so played notes excite the strings that are holding still — the halo you
 * hear on a real instrument when the pedal is down.
 */
export class SympatheticResonance {
  readonly input: GainNode;
  readonly output: GainNode;
  private filters: BiquadFilterNode[] = [];
  private gains: GainNode[] = [];
  private amount = 0;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, voices = 12) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    for (let i = 0; i < voices; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 22;
      bp.frequency.value = 220 * (i + 1);
      const g = ctx.createGain();
      g.gain.value = 0;
      this.input.connect(bp);
      bp.connect(g);
      g.connect(this.output);
      this.filters.push(bp);
      this.gains.push(g);
    }
  }

  /** Tunes the bank to the fundamentals (and first partials) of open strings. */
  setNotes(freqs: number[]) {
    const t = this.ctx.currentTime;
    const list: number[] = [];
    for (const f of freqs) {
      if (f > 30 && f < 4200) list.push(f);
      if (f * 2 < 4200) list.push(f * 2);
    }
    const chosen = list.slice(0, this.filters.length);
    this.filters.forEach((bp, i) => {
      const f = chosen[i];
      if (f) {
        bp.frequency.setTargetAtTime(f, t, 0.02);
        // higher strings radiate less energy back into the room
        this.gains[i].gain.setTargetAtTime(0.55 / (1 + i * 0.35), t, 0.04);
      } else {
        this.gains[i].gain.setTargetAtTime(0, t, 0.05);
      }
    });
  }

  setAmount(v: number) {
    this.amount = Math.max(0, Math.min(1, v));
    this.output.gain.setTargetAtTime(this.amount * 0.5, this.ctx.currentTime, 0.08);
  }

  get level(): number {
    return this.amount;
  }
}
