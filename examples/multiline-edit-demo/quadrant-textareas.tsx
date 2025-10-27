import React, {useMemo, useState} from 'react';
import {Box, Text, render, useInput} from '../../src/index.js';
import {CURSOR_MARKER} from '../../src/cursor-marker.js';

const enableImeCursor = process.env.ENABLE_IME_CURSOR !== 'false';

type AreaDefinition = {
        id: string;
        label: string;
        showCursorMarker: boolean;
        initialValue: string;
};

type AreaState = {
        value: string;
        cursor: number;
};

const areaDefinitions: AreaDefinition[] = [
        {
                id: 'top-left',
                label: 'Top Left',
                showCursorMarker: true,
                initialValue: 'This is the top-left editor.\nTry typing here.',
        },
        {
                id: 'top-right',
                label: 'Top Right',
                showCursorMarker: true,
                initialValue: 'Second editor (top-right).\nSupports multiple lines.',
        },
        {
                id: 'bottom-left',
                label: 'Bottom Left',
                showCursorMarker: true,
                initialValue: 'Bottom-left area.\nUse Tab to move focus.',
        },
        {
                id: 'bottom-right',
                label: 'Bottom Right (no marker)',
                showCursorMarker: false,
                initialValue:
                        'This editor intentionally omits the IME cursor marker.\n' +
                        'Switching focus here reproduces the missing marker case.',
        },
];

const minimumVisibleLines = 3;

type CursorMetadata = {
        line: number;
        column: number;
};

const getCursorMetadata = (value: string, cursor: number): CursorMetadata => {
        const before = value.slice(0, cursor);
        const segments = before.split('\n');
        const line = segments.length - 1;
        const column = segments.at(-1)?.length ?? 0;

        return {line, column};
};

type TextLineProps = {
        line: string;
        isCursorLine: boolean;
        cursorColumn: number;
        isFocused: boolean;
        showCursorMarker: boolean;
};

const TextLine = ({
        line,
        isCursorLine,
        cursorColumn,
        isFocused,
        showCursorMarker,
}: TextLineProps) => {
        if (!isCursorLine) {
                return <Text>{line === '' ? ' ' : line}</Text>;
        }

        const beforeCursor = line.slice(0, cursorColumn);
        const actualChar = line[cursorColumn];
        const cursorChar = actualChar ?? ' ';
        const afterCursor = actualChar === undefined ? '' : line.slice(cursorColumn + 1);

        return (
                <Text>
                        {beforeCursor}
                        {enableImeCursor && isFocused && showCursorMarker && CURSOR_MARKER}
                        {isFocused ? <Text inverse>{cursorChar}</Text> : cursorChar}
                        {afterCursor}
                </Text>
        );
};

const TextArea = ({
        definition,
        state,
        isFocused,
}: {
        definition: AreaDefinition;
        state: AreaState;
        isFocused: boolean;
}) => {
        const {value, cursor} = state;
        const {line, column} = useMemo(() => getCursorMetadata(value, cursor), [value, cursor]);

        const lines = useMemo(() => {
                const baseLines = value.split('\n');
                while (baseLines.length <= line) {
                        baseLines.push('');
                }

                while (baseLines.length < minimumVisibleLines) {
                        baseLines.push('');
                }

                return baseLines;
        }, [value, line]);

        return (
                <Box
                        flexDirection="column"
                        borderStyle="round"
                        borderColor={isFocused ? 'cyan' : 'gray'}
                        padding={1}
                        width={36}
                >
                        <Text bold color={isFocused ? 'cyan' : 'white'}>
                                {definition.label}
                        </Text>
                        {lines.map((lineValue, index) => (
                                <TextLine
                                        key={`${definition.id}-${index}`}
                                        line={lineValue}
                                        isCursorLine={index === line}
                                        cursorColumn={index === line ? column : 0}
                                        isFocused={isFocused}
                                        showCursorMarker={definition.showCursorMarker}
                                />
                        ))}
                        {!definition.showCursorMarker && (
                                <Text color="yellow">
                                        Marker disabled to reproduce missing marker behavior
                                </Text>
                        )}
                </Box>
        );
};

const QuadrantTextAreas = () => {
        const [states, setStates] = useState<AreaState[]>(() =>
                areaDefinitions.map(definition => ({
                        value: definition.initialValue,
                        cursor: definition.initialValue.length,
                })),
        );
        const [focusedIndex, setFocusedIndex] = useState(0);

        useInput((input, key) => {
                if (key.tab) {
                        setFocusedIndex(previous => {
                                const next = key.shift
                                        ? (previous - 1 + areaDefinitions.length) % areaDefinitions.length
                                        : (previous + 1) % areaDefinitions.length;
                                return next;
                        });
                        return;
                }

                const activeDefinition = areaDefinitions[focusedIndex];
                if (!activeDefinition) {
                        return;
                }

                setStates(previousStates => {
                        return previousStates.map((state, index) => {
                                if (index !== focusedIndex) {
                                        return state;
                                }

                                const {value, cursor} = state;

                                if (key.leftArrow) {
                                        return {
                                                value,
                                                cursor: Math.max(0, cursor - 1),
                                        };
                                }

                                if (key.rightArrow) {
                                        return {
                                                value,
                                                cursor: Math.min(value.length, cursor + 1),
                                        };
                                }

                                if (key.home) {
                                        const {line} = getCursorMetadata(value, cursor);
                                        const lineStart = value
                                                .split('\n')
                                                .slice(0, line)
                                                .join('\n').length;
                                        const position = line === 0 ? 0 : lineStart + 1;
                                        return {value, cursor: position};
                                }

                                if (key.end) {
                                        const segments = value.split('\n');
                                        const {line} = getCursorMetadata(value, cursor);
                                        const lineValue = segments[line] ?? '';
                                        const prefixLength = segments
                                                .slice(0, line)
                                                .join('\n').length;
                                        const basePosition = line === 0 ? 0 : prefixLength + 1;
                                        return {value, cursor: basePosition + lineValue.length};
                                }

                                if (key.backspace) {
                                        if (cursor === 0) {
                                                return state;
                                        }

                                        return {
                                                value: value.slice(0, cursor - 1) + value.slice(cursor),
                                                cursor: cursor - 1,
                                        };
                                }

                                if (key.delete) {
                                        if (cursor >= value.length) {
                                                return state;
                                        }

                                        return {
                                                value: value.slice(0, cursor) + value.slice(cursor + 1),
                                                cursor,
                                        };
                                }

                                if (key.return) {
                                        return {
                                                value: value.slice(0, cursor) + '\n' + value.slice(cursor),
                                                cursor: cursor + 1,
                                        };
                                }

                                if (input) {
                                        return {
                                                value: value.slice(0, cursor) + input + value.slice(cursor),
                                                cursor: cursor + input.length,
                                        };
                                }

                                return state;
                        });
                });
        });

        return (
                <Box flexDirection="column" padding={1}>
                        <Text>
                                Four text editors laid out in a 2x2 grid. Use Tab / Shift+Tab to move focus between them.
                        </Text>
                        <Text>
                                When IME cursor positioning is enabled, the focused editor moves the terminal cursor to the block
                                caret.
                        </Text>
                        <Text>Bottom-right editor omits the marker to reproduce the missing marker scenario.</Text>
                        <Text> </Text>
                        <Box flexDirection="column">
                                <Box>
                                        <TextArea
                                                definition={areaDefinitions[0]!}
                                                state={states[0]!}
                                                isFocused={focusedIndex === 0}
                                        />
                                        <Box marginLeft={2}>
                                                <TextArea
                                                        definition={areaDefinitions[1]!}
                                                        state={states[1]!}
                                                        isFocused={focusedIndex === 1}
                                                />
                                        </Box>
                                </Box>
                                <Box marginTop={2}>
                                        <TextArea
                                                definition={areaDefinitions[2]!}
                                                state={states[2]!}
                                                isFocused={focusedIndex === 2}
                                        />
                                        <Box marginLeft={2}>
                                                <TextArea
                                                        definition={areaDefinitions[3]!}
                                                        state={states[3]!}
                                                        isFocused={focusedIndex === 3}
                                                />
                                        </Box>
                                </Box>
                        </Box>
                </Box>
        );
};

render(<QuadrantTextAreas />, {enableImeCursor});
