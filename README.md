# 時間割作成システム

> 高校全体（全クラス・全教員）の時間割を、ブラウザだけで作成・管理できるツール。
> インストール不要・サーバー不要。GitHub Pages で即公開できます。

## デモ

**GitHub Pages:** `https://<your-username>.github.io/timetable-system/`

---

## 主な機能

### マスタ管理
- 教員（担当教科・免許・勤務曜日・非常勤フラグ）
- クラス（学年・コース・学科）
- 教室（普通教室・特別教室・体育館など、収容人数）
- 教科・科目（週あたり時数）

### 授業コマ種別

| 種別 | 説明 |
|------|------|
| 単独授業 | 1クラス・1教員・1教室 |
| 選択授業 | 複数クラスから生徒が選択、同時開講 |
| コース別授業 | クラス内の文系・理系など |
| 習熟度別 / 少人数 | クラスを分割して複数教員が担当 |
| TT授業 | 複数教員が同一クラスを担当 |
| 時間続き | 2コマ連続授業 |
| 固定コマ | HR・会議など曜日・時限固定 |

### 制約チェック（ハード制約）
- 教員の同一時限重複を検出
- 教室の同一時限重複を検出
- 同一クラス・同一科目の同日重複を検出
- 非常勤講師の出勤曜日外への配置を検出
- 週あたり時数の過不足チェック

### 自動最適化エンジン
- バックトラッキング＋制約伝播（基本）
- 焼きなまし法 / 反復局所探索法
- 複数パターンを生成して比較選択
- 配置順：固定コマ → 特別教室使用科目 → 体育 → 選択科目 → 残り

### ソフト制約（バランス最適化）
- 教員ワークロードの均等分散（標準偏差最小化）
- 午前・午後のコマ偏り解消
- 曜日間の偏り解消
- 連続授業コマ数の上限遵守

### UI・編集
- グリッド上でドラッグ＆ドロップ
- 制約違反コマのリアルタイム色付けアラート
- 移動候補のビジュアル表示
- 教員別 / クラス別 / 教室別の表示切替

### 印刷対応
- クラス別時間割（A4・縦横）
- 教員別時間割一覧表
- 特別教室別時間割一覧表
- 選択科目一覧表
- 印刷時はボタン類を自動非表示

### データ入出力（すべてクライアントサイドで完結）

| 操作 | 形式 | 用途 |
|------|------|------|
| インポート | CSV | 教員・クラス・教室・科目の一括登録 |
| インポート | CSV | 既存時間割の読み込み |
| エクスポート | CSV | 校務システムとの連携 / バックアップ |
| 保存 / 復元 | localStorage | ブラウザ内の自動保存（セッション間永続化） |

---

## ディレクトリ構成

```
timetable-system/
├── index.html              # エントリーポイント（単一HTML）
├── css/
│   ├── style.css           # メインスタイル
│   └── print.css           # 印刷用スタイル（@media print）
├── js/
│   ├── main.js             # 起動・初期化
│   ├── store.js            # 状態管理（localStorage 読み書き）
│   ├── data.js             # CSV パーサー・シリアライザー
│   ├── scheduler.js        # 自動最適化エンジン
│   ├── validator.js        # 制約チェック
│   └── ui.js               # DOM操作・ドラッグ＆ドロップ
├── data/
│   ├── teachers.csv        # 教員マスタサンプル
│   ├── classes.csv         # クラスマスタサンプル
│   ├── rooms.csv           # 教室マスタサンプル
│   ├── subjects.csv        # 科目マスタサンプル
│   └── slots.csv           # 時間割サンプル
└── docs/
    └── csv_format.md       # CSV フォーマット仕様書
```

---

## セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/<your-username>/timetable-system.git
cd timetable-system

# ローカル確認（どちらでも可）
npx serve .
python -m http.server 8000
```

ブラウザで `http://localhost:8000` を開いてください。ビルド・コンパイル不要です。

---

## CSV フォーマット

### マスタ CSV

**teachers.csv**
```csv
id,name,subjects,available_days,is_part_time,max_periods_per_day,max_consecutive
t01,山田太郎,"数学Ⅱ,数学B",0|1|2|3|4,false,4,2
t02,佐藤花子,国語総合,0|1|2|3|4,false,5,3
t03,田中次郎,英語コミュニケーション,1|2|3,true,3,2
```

**classes.csv**
```csv
id,name,grade,course
c01,1年1組,1,普通
c02,1年2組,1,普通
c03,2年1組文系,2,文系
```

**rooms.csv**
```csv
id,name,type,capacity
r01,1-1教室,普通教室,40
r02,体育館,特別教室,200
r03,物理実験室,特別教室,30
```

**subjects.csv**
```csv
id,name,hours_per_week,requires_special_room
s01,数学Ⅱ,4,false
s02,体育,3,true
s03,物理,3,true
```

### 時間割 CSV

**slots.csv**
```csv
day,period,class_id,subject_id,teacher_id,room_id,slot_type
0,0,c01,s01,t01,r01,single
0,1,c02,s02,t05,r02,special_room
1,2,c03,s03,t03,r03,single
```

| フィールド | 値 | 説明 |
|---|---|---|
| `day` | 0〜4 | 0=月・1=火・2=水・3=木・4=金 |
| `period` | 0〜5 | 0=1限〜5=6限 |
| `slot_type` | 下記参照 | 授業種別 |

`slot_type` の値: `single` / `elective` / `course` / `team_teaching` / `double` / `fixed`

---

## GitHub Pages デプロイ

Settings → Pages → Branch: `main` / `/ (root)` を設定するだけで自動公開されます。

```bash
git add .
git commit -m "feat: ..."
git push origin main
```

---

## ライセンス

MIT License