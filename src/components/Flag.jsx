import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Static shared pennant geometry. Built at module scope so the per-frame vertex
// mutation is not fighting React's memo/ref immutability rules.
const FLAG_W = 1.6
const FLAG_H = 0.8

function makePennant() {
  const geometry = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 20, 8)
  const pos = geometry.attributes.position

  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + FLAG_W / 2) / FLAG_W
    pos.setY(i, pos.getY(i) * (1 - u))
  }

  geometry.computeVertexNormals()
  geometry.userData.baseX = Float32Array.from(pos.array.filter((_, i) => i % 3 === 0))
  geometry.userData.baseY = Float32Array.from(pos.array.filter((_, i) => i % 3 === 1))
  return geometry
}

const FLAGS = [
  { pos: [10.6 + 1.15, 4.55, -14], geo: makePennant(), phase: 0, speed: 2.4, freq: 2.4 },
  { pos: [-10.6 + 1.15, 4.55, 10], geo: makePennant(), phase: 1.7, speed: 2.0, freq: 2.8 },
]

export function Flag() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    for (const flag of FLAGS) {
      const pos = flag.geo.attributes.position
      const { baseX, baseY } = flag.geo.userData

      for (let i = 0; i < pos.count; i++) {
        const x = baseX[i]
        const lift = x + FLAG_W / 2
        const phase = x * flag.freq - t * flag.speed + flag.phase
        pos.setY(i, baseY[i] + Math.sin(phase) * 0.12 * lift)
        pos.setZ(i, Math.cos(phase) * 0.06 * lift)
      }

      pos.needsUpdate = true
      flag.geo.computeVertexNormals()
    }
  })

  return (
    <>
      {FLAGS.map((flag) => (
        <mesh key={flag.pos[0]} geometry={flag.geo} position={flag.pos} scale={1.5}>
          <meshStandardMaterial color="blue" roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  )
}
