// Fixed-budget particle storage: once full, a new particle replaces the
// oldest, the way the game's banks recycle.

export class Pool<T> {
	readonly items: T[] = [];
	private cursor = 0;
	constructor(readonly budget: number) {}

	add(item: T): void {
		if (this.items.length < this.budget) { this.items.push(item); return; }
		this.items[this.cursor] = item;
		this.cursor = (this.cursor + 1) % this.budget;
	}

	// Drops every item the predicate rejects, keeping order.
	keep(alive: (item: T) => boolean): void {
		const kept = this.items.filter(alive);
		if (kept.length === this.items.length) return;
		this.items.length = 0;
		this.items.push(...kept);
		this.cursor = 0;
	}

	clear(): void {
		this.items.length = 0;
		this.cursor = 0;
	}
}
