/**
 * main.js — 起動・初期化・イベント登録
 * モジュール間の統合とUIイベント処理
 */
import {
  getState, setState, saveToLocalStorage, loadFromLocalStorage, resetState,
  addSlot, removeSlot, updateSlot, addMasterRecord, updateMasterRecord, removeMasterRecord,
  undo, redo,
} from './store.js';
import { importCSV, exportMastersCSV, exportSlotsCSV } from './data.js';
import { validate } from './validator.js';
import { autoSchedule, optimizeExisting } from './scheduler.js';
import {
  populateEntityPicker, renderDashboard, renderTimetableGrid,
  renderMasterTable, showEditModal, showValidationResults,
  showProgress, showNotification,
} from './ui.js';

let currentPage = 'dashboard';
let viewMode = 'class';
let viewId = null;

// ─── 表示更新ヘルパー ───

function refresh() {
  const state = getState();
  const valResult = state.slots?.length > 0 ? validate(state) : { errors: [], warnings: [] };
  renderDashboard(state, valResult);
  // エンティティピッカーを常に最新に保つ
  const prevId = viewId;
  viewId = populateEntityPicker(state, viewMode);
  if (!viewId && prevId) viewId = null; // 削除された場合
  if (currentPage === 'timetable') {
    renderTimetableGrid(state, viewMode, viewId, {}, handleSlotMove, handleCellClick, handleCellEdit);
  }
  if (['teachers', 'classes', 'rooms', 'subjects'].includes(currentPage)) {
    const q = document.getElementById(`search-${currentPage}`)?.value || '';
    renderMasterTable(state, currentPage, q, handleEdit, handleDelete);
  }
}

function refreshTimetable(valMap) {
  renderTimetableGrid(getState(), viewMode, viewId, valMap || {}, handleSlotMove, handleCellClick, handleCellEdit);
}

function runValidation() {
  const { errors, warnings } = validate(getState());
  const map = showValidationResults(errors, warnings);
  refreshTimetable(map);
  return { errors, warnings };
}

// ─── スロット操作 ───

function handleSlotMove(from, to, slot) {
  removeSlot(from.day, from.period, slot.classId);
  addSlot({ ...slot, day: to.day, period: to.period });
  saveToLocalStorage();
  runValidation();
  showNotification('コマを移動しました', 'success');
}

function handleCellClick(day, period) {
  const state = getState();
  // マスタデータが未登録の場合はガイド表示
  if (!state.classes?.length || !state.subjects?.length) {
    showNotification('先にクラスと科目のマスタデータを登録してください', 'warning');
    return;
  }
  const defaults = {};
  if (viewMode === 'class') defaults.classId = viewId;
  else if (viewMode === 'teacher') defaults.teacherId = viewId;
  else if (viewMode === 'room') defaults.roomId = viewId;

  // ドロップダウン選択肢を生成
  const classOpts = (state.classes || []).map(c => ({ value: c.id, label: c.name }));
  const subjectOpts = (state.subjects || []).map(s => ({ value: s.id, label: s.name }));
  const teacherOpts = (state.teachers || []).map(t => ({ value: t.id, label: t.name }));
  const roomOpts = (state.rooms || []).map(r => ({ value: r.id, label: `${r.name} (${r.type})` }));
  const typeOpts = [
    { value: 'single', label: '単独授業' }, { value: 'elective', label: '選択授業' },
    { value: 'course', label: 'コース別' }, { value: 'team_teaching', label: 'TT授業' },
    { value: 'double', label: '時間続き' }, { value: 'fixed', label: '固定コマ' },
  ];

  const fields = [
    { key: 'classId', label: 'クラス', options: classOpts },
    { key: 'subjectId', label: '科目', options: subjectOpts },
    { key: 'teacherId', label: '教員', options: teacherOpts },
    { key: 'roomId', label: '教室', options: roomOpts },
    { key: 'slotType', label: 'コマ種別', options: typeOpts },
  ];
  showEditModal(`コマを追加 (${['月','火','水','木','金'][day]}曜 ${period+1}限)`, fields, {
    ...defaults, slotType: 'single',
  }, data => {
    if (!data.classId || !data.subjectId) {
      showNotification('クラスと科目は必須です', 'warning');
      return;
    }
    addSlot({ day, period, ...data, slotType: data.slotType || 'single' });
    saveToLocalStorage();
    refreshTimetable();
    showNotification('コマを追加しました', 'success');
  });
}

/** コマ入りセルクリック → 編集/削除モーダル */
function handleCellEdit(day, period, slot) {
  const state = getState();
  const dayName = ['月','火','水','木','金'][day];
  const subjectOpts = (state.subjects || []).map(s => ({ value: s.id, label: s.name }));
  const teacherOpts = (state.teachers || []).map(t => ({ value: t.id, label: t.name }));
  const roomOpts = (state.rooms || []).map(r => ({ value: r.id, label: `${r.name} (${r.type})` }));
  const typeOpts = [
    { value: 'single', label: '単独授業' }, { value: 'elective', label: '選択授業' },
    { value: 'course', label: 'コース別' }, { value: 'team_teaching', label: 'TT授業' },
    { value: 'double', label: '時間続き' }, { value: 'fixed', label: '固定コマ' },
  ];

  const fields = [
    { key: 'subjectId', label: '科目', options: subjectOpts },
    { key: 'teacherId', label: '教員', options: teacherOpts },
    { key: 'roomId', label: '教室', options: roomOpts },
    { key: 'slotType', label: 'コマ種別', options: typeOpts },
  ];

  showEditModal(`コマ編集 (${dayName}曜 ${period+1}限)`, fields, slot, data => {
    updateSlot(day, period, slot.classId, {
      subjectId: data.subjectId || slot.subjectId,
      teacherId: data.teacherId || slot.teacherId,
      roomId: data.roomId || slot.roomId,
      slotType: data.slotType || slot.slotType,
    });
    saveToLocalStorage();
    refreshTimetable();
    showNotification('コマを更新しました', 'success');
  });

  // 削除ボタンをモーダル下部に追加
  setTimeout(() => {
    const body = document.getElementById('modal-body');
    if (!body) return;
    const delBtn = document.createElement('button');
    delBtn.className = 'w-full mt-3 text-xs px-3 py-2 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors';
    delBtn.textContent = 'このコマを削除';
    delBtn.addEventListener('click', () => {
      removeSlot(day, period, slot.classId);
      saveToLocalStorage();
      refreshTimetable();
      document.getElementById('modal-overlay')?.classList.add('hidden');
      showNotification('コマを削除しました', 'info');
    });
    body.appendChild(delBtn);
  }, 0);
}

// ─── マスターデータ操作 ───

function getEditFields(type) {
  const defs = {
    teachers: [
      { key: 'name', label: '氏名', placeholder: '山田太郎' },
      { key: 'subjects', label: '担当科目ID（カンマ区切り）', placeholder: 's01,s02' },
      { key: 'availableDays', label: '出勤曜日（0=月〜4=金）', placeholder: '0,1,2,3,4' },
      { key: 'maxPeriodsPerDay', label: '最大コマ数/日', type: 'number', placeholder: '5' },
      { key: 'maxConsecutive', label: '最大連続コマ数', type: 'number', placeholder: '3' },
      { key: 'isPartTime', label: '非常勤 (true/false)', placeholder: 'false' },
    ],
    classes: [
      { key: 'name', label: 'クラス名', placeholder: '1年1組' },
      { key: 'grade', label: '学年', type: 'number', placeholder: '1' },
      { key: 'course', label: 'コース', placeholder: '普通' },
    ],
    rooms: [
      { key: 'name', label: '教室名', placeholder: '1-1教室' },
      { key: 'type', label: '種別', placeholder: '普通教室' },
      { key: 'capacity', label: '定員', type: 'number', placeholder: '40' },
    ],
    subjects: [
      { key: 'name', label: '科目名', placeholder: '数学Ⅱ' },
      { key: 'hoursPerWeek', label: '週時数', type: 'number', placeholder: '4' },
      { key: 'requiresSpecialRoom', label: '特別教室 (true/false)', placeholder: 'false' },
    ],
  };
  return defs[type] || [];
}

function parseFormData(type, data) {
  if (type === 'teachers') return {
    ...data,
    subjects: data.subjects ? data.subjects.split(',').map(s => s.trim()).filter(Boolean) : [],
    availableDays: data.availableDays ? data.availableDays.split(',').map(Number) : [],
    maxPeriodsPerDay: Number(data.maxPeriodsPerDay) || 5,
    maxConsecutive: Number(data.maxConsecutive) || 3,
    isPartTime: data.isPartTime === 'true',
  };
  if (type === 'classes') return { ...data, grade: Number(data.grade) || 1 };
  if (type === 'rooms') return { ...data, capacity: Number(data.capacity) || 40 };
  if (type === 'subjects') return {
    ...data,
    hoursPerWeek: Number(data.hoursPerWeek) || 1,
    requiresSpecialRoom: data.requiresSpecialRoom === 'true',
  };
  return data;
}

function handleEdit(type, id) {
  const rec = (getState()[type] || []).find(r => r.id === id);
  if (!rec) return;
  const labels = { teachers: '教員', classes: 'クラス', rooms: '教室', subjects: '科目' };
  showEditModal(`${labels[type]}を編集`, getEditFields(type), rec, data => {
    updateMasterRecord(type, id, parseFormData(type, data));
    saveToLocalStorage(); refresh();
    showNotification('更新しました', 'success');
  });
}

function handleDelete(type, id) {
  // 孤立スロットの警告チェック
  const state = getState();
  const keyMap = { teachers: 'teacherId', classes: 'classId', rooms: 'roomId', subjects: 'subjectId' };
  const slotKey = keyMap[type];
  if (slotKey) {
    const orphanCount = (state.slots || []).filter(s => s[slotKey] === id).length;
    if (orphanCount > 0) {
      if (!confirm(`この${type === 'teachers' ? '教員' : type === 'classes' ? 'クラス' : type === 'rooms' ? '教室' : '科目'}を参照している時間割コマが${orphanCount}件あります。削除すると参照が壊れます。続行しますか？`)) return;
    }
  }
  removeMasterRecord(type, id);
  saveToLocalStorage(); refresh();
  showNotification('削除しました', 'info');
}

function handleAdd(type) {
  const labels = { teachers: '教員', classes: 'クラス', rooms: '教室', subjects: '科目' };
  showEditModal(`${labels[type]}を追加`, getEditFields(type), {}, data => {
    addMasterRecord(type, parseFormData(type, data));
    saveToLocalStorage(); refresh();
    showNotification('追加しました', 'success');
  });
}

// ─── CSV ───

function detectCSVType(name) {
  const n = name.toLowerCase();
  if (n.includes('teacher') || n.includes('教員')) return 'teachers';
  if (n.includes('class') || n.includes('クラス')) return 'classes';
  if (n.includes('room') || n.includes('教室')) return 'rooms';
  if (n.includes('subject') || n.includes('科目')) return 'subjects';
  if (n.includes('slot') || n.includes('時間割')) return 'slots';
  return null;
}

async function loadSampleData() {
  const files = [
    { path: 'data/teachers.csv', type: 'teachers' },
    { path: 'data/classes.csv', type: 'classes' },
    { path: 'data/rooms.csv', type: 'rooms' },
    { path: 'data/subjects.csv', type: 'subjects' },
    { path: 'data/slots.csv', type: 'slots' },
  ];
  let state = getState();
  for (const f of files) {
    try {
      const res = await fetch(f.path);
      if (!res.ok) continue;
      const text = await res.text();
      state = importCSV(text, f.type, state);
    } catch { /* サンプルファイルがない場合はスキップ */ }
  }
  setState(state);
  saveToLocalStorage();
  refresh();
  viewId = populateEntityPicker(getState(), viewMode);
  showNotification('サンプルデータを読み込みました', 'success');
}

// ─── ページナビゲーション ───

function navigateTo(page) {
  currentPage = page;
  // ページ切り替え
  document.querySelectorAll('[id^="page-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');
  // ナビゲーション状態
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  // タイトル更新
  const titles = {
    dashboard: 'ダッシュボード', timetable: '時間割',
    teachers: '教員管理', classes: 'クラス管理', rooms: '教室管理', subjects: '科目管理',
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[page] || page;
  // コンテンツ描画
  refresh();
  // モバイルサイドバーを閉じる
  closeSidebar();
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
}

// ─── 初期化 ───

document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();

  // サイドバーナビゲーション
  document.getElementById('sidebar-nav')?.addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    navigateTo(btn.dataset.page);
  });

  // モバイルサイドバー
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('-translate-x-full');
    document.getElementById('sidebar-overlay')?.classList.remove('hidden');
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

  // ビュータブ
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      viewMode = tab.dataset.view;
      viewId = populateEntityPicker(getState(), viewMode);
      refreshTimetable();
    });
  });

  // エンティティ選択
  document.getElementById('entity-picker')?.addEventListener('change', e => {
    viewId = e.target.value;
    refreshTimetable();
  });

  // ツールバーボタン
  document.getElementById('btn-auto-place')?.addEventListener('click', async () => {
    showNotification('自動配置を開始...', 'info');
    try {
      const result = await autoSchedule(getState(), { onProgress: showProgress });
      setState(result); saveToLocalStorage(); refreshTimetable();
      showNotification('自動配置完了', 'success');
    } catch (e) { showNotification('自動配置失敗: ' + e.message, 'error'); }
  });

  document.getElementById('btn-optimize')?.addEventListener('click', async () => {
    showNotification('最適化を開始...', 'info');
    try {
      const result = await optimizeExisting(getState(), { onProgress: showProgress });
      setState(result); saveToLocalStorage(); refreshTimetable();
      showNotification('最適化完了', 'success');
    } catch (e) { showNotification('最適化失敗: ' + e.message, 'error'); }
  });

  document.getElementById('btn-validate')?.addEventListener('click', () => {
    const { errors, warnings } = runValidation();
    const total = errors.length + warnings.length;
    showNotification(total === 0 ? '制約違反なし' : `エラー ${errors.length}件 / 警告 ${warnings.length}件`,
      total === 0 ? 'success' : 'warning');
  });

  document.getElementById('btn-print')?.addEventListener('click', () => window.print());

  document.getElementById('btn-save')?.addEventListener('click', () => {
    saveToLocalStorage();
    showNotification('保存しました', 'success');
  });

  document.getElementById('btn-csv-import')?.addEventListener('click', () => {
    document.getElementById('csv-file-input')?.click();
  });
  document.getElementById('csv-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const type = detectCSVType(file.name);
    if (!type) { showNotification('ファイル名から種別を判別できません', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const ns = importCSV(ev.target.result, type, getState());
        setState(ns); saveToLocalStorage();
        viewId = populateEntityPicker(getState(), viewMode);
        refresh();
        showNotification(`${file.name} をインポートしました`, 'success');
      } catch (err) { showNotification('インポート失敗: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btn-csv-export')?.addEventListener('click', () => {
    const items = [
      { key: 'all', label: '全データ（一括）' },
      { key: 'teachers', label: '教員マスタ' },
      { key: 'classes', label: 'クラスマスタ' },
      { key: 'rooms', label: '教室マスタ' },
      { key: 'subjects', label: '科目マスタ' },
      { key: 'slots', label: '時間割データ' },
    ];
    showEditModal('CSVエクスポート', [
      { key: 'target', label: 'エクスポート対象', options: items.map(i => ({ value: i.key, label: i.label })) },
    ], { target: 'all' }, data => {
      const state = getState();
      if (data.target === 'all' || !data.target) {
        exportMastersCSV(state, 'teachers');
        setTimeout(() => exportMastersCSV(state, 'classes'), 200);
        setTimeout(() => exportMastersCSV(state, 'rooms'), 400);
        setTimeout(() => exportMastersCSV(state, 'subjects'), 600);
        setTimeout(() => exportSlotsCSV(state), 800);
      } else if (data.target === 'slots') {
        exportSlotsCSV(state);
      } else {
        exportMastersCSV(state, data.target);
      }
      showNotification('CSVを出力しました', 'success');
    });
  });

  // マスターデータ追加ボタン
  document.getElementById('btn-add-teacher')?.addEventListener('click', () => handleAdd('teachers'));
  document.getElementById('btn-add-class')?.addEventListener('click', () => handleAdd('classes'));
  document.getElementById('btn-add-room')?.addEventListener('click', () => handleAdd('rooms'));
  document.getElementById('btn-add-subject')?.addEventListener('click', () => handleAdd('subjects'));

  // 検索
  for (const type of ['teachers', 'classes', 'rooms', 'subjects']) {
    document.getElementById(`search-${type}`)?.addEventListener('input', () => refresh());
  }

  // ダッシュボード: サンプルデータ読み込み
  document.getElementById('btn-load-sample')?.addEventListener('click', loadSampleData);
  document.getElementById('btn-go-timetable')?.addEventListener('click', () => navigateTo('timetable'));
  document.getElementById('btn-reset-data')?.addEventListener('click', () => {
    if (!confirm('すべてのデータを削除します。よろしいですか？')) return;
    resetState();
    viewId = null;
    refresh();
    showNotification('データをリセットしました', 'info');
  });

  // キーボードショートカット
  document.addEventListener('keydown', e => {
    // モーダル表示中は無視（Esc以外）
    if (!document.getElementById('modal-overlay')?.classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') { e.preventDefault(); saveToLocalStorage(); showNotification('保存しました', 'success'); }
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (undo()) { saveToLocalStorage(); refresh(); showNotification('元に戻しました', 'info'); } }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); if (redo()) { saveToLocalStorage(); refresh(); showNotification('やり直しました', 'info'); } }
      if (e.key === 'y') { e.preventDefault(); if (redo()) { saveToLocalStorage(); refresh(); showNotification('やり直しました', 'info'); } }
    }
    // 数字キーでページ切り替え
    if (!e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
      const pages = { '1': 'dashboard', '2': 'timetable', '3': 'teachers', '4': 'classes', '5': 'rooms', '6': 'subjects' };
      if (pages[e.key]) navigateTo(pages[e.key]);
    }
  });

  // 初期描画
  viewId = populateEntityPicker(getState(), viewMode);
  navigateTo('dashboard');
});
