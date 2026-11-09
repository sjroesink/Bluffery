#!/usr/bin/env python3
"""Generate original opaque Bluffery icons, no third-party assets."""
from PIL import Image, ImageDraw
from pathlib import Path

INK = '#14112b'
ORANGE = '#ff8a3d'
WHITE = '#ffffff'
SCALE = 4  # draw large, downsample for smooth edges

for filename, size, face in [('icon-192.png', 192, .78), ('icon-512.png', 512, .78),
                             ('icon-maskable.png', 512, .56), ('apple-touch-icon.png', 180, .72)]:
    big = size * SCALE
    im = Image.new('RGB', (big, big), INK)
    d = ImageDraw.Draw(im)
    side = big * face
    ox = oy = (big - side) / 2
    u = side / 44  # the mascot is drawn on a 44-unit grid, like the in-app face

    def p(x, y):
        return (ox + (x - 2) * u, oy + (y - 2) * u)

    def box(cx, cy, rx, ry):
        return [p(cx - rx, cy - ry), p(cx + rx, cy + ry)]

    d.rounded_rectangle([p(2, 2), p(46, 46)], radius=14 * u, fill=ORANGE)
    d.ellipse(box(17, 21, 6.5, 7.5), fill=WHITE)
    d.ellipse(box(31, 21, 6.5, 7.5), fill=WHITE)
    d.ellipse(box(20, 22, 3.2, 3.2), fill=INK)
    d.ellipse(box(34, 22, 3.2, 3.2), fill=INK)
    d.arc([p(17, 25), p(33, 38)], 40, 150, fill=INK, width=max(2, round(2.6 * u)))
    im.resize((size, size), Image.LANCZOS).save(Path('public') / filename)
