"""Append the bio-plant atlas set without changing any existing tile numbers or pixels."""
from pathlib import Path
import struct
import zlib

directory = Path(__file__).resolve().parent.parent / "apps" / "micropolis" / "src" / "lib" / "images" / "tilesets"
source = (directory / "all.png").read_bytes()
width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", source[16:29])
assert width == 512 and depth == 8 and color == 2 and interlace == 0
packed = bytearray()
offset = 8
while offset < len(source):
    size = struct.unpack(">I", source[offset:offset + 4])[0]
    if source[offset + 4:offset + 8] == b"IDAT":
        packed.extend(source[offset + 8:offset + 8 + size])
    offset += size + 12
raw = zlib.decompress(packed)
rows = []
stride = width * 3
for y in range(height):
    mode = raw[y * (stride + 1)]
    row = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
    previous = rows[-1] if rows else bytearray(stride)
    for x in range(stride):
        a = row[x - 3] if x >= 3 else 0
        b = previous[x]
        c = previous[x - 3] if x >= 3 else 0
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
        row[x] = (row[x] + (0, a, b, (a + b) // 2, predictor)[mode]) & 255
    rows.append(row)
bio = [bytearray(row) for row in rows[:512]]
for variant in range(9):
    for tile in range(9):
        number = 612 + variant * 9 + tile
        ox, oy = number % 32 * 16, number // 32 * 16
        for y in range(16):
            for x in range(16):
                gx, gy = tile % 3 * 16 + x, tile // 3 * 16 + y
                rgb = (20, 35, 47)
                if gx in (1, 46) or gy in (1, 46):
                    rgb = (84, 132, 149)
                if 5 <= gx <= 42 and 7 <= gy <= 38:
                    tube_x, tube_y = (gx - 5) % 10, (gy - 7) % 16
                    rgb = (15, 73, 75)
                    if 1 <= tube_x <= 7 and 1 <= tube_y <= 13:
                        rgb = (35, 201, 172)
                    if 3 <= tube_x <= 5 and 4 <= tube_y <= 10:
                        rgb = (47, 78, 103)
                if 19 <= gx <= 28 and 41 <= gy <= 44:
                    rgb = (246, 194, 73)
                bio[oy + y][(ox + x) * 3:(ox + x) * 3 + 3] = bytes(rgb)

def png(target, pixels):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    body = b"".join(b"\0" + row for row in pixels)
    target.write_bytes(b"\x89PNG\r\n\x1a\n" +
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, len(pixels), 8, 2, 0, 0, 0)) +
        chunk(b"IDAT", zlib.compress(body, 9)) + chunk(b"IEND", b""))

png(directory / "bio.png", bio)
png(directory / "all.png", rows[:5120] + bio)
