import {type Writable} from 'node:stream';
import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import {findAndRemoveMarker} from './cursor-marker.js';

export type LogUpdate = {
	clear: () => void;
	done: () => void;
	sync: (str: string) => void;
	setOutputStartRow: (row: number) => void;
	(str: string): void;
};

const create = (stream: Writable, {showCursor = false} = {}): LogUpdate => {
	let previousLineCount = 0;
	let previousOutput = '';
	let hasHiddenCursor = false;
	let isCursorVisible = false;
	let outputStartRow: number | undefined;
	let outputEndPosition: {rowOffset: number; col: number} | undefined;
	let previousCursorPosition: {rowOffset: number; col: number} | undefined;
	let previousMarkerPosition: {row: number; col: number} | undefined;

	// Get terminal height (fallback to default if not available)
	const DEFAULT_TERMINAL_HEIGHT = 24;
	const getTerminalHeight = (): number => {
		if ('rows' in stream && typeof stream.rows === 'number') {
			return stream.rows;
		}
		return DEFAULT_TERMINAL_HEIGHT; // Standard terminal height fallback
	};

	const render = (str: string) => {
		if (!showCursor && !hasHiddenCursor) {
			cliCursor.hide();
			hasHiddenCursor = true;
		}

		// Detect and remove cursor marker
		const {cleaned, position} = findAndRemoveMarker(str);

		/**
		 * Border alignment fix for marker removal
		 *
		 * Problem: When we remove the marker character (U+E000), some terminals
		 * still reserve 1 cell of width for it, causing the right border │ to
		 * shift left by 1 character on the cursor line only.
		 *
		 * Solution: Insert a compensating space before the right border to push
		 * it back to the correct column, maintaining visual alignment across all lines.
		 *
		 * This is a workaround for terminal rendering inconsistencies where the
		 * marker character is not truly zero-width.
		 */
		let fixedCleaned = cleaned;
		if (position) {
			const lines = cleaned.split('\n');
			const cursorLine = lines[position.row];
			if (cursorLine) {
				// Find the last occurrence of │ (right border) and insert space before it
				const lastBorderIndex = cursorLine.lastIndexOf('│');
				let paddedLine: string;
				if (lastBorderIndex >= 0) {
					// Insert space before the right border
					paddedLine = cursorLine.slice(0, lastBorderIndex) + ' ' + cursorLine.slice(lastBorderIndex);
				} else {
					// No border found, add space at the end
					paddedLine = cursorLine + ' ';
				}

				lines[position.row] = paddedLine;
				fixedCleaned = lines.join('\n');
			}
		}

		// When cursor is visible, remove any trailing newlines to keep cursor on input line
		// When cursor is hidden, ensure there's a trailing newline
		let output: string;
		if (showCursor) {
			// Remove trailing newlines when cursor is visible
			output = fixedCleaned.replace(/\n+$/, '');
		} else {
			// Ensure trailing newline when cursor is hidden
			output = fixedCleaned.endsWith('\n') ? fixedCleaned : fixedCleaned + '\n';
		}

		// Check if both output AND cursor position are unchanged
		const markerPositionChanged = position !== previousMarkerPosition &&
			!(position && previousMarkerPosition &&
			  position.row === previousMarkerPosition.row &&
			  position.col === previousMarkerPosition.col);

		if (output === previousOutput && !markerPositionChanged) {
			return;
		}

		previousOutput = output;
		previousMarkerPosition = position ? {...position} : undefined;

		// After eraseLines(), cursor will be at the start of the cleared area (row 0, col 0)
		// We need to move it to output end position for the next eraseLines() to work correctly
		let restoreCursor = '';
		if (showCursor && previousCursorPosition && outputEndPosition) {
			// After eraseLines(), cursor is at (outputStartRow, col 0)
			// We need to move to outputEndPosition for consistency

			// Move down to the output end row
			if (outputEndPosition.rowOffset > 0) {
				restoreCursor += `\x1b[${outputEndPosition.rowOffset}B`; // Down
			}

			// Move right to the output end column
			if (outputEndPosition.col > 0) {
				restoreCursor += `\x1b[${outputEndPosition.col}C`; // Right
			}
		}

		// Cursor control
		let cursorControl = '';

		if (showCursor) {
			// Only show cursor when we have both position marker and output start row
			const shouldShowCursor = position !== undefined && outputStartRow !== undefined;

			// Only change cursor visibility when state changes
			if (shouldShowCursor && !isCursorVisible) {
				cursorControl += '\x1b[?25h'; // Show cursor
				isCursorVisible = true;
			} else if (!shouldShowCursor && isCursorVisible) {
				cursorControl += '\x1b[?25l'; // Hide cursor
				isCursorVisible = false;
			}

			// Move cursor to marker position using RELATIVE positioning only
			if (position && outputStartRow !== undefined) {
				// Calculate where cursor will be after writing output
				const lines = output.split('\n');
				const lastLine = lines[lines.length - 1] || '';
				const endRow = lines.length - 1; // Relative to output start
				const endCol = stringWidth(stripAnsi(lastLine)); // Use stringWidth for multi-byte chars

				// Target position relative to output start
				const targetRow = position.row;
				const targetCol = position.col;

				// Calculate relative movement from end position
				const rowDiff = targetRow - endRow;
				const colDiff = targetCol - endCol;

				// Always perform relative cursor movement
				// Since we're only using relative commands, they will work regardless of scrolling
				// The terminal handles boundaries automatically

				// First move vertically
				if (rowDiff > 0) {
					// Move down
					cursorControl += `\x1b[${rowDiff}B`;
				} else if (rowDiff < 0) {
					// Move up
					cursorControl += `\x1b[${-rowDiff}A`;
				}

				// Then move horizontally
				if (colDiff > 0) {
					// Move right
					cursorControl += `\x1b[${colDiff}C`;
				} else if (colDiff < 0) {
					// Move left
					cursorControl += `\x1b[${-colDiff}D`;
				}
			}
		}

		const finalOutput = restoreCursor +
			ansiEscapes.eraseLines(previousLineCount) +
			output +
			cursorControl;

		stream.write(finalOutput);

		previousLineCount = output.split('\n').length;

		// Record output end position for next render (as offset from outputStartRow)
		if (showCursor && outputStartRow !== undefined) {
			const lines = output.split('\n');
			const lastLine = lines[lines.length - 1] || '';
			// Use stringWidth to get actual display width (handles multi-byte chars)
			const lastLineLength = stringWidth(stripAnsi(lastLine));

			// Detect if scroll occurred and adjust outputStartRow
			const terminalHeight = getTerminalHeight();
			const outputEndRow = outputStartRow + lines.length - 1;

			if (outputEndRow > terminalHeight) {
				// Scroll occurred - adjust outputStartRow
				const scrollAmount = outputEndRow - terminalHeight;
				outputStartRow = Math.max(1, outputStartRow - scrollAmount);
			}

			outputEndPosition = {
				rowOffset: lines.length - 1, // Offset from outputStartRow
				col: lastLineLength, // 0-indexed for easier calculation
			};

			// Record cursor position (either IME position or output end)
			if (position) {
				previousCursorPosition = {
					rowOffset: position.row,
					col: position.col,
				};
			} else {
				// No cursor movement, so cursor stays at output end
				previousCursorPosition = {...outputEndPosition};
			}
		}
	};

	render.clear = () => {
		stream.write(ansiEscapes.eraseLines(previousLineCount));
		previousOutput = '';
		previousLineCount = 0;
		// Note: outputStartRow is NOT reset on clear (only on resize)
	};

	render.done = () => {
		previousOutput = '';
		previousLineCount = 0;
		outputStartRow = undefined;

		if (!showCursor) {
			cliCursor.show();
			hasHiddenCursor = false;
		}

		// Always restore cursor visibility on exit
		if (!isCursorVisible) {
			stream.write('\x1b[?25h'); // Show cursor
			isCursorVisible = true;
		}
	};

	render.setOutputStartRow = (row: number) => {
		if (showCursor && outputStartRow === undefined) {
			outputStartRow = row;
		}
	};

	render.sync = (str: string) => {
		const output = showCursor ? str : str + '\n';
		previousOutput = output;
		previousLineCount = output.split('\n').length;
	};

	return render;
};

const logUpdate = {create};
export default logUpdate;
