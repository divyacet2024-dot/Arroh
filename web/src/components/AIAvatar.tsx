/**
 * AIAvatar — MEDORA's premium AI orb identity.
 *
 * Visual design:
 *   - Central orb with soft radial glow that shifts colour per state
 *   - Three concentric SVG rings at different radii + rotation speeds
 *   - Heartbeat ECG path that pulses in sync with state
 *   - Audio-reactive sound-wave bars during SPEAKING (CSS animated)
 *   - Listening ripple rings expand outward
 *   - Processing: neural-mesh dashed ring rotates
 *   - All animations are pure CSS — no heavy JS animation library
 *   - respects prefers-reduced-motion
 *
 * States: IDLE | LISTENING | PROCESSING | SPEAKING | CONFIRMING | ERROR | SUCCESS
 */

import { cn } from '../lib/cn';

export type AvatarState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SPEAKING'
  | 'CONFIRMING'
  | 'ERROR'
  | 'SUCCESS';

interface AIAvatarProps {
  state?: AvatarState;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Screen-reader label */
  label?: string;
}

// Pixel sizes for each variant
const PX: Record<string, number> = { sm: 72, md: 100, lg: 140, xl: 180 };

// State → orb gradient colours
const ORB_GRADIENT: Record<AvatarState, [string, string, string]> = {
  IDLE:       ['#c7f9f0', '#4db0a5', '#1f7773'],
  LISTENING:  ['#a5f3fc', '#22d3ee', '#0e7490'],
  PROCESSING: ['#e0e7ff', '#818cf8', '#4338ca'],
  SPEAKING:   ['#bbf7d0', '#34d399', '#059669'],
  CONFIRMING: ['#fef3c7', '#fbbf24', '#d97706'],
  ERROR:      ['#fee2e2', '#f87171', '#dc2626'],
  SUCCESS:    ['#d1fae5', '#34d399', '#059669'],
};

// State → glow colour (box-shadow / filter)
const GLOW_COLOR: Record<AvatarState, string> = {
  IDLE:       'rgba(47,150,144,0.35)',
  LISTENING:  'rgba(34,211,238,0.50)',
  PROCESSING: 'rgba(99,102,241,0.40)',
  SPEAKING:   'rgba(52,211,153,0.50)',
  CONFIRMING: 'rgba(251,191,36,0.45)',
  ERROR:      'rgba(248,113,113,0.45)',
  SUCCESS:    'rgba(52,211,153,0.55)',
};

export function AIAvatar({ state = 'IDLE', size = 'md', className, label }: AIAvatarProps) {
  const px    = PX[size] ?? 100;
  const half  = px / 2;
  const [c0, c1, c2] = ORB_GRADIENT[state];
  const glow  = GLOW_COLOR[state];

  const isListening  = state === 'LISTENING';
  const isProcessing = state === 'PROCESSING';
  const isSpeaking   = state === 'SPEAKING';
  const isError      = state === 'ERROR';
  const isSuccess    = state === 'SUCCESS';

  const orbPx  = Math.round(px * 0.55);   // inner orb circle
  const ring1  = Math.round(px * 0.48);   // ring 1 radius
  const ring2  = Math.round(px * 0.42);   // ring 2 radius (dashed)

  return (
    <div
      role="img"
      aria-label={label ?? `MEDORA — ${state}`}
      className={cn('relative select-none', className)}
      style={{ width: px, height: px }}
    >
      {/* ── Outer glow backdrop ───────────────────────────────────── */}
      <div
        className="absolute inset-0 rounded-full orb-glow-layer"
        style={{
          background: `radial-gradient(circle, ${c0}55 0%, transparent 70%)`,
          filter: `blur(${Math.round(px * 0.18)}px)`,
        }}
        aria-hidden="true"
      />

      {/* ── Listening ripple rings ────────────────────────────────── */}
      {(isListening || isSpeaking) && (
        <>
          <div
            className="absolute rounded-full orb-ripple-1"
            style={{ inset: -Math.round(px * 0.12), border: `1.5px solid ${c1}66` }}
            aria-hidden="true"
          />
          <div
            className="absolute rounded-full orb-ripple-2"
            style={{ inset: -Math.round(px * 0.22), border: `1px solid ${c1}33` }}
            aria-hidden="true"
          />
        </>
      )}

      {/* ── SVG rings + mark ─────────────────────────────────────── */}
      <svg
        width={px}
        height={px}
        viewBox={`0 0 ${px} ${px}`}
        className="absolute inset-0"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`orb-${size}`} cx="50%" cy="38%" r="55%">
            <stop offset="0%"   stopColor={c0} />
            <stop offset="55%"  stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </radialGradient>
          {/* Glass highlight */}
          <radialGradient id={`orb-hi-${size}`} cx="38%" cy="30%" r="40%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* Outer concentric ring — slow rotation */}
        <circle
          cx={half} cy={half}
          r={ring1}
          fill="none"
          stroke={c1}
          strokeOpacity="0.22"
          strokeWidth="1"
          className={isProcessing ? 'orb-ring-spin-slow' : ''}
        />

        {/* Middle dashed ring — counter-rotation in processing */}
        <circle
          cx={half} cy={half}
          r={ring2}
          fill="none"
          stroke={c2}
          strokeOpacity={isProcessing ? 0.4 : 0.14}
          strokeWidth="1.5"
          strokeDasharray={isProcessing ? '4 6' : '2 8'}
          className={isProcessing ? 'orb-ring-spin-fast-rev' : ''}
        />

        {/* Main orb circle */}
        <circle
          cx={half} cy={half}
          r={orbPx / 2}
          fill={`url(#orb-${size})`}
          className="orb-breathe"
          style={{ filter: `drop-shadow(0 0 ${Math.round(px*0.08)}px ${glow})` }}
        />

        {/* Glass highlight on orb */}
        <circle
          cx={half} cy={half}
          r={orbPx / 2}
          fill={`url(#orb-hi-${size})`}
        />

        {/* ── State-specific inner graphics ── */}
        {!isSpeaking && !isSuccess && !isError && (
          <EcgPath cx={half} cy={half} width={orbPx * 0.7} state={state} color="rgba(255,255,255,0.85)" />
        )}

        {isSuccess && (
          <CheckMark cx={half} cy={half} r={orbPx * 0.28} />
        )}

        {isError && (
          <AlertMark cx={half} cy={half} r={orbPx * 0.3} />
        )}
      </svg>

      {/* ── Speaking waveform bars (DOM elements for CSS animation) ── */}
      {isSpeaking && (
        <div
          className="absolute flex items-center justify-center gap-[2.5px]"
          style={{
            width: orbPx,
            height: orbPx,
            left: half - orbPx / 2,
            top:  half - orbPx / 2,
          }}
          aria-hidden="true"
        >
          {[0.4, 0.7, 1, 0.85, 1.1, 0.75, 0.5, 0.8, 1, 0.6].map((h, i) => (
            <span
              key={i}
              className="rounded-full orb-wave-bar"
              style={{
                width:  Math.max(2, Math.round(orbPx * 0.028)),
                height: Math.round(orbPx * 0.15 * h),
                background: 'rgba(255,255,255,0.85)',
                animationDelay: `${i * 0.07}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Processing neural dot ring ── */}
      {isProcessing && (
        <div
          className="absolute orb-neural-ring"
          style={{ inset: Math.round(px * 0.04) }}
          aria-hidden="true"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className="orb-neural-dot"
              style={{
                '--dot-angle': `${i * 45}deg`,
                animationDelay: `${i * 0.12}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inner SVG helpers ─────────────────────────────────────────────────────────

function EcgPath({
  cx, cy, width, state, color,
}: { cx: number; cy: number; width: number; state: AvatarState; color: string }) {
  const h  = width * 0.35;
  const x0 = cx - width / 2;
  const y0 = cy;
  const isActive = state === 'LISTENING' || state === 'CONFIRMING';
  const d = `M${x0},${y0}
    l${width*0.12},0
    l${width*0.08},-${h*0.4}
    l${width*0.1},${h}
    l${width*0.1},-${h*0.9}
    l${width*0.08},${h*0.5}
    l${width*0.12},0
    l${width*0.06},-${h*0.25}
    l${width*0.06},${h*0.25}
    l${width*0.28},0`;
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width * 0.042}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={isActive ? 1 : 0.75}
      className={isActive ? 'orb-ecg-pulse' : ''}
    />
  );
}

function CheckMark({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <path
      d={`M${cx - r * 0.6},${cy} l${r * 0.5},${r * 0.55} l${r * 0.85},-${r * 0.9}`}
      fill="none"
      stroke="rgba(255,255,255,0.95)"
      strokeWidth={r * 0.22}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="orb-check-draw"
    />
  );
}

function AlertMark({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <>
      <line
        x1={cx} y1={cy - r * 0.7}
        x2={cx} y2={cy + r * 0.1}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={r * 0.22}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy + r * 0.55} r={r * 0.12}
        fill="rgba(255,255,255,0.9)" />
    </>
  );
}
