#!/usr/bin/env node
/**
 * Compiles the Faust physical models in src/dsp to WebAssembly.
 * Output: public/faust/<name>.wasm + <name>.json (DSP metadata / UI description).
 * The generic AudioWorklet in public/worklets/faust-processor.js loads them.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import faust2wasmFiles from "@grame/faustwasm/src/faust2wasmFiles.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "dsp");
const outDir = path.join(root, "public", "faust");

await mkdir(outDir, { recursive: true });
const files = (await readdir(srcDir)).filter((f) => f.endsWith(".dsp"));

for (const file of files) {
  const name = file.replace(/\.dsp$/, "");
  const tmp = path.join(outDir, `_tmp_${name}`);
  process.stdout.write(`faust → wasm: ${name} … `);
  await faust2wasmFiles(path.join(srcDir, file), tmp, ["-ftz", "2"], false);
  const { readFile, rename, rm } = await import("node:fs/promises");
  const wasm = await readFile(path.join(tmp, "dsp-module.wasm"));
  const meta = JSON.parse(await readFile(path.join(tmp, "dsp-meta.json"), "utf8"));
  await writeFile(path.join(outDir, `${name}.wasm`), wasm);
  await writeFile(
    path.join(outDir, `${name}.json`),
    JSON.stringify({
      name: meta.name,
      inputs: meta.inputs,
      outputs: meta.outputs,
      size: meta.size,
      compile_options: meta.compile_options,
      ui: meta.ui,
    }),
  );
  await rm(tmp, { recursive: true, force: true });
  console.log(`${(wasm.length / 1024).toFixed(1)} kB, ${meta.inputs}→${meta.outputs}`);
}
// Bundle the shared Faust runtime + the AudioWorklet processors into one file
// (AudioWorkletGlobalScope cannot use ES module imports).
const { readFile } = await import("node:fs/promises");
const core = await readFile(path.join(root, "src", "audio-worklet", "faust-dsp.js"), "utf8");
const procs = await readFile(path.join(root, "src", "audio-worklet", "processors.js"), "utf8");
await mkdir(path.join(root, "public", "worklets"), { recursive: true });
await writeFile(path.join(root, "public", "worklets", "faust-processor.js"), `${core}\n${procs}`);
// Same runtime as an ES module so the Node test harness can render audio with it.
await writeFile(path.join(root, "scripts", "dsp-core.generated.mjs"), `${core}\nexport { createFaustDsp };\n`);
console.log("Faust models built.");
