"""Extrait les chaînes passées à t()/tn() ainsi que les textes des permissions et catégories d'emojis.

Usage :
  python scripts/extract-i18n.py          → liste (JSON) des clés absentes du dictionnaire anglais
  python scripts/extract-i18n.py --all    → toutes les clés
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')

SQ = r"'((?:\\.|[^'\\])*)'"
DQ = r'"((?:\\.|[^"\\])*)"'
PAT_T = re.compile(r"\bt\(\s*(?:" + SQ + "|" + DQ + ")")
PAT_TN = re.compile(r"\btn\([^,]+,\s*" + SQ + r",\s*" + SQ)


def unescape(s: str) -> str:
    return s.replace("\\'", "'").replace('\\"', '"')


keys = []
for dp, _, files in os.walk(ROOT):
    for f in files:
        if not f.endswith(('.ts', '.tsx')) or f == 'i18n-en.ts':
            continue
        src = open(os.path.join(dp, f), encoding='utf8').read()
        for m in PAT_T.finditer(src):
            keys.append(unescape(m.group(1) if m.group(1) is not None else m.group(2)))
        for m in PAT_TN.finditer(src):
            keys += [unescape(m.group(1)), unescape(m.group(2))]

perms = open(os.path.join(ROOT, 'lib', 'perms.ts'), encoding='utf8').read()
for m in re.finditer(r"(?:title|name|desc): (?:" + SQ + "|" + DQ + ")", perms):
    keys.append(unescape(m.group(1) if m.group(1) is not None else m.group(2)))
emoji = open(os.path.join(ROOT, 'lib', 'emoji.ts'), encoding='utf8').read()
keys += re.findall(r"^  ([A-Za-zÀ-ÿ]+):$", emoji, re.M)

seen = list(dict.fromkeys(keys))
en_src = open(os.path.join(ROOT, 'lib', 'i18n-en.ts'), encoding='utf8').read()
missing = seen if '--all' in sys.argv else [k for k in seen if json.dumps(k, ensure_ascii=False) + ':' not in en_src]
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps(missing, ensure_ascii=False, indent=0))
print(f'{len(seen)} clés, {len(missing)} manquantes', file=sys.stderr)
