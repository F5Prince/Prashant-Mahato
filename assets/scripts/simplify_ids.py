import json
from pathlib import Path

source = Path('..') / 'Mahato Family Tree.JSON'
if not source.exists():
    raise SystemExit(f'Missing source file: {source}')

records = json.loads(source.read_text(encoding='utf-8'))
old_ids = [rec['id'] for rec in records]
new_ids = [str(i + 1) for i in range(len(old_ids))]
id_map = dict(zip(old_ids, new_ids))

new_records = []
for idx, rec in enumerate(records, start=1):
    new_rec = dict(rec)
    new_rec['id'] = str(idx)
    rels = rec.get('rels')
    if rels is not None:
        updated = {}
        for key, value in rels.items():
            if isinstance(value, list):
                updated[key] = [id_map.get(v, v) for v in value]
            elif isinstance(value, str):
                updated[key] = id_map.get(value, value)
            else:
                updated[key] = value
        new_rec['rels'] = updated
    new_records.append(new_rec)

source.write_text(json.dumps(new_records, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Converted {len(new_records)} records to sequential numeric IDs.')
