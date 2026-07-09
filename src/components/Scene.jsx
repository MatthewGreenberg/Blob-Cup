import { Suspense, useLayoutEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Bloom, EffectComposer, TiltShift2, Vignette } from '@react-three/postprocessing'
import { useControls } from 'leva'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'
import { CameraSnapshot } from './CameraSnapshot'
import { Confetti } from './Confetti'
import { Sky } from './Sky'
import { Stadium } from './Stadium'
import { Trophy } from './Trophy'
import { Weather } from './Weather'
import { WEATHER_BY_ID } from '../game/weather'

const DEBUG = new URLSearchParams(window.location.search).has('debug')
const COARSE_POINTER = window.matchMedia?.('(pointer: coarse)').matches ?? false

// Per-screen cinematic camera shots. The rig damps position/target/fov toward
// the active shot every frame, so screen changes become smooth camera moves
// instead of cuts. Non-match screens get a slow autonomous sway (the "attract
// mode" drift); the match shot swaps the sway for the pointer mouse-look, and
// charging (stadium:windup → kick/reset) ramps a damped pre-kick state: camera
// sinks/pushes in slightly, drifts laterally, fov tightens ~3.5°. On
// top of that, a subtle trauma-style shake (offset = trauma² × mixed-frequency
// sines) rocks the camera rotation on ball contact and goal so shots land with
// weight. The rotation offsets are applied after lookAt, which recomputes
// rotation every frame, so they never accumulate. Debug (OrbitControls) skips
// all this.
// All shots stay in the stadium's open camera end (no wall there) or on the
// pitch itself — side positions beyond x≈±12 land inside the bleachers/wall.
const SHOTS = {
  // While assets load the rig holds this high aerial; when the stadium mounts
  // it damps down into the menu shot — the fly-in IS the site entrance. Same
  // side as the menu shot so the descent never crosses geometry or empty sky.
  intro: { pos: [30, 26, 56], target: [0, 1, -10], fov: 40, sway: 0.05 },
  menu: { pos: [14, 9, 40], target: [0, 3, -10], fov: 36, sway: 0.08 },
  about: { pos: [-14, 8, 40], target: [0, 4, -10], fov: 36, sway: 0.06 },
  bracket: { pos: [-8, 14, 30], target: [0, 3, -12], fov: 34, sway: 0.05 },
  result: { pos: [7, 3.5, 4], target: [0, 2.6, -11], fov: 34, sway: 0.05 },
  // Win: hero close-up on the celebrating player (he holds at world z≈23 after
  // the winning shot — the walk-back is skipped), slow arc around him.
  resultWin: { pos: [2.8, 3.1, 29.8], target: [0, 2.7, 23], fov: 33, sway: 0.2 },
  // Final win: same hero arc but framed taller — the trophy spins above his
  // head (Trophy.jsx, top ≈ y 6 with bob), held while Ui delays the champion
  // overlay; the champion shot then IS the zoom-out.
  cupWin: { pos: [2.9, 3.9, 30.9], target: [0, 3.3, 23], fov: 42, sway: 0.18 },
  champion: { pos: [-3.6, 4.4, 30.6], target: [0, 3, 23], fov: 38, sway: 0.16 },
  match: { pos: [0, 4.2, 38], target: [0, 0, -14], fov: 31, sway: 0 },
  // Portrait phones (width < height, NOT just narrow — see CameraRig): pull in
  // behind the kicker and tilt UP off the grass for a tighter, more heroic
  // angle (target raised, camera lower + closer).
  matchMobile: { pos: [0, 3.4, 33], target: [0, 2.6, -14], fov: 31, sway: 0 },
}

// The SHOTS are framed at REF_ASPECT, but three.js fov is vertical — every
// window shape keeps the vertical slice and crops or pads the sides (a portrait
// phone becomes a tunnel; Safari's shorter browser chrome makes a taller,
// narrower viewport than Chrome's at the same window size, and the shot loses
// its edges). Solve the vertical fov per aspect so the HORIZONTAL frustum is
// the constant instead, capped before wide-angle distortion sets in.
const REF_ASPECT = 1.6
const FOV_CAP = 68
function aspectFov(fov, aspect) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * REF_ASPECT
  return Math.min(FOV_CAP, THREE.MathUtils.radToDeg(2 * Math.atan(halfH / aspect)))
}

function CameraRig({ screen }) {
  const rigRef = useRef(null)
  // Tournament win → the result screen uses the celebration close-up; a FINAL
  // win holds the taller trophy shot while Ui delays the champion overlay
  // (screen stays 'match' through the hold).
  const [won, setWon] = useState(null)
  useStadiumEvent('stadium:matchend', (event) =>
    setWon(event.detail?.win ? { final: !!event.detail?.final } : null),
  )
  useStadiumEvent('stadium:matchstart', () => setWon(null))
  useLayoutEffect(() => {
    rigRef.current ??= { target: new THREE.Vector3(0, 0, -14), pos: new THREE.Vector3(), trauma: 0, charge: 0, charging: false, ready: false }
  }, [])
  const bump = (amount) => {
    const rig = rigRef.current
    if (rig) rig.trauma = Math.min(1, rig.trauma + amount)
  }
  // stadium:launch = actual foot-on-ball contact (stadium:kick fires at mouse
  // release, up to RUN_UP_TIME + KICK_CONTACT before the strike).
  useStadiumEvent('stadium:launch', () => bump(0.3))
  useStadiumEvent('stadium:goal', () => bump(0.45))
  // Pre-kick tension: charging drives a damped 0→1 factor that lowers/pushes
  // the camera in, adds lateral drift and tightens fov — all near-imperceptible.
  const setCharging = (on) => {
    if (rigRef.current) rigRef.current.charging = on
  }
  // Entrance latch: fires when Stadium actually mounts (Suspense resolved),
  // then the normal damping flies the camera from the intro aerial to the menu.
  useStadiumEvent('stadium:loaded', () => {
    if (rigRef.current) rigRef.current.ready = true
  })
  useStadiumEvent('stadium:windup', () => setCharging(true))
  useStadiumEvent('stadium:kick', () => setCharging(false))
  useStadiumEvent('stadium:reset', () => setCharging(false))

  useFrame((state, delta) => {
    const rig = rigRef.current
    if (!rig) return
    // Actual portrait orientation only — an aspect < REF_ASPECT threshold also
    // caught desktop windows (Safari's taller viewport tripped it, Chrome's not)
    // and swapped in the pulled-in mobile shot on one browser but not the other.
    const portrait = state.size.width < state.size.height
    const key =
      won?.final && (screen === 'match' || screen === 'result')
        ? 'cupWin'
        : screen === 'result' && won
          ? 'resultWin'
          : screen
    let shot = !rig.ready ? SHOTS.intro : (SHOTS[key] ?? SHOTS.match)
    if (rig.ready && key === 'match' && portrait) shot = SHOTS.matchMobile
    const time = state.clock.elapsedTime
    const cam = state.camera

    // Pointer look during play (the sway:0 shots), slow sway everywhere else.
    // ponytail: touch = where you aim, not a camera stick — skip mouse-look on coarse pointers.
    const yaw = shot.sway === 0 ? (COARSE_POINTER ? 0 : -state.pointer.x * 0.06) : Math.sin(time * 0.16) * shot.sway
    const ox = shot.pos[0] - shot.target[0]
    const oz = shot.pos[2] - shot.target[2]
    const angle = Math.atan2(ox, oz) + yaw
    const radius = Math.hypot(ox, oz)
    rig.pos.set(shot.target[0] + Math.sin(angle) * radius, shot.pos[1], shot.target[2] + Math.cos(angle) * radius)

    // Slow ramp in while charging (~0.9/s), quicker release back to neutral.
    rig.charge = THREE.MathUtils.damp(rig.charge, rig.charging && screen === 'match' ? 1 : 0, rig.charging ? 0.9 : 3, delta)
    const c = rig.charge
    if (c > 0.001) {
      rig.pos.y -= 0.45 * c // slightly lower
      rig.pos.z -= 1.4 * c // slow push-in toward the goal
      rig.pos.x += Math.sin(time * 0.65) * 0.14 * c // slight lateral drift
    }

    cam.position.x = THREE.MathUtils.damp(cam.position.x, rig.pos.x, 2, delta)
    cam.position.y = THREE.MathUtils.damp(cam.position.y, rig.pos.y, 2, delta)
    cam.position.z = THREE.MathUtils.damp(cam.position.z, rig.pos.z, 2, delta)
    rig.target.x = THREE.MathUtils.damp(rig.target.x, shot.target[0], 2.4, delta)
    rig.target.y = THREE.MathUtils.damp(rig.target.y, shot.target[1], 2.4, delta)
    rig.target.z = THREE.MathUtils.damp(rig.target.z, shot.target[2], 2.4, delta)
    cam.lookAt(rig.target)
    cam.fov = THREE.MathUtils.damp(cam.fov, aspectFov(shot.fov - 3.5 * c, state.size.width / state.size.height), 2, delta)
    cam.updateProjectionMatrix()

    if (rig.trauma > 0) {
      const s = rig.trauma * rig.trauma
      cam.rotation.x += Math.sin(time * 31) * s * 0.03
      cam.rotation.y += Math.cos(time * 27) * s * 0.03
      cam.rotation.z += Math.sin(time * 23) * s * 0.012
      rig.trauma = Math.max(0, rig.trauma - delta * 0.8)
    }
  })
  return null
}

export function Scene({ cfg, screen, weather }) {
  const weatherConfig = WEATHER_BY_ID[weather] ?? WEATHER_BY_ID.clear
  const { px, py, pz, tx, ty, tz, fov } = useControls('camera', {
    px: { value: 2.9, min: -80, max: 80, step: 0.5, label: 'pos x' },
    py: { value: 4.2, min: -20, max: 80, step: 0.5, label: 'pos y' },
    pz: { value: 38, min: -80, max: 80, step: 0.5, label: 'pos z' },
    tx: { value: 0, min: -40, max: 40, step: 0.5, label: 'target x' },
    ty: { value: 0, min: -20, max: 40, step: 0.5, label: 'target y' },
    tz: { value: -14, min: -40, max: 60, step: 0.5, label: 'target z' },
    fov: { value: 31, min: 15, max: 90, step: 1 },
  })

  const { bloomEnabled, bloomMipmapBlur, bloomThreshold, bloomSmoothing, bloomIntensity, bloomRadius } =
    useControls('bloom', {
      bloomEnabled: { value: true, label: 'enabled' },
      bloomMipmapBlur: { value: true, label: 'mipmap blur' },
      bloomThreshold: { value: 0.84, min: 0, max: 2, step: 0.01, label: 'threshold' },
      bloomSmoothing: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'smoothing' },
      bloomIntensity: { value: 2.0, min: 0, max: 6, step: 0.05, label: 'intensity' },
      bloomRadius: { value: 0.53, min: 0, max: 1, step: 0.01, label: 'radius' },
    })

  const { sideBlurEnabled, sideBlurAmount, sideBlurTaper } = useControls('side blur', {
    sideBlurEnabled: { value: true, label: 'enabled' },
    sideBlurAmount: { value: 0.11, min: 0, max: 1, step: 0.01, label: 'side blur' },
    sideBlurTaper: { value: 0.76, min: 0, max: 2, step: 0.01, label: 'side taper' },
  })

  const { vignetteEnabled, vignetteOffset, vignetteDarkness } = useControls('vignette', {
    vignetteEnabled: { value: true, label: 'enabled' },
    vignetteOffset: { value: 0.0, min: 0, max: 1, step: 0.01, label: 'offset' },
    vignetteDarkness: { value: 0.8, min: 0, max: 1.5, step: 0.01, label: 'darkness' },
  })

  return (
    <Canvas
      className="stadium-canvas"
      dpr={[1, 1.5]}
      style={{ position: 'absolute', inset: 0, width: '100vw', height: '100dvh' }}
      gl={{
        // EffectComposer renders the scene to its own FBO, so canvas MSAA/depth/
        // stencil only cost (Safari pays double for the multisampled default
        // framebuffer); AA comes from the composer's multisampling instead.
        antialias: false,
        stencil: false,
        depth: false,
        powerPreference: 'high-performance', // dual-GPU Macs default to the iGPU otherwise
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      <color attach="background" args={[weatherConfig.ground]} />
      <PerspectiveCamera makeDefault fov={fov} near={0.1} far={400} position={[px, py, pz]} />
      {DEBUG ? (
        <>
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
        </>
      ) : (
        <CameraRig screen={screen} />
      )}
      <hemisphereLight args={[weatherConfig.hemisphere[0], weatherConfig.hemisphere[1], weatherConfig.hemisphereIntensity]} />
      <ambientLight intensity={weatherConfig.ambientIntensity} />
      {/* Key from the side (bright side + shadow side = readable egg silhouette); cool fill from the far side so the shadow side isn't black. */}
      <directionalLight color={weatherConfig.key[0]} intensity={weatherConfig.key[1]} position={[-14, 16, 6]} />
      <directionalLight color={weatherConfig.fill[0]} intensity={weatherConfig.fill[1]} position={[12, 8, 2]} />
      <Sky weather={weather} />
      <Weather weather={weather} />
      <Confetti screen={screen} />
      {/* stars are baked into the Sky texture — a <Stars> point sphere put almost nothing in the visible sky band */}
      {/* no in-canvas fallback: R3F doesn't paint until this resolves — the
          DOM <Loading /> overlay covers the boot */}
      <Suspense fallback={null}>
        <Stadium cfg={cfg} weather={weather} />
        <Trophy screen={screen} />
        <ContactShadows
          frames={1} /* bake once: moving objects carry their own shadow planes */
          position={[0, -0.015, 0]}
          opacity={0.2}
          color="#000000"
          scale={64}
          blur={2.8}
          far={9}
        />
        <Environment preset="city" environmentIntensity={0.3} />
      </Suspense>
      {/* multisampling 4 (default 8): halves MSAA resolve bandwidth, no visible difference at this dpr */}
      <EffectComposer multisampling={4}>
        {bloomEnabled && (
          <Bloom
            mipmapBlur={bloomMipmapBlur}
            luminanceThreshold={bloomThreshold}
            luminanceSmoothing={bloomSmoothing}
            intensity={bloomIntensity}
            radius={bloomRadius}
          />
        )}
        {/* blur ramps perpendicular to the focus line: vertical center line -> side blur */}
        {sideBlurEnabled && (
          <TiltShift2 blur={sideBlurAmount} taper={sideBlurTaper} start={[0.5, 0]} end={[0.5, 1]} samples={8} />
        )}
        {/* <ToneMapping mode={ToneMappingMode.OPTIMIZED_CINEON} /> */}
        {vignetteEnabled && <Vignette offset={vignetteOffset} darkness={vignetteDarkness} />}
      </EffectComposer>
    </Canvas>
  )
}
