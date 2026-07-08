import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { mulberry32 } from '../utils/random'

// The baked GLB texture is 4096px over the whole stadium — the pitch gets
// ~57 texels/unit and reads as flat plastic up close. This overlay tiles a
// small blade-speckle texture over the floor so the grass has per-pixel
// grain at any camera distance; the mow stripes/lighting stay baked.

// Built at module scope (like GoalNet's geometries): keeps Math.random-style
// PRNG out of render/useMemo and the texture is shared for the app lifetime.
function makeTurfTexture() {
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')
  const rand = mulberry32(7)

  // short near-vertical blade strokes, dark + light over transparent
  const blade = (style, count, len) => {
    ctx.strokeStyle = style
    ctx.lineWidth = 1.1
    ctx.lineCap = 'round'
    for (let i = 0; i < count; i++) {
      const x = rand() * S
      const y = rand() * S
      const a = Math.PI / 2 + (rand() - 0.5) * 0.9
      const l = len * (0.6 + rand() * 0.8)
      ctx.beginPath()
      // draw wrapped 3x3 so strokes crossing the edge tile seamlessly
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S]) {
          ctx.moveTo(x + ox, y + oy)
          ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l)
        }
      ctx.stroke()
    }
  }

  blade('rgba(20, 70, 18, 0.30)', 2600, 5) // shadow blades
  blade('rgba(30, 96, 26, 0.22)', 2000, 6)
  blade('rgba(150, 235, 110, 0.30)', 1800, 4) // lit blade tips
  blade('rgba(210, 255, 170, 0.16)', 900, 3)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(46 / 1, 72 / 2) // one tile per 4 world units
  texture.anisotropy = 16 // grazing pitch-level camera
  return texture
}

const turfTexture = makeTurfTexture()

// Hand-tuned via a since-removed leva pitchLogo panel.
const LOGO = { x: 6.2, z: 19.6, width: 3.9, rotation: 0.01, opacity: 0.39 }

// Floor footprint in GLB-local coords: x ±23, z -39..33 (Blender y 3±36).
export function PitchTurf({ showLogo }) {
  const logo = useTexture('/images/field-logo.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 16
  })
  return (
    <>
      <mesh position={[0, 0.055, -3]} rotation-x={-Math.PI / 2} renderOrder={1}>
        <planeGeometry args={[46, 72]} />
        <meshBasicMaterial map={turfTexture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* painted-on pitch branding (tournament only): upright from the match camera (+z) */}
      {showLogo && (
        <mesh
          position={[LOGO.x, 0.065, LOGO.z]}
          rotation={[-Math.PI / 2, 0, LOGO.rotation]}
          scale={LOGO.width}
          renderOrder={2}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={logo}
            transparent
            opacity={LOGO.opacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </>
  )
}
