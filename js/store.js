/**
 * store.js — 時間割システムの状態管理モジュール
 * localStorageを使った永続化機能付き
 */

const STORAGE_KEY = 'timetable_v1_state';

/** 初期状態を生成する */
function createInitialState() {
  return {
    teachers: [],  // 教師一覧
    classes: [],   // クラス一覧
    rooms: [],     // 教室一覧
    subjects: [],  // 科目一覧
    slots: [],     // コマ割り一覧
    meta: {
      schoolName: '',        // 学校名
      periodsPerDay: 6,      // 1日あたりのコマ数
      workingDays: [0, 1, 2, 3, 4]  // 稼働日（月〜金）
    }
  };
}

/** 現在の状態（モジュールスコープ） */
let state = createInitialState();

/**
 * 現在の状態を取得する
 * @returns {object} 状態オブジェクトのディープコピー
 */
export function getState() {
  return structuredClone(state);
}

/**
 * 状態を上書きする
 * @param {object} newState - 新しい状態オブジェクト
 */
export function setState(newState) {
  state = structuredClone(newState);
}

/**
 * 状態をlocalStorageに保存する
 */
export function saveToLocalStorage() {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    console.error('localStorageへの保存に失敗しました:', e);
  }
}

/**
 * localStorageから状態を読み込む
 * @returns {boolean} 読み込みに成功したかどうか
 */
export function loadFromLocalStorage() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return false;
    const loaded = JSON.parse(json);
    // 初期状態とマージして欠落フィールドを補完する
    const initial = createInitialState();
    state = {
      ...initial,
      ...loaded,
      meta: { ...initial.meta, ...(loaded.meta || {}) }
    };
    return true;
  } catch (e) {
    console.error('localStorageからの読み込みに失敗しました:', e);
    return false;
  }
}

/**
 * 状態を初期値にリセットする
 */
export function resetState() {
  state = createInitialState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('localStorageのクリアに失敗しました:', e);
  }
}

/**
 * 特定のコマを更新する
 * @param {number} day - 曜日（0〜4）
 * @param {number} period - 時限（0〜5）
 * @param {string} classId - クラスID
 * @param {object} updates - 更新する項目
 */
export function updateSlot(day, period, classId, updates) {
  const idx = state.slots.findIndex(
    s => s.day === day && s.period === period && s.classId === classId
  );
  if (idx === -1) {
    console.warn('該当するコマが見つかりません:', { day, period, classId });
    return;
  }
  state.slots[idx] = { ...state.slots[idx], ...updates };
}

/**
 * コマを追加する
 * @param {object} slot - 追加するコマ情報
 */
export function addSlot(slot) {
  const newSlot = {
    ...slot,
    // IDが未設定の場合は自動生成しない（コマはday/period/classIdで一意）
  };
  state.slots.push(newSlot);
}

/**
 * コマを削除する
 * @param {number} day - 曜日（0〜4）
 * @param {number} period - 時限（0〜5）
 * @param {string} classId - クラスID
 */
export function removeSlot(day, period, classId) {
  state.slots = state.slots.filter(
    s => !(s.day === day && s.period === period && s.classId === classId)
  );
}

/**
 * マスターデータにレコードを追加する
 * @param {string} type - データ種別（'teachers'|'classes'|'rooms'|'subjects'）
 * @param {object} record - 追加するレコード（idは自動生成）
 * @returns {object} 追加されたレコード（id付き）
 */
export function addMasterRecord(type, record) {
  if (!state[type] || !Array.isArray(state[type])) {
    console.error('無効なデータ種別です:', type);
    return null;
  }
  const newRecord = {
    ...record,
    id: record.id || crypto.randomUUID()
  };
  state[type].push(newRecord);
  return structuredClone(newRecord);
}

/**
 * マスターデータのレコードを更新する
 * @param {string} type - データ種別
 * @param {string} id - 更新対象のID
 * @param {object} updates - 更新する項目
 */
export function updateMasterRecord(type, id, updates) {
  if (!state[type] || !Array.isArray(state[type])) {
    console.error('無効なデータ種別です:', type);
    return;
  }
  const idx = state[type].findIndex(r => r.id === id);
  if (idx === -1) {
    console.warn('該当するレコードが見つかりません:', { type, id });
    return;
  }
  // IDの上書きは許可しない
  const { id: _discarded, ...safeUpdates } = updates;
  state[type][idx] = { ...state[type][idx], ...safeUpdates };
}

/**
 * マスターデータからレコードを削除する
 * @param {string} type - データ種別
 * @param {string} id - 削除対象のID
 */
export function removeMasterRecord(type, id) {
  if (!state[type] || !Array.isArray(state[type])) {
    console.error('無効なデータ種別です:', type);
    return;
  }
  state[type] = state[type].filter(r => r.id !== id);
}
