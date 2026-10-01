# US-1592: Mark-of-the-Web on browser downloads

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F6 · **Medium**

## Goal

A file downloaded from Persephone's browser carries the Windows Mark-of-the-Web: a
`Zone.Identifier` alternate data stream with `ZoneId=3`, like Chrome and Firefox write. This brings
back the SmartScreen prompt for downloaded executables, Protected View for Office documents, and the
"blocked" flag on downloaded archives.

## Background

### Electron does not write the mark (verified live 2026-10-01)

The test was a standalone Electron 43 main script using this repo's `node_modules/electron`. It
downloaded through `will-download` → `item.setSavePath(...)`, the same API sequence
`download-service.ts` uses, in two cases:

| Source | Session | `Zone.Identifier` |
|---|---|---|
| `http://127.0.0.1` (`<a download>` click, `.exe` and `.txt`) | default | None |
| `https://raw.githubusercontent.com/...` (`webContents.downloadURL`) | default | None |

Chrome writes the mark from its `chrome/` quarantine layer (`IAttachmentExecute::Save`), which
Electron does not include. Nothing in `src/` writes the stream today: there are no `Zone.Identifier`
or `ZoneId` references.

### The download path

`src/main/download-service.ts`:

- **`hookSession`** (`:44-51`): `will-download` on every session, through `app.on("session-created")`, which covers the default session and every browser profile, Tor and incognito partition. It calls `handleWillDownload`.
- **`handleWillDownload`** (`:112-138`):
  - Downloads claimed by a board through a browser URL mask are cancelled and handed to the board. They never reach the disk through this service.
  - Every other download goes to `handleOrdinaryDownload`.
- **`handleOrdinaryDownload`** (`:150-238`):
  - It always shows a save dialog, then calls `item.setSavePath(savePath)`.
  - The `done` handler (`:211-237`) sets `entry.status = "completed"` and sends `eDownloadCompleted` (`:215-217`).
  - `openDownload` (`:75-80`) later runs `shell.openPath(savePath)`, which is where the mark matters.
- **`DownloadItem`** gives `getURL()` and `getURLChain()` (the redirect chain), but no referrer. The downloading page's URL is `webContents.getURL()` at `will-download` time.

There are no other paths that save web content to disk:

- Board catalog ZIPs (`board-download-service.ts`) are extracted board code, run only after the trust dialog, and are never opened by the shell.
- Board-claimed downloads are the board's own responsibility.

## Implementation plan

### 1. Write the mark — `src/main/download-service.ts`

1. Add a module-level helper near `sendToBrowserHost`:
   ```ts
   /**
    * Mark a completed browser download as coming from the internet (Mark-of-the-Web), as Chrome
    * and Firefox do: Windows then shows SmartScreen for executables, Protected View for Office
    * files and the "blocked" flag on archives. Electron does not write it (US-1592).
    * ZoneId=3 is always written: Persephone does not map URLs to the user's IE zones, so
    * intranet sources are treated as internet too (the stricter side). A filesystem without
    * alternate data streams (FAT32, exFAT, some network shares) cannot store the mark; the
    * download itself still succeeds.
    */
   async function writeMarkOfTheWeb(savePath: string, url: string, referrerUrl: string): Promise<void> {
       if (process.platform !== "win32") return;
       const lines = ["[ZoneTransfer]", "ZoneId=3"];
       const referrer = motwUrl(referrerUrl);
       if (referrer) lines.push(`ReferrerUrl=${referrer}`);
       lines.push(`HostUrl=${motwUrl(url) ?? "about:internet"}`);
       try {
           await fs.promises.writeFile(`${savePath}:Zone.Identifier`, lines.join("\r\n") + "\r\n", "utf8");
       } catch {
           // No alternate data streams on this volume — nothing else to do.
       }
   }

   /** The http(s) URL to record, without credentials; undefined for anything else
    *  (data:, blob:, about:), which Chrome records as about:internet. */
   function motwUrl(raw: string): string | undefined {
       try {
           const url = new URL(raw);
           if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
           url.username = "";
           url.password = "";
           return url.href;
       } catch {
           return undefined;
       }
   }
   ```
2. In `handleOrdinaryDownload`, capture the page URL once, before the save dialog:
   ```ts
   // The downloading page — DownloadItem has no referrer getter.
   const referrerUrl = webContents.isDestroyed() ? "" : webContents.getURL();
   ```
3. In the `done` handler, write the mark before the completion is announced, so an immediate "Open" from the downloads list already sees it.

   Before (`:215-217`):
   ```ts
   if (state === "completed") {
       entry.status = "completed";
       openWindows.send(EventEndpoint.eDownloadCompleted, { id, savePath: entry.savePath });
   ```
   After:
   ```ts
   if (state === "completed") {
       entry.status = "completed";
       const hostUrl = item.getURLChain().at(-1) ?? item.getURL();
       void writeMarkOfTheWeb(savePath, hostUrl, referrerUrl).finally(() => {
           openWindows.send(EventEndpoint.eDownloadCompleted, { id, savePath: entry.savePath });
       });
   ```
   - The rest of the handler (releasing `dl.item`, `persist()`) stays synchronous and unchanged.
   - `item.getURLChain()` must be read before `dl.item = undefined`. It is read on the line above, so this holds.
   - `savePath` is the closure variable from the dialog, the same value as `entry.savePath`.
4. Nothing changes for the cancelled or interrupted branches. A partial file is not opened.

### 2. Checks

1. `npm run typecheck`, `npm run lint`, `npm run build-prod`.
2. **Live, dev build.** The save dialog is native, so the user or the verifying agent picks the path.
   - **Internet:** download a small file from an https page in a browser tab, for example a GitHub raw file or a release asset.
     - `Get-Content <file> -Stream Zone.Identifier` shows `ZoneId=3`, `ReferrerUrl=<page>` and `HostUrl=<final URL>`.
     - Properties → General shows "This file came from another computer…".
   - **`data:` or `blob:`:** a download from a page script records `HostUrl=about:internet`.
   - **Cancel** the save dialog: no file, no error.
   - **Non-ADS volume:** if a FAT32/exFAT USB drive is at hand, a download there completes normally without the mark.

## Files changed

| File | Change |
|---|---|
| `src/main/download-service.ts` | `writeMarkOfTheWeb` + `motwUrl`; referrer capture; mark written before `eDownloadCompleted` |

**No change needed:**

- The renderer downloads UI (it reacts to the same events).
- `board-download-service.ts`.
- Board-claimed downloads.
- `ipc/api-types.ts` (no new events or payload fields).

## Concerns / Open questions

1. **Always `ZoneId=3` instead of zone mapping.**
   - Chrome calls `IAttachmentExecute::Save`. That maps the URL to the user's IE security zones, honors the "Do not preserve zone information" policy, and triggers the registered antivirus scan.
   - Doing the same needs a native call, for example a new `persephone-snip.exe mark-of-the-web` subcommand in Rust.
   - Writing `ZoneId=3` directly is the fallback Chrome itself uses when that call fails.
   - It errs on the strict side: an intranet download gets the internet zone.
   - **Recommendation:** ship the direct write now. Move to `IAttachmentExecute` only if a user on a managed network reports Protected View on trusted intranet files.
2. **Loopback and dev-server downloads** (`http://localhost`) are marked too. For developers this means a SmartScreen prompt on locally built executables downloaded through the browser tab. That is acceptable and matches the "everything from the browser is untrusted" model.
3. **Privacy.**
   - The stream records the page URL and the download URL, as Chrome's does. Credentials in the URL are stripped. Query strings are kept, as Chrome keeps them.
   - Incognito and Tor profile downloads are marked the same way. Chrome records the URLs there too.
   - If that is unwanted for Tor, use `HostUrl=about:internet` with no `ReferrerUrl` when `torService.findActivePartitionForSession(webContents.session)` is set. **Recommendation:** do this. It is one condition, and the Tor profile's purpose is not leaving the source behind.

   To act on the Tor recommendation, in step 1.2 add:
   ```ts
   // A Tor download keeps the mark but records no source (US-1592).
   const recordSource = !torService.findActivePartitionForSession(webContents.session);
   ```
   Then pass `recordSource ? hostUrl : ""` and `recordSource ? referrerUrl : ""` in step 1.3. `motwUrl("")` returns `undefined`, so the stream gets `HostUrl=about:internet` and no `ReferrerUrl`. `torService` is already imported in this file.

## Acceptance criteria

- A completed browser download on NTFS has a `Zone.Identifier` stream with `ZoneId=3`, plus `HostUrl` (the final download URL, or `about:internet`) and `ReferrerUrl` (the page) for http(s) sources.
- A Tor-profile download has `ZoneId=3` and `HostUrl=about:internet` only.
- `eDownloadCompleted` is sent after the mark is written. A failed write never fails or delays the download beyond that.
- Cancelled or interrupted downloads are unchanged.
- typecheck, lint and build-prod pass.

## Progress

- [x] `writeMarkOfTheWeb` / `motwUrl` + wiring in `handleOrdinaryDownload`
- [x] Tor: record no source (`recordSource` is captured once in `handleOrdinaryDownload`)
- [x] typecheck / lint / build-prod
- [x] Live verification (2026-10-01, dev build, browser tab on `https://example.com/`):
  - `<a download>` to `/` produced `ZoneId=3`, `ReferrerUrl=https://example.com/` and `HostUrl=https://example.com/`.
  - `<a download>` to `data:text/plain,…` produced `ZoneId=3`, `ReferrerUrl=https://example.com/` and `HostUrl=about:internet`.
  - Cancelling the save dialog left no file and no new entry in the downloads list.
  - For comparison, `persephone-setup-5.0.6.exe`, downloaded earlier with the old code, has no `Zone.Identifier`.
  - Not run: a Tor-profile download (needs the Tor daemon) and a non-ADS volume.
