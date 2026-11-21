/** Remote responder: the question is offered over the event bus and the first answer, local or remote, wins. */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { selectedLabels } from "../_shared/ui/question-nav.ts";
import {
	type DisplayOption,
	type OptionWithDesc,
	type QuestionAnswer,
	type QuestionSpec,
	type RemoteOffer,
	shortHeader,
} from "./types.ts";

/** In-process, question-owned offer; arbitrary custom TUI components are not sent. */
export const REMOTE_QUESTION_CHANNEL = "pi-code:question:v1";
export type RemoteQuestionOutcome =
	| { action: "answer"; indices: number[] }
	| { action: "text"; text: string }
	| { action: "cancel" }
	| { action: "pass" };

export interface RemoteQuestionOffer {
	version: 1;
	requestId: string;
	sessionId: string;
	question: string;
	header?: string;
	options: OptionWithDesc[];
	multiSelect: boolean;
	allowFreeText: boolean;
	signal: AbortSignal;
	/** Must be called during event emission; only one listener receives a settle handle. */
	claim: () => ((outcome: RemoteQuestionOutcome) => boolean) | undefined;
	/** The claimed responder reports input activity to reset a configured idle timer. */
	touch: () => boolean;
}

function validIndices(indices: unknown, count: number, multiSelect: boolean): indices is number[] {
	if (!Array.isArray(indices) || (!multiSelect && indices.length !== 1)) return false;
	return (
		new Set(indices).size === indices.length &&
		indices.every((index) => Number.isInteger(index) && index >= 1 && index <= count)
	);
}

/** A remote outcome as the answer it stands for: null is a cancel, undefined is a
 * pass or anything this question cannot accept, which must never become an answer. */
function remoteAnswer(
	outcome: RemoteQuestionOutcome,
	options: DisplayOption[],
	multiSelect: boolean,
): QuestionAnswer | undefined {
	if (outcome === null || typeof outcome !== "object") return undefined;
	if (outcome.action === "cancel") return null;
	if (outcome.action === "text") {
		const text = typeof outcome.text === "string" ? outcome.text.trim() : "";
		return !multiSelect && text ? { answer: text, wasCustom: true } : undefined;
	}
	if (outcome.action !== "answer") return undefined;
	// Read once and copied, so a getter or Proxy cannot answer with other indices
	// than the ones that passed validation.
	const raw: unknown = outcome.indices;
	const indices: unknown = Array.isArray(raw) ? [...raw] : undefined;
	if (!validIndices(indices, options.length, multiSelect)) return undefined;
	const checked = options.map((_, index) => indices.includes(index + 1));
	return { answer: selectedLabels(options, checked), wasCustom: false, ...(multiSelect ? {} : { index: indices[0] }) };
}

/** Undefined when nobody claims synchronously, so the overlay opens with no async gap. */
export function offerRemoteQuestion(
	params: QuestionSpec,
	allOptions: DisplayOption[],
	ctx: ExtensionContext,
	events: ExtensionAPI["events"] | undefined,
	signal: AbortSignal | undefined,
): RemoteOffer | undefined {
	if (!events) return undefined;
	if (signal?.aborted) return { kind: "settled", value: null };

	const multiSelect = params.multiSelect === true;
	const controller = new AbortController();
	let claimed = false;
	let early: { value: QuestionAnswer } | undefined;
	let deliver: ((value: QuestionAnswer) => void) | undefined;
	let touchOverlay: (() => void) | undefined;
	const close = (): void => {
		controller.abort();
		signal?.removeEventListener("abort", abort);
	};
	const settle = (value: QuestionAnswer): void => {
		close();
		if (deliver) deliver(value);
		else early = { value };
	};
	// nycode aborts the turn before a session replacement invalidates ctx, so this is
	// also the session-replacement path; ctx is never read after emission.
	const abort = (): void => settle(null);
	signal?.addEventListener("abort", abort, { once: true });

	const offer: RemoteQuestionOffer = {
		version: 1,
		requestId: randomUUID(),
		sessionId: ctx.sessionManager.getSessionId(),
		question: params.question,
		header: shortHeader(params.header),
		options: params.options.map(({ label, description }) => ({
			label,
			...(description === undefined ? {} : { description }),
		})),
		multiSelect,
		allowFreeText: allOptions.some((option) => option.isOther === true),
		signal: controller.signal,
		claim: () => {
			if (claimed || controller.signal.aborted) return undefined;
			claimed = true;
			return (outcome) => {
				if (controller.signal.aborted) return false;
				const value = remoteAnswer(outcome, params.options, multiSelect);
				if (value !== undefined) {
					settle(value);
					return true;
				}
				// A pass or invalid reply only withdraws the remote side; the overlay stays
				// open, and a turn abort must still cancel it.
				controller.abort();
				return outcome?.action === "pass";
			};
		},
		touch: () => {
			if (!claimed || controller.signal.aborted) return false;
			touchOverlay?.();
			return true;
		},
	};

	events.emit(REMOTE_QUESTION_CHANNEL, offer);
	if (early) return { kind: "settled", value: early.value };
	if (!claimed || controller.signal.aborted) {
		close();
		return undefined;
	}
	return {
		kind: "claimed",
		remote: {
			attach: (answer, touch) => {
				deliver = answer;
				touchOverlay = touch;
			},
			close,
		},
	};
}
