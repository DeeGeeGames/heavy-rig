"""Reproduce SpriteCook's documented four-view conversion rules.

Independent implementation, checked against the published Python converter.
https://www.spritecook.ai/blog/sprite-stacking-pixel-art
Only view identification is supplied explicitly instead of guessing car shapes.
"""

import numpy as np
from PIL import Image


def remove_outline(image):
    source = np.array(image.convert("RGBA"))
    solid = source[..., 3] > 0
    padded = np.pad(solid, 1)
    interior = padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
    outline = solid & ~interior & (source[..., :3].astype(int).mean(axis=2) < 70)
    result = source.copy()
    neighbors = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    for row, column in zip(*np.nonzero(outline)):
        for dy, dx in neighbors:
            y, x = row + dy, column + dx
            if 0 <= y < source.shape[0] and 0 <= x < source.shape[1] and solid[y, x] and not outline[y, x]:
                result[row, column] = source[y, x]
                break
    return result


def shared_palette(views, count):
    samples = np.concatenate([view[view[..., 3] > 0, :3] for view in views])
    samples = np.unique(samples // 6 * 6 + 3, axis=0).astype(np.uint8)
    indexed = Image.fromarray(samples.reshape(1, -1, 3)).quantize(count, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = np.array(indexed.getpalette()[:count * 3]).reshape(-1, 3)
    result = []
    for view in views:
        difference = view[..., None, :3].astype(int) - palette[None, None]
        nearest = (difference ** 2).sum(axis=-1).argmin(axis=-1)
        colored = view.copy()
        colored[..., :3] = palette[nearest]
        result.append(colored)
    return result


def resize(view, width, height):
    return np.array(Image.fromarray(view).resize((width, height), Image.Resampling.NEAREST))


def row_color(view, row, column):
    occupied = np.flatnonzero(view[row, :, 3])
    if occupied.size == 0:
        return None
    return view[row, min(max(column, occupied[0]), occupied[-1]), :3]


def slices_from_fitted_views(top, side, front, back, shade=0):
    depth, width = top.shape[:2]
    height = side.shape[0]
    occupied = np.zeros((height, depth, width), dtype=bool)
    for z in range(height):
        row = height - 1 - z
        # Published code uses front OR back, not their intersection.
        across = (front[row, :, 3] > 0) | (back[row, :, 3] > 0)
        occupied[z] = (top[..., 3] > 0) & (side[row, :, 3] > 0)[:, None] & across[None, :]

    rgba = np.zeros((height, depth, width, 4), dtype=np.uint8)
    covered = np.zeros((depth, width), dtype=bool)
    for z in range(height - 1, -1, -1):
        row = height - 1 - z
        above = covered.copy()
        covered |= occupied[z]
        for y, x in zip(*np.nonzero(occupied[z])):
            distances = []
            for dy, dx in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                steps = 1
                while 0 <= y + dy * steps < depth and 0 <= x + dx * steps < width and occupied[z, y + dy * steps, x + dx * steps]:
                    steps += 1
                distances.append(steps)
            edge_depth = min(distances)
            face = distances.index(edge_depth)
            if not above[y, x]:
                color = top[y, x, :3]
            elif edge_depth > 2:
                color = rgba[z + 1, y, x, :3]
            else:
                color = row_color(side, row, y) if face < 2 else row_color(back if face == 2 else front, row, x)
                if color is None:
                    color = top[y, x, :3]
            if above[y, x] and edge_depth <= 2 and shade:
                multiplier = 1 - shade * (1 - z / max(height - 1, 1)) - shade * 0.4
                color = np.clip(np.asarray(color, dtype=float) * multiplier, 0, 255)
            rgba[z, y, x] = (*np.asarray(color, dtype=np.uint8), 255)
    return rgba


def convert(views, colors=24, shade=0, top_nose="down", side_nose="left"):
    """Named source views are top, side, front, back; preserve the article fit."""
    top, side, front, back = shared_palette([remove_outline(views[name]) for name in ["top", "side", "front", "back"]], colors)
    if side_nose == "left":
        side = side[:, ::-1]
    if top_nose == "up":
        top = top[::-1]
    depth, width = top.shape[:2]
    height = round(side.shape[0] * depth / side.shape[1])
    side, front, back = [resize(view, w, height) for view, w in [(side, depth), (front, width), (back, width)]]
    fitted = {"top": top, "side": side, "front": front, "back": back}
    return slices_from_fitted_views(top, side, front, back, shade), fitted
