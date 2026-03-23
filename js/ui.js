/**
 * ui.js — DOM操作・レンダリングモジュール
 * index.html の構造に対応し、Tailwind クラスで描画する
 */

const DAY_LABELS = ['月', '火', '水', '木', '金'];
const PERIOD_TIMES = [
  '8:50–9:40', '9:50–10:40', '10:50–11:40',
  '11:50–12:40', '13:30–14:20', '14:30–15:20',
];

/** IDで名前を引く */
function nameById(list, id) {
  return (list || []).find(x => x.id === id)?.name ?? '';
}

/** 科目インデックスからCSSクラスを返す */
function subjColorClass(subjects, subjectId) {
  const idx = (subjects || []).findIndex(s => s.id === subjectId);
  return idx >= 0 ? `subj-${idx % 10}` : '';
}

// ─── エンティティ選択 ───

export function populateEntityPicker(state, viewMode) {
  const el = document.getElementById('entity-picker');
  if (!el) return null;
  el.innerHTML = '';
  const key = viewMode === 'class' ? 'classes' : viewMode === 'teacher' ? 'teachers' : 'rooms';
  for (const item of state[key] || []) {
    const o = document.createElement('option');
    o.value = item.id; o.textContent = item.name;
    el.appendChild(o);
  }
  return el.value || null;
}

// ─── ダッシュボード ───

export function renderDashboard(state, validationResult) {
  const stats = document.getElementById('dashboard-stats');
  if (!stats) return;

  const totalSlots = (state.classes?.length || 0) * (state.meta?.periodsPerDay || 6) * 5;
  const filled = state.slots?.length || 0;
  const pct = totalSlots > 0 ? Math.round((filled / totalSlots) * 100) : 0;
  const errCount = validationResult?.errors?.length || 0;
  const warnCount = validationResult?.warnings?.length || 0;

  const items = [
    { label: '教員', count: state.teachers?.length || 0, icon: '◉', accent: 'text-primary-600' },
    { label: 'クラス', count: state.classes?.length || 0, icon: '◎', accent: 'text-emerald-600' },
    { label: '教室', count: state.rooms?.length || 0, icon: '□', accent: 'text-amber-600' },
    { label: '配置率', count: `${pct}%`, icon: '▦', accent: 'text-violet-600' },
  ];
  stats.innerHTML = items.map(s => `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] font-medium text-gray-400 uppercase tracking-wider">${s.label}</span>
        <span class="text-gray-300 text-xs">${s.icon}</span>
      </div>
      <div class="text-2xl font-bold ${s.accent}">${s.count}</div>
    </div>`).join('');

  // 制約チェック結果
  const violDiv = document.getElementById('violations-content');
  if (!violDiv) return;

  // コマ配置プログレスバー
  let html = `
    <div class="mb-4">
      <div class="flex items-center justify-between text-[10px] text-gray-500 mb-1.5">
        <span>コマ配置状況</span><span class="font-semibold">${filled} / ${totalSlots}</span>
      </div>
      <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-500 ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-primary-500' : 'bg-amber-400'}" style="width:${pct}%"></div>
      </div>
    </div>`;

  // 制約違反サマリー
  if (errCount + warnCount > 0) {
    html += `<div class="space-y-1.5">`;
    if (errCount > 0) html += `<div class="text-xs px-3 py-1.5 rounded bg-red-50 border border-red-200 text-red-700">エラー: ${errCount}件</div>`;
    if (warnCount > 0) html += `<div class="text-xs px-3 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-700">警告: ${warnCount}件</div>`;
    html += `</div>`;
  } else if (filled > 0) {
    html += `<div class="text-xs px-3 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">制約違反なし</div>`;
  }

  // 教員ワークロード（上位5名）
  if ((state.teachers?.length || 0) > 0 && filled > 0) {
    const loads = (state.teachers || []).map(t => {
      const count = (state.slots || []).filter(s => s.teacherId === t.id).length;
      return { name: t.name, count, max: (t.maxPeriodsPerDay || 5) * 5 };
    }).sort((a, b) => b.count - a.count).slice(0, 5);

    html += `<div class="mt-4"><div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">教員ワークロード (Top 5)</div>`;
    for (const l of loads) {
      const loadPct = l.max > 0 ? Math.min(100, Math.round((l.count / l.max) * 100)) : 0;
      const barColor = loadPct >= 90 ? 'bg-red-400' : loadPct >= 70 ? 'bg-amber-400' : 'bg-primary-400';
      html += `<div class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] text-gray-600 w-16 truncate">${l.name}</span>
        <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full ${barColor} rounded-full" style="width:${loadPct}%"></div>
        </div>
        <span class="text-[10px] text-gray-400 w-8 text-right">${l.count}h</span>
      </div>`;
    }
    html += `</div>`;
  }

  violDiv.innerHTML = html;
}

// ─── 時間割グリッド ───

export function renderTimetableGrid(state, viewMode, viewId, validationMap, onSlotMove, onCellClick, onCellEdit) {
  const grid = document.getElementById('timetable-grid');
  if (!grid) return;
  const slots = (state.slots || []).filter(s => {
    if (viewMode === 'class') return s.classId === viewId;
    if (viewMode === 'teacher') return s.teacherId === viewId;
    if (viewMode === 'room') return s.roomId === viewId;
    return false;
  });
  const periods = state.meta?.periodsPerDay || 6;
  let dragData = null;

  // テーブル構築
  const tbl = document.createElement('table');
  tbl.className = 'w-full border-collapse bg-white rounded-lg overflow-hidden border border-gray-200';

  // ヘッダー
  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  hRow.innerHTML = '<th class="bg-primary-500 text-white text-xs font-semibold py-2.5 px-2 w-20 border border-primary-400"></th>';
  for (const d of DAY_LABELS) {
    const th = document.createElement('th');
    th.className = 'bg-primary-500 text-white text-xs font-semibold py-2.5 px-2 border border-primary-400 text-center';
    th.textContent = d;
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  tbl.appendChild(thead);

  // ボディ
  const tbody = document.createElement('tbody');
  for (let p = 0; p < periods; p++) {
    // 昼休み
    if (p === 4) {
      const lr = document.createElement('tr');
      lr.innerHTML = `<td class="bg-amber-50 text-amber-600 text-[10px] font-semibold py-1 px-2 text-center border border-gray-200">昼休み</td>
        <td colspan="5" class="bg-amber-50 text-amber-500 text-[10px] text-center py-1 border border-gray-200">12:40 – 13:30</td>`;
      tbody.appendChild(lr);
    }
    const row = document.createElement('tr');
    // 時限ラベル
    const lbl = document.createElement('td');
    lbl.className = 'bg-gray-50 text-center py-2 px-2 border border-gray-200 w-20';
    lbl.innerHTML = `<div class="text-xs font-semibold text-gray-700">${p + 1}限</div><div class="text-[9px] text-gray-400">${PERIOD_TIMES[p] || ''}</div>`;
    row.appendChild(lbl);

    for (let d = 0; d < 5; d++) {
      const slot = slots.find(s => s.day === d && s.period === p);
      const td = document.createElement('td');
      td.className = 'tt-cell border border-gray-200 p-1 align-top cursor-pointer transition-all duration-100 min-h-[56px] h-16 relative';
      td.dataset.day = d; td.dataset.period = p;

      // 制約違反
      const vKey = `${d}-${p}`;
      if (validationMap?.[vKey] === 'error') td.classList.add('cell-error');
      else if (validationMap?.[vKey] === 'warning') td.classList.add('cell-warning');

      if (slot) {
        td.draggable = true;
        const colorCls = subjColorClass(state.subjects, slot.subjectId);
        td.innerHTML = `<div class="rounded px-1.5 py-1 h-full flex flex-col justify-center ${colorCls}">
          <div class="text-[11px] font-bold text-gray-800 leading-tight truncate">${nameById(state.subjects, slot.subjectId)}</div>
          <div class="text-[9px] text-gray-500 truncate mt-0.5">${nameById(state.teachers, slot.teacherId)}</div>
          <div class="text-[8px] text-gray-400 truncate">${nameById(state.rooms, slot.roomId)}</div>
        </div>`;

        // コマ入りセルクリック → 編集/削除
        td.addEventListener('click', e => {
          if (e.defaultPrevented) return;
          onCellEdit?.(d, p, slot);
        });

        // ドラッグ開始
        td.addEventListener('dragstart', e => {
          const s = slots.find(s => s.day === d && s.period === p);
          if (!s) { e.preventDefault(); return; }
          dragData = { day: d, period: p, slot: { ...s } };
          e.dataTransfer.effectAllowed = 'move';
          td.classList.add('dragging');
        });
        td.addEventListener('dragend', () => { td.classList.remove('dragging'); dragData = null; });
      } else {
        td.innerHTML = '<div class="h-full min-h-[48px] flex items-center justify-center"><span class="text-gray-200 text-lg">+</span></div>';
        td.addEventListener('mouseenter', () => td.querySelector('span')?.classList.replace('text-gray-200', 'text-primary-300'));
        td.addEventListener('mouseleave', () => td.querySelector('span')?.classList.replace('text-primary-300', 'text-gray-200'));
        // 空セルクリック
        td.addEventListener('click', () => onCellClick?.(d, p));
      }

      // ドロップ対象
      td.addEventListener('dragover', e => { e.preventDefault(); td.classList.add('drag-over'); });
      td.addEventListener('dragleave', () => td.classList.remove('drag-over'));
      td.addEventListener('drop', e => {
        e.preventDefault(); td.classList.remove('drag-over');
        if (!dragData || !onSlotMove) return;
        onSlotMove({ day: dragData.day, period: dragData.period }, { day: d, period: p }, dragData.slot);
        dragData = null;
      });
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody);
  grid.innerHTML = '';
  grid.appendChild(tbl);
}

// ─── マスターデータテーブル ───

const MASTER_COLS = {
  teachers: [
    { key: 'name', label: '氏名' },
    { key: 'subjects', label: '担当科目', fmt: (v, st) => (v||[]).map(id => nameById(st.subjects, id) || id).join(', ') },
    { key: 'availableDays', label: '出勤曜日', fmt: v => (v||[]).map(d => DAY_LABELS[d]).join(' ') },
    { key: 'maxPeriodsPerDay', label: '最大コマ/日' },
    { key: 'isPartTime', label: '非常勤', fmt: v => v ? 'Yes' : '' },
  ],
  classes: [
    { key: 'name', label: 'クラス名' },
    { key: 'grade', label: '学年' },
    { key: 'course', label: 'コース' },
  ],
  rooms: [
    { key: 'name', label: '教室名' },
    { key: 'type', label: '種別' },
    { key: 'capacity', label: '定員' },
  ],
  subjects: [
    { key: 'name', label: '科目名' },
    { key: 'hoursPerWeek', label: '週時数' },
    { key: 'requiresSpecialRoom', label: '特別教室', fmt: v => v ? 'Yes' : '' },
  ],
};

export function renderMasterTable(state, type, searchQuery, onEdit, onDelete) {
  const container = document.getElementById(`${type}-table-container`);
  if (!container) return;
  const cols = MASTER_COLS[type];
  if (!cols) return;

  let records = state[type] || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    records = records.filter(r => cols.some(c => {
      const v = c.fmt ? c.fmt(r[c.key], state) : String(r[c.key] ?? '');
      return v.toLowerCase().includes(q);
    }));
  }

  const tbl = document.createElement('table');
  tbl.className = 'data-tbl w-full text-sm';

  // ヘッダー
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.className = 'text-left text-[11px] font-semibold text-gray-500 bg-gray-50 px-4 py-2.5 border-b border-gray-200';
    th.textContent = c.label;
    hr.appendChild(th);
  }
  hr.innerHTML += '<th class="text-right text-[11px] font-semibold text-gray-500 bg-gray-50 px-4 py-2.5 border-b border-gray-200 no-print">操作</th>';
  thead.appendChild(hr);
  tbl.appendChild(thead);

  // ボディ
  const tbody = document.createElement('tbody');
  for (const rec of records) {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-100 hover:bg-gray-50 transition-colors';
    for (const c of cols) {
      const td = document.createElement('td');
      td.className = 'px-4 py-2.5 text-xs text-gray-700';
      td.textContent = c.fmt ? c.fmt(rec[c.key], state) : (rec[c.key] ?? '');
      tr.appendChild(td);
    }
    const actTd = document.createElement('td');
    actTd.className = 'px-4 py-2.5 text-right no-print';
    actTd.innerHTML = `
      <button class="edit-btn text-[11px] text-primary-600 hover:text-primary-800 mr-2 font-medium" data-id="${rec.id}">編集</button>
      <button class="del-btn text-[11px] text-red-500 hover:text-red-700 font-medium" data-id="${rec.id}">削除</button>`;
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  }
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="text-center py-8 text-xs text-gray-400">データがありません</td></tr>`;
  }
  tbl.appendChild(tbody);

  // 古いリスナーを除去してから差し替え
  const newContainer = container.cloneNode(false);
  container.parentNode.replaceChild(newContainer, container);
  newContainer.appendChild(tbl);

  // イベント委譲（コンテナごと差し替え済みなのでリスナーは1つだけ）
  newContainer.addEventListener('click', e => {
    const btn = e.target.closest('.edit-btn, .del-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('edit-btn')) onEdit?.(type, id);
    else if (btn.classList.contains('del-btn') && confirm('削除してもよろしいですか？')) onDelete?.(type, id);
  });
}

// ─── モーダル ───

/**
 * 編集モーダルを表示する
 * fields: [{ key, label, type?, placeholder?, options?: [{value,label}] }]
 */
export function showEditModal(title, fields, values, onSave) {
  const overlay = document.getElementById('modal-overlay');
  const tEl = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  tEl.textContent = title;
  body.innerHTML = '';

  for (const f of fields) {
    const div = document.createElement('div');
    div.className = 'mb-3';
    const val = Array.isArray(values[f.key]) ? values[f.key].join(', ') : (values[f.key] ?? '');
    let inputHtml;
    if (f.options) {
      // ドロップダウン選択
      const opts = f.options.map(o =>
        `<option value="${o.value}" ${o.value === String(val) ? 'selected' : ''}>${o.label}</option>`
      ).join('');
      inputHtml = `<select name="${f.key}" class="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none bg-white">
        <option value="">-- 選択 --</option>${opts}</select>`;
    } else {
      inputHtml = `<input name="${f.key}" type="${f.type || 'text'}" value="${String(val)}"
        placeholder="${f.placeholder || ''}"
        class="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none">`;
    }
    div.innerHTML = `<label class="block text-[11px] font-semibold text-gray-600 mb-1">${f.label}</label>${inputHtml}`;
    body.appendChild(div);
  }

  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');

  // Escキーで閉じる
  const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  const wire = (id, fn) => {
    const el = document.getElementById(id);
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', fn);
  };
  wire('btn-modal-save', () => {
    const data = {};
    for (const f of fields) data[f.key] = body.querySelector(`[name="${f.key}"]`)?.value?.trim() ?? '';
    onSave(data);
    close();
    document.removeEventListener('keydown', escHandler);
  });
  wire('btn-modal-cancel', () => { close(); document.removeEventListener('keydown', escHandler); });
  wire('btn-modal-close', () => { close(); document.removeEventListener('keydown', escHandler); });
}

// ─── 制約チェック結果 ───

export function showValidationResults(errors, warnings) {
  const el = document.getElementById('validation-results');
  if (!el) return {};
  const items = [
    ...(errors || []).map(e => ({ ...e, lv: 'error' })),
    ...(warnings || []).map(w => ({ ...w, lv: 'warning' })),
  ];
  if (items.length === 0) {
    el.innerHTML = '<div class="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">制約違反はありません</div>';
    return {};
  }
  el.innerHTML = `<div class="space-y-1.5">${items.map(i =>
    `<div class="text-xs px-3 py-1.5 rounded-lg border ${
      i.lv === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
    }">[${i.type}] ${i.message}</div>`
  ).join('')}</div>`;

  const map = {};
  for (const i of items) {
    if (i.day != null && i.period != null) {
      const k = `${i.day}-${i.period}`;
      if (!map[k] || i.lv === 'error') map[k] = i.lv;
    }
  }
  return map;
}

// ─── プログレス ───

export function showProgress(pct, msg) {
  const bar = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  const txt = document.getElementById('progress-text');
  if (!bar) return;
  bar.classList.remove('hidden');
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (txt) txt.textContent = `${msg} (${Math.round(pct)}%)`;
  if (pct >= 100) setTimeout(() => bar.classList.add('hidden'), 1200);
}

// ─── トースト ───

export function showNotification(message, type = 'info') {
  const area = document.getElementById('notification-area');
  if (!area) return;
  const colors = {
    success: 'bg-emerald-600', error: 'bg-red-600',
    warning: 'bg-amber-600', info: 'bg-primary-600',
  };
  const toast = document.createElement('div');
  toast.className = `pointer-events-auto ${colors[type] || colors.info} text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg toast-enter max-w-xs`;
  toast.textContent = message;
  area.appendChild(toast);
  setTimeout(() => { toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 250); }, 3000);
}
