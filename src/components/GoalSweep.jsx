import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'

// Goal celebration light pass: one additive plane over the turf, one draw call.
// Layered fields in a single fragment shader (Active Theory-style energy pass):
//   1. impact flash + expanding chromatic shockwave ring at the goal mouth
//   2. a noise-ripped white-hot crest sweeping goal -> player, warm/cool
//      chromatic fringes on its leading/trailing edges
//   3. speed-line streaks trailing the crest
//   4. a fading electric-blue energy grid revealed in the crest's wake
// toneMapped=false + additive: the crest/flash cores sit past the bloom
// threshold and glow. Idle cost is one early-returned useFrame
// (uProgress parked at >1.3 = invisible, shader never runs via discard).
// ponytail: everything derives from uProgress — no uTime uniform needed.

const SWEEP_TIME = 1.25 // seconds for the crest to cross the field
const uniforms = {
  uProgress: { value: 2 }, // >1.3 = off
}

// Plane is 46x72 at GLB-local (0, 0.08, -3); the goal line (GOAL_Z=-12.82)
// lands at plane-local y = +9.82 (uv-space y ~0.636). GOAL_P below.
const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uProgress;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    const vec2 GOAL_P = vec2(0.0, 9.82); // goal mouth in plane-local units

    void main() {
      vec2 p = (vUv - 0.5) * vec2(46.0, 72.0);
      float t = uProgress;
      float time = t * 1.25; // shader clock tied to the sweep

      float fade = smoothstep(1.3, 0.9, t);
      float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);

      // -- 2. sweep crest: noise-ripped gaussian band, goal -> player --
      float bandY = mix(GOAL_P.y, -38.0, t);
      float ripple = (noise(vec2(p.x * 0.16, time * 4.0)) - 0.5) * 2.6;
      float d = p.y - bandY + ripple; // >0 = already swept (wake side)
      float crest = exp(-d * d * 0.55);
      float crestWarm = exp(-(d - 0.9) * (d - 0.9) * 0.5); // leading fringe
      float crestCool = exp(-(d + 0.9) * (d + 0.9) * 0.5); // trailing fringe

      // -- 3. speed lines: elongated streaks riding/trailing the crest --
      float lines = pow(0.5 + 0.5 * sin(p.x * 2.4 + ripple * 3.0), 10.0)
                  * exp(-d * d * 0.05) * 0.6;

      // -- 4. wake: fading electric grid revealed behind the crest --
      float behind = smoothstep(0.0, 1.5, d);
      float wakeFall = exp(-d * 0.09);
      vec2 g = abs(fract(p / 3.2) - 0.5);
      float grid = smoothstep(0.09, 0.015, min(g.x, g.y));
      float scan = 0.75 + 0.25 * sin(p.y * 2.0 - time * 30.0);
      float wake = behind * wakeFall * (grid * 0.6 + 0.09) * scan;

      // -- 1. goal-mouth impact: flash + expanding chromatic shockwave --
      float r = length(p - GOAL_P);
      float flash = exp(-r * 0.12) * exp(-t * 7.0) * 1.5;
      float rw = r - t * 46.0;
      float ringEnv = exp(-t * 2.4);
      float ring = exp(-rw * rw * 0.12) * ringEnv;
      float ringWarm = exp(-(rw - 1.3) * (rw - 1.3) * 0.12) * ringEnv;
      float ringCool = exp(-(rw + 1.3) * (rw + 1.3) * 0.12) * ringEnv;

      const vec3 CORE = vec3(1.6, 1.75, 1.9);  // white-hot, past bloom threshold
      const vec3 CYAN = vec3(0.35, 1.4, 1.8);
      const vec3 BLUE = vec3(0.15, 0.45, 1.5);
      const vec3 WARM = vec3(1.5, 0.55, 0.4);

      vec3 col = CORE * crest
               + WARM * crestWarm * 0.35
               + BLUE * crestCool * 0.4
               + CYAN * lines
               + BLUE * wake * 0.85
               + CORE * flash
               + CYAN * ring * 0.8
               + WARM * ringWarm * 0.3
               + BLUE * ringCool * 0.3;
      col *= edge * fade;

      if (max(col.r, max(col.g, col.b)) < 0.004) discard;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
})

export function GoalSweep() {
  const st = useRef(null)
  useLayoutEffect(() => {
    st.current ??= { t: Infinity }
  }, [])

  useStadiumEvent('stadium:goal', () => {
    if (st.current) st.current.t = 0
  })

  useFrame((_, delta) => {
    const s = st.current
    if (!s || s.t === Infinity) return
    s.t += delta
    const p = s.t / SWEEP_TIME
    uniforms.uProgress.value = p
    if (p > 1.3) s.t = Infinity // parked off
  })

  // Matches PitchTurf's overlay plane, a touch higher so it sits above it.
  return (
    <mesh position={[0, 0.08, -3]} rotation-x={-Math.PI / 2} renderOrder={3} material={material}>
      <planeGeometry args={[46, 72]} />
    </mesh>
  )
}
