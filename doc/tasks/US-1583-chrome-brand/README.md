# US-1583: Browser brands match Chrome

## Status

**Status:** Planned — placeholder, needs investigation before implementation
**Priority:** Medium
**Epic:** None (standalone)

## Goal

Make browser pages report the same browser brands as Google Chrome, so the User-Agent string and
User-Agent Client Hints agree.

## Background (verified 2026-10-01)

- `cleanUserAgent` in `src/main/browser-service.ts` strips `persephone/…` and `Electron/…` from the
  User-Agent string, leaving `… Chrome/150.0.7871.46 Safari/537.36`.
- Client Hints still describe plain Chromium: `navigator.userAgentData.brands` is
  `[{ "Not;A=Brand", "8" }, { "Chromium", "150" }]` with no `Google Chrome` entry, and the
  `Sec-CH-UA` request headers say the same. Real Chrome lists `Google Chrome` too.
- The mismatch is a possible bot-check signal (Cloudflare loops) alongside the permission defaults
  in [US-1582](../US-1582-permission-policy/README.md).

## Scope to investigate

1. How to set brand metadata: CDP `Emulation.setUserAgentOverride` with `userAgentMetadata` (per
   webContents, needs the debugger — conflicts with automation's `cdp-service.ts` attachment and
   is itself detectable), `webContents.setUserAgent`, Chromium command-line switches or features,
   or anything Electron/Castlabs exposes at session level. Prefer a session-level mechanism that
   needs no debugger.
2. Consistency: `navigator.userAgentData.brands`, `getHighEntropyValues()` (`fullVersionList`,
   `platformVersion`, …), `Sec-CH-UA*` headers on navigations and subresources, workers and
   popups must all agree with the UA string.
3. Keep the Google sign-in fix (clean UA) working; incognito and Tor pages included.

## Acceptance criteria (draft)

- [ ] `navigator.userAgentData.brands` and `Sec-CH-UA` include `Google Chrome` with the same major
      version as the UA string, in pages, workers and popups.
- [ ] `getHighEntropyValues(["fullVersionList"])` matches.
- [ ] No debugger attachment is required for normal browsing.

## Files Changed Summary

| File | Change |
|---|---|
| _to be determined by investigation_ | |
