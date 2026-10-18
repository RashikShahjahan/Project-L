# Base-game puzzle catalog

The app catalog is [data/base-game-puzzles.json](../../data/base-game-puzzles.json): 32 white and 20 black physical puzzles. These are publisher puzzles, not synthetic fixtures. Expansion panels are excluded.

## Source and identifiers

Source: Boardcubator's [All Puzzles / Puzzle List](https://drive.google.com/file/d/10-10J5Cs584eoKPhg_AaXMjE43Znmi8F/view), linked from the [publisher's resources page](https://www.boardcubator.com/resources/). The reviewed PDF was created November 8, 2023 and has one large page, with separate base-game and expansion panels. Reviewed October 12, 2026. The catalog stores its SHA-256 fingerprint and source links; the publisher PDF is not redistributed in this repository.

The base-game panel numbers its 52 puzzles. `base-01` through `base-32` belong to the white deck; `base-33` through `base-52` belong to the black collection. These identifiers preserve the publisher list's numbering; they are software IDs, not claims that the physical components print numbers. The list depicts all cards on dark backgrounds, so the illustration background is not a deck classifier. The first 32 are the white set and the final 20 the black set, matching the rulebook's component counts and the listed scoring groups.

Each entry contains:

- `id`: unique physical puzzle ID, used for shuffling and conservation.
- `sourceNumber`: number in the publisher's base-game panel.
- `deck`: `white` or `black`.
- `points`: printed points; the blank point fields on puzzles 22-32 encode zero.
- `reward`: one of the nine piece identifiers in rules.md.
- `mask`: rectangular array of equal-length rows; `#` is fillable and `.` is outside the recess.

Coordinates are `[x, y]`, with x increasing rightward and y downward. The upper-left of the trimmed bounding box is `[0, 0]`. Masks retain the displayed orientation but remove empty outer rows and columns. Grid dots do not create holes inside fillable cells. Array rows are the canonical geometry; consumers can derive cell coordinates without consulting the PDF.

Do not deduplicate physical puzzles by geometry. Puzzles 22 and 23 are two identical zero-point domino masks granting a domino reward. Other repeated masks may have different rewards or scores; for example, puzzle 9 has the same mask as 22 and 23 but scores one point and grants a single. All three remain separate objects.

## Validation and reproduction

The cell masks were extracted from the PDF's white vector squares, points from text, and rewards from colored vector glyphs. Each reward's glyph geometry is checked against its piece shape under rotations and reflections, in addition to its color and area. The rendered base-game panel was visually reviewed for scores, rewards, numbering, and expansion boundaries. An independent pixel sample of all 52 masks from a 4200-pixel-wide Poppler render matched every encoded cell.

The catalog validator checks unique IDs, contiguous source numbering, the 32/20 split, score distribution, valid rewards, connected normalized masks, and preservation of the duplicate physical cards. It requires only standard Python:

```sh
python3 scripts/validate-puzzle-catalog.py
```

To reproduce the publisher comparison, download the linked PDF and install `pdfplumber` in your development Python environment:

```sh
python3 scripts/extract-puzzle-catalog.py /path/to/puzzle-list.pdf
```

The extractor checks the reviewed source fingerprint and compares all 52 entries and metadata. Add `--write` to regenerate the JSON from that exact source. A changed publisher PDF requires review before updating the fingerprint, extraction assumptions, or catalog.

Validation passed on October 12, 2026: 52 unique physical IDs, 32 white and 20 black entries; all source masks, points, and rewards match. Score distribution is white: eleven 0-point, thirteen 1-point, eight 2-point; black: eight 3-point, seven 4-point, five 5-point puzzles.
