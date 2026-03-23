/**
 * scheduler.js — 時間割自動生成・最適化エンジン
 * 貪欲法（メイン）＋焼きなまし法（最適化）
 */
import { validate, validateSlotPlacement } from './validator.js';

const DEFAULT_PERIODS_PER_DAY = 6;
const DEFAULT_DAYS = [0, 1, 2, 3, 4];
const MAX_SA_ITERATIONS = 3000;

function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

/**
 * 科目×クラスから配置すべき授業リストを生成する
 * コース制限・学年制限でフィルタし、必要な組み合わせのみ生成
 */
function generateLessons(state) {
  const lessons = [];
  const classes = state.classes || [];
  const subjects = state.subjects || [];
  const teachers = state.teachers || [];
  const rooms = state.rooms || [];
  const existingSlots = state.slots || [];

  // 既存スロットからの割り当てマップ
  const assignMap = new Map();
  for (const sl of existingSlots) {
    const k = `${sl.classId}|${sl.subjectId}`;
    if (!assignMap.has(k)) assignMap.set(k, { teacherId: sl.teacherId, roomId: sl.roomId, slotType: sl.slotType || 'single' });
  }

  for (const cls of classes) {
    for (const subj of subjects) {
      // 学年フィルタ
      if (subj.targetGrades?.length > 0 && !subj.targetGrades.includes(cls.grade)) continue;
      // コース制限フィルタ
      if (subj.courseRestriction && cls.course !== '共通' && cls.course !== '文理混合' && subj.courseRestriction !== cls.course) continue;

      const key = `${cls.id}|${subj.id}`;
      const assign = assignMap.get(key);
      let teacherId = assign?.teacherId;
      let roomId = assign?.roomId;
      const slotType = assign?.slotType || 'single';

      // 教員自動割り当て
      if (!teacherId) {
        const capable = teachers.find(t => (t.subjects || []).includes(subj.id));
        if (!capable) continue;
        teacherId = capable.id;
      }

      // 教室自動割り当て
      if (!roomId) {
        if (subj.requiresSpecialRoom) {
          const special = rooms.find(r => r.type === '特別教室' || r.type === '体育施設');
          roomId = special?.id || rooms[0]?.id;
        } else {
          const classRoom = rooms.find(r => r.name?.includes(cls.name?.substring(0, 3)));
          roomId = classRoom?.id || rooms[0]?.id;
        }
      }

      if (!teacherId || !roomId) continue;

      lessons.push({
        classId: cls.id, subjectId: subj.id, teacherId, roomId,
        hoursPerWeek: subj.hoursPerWeek || 1,
        requiresSpecialRoom: subj.requiresSpecialRoom || false,
        slotType,
        isElective: slotType === 'elective' || slotType === 'course',
        isTeamTeaching: slotType === 'team_teaching',
        isDouble: slotType === 'double',
      });
    }
  }
  return lessons;
}

/** 配置優先度順にソート */
function sortByPriority(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.slotType === 'fixed' && b.slotType !== 'fixed') return -1;
    if (b.slotType === 'fixed' && a.slotType !== 'fixed') return 1;
    if (a.requiresSpecialRoom && !b.requiresSpecialRoom) return -1;
    if (b.requiresSpecialRoom && !a.requiresSpecialRoom) return 1;
    if (a.isElective && !b.isElective) return -1;
    if (b.isElective && !a.isElective) return 1;
    return (b.hoursPerWeek || 0) - (a.hoursPerWeek || 0);
  });
}

/** (day, period) の組み合わせ生成（曜日別コマ数対応） */
function generateTimeSlots(state) {
  const defaultPeriods = state.meta?.periodsPerDay || DEFAULT_PERIODS_PER_DAY;
  const pByDay = state.meta?.periodsPerDayByDay || {};
  const days = state.meta?.workingDays || DEFAULT_DAYS;
  const slots = [];
  for (const day of days) {
    const periods = Number(pByDay[day]) || defaultPeriods;
    for (let p = 0; p < periods; p++) slots.push({ day, period: p });
  }
  return slots;
}

function makeSlot(ts, lesson) {
  return {
    day: ts.day, period: ts.period,
    classId: lesson.classId, teacherId: lesson.teacherId,
    roomId: lesson.roomId, subjectId: lesson.subjectId,
    slotType: lesson.slotType || 'single',
  };
}

/** 配置可能な時間枠を絞り込む */
function getCandidates(state, lesson, timeSlots) {
  return timeSlots.filter(ts => validateSlotPlacement(state, makeSlot(ts, lesson)).valid);
}

/**
 * 貪欲法で授業を配置する（高速・確実）
 * 各授業を配置可能な枠のうち最も制約の少ない枠に配置
 */
function greedyPlace(state, lessons, timeSlots, onProgress, totalLessons) {
  const result = cloneState(state);
  let placed = 0;
  let failed = 0;

  for (const lesson of lessons) {
    const hours = lesson.hoursPerWeek || 1;
    for (let h = 0; h < hours; h++) {
      const candidates = getCandidates(result, lesson, timeSlots);
      if (candidates.length > 0) {
        // ランダム性を加えて多様な配置を生成
        const idx = Math.floor(Math.random() * Math.min(3, candidates.length));
        result.slots.push(makeSlot(candidates[idx], lesson));
        placed++;
      } else {
        failed++;
      }
    }
    if (onProgress && placed % 5 === 0) {
      onProgress(Math.round((placed / totalLessons) * 70), `配置中... ${placed}/${totalLessons}`);
    }
  }

  return { state: result, placed, failed };
}

/** ソフト制約違反コスト */
function computeCost(state) { return validate(state).warnings.length; }

/**
 * 焼きなまし法による最適化
 */
function simulatedAnnealing(state, options = {}) {
  const maxIter = options.maxIterations || MAX_SA_ITERATIONS;
  const initialTemp = options.initialTemp || 80;
  const coolingRate = options.coolingRate || 0.997;
  const onProgress = options.onProgress || null;

  let cur = cloneState(state);
  let curCost = computeCost(cur);
  let best = cloneState(cur);
  let bestCost = curCost;
  let temp = initialTemp;

  const movable = cur.slots.map((s, i) => ({ ...s, _idx: i })).filter(s => s.slotType !== 'fixed');
  if (movable.length < 2) return best;

  for (let i = 0; i < maxIter; i++) {
    const idxA = Math.floor(Math.random() * movable.length);
    let idxB = Math.floor(Math.random() * (movable.length - 1));
    if (idxB >= idxA) idxB++;

    const ns = cloneState(cur);
    const a = ns.slots[movable[idxA]._idx];
    const b = ns.slots[movable[idxB]._idx];
    if (!a || !b) continue;
    [a.day, a.period, b.day, b.period] = [b.day, b.period, a.day, a.period];

    if (validate(ns).errors.length > 0) continue;

    const newCost = computeCost(ns);
    const delta = newCost - curCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      cur = ns;
      curCost = newCost;
      // movableのインデックスを更新
      movable.forEach((m, mi) => {
        const s = cur.slots[m._idx];
        if (s) { movable[mi] = { ...s, _idx: m._idx }; }
      });
      if (curCost < bestCost) { best = cloneState(cur); bestCost = curCost; }
    }
    temp *= coolingRate;

    if (onProgress && i % 200 === 0) {
      onProgress(70 + Math.round((i / maxIter) * 30), `最適化中... コスト: ${bestCost}`);
    }
  }
  return best;
}

/** 非同期ラッパー（UIブロック防止） */
function runAsync(fn) {
  return new Promise(resolve => setTimeout(() => resolve(fn()), 0));
}

/**
 * 自動スケジュール生成
 */
export async function autoSchedule(state, options = {}) {
  const onProgress = options.onProgress || null;

  const base = cloneState(state);
  base.slots = base.slots.filter(s => s.slotType === 'fixed');

  if (onProgress) onProgress(0, '初期化中...');

  const lessons = sortByPriority(generateLessons(state));
  const timeSlots = generateTimeSlots(state);
  const totalHours = lessons.reduce((sum, l) => sum + (l.hoursPerWeek || 1), 0);

  if (lessons.length === 0) {
    if (onProgress) onProgress(100, '配置する授業がありません');
    return base;
  }

  if (onProgress) onProgress(2, `${lessons.length}科目（計${totalHours}コマ）を配置します...`);

  // 貪欲法で配置
  const { state: greedy, placed, failed } = await runAsync(() =>
    greedyPlace(base, lessons, timeSlots, onProgress, totalHours)
  );

  if (onProgress) onProgress(70, `${placed}コマ配置完了（${failed}コマ未配置）。最適化中...`);

  // 焼きなまし法で最適化
  const optimized = await runAsync(() => simulatedAnnealing(greedy, { ...options, onProgress }));

  if (onProgress) onProgress(100, `完了: ${placed}コマ配置${failed > 0 ? `（${failed}コマ未配置）` : ''}`);
  return optimized;
}

/**
 * 既存スケジュールの最適化
 */
export async function optimizeExisting(state, options = {}) {
  const onProgress = options.onProgress || null;
  if (onProgress) onProgress(0, '最適化を開始...');

  const optimized = await runAsync(() => simulatedAnnealing(state, {
    ...options,
    onProgress: (pct, msg) => { if (onProgress) onProgress(pct, msg); },
  }));
  if (onProgress) onProgress(100, '最適化完了');
  return optimized;
}
