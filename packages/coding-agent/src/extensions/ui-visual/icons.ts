/** Ícones: Nerd Font (kitty ou terminal.nerdFont) com fallback Unicode de largura simples. Contrato usado por tools.ts. */

export type IconName =
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "ok"
	| "err"
	| "pending"
	| "branch"
	| "clock"
	| "think";
export type Env = Record<string, string | undefined>;

// Nerd Fonts 3.5.1 (glyphnames.json).
const NERD: Record<IconName, string> = {
	read: "\uf4a5",
	bash: "\uf489",
	edit: "\uf448",
	write: "\uf4d0",
	grep: "\uf422",
	find: "\uf413",
	ls: "\uf451",
	ok: "\uf42e",
	err: "\uf467",
	pending: "\uf444",
	branch: "\uf418",
	clock: "\uf43a",
	think: "\u{f09d1}",
};

const UNICODE: Record<IconName, string> = {
	read: "▤",
	bash: "$",
	edit: "✎",
	write: "+",
	grep: "⌕",
	find: "⌕",
	ls: "≡",
	ok: "✓",
	err: "✗",
	pending: "●",
	branch: "⎇",
	clock: "◷",
	think: "◇",
};

const set = (v: string | undefined): boolean => (v ?? "") !== "";

/** Preferências terminal.nerdFont / terminal.asciiIcons já resolvidas (env NYCODE_* > settings.json > padrão). */
export type IconPrefs = { nerdFont: boolean | "auto"; asciiIcons: boolean };

let prefs: IconPrefs = { nerdFont: "auto", asciiIcons: false };

/** Chamado no session_start de ui-visual; o estado é do processo, como o tema. */
export const setIconPrefs = (next: IconPrefs): void => {
	prefs = next;
};

/** asciiIcons e NO_COLOR forçam o fallback; nerdFont explícito vale; "auto" só liga no kitty (sem sondar fontes). */
export const nerdFont = (env: Env = process.env, p: IconPrefs = prefs): boolean => {
	if (p.asciiIcons || set(env.NO_COLOR)) return false;
	if (p.nerdFont !== "auto") return p.nerdFont;
	return env.TERM === "xterm-kitty" || set(env.KITTY_WINDOW_ID);
};

export const icon = (name: IconName, env: Env = process.env, p: IconPrefs = prefs): string =>
	nerdFont(env, p) ? NERD[name] : UNICODE[name];
