"""Build horizontal sprite stacks directly from four pixel-art orthographic views.

Requires Pillow only. Input PNGs use a shared 64-pixel ground grid and 48-pixel
height. The front/back are 64x48; the side is 64x48 with nose left; the top is
64x64 with nose down. The waist projection is at ground coordinate (32, 32).
This is an approximate visual hull, not hidden-surface reconstruction.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageOps


SIZE = 64
HEIGHT = 48
ALPHA = 128
VIEWS = ('front', 'back', 'side', 'top')


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--views', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New output directory.')
    parser.add_argument('--source-commit', default='pixel-art-source-not-committed')
    parser.add_argument('--rig', type=Path, help='Optional complete rig.json from a prior export.')
    parser.add_argument('--frames', type=int, default=16)
    return parser.parse_args()


def load_views(folder):
    images = {}
    hashes = {}
    for name in VIEWS:
        path = folder / (name + '.png')
        hashes[name + '.png'] = hashlib.sha256(path.read_bytes()).hexdigest()
        image = Image.open(path).convert('RGBA')
        expected = (SIZE, SIZE if name == 'top' else HEIGHT)
        if image.size != expected:
            raise ValueError(f'{name}.png must be {expected}, received {image.size}')
        if not image.getchannel('A').point(lambda value: 255 if value >= ALPHA else 0).getbbox():
            raise ValueError(f'{name}.png has no opaque silhouette')
        images[name] = image
    images['back'] = ImageOps.mirror(images['back'])
    images['top'] = ImageOps.flip(images['top'])
    return images, hashes


def shared_palette(images):
    pixels = [pixel[:3] for image in images.values() for pixel in image.get_flattened_data()
              if pixel[3] >= ALPHA]
    swatch = Image.new('RGB', (len(pixels), 1))
    swatch.putdata(pixels)
    reduced = swatch.quantize(colors=12, method=Image.Quantize.MEDIANCUT,
                             dither=Image.Dither.NONE).convert('RGB')
    palette = sorted(set(reduced.get_flattened_data()), key=lambda value: (sum(value), value))
    lookup = {}
    for color in set(pixels):
        lookup[color] = min(range(len(palette)), key=lambda index:
                            sum((color[channel] - palette[index][channel]) ** 2
                                for channel in range(3)))
    mapped = {}
    for name, image in images.items():
        mapped[name] = [lookup[pixel[:3]] if pixel[3] >= ALPHA else None
                        for pixel in image.get_flattened_data()]
    return palette, mapped


def visual_hull(mapped, palette):
    front, back, side, top = (mapped[name] for name in VIEWS)
    volume = {}
    for z in range(HEIGHT):
        row = HEIGHT - 1 - z
        xs = [x for x in range(SIZE) if front[row * SIZE + x] is not None
              or back[row * SIZE + x] is not None]
        ys = [y for y in range(SIZE) if side[row * SIZE + y] is not None]
        for y in ys:
            for x in xs:
                if top[y * SIZE + x] is not None:
                    volume[(x - SIZE // 2, y - SIZE // 2, z)] = 0
    if not volume:
        raise ValueError('The views have no shared visual hull; check their alignment')
    spans = {'front': {}, 'side': {}, 'top': {}}
    for x, y, z in volume:
        spans['front'].setdefault((x, z), []).append(y)
        spans['side'].setdefault((y, z), []).append(x)
        spans['top'].setdefault((x, y), []).append(z)
    bounds = {axis: {key: (min(values), max(values)) for key, values in points.items()}
              for axis, points in spans.items()}
    armor_shades = [min(range(len(palette)), key=lambda index:
                        sum((palette[index][channel] - value) ** 2 for channel in range(3)))
                    for value in (70, 100, 130, 160, 190)]
    eroded = {}
    for name in ('front', 'back', 'side'):
        pixels = mapped[name]
        eroded[name] = {row * SIZE + column for row in range(1, HEIGHT - 1)
                        for column in range(1, SIZE - 1)
                        if all(pixels[(row + dy) * SIZE + column + dx] is not None
                               for dy in (-1, 0, 1) for dx in (-1, 0, 1))}
    density_cache = {}

    def density(point):
        if point not in density_cache:
            x, y, z = point
            density_cache[point] = sum((x + dx, y + dy, z + dz) in volume
                                       for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                                       for dz in (-1, 0, 1))
        return density_cache[point]

    light = (-0.45, -0.6, 1.0)
    light_length = math.sqrt(sum(value * value for value in light))
    feature_counts = {name: 0 for name in ('front', 'back', 'side')}
    for x, y, z in volume:
        row = HEIGHT - 1 - z
        px, py = x + SIZE // 2, y + SIZE // 2
        y_min, y_max = bounds['front'][(x, z)]
        x_min, x_max = bounds['side'][(y, z)]
        boundary = any(point not in volume for point in (
            (x - 1, y, z), (x + 1, y, z), (x, y - 1, z),
            (x, y + 1, z), (x, y, z - 1), (x, y, z + 1)))
        normal = (
            density((x - 1, y, z)) - density((x + 1, y, z)),
            density((x, y - 1, z)) - density((x, y + 1, z)),
            density((x, y, z - 1)) - density((x, y, z + 1)),
        ) if boundary else (0, 0, 0)
        length = math.sqrt(sum(value * value for value in normal))
        normal = tuple(value / length for value in normal) if length else (0, 0, 0)
        brightness = max(0, min(0.999, 0.48 + 0.46 * sum(
            normal[index] * light[index] / light_length for index in range(3))))
        color = armor_shades[int(brightness * len(armor_shades))] if boundary else armor_shades[2]
        # View colors never shade general surfaces. Transfer only dark interior
        # markings onto projection-facing skin; eroded masks exclude outlines.
        candidates = [
            ('front', y == y_min and normal[1] < -0.7, row * SIZE + px),
            ('back', y == y_max and normal[1] > 0.7, row * SIZE + px),
            ('side', x in (x_min, x_max) and abs(normal[0]) > 0.7, row * SIZE + py),
        ]
        for name, facing, index in candidates:
            feature = mapped[name][index]
            if facing and index in eroded[name] and feature is not None and sum(palette[feature]) / 3 < 65:
                color = feature
                feature_counts[name] += 1
                break
        volume[(x, y, z)] = color
    return volume, {'armorPalette': [palette[index] for index in armor_shades],
                    'darkFeatureSkinVoxels': feature_counts,
                    'normalMethod': 'central differences of 3x3x3 occupancy density',
                    'light': list(light)}


def silhouette_audit(volume, mapped):
    projections = {name: set() for name in VIEWS}
    for x, y, z in volume:
        row = HEIGHT - 1 - z
        projections['front'].add((x + SIZE // 2, row))
        projections['back'].add((x + SIZE // 2, row))
        projections['side'].add((y + SIZE // 2, row))
        projections['top'].add((x + SIZE // 2, y + SIZE // 2))
    result = {}
    for name, pixels in mapped.items():
        expected = {(index % SIZE, index // SIZE) for index, color in enumerate(pixels)
                    if color is not None}
        actual = projections[name]
        union = expected | actual
        result[name] = {'sourcePixels': len(expected), 'hullPixels': len(actual),
                        'intersectionOverUnion': round(len(expected & actual) / len(union), 6),
                        'missingSourcePixels': len(expected - actual),
                        'extraHullPixels': len(actual - expected)}
    return result


def average(values):
    if not values:
        raise ValueError('Cannot derive leg rig from empty mask band')
    return sum(values) / len(values)


def derive_rig(volume):
    waist, hip, knee, ankle = 23, 20, 11, 4
    joints = {}
    for name, sign in [('left', -1), ('right', 1)]:
        leg = [point for point in volume if point[2] < hip and point[0] * sign > 1]
        if not leg:
            raise ValueError(f'No {name} lower-body volume; check view alignment')
        x = average([point[0] for point in leg if knee <= point[2] <= hip - 1])
        positions = {}
        for label, level in [('hip', hip), ('knee', knee), ('ankle', ankle)]:
            band = [point for point in leg if abs(point[2] - min(level, hip - 1)) <= 1]
            positions[label] = [round(x, 4), round(average([point[1] for point in band]), 4), level]
        joints[name] = positions
    return {'waistHeight': waist, 'levels': {'hip': hip, 'knee': knee, 'ankle': ankle},
            'joints': joints}


def validate_rig(value):
    if not isinstance(value, dict):
        raise ValueError('Rig must be a JSON object')
    waist = value.get('waistHeight')
    levels = value.get('levels')
    joints = value.get('joints')
    if not isinstance(waist, int) or not 8 <= waist <= HEIGHT - 8 or not isinstance(levels, dict) or not isinstance(joints, dict):
        raise ValueError('Invalid waistHeight, levels or joints in rig')
    hip, knee, ankle = (levels.get(key) for key in ('hip', 'knee', 'ankle'))
    if not all(isinstance(level, int) and not isinstance(level, bool) for level in (hip, knee, ankle)) or not 0 < ankle < knee < hip < waist:
        raise ValueError('Rig levels must satisfy 0 < ankle < knee < hip < waist')
    for side in ('left', 'right'):
        if not isinstance(joints.get(side), dict):
            raise ValueError(f'Missing {side} joint positions')
        for label in ('hip', 'knee', 'ankle'):
            point = joints[side].get(label)
            if not isinstance(point, list) or len(point) != 3 or not all(
                    isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                    and -SIZE <= v <= SIZE for v in point):
                raise ValueError(f'Invalid {side} {label} position')
        hip_point, knee_point, ankle_point = (joints[side][label] for label in ('hip', 'knee', 'ankle'))
        if not ankle_point[2] < knee_point[2] < hip_point[2] <= waist:
            raise ValueError(f'Invalid {side} joint height order')
    return value


def split_lower(volume, rig):
    parts = {'pelvis': {}}
    for side in ('left', 'right'):
        for label in ('thigh', 'shin', 'foot'):
            parts[side + '-' + label] = {}
    levels = rig['levels']
    for point, color in volume.items():
        x, _, z = point
        if z >= rig['waistHeight']:
            continue
        if z >= levels['hip']:
            parts['pelvis'][point] = color
            continue
        side = 'left' if x < 0 else 'right'
        label = 'thigh' if z > levels['knee'] else 'shin' if z > levels['ankle'] else 'foot'
        parts[side + '-' + label][point] = color
    for name, part in parts.items():
        if not part:
            raise ValueError(f'No voxels assigned to {name}; adjust the rig levels')
    return parts


def rotate_yz(y, z, angle):
    sine, cosine = math.sin(angle), math.cos(angle)
    return y * cosine - z * sine, y * sine + z * cosine


def transformed(part, source, destination, angle):
    minimum = [min(point[i] for point in part) for i in range(3)]
    maximum = [max(point[i] for point in part) for i in range(3)]
    corners = []
    for x in (minimum[0] - 0.5, maximum[0] + 0.5):
        for y in (minimum[1] - 0.5, maximum[1] + 0.5):
            for z in (minimum[2] - 0.5, maximum[2] + 0.5):
                dy, dz = rotate_yz(y - source[1], z - source[2], angle)
                corners.append((x - source[0] + destination[0], dy + destination[1], dz + destination[2]))
    low = [math.floor(min(point[i] for point in corners)) for i in range(3)]
    high = [math.ceil(max(point[i] for point in corners)) for i in range(3)]
    result = {}
    # Inverse nearest-neighbor sampling keeps rotated voxel blocks filled;
    # forward-only point splats would introduce holes between adjacent cells.
    for z in range(low[2], high[2] + 1):
        for y in range(low[1], high[1] + 1):
            dy, dz = rotate_yz(y - destination[1], z - destination[2], -angle)
            original_y, original_z = round(dy + source[1]), round(dz + source[2])
            for x in range(low[0], high[0] + 1):
                color = part.get((round(x - destination[0] + source[0]), original_y, original_z))
                if color is not None:
                    result[(x, y, z)] = color
    return result


def bone_angle(start, end):
    return math.atan2(end[2] - start[2], end[1] - start[1])


def distance_yz(start, end):
    return math.hypot(end[1] - start[1], end[2] - start[2])


def solve_knee(hip, ankle, upper, lower):
    dy, dz = ankle[1] - hip[1], ankle[2] - hip[2]
    distance = math.hypot(dy, dz)
    if distance < 0.001:
        raise ValueError('IK ankle target coincides with hip')
    clamped = min(max(distance, abs(upper - lower) + 0.001), upper + lower - 0.001)
    along = (upper * upper - lower * lower + clamped * clamped) / (2 * clamped)
    across = math.sqrt(max(0, upper * upper - along * along))
    unit_y, unit_z = dy / distance, dz / distance
    # Bending toward -Y matches the approved Warden's forward knee shape.
    knee = [hip[0], hip[1] + unit_y * along + unit_z * across,
            hip[2] + unit_z * along - unit_y * across]
    actual_ankle = [ankle[0], hip[1] + unit_y * clamped, hip[2] + unit_z * clamped]
    return knee, actual_ankle, abs(distance - clamped)


def posed_lower(parts, rig, motion, phase):
    configurations = {
        'walk': {'stance': 0.62, 'stride': 4.5, 'lift': 2.1, 'direction': 1, 'bob': 0.45},
        'run': {'stance': 0.46, 'stride': 7.0, 'lift': 3.6, 'direction': 1, 'bob': 1.1},
        'backward': {'stance': 0.68, 'stride': 4.0, 'lift': 2.4, 'direction': -1, 'bob': 0.35},
    }
    config = configurations[motion]
    bob = -config['bob'] * (0.5 - 0.5 * math.cos(phase * math.tau * 2))
    result = transformed(parts['pelvis'], (0, 0, 0), (0, 0, bob), 0)
    audit = {'maximumIkClamp': 0.0, 'footMinimumZ': {}}
    for index, side in enumerate(('left', 'right')):
        local_phase = (phase + index * 0.5) % 1
        swing = max(0, (local_phase - config['stance']) / (1 - config['stance']))
        travel = local_phase / config['stance'] if not swing else 1 - swing
        step = config['direction'] * config['stride'] * (travel - 0.5)
        lift = math.sin(swing * math.pi) * config['lift']
        pitch = (-0.3 if motion != 'backward' else 0.18) * math.sin(swing * math.pi)
        joints = rig['joints'][side]
        rest_hip, rest_knee, rest_ankle = (joints[label] for label in ('hip', 'knee', 'ankle'))
        hip = [rest_hip[0], rest_hip[1], rest_hip[2] + bob]
        foot_part = parts[side + '-foot']
        relative_floor = min(rotate_yz(point[1] - rest_ankle[1], point[2] - rest_ankle[2], pitch)[1]
                             for point in foot_part)
        ankle = [rest_ankle[0], rest_ankle[1] + step,
                 max(rest_ankle[2], -relative_floor) + lift]
        knee, ankle, clamp = solve_knee(hip, ankle, distance_yz(rest_hip, rest_knee),
                                       distance_yz(rest_knee, rest_ankle))
        audit['maximumIkClamp'] = max(audit['maximumIkClamp'], clamp)
        thigh = transformed(parts[side + '-thigh'], rest_hip, hip,
                            bone_angle(hip, knee) - bone_angle(rest_hip, rest_knee))
        shin = transformed(parts[side + '-shin'], rest_knee, knee,
                           bone_angle(knee, ankle) - bone_angle(rest_knee, rest_ankle))
        foot = transformed(foot_part, rest_ankle, ankle, pitch)
        audit['footMinimumZ'][side] = min(point[2] for point in foot)
        result.update(thigh)
        result.update(shin)
        result.update(foot)
    return result, {'x': 0, 'y': 0, 'z': rig['waistHeight'] + bob}, audit


def save_atlas(output, name, volume, palette):
    z_min = min(point[2] for point in volume)
    z_max = max(point[2] for point in volume)
    count = z_max - z_min + 1
    image = Image.new('P', (SIZE * 8, SIZE * math.ceil(count / 8)), 0)
    colors = [0, 0, 0] + [value for color in palette for value in color]
    image.putpalette(colors + [0] * (768 - len(colors)))
    pixels = image.load()
    for (x, y, z), color in volume.items():
        px, py = x + SIZE // 2, y + SIZE // 2
        if not 0 <= px < SIZE or not 0 <= py < SIZE:
            raise ValueError(f'{name} exceeds the 64x64 footprint at {(x, y, z)}')
        layer = z - z_min
        pixels[(layer % 8) * SIZE + px, (layer // 8) * SIZE + py] = color + 1
    path = output / (name + '.png')
    image.save(path, transparency=0, optimize=True)
    return {'image': path.name, 'sliceCount': count, 'zMin': z_min,
            'occupiedVoxels': len(volume), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'decodedRgbaBytes': image.width * image.height * 4}


def main():
    args = arguments()
    if not 4 <= args.frames <= 64:
        raise ValueError('--frames must be between 4 and 64')
    images, hashes = load_views(args.views.resolve())
    palette, mapped = shared_palette(images)
    volume, shading = visual_hull(mapped, palette)
    rig = validate_rig(json.loads(args.rig.read_text()) if args.rig else derive_rig(volume))
    parts = split_lower(volume, rig)
    torso = {(x, y, z - rig['waistHeight']): color for (x, y, z), color in volume.items()
             if z >= rig['waistHeight']}
    if not torso:
        raise ValueError('No torso above the waist split')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    manifest = {
        'version': 1, 'grid': {'size': SIZE, 'columns': 8, 'pitch': 1 / HEIGHT},
        'displayScale': 2, 'source': {'commit': args.source_commit, 'kind': 'pixel-views', 'files': hashes},
        'palette': ['#' + ''.join(f'{channel:02x}' for channel in color) for color in palette],
        'torso': save_atlas(output, 'torso', torso, palette), 'motions': {},
        'method': 'Four-view visual hull with flat density-normal shading and dark interior markings; articulated voxel parts; PNG slices only',
    }
    report = {'silhouettes': silhouette_audit(volume, mapped), 'sourceOccupiedVoxels': len(volume), 'shading': shading,
              'parts': {name: len(part) for name, part in parts.items()}, 'motions': {},
              'assumptions': [
                  'Source views share floor height, scale and waist projection at ground grid (32, 32).',
                  'Back view is mirrored; top is vertically flipped to make -Y forward.',
                  'Front/back silhouette union tolerates drawn differences; top and side intersect that union.',
                  'Hidden cavities, occluded surfaces and component depth are inferred by a visual hull.',
                  'Five grayscale armor tones use offline voxel-density normals; interiors stay flat gray; no live lighting.',
                  'Only dark markings inside a one-pixel-eroded source silhouette project onto corresponding predominantly axis-facing boundary skins.',
                  'Part boundaries use horizontal ankle/knee/hip bands; pivots come from mask centroids unless supplied.',
                  'The gait is a new in-place voxel articulation study, not the previously approved 3D motion.',
                  'No planted-foot turning, world-speed synchronization, transitions, terrain adaptation or game integration is established.',
              ]}
    atlases = [manifest['torso']]
    for motion, duration in [('walk', 0.9), ('run', 0.9), ('backward', 1.0)]:
        frames, audits = [], []
        for index in range(args.frames):
            lower, anchor, audit = posed_lower(parts, rig, motion, index / args.frames)
            atlas = save_atlas(output, f'{motion}-{index:02}', lower, palette)
            frames.append({'atlas': atlas, 'anchor': anchor})
            audits.append(audit)
            atlases.append(atlas)
        manifest['motions'][motion] = {'duration': duration, 'frames': frames}
        report['motions'][motion] = audits
    report['atlasCount'] = len(atlases)
    report['decodedAtlasRgbaBytes'] = sum(atlas['decodedRgbaBytes'] for atlas in atlases)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'sampling-report.json').write_text(json.dumps(report, indent=2) + '\n')
    (output / 'rig.json').write_text(json.dumps(rig, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'voxels': len(volume), 'atlases': len(atlases),
                      'decodedMiB': report['decodedAtlasRgbaBytes'] / 1024 / 1024,
                      'silhouettes': report['silhouettes']}))


if __name__ == '__main__':
    main()
