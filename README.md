# Fret & Key: music production and instrument studio

A browser music workstation built on Next.js (App Router), based on the original
`MPunknownperson/music` project and extended with a full music engine.

| Tool | What it does |
| --- | --- |
| **Piano workbench** (`/piano`) | A physically modelled grand: three coupled strings per note, hammer voicing, soundboard, half-pedal, sympathetic resonance, stretch tuning and 18 live controls. Live action cross-section, chord detection, take recording and "send to Studio". |
| **Guitar** (`/guitar`) | 15-fret board, 6 tunings, capo, chord library for every root and 9 qualities, diatonic quick chords, swipe strum pad, auto-strum rhythms, scale/interval overlay. |
| **Studio** (`/studio`) | Multi-track piano roll (melodic and drum tracks), live recording, step entry, generative composer, progression inserter, mute/solo/volume, swing, undo/redo, autosave library, MIDI/WAV/JSON export and JSON import. |
| **Theory lab** (`/theory`) | 12 scales and modes, harmonised triads and 7ths, circle of fifths, chord builder, interval reference and ear training. |
| **Rhythm arena** (`/arena`) | Adaptive rhythm game that charts generated music or your own Studio songs (tilt and shake on phones). |

## The piano model

`src/dsp/piano.dsp` is a Faust program compiled to WebAssembly. Per note it runs:

- a **nonlinear felt hammer** whose contact time shortens with velocity, so loud notes are brighter, not just louder;
- **three detuned strings** (digital waveguides with stiffness dispersion) **coupled at the bridge**, which produces the piano's two-stage decay — a prompt attack that settles into a beating aftersound;
- a **modal spruce soundboard** whose coupling falls off in the treble, plus lid filtering and key-off damper noise.

The loop filters add a few samples of delay that would flatten every note, so
`npm run calibrate` measures the real fundamental of all 88 keys at four hammer
settings and writes `public/faust/piano-tuning.json`. The engine interpolates that
table per note, keeping the instrument within **3 cents** across the keyboard.
`npm run test:audio` renders the models headlessly and asserts pitch, velocity
brightness, decay and damper behaviour.

Performance settings live in `src/engine/audio/piano.ts`: Railsback stretch tuning,
A4 reference, an action velocity curve with a pp–fff dynamic window, damper times
that lengthen in the bass, and the keyboard's stereo image.

## Music engine (`src/engine/music`)

- `audio/piano.ts`, `audio/resonance.ts`: piano voicing, tuning and sympathetic string resonance.
- `audio/daw.ts`: channel strips, sends, EQ, drive, mid/side width, glue compression, limiter, post-fader metering.
- `audio.ts`: Web Audio synthesis: additive piano (inharmonic partials, velocity brightness, damper),
  FM electric piano, Karplus–Strong guitar and bass, saw lead and string pad, drum kit. Includes a look-ahead
  transport, live track replacement, sustain pedal, metronome, analyser and offline rendering.
- `theory.ts`: scales, modes, chord qualities, roman numerals, intervals, circle of fifths.
- `guitar.ts`: tunings, open-chord dictionary and a voicing search that works with any tuning.
- `composer.ts`: seeded generative composer (melody, chords, bass, drums).

## Input devices

- **Touch**: multi-touch, glissando, swipe strumming.
- **Computer keyboard**: DAW-style two-row layout (`Z…/` and `Q…]`), using `KeyboardEvent.code` so it is
  layout-independent. Every page lists its shortcuts.
- **Gamepad** (Standard mapping): face buttons and shoulders play notes or chords, triggers set velocity and
  strum, the right stick flick-strums, and the D-pad drives the Studio cursor.

## Storage

There is **no database**. Songs, settings and arena history are stored in the browser's
`localStorage`, so the app is stateless and runs on Cloudflare's edge.

## Development

```bash
npm install
npm run dev         # http://localhost:3000
npm run build       # Node production build
npm run test:audio  # render the Faust models and assert pitch/decay/damping
npm run faust       # recompile src/dsp/*.dsp to public/faust/*.wasm
npm run calibrate   # re-measure the 88-key piano tuning table
npm run soundfonts  # re-vendor the WebAudioFont presets
```

`scripts/browser-test.mjs` and `scripts/browser-deep.mjs` drive the real UI in
headless Chrome (they need `npm i -D puppeteer`, which is not installed by default
because it downloads a browser). They cover sound output, pedal behaviour,
dynamics, presets, WAV bounce, the Howler loop, polyphony, touch and mobile layout.

## Deploy to Cloudflare (Workers / Pages)

Deployment uses the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare) and `wrangler.jsonc`.

```bash
npx wrangler login
npm run preview    # build with OpenNext and run locally in workerd
npm run deploy     # build and deploy to Cloudflare
```

For Git-connected builds (Workers Builds, or the Cloudflare dashboard "Pages"-style flow):

- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx opennextjs-cloudflare deploy` (or `npx wrangler deploy`)
- Node version: 20 or newer

The health check is at `/api/health`.
