import {type Writable} from 'node:stream';
import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';

export type LogUpdate = {
	clear: () => void;
	done: () => void;
	sync: (str: string) => void;
	(str: string): void;
};

const create = (stream: Writable, {showCursor = false} = {}): LogUpdate => {
	let previousLineCount = 0;
	let previousOutput = '';
	let hasHiddenCursor = false;

	const render = (str: string) => {
		if (!showCursor && !hasHiddenCursor) {
			cliCursor.hide();
			hasHiddenCursor = true;
		}

		// When cursor is visible, remove any trailing newlines to keep cursor on input line
		// When cursor is hidden, ensure there's a trailing newline
		let output: string;
		if (showCursor) {
			// Remove trailing zero-width spaces (used as markers)
			let processed = str.replace(/\u200B/g, '');
			// Remove trailing newlines when cursor is visible
			output = processed.replace(/\n+$/, '');
		} else {
			// Ensure trailing newline when cursor is hidden
			output = str.endsWith('\n') ? str : str + '\n';
		}
		if (output === previousOutput) {
			return;
		}

		previousOutput = output;

		// Calculate cursor position when showCursor is true
		let cursorPosition = '';
		if (showCursor && str.length > 0) {
			// Count zero-width space markers to determine how many cells to move back
			// This allows components to control cursor position by adding multiple markers
			const zeroWidthSpaceCount = (str.match(/\u200B/g) || []).length;
			if (zeroWidthSpaceCount > 0) {
				// Move cursor back N cells to position it correctly
				cursorPosition = `\x1b[${zeroWidthSpaceCount}D`;
			}
		}

		stream.write('\x1b[?2026h' + ansiEscapes.eraseLines(previousLineCount) + output + cursorPosition + '\x1b[?2026l');
		previousLineCount = output.split('\n').length;
	};

	render.clear = () => {
		stream.write('\x1b[?2026h' + ansiEscapes.eraseLines(previousLineCount) + '\x1b[?2026l');
		previousOutput = '';
		previousLineCount = 0;
	};

	render.done = () => {
		previousOutput = '';
		previousLineCount = 0;

		if (!showCursor) {
			cliCursor.show();
			hasHiddenCursor = false;
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
