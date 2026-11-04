"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getEngine } from "@/engine/music/audio";
import { onContextStatus } from "@/engine/audio/context";

const I = {
  home: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z" />
    </svg>
  ),
  piano: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M3 4h18v16H3zM5 6v12h2.5v-5H7V6zm4 0v7h-.5v5h3v-5H11V6zm4 0v7h-.5v5h3v-5H15V6zm4 0v7h-.5v5H19V6z" />
    </svg>
  ),
  guitar: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="m20.5 2-3 3 .7.7-4.6 4.6a4.5 4.5 0 0 0-5.3.6 3 3 0 0 0-.8 1.6c-.1.7-.6 1.2-1.3 1.3-1 .1-1.9.6-2.6 1.3a3.6 3.6 0 0 0 5.1 5.1c.7-.7 1.2-1.6 1.3-2.6.1-.7.6-1.2 1.3-1.3a3 3 0 0 0 1.6-.8 4.5 4.5 0 0 0 .6-5.3l4.6-4.6.7.7 3-3zM9.5 16a1.5 1.5 0 1 1-2.1-2.1A1.5 1.5 0 0 1 9.5 16" />
    </svg>
  ),
  studio: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M3 4h4v4H3zm6 0h4v4H9zm6 0h6v4h-6zM3 10h8v4H3zm10 0h4v4h-4zM3 16h4v4H3zm6 0h12v4H9z" />
    </svg>
  ),
  theory: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m-6 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m12 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m-6 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3" />
    </svg>
  ),
  arena: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M7 6h10a5 5 0 0 1 4.9 6l-1 5a2.5 2.5 0 0 1-4.3 1.2L14 16h-4l-2.6 2.2A2.5 2.5 0 0 1 3.1 17l-1-5A5 5 0 0 1 7 6m1 3v2H6v2h2v2h2v-2h2v-2h-2V9zm8 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2m2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
    </svg>
  ),
};

const ITEMS: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/", label: "Home", icon: I.home },
  { href: "/piano", label: "Piano", icon: I.piano },
  { href: "/guitar", label: "Guitar", icon: I.guitar },
  { href: "/studio", label: "Studio", icon: I.studio },
  { href: "/theory", label: "Theory", icon: I.theory },
  { href: "/arena", label: "Arena", icon: I.arena },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-8 w-8 grid-cols-3 overflow-hidden rounded-lg bg-ivory p-[3px] gap-[2px]">
        <span className="rounded-[2px] bg-sun" />
        <span className="rounded-[2px] bg-ebony" />
        <span className="rounded-[2px] bg-teal" />
      </span>
      <span className="text-base font-bold tracking-tight">
        Fret<span className="text-sun">&amp;</span>Key
      </span>
    </span>
  );
}

function SoundSwitch() {
  const engine = getEngine();
  const [state, setState] = useState<"idle" | "on" | "muted">("idle");
  useEffect(() => {
    const sync = () => setState(engine.muted ? "muted" : engine.context?.state === "running" ? "on" : "idle");
    sync();
    const offEngine = engine.onStatus(sync);
    const offCtx = onContextStatus(sync);
    return () => {
      offEngine();
      offCtx();
    };
  }, [engine]);
  const click = () => {
    if (state === "idle") {
      void engine.ensure().then(() => {
        engine.setMuted(false);
        setState("on");
      });
      return;
    }
    const next = state === "on";
    engine.setMuted(next);
    setState(next ? "muted" : "on");
  };
  return (
    <button
      onClick={click}
      aria-label={state === "muted" ? "Unmute all sound" : "Mute all sound"}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold transition ${
        state === "muted" ? "bg-rose text-ebony" : state === "on" ? "bg-teal text-ebony" : "bg-panel2 text-ivory"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4" />
        {state === "muted" && <path d="M2 3l19 19-1.4 1.4L.6 4.4z" />}
      </svg>
      <span className="hidden sm:inline">{state === "muted" ? "Muted" : state === "on" ? "Sound on" : "Enable sound"}</span>
    </button>
  );
}

export default function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/" aria-label="Home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {ITEMS.slice(1).map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active(it.href) ? "bg-sun text-ebony" : "text-muted hover:bg-panel2 hover:text-ivory"
                }`}
              >
                {it.icon}
                {it.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted xl:block">Keyboard · Touch · Gamepad</span>
            <SoundSwitch />
          </div>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-6">
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                active(it.href) ? "text-sun" : "text-muted"
              }`}
            >
              {it.icon}
              {it.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
