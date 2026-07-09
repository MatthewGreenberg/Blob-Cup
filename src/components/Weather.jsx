import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { STADIUM_POS } from '../game/constants'
import { mulberry32 } from '../utils/random'

// Coupled weather system: falling precipitation, ground splashes, and the
// surface response (wet sheen / puddles / snow cover) all read the SAME
// shared envelope + wind + clock uniforms, so the pitch visibly reacts to
// what's falling on it instead of particles floating over a dry field.
//  - rain: GPU-wrapped instanced streaks (velocity-aligned billboards),
//    splash rings on the turf, a wet-darkening + puddle overlay with analytic
//    expanding ripples and fake floodlight reflection streaks, and lightning
//    (fullscreen flash quad + an ambient pop that lights the props).
//  - snow: GPU point flakes with wind sway, and a noise-mask snow cover that
//    accumulates patchily from the noise peaks as the ground envelope ramps.
// Air envelopes damp fast (precipitation starts/stops), ground envelopes damp
// slow (the pitch wets/dries and snow builds/melts over seconds).
// Everything lives at module scope (react-compiler immutability, same as
// GoalNet/Confetti); all motion is in shaders — the only CPU per-frame work
// is writing ~8 uniform values.

const rand = mulberry32(118)

// --- shared uniforms ---------------------------------------------------------
const uTime = { value: 0 }
const uRainAir = { value: 0 } // falling rain density
const uWet = { value: 0 } // pitch wetness (slower)
const uSnowAir = { value: 0 } // falling snow density
const uSnowGround = { value: 0 } // snow cover (slowest)
const uWind = { value: new THREE.Vector3(2.1, 0, 0.55) }
const uPixelRatio = { value: 1 }
// field-snow look knobs (leva 'field snow'); cover scales the ground envelope target
const uSnowH = { value: 2 } // world-unit height of a fully-grown mound
const uSnowScale = { value: 0.12 } // mound noise frequency: low = big drifts
const uSparkle = { value: 3 }
const snowCtl = { cover: 0.25, damp: 1 }
const env = { rainAir: 0, wet: 0, snowAir: 0, snowGround: 0 }

const GLSL_HASH = /* glsl */ `
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hash21(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`

// noise + the shared snow mound height field. The ground overlay's vertex
// shader displaces by snowH and its fragment shader shades/masks from the
// same function, so the lit mounds match the silhouette exactly. This block
// declares the snow uniforms — including shaders must not redeclare them.
const GLSL_SNOW = /* glsl */ `
  uniform float uSnowGround;
  uniform float uSnowH;
  uniform float uSnowScale;
  ${GLSL_HASH}
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float a = 0.5, r = 0.0;
    for (int i = 0; i < 3; i++) { r += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return r * 1.14; // normalize 3 octaves to ~0..1
  }
  // snow mounds: a low-freq drift field picks where snow piles; the threshold
  // rides the ground envelope so cover grows outward from the peaks, and snow
  // piles extra against the side hoardings. Returns 0..~1 mound height.
  float snowH(vec2 p) {
    float sn = fbm(p * uSnowScale);
    float drift = fbm(p * uSnowScale * 3.36 + 31.7);
    sn += smoothstep(11.0, 20.0, abs(p.x)) * 0.22;
    float th = 1.0 - uSnowGround * 0.9;
    float m = smoothstep(th, th + 0.45, sn + drift * 0.22);
    return m * (0.55 + 0.45 * drift);
  }
`

// --- rain streaks ------------------------------------------------------------
// Fixed world volume over the stadium bowl, wrapped with mod() so there are no
// emitter edges; streaks align to the fall velocity (wind slant included) and
// billboard toward the camera around that axis.
const RAIN_COUNT = 550
const rainGeometry = new THREE.InstancedBufferGeometry()
{
  const quad = new THREE.PlaneGeometry(0.05, 1)
  rainGeometry.index = quad.index
  rainGeometry.setAttribute('position', quad.attributes.position)
  rainGeometry.setAttribute('uv', quad.attributes.uv)
  rainGeometry.instanceCount = RAIN_COUNT
  const seeds = new Float32Array(RAIN_COUNT * 3)
  const rands = new Float32Array(RAIN_COUNT)
  for (let i = 0; i < RAIN_COUNT; i++) {
    seeds[i * 3] = rand()
    seeds[i * 3 + 1] = rand()
    seeds[i * 3 + 2] = rand()
    rands[i] = rand()
  }
  rainGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3))
  rainGeometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1))
}
const rainMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime, uRainAir, uWind },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uRainAir;
    uniform vec3 uWind;
    attribute vec3 aSeed;
    attribute float aRand;
    varying vec2 vUv;
    varying float vGate;
    void main() {
      vUv = uv;
      float speed = mix(19.0, 30.0, aRand);
      vec3 vol = vec3(46.0, 26.0, 74.0);
      vec3 origin = vec3(-23.0, 0.0, -38.0);
      vec3 disp = vec3(uWind.x, -speed, uWind.z) * uTime;
      vec3 anchor = mod(aSeed * vol + disp, vol) + origin;
      // streak lies along the fall velocity, camera-facing around that axis
      vec3 axis = normalize(vec3(-uWind.x, speed, -uWind.z));
      vec3 right = normalize(cross(axis, cameraPosition - anchor));
      float len = mix(0.6, 1.1, fract(aRand * 7.13)) * (0.55 + 0.45 * uRainAir);
      vec3 p = anchor + right * position.x + axis * position.y * len;
      // density: each drop has a rank, light rain shows only the low ranks
      float rank = fract(aRand * 5.7);
      vGate = smoothstep(rank, rank + 0.08, uRainAir * 1.03);
      vGate *= smoothstep(-0.2, 0.9, anchor.y) * smoothstep(26.0, 24.0, anchor.y);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    varying float vGate;
    void main() {
      float x = abs(vUv.x - 0.5) * 2.0;
      float core = 1.0 - x * x;
      float taper = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.62, vUv.y);
      float head = mix(1.15, 0.55, vUv.y); // brighter toward the falling end
      gl_FragColor = vec4(vec3(0.62, 0.72, 0.88), core * taper * head * 0.34 * vGate);
    }
  `,
})
const rainMesh = new THREE.Mesh(rainGeometry, rainMaterial)
rainMesh.frustumCulled = false

// --- splash rings ------------------------------------------------------------
// Fully GPU: each instance loops its own cycle, re-hashing a fresh pitch
// position every cycle. Lives inside the stadium group (GLB-local coords).
const SPLASH_COUNT = 90
const splashGeometry = new THREE.InstancedBufferGeometry()
{
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  splashGeometry.index = quad.index
  splashGeometry.setAttribute('position', quad.attributes.position)
  splashGeometry.setAttribute('uv', quad.attributes.uv)
  splashGeometry.instanceCount = SPLASH_COUNT
  const rands = new Float32Array(SPLASH_COUNT)
  for (let i = 0; i < SPLASH_COUNT; i++) rands[i] = rand()
  splashGeometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1))
}
const splashMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime, uRainAir },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uRainAir;
    attribute float aRand;
    varying vec2 vUv;
    varying float vT;
    varying float vGate;
    ${GLSL_HASH}
    void main() {
      vUv = uv;
      float rate = mix(0.8, 1.5, fract(aRand * 3.1));
      float cycle = uTime * rate + aRand * 43.0;
      float ci = floor(cycle);
      vT = fract(cycle);
      vec2 h = hash21(aRand * 91.7 + ci * 7.3);
      vec3 center = vec3((h.x - 0.5) * 42.0, 0.0, -3.0 + (h.y - 0.5) * 66.0);
      float s = mix(0.45, 0.95, hash11(aRand * 17.0 + ci));
      float rank = fract(aRand * 5.3);
      vGate = smoothstep(rank, rank + 0.1, uRainAir);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position * s, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    varying float vT;
    varying float vGate;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float ring = smoothstep(0.16, 0.02, abs(d - vT * 0.88));
      float pop = smoothstep(0.22, 0.0, d) * smoothstep(0.18, 0.0, vT);
      float fade = (1.0 - vT) * (1.0 - vT);
      gl_FragColor = vec4(vec3(0.75, 0.85, 1.0), (ring * fade * 0.55 + pop * 0.6) * vGate);
    }
  `,
})
const splashMesh = new THREE.Mesh(splashGeometry, splashMaterial)
splashMesh.frustumCulled = false
splashMesh.position.y = 0.072
splashMesh.renderOrder = 2.7 // over the wet overlay, under GoalSweep (3)

// --- snow flakes ---------------------------------------------------------------
const SNOW_COUNT = 1000
const snowGeometry = new THREE.BufferGeometry()
{
  // position stores the normalized spawn seed; the vertex shader owns motion
  const seeds = new Float32Array(SNOW_COUNT * 3)
  const rands = new Float32Array(SNOW_COUNT)
  const sizes = new Float32Array(SNOW_COUNT)
  for (let i = 0; i < SNOW_COUNT; i++) {
    seeds[i * 3] = rand()
    seeds[i * 3 + 1] = rand()
    seeds[i * 3 + 2] = rand()
    rands[i] = rand()
    sizes[i] = 0.35 + rand() * 0.65
  }
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3))
  snowGeometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 1))
  snowGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
}
const snowMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime, uSnowAir, uWind, uPixelRatio },
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uSnowAir;
    uniform vec3 uWind;
    uniform float uPixelRatio;
    attribute float aRand;
    attribute float aSize;
    varying float vGate;
    void main() {
      float r = aRand;
      float speed = mix(1.3, 2.8, fract(r * 3.7));
      vec3 vol = vec3(46.0, 24.0, 74.0);
      vec3 origin = vec3(-23.0, 0.0, -38.0);
      vec3 disp = vec3(uWind.x * 0.32, -speed, uWind.z * 0.32) * uTime;
      vec3 p = mod(position * vol + disp, vol) + origin;
      p.x += sin(uTime * (0.4 + r * 0.9) + r * 6.28) * (0.5 + r * 0.9);
      p.z += cos(uTime * (0.3 + r * 0.6) + r * 4.0) * 0.5;
      float rank = fract(r * 5.7);
      vGate = smoothstep(rank, rank + 0.1, uSnowAir * 1.03);
      vGate *= smoothstep(0.0, 0.8, p.y) * smoothstep(24.0, 22.0, p.y);
      vGate *= 0.75 + 0.25 * sin(uTime * (1.5 + 2.0 * r) + r * 40.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      // gl_PointSize is device px — scale by pixelRatio or retina halves flakes
      gl_PointSize = min(aSize * uPixelRatio * (300.0 / -mv.z), 28.0 * uPixelRatio);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vGate;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = smoothstep(1.0, 0.15, d);
      gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), a * a * 0.9 * vGate);
    }
  `,
})
const snowPoints = new THREE.Points(snowGeometry, snowMaterial)
snowPoints.frustumCulled = false

// --- ground response (wet sheen / puddles / snow cover) -----------------------
// One overlay plane matching PitchTurf's footprint, alpha-blended over the
// baked turf. Rain: noise-mottled darkening, then puddles (fbm mask) with
// analytic expanding rain-ripple rings and fake reflection streaks from the
// back floodlights + goal glow. Snow: cover mask whose threshold rides the
// ground envelope, so snow builds up patchily from the noise peaks; sparkle
// glints push past the bloom threshold and glisten.
const groundMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime, uWet, uSnowGround, uSnowH, uSnowScale, uSparkle },
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    ${GLSL_SNOW}
    void main() {
      vUv = uv;
      vec2 wp = vec2((uv.x - 0.5) * 46.0, -3.0 - (uv.y - 0.5) * 72.0);
      // plane is rotated flat, local +z = world up: raise the snow mounds
      vec3 pos = position;
      pos.z += snowH(wp) * uSnowH * uSnowGround;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uWet;
    uniform float uSparkle;
    varying vec2 vUv;
    ${GLSL_SNOW}
    // expanding rain-impact rings, one per cell per cycle (brightness field)
    float ripples(vec2 p) {
      vec2 i0 = floor(p);
      float acc = 0.0;
      for (int j = -1; j <= 1; j++)
        for (int i = -1; i <= 1; i++) {
          vec2 pi = i0 + vec2(float(i), float(j));
          vec2 c = pi + vec2(hash12(pi), hash12(pi + 7.3));
          float t = fract(uTime * 0.55 + hash12(pi * 1.7));
          float d = length(p - c) - t * 1.4;
          acc += sin(24.0 * d) * smoothstep(0.0, -0.25, d) * (1.0 - t) * (1.0 - t);
        }
      return acc;
    }
    void main() {
      // uv -> stadium-local xz (plane is 46x72 at local (0,_,-3), rotated flat)
      vec2 wp = vec2((vUv.x - 0.5) * 46.0, -3.0 - (vUv.y - 0.5) * 72.0);
      vec3 col = vec3(0.0);
      float alpha = 0.0;

      float wetP = smoothstep(0.0, 0.7, uWet);
      float pudP = smoothstep(0.35, 1.0, uWet); // puddles arrive late
      if (wetP > 0.001) {
        float mottle = 0.75 + 0.5 * fbm(wp * 0.33);
        alpha = 0.32 * wetP * mottle;
        col = vec3(0.02, 0.05, 0.08);

        float mask = smoothstep(mix(0.78, 0.52, pudP), mix(0.78, 0.52, pudP) + 0.22, fbm(wp * 0.17)) * pudP;
        float rip = clamp(ripples(wp * 1.25), -1.0, 1.0);
        // fake reflections: back floodlight pair + goal-mouth glow, streaking
        // toward the camera, shimmering with the ripples
        float zfade = smoothstep(10.0, -30.0, wp.y); // wp.y = stadium-local z
        float lights = exp(-pow((wp.x - 12.0) / 2.6, 2.0)) + exp(-pow((wp.x + 12.0) / 2.6, 2.0));
        float goalGlow = exp(-pow(wp.x / 3.4, 2.0));
        vec3 streak = (lights * vec3(1.0, 0.85, 0.62) + goalGlow * vec3(0.8, 0.9, 1.0)) * zfade;
        vec3 puddle = vec3(0.05, 0.09, 0.15) + streak * (0.35 + 0.3 * rip) + vec3(0.5, 0.65, 0.85) * max(rip, 0.0) * 0.22;
        col = mix(col, puddle, mask);
        alpha = max(alpha, mask * 0.6);
        col += streak * 0.05 * wetP; // faint sheen outside puddles too
        alpha += dot(streak, vec3(0.33)) * 0.1 * wetP;
      }

      if (uSnowGround > 0.001) {
        float h = snowH(wp);
        // finite-difference normal of the displaced mound surface (world y-up)
        float e = 0.5;
        float sx = (snowH(wp + vec2(e, 0.0)) - h) / e * uSnowH * uSnowGround;
        float sz = (snowH(wp + vec2(0.0, e)) - h) / e * uSnowH * uSnowGround;
        vec3 n = normalize(vec3(-sx * 2.4, 1.0, -sz * 2.4)); // slopes exaggerated so mounds read
        vec3 ldir = normalize(vec3(-0.55, 0.75, 0.35)); // matches the warm key light
        float ndl = clamp(dot(n, ldir), 0.0, 1.0);
        vec3 snow = mix(vec3(0.52, 0.6, 0.78), vec3(0.97, 0.98, 1.0), ndl);
        snow += vec3(1.0, 0.88, 0.7) * pow(ndl, 5.0) * 0.2; // warm crest glint
        snow *= mix(vec3(0.78, 0.83, 0.95), vec3(1.0), smoothstep(0.04, 0.3, h)); // cool rim shadow grounding the base
        // sparkle glints on lit faces (past the bloom threshold -> tiny glows)
        float hg = hash12(floor(wp * 9.0));
        snow += smoothstep(0.986, 1.0, hg) * (0.5 + 0.5 * sin(uTime * 2.2 + hg * 43.0)) * ndl * vec3(0.55) * uSparkle;
        float mask = smoothstep(0.02, 0.13, h) * smoothstep(0.0, 0.12, uSnowGround);
        // faint frost dusting between the mounds so the grass reads cold, not bare
        float dust = smoothstep(0.5, 0.95, vnoise(wp * 1.4)) * (1.0 - mask) * smoothstep(0.25, 1.0, uSnowGround);
        col = mix(col, vec3(0.85, 0.89, 0.95), dust * 0.28);
        alpha = max(alpha, dust * 0.3);
        col = mix(col, snow, mask);
        alpha = max(alpha, mask * 0.97);
      }

      gl_FragColor = vec4(col, alpha);
    }
  `,
})
// subdivided so the vertex shader can raise real snow mounds out of the plane
const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(46, 72, 120, 188), groundMaterial)
groundMesh.rotation.x = -Math.PI / 2
groundMesh.position.set(0, 0.068, -3)
groundMesh.renderOrder = 2.5 // over turf(1)+logo(2), under splashes/GoalSweep

// --- lightning -----------------------------------------------------------------
// A fullscreen additive quad parked in front of the camera flashes the whole
// frame (the baked stadium is unlit, so a light alone can't touch it) while an
// ambient pop lights the props. Double-pulse envelope like a real strike.
const flashMaterial = new THREE.MeshBasicMaterial({
  color: '#dfe9ff',
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})
const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flashMaterial)
flashMesh.scale.set(5, 2.5, 1)
flashMesh.renderOrder = 999
flashMesh.frustumCulled = false
flashMesh.visible = false
const flashLight = new THREE.AmbientLight('#cfe0ff', 0)
const storm = { armed: false, start: -10, next: 0 }

export function Weather({ weather }) {
  useControls('field snow', {
    cover: { value: 0.25, min: 0, max: 1, step: 0.01, onChange: (v) => (snowCtl.cover = v) },
    height: { value: 2, min: 0, max: 3, step: 0.01, onChange: (v) => (uSnowH.value = v) },
    scale: { value: 0.12, min: 0.02, max: 0.4, step: 0.005, onChange: (v) => (uSnowScale.value = v) },
    buildSpeed: { value: 1, min: 0.05, max: 3, step: 0.05, onChange: (v) => (snowCtl.damp = v) },
    sparkle: { value: 3, min: 0, max: 4, step: 0.05, onChange: (v) => (uSparkle.value = v) },
  })

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const isRain = weather === 'rain'
    const isSnow = weather === 'snow'

    // air fast, ground slow — precipitation leads, the surface follows
    env.rainAir = THREE.MathUtils.damp(env.rainAir, isRain ? 1 : 0, 1.4, delta)
    env.wet = THREE.MathUtils.damp(env.wet, isRain ? 1 : 0, 0.5, delta)
    env.snowAir = THREE.MathUtils.damp(env.snowAir, isSnow ? 1 : 0, 1.4, delta)
    env.snowGround = THREE.MathUtils.damp(env.snowGround, isSnow ? snowCtl.cover : 0, snowCtl.damp, delta)

    uTime.value = t
    uRainAir.value = env.rainAir
    uWet.value = env.wet
    uSnowAir.value = env.snowAir
    uSnowGround.value = env.snowGround
    uPixelRatio.value = state.gl.getPixelRatio()
    // gentle near-vertical wind with a faint slow gust, shared by rain slant
    // and snow drift — one weather, one wind
    uWind.value.set(0.9 + Math.sin(t * 0.11) * 0.25, 0, 0.3 + Math.sin(t * 0.19) * 0.15)

    rainMesh.visible = env.rainAir > 0.01
    splashMesh.visible = env.rainAir > 0.02
    snowPoints.visible = env.snowAir > 0.01
    groundMesh.visible = env.wet > 0.01 || env.snowGround > 0.01

    // lightning scheduler (rain only)
    if (isRain && env.rainAir > 0.5) {
      if (!storm.armed) {
        storm.armed = true
        storm.next = t + 1.6 + Math.random() * 3
      }
      if (t >= storm.next) {
        storm.start = t
        storm.next = t + 5 + Math.random() * 9
      }
    } else if (!isRain) {
      storm.armed = false
    }
    const k = t - storm.start
    let b = 0
    if (k >= 0 && k < 0.9) {
      // main pulse + two echo flickers
      b = Math.exp(-k * 18) + 0.65 * Math.exp(-Math.abs(k - 0.16) * 30) + 0.35 * Math.exp(-Math.abs(k - 0.34) * 26)
    }
    b *= env.rainAir
    flashLight.intensity = b * 2.4
    flashMesh.visible = b > 0.004
    if (flashMesh.visible) {
      flashMaterial.opacity = Math.min(1, b) * 0.4
      flashMesh.position.copy(state.camera.position)
      flashMesh.quaternion.copy(state.camera.quaternion)
      flashMesh.translateZ(-1)
    }
  })

  return (
    <group>
      <primitive object={rainMesh} />
      <primitive object={snowPoints} />
      <primitive object={flashMesh} />
      <primitive object={flashLight} />
      {/* ground layers live in stadium/GLB-local coords like PitchTurf */}
      <group position={STADIUM_POS}>
        <primitive object={groundMesh} />
        <primitive object={splashMesh} />
      </group>
    </group>
  )
}
