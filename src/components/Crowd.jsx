import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { button, useControls } from 'leva'
import * as THREE from 'three'
import { FAN_SHADOW_Y_OFFSET } from '../game/constants'
import { useStadiumEvent } from '../game/events'
import { mulberry32 } from '../utils/random'
import { makeFanShadowTexture } from '../utils/textures'

// One InstancedMesh of the Blender fan blob (public/fan_blob.glb, single
// primitive, COLOR_0 face + 3 mouth morph targets). Placement mirrors the old
// BUILD_FANS rig in src/stadium_blender_script.py, mapped blender (x,y,z) ->
// three (x, z, -y).
// ponytail: one teal palette for all fans; kept as an array so the seeded shading variety stays
// const FAN_BLUE_COLS = ['#3FD0D6', '#2FB9C4', '#66E0E0', '#48C9D9', '#7AE5E0', '#1FA8B8']
const FAN_BLUE_COLS = ['pink']
const FAN_RED_COLS = FAN_BLUE_COLS
const TIER_TOP = (tier) => 1.4 + 1.1 * tier
const SIDE_FAN_YAW = Math.PI / 2
const CROWD_SPACING = 3.1
const CROWD_SKIP_CHANCE = 0.24
const CROWD_IDLE = 'idle'
const CROWD_CELEBRATION = 'celebration'

export function Crowd() {
  const { scene } = useGLTF('/fan_blob.glb')
  const [crowdMode, setCrowdMode] = useState(CROWD_IDLE)
  const modeBlend = useRef(0)
  const crowdRef = useRef(null)

  const crowd = useMemo(() => {
    const rand = mulberry32(11)
    const src = scene.getObjectByName('FanBlob')
    const spots = []

    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 4; tier++) {
        for (let y = -22.5; y < 24.5; y += CROWD_SPACING + rand() * 1.2) {
          if (rand() < CROWD_SKIP_CHANCE) continue
          const x = side * (12.0 + 2.4 * tier) + (rand() - 0.5)
          const z = -y
          spots.push({
            x,
            y: TIER_TOP(tier),
            z,
            yaw: -side * SIDE_FAN_YAW,
          })
        }
      }
    }

    for (let tier = 0; tier < 4; tier++) {
      for (let x = -17.5; x < 16.5; x += CROWD_SPACING + rand() * 1.2) {
        if (Math.abs(x) < 6.8 && TIER_TOP(tier) < 6.5) continue
        if (rand() < CROWD_SKIP_CHANCE) continue
        const z = -(27.8 + 2.4 * tier + (rand() - 0.5))
        spots.push({ x, y: TIER_TOP(tier), z, yaw: 0 })
      }
    }

    const geometry = src.geometry.clone()
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.3,
    })

    const blobs = new THREE.InstancedMesh(geometry, material, spots.length)
    blobs.frustumCulled = false

    const morphProxy = new THREE.Mesh(geometry, material)
    const mouthTargets = {
      open: src.morphTargetDictionary?.MouthOpen,
      wide: src.morphTargetDictionary?.MouthWide,
      frown: src.morphTargetDictionary?.MouthFrown,
    }

    const shadowGeometry = new THREE.PlaneGeometry(1, 1)
    shadowGeometry.rotateX(-Math.PI / 2)
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: '#5c93d8',
      map: makeFanShadowTexture(),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    })
    const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, spots.length)
    shadows.frustumCulled = false
    shadows.renderOrder = 1

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const fans = []

    spots.forEach((spot, i) => {
      const scale = 0.85 + rand() * 0.35
      const heightScale = scale * (1.05 + rand() * 0.25)
      const phase = rand() * Math.PI * 2
      const fanColors = spot.x < 0 ? FAN_BLUE_COLS : FAN_RED_COLS

      fans.push({
        x: spot.x,
        y: spot.y,
        z: spot.z,
        yaw: spot.yaw,
        scale,
        heightScale,
        shadowScaleX: scale * 2.2,
        shadowScaleZ: scale * 1.9,
        phase,
        mouthPhase: rand() * Math.PI * 2,
        mouthSpeed: 3.4 + rand() * 1.35,
        swaySpeed: 1.65 + rand() * 0.85,
        swayAmp: 0.1 + rand() * 0.055,
        sideAmp: 0.12 + rand() * 0.11,
        jumpSpeed: 9.2 + rand() * 2.4,
        jumpHeight: 0.44 + rand() * 0.2,
        squashAmp: 0.18 + rand() * 0.08,
        stretchAmp: 0.16 + rand() * 0.07,
        idleSquashAmp: 0.045 + rand() * 0.035,
      })

      dummy.position.set(spot.x, spot.y, spot.z)
      dummy.rotation.set(0, spot.yaw, 0)
      dummy.scale.set(scale, heightScale, scale)
      dummy.updateMatrix()
      blobs.setMatrixAt(i, dummy.matrix)
      blobs.setColorAt(i, color.set(fanColors[(rand() * fanColors.length) | 0]))

      if (morphProxy.morphTargetInfluences) {
        morphProxy.morphTargetInfluences.fill(0)
        if (mouthTargets.open !== undefined) morphProxy.morphTargetInfluences[mouthTargets.open] = 0.16
        if (mouthTargets.wide !== undefined) morphProxy.morphTargetInfluences[mouthTargets.wide] = 0.05
        blobs.setMorphAt(i, morphProxy)
      }

      dummy.position.set(spot.x, spot.y + FAN_SHADOW_Y_OFFSET, spot.z)
      dummy.rotation.set(0, spot.yaw, 0)
      dummy.scale.set(scale * 2.2, 1, scale * 1.9)
      dummy.updateMatrix()
      shadows.setMatrixAt(i, dummy.matrix)
    })

    blobs.instanceColor.needsUpdate = true
    shadows.instanceMatrix.needsUpdate = true
    if (blobs.morphTexture) blobs.morphTexture.needsUpdate = true

    return { blobs, shadows, fans, morphProxy, mouthTargets, animator: new THREE.Object3D() }
  }, [scene])

  useControls('crowd', {
    idle: button(() => setCrowdMode(CROWD_IDLE)),
    celebration: button(() => setCrowdMode(CROWD_CELEBRATION)),
  })

  const calmTimer = useRef(null)

  useStadiumEvent('stadium:goal', () => {
    setCrowdMode(CROWD_CELEBRATION)
    clearTimeout(calmTimer.current)
    calmTimer.current = setTimeout(() => setCrowdMode(CROWD_IDLE), 4500)
  })

  useEffect(() => () => clearTimeout(calmTimer.current), [])

  useLayoutEffect(() => {
    crowdRef.current = crowd
    window.__crowd = crowd.blobs
    return () => {
      if (crowdRef.current === crowd) crowdRef.current = null
      if (window.__crowd === crowd.blobs) delete window.__crowd
    }
  }, [crowd])

  useFrame(({ clock }, delta) => {
    const activeCrowd = crowdRef.current
    if (!activeCrowd) return

    const t = clock.elapsedTime
    const targetBlend = crowdMode === CROWD_CELEBRATION ? 1 : 0
    modeBlend.current = THREE.MathUtils.damp(modeBlend.current, targetBlend, 7.5, delta)
    const celebrate = modeBlend.current
    const idle = 1 - celebrate
    const { blobs, shadows, fans, morphProxy, mouthTargets, animator } = activeCrowd
    const influences = morphProxy.morphTargetInfluences

    fans.forEach((fan, i) => {
      const mouthPulse = (Math.sin(t * fan.mouthSpeed + fan.mouthPhase) + 1) * 0.5
      const jumpPhase = t * fan.jumpSpeed + fan.phase
      const jumpWave = Math.sin(jumpPhase)
      const cheerPulse = (jumpWave + 1) * 0.5
      const chantPulse = (Math.sin(t * fan.mouthSpeed * 3.4 + fan.mouthPhase) + 1) * 0.5
      const idleOpen = 0.08 + mouthPulse * 0.34
      const idleWide = 0.035 + (1 - mouthPulse) * 0.12
      const celebrationOpen = 0.32 + chantPulse * 0.68
      const celebrationWide = 0.08 + (1 - chantPulse) * 0.18
      const open = THREE.MathUtils.lerp(idleOpen, celebrationOpen, celebrate)
      const wide = THREE.MathUtils.lerp(idleWide, celebrationWide, celebrate)

      if (influences) {
        influences.fill(0)
        if (mouthTargets.open !== undefined) influences[mouthTargets.open] = open
        if (mouthTargets.wide !== undefined) influences[mouthTargets.wide] = wide
        if (mouthTargets.frown !== undefined) influences[mouthTargets.frown] = 0
        blobs.setMorphAt(i, morphProxy)
      }

      const sway = Math.sin(t * fan.swaySpeed + fan.phase)
      const sideOffset = sway * fan.sideAmp * idle
      const x = fan.x + Math.cos(fan.yaw) * sideOffset
      const z = fan.z - Math.sin(fan.yaw) * sideOffset
      const bounce = Math.pow(cheerPulse, 0.65) * fan.jumpHeight * celebrate
      const landingSquash = Math.pow(1 - cheerPulse, 4)
      const airStretch = Math.pow(cheerPulse, 1.35)
      const breathWave = Math.sin(t * fan.swaySpeed * 1.65 + fan.phase + fan.mouthPhase * 0.2)
      const idleYDeform = 1 + breathWave * fan.idleSquashAmp
      const idleXzDeform = 1 - breathWave * fan.idleSquashAmp * 0.65
      const celebrationYDeform = 1 + airStretch * fan.stretchAmp - landingSquash * fan.squashAmp
      const celebrationXzDeform = 1 + landingSquash * fan.squashAmp * 0.85 - airStretch * fan.stretchAmp * 0.45
      const yDeform = THREE.MathUtils.lerp(idleYDeform, celebrationYDeform, celebrate)
      const xzDeform = THREE.MathUtils.lerp(idleXzDeform, celebrationXzDeform, celebrate)

      animator.position.set(x, fan.y + bounce, z)
      animator.rotation.set(0, fan.yaw, sway * fan.swayAmp * idle)
      animator.scale.set(fan.scale * xzDeform, fan.heightScale * yDeform, fan.scale * xzDeform)
      animator.updateMatrix()
      blobs.setMatrixAt(i, animator.matrix)

      animator.position.set(x, fan.y + FAN_SHADOW_Y_OFFSET, z)
      animator.rotation.set(0, fan.yaw, 0)
      animator.scale.set(
        fan.shadowScaleX * (1 + bounce * 0.35) * (1 + (xzDeform - 1) * 0.3),
        1,
        fan.shadowScaleZ * (1 + bounce * 0.35) * (1 + (xzDeform - 1) * 0.3),
      )
      animator.updateMatrix()
      shadows.setMatrixAt(i, animator.matrix)
    })

    blobs.instanceMatrix.needsUpdate = true
    shadows.instanceMatrix.needsUpdate = true
    if (blobs.morphTexture) blobs.morphTexture.needsUpdate = true
  })

  return (
    <>
      <primitive object={crowd.shadows} />
      <primitive object={crowd.blobs} />
    </>
  )
}
