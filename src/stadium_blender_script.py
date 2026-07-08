# pinalty_stadium.py — Pin-Alty Shootout stadium builder
# Blender 4.x / 5.x. Safe to re-run in the same file: it wipes the scene first.
#
# Fans + flag cloths ship as separate three.js layers; only the flagpoles remain
# in the Blender scene.
#
# EXPORT_GLB = False -> just build the scene for preview/render.
# EXPORT_GLB = True  -> build, merge, bake COMBINED lighting to a texture,
#                       export GLB_PATH, leave the baked scene up for a 1:1
#                       comparison render (same camera, same view transform).
#
# Three.js (the baked texture is already display-ready sRGB):
#   renderer.outputColorSpace = THREE.SRGBColorSpace
#   material.toneMapped = false   # or renderer tone mapping re-crushes it
# Compositor bloom is post-processing and cannot bake; keep the Bloom pass in
# three.js if you want the floodlight panels to glow.
#
# Headless: /Applications/Blender.app/Contents/MacOS/Blender -b -P pinalty_stadium.py

import bpy, bmesh, random, os
from math import pi, radians, sin, cos, atan2
from mathutils import Vector

random.seed(11)

# ---------------------------------------------------------------- knobs
EXPORT_GLB = False        # True: bake lighting + export GLB_PATH
GLB_PATH = "~/dev/demos/stadium/public/pinalty_stadium3.glb"
BAKE_RES = 4096           # footprint is ~36x64 units; 2048 gets blurry
BAKE_SAMPLES = 512
UV_GUTTER_PX = 24         # island gutter must stay larger than bake bleed
BAKE_MARGIN_PX = 8

# post-build resize: object name -> uniform factor or (x, y, z). Applied after
# the whole scene is built, before bake/export — tweak, re-render, then bake.
# Scales about each object's origin, so it stays planted where it was placed.
RESIZE = {
    "Scoreboard": 2.1,
    # "Goal": 1.15,
}

# ---------------------------------------------------------------- helpers
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

_mats = {}
def mat(name, hexcol, rough=0.55, emit=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    col = (*srgb(hexcol), 1.0)
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = rough
    if emit:
        for k in ("Emission Color", "Emission"):
            if k in b.inputs:
                b.inputs[k].default_value = col
                break
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = emit
    _mats[name] = m
    return m

def put(o, c):
    for uc in list(o.users_collection):
        uc.objects.unlink(o)
    c.objects.link(o)
    return o

def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True

def box(name, size, loc, m, c, bev=0.0, rz=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = o.data.name = name
    o.scale = size
    o.rotation_euler = (0, 0, rz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bev:
        md = o.modifiers.new("b", 'BEVEL')
        md.width, md.segments, md.limit_method = bev, 3, 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=md.name)
    if m:
        o.data.materials.append(m)
    return put(o, c)

def sphere(name, r, loc, m, c, segs=20, rings=14, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.name = o.data.name = name
    if scale:
        o.scale = scale
    if m:
        o.data.materials.append(m)
    smooth(o)
    return put(o, c)

def cyl(name, r, depth, loc, m, c, rot=(0, 0, 0), verts=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = o.data.name = name
    if m:
        o.data.materials.append(m)
    smooth(o)
    return put(o, c)

def half_torus(name, major, minor, loc, m, c):
    # arch standing in the XZ plane (upper half of a torus)
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=48, minor_segments=12, location=(0, 0, 0))
    o = bpy.context.object
    o.name = o.data.name = name
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -1e-4], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.rotation_euler = (pi / 2, 0, 0)
    o.location = loc
    if m:
        o.data.materials.append(m)
    smooth(o)
    return put(o, c)

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = objs[0].data.name = name
    return objs[0]

# ---------------------------------------------------------------- scene prep
# Full wipe, not just the default cube: anything left over from a previous run
# or an imported GLB (e.g. the old baked Stadium mesh, whose black-base-color
# emissive material renders as a black pitch) must not survive into this build.
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for block_list in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                   bpy.data.cameras, bpy.data.collections, bpy.data.worlds,
                   bpy.data.node_groups):
    for block in list(block_list):
        block_list.remove(block)
for im in list(bpy.data.images):
    if im.users == 0:
        bpy.data.images.remove(im)

root = bpy.data.collections.new("PinAlty_Stadium")
bpy.context.scene.collection.children.link(root)
def coll(n):
    c = bpy.data.collections.new(n)
    root.children.link(c)
    return c
C_PITCH, C_WALL, C_STANDS, C_TUNNEL, C_DECO = map(
    coll, ("Pitch", "Walls", "Stands", "Tunnel", "Deco"))

def grass_mat(name, hexbase):
    base = srgb(hexbase)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.82
    # turf look: fine dense speckle with dark AND light flecks over the base
    # green — reads as mown grass blades at distance, still flat (no bump)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 70.0
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.5
    noise.inputs["Distortion"].default_value = 0.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*[c * 0.90 for c in base], 1.0)
    ramp.color_ramp.elements[1].position = 0.40
    ramp.color_ramp.elements[1].color = (*base, 1.0)
    light_el = ramp.color_ramp.elements.new(0.66)
    light_el.color = (*[min(1.0, c * 1.09) for c in base], 1.0)
    L = nt.links
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m

# ---------------------------------------------------------------- materials
GRASS_A  = grass_mat("Grass_A", "#7CC24F")   # richer, less pastel than the old
GRASS_B  = grass_mat("Grass_B", "#63A83F")   # candy greens — reference turf
LINE     = mat("Line_White", "#FBFBF3", 0.5)
CURB     = mat("Curb_White", "#FFF8EE", 0.45)
DARK     = mat("Tunnel_Dark", "#1E1424", 0.8)
PINK_TUN = mat("Tunnel_Pink", "#F390B4", 0.45)
DEEP_PINK = mat("Trim_DeepPink", "#C24A78", 0.4)
MINT_TRIM = mat("Trim_Mint", "#79D6C3", 0.4)
GOLD     = mat("Gold", "#F2BE4A", 0.35)
SLATE    = mat("Floodlight_Head", "#4A4458", 0.5)
POLE     = mat("Pole_White", "#F4F1EA", 0.4)
GLOW     = mat("Floodlight_Glow", "#FFF6DC", 0.3, emit=90.0)
SCREEN   = mat("Scoreboard_Screen", "#CFF3FF", 0.3, emit=3.5)

WALL_COLS = ["#F49FC0", "#FFF3E3", "#9FE3C0", "#FFF3E3"]
TIER_COLS = ["#FFF3E3", "#F7B8CD", "#FFF3E3", "#A8DEC9"]

def cmat(prefix, hexcol, rough=0.55):
    return mat(f"{prefix}_{hexcol.lstrip('#')}", hexcol, rough)

# ---------------------------------------------------------------- pitch
# Mow stripes span the entire floor footprint (46x72, reaching the outer
# walls) instead of a narrow lane on a plain apron — matches the reference.
FLOOR_W, FLOOR_L, STRIPE_W = 46.0, 72.0, 3.0
N_STRIPES = 16  # 16*3=48 > 46: half-stripe overhang each side hides behind the walls
for i in range(N_STRIPES):
    box(f"Pitch_Stripe_{i}", (STRIPE_W, FLOOR_L, 0.3),
        (-FLOOR_W / 2 + STRIPE_W * (i + 0.5) - 1.0, 3, -0.15),
        GRASS_A if i % 2 == 0 else GRASS_B, C_PITCH)

for sx in (-1, 1):  # sidelines run the whole floor, front edge to back wall
    box(f"Line_Side_{'L' if sx < 0 else 'R'}", (0.16, FLOOR_L, 0.04), (sx * 8.7, 3, 0.02), LINE, C_PITCH)
for i in range(15):  # dashes reach the sidelines at ±8.7
    box(f"Line_Dash_{i}", (0.6, 0.16, 0.04), (-8.4 + 1.2 * i, 4.0, 0.02), LINE, C_PITCH)
bpy.ops.mesh.primitive_torus_add(major_radius=2.0, minor_radius=0.09,
                                 major_segments=48, minor_segments=8, location=(0, -6, 0.02))
circ = bpy.context.object
circ.name = circ.data.name = "Line_Circle"
circ.scale = (1, 1, 0.25)
circ.data.materials.append(LINE)
smooth(circ)
put(circ, C_PITCH)

# penalty markings at the goal end (goal line sits at GOAL_Y=12.82)
BOX_W, BOX_D = 14.0, 5.5
box("Line_Goal", (17.56, 0.16, 0.04), (0, 12.82, 0.02), LINE, C_PITCH)  # sideline to sideline
box("Line_Box_Front", (BOX_W, 0.16, 0.04), (0, 12.82 - BOX_D, 0.02), LINE, C_PITCH)
for sx in (-1, 1):
    box(f"Line_Box_{'L' if sx < 0 else 'R'}", (0.16, BOX_D, 0.04),
        (sx * BOX_W / 2, 12.82 - BOX_D / 2, 0.02), LINE, C_PITCH)

# ---------------------------------------------------------------- outer wall
# Tall perimeter wall behind the bleachers and the goal end; camera end stays open.
WALL_H, WALL_T = 9.0, 1.2
WALL_MAT = cmat("OuterWall", "#FFF3E3", 0.55)
for sx in (-1, 1):
    tag = 'L' if sx < 0 else 'R'
    box(f"Wall_Side_{tag}", (WALL_T, 61, WALL_H), (sx * 21.0, 6.5, WALL_H / 2),
        WALL_MAT, C_WALL, bev=0.15)
    box(f"Wall_Side_Trim_{tag}", (WALL_T + 0.3, 61, 0.5), (sx * 21.0, 6.5, WALL_H + 0.25),
        MINT_TRIM, C_WALL, bev=0.1)
box("Wall_Back", (43.2, WALL_T, WALL_H), (0, 37.0, WALL_H / 2), WALL_MAT, C_WALL, bev=0.15)
box("Wall_Back_Trim", (43.8, WALL_T + 0.3, 0.5), (0, 37.0, WALL_H + 0.25),
    MINT_TRIM, C_WALL, bev=0.1)

# pink accent band breaking up the tall blank wall face
BAND_MAT = cmat("WallBand", "#F49FC0", 0.5)
for sx in (-1, 1):
    box(f"Wall_Band_{'L' if sx < 0 else 'R'}", (0.15, 61, 0.9),
        (sx * (21.0 - WALL_T / 2 - 0.05), 6.5, 5.6), BAND_MAT, C_WALL)
box("Wall_Band_Back", (43.2, 0.15, 0.9), (0, 37.0 - WALL_T / 2 - 0.05, 5.6), BAND_MAT, C_WALL)

# ---------------------------------------------------------------- stands
TIERS = 4
def tier_z(i):
    return 1.4 + 1.1 * i

for side in (-1, 1):
    for i in range(TIERS):
        h = tier_z(i)
        box(f"Stand_{'L' if side < 0 else 'R'}_{i}", (2.4, 50, h),
            (side * (12.0 + 2.4 * i), 1.0, h / 2),
            cmat("Tier", TIER_COLS[i % len(TIER_COLS)], 0.6), C_STANDS, bev=0.1)
for j in range(TIERS):
    h = tier_z(j)
    box(f"Stand_Back_{j}", (44, 2.4, h), (0, 27.8 + 2.4 * j, h / 2),
        cmat("Tier", TIER_COLS[j % len(TIER_COLS)], 0.6), C_STANDS, bev=0.1)

# ---------------------------------------------------------------- ad hoardings
# Candy boards filling the empty apron band between the sidelines and stands.
HOARD_COLS = ["#F78FB8", "#7EDBB4", "#FFD166", "#7CC4F0"]
for sx in (-1, 1):
    for k, yy in enumerate(range(-18, 21, 4)):
        box(f"Hoarding_{'L' if sx < 0 else 'R'}_{k}", (0.18, 3.6, 0.85),
            (sx * 10.4, yy, 0.425),
            cmat("Hoard", HOARD_COLS[k % len(HOARD_COLS)], 0.45), C_DECO, bev=0.06)

# ---------------------------------------------------------------- tunnel
outer = box("Tunnel_Body", (11, 4.6, 7), (0, 25.1, 3.5), PINK_TUN, C_TUNNEL, bev=0.55)
cut1 = box("_cut1", (5.6, 7, 3.4), (0, 24.9, 1.65), None, C_TUNNEL)
cut2 = cyl("_cut2", 2.8, 7, (0, 24.9, 3.3), None, C_TUNNEL, rot=(pi / 2, 0, 0), verts=48)
for cut in (cut1, cut2):
    md = outer.modifiers.new("bool", 'BOOLEAN')
    md.object, md.operation = cut, 'DIFFERENCE'
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.data.objects.remove(cut, do_unlink=True)

half_torus("Tunnel_Trim", 2.8, 0.22, (0, 22.65, 3.3), DEEP_PINK, C_TUNNEL)
for sx in (-1, 1):
    cyl(f"Tunnel_TrimLeg_{'L' if sx < 0 else 'R'}", 0.22, 3.3, (sx * 2.8, 22.65, 1.65), DEEP_PINK, C_TUNNEL)
box("Tunnel_BackWall", (5.9, 0.4, 6.6), (0, 26.3, 3.3), DARK, C_TUNNEL)
box("Tunnel_Floor", (5.9, 4.2, 0.12), (0, 25.0, 0.06), DARK, C_TUNNEL)

# ---------------------------------------------------------------- scoreboard
# Jumbotron perched on the back-wall crest: from the pitch-level camera the
# tunnel occludes the wall face below z~6.8, so a wall-mounted screen only
# showed a glowing sliver. Raised + tilted at the pitch, with blue/red score
# panels matching the crowd halves so it reads as a scoreboard, not a light.
# Screen content (score) is rendered in three.js as a canvas overlay; the bake
# only ships the frame + soft white backlight.
SB_Y = 33.7
sb = [box("Scoreboard_Frame", (10.5, 0.6, 4.0), (0, SB_Y, 13.62), SLATE, C_DECO, bev=0.12),
      box("Scoreboard_Screen", (9.4, 0.14, 3.0), (0, SB_Y - 0.35, 13.62), SCREEN, C_DECO)]
sb = join(sb, "Scoreboard")
sb.rotation_euler = (radians(10), 0, 0)  # lean the screen down at the pitch

# ---------------------------------------------------------------- goal
# Frame only — the net is added programmatically in three.js later.
GOAL_W, GOAL_H, GOAL_R, GOAL_Y = 9.6, 3.9, 0.14, 12.82
goal = [cyl(f"Goal_Post_{'L' if sx < 0 else 'R'}", GOAL_R, GOAL_H,
            (sx * GOAL_W / 2, GOAL_Y, GOAL_H / 2), POLE, C_DECO, verts=16)
        for sx in (-1, 1)]
goal.append(cyl("Goal_Bar", GOAL_R, GOAL_W + 2 * GOAL_R, (0, GOAL_Y, GOAL_H),
                POLE, C_DECO, rot=(0, pi / 2, 0), verts=16))
g = join(goal, "Goal")
g.location = (-6.76, 12.78, 1.43)   # placement dialed in in Blender
g.scale = (1.415, 1.415, 1.415)

# ---------------------------------------------------------------- flagpoles
# Pole + gold finial only; the red cloth ships as a separate three.js layer.
def flagpole(name, x, y):
    parts = [cyl(name, 0.06, 5.2, (x, y, 2.6), POLE, C_DECO, verts=12),
             sphere(name + "_top", 0.13, (x, y, 5.3), GOLD, C_DECO, segs=12, rings=8)]
    join(parts, name)

flagpole("Flagpole_R", 10.6, 14.0)
flagpole("Flagpole_L", -10.6, -10.0)

# ---------------------------------------------------------------- floodlights
# Big stadium heads matching the reference: a wide slate frame holding a 4x3
# grid of glowing square panels, tilted down at the pitch.
HEAD_W, HEAD_H, COLS, ROWS, GAP = 4.4, 3.2, 4, 3, 0.22
for k, (fx, fy) in enumerate(((-19, 33), (19, 33))):  # back pair only
    rz = atan2(-fy, -fx)
    tilt = radians(18)
    pole = cyl(f"Floodlight_{k}", 0.16, 11.5, (fx, fy, 5.75), POLE, C_DECO, verts=16)
    # build the head flat at the origin, then rotate/park the whole assembly
    head_parts = [box(f"_fh{k}", (0.7, HEAD_W, HEAD_H), (0, 0, 0), SLATE, C_DECO, bev=0.08)]
    cw = (HEAD_W - GAP * (COLS + 1)) / COLS
    ch = (HEAD_H - GAP * (ROWS + 1)) / ROWS
    for ci in range(COLS):
        for ri in range(ROWS):
            head_parts.append(box(
                f"_fc{k}_{ci}{ri}", (0.12, cw, ch),
                (0.38, -HEAD_W / 2 + GAP + cw / 2 + ci * (cw + GAP),
                 -HEAD_H / 2 + GAP + ch / 2 + ri * (ch + GAP)), GLOW, C_DECO))
    head = join(head_parts, f"_fhead{k}")
    head.rotation_euler = (0, tilt, rz)
    head.location = (fx, fy, 12.0)
    join([pole, head], f"Floodlight_{k}")

# ---------------------------------------------------------------- light / world / camera
sun = bpy.data.lights.new("Sun", 'SUN')
sun.energy = 0.55                      # dimmed: floodlights carry the scene
sun.angle = radians(3)
sun.color = srgb("#FFE3B8")            # warm key, low for long shadows
so = bpy.data.objects.new("Sun", sun)
so.rotation_euler = (radians(63), 0, radians(-38))
bpy.context.scene.collection.objects.link(so)
put(so, C_DECO)

fill = bpy.data.lights.new("Sun_Fill", 'SUN')
fill.energy = 0.15
fill.angle = radians(30)
fill.color = srgb("#BFD9FF")           # cool soft fill from the opposite side
fo = bpy.data.objects.new("Sun_Fill", fill)
fo.rotation_euler = (radians(55), 0, radians(140))
bpy.context.scene.collection.objects.link(fo)
put(fo, C_DECO)

def spot(name, loc, target, energy):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.energy = energy
    ld.color = srgb("#FFF2D8")
    ld.spot_size = radians(70)
    ld.spot_blend = 0.6
    ld.shadow_soft_size = 0.6
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(o)
    put(o, C_DECO)

for k, (fx, fy) in enumerate(((-19, 33), (19, 33))):
    spot(f"Floodlight_Spot_{k}", (fx * 0.97, fy * 0.97, 11.4),
         (fx * 0.15, fy * 0.2, 0), 55000)

world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes.get("Background")
if bg:
    # gradient sky: warm horizon -> blue zenith
    tc = wnt.nodes.new("ShaderNodeTexCoord")
    sep = wnt.nodes.new("ShaderNodeSeparateXYZ")
    mr = wnt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.05
    mr.inputs["From Max"].default_value = 0.35
    ramp = wnt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*srgb("#FFE9D2"), 1.0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (*srgb("#7FB8EF"), 1.0)
    L = wnt.links
    L.new(tc.outputs["Generated"], sep.inputs["Vector"])
    L.new(sep.outputs["Z"], mr.inputs["Value"])
    L.new(mr.outputs["Result"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], bg.inputs[0])
    bg.inputs[1].default_value = 0.22   # darker dusk sky, less ambient wash

cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 32
cam = bpy.data.objects.new("Camera", cam_data)
cam.location = (0, -34.5, 8.0)
cam.rotation_euler = (radians(81), 0, 0)
bpy.context.scene.collection.objects.link(cam)
put(cam, C_DECO)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.view_settings.view_transform = 'Standard'   # keep the candy colors punchy

# render quality: raytraced GI/AO + soft shadows (all optional, best-effort)
for attr, val in (("use_raytracing", True), ("use_fast_gi", True),
                  ("shadow_ray_count", 2), ("shadow_step_count", 4),
                  ("taa_render_samples", 64)):
    try:
        setattr(scene.eevee, attr, val)
    except Exception:
        pass

# compositor bloom so the floodlight panels actually glow (Blender 5 node-group API)
try:
    g = bpy.data.node_groups.new("PinAlty_Comp", 'CompositorNodeTree')
    g.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    gout = g.nodes.new("NodeGroupOutput")
    try:
        src = g.nodes.new("CompositorNodeRLayers")
        img = src.outputs["Image"]
    except Exception:
        g.interface.new_socket("Image", in_out='INPUT', socket_type='NodeSocketColor')
        img = g.nodes.new("NodeGroupInput").outputs[0]
    gl = g.nodes.new("CompositorNodeGlare")
    gl.inputs["Type"].default_value = 'Bloom'
    gl.inputs["Threshold"].default_value = 1.3
    gl.inputs["Strength"].default_value = 0.55
    gl.inputs["Size"].default_value = 0.65
    g.links.new(img, gl.inputs["Image"])
    g.links.new(gl.outputs["Image"], gout.inputs["Image"])
    scene.compositing_node_group = g
    scene.render.use_compositing = True
except Exception as e:
    print("bloom setup skipped:", e)

bpy.ops.object.select_all(action='DESELECT')
print(f"done — {len([o for o in bpy.data.objects])} objects")

# ---------------------------------------------------------------- post-build resize
for name, s in RESIZE.items():
    o = bpy.data.objects.get(name)
    if not o:
        print(f"RESIZE: no object named {name!r}")
        continue
    f = (s, s, s) if isinstance(s, (int, float)) else s
    o.scale = [a * b for a, b in zip(o.scale, f)]

# ---------------------------------------------------------------- bake + GLB
# Ported from the v10 web-bake workflow (stadium repo src/script.py). Two baked
# representations keep the export 1:1 with the Blender render:
#   1. linear float bake  -> left on the merged mesh, viewed through Blender's
#      view transform exactly once, so the viewport matches a live render.
#   2. display-referred sRGB PNG (saved THROUGH the scene view transform)
#      -> used only inside the GLB, where three.js shows it untransformed.
# Saving the bake with a plain Image.save() would skip the view transform;
# viewing the display PNG in Blender would apply it twice. Both look "off".
if EXPORT_GLB:
    out_path = os.path.expanduser(GLB_PATH)

    mesh_objects = [o for o in bpy.data.objects if o.type == 'MESH']
    # ponytail: the tiny white Line_* boxes pack to near-subpixel UV islands and
    # some bake black; they're flat white anyway, so skip the bake and ship them
    # as a second mesh with a flat emissive material.
    line_objects = [o for o in mesh_objects if o.name.startswith("Line_")]
    mesh_objects = [o for o in mesh_objects if o not in line_objects]
    lines = join(line_objects, "Lines")
    bpy.ops.object.select_all(action='DESELECT')
    for o in mesh_objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    bpy.ops.object.join()
    stadium = bpy.context.object
    stadium.name = stadium.data.name = "Stadium"
    stadium_me = stadium.data

    lightmap_uv = stadium_me.uv_layers.new(name="Lightmap")
    stadium_me.uv_layers.active = lightmap_uv
    lightmap_uv.active_render = True

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=radians(66),
        island_margin=UV_GUTTER_PX / BAKE_RES,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    # smart_project alone can overlap tiny islands (one line dash baked black);
    # a pack pass guarantees every island gets its own texture space.
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=UV_GUTTER_PX / BAKE_RES)
    except TypeError:
        bpy.ops.uv.pack_islands(margin=UV_GUTTER_PX / BAKE_RES)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Float buffer so highlights/emission don't clip before the view transform.
    bake_img = bpy.data.images.new("stadium_bake_linear", width=BAKE_RES,
                                   height=BAKE_RES, alpha=False, float_buffer=True)
    for cs in ("Linear Rec.709", "Linear", "Non-Color"):
        try:
            bake_img.colorspace_settings.name = cs
            break
        except TypeError:
            continue
    for material in stadium_me.materials:
        nt_ = material.node_tree
        bake_node = nt_.nodes.new("ShaderNodeTexImage")
        bake_node.name = "BAKE_TARGET"
        bake_node.image = bake_img
        for node in nt_.nodes:
            node.select = False
        nt_.nodes.active = bake_node
        bake_node.select = True

    scene.render.engine = 'CYCLES'
    try:
        scene.cycles.device = 'GPU'
    except Exception:
        pass
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_adaptive_sampling = True
    # Bakes are never denoised; samples are the quality knob.
    scene.cycles.use_denoising = False

    bake = scene.render.bake
    bake.use_pass_direct = True
    bake.use_pass_indirect = True
    bake.use_pass_diffuse = True
    bake.use_pass_glossy = True      # specular highlights match the render
    bake.use_pass_emit = True        # floodlight glow panels stay bright
    bake.use_pass_transmission = False

    print(f"baking COMBINED {BAKE_RES}x{BAKE_RES}, {BAKE_SAMPLES} samples...")
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = stadium
    stadium.select_set(True)
    bpy.ops.object.bake(type='COMBINED', use_clear=True,
                        margin=BAKE_MARGIN_PX, margin_type='EXTEND')

    display_path = os.path.splitext(out_path)[0] + "_bake.png"
    image_settings = scene.render.image_settings
    image_settings.file_format = 'PNG'
    image_settings.color_mode = 'RGB'
    image_settings.color_depth = '8'
    bake_img.save_render(display_path, scene=scene)
    baked_display = bpy.data.images.load(display_path, check_existing=False)
    baked_display.name = "stadium_bake"
    baked_display.colorspace_settings.name = 'sRGB'
    baked_display.pack()

    # Emissive-only export material: geometry carries its lighting in the texture.
    export_mat = bpy.data.materials.new("Stadium_Baked")
    export_mat.use_nodes = True
    b = export_mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    b.inputs["Roughness"].default_value = 1.0
    for k in ("Specular IOR Level", "Sheen Weight"):
        if k in b.inputs:
            b.inputs[k].default_value = 0.0
    b.inputs["Emission Strength"].default_value = 1.0
    tex = export_mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.name = "BAKED_TEXTURE"
    tex.image = baked_display
    tex.interpolation = 'Linear'
    tex.extension = 'EXTEND'
    export_mat.node_tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])

    stadium_me.materials.clear()
    stadium_me.materials.append(export_mat)
    for polygon in stadium_me.polygons:
        polygon.material_index = 0

    # flat emissive white for the unbaked lines (matches how the bake would
    # render them: near-white, unlit in three.js)
    line_mat = bpy.data.materials.new("Lines_Flat")
    line_mat.use_nodes = True
    lb = line_mat.node_tree.nodes["Principled BSDF"]
    lb.inputs["Base Color"].default_value = (0, 0, 0, 1)
    lb.inputs["Roughness"].default_value = 1.0
    lb.inputs["Emission Color"].default_value = (*srgb("#FBFBF3"), 1.0)
    lb.inputs["Emission Strength"].default_value = 1.0
    lines.data.materials.clear()
    lines.data.materials.append(line_mat)

    for o in bpy.data.objects:
        o.select_set(o in (stadium, lines))
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_animations=False,
        export_image_format='AUTO',
    )
    print(f"exported {out_path} (texture: {display_path})")

    # Leave Blender showing the LINEAR bake so the view transform applies once,
    # exactly like a live render — this is the 1:1 comparison state.
    tex.image = bake_img
    bpy.ops.object.select_all(action='DESELECT')
