import { Html, useProgress } from '@react-three/drei'

export function Loading() {
  const { progress } = useProgress()

  return (
    <Html center className="loader">
      <span>{Math.round(progress)}%</span>
    </Html>
  )
}
