"""Add keeper actions to bear-goalie.blend rig, render previews, export GLB.
Run: Blender -b ~/Desktop/Blend/bear-goalie.blend -P src/goalie_anim_blender_script.py -- [--export]
Same Tripo rig family as main-player.blend (character faces +X, z-up):
  legs/arms hanging down: +Y = swing backward, -Y = swing forward; knee flex = +Y
  legs: +X = spread toward his left (+Y side), -X = toward his right
  left arm (bone +Y):  X + = raise up, Z - = swing forward
  right arm (bone -Y): X - = raise up, Z + = swing forward
  spine/head (bone +Z): +Y = lean forward, +X = tilt toward his right (-Y)
  whole-body roll (Hip X): - = tip toward his left (+Y) = game world +X after
  the GLB yaw (-pi/2), so DiveR (world +X) rolls Hip X negative.
"""
import bpy, sys, math
from mathutils import Matrix

ARM = bpy.data.objects["Armature"]
SCRATCH = "/private/tmp/claude-501/-Users-mattgreenberg-dev-demos-stadium/4192050b-4863-4d53-ae57-c4d35c2bb68e/scratchpad"
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

# Keeper ready stance: feet apart, knees bent, torso forward, paws out wide.
def ready(bounce=0.0):
    return [
        ("L_Thigh", X, 16), ("R_Thigh", X, -16),
        ("L_Thigh", Y, -28 - bounce), ("R_Thigh", Y, -28 - bounce),
        ("L_Calf", Y, 42 + bounce * 1.5), ("R_Calf", Y, 42 + bounce * 1.5),
        ("L_Foot", Y, -16), ("R_Foot", Y, -16),
        ("Spine01", Y, 12), ("Spine02", Y, 6),
        ("Head", Y, -14),
        ("L_Upperarm", X, -35), ("R_Upperarm", X, 35),
        ("L_Upperarm", Z, -12), ("R_Upperarm", Z, 12),
        ("L_Forearm", Z, -20), ("R_Forearm", Z, 20),
        ("L_Forearm", X, 8), ("R_Forearm", X, -8),
    ]

READY = ready()
READY_DZ = -0.032

# ---- IDLE (48f seamless loop): bouncy ready-stance breathing ----
IDLE_B = ready(bounce=6) + [("Waist", X, 3)]
idle = make_action("Idle", [
    (1, READY_DZ, READY),
    (24, READY_DZ - 0.010, IDLE_B),
    (48, READY_DZ, READY),
])

# Evaluated-mesh floor check shared by pose calibration below.
_MESH = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
def planted(spec):
    """Hip dz that puts the pose's lowest vertex exactly on the floor."""
    apply_pose(spec, 0.0)
    ev = _MESH.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return -min((ev.matrix_world @ v.co).z for v in ev.data.vertices)

# ---- DIVES (30f one-shot): anticipation dip -> full-stretch flying dive ->
# superhero crouch landing -> recover. Authored in place; the game translates
# the keeper group to diveX while the clip plays.
def dive(side):  # side +1 = toward his left (+Y) = game world +X ("DiveR")
    near, far = ("L", "R") if side > 0 else ("R", "L")
    ANTICIPATE = ready(bounce=10) + [
        ("Hip", X, side * 14),  # coil away from the dive
        ("Spine01", Y, 6),
        (f"{near}_Upperarm", X, -20 * (1 if near == "L" else -1)),
    ]
    STRETCH = [
        ("Hip", X, -side * 78),  # whole body tips into the dive
        ("Spine01", X, -side * 12), ("Spine02", X, -side * 6),
        ("Head", X, side * 24),  # keep eyes on the ball
        # both arms stretched overhead, in line with the flying body
        ("L_Upperarm", X, 72), ("R_Upperarm", X, -72),
        ("L_Forearm", X, 10), ("R_Forearm", X, -10),
        # far leg trails bent, near leg kicks long
        (f"{far}_Thigh", Y, -18), (f"{far}_Calf", Y, 55),
        (f"{near}_Thigh", Y, 10), (f"{near}_Calf", Y, 8),
        (f"{near}_Foot", Y, 20), (f"{far}_Foot", Y, 10),
    ]
    LAND = ready(bounce=14) + [
        ("Hip", X, -side * 18),
        ("Spine01", X, -side * 8),
        ("Head", X, side * 10),
        (f"{near}_Upperarm", X, 45 * (1 if near == "L" else -1)),  # near paw still up
    ]
    return make_action("DiveR" if side > 0 else "DiveL", [
        (1, READY_DZ, READY),
        (5, READY_DZ + 0.007, ANTICIPATE),
        (11, 0.09, STRETCH),
        (14, 0.06, STRETCH),
        (20, READY_DZ + 0.017, LAND),
        (30, READY_DZ, READY),
    ])

dive_r = dive(+1)
dive_l = dive(-1)

# ---- SAVE CENTER (30f one-shot): drop into a deep scoop block ----
SCOOP = [
    ("L_Thigh", X, 26), ("R_Thigh", X, -26),
    ("L_Thigh", Y, -72), ("R_Thigh", Y, -72),
    ("L_Calf", Y, 105), ("R_Calf", Y, 105),
    ("L_Foot", Y, -32), ("R_Foot", Y, -32),
    ("Spine01", Y, 22), ("Spine02", Y, 8),
    ("Head", Y, -20),
    # paws scooped low in front
    ("L_Upperarm", X, -48), ("R_Upperarm", X, 48),
    ("L_Upperarm", Z, -50), ("R_Upperarm", Z, 50),
    ("L_Forearm", Z, -40), ("R_Forearm", Z, 40),
]
save_center = make_action("SaveCenter", [
    (1, READY_DZ, READY),
    (5, READY_DZ - 0.02, ready(bounce=8)),
    (11, -0.14, SCOOP),
    (20, -0.14, SCOOP),
    (30, READY_DZ, READY),
])

# ---- CATCH (30f one-shot): weak shot smothered — paws snap forward at chest
# height, then hug the ball in. Ends held on the hug (game clamps the last
# frame and pins the ball to his chest until the round resets).
REACH_FWD = ready(bounce=6) + [
    ("Spine01", Y, 4),
    # arms swing forward to meet the ball (L forward = Z-, R forward = Z+)
    ("L_Upperarm", Z, -60), ("R_Upperarm", Z, 60),
    ("L_Forearm", Z, -12), ("R_Forearm", Z, 12),
]
HUG = [
    ("L_Thigh", X, 14), ("R_Thigh", X, -14),
    ("L_Thigh", Y, -22), ("R_Thigh", Y, -22),
    ("L_Calf", Y, 34), ("R_Calf", Y, 34),
    ("L_Foot", Y, -12), ("R_Foot", Y, -12),
    ("Spine01", Y, 16), ("Spine02", Y, 8),
    ("Head", Y, -4),
    # forearms wrap the ball against the chest
    ("L_Upperarm", Z, -68), ("R_Upperarm", Z, 68),
    ("L_Upperarm", X, -14), ("R_Upperarm", X, 14),
    ("L_Forearm", Z, -58), ("R_Forearm", Z, 58),
    ("L_Forearm", X, 12), ("R_Forearm", X, -12),
]
catch = make_action("Catch", [
    (1, READY_DZ, READY),
    (5, planted(ready(bounce=8)), ready(bounce=8)),
    (9, planted(REACH_FWD), REACH_FWD),
    (14, planted(HUG), HUG),
    (30, planted(HUG), HUG),
])

# ---- CHEER (44f one-shot): made the save — bounce, arms up, wiggle ----
ARMS_UP = [("L_Clavicle", X, 15), ("R_Clavicle", X, -15),
           ("L_Upperarm", X, 62), ("R_Upperarm", X, -62),
           ("L_Forearm", X, 15), ("R_Forearm", X, -15)]
CROUCH = ready(bounce=16)
AIR = [
    ("Spine01", Y, 4),
    ("L_Thigh", X, 10), ("R_Thigh", X, -10),
    ("Head", Y, -10),
] + ARMS_UP
SWAY_L = [("Spine01", X, 12), ("Head", X, -8)] + ARMS_UP + [
    ("L_Thigh", X, 14), ("R_Thigh", X, -14),
    ("L_Thigh", Y, -14), ("R_Thigh", Y, -14), ("L_Calf", Y, 20), ("R_Calf", Y, 20),
]
SWAY_R = [("Spine01", X, -12), ("Head", X, 8)] + ARMS_UP + [
    ("L_Thigh", X, 14), ("R_Thigh", X, -14),
    ("L_Thigh", Y, -14), ("R_Thigh", Y, -14), ("L_Calf", Y, 20), ("R_Calf", Y, 20),
]
cheer = make_action("Cheer", [
    (1, READY_DZ, READY),
    (6, READY_DZ - 0.023, CROUCH),
    (12, 0.14, AIR),
    (16, 0.16, AIR),
    (21, READY_DZ - 0.023, CROUCH),
    (28, -0.01, SWAY_L),
    (36, -0.01, SWAY_R),
    (44, READY_DZ, READY),
])

# ---- DEJECTED (40f one-shot): conceded — slump, head-shake, sag ----
SLUMP = [
    ("L_Thigh", X, 10), ("R_Thigh", X, -10),
    ("L_Thigh", Y, -8), ("R_Thigh", Y, -8), ("L_Calf", Y, 12), ("R_Calf", Y, 12),
    ("Spine01", Y, 24), ("Spine02", Y, 10),
    ("Head", Y, 26),  # hangs the head
    ("L_Upperarm", X, -70), ("R_Upperarm", X, 70),  # arms hang limp
    ("L_Forearm", Y, -4), ("R_Forearm", Y, -4),
]
dejected = make_action("Dejected", [
    (1, READY_DZ, READY),
    (10, -0.001, SLUMP),
    (18, -0.001, SLUMP + [("Head", X, -10)]),
    (26, -0.001, SLUMP + [("Head", X, 10)]),
    (40, -0.005, SLUMP),
])

bpy.ops.object.mode_set(mode="OBJECT")

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
    "side": ((0.05, -2.4, 0.45), (math.radians(85), 0, 0)),
    "front": ((2.4, 0, 0.45), (math.radians(85), 0, math.radians(90))),
}

# Ground-contact check: evaluated-mesh min z at key poses (feet must sit ~0).
MESH = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == ARM)
def floor_z(act, frame):
    ARM.animation_data.action = act
    scn.frame_set(frame)
    ev = MESH.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return min((ev.matrix_world @ v.co).z for v in ev.data.vertices)

for act, frames in ((idle, (1, 24)), (dive_r, (5, 20, 30)), (save_center, (11,)), (catch, (9, 14)), (cheer, (6, 21)), (dejected, (18,))):
    for f in frames:
        print(f"FLOOR {act.name} f{f}: {floor_z(act, f):.3f}")

def render_frames(act, frames, tag, view="front"):
    cam.location, cam.rotation_euler = VIEWS[view]
    ARM.animation_data.action = act
    for f in frames:
        scn.frame_set(f)
        scn.render.filepath = f"{SCRATCH}/bear_{tag}_{view}_{f:02d}.png"
        bpy.ops.render.render(write_still=True)

render_frames(idle, [1, 24], "idle")
render_frames(idle, [1], "idle", view="side")
render_frames(dive_r, [5, 11, 20], "diveR")
render_frames(save_center, [11], "scoop")
render_frames(catch, [9, 14, 30], "catch")
render_frames(catch, [14], "catch", view="side")
render_frames(cheer, [16, 28], "cheer")
render_frames(dejected, [18], "deject", view="side")

# ---- export ----
if EXPORT:
    ARM.animation_data.action = None
    for tr in list(ARM.animation_data.nla_tracks):  # drop the Tripo preview track
        ARM.animation_data.nla_tracks.remove(tr)
    for act in (idle, dive_l, dive_r, save_center, catch, cheer, dejected):
        tr = ARM.animation_data.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, 1, act)
    for ob in bpy.data.objects:
        ob.select_set(ob.type == "ARMATURE" or (ob.type == "MESH" and any(m.type == "ARMATURE" for m in ob.modifiers)))
    bpy.ops.export_scene.gltf(
        filepath="/Users/mattgreenberg/dev/demos/stadium/public/goalie.glb",
        use_selection=True,
        export_animation_mode="NLA_TRACKS",
        export_optimize_animation_size=True,
    )
    print("EXPORTED goalie.glb")
print("DONE")
