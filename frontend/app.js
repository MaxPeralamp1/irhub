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

//oast

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
      renderAll();
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

function renderAll() {
  renderSidebar();
  renderRemoteView();
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
  if (signal) {
    els.modalSignalInfo.textContent = `${signal.pulses.length} pulses @ ${signal.carrier_freq} Hz`;
    els.modalSignalInfo.classList.remove('text-[var(--text-dim)]');
    els.modalSignalInfo.classList.add('text-[var(--ok)]');
  } else {
    els.modalSignalInfo.textContent = 'no signal learned';
    els.modalSignalInfo.classList.add('text-[var(--text-dim)]');
    els.modalSignalInfo.classList.remove('text-[var(--ok)]');
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
    toast(`Learned "${button.label}" (${payload.signal.pulses.length} pulses)`, 'ok');
  }
}


// Boot

async function boot() {
  buildWaveform();
  try {
    state.remotes = await getRemotes();
    state.activeRemoteId = state.remotes[0]?.id || null;
  } catch (e) {
    toast(`Could not reach backend: ${e.message}`, 'error');
  }
  renderAll();
  connectWs();
}

boot();
