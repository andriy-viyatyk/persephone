# US-1531: A claimed download is fetched on the originating page's session (D13)

**Status:** Placeholder — not planned yet
**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

> **This is a placeholder, not an implementation plan.** It exists so D13 is not forgotten. Before
> implementing, it needs the normal task-document treatment: deep investigation, a step-by-step plan
> with verified file paths, concerns and acceptance criteria.

## Goal

When a board claims a Browser download (D12, US-1478) from a **Tor or incognito** page, the board's
re-fetch of that URL runs on the originating page's session — not Persephone's default one — and the
board tells the user once that the swarm connection is not anonymous.

## Why

*(User decision, 2026-09-27: "let allow opening torrent links from tor and incognito mode.")*
Recorded as **D13** in the epic; read it before planning — it settles *propagate, not refuse*, and
*a sentence, not a gate*.

Found live while verifying US-1478: a `.torrent` claimed from a Tor tab is re-fetched by the board
with the user's real IP. On a host blocked on the clear net (`webtorrent.io`) the fetch fails; on a
reachable host it succeeds and **deanonymizes** a request the user made over Tor.

## Where to start (not yet verified in depth)

- `src/main/download-service.ts` — `handleWillDownload` cancels the item and sends
  `eOpenClaimedBrowserDownload` with `{ url, boardRoot }` only. The originating session is known here
  (`webContents.session`) and is dropped.
- `src/ipc/api-types.ts:386` and `src/ipc/renderer/renderer-events.ts:94` — the event payload shape.
- `src/renderer/api/internal/RendererEventsService.ts` — `handleClaimedBrowserDownload`, which hands the
  URL to `openRawLink`.
- `src/main/browser-service.ts` — Browser partitions (`session.fromPartition`); how a Tor or incognito
  page's partition is named and whether it outlives the page.
- The provider fetch the board's `.torrent` path ends up on — where the request is issued and whether
  it can be told which session to use.

## Constraints already decided

- **The board does not choose a network identity.** Propagation is the platform's job; core must not
  learn which board claims `torrent:`.
- **No consent dialog, no permission prompt** — a trusted board is a user application. One plain
  sentence: the metadata was fetched privately, the swarm connection is not.
- BitTorrent over Tor is out of scope (a documented deanonymization path).

## Open questions for the investigation

- What identifies the session across the IPC hop — a partition name? Is it stable if the Tor page closes
  before the fetch runs?
- Does an incognito partition's lifetime survive long enough for the board's fetch?
- Must the persisted link (D5, cold-start restore) carry the session? Probably not — a restored torrent
  resolves from the magnet, not the `.torrent` URL — but confirm.
- Where does the "not anonymous" sentence belong: platform notification or the board's page?
