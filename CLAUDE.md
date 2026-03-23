# CLAUDE.md — 時間割作成システム

## プロジェクト概要

高校全体（全クラス・全教員）の時間割を作成・管理するWebアプリ。

- **動作環境**: ブラウザのみ（GitHub Pages）。バックエンド・ビルドステップなし
- **技術**: Vanilla HTML / CSS / JavaScript（ES Modules）
- **永続化**: `localStorage`（セッション間）+ CSV ファイル入出力
- **外部依存**: なし（CDN も使用しない）

## ディレクトリ構成

```
timetable-system/
├── index.html          # エントリーポイント
├── css/
│   ├── style.css       # メインスタイル
│   └── print.css       # @media print（.no-print を非表示）
├── js/
│   ├── main.js         # 起動・初期化・イベント登録
│   ├── store.js        # 状態管理・localStorage 読み書き
│   ├── data.js         # CSV パーサー / シリアライザー
│   ├── scheduler.js    # 自動最適化エンジン
│   ├── validator.js    # 制約チェック（ハード制約）
│   └── ui.js           # DOM操作・ドラッグ＆ドロップ
└── data/
    ├── teachers.csv    # 教員マスタサンプル
    ├── classes.csv     # クラスマスタサンプル
    ├── rooms.csv       # 教室マスタサンプル
    ├── subjects.csv    # 科目マスタサンプル
    └── slots.csv       # 時間割サンプル
```

## コーディングルール

- **ES Modules**（`import/export`）を使う。`require` は使わない
- **クラス・関数名は英語**、コメント・UIテキストは日本語
- **1ファイル 300行以下**を目安。超える場合は分割する
- **グローバル変数禁止**。モジュールスコープで管理する
- DOM 操作は `ui.js` に集約し、ロジックと分離する
- `store.js` 経由以外で `localStorage` を直接操作しない

## ドメイン知識

### データモデル（store.js が保持する状態）

```js
const state = {
  teachers: [
    {
      id: "t01",
      name: "山田太郎",
      subjects: ["s01", "s02"],      // subject.id の配列
      availableDays: [0,1,2,3,4],    // 0=月〜4=金
      isPartTime: false,
      maxPeriodsPerDay: 4,
      maxConsecutive: 2
    }
  ],
  classes: [
    { id: "c01", name: "1年1組", grade: 1, course: "普通" }
  ],
  rooms: [
    { id: "r01", name: "1-1教室", type: "普通教室", capacity: 40 }
  ],
  subjects: [
    { id: "s01", name: "数学Ⅱ", hoursPerWeek: 4, requiresSpecialRoom: false }
  ],
  slots: [
    {
      day: 0,              // 0=月〜4=金
      period: 0,           // 0=1限〜5=6限
      classId: "c01",
      subjectId: "s01",
      teacherId: "t01",
      roomId: "r01",
      slotType: "single"   // 下記参照
    }
  ],
  meta: {
    schoolName: "",
    periodsPerDay: 6,      // 1日の最大時限数
    workingDays: [0,1,2,3,4]
  }
}
```

### slotType の値

| 値 | 意味 |
|---|---|
| `single` | 単独授業 |
| `elective` | 選択授業（複数クラス同時開講） |
| `course` | コース別授業（クラス内分割） |
| `team_teaching` | TT授業（複数教員） |
| `double` | 時間続き（2コマ連続） |
| `fixed` | 固定コマ（HR・会議等） |
| `special_room` | 特別教室使用授業 |

### 制約チェック（validator.js の責務）

**ハード制約（違反 = エラー）**
1. 同一 `(day, period)` で同じ `teacherId` が複数 → 教員重複
2. 同一 `(day, period)` で同じ `roomId` が複数 → 教室重複
3. 同一 `(classId, day, subjectId)` が複数 → 同日同科目重複
4. `teacherId` の `availableDays` に `day` が含まれない → 出勤日外

**ソフト制約（違反 = 警告・最適化対象）**
- 教員の1日の授業コマ数が `maxPeriodsPerDay` を超える
- 教員の連続コマ数が `maxConsecutive` を超える
- 週あたり時数が `hoursPerWeek` と一致しない

### 自動最適化（scheduler.js の責務）

配置順序（鉄則：制約の厳しいコマから先に配置）：
1. 固定コマ（`slotType: "fixed"`）
2. 特別教室使用・体育（教室制約が厳しい）
3. 選択授業・コース別（複数クラスの同時開講制約）
4. TT授業・時間続き
5. 単独授業（週時数の多い科目から）

アルゴリズム：バックトラッキング＋制約伝播 → 解が見つからない場合は焼きなまし法

## CSV 仕様

### インポート・エクスポート共通ルール
- 文字コード: **UTF-8 BOM あり**（Excel で文字化けしないため。`\uFEFF` を先頭に付与）
- 区切り文字: カンマ
- 複数値フィールド（subjects, availableDays 等）: `|` で結合
- 1行目はヘッダー行（スキップして2行目からパース）
- `id` は変更不可（CSV 再インポート時の照合キー）

### CSV ファイル種別と対応するマスタ

| ファイル名 | 内容 | 主キー |
|---|---|---|
| `teachers.csv` | 教員マスタ | `id` |
| `classes.csv` | クラスマスタ | `id` |
| `rooms.csv` | 教室マスタ | `id` |
| `subjects.csv` | 科目マスタ | `id` |
| `slots.csv` | 時間割データ | `(day, period, classId)` |

### エクスポート関数のシグネチャ（data.js）

```js
// マスタ CSV をダウンロード
export function exportMastersCSV(state, type)  // type: 'teachers'|'classes'|'rooms'|'subjects'

// 時間割 CSV をダウンロード
export function exportSlotsCSV(state)

// CSV 文字列をパースして state に取り込む
export function importCSV(csvText, type, state)  // type は上記と同じ
```

## よくあるミスと注意事項

- `localStorage` のキーは `timetable_v1_*` で統一（バージョン衝突防止）
- CSV 出力は必ず BOM（`\uFEFF`）を先頭に付ける
- `print.css` で `.no-print` クラスのすべての要素を `display: none` にする
- `scheduler.js` は同期的に実行すると UI がブロックされる。`setTimeout` で分割するか `Web Worker` を検討
- 選択授業のコマは `slots` に複数エントリとして入るが、`elective_group_id` で束ねる（将来対応）
- `id` の生成は `crypto.randomUUID()` を使う（`Math.random` では重複リスクがある）

## 動作確認

```bash
# ローカルサーバ（どちらでも可）
npx serve .
python -m http.server 8000
```

`http://localhost:8000` をブラウザで開く。ビルド不要。

## デプロイ

```bash
git add .
git commit -m "fix: ..."
git push origin main
```

Settings → Pages → Branch: `main` / `/ (root)` が設定済みなら自動公開。