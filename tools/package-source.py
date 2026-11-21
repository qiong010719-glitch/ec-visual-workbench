"""Package tracked application sources inside this checkout, without private runtime data."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / 'runs' / 'source-release'
destination.mkdir(parents=True, exist_ok=True)
output = destination / '淘宝视觉工作台-源码.zip'
allowed = {'public', 'src', 'tests', 'tools', 'docs'}
top_level = {'README.md', 'package.json', 'package-lock.json', '.gitignore', '启动工作台.cmd', 'start.ps1'}
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').split('\0')
manifest = []
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for name in sorted(filter(None, tracked)):
        relative = Path(name)
        if relative.parts[0] not in allowed and name not in top_level: continue
        if any(p.startswith('.env') for p in relative.parts): continue
        if 'results' in relative.parts or relative.suffix == '.log': continue
        file = root / relative
        if file.is_symlink() or not file.is_file(): continue
        content = file.read_bytes()
        bundle.writestr('ec-visual-workbench-taobao/' + relative.as_posix(), content)
        manifest.append({'path': relative.as_posix(), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
bundle_hash = hashlib.sha256(output.read_bytes()).hexdigest()
(destination / 'manifest.json').write_text(json.dumps({'archive': output.name, 'sha256': bundle_hash, 'files': manifest}, ensure_ascii=False, indent=2), encoding='utf-8')
print(str(output))
print(f'{len(manifest)} files; {output.stat().st_size:,} bytes; SHA256 {bundle_hash}')
