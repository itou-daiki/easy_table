/**
 * ui.js — 時間割システムのDOM操作・ドラッグ＆ドロップモジュール
 * すべてのDOM操作をこのモジュールに集約する
 */

const DAYS = ['月', '火', '水', '木', '金'];
const PERIODS = ['1限', '2限', '3限', '4限', '5限', '6限'];
const VIEW_MODES = [
  { id: 'class', label: 'クラス別' },
  { id: 'teacher', label: '教員別' },
  { id: 'room', label: '教室別' },
];
const MASTER_TYPES = [
  { id: 'teachers', label: '教員', fields: ['name', 'subjects'] },
  { id: 'classes', label: 'クラス', fields: ['name', 'grade', 'section'] },
  { id: 'rooms', label: '教室', fields: ['name', 'capacity'] },
  { id: 'subjects', label: '科目', fields: ['name', 'weeklyHours'] },
];

/** コールバック群（initUIで設定） */
let cb = {};
/** 現在の表示状態 */
let currentView = { mode: 'class', id: null };
/** ドラッグ中のデータ */
let dragData = null;

// ─── ユーティリティ ───

/** 要素を生成する */
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'textContent') e.textContent = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

/** マスター配列からIDで名前を引く */
function nameById(list, id) {
  const r = list.find(x => x.id === id);
  return r ? r.name : '?';
}

// ─── UI初期化 ───

/**
 * UI全体を初期化する
 * @param {object} state - 現在の状態
 * @param {object} callbacks - コールバック群
 */
export function initUI(state, callbacks) {
  cb = callbacks;
  const root = document.getElementById('app') || document.body;
  root.innerHTML = '';
  root.appendChild(buildToolbar());
  root.appendChild(buildViewSelector(state));
  root.appendChild(el('div', { id: 'timetable-container' }));
  root.appendChild(buildMasterSection(state));
  root.appendChild(el('div', { id: 'validation-panel', className: 'validation-panel' }));
  root.appendChild(el('div', { id: 'progress-bar', className: 'progress-bar hidden' }));
  root.appendChild(el('div', { id: 'notification-area', className: 'notification-area' }));
  root.appendChild(buildModal());
  // 初期ビューのIDを設定
  setDefaultViewId(state);
  renderTimetable(state, currentView.mode, currentView.id);
}

/** ツールバーを構築 */
function buildToolbar() {
  const bar = el('div', { className: 'toolbar' });
  const buttons = [
    { label: '自動配置', action: () => cb.onAutoSchedule?.() },
    { label: '最適化', action: () => cb.onOptimize?.() },
    { label: 'CSVインポート', action: () => triggerFileInput() },
    { label: 'CSVエクスポート', action: () => cb.onExport?.() },
    { label: '保存', action: () => cb.onSave?.() },
    { label: '制約チェック', action: () => cb.onAutoSchedule?.('validate') },
  ];
  for (const b of buttons) {
    const btn = el('button', { className: 'toolbar-btn', textContent: b.label });
    btn.addEventListener('click', b.action);
    bar.appendChild(btn);
  }
  // 非表示のファイル入力（CSVインポート用）
  const fileInput = el('input', { type: 'file', id: 'csv-file-input', accept: '.csv', className: 'hidden' });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) cb.onImport?.(e.target.files[0]);
    e.target.value = '';
  });
  bar.appendChild(fileInput);
  return bar;
}

/** ファイル選択ダイアログを開く */
function triggerFileInput() {
  document.getElementById('csv-file-input')?.click();
}

// ─── ビューセレクタ ───

/** ビュー切り替えUIを構築 */
function buildViewSelector(state) {
  const wrap = el('div', { className: 'view-selector' });
  // モード選択
  const modeSelect = el('select', { id: 'view-mode-select' });
  for (const m of VIEW_MODES) {
    modeSelect.appendChild(el('option', { value: m.id, textContent: m.label }));
  }
  modeSelect.addEventListener('change', () => {
    currentView.mode = modeSelect.value;
    updateIdSelector(state);
    cb.onViewChange?.(currentView.mode, currentView.id);
  });
  // ID選択
  const idSelect = el('select', { id: 'view-id-select' });
  idSelect.addEventListener('change', () => {
    currentView.id = idSelect.value;
    cb.onViewChange?.(currentView.mode, currentView.id);
  });
  wrap.appendChild(el('label', { textContent: '表示: ' }));
  wrap.appendChild(modeSelect);
  wrap.appendChild(idSelect);
  return wrap;
}

/** ビューID選択肢を更新 */
function updateIdSelector(state) {
  const sel = document.getElementById('view-id-select');
  if (!sel) return;
  sel.innerHTML = '';
  const listKey = currentView.mode === 'class' ? 'classes'
    : currentView.mode === 'teacher' ? 'teachers' : 'rooms';
  for (const item of state[listKey] || []) {
    sel.appendChild(el('option', { value: item.id, textContent: item.name }));
  }
  currentView.id = state[listKey]?.[0]?.id || null;
}

/** 初期ビューIDを設定 */
function setDefaultViewId(state) {
  updateIdSelector(state);
}

// ─── 時間割グリッド描画 ───

/**
 * 時間割グリッドを描画する
 * @param {object} state - 状態
 * @param {string} viewMode - 表示モード（'class'|'teacher'|'room'）
 * @param {string} viewId - 表示対象のID
 */
export function renderTimetable(state, viewMode, viewId) {
  currentView.mode = viewMode;
  currentView.id = viewId;
  const container = document.getElementById('timetable-container');
  if (!container) return;
  container.innerHTML = '';
  const table = el('table', { className: 'timetable-grid' });
  // ヘッダー行（曜日）
  const thead = el('thead');
  const headerRow = el('tr');
  headerRow.appendChild(el('th', { textContent: '' })); // 左上角
  for (const d of DAYS) headerRow.appendChild(el('th', { textContent: d }));
  thead.appendChild(headerRow);
  table.appendChild(thead);
  // 各時限の行
  const tbody = el('tbody');
  const slots = filterSlots(state, viewMode, viewId);
  for (let p = 0; p < PERIODS.length; p++) {
    const row = el('tr');
    row.appendChild(el('th', { textContent: PERIODS[p] }));
    for (let d = 0; d < DAYS.length; d++) {
      const slot = slots.find(s => s.day === d && s.period === p);
      const td = createCell(d, p, slot, state);
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

/** 表示モードに応じてコマを絞り込む */
function filterSlots(state, viewMode, viewId) {
  if (!viewId) return [];
  return state.slots.filter(s => {
    if (viewMode === 'class') return s.classId === viewId;
    if (viewMode === 'teacher') return s.teacherId === viewId;
    if (viewMode === 'room') return s.roomId === viewId;
    return false;
  });
}

/** 時間割セルを生成する */
function createCell(day, period, slot, state) {
  const td = el('td', {
    className: 'timetable-cell',
    'data-day': String(day),
    'data-period': String(period),
  });
  if (slot) {
    // コマ情報を表示
    td.setAttribute('draggable', 'true');
    td.classList.add('filled');
    if (slot.error) td.classList.add('error');
    if (slot.warning) td.classList.add('warning');
    const subj = el('div', { className: 'cell-subject', textContent: nameById(state.subjects, slot.subjectId) });
    const teacher = el('div', { className: 'cell-teacher', textContent: nameById(state.teachers, slot.teacherId) });
    const room = el('div', { className: 'cell-room', textContent: nameById(state.rooms, slot.roomId) });
    td.appendChild(subj);
    td.appendChild(teacher);
    td.appendChild(room);
    // ドラッグ開始
    td.addEventListener('dragstart', (e) => {
      dragData = { day, period, slot: structuredClone(slot) };
      e.dataTransfer.effectAllowed = 'move';
      td.classList.add('dragging');
      highlightCandidates(day, period, true);
    });
    td.addEventListener('dragend', () => {
      td.classList.remove('dragging');
      highlightCandidates(day, period, false);
      dragData = null;
    });
  } else {
    td.classList.add('empty');
  }
  // ドロップ対象
  td.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    td.classList.add('drag-over');
  });
  td.addEventListener('dragleave', () => td.classList.remove('drag-over'));
  td.addEventListener('drop', (e) => {
    e.preventDefault();
    td.classList.remove('drag-over');
    if (!dragData) return;
    const to = { day, period };
    const from = { day: dragData.day, period: dragData.period };
    cb.onSlotMove?.(from, to, dragData.slot);
    dragData = null;
  });
  return td;
}

/** 移動候補セルをハイライトする */
function highlightCandidates(fromDay, fromPeriod, show) {
  const cells = document.querySelectorAll('.timetable-cell.empty');
  for (const c of cells) {
    if (show) c.classList.add('candidate');
    else c.classList.remove('candidate');
  }
}

/**
 * 単一セルを更新する
 * @param {number} day - 曜日
 * @param {number} period - 時限
 * @param {object|null} slotData - コマデータ（nullで空にする）
 */
export function updateCell(day, period, slotData) {
  const td = document.querySelector(
    `.timetable-cell[data-day="${day}"][data-period="${period}"]`
  );
  if (!td) return;
  td.innerHTML = '';
  td.className = 'timetable-cell';
  if (slotData) {
    td.classList.add('filled');
    if (slotData.error) td.classList.add('error');
    if (slotData.warning) td.classList.add('warning');
    td.setAttribute('draggable', 'true');
    td.appendChild(el('div', { className: 'cell-subject', textContent: slotData.subjectName || '' }));
    td.appendChild(el('div', { className: 'cell-teacher', textContent: slotData.teacherName || '' }));
    td.appendChild(el('div', { className: 'cell-room', textContent: slotData.roomName || '' }));
  } else {
    td.classList.add('empty');
    td.removeAttribute('draggable');
  }
}

// ─── マスターデータ管理 ───

/** マスター管理セクション全体を構築 */
function buildMasterSection(state) {
  const section = el('div', { id: 'master-section', className: 'master-section' });
  // タブバー
  const tabBar = el('div', { className: 'master-tabs' });
  for (const mt of MASTER_TYPES) {
    const tab = el('button', {
      className: 'master-tab',
      textContent: mt.label,
      'data-type': mt.id,
    });
    tab.addEventListener('click', () => {
      document.querySelectorAll('.master-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderMasterTable(state, mt.id);
    });
    tabBar.appendChild(tab);
  }
  section.appendChild(tabBar);
  section.appendChild(el('div', { id: 'master-table-container' }));
  return section;
}

/**
 * マスターデータテーブルを描画する
 * @param {object} state - 状態
 * @param {string} type - データ種別
 */
export function renderMasterTable(state, type) {
  const container = document.getElementById('master-table-container');
  if (!container) return;
  container.innerHTML = '';
  const mt = MASTER_TYPES.find(m => m.id === type);
  if (!mt) return;
  const records = state[type] || [];
  // テーブル
  const table = el('table', { className: 'master-table' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const f of mt.fields) headRow.appendChild(el('th', { textContent: f }));
  headRow.appendChild(el('th', { textContent: '操作' }));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  // イベント委譲で編集・削除を処理
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('edit-btn')) openEditModal(state, type, id);
    if (btn.classList.contains('delete-btn')) {
      if (confirm('削除してもよろしいですか？')) cb.onMasterUpdate?.('delete', type, id);
    }
  });
  for (const rec of records) {
    const row = el('tr');
    for (const f of mt.fields) {
      const val = Array.isArray(rec[f]) ? rec[f].join(', ') : (rec[f] ?? '');
      row.appendChild(el('td', { textContent: String(val) }));
    }
    const actTd = el('td');
    actTd.appendChild(el('button', { className: 'edit-btn', 'data-id': rec.id, textContent: '編集' }));
    actTd.appendChild(el('button', { className: 'delete-btn', 'data-id': rec.id, textContent: '削除' }));
    row.appendChild(actTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  // 追加フォーム
  const form = el('form', { className: 'master-add-form' });
  for (const f of mt.fields) {
    form.appendChild(el('input', { name: f, placeholder: f, required: '' }));
  }
  const addBtn = el('button', { type: 'submit', textContent: '追加' });
  form.appendChild(addBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    for (const f of mt.fields) {
      const input = form.elements[f];
      data[f] = input.value.trim();
    }
    cb.onMasterUpdate?.('add', type, data);
    form.reset();
  });
  container.appendChild(form);
}

// ─── モーダル ───

/** モーダル要素を構築 */
function buildModal() {
  const overlay = el('div', { id: 'modal-overlay', className: 'modal-overlay hidden' });
  const dialog = el('div', { className: 'modal-dialog' });
  dialog.appendChild(el('h3', { id: 'modal-title' }));
  dialog.appendChild(el('form', { id: 'modal-form' }));
  const btnRow = el('div', { className: 'modal-buttons' });
  const saveBtn = el('button', { id: 'modal-save', textContent: '保存' });
  const cancelBtn = el('button', { id: 'modal-cancel', textContent: 'キャンセル' });
  cancelBtn.addEventListener('click', closeModal);
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  return overlay;
}

/** 編集モーダルを開く */
function openEditModal(state, type, id) {
  const mt = MASTER_TYPES.find(m => m.id === type);
  if (!mt) return;
  const record = (state[type] || []).find(r => r.id === id);
  if (!record) return;
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('modal-form');
  const saveBtn = document.getElementById('modal-save');
  title.textContent = `${mt.label}を編集`;
  form.innerHTML = '';
  for (const f of mt.fields) {
    const val = Array.isArray(record[f]) ? record[f].join(', ') : (record[f] ?? '');
    const label = el('label', { textContent: f });
    const input = el('input', { name: f, value: String(val) });
    form.appendChild(label);
    form.appendChild(input);
  }
  overlay.classList.remove('hidden');
  // 保存ボタン（イベントリスナーの重複を防ぐ）
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.addEventListener('click', (e) => {
    e.preventDefault();
    const data = {};
    for (const f of mt.fields) data[f] = form.elements[f].value.trim();
    cb.onMasterUpdate?.('update', type, id, data);
    closeModal();
  });
}

/** モーダルを閉じる */
function closeModal() {
  document.getElementById('modal-overlay')?.classList.add('hidden');
}

// ─── バリデーション結果表示 ───

/**
 * 制約チェック結果を表示する
 * @param {Array} results - {type:'error'|'warning', message:string, day?:number, period?:number}
 */
export function showValidationResults(results) {
  const panel = document.getElementById('validation-panel');
  if (!panel) return;
  panel.innerHTML = '';
  if (!results || results.length === 0) {
    panel.appendChild(el('p', { className: 'validation-ok', textContent: '制約違反はありません' }));
    return;
  }
  const list = el('ul', { className: 'validation-list' });
  for (const r of results) {
    const li = el('li', { className: `validation-${r.type}`, textContent: r.message });
    list.appendChild(li);
  }
  panel.appendChild(list);
  // 対応セルにエラー/警告クラスを付与
  document.querySelectorAll('.timetable-cell.error, .timetable-cell.warning').forEach(c => {
    c.classList.remove('error', 'warning');
  });
  for (const r of results) {
    if (r.day == null || r.period == null) continue;
    const cell = document.querySelector(
      `.timetable-cell[data-day="${r.day}"][data-period="${r.period}"]`
    );
    if (cell) cell.classList.add(r.type);
  }
}

// ─── 進捗表示 ───

/**
 * スケジューラの進捗を表示する
 * @param {number} percent - 進捗率（0〜100）
 * @param {string} message - 表示メッセージ
 */
export function showProgress(percent, message) {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.innerHTML = '';
  const track = el('div', { className: 'progress-track' });
  const fill = el('div', { className: 'progress-fill' });
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  track.appendChild(fill);
  bar.appendChild(track);
  bar.appendChild(el('span', { className: 'progress-text', textContent: `${message} (${Math.round(percent)}%)` }));
  if (percent >= 100) {
    setTimeout(() => bar.classList.add('hidden'), 1500);
  }
}

// ─── 通知 ───

/**
 * トースト通知を表示する
 * @param {string} message - メッセージ
 * @param {'success'|'error'|'warning'|'info'} type - 通知種別
 */
export function showNotification(message, type = 'info') {
  const area = document.getElementById('notification-area');
  if (!area) return;
  const toast = el('div', { className: `notification notification-${type}`, textContent: message });
  area.appendChild(toast);
  // 自動消去
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
