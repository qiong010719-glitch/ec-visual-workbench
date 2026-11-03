"""Inspect selected image files without altering them; emit counts and review candidates."""
import json
from collections import Counter
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
directory = root / 'data/research/amazon-expansion-20261101'
plan = json.loads((directory / 'category-plan.json').read_text(encoding='utf-8'))
learned = json.loads((directory / 'learning/references.json').read_text(encoding='utf-8'))
resume = Path(plan['activeResume']['directory'])
before = json.loads((resume / 'main-references-before.json').read_text(encoding='utf-8'))
ids = list(dict.fromkeys(p for c in plan['categories'] for p in c.get('selectedProductIds', [])))
products = [learned['products'][p] for p in ids]
unique = {a['sha256']: a for p in products for a in p['assets']}
old_hashes = {a.get('sha256') for p in before['products'].values() for a in p['assets']}
dimensions = {}
invalid = []
for sha, asset in unique.items():
    file = root / 'data/media' / Path(asset['localUrl']).name
    try:
        with Image.open(file) as image:
            dimensions[sha] = image.size
            image.verify()
    except Exception as error:
        invalid.append({'sha256': sha, 'error': str(error)})

new_hashes = set(unique) - old_hashes
non3c_ids = {p for c in plan['categories'] if c.get('phase') == 'non3c' for p in c['selectedProductIds']}
quality = {
    'selectedProductRecords': len(ids),
    'selectedNon3cProductRecords': len(non3c_ids),
    'newProductRecordsSinceResume': sum(p not in before['products'] for p in ids),
    'uniqueImageFiles': len(unique),
    'newUniqueImageFilesSinceResume': len(new_hashes),
    'primaryRoles': dict(Counter(a['role'] for a in unique.values())),
    'newPrimaryRoles': dict(Counter(unique[s]['role'] for s in new_hashes)),
    'smallImagesUnder500pxLongEdge': sum(max(d) < 500 for d in dimensions.values()),
    'newSmallImagesUnder500pxLongEdge': sum(max(dimensions[s]) < 500 for s in new_hashes if s in dimensions),
    'aplusObservedProducts': sum(p.get('aplusStatus') == 'found' for p in products),
    'aplusNotObservedProducts': sum(p.get('aplusStatus') != 'found' for p in products),
    'non3cAplusObservedProducts': sum(learned['products'][p].get('aplusStatus') == 'found' for p in non3c_ids),
    'fullQuotaCategories': [c['label'] for c in plan['categories'] if c.get('selectionComplete')],
    'invalidImages': invalid,
}
(resume / 'asset-quality.json').write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding='utf-8')

samples = []
seen = set()
for category in (c for c in plan['categories'] if c.get('phase') == 'non3c'):
    candidates = [(learned['products'][p], a) for p in category['selectedProductIds'] for a in learned['products'][p]['assets'] if a['sha256'] not in seen and a['sha256'] in dimensions]
    if not candidates:
        continue
    candidates.sort(key=lambda pair: (pair[1]['role'] == 'aplus', pair[1]['role'] == 'gallery', dimensions[pair[1]['sha256']][0] * dimensions[pair[1]['sha256']][1]), reverse=True)
    product, asset = candidates[0]
    sha = asset['sha256']
    seen.add(sha)
    samples.append({'categoryId': category['id'], 'category': category['label'], 'productId': product['id'], 'asin': product['asin'], 'role': asset['role'], 'sha256': sha, 'dimensions': dimensions[sha], 'path': str(root / 'data/media' / Path(asset['localUrl']).name), 'analysis': learned.get('imageAnalyses', {}).get(sha)})
(resume / 'visual-samples-to-check.json').write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(quality, ensure_ascii=False))
if invalid:
    raise SystemExit(1)
