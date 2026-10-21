<#
.SYNOPSIS
    devices_control_v3 - local web UI to inspect, enable and disable Windows PnP devices.

.DESCRIPTION
    Starts a small HTTP server bound to 127.0.0.1 on a random port, protected by a
    one-time token, and opens the UI (files in .\web) in the default browser.
    The script re-launches itself with administrator rights, because Windows requires
    them to enable or disable devices. If UAC is declined it keeps running read-only.

    Every enable/disable action is appended to devices_control_v3.log next to the script.

    v3 changes (remote work):
      * auto-revert: a disable can be armed with a Task Scheduler job that enables the
        device again unless you confirm in time, so a lost connection heals itself
      * remote sessions (SSH, RDP, WinRM, VNC, remote-access tools) are detected; the adapter
        carrying them, and every device it hangs off, cannot be disabled without auto-revert
      * -RememberToken keeps the token and port between runs, so a phone bookmark keeps working
      * touch mode in the UI (tap instead of hover)

.PARAMETER Port
    Fixed port to listen on. Default: a random free port.

.PARAMETER NoBrowser
    Do not open the browser automatically; the URL is printed to the console.

.PARAMETER RememberToken
    Keep the token and port in %ProgramData%\devices_control (administrators only), so the
    URL stays the same after a restart. Delete token.txt there to rotate the token.
#>
param(
    [int]$Port = 0,
    [switch]$NoBrowser,
    [switch]$RememberToken
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
    if ($RememberToken) { $argList += '-RememberToken' }
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

$WebRoot = Join-Path $PSScriptRoot 'web'
$LogPath = Join-Path $PSScriptRoot 'devices_control_v3.log'

if (-not (Test-Path -LiteralPath (Join-Path $WebRoot 'index.html'))) {
    Write-Host "UI files not found: $WebRoot" -ForegroundColor Red
    Write-Host 'Keep the "web" folder next to this script.'
    Read-Host 'Press Enter to close'
    exit 1
}

$StaticTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.svg'  = 'image/svg+xml'
}

function Write-ActionLog([string]$text) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
    try { [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine, [Text.Encoding]::UTF8) } catch { }
    Write-Host $line
}

# ---------------------------------------------------------------- native helpers

# cfgmgr32 gives the device tree and devnode flags in microseconds per device;
# the PnP cmdlets would need seconds for the same data. The audio part talks to
# the Windows audio policy, which is what the Sound control panel uses.
$NativeUsings = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
'@

$TreeSource = @'
public static class DcNative {
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    static extern int CM_Locate_DevNodeW(out uint devInst, string deviceId, uint flags);
    [DllImport("cfgmgr32.dll")]
    static extern int CM_Get_Parent(out uint parent, uint devInst, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    static extern int CM_Get_Device_IDW(uint devInst, StringBuilder buffer, int bufferLen, uint flags);
    [DllImport("cfgmgr32.dll")]
    static extern int CM_Get_DevNode_Status(out uint status, out uint problem, uint devInst, uint flags);

    const uint CM_LOCATE_DEVNODE_NORMAL = 0;
    const uint CM_LOCATE_DEVNODE_PHANTOM = 1;

    public static string[] GetParents(string[] ids) {
        var res = new string[ids.Length];
        var sb = new StringBuilder(512);
        for (int i = 0; i < ids.Length; i++) {
            res[i] = "";
            uint dev, parent;
            if (CM_Locate_DevNodeW(out dev, ids[i], CM_LOCATE_DEVNODE_PHANTOM) != 0) continue;
            if (CM_Get_Parent(out parent, dev, 0) != 0) continue;
            sb.Length = 0;
            if (CM_Get_Device_IDW(parent, sb, sb.Capacity, 0) == 0) res[i] = sb.ToString();
        }
        return res;
    }

    // DevNode status flags, or -1 when the device is not present.
    public static long[] GetStatus(string[] ids) {
        var res = new long[ids.Length];
        for (int i = 0; i < ids.Length; i++) {
            res[i] = -1;
            uint dev, status, problem;
            if (CM_Locate_DevNodeW(out dev, ids[i], CM_LOCATE_DEVNODE_NORMAL) != 0) continue;
            if (CM_Get_DevNode_Status(out status, out problem, dev, 0) == 0) res[i] = status;
        }
        return res;
    }
}

'@

# The audio part is also written to disk for the auto-revert script (see below).
$AudioSource = @'
[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDcPolicyConfig {
    // Only the vtable order matters for the slots that are never called.
    [PreserveSig] int GetMixFormat();
    [PreserveSig] int GetDeviceFormat();
    [PreserveSig] int ResetDeviceFormat();
    [PreserveSig] int SetDeviceFormat();
    [PreserveSig] int GetProcessingPeriod();
    [PreserveSig] int SetProcessingPeriod();
    [PreserveSig] int GetShareMode();
    [PreserveSig] int SetShareMode();
    [PreserveSig] int GetPropertyValue();
    [PreserveSig] int SetPropertyValue();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
}

[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
class DcPolicyConfigClient { }

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDcMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDcMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IDcMMDevice endpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDcMMDevice device);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class DcMMDeviceEnumerator { }

public static class DcAudio {
    // Same call the Sound control panel makes for "Disable" / "Enable".
    public static int SetVisible(string endpointId, bool visible) {
        var pc = (IDcPolicyConfig)new DcPolicyConfigClient();
        try { return pc.SetEndpointVisibility(endpointId, visible ? 1 : 0); }
        finally { Marshal.ReleaseComObject(pc); }
    }

    // 1 active, 2 disabled, 4 not present, 8 unplugged; -1 unknown.
    public static int GetState(string endpointId) {
        var en = (IDcMMDeviceEnumerator)new DcMMDeviceEnumerator();
        try {
            IDcMMDevice dev;
            if (en.GetDevice(endpointId, out dev) != 0 || dev == null) return -1;
            int st;
            int hr = dev.GetState(out st);
            Marshal.ReleaseComObject(dev);
            return hr == 0 ? st : -1;
        } finally { Marshal.ReleaseComObject(en); }
    }

    // flow: 0 render, 1 capture. Returns the endpoint ID or "".
    public static string GetDefault(int flow) {
        var en = (IDcMMDeviceEnumerator)new DcMMDeviceEnumerator();
        try {
            IDcMMDevice dev;
            if (en.GetDefaultAudioEndpoint(flow, 0, out dev) != 0 || dev == null) return "";
            string id;
            int hr = dev.GetId(out id);
            Marshal.ReleaseComObject(dev);
            return hr == 0 ? id : "";
        } finally { Marshal.ReleaseComObject(en); }
    }
}
'@

$NativeSource = $NativeUsings + "`n" + $TreeSource + "`n" + $AudioSource

$script:Native = $false
try {
    Add-Type -TypeDefinition $NativeSource -Language CSharp
    $script:Native = $true
} catch {
    Write-Host ("Native helpers unavailable, falling back to slower PnP cmdlets: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

# ---------------------------------------------------------------- device model

# Classes whose devices are usually reachable from user code (serial, USB, sockets,
# audio APIs, HID, cameras, Bluetooth...). Everything else goes to "System components".
$ProgrammableClasses = @(
    'Ports', 'MultiPortSerial', 'Modem', 'USB', 'USBDevice', 'Net', 'AudioEndpoint', 'MEDIA',
    'HIDClass', 'Keyboard', 'Mouse', 'Camera', 'Image', 'Bluetooth', 'Printer', 'PrintQueue',
    'WPD', 'Biometric', 'SmartCardReader', 'SmartCard', 'Sensor', 'Infrared', 'Multifunction',
    '1394', 'AndroidUsbDeviceClass'
)

$DN_DISABLEABLE = 0x2000

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

function Get-DriverMap {
    $map = @{}
    try {
        foreach ($d in (Get-CimInstance -ClassName Win32_PnPSignedDriver -Property DeviceID, DriverVersion, DriverDate, DriverProviderName, InfName -ErrorAction Stop)) {
            if (-not $d.DeviceID) { continue }
            $date = ''
            if ($d.DriverDate) { try { $date = ([datetime]$d.DriverDate).ToString('yyyy-MM-dd') } catch { } }
            $map[[string]$d.DeviceID] = [ordered]@{
                ver      = [string]$d.DriverVersion
                date     = $date
                provider = [string]$d.DriverProviderName
                inf      = [string]$d.InfName
            }
        }
    } catch { }
    return $map
}

# Risk is a starting point from class + IDs + live state, NOT a safety guarantee.
# The per-device impact check (Get-DeviceImpact) adds what depends on the device.
# Levels: 0 low, 1 medium, 2 high, 3 critical (server refuses without force).
function Get-RiskAssessment([string]$cls, [string]$id, [string[]]$compat, $netStatus, [bool]$isRdp, [bool]$remoteLink) {
    $items = @()
    $uid = $id.ToUpperInvariant()

    if ($cls -in 'System', 'Computer', 'Processor', 'Firmware') { $items += , @(3, 'core') }
    elseif ($cls -eq 'DiskDrive' -and $uid.StartsWith('USBSTOR\')) { $items += , @(1, 'removable') }
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
        if ($remoteLink) { $items += , @(3, 'remoteLink') }
    }
    elseif ($cls -eq 'MEDIA') { $items += , @(1, 'audioController') }
    elseif ($cls -eq 'AudioEndpoint') { $items += , @(0, 'audioEndpoint') }
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

function ConvertTo-DeviceRecord($d, $netMap, $drvMap, [bool]$isRdp, $remoteIds) {
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
    $drv = $null
    if ($drvMap.ContainsKey($id)) { $drv = $drvMap[$id] }
    $link = [bool]($remoteIds -and $remoteIds.ContainsKey($id))
    $risk = Get-RiskAssessment $cls $id $compat $net $isRdp $link

    return [ordered]@{
        id          = $id
        name        = $name
        desc        = [string]$d.Description
        cls         = $cls
        mfr         = [string]$d.Manufacturer
        hwids       = $hw
        compat      = $compat
        service     = [string]$d.Service
        state       = $state
        code        = $code
        present     = $present
        prog        = ($ProgrammableClasses -contains $cls)
        risk        = $risk.Level
        reasons     = $risk.Reasons
        net         = $net
        remoteLink  = $link
        drv         = $drv
        parent      = ''
        disableable = $null
    }
}

# Fills parent and disableable for the given records (native when possible).
function Add-TreeInfo($records) {
    if (-not $records.Count) { return }
    $ids = [string[]]@($records | ForEach-Object { $_.id })
    if ($script:Native) {
        $parents = [DcNative]::GetParents($ids)
        $status = [DcNative]::GetStatus($ids)
        for ($i = 0; $i -lt $records.Count; $i++) {
            $records[$i].parent = $parents[$i]
            if ($status[$i] -ge 0) { $records[$i].disableable = ($status[$i] -band $DN_DISABLEABLE) -ne 0 }
        }
    } else {
        foreach ($r in $records) {
            try { $r.parent = [string](Get-PnpDeviceProperty -InstanceId $r.id -KeyName 'DEVPKEY_Device_Parent' -ErrorAction Stop).Data } catch { }
        }
    }
}

function Get-DeviceList {
    $netMap = Get-NetAdapterMap
    $drvMap = Get-DriverMap
    $isRdp = Test-IsRdp
    $remote = Get-RemoteInfo -Fresh
    $index = @{}
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($d in (Get-CimInstance -ClassName Win32_PnPEntity)) {
        $rec = ConvertTo-DeviceRecord $d $netMap $drvMap $isRdp $remote.set
        if (-not $rec.id -or $index.ContainsKey($rec.id)) { continue }
        $index[$rec.id] = $rec
        $list.Add($rec)
    }
    Add-TreeInfo $list

    $children = @{}
    foreach ($r in $list) {
        if (-not $r.parent) { continue }
        if (-not $children.ContainsKey($r.parent)) { $children[$r.parent] = New-Object System.Collections.Generic.List[string] }
        $children[$r.parent].Add($r.id)
    }
    Set-RemoteDependants $index $remote.set
    $script:DeviceIndex = $index
    $script:Children = $children
    return @{ devices = $list.ToArray(); rdp = $isRdp; remote = (ConvertTo-RemoteSummary $remote $index) }
}

function Get-SingleDevice([string]$id) {
    $q = $id.Replace('\', '\\').Replace("'", "\'")
    $d = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPDeviceID='$q'" | Select-Object -First 1
    if (-not $d) { return $null }
    $rec = ConvertTo-DeviceRecord $d (Get-NetAdapterMap) @{} (Test-IsRdp) (Get-RemoteInfo -Fresh).set
    $old = $script:DeviceIndex[$id]
    if ($old) { $rec.drv = $old.drv }   # driver info does not change on enable/disable
    Add-TreeInfo @($rec)
    return $rec
}

function Get-ChildIds([string]$id) {
    if ($script:Native -and $script:Children) {
        if ($script:Children.ContainsKey($id)) { return [string[]]$script:Children[$id].ToArray() }
        return [string[]]@()
    }
    try { return [string[]]@((Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Children' -ErrorAction Stop).Data) } catch { return [string[]]@() }
}

# What would actually break: walks the device tree below the device and looks
# for keyboards/mice, disks, network adapters and displays that depend on it.
function Get-DeviceImpact([string]$id) {
    $self = $script:DeviceIndex[$id]
    if (-not $self) { return @{ ok = $false; error = 'unknownDevice' } }

    $reasons = New-Object System.Collections.Generic.List[string]

    $disableable = $self.disableable
    if ($null -eq $disableable) {
        try {
            $st = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_DevNodeStatus' -ErrorAction Stop).Data
            if ($null -ne $st) { $disableable = (([uint32]$st) -band $DN_DISABLEABLE) -ne 0 }
        } catch { }
    }
    if ($disableable -eq $false -and $self.state -eq 'ok') { $reasons.Add('notDisableable') }

    $seen = @{}
    $queue = New-Object System.Collections.Generic.Queue[string]
    $queue.Enqueue($id)
    while ($queue.Count -gt 0 -and $seen.Count -lt 500) {
        $cur = $queue.Dequeue()
        foreach ($k in (Get-ChildIds $cur)) {
            if ($k -and -not $seen.ContainsKey($k)) { $seen[$k] = $true; $queue.Enqueue([string]$k) }
        }
    }

    $inputDevs = @(); $storage = @(); $net = @(); $display = @(); $audio = @()
    foreach ($k in $seen.Keys) {
        $rec = $script:DeviceIndex[$k]
        if (-not $rec -or $rec.state -eq 'disconnected') { continue }
        if ($rec.cls -in 'Keyboard', 'Mouse') { $inputDevs += $rec.name }
        elseif ($rec.cls -in 'DiskDrive', 'Volume', 'HDC', 'SCSIAdapter') { $storage += $rec.name }
        elseif ($rec.cls -eq 'Net') { $net += $rec.name }
        elseif ($rec.cls -eq 'Display') { $display += $rec.name }
        elseif ($rec.cls -eq 'AudioEndpoint') { $audio += $rec.name }
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

    if ($self.cls -eq 'AudioEndpoint') {
        $ep = Get-AudioEndpointInfo $id
        if ($ep -and $ep.isDefault) { $reasons.Add('audioDefault') }
    }

    $remote = Get-RemoteInfo -Fresh
    if ($remote.set.ContainsKey($id)) { $reasons.Add('remoteLink') }
    elseif ($seen.Keys | Where-Object { $remote.set.ContainsKey($_) }) { $reasons.Add('childRemoteLink') }

    return @{
        ok          = $true
        remote      = $remote.kinds
        id          = $id
        disableable = $disableable
        reasons     = [string[]]$reasons.ToArray()
        descendants = $seen.Count
        children    = @{
            input   = [string[]]($inputDevs | Select-Object -Unique -First 10)
            storage = [string[]]($storage | Select-Object -Unique -First 10)
            net     = [string[]]($net | Select-Object -Unique -First 10)
            display = [string[]]($display | Select-Object -Unique -First 10)
            audio   = [string[]]($audio | Select-Object -Unique -First 10)
        }
    }
}

# ---------------------------------------------------------------- data folder, remote sessions, auto-revert

$script:DataDir = $null
$script:DataDirOk = $null
$script:DataDirError = ''

# %ProgramData%\devices_control: writable by administrators and SYSTEM only. It holds the
# auto-revert script that SYSTEM runs, so a normal user must never be able to edit it.
function Initialize-DataDir {
    if ($null -ne $script:DataDirOk) { return $script:DataDirOk }
    $script:DataDirOk = $false
    try {
        if (-not $env:ProgramData) { throw 'ProgramData is not set' }
        $dir = Join-Path $env:ProgramData 'devices_control'
        $created = $false
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; $created = $true }
        $admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
        $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
        $me = $null
        try { $me = [Security.Principal.WindowsIdentity]::GetCurrent().User } catch { }
        $acl = Get-Acl -LiteralPath $dir
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
        $trusted = ($owner -eq $admins) -or ($owner -eq $system) -or ($created -and $owner -eq $me)
        if (-not $trusted) { throw "folder $dir is owned by $owner, expected Administrators or SYSTEM" }
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($r in @($acl.Access)) { [void]$acl.RemoveAccessRule($r) }
        foreach ($sid in @($admins, $system)) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
        }
        Set-Acl -LiteralPath $dir -AclObject $acl
        New-Item -ItemType Directory -Path (Join-Path $dir 'jobs') -Force | Out-Null
        $script:DataDir = $dir
        $script:DataDirOk = $true
    } catch { $script:DataDirError = $_.Exception.Message }
    return $script:DataDirOk
}

# --- remote sessions

$RemoteTools = @('remoting_host', 'AnyDesk', 'TeamViewer_Service', 'rustdesk', 'ScreenConnect.ClientService', 'winvnc', 'tvnserver', 'vncserver', 'parsecd', 'SRService')
$script:RemoteCache = $null
$script:RemoteCacheAt = [datetime]::MinValue

# Which adapters carry a remote session right now. SSH/RDP/WinRM/VNC are found through
# established connections on their server ports: the local address of such a connection
# belongs to the adapter the session came in on. For third-party remote-access tools the
# link is unknown, so the default-route adapter is assumed.
function Get-RemoteInfo([switch]$Fresh) {
    if (-not $Fresh -and $script:RemoteCache -and ((Get-Date) - $script:RemoteCacheAt).TotalSeconds -lt 5) { return $script:RemoteCache }
    $kinds = New-Object System.Collections.Generic.List[string]
    $tools = New-Object System.Collections.Generic.List[string]
    $set = @{}
    $portKind = @{ 22 = 'ssh'; 3389 = 'rdp'; 5985 = 'winrm'; 5986 = 'winrm'; 5900 = 'vnc' }

    $conns = @()
    try { $conns = @(Get-NetTCPConnection -State Established -LocalPort 22, 3389, 5985, 5986, 5900 -ErrorAction Stop) } catch { }
    foreach ($c in $conns) {
        $k = $portKind[[int]$c.LocalPort]
        if ($k -and -not $kinds.Contains($k)) { $kinds.Add($k) }
        $addr = ([string]$c.LocalAddress) -replace '%.*$', ''
        if ($addr -in '127.0.0.1', '::1', '0.0.0.0', '::') { continue }
        try {
            $ip = Get-NetIPAddress -IPAddress $addr -ErrorAction Stop | Select-Object -First 1
            $a = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -IncludeHidden -ErrorAction Stop
            if ($a.PnPDeviceID) { $set[[string]$a.PnPDeviceID] = $true }
        } catch { }
    }
    if (($env:SSH_CONNECTION -or $env:SSH_CLIENT) -and -not $kinds.Contains('ssh')) { $kinds.Add('ssh') }
    if ((Test-IsRdp) -and -not $kinds.Contains('rdp')) { $kinds.Add('rdp') }

    foreach ($n in $RemoteTools) {
        if (Get-Process -Name $n -ErrorAction SilentlyContinue) { $tools.Add($n) }
    }
    if ($tools.Count -and -not $set.Count) {
        try {
            $r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
            $a = Get-NetAdapter -InterfaceIndex $r.ifIndex -IncludeHidden -ErrorAction Stop
            if ($a.PnPDeviceID) { $set[[string]$a.PnPDeviceID] = $true }
        } catch { }
    }

    $info = @{ active = ($kinds.Count -gt 0 -or $tools.Count -gt 0); kinds = [string[]]$kinds.ToArray(); tools = [string[]]$tools.ToArray(); set = $set }
    $script:RemoteCache = $info
    $script:RemoteCacheAt = Get-Date
    return $info
}

function ConvertTo-RemoteSummary($remote, $index) {
    $links = @($remote.set.Keys | ForEach-Object {
        $r = $index[$_]
        @{ id = [string]$_; name = $(if ($r) { [string]$r.name } else { [string]$_ }) }
    })
    return @{ active = $remote.active; kinds = $remote.kinds; tools = $remote.tools; links = $links }
}

# Every ancestor of a remote adapter (its PCIe port, USB hub, ...) goes down with it.
function Set-RemoteDependants($index, $remoteIds) {
    foreach ($rid in @($remoteIds.Keys)) {
        $cur = $index[$rid]
        $hops = 0
        while ($cur -and $cur.parent -and $hops -lt 20) {
            $p = $index[$cur.parent]
            if (-not $p) { break }
            if ($p.reasons -notcontains 'childRemoteLink') { $p.reasons = [string[]]@($p.reasons + 'childRemoteLink') }
            if ($p.risk -lt 3) { $p.risk = 3 }
            $cur = $p
            $hops++
        }
    }
}

function Test-RemoteDependency([string]$id) {
    $set = (Get-RemoteInfo -Fresh).set
    if (-not $set.Count) { return $false }
    if ($set.ContainsKey($id)) { return $true }
    $seen = @{}
    $queue = New-Object System.Collections.Generic.Queue[string]
    $queue.Enqueue($id)
    while ($queue.Count -gt 0 -and $seen.Count -lt 500) {
        $cur = $queue.Dequeue()
        foreach ($k in (Get-ChildIds $cur)) {
            if (-not $k -or $seen.ContainsKey($k)) { continue }
            if ($set.ContainsKey($k)) { return $true }
            $seen[$k] = $true
            $queue.Enqueue([string]$k)
        }
    }
    return $false
}

# --- auto-revert (dead man's switch)
#
# Before a risky disable, a one-time Task Scheduler job is registered that runs
# rollback.ps1 as SYSTEM at T+N seconds. The job outlives this server, the browser and
# the network connection. Confirming in the UI removes the job; if nobody confirms, the
# device is enabled again.

$RollbackScriptText = @'
param([Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{32}$')][string]$Job)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$jobFile = Join-Path (Join-Path $dir 'jobs') ($Job + '.json')
if (-not (Test-Path -LiteralPath $jobFile)) { exit 0 }
$j = Get-Content -Raw -LiteralPath $jobFile | ConvertFrom-Json
$logFile = Join-Path $dir 'rollback.log'
function Write-Log([string]$t) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t
    try { [IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine, [Text.Encoding]::UTF8) } catch { }
}
$err = $null
try { Enable-PnpDevice -InstanceId ([string]$j.deviceId) -Confirm:$false -ErrorAction Stop | Out-Null } catch { $err = $_.Exception.Message }
if ($j.endpoint) {
    try {
        Add-Type -Path (Join-Path $dir 'audio.cs') -Language CSharp
        [void][DcAudio]::SetVisible([string]$j.endpoint, $true)
        $err = $null
    } catch { if (-not $err) { $err = $_.Exception.Message } }
}
if ($err) {
    Write-Log ('FAILED ENABLE  [{0}]  {1}  :: {2} (auto-revert)' -f $j.name, $j.deviceId, $err)
} else {
    Write-Log ('ENABLE  [{0}]  {1}  -> state=ok code=0 auto-revert' -f $j.name, $j.deviceId)
    Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue
}
Unregister-ScheduledTask -TaskName ('DevicesControl-Rollback-' + $Job) -Confirm:$false -ErrorAction SilentlyContinue
'@

function Write-RollbackFiles {
    $enc = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $script:DataDir 'rollback.ps1'), $RollbackScriptText, $enc)
    [IO.File]::WriteAllText((Join-Path $script:DataDir 'audio.cs'), ($NativeUsings + "`n" + $AudioSource), $enc)
}

function Start-RollbackJob($rec, [int]$seconds, [string]$endpoint) {
    if (-not (Initialize-DataDir)) { throw "data folder unavailable: $($script:DataDirError)" }
    Write-RollbackFiles
    $id = [guid]::NewGuid().ToString('N')
    $now = [DateTimeOffset]::UtcNow
    $job = [ordered]@{
        id        = $id
        deviceId  = [string]$rec.id
        name      = [string]$rec.name
        endpoint  = $endpoint
        createdAt = $now.ToUnixTimeMilliseconds()
        endsAt    = $now.AddSeconds($seconds).ToUnixTimeMilliseconds()
    }
    $file = Join-Path (Join-Path $script:DataDir 'jobs') ($id + '.json')
    [IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $job -Compress), (New-Object Text.UTF8Encoding($false)))
    try {
        $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Job {1}' -f (Join-Path $script:DataDir 'rollback.ps1'), $id
        $action = New-ScheduledTaskAction -Execute $ps -Argument $arg
        $trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Now.AddSeconds($seconds))
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
        Register-ScheduledTask -TaskName ('DevicesControl-Rollback-' + $id) -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    } catch {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        throw
    }
    return $job
}

function Get-RollbackJobs {
    $jobs = @()
    if (-not $script:IsAdmin -or -not (Initialize-DataDir)) { return $jobs }
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $script:DataDir 'jobs') -Filter '*.json' -ErrorAction SilentlyContinue)) {
        try {
            $j = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json
            if ([string]$j.id -notmatch '^[0-9a-f]{32}$') { continue }
            $jobs += [ordered]@{ id = [string]$j.id; deviceId = [string]$j.deviceId; name = [string]$j.name; createdAt = [double]$j.createdAt; endsAt = [double]$j.endsAt }
        } catch { }
    }
    return $jobs
}

# Cancels the scheduled revert (the user confirmed, or dismissed a stale entry).
function Stop-RollbackJob([string]$jobId) {
    if ($jobId -notmatch '^[0-9a-f]{32}$') { return @{ ok = $false; error = 'badJob' } }
    if (-not $script:IsAdmin) { return @{ ok = $false; error = 'notAdmin' } }
    if (-not (Initialize-DataDir)) { return @{ ok = $false; error = 'rollbackUnavailable'; message = $script:DataDirError } }
    $name = 'DevicesControl-Rollback-' + $jobId
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    # Never report "cancelled" while the task still exists: it would enable the device later.
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        return @{ ok = $false; error = 'taskNotRemoved' }
    }
    Remove-Item -LiteralPath (Join-Path (Join-Path $script:DataDir 'jobs') ($jobId + '.json')) -Force -ErrorAction SilentlyContinue
    return @{ ok = $true }
}

function Invoke-RollbackNow([string]$jobId) {
    $job = @(Get-RollbackJobs | Where-Object { $_.id -eq $jobId }) | Select-Object -First 1
    if (-not $job) { return @{ ok = $false; error = 'badJob' } }
    if (-not $script:DeviceIndex.Count) { [void](Get-DeviceList) }
    $res = Set-DeviceState $job.deviceId 'enable' $false 0
    if ($res.ok) { [void](Stop-RollbackJob $jobId) }
    return $res
}

# ---------------------------------------------------------------- audio endpoints

function Get-EndpointId([string]$instanceId) {
    # SWD\MMDEVAPI\{0.0.0.00000000}.{guid}  ->  {0.0.0.00000000}.{guid}
    $prefix = 'SWD\MMDEVAPI\'
    if (-not $instanceId.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $instanceId.Substring($prefix.Length).ToLowerInvariant()
}

function Get-AudioEndpointInfo([string]$instanceId) {
    if (-not $script:Native) { return $null }
    $ep = Get-EndpointId $instanceId
    if (-not $ep) { return $null }
    $flow = if ($ep.StartsWith('{0.0.1.')) { 1 } else { 0 }
    $state = -1; $def = ''
    try { $state = [DcAudio]::GetState($ep) } catch { }
    try { $def = [DcAudio]::GetDefault($flow) } catch { }
    $defName = ''
    if ($def) {
        $defRec = $script:DeviceIndex['SWD\MMDEVAPI\' + $def]
        $defName = if ($defRec) { $defRec.name } else { $def }
    }
    return @{
        endpoint    = $ep
        flow        = $(if ($flow -eq 1) { 'capture' } else { 'render' })
        state       = $state
        isDefault   = ($def -and $def.ToLowerInvariant() -eq $ep)
        defaultName = $defName
    }
}

# ---------------------------------------------------------------- enable / disable

function Set-DeviceState([string]$id, [string]$action, [bool]$force, [int]$rollback = 0, [bool]$directRemote = $false) {
    if (-not $script:IsAdmin) { return @{ ok = $false; error = 'notAdmin' } }
    if (-not $script:DeviceIndex.Count) { [void](Get-DeviceList) }   # e.g. the server was restarted while a page stayed open
    $rec = $script:DeviceIndex[$id]
    if (-not $rec) { return @{ ok = $false; error = 'unknownDevice' } }
    if ($action -eq 'disable' -and $rec.risk -ge 3 -and -not $force) { return @{ ok = $false; error = 'forceRequired' } }

    $enable = $action -eq 'enable'
    $audioHr = $null
    $ep = $null
    if ($rec.cls -eq 'AudioEndpoint' -and $script:Native) { $ep = Get-EndpointId $id }

    # A device that carries (or sits under) the remote session is disabled without auto-revert
    # only when the caller says so explicitly (directRemote): if the link drops, nobody is
    # there to press Enable. The UI sends the flag only in "no auto-revert" mode, after the
    # user typed the confirmation word.
    $job = $null
    $unguardedRemote = $false
    if (-not $enable) {
        if ($rollback -ne 0 -and ($rollback -lt 15 -or $rollback -gt 900)) { return @{ ok = $false; error = 'badRollback' } }
        if ($rollback -lt 15 -and (Test-RemoteDependency $id)) {
            if (-not $directRemote) { return @{ ok = $false; error = 'rollbackRequired' } }
            $unguardedRemote = $true
        }
        if ($rollback -ge 15) {
            try { $job = Start-RollbackJob $rec $rollback $(if ($ep) { $ep } else { '' }) }
            catch { return @{ ok = $false; error = 'rollbackUnavailable'; message = $_.Exception.Message } }
        }
    }

    # Audio endpoints: the audio policy switch is what actually stops/starts the
    # endpoint for apps; the PnP devnode is only its software mirror.
    if ($ep -and -not $enable) {
        try { $audioHr = [DcAudio]::SetVisible($ep, $false) } catch { $audioHr = -1 }
    }

    $pnpError = $null
    try {
        if ($enable) { Enable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop | Out-Null }
        else { Disable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop | Out-Null }
    } catch { $pnpError = $_.Exception.Message }

    if ($ep -and $enable) {
        try { $audioHr = [DcAudio]::SetVisible($ep, $true) } catch { $audioHr = -1 }
    }

    if ($pnpError -and -not ($ep -and $audioHr -eq 0)) {
        if ($job) { [void](Stop-RollbackJob $job.id) }
        Write-ActionLog ("FAILED {0}  [{1}]  {2}  :: {3}" -f $action.ToUpper(), $rec.name, $id, $pnpError)
        $script:History.Add([ordered]@{ t = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); action = $action; name = $rec.name; id = $id; ok = $false; message = $pnpError })
        return @{ ok = $false; error = 'osError'; message = $pnpError }
    }

    Start-Sleep -Milliseconds 800
    $new = Get-SingleDevice $id
    if (-not $new) { $new = $rec }
    $script:DeviceIndex[$id] = $new
    Set-RemoteDependants $script:DeviceIndex (Get-RemoteInfo).set

    $audio = $null
    if ($ep) {
        $audio = Get-AudioEndpointInfo $id
        # The devnode may stay "ok" while the endpoint is disabled (or the reverse);
        # what apps see is the endpoint state, so report that.
        if ($audio -and $audio.state -eq 2) { $new.state = 'disabled'; $new.code = 22 }
        elseif ($audio -and $audio.state -eq 1 -and $new.state -eq 'disabled') { $new.state = 'ok'; $new.code = 0 }
    }

    $expected = if ($enable) { 'ok' } else { 'disabled' }
    $needsRestart = ($new.code -eq 14) -or ($new.state -ne $expected)
    $suffix = ''
    if ($audio) { $suffix = ' audioState={0} default=[{1}]' -f $audio.state, $audio.defaultName }
    if ($job) { $suffix += ' auto-revert-in={0}s' -f $rollback }
    if ($unguardedRemote) { $suffix += ' NO-AUTO-REVERT (device carries the remote session)' }
    Write-ActionLog ("{0}  [{1}]  {2}  -> state={3} code={4}{5}" -f $action.ToUpper(), $rec.name, $id, $new.state, $new.code, $suffix)
    $script:History.Add([ordered]@{ t = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); action = $action; name = $rec.name; id = $id; ok = $true; state = $new.state })
    return @{ ok = $true; device = $new; needsRestart = $needsRestart; audio = $audio; pnpWarning = $pnpError; rollbackJob = $job }
}

# ---------------------------------------------------------------- system info & metrics

function Get-CimSafe([string]$class, [string]$filter) {
    try {
        if ($filter) { return @(Get-CimInstance -ClassName $class -Filter $filter -ErrorAction Stop) }
        return @(Get-CimInstance -ClassName $class -ErrorAction Stop)
    } catch { return @() }
}

function Get-SysInfo {
    $os = Get-CimSafe 'Win32_OperatingSystem' | Select-Object -First 1
    $cs = Get-CimSafe 'Win32_ComputerSystem' | Select-Object -First 1
    $cpus = Get-CimSafe 'Win32_Processor'
    $board = Get-CimSafe 'Win32_BaseBoard' | Select-Object -First 1
    $bios = Get-CimSafe 'Win32_BIOS' | Select-Object -First 1
    $mem = Get-CimSafe 'Win32_PhysicalMemory'
    $boot = $null
    $uptime = $null
    if ($os -and $os.LastBootUpTime) {
        $boot = ([datetime]$os.LastBootUpTime).ToString('yyyy-MM-dd HH:mm')
        $uptime = [int]((Get-Date) - [datetime]$os.LastBootUpTime).TotalSeconds
    }
    $biosDate = ''
    if ($bios -and $bios.ReleaseDate) { try { $biosDate = ([datetime]$bios.ReleaseDate).ToString('yyyy-MM-dd') } catch { } }

    $gpus = @(Get-CimSafe 'Win32_VideoController' | ForEach-Object {
        [ordered]@{ name = [string]$_.Name; driver = [string]$_.DriverVersion; ram = [double]$_.AdapterRAM; mode = [string]$_.VideoModeDescription }
    })
    $volumes = @(Get-CimSafe 'Win32_LogicalDisk' 'DriveType=2 OR DriveType=3' | ForEach-Object {
        [ordered]@{ letter = [string]$_.DeviceID; label = [string]$_.VolumeName; fs = [string]$_.FileSystem; size = [double]$_.Size; free = [double]$_.FreeSpace; removable = ($_.DriveType -eq 2) }
    })
    $battery = @(Get-CimSafe 'Win32_Battery' | ForEach-Object {
        [ordered]@{ name = [string]$_.Name; charge = [int]$_.EstimatedChargeRemaining; status = [int]$_.BatteryStatus }
    })

    $secureBoot = $null
    try { $secureBoot = [bool](Confirm-SecureBootUEFI -ErrorAction Stop) } catch { }

    return @{
        ok       = $true
        os       = [ordered]@{ name = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; arch = [string]$os.OSArchitecture; boot = $boot; uptime = $uptime }
        computer = [ordered]@{ name = $env:COMPUTERNAME; user = $env:USERNAME; mfr = [string]$cs.Manufacturer; model = [string]$cs.Model; domain = [string]$cs.Domain }
        cpu      = [ordered]@{ name = ([string]($cpus | Select-Object -First 1).Name).Trim(); count = $cpus.Count; cores = [int](($cpus | Measure-Object NumberOfCores -Sum).Sum); threads = [int](($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum); mhz = [int](($cpus | Select-Object -First 1).MaxClockSpeed) }
        memory   = [ordered]@{ total = [double]$cs.TotalPhysicalMemory; modules = $mem.Count; speed = [int](($mem | Measure-Object Speed -Maximum).Maximum) }
        board    = [ordered]@{ mfr = [string]$board.Manufacturer; product = [string]$board.Product }
        bios     = [ordered]@{ vendor = [string]$bios.Manufacturer; version = [string]$bios.SMBIOSBIOSVersion; date = $biosDate; secureBoot = $secureBoot }
        gpus     = $gpus
        volumes  = $volumes
        battery  = $battery
        admin    = $script:IsAdmin
        native   = $script:Native
    }
}

# Rates are computed from raw counters (two samples), because the "formatted"
# WMI perf classes return zeros on one-shot queries. Counter names are not used
# at all, so it works on localized Windows too.
$script:PrevPerf = $null

function Get-Perf {
    $now = @{}
    $cpu = Get-CimSafe 'Win32_PerfRawData_PerfOS_Processor' "Name='_Total'" | Select-Object -First 1
    if ($cpu) { $now.cpuBusy = [double]$cpu.PercentProcessorTime; $now.cpuTs = [double]$cpu.Timestamp_Sys100NS }

    $nets = Get-CimSafe 'Win32_PerfRawData_Tcpip_NetworkInterface'
    if ($nets.Count) {
        $now.rx = [double](($nets | Measure-Object BytesReceivedPersec -Sum).Sum)
        $now.tx = [double](($nets | Measure-Object BytesSentPersec -Sum).Sum)
        $now.netT = [double]$nets[0].Timestamp_PerfTime
        $now.netF = [double]$nets[0].Frequency_PerfTime
    }
    $disk = Get-CimSafe 'Win32_PerfRawData_PerfDisk_PhysicalDisk' "Name='_Total'" | Select-Object -First 1
    if ($disk) {
        $now.dr = [double]$disk.DiskReadBytesPersec
        $now.dw = [double]$disk.DiskWriteBytesPersec
        $now.diskT = [double]$disk.Timestamp_PerfTime
        $now.diskF = [double]$disk.Frequency_PerfTime
    }

    $res = [ordered]@{ ok = $true; t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); cpu = $null; rx = $null; tx = $null; diskRead = $null; diskWrite = $null }
    $p = $script:PrevPerf
    if ($p) {
        if ($now.cpuTs -and $p.cpuTs -and $now.cpuTs -gt $p.cpuTs) {
            $idle = ($now.cpuBusy - $p.cpuBusy) / ($now.cpuTs - $p.cpuTs)
            $res.cpu = [math]::Round([math]::Min(100, [math]::Max(0, 100 * (1 - $idle))), 1)
        }
        if ($now.netT -and $p.netT -and $now.netT -gt $p.netT -and $now.netF) {
            $sec = ($now.netT - $p.netT) / $now.netF
            $res.rx = [math]::Max(0, [math]::Round(($now.rx - $p.rx) / $sec))
            $res.tx = [math]::Max(0, [math]::Round(($now.tx - $p.tx) / $sec))
        }
        if ($now.diskT -and $p.diskT -and $now.diskT -gt $p.diskT -and $now.diskF) {
            $sec = ($now.diskT - $p.diskT) / $now.diskF
            $res.diskRead = [math]::Max(0, [math]::Round(($now.dr - $p.dr) / $sec))
            $res.diskWrite = [math]::Max(0, [math]::Round(($now.dw - $p.dw) / $sec))
        }
    }
    $script:PrevPerf = $now
    if ($null -eq $res.cpu -and $cpu) {
        $lp = Get-CimSafe 'Win32_Processor' | Measure-Object LoadPercentage -Average
        if ($lp.Count) { $res.cpu = [math]::Round([double]$lp.Average, 1) }
    }

    $os = Get-CimSafe 'Win32_OperatingSystem' | Select-Object -First 1
    if ($os) {
        $res.memTotal = [double]$os.TotalVisibleMemorySize * 1024
        $res.memUsed = ([double]$os.TotalVisibleMemorySize - [double]$os.FreePhysicalMemory) * 1024
    }
    $res.top = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object {
        [ordered]@{ name = $_.ProcessName; mem = [double]$_.WorkingSet64 }
    })
    return $res
}

function Get-History {
    $lines = @()
    try {
        if (Test-Path -LiteralPath $LogPath) { $lines += [IO.File]::ReadAllLines($LogPath, [Text.Encoding]::UTF8) }
        # Entries written by the auto-revert script (it runs as SYSTEM and logs to the data folder).
        if ($script:IsAdmin -and (Initialize-DataDir)) {
            $rb = Join-Path $script:DataDir 'rollback.log'
            if (Test-Path -LiteralPath $rb) { $lines += [IO.File]::ReadAllLines($rb, [Text.Encoding]::UTF8) }
        }
        $lines = @($lines | Sort-Object { if ($_.Length -ge 19) { $_.Substring(0, 19) } else { '' } } | Select-Object -Last 300)
    } catch { }
    return @{ ok = $true; log = [string[]]$lines; logPath = $LogPath }
}

# ---------------------------------------------------------------- HTTP

function ConvertTo-JsonText($o) { return ConvertTo-Json -InputObject $o -Depth 8 -Compress }

function Send-Response($ctx, [int]$status, [string]$type, [string]$body) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $r = $ctx.Response
    $r.StatusCode = $status
    $r.ContentType = $type
    $r.AddHeader('Cache-Control', 'no-store')
    $r.AddHeader('X-Content-Type-Options', 'nosniff')
    $r.AddHeader('X-Frame-Options', 'DENY')
    if ($type.StartsWith('text/html')) {
        $r.AddHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
    }
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

function Send-Static($ctx, [string]$path) {
    $name = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
    # Flat whitelist: no sub-folders, no "..", only known extensions.
    if ($name -notmatch '^[A-Za-z0-9_\-]+\.(html|js|css|svg)$') { Send-Response $ctx 404 'text/plain' 'Not found'; return }
    $file = Join-Path $WebRoot $name
    if (-not (Test-Path -LiteralPath $file)) { Send-Response $ctx 404 'text/plain' 'Not found'; return }
    $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
    Send-Response $ctx 200 $StaticTypes[$ext] ([IO.File]::ReadAllText($file, [Text.Encoding]::UTF8))
}

function Invoke-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $json = 'application/json; charset=utf-8'

    # Blocks DNS-rebinding: only the exact loopback host is accepted.
    if ($req.UserHostName -ne "127.0.0.1:$Port") { Send-Response $ctx 400 'text/plain' 'Bad host'; return }

    if (-not $path.StartsWith('/api/')) {
        if ($req.HttpMethod -ne 'GET') { Send-Response $ctx 405 'text/plain' 'Method not allowed'; return }
        Send-Static $ctx $path
        return
    }

    # The custom header forces a CORS preflight, which this server never approves,
    # so other web pages cannot drive the API even if they guess the port.
    if ($req.Headers['X-Token'] -ne $Token) { Send-Response $ctx 403 $json '{"ok":false,"error":"badToken"}'; return }
    if ($req.HttpMethod -ne 'POST') { Send-Response $ctx 405 $json '{"ok":false,"error":"method"}'; return }

    $body = Read-JsonBody $req
    switch ($path) {
        '/api/devices' {
            $data = Get-DeviceList
            $res = @{ ok = $true; admin = $script:IsAdmin; native = $script:Native; rdp = $data.rdp; remote = $data.remote; computer = $env:COMPUTERNAME; devices = $data.devices }
        }
        '/api/impact' { $res = Get-DeviceImpact ([string]$body.id) }
        '/api/set' {
            $action = [string]$body.action
            if ($action -notin 'enable', 'disable') { $res = @{ ok = $false; error = 'badAction' } }
            else { $res = Set-DeviceState ([string]$body.id) $action ([bool]$body.force) ([int]$body.rollback) ([bool]$body.directRemote) }
        }
        '/api/rollbacks' { $res = @{ ok = $true; now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); jobs = @(Get-RollbackJobs) } }
        '/api/rollback/confirm' { $res = Stop-RollbackJob ([string]$body.job) }
        '/api/rollback/revert' { $res = Invoke-RollbackNow ([string]$body.job) }
        '/api/sysinfo' { $res = Get-SysInfo }
        '/api/perf' { $res = Get-Perf }
        '/api/history' { $res = Get-History }
        '/api/shutdown' {
            $script:Running = $false
            $res = @{ ok = $true }
        }
        default { Send-Response $ctx 404 $json '{"ok":false,"error":"notFound"}'; return }
    }
    Send-Response $ctx 200 $json (ConvertTo-JsonText $res)
}

# ---------------------------------------------------------------- main

$remembered = $RememberToken -and $script:IsAdmin -and (Initialize-DataDir)
if ($RememberToken -and -not $remembered) {
    Write-Host ("-RememberToken ignored: {0}" -f $(if (-not $script:IsAdmin) { 'needs administrator rights' } else { $script:DataDirError })) -ForegroundColor Yellow
}

$portFile = if ($remembered) { Join-Path $script:DataDir 'port.txt' } else { $null }
if (-not $Port -and $portFile -and (Test-Path -LiteralPath $portFile)) {
    $saved = 0
    if ([int]::TryParse(([IO.File]::ReadAllText($portFile)).Trim(), [ref]$saved) -and $saved -ge 1024 -and $saved -le 65535) { $Port = $saved }
}
if ($Port) {
    # Make sure the (remembered) port is free; otherwise fall back to a random one.
    try { $t = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port); $t.Start(); $t.Stop() } catch { $Port = 0 }
}
if (-not $Port) {
    $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $Port = $probe.LocalEndpoint.Port
    $probe.Stop()
}
if ($portFile) { try { [IO.File]::WriteAllText($portFile, "$Port") } catch { } }

$Token = $null
if ($remembered) {
    $tokenFile = Join-Path $script:DataDir 'token.txt'
    try { if (Test-Path -LiteralPath $tokenFile) { $Token = ([IO.File]::ReadAllText($tokenFile)).Trim() } } catch { }
    if ($Token -notmatch '^[0-9a-f]{32}$') {
        $Token = [guid]::NewGuid().ToString('N')
        try { [IO.File]::WriteAllText($tokenFile, $Token) } catch { }
    }
} else {
    $Token = [guid]::NewGuid().ToString('N')
}
$script:DeviceIndex = @{}
$script:Children = @{}
$script:History = New-Object System.Collections.Generic.List[object]
$Url = "http://127.0.0.1:$Port/?t=$Token"

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

try { $Host.UI.RawUI.WindowTitle = 'devices_control_v3' } catch { }
Write-Host ''
Write-Host ' devices_control_v3' -ForegroundColor Cyan
Write-Host (' Admin rights : {0}' -f $(if ($script:IsAdmin) { 'YES' } else { 'NO (read-only)' }))
Write-Host (' Native API   : {0}' -f $(if ($script:Native) { 'YES' } else { 'NO (slower fallback)' }))
Write-Host " UI           : $Url"
if ($remembered) { Write-Host ' Link         : stays the same after restart (token.txt / port.txt in the data folder)' -ForegroundColor DarkGray }
$pending = @(Get-RollbackJobs)
if ($pending.Count) { Write-Host (" Auto-revert  : {0} pending job(s), see the banner in the UI" -f $pending.Count) -ForegroundColor Yellow }
Write-Host " Action log   : $LogPath"
Write-Host ' Close this window or press Ctrl+C to stop the server.' -ForegroundColor DarkGray
Write-Host ''

# Over SSH there is no desktop to show a browser on; the URL printed above is for your own browser.
if ($env:SSH_CONNECTION -or $env:SSH_CLIENT) { $NoBrowser = $true }

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
