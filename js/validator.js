/**
 * validator.js — 時間割制約チェッカー
 * ハード制約（エラー）とソフト制約（警告）を検証する
 */

// ヘルパー: スロット・教員・科目の取得
function getSlots(state) { return state.slots || []; }

function getTeacherMap(state) {
  const m = new Map();
  for (const t of state.teachers || []) m.set(t.id, t);
  return m;
}

function getSubjectMap(state) {
  const m = new Map();
  for (const s of state.subjects || []) m.set(s.id, s);
  return m;
}

/** グループ化ヘルパー */
function groupBy(slots, keyFn) {
  const map = new Map();
  for (const s of slots) {
    const k = keyFn(s);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return map;
}

/** エラーオブジェクト生成 */
function err(type, message, s) {
  return { type, message, day: s.day, period: s.period, classId: s.classId, teacherId: s.teacherId, roomId: s.roomId };
}

const DAY_JA = ['月','火','水','木','金'];
function dayPeriodStr(day, period) { return `${DAY_JA[day] ?? day}曜${(period ?? 0) + 1}限`; }

/** ハード制約を検証する */
function checkHardConstraints(slots, teacherMap) {
  const errors = [];

  // 1. 教員重複
  const byTeacher = groupBy(slots, s => s.teacherId ? `${s.day}-${s.period}-${s.teacherId}` : null);
  for (const [, g] of byTeacher) {
    if (g.length > 1) {
      const s = g[0];
      const name = teacherMap.get(s.teacherId)?.name || s.teacherId;
      errors.push(err("教員重複", `${name}が${dayPeriodStr(s.day, s.period)}に複数配置されています`, s));
    }
  }

  // 2. 教室重複
  const byRoom = groupBy(slots, s => s.roomId ? `${s.day}-${s.period}-${s.roomId}` : null);
  for (const [, g] of byRoom) {
    if (g.length > 1) {
      const s = g[0];
      errors.push(err("教室重複", `教室が${dayPeriodStr(s.day, s.period)}に複数使用されています`, s));
    }
  }

  // 3. 同日同科目重複
  const byClassDaySub = groupBy(slots, s => (s.classId && s.subjectId) ? `${s.classId}-${s.day}-${s.subjectId}` : null);
  for (const [, g] of byClassDaySub) {
    if (g.length > 1) {
      const s = g[0];
      errors.push(err("同日同科目重複", `クラス${s.classId}の${s.subjectId}が${s.day}曜に複数回配置されています`, s));
    }
  }

  // 4. 出勤日外
  for (const s of slots) {
    if (!s.teacherId) continue;
    const t = teacherMap.get(s.teacherId);
    if (t?.availableDays && !t.availableDays.includes(s.day)) {
      errors.push(err("出勤日外", `教員${t?.name || s.teacherId}は${['月','火','水','木','金'][s.day] || s.day}曜が出勤日ではありません`, s));
    }
  }

  // 5. クラスの同時限重複（同じクラスが同時に2つの授業）
  const byClassTime = groupBy(slots, s => s.classId ? `${s.classId}|${s.day}|${s.period}` : null);
  for (const [, g] of byClassTime) {
    if (g.length > 1) {
      const s = g[0];
      errors.push(err("クラス重複", `クラスが${['月','火','水','木','金'][s.day] || s.day}曜${s.period + 1}限に複数配置されています`, s));
    }
  }

  return errors;
}

/** ソフト制約を検証する */
function checkSoftConstraints(slots, teacherMap, subjectMap) {
  const warnings = [];
  const w = (type, message, extra = {}) => warnings.push({
    type, message, day: extra.day ?? null, period: extra.period ?? null,
    classId: extra.classId ?? null, teacherId: extra.teacherId ?? null, roomId: extra.roomId ?? null,
  });

  // 教員ごと・日ごとのコマ数集計（区切りに|を使用。teacherIdにハイフンが含まれるため）
  const teacherDayPeriods = new Map();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = `${s.teacherId}|${s.day}`;
    if (!teacherDayPeriods.has(k)) teacherDayPeriods.set(k, []);
    teacherDayPeriods.get(k).push(s.period);
  }

  for (const [key, periods] of teacherDayPeriods) {
    const sepIdx = key.lastIndexOf('|');
    const teacherId = key.substring(0, sepIdx);
    const day = key.substring(sepIdx + 1);
    const teacher = teacherMap.get(teacherId);
    if (!teacher) continue;

    // 1日のコマ数上限
    if (teacher.maxPeriodsPerDay && periods.length > teacher.maxPeriodsPerDay) {
      w("1日コマ数超過", `教員${teacherId}の${day}曜のコマ数(${periods.length})が上限(${teacher.maxPeriodsPerDay})を超えています`, { day, teacherId });
    }

    // 連続コマ数
    if (teacher.maxConsecutive) {
      const sorted = [...periods].sort((a, b) => a - b);
      let cons = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          cons++;
          if (cons > teacher.maxConsecutive) {
            w("連続コマ数超過", `教員${teacherId}の${day}曜に${cons}連続コマがあり上限(${teacher.maxConsecutive})を超えています`, { day, period: sorted[i], teacherId });
            break;
          }
        } else { cons = 1; }
      }
    }
  }

  // 科目ごとの週時数チェック
  const subjectCount = new Map();
  for (const s of slots) { if (s.subjectId) subjectCount.set(s.subjectId, (subjectCount.get(s.subjectId) || 0) + 1); }
  for (const [id, count] of subjectCount) {
    const sub = subjectMap.get(id);
    if (sub?.hoursPerWeek != null && count !== sub.hoursPerWeek) {
      w("週時数不一致", `科目${id}の週時数(${count})が設定値(${sub.hoursPerWeek})と一致しません`);
    }
  }
  return warnings;
}

/**
 * 全制約を検証する
 * @param {object} state - { slots, teachers, subjects, ... }
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validate(state) {
  const slots = getSlots(state);
  const teacherMap = getTeacherMap(state);
  const subjectMap = getSubjectMap(state);
  return {
    errors: checkHardConstraints(slots, teacherMap),
    warnings: checkSoftConstraints(slots, teacherMap, subjectMap),
  };
}

/**
 * 単一スロット配置の妥当性を検証する（ハード制約のみ）
 * @param {object} state - 現在の状態
 * @param {object} slot - 配置しようとするスロット
 * @returns {{ valid: boolean, errors: Array }}
 */
export function validateSlotPlacement(state, slot) {
  const existing = getSlots(state);
  const teacherMap = getTeacherMap(state);
  const errors = [];
  const e = (type, msg) => errors.push(err(type, msg, slot));

  // 教員重複
  if (slot.teacherId && existing.some(s => s.day === slot.day && s.period === slot.period && s.teacherId === slot.teacherId)) {
    e("教員重複", `教員${slot.teacherId}は${slot.day}曜${slot.period}限に既に配置されています`);
  }
  // 教室重複
  if (slot.roomId && existing.some(s => s.day === slot.day && s.period === slot.period && s.roomId === slot.roomId)) {
    e("教室重複", `教室${slot.roomId}は${slot.day}曜${slot.period}限に既に使用されています`);
  }
  // 同日同科目重複
  if (slot.classId && slot.subjectId && existing.some(s => s.classId === slot.classId && s.day === slot.day && s.subjectId === slot.subjectId)) {
    e("同日同科目重複", `クラス${slot.classId}の${slot.subjectId}は${slot.day}曜に既に配置されています`);
  }
  // 出勤日外
  if (slot.teacherId) {
    const t = teacherMap.get(slot.teacherId);
    if (t?.availableDays && !t.availableDays.includes(slot.day)) {
      e("出勤日外", `教員${slot.teacherId}は${slot.day}曜が出勤日ではありません`);
    }
  }
  return { valid: errors.length === 0, errors };
}
