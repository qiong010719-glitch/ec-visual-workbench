"""Archive only assets explicitly referenced by the public page; no endpoint probing."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://ec-image-hardcore-a-plus.vercel.app/'
raw = (ROOT / 'reference/original.html').read_bytes()
source = raw.decode('utf-8').replace('\r\n', '\n').replace('\r', '')
previous = json.loads((ROOT / 'reference/manifest.json').read_text(encoding='utf-8')) if (ROOT / 'reference/manifest.json').exists() else {}
inventory = json.loads((ROOT / 'reference/inventory.json').read_text(encoding='utf-8'))
assets = sorted({p for p in [*re.findall(r'''["'`]([^"'`<>\s]+\.(?:png|jpg|jpeg|webp|gif|svg|woff2?|css|js))["'`]''', source), *[a['url'] for a in inventory['assets']]]
                 if not p.startswith('/') and not any(x in p for x in ('${', '}', ')', '..', '://'))})

def download(path):
    destination = ROOT / 'public' / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not destination.exists():
            for attempt in range(2):
                try:
                    with urllib.request.urlopen(ORIGIN + path, timeout=50) as response:
                        destination.write_bytes(response.read())
                    break
                except Exception:
                    if attempt: raise
        data = destination.read_bytes()
        return {'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'status': 'saved'}
    except Exception as error:
        return {'path': path, 'status': 'unavailable', 'error': str(error)}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    records = list(pool.map(download, assets))

# Never retain or reuse the original operator's service configuration.
source = re.sub(r'var _supa = window\.supabase\.createClient\([\s\S]*?\);',
                'var _supa = window.LocalWorkbench.authClient;', source, count=1)
source = re.sub(r'const firebaseConfig = \{[^\n]+', 'const firebaseConfig = {}; // Local adapter only', source, count=1)
source = re.sub(r'const OVERRIDE_PWD = [^;]+;', 'const OVERRIDE_PWD = ""; // Unused upstream override removed', source, count=1)
source = re.sub(r"const CN_HUB = '[^']+';", "const CN_HUB = '/api/media';", source, count=1)
source = re.sub(r"const CN_UP_KEY = '[^']+';", "const CN_UP_KEY = '';", source, count=1)
for script in ('supabase.js', 'firebase-app-compat.js', 'firebase-database-compat.js', 'firebase-storage-compat.js'):
    source = re.sub(r'\s*<script src="vendor/' + re.escape(script) + r'"></script>', '', source)
source = source.replace('<title>AUPlus 电商视觉工作台 v17 (Sonoma Glass)</title>', '<title>AUPlus 电商视觉工作台 · 本地复刻</title>')
source = re.sub(r'\s*<script src="/local/bridge.js"></script>', '', source)
source = source.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n    <script src="/local/bridge.js"></script>')
# Preserve the original site code separately from local changes.
(ROOT / 'reference/original.html').write_text(source, encoding='utf-8')
counter = {'js': 0, 'css': 0}
def extract(match):
    tag, attrs, body = match.groups()
    if tag == 'script' and ('src=' in attrs or 'application/' in attrs):
        return match.group(0)
    ext = 'js' if tag == 'script' else 'css'
    counter[ext] += 1
    name = f'original-{counter[ext]:02d}.{ext}'
    folder = ROOT / 'public' / 'original'
    folder.mkdir(exist_ok=True)
    (folder / name).write_text(body.strip() + '\n', encoding='utf-8')
    if ext == 'js':
        return f'<script src="/original/{name}"{attrs}></script>'
    return f'<link rel="stylesheet" href="/original/{name}">'

html = re.sub(r'<(script|style)([^>]*)>([\s\S]*?)</\1>', extract, source)
html = html.replace('</body>', '<script src="/local/workbench.js"></script>\n</body>')
(ROOT / 'public/index.html').write_text(html, encoding='utf-8')
manifest = {'source': ORIGIN, 'capturedAt': '2026-11-01', 'originalSha256': previous.get('originalSha256', hashlib.sha256(raw).hexdigest()),
            'originalBytes': previous.get('originalBytes', len(raw)), 'note': 'Upstream service credentials removed. Backend reconstructed separately.',
            'assets': records, 'extracted': counter}
(ROOT / 'reference/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'saved': sum(x['status'] == 'saved' for x in records), 'unavailable': [x for x in records if x['status'] != 'saved'], 'scriptsAndStyles': counter}, ensure_ascii=False))
