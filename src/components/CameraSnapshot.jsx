import { useThree } from '@react-three/fiber'
import { button, useControls } from 'leva'
import * as THREE from 'three'

// Reads the live orbit-dragged camera + target and logs both. Lives inside the
// Canvas so it can reach useThree; the button sits in the same 'camera' panel.
export function CameraSnapshot() {
  const get = useThree((state) => state.get)

  useControls('camera', {
    snapshot: button(() => {
      const { camera, controls } = get()
      const position = camera.position
      const target = controls?.target ?? new THREE.Vector3()
      const round = (value) => Math.round(value * 10) / 10
      console.log(
        `position={[${round(position.x)}, ${round(position.y)}, ${round(position.z)}]} target={[${round(target.x)}, ${round(target.y)}, ${round(target.z)}]} fov={${camera.fov}}`,
      )
    }),
  })

  return null
}
