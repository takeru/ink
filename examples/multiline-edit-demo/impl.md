# IMEカーソル位置制御の実装ドキュメント

## 目的

このドキュメントは、Inkターミナルライブラリで**IME（Input Method Editor）の候補ウィンドウを正しい位置に表示する**ための実装について説明します。

### 背景

- IMEは日本語、中国語、韓国語などの入力に必要
- IME候補ウィンドウは**ターミナルの実際のカーソル位置**に表示される
- Inkはデフォルトでカーソルを末尾に配置するため、IME候補ウィンドウが間違った位置に表示される
- 複数行テキストで正しいカーソル位置を制御する必要がある

---

## 実装の全体像

### アーキテクチャ

```
React Component (multiline-edit-demo.tsx)
  ↓ CURSOR_MARKER を挿入
Ink Renderer (renderer.ts, measure-text.ts)
  ↓ レイアウト計算（マーカー除外）
Ink Core (ink.tsx)
  ↓ カーソル位置クエリ
App Component (App.tsx)
  ↓ DSR (Device Status Report)
log-update (log-update.ts)
  ↓ マーカー検出・削除、相対カーソル移動
Terminal
  ↓ 実際のカーソル表示
IME候補ウィンドウ
```

### 主要コンポーネント

1. **カーソルマーカーシステム** (`cursor-marker.ts`)
2. **初期カーソル位置取得** (`App.tsx`, `ink.tsx`)
3. **相対カーソル移動** (`log-update.ts`)
4. **レイアウト調整** (`measure-text.ts`)

---

## 実装詳細

### 1. カーソルマーカーシステム (`src/cursor-marker.ts`)

#### 目的
Reactコンポーネントからターミナルのカーソル位置を指定する仕組み

#### 実装

```typescript
// マーカー文字：Zero Width Joiner (幅0)
export const CURSOR_MARKER = '\u200D';

export function findAndRemoveMarker(text: string): MarkerInfo {
  const lines = text.split('\n');
  let position: CursorPosition | undefined;

  for (let row = 0; row < lines.length; row++) {
    const markerIndex = lines[row].indexOf(CURSOR_MARKER);
    if (markerIndex >= 0) {
      // マーカー前のテキストの表示幅を計算
      const beforeMarker = lines[row].slice(0, markerIndex);
      const col = stringWidth(stripAnsi(beforeMarker));

      position = {row, col};
      lines[row] = lines[row].replace(CURSOR_MARKER, '');
      break;
    }
  }

  return {cleaned: lines.join('\n'), position};
}
```

#### 設計のポイント

- **マーカー文字の選択**: Zero Width Joiner (`\u200D`)
  - Zero Width Space (`\u200B`) は一部のターミナルで幅1として扱われる
  - Private Use Area (`\uE000`) も同様の問題
  - Zero Width Joinerは絵文字結合用で、確実に不可視

- **位置計算**: `stringWidth(stripAnsi())`
  - ANSIコードを除外して実際の表示幅を計算
  - 全角文字は2セル幅として正しく計算される

#### 使用例 (デモアプリ)

```tsx
return (
  <Text key={`line-${index}`}>
    {before}
    {CURSOR_MARKER}  {/* ← ここにカーソルを配置 */}
    <Text inverse>{cursor}</Text>
    {after}
  </Text>
);
```

---

### 2. 初期カーソル位置取得

#### 問題
画面のどの位置からレンダリングが始まるか不明（前のコマンドの出力が残っている）

#### 解決策：DSR (Device Status Report) を使用

##### `App.tsx`: カーソル位置クエリの実装

```typescript
requestCursorPosition = (callback: (row: number, col: number) => void): void => {
  // Raw modeが有効になるまで待つ
  if (this.rawModeEnabledCount === 0) {
    this.pendingCursorPositionRequest = () => {
      this.requestCursorPosition(callback);
    };
    return;
  }

  this.cursorPositionCallback = callback;

  // タイムアウト設定（100ms）
  this.cursorQueryTimeout = setTimeout(() => {
    this.cursorQueryTimeout = undefined;
    this.cursorPositionCallback = undefined;
    this.stdinBuffer = '';
  }, 100);

  // DSRコマンド送信
  this.props.stdout.write('\x1b[6n');
};

handleReadable = (): void => {
  let chunk;
  while ((chunk = this.props.stdin.read() as string | null) !== null) {
    // カーソル位置応答を待っている場合、バッファに蓄積
    if (this.cursorPositionCallback) {
      this.stdinBuffer += chunk;

      // レスポンス形式: ESC[{row};{col}R
      const regex = /\x1b\[(\d+);(\d+)R/;
      const match = regex.exec(this.stdinBuffer);
      if (match?.[1] && match[2]) {
        const row = Number.parseInt(match[1], 10);
        const col = Number.parseInt(match[2], 10);

        const callback = this.cursorPositionCallback;
        this.cursorPositionCallback = undefined;
        if (callback) {
          callback(row, col);
        }

        // 残りのバッファを処理
        const responseEnd = (match.index ?? 0) + match[0].length;
        const remaining = this.stdinBuffer.slice(responseEnd);
        this.stdinBuffer = '';

        if (remaining.length > 0) {
          this.handleInput(remaining);
          this.internal_eventEmitter.emit('input', remaining);
        }
      }
    } else {
      this.handleInput(chunk);
      this.internal_eventEmitter.emit('input', chunk);
    }
  }
};
```

**重要なポイント**:
1. **Raw modeのタイミング**: Raw modeが有効になってからクエリを送信
2. **Stdinバッファリング**: カーソル位置応答をユーザー入力と分離
3. **タイムアウト処理**: ターミナルが応答しない場合の対処

##### `ink.tsx`: 初期化フラグの管理

```typescript
constructor(options: Options) {
  // ...
  // CIまたはスクリーンリーダー有効時はカーソル非表示なので初期化不要
  this.isInitialized = isInCi || this.isScreenReaderEnabled;
}

onRender: () => void = () => {
  // 初期化完了まで待機
  if (!this.isInitialized) {
    return;
  }
  // ... レンダリング処理
};

handleCursorPositionReceived = (row: number, _col: number) => {
  // 取得した位置をoutputStartRowとして使用
  this.log.setOutputStartRow(row);

  // 初期化完了
  this.isInitialized = true;

  // 最初のレンダリングをトリガー
  this.onRender();
};
```

---

### 3. 相対カーソル移動 (`src/log-update.ts`)

#### 問題：絶対座標の限界

**絶対座標を使うと**:
```typescript
// ❌ 絶対座標方式
const targetRow = outputStartRow + position.row;
cursorControl = `\x1b[${targetRow};${targetCol}H`;
```

**問題点**:
1. スクロールが発生すると座標がずれる
2. `outputStartRow`の値が不正確になる
3. 動的な高さ変更に対応できない

#### 解決策：完全相対移動

```typescript
// ✅ 相対移動方式
const render = (str: string) => {
  // 1. マーカー検出・削除
  const {cleaned, position} = findAndRemoveMarker(str);

  // 2. 前回のカーソル位置から末尾位置に復元
  let restoreCursor = '';
  if (showCursor && previousCursorPosition && outputEndPosition) {
    const rowDiff = outputEndPosition.rowOffset - previousCursorPosition.rowOffset;
    const colDiff = outputEndPosition.col - previousCursorPosition.col;

    if (rowDiff > 0) {
      restoreCursor += `\x1b[${rowDiff}B`; // 下へ
    } else if (rowDiff < 0) {
      restoreCursor += `\x1b[${-rowDiff}A`; // 上へ
    }

    if (colDiff > 0) {
      restoreCursor += `\x1b[${colDiff}C`; // 右へ
    } else if (colDiff < 0) {
      restoreCursor += `\x1b[${-colDiff}D`; // 左へ
    }
  }

  // 3. 出力の末尾位置を計算
  const lines = output.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  const endRow = lines.length - 1;
  const endCol = stringWidth(stripAnsi(lastLine));

  // 4. 末尾からIME位置への相対移動を計算
  let cursorControl = '';
  if (position) {
    const rowDiff = position.row - endRow;
    const colDiff = position.col - endCol;

    if (rowDiff > 0) {
      cursorControl += `\x1b[${rowDiff}B`;
    } else if (rowDiff < 0) {
      cursorControl += `\x1b[${-rowDiff}A`;
    }

    if (colDiff > 0) {
      cursorControl += `\x1b[${colDiff}C`;
    } else if (colDiff < 0) {
      cursorControl += `\x1b[${-colDiff}D`;
    }
  }

  // 5. 出力
  stream.write(
    '\x1b[?2026h' +
      restoreCursor +
      ansiEscapes.eraseLines(previousLineCount) +
      output +
      cursorControl +
      '\x1b[?2026l',
  );

  // 6. 位置を記録（次回の復元用）
  outputEndPosition = {rowOffset: endRow, col: endCol};
  previousCursorPosition = position ?
    {rowOffset: position.row, col: position.col} :
    {...outputEndPosition};
};
```

**仕組み**:

```
レンダリング1回目:
  output書き込み → 末尾(row:29, col:55) → IME位置(row:5, col:70)に移動
  記録: outputEndPosition=(29, 55), previousCursorPosition=(5, 70)

レンダリング2回目:
  現在位置(5, 70) → 末尾(29, 55)に復元 ← restoreCursor
  eraseLines() → 削除（末尾から上に戻る）
  output書き込み → 新しい末尾(28, 55)
  末尾(28, 55) → IME位置(6, 2)に移動 ← cursorControl
  記録: outputEndPosition=(28, 55), previousCursorPosition=(6, 2)
```

#### 重要なポイント

1. **eraseLines()の前提**: カーソルが出力末尾にいること
   - `eraseLines(n)`は「現在位置からn行上に戻って削除」
   - IME位置から実行すると間違った行を削除する
   - だから毎回末尾に復元する

2. **相対オフセットで記録**: 絶対座標ではなく`outputStartRow`からの相対値
   - スクロールしても正しく動作
   - `outputStartRow`の更新が不要

3. **位置の一貫性**:
   - `outputEndPosition`: 出力末尾の位置
   - `previousCursorPosition`: 前回のIME位置（またはoutput末尾）
   - 常に前回の最終カーソル位置を記録

---

### 4. カーソル位置変更の検知

#### 問題
テキストが変更されなくても、カーソル移動（矢印キー）でレンダリングが必要

```typescript
// ❌ これだけでは不十分
if (output === previousOutput) {
  return; // カーソル移動が反映されない
}
```

#### 解決策

```typescript
// マーカー位置も比較
const markerPositionChanged = position !== previousMarkerPosition &&
  !(position && previousMarkerPosition &&
    position.row === previousMarkerPosition.row &&
    position.col === previousMarkerPosition.col);

if (output === previousOutput && !markerPositionChanged) {
  return; // テキストもカーソル位置も同じなら何もしない
}

previousOutput = output;
previousMarkerPosition = position ? {...position} : undefined;
```

---

### 5. 画面高さ超過時の処理 (`ink.tsx`)

#### 問題
コンテンツが画面高さを超えると、別の処理パスに入る

```typescript
// ❌ 以前の実装
if (this.lastOutputHeight >= this.options.stdout.rows) {
  this.options.stdout.write(ansiEscapes.clearTerminal + output);
  this.log.sync(output); // ← カーソル移動を処理しない
  return;
}
```

#### 解決策

```typescript
// ✅ 修正後
if (this.lastOutputHeight >= this.options.stdout.rows) {
  // ターミナルをクリアして状態をリセット
  this.options.stdout.write('\x1b[?2026h' + ansiEscapes.clearTerminal + this.fullStaticOutput + '\x1b[?2026l');
  this.lastOutput = '';
  this.lastOutputHeight = 0;
  // returnせず、通常パスに進む（fall through）
}

// 通常パス: this.log(output) でカーソル移動を処理
```

---

### 6. レイアウト計算の調整 (`src/measure-text.ts`)

#### 問題
Yogaレイアウトエンジンがマーカーを含めて幅を計算すると、Boxの枠がずれる

#### 解決策

```typescript
const measureText = (text: string): Output => {
  // マーカーを削除してから測定
  const textWithoutMarker = text.replaceAll(CURSOR_MARKER, '');

  // キャッシュキーもマーカーなしで
  const cachedDimensions = cache.get(textWithoutMarker);

  if (cachedDimensions) {
    return cachedDimensions;
  }

  const width = widestLine(textWithoutMarker);
  const height = textWithoutMarker.split('\n').length;
  const dimensions = {width, height};

  cache.set(textWithoutMarker, dimensions);

  return dimensions;
};
```

**重要**: キャッシュキーも`textWithoutMarker`を使う
- マーカーあり/なしで同じ結果を返す
- マーカーの有無でレイアウトが変わらない

---

### 7. ターミナルレンダリングの補正 (`log-update.ts`)

#### 問題
一部のターミナルでZero Width文字が幅1として表示される

**現象**:
```
期待: "│ text │"  幅100
実際: "│ text│ "  幅101（マーカー削除後も1セル分残る）
```

#### 解決策：右枠線の前にスペースを挿入

```typescript
if (position) {
  const lines = cleaned.split('\n');
  const cursorLine = lines[position.row];

  // 右枠線の位置を検索
  const lastBorderIndex = cursorLine.lastIndexOf('│');

  if (lastBorderIndex >= 0) {
    // 枠の前にスペースを挿入
    const paddedLine = cursorLine.slice(0, lastBorderIndex) + ' ' +
                       cursorLine.slice(lastBorderIndex);
    lines[position.row] = paddedLine;
  }

  fixedCleaned = lines.join('\n');
}
```

**効果**:
```
マーカー削除: "│ text│"  → 幅99（1セル減る）
パディング追加: "│ text │" → 幅100（枠の内側に+1）
```

---

## 発生した問題と解決策

### 問題1: カーソルが画面下部に表示される

**原因**: 取得したカーソル位置（row=58）をそのまま使用
- コンテンツは画面上部にレンダリング
- カーソル計算は58行目を基準
- カーソルが下部に表示される

**解決策**: 相対移動のみを使用
- 絶対座標（`outputStartRow`）に依存しない
- 常に前回の位置からの相対移動で計算

### 問題2: 画面スクロール時にカーソルが末尾に飛ぶ

**原因**: 境界チェックが絶対座標を使用
```typescript
const targetAbsoluteRow = outputStartRow + targetRow;
if (targetAbsoluteRow > terminalHeight) {
  return; // カーソル移動をスキップ
}
```

**解決策**: 境界チェックを削除
- 相対移動はターミナルが自動的に境界処理
- スクロールしても正しく動作

### 問題3: テキスト未変更時にカーソル移動が反映されない

**原因**: テキスト比較のみで早期リターン
```typescript
if (output === previousOutput) {
  return; // カーソル移動を無視
}
```

**解決策**: マーカー位置も比較
```typescript
const markerPositionChanged = /* ... */;
if (output === previousOutput && !markerPositionChanged) {
  return;
}
```

### 問題4: 画面高さ超過時にカーソル移動しない

**原因**: 別の処理パスで`log.sync()`を使用
- `sync()`はカーソル移動を処理しない

**解決策**: clearTerminal後も通常パスに進む
```typescript
if (this.lastOutputHeight >= this.options.stdout.rows) {
  // クリアのみ実行
  this.options.stdout.write(ansiEscapes.clearTerminal + ...);
  this.lastOutput = '';
  this.lastOutputHeight = 0;
  // fall through（returnしない）
}
// 通常パスでlog(output)を呼ぶ
```

### 問題5: Boxの枠線が1文字左にずれる

**原因1**: Yogaがマーカーを含めて幅を計算
**解決策**: `measureText`でマーカーを削除

**原因2**: ターミナルがZero Width文字を幅1で表示
**解決策**: 右枠線の前にスペースを挿入

---

## デモアプリの使い方

### コード例

```tsx
import {CURSOR_MARKER} from '../../src/cursor-marker.js';

const MultilineCursorTest = () => {
  const [text, setText] = useState('初期テキスト');
  const [cursorPos, setCursorPos] = useState(0);

  // ... テキストを視覚行に分割 ...

  return (
    <Box flexDirection="column" borderStyle="single">
      {visualLines.map((line, index) => {
        if (index === visualRow) {
          const before = line.slice(0, cursorCharIndex);
          const cursor = line[cursorCharIndex] || ' ';
          const after = line.slice(cursorCharIndex + 1);

          return (
            <Text key={index}>
              {before}
              {CURSOR_MARKER}  {/* ← ここにターミナルカーソルを配置 */}
              <Text inverse>{cursor}</Text>
              {after}
            </Text>
          );
        }
        return <Text key={index}>{line}</Text>;
      })}
    </Box>
  );
};
```

### 実行

```bash
npm run build
npm run example examples/multiline-edit-demo/multiline-edit-demo.tsx
```

### 確認事項

1. **カーソル位置**: オレンジのターミナルカーソルと白い視覚カーソルが同じ位置
2. **枠線**: Boxの右枠線が正しく表示される
3. **IME**: 日本語入力時、候補ウィンドウがカーソル位置に表示される

---

## 同様の実装を行う際の注意点

### 1. マーカー文字の選択

**推奨**: Zero Width Joiner (`\u200D`)
- 絵文字結合用で確実に不可視
- `stringWidth`で幅0として扱われる

**避けるべき**:
- Zero Width Space (`\u200B`): 一部ターミナルで幅1
- Private Use Area (`\uE000-\uF8FF`): 環境依存

### 2. 相対移動の原則

**必須**:
- `eraseLines()`の前にカーソルを末尾に復元
- 前回のカーソル位置を記録
- 絶対座標に依存しない

**ANSI エスケープシーケンス**:
- `\x1b[{n}A`: n行上
- `\x1b[{n}B`: n行下
- `\x1b[{n}C`: n列右
- `\x1b[{n}D`: n列左

### 3. タイミング制御

**初期化順序**:
1. Raw mode有効化
2. カーソル位置クエリ送信
3. 応答受信
4. 最初のレンダリング

**注意**: Raw mode前にクエリを送信すると応答がエコーされる

### 4. Yogaレイアウトとの統合

**重要**: `measureText`でマーカーを削除
- レイアウト計算に影響させない
- キャッシュキーもマーカーなしで

### 5. デバッグ

**有用なログポイント**:
```typescript
debugLog(`Cursor positioning: endRow=${endRow}, targetRow=${targetRow}, rowDiff=${rowDiff}`);
debugLog(`Output end position: (${outputEndPosition.row}, ${outputEndPosition.col})`);
debugLog(`Previous cursor: (${previousCursorPosition.row}, ${previousCursorPosition.col})`);
```

**ログファイル**: `/tmp/ink-debug.log`
- レンダリングフロー全体を追跡
- 本番ではログを削除

### 6. 互換性テスト

**必須テスト環境**:
- macOS Terminal
- iTerm2
- Linux (GNOME Terminal, xterm, etc.)
- tmux/screen内

**確認項目**:
- Zero Width文字の表示幅
- DSRの応答
- 相対カーソル移動の動作

---

## パフォーマンス考慮事項

### キャッシング

**`measureText`のキャッシュ**:
- マーカーなしのテキストをキーにする
- マーカーの有無で異なるキャッシュエントリにならないように

### レンダリング最適化

**早期リターン**:
```typescript
if (output === previousOutput && !markerPositionChanged) {
  return; // 無駄なレンダリングを回避
}
```

### 位置計算

**stringWidth/stripAnsi**:
- 比較的重い処理
- 必要な時のみ実行
- 結果を再利用

---

## トラブルシューティング

### カーソルが表示されない

**確認事項**:
1. `showCursor: true` が設定されているか
2. `CURSOR_MARKER`が正しく挿入されているか
3. `findAndRemoveMarker`が正しく動作しているか

**デバッグ**:
```bash
grep "position:" /tmp/ink-debug.log
```

### カーソル位置がずれる

**確認事項**:
1. `stringWidth`で全角文字を正しく計算しているか
2. ANSIコードを除外しているか
3. 相対移動の計算が正しいか

**デバッグ**:
```bash
grep "rowDiff\|colDiff" /tmp/ink-debug.log
```

### 枠線がずれる

**確認事項**:
1. `measureText`でマーカーを削除しているか
2. 右枠線の前にパディングが追加されているか
3. キャッシュキーが正しいか

**デバッグ**:
```bash
grep "Cursor line" /tmp/ink-debug.log
```

### IME候補ウィンドウが間違った位置

**確認事項**:
1. ターミナルのオレンジカーソルが正しい位置にあるか
2. 相対移動が正しく動作しているか
3. スクロールが発生していないか

---

## まとめ

この実装は、以下の技術を組み合わせています：

1. **マーカーベースのカーソル位置指定**: Reactコンポーネントから宣言的に指定
2. **DSRによる初期位置取得**: 画面のどこから始まるか特定
3. **完全相対移動**: スクロールに対応し、絶対座標に依存しない
4. **Yogaレイアウト調整**: マーカーをレイアウト計算から除外
5. **ターミナル互換性対処**: Zero Width文字の表示を補正

複雑ですが、各部分は独立しており、段階的に実装・テストできます。

同様の実装を行う際は、このドキュメントを参照し、各ステップを理解した上で進めることをお勧めします。
