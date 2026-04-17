# US-425: Fix infinite-loop when Persephone is the OS default browser

## Goal

When Persephone is registered as the Windows default browser and the user opens any external link (from Outlook, Teams, VSCode, Explorer, etc.), the link must open in Persephone's internal browser instead of triggering an infinite `shell.openExternal` loop that steals focus system-wide and makes Persephone unresponsive to link clicks.

## Symptoms observed

On a VM where Persephone was registered as the default browser:

1. **Links never open.** Clicking a link in any external app does nothing visible, but Persephone's window cursor (I-beam/arrow) flickers as you hover.
2. **System-wide focus stealing.** After a few seconds, focus is stolen constantly — the mouse cursor blinks over Explorer, VSCode, and every other window. You cannot keep focus on any window.
3. **Quit → auto-restart.** Quitting Persephone from the tray menu closes it, then a new instance starts by itself ~1 second later.
4. **Old `js-notepad` (the pre-rebrand name) did not have this problem** on the same VM. `js-notepad` had no Rust launcher; Windows invoked `js-notepad.exe` directly, and the `eOpenExternalUrl` path was simpler (it didn't route through the content pipeline).

## Root cause: infinite loop

With Persephone set as default browser, the URL-open pipeline forms a cycle:

1. User clicks a link somewhere → Windows invokes the registered handler:
   `C:\...\install\persephone\persephone-launcher.exe <url>`
2. Launcher (`launcher/src/main.rs`) connects to the Named Pipe `\\.\pipe\persephone-<username>` and writes `OPEN <url>\nEND\n`.
3. Pipe server (`src/main/pipe-server.ts:26-30`) calls `openWindows.bringToFront()` and `openWindows.handleOpenUrl(url)`.
4. `open-windows.ts:124-130` sends `eOpenExternalUrl` IPC to the renderer and calls `mainWin.focus()`.
5. In the renderer, `RendererEventsService.handleExternalUrl` fires `openRawLink.sendAsync(createLinkData(url))`.
6. Layer-1 HTTP parser (`parsers.ts:49-55`) forwards to `openLink`.
7. Layer-2 HTTP resolver (`resolvers.ts:147-243`):
   - URL has no recognized file extension → falls into the **browser branch**.
   - `data.browserMode` is undefined.
   - `data.target` is undefined.
   - Falls to the setting-based fallback at `resolvers.ts:228-239`.
   - Setting `link-open-behavior` defaults to `"default-browser"` (`settings.ts:88`).
   - Executes `shell.openExternal(data.url)`.
8. `shell.openExternal` asks Windows to open the URL with the OS default browser — **which is Persephone**. Go to step 1.

The loop runs every time `shell.openExternal` returns control, which is very fast. Each iteration calls `mainWin.focus()`, so Windows sees a rapid stream of focus-steal attempts — that is why the cursor flickers over every window, not just Persephone.

The "Quit → auto-restart" symptom is the same loop seen at teardown: when the first Persephone instance exits, there is typically a launcher invocation already in flight that finds the pipe gone and falls through to `spawn_electron()` in `launcher/src/main.rs:107-123` — producing a fresh instance.

### Why old `js-notepad` did not loop

Before the rebrand and the content-pipeline refactor (EPIC-012 / EPIC-023), the external-URL IPC path opened URLs directly in an internal browser editor without ever calling `shell.openExternal`. The cycle did not exist.

## Implementation plan

### Primary fix (required)

**File:** `src/renderer/api/internal/RendererEventsService.ts`

In `handleExternalUrl` (line 83-90), pass `{ browserMode: "internal" }` to `createLinkData` so the HTTP resolver routes the URL to Persephone's internal browser tab instead of calling `shell.openExternal`.

**Current (line 86):**
```ts
await app.events.openRawLink.sendAsync(createLinkData(url));
```

**Fixed:**
```ts
await app.events.openRawLink.sendAsync(
    createLinkData(url, { browserMode: "internal" })
);
```

### Why this is correct

- The HTTP resolver checks recognized file extensions *before* the browser branch (`resolvers.ts:163`). URLs like `https://host/file.pdf`, `.../data.json`, `.../image.png` continue to open as typed content (PDF viewer, Monaco, image viewer, etc.). `browserMode` is ignored on that path.
- For extension-less URLs (`https://example.com`), the resolver enters the browser branch. With `browserMode === "internal"`, it calls `pagesModel.lifecycle.openUrlInBrowserTab(data.url, { profileName: "" })` (`resolvers.ts:224-226`) — opens a browser tab inside Persephone. No `shell.openExternal`, no loop.
- This is scoped to URLs arriving from the OS (pipe / `second-instance` event). URLs clicked inside Persephone (Monaco links, markdown, Links panel, etc.) still honor the user's `link-open-behavior` setting.
- `handleOpenUrl` (the sibling method at line 75-81) is used for `window.open()` and in-app URL requests and must **not** be changed — those URLs should follow the user's preference.

### Secondary fix (optional)

**File:** `src/main/browser-registration.ts`

The `regAdd` helper writes the data value through `cmd.exe` with nested quotes. When `data` contains quotes (e.g. `"C:\...\launcher.exe" "%1"`), CMD strips the inner quotes. The value stored in the registry is unquoted, which would break for paths with spaces.

Replace `execSync` + shell with `execFileSync` + argv array, bypassing the shell entirely. Apply to `regAdd`, `regDelete`, `regDeleteValue`, and `regQuery`.

After this change, the user must re-register Persephone as default browser once so the new quoted values replace the old unquoted ones.

## Files changed

| File | Change |
| --- | --- |
| `src/renderer/api/internal/RendererEventsService.ts` | `handleExternalUrl` — pass `{ browserMode: "internal" }` to `createLinkData`. Primary fix. |
| `src/main/browser-registration.ts` | `regAdd` / `regDelete` / `regDeleteValue` / `regQuery` — switch to `execFileSync` with argv array. Secondary fix. Optional but recommended. |

## Acceptance criteria

1. With Persephone registered as default browser and running, clicking a plain URL (e.g. `https://example.com`) from an external app opens the URL in a new browser tab inside Persephone. No focus flicker system-wide.
2. Clicking a URL with a typed extension (e.g. `https://host/report.pdf`, `https://host/data.json`) still opens in the typed editor (PDF viewer, Monaco).
3. In-app link clicks in Monaco / markdown still honor the `link-open-behavior` setting (`default-browser` uses OS default; `internal-browser` opens in Persephone's browser tab).
4. Quitting Persephone from the tray menu fully exits the process — no auto-restart.
5. After re-registering as default browser, the registry value at `HKCU\SOFTWARE\Classes\PersephoneURL\shell\open\command` includes quotes around both the launcher path and `%1`. (Verifies secondary fix.)

## Test plan

Manual on a Windows VM where Persephone is set as default browser:

1. Confirm the loop exists **before** the fix: with Persephone running, click any `https://` link in VSCode or Explorer's address bar. Expect cursor flicker and no tab opening. (Skip this if reproducing would disrupt the VM.)
2. Apply the primary fix, rebuild, restart Persephone.
3. Repeat step 1. Expect a new browser tab inside Persephone with the target URL loaded, and no focus flicker.
4. Click a URL pointing to a `.pdf` or `.json` file; expect the typed editor.
5. In Persephone's Settings, set `link-open-behavior` to `default-browser`, click a URL *inside* a Monaco document → expect OS default browser (which is Persephone → opens internal tab via the fixed `handleExternalUrl`). Set it to `internal-browser`, click the same link → expect internal browser tab directly.
6. Open tray → Quit. Verify Persephone exits and does not auto-restart.
7. (Secondary fix) Unregister and re-register as default browser. Run `Get-Item HKCU:\SOFTWARE\Classes\PersephoneURL\shell\open\command | % { $_.GetValue('') }` in PowerShell — the value must contain both `"` around the launcher path and `"%1"`.
