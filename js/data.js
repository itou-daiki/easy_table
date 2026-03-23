/**
 * data.js — CSV入出力モジュール
 * UTF-8 BOM付きエクスポート、パイプ区切りの複数値フィールドに対応
 */

/** CSVカラム定義（ヘッダー名とプロパティ名の対応） */
const COLUMN_DEFS = {
  teachers: [
    { csv: 'ID', prop: 'id', aliases: ['id'] },
    { csv: '氏名', prop: 'name', aliases: ['name'] },
    { csv: '担当科目', prop: 'subjects', aliases: ['subjects'] },
    { csv: '出勤曜日', prop: 'availableDays', aliases: ['available_days'] },
    { csv: '非常勤', prop: 'isPartTime', aliases: ['is_part_time'] },
    { csv: '1日最大コマ数', prop: 'maxPeriodsPerDay', aliases: ['max_periods_per_day'] },
    { csv: '最大連続コマ数', prop: 'maxConsecutive', aliases: ['max_consecutive'] },
    { csv: '授業不可時限', prop: 'unavailablePeriods', aliases: ['unavailable_periods'] },
  ],
  classes: [
    { csv: 'ID', prop: 'id', aliases: ['id'] },
    { csv: 'クラス名', prop: 'name', aliases: ['name'] },
    { csv: '学年', prop: 'grade', aliases: ['grade'] },
    { csv: 'コース', prop: 'course', aliases: ['course'] },
  ],
  rooms: [
    { csv: 'ID', prop: 'id', aliases: ['id'] },
    { csv: '教室名', prop: 'name', aliases: ['name'] },
    { csv: '種別', prop: 'type', aliases: ['type'] },
    { csv: '定員', prop: 'capacity', aliases: ['capacity'] },
  ],
  subjects: [
    { csv: 'ID', prop: 'id', aliases: ['id'] },
    { csv: '科目名', prop: 'name', aliases: ['name'] },
    { csv: '教科', prop: 'department', aliases: ['department'] },
    { csv: '単位数', prop: 'credits', aliases: ['credits'] },
    { csv: '週時数', prop: 'hoursPerWeek', aliases: ['hours_per_week'] },
    { csv: '必履修', prop: 'isRequired', aliases: ['is_required'] },
    { csv: '対象学年', prop: 'targetGrades', aliases: ['target_grades'] },
    { csv: 'コース制限', prop: 'courseRestriction', aliases: ['course_restriction'] },
    { csv: '特別教室要否', prop: 'requiresSpecialRoom', aliases: ['requires_special_room'] },
    { csv: '学校設定科目', prop: 'isSchoolOriginal', aliases: ['is_school_original'] },
    { csv: '代替科目', prop: 'alternativeFor', aliases: ['alternative_for'] },
  ],
  slots: [
    { csv: '曜日', prop: 'day', aliases: ['day'] },
    { csv: '時限', prop: 'period', aliases: ['period'] },
    { csv: 'クラスID', prop: 'classId', aliases: ['class_id'] },
    { csv: '科目ID', prop: 'subjectId', aliases: ['subject_id'] },
    { csv: '教員ID', prop: 'teacherId', aliases: ['teacher_id'] },
    { csv: '教室ID', prop: 'roomId', aliases: ['room_id'] },
    { csv: 'コマ種別', prop: 'slotType', aliases: ['slot_type'] },
  ],
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
      // 授業不可時限はパイプ区切りの"day-period"形式
      if (type === 'teachers' && col.prop === 'unavailablePeriods') {
        return Array.isArray(val) ? val.map(p => `${p.day}-${p.period}`).join('|') : String(val ?? '');
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
  const names = { teachers: '教員マスタ', classes: 'クラスマスタ', rooms: '教室マスタ', subjects: '科目マスタ' };
  triggerDownload(csv, `${names[type] || type}.csv`);
}

/**
 * コマ割りデータをCSVエクスポートする
 * @param {object} state - 状態オブジェクト
 */
export function exportSlotsCSV(state) {
  const csv = toCSV(state.slots || [], COLUMN_DEFS.slots, 'slots');
  triggerDownload(csv, '時間割データ.csv');
}

// ─── Excel（.xlsx）入出力 ───

/** シート名とデータ種別のマッピング */
const SHEET_NAMES = {
  teachers: '教員', classes: 'クラス', rooms: '教室',
  subjects: '科目', slots: '時間割',
};
const SHEET_NAME_TO_TYPE = {};
for (const [k, v] of Object.entries(SHEET_NAMES)) { SHEET_NAME_TO_TYPE[v] = k; SHEET_NAME_TO_TYPE[k] = k; }

/**
 * 全データを1つのExcelファイル（.xlsx）としてエクスポートする
 */
export function exportExcel(state) {
  if (typeof XLSX === 'undefined') { alert('SheetJSライブラリが読み込まれていません'); return; }
  const wb = XLSX.utils.book_new();
  const types = ['teachers', 'classes', 'rooms', 'subjects', 'slots'];
  for (const type of types) {
    const columns = COLUMN_DEFS[type];
    const records = type === 'slots' ? (state.slots || []) : (state[type] || []);
    // ヘッダー行
    const header = columns.map(c => c.csv);
    const rows = records.map(record =>
      columns.map(col => {
        const val = record[col.prop];
        if (type === 'teachers' && col.prop === 'subjects') return Array.isArray(val) ? val.join(',') : String(val ?? '');
        if (type === 'teachers' && col.prop === 'availableDays') return Array.isArray(val) ? val.join('|') : String(val ?? '');
        if (type === 'teachers' && col.prop === 'unavailablePeriods') return Array.isArray(val) ? val.map(p => `${p.day}-${p.period}`).join('|') : String(val ?? '');
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (Array.isArray(val)) return val.join('|');
        return val ?? '';
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // 列幅を自動調整
    ws['!cols'] = header.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length));
      return { wch: Math.min(30, Math.max(8, maxLen + 2)) };
    });
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES[type] || type);
  }
  const schoolName = state.meta?.schoolName || '時間割';
  const year = state.meta?.yearLabel || '';
  const fileName = `${schoolName}${year ? '_' + year : ''}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * 入力用テンプレートExcelファイルをダウンロードする
 * ヘッダー行＋記入例＋入力ガイドを含む
 */
export function downloadTemplate() {
  if (typeof XLSX === 'undefined') { alert('SheetJSライブラリが読み込まれていません'); return; }
  const wb = XLSX.utils.book_new();

  // 各シートにヘッダー + サンプル行 + 入力ガイドを追加
  const templates = {
    teachers: {
      examples: [
        ['t01', '山田太郎', 's01|s02', '0|1|2|3|4', 'false', '5', '3', ''],
        ['t02', '佐藤花子', 's03', '1|2|3', 'true', '3', '2', '0-0|4-5'],
      ],
      notes: '担当科目: 科目IDをパイプ(|)区切り / 出勤曜日: 0=月,1=火,2=水,3=木,4=金 / 授業不可時限: 曜日-時限 をパイプ区切り（例: 0-0 = 月曜1限）',
    },
    classes: {
      examples: [
        ['c01', '1年1組', '1', '共通'],
        ['c02', '2年1組', '2', '文系'],
        ['c03', '2年3組', '2', '理系'],
      ],
      notes: 'コース: 共通/文系/理系/文理混合/特進/普通',
    },
    rooms: {
      examples: [
        ['r01', '1年1組教室', '普通教室', '40'],
        ['r02', '体育館', '体育施設', '200'],
        ['r03', '物理実験室', '特別教室', '30'],
      ],
      notes: '種別: 普通教室/特別教室/体育施設/その他',
    },
    subjects: {
      examples: [
        ['s01', '現代の国語', '国語', '2', '2', 'true', '1', '', 'false', 'false', ''],
        ['s02', '数学Ⅲ', '数学', '3', '3', 'false', '3', '理系', 'false', 'false', ''],
        ['s03', 'プログラミング演習', '情報', '2', '2', 'false', '2|3', '', 'false', 'true', 's44'],
      ],
      notes: '対象学年: パイプ区切り(例:1|2|3) / コース制限: 文系/理系/空欄=共通 / 代替科目: 代替元の科目ID（空欄=なし）',
    },
    slots: {
      examples: [
        ['0', '0', 'c01', 's01', 't01', 'r01', 'single'],
        ['0', '1', 'c01', 's02', 't02', 'r01', 'single'],
        ['1', '2', 'c02', 's03', 't03', 'r03', 'meeting'],
      ],
      notes: '曜日: 0=月〜4=金 / 時限: 0始まり(0=1限) / コマ種別: single/elective/course/team_teaching/double/fixed/meeting',
    },
  };

  const types = ['teachers', 'classes', 'rooms', 'subjects', 'slots'];
  for (const type of types) {
    const columns = COLUMN_DEFS[type];
    const header = columns.map(c => c.csv);
    const tmpl = templates[type];
    const data = [header, ...tmpl.examples, [], ['【入力ガイド】'], [tmpl.notes]];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // 列幅
    ws['!cols'] = header.map((h, i) => {
      const maxLen = Math.max(h.length, ...tmpl.examples.map(r => String(r[i] ?? '').length));
      return { wch: Math.min(35, Math.max(8, maxLen + 2)) };
    });
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES[type]);
  }

  XLSX.writeFile(wb, '時間割テンプレート.xlsx');
}

/**
 * Excelファイル（.xlsx）から全データをインポートする
 * @param {ArrayBuffer} buffer - ファイルの内容
 * @param {object} currentState - 現在の状態
 * @returns {object} 更新後の状態
 */
export function importExcel(buffer, currentState) {
  if (typeof XLSX === 'undefined') throw new Error('SheetJSライブラリが読み込まれていません');
  const wb = XLSX.read(buffer, { type: 'array' });
  let state = structuredClone(currentState);
  let importedSheets = [];

  for (const sheetName of wb.SheetNames) {
    const type = SHEET_NAME_TO_TYPE[sheetName];
    if (!type || !COLUMN_DEFS[type]) continue;
    const ws = wb.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(ws);
    state = importCSV(csvText, type, state);
    importedSheets.push(SHEET_NAMES[type] || type);
  }

  if (importedSheets.length === 0) {
    throw new Error(`認識できるシートがありません。シート名は「${Object.values(SHEET_NAMES).join('」「')}」にしてください。`);
  }
  return { state, importedSheets };
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
  // CSVヘッダー → camelCaseプロパティへの変換マップ（日本語・英語両対応）
  const csvToProp = {};
  columns.forEach(c => {
    csvToProp[c.csv] = c.prop;
    if (c.aliases) c.aliases.forEach(a => { csvToProp[a] = c.prop; });
  });

  const records = rawRows.map(row => {
    const record = {};
    for (const [csvKey, value] of Object.entries(row)) {
      const propName = csvToProp[csvKey] || snakeToCamel(csvKey);
      record[propName] = value;
    }
    // 型変換を行う
    return castRecord(record, type);
  });

  // 空行やIDなしレコードを除外
  const validRecords = records.filter(r => {
    if (type === 'slots') return Number.isFinite(r.day) && Number.isFinite(r.period) && r.classId;
    return r.id;
  });

  const newState = structuredClone(state);
  if (type === 'slots') {
    newState.slots = validRecords;
  } else {
    // 既存データとマージ（同一IDは上書き、新規は追加）
    const existing = new Map((newState[type] || []).map(r => [r.id, r]));
    for (const r of validRecords) existing.set(r.id, r);
    newState[type] = Array.from(existing.values());
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
        maxConsecutive: Number(record.maxConsecutive) || 0,
        // 授業不可時限（"0-0|1-2" → [{day:0,period:0},{day:1,period:2}]）
        unavailablePeriods: record.unavailablePeriods
          ? String(record.unavailablePeriods).split('|').map(p => {
              const [d, pr] = p.trim().split('-').map(Number);
              return { day: d, period: pr };
            }).filter(p => !isNaN(p.day) && !isNaN(p.period))
          : [],
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
        credits: Number(record.credits) || Number(record.hoursPerWeek) || 0,
        hoursPerWeek: Number(record.hoursPerWeek) || 0,
        isRequired: record.isRequired === 'true' || record.isRequired === true,
        targetGrades: record.targetGrades
          ? String(record.targetGrades).split('|').map(Number).filter(n => !isNaN(n))
          : [],
        courseRestriction: record.courseRestriction || '',
        requiresSpecialRoom: record.requiresSpecialRoom === 'true' || record.requiresSpecialRoom === true,
        isSchoolOriginal: record.isSchoolOriginal === 'true' || record.isSchoolOriginal === true,
        department: record.department || '',
        alternativeFor: record.alternativeFor || '',
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
