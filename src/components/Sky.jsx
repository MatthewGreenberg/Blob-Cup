import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { WEATHER_BY_ID } from '../game/weather'

// seeded PRNG — Math.random is banned in render/useMemo by the purity lint
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Stars: one Points with a small custom shader — per-star pixel size (dpr-aware;
// PointsMaterial's gl_PointSize is device px, so retina screens halved the old
// sprites), procedural crisp-core/soft-halo disc, per-star twinkle, and HDR
// brightness on the big ones so bloom catches them. Geometry/material at module
// scope, same pattern as GoalNet/Jumbotron.
const STAR_COUNT = 1300
const STARS_GEO = (() => {
  const rand = mulberry32(42)
  const pos = new Float32Array(STAR_COUNT * 3)
  const col = new Float32Array(STAR_COUNT * 3)
  const size = new Float32Array(STAR_COUNT)
  const tw = new Float32Array(STAR_COUNT)
  for (let i = 0; i < STAR_COUNT; i++) {
    const az = rand() * Math.PI * 2
    // bias toward low elevations — the cameras look nearly level, so the only
    // sky ever on screen is the ~4–20° band above the stadium wall
    const el = ((4 + rand() ** 1.7 * 78) * Math.PI) / 180
    const r = 150 // just inside the 160-radius sky sphere
    pos[i * 3] = r * Math.cos(el) * Math.sin(az)
    pos[i * 3 + 1] = r * Math.sin(el)
    pos[i * 3 + 2] = r * Math.cos(el) * Math.cos(az)
    // fade only the last few degrees into the warm horizon glow
    const horizonFade = Math.min(1, Math.max(0, (el - 0.05) / 0.1))
    const bright = rand() < 0.08
    const b = (bright ? 1.6 + rand() * 0.9 : 0.9 + rand() * 0.7) * horizonFade
    // temperature: mostly warm-white, some cool blue, a few golden
    const t = rand()
    const tint = t < 0.2 ? [0.72, 0.84, 1] : t < 0.32 ? [1, 0.86, 0.66] : [1, 0.97, 0.92]
    col[i * 3] = b * tint[0]
    col[i * 3 + 1] = b * tint[1]
    col[i * 3 + 2] = b * tint[2]
    size[i] = bright ? 5.5 + rand() * 3 : 2.2 + rand() * 2 // CSS px, ×dpr in shader
    tw[i] = rand()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aTw', new THREE.BufferAttribute(tw, 1))
  return geo
})()

const STAR_MAT = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uDpr: { value: 1 }, uOpacity: { value: 1 } },
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    attribute float aSize;
    attribute float aTw;
    uniform float uTime;
    uniform float uDpr;
    varying vec3 vColor;
    void main() {
      float tw = 0.78 + 0.34 * sin(uTime * (0.5 + aTw * 1.8) + aTw * 6.2832);
      vColor = color * tw;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uDpr;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    varying vec3 vColor;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float core = smoothstep(0.4, 0.0, r);
      float halo = (1.0 - smoothstep(0.15, 1.0, r)) * 0.35;
      float a = (core + halo) * uOpacity;
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor, a);
    }
  `,
})

export function Sky({ weather }) {
  const weatherConfig = WEATHER_BY_ID[weather] ?? WEATHER_BY_ID.clear
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    const stops = [0, 0.35, 0.6, 0.82, 1]
    weatherConfig.skyStops.forEach((color, index) => gradient.addColorStop(stops[index], color))
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 4, 256)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [weatherConfig])

  useFrame((state) => {
    STAR_MAT.uniforms.uTime.value = state.clock.elapsedTime
    STAR_MAT.uniforms.uDpr.value = state.gl.getPixelRatio()
    STAR_MAT.uniforms.uOpacity.value = weatherConfig.starOpacity
  })

  return (
    <group>
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[160, 32, 16]} />
        <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} />
      </mesh>
      <points geometry={STARS_GEO} material={STAR_MAT} frustumCulled={false} />
    </group>
  )
}
