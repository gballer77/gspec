// Environment checks a long unattended build is sensitive to — pure parsers,
// with the probing left to the driver.
//
// A measured build spent hours at three to four minutes per engine turn.
// The transcripts carried 51 "system suspend; aborting to retry on a fresh
// connection" events: the Mac's idle sleep was set to one minute, and the
// build stalled every time the screen went dark. Nothing in the run said so.

// Idle-sleep minutes from `pmset -g` output, or null when it cannot be read.
// `0` means never.
export function parseSleepMinutes(pmsetText) {
  const m = String(pmsetText || '').match(/^\s*sleep\s+(\d+)/m);
  return m ? Number(m[1]) : null;
}

// True when idle sleep is on and short enough to interrupt a build between turns.
export function sleepTooShort(minutes, threshold = 10) {
  return Number.isInteger(minutes) && minutes > 0 && minutes < threshold;
}
