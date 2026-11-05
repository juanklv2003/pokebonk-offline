# Upstream 0.9.11 resource review

The reviewed target is 0.9.11, build `mw3lyjcf`, observed on November 5, 2026
(Asia/Taipei), after the verified 0.9.8 release. Offline 0.0.20 also fixes season-calculator module ownership discovered by the
real native boot check.

The [0.9.8 producer audit](upstream-0.9.8-review.md) remains the resource-domain
baseline. Comparing the actual application, menu and configuration modules
finds no added or removed asset-path literals, model/cosmetic identifiers or
resource-producing template quasis. CSS URL sets are also identical after
normalizing the build suffix. League, Lab, shop, biome, achievement and season
catalog sizes remain unchanged. Syntax checks alone initially passed, but native startup exposed an import
ownership error: the season calculator moved into configuration while menus
reused its export name for a numeric constant. The adapter now resolves imports
against their source module and rejects unknown owners. A regression test checks
the real conflicting exports; native startup must also pass.

The new `desktopapp` module is a 94-byte re-export facade for `DESKTOP_APP`,
`androidAppVersion` and `apkUrl` from the existing menu module. It introduces no
asset producer. Other hashed module/style/font paths follow the new graph.
The independently reviewed input inventory now has 70 entries.

Fresh downloads of all JSON catalogs and environment atlases differ only in
`data/i18n/zh.json` and `data/i18n/zht.json`, consistent with the changed version
map. All binary resource version groups are unchanged. Previously verified
binary bytes are reused only at identical versioned URLs through the existing
URL-addressed cache; executable/catalog/style input hashes come from freshly
fetched source. Stable resource requirements are retained, rather than inferred
from the new downloaded-file manifest.

The three optional treasure-frame URLs still return 404 at the official origin.
The existing narrow no-frame adapter and [restoration follow-up](https://github.com/VdustR/pokebonk-offline/issues/30)
remain applicable. New snapshot preparation, payload hashes, resource rejection,
nine-scenario native gameplay/save recovery and all platform checks remain
required before promotion to main and publication. Physical-device and real
installed-profile migration acceptance remain separate.

Local verification passed 91 tests, type checking, 60 compiler probes and 3,829
payload hashes with upstream requests denied during preparation. Real Electron
runs passed all nine scenarios, pointer lock, checkpoint persistence, manual and
automatic save recovery after process restart, settlement, corrupt-save
preservation and network isolation. The conflicting-export regression fails
with the previous resolver and passes with the source-aware resolver. CI still
owns all-platform packaging and publication checks.
