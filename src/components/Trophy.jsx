import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'
import { wireKTX2 } from '../game/ktx2'

// Golden cup for winning the FINAL: pops in spinning above the celebrating
// player's head (world z≈23, same mark as the confetti/camera close-up) with
// glinting star sparkles bursting off it, armed by stadium:matchend
// {win, final} and cleared on the next matchstart or back at the menu
// screens. Scale damps 0↔1 so it pops in and shrinks out instead of cutting.
const TROPHY_H = 1.15
const POS = [0, 4.7, 23]

// --- sparkles: additive Points with a 4-point glint sprite; per-particle
// twinkle is faked through vertex-color brightness (PointsMaterial has no
// per-particle alpha), same trick as Game's trail dots. Everything at module
// scope for the usual react-compiler immutability reason (useFrame mutates).
const SPARK_N = 42
const GOLD = new THREE.Color('#ffdf8a')
const WHITE = new THREE.Color('#fff6e0')

function makeSparkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.globalCompositeOperation = 'lighter'
  // soft core + two elongated rays = a classic 4-point glint
  const core = ctx.createRadialGradient(32, 32, 0, 32, 32, 14)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, 64, 64)
  for (const [sx, sy] of [
    [1, 0.14],
    [0.14, 1],
  ]) {
    ctx.save()
    ctx.translate(32, 32)
    ctx.scale(sx, sy)
    const ray = ctx.createRadialGradient(0, 0, 0, 0, 0, 30)
    ray.addColorStop(0, 'rgba(255,255,255,0.9)')
    ray.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = ray
    ctx.beginPath()
    ctx.arc(0, 0, 30, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sparkGeo = new THREE.BufferGeometry()
const sparkPos = new Float32Array(SPARK_N * 3)
const sparkCol = new Float32Array(SPARK_N * 3)
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3))
const sparkMat = new THREE.PointsMaterial({
  map: makeSparkTexture(),
  size: 0.34,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
  toneMapped: false,
})
const sparkPoints = new THREE.Points(sparkGeo, sparkMat)
sparkPoints.frustumCulled = false

const respawn = (p) => {
  // burst out of the cup body: mostly-horizontal direction, slight rise
  const a = Math.random() * Math.PI * 2
  const up = 0.15 + Math.random() * 0.5
  p.dir.set(Math.cos(a), up, Math.sin(a)).normalize()
  p.y0 = 0.15 + Math.random() * TROPHY_H
  p.r0 = 0.12 + Math.random() * 0.2
  p.speed = 0.5 + Math.random() * 0.7
  p.life = 0.5 + Math.random() * 0.7
  p.flick = 9 + Math.random() * 8
  p.phase = Math.random() * Math.PI * 2
  p.gold = Math.random()
  p.t = 0
}

const seed = mulberry32(5)
const sparks = Array.from({ length: SPARK_N }, () => {
  const p = { dir: new THREE.Vector3(), t: 0 }
  respawn(p)
  p.t = seed() // stagger the first cycle so they don't pulse in unison
  return p
})
const sparkColor = new THREE.Color()

export function Trophy({ screen }) {
  // on/off lives in a ref scratch (same pattern as Confetti) — only useFrame
  // reads it, nothing needs to re-render.
  const st = useRef(null)
  useLayoutEffect(() => {
    st.current ??= { on: false }
  }, [])
  const groupRef = useRef(null)
  const spinRef = useRef(null)
  // trophy.glb ships KTX2-compressed textures, so its loader needs the basis
  // transcoder wired in (same as Game's soccer-ball).
  const gl = useThree((state) => state.gl)
  const scene = useGLTF('/trophy.glb', true, true, (loader) => wireKTX2(loader, gl)).scene

  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((o) => {
      if (!o.isMesh) return
      // same gloss + fabric-rim sheen recipe as the player
      o.material = new THREE.MeshPhysicalMaterial({
        map: o.material.map,
        color: o.material.color,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
        sheen: 0.5,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color('#b9c4ff'),
      })
    })
    // Fit to TROPHY_H tall, bottom-center origin so the bob math is simple.
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = TROPHY_H / size.y
    root.scale.setScalar(s)
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    return root
  }, [scene])

  useStadiumEvent('stadium:matchend', (event) => {
    if (st.current && event.detail?.win && event.detail?.final) st.current.on = true
  })
  useStadiumEvent('stadium:matchstart', () => {
    if (st.current) st.current.on = false
  })
  useEffect(() => {
    if (st.current && (screen === 'menu' || screen === 'bracket' || screen === 'about')) st.current.on = false
  }, [screen])

  useFrame((state, delta) => {
    const g = groupRef.current
    const on = st.current?.on
    if (!g) return
    const k = THREE.MathUtils.damp(g.scale.x, on ? 1 : 0, on ? 6 : 10, delta)
    g.scale.setScalar(Math.max(k, 0.0001))
    g.visible = k > 0.01
    if (!g.visible) return
    // spin the cup only (spinRef) so the sparkles don't orbit with it
    if (spinRef.current) spinRef.current.rotation.y += delta * 1.5
    g.position.y = POS[1] + Math.sin(state.clock.elapsedTime * 1.7) * 0.12

    for (let i = 0; i < SPARK_N; i++) {
      const p = sparks[i]
      p.t += delta / p.life
      if (p.t >= 1) respawn(p)
      const d = p.r0 + p.t * p.speed
      sparkPos[i * 3] = p.dir.x * d
      sparkPos[i * 3 + 1] = p.y0 + p.dir.y * p.t * p.speed
      sparkPos[i * 3 + 2] = p.dir.z * d
      // pop in/out over the life + a fast flicker on top
      const glow =
        Math.sin(Math.min(p.t, 1) * Math.PI) *
        (0.55 + 0.45 * Math.sin(state.clock.elapsedTime * p.flick + p.phase))
      sparkColor.lerpColors(GOLD, WHITE, p.gold).multiplyScalar(glow)
      sparkCol[i * 3] = sparkColor.r
      sparkCol[i * 3 + 1] = sparkColor.g
      sparkCol[i * 3 + 2] = sparkColor.b
    }
    sparkGeo.attributes.position.needsUpdate = true
    sparkGeo.attributes.color.needsUpdate = true
  })

  return (
    <group ref={groupRef} position={POS} scale={0.0001} visible={false}>
      <group ref={spinRef}>
        <primitive object={model} />
      </group>
      <primitive object={sparkPoints} />
    </group>
  )
}
