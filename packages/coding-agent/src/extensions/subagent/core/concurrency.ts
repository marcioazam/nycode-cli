/**
 * Bounded fan-out for parallel subagent runs: the task cap the tool advertises and the
 * worker pool that honours the per-depth concurrency (nesting/index.ts).
 */

export const MAX_PARALLEL_TASKS = 8;

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current); // NOSONAR typescript:S9382 - each worker of the pool runs its items one at a time
		}
	});
	await Promise.all(workers);
	return results;
}
