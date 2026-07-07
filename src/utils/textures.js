import * as THREE from 'three'

export function makeShadowTexture(stops) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 62)
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Blue-tinted shadows keep the crowd grounded without turning into black
// smudges against the saturated stadium seats.
export const makeFanShadowTexture = () =>
  makeShadowTexture([
    [0, 'rgba(50, 118, 205, 0.36)'],
    [0.56, 'rgba(78, 148, 224, 0.2)'],
    [1, 'rgba(78, 148, 224, 0)'],
  ])

// Player shadow needs a much stronger core: it sits alone on bright grass
// while fan shadows only show as a thin ring around the blob base.
export const makePlayerShadowTexture = () =>
  makeShadowTexture([
    [0, 'rgba(30, 65, 120, 0.95)'],
    [0.45, 'rgba(45, 90, 150, 0.6)'],
    [1, 'rgba(45, 90, 150, 0)'],
  ])

export function makeGoalNetTexture(columns, rows) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const drawGrid = (strokeStyle, lineWidth) => {
    ctx.strokeStyle = strokeStyle
    ctx.lineWidth = lineWidth

    for (let x = 0; x <= columns; x++) {
      const px = (x / columns) * canvas.width
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, canvas.height)
      ctx.stroke()
    }

    for (let y = 0; y <= rows; y++) {
      const py = (y / rows) * canvas.height
      ctx.beginPath()
      ctx.moveTo(0, py)
      ctx.lineTo(canvas.width, py)
      ctx.stroke()
    }
  }

  drawGrid('rgba(58, 112, 188, 0.24)', 11)
  drawGrid('rgba(245, 252, 255, 0.82)', 5)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export function makeBallTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 256, 128)

  // Cartoony pentagon patches scattered on the equirect wrap.
  ctx.fillStyle = '#22242e'
  const spots = [
    [16, 34],
    [80, 78],
    [144, 30],
    [208, 84],
    [48, 118],
    [176, 122],
    [112, 4],
    [240, 22],
  ]

  for (const [px, py] of spots) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      ctx[i ? 'lineTo' : 'moveTo'](px + Math.cos(a) * 15, py + Math.sin(a) * 15)
    }
    ctx.closePath()
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  return texture
}
