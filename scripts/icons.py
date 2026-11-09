#!/usr/bin/env python3
"""Generate original opaque Vissig icons, no third-party assets."""
from PIL import Image, ImageDraw
from pathlib import Path
for filename,size in [('icon-192.png',192),('icon-512.png',512),('icon-maskable.png',512),('apple-touch-icon.png',180)]:
    im=Image.new('RGB',(size,size),'#123f3b');d=ImageDraw.Draw(im)
    def box(a):return tuple(round(x*size/512) for x in a)
    d.ellipse(box((108,174,348,338)), fill='#ef795d')
    d.polygon([box((320,256)),box((400,188)),box((400,324))],fill='#ef795d')
    d.ellipse(box((155,218,177,240)),fill='#123f3b')
    d.arc(box((242,192,320,320)),90,270,fill='#123f3b',width=max(2,size//65))
    d.ellipse(box((162,114,185,137)),fill='#f5f2e9')
    d.ellipse(box((193,80,207,94)),fill='#f5f2e9')
    im.save(Path('public')/filename)
