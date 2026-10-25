/**
 * ArrohHumanAvatar — MEDORA's professional digital-human AI assistant.
 *
 * Improvements over v1:
 *   - Warmer, more natural skin tones (less orange, more golden)
 *   - Resting face has a gentle natural smile (Mona-Lisa curve)
 *   - Left/right eye blinks fire at different intervals (natural look)
 *   - Breathing bob is softer (not bouncy)
 *   - Listening: eyebrows rise gently, eyes slightly wider
 *   - Processing: very subtle furrow, no dramatic expression
 *   - Speaking: mouth cycles via useAvatarLipSync, eyebrows neutral
 *   - Confirming: warm closed-mouth smile
 *   - Success: full warm smile
 *   - Error: gentle neutral concern (not alarming)
 *   - All animations respect prefers-reduced-motion
 *
 * The speaking animation is connected ONLY to the real TTS state.
 * Mouth opens when speechSynthesis.onstart fires, closes on onend.
 */

import { useAvatarLipSync } from '../lib/useAvatarLipSync';
import { cn } from '../lib/cn';
import type { AvatarState } from './AIAvatar';

export type { AvatarState };

interface ArrohHumanAvatarProps {
  state?: AvatarState;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

// Total bounding box size per variant
const TOTAL: Record<string, number> = { sm: 80, md: 110, lg: 152, xl: 200 };
// Face oval radius as fraction of total
const FACE_FRAC = 0.36;

// State → ambient ring colour
const RING_COLOR: Record<AvatarState, string> = {
  IDLE:       '#80cbc2',
  LISTENING:  '#22d3ee',
  PROCESSING: '#818cf8',
  SPEAKING:   '#34d399',
  CONFIRMING: '#fbbf24',
  ERROR:      '#f87171',
  SUCCESS:    '#34d399',
};

export function ArrohHumanAvatar({
  state = 'IDLE',
  size = 'md',
  className,
  label,
}: ArrohHumanAvatarProps) {
  const { openAmount } = useAvatarLipSync(state);

  const T   = TOTAL[size] ?? 110;
  const cx  = T / 2;
  const cy  = T / 2;
  const fr  = T * FACE_FRAC;   // face oval half-width

  const isListening  = state === 'LISTENING';
  const isProcessing = state === 'PROCESSING';
  const isSpeaking   = state === 'SPEAKING';
  const isSuccess    = state === 'SUCCESS';
  const isConfirming = state === 'CONFIRMING';
  const isError      = state === 'ERROR';
  const isIdle       = state === 'IDLE';

  const ring = RING_COLOR[state];

  // Brow adjustments
  const browLift  = isListening ? -2.5 : isSuccess ? -1.5 : 0;
  const browFurrow = isProcessing ? 1.8 : isError ? 1.2 : 0;

  // Eye openness scale
  const eyeScale = isListening ? 1.12 : isSpeaking ? 1.0 : 0.96;

  // Smile type per state
  type SmileType = 'neutral' | 'slight' | 'warm' | 'concerned';
  const smileType: SmileType =
    isSuccess || isConfirming ? 'warm' :
    isListening               ? 'slight' :
    isError                   ? 'concerned' :
    'slight';   // default resting smile — not flat neutral

  return (
    <div
      role="img"
      aria-label={label ?? `MEDORA — ${state}`}
      className={cn('relative select-none flex items-center justify-center', className)}
      style={{ width: T, height: T }}
    >
      {/* Ambient glow ring */}
      <div
        className={cn(
          'absolute inset-0 rounded-full',
          isListening && 'avatar-ring-pulse',
          isSpeaking  && 'avatar-ring-speak',
        )}
        style={{
          boxShadow: `0 0 0 ${Math.round(T * 0.03)}px ${ring}28, 0 0 ${Math.round(T * 0.2)}px ${ring}40`,
        }}
        aria-hidden="true"
      />

      <svg
        width={T}
        height={T}
        viewBox={`0 0 ${T} ${T}`}
        className={cn(
          'relative z-10 transition-transform duration-500',
          (isIdle || isConfirming) && 'avatar-breathe',
          isListening && 'avatar-attentive',
        )}
        aria-hidden="true"
      >
        <defs>
          {/* Warm golden Indian skin */}
          <radialGradient id={`sk-${size}`} cx="42%" cy="36%" r="62%">
            <stop offset="0%"   stopColor="#f9d5b0" />
            <stop offset="55%"  stopColor="#e8a87c" />
            <stop offset="100%" stopColor="#c97540" />
          </radialGradient>
          {/* Rich dark hair */}
          <radialGradient id={`hr-${size}`} cx="50%" cy="20%" r="72%">
            <stop offset="0%"   stopColor="#2d1f14" />
            <stop offset="100%" stopColor="#0f0a06" />
          </radialGradient>
          {/* Teal healthcare collar/top */}
          <linearGradient id={`cl-${size}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#1f7773" />
            <stop offset="100%" stopColor="#0a3e3b" />
          </linearGradient>
          {/* Eye iris — warm brown */}
          <radialGradient id={`ir-${size}`} cx="38%" cy="32%" r="58%">
            <stop offset="0%"   stopColor="#7a5230" />
            <stop offset="60%"  stopColor="#4a2e12" />
            <stop offset="100%" stopColor="#1e0e05" />
          </radialGradient>
          {/* Face highlight */}
          <radialGradient id={`fh-${size}`} cx="38%" cy="28%" r="50%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.45)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          {/* Eye white highlight */}
          <radialGradient id={`eh-${size}`} cx="30%" cy="28%" r="50%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.9)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
          </radialGradient>
        </defs>

        {/* ── Neck ── */}
        <ellipse cx={cx} cy={cy + fr * 0.96} rx={fr * 0.36} ry={fr * 0.26} fill={`url(#sk-${size})`} />

        {/* ── Collar / scrubs ── */}
        <path
          d={`M${cx - fr * 0.52},${cy + fr * 0.85}
              Q${cx},${cy + fr * 1.30}
              ${cx + fr * 0.52},${cy + fr * 0.85}
              L${cx + fr * 0.72},${cy + fr * 1.45}
              L${cx - fr * 0.72},${cy + fr * 1.45}Z`}
          fill={`url(#cl-${size})`}
        />
        {/* White coat stripe */}
        <line
          x1={cx - fr * 0.10} y1={cy + fr * 0.98}
          x2={cx + fr * 0.10} y2={cy + fr * 0.98}
          stroke="white" strokeWidth={fr * 0.038} opacity={0.65}
        />

        {/* ── Face oval ── */}
        <ellipse cx={cx} cy={cy} rx={fr} ry={fr * 1.06} fill={`url(#sk-${size})`} />

        {/* Face highlight */}
        <ellipse cx={cx} cy={cy} rx={fr} ry={fr * 1.06} fill={`url(#fh-${size})`} />

        {/* ── Hair top ── */}
        <ellipse cx={cx} cy={cy - fr * 0.70} rx={fr * 1.03} ry={fr * 0.50} fill={`url(#hr-${size})`} />
        {/* Hair sides */}
        <ellipse cx={cx - fr * 0.90} cy={cy - fr * 0.20} rx={fr * 0.20} ry={fr * 0.50} fill={`url(#hr-${size})`} />
        <ellipse cx={cx + fr * 0.90} cy={cy - fr * 0.20} rx={fr * 0.20} ry={fr * 0.50} fill={`url(#hr-${size})`} />

        {/* ── Ears ── */}
        <ellipse cx={cx - fr * 1.01} cy={cy + fr * 0.06} rx={fr * 0.095} ry={fr * 0.135} fill="#e8a87c" />
        <ellipse cx={cx + fr * 1.01} cy={cy + fr * 0.06} rx={fr * 0.095} ry={fr * 0.135} fill="#e8a87c" />

        {/* ── Eyebrows ── */}
        {(['left', 'right'] as const).map((side) => {
          const sign = side === 'left' ? -1 : 1;
          const x0 = cx + sign * fr * 0.14;
          const x1 = cx + sign * fr * 0.44;
          const by = cy - fr * 0.34 - browLift;
          const midY = by - browFurrow * (side === 'left' ? 0.5 : -0.5);
          return (
            <path
              key={side}
              d={`M${x0},${by + 1.5} Q${cx + sign * fr * 0.30},${midY} ${x1},${by}`}
              fill="none"
              stroke="#1e0f07"
              strokeWidth={fr * 0.052}
              strokeLinecap="round"
            />
          );
        })}

        {/* ── Eyes (left then right) ── */}
        {(['left', 'right'] as const).map((side) => {
          const sign = side === 'left' ? -1 : 1;
          const ex  = cx + sign * fr * 0.295;
          const ey  = cy - fr * 0.07;
          const erx = fr * 0.195;
          const ery = fr * 0.148 * eyeScale;

          return (
            <g key={side}>
              {/* Sclera */}
              <ellipse cx={ex} cy={ey} rx={erx} ry={ery} fill="white" />
              <ellipse cx={ex} cy={ey} rx={erx} ry={ery} fill={`url(#eh-${size})`} />
              {/* Iris */}
              <clipPath id={`ec-${side}-${size}`}>
                <ellipse cx={ex} cy={ey} rx={erx} ry={ery} />
              </clipPath>
              <ellipse
                cx={ex} cy={ey + ery * 0.08}
                rx={fr * 0.112} ry={fr * 0.12 * eyeScale}
                fill={`url(#ir-${size})`}
                clipPath={`url(#ec-${side}-${size})`}
              />
              {/* Pupil */}
              <circle
                cx={ex} cy={ey + ery * 0.08}
                r={fr * 0.050}
                fill="#0a0605"
                clipPath={`url(#ec-${side}-${size})`}
              />
              {/* Shine */}
              <circle cx={ex - fr * 0.042} cy={ey - fr * 0.042} r={fr * 0.022} fill="white" opacity={0.92} />
              {/* Upper lid line */}
              <path
                d={`M${ex - erx},${ey - ery * 0.5}
                    Q${ex},${ey - ery * 1.1}
                    ${ex + erx},${ey - ery * 0.5}`}
                fill="none"
                stroke="rgba(40,15,5,0.4)"
                strokeWidth={fr * 0.028}
                strokeLinecap="round"
              />
              {/* Eyelid lid crease */}
              <path
                d={`M${ex - erx * 0.85},${ey - ery * 0.3}
                    Q${ex},${ey - ery * 0.8}
                    ${ex + erx * 0.85},${ey - ery * 0.3}`}
                fill="none"
                stroke="rgba(140,80,30,0.25)"
                strokeWidth={fr * 0.020}
              />
              {/* Blinking upper eyelid — CSS animated */}
              <ellipse
                cx={ex}
                cy={ey - ery * 0.92}
                rx={erx}
                ry={ery * 0.12}
                fill="#e8a87c"
                className={`avatar-blink-lid-${side}`}
                style={{ transformOrigin: `${ex}px ${ey - ery}px` }}
              />
              {/* Lower lash line */}
              <path
                d={`M${ex - erx * 0.75},${ey + ery * 0.65}
                    Q${ex},${ey + ery * 0.9}
                    ${ex + erx * 0.75},${ey + ery * 0.65}`}
                fill="none"
                stroke="rgba(40,15,5,0.2)"
                strokeWidth={fr * 0.018}
              />
            </g>
          );
        })}

        {/* ── Nose bridge + nostrils ── */}
        <path
          d={`M${cx},${cy + fr * 0.03}
              q${fr * 0.055},${fr * 0.175} ${fr * 0.092},${fr * 0.21}
              q${-fr * 0.046},${fr * 0.038} ${-fr * 0.092},0
              q${-fr * 0.046},${-fr * 0.038} ${-fr * 0.092},0
              q${fr * 0.037},${-fr * 0.035} ${fr * 0.092},${-fr * 0.21}`}
          fill="none"
          stroke="rgba(100,48,12,0.30)"
          strokeWidth={fr * 0.030}
          strokeLinecap="round"
        />
        <circle cx={cx - fr * 0.092} cy={cy + fr * 0.275} r={fr * 0.026} fill="rgba(100,48,12,0.22)" />
        <circle cx={cx + fr * 0.092} cy={cy + fr * 0.275} r={fr * 0.026} fill="rgba(100,48,12,0.22)" />

        {/* ── Mouth ── */}
        <MouthPath
          cx={cx} cy={cy} fr={fr}
          openAmount={openAmount}
          smileType={smileType}
          isSpeaking={isSpeaking}
        />

        {/* ── Cheek flush (subtle warmth) ── */}
        <ellipse cx={cx - fr * 0.56} cy={cy + fr * 0.22} rx={fr * 0.22} ry={fr * 0.10} fill="rgba(220,100,80,0.10)" />
        <ellipse cx={cx + fr * 0.56} cy={cy + fr * 0.22} rx={fr * 0.22} ry={fr * 0.10} fill="rgba(220,100,80,0.10)" />

        {/* ── State indicators ── */}
        {isListening  && <MicDot   cx={cx} cy={cy} fr={fr} />}
        {isProcessing && <ThinkDots cx={cx} cy={cy} fr={fr} />}
        {isSpeaking   && size !== 'sm' && <WaveBars cx={cx} cy={cy} fr={fr} />}
        {isSuccess    && <CheckMark cx={cx} cy={cy} fr={fr} />}
      </svg>
    </div>
  );
}

// ── Mouth ─────────────────────────────────────────────────────────────────────

type SmileType = 'neutral' | 'slight' | 'warm' | 'concerned';

function MouthPath({
  cx, cy, fr, openAmount, smileType, isSpeaking,
}: {
  cx: number; cy: number; fr: number;
  openAmount: number;
  smileType: SmileType;
  isSpeaking: boolean;
}) {
  const mx  = cx;
  const my  = cy + fr * 0.46;
  const mw  = fr * 0.295;
  const open = openAmount * fr * 0.175;

  // Smile curve for closed mouth
  const curve =
    smileType === 'warm'      ? fr * 0.075 :
    smileType === 'slight'    ? fr * 0.042 :
    smileType === 'concerned' ? -fr * 0.030 :
    fr * 0.025;  // neutral — just a hair above flat

  if (isSpeaking && open > 0.015) {
    return (
      <g>
        {/* Upper lip */}
        <path
          d={`M${mx - mw},${my}
              q${mw * 0.38},${-fr * 0.018 + curve * 0.25} ${mw},0`}
          fill="#b5614a"
          stroke="#8b3a1e"
          strokeWidth={fr * 0.025}
          strokeLinecap="round"
        />
        {/* Mouth opening */}
        <ellipse
          cx={mx} cy={my + open * 0.42}
          rx={mw * 0.68} ry={Math.max(open * 0.85, fr * 0.018)}
          fill="#1a0806"
        />
        {/* Lower lip */}
        <path
          d={`M${mx - mw * 0.88},${my + open * 0.48}
              q${mw * 0.88},${open * 0.55 + curve * 0.5} ${mw * 1.76},0`}
          fill="#c97055"
          stroke="none"
        />
        {/* Lip outline */}
        <path
          d={`M${mx - mw},${my}
              q${mw},${curve} ${mw * 2},0`}
          fill="none"
          stroke="#8b3a1e"
          strokeWidth={fr * 0.028}
          strokeLinecap="round"
        />
      </g>
    );
  }

  // Closed / resting mouth
  return (
    <g>
      <path
        d={`M${mx - mw},${my}
            q${mw},${curve * 1.6} ${mw * 2},0`}
        fill="none"
        stroke="#8b3a1e"
        strokeWidth={fr * 0.038}
        strokeLinecap="round"
      />
      {/* Lip colour */}
      <path
        d={`M${mx - mw * 0.88},${my - fr * 0.008}
            q${mw * 0.88},${curve + fr * 0.012} ${mw * 1.76},0`}
        fill="#c97055"
        opacity={0.40}
      />
    </g>
  );
}

// ── Indicator sub-components ──────────────────────────────────────────────────

function MicDot({ cx, cy, fr }: { cx: number; cy: number; fr: number }) {
  const y = cy + fr * 1.10;
  return (
    <g>
      <circle cx={cx} cy={y} r={fr * 0.14} fill="rgba(34,211,238,0.18)" className="avatar-mic-pulse" />
      <circle cx={cx} cy={y} r={fr * 0.08} fill="rgba(34,211,238,0.55)" />
      <rect x={cx - fr*0.028} y={y - fr*0.062} width={fr*0.056} height={fr*0.085} rx={fr*0.028} fill="white" />
      <path
        d={`M${cx - fr*0.068},${y + fr*0.028}
            q0,${fr*0.068} ${fr*0.068},${fr*0.068}
            q${fr*0.068},0 ${fr*0.068},${-fr*0.068}`}
        fill="none" stroke="white" strokeWidth={fr*0.020}
      />
    </g>
  );
}

function ThinkDots({ cx, cy, fr }: { cx: number; cy: number; fr: number }) {
  const y = cy + fr * 1.08;
  return (
    <g>
      {[-1, 0, 1].map((i) => (
        <circle
          key={i}
          cx={cx + i * fr * 0.14}
          cy={y}
          r={fr * 0.042}
          fill="rgba(129,140,248,0.65)"
          className="orb-neural-dot-inline"
          style={{ animationDelay: `${(i + 1) * 0.18}s` } as React.CSSProperties}
        />
      ))}
    </g>
  );
}

function WaveBars({ cx, cy, fr }: { cx: number; cy: number; fr: number }) {
  const y   = cy + fr * 1.10;
  const bw  = fr * 0.038;
  const hts = [0.55, 0.85, 1, 0.75, 0.90, 0.60];
  const total = hts.length * bw + (hts.length - 1) * bw * 0.5;
  const sx  = cx - total / 2;
  return (
    <g>
      {hts.map((h, i) => (
        <rect
          key={i}
          x={sx + i * bw * 1.5}
          y={y - fr * 0.095 * h}
          width={bw}
          height={fr * 0.190 * h}
          rx={bw / 2}
          fill="rgba(52,211,153,0.68)"
          className="orb-wave-bar"
          style={{ animationDelay: `${i * 0.07}s` } as React.CSSProperties}
        />
      ))}
    </g>
  );
}

function CheckMark({ cx, cy, fr }: { cx: number; cy: number; fr: number }) {
  const y = cy + fr * 1.08;
  const r = fr * 0.14;
  return (
    <g>
      <circle cx={cx} cy={y} r={r} fill="rgba(52,211,153,0.3)" />
      <path
        d={`M${cx - r * 0.58},${y} l${r * 0.48},${r * 0.52} l${r * 0.82},-${r * 0.86}`}
        fill="none"
        stroke="rgba(52,211,153,0.9)"
        strokeWidth={r * 0.24}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="orb-check-draw"
      />
    </g>
  );
}
