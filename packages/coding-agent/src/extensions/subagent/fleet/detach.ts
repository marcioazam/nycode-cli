/**
 * Ctrl+B for foreground subagent calls (main session only). A call runs inside an
 * AsyncLocalStorage store so trackers started deep in run.ts find their call and can be
 * flipped to background when the user detaches it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ForegroundCall {
	readonly isDetached: boolean;
	readonly detached: Promise<void>;
	trackers: Set<{ markBackground(): void }>;
}

interface CallInternal extends ForegroundCall {
	isDetached: boolean;
	resolveDetached: () => void;
}

// One slot on globalThis: the fleet source is memoised by the first module instance, so after
// /reload a second instance of this file must see the same calls (Ctrl+B).
const SLOT = Symbol.for("pi-code.fleet.detach");
interface DetachState {
	als: AsyncLocalStorage<ForegroundCall>;
	inFlight: Set<CallInternal>;
}
function state(): DetachState {
	const holder = globalThis as Record<symbol, DetachState | undefined>;
	const state = holder[SLOT] ?? { als: new AsyncLocalStorage<ForegroundCall>(), inFlight: new Set() };
	holder[SLOT] = state;
	return state;
}

export function runDetachable<T>(work: (call: ForegroundCall) => Promise<T>): {
	call: ForegroundCall;
	result: Promise<T>;
} {
	let resolveDetached: () => void = () => {};
	const detached = new Promise<void>((resolve) => {
		resolveDetached = resolve;
	});
	const call: CallInternal = { isDetached: false, detached, trackers: new Set(), resolveDetached };
	const { als, inFlight } = state();
	inFlight.add(call);
	return { call, result: als.run(call, () => work(call)) };
}

export function currentForegroundCall(): ForegroundCall | undefined {
	return state().als.getStore();
}

export function finishForeground(call: ForegroundCall): void {
	state().inFlight.delete(call as CallInternal);
}

/** Finite per-process cap on automatically detached batches; shared with background singles
 * (runBackgroundMode counts both), so the total never passes it. Manual Ctrl+B is not counted. */
export const MAX_AUTO_DETACHED_BATCHES = 8;

interface AutoSlots {
	held: number;
}
function slots(): AutoSlots {
	const holder = globalThis as Record<symbol, AutoSlots | undefined>;
	const key = Symbol.for("pi-code.fleet.auto-batch-slots");
	const state = holder[key] ?? { held: 0 };
	holder[key] = state;
	return state;
}

export function activeAutoBatchSlots(): number {
	return slots().held;
}

/** Synchronously takes one slot unless `held + activeBackground` already reached the cap;
 * the returned release is idempotent. */
export function reserveAutoBatchSlot(activeBackground = 0): (() => void) | undefined {
	const s = slots();
	if (s.held + activeBackground >= MAX_AUTO_DETACHED_BATCHES) return undefined;
	s.held++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		s.held--;
	};
}

export function hasForeground(): boolean {
	return state().inFlight.size > 0;
}

/** Moves one call to the background (the shared step of Ctrl+B and the automatic detach); false when it already was. */
export function detachCall(call: ForegroundCall): boolean {
	const internal = call as CallInternal;
	if (internal.isDetached) return false;
	internal.isDetached = true;
	for (const tracker of internal.trackers) tracker.markBackground();
	internal.resolveDetached();
	state().inFlight.delete(internal);
	return true;
}

export function detachAll(): number {
	let moved = 0;
	for (const call of [...state().inFlight]) if (detachCall(call)) moved++;
	return moved;
}

/**
 * Runs `work` as a detachable call tied to the turn's signal. Before a detach the turn's abort
 * reaches the work and takes the call out of the detachable set at once, so a Ctrl+B pressed while
 * the abort settles cannot revive it; after a detach the turn's abort no longer reaches it.
 */
export async function raceDetach<T>(
	outer: AbortSignal | undefined,
	work: (signal: AbortSignal, call: ForegroundCall) => Promise<T>,
	autoDetach = false,
): Promise<{ done: T } | { detached: Promise<T> }> {
	const ctl = new AbortController();
	if (outer?.aborted) ctl.abort();
	const { call, result } = runDetachable((c) => work(ctl.signal, c));
	const onAbort = (): void => {
		if (call.isDetached) return;
		finishForeground(call);
		ctl.abort();
	};
	if (outer?.aborted) onAbort();
	else {
		outer?.addEventListener("abort", onAbort, { once: true });
		// Only this call moves (never its siblings); a turn already aborted stays aborted.
		if (autoDetach) detachCall(call);
	}
	const winner = result.then((done) => ({ done }));
	winner.catch(() => {});
	try {
		return (await Promise.race([winner, call.detached.then(() => undefined)])) ?? { detached: result };
	} finally {
		finishForeground(call);
		outer?.removeEventListener("abort", onAbort);
	}
}
