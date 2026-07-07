import { useMemo } from 'react'
import * as THREE from 'three'
import { GOAL_HALF_W, GOAL_TOP, GOAL_Z } from '../game/constants'
import { makeGoalNetTexture } from '../utils/textures'

const NET_HALF_W = GOAL_HALF_W + 0.28
const NET_W = NET_HALF_W * 2
const NET_H = GOAL_TOP + 0.34
const NET_DEPTH = 3.1
const NET_FRONT_Z = GOAL_Z - 0.12
const NET_BACK_Z = GOAL_Z - NET_DEPTH
const NET_MID_Z = (NET_FRONT_Z + NET_BACK_Z) / 2

const PANELS = [
  {
    key: 'back',
    size: [NET_W, NET_H],
    position: [0, NET_H / 2, NET_BACK_Z],
    rotation: [0, 0, 0],
    grid: [18, 8],
  },
  {
    key: 'roof',
    size: [NET_W, NET_DEPTH],
    position: [0, NET_H, NET_MID_Z],
    rotation: [Math.PI / 2, 0, 0],
    grid: [18, 6],
  },
  {
    key: 'floor',
    size: [NET_W, NET_DEPTH],
    position: [0, 0.04, NET_MID_Z],
    rotation: [Math.PI / 2, 0, 0],
    grid: [18, 6],
  },
  {
    key: 'left',
    size: [NET_DEPTH, NET_H],
    position: [-NET_HALF_W, NET_H / 2, NET_MID_Z],
    rotation: [0, Math.PI / 2, 0],
    grid: [6, 8],
  },
  {
    key: 'right',
    size: [NET_DEPTH, NET_H],
    position: [NET_HALF_W, NET_H / 2, NET_MID_Z],
    rotation: [0, Math.PI / 2, 0],
    grid: [6, 8],
  },
]

export function GoalNet() {
  const panels = useMemo(
    () =>
      PANELS.map((panel) => ({
        ...panel,
        texture: makeGoalNetTexture(panel.grid[0], panel.grid[1]),
      })),
    [],
  )

  return (
    <group renderOrder={1}>
      {panels.map((panel) => (
        <mesh key={panel.key} position={panel.position} rotation={panel.rotation} renderOrder={1}>
          <planeGeometry args={panel.size} />
          <meshBasicMaterial
            map={panel.texture}
            transparent
            opacity={0.72}
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
