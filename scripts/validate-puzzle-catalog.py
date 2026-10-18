"""Validate the app's static base-game catalog using only Python's standard library."""
import json
from collections import Counter, defaultdict
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[1] / 'data/base-game-puzzles.json'
REWARDS = {'single', 'domino', 'tri-line', 'tri-corner', 'tet-t', 'tet-line',
           'tet-l', 'tet-zigzag', 'tet-square'}


def validate(catalog):
    assert catalog['schemaVersion'] == 1 and catalog['set'] == 'base-game'
    assert catalog['synthetic'] is False
    puzzles = catalog['puzzles']
    assert len(puzzles) == 52
    assert [p['sourceNumber'] for p in puzzles] == list(range(1, 53))
    assert len({p['id'] for p in puzzles}) == 52
    assert Counter(p['deck'] for p in puzzles) == {'white': 32, 'black': 20}
    assert Counter((p['deck'], p['points']) for p in puzzles) == {
        ('white', 0): 11, ('white', 1): 13, ('white', 2): 8,
        ('black', 3): 8, ('black', 4): 7, ('black', 5): 5,
    }
    designs = defaultdict(list)
    for p in puzzles:
        number, rows = p['sourceNumber'], p['mask']
        assert p['id'] == f'base-{number:02}'
        assert p['deck'] == ('white' if number <= 32 else 'black')
        assert type(p['points']) is int and 0 <= p['points'] <= 5
        assert p['reward'] in REWARDS
        assert rows and len(rows) <= 5
        width = len(rows[0])
        assert 1 <= width <= 5 and all(len(row) == width for row in rows)
        assert all(set(row) <= {'#', '.'} for row in rows)
        assert '#' in rows[0] and '#' in rows[-1]
        assert any(row[0] == '#' for row in rows) and any(row[-1] == '#' for row in rows)
        cells = {(x, y) for y, row in enumerate(rows) for x, value in enumerate(row) if value == '#'}
        reached = {min(cells)}
        pending = list(reached)
        while pending:
            x, y = pending.pop()
            for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if neighbor in cells and neighbor not in reached:
                    reached.add(neighbor)
                    pending.append(neighbor)
        assert reached == cells, f'Disconnected mask: {p["id"]}'
        designs[(p['deck'], p['points'], p['reward'], tuple(rows))].append(p['id'])
    duplicates = [ids for ids in designs.values() if len(ids) > 1]
    assert duplicates == [['base-22', 'base-23']], 'Review changed duplicate designs'
    return puzzles, duplicates


if __name__ == '__main__':
    puzzles, duplicates = validate(json.loads(CATALOG.read_text()))
    print('Validated 52 unique physical puzzles: 32 white, 20 black; all masks connected and normalized.')
    print('Exact repeated design retained as separate copies:', ', '.join(duplicates[0]))
