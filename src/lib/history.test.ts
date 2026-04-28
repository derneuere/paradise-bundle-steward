// Unit tests for the history reducer.

import { describe, it, expect } from 'vitest';
import {
	HISTORY_CAP,
	canRedo,
	canUndo,
	emptyHistory,
	recordCommit,
	recordRedo,
	recordUndo,
	type HistoryStack,
} from './history';

describe('history', () => {
	describe('recordCommit', () => {
		it('pushes the old value onto past and clears future', () => {
			const stack: HistoryStack<string> = { past: ['a'], future: ['x', 'y'] };
			const next = recordCommit(stack, 'b');
			expect(next).toEqual({ past: ['a', 'b'], future: [] });
		});

		it('initializes from undefined', () => {
			const next = recordCommit<string>(undefined, 'a');
			expect(next).toEqual({ past: ['a'], future: [] });
		});

		it('caps stack depth at HISTORY_CAP, dropping oldest entries', () => {
			let stack = emptyHistory<number>();
			for (let i = 0; i < HISTORY_CAP + 5; i++) {
				stack = recordCommit(stack, i);
			}
			expect(stack.past.length).toBe(HISTORY_CAP);
			// The first 5 entries (0..4) should have been dropped.
			expect(stack.past[0]).toBe(5);
			expect(stack.past[stack.past.length - 1]).toBe(HISTORY_CAP + 4);
		});
	});

	describe('recordUndo', () => {
		it('returns null on empty past', () => {
			const stack = emptyHistory<string>();
			expect(recordUndo(stack, 'current')).toBeNull();
		});

		it('pops past, pushes actualCurrent onto future, returns restored value', () => {
			const stack: HistoryStack<string> = { past: ['v0', 'v1'], future: [] };
			const out = recordUndo(stack, 'v2-current');
			expect(out).not.toBeNull();
			expect(out!.restored).toBe('v1');
			expect(out!.stack).toEqual({ past: ['v0'], future: ['v2-current'] });
		});

		it('uses actualCurrent rather than any stack-internal "current" — drift-resistant', () => {
			// Caller may have mutated the model out-of-band (e.g., bundle reload).
			// recordUndo never assumes the stack carries the current value.
			const stack: HistoryStack<string> = { past: ['v0'], future: [] };
			const out = recordUndo(stack, 'something-else-entirely');
			expect(out!.stack.future).toEqual(['something-else-entirely']);
		});
	});

	describe('recordRedo', () => {
		it('returns null on empty future', () => {
			const stack: HistoryStack<string> = { past: ['a'], future: [] };
			expect(recordRedo(stack, 'cur')).toBeNull();
		});

		it('pops future head, pushes actualCurrent onto past, returns restored', () => {
			const stack: HistoryStack<string> = { past: ['a'], future: ['b', 'c'] };
			const out = recordRedo(stack, 'a-current');
			expect(out!.restored).toBe('b');
			expect(out!.stack).toEqual({ past: ['a', 'a-current'], future: ['c'] });
		});
	});

	describe('canUndo / canRedo', () => {
		it('respect empty / undefined stacks', () => {
			expect(canUndo(undefined)).toBe(false);
			expect(canRedo(undefined)).toBe(false);
			const empty = emptyHistory();
			expect(canUndo(empty)).toBe(false);
			expect(canRedo(empty)).toBe(false);
		});

		it('flip on after a commit', () => {
			const stack = recordCommit(emptyHistory<string>(), 'a');
			expect(canUndo(stack)).toBe(true);
			expect(canRedo(stack)).toBe(false);
		});

		it('flip on after an undo (redo becomes available)', () => {
			let stack = recordCommit(emptyHistory<string>(), 'a');
			const out = recordUndo(stack, 'b')!;
			stack = out.stack;
			expect(canUndo(stack)).toBe(false);
			expect(canRedo(stack)).toBe(true);
		});
	});

	describe('end-to-end commit/undo/redo round-trip', () => {
		it('walks back through commits and forward again', () => {
			let stack = emptyHistory<number>();

			// Commits 0 → 1 → 2 → 3, simulating: state goes from 0 to 1, 1 to 2, etc.
			// At each commit we record the OLD value (the one being replaced).
			stack = recordCommit(stack, 0);
			stack = recordCommit(stack, 1);
			stack = recordCommit(stack, 2);
			// Current "live" value is 3. past = [0, 1, 2].

			// First undo: live is 3, restored should be 2.
			let out = recordUndo(stack, 3)!;
			expect(out.restored).toBe(2);
			stack = out.stack;
			// past = [0, 1], future = [3]

			// Second undo: live is 2, restored should be 1.
			out = recordUndo(stack, 2)!;
			expect(out.restored).toBe(1);
			stack = out.stack;
			// past = [0], future = [2, 3]

			// Redo: live is 1, restored should be 2.
			out = recordRedo(stack, 1)!;
			expect(out.restored).toBe(2);
			stack = out.stack;
			// past = [0, 1], future = [3]

			// Redo: live is 2, restored should be 3.
			out = recordRedo(stack, 2)!;
			expect(out.restored).toBe(3);
			stack = out.stack;
			// past = [0, 1, 2], future = []
			expect(canRedo(stack)).toBe(false);
		});

		it('a fresh commit forks the timeline (clears future)', () => {
			let stack = emptyHistory<number>();
			stack = recordCommit(stack, 0);
			stack = recordCommit(stack, 1);
			let out = recordUndo(stack, 2)!;
			stack = out.stack;
			// past=[0], future=[2]
			expect(canRedo(stack)).toBe(true);

			// User makes a fresh edit (live was 1, now becomes 99).
			stack = recordCommit(stack, 1);
			expect(stack.future).toEqual([]);
			// Old redo branch is gone.
			expect(canRedo(stack)).toBe(false);
		});
	});
});
