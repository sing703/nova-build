"""Generate minimal PNG icons for the Chrome extension."""
import struct
import zlib
from pathlib import Path

def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = chunk_type + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xffffffff)

def make_png(size: int, path: Path) -> None:
    # Purple/cyan gradient-ish solid with simple bolt pattern
    rows = []
    for y in range(size):
        row = b"\x00"
        for x in range(size):
            t = (x + y) / (size * 2)
            r = int(99 + t * 50)
            g = int(102 + t * 30)
            b = int(241 - t * 40)
            # Simple lightning bolt in center
            cx, cy = size // 2, size // 2
            if abs(x - cx) < size // 8 and abs(y - cy) < size // 3:
                r, g, b = 34, 211, 238
            row += bytes([r, g, b])
        rows.append(row)
    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", ihdr)
    png += png_chunk(b"IDAT", compressed)
    png += png_chunk(b"IEND", b"")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"Created {path}")

if __name__ == "__main__":
    base = Path(__file__).resolve().parent.parent / "extension" / "icons"
    for s in (16, 48, 128):
        make_png(s, base / f"icon{s}.png")
