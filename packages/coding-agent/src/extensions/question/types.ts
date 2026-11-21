/** Shapes shared by the question tool's modules: the tool schema, the question list and the answer types. */

import { Type } from "typebox";
import type { Answer } from "../_shared/ui/question-nav.ts";

export interface OptionWithDesc {
	label: string;
	description?: string;
}

export type DisplayOption = OptionWithDesc & { isOther?: boolean };

export interface QuestionDetails {
	question: string;
	header?: string;
	options: string[];
	answer: string | null;
	wasCustom?: boolean;
	multiSelect?: boolean;
	/** Auto-continued on askUserQuestionTimeout rather than answered or cancelled. */
	timedOut?: boolean;
	/** Nav patch: skipped (↷), delegated to the agent, a note on the choice, left unasked, dismissed by Esc/discard. */
	skipped?: boolean;
	delegated?: boolean;
	note?: string;
	pending?: boolean;
	dismissed?: boolean;
}

// Options with labels and optional descriptions
const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const SingleQuestion = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	header: Type.Optional(
		Type.String({ description: "Short label for the question, shown above it, kept to 12 characters" }),
	),
	options: Type.Array(OptionSchema, {
		description: "Options for the user to choose from (2-4)",
		minItems: 2,
		maxItems: 4,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Allow selecting several options (space toggles, enter confirms)" }),
	),
});

/** One question in the flat form, plus an optional batch for Claude's 1-4 questions.
 * The flat fields stay the documented path: a schema offering two equally optional
 * shapes gave smaller models nothing to follow, and they produced neither. */
export const QuestionParams = Type.Object({
	question: Type.Optional(
		Type.String({ description: "The question to ask. Required, unless asking several via questions." }),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "The 2-4 choices for this question, each {label, description?}. Required with question.",
			minItems: 2,
			maxItems: 4,
		}),
	),
	header: Type.Optional(
		Type.String({ description: "Optional short label shown above the question, kept to 12 characters" }),
	),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Optional: allow selecting several options (space toggles, enter confirms)" }),
	),
	questions: Type.Optional(
		Type.Array(SingleQuestion, {
			description:
				"Only to ask 2-4 questions in one call: each entry takes the same fields as above. Leave unset for a single question.",
			minItems: 1,
			maxItems: 4,
		}),
	),
});

export interface QuestionSpec {
	question: string;
	header?: string;
	options: DisplayOption[];
	multiSelect?: boolean;
}

/** Normalize either accepted shape into the list of questions to ask. */
export function questionList(params: Partial<QuestionSpec> & { questions?: QuestionSpec[] }): QuestionSpec[] {
	if (params.questions && params.questions.length > 0) return params.questions;
	if (typeof params.question === "string")
		return [
			{
				question: params.question,
				header: shortHeader(params.header),
				options: params.options ?? [],
				multiSelect: params.multiSelect,
			},
		];
	return [];
}

/** Claude keeps a header short for the label slot. Truncating is the forgiving read:
 * rejecting the call costs a turn while the model recovers from a validation error,
 * which is a poor trade for a display detail. */
const HEADER_MAX = 12;
export const shortHeader = (header: string | undefined): string | undefined =>
	header === undefined ? undefined : header.slice(0, HEADER_MAX);

export type QuestionAnswer = Answer;

/** A claimed offer raced against the open overlay: whichever answers first wins. */
export interface RemoteQuestion {
	/** Routes remote answers into the overlay and remote activity into its idle timer. */
	attach: (answer: (value: QuestionAnswer) => void, touch: () => void) => void;
	/** Ends the offer; the responder's settle handle and touch are rejected from then on. */
	close: () => void;
}
export type RemoteOffer = { kind: "settled"; value: QuestionAnswer } | { kind: "claimed"; remote: RemoteQuestion };
