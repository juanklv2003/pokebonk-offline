# Resource review boundary

The downloaded-file manifest proves byte integrity, not dependency completeness.
Offline 0.0.12 passed all 3031 payload hashes while the official desktop page
requested three missing platform icons and four missing CSS backgrounds.

`scripts/resource-contract.json` is an independent, checked-in baseline of
required resource paths and SHA-256 hashes of the pristine upstream HTML,
JavaScript, CSS, JSON catalogs and SVG inputs. It includes the accepted snapshot
inventory and independently reviewed dependencies. The original baseline added
the seven dependencies reproduced on the desktop page; the [0.9.8 review](upstream-0.9.8-review.md)
records their upstream replacements and new resource families. It is not
a generated output of acquisition, preparation, verification or promotion.

- Acquisition downloads the required paths as mandatory resources.
- Preparation rejects any changed, added or removed upstream input, or build
  identity, before writing output. It also rejects missing required files.
- Payload verification checks the independent requirements even when the file
  manifest has been regenerated without a missing file. It validates PNG and
  WebP signatures and checks the resource-review digest recorded at preparation.
- Native desktop acceptance opens the actual desktop page, checks its four
  inline platform SVGs and decodes all five computed CSS backgrounds. Network failures remain
  fatal; retries and missing-image reporting are not suppressed.

This deliberately holds automatic upstream updates for dependency review.
Identity preflight reports a future upstream build as `review-required`, with
`changed=true` and `eligible=false`, and records the accepted and detected versions
in the workflow summary. Acquisition, validation and publication are skipped
until the independent contract has been reviewed. This expected hold completes
successfully; network, malformed identity and acquisition/verification errors
still fail. Direct acquisition also rejects unreviewed builds instead of
publishing unreviewed URL producers. Changes to tables, callback code, styles or catalogs are covered by
this conservative boundary without trying to solve arbitrary JavaScript.
Builder/runtime changes that do not change upstream inputs remain releasable.

## Reviewing an upstream update

1. Compare the pristine upstream input inventory and hashes with the contract.
   Trace changed URL producers and their finite catalog domains, including
   indirect icon maps, CSS URLs and callbacks. Prefer a complete authoritative
   upstream asset inventory if one becomes available.
2. Add all newly required paths to the independent contract and download their
   versioned original upstream bytes. Do not bless a candidate by copying its
   downloaded-file list or updating hashes alone. Preserve previously required
   paths unless the corresponding producer has been removed.
3. Run preparation, payload verification and native acceptance through the
   affected screens. Exercise a deliberately omitted image with an otherwise
   consistent manifest and an unreviewed producer change; both must reject.
4. Review the contract and snapshot together before accepting the new build.

The baseline prevents reviewed requirements from disappearing and blocks unknown
upstream changes. It does not prove exhaustive coverage of every unvisited
screen in the current minified game. Existing catalog checks and gameplay tests
remain necessary. A runtime screenshot alone cannot prove dependency closure.

## Reproduction evidence

On macOS, the installed Offline 0.0.12 page produced HTTP 404 for
`ui/icons/{pc-tower,laptop,handheld}.png` and
`ui/desktop/{forest,desert,coast,cave}.webp` under `assets/`.
The icon path is selected through an OS-to-icon map; the backgrounds are built
inside a map callback and applied through CSS. Literal icon discovery missed
both. Versioned upstream GETs returned valid PNG/WebP bytes for all seven.
The original verifier returned success despite these requests failing.
The maintained native desktop test now exercises this path without using the
user's profile or opening an external download.

### Appearance frame coverage

A subsequent audit of all five appearance-picker tabs found 20 missing frame
PNGs in the same captured upstream build: `top100`, `mon-ace`, `mon-master`, and
17 `type-*` frames. The original collection heuristic did not enumerate the
research-derived frame names. The unchanged-source gate correctly prevents
unreviewed upstream changes, but cannot discover a dependency omitted from its
initial baseline. These paths are now mandatory independently of acquisition.

Native acceptance enters the picker through the local leaderboard and decodes
all five tabs, including the full rendered frame catalog and banner backgrounds.
For this pinned research catalog, the frame tab exposes 17 type PNGs, two
Pokemon achievement PNGs, and the top-100 PNG. Removing a type frame reproduces
a decode failure; an otherwise consistent manifest omitting a required frame
also rejects. Background checks extract each CSS URL so a valid gradient layer
does not get mistaken for a missing image.

The audit also visited the main menu routes and the settings, achievement,
Dex/glossary, lab, treasure, event and daily-mutation subpages on a disposable
profile. Online-only profile content is unavailable in the local sandbox and
is not covered by this observation. These are bounded current-build checks,
not a guarantee about every future screen or remotely populated social state.

## Linux native CI setup

Both Linux window-manager setup steps call `e2e/install-linux-desktop.sh`.
The GitHub runner mirror list was observed retrying Azure Ubuntu indexes for
several minutes before official-archive failover. A related
[runner image report](https://github.com/actions/runner-images/issues/15040)
describes the same acquisition stall; the remote backend cause is unconfirmed.
The installer uses a temporary, command-scoped source list for Ubuntu 24.04
amd64, official archive/security HTTPS endpoints and the existing Ubuntu archive
keyring. It does not change runner-wide repositories or disable signature/TLS
verification. Both index refresh and installation have two retries and 20-second
connection/data timeouts; each workflow step has a six-minute total deadline.
Any index error fails before package installation. This bounds and avoids the
observed mirror-list path; it cannot guarantee external archive availability.

### Generated portrait readiness

The appearance renderer creates palette-derived portrait images hidden without
a `src`, then assigns the generated PNG asynchronously. Calling `img.decode()`
before that assignment rejects with `EncodingError` even though no resource
is missing; see the [image decoding contract](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode). Native acceptance waits for every portrait source to be assigned
and visible before decoding; corrupt and missing image sources still fail.
`e2e/appearance-readiness.ts` reproduces the pending-source failure in the real
Electron shell, holds a fixture producer result for two seconds, and verifies
both valid completion and permanent corrupt/missing-image rejection.
The main release failure had no HTTP or network errors; its original generic
decode exception did not record the specific image. This fixes a demonstrated
readiness gap and adds URL diagnostics without claiming that every decoder
error has this cause.

### Character preview overlap during automated acceptance

Calling the run-exit `toMenu()` method while already browsing character selection
created another menu scene without disposing the existing preview. The test
then launched a different character and left the Mewtwo preview at world origin,
overlapping the player. A controlled native comparison reproduced the overlap
with the direct test call and showed clean gameplay through the normal Back
button. This is distinct from missing assets. Acceptance now uses Back on menu
screens and holds the selected preview mesh reference to verify that launch
removes it from the rendered scene. Run settlement still uses the run-exit flow.

## Reviewed 0.8.86 update

The `mvwwqlzz` review compares the complete collected module/style graph with
`mvv70wso`. All 15 game/localization data catalogs are byte-identical. The
configuration's evaluated catalogs are unchanged; its differences are build,
version and release history. The 71 calls into the asset/data URL factories
retain the same normalized argument shapes and finite catalog domains.
All 3003 binary assets match the prior snapshot byte for byte after versioned
filename normalization. Eight stylesheets match after that normalization; the remaining
stylesheet adds layout, touch-orientation and co-op vote rules without new
resource URLs. Entry, preload, i18n loader and Three.js wiring remain unchanged
after filename normalization. Language modules add save/recovery, touch and
connection messages. The application adds autosave/recovery and transport/UI
behavior, with no additional asset family in its changed literals or URL calls.

The independent requirements retain the explicit desktop, appearance, sprite,
item, mutation, icon, model and treasure paths, with versioned graph filenames
updated together with the pristine snapshot. Existing catalog and missing-file
controls remain mandatory. The PWA manifest remains excluded from the native
payload, as preparation deliberately removes its link and file. These bounded
source comparisons and native checks do not establish completeness for every
remote social state or future build. See [local run recovery](local-run-recovery.md)
for the new backend compatibility boundary.
