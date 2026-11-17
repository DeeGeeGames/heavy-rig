"""Bake the approved camouflage fields into a shared 128-cubed lookup texture."""
from pathlib import Path

import bpy
import numpy as np

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.render.threads_mode = 'FIXED'
scene.render.threads = 6
scene.render.resolution_x = 2048
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.dither_intensity = 0
scene.render.filter_size = .01
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'Raw'

bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.object
plane.scale.y = .5
material = bpy.data.materials.new('Camouflage field data')
material.use_nodes = True
plane.data.materials.append(material)
nodes = material.node_tree.nodes
links = material.node_tree.links
nodes.clear()


def math(operation, a, b=None):
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    for index, value in enumerate([a] if b is None else [a, b]):
        if isinstance(value, (int, float)):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs[0]


coordinate = nodes.new('ShaderNodeTexCoord')
separate = nodes.new('ShaderNodeSeparateXYZ')
links.new(coordinate.outputs['UV'], separate.inputs[0])
x = math('MULTIPLY', separate.outputs['X'], 16)
y = math('MULTIPLY', separate.outputs['Y'], 8)
vector = nodes.new('ShaderNodeCombineXYZ')
links.new(math('SUBTRACT', math('MULTIPLY', math('FRACT', x), 2), 1), vector.inputs['X'])
links.new(math('SUBTRACT', math('MULTIPLY', math('FRACT', y), 2), 1), vector.inputs['Y'])
slice_index = math('ADD', math('FLOOR', x), math('MULTIPLY', math('FLOOR', y), 16))
links.new(math('SUBTRACT', math('DIVIDE', math('ADD', slice_index, .5), 64), 1), vector.inputs['Z'])

noise = nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 5
noise.inputs['Detail'].default_value = 1
noise.inputs['Roughness'].default_value = .6
noise.inputs['Distortion'].default_value = .18
links.new(vector.outputs[0], noise.inputs['Vector'])

stretch = nodes.new('ShaderNodeVectorMath')
stretch.operation = 'MULTIPLY'
stretch.inputs[1].default_value = (1.2, 1.9, 2.4)
links.new(vector.outputs[0], stretch.inputs[0])
voronoi = nodes.new('ShaderNodeTexVoronoi')
voronoi.voronoi_dimensions = '3D'
voronoi.feature = 'F1'
voronoi.distance = 'EUCLIDEAN'
voronoi.inputs['Scale'].default_value = 3.5
voronoi.inputs['Randomness'].default_value = .85
links.new(stretch.outputs[0], voronoi.inputs['Vector'])
gray = nodes.new('ShaderNodeRGBToBW')
links.new(voronoi.outputs['Color'], gray.inputs[0])

channels = nodes.new('ShaderNodeCombineColor')
channels.mode = 'RGB'


def quantize(source, stops):
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for index, (position, value) in enumerate(stops):
        element = ramp.color_ramp.elements[0] if index == 0 else ramp.color_ramp.elements.new(position)
        element.position = position
        element.color = (value, value, value, 1)
    links.new(source, ramp.inputs[0])
    return ramp.outputs[0]


# Only the approved color boundaries are needed by the runtime. Discrete fields
# compress much smaller than full noise while retaining both armor palettes.
links.new(quantize(noise.outputs['Fac'], [(0, .25), (.41, .415), (.42, .5), (.59, .72)]), channels.inputs[0])
links.new(quantize(gray.outputs[0], [(0, .35), (.51, .6), (.68, .82)]), channels.inputs[1])
emission = nodes.new('ShaderNodeEmission')
links.new(channels.outputs[0], emission.inputs['Color'])
output = nodes.new('ShaderNodeOutputMaterial')
links.new(emission.outputs[0], output.inputs['Surface'])

camera = bpy.data.objects.new('Data camera', bpy.data.cameras.new('Data camera'))
scene.collection.objects.link(camera)
camera.location = (0, 0, 3)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2
scene.camera = camera
scene.render.filepath = str(root / 'public/assets/mechs/faction-patterns.png')
bpy.ops.render.render(write_still=True)

# Render filtering and output dithering are unsuitable for lookup data. Snap
# each channel back to its encoded field values before lossless PNG packaging.
image = bpy.data.images.load(scene.render.filepath)
image.colorspace_settings.name = 'Non-Color'
pixels = np.empty(2048 * 1024 * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
pixels = pixels.reshape((-1, 4))
for channel, values in [(0, [.25, .415, .5, .72]), (1, [.35, .6, .82])]:
    levels = np.array(values, dtype=np.float32)
    nearest = np.abs(pixels[:, channel, None] - levels).argmin(axis=1)
    pixels[:, channel] = levels[nearest]
pixels[:, 2], pixels[:, 3] = 0, 1
image.pixels.foreach_set(pixels.ravel())
image.filepath_raw = scene.render.filepath
image.file_format = 'PNG'
image.save()
