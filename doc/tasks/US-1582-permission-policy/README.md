# US-1582: Permission policy for the app and browser pages

## Status

**Status:** Planned — placeholder, needs investigation before implementation
**Priority:** High
**Epic:** None (standalone)

## Goal

Stop granting every permission silently. Persephone's own renderer gets only the permissions it
actually uses; browser pages follow a Chrome-like policy where sensitive permissions ask the user,
and permission queries report the same states real Chrome reports.

## Background (verified 2026-10-01)

- No code in `src/` calls `setPermissionRequestHandler`, `setPermissionCheckHandler` or
  `setDevicePermissionHandler`, so Electron's default (grant everything) applies to every session.
- On a normal browser page, `navigator.permissions.query()` returns `granted` for notifications,
  camera, microphone, geolocation and clipboard-read, and `Notification.permission` is `granted`.
  Real Chrome returns `prompt` / `default`.
- Consequences: any site can use camera, microphone and location without asking (privacy and
  security gap); the all-granted fingerprint is a plausible reason Cloudflare-style bot checks loop
  in Persephone (the loop reproduces on a fresh browser page no agent touched).

## Scope to investigate

1. **App renderer (Persephone's own window and board frames):** inventory the permissions the app
   really uses (clipboard read/write, fullscreen, notifications, …); grant exactly those, deny the
   rest (camera/microphone are not used).
2. **Browser sessions (`persist:browser-*`, incognito, Tor partitions):** a Chrome-like policy:
   - grant silently what Chrome grants without a prompt (e.g. fullscreen, sanitized clipboard
     write, Widevine `mediaKeySystem` — required for DRM video, must keep working);
   - ask the user for camera, microphone, geolocation, notifications, clipboard-read, MIDI SysEx,
     etc., via a permission prompt tied to the browser page (site origin, Allow / Block,
     remember per site per profile; incognito/Tor decisions not persisted);
   - deny device APIs (HID, serial, USB, Bluetooth) unless there is a reason to support them;
   - the permission-check handler must report `prompt` for undecided permissions so
     `navigator.permissions.query()` / `Notification.permission` match Chrome.
3. A way to review and reset remembered site permissions (Settings → Browser profiles, or the
   browser page's site-info UI).
4. Behaviour for board frames and popups (`did-create-window`) opened from browser pages.

## Acceptance criteria (draft)

- [ ] Fresh browser page: `navigator.permissions.query` / `Notification.permission` report Chrome's
      default states.
- [ ] Camera/microphone/location/notifications ask the user; the answer is remembered per site
      for normal profiles only.
- [ ] Video fullscreen, DRM playback and clipboard features of the app keep working.
- [ ] The app renderer is granted only the permissions it uses.

## Files Changed Summary

| File | Change |
|---|---|
| _to be determined by investigation_ | |
