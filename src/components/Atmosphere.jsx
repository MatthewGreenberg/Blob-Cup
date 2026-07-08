import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'
import { BALL_START, GOAL_Z } from '../game/constants'

// Field-level atmosphere (inside the stadium group, GLB-local coords), all
// deliberately faint — visible in motion, not as decoration:
//  1. floating dust/pollen motes drifting over the pitch (additive Points)
//  2. a low haze plane hanging in front of the goal mouth
//  3. confetti remnants lying near the sidelines, a few fluttering
//  4. a small pool of grass flecks kicked up on ball contact (stadium:launch)
// Meshes/geometries at module scope — same react-compiler immutability reason
// as Confetti/GoalNet (useFrame mutates them). Seeded layout for stable renders.

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(31)

const softDisc = (stops) => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  stops.forEach(([k, c]) => gradient.addColorStop(k, c))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

// --- 1. dust / pollen -------------------------------------------------------
const DUST = 110
const dustBase = Float32Array.from({ length: DUST * 3 }, (_, i) => {
  const axis = i % 3
  if (axis === 0) return (rand() - 0.5) * 26 // x across the pitch
  if (axis === 1) return 0.3 + rand() * 4.2 // y low air
  return -12 + rand() * 34 // z goal → kick spot
})
const dustPhase = Float32Array.from({ length: DUST }, () => rand() * Math.PI * 2)
const dustGeometry = new THREE.BufferGeometry()
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3))
const dustMaterial = new THREE.PointsMaterial({
  map: softDisc([
    [0, 'rgba(255,236,200,0.9)'],
    [0.4, 'rgba(255,236,200,0.35)'],
    [1, 'rgba(255,236,200,0)'],
  ]),
  size: 0.2,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})
const dust = new THREE.Points(dustGeometry, dustMaterial)
dust.frustumCulled = false

// --- 2. goal haze -----------------------------------------------------------
const hazeMaterial = new THREE.MeshBasicMaterial({
  map: softDisc([
    [0, 'rgba(235,225,210,0.55)'],
    [0.55, 'rgba(235,225,210,0.22)'],
    [1, 'rgba(235,225,210,0)'],
  ]),
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
})
const haze = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.4), hazeMaterial)
haze.position.set(0, 1.1, GOAL_Z + 1.9)
const haze2 = new THREE.Mesh(haze.geometry, hazeMaterial)
haze2.position.set(-1.5, 0.9, GOAL_Z + 3.6)
haze2.scale.set(0.7, 0.65, 1)

// --- 3. sideline confetti remnants ------------------------------------------
const REMNANTS = 48
const remnantColors = ['#ff4f79', '#ffd23f', '#4fc3ff', '#7bed7b', '#c77dff'].map((c) => new THREE.Color(c))
const remnantMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.14, 0.22),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.75 }),
  REMNANTS,
)
remnantMesh.frustumCulled = false
const remnants = Array.from({ length: REMNANTS }, () => ({
  x: (8.2 + rand() * 3.4) * (rand() < 0.5 ? -1 : 1), // sidelines only
  z: -10 + rand() * 30,
  rot: rand() * Math.PI * 2,
  flutter: rand() < 0.35 ? 0.5 + rand() * 0.7 : 0, // a few catch the breeze
  phase: rand() * Math.PI * 2,
}))
const animator = new THREE.Object3D()
remnants.forEach((piece, i) => {
  remnantMesh.setColorAt(i, remnantColors[(rand() * remnantColors.length) | 0])
  animator.position.set(piece.x, 0.06, piece.z)
  animator.rotation.set(-Math.PI / 2, 0, piece.rot)
  animator.updateMatrix()
  remnantMesh.setMatrixAt(i, animator.matrix)
})
if (remnantMesh.instanceColor) remnantMesh.instanceColor.needsUpdate = true

// --- 4. grass flecks on impact ----------------------------------------------
const FLECKS = 22
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0)
const fleckColors = ['#3e8f3a', '#57a84b', '#2f7a30'].map((c) => new THREE.Color(c))
const fleckMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.05, 0.13),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  FLECKS,
)
fleckMesh.frustumCulled = false
const flecks = Array.from({ length: FLECKS }, () => ({ life: 0 }))
for (let i = 0; i < FLECKS; i++) {
  fleckMesh.setColorAt(i, fleckColors[(rand() * fleckColors.length) | 0])
  fleckMesh.setMatrixAt(i, HIDE)
}
if (fleckMesh.instanceColor) fleckMesh.instanceColor.needsUpdate = true

export function Atmosphere() {
  // Kick contact: a puff of turf at the ball. (Math.random in handlers is fine.)
  useStadiumEvent('stadium:launch', () => {
    flecks.forEach((fleck) => {
      fleck.life = 0.45 + Math.random() * 0.35
      fleck.maxLife = fleck.life
      fleck.x = BALL_START.x + (Math.random() - 0.5) * 0.3
      fleck.y = 0.1
      fleck.z = BALL_START.z + (Math.random() - 0.5) * 0.3
      fleck.vx = (Math.random() - 0.5) * 2.2
      fleck.vy = 1.2 + Math.random() * 2.2
      fleck.vz = -0.4 - Math.random() * 1.8 // follow-through, toward goal
      fleck.rx = Math.random() * Math.PI
      fleck.rz = Math.random() * Math.PI
      fleck.vr = (Math.random() - 0.5) * 14
    })
  })

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    // Dust: slow rise + sine wander around each mote's seeded base.
    const positions = dustGeometry.attributes.position.array
    for (let i = 0; i < DUST; i++) {
      const p = dustPhase[i]
      positions[i * 3] = dustBase[i * 3] + Math.sin(t * 0.11 + p) * 0.9
      positions[i * 3 + 1] = 0.3 + ((dustBase[i * 3 + 1] - 0.3 + t * (0.05 + (p % 1) * 0.06)) % 4.2)
      positions[i * 3 + 2] = dustBase[i * 3 + 2] + Math.cos(t * 0.09 + p * 1.7) * 0.7
    }
    dustGeometry.attributes.position.needsUpdate = true

    // Haze breathes and drifts a touch.
    haze.position.x = Math.sin(t * 0.07) * 0.6
    hazeMaterial.opacity = 0.12 + Math.sin(t * 0.21) * 0.025

    // Fluttering remnants only (the rest keep their static matrices).
    for (let i = 0; i < REMNANTS; i++) {
      const piece = remnants[i]
      if (!piece.flutter) continue
      const lift = Math.max(0, Math.sin(t * piece.flutter + piece.phase)) ** 6
      animator.position.set(piece.x, 0.06 + lift * 0.25, piece.z)
      animator.rotation.set(-Math.PI / 2 + lift * 0.9, 0, piece.rot + lift * 1.4)
      animator.updateMatrix()
      remnantMesh.setMatrixAt(i, animator.matrix)
    }
    remnantMesh.instanceMatrix.needsUpdate = true

    // Grass flecks: ballistic, fade by shrinking.
    let anyAlive = false
    for (let i = 0; i < FLECKS; i++) {
      const fleck = flecks[i]
      if (fleck.life <= 0) continue
      anyAlive = true
      fleck.life -= delta
      if (fleck.life <= 0) {
        fleckMesh.setMatrixAt(i, HIDE)
        continue
      }
      fleck.vy -= 9 * delta
      fleck.x += fleck.vx * delta
      fleck.y = Math.max(0.02, fleck.y + fleck.vy * delta)
      fleck.z += fleck.vz * delta
      fleck.rx += fleck.vr * delta
      animator.position.set(fleck.x, fleck.y, fleck.z)
      animator.rotation.set(fleck.rx, 0, fleck.rz)
      animator.scale.setScalar(fleck.life / fleck.maxLife)
      animator.updateMatrix()
      fleckMesh.setMatrixAt(i, animator.matrix)
    }
    if (anyAlive) fleckMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <primitive object={dust} />
      <primitive object={haze} />
      <primitive object={haze2} />
      <primitive object={remnantMesh} />
      <primitive object={fleckMesh} />
    </>
  )
}
