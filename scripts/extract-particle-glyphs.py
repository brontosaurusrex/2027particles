"""Write normalized particle contours from the Noto Sans Symbols 2 TTF."""

import json
import sys

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

SYMBOLS = {
    "heart": "♥",
    "star": "★",
    "snowflake": "❄",
    "circle": "●",
    "plus": "✚",
    "sparkle": "✦",
    "diamond": "◆",
    "flower": "✿",
    "lightning": "⚡",
    "ring": "○",
}


class OutlinePen(BasePen):
    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.contours = []

    def _moveTo(self, point):
        self.contours.append([point])

    def _lineTo(self, point):
        self.contours[-1].append(point)

    def _qCurveToOne(self, control, end):
        start = self._getCurrentPoint()
        for step in range(1, 7):
            t = step / 6
            self._lineTo(tuple(
                (1 - t)**2 * a + 2 * (1 - t) * t * b + t**2 * c
                for a, b, c in zip(start, control, end)
            ))

    def _curveToOne(self, first, second, end):
        start = self._getCurrentPoint()
        for step in range(1, 9):
            t = step / 8
            self._lineTo(tuple(
                (1 - t)**3 * a + 3 * (1 - t)**2 * t * b + 3 * (1 - t) * t**2 * c + t**3 * d
                for a, b, c, d in zip(start, first, second, end)
            ))

    def _closePath(self):
        loop = self.contours[-1]
        if loop[-1] == loop[0]:
            loop.pop()


def area(loop):
    return sum(x * ny - nx * y for (x, y), (nx, ny) in zip(loop, loop[1:] + loop[:1])) / 2


def contains(loop, point):
    x, y = point
    inside = False
    for (ax, ay), (bx, by) in zip(loop, loop[1:] + loop[:1]):
        if (ay > y) != (by > y) and x < ax + (bx - ax) * (y - ay) / (by - ay):
            inside = not inside
    return inside


def distance_squared(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    x, y = point[0] - start[0], point[1] - start[1]
    length = dx * dx + dy * dy
    amount = min(1, max(0, (x * dx + y * dy) / length)) if length else 0
    return (x - amount * dx)**2 + (y - amount * dy)**2


def simplify_arc(points):
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    split = max(range(1, len(points) - 1), key=lambda i: distance_squared(points[i], start, end))
    if distance_squared(points[split], start, end) < 0.004**2:
        return [start, end]
    return simplify_arc(points[:split + 1])[:-1] + simplify_arc(points[split:])


def simplify_loop(loop):
    start = loop[0]
    split = max(range(1, len(loop)), key=lambda i: distance_squared(loop[i], start, start))
    return simplify_arc(loop[:split + 1])[:-1] + simplify_arc([*loop[split:], start])[:-1]


def glyph_faces(glyph_set, glyph_name):
    pen = OutlinePen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    loops = [loop for loop in pen.contours if len(loop) >= 3 and area(loop)]
    areas = [abs(area(loop)) for loop in loops]
    parents = [
        min((parent for parent, boundary in enumerate(loops)
             if areas[parent] > areas[index] and contains(boundary, loop[0])),
            key=areas.__getitem__, default=None)
        for index, loop in enumerate(loops)
    ]

    def depth(index):
        parent = parents[index]
        return 0 if parent is None else 1 + depth(parent)

    xs, ys = zip(*(point for loop in loops for point in loop))
    center_x, center_y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    scale = 2 / max(max(xs) - min(xs), max(ys) - min(ys))

    def normalized(loop, hole=False):
        if (area(loop) < 0) != hole:
            loop = loop[::-1]
        vertices = [((x - center_x) * scale, (y - center_y) * scale) for x, y in loop]
        return [[round(x, 4), round(y, 4)] for x, y in simplify_loop(vertices)]

    return [
        [normalized(loop)] + [normalized(loops[child], hole=True)
                              for child, owner in enumerate(parents) if owner == index]
        for index, loop in enumerate(loops) if depth(index) % 2 == 0
    ]


with TTFont(sys.argv[1]) as font:
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    outlines = {name: glyph_faces(glyphs, cmap[ord(symbol)]) for name, symbol in SYMBOLS.items()}
    entries = [f"  {json.dumps(name)}: {json.dumps(faces, separators=(',', ':'))}" for name, faces in outlines.items()]
    print("{\n" + ",\n".join(entries) + "\n}")
