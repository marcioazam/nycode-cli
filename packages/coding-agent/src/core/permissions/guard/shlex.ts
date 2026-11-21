// Port of Python's `shlex.shlex(text, posix=True, punctuation_chars=...)` with `whitespace_split` on and no comment
// characters, which is how guard.py tokenizes (`tokenize`) and how `shlex.split` reads a pgrep line. Same state machine.

const PUNCTUATION = "();<>|&";
const WHITESPACE = " \t\r\n";

/** An unclosed quote or a trailing escape: Python raises ValueError there. */
export class ShlexError extends Error {}

/** Splits `text` like POSIX shell words; with `punctuation` `();<>|&` runs become tokens of their own. */
export function shlexSplit(text: string, punctuation: boolean): string[] {
	const punct = punctuation ? PUNCTUATION : "";
	const pushback: string[] = [];
	let pos = 0;
	// ' ' between tokens, 'a' in a word, 'c' in a punctuation run, a quote or '\\' inside them, null after the end.
	let state: string | null = " ";
	let token = "";

	const readToken = (): string | null => {
		let quoted = false;
		let escapedState = " ";
		for (;;) {
			const ch = pushback.length > 0 ? (pushback.pop() as string) : pos < text.length ? text[pos++] : "";
			if (state === null) {
				token = "";
				break;
			}
			if (state === " ") {
				if (ch === "") {
					state = null;
					break;
				}
				if (WHITESPACE.includes(ch)) {
					if (token !== "" || quoted) break;
				} else if (ch === "\\") {
					escapedState = "a";
					state = ch;
				} else if (punct.includes(ch)) {
					token = ch;
					state = "c";
				} else if (ch === "'" || ch === '"') {
					state = ch;
				} else {
					token = ch;
					state = "a";
				}
			} else if (state === "'" || state === '"') {
				quoted = true;
				if (ch === "") throw new ShlexError("No closing quotation");
				if (ch === state) {
					state = "a";
				} else if (ch === "\\" && state === '"') {
					escapedState = state;
					state = ch;
				} else {
					token += ch;
				}
			} else if (state === "\\") {
				if (ch === "") throw new ShlexError("No escaped character");
				// In POSIX shells only the quote itself or the escape character may be escaped inside quotes.
				if ((escapedState === "'" || escapedState === '"') && ch !== state && ch !== escapedState) token += state;
				token += ch;
				state = escapedState;
			} else {
				if (ch === "") {
					state = null;
					break;
				}
				if (WHITESPACE.includes(ch)) {
					state = " ";
					if (token !== "" || quoted) break;
				} else if (state === "c") {
					if (punct.includes(ch)) {
						token += ch;
					} else {
						if (!WHITESPACE.includes(ch)) pushback.push(ch);
						state = " ";
						break;
					}
				} else if (ch === "'" || ch === '"') {
					state = ch;
				} else if (ch === "\\") {
					escapedState = "a";
					state = ch;
				} else if (!punct.includes(ch)) {
					token += ch;
				} else {
					pushback.push(ch);
					state = " ";
					if (token !== "" || quoted) break;
				}
			}
		}
		const result = token;
		token = "";
		return !quoted && result === "" ? null : result;
	};

	const tokens: string[] = [];
	for (let next = readToken(); next !== null; next = readToken()) tokens.push(next);
	return tokens;
}
