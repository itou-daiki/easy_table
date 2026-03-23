/**
 * scheduler.js — 時間割自動生成・最適化エンジン
 *
 * アルゴリズム:
 *   Phase 1: 授業リスト生成（負荷分散型教員・教室割り当て）
 *   Phase 2: マルチスタート制約付き貪欲法（複数初期解を生成）
 *   Phase 3: ハイブリッド最適化（焼きなまし法＋タブーサーチ＋適応的再加熱）
 *
 * NP困難問題のため真の最適解は保証できないが、マルチスタート＋多様な
 * 近傍操作＋再加熱により、実用的に十分な準最適解を算出する。
 */
import { validate, validateSlotPlacement } from './validator.js';

const DEFAULT_PERIODS = 6;
const DEFAULT_DAYS = [0, 1, 2, 3, 4];

function clone(s) { return JSON.parse(JSON.stringify(s)); }

// ═══════════════════════════════════════════
// Phase 1: 授業リスト生成
// ═══════════════════════════════════════════

function generateLessons(state) {
  const lessons = [];
  const classes = state.classes || [];
  const subjects = state.subjects || [];
  const teachers = state.teachers || [];
  const rooms = state.rooms || [];
  const existing = state.slots || [];

  const assignMap = new Map();
  for (const sl of existing) {
    const k = `${sl.classId}|${sl.subjectId}`;
    if (!assignMap.has(k)) assignMap.set(k, { teacherId: sl.teacherId, roomId: sl.roomId, slotType: sl.slotType || 'single' });
  }

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

      if (!teacherId) {
        const capable = teachers
          .filter(t => (t.subjects || []).includes(subj.id))
          .sort((a, b) => (teacherLoad.get(a.id) || 0) - (teacherLoad.get(b.id) || 0));
        if (capable.length === 0) continue;
        teacherId = capable[0].id;
      }
      teacherLoad.set(teacherId, (teacherLoad.get(teacherId) || 0) + (subj.hoursPerWeek || 1));

      if (!roomId) {
        if (subj.requiresSpecialRoom) {
          const dept = (subj.department || '').toLowerCase();
          const special = rooms.filter(r => r.type === '特別教室' || r.type === '体育施設');
          const matched = special.find(r => {
            const n = r.name.toLowerCase();
            if (dept.includes('理科') || dept === '理数') return n.includes('実験') || n.includes('理科');
            if (dept.includes('体育')) return n.includes('体育') || n.includes('グラウンド');
            if (dept.includes('芸術')) return n.includes('音楽') || n.includes('美術');
            if (dept.includes('家庭')) return n.includes('家庭');
            if (dept.includes('情報')) return n.includes('コンピュータ') || n.includes('PC');
            return false;
          });
          roomId = matched?.id || special[0]?.id || rooms[0]?.id;
        } else {
          const cr = rooms.find(r => r.type === '普通教室' && r.name?.includes(cls.name?.substring(0, 3)));
          roomId = cr?.id || rooms.find(r => r.type === '普通教室')?.id || rooms[0]?.id;
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

function sortByPriority(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.slotType === 'fixed' && b.slotType !== 'fixed') return -1;
    if (b.slotType === 'fixed' && a.slotType !== 'fixed') return 1;
    if (a.requiresSpecialRoom && !b.requiresSpecialRoom) return -1;
    if (b.requiresSpecialRoom && !a.requiresSpecialRoom) return 1;
    return (b.hoursPerWeek || 0) - (a.hoursPerWeek || 0);
  });
}

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

// ═══════════════════════════════════════════
// Phase 2: 制約付き貪欲法（スコアリング）
// ═══════════════════════════════════════════

function scoreCandidates(candidates, lesson, currentSlots, state) {
  const cc = state?.customConstraints || [];
  return candidates.map(ts => {
    let score = 0;
    const sameDaySubj = currentSlots.filter(s => s.classId === lesson.classId && s.subjectId === lesson.subjectId && s.day === ts.day).length;
    score -= sameDaySubj * 100;
    const tLoad = currentSlots.filter(s => s.teacherId === lesson.teacherId && s.day === ts.day).length;
    score -= tLoad * 10;
    const cLoad = currentSlots.filter(s => s.classId === lesson.classId && s.day === ts.day).length;
    score -= cLoad * 5;
    if (ts.period < 4) score += 2;
    for (const c of cc) {
      if (!c.enabled) continue;
      const p = c.params || {};
      if (c.type === 'avoid_period') {
        if (p.subjectId && p.subjectId !== lesson.subjectId) continue;
        if (p.teacherId && p.teacherId !== lesson.teacherId) continue;
        if ((p.day == null || p.day === ts.day) && (p.period == null || p.period === ts.period))
          score -= (c.level === 'hard' ? 500 : 50);
      } else if (c.type === 'prefer_period') {
        if (p.subjectId && p.subjectId !== lesson.subjectId) continue;
        if (p.preferredPeriods?.includes(ts.period)) score += 30; else score -= 15;
      } else if (c.type === 'max_subject_per_day') {
        if (p.subjectId && p.subjectId !== lesson.subjectId) continue;
        const dc = currentSlots.filter(s => s.classId === lesson.classId && s.subjectId === lesson.subjectId && s.day === ts.day).length;
        if (p.max && dc >= p.max) score -= 200;
      }
    }
    score += Math.random() * 3;
    return { ts, score };
  }).sort((a, b) => b.score - a.score).map(s => s.ts);
}

function greedyPlace(state, lessons, timeSlots) {
  const result = clone(state);
  let placed = 0, failed = 0;
  for (const lesson of lessons) {
    for (let h = 0; h < (lesson.hoursPerWeek || 1); h++) {
      const valid = timeSlots.filter(ts => validateSlotPlacement(result, makeSlot(ts, lesson)).valid);
      if (valid.length > 0) {
        result.slots.push(makeSlot(scoreCandidates(valid, lesson, result.slots, state)[0], lesson));
        placed++;
      } else { failed++; }
    }
  }
  return { state: result, placed, failed };
}

/**
 * Phase 2b: クラスの空きコマを埋める
 * 全科目配置後にまだ空きがあるクラスに対して、
 * 週時数に余裕のある科目を追加配置する
 */
function fillEmptySlots(state, origState) {
  const result = clone(state);
  const classes = origState.classes || [];
  const subjects = origState.subjects || [];
  const teachers = origState.teachers || [];
  const rooms = origState.rooms || [];
  const defP = origState.meta?.periodsPerDay || DEFAULT_PERIODS;
  const pByDay = origState.meta?.periodsPerDayByDay || {};
  const workingDays = origState.meta?.workingDays || DEFAULT_DAYS;
  let filled = 0;

  for (const cls of classes) {
    // このクラスの全コマ位置
    const allSlotPositions = [];
    for (const day of workingDays) {
      const periods = Number(pByDay[day]) || defP;
      for (let p = 0; p < periods; p++) allSlotPositions.push({ day, period: p });
    }

    // 現在配置済みのコマ位置
    const filledSet = new Set();
    for (const s of result.slots) {
      if (s.classId === cls.id) filledSet.add(`${s.day}|${s.period}`);
    }

    // 空きコマ
    const empties = allSlotPositions.filter(pos => !filledSet.has(`${pos.day}|${pos.period}`));
    if (empties.length === 0) continue;

    // このクラスに配置可能な科目リスト（学年・コース適合、週時数に余裕あり）
    const classSlots = result.slots.filter(s => s.classId === cls.id);
    const subjectHourCount = new Map();
    for (const s of classSlots) {
      subjectHourCount.set(s.subjectId, (subjectHourCount.get(s.subjectId) || 0) + 1);
    }

    // 追加配置候補: まだ週時数に達していない科目、または配置数が少ない科目
    const candidates = subjects
      .filter(subj => {
        if (subj.targetGrades?.length > 0 && !subj.targetGrades.includes(cls.grade)) return false;
        if (subj.courseRestriction && cls.course !== '共通' && cls.course !== '文理混合' && subj.courseRestriction !== cls.course) return false;
        return true;
      })
      .map(subj => {
        const current = subjectHourCount.get(subj.id) || 0;
        const target = subj.hoursPerWeek || 0;
        const deficit = target - current; // 正なら不足、0は充足、負は超過
        return { subj, current, target, deficit };
      })
      .filter(c => c.deficit > 0) // 不足している科目のみ
      .sort((a, b) => b.deficit - a.deficit); // 不足が大きい順

    for (const empty of empties) {
      if (candidates.length === 0) break;

      // 最も不足している科目から試行
      let placed = false;
      for (let ci = 0; ci < candidates.length; ci++) {
        const cand = candidates[ci];
        // 教員を探す
        const capable = teachers.filter(t => (t.subjects || []).includes(cand.subj.id));
        for (const teacher of capable) {
          // 教室を探す
          let roomId;
          if (cand.subj.requiresSpecialRoom) {
            const dept = (cand.subj.department || '').toLowerCase();
            const special = rooms.filter(r => r.type === '特別教室' || r.type === '体育施設');
            const matched = special.find(r => {
              const n = r.name.toLowerCase();
              if (dept.includes('理科') || dept === '理数') return n.includes('実験');
              if (dept.includes('体育')) return n.includes('体育') || n.includes('グラウンド');
              if (dept.includes('芸術')) return n.includes('音楽') || n.includes('美術');
              if (dept.includes('家庭')) return n.includes('家庭');
              if (dept.includes('情報')) return n.includes('コンピュータ') || n.includes('PC');
              return false;
            });
            roomId = matched?.id || special[0]?.id;
          } else {
            const cr = rooms.find(r => r.type === '普通教室' && r.name?.includes(cls.name?.substring(0, 3)));
            roomId = cr?.id || rooms.find(r => r.type === '普通教室')?.id;
          }
          if (!roomId) continue;

          const testSlot = {
            day: empty.day, period: empty.period,
            classId: cls.id, subjectId: cand.subj.id,
            teacherId: teacher.id, roomId, slotType: 'single',
          };

          if (validateSlotPlacement(result, testSlot).valid) {
            result.slots.push(testSlot);
            cand.deficit--;
            cand.current++;
            if (cand.deficit <= 0) candidates.splice(ci, 1);
            filled++;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
  }
  return { state: result, filled };
}

// ═══════════════════════════════════════════
// Phase 3: ハイブリッド最適化
//   焼きなまし法 + タブーサーチ + 適応的再加熱
// ═══════════════════════════════════════════

/** 多目的コスト関数（低い=良い） */
function computeCost(state) {
  const { errors, warnings } = validate(state);
  let cost = errors.length * 10000 + warnings.length * 10;
  const slots = state.slots || [];

  // 教員の曜日間負荷の標準偏差
  const tdm = new Map();
  for (const s of slots) {
    if (!s.teacherId) continue;
    if (!tdm.has(s.teacherId)) tdm.set(s.teacherId, new Map());
    const dm = tdm.get(s.teacherId);
    dm.set(s.day, (dm.get(s.day) || 0) + 1);
  }
  for (const [, dm] of tdm) {
    const v = [...dm.values()];
    if (v.length < 2) continue;
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    cost += Math.sqrt(v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length) * 5;
  }

  // 同日同科目ペナルティ
  const cds = new Map();
  for (const s of slots) {
    const k = `${s.classId}|${s.day}|${s.subjectId}`;
    cds.set(k, (cds.get(k) || 0) + 1);
  }
  for (const c of cds.values()) if (c > 1) cost += (c - 1) * 8;

  // 教員の連続コマを少しペナルティ（空き時間確保）
  for (const [, dm] of tdm) {
    for (const [, count] of dm) {
      if (count > 4) cost += (count - 4) * 3;
    }
  }

  // クラスの空きコマペナルティ（重い: 空きコマは基本的に許容しない）
  const defP = state.meta?.periodsPerDay || 6;
  const pByDay = state.meta?.periodsPerDayByDay || {};
  const wDays = state.meta?.workingDays || [0,1,2,3,4];
  const classFilledMap = new Map();
  for (const s of slots) {
    if (!s.classId) continue;
    classFilledMap.set(`${s.classId}|${s.day}|${s.period}`, true);
  }
  for (const cls of state.classes || []) {
    for (const day of wDays) {
      const periods = Number(pByDay[day]) || defP;
      for (let p = 0; p < periods; p++) {
        if (!classFilledMap.has(`${cls.id}|${day}|${p}`)) {
          cost += 50; // 空きコマ1つにつき重いペナルティ
        }
      }
    }
  }

  return cost;
}

/** 近傍操作を多様化（3種類） */
function getNeighbor(state, moveType) {
  const ns = clone(state);
  const movable = ns.slots.map((s, i) => ({ ...s, _i: i })).filter(s => s.slotType !== 'fixed' && s.slotType !== 'meeting');
  if (movable.length < 2) return null;

  if (moveType === 0) {
    // (A) 同クラス内スワップ
    return groupSwap(ns, movable, 'classId');
  } else if (moveType === 1) {
    // (B) 同教員内スワップ
    return groupSwap(ns, movable, 'teacherId');
  } else {
    // (C) 3コマ循環交換（A→B, B→C, C→A）
    return tripleRotate(ns, movable);
  }
}

function groupSwap(ns, movable, key) {
  const groups = new Map();
  for (const m of movable) {
    const k = m[key];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const valid = [...groups.values()].filter(g => g.length >= 2);
  if (valid.length === 0) return null;
  const g = valid[Math.floor(Math.random() * valid.length)];
  const iA = Math.floor(Math.random() * g.length);
  let iB = Math.floor(Math.random() * (g.length - 1));
  if (iB >= iA) iB++;
  const a = ns.slots[g[iA]._i], b = ns.slots[g[iB]._i];
  [a.day, a.period, b.day, b.period] = [b.day, b.period, a.day, a.period];
  return ns;
}

function tripleRotate(ns, movable) {
  if (movable.length < 3) return null;
  const pick = () => movable[Math.floor(Math.random() * movable.length)];
  const a = pick();
  let b = pick(); while (b._i === a._i) b = pick();
  let c = pick(); while (c._i === a._i || c._i === b._i) c = pick();
  const sa = ns.slots[a._i], sb = ns.slots[b._i], sc = ns.slots[c._i];
  const [ad, ap] = [sa.day, sa.period];
  sa.day = sc.day; sa.period = sc.period;
  sc.day = sb.day; sc.period = sb.period;
  sb.day = ad; sb.period = ap;
  return ns;
}

/** タブーリスト（直近の操作を記憶して循環回避） */
class TabuList {
  constructor(size = 50) { this.list = []; this.size = size; }
  add(key) { this.list.push(key); if (this.list.length > this.size) this.list.shift(); }
  has(key) { return this.list.includes(key); }
}

function stateKey(state) {
  // 軽量ハッシュ: スロットのday+period+classIdの組み合わせ
  return (state.slots || []).map(s => `${s.day}${s.period}${s.classId}`).sort().join('');
}

/**
 * ハイブリッド最適化（焼きなまし法＋タブーサーチ＋適応的再加熱）
 */
async function hybridOptimize(state, options = {}) {
  const maxIter = options.maxIterations || 12000;
  const initTemp = options.initialTemp || 80;
  const coolRate = 0.9985;
  const reheatThreshold = 800; // この回数改善なしなら再加熱
  const onProgress = options.onProgress || null;
  const yieldInterval = 400;
  const tabu = new TabuList(30);

  let cur = clone(state);
  let curCost = computeCost(cur);
  let best = clone(cur);
  let bestCost = curCost;
  let temp = initTemp;
  let sinceLastImprove = 0;
  let totalAccepted = 0;
  let reheats = 0;

  for (let i = 0; i < maxIter; i++) {
    if (i > 0 && i % yieldInterval === 0) {
      await new Promise(r => setTimeout(r, 0));
      if (onProgress) {
        const pct = options.pctBase != null
          ? options.pctBase + Math.round((i / maxIter) * options.pctRange)
          : Math.round((i / maxIter) * 100);
        onProgress(pct, `最適化中... コスト:${bestCost.toFixed(0)} 改善:${totalAccepted} 再加熱:${reheats}`);
      }
    }

    // 近傍操作を確率的に選択（多様化）
    const moveType = Math.random() < 0.15 ? 2 : (Math.random() < 0.5 ? 0 : 1);
    const neighbor = getNeighbor(cur, moveType);
    if (!neighbor) continue;

    // タブーチェック
    const nKey = stateKey(neighbor);
    if (tabu.has(nKey)) continue;

    const { errors } = validate(neighbor);
    if (errors.length > 0) continue;

    const newCost = computeCost(neighbor);
    const delta = newCost - curCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      tabu.add(stateKey(cur));
      cur = neighbor;
      curCost = newCost;
      if (curCost < bestCost) {
        best = clone(cur);
        bestCost = curCost;
        totalAccepted++;
        sinceLastImprove = 0;
      } else {
        sinceLastImprove++;
      }
    } else {
      sinceLastImprove++;
    }

    temp *= coolRate;

    // 適応的再加熱: 長時間改善がなければ温度を上げて探索を再開
    if (sinceLastImprove >= reheatThreshold) {
      temp = initTemp * 0.5;
      sinceLastImprove = 0;
      reheats++;
      // ベスト解から再スタート（局所解脱出）
      cur = clone(best);
      curCost = bestCost;
    }
  }
  return best;
}

// ═══════════════════════════════════════════
// 公開API
// ═══════════════════════════════════════════

/**
 * 一括自動配置: マルチスタート戦略で複数の初期解を生成し、
 * それぞれを最適化して最良解を採用する
 */
export async function autoSchedule(state, options = {}) {
  const onProgress = options.onProgress || null;
  const NUM_STARTS = 3; // マルチスタート回数

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

  if (onProgress) onProgress(2, `${lessons.length}科目（計${totalHours}コマ）× ${NUM_STARTS}回試行`);

  let globalBest = null;
  let globalBestCost = Infinity;

  for (let run = 0; run < NUM_STARTS; run++) {
    const runPctBase = Math.round((run / NUM_STARTS) * 90);
    const runPctRange = Math.round(90 / NUM_STARTS);

    if (onProgress) onProgress(runPctBase, `試行 ${run + 1}/${NUM_STARTS}: 配置中...`);

    // 貪欲法で初期解を生成（ランダム性があるので毎回異なる解）
    const { state: greedy, placed, failed } = greedyPlace(base, lessons, timeSlots);
    await new Promise(r => setTimeout(r, 0));

    // 空きコマ補完: 不足科目で空きを埋める
    const { state: filled, filled: filledCount } = fillEmptySlots(greedy, state);
    await new Promise(r => setTimeout(r, 0));

    if (onProgress) onProgress(runPctBase + 5, `試行 ${run + 1}: ${placed + filledCount}コマ配置（補完${filledCount}）。最適化中...`);

    // ハイブリッド最適化
    const iterPerRun = Math.round(12000 / NUM_STARTS);
    const optimized = await hybridOptimize(filled, {
      maxIterations: iterPerRun,
      onProgress: (pct, msg) => {
        if (onProgress) onProgress(runPctBase + 5 + Math.round(pct * runPctRange / 100), `試行${run + 1}: ${msg}`);
      },
      pctBase: 0, pctRange: 100,
    });

    const cost = computeCost(optimized);
    if (cost < globalBestCost) {
      globalBest = optimized;
      globalBestCost = cost;
    }
  }

  if (onProgress) onProgress(95, `${NUM_STARTS}回の試行から最良解を選択中...`);

  // 最良解に対して追加の仕上げ最適化
  const final = await hybridOptimize(globalBest, {
    maxIterations: 3000,
    initialTemp: 20,
    onProgress: (pct, msg) => { if (onProgress) onProgress(95 + Math.round(pct * 5 / 100), `仕上げ: ${msg}`); },
    pctBase: 0, pctRange: 100,
  });

  const { errors, warnings } = validate(final);
  if (onProgress) onProgress(100, `完了（エラー${errors.length} 警告${warnings.length} コスト${computeCost(final).toFixed(0)}）`);
  return final;
}

/**
 * 既存配置の最適化: 現在の配置を保持したままハイブリッド最適化を実行
 */
export async function optimizeExisting(state, options = {}) {
  const onProgress = options.onProgress || null;
  if (onProgress) onProgress(0, '既存配置を最適化中...');

  const optimized = await hybridOptimize(state, {
    maxIterations: 15000,
    initialTemp: 60,
    onProgress: (pct, msg) => { if (onProgress) onProgress(pct, msg); },
    pctBase: 0, pctRange: 100,
  });

  const { errors, warnings } = validate(optimized);
  if (onProgress) onProgress(100, `完了（エラー${errors.length} 警告${warnings.length} コスト${computeCost(optimized).toFixed(0)}）`);
  return optimized;
}
