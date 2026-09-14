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

const PRICE_API_URL = 'https://api.porssisahko.net/v2/latest-prices.json';
const PRICE_REFRESH_MS = 15*60*1000;
const RULE_EVAL_MS = 60*1000;


//Persistence (lowdb / JSON file)

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
db.defaults({ remotes: [], routines: [], priceRules: [] }).write();


//Express + HTTP + WebSocket

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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


// Electricity spot price (porssisahko.net) — fetched every 15 min, cached

let priceCache = {prices: [], fetchedAt: 0};

async function refreshPrices(){
  try{
    const res = await fetch(PRICE_API_URL);
    if (!res.ok) throw new ERROR(`HTTP ${res.status}`);
    const data = await res.json();
    priceCache = {prices: data.prices || [], fetchedAt: Date.now()};
    console.log(`[price] refreshed, ${priceCache.prices.length}blocks cached`);
  } catch (err){
    console.error('[price] refresh failed:', err.message);
  }
}

// Returns the cents/kWh price for the current 15-min block, or null if the
// cache is empty/stale and doesn't cover "now".

function getCurrentPriceCents(){
  const now = Date.now();
  const block = priceCache.prices.find((p) =>{
    const start = new Date(p.startDate).getTime();
    const end = new Date(p.endDate).getTime()
    return now >= start && now < end;
  });
  return block ? block.price : null;
}

// Shared action executor — used by manual /api/send, routines, and rules

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// Publishes a single button's learned signal to irhub/send. Throws if the
// button/signal doesn't exist so callers can report a clear error.

function fireButton(remoteId, buttonId) {
  return new Promise((resolve, reject) => {
    const remote = db.get('remotes').find({ id: remoteId }).value();
    const button = remote && remote.buttons.find((b) => b.id === buttonId);

    if (!button) return reject(new Error(`button ${remoteId}/${buttonId} not found`));
    if (!button.signal) return reject(new Error(`button ${remoteId}/${buttonId} has no learned signal`));

    const payload = JSON.stringify({
      carrier_freq: button.signal.carrier_freq,
      pulses: button.signal.pulses,
    });

    mqttClient.publish(TOPIC_SEND, payload, { qos: 1 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Runs a routine's steps in order, waiting each step's delay before firing
// the next button. Broadcasts progress over WebSocket so the UI can show it
// running live.

async function runRoutine(routineId){
  const routine = db.get('routines').find({id: routineId}).value();
  if (!routine) throw new Error('routine not found');

  broadcast('routine-started', {routineId, name: routine.name});

  for (let i = 0; i < routine.steps.length; i++){
    const step = routine.steps[i];
    if (step.delayMs) await sleep(step.delayMs);

    try {
      await fireButton(step.remoteId, step.buttonId);
      broadcast('routine-step', {routineId, stepIndex: i, success: true});
    } catch (err) {
       broadcast('routine-step', {routineId, stepIndex: i, success: false, error: err.message});
      // Keep going with remaining steps rather than aborting the whole routine.
    }
  }
  broadcast('routine-finished', {routineId});
}

// Price rules — "when price goes above/below X, fire this button/routine"
// Edge-triggered: only fires the moment the condition newly becomes true,
// not on every evaluation tick while it stays true.

async function evaluateRules(){
  const priceCents = getCurrentPriceCents();
  if (priceCents === null) return;

  const rules = db.get('priceRules').value;

  for(const rule of rules){
    const conditionMet =
        rule.condition === 'below' ? priceCents < rule.thresholdCents : priceCents > rule.thresholdCents;

    if (conditionMet && !rule.lastTriggeredState){
      console.log(`[rules] "${rule.name}" triggered (price=${priceCents}c, threshold=${rule.thresholdCents}c)`);
      try {
        if (rule.action.type === 'button'){
          await fireButton(rule.action.remoteId, rule.action.buttonId);
        } else if (rule.action.type === 'routine'){
          await runRoutine(rule.action.routineId);
        }
        broadcast('rule-triggered', { ruleId: rule.id, name: rule.name, priceCents });
      } catch (err){
        console.error(`[rules] "${rule.name}" action failed:`, err.message);
        broadcast('rule-triggered', { ruleId: rule.id, name: rule.name, priceCents, error: err.message });
      }
    }
    // Persist the new edge state regardless, so we don't re-fire until the
    // condition genuinely flips off and back on again.
    db.get('priceRules').find({ id: rule.id }).assign({ lastTriggeredState: conditionMet }).write();
  }
}


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

// Electricity price REST API

app.get('/api/price/current', (req, res)=>{
  const priceCents = getCurrentPriceCents();
  res.json({priceCents, cachedBlocks: priceCache.prices.length, fetchedAt: priceCache.fetchedAt});
});

app.get('/api/price/today', (req, res) => {
  res.json({prices: priceCache.prices, fetchedAt: priceCache.fetchedAt});
});

// Routines REST API

app.get('/api/routines', (req, res)=>{
  res.json(db.get('routines').value());
});

// POST /api/routines - create or update a routine
// Body: { id?, name, steps: [{ remoteId, buttonId, delayMs }] }

app.post('/api/routines', (req, res)=>{
  const {id, name, steps} = req.body || {};
  if (!name || typeof name !== 'string'){
    return res.status(400).json({error: 'name is required'});
  }
  if (!Array.isArray(steps) || steps.length === 0){
    return res.status(400).json({error: 'steps myst be a non empty arry'});
  }
  const normalizedSteps = steps.map((s) => ({
    remoteId: s.remoteId,
    buttonId: s.buttonId,
    delayMs: Number.isInteger(s.delayMs) ? s.delayMs : 0,
  }));

  const routineId = id || `routine-${uuidv4().slice(0, 8)}`;
  const existing = db.get('routines').find({ id: routineId }).value();

  if(existing){
    db.get('routines').find({id: routineId}).assign({name, steps: normalizedSteps}).write();
  } else{
    db.get('routines').push({id: routineId, name, steps: normalizedSteps}).write();
  }

  res.status(200).json(db.get('routines').find({ id: routineId }).value());

});

// DELETE /api/routines/:id
app.delete('/api/routines/:id', (req, res) => {
  db.get('routines').remove({ id: req.params.id }).write();
  res.status(204).end();
});

// POST /api/routines/:id/run - execute a routine's steps in order now
app.post('/api/routines/:id/run', async (req, res) => {
  const routine = db.get('routines').find({ id: req.params.id }).value();
  if (!routine) return res.status(404).json({ error: 'routine not found' });

  // Respond immediately; the routine runs asynchronously and reports
  // progress over WebSocket (routine-started / routine-step / routine-finished).
  res.status(202).json({ ok: true, running: true, routineId: routine.id });
  runRoutine(routine.id).catch((err) => console.error('[routine] run failed:', err.message));
});

// Price rules REST API

// GET /api/rules - list all price rules
app.get('/api/rules', (req, res) => {
  res.json(db.get('priceRules').value());
});

// POST /api/rules - create or update a price rule
// Body: { id?, name, enabled, condition: 'below'|'above', thresholdCents,
//         action: { type: 'button', remoteId, buttonId } | { type: 'routine', routineId } }
app.post('/api/rules', (req, res) => {
  const { id, name, enabled, condition, thresholdCents, action } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (condition !== 'below' && condition !== 'above') {
    return res.status(400).json({ error: "condition must be 'below' or 'above'" });
  }
  if (typeof thresholdCents !== 'number') {
    return res.status(400).json({ error: 'thresholdCents must be a number' });
  }
  if (!action || (action.type !== 'button' && action.type !== 'routine')) {
    return res.status(400).json({ error: "action.type must be 'button' or 'routine'" });
  }

  const ruleId = id || `rule-${uuidv4().slice(0, 8)}`;
  const existing = db.get('priceRules').find({ id: ruleId }).value();

  const record = {
    id: ruleId,
    name,
    enabled: enabled !== false,
    condition,
    thresholdCents,
    action,
    lastTriggeredState: existing ? existing.lastTriggeredState : false,
  };

  if (existing) {
    db.get('priceRules').find({ id: ruleId }).assign(record).write();
  } else {
    db.get('priceRules').push(record).write();
  }

  res.status(200).json(db.get('priceRules').find({ id: ruleId }).value());
});

// DELETE /api/rules/:id
app.delete('/api/rules/:id', (req, res) => {
  db.get('priceRules').remove({ id: req.params.id }).write();
  res.status(204).end();
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

server.listen(PORT, () => {
  console.log(`[http] IR Hub backend listening on :${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
});
