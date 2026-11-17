"""Convert supplied listing images to JPEG without changing composition or originals."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('sources', type=Path, nargs='+')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
images = []
sheet = Image.new('RGB', (1200, ((len(args.sources) + 1) // 2) * 650), 'white')
draw = ImageDraw.Draw(sheet)
for index, source in enumerate(args.sources, 1):
    with Image.open(source) as raw:
        raw.load()
        image = ImageOps.exif_transpose(raw).convert('RGB')
        destination = args.out / f'{index:02d}.jpg'
        image.save(destination, 'JPEG', quality=95, subsampling=0)
        with Image.open(destination) as check:
            check.load()
            assert check.size == image.size
        images.append({'index': index, 'source': str(source.resolve()),
                       'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                       'jpeg': str(destination.resolve()), 'width': image.width, 'height': image.height,
                       'bytes': destination.stat().st_size,
                       'jpegSha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
        thumbnail = ImageOps.contain(image, (580, 600))
        x, y = ((index - 1) % 2) * 600, ((index - 1) // 2) * 650
        sheet.paste(thumbnail, (x + (600 - thumbnail.width) // 2, y + 30 + (600 - thumbnail.height) // 2))
        draw.text((x + 12, y + 8), f'{index:02d}  {image.width}x{image.height}  {source.name[:25]}', fill='black')
(args.out / 'manifest.json').write_text(json.dumps(images, ensure_ascii=False, indent=2), encoding='utf-8')
sheet.save(args.out / 'contact-sheet.jpg', quality=92)
print(json.dumps(images, ensure_ascii=False, indent=2))
