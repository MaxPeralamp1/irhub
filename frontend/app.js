'use strict';

const API_BASE = window.IRHUB_API_BASE || (location.port === '3000' ? '' : 'http://localhost:3000');
const WS_URL = (window.IRHUB_WS_URL) ||
  (location.port === '3000'
    ? ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
    : 'ws://localhost:3000/ws');

// ==================== APPLICATION STATE ====================
const state = {
  view: 'places', // 'places' | 'routines' | 'rules'
  remotes: [],
  expandedPlaceIds: new Set(),
  routines: [],
  rules: [],
  routineDraftSteps: [],

  // Button Modal Context
  modalCtx: null, // { remoteId, button, isNew }
  learning: false,
  learnTimer: null,
  learnCountdown: 15,
  selectedIcon: null,
  selectedColor: null,

  // New Remote Modal Context
  selectedNewRemoteType: 'ac',

  // Automation Editing Context
  editingRoutineId: null,
  editingRuleId: null,
};

// ==================== DOM ELEMENTS ====================
const els = {
  // Navigation & Toolbars
  navPlacesBtn: document.getElementById('navPlacesBtn'),
  navRoutinesBtn: document.getElementById('navRoutinesBtn'),
  navRulesBtn: document.getElementById('navRulesBtn'),
  navPlacesBadge: document.getElementById('navPlacesBadge'),
  navRoutinesBadge: document.getElementById('navRoutinesBadge'),
  navRulesBadge: document.getElementById('navRulesBadge'),

  placesToolbarActions: document.getElementById('placesToolbarActions'),
  routinesToolbarActions: document.getElementById('routinesToolbarActions'),
  rulesToolbarActions: document.getElementById('rulesToolbarActions'),

  placesViewContainer: document.getElementById('placesViewContainer'),
  routinesViewContainer: document.getElementById('routinesViewContainer'),
  rulesViewContainer: document.getElementById('rulesViewContainer'),

  // Header & Status
  mqttDot: document.getElementById('mqttDot'),
  mqttLabel: document.getElementById('mqttLabel'),
  toast: document.getElementById('toast'),
  waveform: document.getElementById('waveform'),

  // Places Accordion View
  placesAccordion: document.getElementById('placesAccordion'),
  emptyState: document.getElementById('emptyState'),
  emptyNewRemoteBtn: document.getElementById('emptyNewRemoteBtn'),
  expandAllBtn: document.getElementById('expandAllBtn'),
  collapseAllBtn: document.getElementById('collapseAllBtn'),
  openNewRemoteModalBtn: document.getElementById('openNewRemoteModalBtn'),
  bottomAddPlaceBtn: document.getElementById('bottomAddPlaceBtn'),
  bottomAddPlaceWrapper: document.getElementById('bottomAddPlaceWrapper'),

  // Routines View
  routinesList: document.getElementById('routinesList'),
  newRoutineBtn: document.getElementById('newRoutineBtn'),

  // Price Rules View
  rulesList: document.getElementById('rulesList'),
  newRuleBtn: document.getElementById('newRuleBtn'),
  currentPriceValue: document.getElementById('currentPriceValue'),
  currentPriceUpdated: document.getElementById('currentPriceUpdated'),

  // Edit Button Modal
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalClose: document.getElementById('modalClose'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  modalTitle: document.getElementById('modalTitle'),
  modalSubtitle: document.getElementById('modalSubtitle'),
  modalLabel: document.getElementById('modalLabel'),
  presetChips: document.getElementById('presetChips'),
  iconSelectorGrid: document.getElementById('iconSelectorGrid'),
  colorSelectorGrid: document.getElementById('colorSelectorGrid'),
  modalSignalBadge: document.getElementById('modalSignalBadge'),
  modalSignalInfo: document.getElementById('modalSignalInfo'),
  modalLearnBtn: document.getElementById('modalLearnBtn'),
  learnBtnText: document.getElementById('learnBtnText'),
  modalTestBtn: document.getElementById('modalTestBtn'),
  modalClearSignalBtn: document.getElementById('modalClearSignalBtn'),
  clearSignalRow: document.getElementById('clearSignalRow'),
  modalSaveBtn: document.getElementById('modalSaveBtn'),
  modalDeleteBtn: document.getElementById('modalDeleteBtn'),

  // New Remote Place Modal
  newRemoteModalBackdrop: document.getElementById('newRemoteModalBackdrop'),
  newRemoteModalClose: document.getElementById('newRemoteModalClose'),
  newRemoteCancelBtn: document.getElementById('newRemoteCancelBtn'),
  newRemoteCreateBtn: document.getElementById('newRemoteCreateBtn'),
  newRemoteNameInput: document.getElementById('newRemoteNameInput'),
  newRemoteTypeSelector: document.getElementById('newRemoteTypeSelector'),
  newRemoteTemplateSelect: document.getElementById('newRemoteTemplateSelect'),

  // Routine Modal
  routineModalBackdrop: document.getElementById('routineModalBackdrop'),
  routineModalClose: document.getElementById('routineModalClose'),
  routineCancelBtn: document.getElementById('routineCancelBtn'),
  routineSaveBtn: document.getElementById('routineSaveBtn'),
  routineDeleteBtn: document.getElementById('routineDeleteBtn'),
  routineModalTitle: document.getElementById('routineModalTitle'),
  routineNameInput: document.getElementById('routineNameInput'),
  routineStepsList: document.getElementById('routineStepsList'),
  routineStepRemote: document.getElementById('routineStepRemote'),
  routineStepButton: document.getElementById('routineStepButton'),
  routineStepDelay: document.getElementById('routineStepDelay'),
  routineAddStepBtn: document.getElementById('routineAddStepBtn'),

  // Price Rule Modal
  ruleModalBackdrop: document.getElementById('ruleModalBackdrop'),
  ruleModalClose: document.getElementById('ruleModalClose'),
  ruleCancelBtn: document.getElementById('ruleCancelBtn'),
  ruleSaveBtn: document.getElementById('ruleSaveBtn'),
  ruleDeleteBtn: document.getElementById('ruleDeleteBtn'),
  ruleModalTitle: document.getElementById('ruleModalTitle'),
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
};

// ==================== SVG ICON LIBRARY ====================
const ICONS = {
  ac: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"></path><path d="M12 2v20"></path><path d="m20 16-4-4 4-4"></path><path d="m4 8 4 4-4 4"></path><path d="m16 4-4 4-4-4"></path><path d="m8 20 4-4 4 4"></path></svg>`,
  tv: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>`,
  projector: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7 3 5"></path><path d="M9 6V3"></path><path d="m13 7 2-2"></path><circle cx="9" cy="13" r="3"></circle><path d="M11.83 12H20a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h2.17"></path><path d="M16 16h2"></path></svg>`,
  fan: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"></path><circle cx="12" cy="12" r="2"></circle></svg>`,
  light: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>`,
  speaker: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"></rect><circle cx="12" cy="14" r="4"></circle><line x1="12" x2="12.01" y1="6" y2="6"></line></svg>`,
  game: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="10" y1="12" y2="12"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="15" x2="15.01" y1="13" y2="13"></line><line x1="18" x2="18.01" y1="11" y2="11"></line><rect width="20" height="12" x="2" y="6" rx="6"></rect></svg>`,
  remote: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2"></rect><circle cx="12" cy="14" r="2"></circle><line x1="12" x2="12.01" y1="6" y2="6"></line></svg>`,

  // Button specific icons
  power: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`,
  snowflake: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"></path><path d="M12 2v20"></path><path d="m20 16-4-4 4-4"></path><path d="m4 8 4 4-4 4"></path><path d="m16 4-4 4-4-4"></path><path d="m8 20 4-4 4 4"></path></svg>`,
  flame: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`,
  thermometer: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path></svg>`,
  wind: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"></path><path d="M9.6 4.6A2 2 0 1 1 11 8H2"></path><path d="M12.6 19.4A2 2 0 1 0 14 16H2"></path></svg>`,
  'volume-up': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
  'volume-down': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  'volume-mute': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="22" x2="16" y1="9" y2="15"></line><line x1="16" x2="22" y1="9" y2="15"></line></svg>`,
  'chevron-up': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
  'chevron-down': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  'chevron-left': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
  'chevron-right': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>`,
  sun: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
  moon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`,
  clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  settings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  refresh: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>`,
};

// Auto-detect icon based on name/label
function detectIcon(typeOrLabel, isRemote = false) {
  const s = String(typeOrLabel || '').toLowerCase();
  if (isRemote) {
    if (s.includes('ac') || s.includes('air') || s.includes('cool') || s.includes('heat')) return 'ac';
    if (s.includes('tv') || s.includes('television') || s.includes('screen')) return 'tv';
    if (s.includes('proj')) return 'projector';
    if (s.includes('fan')) return 'fan';
    if (s.includes('light') || s.includes('lamp')) return 'light';
    if (s.includes('sound') || s.includes('audio') || s.includes('speaker')) return 'speaker';
    if (s.includes('tread') || s.includes('mill') || s.includes('sport')) return 'refresh';
    return 'remote';
  }

  // Button icon inference
  if (s.includes('power') || s.includes('on') || s.includes('off')) return 'power';
  if (s.includes('cold') || s.includes('cool') || s.includes('freeze')) return 'snowflake';
  if (s.includes('heat') || s.includes('warm')) return 'flame';
  if (s.includes('temp')) return 'thermometer';
  if (s.includes('fan') || s.includes('speed') || s.includes('air')) return 'fan';
  if (s.includes('swing') || s.includes('wind') || s.includes('breeze')) return 'wind';
  if (s.includes('vol+') || s.includes('vol up') || s.includes('volume up')) return 'volume-up';
  if (s.includes('vol-') || s.includes('vol down') || s.includes('volume down')) return 'volume-down';
  if (s.includes('mute')) return 'volume-mute';
  if (s.includes('up') || s.includes('+')) return 'chevron-up';
  if (s.includes('down') || s.includes('-')) return 'chevron-down';
  if (s.includes('left')) return 'chevron-left';
  if (s.includes('right')) return 'chevron-right';
  if (s.includes('play')) return 'play';
  if (s.includes('pause') || s.includes('stop')) return 'pause';
  if (s.includes('sleep') || s.includes('night')) return 'moon';
  if (s.includes('timer') || s.includes('clock')) return 'clock';
  if (s.includes('mode') || s.includes('source') || s.includes('input')) return 'refresh';
  if (s.includes('setting') || s.includes('menu')) return 'settings';
  return null;
}

const COLOR_OPTIONS = [
  { id: null, label: 'Default', bg: '#1f2a3f', border: '#324261' },
  { id: 'red', label: 'Power Red', bg: '#ef4444', border: '#f87171' },
  { id: 'cyan', label: 'Cool Cyan', bg: '#06b6d4', border: '#22d3ee' },
  { id: 'amber', label: 'Warm Amber', bg: '#f59e0b', border: '#fbbf24' },
  { id: 'green', label: 'Emerald', bg: '#10b981', border: '#34d399' },
  { id: 'blue', label: 'Accent Blue', bg: '#3b82f6', border: '#60a5fa' },
];

// ==================== API CLIENT HELPERS ====================
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

// Remotes API
const getRemotes = () => api('/api/remotes');
const saveRemote = (remote) => api('/api/remotes', { method: 'POST', body: JSON.stringify(remote) });
const deleteRemote = (id) => api(`/api/remotes/${id}`, { method: 'DELETE' });
const sendCommand = (remoteId, buttonId) =>
  api('/api/send', { method: 'POST', body: JSON.stringify({ remoteId, buttonId }) });
const armLearn = (remoteId, buttonId) =>
  api('/api/learn', { method: 'POST', body: JSON.stringify({ remoteId, buttonId }) });
const cancelLearn = () => api('/api/learn', { method: 'DELETE' });

// Routines API
const getRoutines = () => api('/api/routines');
const saveRoutine = (routine) => api('/api/routines', { method: 'POST', body: JSON.stringify(routine) });
const deleteRoutine = (id) => api(`/api/routines/${id}`, { method: 'DELETE' });
const runRoutine = (id) => api(`/api/routines/${id}/run`, { method: 'POST' });

// Price Rules API & Spot Price API
const getRules = () => api('/api/rules');
const saveRule = (rule) => api('/api/rules', { method: 'POST', body: JSON.stringify(rule) });
const deleteRule = (id) => api(`/api/rules/${id}`, { method: 'DELETE' });
const getCurrentPrice = () => api('/api/price/current');

const PRICE_POLL_MS = 60 * 1000;

// ==================== UTILITIES ====================
let toastTimer = null;
function toast(msg, kind = 'info') {
  els.toast.innerHTML = `
    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--ok)' : 'var(--accent)'}"></span>
    <span class="text-white font-medium">${escapeHtml(msg)}</span>
  `;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3500);
}

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

function flashWaveformTransmit() {
  const bars = els.waveform.children;
  for (const bar of bars) {
    const h = 8 + Math.random() * 22;
    bar.style.height = h + 'px';
    bar.classList.add('transmitting');
  }
  setTimeout(() => {
    for (const bar of bars) {
      bar.style.height = '4px';
      bar.classList.remove('transmitting');
    }
  }, 400);
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
    }, 85);
  } else {
    clearInterval(els.waveform._interval);
    for (const bar of bars) {
      bar.style.height = '4px';
      bar.classList.remove('active');
    }
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function genId(prefix = 'btn') {
  return prefix + '-' + Math.random().toString(36).substring(2, 10);
}

// ==================== VIEW SWITCHER ====================
function showView(view) {
  state.view = view;

  // Toggle containers
  els.placesViewContainer.classList.toggle('hidden', view !== 'places');
  els.routinesViewContainer.classList.toggle('hidden', view !== 'routines');
  els.rulesViewContainer.classList.toggle('hidden', view !== 'rules');

  // Toggle top toolbar action buttons
  els.placesToolbarActions.classList.toggle('hidden', view !== 'places');
  els.routinesToolbarActions.classList.toggle('hidden', view !== 'routines');
  els.rulesToolbarActions.classList.toggle('hidden', view !== 'rules');

  // Update nav tabs active state
  els.navPlacesBtn.classList.toggle('is-active', view === 'places');
  els.navRoutinesBtn.classList.toggle('is-active', view === 'routines');
  els.navRulesBtn.classList.toggle('is-active', view === 'rules');

  // Update badge counts
  updateNavBadges();

  if (view === 'places') renderPlacesAccordion();
  if (view === 'routines') renderRoutinesList();
  if (view === 'rules') {
    renderRulesList();
    refreshCurrentPrice();
  }
}

function updateNavBadges() {
  els.navPlacesBadge.textContent = state.remotes.length;
  els.navRoutinesBadge.textContent = state.routines.length;
  els.navRulesBadge.textContent = state.rules.length;
}

els.navPlacesBtn.onclick = () => showView('places');
els.navRoutinesBtn.onclick = () => showView('routines');
els.navRulesBtn.onclick = () => showView('rules');

// ==================== PLACES & REMOTES ACCORDION VIEW ====================
function renderPlacesAccordion() {
  updateNavBadges();

  if (state.remotes.length === 0) {
    els.emptyState.classList.remove('hidden');
    els.placesAccordion.classList.add('hidden');
    els.bottomAddPlaceWrapper.classList.add('hidden');
    return;
  }

  els.emptyState.classList.add('hidden');
  els.placesAccordion.classList.remove('hidden');
  els.bottomAddPlaceWrapper.classList.remove('hidden');
  els.placesAccordion.innerHTML = '';

  state.remotes.forEach((remote) => {
    const isOpen = state.expandedPlaceIds.has(remote.id);
    const totalButtons = (remote.buttons || []).length;
    const mappedButtons = (remote.buttons || []).filter(b => !!b.signal).length;
    const unmappedButtons = totalButtons - mappedButtons;
    const iconType = remote.icon || detectIcon(remote.name, true);
    const iconSvg = ICONS[iconType] || ICONS.remote;

    const placeItem = document.createElement('div');
    placeItem.className = `place-accordion-item ${isOpen ? 'is-open' : ''}`;
    placeItem.id = `place-item-${remote.id}`;

    // Header Button (Collapsed Accordion Header)
    const headerBtn = document.createElement('button');
    headerBtn.className = 'place-accordion-header';
    headerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    headerBtn.innerHTML = `
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/35 flex items-center justify-center text-blue-300 shadow-inner shrink-0">
          ${iconSvg}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-base font-bold text-white tracking-wide">${escapeHtml(remote.name)}</span>
            <span class="text-[10px] mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold uppercase">${iconType}</span>
          </div>
          <p class="text-xs text-[var(--text-muted)] mono mt-0.5">
            ${totalButtons} button${totalButtons === 1 ? '' : 's'} • <span class="${mappedButtons > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}">${mappedButtons} mapped</span>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-xs mono px-2.5 py-1 rounded-lg font-semibold ${
          mappedButtons === totalButtons && totalButtons > 0
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : unmappedButtons > 0
            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
            : 'bg-slate-800 text-slate-400 border border-slate-700'
        } hidden sm:inline-block">
          ${mappedButtons === totalButtons && totalButtons > 0 ? '✓ Ready' : `${mappedButtons}/${totalButtons} Ready`}
        </span>

        <!-- Chevron arrow -->
        <div class="place-chevron w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
    `;

    // Toggle expand/collapse
    headerBtn.onclick = () => {
      if (state.expandedPlaceIds.has(remote.id)) {
        state.expandedPlaceIds.delete(remote.id);
      } else {
        state.expandedPlaceIds.add(remote.id);
      }
      renderPlacesAccordion();
    };

    placeItem.appendChild(headerBtn);

    // Expanded Content Panel
    const contentDiv = document.createElement('div');
    contentDiv.className = 'place-accordion-content space-y-4';

    // Toolbar inside the place
    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800';
    toolbar.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-muted)] mono uppercase tracking-wider">Place Name:</span>
        <input class="remote-rename-input w-48 sm:w-64" value="${escapeHtml(remote.name)}" title="Edit place name" />
      </div>

      <div class="flex items-center gap-2 self-end sm:self-center">
        <button class="add-button-trigger btn-primary text-xs font-bold">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>+ Add Button</span>
        </button>

        <button class="delete-place-trigger btn-danger px-2.5 py-1.5 text-xs" title="Delete this entire place">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Wire toolbar actions
    const renameInput = toolbar.querySelector('.remote-rename-input');
    renameInput.addEventListener('change', async () => {
      const newName = renameInput.value.trim();
      if (newName && newName !== remote.name) {
        try {
          const saved = await saveRemote({
            id: remote.id,
            name: newName,
            icon: remote.icon,
            buttons: remote.buttons,
          });
          Object.assign(remote, saved);
          renderPlacesAccordion();
          toast(`Renamed to "${saved.name}"`, 'ok');
        } catch (e) {
          toast(`Rename failed: ${e.message}`, 'error');
          renameInput.value = remote.name;
        }
      }
    });

    const addBtnTrigger = toolbar.querySelector('.add-button-trigger');
    addBtnTrigger.onclick = () => openNewButtonModal(remote);

    const deletePlaceTrigger = toolbar.querySelector('.delete-place-trigger');
    deletePlaceTrigger.onclick = async () => {
      if (!confirm(`Delete place "${remote.name}" and all its ${remote.buttons.length} buttons?`)) return;
      try {
        await deleteRemote(remote.id);
        state.remotes = state.remotes.filter(r => r.id !== remote.id);
        state.expandedPlaceIds.delete(remote.id);
        renderPlacesAccordion();
        toast(`Deleted place "${remote.name}"`, 'info');
      } catch (e) {
        toast(`Delete failed: ${e.message}`, 'error');
      }
    };

    contentDiv.appendChild(toolbar);

    // Button Grid inside the place
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 pt-1';

    const sortedButtons = [...(remote.buttons || [])].sort((a, b) => (a.row - b.row) || (a.col - b.col));

    sortedButtons.forEach((btn) => {
      const hasSignal = !!btn.signal;
      const card = document.createElement('div');
      const colorClass = btn.color ? `btn-theme-${btn.color}` : '';
      card.className = `btn-key-card ${hasSignal ? 'has-signal' : 'no-signal'} ${colorClass} rounded-2xl p-4 flex flex-col justify-between min-h-[110px] cursor-pointer group`;

      const iconName = btn.icon || detectIcon(btn.label);
      const iconSvg = iconName && ICONS[iconName] ? ICONS[iconName] : '';

      card.innerHTML = `
        <!-- Top Row: Status pill & Quick-Transmit Trigger -->
        <div class="flex items-center justify-between w-full">
          <span class="flex items-center gap-1.5 text-[10px] mono px-2 py-0.5 rounded-full font-semibold ${
            hasSignal ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
          }">
            <span class="w-1.5 h-1.5 rounded-full" style="background:${hasSignal ? 'var(--ok)' : 'var(--signal)'}"></span>
            <span>${hasSignal ? 'Ready' : 'Unmapped'}</span>
          </span>

          ${
            hasSignal
              ? `<button class="quick-transmit-btn" title="Quick Transmit IR signal">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>`
              : `<button class="quick-edit-btn" title="Click to map signal">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                 </button>`
          }
        </div>

        <!-- Center: Icon & Label -->
        <div class="flex flex-col items-center justify-center my-2 gap-1.5 text-center">
          ${iconSvg ? `<div class="text-white group-hover:scale-110 transition-transform duration-200">${iconSvg}</div>` : ''}
          <span class="text-sm font-bold text-white tracking-wide leading-tight">${escapeHtml(btn.label)}</span>
        </div>

        <!-- Bottom: Subtext info -->
        <div class="text-center">
          <span class="text-[10px] mono text-slate-400">
            ${hasSignal ? `${btn.signal.pulses.length}p @ ${(btn.signal.carrier_freq / 1000).toFixed(0)}kHz` : 'Click to map'}
          </span>
        </div>
      `;

      // Click card opens Edit Button Menu!
      card.onclick = (e) => {
        const transmitBtn = e.target.closest('.quick-transmit-btn');
        if (transmitBtn) {
          e.stopPropagation();
          handleQuickTransmit(remote, btn, card);
          return;
        }
        openEditModal(remote, btn, false);
      };

      card.oncontextmenu = (e) => {
        e.preventDefault();
        openEditModal(remote, btn, false);
      };

      grid.appendChild(card);
    });

    // Trailing "+ Add Button" Card
    const addCard = document.createElement('div');
    addCard.className = 'btn-key-card no-signal rounded-2xl p-4 flex flex-col items-center justify-center gap-2 min-h-[110px] cursor-pointer hover:border-blue-500 text-slate-300 hover:text-white transition group';
    addCard.innerHTML = `
      <div class="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/35 flex items-center justify-center text-blue-300 group-hover:scale-110 group-hover:bg-blue-500/30 transition">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>
      <span class="text-xs font-bold text-white tracking-wide">Add Button</span>
      <span class="text-[10px] mono text-slate-400">Create & map key</span>
    `;
    addCard.onclick = () => openNewButtonModal(remote);
    grid.appendChild(addCard);

    contentDiv.appendChild(grid);
    placeItem.appendChild(contentDiv);
    els.placesAccordion.appendChild(placeItem);
  });
}

// Quick Transmit directly from button card
async function handleQuickTransmit(remote, btn, cardEl) {
  if (!btn.signal) {
    openEditModal(remote, btn, false);
    return;
  }
  cardEl.classList.add('transmitting');
  flashWaveformTransmit();
  try {
    await sendCommand(remote.id, btn.id);
    toast(`Sent "${btn.label}" to ${remote.name}`, 'ok');
  } catch (e) {
    toast(`Send failed: ${e.message}`, 'error');
  } finally {
    setTimeout(() => cardEl.classList.remove('transmitting'), 500);
  }
}

// ==================== EDIT BUTTON MENU WORKFLOW ====================
function openEditModal(remote, btn, isNew = false) {
  state.modalCtx = {
    remoteId: remote.id,
    button: { ...btn },
    isNew,
  };

  state.selectedIcon = btn.icon || null;
  state.selectedColor = btn.color || null;

  els.modalTitle.innerHTML = isNew
    ? `<span>Create New Button</span>`
    : `<span>Edit "${escapeHtml(btn.label)}"</span>`;
  els.modalSubtitle.textContent = `in ${remote.name}`;
  els.modalLabel.value = btn.label || '';

  renderPresetChips(remote);
  renderIconSelector();
  renderColorSelector();
  updateModalSignalDisplay(btn.signal);

  els.modalDeleteBtn.classList.toggle('hidden', isNew);

  els.modalBackdrop.classList.remove('hidden');
  els.modalBackdrop.classList.add('flex');
  setTimeout(() => els.modalLabel.focus(), 100);
}

function openNewButtonModal(remote) {
  const newBtn = {
    id: genId('btn'),
    label: '',
    row: Math.floor((remote.buttons || []).length / 4),
    col: (remote.buttons || []).length % 4,
    icon: null,
    color: null,
    signal: null,
  };
  openEditModal(remote, newBtn, true);
}

function closeModal() {
  els.modalBackdrop.classList.add('hidden');
  els.modalBackdrop.classList.remove('flex');
  if (state.learning) stopLearning();
  state.modalCtx = null;
}

function renderPresetChips(remote) {
  const isAc = (remote.name || '').toLowerCase().includes('ac') || (remote.name || '').toLowerCase().includes('air');
  const acPresets = ['Power', 'Temp +', 'Temp -', 'Fan Speed', 'Mode', 'Swing', 'Turbo', 'Sleep', 'Eco'];
  const tvPresets = ['Power', 'Vol +', 'Vol -', 'Mute', 'Channel +', 'Channel -', 'Input', 'Menu', 'OK'];
  const presets = isAc ? acPresets : tvPresets;

  els.presetChips.innerHTML = '';
  presets.forEach((preset) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip';
    chip.textContent = preset;
    chip.onclick = () => {
      els.modalLabel.value = preset;
      const detected = detectIcon(preset);
      if (detected) {
        state.selectedIcon = detected;
        renderIconSelector();
      }
      if (preset.toLowerCase().includes('power')) {
        state.selectedColor = 'red';
        renderColorSelector();
      } else if (preset.toLowerCase().includes('temp') || preset.toLowerCase().includes('cool')) {
        state.selectedColor = 'cyan';
        renderColorSelector();
      }
    };
    els.presetChips.appendChild(chip);
  });
}

function renderIconSelector() {
  els.iconSelectorGrid.innerHTML = '';

  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = `icon-choice-btn text-xs mono ${state.selectedIcon === null ? 'is-active' : ''}`;
  noneBtn.textContent = 'None';
  noneBtn.onclick = () => {
    state.selectedIcon = null;
    renderIconSelector();
  };
  els.iconSelectorGrid.appendChild(noneBtn);

  const iconKeys = [
    'power', 'snowflake', 'flame', 'thermometer', 'fan', 'wind',
    'volume-up', 'volume-down', 'volume-mute', 'chevron-up', 'chevron-down',
    'chevron-left', 'chevron-right', 'play', 'pause', 'sun', 'moon',
    'clock', 'settings', 'refresh'
  ];

  iconKeys.forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = state.selectedIcon === key;
    btn.className = `icon-choice-btn ${isSelected ? 'is-active' : ''}`;
    btn.innerHTML = ICONS[key] || '';
    btn.title = key;
    btn.onclick = () => {
      state.selectedIcon = key;
      renderIconSelector();
    };
    els.iconSelectorGrid.appendChild(btn);
  });
}

function renderColorSelector() {
  els.colorSelectorGrid.innerHTML = '';
  COLOR_OPTIONS.forEach((opt) => {
    const isSelected = state.selectedColor === opt.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `color-choice-btn flex-1 flex items-center justify-center gap-1.5 ${isSelected ? 'is-active' : ''}`;
    if (isSelected) {
      btn.style.boxShadow = `0 0 10px ${opt.border}`;
      btn.style.borderColor = opt.border;
    }
    btn.innerHTML = `
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${opt.bg}"></span>
      <span class="truncate">${opt.label}</span>
    `;
    btn.onclick = () => {
      state.selectedColor = opt.id;
      renderColorSelector();
    };
    els.colorSelectorGrid.appendChild(btn);
  });
}

function updateModalSignalDisplay(signal) {
  if (signal) {
    els.modalSignalBadge.textContent = 'Learned';
    els.modalSignalBadge.className = 'text-[10px] mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold';
    els.modalSignalInfo.innerHTML = `
      <div class="flex items-center gap-2 text-emerald-300 font-semibold">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>${signal.pulses.length} pulses @ ${(signal.carrier_freq / 1000).toFixed(0)} kHz</span>
      </div>
      <span class="text-[10px] text-slate-400 font-medium">Ready to send</span>
    `;
    els.modalTestBtn.disabled = false;
    els.clearSignalRow.classList.remove('hidden');
  } else {
    els.modalSignalBadge.textContent = 'Unmapped';
    els.modalSignalBadge.className = 'text-[10px] mono px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold';
    els.modalSignalInfo.innerHTML = `
      <span class="text-slate-400 font-medium">No IR signal learned yet</span>
    `;
    els.modalTestBtn.disabled = true;
    els.clearSignalRow.classList.add('hidden');
  }
}

// Signal learning countdown
function startLearning() {
  state.learning = true;
  state.learnCountdown = 15;
  els.learnBtnText.textContent = `Listening (${state.learnCountdown}s)...`;
  els.modalLearnBtn.classList.add('learning-pulse');
  setWaveformLearning(true);

  clearInterval(state.learnTimer);
  state.learnTimer = setInterval(() => {
    state.learnCountdown--;
    if (state.learnCountdown <= 0) {
      stopLearning();
      toast('Learn mode timed out', 'error');
    } else {
      els.learnBtnText.textContent = `Listening (${state.learnCountdown}s)...`;
    }
  }, 1000);
}

function stopLearning() {
  state.learning = false;
  clearInterval(state.learnTimer);
  els.learnBtnText.textContent = 'Learn Signal';
  els.modalLearnBtn.classList.remove('learning-pulse');
  setWaveformLearning(false);
}

els.modalLearnBtn.onclick = async () => {
  if (!state.modalCtx) return;
  if (state.learning) {
    await cancelLearn().catch(() => {});
    stopLearning();
    toast('Cancelled learning mode', 'info');
    return;
  }

  try {
    await armLearn(state.modalCtx.remoteId, state.modalCtx.button.id);
    startLearning();
    toast('Point physical remote at IR Hub & press the button', 'info');
  } catch (e) {
    toast(`Could not start learn mode: ${e.message}`, 'error');
  }
};

els.modalTestBtn.onclick = async () => {
  if (!state.modalCtx || !state.modalCtx.button.signal) return;
  flashWaveformTransmit();
  els.modalTestBtn.classList.add('transmitting');
  try {
    await sendCommand(state.modalCtx.remoteId, state.modalCtx.button.id);
    toast(`Blasted "${state.modalCtx.button.label}" via IR LED`, 'ok');
  } catch (e) {
    toast(`Transmit failed: ${e.message}`, 'error');
  } finally {
    setTimeout(() => els.modalTestBtn.classList.remove('transmitting'), 400);
  }
};

els.modalClearSignalBtn.onclick = () => {
  if (!state.modalCtx) return;
  state.modalCtx.button.signal = null;
  updateModalSignalDisplay(null);
  toast('Signal cleared. Click "Learn Signal" to record a new one.', 'info');
};

els.modalSaveBtn.onclick = async () => {
  if (!state.modalCtx) return;
  const { remoteId, button, isNew } = state.modalCtx;
  const remote = state.remotes.find(r => r.id === remoteId);
  if (!remote) return;

  const label = els.modalLabel.value.trim() || button.label || `Key ${(remote.buttons || []).length + 1}`;
  const updatedBtn = {
    ...button,
    label,
    icon: state.selectedIcon,
    color: state.selectedColor,
  };

  let updatedButtons;
  if (isNew) {
    updatedButtons = [...(remote.buttons || []), updatedBtn];
  } else {
    updatedButtons = (remote.buttons || []).map(b => b.id === button.id ? updatedBtn : b);
  }

  try {
    const saved = await saveRemote({
      id: remote.id,
      name: remote.name,
      icon: remote.icon,
      buttons: updatedButtons,
    });
    Object.assign(remote, saved);
    renderPlacesAccordion();
    closeModal();
    toast(`Saved button "${updatedBtn.label}"`, 'ok');
  } catch (e) {
    toast(`Failed to save: ${e.message}`, 'error');
  }
};

els.modalDeleteBtn.onclick = async () => {
  if (!state.modalCtx || state.modalCtx.isNew) return;
  const { remoteId, button } = state.modalCtx;
  const remote = state.remotes.find(r => r.id === remoteId);
  if (!remote) return;

  if (!confirm(`Delete button "${button.label}"?`)) return;

  const updatedButtons = (remote.buttons || []).filter(b => b.id !== button.id);
  try {
    const saved = await saveRemote({
      id: remote.id,
      name: remote.name,
      icon: remote.icon,
      buttons: updatedButtons,
    });
    Object.assign(remote, saved);
    renderPlacesAccordion();
    closeModal();
    toast(`Deleted button "${button.label}"`, 'info');
  } catch (e) {
    toast(`Delete failed: ${e.message}`, 'error');
  }
};

els.modalClose.onclick = closeModal;
els.modalCancelBtn.onclick = closeModal;
els.modalBackdrop.onclick = (e) => {
  if (e.target === els.modalBackdrop) closeModal();
};

// ==================== NEW REMOTE / PLACE MODAL ====================
function openNewRemoteModal() {
  state.selectedNewRemoteType = 'ac';
  els.newRemoteNameInput.value = '';
  renderNewRemoteTypeSelector();
  els.newRemoteModalBackdrop.classList.remove('hidden');
  els.newRemoteModalBackdrop.classList.add('flex');
  setTimeout(() => els.newRemoteNameInput.focus(), 100);
}

function closeNewRemoteModal() {
  els.newRemoteModalBackdrop.classList.add('hidden');
  els.newRemoteModalBackdrop.classList.remove('flex');
}

function renderNewRemoteTypeSelector() {
  const types = [
    { id: 'ac', label: 'AC', icon: ICONS.ac },
    { id: 'tv', label: 'TV', icon: ICONS.tv },
    { id: 'projector', label: 'Projector', icon: ICONS.projector },
    { id: 'fan', label: 'Fan', icon: ICONS.fan },
    { id: 'light', label: 'Light', icon: ICONS.light },
    { id: 'speaker', label: 'Audio', icon: ICONS.speaker },
    { id: 'game', label: 'Console', icon: ICONS.game },
    { id: 'remote', label: 'Other', icon: ICONS.remote },
  ];

  els.newRemoteTypeSelector.innerHTML = '';
  types.forEach((t) => {
    const isSelected = state.selectedNewRemoteType === t.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `device-type-btn ${isSelected ? 'is-active' : ''}`;
    btn.innerHTML = `
      <span class="${isSelected ? 'text-blue-300' : 'text-slate-400'}">${t.icon}</span>
      <span class="text-[11px] tracking-wide">${t.label}</span>
    `;
    btn.onclick = () => {
      state.selectedNewRemoteType = t.id;
      renderNewRemoteTypeSelector();
      if (!els.newRemoteNameInput.value.trim()) {
        els.newRemoteNameInput.value = t.label === 'AC' ? 'AC Remote' : `${t.label} Remote`;
      }
      if (t.id === 'ac') els.newRemoteTemplateSelect.value = 'ac';
      else if (t.id === 'tv') els.newRemoteTemplateSelect.value = 'tv';
      else els.newRemoteTemplateSelect.value = 'empty';
    };
    els.newRemoteTypeSelector.appendChild(btn);
  });
}

els.openNewRemoteModalBtn.onclick = openNewRemoteModal;
els.emptyNewRemoteBtn.onclick = openNewRemoteModal;
els.bottomAddPlaceBtn.onclick = openNewRemoteModal;
els.newRemoteModalClose.onclick = closeNewRemoteModal;
els.newRemoteCancelBtn.onclick = closeNewRemoteModal;
els.newRemoteModalBackdrop.onclick = (e) => {
  if (e.target === els.newRemoteModalBackdrop) closeNewRemoteModal();
};

els.newRemoteCreateBtn.onclick = async () => {
  const name = els.newRemoteNameInput.value.trim() || 'AC Remote';
  const icon = state.selectedNewRemoteType;
  const template = els.newRemoteTemplateSelect.value;

  let initialButtons = [];
  if (template === 'ac') {
    initialButtons = [
      { id: genId(), label: 'Power', icon: 'power', color: 'red', signal: null },
      { id: genId(), label: 'Temp +', icon: 'thermometer', color: 'cyan', signal: null },
      { id: genId(), label: 'Temp -', icon: 'thermometer', color: 'cyan', signal: null },
      { id: genId(), label: 'Fan Speed', icon: 'fan', color: null, signal: null },
      { id: genId(), label: 'Mode', icon: 'refresh', color: null, signal: null },
      { id: genId(), label: 'Swing', icon: 'wind', color: null, signal: null },
    ];
  } else if (template === 'tv') {
    initialButtons = [
      { id: genId(), label: 'Power', icon: 'power', color: 'red', signal: null },
      { id: genId(), label: 'Vol +', icon: 'volume-up', color: null, signal: null },
      { id: genId(), label: 'Vol -', icon: 'volume-down', color: null, signal: null },
      { id: genId(), label: 'Mute', icon: 'volume-mute', color: null, signal: null },
      { id: genId(), label: 'Ch +', icon: 'chevron-up', color: null, signal: null },
      { id: genId(), label: 'Ch -', icon: 'chevron-down', color: null, signal: null },
      { id: genId(), label: 'Input', icon: 'refresh', color: null, signal: null },
    ];
  }

  try {
    const remote = await saveRemote({ name, icon, buttons: initialButtons });
    state.remotes.push(remote);
    state.expandedPlaceIds.add(remote.id);
    renderPlacesAccordion();
    closeNewRemoteModal();
    toast(`Created place "${remote.name}"`, 'ok');

    const el = document.getElementById(`place-item-${remote.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    toast(`Could not create place: ${e.message}`, 'error');
  }
};

els.expandAllBtn.onclick = () => {
  state.remotes.forEach(r => state.expandedPlaceIds.add(r.id));
  renderPlacesAccordion();
};

els.collapseAllBtn.onclick = () => {
  state.expandedPlaceIds.clear();
  renderPlacesAccordion();
};

// ==================== AUTOMATION: ROUTINES ====================
function describeSteps(steps) {
  const labels = (steps || []).map((s) => {
    const remote = state.remotes.find((r) => r.id === s.remoteId);
    const button = remote && (remote.buttons || []).find((b) => b.id === s.buttonId);
    const buttonName = button ? button.label : '?';
    const remoteName = remote ? remote.name : '?';
    return `${remoteName}:${buttonName}`;
  });
  return labels.length > 3 ? labels.slice(0, 3).join(' ➔ ') + ' ➔ ...' : labels.join(' ➔ ');
}

function renderRoutinesList() {
  updateNavBadges();
  els.routinesList.innerHTML = '';

  if (state.routines.length === 0) {
    els.routinesList.innerHTML = `
      <div class="surface-card rounded-2xl p-8 border border-[var(--border)] text-center max-w-md mx-auto my-6">
        <div class="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        </div>
        <h3 class="text-sm font-bold text-white mb-1">No Automation Routines Yet</h3>
        <p class="text-xs text-[var(--text-dim)] mb-4">Chain multiple button presses with custom delays to control ACs, TV setups, and room environments with a single click.</p>
        <button id="emptyNewRoutineBtn" class="btn-primary text-xs font-semibold">+ Create First Routine</button>
      </div>
    `;
    document.getElementById('emptyNewRoutineBtn').onclick = () => openRoutineModal(null);
    return;
  }

  state.routines.forEach((routine) => {
    const card = document.createElement('div');
    card.className = 'automation-card flex flex-col sm:flex-row sm:items-center justify-between gap-3.5';

    const info = document.createElement('div');
    info.className = 'min-w-0';
    info.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        </div>
        <span class="text-base font-bold text-white tracking-wide truncate">${escapeHtml(routine.name)}</span>
        <span class="text-[10px] mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">${routine.steps.length} steps</span>
      </div>
      <p class="text-xs text-[var(--text-muted)] mono mt-1.5 pl-8">
        ${escapeHtml(describeSteps(routine.steps))}
      </p>
    `;

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2 shrink-0 self-end sm:self-center';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn-run text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-md shadow-emerald-500/20';
    runBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      <span>Run</span>
    `;
    runBtn.onclick = () => runRoutineNow(routine);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary text-xs px-3 py-1.5 rounded-xl';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openRoutineModal(routine);

    actions.appendChild(runBtn);
    actions.appendChild(editBtn);
    card.appendChild(info);
    card.appendChild(actions);
    els.routinesList.appendChild(card);
  });
}

async function runRoutineNow(routine) {
  flashWaveformTransmit();
  try {
    await runRoutine(routine.id);
    toast(`Executed routine "${routine.name}"`, 'ok');
  } catch (e) {
    toast(`Routine execution failed: ${e.message}`, 'error');
  }
}

function openRoutineModal(routine) {
  state.editingRoutineId = routine ? routine.id : null;
  state.routineDraftSteps = routine ? routine.steps.map((s) => ({ ...s })) : [];

  els.routineModalTitle.innerHTML = `<span>${routine ? `Edit "${escapeHtml(routine.name)}"` : 'Create Automation Routine'}</span>`;
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
    els.routineStepsList.innerHTML = '<p class="text-xs text-slate-400 mono p-2 text-center">No steps added yet</p>';
    return;
  }

  state.routineDraftSteps.forEach((step, i) => {
    const remote = state.remotes.find((r) => r.id === step.remoteId);
    const button = remote && (remote.buttons || []).find((b) => b.id === step.buttonId);

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 bg-[#0d1627] rounded-xl px-3 py-2 text-xs border border-[var(--border)]';

    const label = document.createElement('span');
    label.className = 'mono truncate text-slate-200';
    label.innerHTML = `
      <span class="text-blue-400 font-bold">${i + 1}.</span> 
      <span class="font-semibold text-white">${remote ? escapeHtml(remote.name) : '?'}</span> 
      <span class="text-slate-400">/</span> 
      <span class="font-bold text-emerald-400">${button ? escapeHtml(button.label) : '?'}</span>
      ${step.delayMs ? `<span class="text-amber-300 font-medium ml-1.5">(+${step.delayMs}ms delay)</span>` : ''}
    `;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger px-2 py-0.5 text-[10px] shrink-0 font-bold';
    removeBtn.textContent = 'Remove';
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
    toast('Create a place with buttons first', 'error');
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
    toast(`Saved routine "${saved.name}"`, 'ok');
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
    toast(`Deleted routine "${routine.name}"`, 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.routineModalClose.onclick = closeRoutineModal;
els.routineCancelBtn.onclick = closeRoutineModal;
els.routineModalBackdrop.onclick = (e) => {
  if (e.target === els.routineModalBackdrop) closeRoutineModal();
};

// ==================== AUTOMATION: PRICE RULES ====================
function describeAction(action) {
  if (!action) return 'no action';
  if (action.type === 'routine') {
    const routine = state.routines.find((r) => r.id === action.routineId);
    return `routine "${routine ? routine.name : action.routineId}"`;
  }
  const remote = state.remotes.find((r) => r.id === action.remoteId);
  const button = remote && (remote.buttons || []).find((b) => b.id === action.buttonId);
  return button ? `${remote.name} / ${button.label}` : 'missing button';
}

function renderRulesList() {
  updateNavBadges();
  els.rulesList.innerHTML = '';

  if (state.rules.length === 0) {
    els.rulesList.innerHTML = `
      <div class="surface-card rounded-2xl p-8 border border-[var(--border)] text-center max-w-md mx-auto my-6">
        <div class="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="1" x2="12" y2="23"></line>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
        </div>
        <h3 class="text-sm font-bold text-white mb-1">No Price Rules Configured</h3>
        <p class="text-xs text-[var(--text-dim)] mb-4">Set up smart price thresholds to automatically turn on cooling during cheap hours or turn down heating when spot electricity spikes.</p>
        <button id="emptyNewRuleBtn" class="btn-primary text-xs font-semibold">+ Create First Price Rule</button>
      </div>
    `;
    document.getElementById('emptyNewRuleBtn').onclick = () => openRuleModal(null);
    return;
  }

  state.rules.forEach((rule) => {
    const card = document.createElement('div');
    card.className = 'automation-card flex flex-col sm:flex-row sm:items-center justify-between gap-3.5';

    const info = document.createElement('div');
    info.className = 'min-w-0';
    info.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-md bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
        </div>
        <span class="text-base font-bold text-white tracking-wide truncate">${escapeHtml(rule.name)}</span>
        <span class="text-[10px] mono px-2 py-0.5 rounded-full font-semibold ${
          rule.enabled
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-slate-800 text-slate-400 border border-slate-700'
        }">${rule.enabled ? 'ACTIVE' : 'PAUSED'}</span>
      </div>
      <p class="text-xs text-[var(--text-muted)] mono mt-1.5 pl-8">
        When price is <span class="text-amber-300 font-bold">${escapeHtml(rule.condition)} ${rule.thresholdCents} c/kWh</span> &rarr; Run <span class="text-blue-300 font-bold">${escapeHtml(describeAction(rule.action))}</span>
      </p>
    `;

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2 shrink-0 self-end sm:self-center';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = `text-xs px-3 py-1.5 rounded-xl font-semibold mono ${rule.enabled ? 'btn-secondary' : 'btn-primary'}`;
    toggleBtn.textContent = rule.enabled ? 'Pause' : 'Enable';
    toggleBtn.onclick = () => toggleRule(rule);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary text-xs px-3 py-1.5 rounded-xl';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openRuleModal(rule);

    actions.appendChild(toggleBtn);
    actions.appendChild(editBtn);
    card.appendChild(info);
    card.appendChild(actions);
    els.rulesList.appendChild(card);
  });
}

async function toggleRule(rule) {
  try {
    const saved = await saveRule({ ...rule, enabled: !rule.enabled });
    Object.assign(rule, saved);
    renderRulesList();
    toast(`Rule is now ${rule.enabled ? 'enabled' : 'paused'}`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
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
      : 'live spot';
  } catch (e) {
    els.currentPriceValue.textContent = '--';
    els.currentPriceUpdated.textContent = 'price unavailable';
  }
}

function openRuleModal(rule) {
  state.editingRuleId = rule ? rule.id : null;

  els.ruleModalTitle.innerHTML = `<span>${rule ? `Edit "${escapeHtml(rule.name)}"` : 'Create Price Rule'}</span>`;
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
    toast('Create a place or a routine first', 'error');
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
  if (!Number.isFinite(thresholdCents)) { toast('Threshold must be a valid number', 'error'); return; }

  let action;
  if (els.ruleActionType.value === 'routine') {
    if (!els.ruleTargetRoutine.value) { toast('Pick a routine to trigger', 'error'); return; }
    action = { type: 'routine', routineId: els.ruleTargetRoutine.value };
  } else {
    if (!els.ruleTargetRemote.value || !els.ruleTargetButton.value) { toast('Pick a remote and a button to trigger', 'error'); return; }
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
    toast(`Saved price rule "${saved.name}"`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.ruleDeleteBtn.onclick = async () => {
  const id = state.editingRuleId;
  if (!id) return;
  const rule = state.rules.find((r) => r.id === id);
  if (!confirm(`Delete price rule "${rule ? rule.name : ''}"?`)) return;
  try {
    await deleteRule(id);
    state.rules = state.rules.filter((r) => r.id !== id);
    closeRuleModal();
    renderRulesList();
    toast(`Deleted rule "${rule.name}"`, 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
};

els.ruleModalClose.onclick = closeRuleModal;
els.ruleCancelBtn.onclick = closeRuleModal;
els.ruleModalBackdrop.onclick = (e) => {
  if (e.target === els.ruleModalBackdrop) closeRuleModal();
};

// ==================== SELECT POPULATORS ====================
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
  (remote.buttons || []).forEach((b) => {
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

// ==================== WEBSOCKET INTEGRATION ====================
function connectWs() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[ws] connected to IR Hub backend');

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
      case 'learn-result':
        onLearnResult(msg.payload);
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
  if (!state.learning) return;
  stopLearning();

  if (!payload.success) {
    toast(`Learn failed: ${payload.error || 'unknown error'}`, 'error');
    return;
  }

  const remote = state.remotes.find((r) => r.id === payload.remoteId);
  const button = remote && (remote.buttons || []).find((b) => b.id === payload.buttonId);

  if (button) {
    button.signal = payload.signal;
    if (state.modalCtx && state.modalCtx.button.id === button.id) {
      state.modalCtx.button.signal = payload.signal;
      updateModalSignalDisplay(payload.signal);
    }
    renderPlacesAccordion();
    toast(`Learned signal for "${button.label}" (${payload.signal.pulses.length} pulses)`, 'ok');
  }
}

// ==================== BOOTSTRAP ====================
async function boot() {
  buildWaveform();

  try {
    state.remotes = await getRemotes();
    const acRemote = state.remotes.find(r => (r.name || '').toLowerCase().includes('ac'));
    const defaultRemote = acRemote || state.remotes[0];
    if (defaultRemote) {
      state.expandedPlaceIds.add(defaultRemote.id);
    }
  } catch (e) {
    toast(`Could not reach backend: ${e.message}`, 'error');
  }

  try {
    state.routines = await getRoutines();
    state.rules = await getRules();
  } catch (e) {
    console.warn('Could not load automation routines/rules:', e);
  }

  showView('places');
  connectWs();

  refreshCurrentPrice();
  setInterval(refreshCurrentPrice, PRICE_POLL_MS);
}

boot();
