/**
 * scheduler.js — 時間割自動生成・最適化エンジン
 * バックトラッキング＋制約伝播 → 焼きなまし法によるスケジューリング
 */
import { validate, validateSlotPlacement } from "./validator.js";

const DAYS = ["月", "火", "水", "木", "金"];
const DEFAULT_MAX_PERIODS = 6;

/** 配置優先度順にソート（制約の厳しい順） */
function sortByPriority(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.slotType === "fixed" && b.slotType !== "fixed") return -1;
    if (b.slotType === "fixed" && a.slotType !== "fixed") return 1;
    if (a.requiresSpecialRoom && !b.requiresSpecialRoom) return -1;
    if (b.requiresSpecialRoom && !a.requiresSpecialRoom) return 1;
    if (a.isElective && !b.isElective) return -1;
    if (b.isElective && !a.isElective) return 1;
    if ((a.isTeamTeaching || a.isDouble) && !(b.isTeamTeaching || b.isDouble)) return -1;
    if ((b.isTeamTeaching || b.isDouble) && !(a.isTeamTeaching || a.isDouble)) return 1;
    return (b.hoursPerWeek || 0) - (a.hoursPerWeek || 0);
  });
}

/** 利用可能な(day, period)の組み合わせを生成 */
function generateTimeSlots(state) {
  const max = state.maxPeriods || DEFAULT_MAX_PERIODS;
  const slots = [];
  for (const day of DAYS) for (let p = 1; p <= max; p++) slots.push({ day, period: p });
  return slots;
}

/** stateのディープコピー */
function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

/** スロット候補オブジェクトを生成 */
function makeSlot(ts, lesson, type = "auto") {
  return {
    day: ts.day, period: ts.period, classId: lesson.classId,
    teacherId: lesson.teacherId, roomId: lesson.roomId,
    subjectId: lesson.subjectId, slotType: type,
  };
}

/** 制約伝播: 配置可能な時間枠を絞り込む */
function propagateConstraints(state, lesson, timeSlots) {
  return timeSlots.filter(ts => validateSlotPlacement(state, makeSlot(ts, lesson)).valid);
}

/**
 * バックトラッキングで授業を配置する
 * @returns {object|null} 成功時は新しいstate、失敗時はnull
 */
function backtrack(state, lessons, timeSlots, onProgress, totalLessons) {
  if (lessons.length === 0) return state;

  const [current, ...remaining] = lessons;
  const hoursNeeded = current.hoursPerWeek || 1;

  // 固定スロットはそのまま配置
  if (current.slotType === "fixed" && current.day && current.period) {
    const slot = makeSlot(current, current, "fixed");
    if (!validateSlotPlacement(state, slot).valid) return null;
    const ns = cloneState(state);
    ns.slots.push(slot);
    return backtrack(ns, remaining, timeSlots, onProgress, totalLessons);
  }

  // 制約伝播で候補を絞り込む
  const candidates = propagateConstraints(state, current, timeSlots);
  if (candidates.length < hoursNeeded) return null;

  for (const ts of candidates) {
    const slot = makeSlot(ts, current);
    if (!validateSlotPlacement(state, slot).valid) continue;

    const ns = cloneState(state);
    ns.slots.push(slot);

    // 残り時数がある場合は同じ授業を再度キューに入れる
    if (hoursNeeded > 1) {
      const reduced = { ...current, hoursPerWeek: hoursNeeded - 1 };
      const result = backtrack(ns, [reduced, ...remaining], timeSlots, onProgress, totalLessons);
      if (result) return result;
    } else {
      if (onProgress) {
        const placed = totalLessons - remaining.length;
        onProgress(Math.round((placed / totalLessons) * 80), `配置中... (${placed}/${totalLessons})`);
      }
      const result = backtrack(ns, remaining, timeSlots, onProgress, totalLessons);
      if (result) return result;
    }
  }
  return null;
}

/** ソフト制約違反をコストとして計算 */
function computeCost(state) { return validate(state).warnings.length; }

/**
 * 焼きなまし法による最適化
 * ソフト制約の違反数をコストとして最小化する
 */
function simulatedAnnealing(state, options = {}) {
  const maxIter = options.maxIterations || 5000;
  const initialTemp = options.initialTemp || 100;
  const coolingRate = options.coolingRate || 0.995;
  const onProgress = options.onProgress || null;

  let cur = cloneState(state);
  let curCost = computeCost(cur);
  let best = cloneState(cur);
  let bestCost = curCost;
  let temp = initialTemp;

  for (let i = 0; i < maxIter; i++) {
    // 非固定スロットからランダムに2つ選んで時間枠を交換
    const movable = cur.slots.map((s, idx) => ({ ...s, _idx: idx })).filter(s => s.slotType !== "fixed");
    if (movable.length < 2) break;

    const idxA = Math.floor(Math.random() * movable.length);
    let idxB = Math.floor(Math.random() * (movable.length - 1));
    if (idxB >= idxA) idxB++;

    const ns = cloneState(cur);
    const a = ns.slots[movable[idxA]._idx];
    const b = ns.slots[movable[idxB]._idx];
    [a.day, a.period, b.day, b.period] = [b.day, b.period, a.day, a.period];

    // ハード制約違反があれば棄却
    if (validate(ns).errors.length > 0) continue;

    const newCost = computeCost(ns);
    const delta = newCost - curCost;

    // メトロポリス基準で受理判定
    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      cur = ns;
      curCost = newCost;
      if (curCost < bestCost) { best = cloneState(cur); bestCost = curCost; }
    }
    temp *= coolingRate;

    // 進捗報告（80%〜100%の範囲）
    if (onProgress && i % 100 === 0) {
      onProgress(80 + Math.round((i / maxIter) * 20), `最適化中... (コスト: ${bestCost})`);
    }
  }
  return best;
}

/** UIブロッキング防止の非同期ラッパー */
function runAsync(fn) {
  return new Promise(resolve => setTimeout(() => resolve(fn()), 0));
}

/**
 * 自動スケジュール生成
 * 非固定スロットをクリアし、優先度順にバックトラッキングで配置。
 * 解が見つからない場合は貪欲法＋焼きなまし法にフォールバック。
 * @param {object} state - 現在の状態
 * @param {object} options - { onProgress?, maxIterations?, initialTemp?, coolingRate? }
 * @returns {Promise<object>} 新しい状態
 */
export async function autoSchedule(state, options = {}) {
  const onProgress = options.onProgress || null;

  // 非固定スロットをクリア
  const base = cloneState(state);
  base.slots = base.slots.filter(s => s.slotType === "fixed");

  if (onProgress) onProgress(0, "初期化中...");
  const lessons = sortByPriority(state.lessons || []);
  const timeSlots = generateTimeSlots(state);
  if (onProgress) onProgress(5, "バックトラッキング開始...");

  // バックトラッキングで配置を試行
  const result = await runAsync(() => backtrack(base, lessons, timeSlots, onProgress, lessons.length));

  if (result) {
    if (onProgress) onProgress(80, "最適化フェーズ開始...");
    const optimized = await runAsync(() => simulatedAnnealing(result, { ...options, onProgress }));
    if (onProgress) onProgress(100, "完了");
    return optimized;
  }

  // フォールバック: 貪欲法で部分配置
  if (onProgress) onProgress(50, "バックトラッキング失敗。貪欲法で再試行...");
  const greedy = cloneState(base);
  for (const lesson of lessons) {
    const hours = lesson.hoursPerWeek || 1;
    for (let h = 0; h < hours; h++) {
      const cands = propagateConstraints(greedy, lesson, timeSlots);
      if (cands.length > 0) greedy.slots.push(makeSlot(cands[0], lesson));
    }
  }

  // 焼きなまし法で最適化
  const optimized = await runAsync(() => simulatedAnnealing(greedy, { ...options, onProgress }));
  if (onProgress) onProgress(100, "完了（部分解）");
  return optimized;
}

/**
 * 既存スケジュールの最適化（焼きなまし法）
 * @param {object} state - 既存の状態
 * @param {object} options - { onProgress?, maxIterations?, initialTemp?, coolingRate? }
 * @returns {Promise<object>} 最適化された状態
 */
export async function optimizeExisting(state, options = {}) {
  const onProgress = options.onProgress || null;
  if (onProgress) onProgress(0, "既存スケジュールの最適化を開始...");

  const optimized = await runAsync(() => simulatedAnnealing(state, {
    ...options,
    onProgress: (pct, msg) => {
      if (onProgress) onProgress(Math.max(0, Math.round((pct - 80) * 5)), msg);
    },
  }));
  if (onProgress) onProgress(100, "最適化完了");
  return optimized;
}
