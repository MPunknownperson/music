/* Minimal Faust WASM runtime: memory layout + DSP interface.
 * Shared by the AudioWorklet build and the Node test harness.
 * Layout follows grame-cncm/faustwasm (FaustWasmInstantiator). */
function faustWasmImport(memory) {
  const rem = (x, y) => x - Math.round(x / y) * y;
  const cps = (x, y) => (Math.sign(x) === Math.sign(y) ? x : -x);
  const f = {
    _acosf: Math.acos, _asinf: Math.asin, _atanf: Math.atan, _atan2f: Math.atan2,
    _ceilf: Math.ceil, _cosf: Math.cos, _expf: Math.exp, _floorf: Math.floor,
    _fmodf: (x, y) => x % y, _logf: Math.log, _log10f: Math.log10,
    _max_f: Math.max, _min_f: Math.min, _remainderf: rem, _powf: Math.pow,
    _roundf: Math.round, _sinf: Math.sin, _sqrtf: Math.sqrt, _tanf: Math.tan,
    _acoshf: Math.acosh, _asinhf: Math.asinh, _atanhf: Math.atanh, _coshf: Math.cosh,
    _sinhf: Math.sinh, _tanhf: Math.tanh, _isnanf: Number.isNaN,
    _isinff: (x) => !isFinite(x), _copysignf: cps,
    _acos: Math.acos, _asin: Math.asin, _atan: Math.atan, _atan2: Math.atan2,
    _ceil: Math.ceil, _cos: Math.cos, _exp: Math.exp, _floor: Math.floor,
    _fmod: (x, y) => x % y, _log: Math.log, _log10: Math.log10,
    _max_: Math.max, _min_: Math.min, _remainder: rem, _pow: Math.pow,
    _round: Math.round, _sin: Math.sin, _sqrt: Math.sqrt, _tan: Math.tan,
    _acosh: Math.acosh, _asinh: Math.asinh, _atanh: Math.atanh, _cosh: Math.cosh,
    _sinh: Math.sinh, _tanh: Math.tanh, _isnan: Number.isNaN,
    _isinf: (x) => !isFinite(x), _copysign: cps,
  };
  return {
    env: Object.assign(
      { memory, memoryBase: 0, tableBase: 0, _abs: Math.abs, table: new WebAssembly.Table({ initial: 0, element: "anyfunc" }) },
      f,
    ),
  };
}

function faustParamTable(meta) {
  const table = {};
  const walk = (items) => {
    for (const it of items || []) {
      if (it.items) walk(it.items);
      else if (typeof it.index === "number") {
        const key = it.shortname || it.label || it.address;
        table[key] = it.index;
        if (it.address) table[it.address] = it.index;
      }
    }
  };
  walk(meta.ui);
  return table;
}

function createFaustDsp(module, meta, sampleRate, bufferSize) {
  const sampleSize = /-double/.test(meta.compile_options || "") ? 8 : 4;
  const shift = sampleSize === 4 ? 2 : 3;
  const ptrSize = 4;
  const nIn = meta.inputs;
  const nOut = meta.outputs;
  const need = meta.size + (nIn + nOut) * (ptrSize + bufferSize * sampleSize);
  const pages = Math.max(2, Math.ceil((need * 2) / 65536));
  const imported = new WebAssembly.Memory({ initial: pages });
  const instance = new WebAssembly.Instance(module, faustWasmImport(imported));
  const ex = instance.exports;
  // faust2wasm modules export their own memory instead of importing one.
  const memory = ex.memory || imported;
  const required = meta.size + (nIn + nOut) * (ptrSize + bufferSize * sampleSize) + 4096;
  if (memory.buffer.byteLength < required) {
    memory.grow(Math.ceil((required - memory.buffer.byteLength) / 65536));
  }

  const inPtrArray = meta.size;
  const outPtrArray = inPtrArray + nIn * ptrSize;
  const inBase = outPtrArray + nOut * ptrSize;
  const outBase = inBase + nIn * bufferSize * sampleSize;

  let heap32 = new Int32Array(memory.buffer);
  let heapF = sampleSize === 4 ? new Float32Array(memory.buffer) : new Float64Array(memory.buffer);
  const ins = [];
  const outs = [];
  for (let c = 0; c < nIn; c++) {
    const p = inBase + c * bufferSize * sampleSize;
    heap32[(inPtrArray >> 2) + c] = p;
    ins.push(heapF.subarray(p >> shift, (p + bufferSize * sampleSize) >> shift));
  }
  for (let c = 0; c < nOut; c++) {
    const p = outBase + c * bufferSize * sampleSize;
    heap32[(outPtrArray >> 2) + c] = p;
    outs.push(heapF.subarray(p >> shift, (p + bufferSize * sampleSize) >> shift));
  }

  const DSP = 0;
  ex.init(DSP, sampleRate);
  const params = faustParamTable(meta);

  const refresh = () => {
    if (memory.buffer === heap32.buffer) return;
    heap32 = new Int32Array(memory.buffer);
    heapF = sampleSize === 4 ? new Float32Array(memory.buffer) : new Float64Array(memory.buffer);
    for (let c = 0; c < nIn; c++) {
      const p = heap32[(inPtrArray >> 2) + c];
      ins[c] = heapF.subarray(p >> shift, (p + bufferSize * sampleSize) >> shift);
    }
    for (let c = 0; c < nOut; c++) {
      const p = heap32[(outPtrArray >> 2) + c];
      outs[c] = heapF.subarray(p >> shift, (p + bufferSize * sampleSize) >> shift);
    }
  };

  return {
    ins,
    outs,
    params,
    set(name, value) {
      const idx = params[name];
      if (idx !== undefined) ex.setParamValue(DSP, idx, value);
    },
    get(name) {
      const idx = params[name];
      return idx === undefined ? 0 : ex.getParamValue(DSP, idx);
    },
    clear() {
      ex.instanceClear(DSP);
      ex.instanceResetUserInterface(DSP);
      ex.instanceInit(DSP, sampleRate);
    },
    compute(count) {
      ex.compute(DSP, count === undefined ? bufferSize : count, inPtrArray, outPtrArray);
      refresh();
    },
  };
}
