import puppeteer from "puppeteer";

const B = process.env.BASE ?? "https://3000-ie370qkzg26lbuoxonzqy.e2b.app";
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text().slice(0, 160));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const check = (n, ok, info = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${info ? " — " + info : ""}`);

// 1 — home page is playable
await page.goto(B + "/", { waitUntil: "networkidle2" });
await wait(600);
const heroKey = await page.evaluate(() => {
  const el = document.querySelector("[data-midi='64']");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height * 0.8 };
});
if (heroKey) {
  await page.mouse.move(heroKey.x, heroKey.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__fk && window.__fk.status().faust === "ready", { timeout: 30000 }).catch(() => {});
  await wait(900);
  const p = await page.evaluate(() => window.__fk.peakDb());
  await page.mouse.up();
  check("home: hero keyboard makes sound", p > -46, `${p.toFixed(1)} dB`);
} else check("home: hero keyboard present", false);
const heroLayout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
check("home: no overflow", heroLayout.sw <= heroLayout.cw + 1, `${heroLayout.sw}/${heroLayout.cw}`);

// 2 — voice management under a fast run
await page.goto(B + "/piano", { waitUntil: "networkidle2" });
await page.mouse.click(700, 400);
await page.waitForFunction(() => window.__fk && window.__fk.status().faust === "ready", { timeout: 30000 }).catch(() => {});
await wait(900);
const keys = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI"];
let during = 0;
for (let i = 0; i < 40; i++) {
  const k = keys[i % keys.length];
  await page.keyboard.down(k);
  await wait(22);
  await page.keyboard.up(k);
  during = Math.max(during, await page.evaluate(() => window.__fk.status().pianoVoices));
}
const focus = await page.evaluate(() => document.activeElement?.tagName + "/" + (document.activeElement?.type || ""));
await page.evaluate(() => window.__fk.allNotesOff());
await wait(1200);
const after = await page.evaluate(() => ({ v: window.__fk.status().pianoVoices, p: window.__fk.peakDb() }));
check("piano: polyphony stays bounded", during > 0 && during <= 32, `${during} voices during a 40-note run, focus ${focus}`);
check("piano: all notes off clears the pool", after.v === 0 && after.p < -55, `${after.v} voices, ${after.p.toFixed(1)} dB`);

// 3 — bounce (the WAV export path) really renders audio
const bounce = await page.evaluate(async () => {
  const e = window.__fk;
  const events = [];
  for (let i = 0; i < 8; i++) {
    events.push({ beat: i * 0.5, midi: [60 + [0, 4, 7, 12][i % 4]], dur: 0.5, vel: 0.8, inst: "piano", role: "melody" });
  }
  const buf = await e.bounce({ name: "test", bpm: 120, lengthBeats: 4, events }, 1);
  let peak = 0;
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return { seconds: buf.duration, peak, channels: buf.numberOfChannels };
});
check("piano: WAV bounce renders real audio", bounce.peak > 0.05 && bounce.seconds > 3, `${bounce.seconds.toFixed(1)}s, peak ${bounce.peak.toFixed(3)}, ${bounce.channels}ch`);

// 4 — preset A/B actually changes the rendered timbre
const ab = await page.evaluate(async () => {
  const e = window.__fk;
  const render = async () => {
    const buf = await e.bounce({ name: "ab", bpm: 120, lengthBeats: 2, events: [{ beat: 0, midi: [48], dur: 2, vel: 0.9, inst: "piano", role: "chord" }] }, 1);
    const d = buf.getChannelData(0);
    // zero-crossing rate over the attack = a direct proxy for brightness
    const n = Math.min(d.length, Math.floor(buf.sampleRate * 0.5));
    let z = 0, energy = 0;
    for (let i = 1; i < n; i++) {
      if ((d[i - 1] <= 0 && d[i] > 0) || (d[i - 1] > 0 && d[i] <= 0)) z++;
      energy += d[i] * d[i];
    }
    return (z / (n / buf.sampleRate)) * Math.sqrt(energy / n) * 100;
  };
  e.loadPianoPreset("felt");
  const felt = await render();
  e.loadPianoPreset("honky");
  const honky = await render();
  e.loadPianoPreset("concert");
  return { felt, honky };
});
check("piano: presets change the rendered timbre", Math.abs(ab.felt - ab.honky) / Math.max(ab.felt, ab.honky) > 0.08, `felt ${ab.felt.toFixed(2)} vs honky ${ab.honky.toFixed(2)}`);

// 5 — studio loop bounce through Howler
await page.goto(B + "/studio", { waitUntil: "networkidle2" });
await page.mouse.click(700, 300);
await wait(2200);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Compose idea")).click());
await wait(300);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("↻ Loop")).click());
await wait(16000);
const loopLabel = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).find((t) => t.includes("Loop")));
check("studio: seamless loop starts", loopLabel.includes("◼"), loopLabel);
const loopPeak = await page.evaluate(() => window.__fk.peakDb());
check("studio: loop is audible", loopPeak > -50, `${loopPeak.toFixed(1)} dB`);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("◼ Loop"))?.click());
await wait(900);

// 6 — mobile piano interaction with touch
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(B + "/piano", { waitUntil: "networkidle2" });
await page.waitForFunction(() => window.__fk && window.__fk.status().faust === "ready", { timeout: 30000 }).catch(() => {});
await wait(600);
const mk = await page.evaluate(() => {
  const el = document.querySelector("[data-midi='55']");
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height * 0.75 };
});
await page.touchscreen.tap(mk.x, mk.y);
await wait(1800);
const mp = await page.evaluate(() => window.__fk.peakDb());
check("mobile: touch plays the piano", mp > -60, `${mp.toFixed(1)} dB`);
const mob = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
check("mobile piano: no overflow", mob.sw <= mob.cw + 1, `${mob.sw}/${mob.cw}`);

console.log(out.join("\n"));
console.log("errors:", errors.length ? [...new Set(errors)].slice(0, 6) : "none");
await browser.close();
process.exit(out.some((r) => r.startsWith("FAIL")) ? 1 : 0);
