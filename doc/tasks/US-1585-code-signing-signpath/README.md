# US-1585: Code signing via SignPath Foundation

## Goal

Obtain SignPath Foundation’s eligibility decision and, on acceptance, sign Persephone’s main Electron executable, its three shipped Rust executables, and the NSIS installer through GitHub Actions. Preserve Widevine VMP signing order and publish only final signed assets. If SignPath rejects the project, stop this task; do not use partial-scope signing as a fallback.

## Background

### Verified project and release setup

- `package.json` declares MIT licensing, Castlabs Electron `v43.0.0+wvcus`, `electron-builder` `^26.15.3`, and `dist`, `dist:zip`, and `dist:publish` scripts that call electron-builder after `scripts/build-prod.mjs`. There is no `build` key in `package.json`; the full packaging configuration is [`electron-builder.yml`](../../../electron-builder.yml).
- `electron-builder.yml` emits NSIS and ZIP targets under `release/`, names the installer `persephone-setup-${version}.${ext}`, includes `assets` as `extraResources`, and installs three Rust executables at the install root via `extraFiles`: `persephone-launcher.exe`, `persephone-snip.exe`, and `mneme.exe`.
- `.github/workflows/publish.yml` builds all three Rust crates on `windows-latest`, installs Node and Castlabs EVS, then runs `npm run dist:publish` with `VMP_SIGN=true`. Electron-builder publishes a draft GitHub release. For tag builds only, the workflow deletes `latest.yml` and `*.blockmap` assets.
- `electron-builder.yml` registers `scripts/vmp-sign.mjs` as `afterSign`. On Windows Authenticode must happen before VMP because VMP signs the Electron PE. Keep the Authenticode operation before this VMP operation. The script currently exports an electron-builder hook, moves non-Electron `.exe` files out of the way, invokes `python -m castlabs_evs.vmp ... sign-pkg`, then restores them. Its comment says `afterPack`, which does not match the config key; correct the comment while making the hook callable after the remote Authenticode step.
- The project has a custom update notice, not `electron-updater`: `src/main/version-service.ts` (`fetchLatestRelease`, `checkForUpdates`) calls GitHub’s latest-release API and compares version tags; it does not download an installer or consume a SHA-512 hash. Electron-builder nevertheless creates `latest.yml` and blockmaps. Since those metadata files describe installer bytes and differential blocks, signing/replacing the installer after their creation would make them stale if retained. Current tag publication deletes both classes; workflow-dispatch drafts retain them.

### Verified SignPath integration constraints

Current requirements were checked against SignPath’s published terms and GitHub integration documentation on 2026-10-01:

- SignPath Foundation requires an OSI-approved license for all components, no proprietary/non-open-source component, an actively maintained project already released in the form to be signed, documented functionality, MFA for all team members on SignPath and GitHub, assigned Authors/Reviewers/Approvers roles, a Code signing policy on the home page and release/download pages, and manual approval of every release signing request. The policy page must include the SignPath attribution, team roles/members, and privacy-policy information. See [Foundation terms](https://signpath.org/terms.html).
- The SignPath GitHub connector requires a GitHub Actions artifact uploaded before the signing request; for OSS, all preceding workflow jobs must run on GitHub-hosted runners. The current action is `signpath/github-action-submit-signing-request@v3`; its documented inputs include `api-token`, `organization-id`, `project-slug`, `signing-policy-slug`, optional `artifact-configuration-slug`, `github-artifact-id`, `wait-for-completion`, and `output-artifact-directory`. See [GitHub integration](https://docs.signpath.io/trusted-build-systems/github) and the [action repository](https://github.com/SignPath/github-action-submit-signing-request).
- SignPath artifact configurations are XML. A ZIP root can describe nested PE files and their Authenticode directives, and PE metadata restrictions can enforce product name/version. See [artifact configuration](https://docs.signpath.io/artifact-configuration/), [syntax](https://docs.signpath.io/artifact-configuration/syntax), and [reference](https://docs.signpath.io/artifact-configuration/reference).
- The installed electron-builder CLI reports `--dir` (“Build unpacked dir”) and `--prepackaged` (“path to prepackaged app”) as supported. Its local 26.15.3 implementation returns early from `PlatformPackager.doPack()` for a prepackaged app. `win.signtoolOptions.sign` resolves a custom sync/async signing function, and the SignPath action is a separate workflow action that uploads/downloads workflow artifacts. So the action is not directly callable as an electron-builder `win.sign` hook. SignPath’s Windows KSP documentation is limited to Code Signing Gateway, not the Foundation GitHub action flow; it is not an established Foundation-compatible shortcut. See [Windows KSP availability and usage](https://docs.signpath.io/crypto-providers/windows).
- The official SignPath artifact-configuration file-format list supports PE files and ZIPs but does not list NSIS as a composite format. It can Authenticode-sign the installer EXE as a PE, but there is no verified configuration to reach into the NSIS payload and sign the uninstaller embedded there.

### Concrete pipeline ordering and verified limitation

Use a two-stage app build to put the remote signing action between electron-builder’s app staging and final distributable creation:

1. Build the unpacked app with electron-builder `--win --dir`, setting `win.signExecutable: false` and leaving `forceCodeSigning` false; keep VMP disabled. Upload the staged app tree as a GitHub artifact and submit it to SignPath; download the signed tree. The app-tree artifact configuration must sign `persephone.exe`, `persephone-launcher.exe`, `persephone-snip.exe`, and `mneme.exe`, with product-name/product-version metadata restrictions. SignPath’s guidance allows upstream OSS binaries to remain unsigned in a signed package; leave Electron’s upstream runtime DLLs (including `ffmpeg.dll`, `libEGL.dll`, and related Chromium DLLs) unsigned and exclude them from signing. If `chrome_crashpad_handler.exe` appears in the actual package, treat it as an upstream binary too. Ask SignPath whether the Castlabs-derived `persephone.exe` itself meets its modified-upstream signing conditions; rejection of that required signature means this task stops.
2. Run VMP against the downloaded, Authenticode-signed Electron executable. Refactor `scripts/vmp-sign.mjs` to export `signVmpDirectory(appDir, productFilename)` and add a CLI entry point that calls it; retain the default electron-builder hook export.
3. Run electron-builder with `--prepackaged <signed-and-VMP-signed-app-dir> --win nsis zip --publish never`, explicitly setting `win.signExecutable: false` and leaving certificate/custom-sign settings unset. This produces a ZIP containing the already-signed inner app and an NSIS installer containing those app files. The prepackaged path skips app packaging/signing hooks. In the NSIS target electron-builder still creates and embeds its intermediate uninstaller, but `WinPackager.signIf()` returns before invoking SignTool when `signExecutable` is false; with no custom signer or certificate and `forceCodeSigning` false there is no signing error.
4. Upload the completed `persephone-setup-<version>.exe` as a second GitHub artifact, submit it to SignPath for Authenticode signing, and download the signed installer. Publish the final signed installer and ZIP with electron-builder’s `publish` command (`electron-builder publish --files <signed-installer> <signed-zip> --version <version>`); the current config already sets GitHub draft releases. Do not include `latest.yml` or blockmaps unless they are regenerated from the signed installer bytes.

This order is supported by the installed electron-builder CLI and its 26.15.3 source; it has not been exercised end-to-end. The NSIS target builds the uninstaller as a temporary executable, calls `packager.signIf(uninstallerPath)` before embedding, and deletes the intermediate after installer creation. The GitHub signing action cannot be inserted at that point. Recommended v1 scope leaves the installed uninstaller unsigned and documents the gap. This is not a release blocker: the uninstaller runs locally, so SmartScreen does not apply; if Windows prompts for elevation, UAC will show “Unknown publisher.” Asking SignPath for an approved way to sign the uninstaller is an optional follow-up if the user chooses to close that gap.

## Implementation Plan

### A. User-side steps (account and enrollment)

> **Status (2026-10-01): on hold, awaiting SignPath Foundation review.** The application was
> submitted 2026-10-01 and acknowledged by email; SignPath said it would reply within a few
> business days. The eligibility question below was asked in the application's Description
> field. Do not start part B until SignPath approves.

- [x] Ask SignPath Foundation whether this released product is eligible under its no-proprietary-components rule: Persephone ships the Castlabs ECS Electron fork (open-source Electron/Chromium with Castlabs patches), Electron’s `ffmpeg.dll` (confirm whether this build enables proprietary codecs), and a runtime-downloaded Widevine CDM that is not included in the submitted app artifact. Persephone’s build also depends on the closed Castlabs EVS service to VMP-sign Electron for Widevine. Ask whether the modified-upstream `persephone.exe` can be signed under the Foundation’s own-binaries rules. If the required main executable cannot be signed or the project is rejected, stop US-1585 without partial-scope signing.
- [x] Submit the application at SignPath Foundation with the public Persephone repository, released installer/ZIP, MIT license, and product/download page, including the above component and build-service disclosure.
- [ ] After acceptance, create the SignPath organization/project and configure project slug, signing-policy slug, and artifact-configuration slug(s) for the unpacked app and installer. Use the GitHub.com trusted build system with origin verification and manual release approval.
- [ ] Enable MFA for every SignPath/GitHub committer and team member. Assign Authors, Reviewers, and Approvers; agree who approves each release signing request.
- [ ] Add GitHub Actions secret `SIGNPATH_API_TOKEN` for a submitter authorized by the project policy. Store non-secret organization id and project/artifact/policy slugs as repository variables where practical; keep the names consistent with the workflow inputs.
- [x] Confirm the policy page’s team roster, privacy wording, and the public release/download locations where it must be linked. Done: `README.md` → “Code signing policy” (on `main` since 2026-10-01), with a “not signed yet” status note to remove once the first signed release ships; the privacy statement lists the three automatic connections (update check, board catalog, Widevine component download).

### B. Repository changes

- [ ] Add `doc/code-signing-policy.md` with the exact SignPath attribution, Authors/Reviewers/Approvers and member references, privacy policy/link, signing scope, and release approval description required by the current terms. Add a README section/link under the exact heading **Code signing policy** and ensure the GitHub Releases/download page links to the same policy.
- [ ] Add SignPath artifact configuration XML under committed path `.github/signpath/` (confirmed not ignored). Define one configuration for the uploaded unpacked-app tree and another for the final installer. Sign the required main `persephone.exe` and the three project Rust PEs (`persephone-launcher.exe`, `persephone-snip.exe`, `mneme.exe`). Follow SignPath’s usual guidance to include upstream OSS binaries unsigned rather than signing them as Persephone code: leave `ffmpeg.dll`, `libEGL.dll`, `libGLESv2.dll`, `d3dcompiler_47.dll`, `dxcompiler.dll`, `dxil.dll`, `vk_swiftshader.dll`, `vulkan-1.dll`, and any `chrome_crashpad_handler.exe` unsigned unless SignPath directs otherwise. Use metadata restrictions on signed files for Persephone product name and a matching product version. Validate paths against the uploaded artifact sample; the application must confirm `persephone.exe` is eligible under its modified-upstream rule.
- [ ] Split the existing `dist:publish` path in `package.json` and `.github/workflows/publish.yml` into build-app-dir → upload/request/download app signing → VMP signing → `--prepackaged` NSIS/ZIP build → installer signing → publish. Preserve the existing tag and workflow-dispatch draft-release behavior, including required `contents: write` permissions and branch/version naming. Use `actions/upload-artifact` v4 or later and the current SignPath action input contract. Use action tag refs consistent with `publish.yml` (`@v4`, `@v5`, `@stable`; SignPath currently documents `@v3`).
- [ ] Configure the first electron-builder pass so its normal `win.signExecutable` path does not sign before SignPath and so `VMP_SIGN` is off until after the SignPath app result returns. Keep VMP after Authenticode. Make `scripts/vmp-sign.mjs` callable for the downloaded app directory while retaining any local `VMP_SIGN=true npm run dist` use case.
- [ ] Update `electron-builder.yml` for the staged `--prepackaged` target usage and ensure the final NSIS/ZIP inputs come from the SignPath-returned directory. Preserve NSIS options, icon, `extraResources`, and all three `extraFiles`. In the prepackaged installer pass set `win.signExecutable: false`, leave custom signing/certificate settings unset, and keep `forceCodeSigning` false so the temporary uninstaller remains unsigned and `signIf()` skips without calling SignTool.
- [ ] Record the recommended v1 behavior: ship with the app tree, Rust tools, and outer NSIS installer signed; leave the installed NSIS uninstaller unsigned. Treat an approved remote uninstaller-signing design as optional follow-up only if the user chooses that scope.
- [ ] Ensure the post-sign installer bytes are the ones published. Update `.github/workflows/publish.yml` so no unsigned installer is published or left as a release asset. Recompute update metadata from signed bytes if used; otherwise remove stale `latest.yml`/blockmaps in both draft and tag publishing. Keep the current custom update checker’s user-facing release URL/version notice behavior.
- [ ] Update `doc/standards/release-process.md`: describe the two sequential SignPath requests per release (app tree, then installer), manual approval at each request, workflow waits, the 600-second default action timeout and the need to raise it if approval takes longer, final signed asset checks, draft-build behavior, and how `latest.yml`/blockmaps are treated. Correct the VMP hook label from `afterPack` to `afterSign` and document Authenticode-before-VMP order plus the unsigned-uninstaller known gap.

#### Before → after pipeline sketch

Current (`package.json` `dist:publish`):

```text
build-prod → electron-builder --win --publish always
           → app packaging/sign hooks → NSIS + ZIP + latest.yml/blockmap → draft release
```

Planned (subject to Foundation approval and the user selecting the recommended unsigned-uninstaller v1 scope):

```text
build-prod → electron-builder --win --dir (no Authenticode/VMP)
           → SignPath app-tree request/download (Authenticode)
           → VMP-sign Electron PE
           → electron-builder --prepackaged <signed dir> --win nsis zip --publish never
           → SignPath installer request/download (Authenticode)
           → electron-builder publish --files <signed-installer> <signed-zip> --version <version>
```

### C. Verification

- [ ] On the installed test build, run `Get-AuthenticodeSignature` against `persephone.exe`, `persephone-launcher.exe`, `persephone-snip.exe`, and `mneme.exe`; require `Status = Valid` and the expected SignPath Foundation signer where each binary is in scope.
- [ ] Verify the downloaded `persephone-setup-<version>.exe` reports a valid Authenticode signature. Confirm the installed uninstaller is unsigned for the recommended v1 scope and that the release/process documentation explains the local UAC “Unknown publisher” prompt if elevation is requested. If the user opts into signing it later, verify its signature after install.
- [ ] Verify SignPath artifact metadata restrictions reject a mismatched product name/version and that each signing request is associated with the expected GitHub workflow, commit/tag, branch policy, and human approver.
- [ ] Install and launch the signed build; test Widevine-protected playback (Netflix/Disney+ or the available licensed test) to confirm Authenticode then VMP signing preserved the CDM license.
- [ ] Compare published release asset hashes to local final artifacts. Confirm no unsigned installer is published and that any published `latest.yml` hash/blockmap corresponds to the final signed installer. Confirm update notices still report the latest non-prerelease release.
- [ ] Run a workflow-dispatch draft build and a tag build; confirm both sequential SignPath requests require approval and gate subsequent steps. Confirm each request’s wait timeout is sufficient for the approval window and the final draft/release assets and metadata policy match the documentation.

## Concerns

### Decisions for the user

1. **SignPath eligibility:** ask SignPath whether the complete Persephone product and its required Castlabs ECS main executable are eligible under Foundation rules. If rejected, stop US-1585; there is no partial-signing fallback.
2. **Uninstaller scope:** approve the recommended v1 default of an unsigned NSIS uninstaller, with the UAC publisher limitation documented, or choose the optional SignPath inquiry/design work to sign it.

### Technical findings

1. **Eligibility gate — Castlabs ECS and runtime/build dependencies.** Precedent (web search 2026-10-01): Electron apps are signed through the Foundation — e.g. Super Productivity (Electron 43.5.0) — but none of 95 public repos found depending on `castlabs/electron-releases` uses SignPath, and no public discussion of a Castlabs/Widevine case was found, so this is a first-of-its-kind question. `src/main/main-setup.ts` awaits `components.whenReady()`; the Widevine CDM is downloaded by Castlabs’ component updater at runtime and is not bundled in the submitted app artifact. The shipped runtime is the Castlabs ECS Electron fork (open-source Electron/Chromium with Castlabs patches), and the checked Electron distribution includes `ffmpeg.dll` plus other upstream DLLs; confirm whether the ffmpeg build enables proprietary codecs. VMP signing depends on the closed Castlabs EVS service, which is a build service rather than a bundled component. Ask SignPath whether these facts satisfy its no-proprietary-components and own-binaries conditions, especially signing the required modified-upstream `persephone.exe`. Do not assume the runtime CDM is part of the submitted artifact or that EVS automatically disqualifies the project.
2. **NSIS uninstaller known gap.** Electron-builder 26.15.3 creates an intermediate uninstaller, calls `packager.signIf(uninstallerPath)` before embedding, and deletes the temporary file after installer creation. SignPath’s GitHub action cannot be inserted at that point. For v1, set `win.signExecutable: false` in the prepackaged installer pass and leave custom signer/certificate configuration unset. The source shows `signIf()` returns immediately when `signExecutable` is false; without a configured local signer it does not invoke SignTool. The installed uninstaller remains unsigned; it runs locally so SmartScreen does not apply, while an elevation prompt shows UAC publisher as “Unknown publisher.” This is a documented v1 gap, not a release blocker. Ask SignPath for an approved remote route only if the user chooses to close it.
3. **Two manual approvals per release.** SignPath Foundation requires manual approval for each release signing request. This design submits two sequential requests (app tree, then installer), and `wait-for-completion` defaults to true, so each approval blocks the workflow before its next stage. The action’s default `wait-for-completion-timeout-in-seconds` is 600 seconds; when that expires the action step fails and the workflow cannot continue. The docs do not say timeout cancels the signing request. Set a suitable longer timeout for the expected approval window and ensure an approver is available for both requests.
4. **Authenticode and VMP order.** Never VMP-sign `persephone.exe` before Authenticode. The first build must skip VMP; run VMP only after the signed app artifact returns. Keep VMP final for the Electron PE and verify playback, since subsequent Authenticode edits would invalidate VMP.
5. **Release hashes and differential metadata.** Electron-builder computes `latest.yml` SHA-512 and blockmaps from the installer before a later SignPath signature changes its bytes. The current app has no `electron-updater` consumer. Keep stale metadata out of both tag releases and manual drafts.
6. **Electron-builder custom hook feasibility.** Version 26.15.3 exposes `win.signtoolOptions.sign` as a sync/async custom callback, but it expects a per-file signing operation. The GitHub action requires an Actions-uploaded artifact id and exchanges whole artifacts, so it cannot be used synchronously from that callback. SignPath’s Windows KSP docs identify Code Signing Gateway availability, not the Foundation action flow; do not assume KSP solves this Foundation pipeline.
7. **Foundation certificate reputation.** Acceptance is discretionary and requires a project with verifiable release history. Signing does not guarantee immediate SmartScreen reputation; describe the benefit accurately as publisher identity/integrity and a path to reputation rather than a promise to remove all first-run warnings.
8. **Yearly artifact-size quota — sign only selected releases.** Foundation subscriptions carry a
   yearly cap on submitted artifact bytes (`yearlyMaxSizeOfArtifactsInBytes`; monthly reset ended
   with SignPath 1.200.2, 2025-11-18). Super Productivity, an Electron app signed through the
   Foundation, exhausted it at ~900 MB per release × ~156 tags a year and was blocked until its
   anniversary; a quota rejection surfaces in CI only as `Invalid request to SignPath API.`
   ([issue](https://github.com/SignPath/github-action-submit-signing-request/issues/15)). Persephone
   v5.0.6 ships a 150 MB installer and a 204 MB ZIP, so one signed release costs roughly 350 MB
   (app tree + installer), and 75 releases since 2026-01-24 is ~100 a year — about 35 GB. The
   actual cap is not published; ask SignPath at onboarding. Plan to sign only deliberate releases
   (not every patch tag) behind a workflow input, and keep unsigned patch releases possible.

## Acceptance Criteria

- [ ] SignPath Foundation accepts the complete Persephone product and permits signing the required `persephone.exe`; if rejected, stop this task without partially signing only the Rust tools or installer.
- [ ] A Foundation-compatible process demonstrably signs `persephone.exe`, all three shipped Rust executables, and the NSIS installer, with VMP still valid after Authenticode; the recommended v1 uninstaller remains unsigned and its UAC limitation is documented.
- [ ] GitHub Actions submits only workflow-built artifacts, downloads signed results, waits for both human approvals within configured timeouts, and publishes only intended final signed assets for tags and workflow-dispatch drafts.
- [ ] SignPath artifact configurations enforce Persephone product metadata on signed files and exclude upstream Electron/Chromium binaries per Foundation guidance.
- [ ] README, release/download surface, and code-signing policy satisfy current Foundation policy content requirements; team MFA and roles are configured.
- [ ] Installer signature/hash metadata is consistent, the release process doc describes the signed flow and approval waits, and installed Authenticode checks plus Widevine playback pass.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/code-signing-policy.md` | Add required public policy and team/privacy details. |
| `README.md` | Add a **Code signing policy** section/link. |
| `.github/workflows/publish.yml` | Stage build, app signing, VMP, installer signing, approval, and final artifact publication. |
| `package.json` | Replace single-step publish script with staged build/sign/publish scripts. |
| `electron-builder.yml` | Support unpacked and prepackaged stages while preserving NSIS, ZIP, resources, and Rust binaries. |
| `scripts/vmp-sign.mjs` | Expose a callable VMP operation for the post-Authenticode app directory; retain hook/local usage as needed. |
| `.github/signpath/` | Add XML artifact configurations for app tree and installer, after sampling the real artifact layout. |
| `doc/standards/release-process.md` | Document SignPath approval, draft/tag process, signature verification, and post-sign metadata behavior; correct VMP hook name. |
| `doc/active-work.md` | Track this task under Planned. |
