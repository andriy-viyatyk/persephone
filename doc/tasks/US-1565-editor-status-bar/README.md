# US-1565: Shared editor status bar — pipe status moves to the footer

## Goal

Move the page pipe status from the top toolbar to a footer status bar, and make that status bar a
shared component every pipe-bearing editor mounts — not only the content-host (text) editors.

## Background

- `ContentHostFooterView` (`editors/base/ContentHostFooterView.ts`) is the text-host footer:
  script toggle, editor contributions (grid, notebook, links, board status text), provider badge,
  encoding. Mounted by `TextChromeView` and the content-host board (`BoardHostView`).
- `PagePipeStatusView` is mounted in the top toolbar by `PageToolbarView.ts` (`page-toolbar-status`
  host) and by `BoardToolbar.ts`.
- `PagePipeStatusModel.rebindCurrentPipe` resolves the page's pipe: the text host's pipe for
  text/text-host editors, otherwise `EditorModel.pipe`. The status is transient (busy → done for 3 s
  → hidden), so the bar itself must not come and go with it (layout shift).
- Editors own their chrome (toolbar and footer); the page frame does not. Approach B (chosen):
  a shared component editors mount, the counterpart of `PageToolbarView`.

## Implementation plan

- [x] `components/pipe-status/page-pipe.ts`: extract the pipe resolution from
      `PagePipeStatusModel` into `subscribePagePipe(page, onPipe)` so the status model and the
      provider badge follow the same pipe.
- [x] `editors/base/EditorStatusBarView.ts` (+ `.css`): generic status bar built on
      `EditorToolbarView` (`borderTop`). Props: `name`, `page`, optional `host` (TextFileModel →
      script toggle + encoding), `contributions`. Content: [script] spacer [contributions]
      [pipe status] [provider badge] | [encoding]. Provider badge is derived from the page pipe.
- [x] Replace `ContentHostFooterView` with it (delete the old file/CSS); `TextChromeView` and the
      board keep `name: "text-chrome-footer"` and `text-toggle-script` so docs/automation hold.
- [x] Mount it in `ImageView`, `VideoView`, `ArchiveEditorView` (`name: "editor-status-bar"`) and in
      the stream-host board branch (board status text as contribution).
- [x] Remove the pipe status from `PageToolbarView` and `BoardToolbar`.
- [x] `PagePipeStatusView` popover placement `top-end` (it opens upward from the footer).
- [x] `PagePipeStatusView.css`: the progress bar is a 2 px line under the trigger instead of a
      72 px column beside it, which read as empty space at the end of the bar.
- [x] Side fix (user report): audio player controls now fill their centred 33%-wide overlay
      (`video-editor.css`), so they are centred at any page width.
- [x] Side fix (user report): the player state badge ("loading" …) is top-centred instead of
      bottom-centred, so it no longer covers the audio control panel.
- [x] Docs: `ui-element-contract.md`, `pages-architecture.md`, `editor-guide.md`, `key-files.md`,
      guides `screens/sidebar.md`, `tabs-and-navigation.md`, `whats-new.md`.

## Concerns / Open questions

- Pipeless editors (Category, Git tree, Mneme root, Board info, Browser, Settings, tools) get no bar;
  they can mount it later if they gain footer content.
- Image and video lose ~24 px of height to the bar.
- The loading shell keeps showing stages itself; no status bar while restoring.

## Acceptance criteria

- Text editors: footer shows script / contributions / pipe status / provider badge / encoding; top
  toolbar has no pipe status.
- Image, video, archive and stream-host board (Torrent Viewer) show a footer with pipe status and
  provider badge; the board footer also shows the board status text.
- Clicking the pipe status opens the stage popover above the footer.
- Existing `data-name`s (`text-chrome-footer`, `text-toggle-script`, `page-pipe-status`,
  `page-pipe-status-popover`) are unchanged.
