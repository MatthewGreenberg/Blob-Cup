import { useMemo } from 'react'
import * as THREE from 'three'

export function Sky() {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#05070f')
    gradient.addColorStop(0.35, '#0a1230')
    gradient.addColorStop(0.6, '#28405f')
    gradient.addColorStop(0.8, '#4a5f7a')
    gradient.addColorStop(0.92, '#7d7a72')
    gradient.addColorStop(1, '#c99a6a')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 4, 256)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[160, 32, 16]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} fog={false} />
    </mesh>
  )
}
