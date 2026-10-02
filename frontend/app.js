'use strict';

const API_BASE = window.IRHUB_API_BASE || '';
const WS_URL = (window.IRHUB_WS_URL) ||
  ((location.protocol === 'https:' ? 'wss://' : 'ws://') + (location.host || 'localhost:3000') + '/ws');


// State
const state = {
  remotes: [],
  activeRemoteId: null,
  editingButtonId: null,
  learning: false,

  view: 'remote',
  routines: [],
  rules: [],
  routineDraftSteps: [],
  editingRoutineId: null,
  editingRuleId: null,
};

const els = {
  remoteList: document.getElementById('remoteList'),
  remoteView: document.getElementById('remoteView'),
  emptyState: document.getElementById('emptyState'),
  remoteNameInput: document.getElementById('remoteNameInput'),
  buttonGrid: document.getElementById('buttonGrid'),
  addButtonBtn: document.getElementById('addButtonBtn'),
  deleteRemoteBtn: document.getElementById('deleteRemoteBtn'),
  newRemoteBtn: document.getElementById('newRemoteBtn'),
  mqttDot: document.getElementById('mqttDot'),
  mqttLabel: document.getElementById('mqttLabel'),
  toast: document.getElementById('toast'),
  waveform: document.getElementById('waveform'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalClose: document.getElementById('modalClose'),
  modalLabel: document.getElementById('modalLabel'),
  modalSignalInfo: document.getElementById('modalSignalInfo'),
  modalLearnBtn: document.getElementById('modalLearnBtn'),
  modalSaveBtn: document.getElementById('modalSaveBtn'),
  modalDeleteBtn: document.getElementById('modalDeleteBtn'),

  navRoutinesBtn: document.getElementById('navRoutinesBtn'),
  navRulesBtn: document.getElementById('navRulesBtn'),
  routinesView: document.getElementById('routinesView'),
  rulesView: document.getElementById('rulesView'),
  routinesList: document.getElementById('routinesList'),
  rulesList: document.getElementById('rulesList'),
  newRoutineBtn: document.getElementById('newRoutineBtn'),
  newRuleBtn: document.getElementById('newRuleBtn'),
  currentPriceValue: document.getElementById('currentPriceValue'),
  currentPriceUpdated: document.getElementById('currentPriceUpdated'),

  routineModalBackdrop: document.getElementById('routineModalBackdrop'),
  routineModalClose: document.getElementById('routineModalClose'),
  routineNameInput: document.getElementById('routineNameInput'),
  routineStepsList: document.getElementById('routineStepsList'),
  routineStepRemote: document.getElementById('routineStepRemote'),
  routineStepButton: document.getElementById('routineStepButton'),
  routineStepDelay: document.getElementById('routineStepDelay'),
  routineAddStepBtn: document.getElementById('routineAddStepBtn'),
  routineSaveBtn: document.getElementById('routineSaveBtn'),
  routineDeleteBtn: document.getElementById('routineDeleteBtn'),

  ruleModalBackdrop: document.getElementById('ruleModalBackdrop'),
  ruleModalClose: document.getElementById('ruleModalClose'),
  ruleNameInput: document.getElementById('ruleNameInput'),
  ruleConditionSelect: document.getElementById('ruleConditionSelect'),
  ruleThresholdInput: document.getElementById('ruleThresholdInput'),
  ruleActionType: document.getElementById('ruleActionType'),
  ruleButtonTargetRow: document.getElementById('ruleButtonTargetRow'),
  ruleRoutineTargetRow: document.getElementById('ruleRoutineTargetRow'),
  ruleTargetRemote: document.getElementById('ruleTargetRemote'),
  ruleTargetButton: document.getElementById('ruleTargetButton'),
  ruleTargetRoutine: document.getElementById('ruleTargetRoutine'),
  ruleEnabledCheckbox: document.getElementById('ruleEnabledCheckbox'),
  ruleSaveBtn: document.getElementById('ruleSaveBtn'),
  ruleDeleteBtn: document.getElementById('ruleDeleteBtn'),

  navSetupBtn: document.getElementById('navSetupBtn'),
  setupView: document.getElementById('setupView'),
  setupUnsupported: document.getElementById('setupUnsupported'),
  setupDeviceName: document.getElementById('setupDeviceName'),
  setupFindBtn: document.getElementById('setupFindBtn'),
  setupForm: document.getElementById('setupForm'),
  setupSsid: document.getElementById('setupSsid'),
  setupPassword: document.getElementById('setupPassword'),
  setupShowPassBtn: document.getElementById('setupShowPassBtn'),
  setupOpenNetwork: document.getElementById('setupOpenNetwork'),
  setupHost: document.getElementById('setupHost'),
  setupPort: document.getElementById('setupPort'),
  setupApplyBtn: document.getElementById('setupApplyBtn'),
  setupForgetBtn: document.getElementById('setupForgetBtn'),
  setupStatus: document.getElementById('setupStatus'),
};

//API helpers
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const getRemotes = () => api('/api/remotes');
const saveRemote = (remote) => api('/api/remotes', { method: 'POST', body: JSON.stringify(remote) });
const deleteRemote = (id) => api(`/api/remotes/${id}`, { method: 'DELETE' });
const sendCommand = (remoteId, buttonId) =>
  api('/api/send', { method: 'POST', body: JSON.stringify({ remoteId, buttonId }) });
const armLearn = (remoteId, buttonId) =>
  api('/api/learn', { method: 'POST', body: JSON.stringify({ remoteId, buttonId }) });
const cancelLearn = () => api('/api/learn', { method: 'DELETE' });


const getRoutines = () => api('/api/routines');
const saveRoutine = (routine) => api('/api/routines', {method: 'POST', body: JSON.stringify(routine)});
const deleteRoutine = (id) => api(`/api/routines/${id}`, {method: 'DELETE'});
const runRoutine = (id) => api(`/api/routines/${id}/run`, {method: 'POST'});

const getRules = () => api('/api/rules');
const saveRule = (rule) => api('/api/rules', {method: 'POST', body: JSON.stringify(rule)});
const deleteRule = (id) => api(`/api/rules/${id}`, {method: 'DELETE'});

const getCurrentPrice = () => api('/api/price/current');

const PRICE_POLL_MS = 60 * 1000;

//toast

let toastTimer = null;
function toast(msg, kind = 'info') {
  els.toast.textContent = msg;
  els.toast.style.borderLeft = `3px solid ${kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--ok)' : 'var(--accent)'}`;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}


//Waveform (signature element) — idle: gentle static bars; learning: live

const WAVEFORM_BARS = 28;
function buildWaveform() {
  els.waveform.innerHTML = '';
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    bar.style.height = '4px';
    els.waveform.appendChild(bar);
  }
}
function setWaveformLearning(on) {
  const bars = els.waveform.children;
  if (on) {
    els.waveform._interval = setInterval(() => {
      for (const bar of bars) {
        const h = 4 + Math.random() * 26;
        bar.style.height = h + 'px';
        bar.classList.add('active');
      }
    }, 90);
  } else {
    clearInterval(els.waveform._interval);
    for (const bar of bars) {
      bar.style.height = '4px';
      bar.classList.remove('active');
    }
  }
}


//Rendering
function renderSidebar() {
  els.remoteList.innerHTML = '';
  state.remotes.forEach((r) => {
    const btn = document.createElement('button');
    const isActive = r.id === state.activeRemoteId;
    btn.className = `w-full text-left px-3 py-2 rounded-md text-sm transition ${
      isActive ? 'surface-2 border border-[var(--accent)]' : 'hover:bg-white/5'
    }`;
    btn.textContent = r.name;
    btn.onclick = () => {
      state.activeRemoteId = r.id;
      showView('remote');
      renderSidebar();
    };
    els.remoteList.appendChild(btn);
  });
}

function renderRemoteView() {
  const remote = state.remotes.find((r) => r.id === state.activeRemoteId);
  if (!remote) {
    els.remoteView.classList.add('hidden');
    els.emptyState.classList.toggle('hidden', state.remotes.length > 0);
    return;
  }
  els.emptyState.classList.add('hidden');
  els.remoteView.classList.remove('hidden');
  els.remoteNameInput.value = remote.name;

  els.buttonGrid.innerHTML = '';
  const sorted = [...remote.buttons].sort((a, b) => (a.row - b.row) || (a.col - b.col));

  sorted.forEach((btn) => {
    const cell = document.createElement('button');
    const hasSignal = !!btn.signal;
    cell.className = `btn-key ${hasSignal ? 'has-signal' : 'no-signal'} rounded-xl p-4 flex flex-col items-center justify-center gap-1 min-h-[84px]`;
    cell.innerHTML = `
      <span class="text-sm font-medium">${escapeHtml(btn.label)}</span>
      <span class="text-[10px] mono ${hasSignal ? 'text-[var(--ok)]' : 'text-[var(--text-dim)]'}">${hasSignal ? 'mapped' : 'unmapped'}</span>
    `;
    cell.onclick = () => handleButtonTap(remote, btn);
    cell.oncontextmenu = (e) => { e.preventDefault(); openEditModal(remote, btn); };

    //long-press on touch devices opens edit modal
    let pressTimer;
    cell.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openEditModal(remote, btn), 500); });
    cell.addEventListener('touchend', () => clearTimeout(pressTimer));

    els.buttonGrid.appendChild(cell);
  });

  //trailing "add button" tile for quick access on the grid itself
  const addTile = document.createElement('button');
  addTile.className = 'btn-key no-signal rounded-xl p-4 flex items-center justify-center text-[var(--text-dim)] min-h-[84px] text-2xl';
  addTile.textContent = '+';
  addTile.onclick = () => addButton(remote);
  els.buttonGrid.appendChild(addTile);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showView(view){
  state.view = view;
  els.remoteView.classList.toggle('hidden', view !== 'remote');
  els.emptyState.classList.toggle('hidden', view !== 'remote' || state.remotes.length > 0);
  els.routinesView.classList.toggle('hidden', view !== 'routines');
  els.rulesView.classList.toggle('hidden', view !== 'rules');
  els.setupView.classList.toggle('hidden', view !== 'setup');

  els.navRoutinesBtn.classList.toggle('surface-2', view === 'routines');
  els.navRulesBtn.classList.toggle('surface-2', view === 'rules');
  els.navSetupBtn.classList.toggle('surface-2', view === 'setup');

  if (view === 'remote') renderRemoteView();
  if (view === 'routines') renderRoutinesList();
  if (view === 'rules') { renderRulesList(); refreshCurrentPrice(); }
  if (view === 'setup') renderSetupSupport();
}

function describeSteps(steps) {
  const labels = steps.map((s) => {
    const remote = state.remotes.find((r) => r.id === s.remoteId);
    const button = remote && remote.buttons.find((b) => b.id === s.buttonId);
    return button ? button.label : '?';
  });
  return labels.length > 3 ? labels.slice(0, 3).join(' > ') + ' > ...' : labels.join(' > ');
}

function describeAction(action) {
  if (!action) return 'no action';
  if (action.type === 'routine') {
    const routine = state.routines.find((r) => r.id === action.routineId);
    return `routine "${routine ? routine.name : action.routineId}"`;
  }
  const remote = state.remotes.find((r) => r.id === action.remoteId);
  const button = remote && remote.buttons.find((b) => b.id === action.buttonId);
  return button ? `${remote.name} / ${button.label}` : 'missing button';
}

function renderRoutinesList() {
  els.routinesList.innerHTML = '';
  if(state.routines.length === 0){
    els.routinesList.innerHTML = '<p class="text-sm text-[var(--text-dim)]"> No routines yet. Create one to chain button presses across any remotes</p>';
    return;
  }

  state.routines.forEach((routine) => {
    const card = document.createElement('div');
    card.className = 'surface rounded-xl p-4 flex items-center justify-between gap-3';

    const info = document.createElement('div');
    info.className = 'min-w-0';
    info.innerHTML = `
      <p class="text-sm font-medium truncate">${escapeHtml(routine.name)}</p>
      <p class="text-xs text-[var(--text-dim)] mono mt-0.5">${routine.steps.length} step${routine.steps.length === 1 ? '' : 's'} &middot; ${escapeHtml(describeSteps(routine.steps))}</p>
    `;

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2 shrink-0';

    const runBtn = document.createElement('button');
    runBtn.className = 'text-xs px-3 py-1.5 rounded-md mono transition';
    runBtn.style.background = 'var(--accent)';
    runBtn.style.color = '#0b0d10';
    runBtn.textContent = 'Run';
    runBtn.onclick = () => runRoutineNow(routine);

    const editBtn = document.createElement('button');
    editBtn.className = 'text-xs px-3 py-1.5 rounded-md surface-2 hover:border-[var(--accent)] transition mono';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openRoutineModal(routine);

    actions.appendChild(runBtn);
    actions.appendChild(editBtn);
    card.appendChild(info);
    card.appendChild(actions);
    els.routinesList.appendChild(card);
  });
}

function renderRulesList() {
  els.rulesList.innerHTML = '';
  if(state.rules.length === 0){
    els.rulesList.innerHTML = '<p class="text-sm text-[var(--text-dim)]"> No price rules yet. Create one to react to the spot price automatically</p>';
    return;
  }

  state.rules.forEach((rule) => {
    const card = document.createElement('div');
    card.className = 'surface rounded-xl p-4 flex items-center justify-between gap-3';

    const info = document.createElement('div');
    info.className = 'min-w-0';
    info.innerHTML = `
      <p class="text-sm font-medium truncate">${escapeHtml(rule.name)}
        <span class="text-[10px] mono ml-1 ${rule.enabled ? 'text-[var(--ok)]' : 'text-[var(--text-dim)]'}">${rule.enabled ? 'enabled' : 'paused'}</span>
      </p>
      <p class="text-xs text-[var(--text-dim)] mono mt-0.5">${escapeHtml(rule.condition)} ${rule.thresholdCents} c/kWh &rarr; ${escapeHtml(describeAction(rule.action))}</p>
    `;

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2 shrink-0';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'text-xs px-3 py-1.5 rounded-md surface-2 hover:border-[var(--accent)] transition mono';
    toggleBtn.textContent = rule.enabled ? 'Pause' : 'Enable';
    toggleBtn.onclick = () => toggleRule(rule);

    const editBtn = document.createElement('button');
    editBtn.className = 'text-xs px-3 py-1.5 rounded-md surface-2 hover:border-[var(--accent)] transition mono';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openRuleModal(rule);

    actions.appendChild(toggleBtn);
    actions.appendChild(editBtn);
    card.appendChild(info);
    card.appendChild(actions);
    els.rulesList.appendChild(card);
  });
}

async function refreshCurrentPrice() {
  try {
    const data = await getCurrentPrice();
    if (data.priceCents === null || data.priceCents === undefined) {
      els.currentPriceValue.textContent = '--';
      els.currentPriceUpdated.textContent = data.cachedBlocks ? 'no block covers now' : 'no price data cached';
      return;
    }
    els.currentPriceValue.textContent = `${data.priceCents.toFixed(2)} c/kWh`;
    els.currentPriceUpdated.textContent = data.fetchedAt
      ? `updated ${new Date(data.fetchedAt).toLocaleTimeString()}`
      : '';
  } catch (e) {
    els.currentPriceValue.textContent = '--';
    els.currentPriceUpdated.textContent = 'price unavailable';
  }
}

function renderAll() {
  renderSidebar();
  if (state.view === 'remote') renderRemoteView();
  if (state.view === 'routines') renderRoutinesList();
  if (state.view === 'rules') renderRulesList();
}


//Actions
async function handleButtonTap(remote, btn) {
  if (!btn.signal) {
    openEditModal(remote, btn);
    return;
  }
  try {
    await sendCommand(remote.id, btn.id);
    toast(`Sent "${btn.label}"`, 'ok');
  } catch (e) {
    toast(`Send failed: ${e.message}`, 'error');
  }
}

async function runRoutineNow(routine) {
  try {
    await runRoutine(routine.id);
    toast(`Running "${routine.name}"`, 'ok');
  } catch (e) {
    toast(`Run failed: ${e.message}`, 'error');
  }
}

async function toggleRule(rule) {
  try {
    const saved = await saveRule({ ...rule, enabled: !rule.enabled });
    Object.assign(rule, saved);
    renderRulesList();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addRemote() {
  const name = prompt('Remote name (e.g. "Bedroom AC")');
  if (!name) return;
  try {
    const remote = await saveRemote({ name, buttons: [] });
    state.remotes.push(remote);
    state.activeRemoteId = remote.id;
    renderAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addButton(remote) {
  const label = prompt('Button label (e.g. "Power")');
  if (!label) return;
  const nextIndex = remote.buttons.length;
  const updated = {
    id: remote.id,
    name: remote.name,
    icon: remote.icon,
    buttons: [
      ...remote.buttons,
      { label, row: Math.floor(nextIndex / 3), col: nextIndex % 3, signal: null },
    ],
  };
  try {
    const saved = await saveRemote(updated);
    Object.assign(remote, saved);
    renderAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function renameRemote(remote, newName) {
  try {
    const saved = await saveRemote({ id: remote.id, name: newName, icon: remote.icon, buttons: remote.buttons });
    Object.assign(remote, saved);
    renderSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function removeRemote(remote) {
  if (!confirm(`Delete "${remote.name}" and all its buttons?`)) return;
  try {
    await deleteRemote(remote.id);
    state.remotes = state.remotes.filter((r) => r.id !== remote.id);
    state.activeRemoteId = state.remotes[0]?.id || null;
    renderAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

//Edit / Learn modal

let modalCtx = null; // { remote, button }

function openEditModal(remote, btn) {
  modalCtx = { remote, button: btn };
  els.modalLabel.value = btn.label;
  updateModalSignalInfo(btn.signal);
  els.modalBackdrop.classList.remove('hidden');
  els.modalBackdrop.classList.add('flex');
}

function closeModal() {
  els.modalBackdrop.classList.add('hidden');
  els.modalBackdrop.classList.remove('flex');
  if (state.learning) stopLearningUi();
  modalCtx = null;
}

function updateModalSignalInfo(signal) {
  els.modalSignalInfo.classList.remove(
    'text-[var(--text-dim)]', 'text-[var(--ok)]', 'text-[var(--danger)]', 'text-[var(--signal)]');

  if (!signal) {
    els.modalSignalInfo.textContent = 'no signal learned';
    els.modalSignalInfo.classList.add('text-[var(--text-dim)]');
    return;
  }

  const base = `${signal.pulses.length} pulses @ ${signal.carrier_freq} Hz`;
  const frames = signal.frame_count ?? 1;

  if (signal.truncated) {
    //The hub ran out of buffer: this capture cannot reproduce the command.
    els.modalSignalInfo.innerHTML = `${escapeHtml(base)}<br>` +
      '<span class="text-[10px]">clipped by the hub &mdash; re-learn this button</span>';
    els.modalSignalInfo.classList.add('text-[var(--danger)]');
  } else if (frames > 1) {
    //Normal for an A/C, which sends its state as two halves. On a TV button
    //it usually means the key was held down during learning.
    els.modalSignalInfo.innerHTML = `${escapeHtml(base)}<br>` +
      `<span class="text-[10px]">${frames} frames &mdash; normal for A/C, otherwise you may have held the key</span>`;
    els.modalSignalInfo.classList.add('text-[var(--signal)]');
  } else {
    els.modalSignalInfo.textContent = base;
    els.modalSignalInfo.classList.add('text-[var(--ok)]');
  }
}

function startLearningUi() {
  state.learning = true;
  els.modalLearnBtn.textContent = 'Point remote & press key...';
  els.modalLearnBtn.classList.add('learning');
  setWaveformLearning(true);
  els.waveform.classList.remove('hidden');
  els.waveform.classList.add('flex');
}

function stopLearningUi() {
  state.learning = false;
  els.modalLearnBtn.textContent = 'Learn Signal';
  els.modalLearnBtn.classList.remove('learning');
  setWaveformLearning(false);
}

els.modalLearnBtn.onclick = async () => {
  if (!modalCtx) return;
  if (state.learning) {
    await cancelLearn().catch(() => {});
    stopLearningUi();
    return;
  }
  try {
    await armLearn(modalCtx.remote.id, modalCtx.button.id);
    startLearningUi();
    toast('Point the remote at the IR Hub and press the button', 'info');
  } catch (e) {
    toast(`Could not arm learn mode: ${e.message}`, 'error');
  }
};

els.modalSaveBtn.onclick = async () => {
  if (!modalCtx) return;
  const { remote, button } = modalCtx;
  const newLabel = els.modalLabel.value.trim() || button.label;
  const updatedButtons = remote.buttons.map((b) => (b.id === button.id ? { ...b, label: newLabel } : b));
  try {
    const saved = await saveRemote({ id: remote.id, name: remote.name, icon: remote.icon, buttons: updatedButtons });
    Object.assign(remote, saved);
    renderAll();
    closeModal();
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.modalDeleteBtn.onclick = async () => {
  if (!modalCtx) return;
  const { remote, button } = modalCtx;
  if (!confirm(`Delete button "${button.label}"?`)) return;
  const updatedButtons = remote.buttons.filter((b) => b.id !== button.id);
  try {
    const saved = await saveRemote({ id: remote.id, name: remote.name, icon: remote.icon, buttons: updatedButtons });
    Object.assign(remote, saved);
    renderAll();
    closeModal();
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.modalClose.onclick = closeModal;
els.modalBackdrop.onclick = (e) => { if (e.target === els.modalBackdrop) closeModal(); };


// Top-level UI wiring

els.newRemoteBtn.onclick = addRemote;
els.addButtonBtn.onclick = () => {
  const remote = state.remotes.find((r) => r.id === state.activeRemoteId);
  if (remote) addButton(remote);
};
els.deleteRemoteBtn.onclick = () => {
  const remote = state.remotes.find((r) => r.id === state.activeRemoteId);
  if (remote) removeRemote(remote);
};
els.remoteNameInput.addEventListener('blur', () => {
  const remote = state.remotes.find((r) => r.id === state.activeRemoteId);
  if (remote && els.remoteNameInput.value.trim() && els.remoteNameInput.value !== remote.name) {
    renameRemote(remote, els.remoteNameInput.value.trim());
  }
});

els.navRoutinesBtn.onclick = () => showView('routines');
els.navRulesBtn.onclick = () => showView('rules');
els.navSetupBtn.onclick = () => showView('setup');


//Select helpers shared by both automation modals

function populateRemoteSelect(select) {
  select.innerHTML = '';
  state.remotes.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}

function populateButtonSelect(select, remoteId) {
  select.innerHTML = '';
  const remote = state.remotes.find((r) => r.id === remoteId);
  if (!remote) return;
  remote.buttons.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.label;
    select.appendChild(opt);
  });
}

function populateRoutineSelect(select) {
  select.innerHTML = '';
  state.routines.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}


//Routine builder modal

function openRoutineModal(routine) {
  state.editingRoutineId = routine ? routine.id : null;
  state.routineDraftSteps = routine ? routine.steps.map((s) => ({ ...s })) : [];

  els.routineNameInput.value = routine ? routine.name : '';
  els.routineStepDelay.value = '';
  els.routineDeleteBtn.classList.toggle('hidden', !routine);

  populateRemoteSelect(els.routineStepRemote);
  populateButtonSelect(els.routineStepButton, els.routineStepRemote.value);
  renderRoutineSteps();

  els.routineModalBackdrop.classList.remove('hidden');
  els.routineModalBackdrop.classList.add('flex');
}

function closeRoutineModal() {
  els.routineModalBackdrop.classList.add('hidden');
  els.routineModalBackdrop.classList.remove('flex');
  state.editingRoutineId = null;
  state.routineDraftSteps = [];
}

function renderRoutineSteps() {
  els.routineStepsList.innerHTML = '';
  if (state.routineDraftSteps.length === 0) {
    els.routineStepsList.innerHTML = '<p class="text-xs text-[var(--text-dim)] mono">no steps yet</p>';
    return;
  }

  state.routineDraftSteps.forEach((step, i) => {
    const remote = state.remotes.find((r) => r.id === step.remoteId);
    const button = remote && remote.buttons.find((b) => b.id === step.buttonId);

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 surface-2 rounded-md px-3 py-2 text-xs border border-[var(--border)]';

    const label = document.createElement('span');
    label.className = 'mono truncate';
    label.textContent = `${i + 1}. ${remote ? remote.name : '?'} / ${button ? button.label : '?'}${step.delayMs ? ` (+${step.delayMs}ms)` : ''}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'mono shrink-0';
    removeBtn.style.color = 'var(--danger)';
    removeBtn.textContent = 'remove';
    removeBtn.onclick = () => {
      state.routineDraftSteps.splice(i, 1);
      renderRoutineSteps();
    };

    row.appendChild(label);
    row.appendChild(removeBtn);
    els.routineStepsList.appendChild(row);
  });
}

els.newRoutineBtn.onclick = () => {
  if (state.remotes.length === 0) {
    toast('Create a remote with buttons first', 'error');
    return;
  }
  openRoutineModal(null);
};

els.routineStepRemote.onchange = () => populateButtonSelect(els.routineStepButton, els.routineStepRemote.value);

els.routineAddStepBtn.onclick = () => {
  const remoteId = els.routineStepRemote.value;
  const buttonId = els.routineStepButton.value;
  if (!remoteId || !buttonId) {
    toast('Pick a remote and a button first', 'error');
    return;
  }
  const delayMs = parseInt(els.routineStepDelay.value, 10);
  state.routineDraftSteps.push({ remoteId, buttonId, delayMs: Number.isInteger(delayMs) ? delayMs : 0 });
  els.routineStepDelay.value = '';
  renderRoutineSteps();
};

els.routineSaveBtn.onclick = async () => {
  const name = els.routineNameInput.value.trim();
  if (!name) { toast('Routine needs a name', 'error'); return; }
  if (state.routineDraftSteps.length === 0) { toast('Add at least one step', 'error'); return; }

  const payload = { name, steps: state.routineDraftSteps };
  if (state.editingRoutineId) payload.id = state.editingRoutineId;

  try {
    const saved = await saveRoutine(payload);
    const existing = state.routines.find((r) => r.id === saved.id);
    if (existing) Object.assign(existing, saved); else state.routines.push(saved);
    closeRoutineModal();
    renderRoutinesList();
    toast(`Saved "${saved.name}"`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.routineDeleteBtn.onclick = async () => {
  const id = state.editingRoutineId;
  if (!id) return;
  const routine = state.routines.find((r) => r.id === id);
  if (!confirm(`Delete routine "${routine ? routine.name : ''}"?`)) return;
  try {
    await deleteRoutine(id);
    state.routines = state.routines.filter((r) => r.id !== id);
    closeRoutineModal();
    renderRoutinesList();
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.routineModalClose.onclick = closeRoutineModal;
els.routineModalBackdrop.onclick = (e) => { if (e.target === els.routineModalBackdrop) closeRoutineModal(); };


//Price rule builder modal

function openRuleModal(rule) {
  state.editingRuleId = rule ? rule.id : null;

  els.ruleNameInput.value = rule ? rule.name : '';
  els.ruleConditionSelect.value = rule ? rule.condition : 'below';
  els.ruleThresholdInput.value = rule ? rule.thresholdCents : '';
  els.ruleActionType.value = rule && rule.action ? rule.action.type : 'button';
  els.ruleEnabledCheckbox.checked = rule ? rule.enabled !== false : true;
  els.ruleDeleteBtn.classList.toggle('hidden', !rule);

  populateRemoteSelect(els.ruleTargetRemote);
  populateRoutineSelect(els.ruleTargetRoutine);

  if (rule && rule.action && rule.action.type === 'button') {
    els.ruleTargetRemote.value = rule.action.remoteId;
    populateButtonSelect(els.ruleTargetButton, rule.action.remoteId);
    els.ruleTargetButton.value = rule.action.buttonId;
  } else {
    populateButtonSelect(els.ruleTargetButton, els.ruleTargetRemote.value);
    if (rule && rule.action && rule.action.routineId) els.ruleTargetRoutine.value = rule.action.routineId;
  }

  syncRuleActionRows();

  els.ruleModalBackdrop.classList.remove('hidden');
  els.ruleModalBackdrop.classList.add('flex');
}

function closeRuleModal() {
  els.ruleModalBackdrop.classList.add('hidden');
  els.ruleModalBackdrop.classList.remove('flex');
  state.editingRuleId = null;
}

function syncRuleActionRows() {
  const isRoutine = els.ruleActionType.value === 'routine';
  els.ruleButtonTargetRow.classList.toggle('hidden', isRoutine);
  els.ruleRoutineTargetRow.classList.toggle('hidden', !isRoutine);
}

els.newRuleBtn.onclick = () => {
  if (state.remotes.length === 0 && state.routines.length === 0) {
    toast('Create a remote or a routine first', 'error');
    return;
  }
  openRuleModal(null);
};

els.ruleActionType.onchange = syncRuleActionRows;
els.ruleTargetRemote.onchange = () => populateButtonSelect(els.ruleTargetButton, els.ruleTargetRemote.value);

els.ruleSaveBtn.onclick = async () => {
  const name = els.ruleNameInput.value.trim();
  if (!name) { toast('Rule needs a name', 'error'); return; }

  const thresholdCents = parseFloat(els.ruleThresholdInput.value);
  if (!Number.isFinite(thresholdCents)) { toast('Threshold must be a number', 'error'); return; }

  let action;
  if (els.ruleActionType.value === 'routine') {
    if (!els.ruleTargetRoutine.value) { toast('Pick a routine', 'error'); return; }
    action = { type: 'routine', routineId: els.ruleTargetRoutine.value };
  } else {
    if (!els.ruleTargetRemote.value || !els.ruleTargetButton.value) { toast('Pick a remote and a button', 'error'); return; }
    action = { type: 'button', remoteId: els.ruleTargetRemote.value, buttonId: els.ruleTargetButton.value };
  }

  const payload = {
    name,
    enabled: els.ruleEnabledCheckbox.checked,
    condition: els.ruleConditionSelect.value,
    thresholdCents,
    action,
  };
  if (state.editingRuleId) payload.id = state.editingRuleId;

  try {
    const saved = await saveRule(payload);
    const existing = state.rules.find((r) => r.id === saved.id);
    if (existing) Object.assign(existing, saved); else state.rules.push(saved);
    closeRuleModal();
    renderRulesList();
    toast(`Saved "${saved.name}"`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.ruleDeleteBtn.onclick = async () => {
  const id = state.editingRuleId;
  if (!id) return;
  const rule = state.rules.find((r) => r.id === id);
  if (!confirm(`Delete rule "${rule ? rule.name : ''}"?`)) return;
  try {
    await deleteRule(id);
    state.rules = state.rules.filter((r) => r.id !== id);
    closeRuleModal();
    renderRulesList();
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.ruleModalClose.onclick = closeRuleModal;
els.ruleModalBackdrop.onclick = (e) => { if (e.target === els.ruleModalBackdrop) closeRuleModal(); };


//WebSocket: live learn-mode results + mqtt status

function connectWs() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[ws] connected');

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'hello':
        setMqttStatus(!!msg.payload.mqttConnected);
        break;
      case 'mqtt-status':
        setMqttStatus(!!msg.payload.connected);
        break;
      case 'learn-armed':
        //handled locally already via startLearningUi(); nothing to do
        break;
      case 'learn-result':
        onLearnResult(msg.payload);
        break;
      case 'raw-signal':
        //a capture arrived with no active learn session (debug/preview)
        break;
      default:
        break;
    }
  };

  ws.onclose = () => {
    setMqttStatus(false);
    setTimeout(connectWs, 2000);
  };
  ws.onerror = () => ws.close();
}

function setMqttStatus(connected) {
  els.mqttDot.style.background = connected ? 'var(--ok)' : 'var(--danger)';
  els.mqttLabel.textContent = connected ? 'mqtt online' : 'mqtt offline';
}

function onLearnResult(payload) {
  if (!state.learning) return; //stale/unsolicited result
  stopLearningUi();

  if (!payload.success) {
    toast(`Learn failed: ${payload.error || 'unknown error'}`, 'error');
    return;
  }

  const remote = state.remotes.find((r) => r.id === payload.remoteId);
  const button = remote && remote.buttons.find((b) => b.id === payload.buttonId);
  if (button) {
    button.signal = payload.signal;
    updateModalSignalInfo(button.signal);
    renderAll();

    if (payload.signal.truncated) {
      toast(`"${button.label}" was clipped at ${payload.signal.pulses.length} pulses — re-learn it`, 'error');
    } else if ((payload.signal.frame_count ?? 1) > 1) {
      toast(`Learned "${button.label}" (${payload.signal.pulses.length} pulses, ${payload.signal.frame_count} frames)`, 'ok');
    } else {
      toast(`Learned "${button.label}" (${payload.signal.pulses.length} pulses)`, 'ok');
    }
  }
}


//Hub setup: BLE provisioning over Web Bluetooth
//
//The UUIDs, status layout and command bytes mirror
//firmware/src/irhub_provision.gatt and ble_provision.cpp - all three move
//together.

const PROV = {
  service: 'be3d7600-0ea0-4e96-82e0-89aa6a3dc19f',
  chars: {
    ssid:     'be3d7601-0ea0-4e96-82e0-89aa6a3dc19f',
    password: 'be3d7602-0ea0-4e96-82e0-89aa6a3dc19f',
    status:   'be3d7603-0ea0-4e96-82e0-89aa6a3dc19f',
    host:     'be3d7604-0ea0-4e96-82e0-89aa6a3dc19f',
    port:     'be3d7605-0ea0-4e96-82e0-89aa6a3dc19f',
    command:  'be3d7606-0ea0-4e96-82e0-89aa6a3dc19f',
  },
  CMD_APPLY: 0x01,
  CMD_FORGET: 0x02,
};

const PROV_STATE = {
  UNPROVISIONED: 0, IDLE: 1, WIFI_CONNECTING: 2, WIFI_FAILED: 3, MQTT_CONNECTING: 4,
  MQTT_FAILED: 5, ONLINE: 6, REVERTED: 7, INVALID: 8, SAVE_FAILED: 9,
};

const setup = { device: null, chars: null, lastState: null };

function renderSetupSupport() {
  let msg = '';
  if (!window.isSecureContext) {
    msg = 'Web Bluetooth only works on a secure page. Open this UI at http://localhost:8080 ' +
          'on the machine serving it, or over HTTPS.';
  } else if (!navigator.bluetooth) {
    msg = 'This browser has no Web Bluetooth. Use Chrome or Edge on desktop or Android ' +
          '(not Firefox or iOS Safari). On Linux, Chrome may need ' +
          'chrome://flags/#enable-experimental-web-platform-features.';
  }
  els.setupUnsupported.textContent = msg;
  els.setupUnsupported.classList.toggle('hidden', !msg);
  els.setupFindBtn.disabled = !!msg;
}

function setSetupStatus(text, kind = 'info') {
  els.setupStatus.textContent = text;
  els.setupStatus.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--ok)' : '';
}

function describeProvStatus(view) {
  const state = view.getUint8(0);
  const reason = view.getInt8(1);
  const ip = [2, 3, 4, 5].map((i) => view.getUint8(i)).join('.');
  const attempt = view.getUint8(6);
  const source = ['stored settings', 'new settings', 'build defaults'][view.getUint8(7)] || 'settings';
  const nth = attempt > 1 ? ` (attempt ${attempt})` : '';

  switch (state) {
    case PROV_STATE.UNPROVISIONED:
      return ['The hub has no settings yet — enter them below.', 'info'];
    case PROV_STATE.IDLE:
      return ['Connected to the hub.', 'info'];
    case PROV_STATE.WIFI_CONNECTING:
      return [`Joining Wi-Fi with ${source}${nth}…`, 'info'];
    case PROV_STATE.WIFI_FAILED:
      return [`${[
        'Wi-Fi failed', 'Wi-Fi network not found or not answering', 'Wrong Wi-Fi password', 'Wi-Fi connection failed',
      ][reason] || 'Wi-Fi failed'} (${source})${nth}.`, 'error'];
    case PROV_STATE.MQTT_CONNECTING:
      return [`Wi-Fi OK, connecting to the MQTT broker with ${source}${nth}…`, 'info'];
    case PROV_STATE.MQTT_FAILED:
      return [`${[
        'MQTT failed', 'MQTT broker did not answer', 'MQTT broker refused the connection', 'Could not reach the MQTT broker',
      ][reason] || 'MQTT failed'} (${source})${nth}.`, 'error'];
    case PROV_STATE.ONLINE:
      return [`Online at ${ip} ✓`, 'ok'];
    case PROV_STATE.REVERTED:
      return ['The new settings did not work — the hub kept its previous settings.', 'error'];
    case PROV_STATE.INVALID:
      return [`The hub rejected the ${['', 'SSID', 'password', 'broker IP', 'port'][reason] || 'settings'}.`, 'error'];
    case PROV_STATE.SAVE_FAILED:
      return ['Online, but the settings could not be saved to flash — they will be lost on reboot.', 'error'];
    default:
      return [`Unknown status ${state}.`, 'info'];
  }
}

function onProvStatus(view) {
  if (view.byteLength < 8) return;
  setup.lastState = view.getUint8(0);
  const [text, kind] = describeProvStatus(view);
  setSetupStatus(text, kind);
}

function resetSetupUi() {
  setup.device = null;
  setup.chars = null;
  els.setupForm.disabled = true;
  els.setupPassword.value = '';
  els.setupDeviceName.textContent = 'not connected';
  els.setupFindBtn.textContent = 'Find hub';
}

function onSetupDisconnected() {
  const wasOnline = setup.lastState === PROV_STATE.ONLINE;
  resetSetupUi();
  if (wasOnline) {
    setSetupStatus('Hub is online — it has turned Bluetooth off.', 'ok');
  } else {
    setSetupStatus('Disconnected from the hub.', 'info');
  }
}

async function setupFind() {
  if (setup.device) {
    setup.device.gatt.disconnect();
    return;
  }

  let device;
  try {
    //Must be the first await: the browser only shows the chooser from a click.
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [PROV.service] }] });
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(`Bluetooth: ${e.message}`, 'error');
    return;
  }

  setup.device = device;
  setup.lastState = null;
  device.addEventListener('gattserverdisconnected', onSetupDisconnected);
  els.setupDeviceName.textContent = device.name || 'IR Hub';
  els.setupFindBtn.textContent = 'Disconnect';
  setSetupStatus('Connecting… your system may ask to pair with the hub.');

  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PROV.service);
    const chars = {};
    for (const [name, uuid] of Object.entries(PROV.chars)) {
      chars[name] = await service.getCharacteristic(uuid);
    }
    setup.chars = chars;

    //Every value needs an encrypted link, so this is where pairing happens.
    chars.status.addEventListener('characteristicvaluechanged', (e) => onProvStatus(e.target.value));
    await chars.status.startNotifications();
    onProvStatus(await chars.status.readValue());

    const text = new TextDecoder();
    els.setupSsid.value = text.decode(await chars.ssid.readValue());
    els.setupHost.value = text.decode(await chars.host.readValue());
    els.setupPort.value = (await chars.port.readValue()).getUint16(0, true) || 1883;
    els.setupPassword.value = '';
    els.setupOpenNetwork.checked = false;
    els.setupForm.disabled = false;
  } catch (e) {
    toast(`Bluetooth: ${e.message}`, 'error');
    if (device.gatt.connected) device.gatt.disconnect();
    else resetSetupUi();
  }
}

function byteLength(s) {
  return new TextEncoder().encode(s).length;
}

//Same rules as net_config::validate() in the firmware.
function validateSetupForm() {
  const ssid = els.setupSsid.value;
  const password = els.setupPassword.value;
  const open = els.setupOpenNetwork.checked;
  const host = els.setupHost.value.trim();
  const port = Number(els.setupPort.value);

  const ssidLen = byteLength(ssid);
  if (ssidLen < 1 || ssidLen > 32) return 'The SSID must be 1–32 bytes.';

  if (!open) {
    const passLen = byteLength(password);
    if (passLen === 0 && setup.lastState === PROV_STATE.UNPROVISIONED) {
      return 'Enter the Wi-Fi password, or tick "Open network".';
    }
    if (passLen !== 0 && (passLen < 8 || passLen > 63)) return 'A WPA2 password is 8–63 characters.';
  }

  const octets = host.split('.');
  const ipv4 = octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255) &&
    octets.some((o) => Number(o) !== 0);
  if (!ipv4) return 'The broker must be an IPv4 address such as 192.168.1.100.';

  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'The port must be 1–65535.';
  return null;
}

async function setupApply() {
  if (!setup.chars) return;
  const problem = validateSetupForm();
  if (problem) {
    toast(problem, 'error');
    return;
  }

  const c = setup.chars;
  const text = new TextEncoder();
  const port = new Uint8Array(2);
  new DataView(port.buffer).setUint16(0, Number(els.setupPort.value), true);

  els.setupApplyBtn.disabled = true;
  try {
    await c.ssid.writeValueWithResponse(text.encode(els.setupSsid.value));
    //Not writing the password keeps the hub's current one.
    if (els.setupOpenNetwork.checked) {
      await c.password.writeValueWithResponse(new Uint8Array(0));
    } else if (els.setupPassword.value) {
      await c.password.writeValueWithResponse(text.encode(els.setupPassword.value));
    }
    await c.host.writeValueWithResponse(text.encode(els.setupHost.value.trim()));
    await c.port.writeValueWithResponse(port);
    await c.command.writeValueWithResponse(Uint8Array.of(PROV.CMD_APPLY));
    els.setupPassword.value = '';
    setSetupStatus('Settings sent — the hub is trying them…');
  } catch (e) {
    toast(`The hub rejected the settings: ${e.message}`, 'error');
  } finally {
    els.setupApplyBtn.disabled = false;
  }
}

async function setupForget() {
  if (!setup.chars) return;
  if (!confirm('Erase the Wi-Fi and broker settings stored on the hub? It will fall back to its build defaults, or wait to be set up again.')) return;
  try {
    await setup.chars.command.writeValueWithResponse(Uint8Array.of(PROV.CMD_FORGET));
    toast('Stored settings erased', 'ok');
  } catch (e) {
    toast(`Could not erase settings: ${e.message}`, 'error');
  }
}

els.setupFindBtn.onclick = setupFind;
els.setupApplyBtn.onclick = setupApply;
els.setupForgetBtn.onclick = setupForget;
els.setupShowPassBtn.onclick = () => {
  const show = els.setupPassword.type === 'password';
  els.setupPassword.type = show ? 'text' : 'password';
  els.setupShowPassBtn.textContent = show ? 'hide' : 'show';
};
els.setupOpenNetwork.onchange = () => {
  els.setupPassword.disabled = els.setupOpenNetwork.checked;
  if (els.setupOpenNetwork.checked) els.setupPassword.value = '';
};


// Boot

async function boot() {
  buildWaveform();
  try {
    state.remotes = await getRemotes();
    state.activeRemoteId = state.remotes[0]?.id || null;
  } catch (e) {
    toast(`Could not reach backend: ${e.message}`, 'error');
  }

  try {
    state.routines = await getRoutines();
    state.rules = await getRules();
  } catch (e) {
    toast(`Could not load automation: ${e.message}`, 'error');
  }

  showView('remote');
  renderSidebar();
  connectWs();

  refreshCurrentPrice();
  setInterval(refreshCurrentPrice, PRICE_POLL_MS);
}

boot();
