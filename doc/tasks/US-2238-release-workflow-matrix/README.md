# US-2238: Release workflow matrix

Epic: [EPIC-216](../../epics/EPIC-216.md) · Status: planned

## Goal

Build Linux release packages in CI and attach them to the Windows draft release, with a checked glibc ceiling and no Linux update assets. Keep the Windows job intact and exercise the workflow only against an isolated throwaway draft during this epic.

## Background

- `.github/workflows/publish.yml` runs on `v*` tag pushes and manual dispatch. Its `build` job uses `windows-latest`, builds the launcher, snip tool and Mneme, installs Node 20 dependencies, installs Python and Castlabs EVS, and runs `npm run dist:publish` with the EVS secrets. On tag pushes only, its Bash cleanup removes `latest.yml` and all `.blockmap` assets. Dispatch drafts retain them. `electron-builder.yml` sets GitHub `releaseType: draft`.
- US-2234's working-tree `electron-builder.yml` configures x64 `deb` and `AppImage` targets, Linux helper payloads and artifact names; `package.json` provides `dist:linux`. `doc/linux-development.md` describes building both helpers first, `npm ci`, and the explicit Castlabs Electron download. The `afterSign` VMP hook does not run for Linux targets; the Linux job needs no EVS secrets.
- `.github/workflows/linux-ci.yml` uses Node 24.22.3, installs Ubuntu runtime/build packages, runs `npm ci` and `node node_modules/electron/install.js`. Its root-owned mode 4755 `chrome-sandbox` step is for running the UI suite on the runner, not packaging; do not copy it into the release build. The packaged sandbox is handled by US-2235.
- Release builds must use `ubuntu-24.04`, glibc 2.39: Ubuntu 26.04's glibc 2.43 produces a Mneme that fails on Debian 13's 2.41. Local 26.04 packages are for local checks, not release.
- The installed `node_modules/electron-publish/out/gitHubPublisher.js` derives `v<package version>`, lists releases, matches either that tag or the bare version, and reuses a matching draft. With `--publish always` it creates a draft if none is found. Two simultaneous creators can race. The Linux job will instead depend on `build`, confirm exactly one matching draft, and upload to that existing release only; a missing or non-draft release is an error. This also prevents Linux uploading before the glibc check.
- In the installed builder, `app-builder-lib/out/targets/appimage/appImageUtil.js` appends the blockmap **inside** the AppImage; `AppImageTarget.js` and `FpmTarget.js` request update metadata, and `publish/updateInfoBuilder.js` names the stable x64 Linux channel file `latest-linux.yml`. A prerelease may use another channel. A separate AppImage `.blockmap` is not emitted by this installed implementation; verify the actual draft asset listing in the CI run rather than assuming a different builder's behavior. The app has no auto-updater.

## Implementation Plan

- [x] Complete US-2234–US-2236 first. In `.github/workflows/publish.yml`, add a sibling `linux` job with `needs: build`, `runs-on: ubuntu-24.04`, and job-level `permissions: contents: write`. The **only** changes to the existing Windows job are none: no line in its job, steps, conditions, environment or scripts is touched. The top-level triggers are also unchanged. This is two serialized platform jobs, not a GitHub matrix that would rewrite the Windows job.

  Before → after at the job boundary:

  ```yaml
  jobs:
    build:
      runs-on: windows-latest
  ```

  ```yaml
  jobs:
    build:
      runs-on: windows-latest
      # existing job continues unchanged
    linux:
      needs: build
      runs-on: ubuntu-24.04
      permissions:
        contents: write
  ```

- [x] In that new job, use `actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, and `actions/setup-node@v4` with `node-version: '24.22.3'` and npm cache. Install the applicable build/runtime packages from `.github/workflows/linux-ci.yml` (`libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libsecret-1-0 build-essential curl xz-utils fonts-noto-core`), plus `file` and `binutils` for inspection. No X server, desktop test tools, sandbox chmod, Python, VMP flags or EVS secrets. Run `npm ci`, `node node_modules/electron/install.js`, `cargo build --release --manifest-path mneme/Cargo.toml`, and the equivalent command for `snip-tool/Cargo.toml`; explicitly verify both expected helper files exist before packaging, since builder otherwise warns and continues.
- [x] Run `npm run build-prod` once and build with `npx electron-builder --linux deb AppImage --x64 --publish never`. The single CLI target list owns release format selection; to drop AppImage after the US-2235 decision, remove `AppImage` from this list and its one corresponding upload entry, and update the expected asset documentation. Leave the local `dist:linux` targets alone. The commands differ from today's Windows command as follows:

  ```text
  Before (Windows): npm run dist:publish
  After (new Linux job): npm run build-prod; npx electron-builder --linux deb AppImage --x64 --publish never
  ```

  `--publish never` intentionally avoids publishing anything before verification; upload the two explicit package files afterwards with `gh`, not a glob of `release/`.
- [x] Still in `.github/workflows/publish.yml`, after packaging and before any upload, inspect every regular ELF under `release/linux-unpacked` (including unpacked native modules and helpers) using `file` and `objdump -T`. Extract only **undefined** `GLIBC_<numeric version>` requirements, compare numeric components to 2.39, print offending path and symbol/version, and fail on any greater version or inspection failure. Handle filenames safely, fail if no ELF or either helper was inspected, and do not mistake `GLIBCXX` for `GLIBC`. Also extract the AppImage without executing the app (`--appimage-extract` in an isolated directory) and inspect its ELF payload/runtime libraries by the same rule, including any ELF absent from `linux-unpacked`; inspect the AppImage runtime ELF itself as well. This check owns the release glibc rule in the workflow; reuse system `file`/`objdump`, with no application protocol or new test harness. The Debian package uses `linux-unpacked` as its payload; confirm that assumption against the generated `.deb` and inspect any additional ELF found there.
- [x] Read the version from `package.json`. With `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, list releases through the GitHub API including pagination, select `tag_name` equal to `v<version>` or `<version>`, and require exactly one result with `draft: true`. Use its actual tag/release ID; never create a release or overwrite a published release. `gh release upload` the exact `release/persephone-<version>-linux-amd64.deb` and `release/persephone-<version>-linux-x86_64.AppImage` to that draft, failing on missing files or upload errors. Record the release ID and asset names in the run log; fail if they are not attached to that same draft. Use narrowly scoped replacement of those names if supporting retries, never `--clobber` on unrelated assets.
- [x] List the draft's assets before and after upload. As in Windows cleanup, remove Linux update assets from that draft: `latest-linux.yml`, any actual channel-specific `*-linux.yml`, and any external Linux AppImage `.blockmap` if present. Restrict deletion to Linux metadata; do not delete Windows assets. The explicit upload normally uploads neither metadata nor a separate blockmap, but cleanup handles stale artifacts on retries. Fail on API/deletion errors and verify final asset names; preserve the AppImage's embedded blockmap.
- [x] In Claude's throwaway run, record the actual files generated and uploaded by this builder, including whether channel metadata exists with `--publish never`.
- [x] Update `doc/standards/release-process.md`: list Windows setup/ZIP and the enabled Linux assets, state Linux release packages come only from CI on Ubuntu 24.04, and require Claude's install check in the clean Ubuntu 26.04 and Debian 13 VMs from `doc/linux-development.md` § “Clean install VMs”, restoring `clean` before each format/check and running one VM at a time. Keep the user-controlled publication stop. Replace the current test-build instructions that reuse the real package version with the isolated procedure below, and explain Windows dispatch metadata remains until the draft is deleted.
- [x] Update `.claude/skills/release/SKILL.md` verification: before the user publishes, inspect the draft for both Windows assets and each enabled Linux asset and require the clean-VM install checks; after publication verify those same assets and `isDraft: false`. Continue pointing to the canonical release process rather than duplicating its procedure. Explicitly say Linux release packages are CI-built.
- [x] Verify Windows packaging per EPIC-216 decision 5: Claude's dispatch run builds the unchanged Windows installer and ZIP; inspect the run and draft for the usual `persephone-setup-<version>.exe` and Windows portable ZIP, signing step, and expected dispatch metadata. Compare their naming and steps to the existing workflow. No unit tests or test harnesses.
- [x] Claude performs the manual CI check and cleanup. On a disposable branch containing the completed workflow and dependencies, choose a unique valid semver prerelease such as `<next-version>-ci.us2238.<unique-number>`; change **both** `package.json` and `package-lock.json` with `npm version <version> --no-git-tag-version`, commit and push that disposable branch. Confirm neither `v<version>` nor `<version>` already identifies a release or tag. Do not change the real upcoming branch version, push a tag, merge the disposable version commit, or publish the draft. Then run:

  ```bash
  gh workflow run publish.yml --repo andriy-viyatyk/persephone --ref <disposable-branch>
  gh run list --repo andriy-viyatyk/persephone --workflow publish.yml --branch <disposable-branch>
  gh run watch <run-id> --repo andriy-viyatyk/persephone --exit-status
  ```

  Inspect logs and the draft's `tag_name`, `isDraft`, assets and glibc results with `gh release view v<test-version> --repo andriy-viyatyk/persephone --json tagName,isDraft,assets` (use the actual matching tag if bare). Confirm exactly one draft, both jobs and enabled packages, Linux metadata absence, and no effect on the real next release. Claude deletes that **identified draft only** after recording results; if a test tag was unexpectedly created, stop and investigate rather than deleting it automatically. Then Claude deletes the disposable remote branch with `git push origin --delete <disposable-branch>`. The unique prerelease version, separate branch and absence of a pushed release tag make this draft throwaway. If a job fails, record the failure and safely remove the identified test draft and disposable remote branch before a fresh unique-version retry.

## Concerns

- AppImage remains enabled pending the US-2235 decision. Removing it later is limited to the Linux target list and matching upload entry, plus the documented expected assets. US-2236 supplies the Linux hook behavior. Do not publish a release during this task.
- Draft serialization prevents the two jobs in one run racing. Avoid concurrent runs for the same version: the maintainer must check for an existing run/draft before starting; a rerun must confirm the draft is still a draft. An interrupted Windows job can leave a partial draft for manual inspection.
- The GLIBC check is a symbol-version ceiling, not proof that other library dependencies or desktop integration work. The clean VM checks remain necessary. AppImage extraction and `objdump` behavior must be verified in the actual CI run, and errors must fail closed.
- Linux runs only after successful Windows publication to the draft, so a Windows failure prevents Linux packaging. This is intentional to avoid concurrent draft creation. Dispatch does not exercise the Windows tag-only cleanup; preserve its existing condition and inspect it separately.

## Acceptance Criteria

- [x] The new Linux job uses `ubuntu-24.04`, builds both helpers and enabled x64 formats, and fails before upload if any packaged ELF requires a GLIBC version above 2.39 or cannot be inspected. (Workflow implemented; dispatch verification pending.)
- [x] A single existing draft contains the unchanged Windows assets and `persephone-<version>-linux-amd64.deb` plus, if retained, `persephone-<version>-linux-x86_64.AppImage`; no Linux update metadata or external Linux blockmap is attached. Actual generated/uploaded files are recorded from the run.
- [x] No Windows job line changes; Linux receives no EVS secrets. The Windows build and asset names are verified by Claude.
- [x] Release process and release skill describe enabled Linux assets, CI-only Linux release builds, clean Ubuntu/Debian install checks, and the isolated dispatch draft procedure. No public release is made.
- [x] Claude's branch dispatch confirms both jobs, draft identity, asset listing and cleanup; Claude deletes the identified throwaway draft and disposable remote branch. No test harness or unit tests are added.

## Files Changed

| Path | Planned change |
|---|---|
| `.github/workflows/publish.yml` | Add serialized Linux build, glibc gate and draft upload/cleanup; existing Windows job untouched. |
| `doc/standards/release-process.md` | Document assets, CI provenance, VM checks and isolated draft testing. |
| `.claude/skills/release/SKILL.md` | Extend release verification and refer to the canonical procedure. |
| `doc/tasks/US-2238-release-workflow-matrix/README.md` | Track implementation and verified CI findings. |

No changes: `electron-builder.yml`, `package.json`, `scripts/vmp-sign.mjs`, `.github/workflows/linux-ci.yml`, `doc/linux-development.md`, the epic table or dashboard. The temporary version changes for the dispatch live only on the disposable branch and are not part of the implementation.

## Dispatch check (Claude, 2026-11-27)

The AppImage was dropped before the run (US-2235, user decision): the job builds and uploads only the `.deb`.

- Disposable branch `ci-us2238-throwaway` (the working tree plus a `5.0.23-ci.us2238.1` version commit), dispatched
  as run 45970376591: `build` (Windows) and `linux` both succeeded.
- One draft, `v5.0.23-ci.us2238.1`, held `persephone-setup-5.0.23-ci.us2238.1.exe` (+ `.blockmap`),
  `persephone-5.0.23-ci.us2238.1-win.zip`, `latest.yml` (kept on dispatch, removed on tag runs, as before) and
  `persephone-5.0.23-ci.us2238.1-linux-amd64.deb`. No `latest-linux.yml` or Linux blockmap was uploaded.
- GLIBC gate: 9 ELF files in `linux-unpacked` (both helpers) and 9 in the `.deb` payload, all at or below 2.39.
- The CI `.deb` passed the install checks in both clean VMs (US-2240); `mneme` runs on Debian 13.
- No tag was created. Claude deleted the draft, the remote branch and the local worktree.
