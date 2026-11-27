# US-2239: Linux docs

## Goal

Make the shipped guides and repository README accurate and useful for Windows and Linux users of [EPIC-216](../../epics/EPIC-216.md). This is a documentation plan; implementation and publishing are separate steps.

## Background

The canonical in-app guides are `assets/guides/`. The inventory's [Guide references](../../reviews/multiplatform-2026-11/inventory.md#guide-references-list-only) identifies Windows-specific passages; [roadmap §3](../../reviews/multiplatform-roadmap.md#3-feature-parity-target) identifies features not offered on Linux. EPIC-216's later format decision supersedes its older AppImage descriptions: Linux ships **only** `persephone-<version>-linux-amd64.deb` for x86_64 from GitHub Releases, with no AppImage, Flatpak, Snap or apt repository. Ubuntu 26.04 LTS GNOME is supported; Debian 13 was install-checked; other distributions are untested.

Install with `sudo apt install ./persephone-<version>-linux-amd64.deb` (apt resolves dependencies); double-clicking may open Software. The package installs to `/opt/persephone`, adds a Persephone launcher and Open With for text files and folders. `sudo apt remove persephone` leaves settings under `~/.config/persephone`. It installs `/etc/apparmor.d/persephone` so Chromium's sandbox works. Browser cookies and passwords are encrypted with GNOME Keyring: a normal password login opens it with the session; automatic login may prompt once to create a “Default Keyring”. Without a keyring Chromium falls back to a fixed key, with weaker at-rest protection. Widevine works at L3 without VMP; services requiring VMP or a higher security level may refuse playback.

[US-2237](../US-2237-update-notice-per-platform/README.md) is implemented. `AboutEditorView.renderUpdateStatus()` in `src/renderer/editors/about/AboutView.ts` opens `downloadUrl ?? releaseUrl` and labels the action Download or Open release page. `selectUpdateAssetUrl()` in `src/shared/update-asset-policy.ts` selects Windows setup or Linux `.deb` for the shipped formats. An AppImage branch remains in code, but is not a shipped format. No platform has an auto-updater. `releaseUrl` stays the release page; nullable `downloadUrl` is the selected asset. Automatic checks exclude named profiles; the About check also refreshes the board catalog.

## Implementation Plan

- [x] Update `assets/guides/getting-started.md`: preserve Windows installer, ZIP and options; add Linux install, uninstall, support and launcher/Open With details from Background, including AppArmor and the absence of other formats. Provide Linux `/opt/persephone/persephone` command examples alongside the existing Windows commands, including named profiles and quoted custom profile directory; distinguish platform-specific default data paths and the shared OS clipboard. In First Launch mention the keyring prompt and link to the browser details. Correct the settings-file location, and qualify close-to-tray by tray availability. In **Checking for Updates**, say checks notify but do not install; Download opens the Windows setup `.exe` or Linux `.deb`, while Open release page is the fallback when no matching asset exists. Keep named-profile and board-catalog distinctions.
- [x] In `assets/guides/editors/browser/network-and-agent.md`, explicitly state Windows single sign-on is unavailable on Linux; explain GNOME Keyring and the fixed-key fallback, Widevine L3 without VMP and possible playback refusals, and that Linux downloads lack Windows Mark-of-the-Web. Link these notes from `assets/guides/editors/browser/index.md` near its Downloads/browser overview so users can find them; keep the hub concise. The three roadmap §3 not-offered features are discoverable here for SSO and Mark-of-the-Web and in `assets/guides/agents/web-app-tests/run-options.md` and `assets/guides/agents/web-app-tests/unattended-runs.md` for `--desktop` (already explicitly Windows-only).
- [x] In `assets/guides/scripting/api/shell.md`, add `downloadUrl: string | null` to `IUpdateInfo` as the platform installer asset, nullable when unavailable; retain `releaseUrl` as the release page and explain fallback without implying automatic installation. In `assets/guides/screens/index.md`, change the Windows-only introduction to Windows and Linux and label `about-update-download` as **Download / Open release page**. `assets/guides/boards/published-boards.md` already correctly describes the shared About check; retain it.
- [x] Update each inventory page as follows, using default-profile paths as examples and saying named/custom profiles or XDG configuration may change the data root:

  | Guide path under `assets/guides/` | Action |
  |---|---|
  | `agent-tools.md` | Add Linux `~/.config/persephone/data/trustedTools.txt` beside Windows; say the toolset runs with the current OS user's privileges and label the Windows path example. |
  | `mneme.md` | Name GNOME Files alongside Windows Explorer for drag import. |
  | `shortcuts.md` | Replace Windows-only clipboard/file-manager wording in File Explorer shortcuts with Windows/Linux wording; retain Ctrl bindings and actual selection restrictions. |
  | `tabs-and-navigation/file-explorer-and-panels.md` | Describe Default App as the OS default, not Windows only; retain existing Linux terminal, clipboard and drag details. |
  | `tabs-and-navigation/index.md` | Change Windows Explorer descriptions of Show in File Explorer / Git root to the system file manager, preserving visible action labels. |
  | `tabs-and-navigation/menu-bar.md` | Remove both incorrect Windows-only terminal claims; describe Windows Explorer and GNOME Files drag/drop consistently with the detailed explorer guide. Keep its explicit Linux clipboard-history limitation. |
  | `editors/folder.md` | Include GNOME Files for inbound/outbound drag examples. |
  | `editors/browser/network-and-agent.md` | Add browser security, DRM, downloads and SSO notes as above. |
  | `screens/settings.md` | Add concise Linux equivalents for language packs, board settings, application settings and MCP settings paths; keep the existing Linux desktop link and availability notes. This page is near the limit: shorten existing repetitive prose or move topic detail to the relevant existing guide if required, preserving headings and links. |
  | `screens/sidebar.md` | Linux clipboard history is already explicitly unavailable; retain that accurate explanation. |
  | `agents/audio.md` | Existing capture and Linux cancellation limitations are accurate; no change. |
  | `agents/scripting/the-app-object.md` | Add Linux default `~/.config/persephone/data/appSettings.json` next to the Windows path. |
  | `agents/web-app-tests/run-options.md` | Add installed Linux command `/opt/persephone/persephone --test ./web-tests --profile qa --log-dir ./web-test-logs` and Linux init form `/opt/persephone/persephone --test --init ./web-tests`; identify Windows console wrapper as Windows-only, retaining existing `--desktop` limitation. |
  | `agents/web-app-tests/unattended-runs.md` | Keep Windows-only workspace placement, Windows commands and Linux visibility limitations; identify its Windows clipboard test as platform-specific. |
  | `scripting/api/app.md` | Label Windows path examples and add a representative POSIX file/board path; preserve already-correct Linux Tor PATH note. |
  | `boards/board-ui.md` | Add Linux default `~/.config/persephone/data/board-settings.json`. |
  | `boards/bridge.md` | Add Linux default board data `~/.config/persephone/board-data/<id>` and log `~/.config/persephone/board-logs/<id>/ui.log`; preserve Windows legacy fallback as Windows-specific and encourage the provided data path. |
  | `boards/getting-started.md` | Add Linux board log path and label Windows script examples or add POSIX examples; retain existing Linux launcher details. |
  | `boards/trust-and-permissions.md` | Add Linux default `~/.config/persephone/data/trustedBoards.json` alongside Windows. |
  | `mcp-setup/available-tools.md` | Existing session and Linux workspace-visibility limitations are accurate; retain them. MCP settings-file path is addressed in `screens/settings.md`. |
  | `whats-new.md` | Add a current release entry for Linux `.deb` availability, support, security/DRM limits and update notice; leave historical Windows release notes intact. |

- [x] Update repository `README.md`: replace “notepad for Windows” with “notepad for Windows and Linux”; retain Windows installer/portable links and add the GitHub Releases Linux x86_64 `.deb`, supported and checked distributions, concise install command and guide link. Do not claim a Linux portable package or automatic updates.
- [x] Preserve valid quoted front matter, page headings/anchors and relative links. Check changed pages via `guides.search` for the new topics. `npm run guides:check` enforces 20,000 characters per page after front matter, and 10,000 for registered split hubs; `whats-new.md` is exempt as a changelog. Current sizes below are JavaScript UTF-16 character counts including original line endings, measured after front matter (not bytes). Limit growth of the two near-limit hubs and Settings. If a split is necessary, follow `doc/standards/guide-structure.md`, including Read next, anchors, links and consumers.

  | Page under `assets/guides/` | Current characters |
  |---|---:|
  | `getting-started.md` | 9,624 |
  | `agent-tools.md` | 12,625 |
  | `mneme.md` | 12,987 |
  | `shortcuts.md` | 10,765 |
  | `tabs-and-navigation/file-explorer-and-panels.md` | 14,859 |
  | `tabs-and-navigation/index.md` (hub) | 9,618 |
  | `tabs-and-navigation/menu-bar.md` | 9,433 |
  | `editors/folder.md` | 4,467 |
  | `editors/browser/index.md` (hub) | 9,472 |
  | `editors/browser/network-and-agent.md` | 7,930 |
  | `screens/settings.md` | 19,565 |
  | `agents/scripting/the-app-object.md` | 15,035 |
  | `agents/web-app-tests/run-options.md` | 7,530 |
  | `agents/web-app-tests/unattended-runs.md` | 6,112 |
  | `scripting/api/app.md` | 12,702 |
  | `boards/board-ui.md` | 9,164 |
  | `boards/bridge.md` | 12,263 |
  | `boards/getting-started.md` | 11,178 |
  | `boards/trust-and-permissions.md` | 8,322 |
  | `whats-new.md` (exempt) | 54,989 |
  | `scripting/api/shell.md` | 2,596 |
  | `screens/index.md` | 14,227 |

- [ ] Claude runs `npm run guides:check` after guide edits and `npm run i18n:check` if catalog messages change: Codex cannot run these here (EPERM). No new UI text is expected. Guides and What's New remain English under `doc/standards/localization.md`. If implementation unexpectedly adds UI copy, list its exact English catalog keys and text in this task, then translate changed messages into every built-in pack at epic close with current source hashes; Claude runs the i18n check. Epic review/document/userdoc are deferred to epic completion.

### Representative before → after

In `assets/guides/tabs-and-navigation/menu-bar.md`:

```md
Before: **Open Terminal here** (Windows only — see ...)
After:  **Open Terminal here** (Windows and Linux — see ...)
```

In `assets/guides/scripting/api/shell.md`'s `IUpdateInfo` table:

```md
Before: | `releaseUrl` | `string \| null` | URL to the release page. |
After:  | `releaseUrl` | `string \| null` | URL to the release page. |
        | `downloadUrl` | `string \| null` | Platform installer asset URL, or null when unavailable. |
```

### Site (Claude, with the user)

The site is a separate repository and outside Codex's scope. Claude, with the user, should change Windows-only product and download wording to Windows and Linux, retain Windows installer and ZIP, add Linux x86_64 `.deb` from GitHub Releases and the Ubuntu 26.04 GNOME / Debian 13 support distinction, link the install guide, and avoid claiming AppImage, Flatpak, Snap or an auto-updater. Mention Linux Widevine limits wherever DRM support is advertised. Review the actual wording with the user before publishing; do not publish as part of this task plan.

## Concerns

- EPIC-216 retains stale AppImage claims in its overview, goals, task table, target decision and run-1 note; the later narrowed format decision and verified facts above govern this task. Claude maintains the epic and dashboard.
- Roadmap §3 describes a limited Linux clipboard history target, but shipped Settings, sidebar and menu guides explicitly say it is unavailable. Preserve the shipped documentation; do not promise the target behavior.
- Settings has only 435 characters of page headroom, and the two affected hubs have 382 and 528 characters respectively. Make concise replacements and verify the actual final counts; splitting requires the guide-structure workflow.
- No open product decision is needed for this plan. No live VM checks or release publication are part of Codex's work.

## Acceptance Criteria

- [x] Windows and Linux installation, package scope, support, uninstall, launcher, settings retention and AppArmor are accurate and easy to find.
- [x] The browser guide explains keyring behavior, fallback protection, Linux Widevine limits, unavailable Windows SSO and absent Mark-of-the-Web; test-runner guides state `--desktop` is unavailable on Linux.
- [x] Every inventory page is handled as specified, with Windows examples qualified and Linux alternatives where useful; historical notes remain historical.
- [x] Both update guides describe the shipped asset selection, nullable `downloadUrl`, release-page fallback and no auto-updater; About selector and board catalog description remain accurate.
- [x] README and What's New describe Linux; site wording is handed to Claude and the user without site changes or publication by Codex.
- [ ] Claude's `npm run guides:check` passes, guide search finds added topics, links and anchors remain valid, and localization follows the stated conditional workflow.

## Files Changed

| Path | Planned change |
|---|---|
| `doc/tasks/US-2239-linux-docs/README.md` | This task plan. |
| `assets/guides/getting-started.md`, `assets/guides/editors/browser/index.md`, `assets/guides/editors/browser/network-and-agent.md`, `assets/guides/scripting/api/shell.md`, `assets/guides/screens/index.md`, `assets/guides/whats-new.md` | Install, platform security, update behavior, UI reference and release entry. |
| `assets/guides/agent-tools.md`, `assets/guides/mneme.md`, `assets/guides/shortcuts.md`, `assets/guides/tabs-and-navigation/file-explorer-and-panels.md`, `assets/guides/tabs-and-navigation/index.md`, `assets/guides/tabs-and-navigation/menu-bar.md`, `assets/guides/editors/folder.md`, `assets/guides/screens/settings.md` | Platform-aware paths, file manager and terminal wording. |
| `assets/guides/agents/scripting/the-app-object.md`, `assets/guides/agents/web-app-tests/run-options.md`, `assets/guides/agents/web-app-tests/unattended-runs.md`, `assets/guides/scripting/api/app.md`, `assets/guides/boards/board-ui.md`, `assets/guides/boards/bridge.md`, `assets/guides/boards/getting-started.md`, `assets/guides/boards/trust-and-permissions.md` | Linux paths and command examples, with platform limits. |
| `README.md` | Windows and Linux introduction and download instructions. |

**No changes needed:** `assets/guides/screens/sidebar.md`, `assets/guides/agents/audio.md`, `assets/guides/mcp-setup/available-tools.md`, `assets/guides/boards/published-boards.md`, `src/renderer/editors/about/AboutView.ts`, `src/shared/update-asset-policy.ts`, `doc/active-work.md`, `doc/epics/EPIC-216.md`, and the separate site repository. No UI catalog or language pack changes are expected.
