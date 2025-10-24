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
function MultilineCursorTest() {
	const [text, setText] = useState('これは長いテキストです。ターミナルの幅を超えて折り返されるはずです。');
	const [cursorPos, setCursorPos] = useState(text.length);
	const [targetCol, setTargetCol] = useState<number | null>(null); // Remember column for up/down navigation

	// Calculate visual lines (memoized)
	const terminalWidth = 80;
	const {visualLines, visualLineStartPos} = useMemo(() => {
		const logicalLines = text.split('\n');
		const visualLines: string[] = [];
		const visualLineStartPos: number[] = [];

		let charPos = 0;
		for (let logicalIdx = 0; logicalIdx < logicalLines.length; logicalIdx++) {
			const logicalLine = logicalLines[logicalIdx];
			const chars = Array.from(logicalLine);
			let currentLine = '';
			let lineStartPos = charPos;

			for (const char of chars) {
				const testLine = currentLine + char;
				if (stringWidth(testLine) > terminalWidth && currentLine.length > 0) {
					visualLineStartPos.push(lineStartPos);
					visualLines.push(currentLine);
					lineStartPos = charPos;
					currentLine = char;
				} else {
					currentLine += char;
				}
				charPos++;
			}

			visualLineStartPos.push(lineStartPos);
			visualLines.push(currentLine);

			if (logicalIdx < logicalLines.length - 1) {
				charPos++;
			}
		}

		return {visualLines, visualLineStartPos};
	}, [text, terminalWidth]);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			return;
		}

		if (key.leftArrow) {
			setCursorPos(Math.max(0, cursorPos - 1));
			setTargetCol(null); // Clear target column on horizontal movement
		} else if (key.rightArrow) {
			setCursorPos(Math.min(text.length, cursorPos + 1));
			setTargetCol(null); // Clear target column on horizontal movement
		} else if (key.backspace || key.delete) {
			if (cursorPos > 0) {
				setText(text.slice(0, cursorPos - 1) + text.slice(cursorPos));
				setCursorPos(cursorPos - 1);
			}
			setTargetCol(null);
		} else if (key.return) {
			// Insert newline at cursor position
			setText(text.slice(0, cursorPos) + '\n' + text.slice(cursorPos));
			setCursorPos(cursorPos + 1);
			setTargetCol(null);
		} else if (key.upArrow || key.downArrow) {
			// Find current visual row and column
			let currentRow = -1;
			let currentCol = 0;

			// Find which line the cursor is on
			for (let i = 0; i < visualLines.length; i++) {
				const lineStart = visualLineStartPos[i];
				const lineContent = visualLines[i];
				const lineChars = Array.from(lineContent);

				// Determine the range of cursor positions that belong to this line
				let lineEndExclusive: number;

				if (i < visualLines.length - 1) {
					// Not the last line - line ends before next line starts
					lineEndExclusive = visualLineStartPos[i + 1];
				} else {
					// Last line - includes end of text
					lineEndExclusive = text.length + 1; // +1 to include text.length
				}

				// Check if cursor is within this line's range
				// Use < for upper bound except for last line
				const inRange = i < visualLines.length - 1
					? (cursorPos >= lineStart && cursorPos < lineEndExclusive)
					: (cursorPos >= lineStart && cursorPos <= text.length);

				if (inRange) {
					currentRow = i;
					const posInLine = Math.min(cursorPos - lineStart, lineChars.length);
					const textBeforeCursor = lineChars.slice(0, posInLine).join('');
					currentCol = stringWidth(textBeforeCursor);
					break;
				}
			}

			if (currentRow === -1) {
				// Couldn't find current row, abort
				return;
			}

			// Remember column position for consecutive up/down movements
			const desiredCol = targetCol !== null ? targetCol : currentCol;

			// Calculate target row
			const targetRow = key.upArrow
				? Math.max(0, currentRow - 1)
				: Math.min(visualLines.length - 1, currentRow + 1);

			if (targetRow !== currentRow) {
				// Find character position at desiredCol in target row
				const targetLine = visualLines[targetRow];
				const targetLineStart = visualLineStartPos[targetRow];
				const targetLineChars = Array.from(targetLine);

				let charPos = 0;
				let cellPos = 0;

				// Find the character position that matches desiredCol
				for (let i = 0; i < targetLineChars.length; i++) {
					const charWidth = stringWidth(targetLineChars[i]);
					if (cellPos >= desiredCol) {
						// We've reached or passed the desired column
						charPos = i;
						break;
					}
					cellPos += charWidth;
					charPos = i + 1;
				}

				// If desiredCol is beyond the line, put cursor at end
				if (cellPos < desiredCol && charPos === targetLineChars.length) {
					// Cursor at end of line
				}

				const newCursorPos = targetLineStart + charPos;
				setCursorPos(Math.min(newCursorPos, text.length));
				setTargetCol(desiredCol);
			}
		} else if (!key.tab) {
			// Insert text at cursor position
			setText(text.slice(0, cursorPos) + input + text.slice(cursorPos));
			setCursorPos(cursorPos + input.length);
			setTargetCol(null);
		}
	});

	const logicalLines = text.split('\n');

	// Find which visual line contains the cursor (for display)
	let visualRow = 0;
	let visualCol = 0;

	for (let i = 0; i < visualLines.length; i++) {
		const lineStart = visualLineStartPos[i];
		const lineContent = visualLines[i];
		const lineChars = Array.from(lineContent);

		// Determine the range - same logic as in useInput
		const inRange = i < visualLines.length - 1
			? (cursorPos >= lineStart && cursorPos < visualLineStartPos[i + 1])
			: (cursorPos >= lineStart && cursorPos <= text.length);

		if (inRange) {
			visualRow = i;
			const posInLine = Math.min(cursorPos - lineStart, lineChars.length);
			const textBeforeCursor = lineChars.slice(0, posInLine).join('');
			visualCol = stringWidth(textBeforeCursor);
			break;
		}
	}

	return (
		<Box flexDirection="column">
			<Text color="cyan">Multi-line Cursor Position Test</Text>
			<Text color="gray">Text wraps at {terminalWidth} cells (full-width chars = 2 cells)</Text>
			<Text> </Text>

			<Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1}>
				{visualLines.map((line, index) => {
					if (index === visualRow) {
						// Show cursor on this line
						// visualCol is in cells, need to find character index
						const lineChars = Array.from(line);
						let cursorCharIndex = lineChars.length; // default to end of line
						let cellCount = 0;

						for (let i = 0; i < lineChars.length; i++) {
							const charWidth = stringWidth(lineChars[i]);
							// If adding this char would exceed visualCol, cursor is on this char
							if (cellCount + charWidth > visualCol) {
								cursorCharIndex = i;
								break;
							}
							cellCount += charWidth;
						}

						const before = lineChars.slice(0, cursorCharIndex).join('');
						const cursor = lineChars[cursorCharIndex] || ' ';
						const after = lineChars.slice(cursorCharIndex + 1).join('');

						// Empty line with cursor
						if (line === '' && before === '' && after === '') {
							return <Text key={`line-${index}`}><Text inverse> </Text></Text>;
						}

						return (
							<Text key={`line-${index}`}>
								{before}<Text inverse>{cursor}</Text>{after}
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
			<Text>  Logical position: {cursorPos} / {text.length} characters</Text>
			<Text>  Visual position: row {visualRow}, col {visualCol} cells</Text>
			<Text>  Total visual lines: {visualLines.length}</Text>
			<Text>  Logical lines (with \\n): {logicalLines.length}</Text>
			{visualLineStartPos.length > 0 && (
				<>
					<Text>  Line {visualRow} starts at char: {visualLineStartPos[visualRow]}</Text>
					<Text>  Line {visualRow} content: "{visualLines[visualRow]}" (length: {visualLines[visualRow].length})</Text>
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
			<Text color="red" bold>Problem:</Text>
			<Text>  Terminal cursor (orange █) stays at END of last line</Text>
			<Text>  Visual cursor (white █ above) shows where text SHOULD insert</Text>
			<Text>  IME candidate window follows terminal cursor (wrong!)</Text>
		</Box>
	);
}

render(<MultilineCursorTest />);
