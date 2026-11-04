import Link from "next/link";
import RecentSongs from "@/components/ui/RecentSongs";
import HeroInstrument from "@/components/ui/HeroInstrument";

const TOOLS = [
  {
    href: "/piano",
    title: "Piano",
    body: "A modelled grand: three coupled strings per note, hammer voicing, half-pedal, stretch tuning and 18 live controls.",
    color: "bg-ivory text-ebony",
    accent: "bg-ebony",
  },
  {
    href: "/guitar",
    title: "Guitar",
    body: "Two-handed performance: fret with one hand while the other strums. Six independent WASM strings, six tunings, capo and amp.",
    color: "bg-[#c98a4b] text-ebony",
    accent: "bg-[#3a2418]",
  },
  {
    href: "/studio",
    title: "Studio",
    body: "Multi-track piano roll, 130+ patches per track, live and step recording, seamless loop bounce, MIDI and WAV export.",
    color: "bg-sun text-ebony",
    accent: "bg-ebony",
  },
  {
    href: "/theory",
    title: "Theory lab",
    body: "Twelve scales and modes, harmonised chords, circle of fifths, chord builder and ear training.",
    color: "bg-teal text-ebony",
    accent: "bg-ebony",
  },
  {
    href: "/arena",
    title: "Rhythm arena",
    body: "Play your own songs as a rhythm game. The rules adapt to your timing, and motion controls work on phones.",
    color: "bg-violet text-ebony",
    accent: "bg-ebony",
  },
];

const INPUTS = [
  { k: "Touch", d: "Multi-touch chords, glissando slides and swipe-strumming tuned for phones and tablets." },
  { k: "Computer keyboard", d: "A two-row DAW layout (Z–/ and Q–]) that works on any keyboard layout, plus shortcuts for every tool." },
  { k: "Game controller", d: "Face buttons play scale degrees or chords, triggers set velocity and strum, and the D-pad edits the piano roll." },
];

export default function HomePage() {
  return (
    <div className="space-y-10 py-2">
      <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="label text-sun">Physical modelling · SoundFonts · Web Audio DAW</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Play it. Write it.
            <br />
            <span className="text-sun">Hear it now.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
            A full music workstation in the browser: recorded SoundFont instruments, Faust physical models running as
            WebAssembly, and a proper mixing desk. Play with both hands on touch, a computer keyboard or a game controller.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/studio" className="btn btn-sun px-6 py-3 text-base">
              Open the studio
            </Link>
            <Link href="/piano" className="btn px-6 py-3 text-base">
              Play piano
            </Link>
            <Link href="/guitar" className="btn px-6 py-3 text-base">
              Play guitar
            </Link>
          </div>
        </div>
        <HeroInstrument />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className={`group flex flex-col justify-between rounded-2xl p-5 transition hover:-translate-y-0.5 ${t.color}`}>
            <div>
              <span className={`mb-4 block h-1.5 w-10 rounded-full ${t.accent}`} />
              <h2 className="text-xl font-bold">{t.title}</h2>
              <p className="mt-2 text-sm opacity-80">{t.body}</p>
            </div>
            <span className="mt-5 text-sm font-bold">Open →</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {INPUTS.map((i) => (
          <div key={i.k} className="panel p-5">
            <p className="label">Input</p>
            <h3 className="mt-1 text-lg font-bold">{i.k}</h3>
            <p className="mt-2 text-sm text-muted">{i.d}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="panel p-5">
          <p className="label">Inside the music engine</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><b className="text-ivory">The piano:</b> a Faust waveguide with three detuned strings coupled at the bridge, so notes bloom then settle into a beating aftersound. Every one of the 88 keys is individually calibrated to within 3 cents.</li>
            <li><b className="text-ivory">Sampled instruments:</b> WebAudioFont SoundFonts load straight into the audio graph — a recorded grand piano, Rhodes, nylon and steel guitars, upright bass, strings, brass and more, with the rest of the GM library streamed on demand.</li>
            <li><b className="text-ivory">Physical modelling:</b> Faust DSP compiled to WebAssembly runs a dispersive string waveguide with a modal soundboard in an AudioWorklet. Pick position, stiffness, damping and body resonance are live parameters, not samples.</li>
            <li><b className="text-ivory">Every platform:</b> Howler owns the audio context and the iOS/Android unlock, so one switch mutes everything and loops stay seamless and click-free.</li>
            <li><b className="text-ivory">The desk:</b> channel strips, convolution room, body send, tape-style drive, chorus, delay, mid/side width, glue compression and a limiter — then loudness-normalised bounces at −14 LUFS.</li>
          </ul>
        </div>
        <RecentSongs />
      </section>
    </div>
  );
}
