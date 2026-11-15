"""Normalize one generated 2x2 projection sheet onto a shared authoring grid.

This is deterministic asset preparation, not another image-generation step.
Source order: top/side/front/back. The side faces left; the top faces down.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image


PALETTE = [24, 38, 52, 66, 80, 96, 112, 130, 148, 168, 190, 214]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def silhouette(image):
    return image.getchannel('A').point(lambda value: 255 if value >= 192 else 0)


def quantize(image):
    result = Image.new('RGBA', image.size)
    pixels = []
    for red, green, blue, alpha in image.get_flattened_data():
        if alpha < 192:
            pixels.append((0, 0, 0, 0))
            continue
        value = round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
        gray = min(PALETTE, key=lambda level: abs(level - value))
        pixels.append((gray, gray, gray, 255))
    result.putdata(pixels)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sheet', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--side-waist-column', type=float,
                        help='Optional waist center in side pixels after resizing to 48 high.')
    args = parser.parse_args()
    source = Image.open(args.sheet).convert('RGBA')
    width, height = source.size
    boxes = {
        'top': (0, 0, width // 2, height // 2),
        'side': (width // 2, 0, width, height // 2),
        'front': (0, height // 2, width // 2, height),
        'back': (width // 2, height // 2, width, height),
    }
    cropped = {}
    report = {'sheetSha256': digest(args.sheet), 'baselineSha256': digest(args.baseline),
              'status': 'generated-views-normalized-for-proof-not-owner-approved',
              'grid': {'width': 64, 'height': 48, 'waist': [32, 32, 23]}, 'views': {}}
    for name, box in boxes.items():
        panel = source.crop(box)
        bounds = silhouette(panel).getbbox()
        if bounds is None:
            raise ValueError(f'Empty source projection: {name}')
        cropped[name] = panel.crop(bounds)
        report['views'][name] = {'panel': box, 'sourceBounds': bounds}
    front_width = round(cropped['front'].width * 48 / cropped['front'].height)
    side_width = round(cropped['side'].width * 48 / cropped['side'].height)
    if not 12 <= front_width <= 64 or not 12 <= side_width <= 64:
        raise ValueError('Source proportions do not fit the selected authoring grid')
    front = quantize(cropped['front'].resize((front_width, 48), Image.Resampling.NEAREST))
    back = quantize(cropped['back'].resize((front_width, 48), Image.Resampling.NEAREST))
    side = quantize(cropped['side'].resize((side_width, 48), Image.Resampling.NEAREST))
    top = quantize(cropped['top'].resize((front_width, side_width), Image.Resampling.NEAREST))
    # Use the narrowest populated side band around the intended waist. Guns
    # extend far forward above it, so centering the entire profile is incorrect.
    bands = []
    for row in range(22, 27):
        bounds = silhouette(side).crop((0, row, side_width, row + 1)).getbbox()
        if bounds is not None:
            bands.append((bounds[2] - bounds[0], row, (bounds[0] + bounds[2]) / 2))
    if not bands:
        raise ValueError('Cannot locate a waist band in the side projection')
    _, waist_row, waist_column = min(bands)
    if args.side_waist_column is not None:
        if not math.isfinite(args.side_waist_column) or not 0 <= args.side_waist_column < side_width:
            raise ValueError('Side waist column must be finite and within the resized profile')
        waist_column = args.side_waist_column
    side_left = round(32 - waist_column)
    placements = {'front': ((64 - front_width) // 2, 0), 'back': ((64 - front_width) // 2, 0),
                  'side': (side_left, 0), 'top': ((64 - front_width) // 2, 64 - side_left - side_width)}
    args.output.mkdir(parents=True, exist_ok=False)
    for name, image in [('front', front), ('back', back), ('side', side), ('top', top)]:
        target = Image.new('RGBA', (64, 64 if name == 'top' else 48))
        left, upper = placements[name]
        if left < 0 or upper < 0 or left + image.width > target.width or upper + image.height > target.height:
            raise ValueError(f'Aligned {name} projection would be clipped')
        target.paste(image, placements[name])
        path = args.output / (name + '.png')
        target.save(path)
        report['views'][name].update({'normalizedSize': image.size, 'placement': placements[name],
                                     'sha256': digest(path)})
    report['sideWaist'] = {'row': waist_row, 'column': waist_column, 'alignedColumn': waist_column + side_left}
    report['assumptions'] = [
        'Front/back/side share a 48-pixel height; back width is fitted to front width.',
        'Top width matches front, top depth matches side. This rescales generated views to a common grid.',
        'The side waist band sets depth origin. Matching dimensions do not prove hidden geometry.',
        'Transparent pixels become empty space; opaque dark weapon markings stay painted surfaces.',
    ]
    (args.output / 'normalization.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
