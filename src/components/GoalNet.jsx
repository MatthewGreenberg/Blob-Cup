import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  GOAL_TOP,
  NET_BACK_H,
  NET_BACK_Z,
  NET_FRONT_Z,
  NET_HALF_W,
} from '../game/constants'
import { useStadiumEvent } from '../game/events'
import { makeGoalNetTexture } from '../utils/textures'

// Real-net silhouette: the roof slopes from the crossbar down to a low back
// frame, with a little cloth sag baked into every panel. Panels are built as
// world-space vertex grids (meshes sit at the origin) so one impact ripple
// can displace all of them from a single world-space hit point.

const CELL = 0.24 // net hole size in world units; UVs are worldPos / CELL

const lerp = THREE.MathUtils.lerp

// Grid geometry from a parametric surface. uvAxes picks which two world
// coordinates drive the tiling UVs so hole density matches on every panel.
function buildPanel(cols, rows, surface, uvAxes) {
  const positions = []
  const uvs = []
  const indices = []
  const p = new THREE.Vector3()

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      p.set(...surface(i / cols, j / rows))
      positions.push(p.x, p.y, p.z)
      uvs.push(p[uvAxes[0]] / CELL, p[uvAxes[1]] / CELL)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      const b = a + 1
      const c = a + cols + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

const sag = (u, v) => Math.sin(u * Math.PI) * Math.sin(v * Math.PI)

const PANELS = [
  {
    key: 'back',
    cols: 20,
    rows: 8,
    uvAxes: ['x', 'y'],
    // Bottom of the back sheet bellies out; it hangs slack, not drum-tight.
    surface: (u, v) => [
      lerp(-NET_HALF_W, NET_HALF_W, u),
      v * NET_BACK_H,
      NET_BACK_Z - Math.sin(u * Math.PI) * (1 - v) * 0.16,
    ],
  },
  {
    key: 'roof',
    cols: 20,
    rows: 10,
    uvAxes: ['x', 'z'],
    surface: (u, v) => [
      lerp(-NET_HALF_W, NET_HALF_W, u),
      lerp(GOAL_TOP + 0.04, NET_BACK_H, v) - sag(u, v) * 0.14,
      lerp(NET_FRONT_Z, NET_BACK_Z, v),
    ],
  },
  ...[-1, 1].map((side) => ({
    key: side < 0 ? 'left' : 'right',
    cols: 10,
    rows: 8,
    uvAxes: ['z', 'y'],
    // Pentagon: top edge follows the roof slope; slight outward belly.
    surface: (u, v) => [
      side * (NET_HALF_W + sag(u, v) * 0.1),
      v * lerp(GOAL_TOP + 0.04, NET_BACK_H, u),
      lerp(NET_FRONT_Z, NET_BACK_Z, u),
    ],
  })),
  {
    key: 'floor',
    cols: 12,
    rows: 6,
    uvAxes: ['x', 'z'],
    surface: (u, v) => [
      lerp(-NET_HALF_W, NET_HALF_W, u),
      0.04,
      lerp(NET_FRONT_Z, NET_BACK_Z, v),
    ],
  },
]

const RIPPLE_DURATION = 1.5

// Built once at module scope (deterministic, no DOM needed) — also keeps the
// useFrame vertex writes off render-scoped values (react-compiler immutability).
const NET_PANELS = PANELS.map((panel) => {
  const geometry = buildPanel(panel.cols, panel.rows, panel.surface, panel.uvAxes)
  return { key: panel.key, geometry, base: geometry.attributes.position.array.slice() }
})

export function GoalNet() {
  const texture = useMemo(() => makeGoalNetTexture(), [])
  // Ripple scratch state; t past RIPPLE_DURATION = idle (rest positions restored).
  const impactRef = useRef({ t: RIPPLE_DURATION + 1, x: 0, y: 0, z: 0, amp: 0, settled: true })

  useStadiumEvent('stadium:netHit', (e) => {
    const imp = impactRef.current
    imp.t = 0
    imp.settled = false
    imp.x = e.detail.x
    imp.y = e.detail.y
    imp.z = e.detail.z
    imp.amp = 0.35 + e.detail.power * 0.75
  })

  useFrame((_, delta) => {
    const imp = impactRef.current
    if (imp.settled) return
    imp.t += delta

    const done = imp.t >= RIPPLE_DURATION
    const decay = done ? 0 : Math.exp(-imp.t * 3.2)
    for (const { geometry, base } of NET_PANELS) {
      const pos = geometry.attributes.position.array
      for (let i = 0; i < pos.length; i += 3) {
        const dx = base[i] - imp.x
        const dy = base[i + 1] - imp.y
        const dz = base[i + 2] - imp.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        // Traveling damped wave pushing the mesh away from the goal mouth.
        const w = Math.exp(-(d * d) / 2.4)
        pos[i] = base[i]
        pos[i + 1] = base[i + 1]
        pos[i + 2] = base[i + 2] - imp.amp * w * Math.cos(imp.t * 11 - d * 2.2) * decay
      }
      geometry.attributes.position.needsUpdate = true
    }
    if (done) imp.settled = true
  })

  return (
    <group renderOrder={1}>
      {NET_PANELS.map((panel) => (
        <mesh key={panel.key} geometry={panel.geometry} renderOrder={1}>
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={0.8}
            alphaTest={0.03}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
