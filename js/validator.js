/**
 * validator.js — 時間割制約チェッカー
 * ハード制約（エラー）とソフト制約（警告）を検証する
 * 各制約はstate.constraintsでON/OFF・レベル切替可能
 */

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
function getClassMap(state) {
  const m = new Map();
  for (const c of state.classes || []) m.set(c.id, c);
  return m;
}

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

function errObj(type, message, s) {
  return { type, message, day: s?.day, period: s?.period, classId: s?.classId, teacherId: s?.teacherId, roomId: s?.roomId };
}

const DAY_JA = ['月','火','水','木','金','土'];
function dp(day, period) { return `${DAY_JA[day] ?? day}曜${(period ?? 0) + 1}限`; }

/** 制約が有効か確認 */
function isEnabled(constraints, key) {
  return constraints?.[key]?.enabled !== false;
}

/** 制約のレベルを取得（デフォルトは定義通り） */
function getLevel(constraints, key, defaultLevel) {
  return constraints?.[key]?.level || defaultLevel;
}

/**
 * 全制約を検証する
 */
export function validate(state) {
  const slots = getSlots(state);
  const teacherMap = getTeacherMap(state);
  const subjectMap = getSubjectMap(state);
  const classMap = getClassMap(state);
  const con = state.constraints || {};
  const errors = [];
  const warnings = [];

  const push = (key, defaultLevel, type, message, s) => {
    const level = getLevel(con, key, defaultLevel);
    const item = errObj(type, message, s);
    if (level === 'hard') errors.push(item);
    else warnings.push(item);
  };

  // ── ハード制約 ──

  // 1. 教員重複
  if (isEnabled(con, 'teacherConflict')) {
    const g = groupBy(slots, s => s.teacherId ? `${s.day}-${s.period}-${s.teacherId}` : null);
    for (const [, arr] of g) {
      if (arr.length > 1) {
        const s = arr[0];
        const name = teacherMap.get(s.teacherId)?.name || s.teacherId;
        push('teacherConflict', 'hard', '教員重複', `${name}が${dp(s.day, s.period)}に複数配置`, s);
      }
    }
  }

  // 2. 教室重複
  if (isEnabled(con, 'roomConflict')) {
    const g = groupBy(slots, s => s.roomId ? `${s.day}-${s.period}-${s.roomId}` : null);
    for (const [, arr] of g) {
      if (arr.length > 1) {
        const s = arr[0];
        push('roomConflict', 'hard', '教室重複', `教室が${dp(s.day, s.period)}に複数使用`, s);
      }
    }
  }

  // 3. 同日同科目重複
  if (isEnabled(con, 'sameDaySubject')) {
    const g = groupBy(slots, s => (s.classId && s.subjectId) ? `${s.classId}-${s.day}-${s.subjectId}` : null);
    for (const [, arr] of g) {
      if (arr.length > 1) {
        const s = arr[0];
        const subName = subjectMap.get(s.subjectId)?.name || s.subjectId;
        const clsName = classMap.get(s.classId)?.name || s.classId;
        push('sameDaySubject', 'hard', '同日同科目', `${clsName}の${subName}が${DAY_JA[s.day]}曜に複数回`, s);
      }
    }
  }

  // 4. 出勤日外
  if (isEnabled(con, 'teacherAvailDay')) {
    for (const s of slots) {
      if (!s.teacherId) continue;
      const t = teacherMap.get(s.teacherId);
      if (t?.availableDays && !t.availableDays.includes(s.day)) {
        push('teacherAvailDay', 'hard', '出勤日外', `${t.name || s.teacherId}は${DAY_JA[s.day]}曜が出勤日外`, s);
      }
    }
  }

  // 5. 授業不可時限
  if (isEnabled(con, 'teacherAvailPeriod')) {
    for (const s of slots) {
      if (!s.teacherId) continue;
      const t = teacherMap.get(s.teacherId);
      if (t?.unavailablePeriods?.some(up => up.day === s.day && up.period === s.period)) {
        push('teacherAvailPeriod', 'hard', '授業不可時限', `${t.name || s.teacherId}は${dp(s.day, s.period)}が授業不可`, s);
      }
    }
  }

  // 6. クラス重複
  if (isEnabled(con, 'classConflict')) {
    const g = groupBy(slots, s => s.classId ? `${s.classId}|${s.day}|${s.period}` : null);
    for (const [, arr] of g) {
      if (arr.length > 1) {
        const s = arr[0];
        const clsName = classMap.get(s.classId)?.name || s.classId;
        push('classConflict', 'hard', 'クラス重複', `${clsName}が${dp(s.day, s.period)}に複数配置`, s);
      }
    }
  }

  // ── ソフト制約 ──

  // 教員ごと・日ごとのコマ数集計
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

    // 1日コマ数上限
    if (isEnabled(con, 'maxPeriodsPerDay') && teacher.maxPeriodsPerDay && periods.length > teacher.maxPeriodsPerDay) {
      push('maxPeriodsPerDay', 'soft', '1日コマ数超過',
        `${teacher.name}の${DAY_JA[day]}曜: ${periods.length}コマ（上限${teacher.maxPeriodsPerDay}）`, { day: Number(day), teacherId });
    }

    // 連続コマ数
    if (isEnabled(con, 'maxConsecutive') && teacher.maxConsecutive) {
      const sorted = [...periods].sort((a, b) => a - b);
      let cons = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          cons++;
          if (cons > teacher.maxConsecutive) {
            push('maxConsecutive', 'soft', '連続コマ超過',
              `${teacher.name}の${DAY_JA[day]}曜に${cons}連続（上限${teacher.maxConsecutive}）`, { day: Number(day), period: sorted[i], teacherId });
            break;
          }
        } else { cons = 1; }
      }
    }
  }

  // 週時数チェック
  if (isEnabled(con, 'weeklyHours')) {
    const classSubjectCount = new Map();
    for (const s of slots) {
      if (s.subjectId && s.classId) {
        const k = `${s.classId}|${s.subjectId}`;
        classSubjectCount.set(k, (classSubjectCount.get(k) || 0) + 1);
      }
    }
    for (const [key, count] of classSubjectCount) {
      const [classId, subjectId] = key.split('|');
      const sub = subjectMap.get(subjectId);
      const cls = classMap.get(classId);
      if (sub?.hoursPerWeek && count !== sub.hoursPerWeek) {
        push('weeklyHours', 'soft', '週時数不一致',
          `${sub.name}（${cls?.name || classId}）: ${count}コマ / 設定${sub.hoursPerWeek}コマ`, { classId });
      }
    }
  }

  // コース制限
  if (isEnabled(con, 'courseRestriction')) {
    for (const s of slots) {
      const sub = subjectMap.get(s.subjectId);
      const cls = classMap.get(s.classId);
      if (sub?.courseRestriction && cls?.course && cls.course !== '共通' && cls.course !== '文理混合') {
        if (sub.courseRestriction !== cls.course) {
          push('courseRestriction', 'soft', 'コース不一致',
            `${sub.name}（${sub.courseRestriction}向け）→ ${cls.name}（${cls.course}）`, { day: s.day, period: s.period, classId: s.classId });
        }
      }
    }
  }

  // 対象学年
  if (isEnabled(con, 'gradeRestriction')) {
    for (const s of slots) {
      const sub = subjectMap.get(s.subjectId);
      const cls = classMap.get(s.classId);
      if (sub?.targetGrades?.length > 0 && cls?.grade && !sub.targetGrades.includes(cls.grade)) {
        push('gradeRestriction', 'soft', '学年不一致',
          `${sub.name}（${sub.targetGrades.join('・')}年向け）→ ${cls.name}（${cls.grade}年）`, { day: s.day, period: s.period, classId: s.classId });
      }
    }
  }

  // 必履修科目
  if (isEnabled(con, 'requiredSubjects')) {
    const requiredSubjects = [...subjectMap.values()].filter(s => s.isRequired);
    for (const cls of state.classes || []) {
      const classSubjectIds = new Set(slots.filter(s => s.classId === cls.id).map(s => s.subjectId));
      for (const req of requiredSubjects) {
        if (req.targetGrades?.length > 0 && !req.targetGrades.includes(cls.grade)) continue;
        if (!classSubjectIds.has(req.id)) {
          push('requiredSubjects', 'soft', '必履修未配置', `${cls.name}に「${req.name}」が未配置`, { classId: cls.id });
        }
      }
    }
  }

  // ── カスタム制約 ──
  for (const cc of state.customConstraints || []) {
    if (!cc.enabled) continue;
    evaluateCustomConstraint(cc, slots, teacherMap, subjectMap, classMap, state, errors, warnings);
  }

  return { errors, warnings };
}

/** カスタム制約の評価 */
function evaluateCustomConstraint(cc, slots, teacherMap, subjectMap, classMap, state, errors, warnings) {
  const push = (msg) => {
    const item = errObj(cc.label, msg, {});
    if (cc.level === 'hard') errors.push(item);
    else warnings.push(item);
  };

  switch (cc.type) {
    case 'avoid_period': {
      // 特定の曜日・時限を避ける
      const { day, period, subjectId, teacherId } = cc.params || {};
      for (const s of slots) {
        if (day != null && s.day !== day) continue;
        if (period != null && s.period !== period) continue;
        if (subjectId && s.subjectId !== subjectId) continue;
        if (teacherId && s.teacherId !== teacherId) continue;
        const subName = subjectMap.get(s.subjectId)?.name || '';
        push(`${subName}が${dp(s.day, s.period)}に配置されています`);
      }
      break;
    }
    case 'require_consecutive': {
      // 連続コマを要求
      const { subjectId } = cc.params || {};
      if (!subjectId) break;
      const classSlots = new Map();
      for (const s of slots) {
        if (s.subjectId !== subjectId) continue;
        const k = `${s.classId}|${s.day}`;
        if (!classSlots.has(k)) classSlots.set(k, []);
        classSlots.get(k).push(s.period);
      }
      for (const [key, periods] of classSlots) {
        if (periods.length < 2) continue;
        const sorted = periods.sort((a, b) => a - b);
        let consecutive = true;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] !== sorted[i-1] + 1) { consecutive = false; break; }
        }
        if (!consecutive) {
          const [classId] = key.split('|');
          const subName = subjectMap.get(subjectId)?.name || subjectId;
          const clsName = classMap.get(classId)?.name || classId;
          push(`${subName}（${clsName}）が連続配置されていません`);
        }
      }
      break;
    }
    case 'max_subject_per_day': {
      // 1日の特定科目コマ数上限
      const { subjectId, max } = cc.params || {};
      if (!subjectId || !max) break;
      const countByDay = new Map();
      for (const s of slots) {
        if (s.subjectId !== subjectId) continue;
        const k = `${s.classId}|${s.day}`;
        countByDay.set(k, (countByDay.get(k) || 0) + 1);
      }
      for (const [key, count] of countByDay) {
        if (count > max) {
          const [classId, day] = key.split('|');
          const subName = subjectMap.get(subjectId)?.name || subjectId;
          push(`${subName}（${classMap.get(classId)?.name || classId}）が${DAY_JA[day]}曜に${count}コマ（上限${max}）`);
        }
      }
      break;
    }
    case 'prefer_period': {
      // 特定の時限に配置を推奨
      const { subjectId, preferredPeriods } = cc.params || {};
      if (!subjectId || !preferredPeriods?.length) break;
      for (const s of slots) {
        if (s.subjectId !== subjectId) continue;
        if (!preferredPeriods.includes(s.period)) {
          const subName = subjectMap.get(subjectId)?.name || subjectId;
          push(`${subName}が推奨時限外（${dp(s.day, s.period)}）に配置`);
        }
      }
      break;
    }
  }
}

/**
 * 単一スロット配置の妥当性を検証する（ハード制約のみ）
 */
export function validateSlotPlacement(state, slot) {
  const existing = getSlots(state);
  const teacherMap = getTeacherMap(state);
  const con = state.constraints || {};
  const errors = [];
  const e = (type, msg) => errors.push(errObj(type, msg, slot));

  if (isEnabled(con, 'teacherConflict') && slot.teacherId && existing.some(s => s.day === slot.day && s.period === slot.period && s.teacherId === slot.teacherId)) {
    e('教員重複', `教員が${dp(slot.day, slot.period)}に既に配置`);
  }
  if (isEnabled(con, 'roomConflict') && slot.roomId && existing.some(s => s.day === slot.day && s.period === slot.period && s.roomId === slot.roomId)) {
    e('教室重複', `教室が${dp(slot.day, slot.period)}に既に使用`);
  }
  if (isEnabled(con, 'sameDaySubject') && slot.classId && slot.subjectId && existing.some(s => s.classId === slot.classId && s.day === slot.day && s.subjectId === slot.subjectId)) {
    e('同日同科目', `この科目は${DAY_JA[slot.day]}曜に既に配置`);
  }
  if (isEnabled(con, 'teacherAvailDay') && slot.teacherId) {
    const t = teacherMap.get(slot.teacherId);
    if (t?.availableDays && !t.availableDays.includes(slot.day)) {
      e('出勤日外', `${t.name || slot.teacherId}は${DAY_JA[slot.day]}曜が出勤日外`);
    }
  }
  if (isEnabled(con, 'teacherAvailPeriod') && slot.teacherId) {
    const t = teacherMap.get(slot.teacherId);
    if (t?.unavailablePeriods?.some(up => up.day === slot.day && up.period === slot.period)) {
      e('授業不可時限', `${t.name || slot.teacherId}は${dp(slot.day, slot.period)}が授業不可`);
    }
  }
  if (isEnabled(con, 'classConflict') && slot.classId && existing.some(s => s.day === slot.day && s.period === slot.period && s.classId === slot.classId)) {
    e('クラス重複', `このクラスは${dp(slot.day, slot.period)}に既に配置`);
  }
  return { valid: errors.length === 0, errors };
}
