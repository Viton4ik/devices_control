'use strict';
// What each device is: functional groups, class descriptions, ID-based recognition
// rules and vendor tables. Rules work on hardware/compatible IDs, which do not depend
// on the Windows display language, so they recognise devices on Russian Windows too.

// ------------------------------------------------------------------ functional groups

const GROUPS = [
  // key, ru, en, ru desc, en desc, programmable zone
  ['comm',      'Порты COM/LPT и модемы', 'COM/LPT ports and modems', 'Последовательные и параллельные порты, переходники USB-COM, модемы.', 'Serial and parallel ports, USB-serial adapters, modems.', true],
  ['usb',       'USB-контроллеры и хабы', 'USB controllers and hubs', 'Хост-контроллеры, корневые и внешние концентраторы, составные USB-устройства.', 'Host controllers, root and external hubs, composite USB devices.', true],
  ['net',       'Сеть', 'Network', 'Ethernet, Wi-Fi, VPN и виртуальные адаптеры, служебные минипорты Windows.', 'Ethernet, Wi-Fi, VPN and virtual adapters, Windows helper miniports.', true],
  ['audio',     'Звук', 'Audio', 'Звуковые контроллеры, кодеки и аудиоточки (динамики, наушники, микрофоны).', 'Sound controllers, codecs and audio endpoints (speakers, headphones, mics).', true],
  ['input',     'Ввод: клавиатура, мышь, HID', 'Input: keyboard, mouse, HID', 'Клавиатуры, мыши, тачпады, геймпады и прочие HID-устройства.', 'Keyboards, mice, touchpads, gamepads and other HID devices.', true],
  ['camera',    'Камеры и сканеры', 'Cameras and scanners', 'Веб-камеры, ИК-камеры Windows Hello, сканеры.', 'Webcams, Windows Hello IR cameras, scanners.', true],
  ['bluetooth', 'Bluetooth', 'Bluetooth', 'Радиомодуль Bluetooth, сопряжённые устройства и их профили.', 'Bluetooth radio, paired devices and their profiles.', true],
  ['print',     'Печать', 'Printing', 'Принтеры, МФУ и очереди печати, включая виртуальные (PDF, XPS).', 'Printers, MFPs and print queues, including virtual ones (PDF, XPS).', true],
  ['portable',  'Телефоны и портативные', 'Phones and portable', 'Телефоны, плееры, фотоаппараты (MTP/PTP), Android ADB.', 'Phones, players, cameras (MTP/PTP), Android ADB.', true],
  ['security',  'Безопасность и биометрия', 'Security and biometrics', 'TPM, сканеры отпечатков, считыватели смарт-карт.', 'TPM, fingerprint readers, smart card readers.', true],
  ['sensors',   'Датчики', 'Sensors', 'Акселерометр, гироскоп, датчики освещённости и ориентации, ИК-порт.', 'Accelerometer, gyroscope, light and orientation sensors, infrared.', true],
  ['display',   'Видео и мониторы', 'Graphics and monitors', 'Видеокарты (встроенные и дискретные) и подключённые мониторы.', 'Graphics adapters (integrated and discrete) and attached monitors.', false],
  ['storage',   'Хранение данных', 'Storage', 'Контроллеры SATA/NVMe, физические диски, тома, флешки, приводы.', 'SATA/NVMe controllers, physical disks, volumes, flash drives, optical drives.', false],
  ['cpu',       'Процессор', 'Processor', 'Логические процессоры (ядра/потоки) центрального процессора.', 'Logical processors (cores/threads) of the CPU.', false],
  ['board',     'Системная плата и шины', 'Mainboard and buses', 'Чипсет, шины PCI Express, ACPI, таймеры, контроллеры прерываний, прошивка UEFI.', 'Chipset, PCI Express buses, ACPI, timers, interrupt controllers, UEFI firmware.', false],
  ['power',     'Питание', 'Power', 'Батарея, адаптер питания, кнопки питания и сна, датчик крышки.', 'Battery, AC adapter, power and sleep buttons, lid switch.', false],
  ['software',  'Программные и виртуальные устройства', 'Software and virtual devices', 'Устройства без собственного «железа»: создаются Windows и драйверами (шины, компоненты, эмуляторы).', 'Devices without hardware of their own: created by Windows and drivers (buses, components, emulators).', false],
  ['other',     'Прочее', 'Other', 'Устройства, назначение которых не удалось определить по классу.', 'Devices whose purpose could not be determined from the class.', false],
].map(([key, ru, en, dru, den, prog], order) => ({ key, ru, en, dru, den, prog, order }));
const GROUP_BY_KEY = Object.fromEntries(GROUPS.map(g => [g.key, g]));

const CLASS_GROUP = {
  Ports: 'comm', MultiPortSerial: 'comm', Modem: 'comm',
  USB: 'usb', USBDevice: 'usb',
  Net: 'net',
  AudioEndpoint: 'audio', MEDIA: 'audio', AudioProcessingObject: 'audio',
  Keyboard: 'input', Mouse: 'input', HIDClass: 'input', XnaComposite: 'input', XboxComposite: 'input',
  Camera: 'camera', Image: 'camera',
  Bluetooth: 'bluetooth',
  Printer: 'print', PrintQueue: 'print',
  WPD: 'portable', AndroidUsbDeviceClass: 'portable',
  Biometric: 'security', SmartCardReader: 'security', SmartCard: 'security', SecurityDevices: 'security',
  Sensor: 'sensors', Infrared: 'sensors',
  Display: 'display', Monitor: 'display',
  DiskDrive: 'storage', Volume: 'storage', VolumeSnapshot: 'storage', HDC: 'storage', SCSIAdapter: 'storage',
  SCSIController: 'storage', SDHost: 'storage', CDROM: 'storage', FloppyDisk: 'storage', fdc: 'storage', MTD: 'storage',
  Processor: 'cpu',
  System: 'board', Computer: 'board', Firmware: 'board', '1394': 'board', Multifunction: 'board',
  Battery: 'power',
  SoftwareDevice: 'software', SoftwareComponent: 'software', Extension: 'software', LegacyDriver: 'software',
};

function groupOf(d) {
  const id = (d.id || '').toUpperCase();
  const g = CLASS_GROUP[d.cls];
  if (g === 'board' && /^(ROOT|SWD)\\/.test(id)) return 'software';
  if (g === 'board' && /ACPI\\(PNP0C0A|ACPI0003|PNP0C0C|PNP0C0D|PNP0C0E)/.test(idsOf(d))) return 'power';
  if (g) return g;
  if (id.startsWith('SWD\\MMDEVAPI')) return 'audio';
  if (/^(USB|USBSTOR)\\/.test(id)) return id.startsWith('USBSTOR') ? 'storage' : 'usb';
  if (id.startsWith('HID\\')) return 'input';
  if (/^BTH/.test(id)) return 'bluetooth';
  if (id.startsWith('DISPLAY\\')) return 'display';
  if (/^(ROOT|SWD|SW)\\/.test(id)) return 'software';
  if (/^(PCI|ACPI)\\/.test(id)) return 'board';
  return 'other';
}

// ------------------------------------------------------------------ class descriptions

const CLASS_TEXT = {
  Ports: ['COM- и LPT-порты. Через COM-порт работают Arduino и другие микроконтроллеры, GPS-приёмники, сканеры штрихкодов, промышленное оборудование, переходники USB-RS232.',
          'COM and LPT ports. Arduino and other microcontrollers, GPS receivers, barcode scanners, industrial gear and USB-RS232 adapters talk through COM ports.'],
  MultiPortSerial: ['Многопортовая плата или адаптер последовательных портов (несколько COM на одном устройстве).', 'Multi-port serial card or adapter (several COM ports on one device).'],
  Modem: ['Модем: дозвон, 3G/4G или факс. Управляется AT-командами через COM-порт.', 'Modem: dial-up, 3G/4G or fax. Controlled with AT commands over a COM port.'],
  USB: ['USB-инфраструктура: хост-контроллеры (сами порты), концентраторы и составные устройства. Отключение контроллера или хаба гасит всё, что к нему подключено, - именно так чаще всего теряют клавиатуру и мышь.',
        'USB infrastructure: host controllers (the ports themselves), hubs and composite devices. Disabling a controller or hub kills everything attached to it - the usual way people lose their keyboard and mouse.'],
  USBDevice: ['USB-устройство без отдельного класса Windows: программаторы, отладочные платы, ключи защиты, устройства с драйвером WinUSB.', 'USB device without its own Windows class: programmers, dev boards, dongles, WinUSB devices.'],
  Net: ['Сетевой адаптер. Физические (Ethernet, Wi-Fi) дают доступ в сеть; виртуальные создаются VPN, виртуальными машинами и самой Windows (WAN Miniport - служебные адаптеры для VPN/PPPoE).',
        'Network adapter. Physical ones (Ethernet, Wi-Fi) connect you to the network; virtual ones are created by VPNs, virtual machines and Windows itself (WAN Miniports are helper adapters for VPN/PPPoE).'],
  AudioEndpoint: ['Аудиоточка - конкретный выход или вход звука (динамики, наушники, микрофон, «стерео микшер»). Это программный узел над звуковым контроллером: отключение точки не выключает звуковую карту, приложения просто переключаются на другой выход. Чтобы выключить звук целиком, отключайте родительский контроллер из класса MEDIA.',
                  'Audio endpoint - one specific sound output or input (speakers, headphones, microphone, "stereo mix"). It is a software node on top of the sound controller: disabling it does not turn the sound card off, apps just switch to another output. To kill sound entirely, disable the parent controller in the MEDIA class.'],
  MEDIA: ['Звуковой, видео- или игровой контроллер: аудиокодек (Realtek и т.п.), звук по HDMI/DisplayPort, USB-аудио, MIDI, виртуальные аудиоустройства. Отключение убирает все его аудиоточки сразу.',
          'Sound, video or game controller: audio codec (Realtek etc.), HDMI/DisplayPort audio, USB audio, MIDI, virtual audio devices. Disabling it removes all its audio endpoints at once.'],
  AudioProcessingObject: ['Программный аудиоэффект (APO): эквалайзер, шумоподавление, пространственный звук от производителя.', 'Software audio effect (APO): equaliser, noise suppression, vendor spatial sound.'],
  HIDClass: ['HID (Human Interface Device) - универсальный протокол устройств ввода. Сюда попадают сами USB/Bluetooth/I2C-интерфейсы клавиатур и мышей, тачпады, сенсорные экраны, геймпады, мультимедийные кнопки, датчики и служебные каналы фирменных утилит (подсветка, DPI).',
              'HID (Human Interface Device) - the universal input protocol. This covers the USB/Bluetooth/I2C interfaces of keyboards and mice, touchpads, touch screens, gamepads, media keys, sensors and vendor utility channels (lighting, DPI).'],
  Keyboard: ['Клавиатура (логическое устройство Windows). Физически за ней стоит HID- или PS/2-интерфейс.', 'Keyboard (Windows logical device). Physically backed by a HID or PS/2 interface.'],
  Mouse: ['Мышь, тачпад, трекбол или перо (логическое указывающее устройство).', 'Mouse, touchpad, trackball or pen (logical pointing device).'],
  Camera: ['Камера: веб-камера, встроенная камера ноутбука или ИК-камера Windows Hello.', 'Camera: webcam, built-in laptop camera or Windows Hello IR camera.'],
  Image: ['Устройство захвата изображений: камера старого типа, сканер, иногда МФУ.', 'Imaging device: legacy camera, scanner, sometimes an MFP.'],
  Bluetooth: ['Bluetooth: сам радиомодуль, перечислители протоколов и каждое сопряжённое устройство вместе с его профилями (звук, HID, COM-порт по Bluetooth).', 'Bluetooth: the radio itself, protocol enumerators and every paired device with its profiles (audio, HID, serial over Bluetooth).'],
  Printer: ['Принтер или МФУ (физический или сетевой).', 'Printer or MFP (physical or network).'],
  PrintQueue: ['Очередь печати - то, что видят программы в диалоге «Печать». Бывает виртуальной: Microsoft Print to PDF, XPS, OneNote, факс.', 'Print queue - what apps see in the Print dialog. Can be virtual: Microsoft Print to PDF, XPS, OneNote, fax.'],
  WPD: ['Портативное устройство (Windows Portable Devices): телефон, плеер, фотоаппарат по MTP/PTP, иногда флешка, показанная как WPD.', 'Portable device (Windows Portable Devices): phone, player, camera over MTP/PTP, sometimes a flash drive shown as WPD.'],
  AndroidUsbDeviceClass: ['Android-устройство в режиме отладки (ADB-интерфейс).', 'Android device in debugging mode (ADB interface).'],
  Biometric: ['Биометрический датчик: сканер отпечатков или лица для Windows Hello.', 'Biometric sensor: fingerprint or face sensor for Windows Hello.'],
  SmartCardReader: ['Считыватель смарт-карт: банковские токены, электронная подпись, корпоративные пропуска.', 'Smart card reader: bank tokens, digital signatures, corporate badges.'],
  SmartCard: ['Смарт-карта или виртуальная смарт-карта (например, на базе TPM).', 'Smart card or virtual smart card (e.g. TPM-based).'],
  SecurityDevices: ['Модуль TPM - аппаратный сейф для ключей. На нём держатся BitLocker, Windows Hello и требования Windows 11.', 'TPM module - a hardware key vault. BitLocker, Windows Hello and the Windows 11 requirements rely on it.'],
  Sensor: ['Датчик: акселерометр, гироскоп, компас, освещённость, присутствие человека. Используется для автоповорота экрана и яркости.', 'Sensor: accelerometer, gyroscope, compass, ambient light, human presence. Used for auto-rotation and brightness.'],
  Infrared: ['Инфракрасный порт или приёмник (IrDA, ИК-пульт).', 'Infrared port or receiver (IrDA, IR remote).'],
  Display: ['Видеоадаптер: встроенная графика процессора или дискретная видеокарта. Без драйвера Windows переходит на «Базовый видеоадаптер Microsoft» (низкое разрешение, без ускорения).', 'Display adapter: integrated CPU graphics or a discrete card. Without the driver Windows falls back to the "Microsoft Basic Display Adapter" (low resolution, no acceleration).'],
  Monitor: ['Монитор или экран ноутбука. Windows читает его модель и режимы из EDID; часть мониторов управляется программно через DDC/CI (яркость, контраст, вход).', 'Monitor or laptop panel. Windows reads its model and modes from EDID; many monitors can be controlled via DDC/CI (brightness, contrast, input).'],
  DiskDrive: ['Физический диск: SSD, HDD, NVMe, флешка или карта памяти. Если на нём Windows - отключение уронит систему.', 'Physical disk: SSD, HDD, NVMe, flash drive or memory card. If Windows lives on it, disabling crashes the system.'],
  Volume: ['Том - раздел диска: C:, D:, а также скрытые служебные (EFI, восстановление). Отключение тома с Windows недопустимо.', 'Volume - a disk partition: C:, D: and hidden service ones (EFI, recovery). Never disable the Windows volume.'],
  VolumeSnapshot: ['Теневая копия тома: точки восстановления и резервные копии (VSS).', 'Volume shadow copy: restore points and backups (VSS).'],
  HDC: ['Контроллер дисков IDE/SATA (AHCI). К нему подключены SATA-диски и приводы.', 'IDE/SATA (AHCI) disk controller. SATA disks and drives hang off it.'],
  SCSIAdapter: ['Контроллер хранения: NVMe, RAID, Intel RST/VMD, Storage Spaces, виртуальные диски. Обычно на нём системный диск.', 'Storage controller: NVMe, RAID, Intel RST/VMD, Storage Spaces, virtual disks. Usually hosts the system disk.'],
  SDHost: ['Контроллер SD-карт. На некоторых ноутбуках и планшетах через него подключён системный eMMC-накопитель.', 'SD card host controller. On some laptops and tablets the system eMMC drive hangs off it.'],
  CDROM: ['Оптический привод или виртуальный привод для ISO-образов.', 'Optical drive or a virtual drive for ISO images.'],
  Processor: ['Логический процессор - одно ядро или поток CPU. Windows показывает по узлу на каждый поток; отключать их нельзя.', 'Logical processor - one CPU core or thread. Windows shows one node per thread; they cannot be disabled.'],
  System: ['Системное устройство чипсета или ACPI: шины PCI Express, таймеры, контроллер прерываний, управление питанием и температурой, служебные интерфейсы производителя. Основа работы ПК.', 'Chipset or ACPI system device: PCI Express buses, timers, interrupt controller, power and thermal management, vendor service interfaces. The foundation of the PC.'],
  Computer: ['Описание типа компьютера для ядра Windows (HAL). Отключить нельзя и незачем.', 'Computer type description for the Windows kernel (HAL). Cannot and should not be disabled.'],
  Firmware: ['Прошивка: UEFI системной платы или обновляемая прошивка отдельного компонента. Через этот узел Windows Update ставит обновления BIOS.', 'Firmware: mainboard UEFI or the updatable firmware of a component. Windows Update installs BIOS updates through this node.'],
  '1394': ['Контроллер FireWire (IEEE 1394): старые видеокамеры, аудиоинтерфейсы.', 'FireWire (IEEE 1394) controller: old camcorders, audio interfaces.'],
  Multifunction: ['Многофункциональное устройство: одна плата с несколькими функциями (например, модем + сеть).', 'Multifunction device: one card with several functions (e.g. modem + network).'],
  Battery: ['Батарея или адаптер питания (ACPI). Через них Windows знает заряд и источник питания.', 'Battery or AC adapter (ACPI). Windows learns charge level and power source through them.'],
  SoftwareDevice: ['Программное устройство: создано Windows или приложением без отдельного «железа» (например, для Miracast, Xbox Game Bar, принтеров в сети).', 'Software device: created by Windows or an app without dedicated hardware (e.g. Miracast, Xbox Game Bar, network printers).'],
  SoftwareComponent: ['Программный компонент драйвера: ставит фирменную утилиту или службу (панель звука, графики, Thunderbolt). Отключение убирает утилиту, само устройство работает.', 'Driver software component: installs a vendor app or service (audio/graphics panel, Thunderbolt). Disabling removes the app, the device itself keeps working.'],
  Extension: ['Расширение драйвера (INF extension): производитель ПК добавляет свои настройки к базовому драйверу.', 'Driver extension (INF extension): the PC maker adds its settings to the base driver.'],
  LegacyDriver: ['Устаревший драйвер без Plug and Play.', 'Legacy non-Plug-and-Play driver.'],
};
const CLASS_FALLBACK = ['Класс не описан в этом инструменте. Не отключайте, если не понимаете назначение устройства.', 'This class is not described by the tool. Do not disable it unless you understand what the device does.'];

// How the device can be driven from user code (programmable groups only).
const ACCESS = {
  Ports: ['Python: <code>serial.Serial("COMx", 9600)</code> (pySerial); C#: <code>System.IO.Ports.SerialPort</code>.', 'Python: <code>serial.Serial("COMx", 9600)</code> (pySerial); C#: <code>System.IO.Ports.SerialPort</code>.'],
  MultiPortSerial: ['Каждый порт - обычный COM: pySerial, <code>SerialPort</code>.', 'Each port is a normal COM: pySerial, <code>SerialPort</code>.'],
  Modem: ['AT-команды через COM-порт (pySerial).', 'AT commands over the COM port (pySerial).'],
  USB: ['Контроллеры и хабы напрямую не программируют. Питание портов хаба: <code>uhubctl</code>-подобные утилиты (если хаб поддерживает).', 'Controllers and hubs are not driven directly. Hub port power: <code>uhubctl</code>-style tools (if the hub supports it).'],
  USBDevice: ['libusb/pyusb при драйвере WinUSB (ставится через Zadig); C#: LibUsbDotNet.', 'libusb/pyusb with the WinUSB driver (install via Zadig); C#: LibUsbDotNet.'],
  Net: ['Сокеты (<code>socket</code>, <code>HttpClient</code>); настройка: <code>Get-NetAdapter</code>, <code>netsh</code>; Wi-Fi: <code>netsh wlan</code>, Windows.Devices.WiFi.', 'Sockets (<code>socket</code>, <code>HttpClient</code>); configuration: <code>Get-NetAdapter</code>, <code>netsh</code>; Wi-Fi: <code>netsh wlan</code>, Windows.Devices.WiFi.'],
  AudioEndpoint: ['Python: <code>pycaw</code>, <code>sounddevice</code>; C#: NAudio (WASAPI); громкость: <code>IAudioEndpointVolume</code>.', 'Python: <code>pycaw</code>, <code>sounddevice</code>; C#: NAudio (WASAPI); volume: <code>IAudioEndpointVolume</code>.'],
  MEDIA: ['Через его аудиоточки (WASAPI); MIDI: <code>python-rtmidi</code>, Windows.Devices.Midi.', 'Through its audio endpoints (WASAPI); MIDI: <code>python-rtmidi</code>, Windows.Devices.Midi.'],
  HIDClass: ['Python: <code>hid.device().open(VID, PID)</code> (hidapi); C#: HidSharp. Клавиатуры и мыши Windows открывать не даёт.', 'Python: <code>hid.device().open(VID, PID)</code> (hidapi); C#: HidSharp. Windows will not let you open keyboards and mice.'],
  Keyboard: ['Эмуляция: <code>SendInput</code>, <code>pynput</code>, <code>pyautogui</code>; чтение: Raw Input.', 'Emulation: <code>SendInput</code>, <code>pynput</code>, <code>pyautogui</code>; reading: Raw Input.'],
  Mouse: ['Эмуляция: <code>SendInput</code>, <code>pynput</code>, <code>pyautogui</code>; чтение: Raw Input.', 'Emulation: <code>SendInput</code>, <code>pynput</code>, <code>pyautogui</code>; reading: Raw Input.'],
  Camera: ['OpenCV: <code>cv2.VideoCapture(0)</code>; WinRT: Windows.Media.Capture.', 'OpenCV: <code>cv2.VideoCapture(0)</code>; WinRT: Windows.Media.Capture.'],
  Image: ['Камеры - OpenCV; сканеры - WIA (<code>WIA.CommonDialog</code>).', 'Cameras - OpenCV; scanners - WIA (<code>WIA.CommonDialog</code>).'],
  Bluetooth: ['BLE: Python <code>bleak</code>; WinRT: Windows.Devices.Bluetooth; классический SPP - как COM-порт.', 'BLE: Python <code>bleak</code>; WinRT: Windows.Devices.Bluetooth; classic SPP - as a COM port.'],
  Printer: ['PowerShell: <code>Get-Printer</code>, <code>Out-Printer</code>; Python: <code>win32print</code>.', 'PowerShell: <code>Get-Printer</code>, <code>Out-Printer</code>; Python: <code>win32print</code>.'],
  PrintQueue: ['PowerShell: <code>Get-PrintJob</code>, <code>Out-Printer</code>; Python: <code>win32print</code>.', 'PowerShell: <code>Get-PrintJob</code>, <code>Out-Printer</code>; Python: <code>win32print</code>.'],
  WPD: ['Windows Portable Devices API (MTP); для Android - ADB.', 'Windows Portable Devices API (MTP); for Android - ADB.'],
  AndroidUsbDeviceClass: ['<code>adb devices</code>, <code>adb shell</code>; Python: <code>pure-python-adb</code>.', '<code>adb devices</code>, <code>adb shell</code>; Python: <code>pure-python-adb</code>.'],
  Biometric: ['Windows Biometric Framework (<code>WinBio*</code>), Windows Hello API.', 'Windows Biometric Framework (<code>WinBio*</code>), Windows Hello API.'],
  SmartCardReader: ['PC/SC: Python <code>pyscard</code>, WinSCard API.', 'PC/SC: Python <code>pyscard</code>, WinSCard API.'],
  SmartCard: ['PC/SC: Python <code>pyscard</code>, WinSCard API.', 'PC/SC: Python <code>pyscard</code>, WinSCard API.'],
  Sensor: ['WinRT: Windows.Devices.Sensors (Accelerometer, LightSensor…).', 'WinRT: Windows.Devices.Sensors (Accelerometer, LightSensor…).'],
  Infrared: ['IrDA-сокеты или утилиты ИК-приёмника.', 'IrDA sockets or IR receiver utilities.'],
  Multifunction: ['Через функции-потомки этого устройства.', 'Through the child functions of this device.'],
  '1394': ['Через драйверы подключённых устройств.', 'Through the drivers of attached devices.'],
};

// ------------------------------------------------------------------ vendors

const PCI_VENDORS = {
  '8086': 'Intel', '10DE': 'NVIDIA', '1002': 'AMD (ATI)', '1022': 'AMD', '10EC': 'Realtek', '14E4': 'Broadcom', '168C': 'Qualcomm Atheros',
  '17CB': 'Qualcomm', '1B21': 'ASMedia', '1969': 'Qualcomm Atheros', '144D': 'Samsung', '15B7': 'Western Digital / SanDisk', '1C5C': 'SK hynix',
  '126F': 'Silicon Motion', '1987': 'Phison', '1179': 'Toshiba / Kioxia', '1E0F': 'Kioxia', '2646': 'Kingston', '1912': 'Renesas',
  '104C': 'Texas Instruments', '1217': 'O2 Micro', '1180': 'Ricoh', '14C3': 'MediaTek', '1814': 'Ralink / MediaTek', '1106': 'VIA', '1B4B': 'Marvell',
  '1D6A': 'Aquantia / Marvell', '15AD': 'VMware', '1414': 'Microsoft', '80EE': 'Oracle VirtualBox', '1AF4': 'Red Hat (VirtIO)', '1CC1': 'ADATA',
  '1E4B': 'Maxio', '1D97': 'Shenzhen Longsys', '1CC4': 'Union Memory', '2263': 'Kingston', '1344': 'Micron', '1C58': 'HGST / WD', '106B': 'Apple', '1095': 'Silicon Image',
  '197B': 'JMicron', '1283': 'ITE', '13F6': 'C-Media', '1102': 'Creative', '1D17': 'Zhaoxin',
};
const USB_VENDORS = {
  '046D': 'Logitech', '045E': 'Microsoft', '05AC': 'Apple', '0BDA': 'Realtek', '8087': 'Intel', '0A5C': 'Broadcom', '0CF3': 'Qualcomm Atheros',
  '13D3': 'AzureWave', '04F2': 'Chicony', '5986': 'Bison / Acer', '0C45': 'Sonix', '1BCF': 'Sunplus', '0403': 'FTDI', '1A86': 'QinHeng (CH340/CH341)',
  '10C4': 'Silicon Labs (CP210x)', '067B': 'Prolific', '2341': 'Arduino', '2A03': 'Arduino', '2E8A': 'Raspberry Pi', '0483': 'STMicroelectronics',
  '04D8': 'Microchip', '303A': 'Espressif', '1366': 'SEGGER', '1532': 'Razer', '1038': 'SteelSeries', '1B1C': 'Corsair', '0951': 'Kingston', '0781': 'SanDisk',
  '090C': 'Silicon Motion', '058F': 'Alcor Micro', '05E3': 'Genesys Logic', '2109': 'VIA Labs', '0B95': 'ASIX', '054C': 'Sony', '057E': 'Nintendo',
  '28DE': 'Valve', '1050': 'Yubico', '138A': 'Synaptics (Validity)', '06CB': 'Synaptics', '27C6': 'Goodix', '04F3': 'Elan', '0489': 'Foxconn',
  '0E8D': 'MediaTek', '2CB7': 'Fibocom', '1199': 'Sierra Wireless', '12D1': 'Huawei', '18D1': 'Google', '04E8': 'Samsung', '22B8': 'Motorola',
  '2717': 'Xiaomi', '03F0': 'HP', '04A9': 'Canon', '04B8': 'Epson', '04F9': 'Brother', '1A40': 'Terminus Technology', '0424': 'Microchip (SMSC)',
  '0D8C': 'C-Media', '1235': 'Focusrite', '046A': 'Cherry', '258A': 'Sinowealth', '320F': 'Telink', '3434': 'Keychron', '0B05': 'ASUS', '1462': 'MSI',
  '048D': 'ITE', '2516': 'Cooler Master', '1E7D': 'ROCCAT', '0738': 'Mad Catz', '24AE': 'Shenzhen Rapoo', '3151': 'YICHIP', '1D6B': 'Linux Foundation',
  '0BB4': 'HTC', '2833': 'Oculus', '0FD9': 'Elgato', '17EF': 'Lenovo', '413C': 'Dell', '0408': 'Quanta', '2232': 'Silicon Motion (cameras)', '1D5C': 'Fresco Logic',
  '0E0F': 'VMware', '80EE': 'VirtualBox', '0B0E': 'Jabra (GN)', '047F': 'Plantronics / Poly', '1395': 'Sennheiser / EPOS',
};
const MONITOR_VENDORS = {
  SAM: 'Samsung', DEL: 'Dell', GSM: 'LG', LGD: 'LG Display', AUO: 'AU Optronics', BOE: 'BOE', SHP: 'Sharp', CMN: 'Innolux (Chimei)', ACR: 'Acer',
  AUS: 'ASUS', HWP: 'HP', HPN: 'HP', LEN: 'Lenovo', PHL: 'Philips', BNQ: 'BenQ', VSC: 'ViewSonic', AOC: 'AOC', MSI: 'MSI', GBT: 'Gigabyte',
  IVM: 'iiyama', NEC: 'NEC', SNY: 'Sony', APP: 'Apple', HSD: 'HannStar', IVO: 'InfoVision', CSO: 'CSOT', SDC: 'Samsung Display', HKC: 'HKC',
  XMI: 'Xiaomi', MZI: 'Digital Projection', ENC: 'EIZO', EIZ: 'EIZO', NOE: 'NOE', TCL: 'TCL', HIS: 'Hisense', MEI: 'Panasonic', TSB: 'Toshiba', DWE: 'Daewoo',
};
const ACPI_VENDORS = { INT: 'Intel', AMDI: 'AMD', MSFT: 'Microsoft', ELAN: 'Elan', SYNA: 'Synaptics', ATK: 'ASUS', DELL: 'Dell', HPQ: 'HP', LEN: 'Lenovo', IDEA: 'Lenovo', NVDA: 'NVIDIA', QCOM: 'Qualcomm', FTE: 'FocalTech', GXTP: 'Goodix', WCOM: 'Wacom', ACPI: 'ACPI', PNP: 'стандарт PnP' };

function idsOf(d) { return [d.id, ...(d.hwids || []), ...(d.compat || [])].join('|').toUpperCase(); }

function vendorOf(d) {
  const H = idsOf(d);
  let m;
  if ((m = H.match(/(?:^|[\\&|])VEN_([0-9A-F]{4})/)) && PCI_VENDORS[m[1]]) return { name: PCI_VENDORS[m[1]], by: 'PCI VEN_' + m[1] };
  if ((m = H.match(/VID_([0-9A-F]{4})/)) && USB_VENDORS[m[1]]) return { name: USB_VENDORS[m[1]], by: 'VID_' + m[1] };
  if ((m = H.match(/VID&0002([0-9A-F]{4})/)) && USB_VENDORS[m[1]]) return { name: USB_VENDORS[m[1]], by: 'BT VID ' + m[1] };
  if ((m = H.match(/^DISPLAY\\([A-Z]{3})/)) && MONITOR_VENDORS[m[1]]) return { name: MONITOR_VENDORS[m[1]], by: 'EDID ' + m[1] };
  if ((m = H.match(/^ACPI\\([A-Z]{3,4})[0-9A-F]{4}/))) {
    const k = Object.keys(ACPI_VENDORS).find(p => m[1].startsWith(p));
    if (k && k !== 'PNP' && k !== 'ACPI') return { name: ACPI_VENDORS[k], by: 'ACPI ' + m[1] };
  }
  return null;
}

// ------------------------------------------------------------------ recognition rules
// Each rule: test (regex on all IDs, or a function), ru [function, text], en [function, text], guess.
// "guess" marks conclusions drawn from indirect signs; they are shown as assumptions.

const R = (test, ru, en, guess = false) => ({ test, ru, en, guess });

const RULES = [
  // ---- ACPI / mainboard
  R(/ACPI\\PNP0103/, ['Таймер HPET', 'Таймер событий высокой точности. Даёт Windows точное время для планировщика и мультимедиа.'], ['HPET timer', 'High Precision Event Timer. Gives Windows precise timing for the scheduler and multimedia.']),
  R(/ACPI\\PNP0100/, ['Системный таймер', 'Классический таймер платы (PIT 8254), запасной источник отсчёта времени.'], ['System timer', 'Classic board timer (PIT 8254), a fallback time source.']),
  R(/ACPI\\PNP000[03]/, ['Контроллер прерываний', 'Распределяет аппаратные прерывания между ядрами процессора (PIC/APIC). Без него ПК не работает.'], ['Interrupt controller', 'Routes hardware interrupts to CPU cores (PIC/APIC). The PC does not work without it.']),
  R(/ACPI\\PNP0B0[012]/, ['Часы реального времени', 'Часы CMOS на плате: хранят время, пока ПК выключен (питаются от батарейки CR2032).'], ['Real-time clock', 'CMOS clock on the board: keeps time while the PC is off (powered by a CR2032 cell).']),
  R(/ACPI\\PNP0200/, ['Контроллер DMA', 'Контроллер прямого доступа к памяти для устаревших устройств.'], ['DMA controller', 'Direct memory access controller for legacy devices.']),
  R(/ACPI\\PNP0C0C/, ['Кнопка питания', 'Кнопка питания корпуса. Её действие настраивается в «Электропитании».'], ['Power button', 'The case power button. Its action is set in Power Options.']),
  R(/ACPI\\PNP0C0D/, ['Датчик крышки', 'Определяет, закрыта ли крышка ноутбука (сон/выключение экрана).'], ['Lid switch', 'Detects whether the laptop lid is closed (sleep/screen off).']),
  R(/ACPI\\PNP0C0E/, ['Кнопка сна', 'Аппаратная кнопка или клавиша перехода в сон.'], ['Sleep button', 'Hardware sleep button or key.']),
  R(/ACPI\\PNP0C0A/, ['Батарея', 'Батарея ноутбука, управляемая через ACPI.'], ['Battery', 'Laptop battery managed via ACPI.']),
  R(/ACPI\\ACPI0003/, ['Адаптер питания', 'Определяет, подключено ли зарядное устройство.'], ['AC adapter', 'Detects whether the charger is plugged in.']),
  R(/ACPI\\PNP0C0B/, ['Вентилятор', 'Вентилятор, управляемый прошивкой через ACPI.'], ['Fan', 'Fan controlled by firmware via ACPI.']),
  R(/THERMALZONE|ACPI\\THERMAL/, ['Термозона', 'Зона контроля температуры: по ней прошивка и Windows снижают частоты при перегреве.'], ['Thermal zone', 'Temperature zone: firmware and Windows throttle on overheating based on it.']),
  R(/ACPI\\PNP0C0[12]/, ['Ресурсы системной платы', 'Резервирует адреса и порты, занятые платой, чтобы их не занял другой драйвер.'], ['Mainboard resources', 'Reserves addresses and ports used by the board so no other driver takes them.']),
  R(/ACPI\\PNP0A0[38]/, ['Корневая шина PCI Express', 'Корень шины PCI/PCIe: от неё растут видеокарта, NVMe, USB, сеть - практически всё.'], ['PCI Express root bus', 'Root of the PCI/PCIe bus: the GPU, NVMe, USB and network all grow from it.']),
  R(/ACPI\\PNP0C0F/, ['Связь прерываний PCI', 'Служебное ACPI-описание маршрутизации прерываний PCI.'], ['PCI interrupt link', 'ACPI description of PCI interrupt routing.']),
  R(/ACPI\\PNP0C14/, ['Интерфейс WMI-ACPI', 'Канал, через который фирменные утилиты (ASUS, Lenovo, HP, Dell) управляют подсветкой, вентиляторами, режимами питания.'], ['WMI-ACPI interface', 'The channel vendor utilities (ASUS, Lenovo, HP, Dell) use to drive lighting, fans and power modes.']),
  R(/ACPI\\PNP0C09/, ['Встроенный контроллер (EC)', 'Микроконтроллер ноутбука: батарея, вентиляторы, горячие клавиши, крышка. Отключение ломает питание и клавиши.'], ['Embedded controller (EC)', 'Laptop microcontroller: battery, fans, hotkeys, lid. Disabling breaks power and keys.']),
  R(/ACPI\\PNP0800/, ['Системный динамик', 'Пищалка платы (сигналы POST и ошибок).'], ['System speaker', 'Board beeper (POST and error beeps).']),
  R(/ACPI\\PNP0C04/, ['Сопроцессор', 'Описание математического сопроцессора (исторически отдельная микросхема, сейчас часть CPU).'], ['Numeric processor', 'Math coprocessor descriptor (historically a separate chip, now part of the CPU).']),
  R(/ACPI\\PNP0C33/, ['Устройство ошибок WHEA', 'Сообщает Windows об аппаратных ошибках (память, PCIe).'], ['WHEA error device', 'Reports hardware errors (memory, PCIe) to Windows.']),
  R(/ACPI\\ACPI000E/, ['Часы и будильник ACPI', 'Позволяет будить ПК по расписанию.'], ['ACPI time and alarm', 'Lets the PC wake on a schedule.']),
  R(/ACPI\\ACPI0010|ACPI\\ACPI000C/, ['Контейнер процессоров', 'ACPI-узел, объединяющий процессоры для управления питанием.'], ['Processor container', 'ACPI node grouping processors for power management.']),
  R(/ACPI\\(GENUINEINTEL|AUTHENTICAMD|ACPI0007)/, ['Логический процессор', 'Один поток выполнения CPU.'], ['Logical processor', 'One CPU execution thread.']),
  R(/ACPI\\MSFT0101|ACPI\\PNP0C31|ACPI\\NTC0702|ACPI\\IFX0102/, ['Модуль TPM', 'Хранит ключи BitLocker и Windows Hello, нужен для Windows 11.'], ['TPM module', 'Stores BitLocker and Windows Hello keys, required by Windows 11.']),
  R(/ACPI\\(PNP0303|PNP030B|PNP0320)/, ['Клавиатура PS/2 (встроенная)', 'Встроенная клавиатура ноутбука или PS/2-клавиатура. Отключение = нет клавиатуры.'], ['PS/2 keyboard (built-in)', 'Built-in laptop keyboard or PS/2 keyboard. Disabling = no keyboard.']),
  R(/ACPI\\(PNP0F03|PNP0F13|PNP0F0E)/, ['Тачпад или мышь PS/2', 'Тачпад ноутбука или мышь, подключённые по PS/2.'], ['PS/2 touchpad or mouse', 'Laptop touchpad or mouse connected over PS/2.']),
  R(/ACPI\\PNP0C50/, ['HID по шине I2C', 'Устройство ввода на шине I2C - почти всегда тачпад или сенсорный экран ноутбука.'], ['HID over I2C', 'Input device on the I2C bus - nearly always the laptop touchpad or touch screen.'], true),
  R(/ACPI\\PNP050[01]/, ['Встроенный COM-порт', 'Аппаратный COM-порт на плате (разъём DB-9 или колодка).'], ['Built-in COM port', 'Hardware COM port on the board (DB-9 or header).']),
  R(/ACPI\\PNP040[01]/, ['Встроенный LPT-порт', 'Параллельный порт принтера на плате.'], ['Built-in LPT port', 'Parallel printer port on the board.']),
  R(/ACPI\\PNP0700/, ['Контроллер дисковода', 'Контроллер флоппи-дисковода.'], ['Floppy controller', 'Floppy drive controller.']),
  R(/ACPI\\INT3400|ACPI\\INT3403|ACPI\\INTC10[0-9A-F]{2}|ACPI\\INT340[0-9]/, ['Intel DPTF (температура и питание)', 'Платформа Intel Dynamic Tuning: держит температуру и мощность ноутбука в рамках. Отключение может вызвать перегрев или троттлинг.'], ['Intel DPTF (thermal and power)', 'Intel Dynamic Tuning: keeps laptop temperature and power in limits. Disabling can cause overheating or throttling.'], true),
  R(/ACPI\\(INT33A1|INT34(5[0-9]|BB|C[0-9A-F])|INTC10)/, ['Intel Serial IO / GPIO', 'Шина I2C/SPI/GPIO чипсета Intel: на ней тачпад, сенсорный экран, датчики.'], ['Intel Serial IO / GPIO', 'Intel chipset I2C/SPI/GPIO bus: touchpad, touch screen and sensors sit on it.'], true),
  R(/ACPI\\AMDI00(10|30|52)/, ['AMD I2C / GPIO', 'Шина I2C/GPIO чипсета AMD: тачпад, датчики.'], ['AMD I2C / GPIO', 'AMD chipset I2C/GPIO bus: touchpad, sensors.'], true),
  R(/ACPI\\(ATK|ASUS)/, ['Сервис ASUS ATK', 'Интерфейс горячих клавиш и функций ASUS (яркость, подсветка, режимы).'], ['ASUS ATK service', 'ASUS hotkey and feature interface (brightness, lighting, modes).'], true),
  R(/ACPI\\(LEN|IDEA)/, ['Сервис Lenovo', 'Интерфейс функций Lenovo (горячие клавиши, режимы питания, камера-шторка).'], ['Lenovo service', 'Lenovo feature interface (hotkeys, power modes, camera shutter).'], true),
  R(/ACPI\\HPQ/, ['Сервис HP', 'Интерфейс функций HP (горячие клавиши, беспроводная связь).'], ['HP service', 'HP feature interface (hotkeys, wireless).'], true),
  R(/ACPI\\DELL/, ['Сервис Dell', 'Интерфейс функций Dell.'], ['Dell service', 'Dell feature interface.'], true),
  R(/^UEFI\\|FIRMWARE\\/, ['Прошивка UEFI', 'Узел прошивки: через него ставятся обновления BIOS/UEFI или прошивки компонента.'], ['UEFI firmware', 'Firmware node: BIOS/UEFI or component firmware updates are installed through it.']),

  // ---- PCI class codes
  R(/PCI\\CC_0600/, ['Хост-мост', 'Связывает процессор и память с шиной PCI. Сердце чипсета.'], ['Host bridge', 'Links the CPU and memory to the PCI bus. The heart of the chipset.']),
  R(/PCI\\CC_0601/, ['LPC/eSPI-контроллер', 'Южный мост: к нему подключены чип BIOS, TPM, контроллер ввода-вывода, EC.'], ['LPC/eSPI controller', 'South bridge: BIOS chip, TPM, super I/O and EC hang off it.']),
  R(/PCI\\CC_0604/, ['Корневой порт PCI Express', 'Порт PCIe: за ним стоит одно устройство (видеокарта, NVMe, Wi-Fi, USB-контроллер). Отключение отрежет всё, что за ним.'], ['PCI Express root port', 'PCIe port: one device sits behind it (GPU, NVMe, Wi-Fi, USB controller). Disabling cuts off everything behind it.']),
  R(/PCI\\CC_0C05/, ['Контроллер SMBus', 'Служебная шина: датчики платы, параметры модулей памяти (SPD).'], ['SMBus controller', 'Service bus: board sensors, memory module parameters (SPD).']),
  R(d => /PCI\\CC_078/.test(idsOf(d)) && /VEN_8086/.test(idsOf(d)), ['Intel Management Engine', 'Связь Windows с микроконтроллером Intel ME: управление питанием, защита прошивки, AMT. Отключение может мешать обновлениям прошивки и сну.'], ['Intel Management Engine', 'Link between Windows and the Intel ME microcontroller: power management, firmware protection, AMT. Disabling can break firmware updates and sleep.']),
  R(/PCI\\CC_078/, ['Коммуникационный контроллер', 'Служебный канал связи с микроконтроллером платы (например, AMD PSP).'], ['Communication controller', 'Service channel to a board microcontroller (e.g. AMD PSP).'], true),
  R(/PCI\\CC_0700/, ['Последовательный контроллер PCI', 'COM-порт на шине PCI (часто виртуальный порт Intel AMT SOL).'], ['PCI serial controller', 'COM port on the PCI bus (often Intel AMT SOL virtual port).'], true),
  R(/PCI\\CC_0C0340/, ['Контроллер USB4 / Thunderbolt', 'Хост-контроллер USB4: порты Type-C с Thunderbolt, док-станции.'], ['USB4 / Thunderbolt controller', 'USB4 host controller: Type-C ports with Thunderbolt, docks.']),
  R(/PCI\\CC_0C0330/, ['USB 3.x контроллер (xHCI)', 'Хост-контроллер USB 3.x: обслуживает группу USB-портов, включая порты USB 2.0. Отключение гасит ВСЕ эти порты.'], ['USB 3.x controller (xHCI)', 'USB 3.x host controller: serves a group of USB ports including USB 2.0 ones. Disabling kills ALL of them.']),
  R(/PCI\\CC_0C0320/, ['USB 2.0 контроллер (EHCI)', 'Хост-контроллер USB 2.0 на старых платах.'], ['USB 2.0 controller (EHCI)', 'USB 2.0 host controller on older boards.']),
  R(/PCI\\CC_0C03[01]0/, ['USB 1.1 контроллер', 'Хост-контроллер USB 1.1 (OHCI/UHCI) на старых платах.'], ['USB 1.1 controller', 'USB 1.1 host controller (OHCI/UHCI) on older boards.']),
  R(/PCI\\CC_0C0A/, ['Контроллер Thunderbolt', 'Хост-интерфейс Thunderbolt.'], ['Thunderbolt controller', 'Thunderbolt host interface.']),
  R(/PCI\\CC_0C80|PCI\\CC_0C09/, ['Контроллер последовательной шины', 'I2C/SPI/UART-контроллер чипсета: к нему часто подключены тачпад, сенсорный экран, датчики.'], ['Serial bus controller', 'Chipset I2C/SPI/UART controller: touchpad, touch screen and sensors often hang off it.'], true),
  R(/PCI\\CC_0108/, ['Контроллер NVMe', 'Контроллер NVMe-накопителя. Почти наверняка на нём системный диск.'], ['NVMe controller', 'NVMe drive controller. Very likely hosts the system disk.']),
  R(/PCI\\CC_0106/, ['SATA-контроллер (AHCI)', 'Контроллер SATA: к нему подключены SATA-диски и приводы.'], ['SATA controller (AHCI)', 'SATA controller: SATA disks and drives hang off it.']),
  R(/PCI\\CC_0104/, ['RAID-контроллер', 'RAID или Intel RST/VMD: через него может работать системный диск.'], ['RAID controller', 'RAID or Intel RST/VMD: the system disk may go through it.']),
  R(/PCI\\CC_0101/, ['IDE-контроллер', 'Контроллер IDE (или SATA в режиме совместимости).'], ['IDE controller', 'IDE controller (or SATA in compatibility mode).']),
  R(/PCI\\CC_0403/, ['Контроллер HD Audio', 'Шина High Definition Audio: к ней подключены звуковой кодек (Realtek и т.п.) и звук по HDMI/DisplayPort.'], ['HD Audio controller', 'High Definition Audio bus: the sound codec (Realtek etc.) and HDMI/DisplayPort audio hang off it.']),
  R(/PCI\\CC_0401/, ['Звуковой контроллер PCI', 'Звуковая карта на шине PCI.'], ['PCI audio controller', 'Sound card on the PCI bus.']),
  R(/PCI\\CC_0302/, ['Дискретная видеокарта (3D)', 'Дополнительный графический процессор ноутбука (Optimus/Switchable): включается для игр и 3D.'], ['Discrete GPU (3D)', 'Secondary laptop GPU (Optimus/Switchable): wakes up for games and 3D.']),
  R(/PCI\\CC_0300/, ['Видеоадаптер', 'Графический адаптер, выводящий изображение.'], ['Display adapter', 'Graphics adapter driving the display.']),
  R(/PCI\\CC_0200/, ['Ethernet-адаптер', 'Проводная сетевая карта (разъём RJ-45).'], ['Ethernet adapter', 'Wired network card (RJ-45 jack).']),
  R(/PCI\\CC_0280/, ['Wi-Fi-адаптер', 'Беспроводной сетевой адаптер (Wi-Fi), обычно на одной карте с Bluetooth.'], ['Wi-Fi adapter', 'Wireless network adapter (Wi-Fi), usually on one card with Bluetooth.'], true),
  R(/PCI\\CC_0805/, ['Кардридер SD', 'Контроллер SD-карт; на некоторых устройствах - системный eMMC.'], ['SD card reader', 'SD card controller; on some devices - the system eMMC.']),
  R(/PCI\\CC_1180/, ['Контроллер обработки сигналов', 'Обычно тепловая подсистема процессора Intel (DPTF/Dynamic Tuning).'], ['Signal processing controller', 'Usually the Intel CPU thermal subsystem (DPTF/Dynamic Tuning).'], true),
  R(/PCI\\CC_0880/, ['Системный периферийный контроллер', 'Служебный блок чипсета: GNA (ИИ-ускоритель Intel), тепловой контроллер, таймеры или Thunderbolt.'], ['System peripheral', 'Chipset service block: GNA (Intel AI accelerator), thermal controller, timers or Thunderbolt.'], true),
  R(/PCI\\CC_1200/, ['Ускоритель ИИ (NPU)', 'Нейропроцессор для локальных ИИ-функций Windows (Studio Effects, Copilot+).'], ['AI accelerator (NPU)', 'Neural processing unit for local Windows AI features (Studio Effects, Copilot+).'], true),
  R(/PCI\\CC_05/, ['Контроллер памяти', 'Служебная функция контроллера памяти/чипсета.'], ['Memory controller', 'Memory controller/chipset service function.'], true),
  R(/PCI\\CC_0B40/, ['Сопроцессор', 'Вспомогательный процессор (например, AMD Platform Security Processor).'], ['Co-processor', 'Helper processor (e.g. AMD Platform Security Processor).'], true),
  R(/PCI\\CC_0C00/, ['Контроллер FireWire', 'IEEE 1394 (FireWire).'], ['FireWire controller', 'IEEE 1394 (FireWire).']),
  R(/PCI\\CC_0D11/, ['Bluetooth-контроллер PCI', 'Bluetooth на шине PCI.'], ['PCI Bluetooth controller', 'Bluetooth on the PCI bus.']),

  // ---- Windows software buses and devices
  R(/ROOT\\BASICDISPLAY/, ['Базовый видеоадаптер Microsoft', 'Запасной видеодрайвер Windows: работает, пока не загружен драйвер видеокарты.'], ['Microsoft Basic Display Adapter', 'Windows fallback video driver: active until the GPU driver loads.']),
  R(/ROOT\\BASICRENDER/, ['Базовый драйвер отрисовки', 'Программный рендер DirectX на процессоре, когда нет GPU.'], ['Microsoft Basic Render Driver', 'Software DirectX renderer on the CPU when there is no GPU.']),
  R(/ROOT\\COMPOSITEBUS/, ['Перечислитель составной шины', 'Создаёт программные устройства Windows (Miracast, беспроводные дисплеи и др.).'], ['Composite Bus Enumerator', 'Creates Windows software devices (Miracast, wireless displays, etc.).']),
  R(/ROOT\\UMBUS/, ['Шина UMBus', 'Шина для драйверов пользовательского режима (UMDF): датчики, принтеры WSD и т.п.'], ['UMBus', 'Bus for user-mode (UMDF) drivers: sensors, WSD printers, etc.']),
  R(/ROOT\\VDRVROOT/, ['Перечислитель виртуальных дисков', 'Позволяет подключать VHD/VHDX и ISO как диски.'], ['Virtual drive enumerator', 'Lets you mount VHD/VHDX and ISO files as drives.']),
  R(/ROOT\\VOLMGR/, ['Диспетчер томов', 'Ядро работы с разделами дисков. Без него Windows не видит тома - критично.'], ['Volume Manager', 'Core of disk partition handling. Without it Windows sees no volumes - critical.']),
  R(/ROOT\\NDISVIRTUALBUS/, ['Шина виртуальных сетевых адаптеров', 'Создаёт виртуальные сетевые адаптеры NDIS.'], ['NDIS virtual network bus', 'Creates NDIS virtual network adapters.']),
  R(/ROOT\\RDPBUS/, ['Шина удалённого рабочего стола', 'Перенаправляет принтеры, диски и звук в RDP-сеансах.'], ['Remote Desktop device bus', 'Redirects printers, drives and audio in RDP sessions.']),
  R(/ROOT\\MSSMBIOS/, ['Драйвер SMBIOS', 'Передаёт Windows сведения о плате, BIOS и памяти.'], ['SMBIOS driver', 'Passes board, BIOS and memory information to Windows.']),
  R(/ROOT\\KDNIC|MS_KDNIC/, ['Адаптер отладки ядра', 'Сетевой адаптер для отладки Windows по сети. В обычной работе не нужен.'], ['Kernel debug adapter', 'Network adapter for debugging Windows over the network. Not needed in normal use.']),
  R(/ROOT\\SPACEPORT/, ['Дисковые пространства', 'Storage Spaces: объединение дисков в пулы.'], ['Storage Spaces', 'Storage Spaces: pooling disks.']),
  R(/ROOT\\(VMBUS|VID|VMS_|HYPER|VPCIVSP|STORVSP|NETVSC)|VMBUS\\/, ['Компонент Hyper-V', 'Часть виртуализации Windows: Hyper-V, WSL2, Песочница, Docker Desktop.'], ['Hyper-V component', 'Part of Windows virtualisation: Hyper-V, WSL2, Sandbox, Docker Desktop.'], true),
  R(/VMWARE|VMNET|VMCI|VMX86/, ['Компонент VMware', 'Виртуальное устройство VMware Workstation/Player.'], ['VMware component', 'VMware Workstation/Player virtual device.'], true),
  R(/VBOX/, ['Компонент VirtualBox', 'Виртуальное устройство VirtualBox.'], ['VirtualBox component', 'VirtualBox virtual device.'], true),
  R(/SWD\\MSRRAS|MS_NDISWAN|MS_(SSTP|PPTP|L2TP|AGILEVPN|PPPOE)MINIPORT|MS_NDISWANBH/, ['WAN Miniport (служебный)', 'Служебный адаптер Windows для VPN (SSTP, L2TP, IKEv2, PPTP), PPPoE и захвата трафика. Нужен, только если пользуетесь встроенным VPN/PPPoE.'], ['WAN Miniport (helper)', 'Windows helper adapter for VPN (SSTP, L2TP, IKEv2, PPTP), PPPoE and traffic capture. Needed only if you use built-in VPN/PPPoE.']),
  R(/SWD\\IP_TUNNEL_VBUS|ISATAP|TEREDO|6TO4|IPHTTPS/, ['IPv6-туннель', 'Адаптер туннелирования IPv6 (Teredo, 6to4, IP-HTTPS). Обычно не используется.'], ['IPv6 tunnel', 'IPv6 tunnelling adapter (Teredo, 6to4, IP-HTTPS). Usually unused.']),
  R(/VWIFIMP|VWIFIMP_WFD|MS_VWIFI/, ['Виртуальный адаптер Wi-Fi Direct', 'Нужен для мобильного хот-спота, Miracast и Wi-Fi Direct.'], ['Wi-Fi Direct virtual adapter', 'Used for Mobile Hotspot, Miracast and Wi-Fi Direct.']),
  R(/TAP0901|TAP-WINDOWS|TAPOAS/, ['VPN-адаптер TAP (OpenVPN)', 'Виртуальный адаптер OpenVPN и совместимых VPN.'], ['TAP VPN adapter (OpenVPN)', 'Virtual adapter of OpenVPN and compatible VPNs.']),
  R(/WINTUN|WIREGUARD/, ['VPN-адаптер Wintun/WireGuard', 'Виртуальный адаптер WireGuard, Tailscale, новых версий OpenVPN.'], ['Wintun/WireGuard VPN adapter', 'Virtual adapter of WireGuard, Tailscale, newer OpenVPN.']),
  R(/ZEROTIER/, ['VPN-адаптер ZeroTier', 'Виртуальная сеть ZeroTier.'], ['ZeroTier VPN adapter', 'ZeroTier virtual network.']),
  R(/BTH\\MS_BTHPAN/, ['Сеть через Bluetooth (PAN)', 'Подключение к сети через телефон по Bluetooth.'], ['Bluetooth network (PAN)', 'Network connection through a phone over Bluetooth.']),
  R(/SWD\\RADIO|RADIOMANAGEMENT/, ['Управление радиомодулями', 'Связывает переключатели «Режим в самолёте», Wi-Fi и Bluetooth с драйверами.'], ['Radio management', 'Ties Airplane mode, Wi-Fi and Bluetooth switches to the drivers.']),
  R(/SWD\\DAFUPNPPROVIDER|SWD\\DAFWSDPROVIDER|SWD\\DAFDNSSDPROVIDER/, ['Устройство из сети', 'Найдено в локальной сети (UPnP/WSD/mDNS): медиасервер, телевизор, принтер, роутер.'], ['Network-discovered device', 'Found on the local network (UPnP/WSD/mDNS): media server, TV, printer, router.'], true),
  R(/SWD\\PRINTENUM/, ['Очередь печати', 'Принтер в списке «Печать» у приложений.'], ['Print queue', 'A printer in the apps\' Print list.']),
  R(/SWD\\WPDBUSENUM|WPDBUSENUMROOT/, ['Носитель как портативное устройство', 'Флешка, карта памяти или телефон, видимые через Windows Portable Devices.'], ['Media as portable device', 'Flash drive, memory card or phone seen through Windows Portable Devices.'], true),
  R(/SWD\\SCDEVICEENUM/, ['Виртуальная смарт-карта', 'Смарт-карта, созданная Windows (например, на базе TPM для Windows Hello).'], ['Virtual smart card', 'Smart card created by Windows (e.g. TPM-based for Windows Hello).']),
  R(/^SWC\\/, ['Программный компонент драйвера', 'Устанавливает фирменное приложение или службу к драйверу.'], ['Driver software component', 'Installs a vendor app or service for the driver.']),

  // ---- storage
  R(/USBSTOR\\/, ['USB-накопитель', 'Флешка или внешний диск по USB. Перед отключением закройте файлы с него.'], ['USB drive', 'Flash drive or external disk over USB. Close its files before disabling.']),
  R(/STORAGE\\VOLUMESNAPSHOT/, ['Теневая копия', 'Снимок тома для точек восстановления и резервных копий.'], ['Shadow copy', 'Volume snapshot for restore points and backups.']),
  R(/STORAGE\\VOLUME/, ['Раздел диска', 'Том: C:, D: или скрытый служебный раздел (EFI, восстановление).'], ['Disk partition', 'Volume: C:, D: or a hidden service partition (EFI, recovery).']),
  R(/SCSI\\DISKNVME|NVME\\|SCSI\\DISK.*NVME/, ['NVMe-диск', 'Быстрый SSD-накопитель NVMe (M.2). Скорее всего системный.'], ['NVMe disk', 'Fast NVMe SSD (M.2). Most likely the system disk.'], true),
  R(/SCSI\\DISK|IDE\\DISK/, ['Диск SATA/SCSI', 'Жёсткий диск или SSD.'], ['SATA/SCSI disk', 'Hard disk or SSD.']),
  R(/CDROM/, ['Оптический или виртуальный привод', 'DVD/Blu-ray или виртуальный привод для ISO.'], ['Optical or virtual drive', 'DVD/Blu-ray or a virtual drive for ISO.']),
  R(/(^|\|)(SD|SDA|MMC)\\/, ['Карта памяти / eMMC', 'Носитель на шине SD/MMC.'], ['Memory card / eMMC', 'Storage on the SD/MMC bus.']),

  // ---- audio
  R(d => /HDAUDIO\\FUNC_01&VEN_(8086|10DE|1002)/.test(idsOf(d)), ['Звук по HDMI/DisplayPort', 'Аудиовыход видеокарты: звук на монитор или телевизор через HDMI/DP.'], ['HDMI/DisplayPort audio', 'Graphics card audio output: sound to a monitor or TV via HDMI/DP.']),
  R(/HDAUDIO\\FUNC_01/, ['Звуковой кодек', 'Сама «звуковая карта» платы (обычно Realtek): динамики, наушники, микрофон. Отключение выключит весь звук через этот кодек.'], ['Sound codec', 'The board\'s actual "sound card" (usually Realtek): speakers, headphones, mic. Disabling turns off all sound through this codec.']),
  R(/HDAUDIO\\FUNC_02/, ['Модем HD Audio', 'Модем на шине HD Audio.'], ['HD Audio modem', 'Modem on the HD Audio bus.']),
  R(/INTELAUDIO\\/, ['Аудиопроцессор Intel (SST)', 'Intel Smart Sound: обработка звука и встроенные микрофоны ноутбука.'], ['Intel audio DSP (SST)', 'Intel Smart Sound: audio processing and the laptop\'s built-in microphones.'], true),
  R(d => d.cls === 'AudioEndpoint' && /стерео ?микшер|stereo ?mix|what u hear/i.test(d.name), ['Стерео микшер (запись того, что звучит)', 'Виртуальный вход: записывает всё, что играет на выходе. Нужен для записи звука с компьютера; в остальном не используется.'], ['Stereo Mix (what you hear)', 'Virtual input that records whatever is playing. Needed to record PC audio; otherwise unused.']),
  R(d => d.cls === 'AudioEndpoint' && /микрофон|microphone|mic\b|массив|array/i.test(d.name), ['Микрофон', 'Вход звука: встроенный или внешний микрофон.'], ['Microphone', 'Sound input: built-in or external microphone.']),
  R(d => d.cls === 'AudioEndpoint' && /наушник|headphone|headset|гарнитур/i.test(d.name), ['Наушники / гарнитура', 'Выход звука на наушники.'], ['Headphones / headset', 'Sound output to headphones.']),
  R(d => d.cls === 'AudioEndpoint' && /динамик|speaker/i.test(d.name), ['Динамики', 'Выход звука на динамики. Если в имени «2-», Windows создала второй экземпляр звукового устройства - звук может идти через другой, одноимённый выход.'], ['Speakers', 'Sound output to speakers. A "2-" prefix means Windows created a second instance of the sound device - audio may be going through another output with the same name.']),
  R(d => d.cls === 'AudioEndpoint' && /hdmi|displayport|nvidia|amd high def|intel.*display|монитор|monitor|tv|телевиз/i.test(d.name), ['Звук на монитор/ТВ', 'Выход звука через HDMI/DisplayPort.'], ['Monitor/TV audio', 'Sound output via HDMI/DisplayPort.']),
  R(d => d.cls === 'AudioEndpoint' && /цифров|digital|spdif|s\/pdif|optical/i.test(d.name), ['Цифровой выход S/PDIF', 'Оптический или коаксиальный цифровой аудиовыход.'], ['S/PDIF digital output', 'Optical or coaxial digital audio output.']),
  R(/SWD\\MMDEVAPI\\\{0\.0\.1\./, ['Вход звука', 'Аудиоточка записи (микрофон или линейный вход).'], ['Audio input', 'Recording endpoint (microphone or line in).']),
  R(/SWD\\MMDEVAPI\\\{0\.0\.0\./, ['Выход звука', 'Аудиоточка воспроизведения.'], ['Audio output', 'Playback endpoint.']),

  // ---- Bluetooth profiles (UUIDs are language-independent)
  R(/BTHENUM\\\{0000110B/, ['Bluetooth-аудио (A2DP)', 'Стереозвук на беспроводные наушники или колонку.'], ['Bluetooth audio (A2DP)', 'Stereo sound to wireless headphones or a speaker.']),
  R(/BTHENUM\\\{0000111E|BTHENUM\\\{00001108|BTHHFENUM/, ['Bluetooth-гарнитура (Hands-Free)', 'Микрофон и звук для звонков через Bluetooth-гарнитуру.'], ['Bluetooth headset (Hands-Free)', 'Mic and call audio through a Bluetooth headset.']),
  R(/BTHENUM\\\{0000110[CE]/, ['Пульт Bluetooth (AVRCP)', 'Кнопки «пауза/следующий трек» на наушниках и колонках.'], ['Bluetooth remote (AVRCP)', 'Play/pause/next buttons on headphones and speakers.']),
  R(/BTHENUM\\\{00001124/, ['Bluetooth HID', 'Беспроводная клавиатура, мышь или геймпад (классический Bluetooth).'], ['Bluetooth HID', 'Wireless keyboard, mouse or gamepad (classic Bluetooth).']),
  R(/BTHENUM\\\{00001101/, ['COM-порт по Bluetooth (SPP)', 'Последовательный порт через Bluetooth: модули HC-05/HC-06, GPS, принтеры чеков.'], ['Serial over Bluetooth (SPP)', 'Serial port over Bluetooth: HC-05/HC-06 modules, GPS, receipt printers.']),
  R(/BTHENUM\\\{0000(1105|1106)/, ['Передача файлов Bluetooth (OBEX)', 'Отправка и приём файлов по Bluetooth.'], ['Bluetooth file transfer (OBEX)', 'Sending and receiving files over Bluetooth.']),
  R(/BTHENUM\\\{0000(112F|1132|1116|1115)/, ['Профиль телефона Bluetooth', 'Телефонная книга, сообщения или сеть с телефона.'], ['Bluetooth phone profile', 'Phonebook, messages or network from a phone.']),
  R(/BTHLEDEVICE\\\{00001812/, ['Bluetooth LE HID', 'Беспроводная клавиатура или мышь (Bluetooth Low Energy).'], ['Bluetooth LE HID', 'Wireless keyboard or mouse (Bluetooth Low Energy).']),
  R(/BTHLEDEVICE\\\{0000180F/, ['Уровень заряда (BLE)', 'Сервис, сообщающий Windows заряд беспроводного устройства.'], ['Battery level (BLE)', 'Service reporting the wireless device\'s battery to Windows.']),
  R(/BTHLEDEVICE\\\{0000180A/, ['Сведения об устройстве (BLE)', 'Модель и прошивка беспроводного устройства.'], ['Device information (BLE)', 'Model and firmware of the wireless device.']),
  R(/BTHLEDEVICE\\\{0000180[01]/, ['Служебный сервис BLE', 'Базовые сервисы Bluetooth LE (Generic Access/Attribute).'], ['BLE core service', 'Bluetooth LE base services (Generic Access/Attribute).']),
  R(/BTHLEDEVICE\\/, ['Сервис Bluetooth LE', 'Один из сервисов сопряжённого BLE-устройства (часы, датчик, трекер).'], ['Bluetooth LE service', 'One of the services of a paired BLE device (watch, sensor, tracker).'], true),
  R(/BTHLE\\/, ['Устройство Bluetooth LE', 'Сопряжённое устройство Bluetooth Low Energy.'], ['Bluetooth LE device', 'Paired Bluetooth Low Energy device.']),
  R(/BTH\\MS_BTHLE|BTH\\MS_BTHBRB/, ['Перечислитель Bluetooth', 'Служебный узел стека Bluetooth Windows.'], ['Bluetooth enumerator', 'Windows Bluetooth stack service node.']),
  R(/BTH\\MS_RFCOMM/, ['Протокол RFCOMM', 'Основа COM-портов и гарнитур по Bluetooth.'], ['RFCOMM protocol', 'Basis for Bluetooth COM ports and headsets.']),
  R(/BTHENUM\\DEV_|BTHENUM\\/, ['Сопряжённое Bluetooth-устройство', 'Устройство, когда-то сопряжённое с этим ПК.'], ['Paired Bluetooth device', 'A device paired with this PC at some point.']),
  R(d => d.cls === 'Bluetooth' && /^USB\\|^PCI\\/.test((d.id || '').toUpperCase()), ['Bluetooth-радиомодуль', 'Сам Bluetooth-адаптер. Отключение разорвёт все беспроводные подключения.'], ['Bluetooth radio', 'The Bluetooth adapter itself. Disabling drops all wireless links.']),

  // ---- HID usages
  R(/HID_DEVICE_UP:000D_U:0004|HID_DEVICE_UP:000D_U:0001/, ['Сенсорный экран', 'Сенсорная панель экрана (или перо).'], ['Touch screen', 'Screen digitiser (or pen).']),
  R(/HID_DEVICE_UP:000D_U:0005/, ['Тачпад (Precision)', 'Высокоточная сенсорная панель ноутбука. Отключение = нет тачпада.'], ['Precision touchpad', 'Laptop precision touchpad. Disabling = no touchpad.']),
  R(/HID_DEVICE_UP:000D_U:000E/, ['Настройки тачпада', 'Канал конфигурации сенсорной панели.'], ['Touchpad configuration', 'Touchpad configuration channel.']),
  R(/HID_DEVICE_SYSTEM_KEYBOARD|HID_DEVICE_UP:0001_U:0006/, ['HID-клавиатура', 'Интерфейс клавиатуры. Отключение = клавиатура перестанет печатать.'], ['HID keyboard', 'Keyboard interface. Disabling = the keyboard stops typing.']),
  R(/HID_DEVICE_SYSTEM_MOUSE|HID_DEVICE_UP:0001_U:0002/, ['HID-мышь', 'Интерфейс мыши или тачпада. Отключение = курсор замрёт.'], ['HID mouse', 'Mouse or touchpad interface. Disabling = the cursor freezes.']),
  R(/HID_DEVICE_UP:0001_U:000[45]|HID_DEVICE_SYSTEM_GAME/, ['Геймпад / джойстик', 'Игровой контроллер.'], ['Gamepad / joystick', 'Game controller.']),
  R(/HID_DEVICE_UP:000C_U:0001|HID_DEVICE_SYSTEM_CONSUMER/, ['Мультимедийные клавиши', 'Громкость, воспроизведение, яркость, калькулятор и т.п.'], ['Media keys', 'Volume, playback, brightness, calculator and so on.']),
  R(/HID_DEVICE_UP:0001_U:0080|HID_DEVICE_SYSTEM_CONTROL/, ['Системные клавиши', 'Клавиши питания, сна и «В самолёте».'], ['System keys', 'Power, sleep and airplane-mode keys.']),
  R(/HID_DEVICE_UP:0001_U:000C/, ['Беспроводной переключатель', 'Аппаратный переключатель радиомодулей.'], ['Wireless radio switch', 'Hardware radio switch.']),
  R(/HID_DEVICE_UP:0020/, ['HID-датчик', 'Датчик (освещённость, ориентация, присутствие), подключённый как HID.'], ['HID sensor', 'Sensor (light, orientation, presence) connected as HID.']),
  R(/HID_DEVICE_UP:000B/, ['Телефонные кнопки', 'Кнопки ответа/отключения микрофона на гарнитуре.'], ['Telephony buttons', 'Answer/mute buttons on a headset.']),
  R(/HID_DEVICE_UP:0059/, ['RGB-подсветка (LampArray)', 'Подсветка, которой Windows управляет через «Динамическое освещение».'], ['RGB lighting (LampArray)', 'Lighting controlled by Windows Dynamic Lighting.']),
  R(/HID_DEVICE_UP:008[45]/, ['ИБП / источник питания', 'Источник бесперебойного питания, подключённый по USB.'], ['UPS / power device', 'Uninterruptible power supply connected over USB.']),
  R(/HID_DEVICE_UP:FF|HID_DEVICE_UP:FFA0|HID_DEVICE_UP:FF00/, ['Служебный канал производителя', 'Нестандартный HID-интерфейс: через него фирменные утилиты меняют подсветку, DPI, макросы, обновляют прошивку. Самое удобное место для собственного кода.'], ['Vendor channel', 'Non-standard HID interface: vendor utilities change lighting, DPI, macros and update firmware through it. The handiest entry point for your own code.'], true),
  R(/HID\\CONVERTEDDEVICE/, ['Преобразованное HID-устройство', 'Клавиатура или мышь, переданная Windows из другого протокола.'], ['Converted HID device', 'Keyboard or mouse passed to Windows from another protocol.'], true),

  // ---- USB
  R(/USB\\ROOT_HUB/, ['Корневой USB-концентратор', 'Порты, которые даёт хост-контроллер. Отключение гасит все порты этого контроллера.'], ['USB root hub', 'The ports provided by the host controller. Disabling kills all ports of that controller.']),
  R(/USB\\CLASS_09/, ['USB-концентратор', 'Хаб: внешний разветвитель, хаб монитора/док-станции или внутренний хаб платы.'], ['USB hub', 'Hub: external splitter, monitor/dock hub or the board\'s internal hub.']),
  R(/USB\\COMPOSITE/, ['Составное USB-устройство', 'Родитель для нескольких функций одного устройства (например, клавиатура + мультимедиа-клавиши или камера + микрофон).'], ['Composite USB device', 'Parent of several functions of one device (e.g. keyboard + media keys, or camera + mic).']),
  R(/VID_1A86&PID_(7523|5523|55D4)/, ['Переходник USB-COM CH340', 'Чип CH340/CH341: USB-UART в клонах Arduino, ESP-платах, программаторах.'], ['CH340 USB-serial adapter', 'CH340/CH341 chip: USB-UART in Arduino clones, ESP boards, programmers.']),
  R(/VID_10C4&PID_EA6[0-9]/, ['Переходник USB-COM CP210x', 'Чип Silicon Labs CP210x: USB-UART в ESP32-платах и модулях.'], ['CP210x USB-serial adapter', 'Silicon Labs CP210x: USB-UART in ESP32 boards and modules.']),
  R(/VID_0403&PID_60(01|10|11|14|15)/, ['Переходник USB-COM FTDI', 'Чип FTDI: надёжный USB-UART в программаторах и промышленном оборудовании.'], ['FTDI USB-serial adapter', 'FTDI chip: dependable USB-UART in programmers and industrial gear.']),
  R(/VID_067B&PID_2303/, ['Переходник USB-COM PL2303', 'Чип Prolific PL2303 (часто подделки, требующие старого драйвера).'], ['PL2303 USB-serial adapter', 'Prolific PL2303 chip (often counterfeits that need an old driver).']),
  R(/VID_(2341|2A03)/, ['Плата Arduino', 'Оригинальная плата Arduino.'], ['Arduino board', 'Genuine Arduino board.']),
  R(/VID_2E8A/, ['Raspberry Pi Pico / RP2040', 'Микроконтроллер Raspberry Pi.'], ['Raspberry Pi Pico / RP2040', 'Raspberry Pi microcontroller.']),
  R(/VID_303A/, ['Плата ESP32 (Espressif)', 'ESP32-S2/S3/C3 со встроенным USB.'], ['ESP32 board (Espressif)', 'ESP32-S2/S3/C3 with native USB.']),
  R(/VID_0483&PID_(5740|DF11|3748|374B)/, ['STM32 / ST-Link', 'Микроконтроллер STM32 или программатор ST-Link.'], ['STM32 / ST-Link', 'STM32 microcontroller or ST-Link programmer.']),
  R(/VID_1366/, ['Программатор J-Link', 'Отладчик SEGGER J-Link.'], ['J-Link debugger', 'SEGGER J-Link debugger.']),
  R(/VID_046D&PID_C5(2B|32|34|39|3F|47|48|4D)/, ['Приёмник Logitech', 'USB-приёмник Unifying/Lightspeed/Bolt для беспроводных мыши и клавиатуры. Отключение = мышь и клавиатура Logitech пропадут.'], ['Logitech receiver', 'Unifying/Lightspeed/Bolt USB receiver for a wireless mouse and keyboard. Disabling = the Logitech mouse and keyboard vanish.']),
  R(/VID_1050/, ['Ключ YubiKey', 'Аппаратный ключ безопасности (FIDO2, OTP, смарт-карта).'], ['YubiKey', 'Hardware security key (FIDO2, OTP, smart card).']),
  R(/VID_8087&PID_0(0|A|2|3)[0-9A-F]{2}/, ['Intel Bluetooth (USB-часть)', 'Bluetooth-модуль Intel, подключённый к внутреннему USB.'], ['Intel Bluetooth (USB side)', 'Intel Bluetooth module on internal USB.'], true),
  R(/USB\\CLASS_E0&SUBCLASS_01&PROT_03|RNDIS/, ['USB-модем телефона (RNDIS)', 'Интернет через телефон по USB.'], ['Phone USB tethering (RNDIS)', 'Internet through a phone over USB.']),
  R(/USB\\CLASS_E0/, ['Беспроводной контроллер USB', 'Почти всегда Bluetooth-модуль (внутренний или донгл).'], ['USB wireless controller', 'Almost always a Bluetooth module (internal or dongle).'], true),
  R(/USB\\CLASS_0E/, ['USB-камера (UVC)', 'Видеоустройство стандарта UVC: веб-камера или карта захвата.'], ['USB camera (UVC)', 'UVC video device: webcam or capture card.']),
  R(/USB\\CLASS_01/, ['USB-аудио', 'Гарнитура, микрофон, ЦАП или аудиоинтерфейс.'], ['USB audio', 'Headset, microphone, DAC or audio interface.']),
  R(/USB\\CLASS_02|USB\\CLASS_0A/, ['USB CDC (модем/виртуальный COM)', 'USB-устройство связи: виртуальный COM-порт микроконтроллера, модем или сетевой интерфейс телефона.'], ['USB CDC (modem/virtual COM)', 'USB communication device: microcontroller virtual COM port, modem or phone network interface.'], true),
  R(/USB\\CLASS_08/, ['USB Mass Storage', 'Интерфейс накопителя: флешка, внешний диск, кардридер.'], ['USB Mass Storage', 'Storage interface: flash drive, external disk, card reader.']),
  R(/USB\\CLASS_07/, ['USB-принтер', 'Принтерный интерфейс USB.'], ['USB printer', 'USB printer interface.']),
  R(/USB\\CLASS_06/, ['Камера/телефон (PTP)', 'Фотоаппарат или телефон в режиме передачи фото.'], ['Camera/phone (PTP)', 'Camera or phone in photo transfer mode.']),
  R(/USB\\CLASS_0B/, ['USB-считыватель смарт-карт', 'CCID-считыватель или токен.'], ['USB smart card reader', 'CCID reader or token.']),
  R(/USB\\CLASS_03/, ['USB HID-интерфейс', 'USB-интерфейс устройства ввода (клавиатура, мышь, геймпад, служебный канал).'], ['USB HID interface', 'USB interface of an input device (keyboard, mouse, gamepad, vendor channel).']),
  R(/USB\\CLASS_FF/, ['Интерфейс производителя', 'Нестандартный USB-интерфейс; работает с фирменным драйвером или через WinUSB/libusb.'], ['Vendor interface', 'Non-standard USB interface; works with the vendor driver or through WinUSB/libusb.'], true),
  R(/USB\\CLASS_DC|USB\\CLASS_EF/, ['Служебный интерфейс USB', 'Диагностика или вспомогательная функция устройства.'], ['USB helper interface', 'Diagnostics or helper function of the device.'], true),

  // ---- monitors, printers, phones
  R(/^DISPLAY\\/, ['Монитор', 'Подключённый экран; модель и производитель берутся из EDID.'], ['Monitor', 'Attached screen; model and maker come from EDID.']),
  R(d => d.cls === 'PrintQueue' && /pdf/i.test(d.name), ['Печать в PDF', 'Виртуальный принтер: сохраняет документ как PDF-файл.'], ['Print to PDF', 'Virtual printer: saves the document as a PDF file.']),
  R(d => d.cls === 'PrintQueue' && /xps/i.test(d.name), ['Печать в XPS', 'Виртуальный принтер: сохраняет документ в формате XPS.'], ['Print to XPS', 'Virtual printer: saves the document as XPS.']),
  R(d => d.cls === 'PrintQueue' && /onenote/i.test(d.name), ['Отправить в OneNote', 'Виртуальный принтер OneNote.'], ['Send to OneNote', 'OneNote virtual printer.']),
  R(d => d.cls === 'PrintQueue' && /fax|факс/i.test(d.name), ['Факс', 'Виртуальный принтер факса Windows.'], ['Fax', 'Windows fax virtual printer.']),
  R(/MTP|WPD/, ['Устройство MTP', 'Телефон, плеер или камера в режиме передачи файлов.'], ['MTP device', 'Phone, player or camera in file transfer mode.'], true),
];

// Fallback by the start of the instance ID when no rule matched.
const PREFIX_GUESS = [
  [/^ROOT\\/, ['Программное устройство Windows', 'Создано Windows или драйвером без отдельного оборудования (корень ROOT).'], ['Windows software device', 'Created by Windows or a driver without dedicated hardware (ROOT enumerator).']],
  [/^SWD\\/, ['Программное устройство', 'Создано программным перечислителем Windows (SWD).'], ['Software device', 'Created by a Windows software enumerator (SWD).']],
  [/^USB\\/, ['USB-устройство', 'Устройство или функция на шине USB.'], ['USB device', 'Device or function on the USB bus.']],
  [/^HID\\/, ['HID-устройство', 'Интерфейс устройства ввода.'], ['HID device', 'Input device interface.']],
  [/^PCI\\/, ['Устройство PCI Express', 'Встроенный в плату или установленный в слот контроллер.'], ['PCI Express device', 'Controller built into the board or installed in a slot.']],
  [/^ACPI\\/, ['Устройство ACPI', 'Описано в таблицах прошивки платы (ACPI).'], ['ACPI device', 'Described in the board firmware tables (ACPI).']],
  [/^BTH/, ['Bluetooth-узел', 'Часть стека Bluetooth.'], ['Bluetooth node', 'Part of the Bluetooth stack.']],
  [/^HDAUDIO\\|^INTELAUDIO\\/, ['Аудиофункция', 'Функция на шине HD Audio.'], ['Audio function', 'Function on the HD Audio bus.']],
  [/^STORAGE\\|^SCSI\\|^NVME\\/, ['Устройство хранения', 'Узел подсистемы хранения данных.'], ['Storage device', 'Storage subsystem node.']],
];

// Returns { func, text, guess, vendor, access }.
function explain(d) {
  const L = S.lang === 'ru' ? 'ru' : 'en';
  const li = L === 'ru' ? 0 : 1;
  const H = idsOf(d);
  let func = '', text = '', guess = false;

  for (const r of RULES) {
    const hit = typeof r.test === 'function' ? r.test(d) : r.test.test(H);
    if (hit) { [func, text] = r[L]; guess = r.guess; break; }
  }
  if (!func) {
    const p = PREFIX_GUESS.find(([re]) => re.test((d.id || '').toUpperCase()));
    if (p && !CLASS_TEXT[d.cls]) { [func, text] = p[li + 1]; guess = true; }
  }

  const clsText = (CLASS_TEXT[d.cls] || (func ? null : CLASS_FALLBACK));
  if (!d.cls && !func) guess = true;
  const parts = [];
  if (text) parts.push(text);
  if (clsText) parts.push(clsText[li]);

  // Port number in the name is the most useful fact about a COM device.
  const com = (d.name || '').match(/\((COM\d+|LPT\d+)\)/i);
  if (com) parts.unshift((L === 'ru' ? 'Порт: ' : 'Port: ') + com[1].toUpperCase() + '.');

  if (d.net === 'Up') parts.push(L === 'ru' ? 'Сейчас подключён к сети.' : 'Currently connected.');
  else if (d.net === 'Disconnected') parts.push(L === 'ru' ? 'Кабель/сеть сейчас не подключены.' : 'Cable/network is not connected now.');

  if (!func) func = groupName(groupOf(d));

  const acc = ACCESS[d.cls];
  return {
    func,
    text: parts.join(' '),
    guess,
    vendor: vendorOf(d),
    access: d.prog && acc ? acc[li] : '',
  };
}

function groupName(key) { const g = GROUP_BY_KEY[key] || GROUP_BY_KEY.other; return S.lang === 'ru' ? g.ru : g.en; }
function groupDesc(key) { const g = GROUP_BY_KEY[key] || GROUP_BY_KEY.other; return S.lang === 'ru' ? g.dru : g.den; }
