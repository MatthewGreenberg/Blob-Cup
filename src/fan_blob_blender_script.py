# fan_blob_blender_script.py — expressive crowd-blob builder + GLB exporter
# Blender 4.x / 5.x. Safe to re-run: wipes the scene first.
#
# Builds ONE blob as a SINGLE mesh ("FanBlob") so three.js can instance it:
#   - vertex colors carry the face: body is WHITE (so instanceColor tint works),
#     eyes/mouth are dark (dark x tint stays dark), blush pink, eye sparkles white.
#     One material -> one glTF primitive -> one InstancedMesh draw call.
#   - shape keys (glTF morph targets) make the mouth expressive:
#       MouthOpen  — cheering "O"
#       MouthWide  — big grin
#       MouthFrown — sad corners-down
#   - origin at bottom-center, front faces Blender -Y (= three.js +Z, toward
#     the pitch camera, same convention as the current canvas-face crowd).
#
# three.js usage (r152+):
#   const mesh = new THREE.InstancedMesh(geo, mat, N)
#   mesh.setColorAt(i, pastel)                     // color per fan
#   matrix.makeScale(s, s * heightVar, s)          // height per fan
#   mesh.setMorphAt(i, dummyWithMorphInfluences)   // expression per fan
#   (loader auto-enables vertexColors when COLOR_0 is present)
#
# Headless: /Applications/Blender.app/Contents/MacOS/Blender -b -P src/fan_blob_blender_script.py

import bpy, os
from math import pi
from mathutils import Vector

# ---------------------------------------------------------------- knobs
EXPORT_GLB = True
GLB_PATH = "~/dev/demos/stadium/public/fan_blob.glb"

# ---------------------------------------------------------------- helpers
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def sphere(name, r, loc, segs=20, rings=14, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.name = o.data.name = name
    if scale:
        o.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    return o

def paint(o, hexcol):
    col = (*srgb(hexcol), 1.0)
    attr = o.data.color_attributes.new(name="Col", type='BYTE_COLOR', domain='POINT')
    for d in attr.data:
        d.color = col
    return o

# ---------------------------------------------------------------- scene wipe
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for bl in (bpy.data.meshes, bpy.data.materials):
    for b in list(bl):
        bl.remove(b)

# ---------------------------------------------------------------- build (front = -Y)
BZ = 0.72                     # body center height; bottom sits at z=0
parts = []

body = sphere("FanBlob", 0.62, (0, 0, BZ), segs=32, rings=24, scale=(0.95, 0.95, 1.15))
paint(body, "#FFFFFF")        # white -> takes instanceColor tint cleanly
parts.append(body)

for off in (-0.13, 0.13):     # eyes: tall dark ovals + white sparkle (big = cute)
    e = sphere("eye", 0.104, (off, -0.52, BZ + 0.16), segs=12, rings=8, scale=(1, 1, 1.3))
    parts.append(paint(e, "#241B26"))
    hl = sphere("hl", 0.039, (off + 0.024, -0.587, BZ + 0.215), segs=8, rings=6)
    parts.append(paint(hl, "#FFFFFF"))

for off in (-0.28, 0.28):     # blush: sphere projected onto the body -> flat decal
    b = sphere("blush", 0.094, (off, -0.47, BZ - 0.028), segs=12, rings=8)
    C = Vector((0, 0, BZ)) - Vector(b.location)   # body center in blush-local
    A = (0.62 * 0.95, 0.62 * 0.95, 0.62 * 1.15)   # body ellipsoid semi-axes
    ns = {v.index: sum(((v.co - C)[i] / A[i]) ** 2 for i in range(3)) ** 0.5
          for v in b.data.vertices}
    lo, hi = min(ns.values()), max(ns.values())
    for v in b.data.vertices:                     # deeper verts sit lower: thin shell, no z-fight
        eps = 0.004 + 0.012 * (ns[v.index] - lo) / (hi - lo)
        v.co = C + (v.co - C) * ((1 + eps) / ns[v.index])
    parts.append(paint(b, "#FF8FB4"))

mouth = sphere("mouth", 0.068, (0, -0.575, BZ - 0.035), segs=16, rings=12,
               scale=(1.15, 0.7, 0.85))
paint(mouth, "#6B3040")
vg = mouth.vertex_groups.new(name="mouth")
vg.add([v.index for v in mouth.data.vertices], 1.0, 'REPLACE')
parts.append(mouth)

for side in (-1, 1):          # stubby nub arms, dusty pink (tint multiplies -> stays darker)
    a = sphere("arm", 0.11, (side * 0.60, -0.12, BZ - 0.25), segs=12, rings=8)
    a.scale = (1.5, 0.8, 0.8)
    a.rotation_euler = (0, side * pi * 35 / 180, 0)   # tilt down-and-out
    parts.append(paint(a, "#D96E93"))

# ---------------------------------------------------------------- join -> single mesh
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
blob = bpy.context.object
blob.name = blob.data.name = "FanBlob"
me = blob.data

m = bpy.data.materials.new("FanBlob")
m.use_nodes = True
bsdf = m.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.5
ca = m.node_tree.nodes.new("ShaderNodeVertexColor")
ca.layer_name = "Col"
m.node_tree.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
me.materials.append(m)

# ---------------------------------------------------------------- squash base
# flatten the bottom into a contact patch (with a slight outward bulge) so the
# blob reads as sitting on the tier instead of tangent-touching it
BOTTOM = -0.62 * 1.15         # body-local z of the lowest vertex
SQ_START = -0.45              # squash begins here
for v in me.vertices:
    if v.co.z < SQ_START:
        t = (SQ_START - v.co.z) / (SQ_START - BOTTOM)   # 0 at start -> 1 at bottom
        v.co.z = SQ_START + (v.co.z - SQ_START) * 0.4
        s = 1 + 0.16 * t * t
        v.co.x *= s
        v.co.y *= s
drop = min(v.co.z for v in me.vertices) + BZ            # re-seat bottom on z=0
for v in me.vertices:
    v.co.z -= drop

# ---------------------------------------------------------------- mouth shape keys
gi = blob.vertex_groups["mouth"].index
midx = [v.index for v in me.vertices if any(g.group == gi for g in v.groups)]
mc = sum((me.vertices[i].co.copy() for i in midx), start=bpy.context.object.location * 0) / len(midx)
EXT_X = 0.068 * 1.15
def bend(x):                  # corner lift, quadratic across mouth width
    return 0.028 * (x / EXT_X) ** 2

for i in midx:                # basis gets a gentle smile curve (corners up)
    me.vertices[i].co.z += bend(me.vertices[i].co.x - mc.x)

blob.shape_key_add(name="Basis")

def add_key(name, fn):
    k = blob.shape_key_add(name=name, from_mix=False)
    for i in midx:
        rel = me.vertices[i].co - mc
        k.data[i].co = mc + fn(rel)

from mathutils import Vector
add_key("MouthOpen",  lambda r: Vector((r.x * 0.75, r.y * 1.1,
                                        (r.z - bend(r.x)) * 2.8 - 0.02)))
add_key("MouthWide",  lambda r: Vector((r.x * 2.0, r.y,
                                        r.z * 1.1 + bend(r.x) * 1.5)))
add_key("MouthFrown", lambda r: Vector((r.x, r.y,
                                        r.z - 2.0 * bend(r.x) - 0.01)))

# ---------------------------------------------------------------- origin + export
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

if EXPORT_GLB:
    out_path = os.path.expanduser(GLB_PATH)
    bpy.ops.object.select_all(action='DESELECT')
    blob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,          # must stay off: mesh has shape keys
        export_yup=True,
        export_morph=True,
        export_animations=False,
        export_attributes=True,      # COLOR_0 vertex colors
    )
    print(f"exported {out_path}")

print(f"FanBlob: {len(me.vertices)} verts, keys: "
      f"{[k.name for k in me.shape_keys.key_blocks]}")
