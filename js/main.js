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
  renderMasterTable, renderCurriculumMap, showEditModal,
  showValidationResults, showProgress, showNotification,
} from './ui.js';

let currentPage = 'dashboard';
let viewMode = 'class';
let viewId = null;

// ─── 表示更新ヘルパー ───

function refresh() {
  const state = getState();
  const valResult = state.slots?.length > 0 ? validate(state) : { errors: [], warnings: [] };
  renderDashboard(state, valResult);
  // ナビバッジ更新
  for (const t of ['teachers', 'classes', 'rooms', 'subjects']) {
    const badge = document.getElementById(`nav-badge-${t}`);
    if (badge) badge.textContent = (state[t]?.length || 0) > 0 ? state[t].length : '';
  }
  // エンティティピッカーを常に最新に保つ
  const prevId = viewId;
  viewId = populateEntityPicker(state, viewMode);
  if (!viewId && prevId) viewId = null; // 削除された場合
  if (currentPage === 'timetable') {
    renderTimetableGrid(state, viewMode, viewId, {}, handleSlotMove, handleCellClick, handleCellEdit);
  }
  if (currentPage === 'curriculum') {
    renderCurriculumMap(state);
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
    // 教員-科目の整合性チェック
    if (data.teacherId) {
      const teacher = (state.teachers || []).find(t => t.id === data.teacherId);
      if (teacher && teacher.subjects?.length > 0 && !teacher.subjects.includes(data.subjectId)) {
        const tName = teacher.name;
        const sName = (state.subjects || []).find(s => s.id === data.subjectId)?.name || data.subjectId;
        if (!confirm(`${tName}は「${sName}」の担当ではありません。続行しますか？`)) return;
      }
    }
    // コース制限チェック
    const subj = (state.subjects || []).find(s => s.id === data.subjectId);
    const cls = (state.classes || []).find(c => c.id === data.classId);
    if (subj?.courseRestriction && cls?.course && cls.course !== '共通' && cls.course !== '文理混合') {
      if (subj.courseRestriction !== cls.course) {
        if (!confirm(`「${subj.name}」は${subj.courseRestriction}向け科目ですが、${cls.name}（${cls.course}）に配置します。続行しますか？`)) return;
      }
    }
    // 対象学年チェック
    if (subj?.targetGrades?.length > 0 && cls?.grade) {
      if (!subj.targetGrades.includes(cls.grade)) {
        if (!confirm(`「${subj.name}」の対象学年は${subj.targetGrades.join('・')}年ですが、${cls.name}（${cls.grade}年）に配置します。続行しますか？`)) return;
      }
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
  const state = getState();
  // 科目の選択肢を生成（教科でグループ化した表示名付き）
  const subjectOpts = (state.subjects || []).map(s => ({
    value: s.id, label: `${s.name}${s.department ? ` (${s.department})` : ''}`
  }));

  const defs = {
    teachers: [
      { key: 'name', label: '氏名', placeholder: '山田太郎' },
      { key: 'subjects', label: '担当科目', multi: true, options: subjectOpts },
      { key: 'availableDays', label: '出勤曜日', type: 'checkboxGroup', options: [
        {value:'0',label:'月'},{value:'1',label:'火'},{value:'2',label:'水'},
        {value:'3',label:'木'},{value:'4',label:'金'},
      ]},
      { key: 'maxPeriodsPerDay', label: '1日最大コマ数', type: 'number', placeholder: '5' },
      { key: 'maxConsecutive', label: '最大連続コマ数', type: 'number', placeholder: '3' },
      { key: 'isPartTime', label: '非常勤', type: 'toggle' },
    ],
    classes: [
      { key: 'name', label: 'クラス名', placeholder: '1年1組' },
      { key: 'grade', label: '学年', options: [
        {value:'1',label:'1年'},{value:'2',label:'2年'},{value:'3',label:'3年'},
      ]},
      { key: 'course', label: 'コース', options: [
        {value:'共通',label:'共通（1年など）'},
        {value:'文系',label:'文系'},{value:'理系',label:'理系'},
        {value:'文理混合',label:'文理混合'},
        {value:'特進',label:'特進'},{value:'普通',label:'普通'},
      ]},
    ],
    rooms: [
      { key: 'name', label: '教室名', placeholder: '1-1教室' },
      { key: 'type', label: '種別', options: [
        {value:'普通教室',label:'普通教室'},{value:'特別教室',label:'特別教室'},
        {value:'体育施設',label:'体育施設'},{value:'その他',label:'その他'},
      ]},
      { key: 'capacity', label: '定員', type: 'number', placeholder: '40' },
    ],
    subjects: [
      { key: 'name', label: '科目名', placeholder: '数学Ⅱ' },
      { key: 'department', label: '教科', options: [
        {value:'国語',label:'国語'},{value:'地理歴史',label:'地理歴史'},{value:'公民',label:'公民'},
        {value:'数学',label:'数学'},{value:'理科',label:'理科'},{value:'保健体育',label:'保健体育'},
        {value:'芸術',label:'芸術'},{value:'外国語',label:'外国語'},{value:'家庭',label:'家庭'},
        {value:'情報',label:'情報'},{value:'理数',label:'理数'},{value:'総合',label:'総合的な探究'},
        {value:'特別活動',label:'特別活動'},{value:'商業',label:'商業'},
      ]},
      { key: 'credits', label: '単位数', type: 'number', placeholder: '2' },
      { key: 'hoursPerWeek', label: '週時数', type: 'number', placeholder: '2' },
      { key: 'isRequired', label: '必履修科目', type: 'toggle' },
      { key: 'targetGrades', label: '対象学年', type: 'checkboxGroup', options: [
        {value:'1',label:'1年'},{value:'2',label:'2年'},{value:'3',label:'3年'},
      ]},
      { key: 'courseRestriction', label: 'コース制限', options: [
        {value:'',label:'共通（制限なし）'},
        {value:'文系',label:'文系のみ'},{value:'理系',label:'理系のみ'},
      ]},
      { key: 'requiresSpecialRoom', label: '特別教室が必要', type: 'toggle' },
      { key: 'isSchoolOriginal', label: '学校設定科目', type: 'toggle' },
    ],
  };
  return defs[type] || [];
}

/** カンマ区切り文字列を配列に変換するヘルパー */
function csvToArray(str) { return str ? str.split(',').map(s => s.trim()).filter(Boolean) : []; }

function parseFormData(type, data) {
  if (type === 'teachers') return {
    ...data,
    subjects: csvToArray(data.subjects),
    availableDays: csvToArray(data.availableDays).map(Number),
    maxPeriodsPerDay: Number(data.maxPeriodsPerDay) || 5,
    maxConsecutive: Number(data.maxConsecutive) || 3,
    isPartTime: data.isPartTime === 'true',
  };
  if (type === 'classes') return { ...data, grade: Number(data.grade) || 1 };
  if (type === 'rooms') return { ...data, capacity: Number(data.capacity) || 40 };
  if (type === 'subjects') return {
    ...data,
    department: data.department || '',
    credits: Number(data.credits) || Number(data.hoursPerWeek) || 1,
    hoursPerWeek: Number(data.hoursPerWeek) || 1,
    isRequired: data.isRequired === 'true',
    targetGrades: csvToArray(data.targetGrades).map(Number).filter(n => !isNaN(n)),
    courseRestriction: data.courseRestriction || '',
    requiresSpecialRoom: data.requiresSpecialRoom === 'true',
    isSchoolOriginal: data.isSchoolOriginal === 'true',
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

function detectCSVType(name, headerLine) {
  // ファイル名から推定
  const n = name.toLowerCase();
  if (n.includes('teacher') || n.includes('教員')) return 'teachers';
  if (n.includes('class') || n.includes('クラス')) return 'classes';
  if (n.includes('room') || n.includes('教室')) return 'rooms';
  if (n.includes('subject') || n.includes('科目')) return 'subjects';
  if (n.includes('slot') || n.includes('時間割')) return 'slots';
  // ヘッダー内容から推定
  if (headerLine) {
    const h = headerLine.toLowerCase();
    if (h.includes('氏名') || h.includes('非常勤') || h.includes('is_part_time')) return 'teachers';
    if (h.includes('クラス名') || h.includes('grade')) return 'classes';
    if (h.includes('定員') || h.includes('capacity')) return 'rooms';
    if (h.includes('週時数') || h.includes('hours_per_week')) return 'subjects';
    if (h.includes('曜日') || h.includes('時限') || h.includes('period')) return 'slots';
  }
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

function updateSaveIndicator() {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  const now = new Date();
  el.textContent = `保存済 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  el.classList.remove('hidden');
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
    dashboard: 'ダッシュボード', timetable: '時間割', curriculum: '教育課程',
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

  // 自動保存（60秒ごと）
  setInterval(() => {
    saveToLocalStorage();
    updateSaveIndicator();
  }, 60000);

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
    updateSaveIndicator();
    showNotification('保存しました', 'success');
  });

  document.getElementById('btn-csv-import')?.addEventListener('click', () => {
    document.getElementById('csv-file-input')?.click();
  });
  document.getElementById('csv-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target.result;
        const firstLine = text.split('\n')[0] || '';
        const type = detectCSVType(file.name, firstLine);
        if (!type) { showNotification('データ種別を判別できません。ファイル名に教員/クラス/教室/科目/時間割を含めてください。', 'error'); return; }
        const ns = importCSV(text, type, getState());
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
      const pages = { '1': 'dashboard', '2': 'timetable', '3': 'curriculum', '4': 'teachers', '5': 'classes', '6': 'rooms', '7': 'subjects' };
      if (pages[e.key]) navigateTo(pages[e.key]);
    }
  });

  // 設定の読み込み
  {
    const st = getState();
    const m = st.meta || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('setting-school-name', m.schoolName || '');
    setVal('setting-year', m.yearLabel || '');
    setVal('setting-periods', String(m.periodsPerDay || 6));
    setVal('setting-period-minutes', String(m.periodMinutes || 50));
    setVal('setting-start-time', m.startTime || '08:50');
    setVal('setting-break', String(m.breakMinutes || 10));
    setVal('setting-lunch-after', String(m.lunchAfterPeriod || 4));
    setVal('setting-lunch', String(m.lunchMinutes || 50));
    setVal('setting-grad-credits', String(m.graduationCredits || 74));
    // 授業日チェックボックス
    const wd = m.workingDays || [0,1,2,3,4];
    document.querySelectorAll('.wd-cb').forEach(cb => {
      const v = Number(cb.value);
      cb.checked = wd.includes(v);
      const lbl = cb.closest('label');
      if (lbl) {
        if (cb.checked) { lbl.classList.add('bg-primary-50','border-primary-300','text-primary-700'); lbl.classList.remove('bg-white','border-gray-200','text-gray-600'); }
        else { lbl.classList.remove('bg-primary-50','border-primary-300','text-primary-700'); lbl.classList.add('bg-white','border-gray-200','text-gray-600'); }
      }
    });
  }

  // 授業日チェックボックスのトグル
  document.getElementById('setting-working-days')?.addEventListener('click', e => {
    const lbl = e.target.closest('label');
    if (!lbl) return;
    const cb = lbl.querySelector('.wd-cb');
    if (!cb) return;
    setTimeout(() => {
      if (cb.checked) { lbl.classList.add('bg-primary-50','border-primary-300','text-primary-700'); lbl.classList.remove('bg-white','border-gray-200','text-gray-600'); }
      else { lbl.classList.remove('bg-primary-50','border-primary-300','text-primary-700'); lbl.classList.add('bg-white','border-gray-200','text-gray-600'); }
    }, 0);
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const s = getState();
    s.meta = s.meta || {};
    s.meta.schoolName = document.getElementById('setting-school-name')?.value || '';
    s.meta.yearLabel = document.getElementById('setting-year')?.value || '';
    s.meta.periodsPerDay = Number(document.getElementById('setting-periods')?.value) || 6;
    s.meta.periodMinutes = Number(document.getElementById('setting-period-minutes')?.value) || 50;
    s.meta.startTime = document.getElementById('setting-start-time')?.value || '08:50';
    s.meta.breakMinutes = Number(document.getElementById('setting-break')?.value) || 10;
    s.meta.lunchAfterPeriod = Number(document.getElementById('setting-lunch-after')?.value) || 4;
    s.meta.lunchMinutes = Number(document.getElementById('setting-lunch')?.value) || 50;
    s.meta.graduationCredits = Number(document.getElementById('setting-grad-credits')?.value) || 74;
    // 授業日
    const wdCbs = document.querySelectorAll('.wd-cb:checked');
    s.meta.workingDays = Array.from(wdCbs).map(cb => Number(cb.value)).sort();
    setState(s);
    saveToLocalStorage();
    refresh();
    showNotification('設定を保存しました', 'success');
  });

  // 初期描画
  viewId = populateEntityPicker(getState(), viewMode);
  navigateTo('dashboard');
});
