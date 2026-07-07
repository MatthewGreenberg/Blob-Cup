import { useEffect } from 'react'

export const emitStadiumEvent = (name, detail) => {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function useStadiumEvent(name, handler) {
  useEffect(() => {
    window.addEventListener(name, handler)
    return () => window.removeEventListener(name, handler)
  })
}
