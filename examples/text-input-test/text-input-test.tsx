import React, {useState} from 'react';
import {render, Text, Box} from '../../src/index.js';
import TextInput from './text-input-local.js';

function TextInputTestApp() {
	const [input, setInput] = useState('');
	const [messages, setMessages] = useState<string[]>([]);

	const handleSubmit = (value: string) => {
		if (value) {
			setMessages([...messages, `You typed: ${value}`]);
			setInput('');
		}
	};

	return (
		<Box flexDirection="column">
			<Box flexDirection="column">
				{messages.map((message, index) => (
					<Text key={index}>{message}</Text>
				))}
			</Box>

			<Box>
				<Text>Enter text: </Text>
				<TextInput
					value={input}
					placeholder="Type here..."
					focus={true}
					showCursor={true}
					onChange={setInput}
					onSubmit={handleSubmit}
				/>
			</Box>
		</Box>
	);
}

render(<TextInputTestApp />);
