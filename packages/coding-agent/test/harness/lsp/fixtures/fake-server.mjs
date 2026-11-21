// Minimal LSP server over stdio for the lsp extension tests: reports an error and a warning for any
// document that contains "BAD", answers hover with a fixed text, and exits on `exit`.
let buffer = Buffer.alloc(0);

function send(message) {
	const json = JSON.stringify({ jsonrpc: "2.0", ...message });
	process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function publish(uri, text) {
	const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
	const diagnostics = text.includes("BAD")
		? [
				{ range, severity: 1, message: "bad token", source: "fake", code: 7 },
				{ range, severity: 2, message: "just a warning", source: "fake" },
			]
		: [];
	send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
}

function handle(message) {
	switch (message.method) {
		case "initialize":
			send({ id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1 } } } });
			break;
		case "textDocument/didOpen":
			publish(message.params.textDocument.uri, message.params.textDocument.text);
			break;
		case "textDocument/didChange":
			publish(message.params.textDocument.uri, message.params.contentChanges[0].text);
			break;
		case "textDocument/hover":
			send({ id: message.id, result: { contents: "fake hover" } });
			break;
		case "shutdown":
			send({ id: message.id, result: null });
			break;
		case "exit":
			process.exit(0);
	}
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd < 0) return;
		const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
		if (buffer.length < headerEnd + 4 + length) return;
		const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString();
		buffer = buffer.subarray(headerEnd + 4 + length);
		handle(JSON.parse(body));
	}
});
