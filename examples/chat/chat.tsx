import React, {useState} from 'react';
import {render, Text, Box, useInput} from '../../src/index.js';

let messageId = 0;

function ChatApp() {
	const [input, setInput] = useState('');

	const [messages, setMessages] = useState<
		Array<{
			id: number;
			text: string;
		}>
	>([]);

	useInput((character, key) => {
		if (key.return) {
			if (input) {
				setMessages(previousMessages => [
					...previousMessages,
					{
						id: messageId++,
						text: `User: ${input}`,
					},
				]);
				setInput('');
			}
		} else if (key.backspace || key.delete) {
			setInput(currentInput => currentInput.slice(0, -1));
		} else {
			setInput(currentInput => currentInput + character);
		}
	});

	return (
		<Box flexDirection="column">
			<Box flexDirection="column">
				{messages.map(message => (
					<Text key={message.id}>{message.text}</Text>
				))}
			</Box>

			<Text>
				Enter your message: {input}
				<Text backgroundColor="white" color="black">█</Text>
				<Text>{'\u200B'}</Text>
			</Text>
		</Box>
	);
}

render(<ChatApp />);
