# US-1692: Remove the audio features from the Video Player

Epic: [EPIC-128](../../epics/EPIC-128.md) (decisions A3, A8)

## Goal

Keep audio files playable in the built-in Video Player as a simple native audio-controls experience, with play/pause, seek, and volume. Remove its visualizer, custom audio chrome, sibling-track navigation, shuffle, and matching settings and script/documentation surfaces. Keep video playback behavior unchanged, including HLS .m3u8 and existing video controls and actions.

## Background

- EPIC-128 A8 schedules this after BT-042 publishes the Audio Player board. The board takes the music-player features; an audio file without the board remains claimed by the built-in video-view editor and plays through VPlayer's existing native video element controls. The editor switch offer is generic and catalog-driven: once the Audio Player is present in the published catalog, its audio fileMasks surface it through the existing matching path.
- src/renderer/editors/video/video-types.ts::detectVideoFormat() distinguishes "audio", "m3u8", and "mp4"; VideoEditor continues to resolve sources and stream URLs. src/renderer/editors/video/VPlayer.ts::syncMode() selects HLS, native, or no-source mode. An HTMLVideoElement can play audio-only files with the same native play/pause/seek/volume controls, so route format "audio" through the existing "native" branch. Keep the "audio" format classification for facade reporting, and preserve source resolution, media handoff, page mute, and all video/HLS mode paths.
- Current audio presentation is assembled by src/renderer/editors/video/AudioPlayer.ts::AudioPlayerView, AudioControls.ts::AudioControlsView, and AudioVisualizer.ts::AudioVisualizerView, with effects/BarsEffect.ts, effects/CircularEffect.ts, and effects/types.ts. Audio <audio> is currently hidden by video-editor.css; the custom overlay and canvas own its visible controls.
- Next/Previous determination: there is a Next button and end-of-track advance, but no Previous button or action. VideoView.playerProps() wires VideoEditor.playNext as VPlayerProps.onNext and onEnded; VideoEditor.getSiblingTracks() passes isAudioFile() to getSiblingItems(), so the path enumerates only audio siblings. AudioControls.ts renders the audio-next button. This is audio-only navigation despite the generic VideoEditor/VPlayer wiring; remove the path and wiring, rather than retaining it for video. VideoView's normal video controls and VPlayer HLS/native paths are separate and must remain unchanged.
- A3's shared source helper is not audio-player-only. src/renderer/editors/shared/source-context.ts::navigateToSourceItem() is called by src/renderer/editors/board/BoardEditorModel.ts::navigateSource() to implement board source navigation. Keep the helper and its board use; remove only VideoEditor's call/import. The getSiblingItems() helper also serves source-context capture elsewhere; inspect references before deleting any export.
- Settings are stored/typed in src/renderer/api/settings.ts: visualizer-effect is a setting definition and audio-shuffle has a type, description, and default false. src/renderer/scripting/ai-vision/namespaces/settings.ts has hidden-setting help for both. There are no matching rows in src/renderer/editors/settings/settings-catalog.ts; the current Settings UI does not expose either setting as a row. src/shared/i18n/en/editors.ts has editors.nextTrack, editors.shuffleOn, and editors.shuffleOff; locale copies are assets/languages/be.lang.json, de.lang.json, es.lang.json, et.lang.json, fr.lang.json, hu.lang.json, it.lang.json, ja.lang.json, ko.lang.json, lt.lang.json, lv.lang.json, pl.lang.json, pt-BR.lang.json, ro.lang.json, sk.lang.json, uk.lang.json, and zh-CN.lang.json. These files include generated message-hash entries; search showed all three strings are used only by AudioControls.ts.
- Existing visualizer-effect/audio-shuffle values in appSettings.json are intentionally left as inert saved data once the Video Player no longer reads them; no load-time migration is warranted.
- Existing editor-switch offer mechanism is generic: src/renderer/editors/base/editor-switch-options.ts uses publishedBoards.catalogBoardsForFile(fileName) to expose the + Board Info install target when a matching catalog board exists; src/renderer/api/published-boards.ts::catalogBoardsForFile() matches published board masks. Neither file needs a code change. Once BT-042 adds the Audio Player and its audio fileMasks to the published catalog, the existing path surfaces it as the matching offer.
- Search results identify user-facing and developer references in assets/guides/editors/video.md, scripting/API guides, doc/architecture/, and QA surface docs. qa/surfaces/shell.md uses audio-shuffle in its current help scenario and should be updated. qa/runs/2026-08-09-ui-guidance-haiku.md and assets/guides/whats-new.md are historical records and should retain their dated descriptions.
- The visibility sweep across src/renderer/editors/video/VideoView.ts and VideoEditor.ts found no page-visibility or visualizer-animation pause logic. VideoView.ts has an unrelated overflowVisible toolbar option; VideoEditor.ts has only the visualizer settings accessors already slated for removal.

## Implementation Plan

- [x] 1. Route audio through VPlayer's existing native video element. In src/renderer/editors/video/VPlayer.ts, remove the "audio" ActiveMode, AudioPlayerView and AudioPlayerProps imports/state, audioProps(), all audioPlayer updates/visibility toggles, and both insertBefore(this.video, this.audioPlayer.root) calls. Keep the video element as VPlayer's only child by appending it normally in onMount(). In syncMode(), use the existing video path for every non-HLS source: const nextMode = !source ? "none" : wantsHls ? "hls" : "native". This keeps the existing controls/autoplay setup, lifecycle/error/mute listeners, onMediaElementChange handoff, source assignment, and reload behavior for audio as well as video. Leave VideoFormat "audio" detection in video-types.ts and preserve .m3u8 HLS detection and playback.
- [x] 2. Remove audio navigation and shuffle from the editor model/view path. In src/renderer/editors/video/VideoEditor.ts, remove the shuffle getter/toggle, visualizerEffect getter/setter, canPlayNext, getSiblingTracks(), playNext(), navigateToTrack(), and getShuffleBagNext() plus their audio-only imports. In src/renderer/editors/video/VideoView.ts, remove the audio-shuffle settings subscription and the hasNext, onNext, onEnded, shuffle, and onToggleShuffle props passed to VPlayer. In src/renderer/editors/video/VPlayer.ts, remove those same audio-only fields from VPlayerProps and remove their forwarding/behavior. Delete src/renderer/editors/video/AudioPlayer.ts, AudioControls.ts, AudioVisualizer.ts, and src/renderer/editors/video/effects/ (including types.ts) after checking for other imports. The visibility sweep found no page-visibility or visualizer-animation pause logic to remove; VideoView's overflowVisible option is unrelated.
- [x] 3. Remove only dead audio CSS and preserve video CSS. In src/renderer/editors/video/video-editor.css, remove selectors that only style audio-media, visualizer canvas/track info, [data-audio-overlay], audio seek/time labels. Keep selectors for video-media, video URL input, state badge, VLC fallback, and temporary recording controls.
- [x] 4. Remove obsolete settings and localization. In src/renderer/api/settings.ts, remove visualizer-effect and audio-shuffle from AppSettingsKey, settingsComments/defaultAppSettingsState, and setting descriptions; do not add load-time pruning or persistence migration for old appSettings.json values. The current Settings UI has no rows for these settings (src/renderer/editors/settings/settings-catalog.ts), so remove no visible rows. Remove their hidden-setting descriptions from src/renderer/scripting/ai-vision/namespaces/settings.ts, their help/listing from scripting settings docs, and editors.nextTrack / editors.shuffleOn / editors.shuffleOff from src/shared/i18n/en/editors.ts and every corresponding assets/languages/*.lang.json locale key (including translation hash entries where generated locale files contain them). Search all keys after edits.
- [x] 5. Update scripting and MCP/ai-vision surfaces. In src/renderer/scripting/api-wrapper/VideoEditorFacade.ts, remove audio-only members and element descriptions: canPlayNext, shuffle, visualizerEffect, playNext, toggleShuffle, setVisualizerEffect, audio-play-pause, audio-next, audio-mute, audio-seek, audio-shuffle, and visualizer-bars/circular/none. Keep generic media state and video controls, including format === "audio", play(), pause(), seek(), and toggleMute(); their underlying media element remains the existing HTMLVideoElement on the native path. Keep video URL, VLC, page mute and video-only operations. Update matching declarations in src/renderer/api/types/video-editor.d.ts and assets/editor-types/video-editor.d.ts. Update VIDEO_EDITOR_MEMBERS, VIDEO_ELEMENTS, and VIDEO_EDITOR_HELP in VideoEditorFacade.ts plus guide-backed help so no removed capability is advertised. Keep historical doc/architecture/scripting.md and QA references current.
- [x] 6. Update shipped guides and developer architecture docs. Rewrite assets/guides/editors/video.md to describe audio as native minimal controls, remove Next/shuffle/visualizer elements and actions, and document preserved HLS/video functionality. Update relevant scripting pages and assets/guides/agents/scripting.md for the reduced facade, plus assets/guides/scripting/api/settings.md for removed setting keys. Update doc/architecture/folder-structure.md, doc/architecture/key-files.md, doc/architecture/scripting.md, and doc/architecture/secondary-views.md to remove the built-in audio-player architecture and document simple native audio playback; retain A3/source-context architecture where boards still use it. Preserve the historical descriptions in assets/guides/whats-new.md.
- [x] 7. Update QA surfaces and keep the existing editor-switch offer path. Revise qa/surfaces/editors/media.md to cover the remaining VideoEditor facade/actions and native audio mode; after audio-only element members are removed, its curated elements should be video-url-input and video-open-vlc. In qa/surfaces/shell.md, replace Test S.17's visualizer/audio-shuffle hidden-setting example with search-max-file-size, which remains a registered no-row setting in src/renderer/scripting/ai-vision/namespaces/settings.ts. Keep qa/runs/2026-08-09-ui-guidance-haiku.md as a historical QA report. Do not change src/renderer/editors/base/editor-switch-options.ts or src/renderer/api/published-boards.ts: once BT-042 publishes the Audio Player entry with audio fileMasks, the existing catalogBoardsForFile() path exposes its install offer.
- [x] 8. Run the targeted reference sweeps after edits. For active feature references, run:

    rg -n -i --hidden -e 'AudioPlayer(View)?|AudioControls(View)?|AudioVisualizer(View)?|BarsEffect|CircularEffect|visualizer-effect|audio-shuffle|audio-(play-pause|next|mute|seek)|visualizer-(bars|circular|none)|canPlayNext|playNext|toggleShuffle|setVisualizerEffect|editors\.(nextTrack|shuffleOn|shuffleOff)|Next Track|shuffle|visualizer' src assets/guides assets/editor-types doc/architecture qa

Expected remaining feature hits are only historical assets/guides/whats-new.md and qa/runs/2026-08-09-ui-guidance-haiku.md, which are listed as no-change files. Separately run:

    rg -n 'navigateToSourceItem|getSiblingItems|captureBoardSourceContext|navigateSource' src/renderer/editors/shared/source-context.ts src/renderer/editors/board/BoardEditorModel.ts

Expected hits are only the retained shared helper and its BoardEditorModel caller. Keep generic audio media references unrelated to Video Player.

### Before → after

    // Before: audio gets a separate AudioPlayerView mode.
    const wantsAudio = this.props.format === "audio";
    const nextMode = !source ? "none" : wantsAudio ? "audio" : wantsHls ? "hls" : "native";

    // After: audio uses the already-wired native video element and controls.
    const nextMode = !source ? "none" : wantsHls ? "hls" : "native";

    // Before: the same VideoEditor action wired to the audio Next button and end event.
    onEnded: this.model.playNext,
    onNext: this.model.playNext,

    // After: audio has no sibling navigation or automatic advance; video/HLS playback is unchanged.
    // (No audio Next or ended-to-next callback is passed to VPlayer.)

## Concerns

- Audio now appears in the native video surface: the dark media area with its controls bar. This is the intended simple player. The existing HTMLVideoElement's source/reload path, lifecycle/error/mute listeners, media handoff, page mute, and facade play/pause/seek behavior already cover this mode; preserve them while removing AudioPlayerView.
- The VideoEditorFacade.playNext() member is generic in its description but currently reaches an audio-only sibling list. Remove it along with canPlayNext; preserve all other video facade members. Keep media format "audio" because audio still opens in this editor.
- source-context.ts::navigateToSourceItem() must remain because BoardEditorModel.navigateSource() uses it. getSiblingItems() is also called by captureBoardSourceContext() in that helper; do not remove shared A3 functionality while deleting the Video Player call path.
- assets/guides/whats-new.md and qa/runs/2026-08-09-ui-guidance-haiku.md contain dated records of then-current Video Player features. Preserve those historical records; update the current guide and QA surface descriptions instead.
- Audio Player publication remains the A8 dependency (BT-042); the built-in audio matcher must remain so unsupported/uninstalled board states still have an editor. Its eventual published audio fileMasks are matched by the existing catalog-driven editor-switch offer.
- The current facade exposes toggleMute() through VideoEditor.toggleMuteAll(), which PageTabView uses for the page mute button. VPlayer passes pageMuted to the native video element in both video and audio playback modes, so retain this generic media behavior and the page-tab integration.

## Acceptance Criteria

- [ ] Opening a supported audio file without Audio Player installed still opens video-view and plays through the existing HTMLVideoElement native controls for play/pause, seek, and volume; no visualizer, custom transport, Next/Previous, shuffle, or sibling/end-of-track navigation is present. Audio uses the native video surface (dark area plus controls bar).
- [ ] Audio source resolution, pipe/stream seeking, playback state, page mute integration, and error handling continue to function.
- [ ] Video playback is unchanged, including local/HTTP video, HLS .m3u8, native video controls, VLC fallback, video URL handling, and recording actions.
- [ ] Once BT-042 publishes the Audio Player with audio fileMasks, the existing editor-switch catalogBoardsForFile() path surfaces it as the install offer for an audio file; src/renderer/editors/base/editor-switch-options.ts and src/renderer/api/published-boards.ts require no changes. The built-in Video Player remains the fallback claim.
- [ ] No active settings, defaults, translations, script facade/types, $help/ai-vision/MCP descriptions, user guides, architecture docs, or QA checklists advertise removed built-in audio features. The remaining historical release-note content is intentionally identified.
- [ ] source-context.ts::navigateToSourceItem() remains and BoardEditorModel source navigation behavior is unaffected.
- [ ] Implementation is not started before the user reviews this task document, and no commit is created as part of this task-document work.

### Files verified as no-change candidates

| File/path | Reason |
|-----------|--------|
| src/renderer/editors/shared/source-context.ts | Keep shared A3 helper; navigateToSourceItem() is used by BoardEditorModel, and getSiblingItems() serves board context capture |
| src/renderer/editors/board/BoardEditorModel.ts | navigateSource() uses shared source navigation; no audio-only player code |
| src/renderer/editors/base/editor-switch-options.ts | Existing offer is catalog-driven through publishedBoards.catalogBoardsForFile(); no change needed when the Audio Player is published with matching audio fileMasks |
| src/renderer/api/published-boards.ts | catalogBoardsForFile() already matches published board masks; no change needed |
| src/renderer/editors/video/video-types.ts | Keep "audio" classification and .m3u8-before-audio detection so audio and HLS continue opening correctly |
| src/renderer/editors/video/NodeFetchHlsLoader.ts | Keep the HLS request loader and its custom-header support unchanged |
| src/renderer/editors/settings/settings-catalog.ts | Verified no rows for visualizer-effect or audio-shuffle; no UI row needs removal here |
| doc/architecture/content-pipeline.md | Pipe-backed media source behavior remains in place; no built-in audio UI/navigation descriptions were found there |
| assets/guides/whats-new.md, qa/runs/2026-08-09-ui-guidance-haiku.md | Dated release/QA records; preserve historical statements |

## Files Changed Summary

| File/path | Planned change |
|-----------|----------------|
| src/renderer/editors/video/AudioPlayer.ts | Delete custom audio player view |
| src/renderer/editors/video/AudioControls.ts | Delete custom controls view |
| src/renderer/editors/video/AudioVisualizer.ts | Delete visualizer view |
| src/renderer/editors/video/effects/ | Delete bars/circular effects and effect type |
| src/renderer/editors/video/VPlayer.ts | Route audio through the existing native video path; remove the separate audio mode and subview; preserve video/HLS modes |
| src/renderer/editors/video/VideoView.ts | Remove audio shuffle setting subscription and next/shuffle wiring |
| src/renderer/editors/video/VideoEditor.ts | Remove audio visualizer, next, and shuffle model code; retain source/media/video behavior |
| src/renderer/editors/video/video-editor.css | Remove dead custom-audio selectors; retain video styling |
| src/renderer/api/settings.ts | Remove audio-only setting identifiers, descriptions/comments, and defaults |
| src/renderer/scripting/ai-vision/namespaces/settings.ts | Remove hidden setting help for the removed ids |
| src/renderer/scripting/api-wrapper/VideoEditorFacade.ts | Remove removed audio controls/actions/settings from members, elements, and help |
| src/renderer/api/types/video-editor.d.ts, assets/editor-types/video-editor.d.ts | Keep generated/public declarations aligned with the reduced facade |
| src/shared/i18n/en/editors.ts, assets/languages/be.lang.json, de.lang.json, es.lang.json, et.lang.json, fr.lang.json, hu.lang.json, it.lang.json, ja.lang.json, ko.lang.json, lt.lang.json, lv.lang.json, pl.lang.json, pt-BR.lang.json, ro.lang.json, sk.lang.json, uk.lang.json, zh-CN.lang.json | Remove Next Track and shuffle labels and locale/hash entries used only by custom audio controls |
| assets/guides/editors/video.md, assets/guides/agents/scripting.md, assets/guides/scripting/api/page.md, assets/guides/scripting/api/settings.md | Describe minimal audio playback and reduced facade/settings |
| doc/architecture/folder-structure.md, doc/architecture/key-files.md, doc/architecture/scripting.md, doc/architecture/secondary-views.md | Remove obsolete built-in audio feature descriptions; preserve board source-context architecture |
| qa/surfaces/editors/media.md, qa/surfaces/shell.md | Update current media/facade and no-row settings-help checks |
| doc/active-work.md, doc/epics/EPIC-128.md | Link US-1692 to this task document |

