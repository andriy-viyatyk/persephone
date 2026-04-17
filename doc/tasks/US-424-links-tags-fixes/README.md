# US-424: Links & Tags Panel — Enhancements and Bug Fixes

## Goal

A collection of small enhancements and bug fixes for the Links and Tags panels, implemented incrementally.

## Items

Items will be added as they are identified. Each item is implemented and tested before moving to the next.

| # | Type | Description | Status |
|---|------|-------------|--------|
| 1 | Enhancement | Save button in Links sidebar panel — visible when `modified: true` and LinksEditor is not the main editor. Calls `saveFile()` (save or Save As for readonly pipes). | Done |
| 2 | Enhancement | SaveIcon updated to floppy disk shape (was empty page outline). | Done |
| 3 | Enhancement | Tag editing in LinkTooltip — bottom section shows all available tags as toggleable badges (active/inactive). Click toggles tag on/off. Inline input for adding new tags (Enter or blur to commit). Wired into LinkItemList (main editor) and LinkTagsSecondaryEditor (sidebar). | Done |
| 4 | Bug fix | PageNavigator + Links panels: (a) First open didn't show panels — `toggleNavigator()` created model without firing `pageNavigatorToggled` event. (b) Tags/Hostnames panels were conditionally hidden when no data — now all 3 panels always shown when main editor is Links. (c) Tags panel timing on demote — `promoteSecondaryToMain` microtask was overwriting panels set by CategorySE effect. (d) Panel list visibility rules: main=Links → all 3 always; standalone → Links always, Tags if data, Hostnames hidden. | Done |
| 5 | Bug fix | Archive path `!` separator incorrectly splitting filenames containing `!` (e.g., `Roxette - Crash!Boom!Bang!.mp3`). Fixed `isArchivePath`/`parseArchivePath` in `file-path.ts` to only treat `!` as separator when the left side has a known archive extension. | Done |

## Files Changed

*(updated as implementation progresses)*
