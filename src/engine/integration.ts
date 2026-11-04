import type { MusicEngine } from "./music/audio";
import { makeArpLayer } from "./music/composer";
import type { ArenaEvent, ArenaGame } from "./game/arena";

/**
 * Wires a running arena game to the music engine (game → music):
 * - the low-pass expression follows the combo, so playing well opens up the sound;
 * - every 10-hit combo adds a generated arpeggio layer to the transport, aligned to the next bar;
 * - a miss closes the filter briefly;
 * - finishing the run restores neutral expression.
 *
 * Returns a disposer that unsubscribes and resets the expression.
 */
export function bridgeArenaToMusic(game: ArenaGame, audio: MusicEngine): () => void {
  const rules = game.rules;
  let layers = 0;

  const off = game.subscribe((e: ArenaEvent) => {
    switch (e.type) {
      case "hit": {
        audio.setExpression(Math.min(1, e.combo / 40));
        if (e.combo > 0 && e.combo % 10 === 0) {
          layers++;
          const seed = ((Date.now() ^ Math.imul(layers, 2654435761)) >>> 0) || layers;
          audio.addTrack(
            makeArpLayer({
              root: rules.root,
              scale: rules.scale,
              progression: rules.progression,
              bpm: rules.bpm,
              instrument: rules.instrument,
              seed,
              bars: 4,
            }),
            { loop: false },
          );
        }
        break;
      }
      case "miss":
        audio.setExpression(0.12);
        break;
      case "finish":
        audio.setExpression(0.5);
        break;
      default:
        break;
    }
  });

  return () => {
    off();
    audio.setExpression(1);
  };
}
