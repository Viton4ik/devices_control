# devices_control_v2

Local web UI (Windows 10/11) for inspecting PnP devices and enabling/disabling them.

## Files
- `devices_control_v2.bat` - double-click to start.
- `devices_control_v2.ps1` - server (Windows PowerShell 5.1+, nothing to install). Asks for admin rights via UAC.
- `web\` - UI (index.html, app.css, i18n.js, knowledge.js, app.js, map.js, dashboard.js, main.js). Keep it next to the .ps1.
- `devices_control_v2.log` - created on first action: every enable/disable with the device ID.

## Tabs
- **Overview** - device counters, live CPU / memory / network / disk charts, disk space, system info,
  devices by function, devices with errors, disabled devices (with Enable buttons), action history.
- **PC map** - an illustrated PC; hover a part to see its devices, click for the device tree of that part.
  In the tree, hovering a node highlights everything that would go down with it.
- **Programmable** / **System components** - cards grouped by function, search and filters.

## What changed since v1
- Audio endpoints (speakers, microphones, stereo mix) are switched through the Windows audio policy,
  the same call the Sound control panel makes. v1 only disabled the PnP node, which does not stop playback.
  After disabling, the UI tells you where Windows routed the sound.
- Device tree and "Windows does not allow disabling this device" come from cfgmgr32 (fast, no PowerShell per device).
- Driver version/date/provider, functional groups, detailed explanations recognised from hardware IDs
  (marked "assumption" when inferred), vendor by PCI/USB/EDID ID.

## Undo
Device Manager (devmgmt.msc) -> the device -> Enable, or from an admin console:
`Enable-PnpDevice -InstanceId '<ID from the log>' -Confirm:$false`. A reboot does NOT re-enable a device.
