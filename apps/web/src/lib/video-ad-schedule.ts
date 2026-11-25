import type { VideoAdSlot } from "./video-ads";

/** A played/consumed ad break: pre/post roll once per video, each mid-roll cue on its own. */
export type AdBreakKey = VideoAdSlot | `MID_ROLL@${number}`;

export function midRollBreakKey(cueSec: number): AdBreakKey {
  return `MID_ROLL@${cueSec}`;
}

/**
 * The mid-roll to play now, if any. When playback reaches or jumps past several unplayed cues
 * (a forward seek), only the latest one plays: viewers get one break, never a backlog.
 */
export function dueMidRollCue(
  cuesSec: readonly number[],
  currentTimeSec: number,
  played: (cueSec: number) => boolean,
): number | null {
  let due: number | null = null;
  for (const cue of cuesSec) {
    if (cue > currentTimeSec) break;
    if (!played(cue)) due = cue;
  }
  return due;
}

/** Cues already behind the starting position of resumed playback are not owed to the viewer. */
export function cuesBefore(cuesSec: readonly number[], positionSec: number): number[] {
  return cuesSec.filter((cue) => cue <= positionSec);
}

/** Older decisions carry only an interval; treat it as a single cue like before. */
export function decisionMidRollCues(decision: {
  midRollEnabled: boolean;
  midRollEverySec: number;
  midRollCuePoints?: number[] | undefined;
}): number[] {
  if (!decision.midRollEnabled) return [];
  const cues = decision.midRollCuePoints ?? [decision.midRollEverySec];
  return [...cues].filter((cue) => Number.isFinite(cue) && cue > 0).sort((a, b) => a - b);
}
