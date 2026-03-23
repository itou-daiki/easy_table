/**
 * scheduler.js — 時間割自動生成・最適化エンジン
 *
 * Phase 1: 授業リスト生成（教員・教室の負荷分散割り当て）
 * Phase 2: 制約付き貪欲法（曜日分散・連続回避を考慮）
 * Phase 3: 焼きなまし法（同クラス内スワップ + 隣接スワップで効率的探索）
 */
import { validate, validateSlotPlacement } from './validator.js';

const DEFAULT_PERIODS = 6;
const DEFAULT_DAYS = [0, 1, 2, 3, 4];

function clone(s) { return JSON.parse(JSON.stringify(s)); }

// ─── Phase 1: 授業リスト生成（負荷分散型教員・教室割り当て） ───

function generateLessons(state) {
  const lessons = [];
  const classes = state.classes || [];
  const subjects = state.subjects || [];
  const teachers = state.teachers || [];
  const rooms = state.rooms || [];
  const existing = state.slots || [];

  // 既存割り当てマップ
  const assignMap = new Map();
  for (const sl of existing) {
    const k = `${sl.classId}|${sl.subjectId}`;
    if (!assignMap.has(k)) assignMap.set(k, { teacherId: sl.teacherId, roomId: sl.roomId, slotType: sl.slotType || 'single' });
  }

  // 教員ごとの現在担当コマ数（負荷分散用）
  const teacherLoad = new Map();
  for (const t of teachers) teacherLoad.set(t.id, 0);
  for (const sl of existing) {
    if (sl.teacherId) teacherLoad.set(sl.teacherId, (teacherLoad.get(sl.teacherId) || 0) + 1);
  }

  for (const cls of classes) {
    for (const subj of subjects) {
      if (subj.targetGrades?.length > 0 && !subj.targetGrades.includes(cls.grade)) continue;
      if (subj.courseRestriction && cls.course !== '共通' && cls.course !== '文理混合' && subj.courseRestriction !== cls.course) continue;

      const key = `${cls.id}|${subj.id}`;
      const assign = assignMap.get(key);
      let teacherId = assign?.teacherId;
      let roomId = assign?.roomId;
      const slotType = assign?.slotType || 'single';

      // 教員割り当て: 担当可能な教員の中で最も負荷の低い教員を選ぶ
      if (!teacherId) {
        const capable = teachers
          .filter(t => (t.subjects || []).includes(subj.id))
          .sort((a, b) => (teacherLoad.get(a.id) || 0) - (teacherLoad.get(b.id) || 0));
        if (capable.length === 0) continue;
        teacherId = capable[0].id;
      }
      // 割り当てた分の負荷を加算
      teacherLoad.set(teacherId, (teacherLoad.get(teacherId) || 0) + (subj.hoursPerWeek || 1));

      // 教室割り当て: 科目の教科に適した部屋を選ぶ
      if (!roomId) {
        if (subj.requiresSpecialRoom) {
          // 教科に基づいた教室マッチング
          const dept = (subj.department || '').toLowerCase();
          const specialRooms = rooms.filter(r => r.type === '特別教室' || r.type === '体育施設');
          const matched = specialRooms.find(r => {
            const rn = r.name.toLowerCase();
            if (dept.includes('理科') || dept === '理数') return rn.includes('実験') || rn.includes('理科');
            if (dept.includes('体育')) return rn.includes('体育') || rn.includes('グラウンド');
            if (dept.includes('芸術')) return rn.includes('音楽') || rn.includes('美術');
            if (dept.includes('家庭')) return rn.includes('家庭');
            if (dept.includes('情報')) return rn.includes('コンピュータ') || rn.includes('PC');
            return false;
          });
          roomId = matched?.id || specialRooms[0]?.id || rooms[0]?.id;
        } else {
          // クラス名に対応する普通教室
          const classRoom = rooms.find(r => r.type === '普通教室' && r.name?.includes(cls.name?.substring(0, 3)));
          roomId = classRoom?.id || rooms.find(r => r.type === '普通教室')?.id || rooms[0]?.id;
        }
      }

      if (!teacherId || !roomId) continue;

      lessons.push({
        classId: cls.id, subjectId: subj.id, teacherId, roomId,
        hoursPerWeek: subj.hoursPerWeek || 1,
        requiresSpecialRoom: subj.requiresSpecialRoom || false,
        slotType, department: subj.department || '',
      });
    }
  }
  return lessons;
}

/** 配置優先度ソート（制約が厳しい順） */
function sortByPriority(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.slotType === 'fixed' && b.slotType !== 'fixed') return -1;
    if (b.slotType === 'fixed' && a.slotType !== 'fixed') return 1;
    if (a.requiresSpecialRoom && !b.requiresSpecialRoom) return -1;
    if (b.requiresSpecialRoom && !a.requiresSpecialRoom) return 1;
    return (b.hoursPerWeek || 0) - (a.hoursPerWeek || 0);
  });
}

/** 曜日別コマ数対応のタイムスロット生成 */
function generateTimeSlots(state) {
  const defP = state.meta?.periodsPerDay || DEFAULT_PERIODS;
  const pByDay = state.meta?.periodsPerDayByDay || {};
  const days = state.meta?.workingDays || DEFAULT_DAYS;
  const slots = [];
  for (const day of days) {
    const p = Number(pByDay[day]) || defP;
    for (let i = 0; i < p; i++) slots.push({ day, period: i });
  }
  return slots;
}

function makeSlot(ts, lesson) {
  return { day: ts.day, period: ts.period, classId: lesson.classId, teacherId: lesson.teacherId, roomId: lesson.roomId, subjectId: lesson.subjectId, slotType: lesson.slotType || 'single' };
}

// ─── Phase 2: 制約付き貪欲法（分散配置） ───

/**
 * 候補枠をスコアリングして最適な枠を選ぶ
 * - 同日に同じ科目が少ない曜日を優先
 * - 同じ教員のコマが少ない曜日を優先
 * - 午前の早い時限を少し優先（実際の学校の傾向）
 */
function scoreCandidates(candidates, lesson, currentSlots) {
  const scores = candidates.map(ts => {
    let score = 0;
    // この曜日にこのクラス・科目が既にあれば減点（分散促進）
    const sameDaySameSubj = currentSlots.filter(s => s.classId === lesson.classId && s.subjectId === lesson.subjectId && s.day === ts.day).length;
    score -= sameDaySameSubj * 100;
    // この曜日にこの教員が既に何コマあるか（分散促進）
    const teacherDayLoad = currentSlots.filter(s => s.teacherId === lesson.teacherId && s.day === ts.day).length;
    score -= teacherDayLoad * 10;
    // この曜日にこのクラスが何コマあるか（曜日間均等化）
    const classDayLoad = currentSlots.filter(s => s.classId === lesson.classId && s.day === ts.day).length;
    score -= classDayLoad * 5;
    // 午前時限（0-3）を少し優先
    if (ts.period < 4) score += 2;
    // ランダムノイズ（同点回避）
    score += Math.random() * 3;
    return { ts, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.map(s => s.ts);
}

function greedyPlace(state, lessons, timeSlots, onProgress, totalHours) {
  const result = clone(state);
  let placed = 0, failed = 0;

  for (const lesson of lessons) {
    const hours = lesson.hoursPerWeek || 1;
    for (let h = 0; h < hours; h++) {
      const valid = timeSlots.filter(ts => validateSlotPlacement(result, makeSlot(ts, lesson)).valid);
      if (valid.length > 0) {
        const ranked = scoreCandidates(valid, lesson, result.slots);
        result.slots.push(makeSlot(ranked[0], lesson));
        placed++;
      } else {
        failed++;
      }
    }
    if (onProgress && placed % 10 === 0) {
      onProgress(Math.round((placed / totalHours) * 65), `配置中... ${placed}/${totalHours}`);
    }
  }
  return { state: result, placed, failed };
}

// ─── Phase 3: 焼きなまし法（改良版） ───

/** 多目的コスト関数 */
function computeCost(state) {
  const { errors, warnings } = validate(state);
  let cost = errors.length * 1000 + warnings.length * 10;

  const slots = state.slots || [];
  // 教員の曜日間負荷分散（標準偏差ペナルティ）
  const teacherDayMap = new Map();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = s.teacherId;
    if (!teacherDayMap.has(k)) teacherDayMap.set(k, new Map());
    const dm = teacherDayMap.get(k);
    dm.set(s.day, (dm.get(s.day) || 0) + 1);
  }
  for (const [, dayMap] of teacherDayMap) {
    const vals = [...dayMap.values()];
    if (vals.length < 2) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / vals.length;
    cost += Math.sqrt(variance) * 3; // 分散が大きいほどペナルティ
  }

  // 同日同科目ペナルティ（同じクラスで同日に同科目2コマは避けたい）
  const classDaySubj = new Map();
  for (const s of slots) {
    const k = `${s.classId}|${s.day}|${s.subjectId}`;
    classDaySubj.set(k, (classDaySubj.get(k) || 0) + 1);
  }
  for (const count of classDaySubj.values()) {
    if (count > 1) cost += (count - 1) * 5;
  }

  return cost;
}

/**
 * 近傍操作: 同クラス内の2コマを交換（教員・教室の制約を保持しやすい）
 * または、同教員の2コマの時間枠を交換
 */
function getNeighbor(state) {
  const ns = clone(state);
  const movable = ns.slots.map((s, i) => ({ ...s, _i: i })).filter(s => s.slotType !== 'fixed' && s.slotType !== 'meeting');
  if (movable.length < 2) return null;

  // 50%の確率で同クラス内スワップ、50%で同教員内スワップ
  const useClass = Math.random() < 0.5;
  const groupKey = useClass ? 'classId' : 'teacherId';
  const groups = new Map();
  for (const m of movable) {
    const k = m[groupKey];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  // 2コマ以上あるグループからランダムに選択
  const validGroups = [...groups.values()].filter(g => g.length >= 2);
  if (validGroups.length === 0) return null;

  const group = validGroups[Math.floor(Math.random() * validGroups.length)];
  const iA = Math.floor(Math.random() * group.length);
  let iB = Math.floor(Math.random() * (group.length - 1));
  if (iB >= iA) iB++;

  const a = ns.slots[group[iA]._i];
  const b = ns.slots[group[iB]._i];
  [a.day, a.period, b.day, b.period] = [b.day, b.period, a.day, a.period];

  return ns;
}

async function simulatedAnnealing(state, options = {}) {
  const maxIter = options.maxIterations || 5000;
  const initTemp = options.initialTemp || 50;
  const coolRate = options.coolingRate || 0.998;
  const onProgress = options.onProgress || null;
  const yieldInterval = 500; // この回数ごとにUIに制御を返す

  let cur = clone(state);
  let curCost = computeCost(cur);
  let best = clone(cur);
  let bestCost = curCost;
  let temp = initTemp;
  let accepted = 0;

  for (let i = 0; i < maxIter; i++) {
    // 定期的にUIに制御を返す
    if (i > 0 && i % yieldInterval === 0) {
      await new Promise(r => setTimeout(r, 0));
      if (onProgress) {
        onProgress(65 + Math.round((i / maxIter) * 35), `最適化中... コスト: ${bestCost.toFixed(0)} (${accepted}回改善)`);
      }
    }

    const neighbor = getNeighbor(cur);
    if (!neighbor) continue;

    // ハード制約違反があれば棄却（高速チェック）
    const { errors } = validate(neighbor);
    if (errors.length > 0) continue;

    const newCost = computeCost(neighbor);
    const delta = newCost - curCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      cur = neighbor;
      curCost = newCost;
      if (curCost < bestCost) {
        best = clone(cur);
        bestCost = curCost;
        accepted++;
      }
    }
    temp *= coolRate;
  }
  return best;
}

// ─── 公開API ───

export async function autoSchedule(state, options = {}) {
  const onProgress = options.onProgress || null;

  const base = clone(state);
  base.slots = base.slots.filter(s => s.slotType === 'fixed' || s.slotType === 'meeting');

  if (onProgress) onProgress(0, '授業リストを生成中...');

  const lessons = sortByPriority(generateLessons(state));
  const timeSlots = generateTimeSlots(state);
  const totalHours = lessons.reduce((sum, l) => sum + (l.hoursPerWeek || 1), 0);

  if (lessons.length === 0) {
    if (onProgress) onProgress(100, '配置する授業がありません');
    return base;
  }

  if (onProgress) onProgress(3, `${lessons.length}科目（計${totalHours}コマ）を配置...`);

  // Phase 2: 貪欲法
  const { state: greedy, placed, failed } = greedyPlace(base, lessons, timeSlots, onProgress, totalHours);
  await new Promise(r => setTimeout(r, 0));

  if (onProgress) onProgress(65, `${placed}コマ配置（${failed}コマ未配置）。最適化開始...`);

  // Phase 3: 焼きなまし法
  const optimized = await simulatedAnnealing(greedy, { ...options, onProgress });

  if (onProgress) onProgress(100, `完了: ${placed}コマ配置${failed > 0 ? `（${failed}コマ未配置）` : ''}`);
  return optimized;
}

export async function optimizeExisting(state, options = {}) {
  const onProgress = options.onProgress || null;
  if (onProgress) onProgress(0, '既存配置を最適化中...');
  const optimized = await simulatedAnnealing(state, {
    maxIterations: 8000, ...options,
    onProgress: (pct, msg) => { if (onProgress) onProgress(pct, msg); },
  });
  if (onProgress) onProgress(100, '最適化完了');
  return optimized;
}
