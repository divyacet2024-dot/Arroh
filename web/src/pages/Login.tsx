import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  HeartPulse,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ApiError } from '../services/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this email already exists.';
    if (error.status === 401) return 'Invalid email or password.';
    if (error.status === 422) return 'Please check the required information and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/* ─────────────────────── Particle canvas ─────────────────────── */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}

const PARTICLE_COLORS = [
  'rgba(45,212,191,',   // teal
  'rgba(34,211,238,',   // cyan
  'rgba(52,211,153,',   // emerald
  'rgba(99,102,241,',   // indigo
];

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let particles: Particle[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Spawn particles
    const spawn = () => {
      const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -Math.random() * 0.6 - 0.2,
        radius: Math.random() * 2.5 + 0.5,
        alpha: Math.random() * 0.6 + 0.2,
        color,
      });
    };
    for (let i = 0; i < 80; i++) spawn();

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(45,212,191,${0.08 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `${p.color}${p.alpha})`;
        ctx.fill();

        // Subtle glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
        g.addColorStop(0, `${p.color}${p.alpha * 0.3})`);
        g.addColorStop(1, `${p.color}0)`);
        ctx.fillStyle = g;
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
      });

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0"
      aria-hidden="true"
    />
  );
}

/* ─────────────────── Cursor trail effect ─────────────────── */

function CursorTrail() {
  const trailRef = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLSpanElement[]>([]);
  const mouse = useRef({ x: 0, y: 0 });
  const positions = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    const el = trailRef.current;
    if (!el) return;

    const NUM = 12;
    positions.current = Array.from({ length: NUM }, () => ({ x: 0, y: 0 }));

    const spans = Array.from({ length: NUM }, (_, i) => {
      const s = document.createElement('span');
      s.className = 'cursor-dot';
      const scale = 1 - i / NUM;
      s.style.cssText = `
        position:fixed;pointer-events:none;border-radius:50%;z-index:9999;
        width:${8 * scale}px;height:${8 * scale}px;
        background:rgba(45,212,191,${0.8 - i * 0.06});
        box-shadow:0 0 ${6 * scale}px rgba(45,212,191,0.5);
        transform:translate(-50%,-50%);transition:opacity 0.3s;
      `;
      document.body.appendChild(s);
      return s;
    });
    dots.current = spans;

    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);

    let raf: number;
    const animate = () => {
      positions.current[0] = { ...mouse.current };
      for (let i = 1; i < NUM; i++) {
        positions.current[i] = {
          x: positions.current[i].x + (positions.current[i - 1].x - positions.current[i].x) * 0.35,
          y: positions.current[i].y + (positions.current[i - 1].y - positions.current[i].y) * 0.35,
        };
      }
      dots.current.forEach((dot, i) => {
        dot.style.left = `${positions.current[i].x}px`;
        dot.style.top = `${positions.current[i].y}px`;
      });
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      spans.forEach((s) => s.remove());
    };
  }, []);

  return <div ref={trailRef} aria-hidden="true" />;
}

/* ─────────────────────── Typing animation ─────────────────────── */

function TypingText({ texts }: { texts: string[] }) {
  const [displayed, setDisplayed] = useState('');
  const [textIdx, setTextIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = texts[textIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting && charIdx < current.length) {
      timeout = setTimeout(() => setCharIdx((c) => c + 1), 55);
    } else if (!deleting && charIdx === current.length) {
      timeout = setTimeout(() => setDeleting(true), 2200);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx((c) => c - 1), 30);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setTextIdx((t) => (t + 1) % texts.length);
    }

    setDisplayed(current.slice(0, charIdx));
    return () => clearTimeout(timeout);
  }, [charIdx, deleting, textIdx, texts]);

  return (
    <span className="ar-typing">
      {displayed}
      <span className="ar-cursor" aria-hidden="true">|</span>
    </span>
  );
}

/* ─────────────────────────── Main Login ─────────────────────────── */

export function Login() {
  const { isAuthenticated, isSessionReady, login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isSessionReady && isAuthenticated) return <Navigate to="/" replace />;

  const isRegister = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (isRegister) {
      if (!name.trim()) { setError('Enter your full name.'); return; }
      if (password !== confirm) { setError('Passwords do not match.'); return; }
    }

    setLoading(true);
    try {
      if (isRegister) {
        await register(name.trim(), email.trim(), password);
        setSuccess('Account created! Signing you in…');
      } else {
        await login(email.trim(), password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ar-login-root">
      {/* Animated particle network */}
      <ParticleCanvas />

      {/* Moving cursor trail */}
      <CursorTrail />

      {/* Deep layered background */}
      <div className="ar-bg-base" />
      <div className="ar-orb ar-orb-1" />
      <div className="ar-orb ar-orb-2" />
      <div className="ar-orb ar-orb-3" />
      <div className="ar-orb ar-orb-4" />
      <div className="ar-grid-overlay" />
      <div className="ar-vignette" />

      {/* Floating medical icons in background */}
      <div className="ar-float-icons" aria-hidden="true">
        {['❤️', '🩺', '💊', '🩻', '🧬', '⚕️'].map((icon, i) => (
          <span key={i} className="ar-float-icon" style={{ '--delay': `${i * 1.8}s`, '--x': `${10 + i * 14}%` } as React.CSSProperties}>
            {icon}
          </span>
        ))}
      </div>

      {/* Card */}
      <div className="ar-stage">
        <div className="ar-card">
          {/* Scanline shimmer on top of card */}
          <div className="ar-scanline" aria-hidden="true" />

          {/* Brand */}
          <div className="ar-brand">
            <div className="ar-logo-wrap">
              <div className="ar-logo-ring ar-logo-ring-1" />
              <div className="ar-logo-ring ar-logo-ring-2" />
              <span className="ar-logo-icon">
                <HeartPulse className="h-7 w-7" aria-hidden="true" />
              </span>
            </div>
            <div>
              <p className="ar-brand-name">MEDORA</p>
              <p className="ar-brand-sub">Rural Healthcare Platform</p>
            </div>
          </div>

          {/* Headline with typing effect */}
          <h1 className="ar-headline">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="ar-subhead">
            <TypingText
              texts={
                isRegister
                  ? ['Join the MEDORA network.', 'Serving rural India.', 'Healthcare for all.']
                  : ['AI-powered rural care.', 'Triage. Consult. Heal.', 'Securely sign in below.']
              }
            />
          </p>

          {/* Mode tabs */}
          <div className="ar-tabs" role="tablist">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => switchMode(m)}
                disabled={loading}
                className={`ar-tab ${mode === m ? 'ar-tab-active' : ''}`}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="ar-form">
            {isRegister && (
              <InputField
                id="name"
                label="Full name"
                type="text"
                icon={<UserRound className="h-4 w-4" />}
                placeholder="Dr. Anita Kumar"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                delay={0}
              />
            )}

            <InputField
              id="email"
              label="Email address"
              type="email"
              icon={<Mail className="h-4 w-4" />}
              placeholder="doctor@phc.gov.in"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!isRegister}
              delay={isRegister ? 1 : 0}
            />

            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              show={showPwd}
              toggleShow={() => setShowPwd((v) => !v)}
              hint={isRegister ? 'At least 8 characters' : undefined}
              delay={isRegister ? 2 : 1}
            />

            {isRegister && (
              <PasswordField
                id="confirm"
                label="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                show={showPwd}
                toggleShow={() => setShowPwd((v) => !v)}
                delay={3}
              />
            )}

            {/* Error / Success feedback */}
            {error && (
              <div role="alert" className="ar-alert ar-alert-error">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div role="status" className="ar-alert ar-alert-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{success}</span>
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} className="ar-submit">
              <span className="ar-submit-shine" aria-hidden="true" />
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {isRegister ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {isRegister ? 'Create account' : 'Sign in'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          {/* Trust badge */}
          <div className="ar-trust">
            <ShieldCheck className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true" />
            <p>
              End-to-end encrypted · ABDM-aligned · FHIR R4 compliant
            </p>
          </div>

          {/* Footer links */}
          <p className="ar-switch">
            {isRegister ? 'Already have an account?' : 'New to MEDORA?'}{' '}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? 'login' : 'register')}
              disabled={loading}
              className="ar-switch-link"
            >
              {isRegister ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>

        {/* Right side info panel (desktop only) */}
        <div className="ar-info-panel" aria-hidden="true">
          <div className="ar-info-inner">
            <p className="ar-info-title">Empowering Rural Healthcare</p>
            <p className="ar-info-desc">
              AI-driven triage · Voice intake in 12+ languages · Offline-first · WebRTC tele-consultation
            </p>
            <ul className="ar-info-list">
              {[
                { icon: '🩺', text: 'AI triage with clinical protocols' },
                { icon: '🎙️', text: 'Voice assistant in Hindi, Tamil, Kannada & more' },
                { icon: '📡', text: 'Offline-first sync for remote PHCs' },
                { icon: '🏥', text: 'Smart referral & bed availability' },
                { icon: '💊', text: 'Predictive inventory forecasting' },
                { icon: '🔐', text: 'Secure PBKDF2 + HMAC auth' },
              ].map((item) => (
                <li key={item.text} className="ar-info-item">
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <div className="ar-stat-row">
              {[
                { value: '12+', label: 'Languages' },
                { value: 'FHIR', label: 'R4 Ready' },
                { value: 'ABDM', label: 'Aligned' },
              ].map((s) => (
                <div key={s.label} className="ar-stat">
                  <span className="ar-stat-value">{s.value}</span>
                  <span className="ar-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Field sub-components ─────────────────── */

interface InputFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  id: string;
  label: string;
  icon: ReactNode;
  delay?: number;
}

function InputField({ id, label, icon, delay = 0, ...props }: InputFieldProps) {
  return (
    <div className="ar-field" style={{ '--field-delay': `${delay * 0.07}s` } as React.CSSProperties}>
      <label htmlFor={id} className="ar-label">{label}</label>
      <div className="ar-input-wrap">
        <span className="ar-input-icon">{icon}</span>
        <input id={id} className="ar-input" {...props} />
      </div>
    </div>
  );
}

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> {
  id: string;
  label: string;
  show: boolean;
  toggleShow: () => void;
  hint?: string;
  delay?: number;
}

function PasswordField({ id, label, show, toggleShow, hint, delay = 0, ...props }: PasswordFieldProps) {
  return (
    <div className="ar-field" style={{ '--field-delay': `${delay * 0.07}s` } as React.CSSProperties}>
      <label htmlFor={id} className="ar-label">{label}</label>
      <div className="ar-input-wrap">
        <span className="ar-input-icon">
          <LockKeyhole className="h-4 w-4" />
        </span>
        <input id={id} type={show ? 'text' : 'password'} className="ar-input ar-input-pwd" {...props} />
        <button
          type="button"
          onClick={toggleShow}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="ar-eye-btn"
        >
          {show
            ? <EyeOff className="h-4 w-4" aria-hidden="true" />
            : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="ar-hint">{hint}</p>}
    </div>
  );
}
