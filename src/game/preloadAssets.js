import { useGLTF } from '@react-three/drei'

useGLTF.preload('/pinalty_stadium3.glb')
useGLTF.preload('/fan_blob.glb')
useGLTF.preload('/player.glb')
useGLTF.preload('/goalie.glb')
// soccer-ball.glb needs a KTX2 transcoder wired into its loader, so it's
// loaded (not blindly preloaded) inside <Game />.
