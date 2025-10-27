import process from 'node:process';
import React, {useEffect, useState} from 'react';
import {Box, Text, render} from '../../src/index.js';
import {CURSOR_MARKER} from '../../src/cursor-marker.js';

const Frame = ({showMarker}: {showMarker: boolean}) => (
        <Box flexDirection="column">
                <Text>
                        {showMarker ? (
                                <>
                                        {CURSOR_MARKER}
                                        <Text inverse>█</Text>
                                        Marker frame line 1
                                </>
                        ) : (
                                'Frame without marker line 1'
                        )}
                </Text>
                <Text>
                        {showMarker
                                ? 'Marker frame line 2 should be cleared'
                                : 'Frame without marker line 2'}
                </Text>
                <Text>
                        {showMarker
                                ? 'Marker frame line 3 should be cleared'
                                : 'Frame without marker line 3'}
                </Text>
        </Box>
);

const App = () => {
        const [showMarker, setShowMarker] = useState(true);

        useEffect(() => {
                const toggle = setTimeout(() => {
                        setShowMarker(false);
                }, 50);

                const exit = setTimeout(() => {
                        process.exit(0);
                }, 200);

                return () => {
                        clearTimeout(toggle);
                        clearTimeout(exit);
                };
        }, []);

        return <Frame showMarker={showMarker} />;
};

render(<App />, {enableImeCursor: true});
