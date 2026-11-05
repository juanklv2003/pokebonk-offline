# PokéBonk Offline

Unofficial, fully bundled [PokéBonk](https://pokebonk.com/) unlock-all apps for Electron desktop and Android. All game resources ship inside each package, saves stay local, and the game runs without an account or internet connection. There is no PWA, service worker, or Pages deployment.

## Download and play

Download the **Unlocked** archive or APK for your platform from the [latest release](https://github.com/VdustR/pokebonk-offline/releases/latest). Release titles show the upstream game and offline builder versions; download filenames identify the edition and platform. `SHA256SUMS.txt` verifies every download.

| Package | Platform |
| --- | --- |
| `pokebonk-offline-*-unlocked-darwin-arm64-*.zip` | Apple Silicon Mac, macOS 13+ |
| `pokebonk-offline-*-unlocked-darwin-x64-*.zip` | Intel Mac, macOS 13+ |
| `pokebonk-offline-*-unlocked-win32-x64-*.zip` | Windows 10+ x64 |
| `pokebonk-offline-*-unlocked-linux-x64-*.tar.gz` | Linux x64 with Electron's system dependencies |
| `pokebonk-offline-*-unlocked-android.apk` | Android 8+ with a WebGL-capable Android System WebView |

Extract desktop archives and launch the included app. Install the APK on Android. Desktop builds are not commercially signed; macOS apps have verified ad-hoc signatures and are not notarized. The operating system may require user approval when first opening a download.

Android updates use the same dedicated signing certificate and application ID, allowing APK updates without uninstalling. Keep the existing app installed to retain its data. Electron updates retain the same app name, storage origin, and user-data directory.

Android follows the game's responsive landscape viewport, using the [WebView wide-viewport support](https://developer.android.com/develop/ui/views/layout/webapps/targeting) needed to match Chrome scaling. Use the game's settings to adjust HUD size, touch-button size, minimap size, and camera distance. Display-cutout padding remains active to keep controls clear of the camera area.

### macOS installation and first launch

These builds support macOS 13 or later. They are ad-hoc signed, with no Apple Developer ID or notarization; macOS may block a downloaded copy on first launch.

1. Open Apple menu > **About This Mac** ([Apple's chip identification guide](https://support.apple.com/en-us/116943)). Choose the `darwin-arm64` ZIP for an Apple Silicon chip, or `darwin-x64` for an Intel processor. Download it from this repository's [Releases](https://github.com/VdustR/pokebonk-offline/releases/latest).
2. Check the ZIP against `SHA256SUMS.txt` from the same Release. In Terminal, run `shasum -a 256` followed by a space, drag the ZIP into the window, and press Return. Compare both the filename and hash with the checksum file.
3. Double-click the ZIP in Finder. Inside the extracted `Pokebonk Offline-darwin-…` folder, drag **Pokebonk Offline.app** to **Applications**. Open that copy once. [Apple's app installation guide](https://support.apple.com/guide/mac-help/install-and-uninstall-other-apps-mh35835/mac) explains installing downloaded apps.
4. If macOS reports that the developer cannot be verified or Apple cannot check for malicious software, dismiss that dialog. Proceed only if you trust this download and its integrity check passed.
5. Open Apple menu > **System Settings > Privacy & Security**, then scroll to **Security**. Find the blocked **Pokebonk Offline** entry and select **Open Anyway**. Some macOS versions show **Open** before that confirmation. The exception is for this app. See [Apple's first-launch instructions](https://support.apple.com/en-us/102445).
6. Authenticate if prompted, then confirm **Open** when macOS asks again. Future launches of the approved copy normally work from Applications. If the button is missing, try opening the app again and return to Settings: Apple says the approval is available for roughly an hour after the attempt. [Apple's exception guide](https://support.apple.com/guide/mac-help/mh40617/mac) describes the timing and authentication.

A warning that the app **will damage your computer**, was moved to Trash as malware, or **is damaged** needs investigation; do not treat it as the ordinary unidentified-developer prompt. Re-download from Releases and verify the checksum for a damaged download; report a persistent failure. Managed Macs may require your administrator's approval. [Apple distinguishes these alerts](https://support.apple.com/en-us/102445).

For an update, quit the app and replace its copy in Applications. Keep the same app name and user-data directory to retain local saves; a new downloaded build may require approval again.

## Editions

**Unlocked** is the current supported edition. A **Standard** edition was evaluated and is not planned: normal progression requires a separate reward, purchase and claim backend. See the [edition decision](docs/editions.md) for the evidence and save-isolation requirements if it is ever reconsidered.

## Unlocks and scope

The current catalogs supply every League member, maximum Lab upgrades, every shop item, character looks and cosmetics, all achievements with their title/mastery-look rewards, one billion Stardust, and 999 of each preparation item. Every treasure wheel has its full prize collection and corresponding looks, frames, and titles. Preparation-item prizes follow the same 999-per-item policy. Every League member has the Normal, Hard, and Nightmare victory marks. Supported maps have every difficulty and champion medal. Daily and weekly commissions are completed and claimed when loading or saving, including after a period changes.

Unlocks apply to both new and existing native-app saves. Actual run counters, recent results, recorded best times and scores, selected character, equipped look, and preferences retain their values. Victory marks do not add fabricated runs or leaderboard records. Future-season maps without implemented gameplay stay unavailable. Online accounts, multiplayer, clans, social features, mail, and rankings remain unavailable; visible online entry points can show a local unsupported-feature message.

The former PWA's browser data is separate from Electron and Android app storage. Changing the distribution does not delete that browser data or modify an official account, but it does not automatically migrate browser saves into the native apps. Uninstalling an app or deleting its data can remove its local save.

## Build and verify

Use Node.js 24 LTS (24.12+) or Node.js 26+, with pnpm 10.33.2. Electron 45.0.0 and Electron Packager 20.3.0 are pinned. Android uses the checked-in Gradle wrapper, JDK 17+, Android SDK 36, and build-tools 36.0.0.

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm typecheck
pnpm test:types
pnpm test
pnpm prepare:game
node scripts/verify-game.ts
pnpm e2e:electron
pnpm package:electron build/game release darwin arm64
pnpm stage:android
cd android
./gradlew --no-daemon assembleDebug assembleRelease lintRelease
```

Maintained tools, tests, Electron code, and the browser backend use TypeScript 7.0.2 with `@tsconfig/strictest` and application-scoped `ts-reset`. See [TypeScript boundaries and verification](docs/typescript.md) for the environment split, runtime emission, coverage gate, and incremental-cache limitation.

Catalog-driven status and reaction images are required assets. The payload verifier checks catalog completeness as well as file hashes; native tests also decode these images. See [asset collection and evidence limits](docs/asset-collection.md).

A loopback static preview is available with `pnpm preview` for debugging. It is not an installable PWA. Desktop external web links open in the system default browser. Desktop window closing, menus and lifecycle follow the [desktop integration audit](docs/desktop-integration.md). Desktop fullscreen controls follow the [fullscreen permission repair and reproduction](docs/desktop-fullscreen.md). Desktop keyboard/mouse capture follows the [pointer-lock specification and reproduction](docs/desktop-pointer-lock.md). Native runtime tests use a temporary Electron user-data directory; a packaged executable can be supplied as the second argument to `e2e/electron.ts`.

To test an installed debug APK on a connected emulator or device:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
ANDROID_FULL_GAMEPLAY=1 pnpm e2e:android <adb-serial>
```

Release WebViews disable debugging. Do not replace an installed release APK with a debug APK: their signatures differ. The debug test validates unlocks, resource loading, local persistence, and optionally nine representative gameplay scenarios. Emulator evidence does not establish physical-device behavior.

## Automatic releases

CI builds the verified upstream snapshot in `vendor/pokebonk/` on main changes, pull requests, and manual dispatch. It does not contact the upstream game site. A separate workflow checks for upstream updates every six hours. Changed upstream inputs now stop for [resource dependency review](docs/resource-completeness.md); after the contract is reviewed, the candidate must pass the existing platform checks before promotion and publication. Failed syncs retain the previous snapshot, so builder updates and packaging remain available during upstream outages. See [snapshot storage and synchronization](docs/upstream-snapshots.md). Titles use **PokéBonk 0.8.34 · Offline 0.0.1**; tags also retain the exact upstream build. A published matching identity skips packaging when its packaged-source digest is unchanged, so documentation-only commits do not create new binaries. Changed packaged source requires an offline version bump. Every new identity builds all platforms and publishes as **Latest** only after verification. Pull requests never receive signing secrets or publish Releases. See [release versioning and the Changesets workflow](docs/release-versioning.md).

The separate sync collector follows the game module/CSS graph and current catalogs; ordinary preparation uses only the committed snapshot. Semantic patching fails on incompatible upstream structures. Payload manifests verify each bundled file's SHA-256 and length. Status badges are collected from the real status-effect catalog as mandatory images. Runtime checks decode every status icon and display an afflicted boss, alongside complete local resource access, all unlock categories, persisted saves, and eight maps plus the Halloween tower, including Canela, Cave, Encina and Iris. These are representative checks rather than exhaustive coverage of every event or physical device.

Electron serves only the bundled custom origin with Node integration disabled, context isolation and sandboxing enabled, and runtime HTTP/HTTPS/WebSocket requests blocked. Android serves bundled assets through a local HTTPS WebView origin and requests no `INTERNET` permission. These follow the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and Android's [local-content model](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content).

Android signing passwords remain in GitHub Actions secrets. `android/signing-certificate.sha256` pins the public certificate fingerprint so a different signing key fails publication. Every new-format Release contains four desktop archives, one signed APK, checksums, and `release-info.json` with upstream/offline versions, source commit, source digest, and edition. An incomplete draft can be resumed; it is never treated as a completed update.

## Attribution

Builder code uses the included AGPL-3.0 license. PokéBonk's game code and assets are stored as a pristine, versioned snapshot, retain their original rights, and are not covered by the builder license. The upstream legal page and original credits remain included; see [vendored upstream notices](vendor/README.md).

Credit goes to Charcher and the original contributors. Pokémon names and assets belong to their respective owners; the game's credits and legal page remain included. This is an unofficial, noncommercial personal build with no affiliation or endorsement.

Local manual saves and autosave recovery preserve the game simulation across
native process restarts. See [local run recovery](docs/local-run-recovery.md)
for settlement, interruption handling and the cloud capability boundary.
