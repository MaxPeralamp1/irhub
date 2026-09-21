'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');


//Config

const PORT = process.env.PORT || 3000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;
const LEARN_TIMEOUT_MS = parseInt(process.env.LEARN_TIMEOUT_MS || '15000', 10);

const TOPIC_SEND = 'irhub/send';
const TOPIC_LEARNED = 'irhub/learned';
const TOPIC_STATUS = 'irhub/status';


//Persistence (lowdb / JSON file)

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
db.defaults({ remotes: [] }).write();


//Express + HTTP + WebSocket

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', payload: { mqttConnected: mqttClient.connected } }));
});


//MQTT client (bridges hardware <-> backend)

const mqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: `irhub-backend-${uuidv4().slice(0, 8)}`,
  reconnectPeriod: 3000,
});

mqttClient.on('connect', () => {
  console.log(`[mqtt] connected to ${MQTT_URL}`);
  mqttClient.subscribe([TOPIC_LEARNED, TOPIC_STATUS], (err) => {
    if (err) console.error('[mqtt] subscribe error', err);
  });
  broadcast('mqtt-status', { connected: true });
});

mqttClient.on('reconnect', () => console.log('[mqtt] reconnecting...'));
mqttClient.on('close', () => broadcast('mqtt-status', { connected: false }));
mqttClient.on('error', (err) => console.error('[mqtt] error', err.message));


//Learn-mode session state

//Only one active learn session at a time (matches "point remote at Pico,
//press button" physical UX).
let learnSession = null; // { remoteId, buttonId, timer, startedAt }

function clearLearnSession() {
  if (learnSession && learnSession.timer) clearTimeout(learnSession.timer);
  learnSession = null;
}

mqttClient.on('message', (topic, payloadBuf) => {
  if (topic === TOPIC_STATUS) {
    const status = payloadBuf.toString();
    broadcast('hub-status', { status });
    return;
  }

  if (topic === TOPIC_LEARNED) {
    let signal;
    try {
      signal = JSON.parse(payloadBuf.toString());
    } catch (e) {
      console.error('[mqtt] bad JSON on irhub/learned:', e.message);
      return;
    }

    console.log(`[mqtt] learned signal: ${signal.pulses?.length ?? 0} pulses @ ${signal.carrier_freq}Hz`);

    if (learnSession) {
      const { remoteId, buttonId } = learnSession;
      const remote = db.get('remotes').find({ id: remoteId }).value();
      const button = remote && remote.buttons.find((b) => b.id === buttonId);

      if (remote && button) {
        db.get('remotes')
          .find({ id: remoteId })
          .get('buttons')
          .find({ id: buttonId })
          .assign({ signal })
          .write();

        broadcast('learn-result', { remoteId, buttonId, signal, success: true });
      } else {
        broadcast('learn-result', { remoteId, buttonId, success: false, error: 'target button not found' });
      }
      clearLearnSession();
    } else {
      // Not in learn mode: still surface it live in case the UI wants a
      // "raw capture" preview / debugging view.
      broadcast('raw-signal', { signal });
    }
  }
});


// REST API


//GET /api/remotes - list all remote categories with their button layouts
app.get('/api/remotes', (req, res) => {
  res.json(db.get('remotes').value());
});

//GET /api/remotes/:id - single remote
app.get('/api/remotes/:id', (req, res) => {
  const remote = db.get('remotes').find({ id: req.params.id }).value();
  if (!remote) return res.status(404).json({ error: 'remote not found' });
  res.json(remote);
});

//POST /api/remotes - create a new remote, or update an existing one
//(matched by id). Body: { id?, name, icon?, buttons?: [...] }
//If id is omitted, a new remote is created with a slugified id.
//If id matches an existing remote, name/icon/buttons are merged in
//(buttons array, when provided, fully replaces the existing layout so
//the frontend's builder can add/rename/reorder freely).
app.post('/api/remotes', (req, res) => {
  const { id, name, icon, buttons } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const remoteId = id || name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const existing = db.get('remotes').find({ id: remoteId }).value();

  const normalizedButtons = Array.isArray(buttons)
    ? buttons.map((b, idx) => ({
        id: b.id || `btn-${uuidv4().slice(0, 8)}`,
        label: b.label || `Button ${idx + 1}`,
        row: Number.isInteger(b.row) ? b.row : Math.floor(idx / 3),
        col: Number.isInteger(b.col) ? b.col : idx % 3,
        icon: b.icon || null,
        color: b.color || null,
        signal: b.signal ?? (existing?.buttons.find((eb) => eb.id === b.id)?.signal ?? null),
      }))
    : existing?.buttons || [];

  if (existing) {
    db.get('remotes')
      .find({ id: remoteId })
      .assign({
        name,
        icon: icon ?? existing.icon,
        buttons: normalizedButtons,
      })
      .write();
  } else {
    db.get('remotes')
      .push({ id: remoteId, name, icon: icon || 'remote', buttons: normalizedButtons })
      .write();
  }

  res.status(200).json(db.get('remotes').find({ id: remoteId }).value());
});

//DELETE /api/remotes/:id
app.delete('/api/remotes/:id', (req, res) => {
  db.get('remotes').remove({ id: req.params.id }).write();
  res.status(204).end();
});

//POST /api/send - execute a button press: look up its stored signal and
//publish it to irhub/send for the Pico to transmit.
//Body: { remoteId, buttonId }
app.post('/api/send', (req, res) => {
  const { remoteId, buttonId } = req.body || {};
  if (!remoteId || !buttonId) {
    return res.status(400).json({ error: 'remoteId and buttonId are required' });
  }

  const remote = db.get('remotes').find({ id: remoteId }).value();
  const button = remote && remote.buttons.find((b) => b.id === buttonId);

  if (!button) return res.status(404).json({ error: 'button not found' });
  if (!button.signal) return res.status(409).json({ error: 'button has no learned signal yet' });

  const payload = JSON.stringify({
    carrier_freq: button.signal.carrier_freq,
    pulses: button.signal.pulses,
  });

  mqttClient.publish(TOPIC_SEND, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[mqtt] publish irhub/send failed', err);
      return res.status(502).json({ error: 'failed to publish to MQTT broker' });
    }
    res.json({ ok: true, remoteId, buttonId });
  });
});

//POST /api/learn - arm learn mode for a specific button. The backend then
//waits for the next irhub/learned MQTT message and maps it to the target
//button automatically. Result is pushed over WebSocket (type: learn-result)
//so the UI updates in real time; this endpoint just acknowledges arming.
//Body: { remoteId, buttonId, timeoutMs? }
app.post('/api/learn', (req, res) => {
  const { remoteId, buttonId, timeoutMs } = req.body || {};
  if (!remoteId || !buttonId) {
    return res.status(400).json({ error: 'remoteId and buttonId are required' });
  }

  const remote = db.get('remotes').find({ id: remoteId }).value();
  if (!remote || !remote.buttons.find((b) => b.id === buttonId)) {
    return res.status(404).json({ error: 'remote or button not found' });
  }

  clearLearnSession();

  const timeout = timeoutMs || LEARN_TIMEOUT_MS;
  const timer = setTimeout(() => {
    broadcast('learn-result', { remoteId, buttonId, success: false, error: 'timed out waiting for signal' });
    clearLearnSession();
  }, timeout);

  learnSession = { remoteId, buttonId, timer, startedAt: Date.now() };

  broadcast('learn-armed', { remoteId, buttonId, timeoutMs: timeout });
  res.status(202).json({ ok: true, armed: true, remoteId, buttonId, timeoutMs: timeout });
});

//DELETE /api/learn - cancel an in-progress learn session
app.delete('/api/learn', (req, res) => {
  const wasActive = !!learnSession;
  clearLearnSession();
  res.json({ ok: true, cancelled: wasActive });
});

//GET /api/status - hub/mqtt connectivity snapshot
app.get('/api/status', (req, res) => {
  res.json({ mqttConnected: mqttClient.connected, learnSessionActive: !!learnSession });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

server.listen(PORT, () => {
  console.log(`[http] IR Hub backend listening on :${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
});
