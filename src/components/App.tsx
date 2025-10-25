import {EventEmitter} from 'node:events';
import process from 'node:process';
import React, {PureComponent, type ReactNode} from 'react';
import cliCursor from 'cli-cursor';
import AppContext from './AppContext.js';
import StdinContext from './StdinContext.js';
import StdoutContext from './StdoutContext.js';
import StderrContext from './StderrContext.js';
import FocusContext from './FocusContext.js';
import ErrorOverview from './ErrorOverview.js';

const tab = '\t';
const shiftTab = '\u001B[Z';
const escape = '\u001B';

type Props = {
	readonly children: ReactNode;
	readonly stdin: NodeJS.ReadStream;
	readonly stdout: NodeJS.WriteStream;
	readonly stderr: NodeJS.WriteStream;
	readonly writeToStdout: (data: string) => void;
	readonly writeToStderr: (data: string) => void;
	readonly exitOnCtrlC: boolean;
	readonly onExit: (error?: Error) => void;
};

type State = {
	readonly isFocusEnabled: boolean;
	readonly activeFocusId?: string;
	readonly focusables: Focusable[];
	readonly error?: Error;
};

type Focusable = {
	readonly id: string;
	readonly isActive: boolean;
};

// Root component for all Ink apps
// It renders stdin and stdout contexts, so that children can access them if needed
// It also handles Ctrl+C exiting and cursor visibility
export default class App extends PureComponent<Props, State> {
	static displayName = 'InternalApp';

	static getDerivedStateFromError(error: Error) {
		return {error};
	}

	override state = {
		isFocusEnabled: true,
		activeFocusId: undefined,
		focusables: [],
		error: undefined,
	};

	// Count how many components enabled raw mode to avoid disabling
	// raw mode until all components don't need it anymore
	rawModeEnabledCount = 0;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	internal_eventEmitter = new EventEmitter();

	// Cursor position query handling
	onCursorPositionReceived?: (row: number, col: number) => void;
	cursorPositionCallback?: (row: number, col: number) => void;
	stdinBuffer = '';
	cursorQueryTimeout?: NodeJS.Timeout;
	pendingCursorPositionRequest?: () => void;

	// Constants for cursor position query
	static readonly CURSOR_POSITION_TIMEOUT_MS = 100;

	// Determines if TTY is supported on the provided stdin
	isRawModeSupported(): boolean {
		return this.props.stdin.isTTY;
	}

	override render() {
		return (
			<AppContext.Provider
				// eslint-disable-next-line react/jsx-no-constructed-context-values
				value={{
					exit: this.handleExit,
				}}
			>
				<StdinContext.Provider
					// eslint-disable-next-line react/jsx-no-constructed-context-values
					value={{
						stdin: this.props.stdin,
						setRawMode: this.handleSetRawMode,
						isRawModeSupported: this.isRawModeSupported(),
						// eslint-disable-next-line @typescript-eslint/naming-convention
						internal_exitOnCtrlC: this.props.exitOnCtrlC,
						// eslint-disable-next-line @typescript-eslint/naming-convention
						internal_eventEmitter: this.internal_eventEmitter,
					}}
				>
					<StdoutContext.Provider
						// eslint-disable-next-line react/jsx-no-constructed-context-values
						value={{
							stdout: this.props.stdout,
							write: this.props.writeToStdout,
						}}
					>
						<StderrContext.Provider
							// eslint-disable-next-line react/jsx-no-constructed-context-values
							value={{
								stderr: this.props.stderr,
								write: this.props.writeToStderr,
							}}
						>
							<FocusContext.Provider
								// eslint-disable-next-line react/jsx-no-constructed-context-values
								value={{
									activeId: this.state.activeFocusId,
									add: this.addFocusable,
									remove: this.removeFocusable,
									activate: this.activateFocusable,
									deactivate: this.deactivateFocusable,
									enableFocus: this.enableFocus,
									disableFocus: this.disableFocus,
									focusNext: this.focusNext,
									focusPrevious: this.focusPrevious,
									focus: this.focus,
								}}
							>
								{this.state.error ? (
									<ErrorOverview error={this.state.error as Error} />
								) : (
									this.props.children
								)}
							</FocusContext.Provider>
						</StderrContext.Provider>
					</StdoutContext.Provider>
				</StdinContext.Provider>
			</AppContext.Provider>
		);
	}

	override componentDidMount() {
		// Note: Cursor hiding is disabled to support IME (Input Method Editor)
		// The cursor visibility is now managed by the showCursor option in ink.tsx
		// cliCursor.hide(this.props.stdout);

		// Query cursor position for absolute positioning (IME support)
		// This will be queued until raw mode is enabled
		this.requestCursorPosition((row, col) => {
			if (this.onCursorPositionReceived) {
				this.onCursorPositionReceived(row, col);
			}
		});
	}

	override componentWillUnmount() {
		// Clean up cursor position query timeout if pending
		if (this.cursorQueryTimeout) {
			clearTimeout(this.cursorQueryTimeout);
			this.cursorQueryTimeout = undefined;
		}

		cliCursor.show(this.props.stdout);

		// ignore calling setRawMode on an handle stdin it cannot be called
		if (this.isRawModeSupported()) {
			this.handleSetRawMode(false);
		}
	}

	override componentDidCatch(error: Error) {
		this.handleExit(error);
	}

	handleSetRawMode = (isEnabled: boolean): void => {
		const {stdin} = this.props;

		if (!this.isRawModeSupported()) {
			if (stdin === process.stdin) {
				throw new Error(
					'Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported',
				);
			} else {
				throw new Error(
					'Raw mode is not supported on the stdin provided to Ink.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported',
				);
			}
		}

		stdin.setEncoding('utf8');

		if (isEnabled) {
			// Ensure raw mode is enabled only once
			if (this.rawModeEnabledCount === 0) {
				stdin.ref();
				stdin.setRawMode(true);
				stdin.addListener('readable', this.handleReadable);
			}

			// Increment count BEFORE executing pending requests so they don't get queued again
			this.rawModeEnabledCount++;

			// Execute any pending cursor position request now that raw mode is enabled
			if (this.pendingCursorPositionRequest) {
				const request = this.pendingCursorPositionRequest;
				this.pendingCursorPositionRequest = undefined;
				request();
			}

			return;
		}

		// Disable raw mode only when no components left that are using it
		if (--this.rawModeEnabledCount === 0) {
			stdin.setRawMode(false);
			stdin.removeListener('readable', this.handleReadable);
			stdin.unref();
		}
	};

	handleReadable = (): void => {
		let chunk;
		// eslint-disable-next-line @typescript-eslint/ban-types
		while ((chunk = this.props.stdin.read() as string | null) !== null) {
			// If waiting for cursor position response, buffer all input
			if (this.cursorPositionCallback) {
				this.stdinBuffer += chunk;

				// Check for complete cursor position response: ESC[{row};{col}R
				// eslint-disable-next-line unicorn/no-hex-escape, no-control-regex
				const regex = /\x1b\[(\d+);(\d+)R/;
				const match = regex.exec(this.stdinBuffer);
				if (match && match[1] && match[2]) {
					const row = Number.parseInt(match[1], 10);
					const col = Number.parseInt(match[2], 10);

					// Clear timeout
					if (this.cursorQueryTimeout) {
						clearTimeout(this.cursorQueryTimeout);
						this.cursorQueryTimeout = undefined;
					}

					// Call the callback
					const callback = this.cursorPositionCallback;
					this.cursorPositionCallback = undefined;
					if (callback) {
						callback(row, col);
					}

					// Remove the cursor response from buffer and process remaining data
					const responseEnd = (match.index ?? 0) + match[0].length;
					const remaining = this.stdinBuffer.slice(responseEnd);
					this.stdinBuffer = '';

					// Process any remaining buffered data
					if (remaining.length > 0) {
						this.handleInput(remaining);
						this.internal_eventEmitter.emit('input', remaining);
					}
				}
			} else {
				// Normal processing when not waiting for cursor response
				this.handleInput(chunk);
				this.internal_eventEmitter.emit('input', chunk);
			}
		}
	};

	handleInput = (input: string): void => {
		// Exit on Ctrl+C
		// eslint-disable-next-line unicorn/no-hex-escape
		if (input === '\x03' && this.props.exitOnCtrlC) {
			this.handleExit();
		}

		// Reset focus when there's an active focused component on Esc
		if (input === escape && this.state.activeFocusId) {
			this.setState({
				activeFocusId: undefined,
			});
		}

		if (this.state.isFocusEnabled && this.state.focusables.length > 0) {
			if (input === tab) {
				this.focusNext();
			}

			if (input === shiftTab) {
				this.focusPrevious();
			}
		}
	};

	/**
	 * Request the current cursor position from the terminal using DSR (Device Status Report).
	 *
	 * The terminal will respond with ESC[{row};{col}R, which will be parsed from stdin.
	 * If the terminal doesn't respond within the timeout period, the callback will be
	 * called with (1, 1) as a fallback to allow the application to continue.
	 *
	 * @param callback - Called with (row, col) when terminal responds, or (1, 1) on timeout
	 *
	 * @example
	 * ```typescript
	 * this.requestCursorPosition((row, col) => {
	 *   console.log(`Cursor is at row ${row}, column ${col}`);
	 * });
	 * ```
	 */
	requestCursorPosition = (
		callback: (row: number, col: number) => void,
	): void => {
		// If raw mode is not yet enabled, store for later
		if (this.rawModeEnabledCount === 0) {
			this.pendingCursorPositionRequest = () => {
				// This closure captures 'callback'
				this.requestCursorPosition(callback);
			};
			return;
		}

		// Handle race condition: if a query is already pending, clear it
		if (this.cursorQueryTimeout) {
			clearTimeout(this.cursorQueryTimeout);
			this.cursorQueryTimeout = undefined;
		}

		// Set callback
		this.cursorPositionCallback = callback;

		// Set timeout in case terminal doesn't respond
		this.cursorQueryTimeout = setTimeout(() => {
			this.cursorQueryTimeout = undefined;
			const timeoutCallback = this.cursorPositionCallback;
			this.cursorPositionCallback = undefined;
			this.stdinBuffer = '';
			// Terminal didn't respond - fall back to row 1, col 1
			// This allows the application to start even if DSR is not supported
			if (timeoutCallback) {
				timeoutCallback(1, 1);
			}
		}, App.CURSOR_POSITION_TIMEOUT_MS);

		// Send cursor position query (DSR - Device Status Report)
		// Write directly to stdout, bypassing Ink's rendering system
		// eslint-disable-next-line unicorn/no-hex-escape
		this.props.stdout.write('\x1b[6n');
	};

	handleExit = (error?: Error): void => {
		if (this.isRawModeSupported()) {
			this.handleSetRawMode(false);
		}

		this.props.onExit(error);
	};

	enableFocus = (): void => {
		this.setState({
			isFocusEnabled: true,
		});
	};

	disableFocus = (): void => {
		this.setState({
			isFocusEnabled: false,
		});
	};

	focus = (id: string): void => {
		this.setState(previousState => {
			const hasFocusableId = previousState.focusables.some(
				focusable => focusable?.id === id,
			);

			if (!hasFocusableId) {
				return previousState;
			}

			return {activeFocusId: id};
		});
	};

	focusNext = (): void => {
		this.setState(previousState => {
			const firstFocusableId = previousState.focusables.find(
				focusable => focusable.isActive,
			)?.id;
			const nextFocusableId = this.findNextFocusable(previousState);

			return {
				activeFocusId: nextFocusableId ?? firstFocusableId,
			};
		});
	};

	focusPrevious = (): void => {
		this.setState(previousState => {
			const lastFocusableId = previousState.focusables.findLast(
				focusable => focusable.isActive,
			)?.id;
			const previousFocusableId = this.findPreviousFocusable(previousState);

			return {
				activeFocusId: previousFocusableId ?? lastFocusableId,
			};
		});
	};

	addFocusable = (id: string, {autoFocus}: {autoFocus: boolean}): void => {
		this.setState(previousState => {
			let nextFocusId = previousState.activeFocusId;

			if (!nextFocusId && autoFocus) {
				nextFocusId = id;
			}

			return {
				activeFocusId: nextFocusId,
				focusables: [
					...previousState.focusables,
					{
						id,
						isActive: true,
					},
				],
			};
		});
	};

	removeFocusable = (id: string): void => {
		this.setState(previousState => ({
			activeFocusId:
				previousState.activeFocusId === id
					? undefined
					: previousState.activeFocusId,
			focusables: previousState.focusables.filter(focusable => {
				return focusable.id !== id;
			}),
		}));
	};

	activateFocusable = (id: string): void => {
		this.setState(previousState => ({
			focusables: previousState.focusables.map(focusable => {
				if (focusable.id !== id) {
					return focusable;
				}

				return {
					id,
					isActive: true,
				};
			}),
		}));
	};

	deactivateFocusable = (id: string): void => {
		this.setState(previousState => ({
			activeFocusId:
				previousState.activeFocusId === id
					? undefined
					: previousState.activeFocusId,
			focusables: previousState.focusables.map(focusable => {
				if (focusable.id !== id) {
					return focusable;
				}

				return {
					id,
					isActive: false,
				};
			}),
		}));
	};

	findNextFocusable = (state: State): string | undefined => {
		const activeIndex = state.focusables.findIndex(focusable => {
			return focusable.id === state.activeFocusId;
		});

		for (
			let index = activeIndex + 1;
			index < state.focusables.length;
			index++
		) {
			const focusable = state.focusables[index];

			if (focusable?.isActive) {
				return focusable.id;
			}
		}

		return undefined;
	};

	findPreviousFocusable = (state: State): string | undefined => {
		const activeIndex = state.focusables.findIndex(focusable => {
			return focusable.id === state.activeFocusId;
		});

		for (let index = activeIndex - 1; index >= 0; index--) {
			const focusable = state.focusables[index];

			if (focusable?.isActive) {
				return focusable.id;
			}
		}

		return undefined;
	};
}
