# Engine scratch notes

Text artifacts that describe **internals of the C++ simulator**, **tile representation**, and **coding conventions**. Authored alongside the Tcl/Tk → Python → modern web transitions; some wording still reflects older stacks.

## Files

| File | Description |
|------|-------------|
| **`SIMULATOR.txt`** | High-level simulator behaviour notes. |
| **`Tiles.txt`** | Tile types / bitmask / animation ideas. |
| **`AnimationSequences.txt`** | Animation / sprite sequencing notes. |
| **`file-format.txt`** | Binary / record layout clues (pair with **`../city-save-files.md`** for modern CLI work). |
| **`CODING-STYLE.txt`** | C++ style expectations for the core (`packages/micropolis-engine/src/`). |
| **`ASSETS.txt`** | Inventory of UI surfaces (dialogs, tools, overlays) from the classic activity era. |

The former `legacy/` Tcl/Python integration notes were pruned because the
Wasm/Embind bridge supersedes them. They remain in the
[pinned upstream history](../../README.md).

For current project structure and upstream history, see the
[provenance index](../../README.md).
