# Dipolis simulation references and provenance

Dipolis modifies the GPL-released Electronic Arts city simulation and
[Don Hopkins's MicropolisCore port](https://github.com/SimHacker/MicropolisCore).
The upstream base is
[`f9ae6a57bbe5f5ff94c149bccb3015757f18241d`](https://github.com/SimHacker/MicropolisCore/commit/f9ae6a57bbe5f5ff94c149bccb3015757f18241d),
authored by Don Hopkins on 2026-10-03. Local Git history identifies it as the
immediate parent of the first Dipolis engine extension,
`64ea370a408ebabef025f804939249de6219b302`
(`feat(micropolis): add AI, power priorities, farms, and food import`).

## Retained documentation

- [`notes/`](notes/README.md): simulator behaviour, tile bitmasks, animation,
  binary city-save layout, coding conventions, and engine/CLI test references.

Broader historical engineering plans and cross-project archives are not a
Dipolis roadmap and were removed. Their originals remain in the
[pinned upstream documentation tree](https://github.com/SimHacker/MicropolisCore/tree/f9ae6a57bbe5f5ff94c149bccb3015757f18241d/documentation).
The original manual archives are not distributed in this checkout. Their
copyright and attribution history remains accessible at the upstream base;
the retained program's original notices remain at the repository root.

## Dependency and pruning inventory

The explicit workspace consists of Dipolis plus `@micropolis/engine-wasm`,
`@micropolis/render-core`, and `@micropolis/tile-renderer`. The app imports all
three; tile-renderer also depends on render-core. Their internal names remain
unchanged for API compatibility.

The inventory was derived from `git ls-files`. Separate applications,
character-rendering libraries, unused data placeholders, old client archives,
cross-project design plans, conference/art collections, and their deployment
workflows were pruned. Original history remains in Git.

Top-level tracked directories inspected were `.github`, `.vscode`, `apps`,
`content`, `docs`, `documentation`, `images`, `packages`, `scripts`, and `skills`.
Active results/handbooks under `docs`, city assets under `content/micropolis`,
engine sources, legal notices, and applicable build configuration remain.
Root image archives were removed after their website routes, markdown loaders,
and tests were retired. Unrelated editor settings and scripts were not changed.
Unexpected user files were preserved; generated dependency remnants were
removed only after a no-follow symlink audit.

## Original notices

Root [`LICENSE`](../LICENSE),
[`MicropolisGPLLicenseNotice.md`](../MicropolisGPLLicenseNotice.md), and
[`MicropolisPublicNameLicense.md`](../MicropolisPublicNameLicense.md) remain
verbatim. Original copyright, GPL, name-license, and attribution requirements
remain applicable. The modified project is named Dipolis.
