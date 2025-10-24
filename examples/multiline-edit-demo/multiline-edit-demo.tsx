import React, {useState, useMemo} from 'react';
import {render, Text, Box, useInput} from '../../src/index.js';
import stringWidth from 'string-width';

/**
 * This app demonstrates the cursor positioning issue with multi-line text.
 *
 * Try:
 * 1. Type a long line that wraps (e.g., "あああああああああああああああああああああああああああああああああああ")
 * 2. Press left arrow to move cursor
 * 3. Type Japanese with IME
 *
 * Expected: IME candidate window appears at cursor position
 * Actual: IME candidate window appears at end of text (wrong position)
 */

const TERMINAL_WIDTH = 80;

// Types
type VisualLines = {
	lines: string[];
	startPositions: number[];
};

type CursorPosition = {
	row: number;
	col: number;
};

// Helper functions
function calculateVisualLines(text: string, terminalWidth: number): VisualLines {
	const logicalLines = text.split('\n');
	const lines: string[] = [];
	const startPositions: number[] = [];

	let charPos = 0;
	for (let logicalIdx = 0; logicalIdx < logicalLines.length; logicalIdx++) {
		const logicalLine = logicalLines[logicalIdx];
		const chars = Array.from(logicalLine);
		let currentLine = '';
		let lineStartPos = charPos;

		for (const char of chars) {
			const testLine = currentLine + char;
			if (stringWidth(testLine) > terminalWidth && currentLine.length > 0) {
				startPositions.push(lineStartPos);
				lines.push(currentLine);
				lineStartPos = charPos;
				currentLine = char;
			} else {
				currentLine += char;
			}
			charPos++;
		}

		startPositions.push(lineStartPos);
		lines.push(currentLine);

		if (logicalIdx < logicalLines.length - 1) {
			charPos++;
		}
	}

	return {lines, startPositions};
}

function isInLineRange(
	cursorPos: number,
	lineIndex: number,
	startPositions: number[],
	textLength: number,
): boolean {
	const lineStart = startPositions[lineIndex];
	const isLastLine = lineIndex === startPositions.length - 1;

	if (isLastLine) {
		return cursorPos >= lineStart && cursorPos <= textLength;
	}

	const nextLineStart = startPositions[lineIndex + 1];
	return cursorPos >= lineStart && cursorPos < nextLineStart;
}

function findCursorPosition(
	cursorPos: number,
	visualLines: VisualLines,
	textLength: number,
): CursorPosition {
	for (let i = 0; i < visualLines.lines.length; i++) {
		if (isInLineRange(cursorPos, i, visualLines.startPositions, textLength)) {
			const lineStart = visualLines.startPositions[i];
			const lineChars = Array.from(visualLines.lines[i]);
			const posInLine = Math.min(cursorPos - lineStart, lineChars.length);
			const textBeforeCursor = lineChars.slice(0, posInLine).join('');

			return {
				row: i,
				col: stringWidth(textBeforeCursor),
			};
		}
	}

	return {row: 0, col: 0};
}

function findCharIndexAtColumn(line: string, targetCol: number): number {
	const chars = Array.from(line);
	let charPos = 0;
	let cellPos = 0;

	for (let i = 0; i < chars.length; i++) {
		const charWidth = stringWidth(chars[i]);
		if (cellPos >= targetCol) {
			return i;
		}
		cellPos += charWidth;
		charPos = i + 1;
	}

	return charPos;
}

function handleVerticalMovement(
	direction: 'up' | 'down',
	cursorPos: number,
	visualLines: VisualLines,
	textLength: number,
	targetCol: number | null,
): {newCursorPos: number; newTargetCol: number} {
	const currentPosition = findCursorPosition(cursorPos, visualLines, textLength);
	const desiredCol = targetCol !== null ? targetCol : currentPosition.col;

	const targetRow =
		direction === 'up'
			? Math.max(0, currentPosition.row - 1)
			: Math.min(visualLines.lines.length - 1, currentPosition.row + 1);

	if (targetRow === currentPosition.row) {
		return {newCursorPos: cursorPos, newTargetCol: desiredCol};
	}

	const targetLine = visualLines.lines[targetRow];
	const targetLineStart = visualLines.startPositions[targetRow];
	const charIndex = findCharIndexAtColumn(targetLine, desiredCol);
	const newCursorPos = targetLineStart + charIndex;

	return {
		newCursorPos: Math.min(newCursorPos, textLength),
		newTargetCol: desiredCol,
	};
}

function MultilineCursorTest() {
	const [text, setText] = useState(
		'これは長いテキストです。ターミナルの幅を超えて折り返されるはずです。',
	);
	const [cursorPos, setCursorPos] = useState(text.length);
	const [targetCol, setTargetCol] = useState<number | null>(null);

	// Calculate visual lines (memoized)
	const visualLines = useMemo(
		() => calculateVisualLines(text, TERMINAL_WIDTH),
		[text],
	);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			return;
		}

		if (key.leftArrow) {
			setCursorPos(Math.max(0, cursorPos - 1));
			setTargetCol(null);
		} else if (key.rightArrow) {
			setCursorPos(Math.min(text.length, cursorPos + 1));
			setTargetCol(null);
		} else if (key.backspace || key.delete) {
			if (cursorPos > 0) {
				setText(text.slice(0, cursorPos - 1) + text.slice(cursorPos));
				setCursorPos(cursorPos - 1);
			}
			setTargetCol(null);
		} else if (key.return) {
			setText(text.slice(0, cursorPos) + '\n' + text.slice(cursorPos));
			setCursorPos(cursorPos + 1);
			setTargetCol(null);
		} else if (key.upArrow || key.downArrow) {
			const direction = key.upArrow ? 'up' : 'down';
			const {newCursorPos, newTargetCol} = handleVerticalMovement(
				direction,
				cursorPos,
				visualLines,
				text.length,
				targetCol,
			);
			setCursorPos(newCursorPos);
			setTargetCol(newTargetCol);
		} else if (!key.tab) {
			setText(text.slice(0, cursorPos) + input + text.slice(cursorPos));
			setCursorPos(cursorPos + input.length);
			setTargetCol(null);
		}
	});

	const logicalLines = text.split('\n');
	const {row: visualRow, col: visualCol} = findCursorPosition(
		cursorPos,
		visualLines,
		text.length,
	);

	return (
		<Box flexDirection="column">
			<Text color="cyan">Multi-line Cursor Position Test</Text>
			<Text color="gray">
				Text wraps at {TERMINAL_WIDTH} cells (full-width chars = 2 cells)
			</Text>
			<Text> </Text>

			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor="blue"
				padding={1}
			>
				{visualLines.lines.map((line, index) => {
					if (index === visualRow) {
						// Show cursor on this line
						const lineChars = Array.from(line);
						const cursorCharIndex = findCharIndexAtColumn(line, visualCol);

						const before = lineChars.slice(0, cursorCharIndex).join('');
						const cursor = lineChars[cursorCharIndex] || ' ';
						const after = lineChars.slice(cursorCharIndex + 1).join('');

						// Empty line with cursor
						if (line === '' && before === '' && after === '') {
							return (
								<Text key={`line-${index}`}>
									<Text inverse> </Text>
								</Text>
							);
						}

						return (
							<Text key={`line-${index}`}>
								{before}
								<Text inverse>{cursor}</Text>
								{after}
							</Text>
						);
					}

					// Empty line without cursor - show as blank line
					if (line === '') {
						return <Text key={`line-${index}`}> </Text>;
					}

					return <Text key={`line-${index}`}>{line}</Text>;
				})}
			</Box>

			<Text> </Text>
			<Text color="yellow">Cursor Info:</Text>
			<Text>
				  Logical position: {cursorPos} / {text.length} characters
			</Text>
			<Text>
				  Visual position: row {visualRow}, col {visualCol} cells
			</Text>
			<Text>  Total visual lines: {visualLines.lines.length}</Text>
			<Text>  Logical lines (with \\n): {logicalLines.length}</Text>
			{visualLines.startPositions.length > 0 && (
				<>
					<Text>
						  Line {visualRow} starts at char:{' '}
						{visualLines.startPositions[visualRow]}
					</Text>
					<Text>
						  Line {visualRow} content: "{visualLines.lines[visualRow]}" (length:{' '}
						{visualLines.lines[visualRow].length})
					</Text>
				</>
			)}

			<Text> </Text>
			<Text color="green">Controls:</Text>
			<Text>  Type text to add at cursor position</Text>
			<Text>  Enter to insert newline</Text>
			<Text>  Arrow keys to move cursor (Up/Down/Left/Right)</Text>
			<Text>  Backspace to delete</Text>
			<Text>  Ctrl+C to exit</Text>

			<Text> </Text>
			<Text color="red" bold>
				Problem:
			</Text>
			<Text>  Terminal cursor (orange █) stays at END of last line</Text>
			<Text>
				  Visual cursor (white █ above) shows where text SHOULD insert
			</Text>
			<Text>  IME candidate window follows terminal cursor (wrong!)</Text>
		</Box>
	);
}

render(<MultilineCursorTest />);
