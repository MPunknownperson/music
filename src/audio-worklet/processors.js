/* AudioWorklet processors hosting Faust-compiled physical models. */

class FaustStringProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.meta = o.meta;
    this.max = o.voices || 12;
    this.voices = [];
    this.ready = false;
    this.shared = o.defaults || {};
    this.frame = 0;
    WebAssembly.compile(o.wasm).then((m) => {
      this.module = m;
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    });
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  alloc() {
    if (this.voices.length < this.max) {
      const v = {
        dsp: createFaustDsp(this.module, this.meta, sampleRate, 128),
        id: -1,
        used: false,
        pan: 0.5,
        level: 1,
        silent: 0,
        age: 0,
      };
      this.voices.push(v);
      return v;
    }
    // Steal the quietest voice.
    let best = this.voices[0];
    for (const v of this.voices) if (v.level < best.level) best = v;
    return best;
  }

  onMessage(m) {
    if (!this.ready && m.type !== "params") return;
    if (m.type === "on") {
      const v = this.alloc();
      v.dsp.clear();
      v.id = m.id;
      v.used = true;
      v.pan = m.pan === undefined ? 0.5 : m.pan;
      v.level = 1;
      v.silent = 0;
      v.age = ++this.frame;
      const d = v.dsp;
      d.set("freq", m.freq);
      d.set("gain", m.gain === undefined ? 0.8 : m.gain);
      for (const k in this.shared) d.set(k, this.shared[k]);
      if (m.params) for (const k in m.params) d.set(k, m.params[k]);
      d.set("gate", 1);
    } else if (m.type === "off") {
      for (const v of this.voices) if (v.used && v.id === m.id) v.dsp.set("gate", 0);
    } else if (m.type === "choke") {
      for (const v of this.voices) {
        if (!v.used) continue;
        if (m.id === undefined || v.id === m.id) {
          v.dsp.set("gate", 0);
          v.dsp.set("damping", 0.98);
        }
      }
    } else if (m.type === "set") {
      for (const v of this.voices) {
        if (v.used && v.id === m.id) for (const k in m.values) v.dsp.set(k, m.values[k]);
      }
    } else if (m.type === "params") {
      for (const k in m.values) {
        this.shared[k] = m.values[k];
        for (const v of this.voices) if (v.used) v.dsp.set(k, m.values[k]);
      }
    } else if (m.type === "allOff") {
      for (const v of this.voices) {
        v.used = false;
        v.id = -1;
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    L.fill(0);
    if (R !== L) R.fill(0);
    if (!this.ready) return true;
    for (const v of this.voices) {
      if (!v.used) continue;
      v.dsp.compute(128);
      const src = v.dsp.outs[0];
      const gl = Math.min(1, 2 * (1 - v.pan));
      const gr = Math.min(1, 2 * v.pan);
      let sum = 0;
      for (let i = 0; i < 128; i++) {
        const s = src[i];
        sum += s * s;
        L[i] += s * gl;
        R[i] += s * gr;
      }
      const rms = Math.sqrt(sum / 128);
      v.level = rms;
      if (rms < 0.00004) {
        if (++v.silent > 6) {
          v.used = false;
          const id = v.id;
          v.id = -1;
          this.port.postMessage({ type: "ended", id });
        }
      } else v.silent = 0;
    }
    return true;
  }
}

class FaustBodyProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.meta = o.meta;
    this.ready = false;
    this.pending = {};
    WebAssembly.compile(o.wasm).then((m) => {
      this.dsp = createFaustDsp(m, this.meta, sampleRate, 128);
      for (const k in this.pending) this.dsp.set(k, this.pending[k]);
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    });
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "params") {
        for (const k in m.values) {
          this.pending[k] = m.values[k];
          if (this.dsp) this.dsp.set(k, m.values[k]);
        }
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const input = inputs[0];
    if (!this.ready) {
      if (input && input[0]) {
        L.set(input[0]);
        R.set(input[1] || input[0]);
      } else {
        L.fill(0);
        if (R !== L) R.fill(0);
      }
      return true;
    }
    const d = this.dsp;
    if (input && input[0]) {
      d.ins[0].set(input[0]);
      d.ins[1].set(input[1] || input[0]);
    } else {
      d.ins[0].fill(0);
      d.ins[1].fill(0);
    }
    d.compute(128);
    L.set(d.outs[0]);
    R.set(d.outs[1]);
    return true;
  }
}

registerProcessor("faust-string", FaustStringProcessor);
registerProcessor("faust-voice", FaustStringProcessor);
registerProcessor("faust-body", FaustBodyProcessor);

/* Float32 PCM capture used for real-time WAV bounce of the live mix. */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "record") this.active = !!e.data.value;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (this.active && input && input[0]) {
      const l = new Float32Array(input[0]);
      const r = new Float32Array(input[1] || input[0]);
      this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    }
    // silent pass-through: an output keeps the node inside the render graph
    const out = outputs[0];
    if (out) for (let c = 0; c < out.length; c++) out[c].fill(0);
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorderProcessor);
