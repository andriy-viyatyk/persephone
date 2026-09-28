# US-1557: Per-profile browser network — proxy settings, with a WSL-hosted VPN container as the first backend

**Status:** Completed 2026-09-28 · standalone (no epic)  
**Scope:** Part A environment runbook (done by the user), Part B per-profile proxy (implemented). App-wide proxy is [US-1559](../US-1559-global-app-proxy/README.md).

## Goal

Allow each persistent Persephone browser profile to use either its normal direct network or a configured proxy, so every request made on that profile's behalf uses that route and DNS does not leak to the computer's default resolver. The first intended proxy endpoint is a SOCKS5/HTTP listener in a small Linux environment under WSL2 whose VPN tunnel is confined to WSL and protected by a kill switch.

## Background

### Existing browser/session path

- [`BrowserProfile`](../../src/renderer/api/settings.ts#L17) currently stores `name`, `color`, and optional `bookmarksFile`; `browser-profiles` is an app setting in that file. [`BrowserProfilesSectionModel`](../../src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts#L30) adds, edits, and removes profile objects, and [`BrowserProfilesSection`](../../src/renderer/editors/settings/sections/BrowserProfilesSection.ts#L346) renders the settings section, profile rows, default profile, Incognito, and Tor controls. There is no per-profile network editor or proxy field today.
- [`getPartitionString`](../../src/renderer/editors/browser/BrowserEditorModel.ts#L328) maps ordinary profiles to `persist:browser-${profileName || "default"}`; Incognito and Tor pages instead receive unique in-memory partitions. [`BrowserEditor.partition`](../../src/renderer/editors/browser/BrowserEditor.ts#L97) delegates to `BrowserTorModel`, which derives the partition from editor state in [`BrowserTorModel.partition`](../../src/renderer/editors/browser/BrowserTorModel.ts#L27).
- [`browser-service.ts`](../../src/main/browser-service.ts#L656) resolves the supplied partition through `session.fromPartition` for clear-profile-data and clear-cache operations; it does not currently apply any browser-profile proxy settings.
- [`BrowserWebviewItemView`](../../src/renderer/editors/browser/BrowserView.ts#L64) creates a `<webview>`, sets its URL and partition, then connects it. [`browser-pages.ts`](../../src/renderer/editors/browser/browser-pages.ts#L72) restores the editor and, for Tor only, awaits proxy arming before adding/mounting the page; if arming fails it refuses to open. This is the established fail-closed ordering to extend to configured profile proxies.
- [`tor-service.ts`](../../src/main/tor-service.ts#L349) sets `proxyRules: "socks5://127.0.0.1:${this.socksPort}"`, sets `proxyBypassRules: ""`, and awaits `closeAllConnections()`; clearing the proxy also closes connections ([lines 358–365](../../src/main/tor-service.ts#L358)). The Tor proxy is session-scoped. [`checkIp`](../../src/main/tor-service.ts#L269) calls `session.fromPartition(partition).fetch(...)` in main, because renderer-side fetch would use the wrong session; reuse this pattern for a proxied-profile “Check IP” action.
- The Tor IPC contract is in [`src/ipc/tor-ipc.ts`](../../src/ipc/tor-ipc.ts), and handlers are registered from [`src/main/main-setup.ts`](../../src/main/main-setup.ts#L91) by `initTorHandlers()` / `initBrowserHandlers()`. Browser guest webContents registration resolves the supplied ID with `webContents.fromId()` in [`browser-service.ts`](../../src/main/browser-service.ts#L193); that registration is sent at `dom-ready`, so it is too late for a guest WebRTC policy (see Part B step 6).
- [`tools-editors-registry.ts`](../../src/renderer/ui/sidebar/tools-editors-registry.ts#L146) creates direct, Incognito, Tor, and one tool per configured profile. [`PageCollectionWrapper.showBrowserPage`](../../src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts#L310) accepts `profileName`, `incognito`, `tor`, and `url`; a selected profile should automatically use its saved network choice. Initial scope adds no script API to set network policy.

### Verified traffic paths and leak points

| Traffic path | Current behavior found in source | Plan implication |
|---|---|---|
| Browser page requests, redirects, downloads | Browser page loads run in the assigned webview partition. `DownloadService` hooks each Electron session's `will-download` event ([`download-service.ts`](../../src/main/download-service.ts#L37)), so browser downloads belong to that session and inherit its proxy. | Keep webview and downloads on the profile session; confirm with manual download test. |
| IP check | Tor check runs in main via the partition's `Session.fetch` ([`tor-service.ts`](../../src/main/tor-service.ts#L263)). | Reuse the partition-session check; do not use renderer `fetch`. |
| Browser tab favicon display | Main relays `page-favicon-updated`; `BrowserView.handleFavicon` stores the remote favicon URL ([`BrowserView.ts`](../../src/renderer/editors/browser/BrowserView.ts#L179)). `BrowserTabsPanel.renderFavicon` assigns that URL to an `<img>` in the host renderer ([`BrowserTabsPanel.ts`](../../src/renderer/editors/browser/BrowserTabsPanel.ts#L60)), so this second image request is not issued by the profile guest session. | Feed an icon already obtained/cached through the profile Session, or resolve it through an opaque session-backed resource URL. |
| Bookmark favicon persistence | [`favicon-cache.ts`](../../src/renderer/components/icons/favicon-cache.ts#L100) downloads an image using raw Node `http`/`https` in the renderer. It is requested from browser/bookmark flows ([`BrowserView.ts`](../../src/renderer/editors/browser/BrowserView.ts#L179), [`BrowserBookmarksUIModel.ts`](../../src/renderer/editors/browser/BrowserBookmarksUIModel.ts#L229)). Tor and Incognito paths explicitly skip it; ordinary profile pages do not. | This is a confirmed direct-network leak for proxied profiles. Replace with a main/session-owned fetch or profile-session response bytes before caching. |
| Link editor bookmark/preview images | The browser's blank-tab bookmarks use the Link editor. `resolveTorSrc` routes rendered remote `<img>` resources through `tor-src://` only when a Tor proxy descriptor exists ([`tor-src.ts`](../../src/renderer/editors/link-editor/tor-src.ts#L1)); `session-src://` already has an opaque handle bound to a supplied Electron `Session` and fetches through `entry.session.fetch` ([`session-src-protocol.ts`](../../src/main/session-src-protocol.ts#L33), [lines 121–132](../../src/main/session-src-protocol.ts#L121)). Standard proxied profiles have neither route today, so regular image previews load from the host renderer. | Generalize session-backed image resolution for any profile session; retain the Tor route or migrate it onto the common session capability without weakening its active-Tor checks. Archive images in `pipe-image-src.ts` are local content-pipe reads, not network requests. |
| `*-src` and app protocols | `session-src://` uses the exact Session registered for a one-URL capability. `tor-src://` fetches through the Tor partition's Session ([`tor-src-protocol.ts`](../../src/main/tor-src-protocol.ts#L66)). `app-asset://` reads bundled files using `net.fetch(fileUrl)` ([`main-setup.ts`](../../src/main/main-setup.ts#L99)); `board://` serves local board files from the host session ([`board-protocol-service.ts`](../../src/main/board-protocol-service.ts#L327)). | Keep local asset/file schemes local. Any remote resource scheme used by a profile page must carry an opaque profile-session capability; never accept a renderer-supplied partition name as authority. |
| Renderer-side page script/context-menu reads | `BrowserWebviewModel` and `webview-context-menu.ts` execute `fetch(location.href)` inside the browser guest via `webview.executeJavaScript`, so these page-origin reads use the guest's browser context/session ([`BrowserWebviewModel.ts`](../../src/renderer/editors/browser/BrowserWebviewModel.ts#L499), [`webview-context-menu.ts`](../../src/renderer/editors/browser/webview-context-menu.ts#L226)). | Preserve execution inside the guest. Audit any newly introduced renderer `fetch` before treating it as profile traffic. |

Chromium's SOCKS5 URL requests resolve their target hostnames at the proxy, but DNS prefetch can still produce local DNS requests; therefore applying a SOCKS proxy alone does **not** satisfy this task. Disable/contain DNS prefetch for proxied browser contexts and verify on the wire. Chromium also has implicit proxy bypass rules for localhost and link-local targets; `<-loopback>` subtracts those implicit rules. For strict profile isolation, use an explicit no-fallback proxy configuration and decide whether localhost/link-local web destinations must also be forced through it. Do not append `direct://` as a fallback. Sources: [Chromium SOCKS proxy and DNS behavior](https://www.chromium.org/developers/design-documents/network-stack/socks-proxy/), [Chromium implicit bypass and `<-loopback>` semantics](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md), [Electron `Session.setProxy`](https://www.electronjs.org/docs/latest/api/session).

For proxied profile guest pages, set `webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")`; Electron documents that this hides public/local IPs and restricts WebRTC to TCP unless the proxy supports UDP. Apply it to the guest webContents created for the profile, not the parent Persephone window. Source: [Electron `webContents`](https://www.electronjs.org/docs/latest/api/web-contents).

Chromium does not support authentication methods for SOCKS5 proxies, while HTTP proxy authentication is supported; Electron exposes the webContents/app `login` event with `authInfo.isProxy` and a credential callback ([Chromium proxy authentication](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md), [Electron `webContents` login event](https://www.electronjs.org/docs/latest/api/web-contents#event-login)). This repository has no existing `safeStorage` integration (`rg safeStorage src` found none) and ordinary settings are persisted app settings. Recommend deferring authenticated proxy credentials: initial UI supports unauthenticated SOCKS5 and HTTP endpoints only; never place a password in `browser-profiles`. If credentials become required, add a main-owned secret store backed by Electron `safeStorage` and scoped retrieval through IPC. VPN configuration and credentials remain user-owned files on disk and are never pasted into chat or committed.

## Implementation Plan

### Part A — WSL2 environment setup and manual test runbook (no Persephone code)

Record and execute these steps before implementation, with the user operating the elevated/reboot/configuration steps. The current laptop was checked: Windows 11 Enterprise, WSL is not installed (`wsl --status` reports not installed), a hypervisor is present, and the agent shell is not elevated. Enterprise IT policy may block enabling WSL/virtualization; if installation is denied, stop and resolve policy with the user/IT. Microsoft documents default WSL2 NAT and host-to-guest localhost forwarding ([WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking), [`localhostForwarding`](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#configuration-settings-for-wslconfig)). Keep WSL in default NAT mode; do not enable mirrored networking.

1. **User, elevated PowerShell + reboot:** run `wsl --install --no-distribution`, allow Windows to enable the WSL/Virtual Machine Platform features, then reboot when asked. Run `wsl --status` afterward and verify WSL2 is available. This is the only Windows admin step in the basic setup.
2. **User chooses a Linux distro:** install Ubuntu with `wsl --install -d Ubuntu` (or another supported Ubuntu release), or import a minimal Alpine rootfs with `wsl --import` if an Alpine rootfs is available. Start it once and create its Linux user. No Docker installation is required or permitted for this design.
3. Install one small proxy daemon (for example `microsocks` or Dante) inside WSL. Configure it to bind only to Linux loopback on port `1080`; Windows access should use `127.0.0.1:1080` via WSL2 localhost forwarding. Verify with Windows `Test-NetConnection 127.0.0.1 -Port 1080` and check the WSL setting `localhostForwarding` if this fails. Keep the proxy listener unauthenticated and loopback-only for the initial manual experiment.
4. **Baseline, before VPN:** from Windows run `curl.exe --socks5-hostname 127.0.0.1:1080 https://api.ipify.org` and `curl.exe https://api.ipify.org`. Confirm the SOCKS request succeeds and both show the same public IP (expected before VPN). `--socks5-hostname` is intentional: it asks the SOCKS proxy to resolve the target hostname remotely. Also check that WSL proxy logs show the request.
5. **User supplies VPN configuration later:** place the VPN configuration file in a user-controlled WSL/Linux path (or a protected Windows path accessed from WSL) and enter credentials only in that file/secure prompt. Do not paste credentials into chat, task docs, shell transcripts intended for sharing, or the repository. Choose one client based on the supplied provider format (WireGuard, OpenVPN, or openconnect); do not assume all providers support the same Linux client.
6. Start the VPN client inside WSL and verify that its tunnel interface is `tun0` (or record the actual interface). Configure the proxy's egress so its outbound traffic routes through the tunnel, while allowing only the VPN endpoint/bootstrap traffic over the underlying WSL NAT interface.
7. Add a Linux firewall kill switch (iptables/nftables as supported by the distro): allow loopback, established traffic, VPN endpoint traffic needed to establish/re-establish the tunnel, and outbound traffic on the VPN interface; reject other WSL egress. Set the WSL resolver to the VPN provider's resolver and ensure DNS from the proxy/VPN environment uses that resolver through the tunnel. Confirm firewall policy persists/reapplies after distro restart; a stopped tunnel must leave proxy requests failing closed.
8. **Manual acceptance:** repeat the SOCKS and direct IP checks. Proxied IP must match the VPN exit and differ from direct Windows IP. Query a DNS leak test while using `curl --socks5-hostname` and inspect a packet capture/firewall counters or DNS leak service: no query for the tested destination may reach the Windows/default ISP resolver; the observed resolver must be the VPN resolver. Stop the VPN and verify SOCKS requests fail instead of showing the direct IP. Restart WSL and verify the intended firewall, resolver, VPN, and proxy startup order.
9. Keep a short record of distro, proxy port, tunnel interface, VPN client, firewall approach, and observed checks, with secrets and private keys omitted. [Gluetun](https://github.com/qdm12/gluetun) is a reference design for VPN + kill-switch behavior only; it is a Docker image and is **not** part of this no-Docker setup.

#### Test environment as built (2026-09-28)

The user has no VPN provider they trust, so steps 5–7 use a **local test VPN** that behaves like a real one (tunnel-only egress, provider resolver, kill switch) but exits through the laptop's own public IP. Swapping in a real provider later changes only the server side; Persephone sees the same `127.0.0.1:1080` SOCKS5 endpoint either way.

| Item | Value |
|---|---|
| WSL | 2.7.14, kernel 6.18.33.2, default NAT networking, localhost forwarding on |
| `%USERPROFILE%\.wslconfig` | `[general] instanceIdleTimeout=-1`, `[wsl2] networkingMode=nat`, `localhostForwarding=true`, `vmIdleTimeout=-1` — without the idle timeouts the distro stops ~15 s after the last `wsl.exe` session and the proxy disappears |
| Distro | Ubuntu 26.04.1 LTS, systemd |
| Script | [`testvpn.sh`](testvpn.sh) → `/usr/local/sbin/testvpn` (`up`, `down`, `tunnel-down`, `tunnel-up`, `status`, `dns <ip>`); keys generated into `/etc/testvpn/` (0600, never leave WSL) |
| "Provider" (root namespace) | WireGuard `wg-srv` 10.99.0.1/24 on UDP 51820; dnsmasq on 10.99.0.1 (`testvpn-dns.service`, logs queries) forwarding to `DNS_UPSTREAM` from `/etc/testvpn/dns.env` (default 9.9.9.9); `testvpn dns <ip>` switches it after checking the server answers; NAT out `eth0` |
| "Client" (namespace `vpn`) | underlay `veth-cli` 10.200.0.2/30 with a fallback default route (metric 200); tunnel `wg0` 10.99.0.2 as primary default route (metric 50); IPv6 disabled; resolver `/etc/netns/vpn/resolv.conf` → 10.99.0.1 |
| Kill switch | nftables `inet killswitch` in the client namespace: output allows only `lo`, `wg0`, and UDP 51820 to the endpoint; input allows only established traffic and TCP 1080 from 10.200.0.1 |
| Proxy | `microsocks` 1.0.5 in the client namespace on 10.200.0.2:1080 (`microsocks.service`, `NetworkNamespacePath=/run/netns/vpn`) |
| Windows endpoint | `socat` 127.0.0.1:1080 → 10.200.0.2:1080 (`testvpn-forward.service`); Windows reaches it as `127.0.0.1:1080` |
| Startup order | `testvpn` → `testvpn-dns` → `microsocks` → `testvpn-forward`, all `BindsTo=testvpn.service` |

Observed checks:

- Baseline before the tunnel: SOCKS curl from Windows succeeded; proxied IP equalled the direct IP.
- With the tunnel: SOCKS curl → HTTP 200; `wg show` transfer counters grew; a 25 s `tcpdump` on the underlay saw **0** packets other than WireGuard UDP 51820.
- DNS: every hostname the proxy resolved appeared in the dnsmasq log as a query from 10.99.0.2. `edns.ip-api.com` via the proxy reported the Quad9 resolver and no EDNS client subnet; direct Windows reported the default resolver plus the ISP's EDNS subnet.
- Kill switch: `testvpn tunnel-down` left only the underlay default route; SOCKS by hostname and by IP literal both failed and the `blocked egress` counter rose (10 packets); `tunnel-up` restored HTTP 200.
- `wsl --shutdown` then restart: all four units came back `active`, a handshake completed, SOCKS returned HTTP 200.
- Firefox with a manual SOCKS v5 proxy `127.0.0.1:1080` and **Proxy DNS when using SOCKS v5** ticked: ipleak.net reported the Quad9 resolver (i3D.net, Poland). After switching the upstream to the router, the dnsmasq log showed queries forwarded to the router; the switch back to Quad9 also verified. A non-answering server is refused and the previous upstream kept.

#### Using the test VPN

**Start after a Windows restart.** WSL does not start with Windows, and a connection to `127.0.0.1:1080` does not wake it. Run any `wsl` command once — the Desktop shortcut **Start Test VPN** runs `wsl -d Ubuntu -u root -- testvpn status` — and systemd brings up the tunnel, resolver, proxy, and forwarder. Because of the `.wslconfig` idle settings the distro then keeps running until `wsl --shutdown` or a Windows restart; closing the window does not stop it.

**Commands** (PowerShell, `wsl -d Ubuntu -u root -- testvpn <command>`):

| Command | Effect |
|---|---|
| `status` | Current DNS upstream, WireGuard handshake/transfer, client routes, kill-switch counter |
| `tunnel-down` / `tunnel-up` | Simulate the VPN dropping and recovering; with the tunnel down every proxied request must fail |
| `dns <ipv4>` | Switch the provider resolver's upstream; checks the server answers first. Restarts only `testvpn-dns` (about a second); the tunnel and proxy keep running, so nothing needs stopping first |
| `down` / `up` | Tear down / rebuild the namespaces and tunnel (normally done by `testvpn.service`) |

**Switching DNS from Windows.** `%USERPROFILE%\testvpn\Set-TestVpnDns.ps1 -Mode Quad9|Router|Custom`, run by the Desktop shortcuts **Test VPN DNS - Quad9**, **Test VPN DNS - WiFi router**, and **Test VPN DNS - Custom IP** (shows the current upstream and asks for any IPv4 DNS server; empty input cancels). Router mode takes the active network's first non-loopback IPv4 DNS server, falling back to its default gateway: on this laptop Windows resolves through a local `127.0.0.1` client (likely a corporate security agent), which WSL cannot use, so the router is chosen. Browsers cache lookups for about a minute after a switch. Quad9 is the realistic choice for leak testing; a router upstream forwards to the ISP resolver and therefore looks exactly like a DNS leak on ipleak.net.

**Pointing a browser at it.**
- Persephone (after Part B) and Firefox: SOCKS5 host `127.0.0.1`, port `1080`, with proxy-side DNS (Firefox: tick **Proxy DNS when using SOCKS v5**; use a separate profile from `about:profiles` to keep the normal profile direct).
- Chrome: a separate instance, `chrome.exe --proxy-server="socks5://127.0.0.1:1080" --user-data-dir="%LOCALAPPDATA%\ChromeTestVPN"`. The separate `--user-data-dir` is required; otherwise the command joins the running Chrome and ignores the flag. Chrome resolves `socks5://` hostnames through the proxy.
- Check at ipleak.net: DNS must show the configured upstream (Quad9 → i3D.net / WoodyNet), IP shows the real public IP (expected for this local VPN), and with `tunnel-down` pages must fail to load. WebRTC may still reveal the local address — a browser behaviour, not a tunnel leak (Firefox: `media.peerconnection.enabled=false`).

**Rebuild from scratch** (new machine or distro): install Ubuntu (`wsl --install -d Ubuntu --no-launch`), write the `.wslconfig` above, then as root `apt-get install microsocks wireguard-tools nftables socat dnsmasq-base tcpdump bind9-dnsutils`, copy [`testvpn.sh`](testvpn.sh) to `/usr/local/sbin/testvpn`, write `DNS_UPSTREAM=9.9.9.9` to `/etc/testvpn/dns.env`, create the four units listed in the table (`testvpn` oneshot `up`/`down`; `testvpn-dns` running dnsmasq with `EnvironmentFile=/etc/testvpn/dns.env` and `--server=${DNS_UPSTREAM} --listen-address=10.99.0.1 --bind-interfaces --no-resolv --no-hosts --log-queries --user=nobody`; `microsocks -i 10.200.0.2 -p 1080` with `NetworkNamespacePath=/run/netns/vpn` and `BindReadOnlyPaths=/etc/netns/vpn/resolv.conf:/etc/resolv.conf`; `socat TCP-LISTEN:1080,bind=127.0.0.1,fork,reuseaddr TCP:10.200.0.2:1080`), and `systemctl enable --now` all four. Keys are generated on first `up`.

**Remove it:** `wsl --unregister Ubuntu` (deletes the distro and its keys), delete `%USERPROFILE%\.wslconfig`, `%USERPROFILE%\testvpn\`, and the four Desktop shortcuts.

**Future/out of scope:** Persephone launching/stopping the WSL VPN environment using the existing sidecar lifecycle pattern is a later task unless implementation investigation proves it is small and low-risk. First deliver a user-configured endpoint and clear unavailable-proxy error; do not silently start or manage Linux VPN processes in this task.

### Part B — Persephone profile network setting

Revised 2026-09-28 after a second source pass focused on what the Tor mode already provides.

#### What Tor mode gives us, and what it does not

A proxied profile is, at the Chromium level, the same thing as a Tor page: a session with
`setProxy({ proxyRules: "socks5://…", proxyBypassRules: "" })` + `closeAllConnections()`
applied before the webview mounts. The difference is lifetime: a Tor partition is in-memory
and per page, a profile partition is `persist:browser-<name>` and shared by every page of that
profile, in every window, for the whole app run. Electron does not persist `setProxy`, so the
proxy must be applied again on every app start before the first profile page mounts.

| Tor piece | Reuse for profiles? |
|---|---|
| `setProxyForPartition` / `clearProxyForPartition` (`tor-service.ts:349-365`) | **Yes** — extract into a shared main helper `src/main/session-proxy.ts` used by both services. |
| Arm-before-`addPage` in `browser-pages.ts:88` and arm-in-`restore()` in `BrowserEditor.ts:250` | **Yes** — same two call sites, one more branch each. |
| `checkIp` + `normalizeGeo` + geo provider list (`tor-service.ts:269-440`) | **Yes** — move the geo half into the shared helper; Tor keeps its `check.torproject.org` call on top. |
| `imageProxySource` → `resolveTorSrc` → `tor-src://` for the blank-tab Link editor (`BrowserTabsModel.ts:308`, `tor-src.ts`, `tor-src-protocol.ts`) | **Pattern yes, scheme no** — `tor-src://<partition>` puts the partition in the URL host; `persist:browser-My Profile` is not a valid host. Use a main-issued opaque token instead (step 5). |
| `session-src://` one-URL capability (`session-src-protocol.ts`) | **Yes** — for hand-offs out of the browser (step 7). |
| Sidecar daemon, `activePartitions`, bootstrap overlay, log/status broadcast, Reconnect | **No** — a profile proxy is an external endpoint Persephone does not run. Chromium's own `ERR_PROXY_CONNECTION_FAILED` page is the fail-closed state. |

#### Leaks found that Tor mode has today too

These are on the same code paths, so the fix for profiles fixes Tor at the same time. Recommend
including them (they are the same lines of code; excluding Tor would mean writing a
profile-only branch next to a known Tor leak):

1. **Browser tab-strip favicon** — `BrowserTabsPanel.renderFavicon` sets `img.src = tab.favicon`
   in the host renderer (app session, direct). Tor pages show remote favicons this way today.
2. **"Open Image in New Tab"** (`webview-context-menu.ts:140` → `PagesLifecycleModel.openImageInNewTab`)
   builds a plain `HttpProvider(url)`, which uses raw Node `https` — direct, for Tor pages too.
3. **Board-claimed downloads** (`download-service.ts:121`) issue a `session-src` handle only for
   Tor or non-persistent sessions; a proxied persistent profile gets none, so the board fetches
   the URL direct through `nodeFetch`.
4. **WebRTC** — no code sets `setWebRTCIPHandlingPolicy` anywhere (`rg WebRTC src` is empty),
   so Tor pages can reveal local/public IPs through WebRTC today.

#### Steps

1. **Settings model** (`src/renderer/api/settings.ts`)
   - Add `BrowserNetwork = { kind: "direct" } | { kind: "proxy"; protocol: "socks5" | "http"; host: string; port: number }`.
   - `BrowserProfile.network?: BrowserNetwork` (missing = direct).
   - New key `browser-default-network` for the built-in Default profile — it has no
     `BrowserProfile` object, and already uses separate keys (`browser-default-bookmarks-file`).
   - Add both to `AppSettingsKey`, descriptions, and defaults.
   - No credentials anywhere.
   - One pure helper, `resolveProfileNetwork(profileName)`, used by every reader.

2. **Shared main helper** — `src/main/session-proxy.ts`:
   - `applySessionProxy(partition, rules)`: `setProxy({ mode: "fixed_servers", proxyRules, proxyBypassRules: "" })` + `closeAllConnections()`.
   - `setSessionDirect(partition)`.
   - `lookupEgress(session)`: ipify-style IP plus the existing geo providers.
   - `tor-service.ts` switches to it without any behaviour change.

3. **Profile network service** — `src/main/browser-network-service.ts` + `src/ipc/browser-network-ipc.ts`, registered in `main-setup.ts` beside `initTorHandlers()`:
   - `apply(partition, network)` → `{ token? }`. It validates `partition` against `^persist:browser-.+$` and builds the rules from validated host/port. It keeps `Map<partition, { network, token }>`. It is idempotent: the same config is a no-op, so the Nth page of a profile does not reset connections. A changed config reapplies the proxy and closes connections. Direct clears the entry and sets the session direct.
   - `checkIp(partition)` → `{ ip, country?, …, error? }` through `lookupEgress`.
   - Main-side queries for other services: `isProxiedSession(session)` and `tokenForSession(session)`.
   - Renderer trust note: the renderer runs with `nodeIntegration`, so validating "is this a
     real profile" in main adds no security. The partition regex just stops a bad call from
     touching Tor/incognito/app sessions.

4. **Arm before mount** — a small `BrowserProfileNetworkModel` sub-model in `BrowserEditor`, beside `BrowserTorModel`:
   - `armProxy()` resolves the profile network and invokes `apply`.
   - It keeps `token` and `network` in editor state for the UI.
   - Call it in `BrowserEditor.restore()` for non-Tor, non-incognito pages, and in `showBrowserPage` before `addPage`, exactly like Tor.
   - If `apply` rejects, do not open the page (new) or keep the tabs at `about:blank` with an error banner (restored).
   - Never fall back to direct.
   - A settings subscription in the same model reapplies the proxy when the profile's network changes. Main's idempotency makes it safe for every open page of that profile to call it.
   - Profile rename already means a new partition, so nothing special is needed.

5. **Blank-tab Link editor images and tab favicons** — generalize the routing, not the Tor scheme:
   - Rename `TorProxyInfo` → `ImageRoute { toUrl(src): string; ready: boolean }` and
     `resolveTorSrc` → `resolveRoutedSrc` (in `link-editor/tor-src.ts`, renamed
     `routed-src.ts`). The fail-closed rules (local schemes pass through, not-ready → `null`)
     stay as they are.
   - `imageProxySource` in `BrowserTabsModel.configureBookmarks` returns a Tor route (`tor-src://<partition>/?u=`, unchanged, keeping `isActiveTorPartition`) or a profile route (`profile-src://<token>/?u=`), or null for direct.
   - New `profile-src` scheme, handled in `browser-network-service.ts`:
     - privileged like `tor-src`;
     - registered on `appPartition`;
     - `token` must map to a currently proxied partition;
     - http(s) targets only;
     - forwards only content type;
     - `no-store`.
     A token is invalidated when the profile goes direct, so stale tiles fail rather than leak.
   - `LinkEditor.isTorPage` becomes `isPrivatePage` (true for a route marked private — Tor and proxied Incognito) (same meaning at its two call sites: do not arm the Node-https favicon save).
   - `BrowserTabsPanel.renderFavicon` resolves `tab.favicon` through the same route (fixes leak 1 for Tor too). The route comes from the `BrowserEditor` it already has via props.

6. **Bookmark favicon persistence** (`favicon-cache.ts`, `BrowserView.handleFavicon`, `BrowserBookmarksUIModel.runStarClick`):
   - `saveFavicon(hostname, url, fetchUrl?)`: when a routed URL is supplied, download with renderer `fetch(fetchUrl)` (Chromium, app session → `profile-src` → profile session) instead of Node `https`.
   - Proxied profiles are persistent, so the on-disk cache is fine for them.
   - Tor/incognito keep skipping the save (disk trace), unchanged.

7. **Hand-offs out of the browser** (fixes leaks 2 and 3 for Tor too):
   - `download-service.ts:121`: issue a `session-src` handle when `torPartition || !persistent || browserNetwork.isProxiedSession(session)`.
   - "Open Image in New Tab": for a routed page, ask main (new IPC `browserNetwork.sessionSource(partition, url)`, allowed only for proxied/Tor partitions) for a `session-src` handle, and open the image with `HttpProvider(url, { sessionHandle })` — the path `link-utils.ts:175` already supports.

8. **WebRTC** — `app.on("web-contents-created")` in `browser-network-service.ts`:
   - For `wc.getType() === "webview"` whose `wc.session` is proxied or a Tor partition, call `wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")` before navigation.
   - It works because the proxy is armed before `addPage` (step 4).
   - A profile switched to proxy at runtime applies it only to guests created after the switch. Say so in the change notice, or loop over existing guests of that session: `webContents.getAllWebContents()`.

9. **Settings UI** (`BrowserProfilesSection.ts` / `…Model.ts`):
   - Each profile row and the Default row get a network line: `Network: [Direct | SOCKS5 | HTTP]  host [127.0.0.1] port [1080]`, validated on blur (host non-empty and no scheme/space; port 1–65535).
   - The line matches the existing bookmarks-file line layout.
   - Incognito and Tor rows unchanged.

10. **Indicator and Check IP**:
    - A proxied page shows a small shield/route marker in the URL bar (tooltip `SOCKS5 127.0.0.1:1080`).
    - Clicking it opens a network-info dialog calling `browserNetwork.checkIp`.
    - Implement it by generalizing `TorInfoDialog` (show the Tor verdict + Reconnect only for Tor) rather than cloning it.

11. **DNS** — unchanged decision: no prefetch handling; one packet-capture/dnsmasq-log check covering a Tor page and a proxied-profile page. The test VPN's dnsmasq log makes this easy: page hostnames must appear there and nowhere else.

12. **Incognito** uses one shared setting, `browser-incognito-network` (see "Decisions taken during implementation").

13. **Docs**: `assets/guides/editors/browser.md`, `doc/architecture/browser-editor.md`, `key-files.md`.

### Files expected to change

| File | Expected work |
|---|---|
| `src/renderer/api/settings.ts` | `BrowserNetwork`, `BrowserProfile.network`, `browser-default-network`, resolver helper. |
| `src/main/session-proxy.ts` (new) | Shared apply/clear/egress-lookup helpers. |
| `src/main/tor-service.ts` | Use the shared helper; no behaviour change. |
| `src/main/browser-network-service.ts` (new) | Profile proxy map, tokens, `profile-src` handler, WebRTC hook, check IP, session-source IPC. |
| `src/ipc/browser-network-ipc.ts` (new) | Channels + result types. |
| `src/main/main-setup.ts` | Register handlers and the `profile-src` privileged scheme. |
| `src/main/download-service.ts` | Session handle for proxied persistent sessions. |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` (new) | Arm/reapply/state for one page. |
| `src/renderer/editors/browser/BrowserEditor.ts`, `browser-pages.ts` | Arm before mount (restore + new page). |
| `src/renderer/editors/browser/BrowserTabsModel.ts`, `BrowserTabsPanel.ts` | Route selection; routed tab favicons. |
| `src/renderer/editors/browser/BrowserView.ts`, `BrowserBookmarksUIModel.ts`, `webview-context-menu.ts` | Routed favicon save; routed "Open Image in New Tab". |
| `src/renderer/editors/link-editor/tor-src.ts` → `routed-src.ts` + its ~10 importers | `ImageRoute`/`resolveRoutedSrc` rename. |
| `src/renderer/components/icons/favicon-cache.ts` | Optional Chromium fetch URL. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | `openImageInNewTab(url, title?, sessionHandle?)`. |
| `src/renderer/editors/settings/sections/BrowserProfilesSection*.ts` | Network line per row. |
| `src/renderer/ui/dialogs/TorInfoDialog.ts` | Generalize to a browser network-info dialog. |
| docs listed in step 13 | |

### Files investigated that need no change

| File | Reason |
|---|---|
| `src/main/tor-src-protocol.ts` | Tor keeps its own scheme and its active-circuit guard. |
| `src/main/session-src-protocol.ts` | Already generic; only gains callers. |
| `src/main/board-protocol-service.ts`, `app-asset` handler | Local files. |
| `src/renderer/editors/link-editor/pipe-image-src.ts` | Local archive reads. |
| `PageCollectionWrapper.ts`, `tools-editors-registry.ts` | Pass `profileName`; the network resolves below them. |

## Concerns / Open Questions

1. **Scope: fix the four Tor leaks here too?** Recommended yes. They share lines with the
   profile fix, and routing both through one `ImageRoute` is simpler than two branches.
2. **Localhost bypass.** Recommended: keep Chromium's implicit loopback/link-local bypass (no
   `<-loopback>`), exactly as Tor does today. Forcing `localhost` through the WSL proxy would
   reach the Linux namespace's loopback, not the Windows dev server, so it would only break
   local development without improving privacy. Document it in the guide.
3. **Unreachable proxy.** The fail-closed state is Chromium's `ERR_PROXY_CONNECTION_FAILED` /
   `ERR_SOCKS_CONNECTION_FAILED` page; there is no daemon to report status. The URL-bar marker
   + Check IP is the diagnostic. There is no separate overlay unless you want one.
4. **Runtime switch Direct → Proxy while pages are open.** Connections are closed and new
   requests use the proxy. Pages already loaded stay as they are until reloaded, and existing
   guests only get the WebRTC policy if we loop over them (step 8). Recommend applying it to
   existing guests plus a toast "Reload open pages of <profile>".
5. **"Show Resources" link list** (`BrowserWebviewModel.showResources`) opens a standalone Link
   editor page whose remote image tiles load direct — for Tor today, too. It is a
   separate page not tied to the profile. Proposal: pass the page's route into that page (the
   same `imageProxySource` hook), or leave it as a documented limitation. Recommend passing the route —
   it is a one-line hook, but the route must outlive the source page (token valid while the profile
   stays proxied, so fine for profiles; Tor route dies with the Tor page → images go blank, which is
   fail-closed).
6. **Proxy auth** deferred (no `safeStorage`); unauthenticated SOCKS5/HTTP only.
7. **Incognito** — resolved: proxied through the shared `browser-incognito-network` setting (see decisions below).

## Related

- App-wide proxy for Persephone's own traffic is [US-1559](../US-1559-global-app-proxy/README.md); it reuses this task's `BrowserNetwork` type and `session-proxy.ts` helper.

## Decisions taken during implementation

- Concerns 1–4 and 6–7 as recommended: the four Tor leaks are fixed by the same routing; Chromium's
  implicit loopback bypass is kept; the unreachable-proxy state is Chromium's own error page; a
  runtime change applies the WebRTC policy to existing guests and shows a "reload open tabs" notice.
- Concern 5 ("Show Resources"): the list page is a standalone text-backed Link page that outlives
  the browser page, so wiring a live route into it was not worth it. On a Tor or proxied page the
  list is opened **without image thumbnails** (`BrowserWebviewModel.showResources` drops `imgSrc`) —
  fail-closed. Opening an entry from that list is an ordinary app fetch (documented limitation).
- A profile proxy that main cannot apply (e.g. a hand-edited invalid host) is fail-closed: a new
  page is refused; a restored or already-open page keeps its tabs but mounts **no webview** and
  shows an error panel with Retry until the setting is fixed (`networkError`, `ProfileNetworkErrorView`).
- **Incognito can be proxied too** (added on user request, 2026-09-28; supersedes step 12 and
  concern 7). One shared setting, `browser-incognito-network`, applies to every Incognito page and
  has its own "Network:" line on the Incognito row in Settings. Each Incognito page has its own
  in-memory partition (`browser-incognito-<uuid>`), which main's `apply` now accepts; on page
  dispose the renderer calls `browser-network:release` so main forgets that partition and revokes
  its token. Its image route is marked private, so Incognito still never writes favicons to the
  on-disk cache. A per-page choice ("open Incognito through the proxy") is not provided.
- The `profile-src` token lives in main for as long as the profile stays proxied (shared by every
  page of the profile); switching to Direct revokes it.

## Verification (2026-09-28, dev build, test VPN from Part A)

Throwaway profile `US1557Proxy` (SOCKS5 `127.0.0.1:1080`), removed afterwards with its session data.

| Check | Result |
|---|---|
| Page load through the profile | `example.net` / `www.wikipedia.org` resolved by the test VPN's dnsmasq (queries logged from the tunnel). |
| URL bar | "Proxy" chip, tooltip `Proxy: SOCKS5 127.0.0.1:1080`. |
| Tab-strip favicon | `profile-src://<token>/?u=…`, image loaded (48 px). |
| Blank-tab Link editor tiles | `profile-src://…` image loaded (580 px); its host (`www.python.org`, used by no other tab) resolved by the VPN resolver. |
| WebRTC | proxied guest `disable_non_proxied_udp`; back on after Direct → Proxy. |
| Kill switch | `testvpn tunnel-down` → Check IP `net::ERR_SOCKS_CONNECTION_FAILED`; `tunnel-up` → IP/geo returned. |
| Runtime Direct ↔ Proxy | chip removed/restored; Check IP "not using a proxy" while Direct. |
| Invalid config | error panel, 0 webviews; fixing the setting remounts the webview (1). |
| `session-src` hand-off | handle issued for the proxied partition only (none for `persist:browser-default`); fetch 200 through the VPN resolver. |
| Incognito | with `browser-incognito-network` set to the proxy: `example.net` resolved by the VPN resolver, "Proxy" chip shown, Check IP answered; after closing the page main reports it not proxied (entry released). Setting restored to Direct. |
| Tor regression | Tor page bootstraps; tab favicon now `tor-src://…` (48 px); guest `disable_non_proxied_udp`. |

Not verified live: Settings UI rows (no script entry point opens Settings), restore after an app
restart, the "Open Image in New Tab" click itself (its handle + fetch path is verified above),
board-claimed downloads, bookmark-favicon persistence, and a packet capture on the Windows side.

## Acceptance Criteria

### Environment/runbook proof

- [x] The user can follow the runbook to install WSL2 without Docker, subject to admin approval/reboot, install an approved distro, and expose a loopback-only proxy at Windows `127.0.0.1:1080` in default NAT mode.
- [x] Baseline SOCKS hostname-resolution curl succeeds and shows the direct egress IP before the VPN is enabled.
- [x] With VPN active, proxy egress uses the VPN tunnel and the VPN DNS resolver; direct Windows egress remains unchanged.
- [x] A kill switch prevents WSL proxy/VPN traffic from using the underlying default route when the tunnel drops; SOCKS requests fail closed.
- [x] Manual DNS leak evidence shows no tested hostname resolution reaching the Windows/default ISP resolver.
- [x] No VPN config, key, password, or provider credential is committed or pasted into shared task/chat content.

### Persephone implementation

- [ ] Every browser profile can choose Direct or a validated unauthenticated SOCKS5/HTTP proxy endpoint; old settings with no network field remain Direct.
- [ ] A configured proxy is applied to the profile's Electron Session before the first URL request, including restored browser pages; runtime edits reapply it and close old connections before more navigation.
- [x] A failed/unreachable configured proxy presents a clear retryable error and never changes the profile to Direct.
- [ ] All remote requests made for the proxied profile—webview page requests, downloads, tab/bookmark favicons, and Link editor previews—are issued by or fetched through the profile's Session; local app assets/local archive reads remain local.
- [x] Proxied profile guest pages use `disable_non_proxied_udp`; local WebRTC IP disclosure is suppressed.
- [ ] The four leaks Tor mode has today (tab-strip favicon, "Open Image in New Tab", board-claimed downloads, WebRTC) are closed for Tor pages by the same routing (if concern 1 is accepted).
- [ ] Incognito pages can be proxied through `browser-incognito-network`; closing a page releases its partition in main.
- [ ] The Default profile can be proxied (`browser-default-network`); proxy settings are re-applied on every app start before the first profile page mounts.
- [ ] SOCKS5 destination names resolve through the proxy; a packet capture on a proxied-profile page and a Tor page shows no page-hostname queries to the machine's default resolver (or any leak found is filed as a shared follow-up covering both modes).
- [x] Proxy configuration has no `direct://` fallback and no unintended bypass rules; localhost/link-local behavior is explicitly selected and documented.
- [x] “Check IP” runs in main through the profile Session and reports the proxied egress IP or a useful error.
- [x] Tor remains a separately functioning mode with its existing fail-closed behavior; no network setting/password is added to script APIs or plain settings secrets.
- [x] Browser user documentation and affected developer architecture pointers are updated at implementation completion.

## Files Changed

| File | Change |
|---|---|
| `src/ipc/browser-network-ipc.ts` (new) | `BrowserNetwork`, `EgressIpInfo`, channels, endpoint validation, `PROFILE_SRC_SCHEME`. |
| `src/ipc/tor-ipc.ts` | `TorIpInfo` extends `EgressIpInfo`. |
| `src/main/session-proxy.ts` (new) | `applySessionProxy`, `setSessionDirect`, `lookupGeo` shared by Tor and profiles. |
| `src/main/tor-service.ts` | Uses the shared helper; tracks armed partitions for `isTorSession`. |
| `src/main/browser-network-service.ts` (new) | Profile proxy map + tokens, `profile-src://` handler, WebRTC hook, check IP, session-source IPC. |
| `src/main/main-setup.ts` | Registers the scheme, handler, and IPC. |
| `src/main/download-service.ts` | Board-claimed downloads from a proxied profile get a `session-src` handle. |
| `src/renderer/api/settings.ts` | `BrowserProfile.network`, `browser-default-network`, `browser-incognito-network`. |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` (new) | Per-page arm/re-apply, image route, routed fetch URL, session source, info dialog. |
| `src/renderer/editors/browser/BrowserEditor.ts`, `BrowserEditorModel.ts`, `browser-pages.ts` | Arm before mount (restore + new page); `networkToken`/`networkLabel`/`networkError` state. |
| `src/renderer/editors/browser/BrowserView.ts`, `BrowserView.css` | Proxy chip; error panel instead of webviews; routed favicon save. |
| `src/renderer/editors/browser/BrowserTabsModel.ts`, `BrowserTabsPanel.ts` | Link editor route; routed tab-strip favicons. |
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts`, `webview-context-menu.ts`, `BrowserWebviewModel.ts` | Routed favicon save; routed "Open Image in New Tab"; Resources list without thumbnails on routed pages. |
| `src/renderer/editors/link-editor/tor-src.ts` → `routed-src.ts` (+ importers) | `ImageRoute`, `resolveRoutedSrc`, `torImageRoute`, `profileImageRoute`; `isTorPage` → `isPrivatePage`. |
| `src/renderer/components/icons/favicon-cache.ts` | Optional routed URL fetched with Chromium `fetch()`. |
| `src/renderer/api/pages/PagesLifecycleModel.ts`, `PagesModel.ts` | `openImageInNewTab(url, title?, sessionHandle?)`. |
| `src/renderer/editors/settings/sections/ProfileNetworkLineView.ts` (new), `BrowserProfilesSection*.ts` | Network line for every profile, the Default profile, and Incognito. |
| `src/renderer/ui/dialogs/TorInfoDialog.ts`, `TorInfoDialogView.ts` | Proxy mode (`showBrowserNetworkInfoDialog`). |
| `doc/tasks/US-1559-global-app-proxy/README.md` (new), `doc/active-work.md` | Follow-up task; dashboard. |
