/**
 * ui.js — DOM操作・レンダリングモジュール
 * index.html の構造に対応し、Tailwind クラスで描画する
 */

const DAY_LABELS = ['月', '火', '水', '木', '金', '土'];

let sortState = { type: '', key: '', asc: true };

/** metaから時限時刻を動的に計算 */
function calcPeriodTimes(meta) {
  const pm = meta?.periodMinutes || 50;
  const brk = meta?.breakMinutes || 10;
  const lunch = meta?.lunchMinutes || 50;
  const lunchAfter = meta?.lunchAfterPeriod || 4;
  const periods = meta?.periodsPerDay || 6;
  const [sh, sm] = (meta?.startTime || '08:50').split(':').map(Number);
  let mins = sh * 60 + sm;
  const times = [];
  for (let p = 0; p < periods; p++) {
    if (p === lunchAfter) mins += lunch; // 昼休み分を加算
    const startH = Math.floor(mins / 60), startM = mins % 60;
    const endMins = mins + pm;
    const endH = Math.floor(endMins / 60), endM = endMins % 60;
    times.push(`${startH}:${String(startM).padStart(2,'0')}–${endH}:${String(endM).padStart(2,'0')}`);
    mins = endMins + brk;
  }
  return times;
}

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
    { label: '教員', count: state.teachers?.length || 0, icon: '◉', accent: 'text-primary-600', page: 'teachers' },
    { label: 'クラス', count: state.classes?.length || 0, icon: '◎', accent: 'text-emerald-600', page: 'classes' },
    { label: '教室', count: state.rooms?.length || 0, icon: '□', accent: 'text-amber-600', page: 'rooms' },
    { label: '配置率', count: `${pct}%`, icon: '▦', accent: 'text-violet-600', page: 'timetable' },
  ];
  const hasData = items.some(s => s.count > 0);
  stats.innerHTML = items.map(s => `
    <div class="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors cursor-pointer" data-page="${s.page}">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] font-medium text-gray-400 uppercase tracking-wider">${s.label}</span>
        <span class="text-gray-300 text-xs">${s.icon}</span>
      </div>
      <div class="text-2xl font-bold ${s.accent}">${s.count}</div>
    </div>`).join('');
  if (!hasData) {
    stats.innerHTML += `<div class="col-span-2 lg:col-span-4 text-center py-4">
      <p class="text-sm text-gray-500">データがありません</p>
      <p class="text-xs text-gray-400 mt-1">「サンプルデータを読み込む」かCSVをインポートしてください</p>
    </div>`;
  }

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

  // クラス別週時数
  if ((state.classes?.length || 0) > 0 && filled > 0) {
    html += `<div class="mt-4"><div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">クラス別 週コマ数</div>`;
    const classHours = (state.classes || []).map(c => {
      const count = (state.slots || []).filter(s => s.classId === c.id).length;
      const target = (state.meta?.periodsPerDay || 6) * 5;
      return { name: c.name, count, target };
    });
    for (const c of classHours) {
      const pct = c.target > 0 ? Math.min(100, Math.round((c.count / c.target) * 100)) : 0;
      html += `<div class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] text-gray-600 w-16 truncate">${c.name}</span>
        <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-400 rounded-full" style="width:${pct}%"></div>
        </div>
        <span class="text-[10px] text-gray-400 w-12 text-right">${c.count}/${c.target}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // 教室稼働率
  if ((state.rooms?.length || 0) > 0 && filled > 0) {
    html += `<div class="mt-4"><div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">教室稼働率</div>`;
    const totalPossible = (state.meta?.periodsPerDay || 6) * 5;
    const roomUsage = (state.rooms || []).map(r => {
      const count = (state.slots || []).filter(s => s.roomId === r.id).length;
      return { name: r.name, count, total: totalPossible };
    }).sort((a, b) => b.count - a.count);
    for (const r of roomUsage) {
      const pct = r.total > 0 ? Math.min(100, Math.round((r.count / r.total) * 100)) : 0;
      const barColor = pct >= 80 ? 'bg-red-400' : pct >= 50 ? 'bg-amber-400' : 'bg-cyan-400';
      html += `<div class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] text-gray-600 w-20 truncate">${r.name}</span>
        <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full ${barColor} rounded-full" style="width:${pct}%"></div>
        </div>
        <span class="text-[10px] text-gray-400 w-8 text-right">${pct}%</span>
      </div>`;
    }
    html += `</div>`;
  }

  // 科目カラー凡例
  if ((state.subjects?.length || 0) > 0) {
    html += `<div class="mt-4"><div class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">科目カラー</div>
      <div class="flex flex-wrap gap-1.5">`;
    for (let i = 0; i < state.subjects.length; i++) {
      html += `<span class="subj-${i % 10} text-[10px] px-2 py-0.5 rounded">${state.subjects[i].name}</span>`;
    }
    html += `</div></div>`;
  }

  violDiv.innerHTML = html;

  // ─── 教育課程概要 ───
  renderCurriculumOverview(state);
}

/** 教育課程概要を描画する */
function renderCurriculumOverview(state) {
  const el = document.getElementById('curriculum-content');
  if (!el) return;
  const subjects = state.subjects || [];
  if (subjects.length === 0) { el.innerHTML = '<p class="text-xs text-gray-400">科目データをインポートしてください</p>'; return; }

  // 教科ごとにグループ化
  const byDept = new Map();
  for (const s of subjects) {
    const dept = s.department || '未分類';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(s);
  }

  const requiredCount = subjects.filter(s => s.isRequired).length;
  const electiveCount = subjects.filter(s => !s.isRequired).length;
  const schoolOrigCount = subjects.filter(s => s.isSchoolOriginal).length;
  const totalCredits = subjects.reduce((sum, s) => sum + (s.credits || 0), 0);

  let h = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
    <div class="text-center p-2 bg-primary-50 rounded"><div class="text-lg font-bold text-primary-600">${subjects.length}</div><div class="text-[10px] text-gray-500">総科目数</div></div>
    <div class="text-center p-2 bg-emerald-50 rounded"><div class="text-lg font-bold text-emerald-600">${requiredCount}</div><div class="text-[10px] text-gray-500">必履修科目</div></div>
    <div class="text-center p-2 bg-amber-50 rounded"><div class="text-lg font-bold text-amber-600">${electiveCount}</div><div class="text-[10px] text-gray-500">選択科目</div></div>
    <div class="text-center p-2 bg-violet-50 rounded"><div class="text-lg font-bold text-violet-600">${schoolOrigCount}</div><div class="text-[10px] text-gray-500">学校設定科目</div></div>
  </div>`;

  // 教科別の表
  h += `<div class="overflow-x-auto"><table class="w-full text-[11px]"><thead><tr class="text-left text-gray-500 border-b">
    <th class="py-1 px-2">教科</th><th class="py-1 px-2">科目数</th><th class="py-1 px-2">必履修</th><th class="py-1 px-2">科目一覧</th>
  </tr></thead><tbody>`;
  for (const [dept, subs] of byDept) {
    const req = subs.filter(s => s.isRequired).length;
    const names = subs.map(s => {
      let badge = '';
      if (s.isRequired) badge = '<span class="text-emerald-600 text-[9px]">必</span>';
      if (s.isSchoolOriginal) badge = '<span class="text-violet-600 text-[9px]">独</span>';
      if (s.courseRestriction) badge += `<span class="text-amber-600 text-[9px]">${s.courseRestriction}</span>`;
      return `<span class="inline-block bg-gray-100 px-1.5 py-0.5 rounded mr-1 mb-1">${s.name}${badge ? ' '+badge : ''}</span>`;
    }).join('');
    h += `<tr class="border-b border-gray-100"><td class="py-1.5 px-2 font-medium">${dept}</td><td class="py-1.5 px-2">${subs.length}</td><td class="py-1.5 px-2">${req}</td><td class="py-1.5 px-2">${names}</td></tr>`;
  }
  h += `</tbody></table></div>`;

  el.innerHTML = h;
}

// ─── 教育課程マップ ───

/** クラス×科目の教育課程マップを描画 */
export function renderCurriculumMap(state) {
  const container = document.getElementById('curriculum-map-container');
  if (!container) return;
  const classes = state.classes || [];
  const subjects = state.subjects || [];

  if (classes.length === 0 || subjects.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-xs text-gray-400">クラスと科目のデータを登録してください</div>';
    return;
  }

  // 教科でグループ化
  const byDept = new Map();
  for (const s of subjects) {
    const dept = s.department || '未分類';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(s);
  }

  // 現在の配置状況を集計（クラス×科目→コマ数）
  const slotCounts = new Map();
  for (const sl of state.slots || []) {
    const k = `${sl.classId}|${sl.subjectId}`;
    slotCounts.set(k, (slotCounts.get(k) || 0) + 1);
  }

  let h = '<table class="w-full text-[10px] border-collapse">';
  // ヘッダー: クラス名
  h += '<thead><tr><th class="sticky left-0 bg-gray-50 px-2 py-1.5 border border-gray-200 text-left text-gray-500 z-10 min-w-[100px]">科目</th>';
  for (const cls of classes) {
    h += `<th class="px-2 py-1.5 border border-gray-200 text-center bg-gray-50 text-gray-600 min-w-[60px]">${cls.name}</th>`;
  }
  h += '</tr></thead><tbody>';

  for (const [dept, subs] of byDept) {
    // 教科ヘッダー行
    h += `<tr><td colspan="${classes.length + 1}" class="px-2 py-1 bg-primary-50 text-primary-700 font-semibold border border-gray-200">${dept}</td></tr>`;
    for (const subj of subs) {
      h += '<tr>';
      const badges = [];
      if (subj.isRequired) badges.push('<span class="text-emerald-600">必</span>');
      if (subj.courseRestriction) badges.push(`<span class="text-amber-600">${subj.courseRestriction}</span>`);
      if (subj.isSchoolOriginal) badges.push('<span class="text-violet-600">独</span>');
      h += `<td class="sticky left-0 bg-white px-2 py-1 border border-gray-200 z-10">${subj.name} <span class="text-[8px]">(${subj.hoursPerWeek}h)</span> ${badges.join(' ')}</td>`;

      for (const cls of classes) {
        // この科目がこのクラスに適用可能か判定
        const gradeOk = !subj.targetGrades?.length || subj.targetGrades.includes(cls.grade);
        const courseOk = !subj.courseRestriction || cls.course === '共通' || cls.course === '文理混合' || subj.courseRestriction === cls.course;
        const applicable = gradeOk && courseOk;
        const count = slotCounts.get(`${cls.id}|${subj.id}`) || 0;
        const target = applicable ? (subj.hoursPerWeek || 0) : 0;

        let cellClass = 'text-center px-1 py-1 border border-gray-200';
        let content = '';
        if (!applicable) {
          cellClass += ' bg-gray-100 text-gray-300';
          content = '-';
        } else if (count === 0 && target > 0) {
          cellClass += ' bg-red-50 text-red-400';
          content = `0/${target}`;
        } else if (count < target) {
          cellClass += ' bg-amber-50 text-amber-600';
          content = `${count}/${target}`;
        } else if (count === target) {
          cellClass += ' bg-emerald-50 text-emerald-600 font-medium';
          content = `${count}`;
        } else {
          cellClass += ' bg-red-50 text-red-600 font-medium';
          content = `${count}/${target}`;
        }
        h += `<td class="${cellClass}">${content}</td>`;
      }
      h += '</tr>';
    }
  }
  h += '</tbody></table>';
  container.innerHTML = h;
}

// ─── 時間割グリッド ───

export function renderTimetableGrid(state, viewMode, viewId, validationMap, onSlotMove, onCellClick, onCellEdit) {
  const grid = document.getElementById('timetable-grid');
  if (!grid) return;

  // データがない場合の空状態表示
  if (!viewId) {
    grid.innerHTML = `<div class="flex flex-col items-center justify-center py-16 text-gray-400">
      <div class="text-4xl mb-3">▦</div>
      <p class="text-sm font-medium mb-1">表示対象が選択されていません</p>
      <p class="text-xs">上のドロップダウンからクラス・教員・教室を選択してください</p>
    </div>`;
    return;
  }

  const slots = (state.slots || []).filter(s => {
    if (viewMode === 'class') return s.classId === viewId;
    if (viewMode === 'teacher') return s.teacherId === viewId;
    if (viewMode === 'room') return s.roomId === viewId;
    return false;
  });
  const defaultPeriods = state.meta?.periodsPerDay || 6;
  const pByDay = state.meta?.periodsPerDayByDay || {};
  // 全曜日の最大コマ数（グリッドの行数を決定）
  const maxPeriods = Math.max(defaultPeriods, ...Object.values(pByDay).map(Number).filter(n => n > 0));
  const periodTimes = calcPeriodTimes({ ...state.meta, periodsPerDay: maxPeriods });
  const lunchAfter = (state.meta?.lunchAfterPeriod ?? 4) - 1;
  const workingDays = state.meta?.workingDays || [0,1,2,3,4];
  /** 曜日ごとのコマ数を取得 */
  const getPeriodsForDay = (d) => Number(pByDay[d]) || defaultPeriods;
  let dragData = null;

  // テーブル構築（table-layout:fixed でセル幅を均等化）
  const tbl = document.createElement('table');
  tbl.className = 'w-full border-collapse bg-white rounded-lg overflow-hidden border border-gray-200';
  tbl.style.tableLayout = 'fixed';

  // ヘッダー
  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  hRow.innerHTML = '<th class="bg-primary-500 text-white text-xs font-semibold py-2.5 px-2 w-20 border border-primary-400"></th>';
  for (const di of workingDays) {
    const th = document.createElement('th');
    th.className = 'bg-primary-500 text-white text-xs font-semibold py-2.5 px-2 border border-primary-400 text-center';
    const dayP = getPeriodsForDay(di);
    th.innerHTML = `${DAY_LABELS[di] || `Day${di}`}${dayP !== defaultPeriods ? `<span class="text-[9px] opacity-70 block">${dayP}限</span>` : ''}`;
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  tbl.appendChild(thead);

  // ボディ
  const tbody = document.createElement('tbody');
  for (let p = 0; p < maxPeriods; p++) {
    // 昼休み
    if (p === lunchAfter + 1 && maxPeriods > lunchAfter + 1) {
      const lr = document.createElement('tr');
      lr.innerHTML = `<td class="bg-amber-50 text-amber-600 text-[10px] font-semibold py-1 px-2 text-center border border-gray-200">昼休み</td>
        <td colspan="${workingDays.length}" class="bg-amber-50 text-amber-500 text-[10px] text-center py-1 border border-gray-200">${state.meta?.lunchMinutes || 50}分</td>`;
      tbody.appendChild(lr);
    }
    const row = document.createElement('tr');
    // 時限ラベル
    const lbl = document.createElement('td');
    lbl.className = 'bg-gray-50 text-center py-2 px-2 border border-gray-200 w-20';
    lbl.innerHTML = `<div class="text-xs font-semibold text-gray-700">${p + 1}限</div><div class="text-[9px] text-gray-400">${periodTimes[p] || ''}</div>`;
    row.appendChild(lbl);

    for (const d of workingDays) {
      const dayPeriods = getPeriodsForDay(d);
      const td = document.createElement('td');

      const cellH = 'h-[68px]'; // 全セル統一の高さ

      // この曜日のコマ数を超えている場合はグレーアウト
      if (p >= dayPeriods) {
        td.className = `border border-gray-200 bg-gray-100 ${cellH}`;
        td.innerHTML = '';
        row.appendChild(td);
        continue;
      }

      // 同じ (day, period) に複数コマがある場合（選択同時開講）
      const cellSlots = slots.filter(s => s.day === d && s.period === p);
      const slot = cellSlots[0]; // 代表スロット（ドラッグ等で使用）
      td.className = `tt-cell border border-gray-200 p-1 align-top cursor-pointer transition-all duration-100 ${cellH} relative overflow-hidden`;
      td.dataset.day = d; td.dataset.period = p;

      // 制約違反
      const vKey = `${d}-${p}`;
      if (validationMap?.[vKey] === 'error') td.classList.add('cell-error');
      else if (validationMap?.[vKey] === 'warning') td.classList.add('cell-warning');

      if (cellSlots.length > 1) {
        // 選択同時開講: 複数科目を1セルに表示
        td.draggable = false;
        const items = cellSlots.map(s => {
          const colorCls = subjColorClass(state.subjects, s.subjectId);
          return `<div class="rounded px-1 py-0.5 ${colorCls} mb-px"><span class="text-[9px] font-bold text-gray-800 truncate block">${nameById(state.subjects, s.subjectId)}</span><span class="text-[7px] text-gray-500">${nameById(state.teachers, s.teacherId)}</span></div>`;
        }).join('');
        td.innerHTML = items;
        td.title = cellSlots.map(s => `${nameById(state.subjects, s.subjectId)} / ${nameById(state.teachers, s.teacherId)}`).join('\n');
        // クリック時は最初のスロットを編集対象
        td.addEventListener('click', e => {
          if (e.defaultPrevented) return;
          onCellEdit?.(d, p, slot);
        });
      } else if (slot) {
        td.draggable = true;
        const colorCls = subjColorClass(state.subjects, slot.subjectId);
        const sName = nameById(state.subjects, slot.subjectId);
        const tName = nameById(state.teachers, slot.teacherId);
        const rName = nameById(state.rooms, slot.roomId);
        td.title = [sName, tName, rName].filter(Boolean).join(' / ');
        td.innerHTML = `<div class="rounded px-1.5 py-1 h-full flex flex-col justify-center ${colorCls}">
          <div class="text-[11px] font-bold text-gray-800 leading-tight truncate">${sName}</div>
          <div class="text-[9px] text-gray-500 truncate mt-0.5">${tName}</div>
          <div class="text-[8px] text-gray-400 truncate">${rName}</div>
          ${slot.slotType && slot.slotType !== 'single' ? `<div class="text-[7px] mt-0.5"><span class="bg-gray-200 text-gray-600 px-1 rounded">${{'elective':'選択','course':'コース','team_teaching':'TT','double':'連続','fixed':'固定','special_room':'特別','meeting':'会議'}[slot.slotType] || slot.slotType}</span></div>` : ''}
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
          // 移動先候補をハイライト（自身と同曜日以外で空いているセル）
          tbody.querySelectorAll('.tt-cell').forEach(c => {
            if (c === td || c.classList.contains('bg-gray-100')) return; // グレーアウト除外
            c.classList.add('candidate');
          });
        });
        td.addEventListener('dragend', () => {
          td.classList.remove('dragging');
          dragData = null;
          tbody.querySelectorAll('.candidate').forEach(c => c.classList.remove('candidate'));
        });
      } else {
        td.innerHTML = '<div class="h-full flex items-center justify-center"><span class="text-gray-200 text-lg">+</span></div>';
        td.addEventListener('mouseenter', () => td.querySelector('span')?.classList.replace('text-gray-200', 'text-primary-300'));
        td.addEventListener('mouseleave', () => td.querySelector('span')?.classList.replace('text-primary-300', 'text-gray-200'));
        // 空セルクリック
        td.addEventListener('click', () => onCellClick?.(d, p));
      }

      // ドロップ対象（グレーアウトセルはドロップ不可）
      if (p < dayPeriods) {
        td.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          td.classList.add('drag-over');
        });
        td.addEventListener('dragleave', () => td.classList.remove('drag-over'));
        td.addEventListener('drop', e => {
          e.preventDefault(); td.classList.remove('drag-over');
          if (!dragData || !onSlotMove) return;
          onSlotMove({ day: dragData.day, period: dragData.period }, { day: d, period: p }, dragData.slot);
          dragData = null;
        });
      }
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
    { key: 'department', label: '教科' },
    { key: 'credits', label: '単位' },
    { key: 'hoursPerWeek', label: '週時数' },
    { key: 'isRequired', label: '必履修', fmt: v => v ? '必' : '' },
    { key: 'targetGrades', label: '対象学年', fmt: v => (v||[]).join('・') || '全' },
    { key: 'courseRestriction', label: 'コース', fmt: v => v || '共通' },
    { key: 'isSchoolOriginal', label: '学校設定', fmt: v => v ? '独自' : '' },
    { key: 'alternativeFor', label: '代替科目', fmt: (v, st) => v ? nameById(st.subjects, v) || v : '' },
  ],
};

export function renderMasterTable(state, type, searchQuery, onEdit, onDelete) {
  const container = document.getElementById(`${type}-table-container`);
  if (!container) return;
  const cols = MASTER_COLS[type];
  if (!cols) return;

  const total = (state[type] || []).length;
  let records = state[type] || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    records = records.filter(r => cols.some(c => {
      const v = c.fmt ? c.fmt(r[c.key], state) : String(r[c.key] ?? '');
      return v.toLowerCase().includes(q);
    }));
  }

  // 件数バッジ
  const badge = document.createElement('div');
  badge.className = 'px-4 py-2 text-[11px] text-gray-500 bg-gray-50 border-b border-gray-200';
  badge.textContent = searchQuery ? `${records.length}件 / ${total}件中` : `${total}件`;

  const tbl = document.createElement('table');
  tbl.className = 'data-tbl w-full text-sm';

  // ヘッダー
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.className = 'text-left text-[11px] font-semibold text-gray-500 bg-gray-50 px-4 py-2.5 border-b border-gray-200 cursor-pointer hover:bg-gray-100 select-none';
    const arrow = (sortState.type === type && sortState.key === c.key) ? (sortState.asc ? ' ↑' : ' ↓') : '';
    th.textContent = c.label + arrow;
    th.addEventListener('click', () => {
      if (sortState.type === type && sortState.key === c.key) {
        sortState.asc = !sortState.asc;
      } else {
        sortState = { type, key: c.key, asc: true };
      }
      // Re-render: we need to call the function again
      // Store onEdit and onDelete in module scope or pass through
      renderMasterTable(state, type, searchQuery, onEdit, onDelete);
    });
    hr.appendChild(th);
  }
  hr.innerHTML += '<th class="text-right text-[11px] font-semibold text-gray-500 bg-gray-50 px-4 py-2.5 border-b border-gray-200 no-print">操作</th>';
  thead.appendChild(hr);
  tbl.appendChild(thead);

  // ソート
  if (sortState.type === type && sortState.key) {
    const key = sortState.key;
    records = [...records].sort((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ja');
      return sortState.asc ? cmp : -cmp;
    });
  }

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
  newContainer.appendChild(badge);
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
 * fields: [{ key, label, type?, placeholder?, options?, multi? }]
 * type: 'text'|'number'|'toggle'|'checkboxGroup'|'hidden'
 * options: [{value,label}]  (select / checkboxGroup 用)
 * multi: true → 複数選択（タグ型）
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
    const rawVal = values[f.key];
    const val = Array.isArray(rawVal) ? rawVal : (rawVal ?? '');
    const valStr = Array.isArray(val) ? val.join(', ') : String(val);
    const valArr = Array.isArray(val) ? val.map(String) : [];

    let inputHtml;

    if (f.type === 'toggle') {
      // トグルスイッチ
      const checked = val === true || val === 'true';
      inputHtml = `<label class="inline-flex items-center gap-2 cursor-pointer">
        <input name="${f.key}" type="checkbox" ${checked ? 'checked' : ''} class="sr-only peer">
        <div class="w-9 h-5 bg-gray-200 peer-checked:bg-primary-500 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
        <span class="text-xs text-gray-500">${val === true || val === 'true' ? 'はい' : 'いいえ'}</span>
      </label>`;
    } else if (f.type === 'checkboxGroup' && f.options) {
      // チェックボックスグループ（複数選択）
      inputHtml = `<div class="flex flex-wrap gap-2 mt-1" data-name="${f.key}" data-type="checkboxGroup">` +
        f.options.map(o => {
          const checked = valArr.includes(String(o.value));
          return `<label class="inline-flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded border ${checked ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-600'} hover:border-primary-300 transition-colors">
            <input type="checkbox" value="${o.value}" ${checked ? 'checked' : ''} class="sr-only cbg-input">
            ${o.label}
          </label>`;
        }).join('') + `</div>`;
    } else if (f.options && f.multi) {
      // マルチセレクト（タグ型）
      inputHtml = `<div class="flex flex-wrap gap-1 mt-1 p-2 border border-gray-300 rounded-lg min-h-[36px] bg-white" data-name="${f.key}" data-type="multiSelect">` +
        f.options.map(o => {
          const selected = valArr.includes(String(o.value));
          return `<button type="button" data-value="${o.value}" class="ms-tag text-[10px] px-2 py-0.5 rounded-full border transition-colors ${selected ? 'bg-primary-500 text-white border-primary-500' : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-primary-300'}">${o.label}</button>`;
        }).join('') + `</div>`;
    } else if (f.options) {
      // ドロップダウン選択
      const opts = f.options.map(o =>
        `<option value="${o.value}" ${o.value === valStr ? 'selected' : ''}>${o.label}</option>`
      ).join('');
      inputHtml = `<select name="${f.key}" class="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none bg-white">
        <option value="">-- 選択 --</option>${opts}</select>`;
    } else if (f.type === 'periodGrid') {
      // 曜日×時限グリッド（授業不可時限用）
      const blocked = Array.isArray(val) ? val : [];
      const days = ['月','火','水','木','金'];
      const numP = 6; // TODO: stateから取得
      let gridHtml = '<div data-name="' + f.key + '" data-type="periodGrid" class="border border-gray-200 rounded-lg overflow-hidden mt-1">';
      gridHtml += '<table class="w-full text-[10px]"><thead><tr><th class="bg-gray-50 px-1 py-1 border-b border-r border-gray-200 w-8"></th>';
      for (let pi = 0; pi < numP; pi++) gridHtml += `<th class="bg-gray-50 px-1 py-1 border-b border-gray-200 text-center">${pi+1}限</th>`;
      gridHtml += '</tr></thead><tbody>';
      for (let di = 0; di < days.length; di++) {
        gridHtml += `<tr><td class="bg-gray-50 px-2 py-1 border-r border-gray-200 font-semibold text-gray-600">${days[di]}</td>`;
        for (let pi = 0; pi < numP; pi++) {
          const isBlocked = blocked.some(b => b.day === di && b.period === pi);
          gridHtml += `<td class="pg-cell text-center py-1.5 border-gray-100 border cursor-pointer transition-colors ${isBlocked ? 'bg-red-100 text-red-600' : 'hover:bg-gray-50'}" data-day="${di}" data-period="${pi}">${isBlocked ? 'x' : ''}</td>`;
        }
        gridHtml += '</tr>';
      }
      gridHtml += '</tbody></table></div><p class="text-[9px] text-gray-400 mt-1">赤いセル = 授業不可。クリックで切り替え</p>';
      inputHtml = gridHtml;
    } else if (f.type === 'hidden') {
      inputHtml = `<input name="${f.key}" type="hidden" value="${valStr}">`;
    } else {
      inputHtml = `<input name="${f.key}" type="${f.type || 'text'}" value="${valStr}"
        placeholder="${f.placeholder || ''}"
        class="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none">`;
    }
    const labelHtml = f.type === 'hidden' ? '' : `<label class="block text-[11px] font-semibold text-gray-600 mb-1">${f.label}</label>`;
    div.innerHTML = `${labelHtml}${inputHtml}`;
    body.appendChild(div);
  }

  // チェックボックスグループのクリックイベント
  body.querySelectorAll('[data-type="checkboxGroup"]').forEach(group => {
    group.addEventListener('click', e => {
      const label = e.target.closest('label');
      if (!label) return;
      const cb = label.querySelector('.cbg-input');
      if (!cb) return;
      // トグル見た目
      if (cb.checked) { label.classList.add('bg-primary-50','border-primary-300','text-primary-700'); label.classList.remove('bg-white','border-gray-200','text-gray-600'); }
      else { label.classList.remove('bg-primary-50','border-primary-300','text-primary-700'); label.classList.add('bg-white','border-gray-200','text-gray-600'); }
    });
  });

  // マルチセレクトのクリックイベント
  body.querySelectorAll('[data-type="multiSelect"]').forEach(group => {
    group.addEventListener('click', e => {
      const tag = e.target.closest('.ms-tag');
      if (!tag) return;
      const on = tag.classList.contains('bg-primary-500');
      if (on) { tag.classList.remove('bg-primary-500','text-white','border-primary-500'); tag.classList.add('bg-gray-100','text-gray-600','border-gray-200'); }
      else { tag.classList.add('bg-primary-500','text-white','border-primary-500'); tag.classList.remove('bg-gray-100','text-gray-600','border-gray-200'); }
    });
  });

  // periodGridのクリックイベント
  body.querySelectorAll('[data-type="periodGrid"]').forEach(grid => {
    grid.addEventListener('click', e => {
      const cell = e.target.closest('.pg-cell');
      if (!cell) return;
      const isBlocked = cell.classList.contains('bg-red-100');
      if (isBlocked) {
        cell.classList.remove('bg-red-100', 'text-red-600');
        cell.textContent = '';
      } else {
        cell.classList.add('bg-red-100', 'text-red-600');
        cell.textContent = 'x';
      }
    });
  });

  // トグルスイッチのラベル更新
  body.querySelectorAll('input[type="checkbox"]:not(.cbg-input):not(.sr-only)').forEach(cb => {
    cb.addEventListener('change', () => {
      const span = cb.closest('label')?.querySelector('span');
      if (span) span.textContent = cb.checked ? 'はい' : 'いいえ';
    });
  });

  overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');

  const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  /** フォームデータ収集 */
  function collectData() {
    const data = {};
    for (const f of fields) {
      if (f.type === 'toggle') {
        const cb = body.querySelector(`[name="${f.key}"]`);
        data[f.key] = cb?.checked ? 'true' : 'false';
      } else if (f.type === 'checkboxGroup') {
        const checked = body.querySelectorAll(`[data-name="${f.key}"] .cbg-input:checked`);
        data[f.key] = Array.from(checked).map(c => c.value).join(',');
      } else if (f.type === 'periodGrid') {
        // 赤いセル = 授業不可時限
        const blockedCells = body.querySelectorAll(`[data-name="${f.key}"] .pg-cell.bg-red-100`);
        data[f.key] = Array.from(blockedCells).map(c => `${c.dataset.day}-${c.dataset.period}`).join(',');
      } else if (f.multi) {
        const tags = body.querySelectorAll(`[data-name="${f.key}"] .ms-tag.bg-primary-500`);
        data[f.key] = Array.from(tags).map(t => t.dataset.value).join(',');
      } else {
        data[f.key] = body.querySelector(`[name="${f.key}"]`)?.value?.trim() ?? '';
      }
    }
    return data;
  }

  const wire = (id, fn) => {
    const el = document.getElementById(id);
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', fn);
  };
  wire('btn-modal-save', () => { onSave(collectData()); close(); document.removeEventListener('keydown', escHandler); });
  wire('btn-modal-cancel', () => { close(); document.removeEventListener('keydown', escHandler); });
  wire('btn-modal-close', () => { close(); document.removeEventListener('keydown', escHandler); });
}

// ─── 制約チェック結果 ───

export function showValidationResults(errors, warnings) {
  const el = document.getElementById('validation-results');
  if (!el) return {};
  const allErrors = (errors || []).map(e => ({ ...e, lv: 'error' }));
  const allWarnings = (warnings || []).map(w => ({ ...w, lv: 'warning' }));

  if (allErrors.length === 0 && allWarnings.length === 0) {
    el.innerHTML = `<div class="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
      <span class="text-lg">&#10003;</span>
      <div><div class="font-semibold">制約違反はありません</div><div class="text-emerald-500 mt-0.5">すべての制約条件を満たしています</div></div>
    </div>`;
    return {};
  }

  // 種類別にグループ化
  const groups = new Map();
  for (const item of [...allErrors, ...allWarnings]) {
    const key = item.type;
    if (!groups.has(key)) groups.set(key, { type: key, lv: item.lv, items: [] });
    const g = groups.get(key);
    if (item.lv === 'error') g.lv = 'error'; // 1つでもエラーがあればエラーグループ
    g.items.push(item);
  }

  // 説明文（ユーザーにやさしいガイド）
  const guides = {
    '教員重複': { icon: '&#9888;', desc: '同じ教員が同じ時間に複数のクラスに配置されています', action: '片方のコマを別の時間に移動するか、別の教員に変更してください' },
    '教室重複': { icon: '&#9888;', desc: '同じ教室が同じ時間に複数のクラスで使用されています', action: '片方のコマの教室を変更してください' },
    '同日同科目': { icon: '&#9888;', desc: '同じクラスで同じ日に同じ科目が複数回配置されています', action: 'コマを別の曜日に移動してください' },
    '出勤日外': { icon: '&#9888;', desc: '教員の出勤日ではない曜日にコマが配置されています', action: '別の曜日に移動するか、別の教員に変更してください' },
    '授業不可時限': { icon: '&#9888;', desc: '教員が授業できない時限にコマが配置されています', action: '別の時限に移動するか、別の教員に変更してください' },
    'クラス重複': { icon: '&#9888;', desc: '同じクラスの同じ時間に複数の授業が重なっています', action: '選択同時開講でなければ、片方を別の時間に移動してください' },
    '1日コマ数超過': { icon: '&#9888;', desc: '教員の1日あたりの授業コマ数が上限を超えています', action: '一部のコマを別の曜日に移動してください' },
    '連続コマ超過': { icon: '&#9888;', desc: '教員の連続授業コマ数が上限を超えています', action: '間に空きコマを入れてください' },
    '週時数不一致': { icon: '&#128203;', desc: '科目の週あたりコマ数が設定値と異なります', action: 'コマを追加または削除して調整してください' },
    'コース不一致': { icon: '&#128203;', desc: 'コース制限のある科目が対象外のクラスに配置されています', action: '科目を適切なコースのクラスに移動してください' },
    '学年不一致': { icon: '&#128203;', desc: '対象学年外のクラスに科目が配置されています', action: '科目を正しい学年のクラスに移動してください' },
    '必履修未配置': { icon: '&#128203;', desc: '必履修科目がまだ配置されていないクラスがあります', action: '該当クラスにコマを追加してください' },
  };

  // サマリー
  let html = `<div class="bg-white border border-gray-200 rounded-lg overflow-hidden">`;
  html += `<div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
    <div class="flex gap-3 text-xs font-semibold">`;
  if (allErrors.length > 0) html += `<span class="text-red-600 bg-red-100 px-2 py-0.5 rounded-full">エラー ${allErrors.length}件</span>`;
  if (allWarnings.length > 0) html += `<span class="text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">警告 ${allWarnings.length}件</span>`;
  html += `</div><div class="flex-1"></div>
    <button id="btn-toggle-warnings" class="text-[10px] text-gray-500 hover:text-gray-700">警告を${allWarnings.length > 10 ? '折りたたむ' : '表示'}</button>
  </div>`;

  // グループ別表示
  const DAY_JA = ['月','火','水','木','金','土'];
  let warningGroupsHtml = '';

  for (const [, group] of groups) {
    const guide = guides[group.type] || { icon: '&#8226;', desc: '', action: '' };
    const isError = group.lv === 'error';
    const borderColor = isError ? 'border-red-200' : 'border-amber-200';
    const bgColor = isError ? 'bg-red-50' : 'bg-amber-50';
    const textColor = isError ? 'text-red-700' : 'text-amber-700';
    const headerBg = isError ? 'bg-red-100' : 'bg-amber-100';

    const groupHtml = `<div class="border-b ${borderColor} last:border-b-0">
      <div class="flex items-center gap-2 px-4 py-2 ${headerBg} cursor-pointer group-toggle" data-type="${group.type}">
        <span class="text-sm">${guide.icon}</span>
        <span class="text-xs font-semibold ${textColor}">${group.type}</span>
        <span class="text-[10px] ${textColor} opacity-70">${group.items.length}件</span>
        <span class="text-[10px] ml-auto text-gray-400 toggle-arrow">▼</span>
      </div>
      <div class="group-body px-4 py-1.5 ${bgColor}" data-group="${group.type}">
        ${guide.desc ? `<p class="text-[10px] text-gray-500 mb-1.5">${guide.desc}</p>` : ''}
        ${guide.action ? `<p class="text-[10px] text-primary-600 mb-1.5">&#10132; ${guide.action}</p>` : ''}
        <div class="space-y-1">
          ${group.items.map(item => {
            const dayAttr = item.day != null ? ` data-day="${item.day}"` : '';
            const periodAttr = item.period != null ? ` data-period="${item.period}"` : '';
            const clickable = (item.day != null && item.period != null) ? ' cursor-pointer hover:bg-white/50 active:bg-white/80' : '';
            const location = (item.day != null && item.period != null) ? `<span class="font-mono text-[9px] ${isError ? 'bg-red-200' : 'bg-amber-200'} px-1 rounded mr-1">${DAY_JA[item.day] || item.day}${(item.period ?? 0) + 1}</span>` : '';
            return `<div class="text-[11px] ${textColor} py-0.5 px-1.5 rounded${clickable}"${dayAttr}${periodAttr}>${location}${item.message}</div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

    if (isError) {
      html += groupHtml;
    } else {
      warningGroupsHtml += groupHtml;
    }
  }

  // 警告は折りたたみ可能
  if (warningGroupsHtml) {
    html += `<div id="warning-groups">${warningGroupsHtml}</div>`;
  }

  html += `</div>`;
  el.innerHTML = html;

  // グループの折りたたみ
  el.querySelectorAll('.group-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const body = el.querySelector(`[data-group="${toggle.dataset.type}"]`);
      const arrow = toggle.querySelector('.toggle-arrow');
      if (body) {
        body.classList.toggle('hidden');
        if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▶' : '▼';
      }
    });
  });

  // 警告の一括折りたたみ
  document.getElementById('btn-toggle-warnings')?.addEventListener('click', () => {
    const wg = document.getElementById('warning-groups');
    if (wg) { wg.classList.toggle('hidden'); }
  });

  // セルへのジャンプ
  el.addEventListener('click', e => {
    const item = e.target.closest('[data-day][data-period]');
    if (!item || item.classList.contains('group-toggle')) return;
    const cell = document.querySelector(`.tt-cell[data-day="${item.dataset.day}"][data-period="${item.dataset.period}"]`);
    if (cell) {
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cell.classList.add('ring-2', 'ring-primary-500', 'ring-offset-1');
      setTimeout(() => cell.classList.remove('ring-2', 'ring-primary-500', 'ring-offset-1'), 2000);
    }
  });

  const map = {};
  for (const i of [...allErrors, ...allWarnings]) {
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
