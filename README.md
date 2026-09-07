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
cmake .. -DPICO_BOARD=pico_w \
         -DWIFI_SSID="YourWiFi" \
         -DWIFI_PASSWORD="YourPassword" \
         -DMQTT_BROKER_IP="192.168.1.100" \
         -DMQTT_BROKER_PORT=1883
make -j4
```

Flash `irhub_firmware.uf2` by holding BOOTSEL while plugging in the Pico W,
then copying the file to the mounted RPI-RP2 drive.

Firmware architecture:
- **`NetworkTask`** (`src/mqtt_manager.cpp`, high priority) — brings up
  cyw43/Wi-Fi, connects to Mosquitto, subscribes to `irhub/send`, decodes
  incoming JSON into an `IrMessage` and pushes it to the transmit queue;
  drains the capture queue and publishes each entry to `irhub/learned`;
  auto-reconnects Wi-Fi and MQTT on drop.
- **`IRCaptureTask`** (`src/ir_capture.cpp`, medium priority) — a GPIO edge
  interrupt on GP15 timestamps every mark/space transition with the
  microsecond hardware timer (protocol-agnostic raw capture, works with any
  remote). A repeating timer polls for a 12ms idle gap to detect end-of-frame,
  then hands the pulse train to the task via a binary semaphore, which
  formats it as `IrMessage` and queues it for MQTT publish.
- **`IRTransmitTask`** (`src/ir_transmit.cpp`, high priority) — blocks on a
  queue fed by the MQTT subscribe callback, configures the PWM slice on GP14
  for the requested carrier frequency, and gates it on/off for each
  mark/space duration using the hardware microsecond timer for tight timing.

Wire payload schema (used both directions):

```json
{"carrier_freq": 38000, "pulses": [9000, 4500, 560, 560, 560, 1690, ...]}
```

`pulses[0]` is always a mark (LED on), alternating with spaces (LED off).

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
