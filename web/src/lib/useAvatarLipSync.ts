/**
 * useAvatarLipSync — deterministic phoneme-style mouth animation.
 *
 * The Web Speech API does not expose real-time audio amplitude or phoneme
 * boundaries, so we use a deterministic approach:
 *
 *   SPEAKING state → cycle through mouth shapes at a natural syllable rate
 *   IDLE/other    → mouth closed (shape index 0)
 *
 * Mouth shapes (index 0–5):
 *   0  closed       "M", silence
 *   1  slight open  "E", "i"
 *   2  mid open     "A" short
 *   3  wide open    "A" open
 *   4  round        "O", "U"
 *   5  narrow       "ee", "F"
 *
 * The sequence is not random — it follows a natural speech rhythm:
 * open → wider → open → round → slight → closed → repeat, with random
 * micro-variation so it doesn't look mechanical.
 *
 * Connected to the actual TTS state: mouth only moves when
 * speechSynthesis has actually started (onstart) and stops when it ends (onend).
 */

import { useEffect, useRef, useState } from 'react';
import type { AvatarState } from '../components/AIAvatar';

export type MouthShape = 0 | 1 | 2 | 3 | 4 | 5;

// Natural speech pattern: weighted sequence of mouth shapes.
const SPEECH_SEQUENCE: MouthShape[] = [1, 2, 3, 2, 4, 1, 3, 4, 2, 1, 5, 2, 3, 1, 0, 2, 3, 4, 1, 2];

// Timing: average ms per shape step — mimics ~3–4 syllables/second.
const BASE_STEP_MS = 120;

export interface LipSyncState {
  mouthShape: MouthShape;
  /** 0–1, used to scale mouth opening */
  openAmount: number;
}

const OPEN_AMOUNTS: Record<MouthShape, number> = {
  0: 0,
  1: 0.2,
  2: 0.45,
  3: 0.75,
  4: 0.55,
  5: 0.25,
};

export function useAvatarLipSync(avatarState: AvatarState): LipSyncState {
  const [mouthShape, setMouthShape] = useState<MouthShape>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqIdxRef = useRef(0);

  useEffect(() => {
    if (avatarState !== 'SPEAKING') {
      // Stop animation — close mouth immediately.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setMouthShape(0);
      return;
    }

    // SPEAKING: cycle through mouth shapes.
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      const shape = SPEECH_SEQUENCE[seqIdxRef.current % SPEECH_SEQUENCE.length];
      setMouthShape(shape);
      seqIdxRef.current += 1;
      // Add ±30ms jitter so it doesn't look mechanical.
      const jitter = (Math.random() - 0.5) * 60;
      timerRef.current = setTimeout(step, BASE_STEP_MS + jitter);
    };

    step();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [avatarState]);

  return {
    mouthShape,
    openAmount: OPEN_AMOUNTS[mouthShape],
  };
}
