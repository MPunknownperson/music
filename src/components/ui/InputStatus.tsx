"use client";

export default function InputStatus({ gamepad }: { gamepad: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 rounded-full bg-panel2 px-2.5 py-1 text-muted">
        <span className="h-2 w-2 rounded-full bg-teal" /> Keyboard
      </span>
      <span
        className="flex max-w-[220px] items-center gap-1.5 truncate rounded-full bg-panel2 px-2.5 py-1 text-muted"
        title={gamepad ?? "Press any button on a controller to connect"}
      >
        <span className={`h-2 w-2 flex-none rounded-full ${gamepad ? "bg-teal" : "bg-line"}`} />
        {gamepad ? `Gamepad: ${gamepad.split("(")[0].trim() || "connected"}` : "No gamepad — press any button"}
      </span>
    </div>
  );
}
