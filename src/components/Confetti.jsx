import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'

// Candy confetti for winning the FINAL: armed by stadium:matchend
// {win, final}, rains through the result + champion screens, stops (and lets
// the airborne pieces fall out) on any other screen. World coords at scene
// root, volume centered over the celebrating player (world z≈23).
const COUNT = 500
const COLS = ['#ff4f79', '#ffd23f', '#4fc3ff', '#7bed7b', '#ff8a3d', '#c77dff', '#ffffff'].map(
  (c) => new THREE.Color(c),
)

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Mesh/geometry/params at module scope — same react-compiler immutability
// reason as GoalNet's panels and Game's trail dots (useFrame mutates them).
const geometry = new THREE.PlaneGeometry(0.17, 0.3)
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })
const mesh = new THREE.InstancedMesh(geometry, material, COUNT)
mesh.frustumCulled = false
const animator = new THREE.Object3D()
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0)

const rand = mulberry32(21)
const pieces = Array.from({ length: COUNT }, () => ({
  x: 0,
  y: -1,
  z: 0,
  rx: rand() * Math.PI * 2,
  ry: rand() * Math.PI * 2,
  rz: rand() * Math.PI * 2,
  // Tumble + flutter character is fixed per piece; position is re-rolled on spawn.
  vrx: (rand() - 0.5) * 9,
  vry: (rand() - 0.5) * 7,
  vrz: (rand() - 0.5) * 9,
  fall: 2.4 + rand() * 1.8,
  swayAmp: 0.8 + rand() * 1.4,
  swayFreq: 1.6 + rand() * 2.2,
  swayPhase: rand() * Math.PI * 2,
  scale: 0.7 + rand() * 0.8,
  alive: false,
}))
for (let i = 0; i < COUNT; i++) {
  mesh.setColorAt(i, COLS[(rand() * COLS.length) | 0])
  mesh.setMatrixAt(i, HIDE)
}
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

const spawn = (piece, y) => {
  piece.x = (Math.random() - 0.5) * 30
  piece.z = 23 + (Math.random() - 0.5) * 26
  piece.y = y
  piece.alive = true
}

export function Confetti({ screen }) {
  const st = useRef(null)
  useLayoutEffect(() => {
    st.current ??= { on: false }
  }, [])

  useStadiumEvent('stadium:matchend', (event) => {
    const s = st.current
    if (!s || !event.detail?.win || !event.detail?.final) return
    s.on = true
    // Opening burst: heights staggered so the first wave lands immediately
    // and the rain keeps arriving.
    pieces.forEach((piece) => spawn(piece, 6 + Math.random() * 22))
  })

  useEffect(() => {
    if (st.current && screen !== 'result' && screen !== 'champion') st.current.on = false
  }, [screen])

  useFrame((state, delta) => {
    const s = st.current
    if (!s || (!s.on && !pieces.some((p) => p.alive))) return
    const t = state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const p = pieces[i]
      if (!p.alive) continue
      p.y -= p.fall * delta
      p.x += Math.sin(t * p.swayFreq + p.swayPhase) * p.swayAmp * delta
      p.rx += p.vrx * delta
      p.ry += p.vry * delta
      p.rz += p.vrz * delta
      if (p.y < 0.15) {
        if (s.on) spawn(p, 18 + Math.random() * 8)
        else {
          p.alive = false
          mesh.setMatrixAt(i, HIDE)
          continue
        }
      }
      animator.position.set(p.x, p.y, p.z)
      animator.rotation.set(p.rx, p.ry, p.rz)
      animator.scale.setScalar(p.scale)
      animator.updateMatrix()
      mesh.setMatrixAt(i, animator.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={mesh} />
}
