import puppeteer from "puppeteer";

const B = process.env.BASE ?? "https://3000-ie370qkzg26lbuoxonzqy.e2b.app";
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 180));
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 180)));

const peak = () => page.evaluate(() => window.__fk.peakDb());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${info ? " — " + info : ""}`);
  return ok;
};

// ---------------------------------------------------------------- piano lab
await page.goto(B + "/piano", { waitUntil: "networkidle2", timeout: 60000 });
await page.mouse.click(700, 400);
await page.waitForFunction(() => window.__fk && window.__fk.status().faust === "ready", { timeout: 30000 }).catch(() => {});
await wait(900);
let st = await page.evaluate(() => window.__fk.status());
check("piano: Faust WASM live", st.faust === "ready", JSON.stringify(st).slice(0, 130));

// play a chord from the computer keyboard, measure sound
await page.keyboard.down("KeyQ");
await page.keyboard.down("KeyE");
await page.keyboard.down("KeyG");
await wait(260);
let p1 = await peak();
check("piano: keyboard chord sounds", p1 > -46, `${p1.toFixed(1)} dB`);
let voices = await page.evaluate(() => window.__fk.status().pianoVoices);
check("piano: 3 modelled notes allocated", voices >= 3, `${voices} voices`);

// pedal holds the sound after key release
await page.keyboard.down("Space");
await wait(60);
await page.keyboard.up("KeyQ");
await page.keyboard.up("KeyE");
await page.keyboard.up("KeyG");
await wait(500);
const pedalPeak = await peak();
const pedalState = await page.evaluate(() => window.__fk.pedal);
check("piano: pedal sustains after release", pedalPeak > -60 && pedalState === 1, `${pedalPeak.toFixed(1)} dB, pedal ${pedalState}`);
await page.keyboard.up("Space");
await wait(900);
const afterPedal = await peak();
check("piano: damper silences on pedal up", afterPedal < pedalPeak - 6, `${afterPedal.toFixed(1)} dB`);

// velocity affects level
await page.evaluate(() => window.__fk.allNotesOff());
const strikeAt = async (depth) => {
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-midi='60']");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y, h: r.height };
  });
  await page.mouse.move(box.x, box.y + box.h * depth);
  await page.mouse.down();
  await wait(200);
  const v = await peak();
  await page.mouse.up();
  await wait(500);
  return v;
};
const soft = await strikeAt(0.15);
const hard = await strikeAt(0.95);
check("piano: strike depth changes dynamics", hard > soft + 2, `soft ${soft.toFixed(1)} / hard ${hard.toFixed(1)} dB`);

// preset switching + a live control
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.startsWith("Honky-tonk"));
  b.click();
});
await wait(300);
const honky = await page.evaluate(() => window.__fk.piano.unison);
check("piano: preset applies", honky > 3, `unison ${honky}`);

const sliderMoved = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label")];
  const l = labels.find((x) => x.textContent.includes("Hammer felt"));
  const input = l.querySelector("input[type=range]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "0.95");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return window.__fk.piano.hammer;
});
check("piano: workbench slider is live", sliderMoved > 0.9, `hammer ${sliderMoved}`);

// tuning readout responds
const tuned = await page.evaluate(() => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent.includes("Concert pitch"));
  const input = l.querySelector("input[type=range]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "432");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return window.__fk.piano.tuning;
});
check("piano: concert pitch control", tuned === 432, `A4 ${tuned}`);
await page.evaluate(() => window.__fk.loadPianoPreset("concert"));

// mute switch kills everything
await page.click('button[aria-label*="Mute" i]');
await page.keyboard.down("KeyQ");
await wait(220);
const muted = await peak();
await page.keyboard.up("KeyQ");
check("global mute silences the mix", muted < -70, `${muted.toFixed(1)} dB`);
await page.click('button[aria-label*="Unmute" i]');
await wait(200);

// overflow / layout
const layout = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
  canvas: !!document.querySelector("canvas"),
}));
check("desktop: no horizontal overflow", layout.sw <= layout.cw + 1, `${layout.sw}/${layout.cw}`);

// ---------------------------------------------------------------- guitar
await page.goto(B + "/guitar", { waitUntil: "networkidle2" });
await page.mouse.click(700, 300);
await wait(2500);
const zones = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div[style*="touch-action"]')).map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }),
);
if (zones.length >= 2) {
  const [neck, strum] = zones;
  await page.mouse.move(neck.x + neck.w * 0.3, neck.y + neck.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(neck.x + neck.w * 0.5, neck.y + neck.h * 0.2);
  await page.mouse.up();
  await page.mouse.move(strum.x + strum.w * 0.5, strum.y + 4);
  await page.mouse.down();
  let gp = -100;
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(strum.x + strum.w * 0.5, strum.y + (strum.h - 8) * (i / 16));
    await wait(16);
    gp = Math.max(gp, await peak());
  }
  await page.mouse.up();
  check("guitar: two-handed strum sounds", gp > -46, `${gp.toFixed(1)} dB`);
}

// ---------------------------------------------------------------- studio
await page.goto(B + "/studio", { waitUntil: "networkidle2" });
await page.mouse.click(700, 300);
await wait(2000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Compose idea"));
  b.click();
});
await wait(400);
const noteCount = await page.evaluate(() => document.querySelectorAll("input.field")[0]?.value);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "▶ Play");
  b.click();
});
await wait(1600);
const studioPeak = await peak();
check("studio: sequencer plays the composed song", studioPeak > -40, `${studioPeak.toFixed(1)} dB, song "${noteCount}"`);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("■ Stop"));
  b && b.click();
});
await wait(300);
const tools = await page.evaluate(() => ["Quantise", "Humanise", "Snap to key"].map((t) => !![...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)));
check("studio: musical tools present", tools.every(Boolean), tools.join(","));
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Humanise").click());
await wait(200);
const velBars = await page.evaluate(() => document.querySelectorAll('div[style*="cursor: ns-resize"], div.cursor-ns-resize > div').length);
check("studio: velocity lane rendered", velBars > 5, `${velBars} elements`);

// ---------------------------------------------------------------- mobile
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
for (const path of ["/piano", "/guitar", "/studio"]) {
  await page.goto(B + path, { waitUntil: "networkidle2" });
  await wait(900);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  check(`mobile ${path}: no overflow`, m.sw <= m.cw + 1, `${m.sw}/${m.cw}`);
}

console.log(results.join("\n"));
console.log("console errors:", errors.length ? [...new Set(errors)].slice(0, 8) : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
