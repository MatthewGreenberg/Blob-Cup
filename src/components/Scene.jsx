import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useControls } from 'leva'
import * as THREE from 'three'
import { CameraSnapshot } from './CameraSnapshot'
import { Loading } from './Loading'
import { Sky } from './Sky'
import { Stadium } from './Stadium'

export function Scene() {
  const { px, py, pz, tx, ty, tz, fov } = useControls('camera', {
    px: { value: 2.5, min: -80, max: 80, step: 0.5, label: 'pos x' },
    py: { value: 5.3, min: -20, max: 80, step: 0.5, label: 'pos y' },
    pz: { value: 40.7, min: -80, max: 80, step: 0.5, label: 'pos z' },
    tx: { value: 0, min: -40, max: 40, step: 0.5, label: 'target x' },
    ty: { value: 3, min: -20, max: 40, step: 0.5, label: 'target y' },
    tz: { value: -14, min: -40, max: 60, step: 0.5, label: 'target z' },
    fov: { value: 36, min: 15, max: 90, step: 1 },
  })

  const { bloomEnabled, bloomMipmapBlur, bloomThreshold, bloomSmoothing, bloomIntensity, bloomRadius } =
    useControls('bloom', {
      bloomEnabled: { value: true, label: 'enabled' },
      bloomMipmapBlur: { value: true, label: 'mipmap blur' },
      bloomThreshold: { value: 0.9, min: 0, max: 2, step: 0.01, label: 'threshold' },
      bloomSmoothing: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'smoothing' },
      bloomIntensity: { value: 1.6, min: 0, max: 6, step: 0.05, label: 'intensity' },
      bloomRadius: { value: 0, min: 0, max: 1, step: 0.01, label: 'radius' },
    })

  return (
    <Canvas
      className="stadium-canvas"
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0, width: '100vw', height: '100dvh' }}
      gl={{
        antialias: true,
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      <color attach="background" args={['#cdb59b']} />
      <PerspectiveCamera makeDefault fov={fov} near={0.1} far={400} position={[px, py, pz]} />
      <OrbitControls
        makeDefault
        target={[tx, ty, tz]}
        minDistance={14}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2.05}
        enableDamping
        dampingFactor={0.06}
        mouseButtons={{ LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        touches={{ ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      />
      <CameraSnapshot />
      <hemisphereLight args={['#e9dcc9', '#77836e', 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight color="#ffd9a8" intensity={1.6} position={[12, 18, 10]} />
      <Sky />
      <Suspense fallback={<Loading />}>
        <Stadium />
        <ContactShadows
          position={[0, -0.015, 0]}
          opacity={0.2}
          color="#000000"
          scale={64}
          blur={2.8}
          far={9}
        />
        <Environment preset="city" environmentIntensity={0.3} />
      </Suspense>
      <EffectComposer>
        {bloomEnabled && (
          <Bloom
            mipmapBlur={bloomMipmapBlur}
            luminanceThreshold={bloomThreshold}
            luminanceSmoothing={bloomSmoothing}
            intensity={bloomIntensity}
            radius={bloomRadius}
          />
        )}
        <ToneMapping mode={ToneMappingMode.OPTIMIZED_CINEON} />
      </EffectComposer>
    </Canvas>
  )
}
