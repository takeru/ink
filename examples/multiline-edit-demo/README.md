# Multi-line Edit Demo

複数行テキスト編集におけるカーソル位置計算のデモアプリとテストスイート。

## 概要

このデモは、ターミナルでの複数行テキスト編集において、視覚的なカーソル位置（行と列）を正確に計算する方法を示します。

- 自動的な行折り返し（ターミナル幅80セルで折り返し）
- 全角文字対応（全角文字 = 2セル、半角文字 = 1セル）
- 改行文字（`\n`）のサポート
- 矢印キーによるカーソル移動（上下左右）

このロジックは、IME（日本語入力など）の候補ウィンドウを正しい位置に表示するために必要です。

## デモアプリの実行

```bash
npm run example examples/multiline-edit-demo/multiline-edit-demo.tsx
```

### 操作方法

- **テキスト入力**: そのまま文字を入力
- **Enter**: 改行を挿入
- **矢印キー**: カーソル移動（←→↑↓）
- **Backspace**: 文字削除
- **Ctrl+C**: 終了

画面上部のボックス内に、視覚的なカーソル位置が白い反転文字（█）で表示されます。
画面下部には、現在のカーソル位置情報（論理位置、視覚位置、行情報）が表示されます。

## テストの実行

### スタンドアロンテストスクリプト

個別のテストケースを実行：

```bash
node --loader ts-node/esm examples/multiline-edit-demo/test/multiline-cursor-simple.tsx <test-name>
```

利用可能なテストケース：
- `empty-text` - 空テキスト
- `single-line-end` - 1行テキストの末尾
- `two-lines-second-line` - 2行目のテキスト
- `empty-line` - 空行
- `fullwidth-chars` - 全角文字
- `mixed-width` - 全角・半角混在
- `cursor-on-newline` - 改行文字上のカーソル
- `multiple-empty-lines` - 複数の空行
- `line-start` - 行の先頭
- `text-start` - テキストの先頭
- `long-line-wrap` - 長い行の折り返し
- `fullwidth-wrap` - 全角文字の折り返し
- `fullwidth-wrap-boundary` - 全角文字が境界で折り返し
- `mixed-width-wrap` - 全角・半角混在で折り返し
- `cursor-at-wrap-point` - 折り返し位置のカーソル

例：
```bash
node --loader ts-node/esm examples/multiline-edit-demo/test/multiline-cursor-simple.tsx fullwidth-wrap-boundary
# => PASS: row=1, col=0
```

### AVA統合テスト

全テストケースを自動実行（node-ptyを使用）：

```bash
# プロジェクトルートから
npx ava examples/multiline-edit-demo/test/multiline-cursor.test.tsx
```

## 実装の詳細

### カーソル位置計算アルゴリズム

1. **論理行を視覚行に分割**
   - テキストを `\n` で論理行に分割
   - 各論理行をターミナル幅（80セル）で折り返し
   - `string-width` を使用して文字幅を計算（全角=2, 半角=1）

2. **カーソルの視覚位置を特定**
   - カーソルの論理位置（文字インデックス）から視覚行を特定
   - 行内のカーソル位置から視覚列（セル単位）を計算

3. **境界条件の処理**
   - 空行の扱い
   - 改行文字上のカーソル
   - 折り返し境界でのカーソル位置
   - 全角文字が境界にまたがる場合

## ファイル構成

```
multiline-edit-demo/
├── README.md                        # このファイル
├── multiline-edit-demo.tsx          # インタラクティブデモアプリ
└── test/
    ├── multiline-cursor-simple.tsx  # スタンドアロンテストスクリプト
    └── multiline-cursor.test.tsx    # AVA統合テスト
```
