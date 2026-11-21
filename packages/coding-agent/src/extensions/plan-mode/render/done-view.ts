// Exibição das tags [DONE:n] e blocos de estado do plano no chat (2026-11-18):
// - Layout único padronizado para todos os estados (`em espera`, `bloqueado`, `cancelado`, avanço de etapa), sempre com o
//   ícone de Plano (Opção 1 `U+EB9D` no Kitty/Nerd Font, `◈` Unicode, `^` ASCII) e a palavra `plano`.
// - Etapa + barra de progresso (com micro-cometa opcional) + % ficam colados ao título à esquerda.
// - Data/hora de envio fica em pílula discreta no canto superior direito (Solução 2).
// - `em espera` usa cor roxa/lavanda (`wait`), separada do ciano (`run` exclusivo para execução ativa).
// - `bloqueado` exibe o ícone de warning (`\uf421` / `▲` / `!`) junto de `precisa de você`.
export interface DoneStep {
	step: number;
	text: string;
	completed?: boolean;
}
export type Env = Record<string, string | undefined>;
export interface DonePaint {
	ok: (s: string) => string;
	muted: (s: string) => string;
	text: (s: string) => string;
	dim?: (s: string) => string;
	/** Ciano de execução ativa; `wait` (roxo/lavanda) separa `em espera` de `executando`. */
	run?: (s: string) => string;
	wait?: (s: string) => string;
	warn?: (s: string) => string;
	accent?: (s: string) => string;
	bold?: (s: string) => string;
	/** Fundos de caixa (neutro, roxo suave p/ espera, âmbar suave p/ bloqueado). */
	box?: (s: string) => string;
	waitBox?: (s: string) => string;
	warnBox?: (s: string) => string;
	/** Pílula opcional p/ data de envio no canto direito (Solução 2). */
	pill?: (s: string, kind: "neutral" | "wait" | "warn") => string;
	/** Barra animada com micro-cometa opcional nas células pendentes. */
	bar?: (filled: number, cells: number) => string;
}

export const plainPaint: DonePaint = { ok: (s) => s, muted: (s) => s, text: (s) => s };

const TAG = /\[DONE:(\d+)\]/gi;
const ONLY_TAGS = /^\s*(?:\[DONE:\d+\]\s*)+$/i;
const FENCE = /^\s*(```|~~~)/;
const PARTIAL = /\[(?:D(?:O(?:N(?:E(?::\d*)?)?)?)?)?$/i;

const BAR_MAX = 12;
const seen = (s: string): number => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
const literal = (s: string, color: (s: string) => string): string => {
	const fence = "`".repeat(1 + Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length)));
	return `${fence}${color(s)}${fence}`;
};
export const HOLD = /^\s*(?:PLAN (WAITING|BLOCKED)|PLANO (AGUARDANDO|BLOQUEADO)):\s*(.+?)\s*$/i;
export const CANCELLED = /^\s*(?:PLAN CANCELLED|PLANO CANCELADO)\.?\s*$/i;
const BG_ID = /\s*\(?\b((?:bg|fg)-[0-9a-f]+)\)?/i;
const lista = (ns: number[]): string =>
	ns.length < 2 ? String(ns[0]) : `${ns.slice(0, -1).join(", ")} e ${ns[ns.length - 1]}`;

const isAscii = (env: Env): boolean => Boolean(env.NYCODE_ASCII_ICONS) || env.TERM === "dumb" || env.TERM === "linux";
const isNerd = (env: Env): boolean =>
	!isAscii(env) && (env.NYCODE_NERD_FONT === "1" || env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID));
export const planGlyph = (env: Env = process.env): string => (isAscii(env) ? "^" : isNerd(env) ? "\ueb9d" : "◈");
export const warnGlyph = (env: Env = process.env): string => (isAscii(env) ? "!" : isNerd(env) ? "\uf421" : "▲");
export const glyphGap = (env: Env = process.env): string =>
	!isAscii(env) && (env.TERM === "xterm-kitty" || Boolean(env.KITTY_WINDOW_ID)) ? "  " : " ";

export function renderDoneTags(
	text: string,
	steps: readonly DoneStep[] | undefined,
	paint: DonePaint = plainPaint,
	streaming = false,
	width = 0,
	_owned = true,
	sentAt = "",
	env: Env = process.env,
): string {
	if (!text.includes("[") && !/PLAN/i.test(text)) return text;
	const titles = new Map((steps ?? []).map((s) => [s.step, s.text]));
	const total = steps && steps.length > 0 ? Math.max(...steps.map((s) => s.step), steps.length) : 0;
	const ok = paint.ok("concluída");
	const dot = (paint.dim ?? paint.muted)("·");
	const dim = paint.dim ?? paint.muted;
	const drawBar = (filled: number, cells: number): string =>
		paint.bar
			? paint.bar(filled, cells)
			: paint.ok("━".repeat(filled)) + (filled < cells ? dim("╌".repeat(cells - filled)) : "");

	const block = (ns: number[]): string => {
		const known = ns.filter((n) => titles.has(n));
		const out: string[] = [];
		const rest = ns.filter((n) => !titles.has(n));
		if (rest.length)
			out.push(
				rest.length === 1
					? `${paint.muted(`etapa ${rest[0]}`)} ${ok}`
					: `${paint.muted(`etapas ${lista(rest)}`)} ${paint.ok("concluídas")}`,
			);
		for (const n of known)
			out.push(`${paint.muted(`etapa ${n} de ${total}`)} ${ok} ${dot} ${paint.text(titles.get(n)!)}`);
		if (!known.length) return out.join("\n");
		const last = Math.max(...known);
		const cells = Math.min(total, BAR_MAX);
		const filled = Math.min(cells, Math.round((last / total) * cells));
		const bar = drawBar(filled, cells);
		out[out.length - 1] += `  ${bar}${last >= total ? ` ${paint.muted("plano concluído")}` : ""}`;
		const next = last < total ? titles.get(last + 1) : undefined;
		if (next !== undefined) out.push(paint.muted(`→ a seguir: etapa ${last + 1} · ${next}`));
		return out.join("\n");
	};

	const boxed = width > 0 && paint.box !== undefined;
	const side = boxed ? " ".repeat(width >= 26 ? 3 : 1) : "";
	const inner = boxed ? Math.max(8, width - 2 * side.length) : 0;
	const gap = glyphGap(env);
	const pGlyph = planGlyph(env);
	const wGlyph = warnGlyph(env);
	const bold = paint.bold ?? ((s: string) => s);
	const railLead = boxed ? " ".repeat(1 + gap.length) : "";
	const rail = `${railLead}${dim("│")}`;
	const RAIL = railLead.length + 2;

	const wrap = (plain: string, room: number): string[] => {
		if (!boxed) return [plain];
		const out: string[] = [];
		let cur = "";
		for (const word of plain.split(/\s+/).filter(Boolean)) {
			for (let w = word; w; w = w.slice(room)) {
				const piece = w.slice(0, room);
				if (cur && [...cur].length + 1 + [...piece].length > room) {
					out.push(cur);
					cur = "";
				}
				cur = cur ? `${cur} ${piece}` : piece;
			}
		}
		if (cur) out.push(cur);
		return out.length ? out : [""];
	};

	type Row = string | { s: string; cols: number };
	const frame = (rows: Row[], kind: "neutral" | "wait" | "warn"): string => {
		const boxFn =
			kind === "wait" ? (paint.waitBox ?? paint.box) : kind === "warn" ? (paint.warnBox ?? paint.box) : paint.box;
		const open = boxed && boxFn ? (boxFn("\u0000").split("\u0000")[0] ?? "") : "";
		const row = (s: string, cols = seen(s)): string => {
			if (!boxed || !boxFn) return s;
			const body = s.replace(/\x1b\[(?:0|49)?m/g, (m) => m + open);
			return boxFn(`${side}${body}${" ".repeat(Math.max(0, inner - cols))}${side}`);
		};
		return (boxed ? ["", ...rows, ""] : rows)
			.map((r) => (typeof r === "string" ? row(r) : row(r.s, r.cols)))
			.join("\n");
	};

	const headerLine = (
		iconPaint: (s: string) => string,
		statePaint: (s: string) => string,
		stateName: string,
		extras: string[],
		kind: "neutral" | "wait" | "warn",
	): string => {
		const base = `${boxed ? "" : "  "}${iconPaint(pGlyph)}${gap}${paint.text(bold("plano"))} ${dot} ${statePaint(bold(stateName))}`;
		const rightStr = sentAt && width >= 36 ? (paint.pill ? paint.pill(dim(sentAt), kind) : dim(sentAt)) : "";
		if (!boxed) {
			const left = extras.length ? `${base} ${dot} ${extras.join("  ")}` : base;
			return rightStr ? `${left}  ${rightStr}` : left;
		}
		for (let n = extras.length; n >= 0; n--) {
			const left = n > 0 ? `${base} ${dot} ${extras.slice(0, n).join("  ")}` : base;
			if (rightStr) {
				const g = inner - seen(left) - seen(rightStr);
				if (g >= 2) return left + " ".repeat(g) + rightStr;
			} else if (seen(left) <= inner) {
				return left;
			}
		}
		return base;
	};

	const hold = (kind: string, reason: string): string => {
		const waiting = /^(WAITING|AGUARDANDO)$/i.test(kind);
		const waitPaint = paint.wait ?? paint.run ?? paint.muted;
		const warnPaint = paint.warn ?? paint.muted;
		const statePaint = waiting ? waitPaint : warnPaint;
		const iconPaint = waiting
			? (paint.wait ?? paint.accent ?? paint.muted)
			: (paint.warn ?? paint.accent ?? paint.muted);
		const boxKind: "wait" | "warn" = waiting ? "wait" : "warn";

		const done = (steps ?? []).filter((s) => s.completed).length;
		const currentObj = (steps ?? []).find((s) => !s.completed);
		const current = currentObj?.step;
		const cells = Math.min(total, BAR_MAX);
		const filled = total ? Math.min(cells, Math.round((done / total) * cells)) : 0;
		const pct = total ? Math.round((done / total) * 100) : 0;
		const extras =
			current === undefined
				? []
				: [paint.muted(`etapa ${current} de ${total}`), drawBar(filled, cells), dim(`${pct}%`)];

		const room = Math.max(4, inner - RAIL);
		const stepRows: Row[] = [];
		if (currentObj?.text) {
			const rem = Math.max(0, total - done);
			const saldo = `${done} ${done === 1 ? "concluída" : "concluídas"}, ${rem === 1 ? "falta 1" : `faltam ${rem}`}`;
			const plainStep = `atual: ${currentObj.text} · ${saldo}`;
			if (!boxed || [...plainStep].length <= room) {
				const line = `${rail} ${dim("atual:")} ${boxed ? literal(currentObj.text, paint.text) : paint.text(currentObj.text)} ${dot} ${paint.muted(saldo)}`;
				stepRows.push(boxed ? { s: line, cols: RAIL + [...plainStep].length } : line);
			} else {
				for (const r of wrap(plainStep, room)) {
					stepRows.push(
						boxed
							? { s: `${rail} ${literal(r, paint.muted)}`, cols: RAIL + [...r].length }
							: `${rail} ${paint.muted(r)}`,
					);
				}
			}
		}

		const id = BG_ID.exec(reason)?.[1];
		const why = reason.replace(BG_ID, "").trim() || reason;
		const todoPlain = waiting
			? `segundo plano${id ? ` · ${id}` : ""} · retoma sozinho, nada a fazer`
			: `${wGlyph}${gap}precisa de você · responda para continuar`;
		const actionRows: Row[] =
			!boxed || [...todoPlain].length <= room
				? waiting
					? [
							`${rail} ${waitPaint("segundo plano")}${dim(`${id ? ` · ${id}` : ""} · retoma sozinho, nada a fazer`)}`,
						]
					: [
							`${rail} ${warnPaint(wGlyph)}${gap}${warnPaint(bold("precisa de você"))} ${paint.muted("· responda para continuar")}`,
						]
				: wrap(todoPlain, room).map((r) => `${railLead}${paint.muted(`│ ${r}`)}`);

		return frame(
			[
				headerLine(iconPaint, statePaint, waiting ? "em espera" : "bloqueado", extras, boxKind),
				...stepRows,
				...wrap(why, room).map(
					(r): Row =>
						boxed
							? { s: `${rail} ${literal(r, paint.text)}`, cols: RAIL + [...r].length }
							: `${rail} ${paint.text(r)}`,
				),
				...actionRows,
			],
			boxKind,
		);
	};

	let fenced = false;
	const lines: string[] = [];
	let run: number[] = [];
	const flush = () => {
		if (run.length) lines.push(block(run));
		run = [];
	};
	for (const line of text.split("\n")) {
		if (FENCE.test(line)) {
			flush();
			fenced = !fenced;
			lines.push(line);
		} else if (!fenced && HOLD.test(line)) {
			flush();
			const m = HOLD.exec(line)!;
			lines.push(hold(m[1] ?? m[2], m[3]));
		} else if (!fenced && CANCELLED.test(line)) {
			flush();
			lines.push(
				frame([headerLine(paint.accent ?? paint.muted, paint.muted, "cancelado", [], "neutral")], "neutral"),
			);
		} else if (!fenced && ONLY_TAGS.test(line)) run.push(...[...line.matchAll(TAG)].map((m) => Number(m[1])));
		else {
			flush();
			lines.push(
				fenced || !line.includes("[")
					? line
					: line
							.split(/(`[^`]*`)/)
							.map((part, i) =>
								i % 2 === 1 ? part : part.replace(TAG, (_m, n) => `${paint.muted(`etapa ${n}`)} ${ok}`),
							)
							.join(""),
			);
		}
	}
	flush();
	let out = lines.join("\n");
	if (streaming && !fenced) out = out.replace(PARTIAL, "");
	return out;
}
