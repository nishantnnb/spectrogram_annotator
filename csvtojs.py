#!/usr/bin/env python3
"""
csvtojs.py

Usage:
  python csvtojs.py input.csv
  python csvtojs.py input.csv -o species-data.js
  python csvtojs.py input.csv --var-name MY_VAR --compact

Produces a JS file that assigns the CSV rows to a global array usable
directly from a <script src="..."></script> in a file:// context.

Behavior:
- Uses the header row if present. Looks for columns named (case-insensitive)
  Key, Common Name, Scientific Name. If those headers are not present,
  it falls back to taking the first three columns as key, common, scientific.
- Trims values.
- Emits UTF-8 output.
"""
import argparse
import csv
import json
from pathlib import Path
import sys

def infer_fields(fieldnames):
    low = [f.strip().lower() for f in (fieldnames or [])]
    def idx_of(names):
        for n in names:
            if n in low:
                return low.index(n)
        return -1
    # look for exact header names
    try:
        key_i = low.index('key')
        common_i = low.index('common name')
        sci_i = low.index('scientific name') if 'scientific name' in low else (low.index('scientific') if 'scientific' in low else -1)
        return ('header', {'key': 'key', 'common': 'common name', 'scientific': 'scientific name'})
    except ValueError:
        # fallback: if there are at least 3 columns, use first 3
        if len(low) >= 3:
            return ('fallback', None)
        # otherwise use whatever columns exist
        return ('fallback', None)

def build_records_from_dictrow(row, headers_mode):
    # row is an OrderedDict from csv.DictReader
    # find keys for common fields
    keys = {k.strip(): v for k,v in row.items()}
    # case-insensitive lookups
    lookup = {k.strip().lower(): (k, v) for k,v in row.items()}
    def g(name):
        # try direct header names
        if name in lookup:
            return (lookup[name][1] or '').strip()
        # try partial matches
        for k in lookup:
            if name in k:
                return (lookup[k][1] or '').strip()
        return ''
    return {
        'key': g('key'),
        'common': g('common name') or g('common'),
        'scientific': g('scientific name') or g('scientific')
    }

def build_records_from_rowlist(cols):
    # cols: list of string values (already trimmed)
    key = cols[0] if len(cols) > 0 else ''
    common = cols[1] if len(cols) > 1 else ''
    scientific = cols[2] if len(cols) > 2 else ''
    return {'key': (key or '').strip(), 'common': (common or '').strip(), 'scientific': (scientific or '').strip()}

def convert_csv_to_records(path):
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(newline='', encoding='utf-8') as fh:
        # detect if header-like by using DictReader; if headers are numeric names fallback to row parsing
        sample = fh.read(8192)
        fh.seek(0)
        # Use csv.Sniffer to try detect header
        has_header = False
        try:
            sniffer = csv.Sniffer()
            has_header = sniffer.has_header(sample)
        except Exception:
            has_header = True  # conservative
        # Try DictReader first if header detected
        records = []
        if has_header:
            reader = csv.DictReader(fh)
            # check if meaningful headers exist
            header_mode = infer_fields(reader.fieldnames)
            # read rows
            for row in reader:
                rec = build_records_from_dictrow(row, header_mode)
                # skip empty rows (no key and no common)
                if not rec['key'] and not rec['common']:
                    continue
                records.append(rec)
            if records:
                return records
            # fallback to row parsing below if no records produced
            fh.seek(0)
        # fallback: plain row parsing
        fh.seek(0)
        reader2 = csv.reader(fh)
        for cols in reader2:
            cols = [c.strip() for c in cols]
            if not any(cols):
                continue
            rec = build_records_from_rowlist(cols)
            if not rec['key'] and not rec['common']:
                continue
            records.append(rec)
    return records

def write_js(records, out_path, var_name='window.__speciesRecords', compact=False):
    out_path = Path(out_path)
    if compact:
        json_text = json.dumps(records, ensure_ascii=False, separators=(',',':'))
        text = f"{var_name}={json_text};\n"
    else:
        json_text = json.dumps(records, ensure_ascii=False, indent=2)
        text = f"{var_name} = {json_text};\n"
    out_path.write_text(text, encoding='utf-8')
    return out_path

def main():
    p = argparse.ArgumentParser(prog='csvtojs', description='Convert CSV to a JS file that assigns an array to a global variable.')
    p.add_argument('csvfile', help='Input CSV file')
    p.add_argument('-o', '--out', default='species-data.js', help='Output JS filename (default: species-data.js)')
    p.add_argument('--var-name', default='window.__speciesRecords', help='Global variable assignment (default: window.__speciesRecords)')
    p.add_argument('--compact', action='store_true', help='Emit compact JSON (no pretty indent)')
    args = p.parse_args()

    try:
        records = convert_csv_to_records(args.csvfile)
    except FileNotFoundError:
        print(f"Error: file not found: {args.csvfile}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print("Error reading CSV:", e, file=sys.stderr)
        sys.exit(2)

    if not records:
        print("Warning: no records parsed from CSV. Output will still be created as an empty array.", file=sys.stderr)

    out = write_js(records, args.out, var_name=args.var_name, compact=args.compact)
    print(f"Wrote {out} with {len(records)} records.")

if __name__ == '__main__':
    main()