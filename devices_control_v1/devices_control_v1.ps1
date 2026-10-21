<#
.SYNOPSIS
    devices_control_v1 - local web UI to list, enable and disable Windows PnP devices.

.DESCRIPTION
    Starts a small HTTP server bound to 127.0.0.1 on a random port, protected by a
    one-time token, and opens the UI (devices_control_v1.html) in the default browser.
    The script re-launches itself with administrator rights, because Windows requires
    them to enable or disable devices. If UAC is declined it keeps running read-only.

    Every enable/disable action is appended to devices_control_v1.log next to the script,
    so you can always find out what was changed and switch it back.

.PARAMETER Port
    Fixed port to listen on. Default: a random free port.

.PARAMETER NoBrowser
    Do not open the browser automatically; the URL is printed to the console.
#>
param(
    [int]$Port = 0,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- elevation

function Test-IsAdmin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    $exe = (Get-Process -Id $PID).Path
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Port) { $argList += @('-Port', "$Port") }
    if ($NoBrowser) { $argList += '-NoBrowser' }
    try {
        Start-Process -FilePath $exe -ArgumentList $argList -Verb RunAs | Out-Null
        exit
    } catch {
        Write-Host 'Administrator rights were not granted. Continuing in READ-ONLY mode:' -ForegroundColor Yellow
        Write-Host 'devices will be listed, but enabling/disabling is unavailable.' -ForegroundColor Yellow
    }
}

$script:IsAdmin = Test-IsAdmin

# ---------------------------------------------------------------- files

$HtmlPath = Join-Path $PSScriptRoot 'devices_control_v1.html'
$LogPath = Join-Path $PSScriptRoot 'devices_control_v1.log'

if (-not (Test-Path -LiteralPath $HtmlPath)) {
    Write-Host "UI file not found: $HtmlPath" -ForegroundColor Red
    Write-Host 'Keep devices_control_v1.html in the same folder as this script.'
    Read-Host 'Press Enter to close'
    exit 1
}
$script:Html = [IO.File]::ReadAllText($HtmlPath, [Text.Encoding]::UTF8)

function Write-ActionLog([string]$text) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
    try { [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine, [Text.Encoding]::UTF8) } catch { }
    Write-Host $line
}

# ---------------------------------------------------------------- device model

# Classes whose devices are usually reachable from user code (serial, USB, sockets,
# audio APIs, HID, cameras, Bluetooth...). Everything else goes to the "other" page.
$ProgrammableClasses = @(
    'Ports', 'MultiPortSerial', 'Modem', 'USB', 'USBDevice', 'Net', 'AudioEndpoint', 'MEDIA',
    'HIDClass', 'Keyboard', 'Mouse', 'Camera', 'Image', 'Bluetooth', 'Printer', 'PrintQueue',
    'WPD', 'Biometric', 'SmartCardReader', 'SmartCard', 'Sensor', 'Infrared', 'Multifunction',
    '1394', 'AndroidUsbDeviceClass'
)

function Test-IsRdp {
    if ($env:SESSIONNAME -like 'RDP-*') { return $true }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        return [bool][System.Windows.Forms.SystemInformation]::TerminalServerSession
    } catch { return $false }
}

function Get-NetAdapterMap {
    $map = @{}
    try {
        foreach ($a in (Get-NetAdapter -IncludeHidden -ErrorAction Stop)) {
            if ($a.PnPDeviceID) { $map[[string]$a.PnPDeviceID] = [string]$a.Status }
        }
    } catch { }
    return $map
}

# Risk is a starting point from class + live state, NOT a safety guarantee.
# The per-device impact check (Get-DeviceImpact) adds what depends on the device.
# Levels: 0 low, 1 medium, 2 high, 3 critical (server refuses without force).
function Get-RiskAssessment([string]$cls, [string]$id, [string[]]$compat, $netStatus, [bool]$isRdp) {
    $items = @()
    $uid = $id.ToUpperInvariant()

    if ($cls -in 'System', 'Computer', 'Processor', 'Firmware') { $items += , @(3, 'core') }
    elseif ($cls -in 'DiskDrive', 'Volume', 'VolumeSnapshot', 'HDC', 'SCSIAdapter', 'SCSIController', 'SDHost') { $items += , @(3, 'storage') }
    elseif ($cls -eq 'SecurityDevices') { $items += , @(3, 'tpm') }
    elseif ($cls -eq 'Display') { $items += , @(2, 'display') }
    elseif ($cls -in 'Keyboard', 'Mouse') { $items += , @(2, 'input') }
    elseif ($cls -eq 'USB') {
        if ($uid.StartsWith('USB\ROOT_HUB') -or ($compat -match '^USB\\Class_09')) { $items += , @(2, 'usbHub') }
        elseif (-not $uid.StartsWith('USB\')) { $items += , @(2, 'usbController') }
        else { $items += , @(1, 'usbDevice') }
    }
    elseif ($cls -eq 'Net') {
        if ($netStatus -eq 'Up') {
            $items += , @(2, 'netActive')
            if ($isRdp) { $items += , @(3, 'rdp') }
        } else { $items += , @(1, 'net') }
    }
    elseif ($cls -eq 'HIDClass') { $items += , @(1, 'hid') }
    elseif ($cls -eq 'Bluetooth') { $items += , @(1, 'bluetooth') }
    elseif ($cls -in 'SoftwareDevice', 'SoftwareComponent', 'Extension', 'LegacyDriver') { $items += , @(1, 'software') }
    elseif ($cls -eq 'Battery') { $items += , @(1, 'battery') }
    elseif (-not $cls) { $items += , @(1, 'unknownClass') }

    $level = 0
    $reasons = @()
    foreach ($x in $items) {
        if ($x[0] -gt $level) { $level = $x[0] }
        $reasons += $x[1]
    }
    return @{ Level = $level; Reasons = [string[]]$reasons }
}

function ConvertTo-DeviceRecord($d, $netMap, [bool]$isRdp) {
    $id = [string]$d.PNPDeviceID
    if (-not $id) { $id = [string]$d.DeviceID }
    $cls = [string]$d.PNPClass
    $name = [string]$d.Name
    if (-not $name) { $name = [string]$d.Description }
    if (-not $name) { $name = $id }

    $code = 0
    if ($null -ne $d.ConfigManagerErrorCode) { $code = [int]$d.ConfigManagerErrorCode }
    $present = $true
    if ($null -ne $d.Present) { $present = [bool]$d.Present }

    $state = if ($code -eq 22) { 'disabled' } elseif (-not $present) { 'disconnected' } elseif ($code -eq 0) { 'ok' } else { 'error' }

    $hw = [string[]]@($d.HardwareID | Where-Object { $_ })
    $compat = [string[]]@($d.CompatibleID | Where-Object { $_ })
    $net = $null
    if ($netMap.ContainsKey($id)) { $net = $netMap[$id] }
    $risk = Get-RiskAssessment $cls $id $compat $net $isRdp

    return [ordered]@{
        id      = $id
        name    = $name
        cls     = $cls
        mfr     = [string]$d.Manufacturer
        hwids   = $hw
        service = [string]$d.Service
        state   = $state
        code    = $code
        present = $present
        prog    = ($ProgrammableClasses -contains $cls)
        risk    = $risk.Level
        reasons = $risk.Reasons
        net     = $net
    }
}

function Get-DeviceList {
    $netMap = Get-NetAdapterMap
    $isRdp = Test-IsRdp
    $index = @{}
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($d in (Get-CimInstance -ClassName Win32_PnPEntity)) {
        $rec = ConvertTo-DeviceRecord $d $netMap $isRdp
        if (-not $rec.id -or $index.ContainsKey($rec.id)) { continue }
        $index[$rec.id] = $rec
        $list.Add($rec)
    }
    $script:DeviceIndex = $index
    return @{ devices = $list.ToArray(); rdp = $isRdp }
}

function Get-SingleDevice([string]$id) {
    $q = $id.Replace('\', '\\').Replace("'", "\'")
    $d = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPDeviceID='$q'" | Select-Object -First 1
    if (-not $d) { return $null }
    return ConvertTo-DeviceRecord $d (Get-NetAdapterMap) (Test-IsRdp)
}

# What would actually break: walks the device tree below the device and looks
# for keyboards/mice, disks, network adapters and displays that depend on it.
function Get-DeviceImpact([string]$id) {
    $self = $script:DeviceIndex[$id]
    if (-not $self) { return @{ ok = $false; error = 'unknownDevice' } }

    $reasons = New-Object System.Collections.Generic.List[string]

    $disableable = $null
    try {
        $st = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_DevNodeStatus' -ErrorAction Stop).Data
        if ($null -ne $st) { $disableable = (([uint32]$st) -band 0x2000) -ne 0 }   # DN_DISABLEABLE
    } catch { }
    if ($disableable -eq $false -and $self.state -eq 'ok') { $reasons.Add('notDisableable') }

    $seen = @{}
    $queue = New-Object System.Collections.Generic.Queue[string]
    $queue.Enqueue($id)
    while ($queue.Count -gt 0 -and $seen.Count -lt 300) {
        $cur = $queue.Dequeue()
        $kids = $null
        try { $kids = (Get-PnpDeviceProperty -InstanceId $cur -KeyName 'DEVPKEY_Device_Children' -ErrorAction Stop).Data } catch { }
        foreach ($k in @($kids)) {
            if ($k -and -not $seen.ContainsKey($k)) { $seen[$k] = $true; $queue.Enqueue([string]$k) }
        }
    }

    $inputDevs = @(); $storage = @(); $net = @(); $display = @()
    foreach ($k in $seen.Keys) {
        $rec = $script:DeviceIndex[$k]
        if (-not $rec -or $rec.state -eq 'disconnected') { continue }
        if ($rec.cls -in 'Keyboard', 'Mouse') { $inputDevs += $rec.name }
        elseif ($rec.cls -in 'DiskDrive', 'Volume', 'HDC', 'SCSIAdapter') { $storage += $rec.name }
        elseif ($rec.cls -eq 'Net') { $net += $rec.name }
        elseif ($rec.cls -eq 'Display') { $display += $rec.name }
    }
    if ($inputDevs.Count) { $reasons.Add('childInput') }
    if ($storage.Count) { $reasons.Add('childStorage') }
    if ($net.Count) { $reasons.Add('childNet') }
    if ($display.Count) { $reasons.Add('childDisplay') }

    if ($self.cls -eq 'Net') {
        try {
            $ifIdx = Get-NetRoute -DestinationPrefix '0.0.0.0/0', '::/0' -ErrorAction Stop |
                Select-Object -ExpandProperty ifIndex -Unique
            foreach ($i in $ifIdx) {
                $a = Get-NetAdapter -InterfaceIndex $i -IncludeHidden -ErrorAction SilentlyContinue
                if ($a -and $a.PnPDeviceID -eq $id) { $reasons.Add('defaultRoute'); break }
            }
        } catch { }
    }

    return @{
        ok          = $true
        id          = $id
        disableable = $disableable
        reasons     = [string[]]$reasons.ToArray()
        descendants = $seen.Count
        children    = @{
            input   = [string[]]($inputDevs | Select-Object -Unique -First 10)
            storage = [string[]]($storage | Select-Object -Unique -First 10)
            net     = [string[]]($net | Select-Object -Unique -First 10)
            display = [string[]]($display | Select-Object -Unique -First 10)
        }
    }
}

function Set-DeviceState([string]$id, [string]$action, [bool]$force) {
    if (-not $script:IsAdmin) { return @{ ok = $false; error = 'notAdmin' } }
    $rec = $script:DeviceIndex[$id]
    if (-not $rec) { return @{ ok = $false; error = 'unknownDevice' } }
    if ($action -eq 'disable' -and $rec.risk -ge 3 -and -not $force) { return @{ ok = $false; error = 'forceRequired' } }

    try {
        if ($action -eq 'disable') { Disable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop | Out-Null }
        else { Enable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop | Out-Null }
    } catch {
        Write-ActionLog ("FAILED {0}  [{1}]  {2}  :: {3}" -f $action.ToUpper(), $rec.name, $id, $_.Exception.Message)
        return @{ ok = $false; error = 'osError'; message = $_.Exception.Message }
    }

    Start-Sleep -Milliseconds 800
    $new = Get-SingleDevice $id
    if (-not $new) { $new = $rec }
    $script:DeviceIndex[$id] = $new

    $expected = if ($action -eq 'disable') { 'disabled' } else { 'ok' }
    $needsRestart = ($new.code -eq 14) -or ($new.state -ne $expected)
    Write-ActionLog ("{0}  [{1}]  {2}  -> state={3} code={4}" -f $action.ToUpper(), $rec.name, $id, $new.state, $new.code)
    return @{ ok = $true; device = $new; needsRestart = $needsRestart }
}

# ---------------------------------------------------------------- HTTP

function ConvertTo-JsonText($o) { return ConvertTo-Json -InputObject $o -Depth 6 -Compress }

function Send-Response($ctx, [int]$status, [string]$type, [string]$body) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $r = $ctx.Response
    $r.StatusCode = $status
    $r.ContentType = $type
    $r.AddHeader('Cache-Control', 'no-store')
    $r.AddHeader('X-Content-Type-Options', 'nosniff')
    $r.AddHeader('X-Frame-Options', 'DENY')
    $r.ContentLength64 = $bytes.Length
    $r.OutputStream.Write($bytes, 0, $bytes.Length)
    $r.OutputStream.Close()
}

function Read-JsonBody($req) {
    $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd()
    $sr.Close()
    if (-not $text) { return $null }
    return $text | ConvertFrom-Json
}

function Invoke-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $json = 'application/json; charset=utf-8'

    # Blocks DNS-rebinding: only the exact loopback host is accepted.
    if ($req.UserHostName -ne "127.0.0.1:$Port") { Send-Response $ctx 400 'text/plain' 'Bad host'; return }

    if ($req.HttpMethod -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        Send-Response $ctx 200 'text/html; charset=utf-8' $script:Html
        return
    }
    if (-not $path.StartsWith('/api/')) { Send-Response $ctx 404 'text/plain' 'Not found'; return }

    # The custom header forces a CORS preflight, which this server never approves,
    # so other web pages cannot drive the API even if they guess the port.
    if ($req.Headers['X-Token'] -ne $Token) { Send-Response $ctx 403 $json '{"ok":false,"error":"badToken"}'; return }
    if ($req.HttpMethod -ne 'POST') { Send-Response $ctx 405 $json '{"ok":false,"error":"method"}'; return }

    $body = Read-JsonBody $req
    switch ($path) {
        '/api/devices' {
            $data = Get-DeviceList
            $res = @{ ok = $true; admin = $script:IsAdmin; rdp = $data.rdp; computer = $env:COMPUTERNAME; devices = $data.devices }
        }
        '/api/impact' {
            $res = Get-DeviceImpact ([string]$body.id)
        }
        '/api/set' {
            $action = [string]$body.action
            if ($action -notin 'enable', 'disable') { $res = @{ ok = $false; error = 'badAction' } }
            else { $res = Set-DeviceState ([string]$body.id) $action ([bool]$body.force) }
        }
        '/api/shutdown' {
            $script:Running = $false
            $res = @{ ok = $true }
        }
        default { Send-Response $ctx 404 $json '{"ok":false,"error":"notFound"}'; return }
    }
    Send-Response $ctx 200 $json (ConvertTo-JsonText $res)
}

# ---------------------------------------------------------------- main

if (-not $Port) {
    $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $Port = $probe.LocalEndpoint.Port
    $probe.Stop()
}

$Token = [guid]::NewGuid().ToString('N')
$script:DeviceIndex = @{}
$Url = "http://127.0.0.1:$Port/?t=$Token"

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

$Host.UI.RawUI.WindowTitle = 'devices_control_v1'
Write-Host ''
Write-Host ' devices_control_v1' -ForegroundColor Cyan
Write-Host (' Admin rights : {0}' -f $(if ($script:IsAdmin) { 'YES' } else { 'NO (read-only)' }))
Write-Host " UI           : $Url"
Write-Host " Action log   : $LogPath"
Write-Host ' Close this window or press Ctrl+C to stop the server.' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) {
    # explorer.exe hands the URL to the default browser in the normal (non-elevated)
    # user context, so the browser itself does not run as administrator.
    try { Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$Url`"" } catch { Write-Host 'Open the URL above manually.' }
}

$script:Running = $true
try {
    while ($script:Running) {
        $task = $listener.GetContextAsync()
        while (-not $task.AsyncWaitHandle.WaitOne(250)) { }   # short waits keep Ctrl+C responsive
        $ctx = $task.Result
        try {
            Invoke-Request $ctx
        } catch {
            Write-Host ("Request error: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
            try { Send-Response $ctx 500 'application/json; charset=utf-8' (ConvertTo-JsonText @{ ok = $false; error = 'server'; message = $_.Exception.Message }) } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host 'Server stopped.'
}
