# EPIC-104: Clipboard tracker

## Status

**Status:** Active
**Created:** 2026-09-17

## Overview

An opt-in clipboard history. While enabled, Persephone records every OS clipboard change — text,
HTML, images, and Windows file lists — keeps the most recent 100, and stores each one as a real
file in the app data folder. A **Clipboard** panel in the Explorer sidebar family lists them
newest-first; selecting an item opens its file in whichever editor already claims that extension,
and a per-item **Copy** action puts it back on the clipboard.

Disabled by default. When off, nothing is watched, nothing is written, and the panel's header icon
is not rendered at all.

## What already exists

The hard part — watching a Windows clipboard from Electron — is mostly built. Four facts, each
verified against the source:

- **A Win32 clipboard helper already ships.** `snip-tool/src/clipboard.rs` opens the clipboard,
  reads `CF_HDROP`, and writes it back, behind the `clipboard-read` / `clipboard-write` subcommands
  of `persephone-snip.exe`. `snip-tool/Cargo.toml` already enables every `windows-sys` feature a
  clipboard listener needs: `Win32_System_DataExchange`, `Win32_UI_WindowsAndMessaging`,
  `Win32_Foundation`, `Win32_System_Memory`.
- **The exe is already packaged and already built.** `electron-builder.yml:31` copies
  `snip-tool/target/release/persephone-snip.exe` beside `persephone.exe`; `getSnipToolPath()`
  (`src/main/snip-service.ts`) resolves packaged vs. dev. A second crate would add a build step, a
  packaging entry, and another binary to sign, for code that belongs next to `clipboard.rs`.
- **Sidecar lifecycle is a solved problem.** `SidecarProcess` (`src/main/sidecar-process.ts`) owns
  start dedupe, the readiness timeout, the stale-child guard, unexpected-death notification, and
  stop-and-wait before restart. `mneme-service.ts` is the model to copy.
- **The Explorer sidebar is already a composed panel family.**
  `ExplorerEditor.composeSecondaryView()` builds `["explorer", ("search"), ("boards")]` in display
  order, and `boardsOpen` is persisted in editor state precisely so the panel survives a restart. A
  fourth member is an established move, not a new mechanism.

Electron's own `clipboard` API cannot read `CF_HDROP` at all — which is why `clip-service.ts`
exists — so routing capture through the helper is what makes file-list history possible.

## Goals

- A `clipboard-watch` subcommand on the existing helper reports every clipboard change as it
  happens, with no polling and no new dependency in either `Cargo.toml` or `package.json`.
- The watcher runs only while the setting is on, starts and stops when the setting is toggled (no
  app restart), and its death is visible rather than silent.
- Each change becomes one history item, stored as a file with a truthful extension, capped at a
  user-configurable number of items (default 100) with the oldest evicted.
- The user can clear the whole history or remove a single item, and is warned in Settings that
  captured content sits on disk in readable form.
- While the panel is open, a wedged listener is detected and can be restarted from the panel.
- Content an application marked as excluded from clipboard history is never captured — not as a
  file, not as an entry.
- The **Clipboard** panel lists items newest-first with a timestamp and a preview, opens an item's
  file in its normal editor, and copies an item back to the clipboard.
- Re-copying an existing item leaves exactly one entry for it, at the top.
- With the setting off, the feature is fully absent from the UI, including the header icon.

## Decisions

**D1 — A subcommand, not a new crate.** `clipboard-watch` joins `clipboard-read` and
`clipboard-write` in `snip-tool`. The dispatch in `main.rs` already branches on the first argument,
and the Win32 features are already enabled. The one behavioural departure: this subcommand is
long-lived and must be invisible — a message-only (`HWND_MESSAGE`) window plus `windowsHide: true`
on spawn, unlike the snip path, which deliberately shows UI.

**D2 — Event-driven, not polled.** `AddClipboardFormatListener` + `WM_CLIPBOARDUPDATE`. Polling
`clipboard.readText()` on a timer calls `OpenClipboard` forever, which is the classic cause of
*other* applications' copies failing intermittently, and it cannot detect an image change without
decoding the whole bitmap every tick. Polling `GetClipboardSequenceNumber` avoids both problems but
still burns a timer for something Windows will simply tell us.

**D3 — The watcher notifies; the main process captures.** The subcommand emits one JSON line per
change (sequence number, timestamp, available formats, exclusion flags) and reads no payload apart
from the file list it uniquely can read. Hashing, dedup, the data-folder layout, and the 100-item
cap live in TypeScript beside `app.fs` and the settings, where they are far easier to change than
in Rust.

**D4 — Persephone's own copies are tracked, by explicit user decision.** No self-echo suppression.
"Copy board path", grid copies, and the panel's own Copy action all produce history entries like
any other source. This is the point of the feature, not a leak in it.

**D5 — Re-copying promotes rather than duplicates.** When incoming content hashes equal to an
existing item, that item is removed from its position and the new capture is inserted at the top.
This is the user-requested behaviour for the panel's Copy action, and it subsumes a second problem
for free: one Ctrl+C can raise several `WM_CLIPBOARDUPDATE` messages as the source app fills
formats in stages, and under this rule the repeats collapse into the single top entry instead of
needing their own suppression window.

**D6 — Excluded content is skipped whole.** Password managers set
`ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory` exactly so that
history tools ignore the copy. Persephone honours both: no file written, no entry, no preview text.
A tracker that writes a vault password into the data folder as plain `.txt` is the version of this
feature that gets uninstalled.

**D7 — One item per clipboard change, with flavours.** An HTML copy almost always carries a plain
text flavour too. These are one item — a primary flavour that determines the stored extension and
what opens on selection, plus optional siblings — rather than two rows for one Ctrl+C.

**D8 — Files with real extensions; no new editor.** `.txt`, `.html`, `.png`, and `.files.txt` for
file lists. Selecting an item hands the payload path to the ordinary content pipeline and the
existing extension routing does the rest. The panel is a list, not a viewer.

A file list is stored as one absolute path per line, not as the watcher's `{ paths, dropEffect }`
JSON — selecting it should show a readable list, and the JSON blob was the first thing a user saw
and asked about (user report, 2026-09-17). The `dropEffect` moved to the index item, which is the
only consumer that needs it (copy-back). The double suffix is deliberate: a copy can carry both a
file list and text, and a bare `.txt` would make the two payloads of one item collide on a single
file name. Payloads written as `.json` by earlier builds are still read.

Selection **navigates the host page** rather than opening a new one — `openRawLink` with the
panel's own `pageId`, the same route `ExplorerEditor.openSearchResult` uses. The first
implementation called `app.pages.openFile(path)`, which opens a page per item and turns browsing
the history into tab cleanup (user report, 2026-09-17). `openFile` remains the fallback when the
panel has no page host to navigate.

**D9 — The panel joins the Explorer family.** A fourth id in `composeSecondaryView()`, with its
open state persisted the way `boardsOpen` is. The header icon follows the setting live: while
`clipboard.enabled` is off the button is not created, and toggling the setting updates the header
without a restart — the same conditional-append shape `ExplorerSecondaryView` already uses for the
Boards button.

**D10 — No encryption; a warning label and real delete actions instead.** The history is stored in
plain, openable files, because a key stored beside the data would buy reassurance rather than
protection. What the user gets instead is honesty and control: a static `warning`-tone
`NotificationView` in the Settings section stating that occasionally-copied secrets may remain on
disk in readable form, a **Clear** action in the panel header, and a **Remove** context-menu item
per row. `NotificationView` with `type: "warning"` and no `onClose` already renders exactly this
inline banner, on `color.warning.*` tokens — no new component, no new token.

**D11 — The cap is a setting.** `clipboard.max-items`, default 100. A value that is not a positive
number falls back to 100 rather than erroring, matching the settings file's "deleting a key
restores its default" contract. Lowering the cap evicts immediately, so setting 20 trims to 20
rather than waiting for 80 more copies. A byte ceiling is deliberately not added: item count is
what the user asked to control, and a second implicit limit that silently discards a screenshot
they can see in the list would be worse than a large folder.

**D12 — The health check proves the listener is *hearing*, not merely alive.** Process death is
already covered — `SidecarProcess.onUnexpectedExit` fires and the renderer toasts — so a ping that
only answers "still running" would add nothing. The failure this is actually for is the
live-but-deaf listener: the process is up but its message loop is wedged or its format listener was
torn down, and clipboard changes are silently missed. So the pong carries evidence. The watcher
answers with two numbers: `GetClipboardSequenceNumber()` read at that moment (a cheap call that
does not open the clipboard) and the sequence number of the last change it actually emitted. If the
OS number is ahead of the delivered number, the listener is deaf even though the process is alive,
and the panel shows an error badge with **Restart** — `SidecarProcess` already supports
stop-and-wait-then-start.

Mechanically this needs a second thread in the watcher reading stdin line-by-line, because the main
thread is parked in `GetMessage`. Rust's `stdout` handle is internally mutex-guarded, so both
threads can write lines safely. Pinging runs only while the Clipboard panel is open, per the user's
request — there is nothing to notice a gap for when nobody is looking.

**D13 — The agent can read the history, discovered through the object model rather than a static
string.** "I copied something, take a look" should work, so clipboard history joins the ai-vision
object model as its own namespace (`src/renderer/scripting/ai-vision/namespaces/`), where
`recent.ts` is the closest shape: a capped, persisted list with read and mutate members. That node
is built per call, so it appears exactly while `clipboard.enabled` is on and vanishes when it is
off — no stale advertisement of a feature that is not running.

`SERVER_INSTRUCTIONS` (`src/main/mcp/manifest.ts:18-31`) also gains a line, but it is secondary and
deliberately so: it is a static const joined at module load and sent once at `initialize`, so a
client that connected before the setting was turned on never sees it, and one that connected while
it was on keeps seeing it after it is turned off. It is a hint for discovery, not the contract. The
namespace is the contract.

This widens D10 rather than adding a new risk: an agent gains read access to everything in the
history. D6 is what keeps that bounded — content an application marked excluded never entered the
store, so it cannot be read back here either.

**D14 — Persephone's own clipboard writes use Electron's native clipboard, never the Web API.**
D4 says Persephone's copies are tracked, but they were not, and the tracker was not at fault:
Chromium stamps every `navigator.clipboard.write*` call with the registered
`CanIncludeInClipboardHistory` format set to `0` — "do not put this in clipboard history" — and D6
honours it. Measured against the built watcher, the same content copied two ways:

| write path | formats reported | `CanIncludeInClipboardHistory` | captured |
|---|---|---|---|
| `navigator.clipboard.write` | `PNG`, `CF_DIBV5`, `CF_BITMAP`, `CF_DIB`, **49711** | present, value `0` | no |
| `clipboard.writeImage` (Electron) | `PNG`, `CF_DIBV5`, `CF_BITMAP`, `CF_DIB` | absent | yes |

So the fix belongs at the write, not at the capture — weakening D6 to special-case the flag would
also un-honour it for the password managers it exists for, and origin-sniffing is exactly the
machinery D4 forbids. Electron's native write is additionally synchronous and needs no document
focus, which removes a real failure mode: `navigator.clipboard.writeText` throws
`Document is not focused` when the window is not focused, so some copies were already failing
silently before the tracker existed.

`toClipboard` (`src/renderer/core/utils/utils.ts`) and `copyPngBlobToClipboard`
(`src/renderer/editors/shared/image-export.ts`) are converted; US-1444 sweeps the remaining direct
`navigator.clipboard.*` call sites onto them.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1438 | `clipboard-watch` subcommand in persephone-snip (listener + ping/pong) | Planned |
| US-1439 | Main-process clipboard capture service, store and IPC | Planned |
| US-1440 | Clipboard settings — enable toggle, item cap, on-disk warning | Planned |
| US-1441 | Clipboard sidebar panel — list, Copy, Remove, Clear, health badge | Planned |
| US-1443 | Agent access — ai-vision clipboard namespace and MCP instruction line | Planned |
| US-1444 | Route Persephone's own clipboard writes through Electron's native clipboard | Planned |

Suggested order: US-1440 first (the setting gates everything), then US-1438 and US-1439 together
(neither is testable without the other), then US-1441 and US-1443, which both build on US-1439's
store and IPC.

## Concerns

All four open questions from the first draft were settled by the user on 2026-09-17; each is now a
decision above. What remains are the risks to keep in view during implementation.

- **Secrets at rest** (→ D6, D10). Accepted, unencrypted, with disclosure and delete actions. The
  residual risk is real and deliberate: anything copied while the tracker is on, and not marked
  excluded by its source application, is readable on disk until evicted or cleared.
- **Disk growth** (→ D11). Bounded by item count only. A user who sets 100 and copies 100
  screenshots gets a large folder, by their own instruction.
- **Watcher health** (→ D12). Covered for death (toast) and for wedged-while-open (badge +
  Restart). Not covered: a listener that goes deaf while the panel is *closed*, which is
  undetectable without the polling this epic exists to avoid. Acceptable — the cost is missed
  history, not lost data.
- **Windows only.** `AddClipboardFormatListener` has no cross-platform equivalent here. Confirmed
  by the user as consistent with the product: Windows is the only planned platform.
- **Dev builds need the exe.** As with the existing file-clipboard features, a dev checkout needs
  `cargo build --release` in `snip-tool/` before the tracker does anything. The service must degrade
  quietly when the exe is missing, the way `clip-service.ts` does.

## Notes

### 2026-09-17

- Epic created from the user's feature proposal.
- User decisions taken during design: Persephone's own copies are tracked rather than filtered
  (D4); excluded/password content is skipped (D6); re-copy promotes to the top (D5); the header
  icon is hidden entirely while the setting is off (D9).
- All four open questions closed the same day: no encryption but a warning label plus Clear and
  per-item Remove (D10); the 100-item cap becomes a setting with a default fallback (D11); listener
  health gets a ping/pong with a restart affordance (D12); Windows-only confirmed, and the dev-build
  `cargo build --release` prerequisite accepted.
