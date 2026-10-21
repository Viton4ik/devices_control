# devices_control_v1

Local web UI (Windows 10/11) for listing PnP devices and enabling/disabling them.

## Files
- `devices_control_v1.bat` - double-click to start.
- `devices_control_v1.ps1` - server (PowerShell 5.1+, no installs). Asks for admin rights via UAC.
- `devices_control_v1.html` - UI. Must stay next to the .ps1.
- `devices_control_v1.log` - created on first action: every enable/disable with the device ID.

## Run
Double-click `devices_control_v1.bat`, accept UAC. The browser opens at `http://127.0.0.1:<port>/?t=<token>`.
Stop with the "Stop server" button or by closing the PowerShell window.

Options: `devices_control_v1.ps1 -Port 8080 -NoBrowser`

## Safety
- Server listens on 127.0.0.1 only; API requires a one-time token per run.
- Risk is computed from class + live state (active network adapter, default route, RDP session)
  and, before each disable, from the device tree: keyboards/mice/disks/network/display that depend on it.
- Critical devices require typing a confirmation word; the server refuses them without it.

## Undo
If you lost keyboard/mouse/network: Device Manager (devmgmt.msc) -> View -> the device -> Enable,
or from an admin console: `Enable-PnpDevice -InstanceId '<ID from the log>' -Confirm:$false`.
A reboot does NOT re-enable a disabled device.
