# Upstream 0.9.8 resource and module review

The reviewed input is PokéBonk 0.9.8, build `mw2lpvdy`, observed on November 5,
2026 (Asia/Taipei). Its predecessor is 0.8.86, build `mvwwqlzz`.

## Module ownership

The application now imports shared menu/profile code from a separate module.
The profile factory, Pokédex registry, achievements, task refresh and Friends
route belong to that module; startup, HTTP backend selection and the status bar
belong to the application. The resource contract records both original modules.
Preparation patches each owner and adds a named local-backend export/import.
Configuration symbols that the menu did not already import are imported from
its existing configuration dependency. The application season import is traced
back to the corresponding menu export. Missing or ambiguous ownership rejects.

A direct `inspectGame` call with the pristine application and configuration
reproduced `profile factory: expected one match, got 0`. With explicit menu
ownership, the same modules pass inspection and every patch stage, including
the live-checkpoint alias, local-storage failure message and offline Friends
route. The reduced split-module regression fails on the original implementation;
the integrated-module cases remain covered.

## Independent resource review

The baseline was reviewed against the HTML/module/CSS graph, asset-version
catalog, item/sprite data and the actual URL producers, before full collection.
It was not copied from the candidate's downloaded-file manifest.

- The game advances to season 3 with a Pokédex limit of 251. Portraits, icons
  and cries through that limit, all animated sprite catalog entries and their
  fallback resources are included.
- The module graph adds menus, a preload helper, event data, German translations
  and split font/menu styles. Retired hashed modules/fonts are replaced by the
  paths referenced by the new graph. Stable existing requirements are retained.
- New environment catalogs include Canela, Cave, Encina, Iris, Crater, Mewden,
  Tintower, Ilextime and Wilds. Their atlases and terrain textures are required.
  Iris's panorama callback enumerates `pano_far` and `pano_near`; both PNGs are
  required, as is the shared hazards texture.
- Native startup reproduced six missing Iris tile textures. The shared tile
  loader selects six explicit tokens for each of the Wilds, island, cave,
  ancient and valley terrain branches. Those branches map to Wilds, Canela,
  Cave, Encina and Iris respectively. All 30 tile PNGs and the two panorama
  layers for those maps plus Forest and Desert are now required. Preparation
  still removes the upstream website manifest because native apps are not PWAs.
- Relic renderers derive `ui/relics/<key>.png` from the 32-entry passive relic
  catalog. Expedition legendary equipment derives `gear/<icon>.png` from 18
  legend records. These are separate from the held-item catalog. Event artwork,
  explicit icon paths and wardrobe frame overrides are required as well.
- The 251-species achievement introduces nested `prizes` for the `allcaught`
  frame/banner and `pokemaster` avatar. Appearance acceptance reproduced a missing
  `allcaught.jpg` request. Collection now resolves `bg:` to banner JPEGs, and
  cosmetic injection includes nested achievement rewards. All three paths are
  independently required; the nested-cosmetics regression failed before the fix.
- The desktop download page replaces three platform PNGs with four inline SVGs.
  Its background list is now forest, coast, glacier, desert and horde; the retired
  cave background and platform PNG requirements are removed with their producers.
  Native acceptance checks all four platform SVGs and decodes all five backgrounds.
- The combined mutation catalog contains generation-specific subsets. Selection
  requires a unique strict superset with identical subset entries; duplicate,
  conflicting or disjoint catalogs reject. All mutation icons and frame/banner
  rewards remain mandatory.
- Achievement categories derive icons from their category records, including
  the new `rift` category; all 11 category icons are required. The appearance
  achievement list now appends batches through an IntersectionObserver. Native
  acceptance scrolls the real sentinel before counting completed cards; an
  isolated native probe rendered all 118 general and 309 appearance achievements.
- Model literals and indirect scene tables were traced across the application
  and menu modules. The independently fetched GLBs have the `glTF` signature.
  This includes the menu-owned Encina landmarks and Canela/Cave decoration models.
  Four `w_*` labels (`w_tent_rocket`, `w_crates_stack`, `w_campfire`, `w_signpost`)
  are lookups within the Wilds atlas, not separate GLBs; their standalone URLs
  return 404 and are not required model downloads.
- Three optional treasure-style frames (`look-ember`, `look-verdant`, `look-tidal`)
  also return 404 at the official same-version URLs. Their renderer explicitly
  removes failed frame images. The offline adapter preserves that no-frame
  result without requesting these absent decorations; explicit frame overrides
  and every other missing resource keep their normal behavior. Original artwork
  is not replaced. [The upstream resource follow-up](https://github.com/VdustR/pokebonk-offline/issues/30)
  records the evidence and conditions for removing the adapter.

## Acceptance boundaries

Preparation, payload verification, resource-gate rejection tests, native gameplay,
image decoding, save/recovery and platform packaging are required before release.
Gameplay acceptance covers eight maps and the Halloween tower, including all
four newly playable Canela, Cave, Encina and Iris maps.
The independent baseline guards reviewed resource producers; it does not prove
all possible remotely supplied content or every gameplay combination. Network
isolation and local save identities stay unchanged. Online-only account/social
features and expedition services are not supplied by the local backend.

The scheduled review-required state and polling frequency are unchanged by this
update. Their visibility and cadence are a separate follow-up decision.

The first native run also stopped at the upstream Johto starter dialog despite
the complete League unlock. The local profile now normalizes the numeric
`starterJ` and numeric-array `johtoForms` fields, grants the default Johto starter
only when unset and unlocks the current form catalog. Existing starter choices,
selected character and counters are preserved; malformed new fields reject
before a profile write. The focused backend regression failed before this fix.
