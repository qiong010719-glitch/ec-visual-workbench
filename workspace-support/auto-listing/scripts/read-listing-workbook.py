"""Read listing metadata only; the source workbook is never modified."""
import json
import os
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.environ.get('ERP_PYTHON_DEPS', str(Path(__file__).resolve().parents[1] / 'outputs/erp-runtime')))


def text(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read(source):
    source = Path(source)
    if source.suffix.lower() == '.xls':
        import xlrd
        book = xlrd.open_workbook(str(source), on_demand=True)
        sheets = [(s.name, [s.row_values(i) for i in range(s.nrows)]) for s in book.sheets() if s.nrows]
        book.release_resources()
    elif source.suffix.lower() == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(source, read_only=True, data_only=False)
        sheets = [(s.title, list(s.values)) for s in book.worksheets]
        book.close()
    else:
        raise ValueError('请选择 .xls 或 .xlsx 表格')
    matches = []
    for name, values in sheets:
        values = [list(map(text, row)) for row in values]
        if not values:
            continue
        header = ['标题' if h == '产品标题' else h for h in values[0]]
        if all(h in header for h in ('货号', '标题', '英文标题')):
            matches.append((name, header, values[1:]))
    if len(matches) != 1:
        raise ValueError('需要恰好一个包含「货号、标题（或产品标题）、英文标题」的工作表')
    name, header, values = matches[0]
    if any(header.count(h) != 1 for h in ('货号', '标题', '英文标题')):
        raise ValueError('必需列名不能重复')
    rows = []
    for index, row in enumerate(values, 2):
        if not any(row):
            continue
        record = {h: row[i] if i < len(row) else '' for i, h in enumerate(header) if h}
        if any(record[h].startswith('=') for h in ('货号', '标题', '英文标题')):
            raise ValueError(f'第 {index} 行请使用文本值，不使用公式')
        rows.append({'rowId': str(index), 'productCode': record.pop('货号'), 'title': record.pop('标题'),
                     'englishTitle': record.pop('英文标题'), 'metadata': record})
    if not 1 <= len(rows) <= 20:
        raise ValueError('当前小批量流程支持 1—20 条商品')
    return {'sheet': name, 'rows': rows}


if __name__ == '__main__':
    try:
        print(json.dumps(read(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
