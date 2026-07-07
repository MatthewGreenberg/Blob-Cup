import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'

// The jumbotron screen is baked into the GLB (Scoreboard_Screen). We park a
// plane exactly over that baked face and feed it a WebGLRenderTarget rendered
// from a second camera behind the goal looking back at the player — the reverse
// shot. All coords are GLB-local (component lives inside the stadium group).
// Defaults derived from the Blender scoreboard: Screen box 9.4x3.0 offset
// (0,-0.35,0) from the join origin (0,33.64,13.62), tilted 10° down, then the
// RESIZE pass scales the whole Scoreboard x2.772 — so the baked screen face is
// 26.06x8.32 centered at three-space (0,13.42,-32.49). Exposed in leva since
// the bake can shift.
const S = 2.772
const W = 9.4 * S
const H = 3.0 * S

export function Jumbotron() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const planeRef = useRef()
  const camRef = useRef()

  const rt = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1024, Math.round((1024 * H) / W), {
      depthBuffer: true,
      samples: 4,
    })
    target.texture.colorSpace = THREE.SRGBColorSpace
    return target
  }, [])

  const { px, py, pz, rx, inset, cx, cy, cz, lx, ly, lz, fov } = useControls('jumbotron', {
    px: { value: 0, min: -20, max: 20, step: 0.1, label: 'screen x' },
    py: { value: 13.41, min: 0, max: 30, step: 0.1, label: 'screen y' },
    // baked screen front face sits at z≈-32.49; park 0.06 in front of it (along
    // the tilted normal) so the live RT wins the depth test instead of z-fighting.
    pz: { value: -32.43, min: -50, max: 0, step: 0.1, label: 'screen z' },
    rx: { value: 0.175, min: -1, max: 1, step: 0.01, label: 'screen tilt' },
    // the baked glowing screen doubles as a backlight bezel — keep a border of
    // it visible around the live RT plane
    inset: { value: 1.0, min: 0.5, max: 1, step: 0.01 },
    cx: { value: 0, min: -20, max: 20, step: 0.5, label: 'cam x' },
    cy: { value: 7, min: 0, max: 30, step: 0.5, label: 'cam y' },
    cz: { value: -17, min: -40, max: 20, step: 0.5, label: 'cam z' },
    lx: { value: 0, min: -20, max: 20, step: 0.5, label: 'look x' },
    ly: { value: 2.5, min: 0, max: 20, step: 0.5, label: 'look y' },
    lz: { value: 22, min: -20, max: 40, step: 0.5, label: 'look z' },
    fov: { value: 42, min: 15, max: 90, step: 1 },
  })

  useFrame(() => {
    const cam = camRef.current
    const plane = planeRef.current
    if (!cam || !plane) return
    cam.position.set(cx, cy, cz)
    cam.lookAt(plane.parent.localToWorld(new THREE.Vector3(lx, ly, lz)))
    plane.visible = false // avoid feedback: keep the screen out of its own shot
    gl.setRenderTarget(rt)
    gl.render(scene, cam)
    gl.setRenderTarget(null)
    plane.visible = true
  })

  return (
    <>
      {/* child of the group → inherits STADIUM_POS; lookAt uses world space */}
      <perspectiveCamera ref={camRef} fov={fov} aspect={W / H} near={0.5} far={400} />
      <mesh ref={planeRef} position={[px, py, pz]} rotation={[rx, 0, 0]} scale={[inset, inset, 1]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={rt.texture} toneMapped={false} />
      </mesh>
    </>
  )
}
