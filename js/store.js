/**
 * store.js — 時間割システムの状態管理モジュール
 * localStorage永続化 + Undo/Redo履歴機能付き
 */

const STORAGE_KEY = 'timetable_v1_state';
const MAX_HISTORY = 50; // 履歴の最大保持数

/** 初期状態を生成する */
function createInitialState() {
  return {
    teachers: [],
    classes: [],
    rooms: [],
    subjects: [],
    slots: [],
    meta: {
      schoolName: '',
      periodsPerDay: 6,
      workingDays: [0, 1, 2, 3, 4],
    },
  };
}

/** 現在の状態 */
let state = createInitialState();

/** Undo/Redo 履歴 */
const undoStack = [];
const redoStack = [];

/** 現在の状態のスナップショットをundoスタックに保存 */
function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // 新しい操作が入ったらredoをクリア
}

// ─── 基本操作 ───

export function getState() {
  return structuredClone(state);
}

export function setState(newState) {
  pushUndo();
  state = structuredClone(newState);
}

export function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('localStorageへの保存に失敗しました:', e);
  }
}

export function loadFromLocalStorage() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return false;
    const loaded = JSON.parse(json);
    const initial = createInitialState();
    state = { ...initial, ...loaded, meta: { ...initial.meta, ...(loaded.meta || {}) } };
    undoStack.length = 0;
    redoStack.length = 0;
    return true;
  } catch (e) {
    console.error('localStorageからの読み込みに失敗しました:', e);
    return false;
  }
}

export function resetState() {
  pushUndo();
  state = createInitialState();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Undo / Redo ───

export function undo() {
  if (undoStack.length === 0) return false;
  redoStack.push(JSON.stringify(state));
  state = JSON.parse(undoStack.pop());
  return true;
}

export function redo() {
  if (redoStack.length === 0) return false;
  undoStack.push(JSON.stringify(state));
  state = JSON.parse(redoStack.pop());
  return true;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// ─── コマ操作 ───

export function updateSlot(day, period, classId, updates) {
  pushUndo();
  const idx = state.slots.findIndex(s => s.day === day && s.period === period && s.classId === classId);
  if (idx === -1) return;
  state.slots[idx] = { ...state.slots[idx], ...updates };
}

export function addSlot(slot) {
  pushUndo();
  state.slots.push({ ...slot });
}

export function removeSlot(day, period, classId) {
  pushUndo();
  state.slots = state.slots.filter(s => !(s.day === day && s.period === period && s.classId === classId));
}

// ─── マスターデータ操作 ───

export function addMasterRecord(type, record) {
  if (!Array.isArray(state[type])) return null;
  pushUndo();
  const newRecord = { ...record, id: record.id || crypto.randomUUID() };
  state[type].push(newRecord);
  return structuredClone(newRecord);
}

export function updateMasterRecord(type, id, updates) {
  if (!Array.isArray(state[type])) return;
  const idx = state[type].findIndex(r => r.id === id);
  if (idx === -1) return;
  pushUndo();
  const { id: _discarded, ...safeUpdates } = updates;
  state[type][idx] = { ...state[type][idx], ...safeUpdates };
}

export function removeMasterRecord(type, id) {
  if (!Array.isArray(state[type])) return;
  pushUndo();
  state[type] = state[type].filter(r => r.id !== id);
}
