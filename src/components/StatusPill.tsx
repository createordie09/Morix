/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';

export type StatusPillState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'searching'
  | 'planning'
  | 'muted'
  | 'blocked'
  | 'error';

const STATE_LABELS: Record<StatusPillState, string> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  searching: 'Searching',
  planning: 'Planning',
  muted: 'Muted',
  blocked: 'Blocked',
  error: 'Error',
};

interface StatusPillProps {
  state: StatusPillState;
  isActivated: boolean;
  isActivating: boolean;
  micVolume?: number; // 0 to 1
  onClick: () => void;
}

interface ColorStop {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ThemeConfig {
  bg: ColorStop;
  stops: ColorStop[];
  waveAmp: number;
  waveFreq: number;
  speed: number;
  glowColor: string;
  type: 'wave' | 'dual' | 'sweep' | 'pulse';
}

const THEMES: Record<StatusPillState, ThemeConfig> = {
  idle: {
    bg: { r: 10, g: 13, b: 20, a: 1.0 },
    stops: [
      { r: 18, g: 26, b: 42, a: 0.8 },
      { r: 28, g: 40, b: 64, a: 0.85 },
      { r: 15, g: 22, b: 36, a: 0.8 },
      { r: 24, g: 34, b: 54, a: 0.85 },
    ],
    waveAmp: 4,
    waveFreq: 0.015,
    speed: 0.35,
    glowColor: 'rgba(28, 40, 64, 0.35)',
    type: 'wave',
  },
  listening: {
    bg: { r: 6, g: 18, b: 36, a: 1.0 },
    stops: [
      { r: 0, g: 195, b: 255, a: 0.95 },
      { r: 0, g: 114, b: 255, a: 0.9 },
      { r: 0, g: 242, b: 254, a: 0.95 },
      { r: 14, g: 90, b: 200, a: 0.9 },
    ],
    waveAmp: 7,
    waveFreq: 0.025,
    speed: 1.1,
    glowColor: 'rgba(0, 195, 255, 0.45)',
    type: 'wave',
  },
  thinking: {
    // Multi-color organic ribbon as in reference Image 1: Gold -> Green -> Cyan -> Purple/Magenta
    bg: { r: 14, g: 8, b: 24, a: 1.0 },
    stops: [
      { r: 245, g: 158, b: 11, a: 0.95 }, // Amber / Gold
      { r: 34, g: 197, b: 94, a: 0.95 }, // Lime / Emerald
      { r: 6, g: 182, b: 212, a: 0.95 }, // Cyan / Turquoise
      { r: 192, g: 38, b: 211, a: 0.95 }, // Magenta / Purple
    ],
    waveAmp: 9,
    waveFreq: 0.022,
    speed: 1.8,
    glowColor: 'rgba(192, 38, 211, 0.45)',
    type: 'wave',
  },
  speaking: {
    // Violet / rose energetic wave
    bg: { r: 24, g: 8, b: 28, a: 1.0 },
    stops: [
      { r: 168, g: 85, b: 247, a: 0.92 },
      { r: 236, g: 72, b: 153, a: 0.95 },
      { r: 244, g: 63, b: 94, a: 0.92 },
      { r: 192, g: 38, b: 211, a: 0.95 },
    ],
    waveAmp: 8,
    waveFreq: 0.024,
    speed: 1.4,
    glowColor: 'rgba(236, 72, 153, 0.45)',
    type: 'wave',
  },
  searching: {
    // Warm metallic amber / gold sweeping gradient as in reference Image 2
    bg: { r: 22, g: 14, b: 6, a: 1.0 },
    stops: [
      { r: 180, g: 83, b: 9, a: 0.9 },
      { r: 245, g: 158, b: 11, a: 0.95 },
      { r: 251, g: 191, b: 36, a: 0.98 },
      { r: 146, g: 64, b: 14, a: 0.9 },
    ],
    waveAmp: 6,
    waveFreq: 0.02,
    speed: 1.5,
    glowColor: 'rgba(245, 158, 11, 0.45)',
    type: 'sweep',
  },
  planning: {
    // Contrasted dual-color electric blue on left and fire red on right as in reference Image 3
    bg: { r: 12, g: 12, b: 18, a: 1.0 },
    stops: [
      { r: 2, g: 132, b: 199, a: 0.98 }, // Vibrant blue
      { r: 14, g: 165, b: 233, a: 0.95 }, // Cyan
      { r: 239, g: 68, b: 68, a: 0.98 }, // Coral red
      { r: 220, g: 38, b: 38, a: 0.95 }, // Crimson
    ],
    waveAmp: 11,
    waveFreq: 0.028,
    speed: 1.6,
    glowColor: 'rgba(239, 68, 68, 0.35)',
    type: 'dual',
  },
  muted: {
    // Desaturated slate/zinc gray, slow subtle motion
    bg: { r: 18, g: 18, b: 22, a: 1.0 },
    stops: [
      { r: 63, g: 63, b: 70, a: 0.65 },
      { r: 82, g: 82, b: 91, a: 0.75 },
      { r: 39, g: 39, b: 42, a: 0.65 },
      { r: 71, g: 71, b: 78, a: 0.7 },
    ],
    waveAmp: 2.5,
    waveFreq: 0.012,
    speed: 0.12,
    glowColor: 'rgba(82, 82, 91, 0.25)',
    type: 'wave',
  },
  blocked: {
    // Deep blood red slow warning pulse
    bg: { r: 28, g: 6, b: 6, a: 1.0 },
    stops: [
      { r: 185, g: 28, b: 28, a: 0.9 },
      { r: 220, g: 38, b: 38, a: 0.95 },
      { r: 127, g: 29, b: 29, a: 0.9 },
      { r: 153, g: 27, b: 27, a: 0.92 },
    ],
    waveAmp: 5,
    waveFreq: 0.018,
    speed: 0.6,
    glowColor: 'rgba(220, 38, 38, 0.45)',
    type: 'pulse',
  },
  error: {
    // Intense dark crimson red gradient with visible warning pulse
    bg: { r: 38, g: 8, b: 8, a: 1.0 },
    stops: [
      { r: 220, g: 38, b: 38, a: 0.98 }, // Vibrant red
      { r: 185, g: 28, b: 28, a: 0.95 }, // Deep red
      { r: 239, g: 68, b: 68, a: 0.98 }, // Bright crimson
      { r: 153, g: 27, b: 27, a: 0.95 }, // Dark wine
    ],
    waveAmp: 8,
    waveFreq: 0.024,
    speed: 1.2,
    glowColor: 'rgba(239, 68, 68, 0.65)',
    type: 'pulse',
  },
};

function lerpColor(c1: ColorStop, c2: ColorStop, t: number): ColorStop {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
    a: c1.a + (c2.a - c1.a) * t,
  };
}

function rgbaStr(c: ColorStop): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a.toFixed(2)})`;
}

export default function StatusPill({
  state,
  isActivated,
  isActivating,
  micVolume = 0,
  onClick,
}: StatusPillProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Interpolation state for liquid gradient waves
  const prevThemeRef = useRef<ThemeConfig>(THEMES[state]);
  const targetThemeRef = useRef<ThemeConfig>(THEMES[state]);
  const transitionStartRef = useRef<number>(performance.now());
  const transitionDuration = 500; // ms (0.5s fluid transition)

  // Track state word with 0.3s fade in/out transition
  const targetWord = STATE_LABELS[state] || '';
  const [displayedWord, setDisplayedWord] = useState(targetWord);
  const [wordOpacity, setWordOpacity] = useState(targetWord ? 1 : 0);
  const prevWordRef = useRef(targetWord);

  useEffect(() => {
    if (targetWord !== prevWordRef.current) {
      setWordOpacity(0);
      const timer = window.setTimeout(() => {
        setDisplayedWord(targetWord);
        prevWordRef.current = targetWord;
        if (targetWord) {
          setWordOpacity(1);
        }
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setWordOpacity(targetWord ? 1 : 0);
    }
  }, [targetWord]);

  // Track state changes to trigger smooth palette interpolation
  useEffect(() => {
    const nextTheme = THEMES[state] || THEMES.idle;
    prevThemeRef.current = targetThemeRef.current;
    targetThemeRef.current = nextTheme;
    transitionStartRef.current = performance.now();
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const render = (now: number) => {
      const width = canvas.clientWidth || 142;
      const height = canvas.clientHeight || 44;
      if (width === 0 || height === 0) return;

      // Compute transition progress (0 to 1 with smooth ease-in-out)
      const elapsed = now - transitionStartRef.current;
      const rawProgress = Math.min(1, Math.max(0, elapsed / transitionDuration));
      const t = rawProgress < 0.5
        ? 2 * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;

      const prevTheme = prevThemeRef.current;
      const targetTheme = targetThemeRef.current;

      // Interpolate parameters
      const bg = lerpColor(prevTheme.bg, targetTheme.bg, t);
      const stopsCount = Math.max(prevTheme.stops.length, targetTheme.stops.length);
      const stops: ColorStop[] = [];
      for (let i = 0; i < stopsCount; i++) {
        const s1 = prevTheme.stops[i] || prevTheme.stops[prevTheme.stops.length - 1];
        const s2 = targetTheme.stops[i] || targetTheme.stops[targetTheme.stops.length - 1];
        stops.push(lerpColor(s1, s2, t));
      }

      // Responsive volume boost in listening / speaking
      const volBoost = state === 'listening' ? micVolume * 2.8 : 0;
      const waveAmp = (prevTheme.waveAmp + (targetTheme.waveAmp - prevTheme.waveAmp) * t) * (1 + volBoost);
      const speed = (prevTheme.speed + (targetTheme.speed - prevTheme.speed) * t) * (1 + volBoost * 0.8);
      const currentType = t > 0.5 ? targetTheme.type : prevTheme.type;

      time += speed * 0.04;

      // 1. Clear background
      ctx.clearRect(0, 0, width, height);

      // 2. Base Dark/Tinted Background
      ctx.fillStyle = rgbaStr(bg);
      ctx.fillRect(0, 0, width, height);

      // 3. Draw Dynamic Wave Gradients according to theme type
      if (currentType === 'dual') {
        // DUAL TONE (Planning state: Blue on Left, Red on Right with organic undulating wave divider)
        const midX = width * 0.5 + Math.sin(time * 1.2) * (width * 0.08);

        // Left half (Electric Blue)
        const leftGrad = ctx.createLinearGradient(0, 0, midX + 20, height);
        leftGrad.addColorStop(0, rgbaStr(stops[0]));
        leftGrad.addColorStop(1, rgbaStr(stops[1] || stops[0]));
        ctx.fillStyle = leftGrad;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(midX, 0);
        // Undulating wave border down the middle
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          const py = (height / steps) * i;
          const px = midX + Math.sin(py * 0.12 + time * 2) * waveAmp;
          ctx.lineTo(px, py);
        }
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();

        // Right half (Fire Red)
        const rightGrad = ctx.createLinearGradient(midX - 20, 0, width, height);
        rightGrad.addColorStop(0, rgbaStr(stops[2] || stops[0]));
        rightGrad.addColorStop(1, rgbaStr(stops[3] || stops[1] || stops[0]));
        ctx.fillStyle = rightGrad;

        ctx.beginPath();
        ctx.moveTo(midX, 0);
        ctx.lineTo(width, 0);
        ctx.lineTo(width, height);
        ctx.lineTo(midX, height);
        for (let i = steps; i >= 0; i--) {
          const py = (height / steps) * i;
          const px = midX + Math.sin(py * 0.12 + time * 2) * waveAmp;
          ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else if (currentType === 'sweep') {
        // SWEEPING WAVE (Searching state: warm metallic amber sweeping back and forth)
        const sweepOffset = (Math.sin(time) * 0.5 + 0.5) * width;
        const sweepGrad = ctx.createLinearGradient(
          sweepOffset - width * 0.6,
          0,
          sweepOffset + width * 0.6,
          height
        );
        sweepGrad.addColorStop(0, rgbaStr(stops[0]));
        sweepGrad.addColorStop(0.35, rgbaStr(stops[1]));
        sweepGrad.addColorStop(0.65, rgbaStr(stops[2]));
        sweepGrad.addColorStop(1, rgbaStr(stops[3]));

        ctx.fillStyle = sweepGrad;
        ctx.beginPath();
        ctx.moveTo(0, height * 0.2);
        for (let x = 0; x <= width; x += 4) {
          const y =
            height * 0.5 +
            Math.sin(x * 0.025 + time * 1.5) * waveAmp +
            Math.cos(x * 0.015 - time) * (waveAmp * 0.6);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();

        // Soft secondary top ripple
        ctx.fillStyle = rgbaStr({ ...stops[2], a: 0.35 });
        ctx.beginPath();
        ctx.moveTo(0, height * 0.3);
        for (let x = 0; x <= width; x += 6) {
          const y = height * 0.4 + Math.sin(x * 0.03 + time * 2.2) * (waveAmp * 0.7);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();
      } else {
        // WAVE / MULTI-COLOR RIBBON (Thinking, Listening, Speaking, Idle, Muted, Blocked)
        const waveGrad = ctx.createLinearGradient(0, 0, width, height);
        waveGrad.addColorStop(0, rgbaStr(stops[0]));
        waveGrad.addColorStop(0.33, rgbaStr(stops[1]));
        waveGrad.addColorStop(0.66, rgbaStr(stops[2]));
        waveGrad.addColorStop(1, rgbaStr(stops[3]));

        ctx.fillStyle = waveGrad;
        ctx.beginPath();

        // Organic harmonic wave curve across pill
        const baseY = height * 0.52;
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= width; x += 3) {
          const y =
            baseY +
            Math.sin(x * 0.028 + time * 1.6) * waveAmp +
            Math.cos(x * 0.018 - time * 1.1) * (waveAmp * 0.5);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();

        // Secondary soft harmonic wave to create rich multi-layered depth (as in reference Image 1)
        if (state === 'thinking' || state === 'speaking' || state === 'listening') {
          ctx.fillStyle = rgbaStr({ ...stops[1], a: 0.4 });
          ctx.beginPath();
          const secBaseY = height * 0.44;
          ctx.moveTo(0, secBaseY);
          for (let x = 0; x <= width; x += 4) {
            const y =
              secBaseY +
              Math.cos(x * 0.032 - time * 1.4) * (waveAmp * 0.8) +
              Math.sin(x * 0.016 + time * 0.9) * (waveAmp * 0.4);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fill();
        }

        // Pulse effect for 'blocked' state
        if (state === 'blocked') {
          const pulse = (Math.sin(time * 2.5) * 0.5 + 0.5) * 0.35;
          ctx.fillStyle = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // 4. Subtle top glass sheen reflection overlay
      const sheenGrad = ctx.createLinearGradient(0, 0, 0, height * 0.7);
      sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
      sheenGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.08)');
      sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(0, 0, width, height * 0.6);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [state, micVolume]);

  // Set internal canvas resolution to match pixel density for razor-sharp rendering
  useEffect(() => {
    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const cssW = rect.width || 142;
      const cssH = rect.height || 44;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  const currentTheme = THEMES[state] || THEMES.idle;

  // Tooltip & accessibility labels without permanent text
  const tooltipText = isActivating
    ? 'Initialisation de Morix...'
    : state === 'blocked'
    ? 'Microphone bloqué — Cliquer pour afficher les instructions'
    : state === 'muted'
    ? 'Micro coupé — Cliquer pour réactiver'
    : state === 'listening'
    ? 'Écoute en cours...'
    : state === 'speaking'
    ? 'Morix parle...'
    : state === 'thinking'
    ? 'Réflexion en cours...'
    : state === 'searching'
    ? 'Recherche web en direct...'
    : state === 'planning'
    ? 'Traitement en cours...'
    : isActivated
    ? 'Micro actif — Cliquer pour couper'
    : 'Activer le micro de Morix';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isActivating}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!isActivating) {
            onClick();
          }
        }
      }}
      title={tooltipText}
      aria-label={tooltipText}
      style={{
        position: 'relative',
        width: '142px',
        height: '44px',
        borderRadius: '9999px',
        padding: 0,
        border: '1px solid rgba(255, 255, 255, 0.24)',
        outline: isFocused ? '2px solid rgba(255, 255, 255, 0.85)' : 'none',
        outlineOffset: '4px',
        boxShadow: `0 12px 36px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.4), 0 0 24px ${currentTheme.glowColor}`,
        overflow: 'hidden',
        cursor: isActivating ? 'wait' : 'pointer',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        transition: 'transform 200ms ease, box-shadow 400ms ease, border-color 400ms ease, outline 150ms ease',
      }}
      onMouseEnter={(e) => {
        if (!isActivating) {
          e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.45)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActivating) {
          e.currentTarget.style.transform = 'translateY(0) scale(1.0)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.24)';
        }
      }}
    >
      {/* 1. Canvas displaying the flowing, undulating liquid gradient waves */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
        }}
      />

      {/* 2. Glass glossy reflection layer along the pill perimeter */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '9999px',
          boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.5), inset 0 -1px 2px rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none',
        }}
      />

      {/* 3. Centered State Word + Discreet semi-transparent mic icon */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: displayedWord ? '6px' : '0px',
          pointerEvents: 'none',
          userSelect: 'none',
          transition: 'gap 250ms ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            opacity: state === 'muted' ? 0.8 : 0.65,
            filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.85))',
            transition: 'opacity 250ms ease',
          }}
        >
          {state === 'muted' || state === 'blocked' ? (
            /* Mic Off Icon with clean diagonal slash */
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          ) : (
            /* Clean Minimalist Mic Icon */
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
        </div>

        {displayedWord && (
          <span
            style={{
              fontFamily:
                "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fontSize: '0.8125rem',
              fontWeight: 500,
              letterSpacing: '-0.015em',
              color: 'rgba(244, 244, 245, 0.95)',
              textShadow:
                '0 1px 3px rgba(0, 0, 0, 0.8), 0 0 8px rgba(0, 0, 0, 0.5)',
              opacity: wordOpacity,
              transform: wordOpacity === 1 ? 'translateY(0)' : 'translateY(1px)',
              transition: 'opacity 150ms ease, transform 150ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {displayedWord}
          </span>
        )}
      </div>
    </button>
  );
}
