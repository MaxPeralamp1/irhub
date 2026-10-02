# IR Hub

A Wi-Fi IR blaster/learner built on a Raspberry Pi Pico W (FreeRTOS + Pico SDK,
C++), bridged to a web UI through Mosquitto MQTT and a small Node/Express
backend.

```
[IR remote] --> VS1838B --> GP15 --> Pico W --Wi-Fi/MQTT--> Mosquitto --> Node backend --> Web UI
                                        |
                                       GP14 --> MOSFET gate --> IR LED --> [device]
```

## Hardware wiring

| Signal          | Pico W pin | Notes                                             |
|------------------|-----------|----------------------------------------------------|
| IR receiver OUT  | GP15      | VS1838B/TSOP38238; internal pull-up enabled in FW  |
| IR receiver VCC  | 3V3       |                                                      |
| IR receiver GND  | GND       |                                                      |
| MOSFET gate      | GP14      | via ~220Ω series resistor                          |
| MOSFET drain     | IR LED cathode (through current-limit resistor to VBUS/5V) | N-channel, e.g. 2N7000/AO3400 |
| MOSFET source    | GND       |                                                      |

The MOSFET gate is driven by PWM at 38kHz (configurable duty cycle) gated
on/off by the mark/space timing of the learned signal.

## Part 1 — Firmware (`firmware/`)

Dependencies:
- [Pico SDK](https://github.com/raspberrypi/pico-sdk) (`PICO_SDK_PATH`)
- [FreeRTOS-Kernel](https://github.com/FreeRTOS/FreeRTOS-Kernel) (`FREERTOS_KERNEL_PATH`)
- `arm-none-eabi-gcc` toolchain, CMake ≥ 3.13, Ninja (optional)

Build:

```bash
cd firmware
mkdir build && cd build
cmake .. -DPICO_BOARD=pico_w
make -j4
```

Flash `irhub_firmware.uf2` by holding BOOTSEL while plugging in the Pico W,
then copying the file to the mounted RPI-RP2 drive. The hub then waits to be
given its Wi-Fi network and MQTT broker over Bluetooth — see
[Provisioning over Bluetooth](#provisioning-over-bluetooth).

For development you can bake in defaults instead, used only while the hub
has nothing stored:

```bash
cmake .. -DPICO_BOARD=pico_w \
         -DWIFI_SSID="YourWiFi" \
         -DWIFI_PASSWORD="YourPassword" \
         -DMQTT_BROKER_IP="192.168.1.100" \
         -DMQTT_BROKER_PORT=1883
```

A build directory made before provisioning existed has these cached. Clear
them with `-DWIFI_SSID=""` (or a fresh build directory) if you want a build
without defaults.

Firmware architecture:
- **`NetworkTask`** (`src/mqtt_manager.cpp`, high priority) — brings up
  cyw43/Wi-Fi with the settings from `net_config` (flash, else the build
  defaults), connects to Mosquitto, subscribes to `irhub/send`, decodes
  incoming JSON into an `IrMessage` and pushes it to the transmit queue;
  drains the capture queue and publishes each entry to `irhub/learned`;
  auto-reconnects on drop (a broker drop reconnects MQTT only, not Wi-Fi).
  It also runs the BLE provisioning flow in `src/ble_provision.cpp`.
- **`IRCaptureTask`** (`src/ir_capture.cpp`, medium priority) — a GPIO edge
  interrupt on GP15 timestamps every mark/space transition with the
  microsecond hardware timer (protocol-agnostic raw capture, works with any
  remote). A repeating 2ms alarm watches for the idle gap that ends a capture,
  then posts the finished buffer's index to a queue; the task formats it as an
  `IrMessage` and queues it for MQTT publish. Details worth knowing:
  - **Two gap thresholds.** `IR_MESSAGE_GAP_US` (55ms) ends the capture;
    `IR_FRAME_GAP_US` (12ms) only marks a frame boundary. An air conditioner
    that sends its state as two halves 20–40ms apart therefore arrives as one
    pulse train, with the gap recorded as an ordinary space, while NEC
    auto-repeat frames (~110ms apart) stay separate captures.
    `IR_MESSAGE_GAP_US` must stay under 65535 so an inter-frame gap still fits
    a `uint16` pulse entry.
  - **A ring of `IR_CAPTURE_BUFFERS` (4) buffers**, handed over through a queue
    of indices. Frames completing back-to-back are queued rather than
    overwriting each other. If every buffer is still in flight the *next*
    transmission is refused and counted, rather than corrupting a queued one.
  - **Glitch filtering does not disturb the timebase.** An interval shorter
    than `IR_MIN_PULSE_US` is discarded *without* advancing the last-edge
    timestamp, so the interval after it is still measured from the last valid
    edge instead of being shortened by the spike.
  - **Truncation is reported, not silent.** Hitting `IR_MAX_PULSES` (800) sets
    `truncated` on the message; the backend then refuses to transmit that
    signal and the UI tells you to re-learn the button.
  - The carrier frequency is **not** measured. The VS1838B demodulates it away
    before GP15, so `carrier_freq` is always reported as `IR_CARRIER_HZ`.
- **`IRTransmitTask`** (`src/ir_transmit.cpp`, high priority) — blocks on a
  queue fed by the MQTT subscribe callback, configures the PWM slice on GP14
  for the requested carrier frequency, and gates it on/off for each
  mark/space duration using the hardware microsecond timer for tight timing.

Wire payload schema:

```json
{"carrier_freq": 38000, "frame_count": 1, "truncated": false,
 "pulses": [9000, 4500, 560, 560, 560, 1690, ...]}
```

`pulses[0]` is always a mark (LED on), alternating with spaces (LED off).

`frame_count` and `truncated` are outbound metadata on `irhub/learned`:
`frame_count` is the number of frames in the train (1 for an ordinary
command, 2 for a typical A/C, more if a key was held during learning), and
`truncated` means the capture hit `IR_MAX_PULSES` and cannot reproduce the
original command. The inbound direction (`irhub/send`) needs only
`carrier_freq` and `pulses`; the decoder ignores unknown keys, so old
payloads without the metadata still work. The firmware refuses an inbound
payload carrying more than `IR_MAX_PULSES` pulses rather than transmitting a
partial frame.

### Provisioning over Bluetooth

The hub advertises over BLE as **`IRHub-XXXX`** (last four hex digits of its
Bluetooth address) when:

- it has no stored settings and no build defaults, or
- its settings keep failing: 3 Wi-Fi joins in a row, or 5 broker connections
  in a row (a wrong broker IP can only be fixed this way). It keeps retrying
  the old settings while advertising.

Open the web UI → **📶 Set up hub** → **Find hub**, pick `IRHub-XXXX`, and
accept the pairing prompt. Enter the SSID, password and broker, then press
**Apply**. The status line follows the hub as it joins Wi-Fi and connects to
the broker.

- **New settings are saved only once Wi-Fi *and* MQTT both work with them.** If
  they fail (2 Wi-Fi or 3 broker attempts), the hub reports why ("Wrong Wi-Fi
  password", "MQTT broker did not answer", ...) and goes back to its previous
  settings. A typo can't lock you out.
- Once online, Bluetooth turns off when the page disconnects, or 20 s after
  going online if nothing is connected (5 min at most).
- Leave the password blank to keep the current one (for example when only the
  broker moved). Tick **Open network** for a network without a password.
- **Forget stored settings** erases them. The hub falls back to its build
  defaults, or waits to be set up again. Flashing
  [`flash_nuke.uf2`](https://datasheets.raspberrypi.com/soft/flash_nuke.uf2)
  does the same.

Things to know:

- **Stored settings win over the `-D` build defaults.** Flashing a new UF2 does
  not erase them. They live in the flash sector just below BTstack's bond
  storage at the top of flash.
- **Web Bluetooth needs a secure page.** Use `http://localhost:8080` on the
  machine serving the frontend, or serve it over HTTPS. It works in Chrome and
  Edge on desktop and Android, but not in Firefox or on iOS. On Linux, Chrome
  may need `chrome://flags/#enable-experimental-web-platform-features`. nRF
  Connect on a phone also works; the characteristics are listed in
  `firmware/src/irhub_provision.gatt`.
- **Security:** pairing is LE Secure Connections "Just Works". The link is
  encrypted but has no man-in-the-middle protection. While the hub is
  advertising, anyone in Bluetooth range can give it new settings. The
  password can be written but never read back.
- Saving to flash turns interrupts off for about 45 ms, so an IR capture in
  progress at that moment is lost. This only happens right after a successful
  provision.

### Host tests

The capture path and the stored-settings record have host-side tests that
need neither hardware nor the ARM toolchain. The capture test compiles
`src/ir_capture.cpp` against stub FreeRTOS/Pico headers with a controllable
clock and drives synthetic edge sequences (a NEC frame, an A/C sent as two
halves, noise spikes, an over-length signal, and frames arriving
back-to-back). The `net_config` test covers the flash record's CRC and
parsing, and field validation:

```bash
cd firmware/test
chmod +x run_test.sh && ./run_test.sh
```

### Memory

`IrMessage` is ~1.6KB at `IR_MAX_PULSES=800`, so the tasks that handle one
keep it in static storage rather than on the stack, and `configTOTAL_HEAP_SIZE`
is sized against measured demand (~46KB) rather than left at a round number —
the FreeRTOS heap is a static array in `.bss`, so unused heap is SRAM nothing
else can use. `main()` prints `xPortGetFreeHeapSize()` and `sizeof(IrMessage)`
at boot; check both after changing `IR_MAX_PULSES` or the buffer count.
BTstack (BLE provisioning) is configured without malloc in
`firmware/btstack_config.h` and costs about 6KB of static RAM. The link step
prints RAM/FLASH usage (`--print-memory-usage`).

## Part 2 — Backend (`backend/`)

```bash
cd backend
cp .env.example .env   # edit MQTT_URL etc.
npm install
npm start
```

REST API:

| Method | Path            | Body                                   | Description                                   |
|--------|-----------------|-----------------------------------------|-----------------------------------------------|
| GET    | `/api/remotes`  | —                                        | List all remotes + button layouts             |
| GET    | `/api/remotes/:id` | —                                     | Get one remote                                 |
| POST   | `/api/remotes`  | `{id?, name, icon?, buttons?}`           | Create or update a remote/layout               |
| DELETE | `/api/remotes/:id` | —                                     | Delete a remote                                |
| POST   | `/api/send`     | `{remoteId, buttonId}`                   | Publish the button's signal to `irhub/send`    |
| POST   | `/api/learn`    | `{remoteId, buttonId, timeoutMs?}`       | Arm learn mode; result arrives over WebSocket  |
| DELETE | `/api/learn`    | —                                        | Cancel an in-progress learn session            |
| GET    | `/api/status`   | —                                        | MQTT connectivity snapshot                     |

WebSocket (`/ws`) push events: `hello`, `mqtt-status`, `hub-status`,
`learn-armed`, `learn-result`, `raw-signal`.

Data is persisted to `backend/db.json` via lowdb.

## Part 3 — Frontend (`frontend/`)

Static single-page app (Tailwind CDN + vanilla JS) — no build step.

```bash
cd frontend
python3 -m http.server 8080   # or serve with any static file server
```

By default it talks to the backend on the same origin at `/api/*` and
`/ws`. If serving the frontend separately from the backend, set globals
before `app.js` loads:

```html
<script>
  window.IRHUB_API_BASE = 'http://192.168.1.50:3000';
  window.IRHUB_WS_URL = 'ws://192.168.1.50:3000/ws';
</script>
```

UI flow:
0. First time only: **📶 Set up hub** gives the Pico W its Wi-Fi and broker
   over Bluetooth (see [Provisioning over Bluetooth](#provisioning-over-bluetooth)).
1. Create a remote from the sidebar ("+ New").
2. Add buttons ("+ Add Button" or the trailing `+` tile in the grid).
3. Tap an unmapped button (or right-click / long-press any button) to open
   the edit modal, then **Learn Signal** — point the physical remote at the
   Pico W's IR receiver and press the key. The result streams back over
   WebSocket and saves automatically.
4. Tap a mapped button to fire it — the backend publishes to `irhub/send`
   and the Pico W blasts the IR LED.

## Mosquitto

Any standard Mosquitto install works; no special config is required beyond
allowing connections from the Pico W and the backend host. Example
`mosquitto.conf` for local development:

```
listener 1883
allow_anonymous true
```
