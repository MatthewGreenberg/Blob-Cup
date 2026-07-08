"""Author Kick/Celebrate/Idle/Walk/Run actions + MouthHappy/MouthSad shape keys
on the main-player.blend rig, render previews, export GLB.
Run: Blender -b main-player.blend -P player_anim_blender_script.py -- [--export]
World-axis rotation conventions (character faces +X, verified via renders):
  legs/arms hanging down: +Y = swing backward, -Y = swing forward; knee flex = +Y
  left arm (bone +Y):  X + = raise up, X - = lower to side
  right arm (bone -Y): X - = raise up, X + = lower to side
  foot (bone +X): +Y = toe down
  BIND POSE IS A T-POSE: upperarm X angles are measured from horizontal, not
  from hanging — X +34 on a raised arm is already a wide V above the head.
"""
import bpy, sys, math
from mathutils import Matrix

ARM = bpy.data.objects["Armature"]
SCRATCH = "/private/tmp/claude-501/-Users-mattgreenberg-dev-demos-stadium/4b2496f3-b53a-402c-bfca-f3a822be80b1/scratchpad"
EXPORT = "--export" in sys.argv

bpy.context.view_layer.objects.active = ARM
bpy.ops.object.mode_set(mode="POSE")

def reset():
    for pb in ARM.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

def rot(name, axis, deg):
    pb = ARM.pose.bones[name]
    M = pb.matrix
    loc = M.to_translation()
    R = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-loc)
    pb.matrix = R @ M
    bpy.context.view_layer.update()

def apply_pose(spec, hip_dz=0.0):
    reset()
    for name, axis, deg in spec:  # author order = parent-first
        rot(name, axis, deg)
    if hip_dz:
        pb = ARM.pose.bones["Hip"]
        pb.matrix = Matrix.Translation((0, 0, hip_dz)) @ pb.matrix
        bpy.context.view_layer.update()

def key_all(frame):
    for pb in ARM.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    ARM.pose.bones["Hip"].keyframe_insert("location", frame=frame)

def make_action(name, keys):
    ARM.animation_data_create()
    act = bpy.data.actions.new(name)
    ARM.animation_data.action = act
    for frame, hip_dz, spec in keys:
        apply_pose(spec, hip_dz)
        key_all(frame)
    act.use_fake_user = True
    return act

Y, X, Z = "Y", "X", "Z"

ARMS_IDLE = [("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
             ("L_Forearm", Y, -12), ("R_Forearm", Y, -12)]
IDLE = [
    ("L_Thigh", Y, 3), ("R_Thigh", Y, 3),
    ("L_Calf", Y, 5), ("R_Calf", Y, 5),
    ("Spine01", Y, -3),
] + ARMS_IDLE

# ---- KICK (right leg, ~40f) ----
WINDUP = [
    ("Spine01", Y, -16), ("Spine02", Y, -6),
    ("L_Thigh", Y, -10), ("L_Calf", Y, 22), ("L_Foot", Y, -12),
    ("R_Thigh", Y, 40), ("R_Calf", Y, 70), ("R_Foot", Y, 15),
    ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
    ("L_Upperarm", Y, -45), ("R_Upperarm", Y, 35),
    ("L_Forearm", Y, -25), ("R_Forearm", Y, -10),
    ("Head", Y, 10),
]
CONTACT = [
    ("Spine01", Y, 8), ("Spine02", Y, 4),
    ("L_Thigh", Y, -6), ("L_Calf", Y, 12), ("L_Foot", Y, -6),
    ("R_Thigh", Y, -60), ("R_Calf", Y, 12), ("R_Foot", Y, 25),
    ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
    ("L_Upperarm", Y, 35), ("R_Upperarm", Y, -40),
    ("L_Forearm", Y, -15), ("R_Forearm", Y, -25),
]
FOLLOW = [
    ("Spine01", Y, 14), ("Spine02", Y, 6),
    ("L_Thigh", Y, -4), ("L_Calf", Y, 8), ("L_Foot", Y, -4),
    ("R_Thigh", Y, -85), ("R_Calf", Y, 20), ("R_Foot", Y, 20),
    ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
    ("L_Upperarm", Y, 50), ("R_Upperarm", Y, -55),
    ("L_Forearm", Y, -15), ("R_Forearm", Y, -25),
    ("Head", Y, -5),
]
kick = make_action("Kick", [
    (1, 0.0, IDLE),
    (10, -0.005, WINDUP),
    (16, 0.0, CONTACT),
    (22, 0.0, FOLLOW),
    (40, 0.0, IDLE),
])

# ---- CELEBRATE (~60f) ----
# Bind pose is a T-pose, so upperarm X raise is measured from horizontal.
# Wide V (~34deg above horizontal + open clavicles) keeps the hands clear of
# the oversized chibi head; slight Y tilt pulls them forward off the hair.
ARMS_UP = [("L_Clavicle", X, 22), ("R_Clavicle", X, -22),
           ("L_Upperarm", X, 34), ("R_Upperarm", X, -34),
           ("L_Upperarm", Y, 10), ("R_Upperarm", Y, 10),
           ("L_Forearm", X, 20), ("R_Forearm", X, -20)]
CROUCH = [
    ("Spine01", Y, -14),
    ("L_Thigh", Y, -50), ("R_Thigh", Y, -50),
    ("L_Calf", Y, 75), ("R_Calf", Y, 75),
    ("L_Foot", Y, -25), ("R_Foot", Y, -25),
    ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
    ("L_Upperarm", Y, 30), ("R_Upperarm", Y, 30),
]
AIR = [
    ("Spine01", Y, 6),
    ("L_Thigh", Y, 4), ("R_Thigh", Y, 4),
    ("L_Calf", Y, 8), ("R_Calf", Y, 8),
    ("Head", Y, -6),
] + ARMS_UP
LAND = [
    ("Spine01", Y, -10),
    ("L_Thigh", Y, -30), ("R_Thigh", Y, -30),
    ("L_Calf", Y, 45), ("R_Calf", Y, 45),
    ("L_Foot", Y, -15), ("R_Foot", Y, -15),
] + ARMS_UP
SWAY_L = [("Spine01", X, 10), ("Head", X, -7)] + ARMS_UP
SWAY_R = [("Spine01", X, -10), ("Head", X, 7)] + ARMS_UP
celebrate = make_action("Celebrate", [
    (1, 0.0, IDLE),
    (7, -0.055, CROUCH),  # hip drop matched to knee bend so feet stay on floor
    (14, 0.13, AIR),
    (17, 0.15, AIR),
    (23, -0.02, LAND),
    (30, 0.0, SWAY_L),
    (38, 0.0, SWAY_R),
    (46, 0.0, SWAY_L),
    (54, 0.0, SWAY_R),
    (60, 0.0, IDLE),
])

# ---- IDLE (48f seamless loop): breathing sway ----
IDLE_B = [
    ("L_Thigh", Y, 3), ("R_Thigh", Y, 3),
    ("L_Calf", Y, 5), ("R_Calf", Y, 5),
    ("Spine01", Y, -5), ("Spine02", Y, 1),
    ("Head", Y, 2),
    ("L_Upperarm", X, -53), ("R_Upperarm", X, 53),
    ("L_Forearm", Y, -16), ("R_Forearm", Y, -16),
]
idle = make_action("Idle", [
    (1, 0.0, IDLE),
    (24, -0.006, IDLE_B),
    (48, 0.0, IDLE),
])

# ---- WALK (24f seamless loop, in-place; game translates the character) ----
def step(fwd, back):  # fwd/back = "L"/"R"
    return [
        ("Spine01", Y, -4),
        (f"{fwd}_Thigh", Y, -25), (f"{fwd}_Calf", Y, 8), (f"{fwd}_Foot", Y, -10),
        (f"{back}_Thigh", Y, 20), (f"{back}_Calf", Y, 18), (f"{back}_Foot", Y, 12),
        ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
        (f"{fwd}_Upperarm", Y, 22), (f"{back}_Upperarm", Y, -22),  # arms counter-swing
        ("L_Forearm", Y, -18), ("R_Forearm", Y, -18),
    ]

def passing(swing, stance):
    return [
        ("Spine01", Y, -3),
        (f"{swing}_Thigh", Y, -12), (f"{swing}_Calf", Y, 40), (f"{swing}_Foot", Y, -15),
        (f"{stance}_Thigh", Y, 2), (f"{stance}_Calf", Y, 3),
        ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
        ("L_Forearm", Y, -15), ("R_Forearm", Y, -15),
    ]

walk = make_action("Walk", [
    (1, -0.008, step("R", "L")),
    (7, 0.006, passing("L", "R")),
    (13, -0.008, step("L", "R")),
    (19, 0.006, passing("R", "L")),
    (25, -0.008, step("R", "L")),
])

# ---- RUN (20f seamless sprint loop, in-place; run-up before the kick) ----
def step_run(fwd, back):
    return [
        ("Spine01", Y, -14), ("Spine02", Y, -4), ("Head", Y, 6),
        (f"{fwd}_Thigh", Y, -55), (f"{fwd}_Calf", Y, 20), (f"{fwd}_Foot", Y, -8),
        (f"{back}_Thigh", Y, 35), (f"{back}_Calf", Y, 55), (f"{back}_Foot", Y, 18),
        ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
        (f"{fwd}_Upperarm", Y, 35), (f"{back}_Upperarm", Y, -35),
        ("L_Forearm", Y, -60), ("R_Forearm", Y, -60),  # arms pump bent at 90
    ]

def pass_run(swing, stance):
    return [
        ("Spine01", Y, -12), ("Spine02", Y, -3), ("Head", Y, 5),
        (f"{swing}_Thigh", Y, -38), (f"{swing}_Calf", Y, 95), (f"{swing}_Foot", Y, -12),
        (f"{stance}_Thigh", Y, 10), (f"{stance}_Calf", Y, 12),
        ("L_Upperarm", X, -55), ("R_Upperarm", X, 55),
        ("L_Forearm", Y, -55), ("R_Forearm", Y, -55),
    ]

run = make_action("Run", [
    (1, -0.018, step_run("R", "L")),
    (6, 0.02, pass_run("L", "R")),
    (11, -0.018, step_run("L", "R")),
    (16, 0.02, pass_run("R", "L")),
    (21, -0.018, step_run("R", "L")),
])

bpy.ops.object.mode_set(mode="OBJECT")

# ---- mouth shape keys (MouthHappy / MouthSad) ----
# Gaussian-weighted displacement around the mouth (front of face = +X,
# mouth center y=0 z=0.675 in rest space). Happy: corners up+out, grin opens.
# Sad: opening squashed toward its centerline (>0.3 crushes the teeth through
# the lips), corners drag down, mouth narrows and recedes.
import numpy as np

MESH = next(ob for ob in bpy.data.objects
            if ob.type == "MESH" and any(m.type == "ARMATURE" for m in ob.modifiers))

def build_mouth_keys():
    MESH.shape_key_clear()
    MESH.shape_key_add(name="Basis")
    n = len(MESH.data.vertices)
    co = np.empty(n * 3)
    MESH.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    CY, CZ = 0.0, 0.675
    front = co[:, 0] > 0.10
    w = np.exp(-((co[:, 1] - CY) ** 2 / (2 * 0.055 ** 2) + (co[:, 2] - CZ) ** 2 / (2 * 0.042 ** 2))) * front
    # nose mask: the nose bulges past the lip surface (x > ~0.19) in the band
    # just above the mouth (z 0.66-0.725); fade w to 0 there so neither morph
    # drags the nose (it used to smear sideways/down -> creepy)
    nose_band = np.clip((co[:, 2] - 0.660) / 0.012, 0, 1) * np.clip((0.725 - co[:, 2]) / 0.012, 0, 1)
    nose_bulge = np.clip((co[:, 0] - 0.185) / 0.012, 0, 1)
    w *= 1 - nose_band * nose_bulge
    # the x>0.185 bulge mask misses the central philtrum + nose underside
    # (x~0.17-0.185, y~0): the forward/up push there dragged the whole nose
    # into a lump. Kill weight for central verts above the mouth so only the
    # lateral smile corners move up there (nose stays put, smile survives).
    central = np.clip((0.030 - np.abs(co[:, 1])) / 0.030, 0, 1)   # 1 at center -> 0 by |y|=0.03
    high = np.clip((co[:, 2] - 0.640) / 0.040, 0, 1)              # 0 at mouth -> 1 by z=0.68
    w *= 1 - central * high
    corner = np.clip(np.abs(co[:, 1]) / 0.07, 0, 1)  # 0 center -> 1 corners
    sy = np.sign(co[:, 1])

    happy = np.zeros_like(co)
    happy[:, 2] += w * corner * 0.030          # corners lift
    happy[:, 1] += w * sy * 0.022              # widen
    happy[:, 0] += w * 0.010                   # cheek/lip push out
    lower = co[:, 2] < CZ
    happy[:, 2] -= w * (1 - corner) * lower * 0.012  # drop lower-center: open grin

    sad = np.zeros_like(co)
    sad[:, 2] += w * (CZ - co[:, 2]) * 0.28    # squash the opening shut-ish
    sad[:, 2] -= w * corner * 0.032            # corners down
    sad[:, 1] -= w * sy * 0.012                # narrow
    sad[:, 0] -= w * 0.006                     # recede

    for name, disp in (("MouthHappy", happy), ("MouthSad", sad)):
        sk = MESH.shape_key_add(name=name, from_mix=False)
        sk.data.foreach_set("co", (co + disp).reshape(-1))
    MESH.data.update()

build_mouth_keys()

# ---- previews ----
scn = bpy.context.scene
scn.render.resolution_x = 420
scn.render.resolution_y = 420
scn.render.engine = "BLENDER_WORKBENCH"
scn.render.image_settings.file_format = "PNG"
cam = bpy.data.objects["Camera"]
cam.rotation_mode = "XYZ"
bpy.data.objects["Icosphere"].hide_render = True

VIEWS = {
    "side": ((0.05, -2.1, 0.35), (math.radians(90), 0, 0)),
    "front": ((2.1, 0, 0.35), (math.radians(90), 0, math.radians(90))),
}

def render_frames(act, frames, tag, view="side"):
    cam.location, cam.rotation_euler = VIEWS[view]
    ARM.animation_data.action = act
    for f in frames:
        scn.frame_set(f)
        scn.render.filepath = f"{SCRATCH}/prev_{tag}_{f:02d}.png"
        bpy.ops.render.render(write_still=True)

render_frames(kick, [1, 10, 16, 22], "kick")
render_frames(celebrate, [7, 16, 23], "cele")
render_frames(celebrate, [16, 38], "celef", view="front")
render_frames(walk, [1, 7, 13], "walk")
render_frames(run, [1, 6, 11], "run")

# ---- export ----
if EXPORT:
    ARM.animation_data.action = None
    for tr in list(ARM.animation_data.nla_tracks):
        ARM.animation_data.nla_tracks.remove(tr)
    for act in (kick, celebrate, idle, walk, run):
        tr = ARM.animation_data.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, 1, act)
    for ob in bpy.data.objects:
        ob.select_set(ob.type == "ARMATURE" or (ob.type == "MESH" and any(m.type == "ARMATURE" for m in ob.modifiers)))
    bpy.ops.export_scene.gltf(
        filepath="/Users/mattgreenberg/dev/demos/stadium/public/player.glb",
        use_selection=True,
        export_animation_mode="NLA_TRACKS",
        export_optimize_animation_size=True,
    )
    print("EXPORTED player.glb")
print("DONE")
