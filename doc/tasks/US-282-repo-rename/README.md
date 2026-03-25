# US-282: GitHub Repo Rename — js-notepad → persephone

**Epic:** EPIC-013
**Status:** Planned
**Created:** 2026-03-25

## Goal

Rename the GitHub repository from `andriy-viyatyk/js-notepad` to `andriy-viyatyk/persephone` and update all local references.

## Prerequisites

- US-280 (Core rebrand) — Done
- US-281 (Doc rebrand) — Done
- All code and docs already reference `andriy-viyatyk/persephone` URLs

## Implementation Plan

### Step 1: Rename repo on GitHub (manual)

- [ ] Go to https://github.com/andriy-viyatyk/js-notepad/settings
- [ ] Under "Repository name", change `js-notepad` to `persephone`
- [ ] Click "Rename"
- [ ] GitHub automatically redirects all old URLs to the new name

### Step 2: Update local git remote

- [ ] Run: `git remote set-url origin https://github.com/andriy-viyatyk/persephone.git`
- [ ] Verify: `git remote get-url origin` shows the new URL
- [ ] Verify: `git fetch` works

### Step 3: Update `.mcp.json` (if needed)

- [ ] Already updated in US-280 — verify server key is `"persephone"`

### Step 4: Update local project folder (optional)

- [ ] Consider renaming `D:\projects\js-notepad` → `D:\projects\persephone`
- [ ] Update any local config, shell aliases, or IDE workspace files that reference the old path
- [ ] Update Claude Code memory files if they reference the old path

### Step 5: Verify

- [ ] `git push` works to the new remote
- [ ] GitHub Pages (if used) works at the new URL
- [ ] Old URLs (`github.com/andriy-viyatyk/js-notepad`) redirect correctly
- [ ] `electron-builder.yml` publish config (`repo: persephone`) matches
- [ ] Version check API URL in `version-service.ts` resolves correctly

## Notes

- GitHub automatically sets up redirects from old repo URL → new repo URL. Existing clones, links, and bookmarks will continue to work.
- The `gh` CLI is not installed, so Step 1 must be done manually in the browser.
- Old `git clone` URLs will still work due to GitHub redirects, but it's best practice to update the remote.

## Acceptance Criteria

- [ ] Repo accessible at `github.com/andriy-viyatyk/persephone`
- [ ] Local remote updated
- [ ] `git push` succeeds to new URL
- [ ] Old URL redirects to new URL
