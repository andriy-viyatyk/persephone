<#
.SYNOPSIS
  Agent control for the Hyper-V Ubuntu test VM (EPIC-214, US-2211). Needs membership in the local
  "Hyper-V Administrators" group, not elevation. Shell access is plain OpenSSH: `ssh persephone-vm '<command>'`.

.EXAMPLE
  ./vm.ps1 status | start | stop | screenshot [path] | type "<text>" [-Enter] | key ctrl+alt+t
  ./vm.ps1 fix-network     # after a Windows reboot moved the Default Switch subnet
  ./vm.ps1 sync            # copy the Windows checkout into ~/persephone (no node_modules)
  ./vm.ps1 app-start [x11] | app-stop | app-log   # x11 = run through XWayland instead of native Wayland
  ./vm.ps1 input-setup     # tools for real input in the session (ydotool, xclip); then ssh ... ptr.sh (see that file)
  ./vm.ps1 tunnel          # forward the VM app's MCP port 7875 to localhost:7875 (runs until stopped;
                           # conflicts with a WSL Persephone on the same port, so stop that first)
  ./vm.ps1 checkpoint <name> | restore <name> | checkpoints
#>
param(
    [Parameter(Position = 0)][string]$Command = "status",
    [Parameter(Position = 1)][string]$Arg = "",
    [switch]$Enter
)
$ErrorActionPreference = "Stop"
$VmName = "persephone-vm"
$HostOctet = 50            # the VM's address is <Default Switch network>.<HostOctet>
$Repo = Resolve-Path "$PSScriptRoot\..\.."
$McpLocalPort = 7875       # must equal the VM app's mcp.port: the MCP server checks the Host header's port

function Get-Keyboard {
    $vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VmName'"
    Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_Keyboard
}

# Msvm_Keyboard.TypeText drops and reorders keys, so text is typed one key at a time (US layout).
function Send-Text([string]$Text, [bool]$PressEnter) {
    $kb = Get-Keyboard
    $plain = @{ ' ' = 0x20; ';' = 0xBA; '=' = 0xBB; ',' = 0xBC; '-' = 0xBD; '.' = 0xBE; '/' = 0xBF; '`' = 0xC0;
                '[' = 0xDB; '\' = 0xDC; ']' = 0xDD; "'" = 0xDE }
    $shifted = @{ ':' = 0xBA; '+' = 0xBB; '<' = 0xBC; '_' = 0xBD; '>' = 0xBE; '?' = 0xBF; '~' = 0xC0;
                  '{' = 0xDB; '|' = 0xDC; '}' = 0xDD; '"' = 0xDE; '!' = 0x31; '@' = 0x32; '#' = 0x33; '$' = 0x34;
                  '%' = 0x35; '^' = 0x36; '&' = 0x37; '*' = 0x38; '(' = 0x39; ')' = 0x30 }
    foreach ($c in $Text.ToCharArray()) {
        $s = [string]$c; $shift = $false
        if ($plain.ContainsKey($s)) { $code = $plain[$s] }
        elseif ($shifted.ContainsKey($s)) { $code = $shifted[$s]; $shift = $true }
        elseif ($s -cmatch '[a-z0-9]') { $code = [int][char]$s.ToUpper() }
        elseif ($s -cmatch '[A-Z]') { $code = [int][char]$s; $shift = $true }
        else { throw "Cannot type character '$s'" }
        if ($shift) { Invoke-CimMethod -InputObject $kb -MethodName PressKey -Arguments @{ keyCode = 0x10 } | Out-Null }
        Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = $code } | Out-Null
        if ($shift) { Invoke-CimMethod -InputObject $kb -MethodName ReleaseKey -Arguments @{ keyCode = 0x10 } | Out-Null }
        Start-Sleep -Milliseconds 25
    }
    if ($PressEnter) { Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = 0x0D } | Out-Null }
}

function Send-Combo([string]$Combo) {
    $kb = Get-Keyboard
    $named = @{ ctrl = 0x11; alt = 0x12; shift = 0x10; super = 0x5B; enter = 0x0D; esc = 0x1B; tab = 0x09 }
    $keys = @($Combo.ToLower().Split("+") | ForEach-Object { if ($named.ContainsKey($_)) { $named[$_] } else { [int][char]$_.ToUpper() } })
    foreach ($k in $keys) { Invoke-CimMethod -InputObject $kb -MethodName PressKey -Arguments @{ keyCode = [int]$k } | Out-Null }
    [array]::Reverse($keys)
    foreach ($k in $keys) { Invoke-CimMethod -InputObject $kb -MethodName ReleaseKey -Arguments @{ keyCode = [int]$k } | Out-Null }
}

function Save-Screenshot([string]$Out) {
    Add-Type -AssemblyName System.Drawing
    # The guest screen size (set in GNOME with gdctl), so the capture is 1:1 with screen pixels.
    $w = 1920; $h = 1080
    $vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VmName'"
    $settings = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_VirtualSystemSettingData |
        Where-Object { $_.VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized' }
    $svc = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_VirtualSystemManagementService
    $r = Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage -Arguments @{
        TargetSystem = $settings; WidthPixels = [uint16]$w; HeightPixels = [uint16]$h }
    if ($r.ReturnValue -ne 0) { throw "GetVirtualSystemThumbnailImage returned $($r.ReturnValue)" }
    $bytes = [byte[]]$r.ImageData
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
    $data = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, [Math]::Min($bytes.Length, $data.Stride * $h))
    $bmp.UnlockBits($data); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $Out
}

function Get-ExpectedAddress {
    $ip = Get-NetIPAddress -InterfaceAlias "vEthernet (Default Switch)" -AddressFamily IPv4
    $bytes = ([System.Net.IPAddress]::Parse($ip.IPAddress)).GetAddressBytes()
    $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $ip.PrefixLength))
    $hostValue = ([uint32]$bytes[0] -shl 24) -bor ([uint32]$bytes[1] -shl 16) -bor ([uint32]$bytes[2] -shl 8) -bor [uint32]$bytes[3]
    $network = $hostValue -band $mask
    $vmValue = $network + $HostOctet
    $vmIp = "{0}.{1}.{2}.{3}" -f (($vmValue -shr 24) -band 255), (($vmValue -shr 16) -band 255), (($vmValue -shr 8) -band 255), ($vmValue -band 255)
    [pscustomobject]@{ Gateway = $ip.IPAddress; Prefix = $ip.PrefixLength; Address = $vmIp }
}

function Set-SshHostName([string]$Address) {
    $config = "$env:USERPROFILE\.ssh\config"
    $text = Get-Content $config -Raw
    $updated = [regex]::Replace($text, "(?ms)(Host $VmName\s.*?HostName\s+)\S+", "`${1}$Address")
    if ($updated -ne $text) { [IO.File]::WriteAllText($config, $updated) }
}

switch ($Command) {
    "status" {
        Get-VM $VmName | Select-Object Name, State, Uptime, CPUUsage | Format-List | Out-String
        $expected = Get-ExpectedAddress
        "expected address: $($expected.Address) (gateway $($expected.Gateway)/$($expected.Prefix))"
        if (Test-Connection $expected.Address -Count 1 -Quiet) { "reachable" } else { "NOT reachable: run fix-network" }
    }
    "start" { Start-VM $VmName; "started" }
    "stop" { Stop-VM $VmName; "stopped" }
    "screenshot" { Save-Screenshot ($(if ($Arg) { $Arg } else { "$env:TEMP\$VmName-screen.png" })) }
    "type" { Send-Text $Arg $Enter.IsPresent }
    "key" { Send-Combo $Arg }
    "fix-network" {
        # The Default Switch has no working DHCP on this host, so the VM uses a static address in the
        # switch's subnet. Windows may move that subnet after a reboot; this re-types the VM's netplan
        # through the console keyboard, then points the SSH alias at the new address.
        $e = Get-ExpectedAddress
        $yaml = "network: {version: 2, renderer: NetworkManager, ethernets: {eth0: {dhcp4: false, dhcp6: false, link-local: [ipv6], addresses: [$($e.Address)/$($e.Prefix)], routes: [{to: default, via: $($e.Gateway)}], nameservers: {addresses: [$($e.Gateway)]}}}}"
        Send-Combo "ctrl+alt+t"; Start-Sleep 4
        Send-Text "echo '$yaml' | sudo tee /etc/netplan/50-static.yaml >/dev/null && sudo netplan apply && exit" $true
        Start-Sleep 8
        Set-SshHostName $e.Address
        if (Test-Connection $e.Address -Count 2 -Quiet) { "network fixed: $($e.Address)" } else { "still unreachable; take a screenshot" }
    }
    "sync" {
        $excludes = "--exclude=node_modules --exclude=.vite --exclude=release --exclude=dist --exclude=out --exclude=target --exclude=.git --exclude=*.exe --exclude=integration-test/reports --exclude=.persephone --exclude=temp --exclude=.i18n-work"
        # Unpack over the existing tree so node_modules in the VM is kept; then drop files deleted on Windows.
        $parent = Split-Path $Repo.Path -Parent
        $unixParent = "/" + $parent.Substring(0, 1).ToLower() + ($parent.Substring(2) -replace '\\', '/')
        $folder = Split-Path $Repo.Path -Leaf
        bash -c "tar -C '$unixParent' -cf - $excludes $folder | ssh $VmName 'tar -C ~ -xf -'"
        "synced (deleted files are not removed; use a fresh copy if that matters)"
    }
    "app-start" {
        # systemd --user carries the GNOME session's WAYLAND_DISPLAY/DISPLAY, so the app opens on the real desktop.
        # The [p] keeps pkill from matching this ssh command line itself.
        $flags = if ($Arg -eq "x11") { " -- --ozone-platform=x11" } else { "" }
        ssh $VmName "systemctl --user stop persephone-dev 2>/dev/null; pkill -f '[p]ersephone/node_modules/electron'; systemctl --user reset-failed persephone-dev 2>/dev/null; systemd-run --user --unit=persephone-dev --working-directory=/home/dev/persephone bash -lc 'npm start$flags' && echo started"
    }
    "app-stop" { ssh $VmName "systemctl --user stop persephone-dev; pkill -f '[p]ersephone/node_modules/electron'; echo stopped" }
    "input-setup" {
        ssh $VmName "sudo apt-get install -y -qq ydotool xclip >/dev/null; export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus; gsettings set org.gnome.desktop.peripherals.mouse accel-profile flat; gsettings set org.gnome.desktop.peripherals.mouse speed 0; chmod +x ~/persephone/scripts/linux-vm/ptr.sh; echo ready"
    }
    "app-log" { ssh $VmName "journalctl --user -u persephone-dev --no-pager -n 40" }
    "tunnel" { ssh -N -o ExitOnForwardFailure=yes -L "${McpLocalPort}:localhost:7875" $VmName }
    "checkpoint" { Checkpoint-VM $VmName -SnapshotName $Arg; "checkpoint $Arg" }
    "restore" { Restore-VMCheckpoint -VMName $VmName -Name $Arg -Confirm:$false; "restored $Arg" }
    "checkpoints" { Get-VMCheckpoint -VMName $VmName | Select-Object Name, CreationTime | Format-Table | Out-String }
    default { throw "Unknown command: $Command" }
}
