"""Create a reviewable source package without runtime data, credentials or failed-test artifacts."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
output = root.parent / 'ec-workbench-本地复刻.zip'
excluded = {'data', 'preview-data', 'node_modules', '__pycache__', '.git'}
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for file in sorted(root.rglob('*')):
        if not file.is_file(): continue
        relative = file.relative_to(root)
        if set(relative.parts) & excluded: continue
        if file.name == '.env' or file.name.startswith('.env.') and file.name != '.env.example': continue
        if file.name == 'failure.png' or file.suffix == '.log': continue
        bundle.write(file, Path('ec-workbench') / relative)
print(str(output))
print(f'{output.stat().st_size:,} bytes')
