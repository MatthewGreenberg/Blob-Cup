import * as THREE from 'three'

// Layout mirrors src/stadium_blender_script.py (LANE_W=18, LANE_L=46, tiers at
// x=side*(12+2.4t), tier-top z=1.4+1.1t). Blender is Z-up and the GLB is
// exported Y-up, so a Blender (x, y, z) lands at three (x, z, -y).

// Penalty shootout: aim with the pointer, hold to charge power, release to
// shoot. The Kick clip winds up and freezes at the cocked pose while charging.
export const STADIUM_POS = [0, 0.3, 3.0]
// The GLB now ships a real goal frame (posts ±4.8, bar 3.9) at blender
// y=12.82 -> GLB z=-12.82; the game plays on its line, not the tunnel mouth.
export const GOAL_Z = -12.82
export const GOAL_HALF_W = 4.6
export const GOAL_TOP = 3.6
export const BALL_R = 0.39
export const BALL_START = new THREE.Vector3(-0.45, BALL_R, 17.9)
// Run-up: holding to charge also walks the player (Walk clip) from his mark
// at PLAYER_POS to PLAYER_KICK_Z over RUN_UP_TIME; releasing kicks — if he's
// still mid-approach he finishes the walk first, so the ball launches
// max(0, RUN_UP_TIME - holdTime) + KICK_CONTACT after release (KICK_CONTACT =
// foot-on-ball, frame 16 @ 24fps in the Kick clip). After each shot resolves
// he trots back to the mark.
export const PLAYER_POS = [0, 0, 24]
export const PLAYER_KICK_Z = 20
export const RUN_UP_TIME = 0.85
export const PLAYER_RETURN_TIME = 1.1
export const KICK_CONTACT = 0.66
export const CHARGE_TIME = 0.9
export const FLIGHT_TIME_SLOW = 1.1
export const FLIGHT_TIME_FAST = 0.5
export const KEEPER_DIVE_X = 3.2
export const KEEPER_REACH_X = 1.6
export const KEEPER_REACH_Y = 3.0
// Keeper sways side to side while you aim and (usually) dives with his lean —
// read him and shoot the other way. Releasing in the gold band is a 'perfect'
// strike the keeper can never save.
export const KEEPER_SHUFFLE_X = 2.0
export const KEEPER_SHUFFLE_SPEED = 1.7
export const KEEPER_COMMIT_DEAD_ZONE = 0.8
export const PERFECT_MIN = 0.86
export const PERFECT_MAX = 0.97
export const FIRE_POOL = 56
export const FAN_SHADOW_Y_OFFSET = 0.06

// World-space goal plane for pointer-ray aiming (local GOAL_Z + group z offset).
export const GOAL_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(GOAL_Z + STADIUM_POS[2]))
export const AIM_HIT = new THREE.Vector3()
