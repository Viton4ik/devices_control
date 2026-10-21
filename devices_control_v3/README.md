# devices_control_v3

Local web UI (Windows 10/11) for inspecting PnP devices and enabling/disabling them, now safe to use over a remote connection.

Full documentation and screenshots: see the [repository README](../README.md).

## Files
- `devices_control_v3.bat` - double-click to start.
- `devices_control_v3.ps1` - server (Windows PowerShell 5.1+, nothing to install). Asks for admin rights via UAC.
- `web\` - UI. Keep it next to the .ps1.
- `devices_control_v3.log` - every enable / disable, with the device ID.

## What is new in v3
- **Auto-revert.** A disable can be armed with a timer (30 s to 15 min in the UI). A one-time Task Scheduler job runs `%ProgramData%\devices_control\rollback.ps1` as SYSTEM and enables the device again unless you pressed *Keep disabled* in time.
- **Remote sessions are detected** (SSH, RDP, WinRM, VNC through established connections on their ports; remote-access tools by process name). The adapter carrying the session and every device above it in the tree need auto-revert; the server enforces it.
- **Touch mode**: tap instead of hover, with a bottom sheet.
- **`-RememberToken`**: keeps token and port in `%ProgramData%\devices_control` so a bookmarked link keeps working.
- Runs without opening a browser when started from an SSH session.

## Parameters
| Parameter | Meaning |
|---|---|
| `-Port N` | Fixed port (default: random). |
| `-NoBrowser` | Do not open the browser. |
| `-RememberToken` | Keep token and port between runs. Delete `token.txt` in the data folder to rotate. |

## Undo
Yellow bar *Revert now*, Overview -> Disabled devices -> Enable, Device Manager, or
`Enable-PnpDevice -InstanceId '<ID from the log>' -Confirm:$false`. A reboot does NOT re-enable a device.
