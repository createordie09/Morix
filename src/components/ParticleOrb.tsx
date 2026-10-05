/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbState } from '../types/orb';

// Optimized GLSL 3D Simplex noise based on Ashima Arts / Stefan Gustavson
const simplexNoiseGLSL = `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const vertexShader = `
uniform float uTime;
uniform float uBaseRadius;
uniform float uScale;
uniform float uSize;
uniform float uPixelRatio;

// Smooth state parameters interpolated on CPU and passed to GPU
uniform float uColorShift;     // negative = shift towards blue/cyan, positive = shift towards violet/pink
uniform float uVibration;      // high-frequency listening quiver
uniform float uChaos;          // turbulence & chaotic surface ripples for thinking
uniform float uAudioWave;      // rhythmic radial waves for speaking
uniform float uAudioIntensity; // speech pulse amplitude
uniform float uMuted;          // 0.0 = vibrant palette, 1.0 = desaturated/dull for disconnected state

varying vec3 vColor;
varying float vAlpha;

${simplexNoiseGLSL}

void main() {
  vec3 norm = normalize(position);

  // Time base for wave octaves
  float t = uTime;

  // Harmonic displacement with chaos/thinking modulation
  float freqScale = 1.0 + uChaos * 0.75;
  float ampChaos  = 1.0 + uChaos * 0.45;

  float n1 = snoise(norm * (1.15 * freqScale) + vec3(0.0, t * 0.16, t * 0.09)) * (0.24 * ampChaos);
  float n2 = snoise(norm * (2.30 * freqScale) + vec3(t * 0.11, 3.0, t * 0.13)) * (0.12 * ampChaos);
  float n3 = snoise(norm * (4.60 * freqScale) + vec3(t * 0.05, 6.5, t * 0.06)) * (0.04 * ampChaos);

  // Listening vibration: high frequency localized shiver/quiver
  float vibrationEffect = sin(uTime * 32.0 + norm.y * 16.0 + norm.x * 14.0) * 0.024 * uVibration;

  // Speaking wave: rhythmic expanding waves from center outward along surface
  float wavePattern = sin(uTime * 9.0 - length(norm.xy) * 6.5) * 0.075 * uAudioWave * uAudioIntensity;

  // Calm breathing pulse combined with speaking wave dynamics
  float breathe = 1.0 + sin(uTime * 0.85) * 0.025 + wavePattern;

  float displacement = (1.0 + n1 + n2 + n3 + vibrationEffect) * breathe;
  vec3 newPosition = norm * (uBaseRadius * uScale) * displacement;

  // Vertex color gradient with uColorShift modulation
  // Shift factor: negative shifts towards cyan/blue (listening), positive shifts towards violet/rose (speaking)
  float grad = (newPosition.y * 0.72 - newPosition.x * 0.42 - newPosition.z * 0.22);
  float shiftedGrad = grad - (uColorShift * 0.75);
  float gradFactor = clamp((shiftedGrad + 1.25) / 2.5, 0.0, 1.0);

  // Exact reference color stops: Magenta-Rose -> Violet -> Indigo -> Blue -> Cyan
  vec3 colPink   = vec3(0.851, 0.275, 0.937); // #D946EF
  vec3 colViolet = vec3(0.710, 0.396, 0.961); // #B565F5
  vec3 colIndigo = vec3(0.388, 0.400, 0.945); // #6366F1
  vec3 colBlue   = vec3(0.290, 0.620, 1.000); // #4A9EFF
  vec3 colCyan   = vec3(0.220, 0.741, 0.973); // #38BDF8

  vec3 finalColor;
  if (gradFactor < 0.26) {
    finalColor = mix(colPink, colViolet, gradFactor / 0.26);
  } else if (gradFactor < 0.58) {
    finalColor = mix(colViolet, colIndigo, (gradFactor - 0.26) / 0.32);
  } else if (gradFactor < 0.86) {
    finalColor = mix(colIndigo, colBlue, (gradFactor - 0.58) / 0.28);
  } else {
    finalColor = mix(colBlue, colCyan, (gradFactor - 0.86) / 0.14);
  }

  // Accentuate color bias: speaking enhances rose/pink shimmer, listening enhances electric blue/cyan
  if (uColorShift > 0.0) {
    finalColor = mix(finalColor, colPink, uColorShift * 0.28 * (0.6 + 0.4 * sin(uTime * 7.0)));
  } else if (uColorShift < 0.0) {
    finalColor = mix(finalColor, colCyan, -uColorShift * 0.32);
  }

  // If disconnected or muted, gracefully fade to desaturated matte slate-gray
  if (uMuted > 0.0) {
    vec3 grayTone = vec3(0.25, 0.26, 0.30);
    finalColor = mix(finalColor, grayTone, uMuted * 0.88);
  }

  vColor = finalColor;
  vAlpha = 0.95 - (uMuted * 0.40);

  vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Responsive point size with distance attenuation
  gl_PointSize = uSize * uPixelRatio * (280.0 / -mvPosition.z);
}
`;

const fragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Render circular point with smooth anti-aliased edge
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) {
    discard;
  }
  float edgeAlpha = smoothstep(0.5, 0.42, dist);
  gl_FragColor = vec4(vColor, vAlpha * edgeAlpha);
}
`;

interface AnimatedState {
  scale: number;
  rotationSpeed: number;
  noiseSpeed: number;
  colorShift: number;
  vibration: number;
  chaos: number;
  audioWave: number;
  muted: number;
}

const STATE_TARGETS: Record<OrbState, AnimatedState> = {
  idle: {
    scale: 1.0,
    rotationSpeed: (Math.PI * 2) / 25.6, // ~0.245 rad/sec
    noiseSpeed: 0.35,
    colorShift: 0.0,
    vibration: 0.0,
    chaos: 0.0,
    audioWave: 0.0,
    muted: 0.0,
  },
  listening: {
    scale: 0.90, // Contracted by 10%
    rotationSpeed: 0.16, // Calm, attentive rotation
    noiseSpeed: 0.55,
    colorShift: -0.65, // Strong shift towards cyan/blue
    vibration: 1.0, // High-frequency active listening quiver
    chaos: 0.05,
    audioWave: 0.0,
    muted: 0.0,
  },
  speaking: {
    scale: 1.06, // Slightly expanded, pulses with rhythmic speech
    rotationSpeed: 0.28,
    noiseSpeed: 0.65,
    colorShift: 0.65, // Shift towards violet/magenta/rose
    vibration: 0.08,
    chaos: 0.25,
    audioWave: 1.0, // Expanding wave rings from center
    muted: 0.0,
  },
  thinking: {
    scale: 1.01,
    rotationSpeed: 0.72, // Noticeably faster rotation (~3x idle)
    noiseSpeed: 1.35, // Rapid, turbulent noise surface
    colorShift: 0.10,
    vibration: 0.25,
    chaos: 1.0, // Chaotic surface deformation
    audioWave: 0.0,
    muted: 0.0,
  },
  searching: {
    scale: 1.02,
    rotationSpeed: 0.65,
    noiseSpeed: 1.2,
    colorShift: 0.85, // Warm amber / golden
    vibration: 0.15,
    chaos: 0.7,
    audioWave: 0.0,
    muted: 0.0,
  },
  planning: {
    scale: 1.04,
    rotationSpeed: 0.70,
    noiseSpeed: 1.25,
    colorShift: 0.35, // Dual tone energy
    vibration: 0.2,
    chaos: 0.8,
    audioWave: 0.0,
    muted: 0.0,
  },
  muted: {
    scale: 0.92,
    rotationSpeed: 0.1,
    noiseSpeed: 0.2,
    colorShift: 0.0,
    vibration: 0.0,
    chaos: 0.0,
    audioWave: 0.0,
    muted: 1.0, // Gray/dimmed
  },
  blocked: {
    scale: 0.88,
    rotationSpeed: 0.08,
    noiseSpeed: 0.2,
    colorShift: -1.2, // Deep warning red
    vibration: 0.35,
    chaos: 0.0,
    audioWave: 0.0,
    muted: 0.5,
  },
  disconnected: {
    scale: 0.86,
    rotationSpeed: 0.06, // Sluggish rotation
    noiseSpeed: 0.15, // Low motion
    colorShift: 0.0,
    vibration: 0.0,
    chaos: 0.0,
    audioWave: 0.0,
    muted: 1.0, // Gray/dimmed
  },
  error: {
    scale: 0.88,
    rotationSpeed: 0.05,
    noiseSpeed: 0.22,
    colorShift: -1.35, // Intense warning red
    vibration: 0.45,
    chaos: 0.08,
    audioWave: 0.0,
    muted: 0.4,
  },
};

interface ParticleOrbProps {
  state?: OrbState;
  transparentBackground?: boolean;
  audioIntensity?: number;
}

export default function ParticleOrb({
  state = 'idle',
  transparentBackground = false,
  audioIntensity = 0,
}: ParticleOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OrbState>(state);
  const audioIntensityRef = useRef<number>(audioIntensity);

  // Keep stateRef and audioIntensityRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    audioIntensityRef.current = audioIntensity;
  }, [audioIntensity]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;

    // 1. Scene setup
    const scene = new THREE.Scene();
    if (!transparentBackground) {
      scene.background = new THREE.Color(0x000000);
    } else {
      scene.background = null;
    }

    // 2. Camera setup with well-proportioned framing
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    const updateCameraDistance = (w: number, h: number) => {
      const aspect = w / h;
      const minDimension = Math.min(w, h);
      let baseDistance = 8.2;
      if (minDimension < 500) {
        baseDistance = 8.2 * (500 / Math.max(minDimension, 260));
      }
      camera.position.z = aspect < 1 ? baseDistance / Math.max(aspect * 0.9, 0.55) : baseDistance;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);
    };
    updateCameraDistance(width, height);

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (transparentBackground) {
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(0x000000, 1);
    }
    container.appendChild(renderer.domElement);

    // 4. Geometry and Quality Tiers for Adaptive Performance
    const QUALITY_TIERS = {
      high: { widthSegments: 160, heightSegments: 112, size: 0.035 },
      medium: { widthSegments: 112, heightSegments: 78, size: 0.042 },
      low: { widthSegments: 80, heightSegments: 56, size: 0.052 },
    } as const;

    type QualityTier = keyof typeof QUALITY_TIERS;
    let currentQuality: QualityTier = 'high';

    let currentGeometry = new THREE.SphereGeometry(
      1.0,
      QUALITY_TIERS.high.widthSegments,
      QUALITY_TIERS.high.heightSegments
    );

    const shaderMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBaseRadius: { value: 1.35 },
        uScale: { value: 1.0 },
        uSize: { value: QUALITY_TIERS.high.size },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uColorShift: { value: 0.0 },
        uVibration: { value: 0.0 },
        uChaos: { value: 0.0 },
        uAudioWave: { value: 0.0 },
        uAudioIntensity: { value: 0.0 },
        uMuted: { value: 0.0 },
      },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(currentGeometry, shaderMaterial);

    const setQualityLevel = (newQuality: QualityTier) => {
      if (newQuality === currentQuality) return;
      console.log(`[ParticleOrb Adaptive] Adaptation automatique des performances : ${currentQuality} -> ${newQuality}`);
      currentQuality = newQuality;
      const config = QUALITY_TIERS[newQuality];

      // Remplacement chirurgical de la géométrie Three.js sans réinitialiser la scène ni les shaders
      const oldGeom = points.geometry;
      currentGeometry = new THREE.SphereGeometry(1.0, config.widthSegments, config.heightSegments);
      points.geometry = currentGeometry;
      oldGeom.dispose();

      // Ajustement subtil de la taille de point pour conserver le volume visuel
      shaderMaterial.uniforms.uSize.value = config.size;
    };

    const initialRotX = 0.32;
    const initialRotY = -0.38;
    const initialRotZ = 0.12;

    points.rotation.x = initialRotX;
    points.rotation.y = initialRotY;
    points.rotation.z = initialRotZ;

    scene.add(points);

    // 5. Smooth Interpolation & 60fps Animation Loop
    const currentValues: AnimatedState = { ...STATE_TARGETS[stateRef.current] };
    let currentYRotation = initialRotY;
    let accumulatedShaderTime = 0;

    // Métriques et adaptation automatique de performance
    let frameCounter = 0;
    let windowStartTime = performance.now();
    let isInitialAssessmentComplete = false;
    const INITIAL_ASSESSMENT_MS = 3500; // Mesure initiale sur les 3.5 premières secondes
    const PERIODIC_ASSESSMENT_MS = 10000; // Réévaluation périodique toutes les 10 secondes

    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Mesure du framerate et adaptation dynamique de la géométrie
      if (typeof document === 'undefined' || !document.hidden) {
        frameCounter++;
        const now = performance.now();
        const elapsed = now - windowStartTime;

        if (!isInitialAssessmentComplete) {
          if (elapsed >= INITIAL_ASSESSMENT_MS) {
            isInitialAssessmentComplete = true;
            const measuredFps = (frameCounter * 1000) / elapsed;
            frameCounter = 0;
            windowStartTime = now;

            if (measuredFps < 40) {
              setQualityLevel('low');
            } else if (measuredFps < 50) {
              setQualityLevel('medium');
            }
          }
        } else if (elapsed >= PERIODIC_ASSESSMENT_MS) {
          const measuredFps = (frameCounter * 1000) / elapsed;
          frameCounter = 0;
          windowStartTime = now;

          // Hystérésis pour éviter tout effet de yoyo / oscillation
          if (currentQuality === 'high') {
            if (measuredFps < 48) {
              setQualityLevel('medium');
            }
          } else if (currentQuality === 'medium') {
            if (measuredFps < 44) {
              setQualityLevel('low');
            } else if (measuredFps >= 57) {
              setQualityLevel('high');
            }
          } else if (currentQuality === 'low') {
            if (measuredFps >= 55) {
              setQualityLevel('medium');
            }
          }
        }
      } else {
        // En arrière-plan (onglet masqué), réinitialiser la fenêtre de mesure
        windowStartTime = performance.now();
        frameCounter = 0;
      }

      const delta = Math.min(clock.getDelta(), 0.1);
      const targetValues = STATE_TARGETS[stateRef.current];

      // Exponential smoothing over ~0.5s (lerpFactor ~0.95 at 0.5s)
      const lerpFactor = 1.0 - Math.exp(-delta * 6.0);

      currentValues.scale += (targetValues.scale - currentValues.scale) * lerpFactor;
      currentValues.rotationSpeed += (targetValues.rotationSpeed - currentValues.rotationSpeed) * lerpFactor;
      currentValues.noiseSpeed += (targetValues.noiseSpeed - currentValues.noiseSpeed) * lerpFactor;
      currentValues.colorShift += (targetValues.colorShift - currentValues.colorShift) * lerpFactor;
      currentValues.vibration += (targetValues.vibration - currentValues.vibration) * lerpFactor;
      currentValues.chaos += (targetValues.chaos - currentValues.chaos) * lerpFactor;
      currentValues.audioWave += (targetValues.audioWave - currentValues.audioWave) * lerpFactor;
      currentValues.muted += (targetValues.muted - currentValues.muted) * lerpFactor;

      // Advance time dynamically based on interpolated noise speed
      accumulatedShaderTime += delta * currentValues.noiseSpeed;
      shaderMaterial.uniforms.uTime.value = accumulatedShaderTime;

      // Update uniforms
      shaderMaterial.uniforms.uScale.value = currentValues.scale;
      shaderMaterial.uniforms.uColorShift.value = currentValues.colorShift;
      shaderMaterial.uniforms.uVibration.value = currentValues.vibration;
      shaderMaterial.uniforms.uChaos.value = currentValues.chaos;
      shaderMaterial.uniforms.uAudioWave.value = currentValues.audioWave;
      shaderMaterial.uniforms.uMuted.value = currentValues.muted;

      // Speech envelope: real audio intensity when available, or fallback to simulated envelope
      let speechIntensity: number;
      const realIntensity = audioIntensityRef.current;
      if (typeof realIntensity === 'number' && realIntensity > 0) {
        // Boost dynamic range for visible particle pulsation synchronized to actual speech
        speechIntensity = Math.min(1.6, Math.max(0.18, realIntensity * 2.2));
      } else {
        const totalElapsed = clock.getElapsedTime();
        const rawSpeech =
          Math.sin(totalElapsed * 5.2) * 0.45 +
          Math.sin(totalElapsed * 8.7) * 0.35 +
          Math.cos(totalElapsed * 2.8) * 0.30;
        speechIntensity = Math.max(0.15, rawSpeech + 0.45);
      }
      shaderMaterial.uniforms.uAudioIntensity.value = speechIntensity;

      // Smooth vertical Y rotation
      currentYRotation += delta * currentValues.rotationSpeed;
      points.rotation.y = currentYRotation;

      renderer.render(scene, camera);
    };

    animate();

    // 6. Responsiveness & Resize Observer
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth || window.innerWidth;
      height = container.clientHeight || window.innerHeight;

      camera.aspect = width / height;
      updateCameraDistance(width, height);
      camera.updateProjectionMatrix();

      const pixelRatio = Math.min(window.devicePixelRatio, 2);
      renderer.setSize(width, height);
      renderer.setPixelRatio(pixelRatio);
      shaderMaterial.uniforms.uPixelRatio.value = pixelRatio;
    };

    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    // WebGL Context recovery listeners
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(animationFrameId);
    };
    const handleContextRestored = () => {
      animate();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    // Visibility change listener (éviter de fausser les calculs FPS si onglet masqué)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        windowStartTime = performance.now();
        frameCounter = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 7. Comprehensive cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      clock.stop();
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      if (container.contains(canvas)) {
        container.removeChild(canvas);
      }

      currentGeometry.dispose();
      shaderMaterial.dispose();
      renderer.dispose();
    };
  }, [transparentBackground]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    />
  );
}
