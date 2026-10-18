"""Verify/extract the publisher's November 2023 vector PDF (requires pdfplumber).

Usage: python3 scripts/extract-puzzle-catalog.py /path/to/puzzle-list.pdf [--write]
No download or PDF redistribution is required. --write regenerates the JSON.
"""
import argparse
import hashlib
import json
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/base-game-puzzles.json'
SOURCE_SHA256 = 'cc5fedc6b7d4011cb0c42724f9ab1eee0e4c70fd67c795eeb8ef7537ef8c8d01'
COLORS = {
    (0, 0, 1, 0): ('single', 1),
    (.85, 0, 1, 0): ('domino', 2),
    (1, .4, 0, 0): ('tri-line', 3),
    (0, .5, 1, 0): ('tri-corner', 3),
    (0, 1, 0, 0): ('tet-t', 4),
    (.5, .85, 0, 0): ('tet-line', 4),
    (1, 0, .2, 0): ('tet-l', 4),
    (0, .7, 1, 0): ('tet-zigzag', 4),
    (0, 1, .5, 0): ('tet-square', 4),
}


SHAPES = {
    'single': ['#'], 'domino': ['##'], 'tri-line': ['###'],
    'tri-corner': ['#.', '##'], 'tet-t': ['###', '.#.'],
    'tet-line': ['####'], 'tet-l': ['#.', '#.', '##'],
    'tet-zigzag': ['.##', '##.'], 'tet-square': ['##', '##'],
}


def shape_signature(rows):
    cells = {(x, y) for y, row in enumerate(rows) for x, value in enumerate(row) if value == '#'}
    variants = []
    for reflected in (False, True):
        variant = {(-x if reflected else x, y) for x, y in cells}
        for _ in range(4):
            min_x, min_y = min(x for x, _ in variant), min(y for _, y in variant)
            variants.append(tuple(sorted((x - min_x, y - min_y) for x, y in variant)))
            variant = {(-y, x) for x, y in variant}
    return min(variants)


def inside(obj, card):
    return (obj['x0'] >= card['x0'] - .01 and obj['x1'] <= card['x1'] + .01
            and obj['top'] >= card['top'] - .01 and obj['bottom'] <= card['bottom'] + .01)


def mask(squares, unit):
    x0 = min(s['x0'] for s in squares)
    y0 = min(s['top'] for s in squares)
    cells = set()
    for square in squares:
        x, y = (square['x0'] - x0) / unit, (square['top'] - y0) / unit
        assert abs(x - round(x)) < .002 and abs(y - round(y)) < .002
        cells.add((round(x), round(y)))
    assert len(cells) == len(squares), 'Duplicate cell geometry'
    return [''.join('#' if (x, y) in cells else '.' for x in range(max(x for x, _ in cells) + 1))
            for y in range(max(y for _, y in cells) + 1)]


def extract(path):
    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    assert fingerprint == SOURCE_SHA256, 'PDF differs from the reviewed source; review it before regenerating'
    with pdfplumber.open(path) as pdf:
        assert len(pdf.pages) == 1
        page = pdf.pages[0]
        # Reviewed base-game panel only; other panels contain expansion cards.
        cards = sorted([c for c in page.curves if 190 < c['width'] < 200
                        and 220 < c['height'] < 230 and c['x0'] < 2000],
                       key=lambda c: (round(c['top']), c['x0']))
        assert len(cards) == 52
        words = page.extract_words()
        puzzles = []
        for number, card in enumerate(cards, 1):
            squares = [r for r in page.rects if inside(r, card)
                       and abs(r['width'] - 28.3465) < .01 and abs(r['height'] - 28.3465) < .01
                       and r['non_stroking_color'] == (0, 0, 0, 0)]
            rewards = [r for r in page.rects + page.curves if inside(r, card) and r['top'] < card['top'] + 45
                       and abs(r['width'] - 9.449) < .01 and abs(r['height'] - 9.449) < .01
                       and r['non_stroking_color'] in COLORS]
            colors = {r['non_stroking_color'] for r in rewards}
            assert len(colors) == 1
            reward, area = COLORS[colors.pop()]
            assert len(rewards) == area
            assert shape_signature(mask(rewards, 9.449)) == shape_signature(SHAPES[reward]), 'Reward glyph disagrees with color mapping'
            points = [w['text'] for w in words if inside(w, card) and w['top'] < card['top'] + 50]
            assert len(points) <= 1 and all(w.isdigit() for w in points)
            puzzles.append({'id': f'base-{number:02}', 'sourceNumber': number,
                            'deck': 'white' if number <= 32 else 'black',
                            'points': int(points[0]) if points else 0,
                            'reward': reward, 'mask': mask(squares, 28.3465)})
        return {'schemaVersion': 1, 'set': 'base-game', 'synthetic': False,
                'source': {'title': 'Boardcubator All Puzzles (November 2023)',
                           'url': 'https://drive.google.com/file/d/10-10J5Cs584eoKPhg_AaXMjE43Znmi8F/view',
                           'resourcesUrl': 'https://www.boardcubator.com/resources/',
                           'sha256': fingerprint, 'page': 1, 'panel': 'BASE GAME',
                           'reviewedOn': '2026-10-12'}, 'puzzles': puzzles}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    result = extract(args.pdf)
    if args.write:
        OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
        print(f'Wrote {len(result["puzzles"])} puzzles to {OUTPUT}')
    else:
        assert result == json.loads(OUTPUT.read_text()), 'Catalog does not match publisher vectors/text'
        print('All 52 masks, point values, rewards, and source metadata match the publisher PDF.')
