/**
 * data.js — CSV入出力モジュール
 * UTF-8 BOM付きエクスポート、パイプ区切りの複数値フィールドに対応
 */

/** CSVカラム定義（ヘッダー名とプロパティ名の対応） */
const COLUMN_DEFS = {
  teachers: [
    { csv: 'id', prop: 'id' },
    { csv: 'name', prop: 'name' },
    { csv: 'subjects', prop: 'subjects' },
    { csv: 'available_days', prop: 'availableDays' },
    { csv: 'is_part_time', prop: 'isPartTime' },
    { csv: 'max_periods_per_day', prop: 'maxPeriodsPerDay' },
    { csv: 'max_consecutive', prop: 'maxConsecutive' }
  ],
  classes: [
    { csv: 'id', prop: 'id' },
    { csv: 'name', prop: 'name' },
    { csv: 'grade', prop: 'grade' },
    { csv: 'course', prop: 'course' }
  ],
  rooms: [
    { csv: 'id', prop: 'id' },
    { csv: 'name', prop: 'name' },
    { csv: 'type', prop: 'type' },
    { csv: 'capacity', prop: 'capacity' }
  ],
  subjects: [
    { csv: 'id', prop: 'id' },
    { csv: 'name', prop: 'name' },
    { csv: 'hours_per_week', prop: 'hoursPerWeek' },
    { csv: 'requires_special_room', prop: 'requiresSpecialRoom' }
  ],
  slots: [
    { csv: 'day', prop: 'day' },
    { csv: 'period', prop: 'period' },
    { csv: 'class_id', prop: 'classId' },
    { csv: 'subject_id', prop: 'subjectId' },
    { csv: 'teacher_id', prop: 'teacherId' },
    { csv: 'room_id', prop: 'roomId' },
    { csv: 'slot_type', prop: 'slotType' }
  ]
};

/** snake_caseからcamelCaseへの変換 */
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * CSVフィールドをエスケープする（カンマや改行を含む場合はダブルクォートで囲む）
 * @param {string} value - エスケープ対象の値
 * @returns {string} エスケープ済みの値
 */
function escapeField(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * CSVテキストをパースして行オブジェクトの配列を返す
 * @param {string} csvText - CSVテキスト
 * @returns {Array<object>} ヘッダーをキーとしたオブジェクトの配列
 */
export function parseCSV(csvText) {
  // BOMを除去
  const text = csvText.replace(/^\uFEFF/, '');
  const rows = [];
  let current = '';
  let inQuotes = false;
  const lines = [];

  // クォート内の改行を考慮してフィールド分割する
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++; // エスケープされたダブルクォートをスキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      lines.push(current);
      current = '';
      // \r\n の場合は \n もスキップ
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);

  if (lines.length === 0) return [];

  /** 1行をフィールド配列に分割する */
  function splitRow(line) {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        fields.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  }

  const headers = splitRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue; // 空行をスキップ
    const values = splitRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

/**
 * レコード配列をCSV文字列に変換する
 * @param {Array<object>} records - レコード配列
 * @param {Array<{csv: string, prop: string}>} columns - カラム定義
 * @param {string} type - データ種別（特殊フィールド処理用）
 * @returns {string} CSV文字列（BOM付き）
 */
function toCSV(records, columns, type) {
  const header = columns.map(c => c.csv).join(',');
  const rows = records.map(record => {
    return columns.map(col => {
      const val = record[col.prop];
      // 教師の担当科目はカンマ区切り（クォートで囲む）
      if (type === 'teachers' && col.prop === 'subjects') {
        return escapeField(Array.isArray(val) ? val.join(',') : String(val ?? ''));
      }
      // 教師の出勤可能日はパイプ区切り
      if (type === 'teachers' && col.prop === 'availableDays') {
        return Array.isArray(val) ? val.join('|') : String(val ?? '');
      }
      // 真偽値
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      // 配列（汎用）
      if (Array.isArray(val)) return escapeField(val.join('|'));
      return escapeField(val);
    }).join(',');
  });
  // UTF-8 BOM + ヘッダー + データ行
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/**
 * CSVファイルをダウンロードする
 * @param {string} csvString - CSV文字列
 * @param {string} filename - ファイル名
 */
function triggerDownload(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * マスターデータをCSVエクスポートする
 * @param {object} state - 状態オブジェクト
 * @param {string} type - データ種別（'teachers'|'classes'|'rooms'|'subjects'）
 */
export function exportMastersCSV(state, type) {
  const columns = COLUMN_DEFS[type];
  if (!columns) {
    console.error('無効なデータ種別です:', type);
    return;
  }
  const records = state[type] || [];
  const csv = toCSV(records, columns, type);
  triggerDownload(csv, `${type}.csv`);
}

/**
 * コマ割りデータをCSVエクスポートする
 * @param {object} state - 状態オブジェクト
 */
export function exportSlotsCSV(state) {
  const csv = toCSV(state.slots || [], COLUMN_DEFS.slots, 'slots');
  triggerDownload(csv, 'slots.csv');
}

/**
 * CSVインポート — CSVテキストを解析して状態に反映する
 * @param {string} csvText - CSVテキスト
 * @param {string} type - データ種別（'teachers'|'classes'|'rooms'|'subjects'|'slots'）
 * @param {object} state - 現在の状態オブジェクト
 * @returns {object} 更新後の状態オブジェクト
 */
export function importCSV(csvText, type, state) {
  const columns = COLUMN_DEFS[type];
  if (!columns) {
    console.error('無効なデータ種別です:', type);
    return state;
  }
  const rawRows = parseCSV(csvText);
  // CSVヘッダー（snake_case）→ camelCaseプロパティへの変換マップ
  const csvToProp = {};
  columns.forEach(c => { csvToProp[c.csv] = c.prop; });

  const records = rawRows.map(row => {
    const record = {};
    for (const [csvKey, value] of Object.entries(row)) {
      const propName = csvToProp[csvKey] || snakeToCamel(csvKey);
      record[propName] = value;
    }
    // 型変換を行う
    return castRecord(record, type);
  });

  const newState = structuredClone(state);
  if (type === 'slots') {
    newState.slots = records;
  } else {
    newState[type] = records;
  }
  return newState;
}

/**
 * インポートしたレコードの型変換を行う
 * @param {object} record - 変換前のレコード
 * @param {string} type - データ種別
 * @returns {object} 型変換後のレコード
 */
function castRecord(record, type) {
  switch (type) {
    case 'teachers':
      return {
        ...record,
        // 科目IDリスト（カンマ区切り）
        subjects: record.subjects
          ? String(record.subjects).split(',').map(s => s.trim()).filter(Boolean)
          : [],
        // 出勤可能日（パイプ区切り → 数値配列）
        availableDays: record.availableDays
          ? String(record.availableDays).split('|').map(Number)
          : [],
        isPartTime: record.isPartTime === 'true' || record.isPartTime === true,
        maxPeriodsPerDay: Number(record.maxPeriodsPerDay) || 0,
        maxConsecutive: Number(record.maxConsecutive) || 0
      };
    case 'classes':
      return {
        ...record,
        grade: record.grade != null ? Number(record.grade) : 0
      };
    case 'rooms':
      return {
        ...record,
        capacity: record.capacity != null ? Number(record.capacity) : 0
      };
    case 'subjects':
      return {
        ...record,
        hoursPerWeek: Number(record.hoursPerWeek) || 0,
        requiresSpecialRoom: record.requiresSpecialRoom === 'true' || record.requiresSpecialRoom === true
      };
    case 'slots':
      return {
        ...record,
        day: Number(record.day),
        period: Number(record.period)
      };
    default:
      return record;
  }
}
