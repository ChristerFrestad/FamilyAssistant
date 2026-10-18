// Let React finish effects from a render that happened outside act().
//
// Screens render their data when a mocked fetch resolves. That render
// happens while Testing Library's waitFor/findBy is polling, i.e.
// outside act(), so React schedules the passive effects (useEffect) on
// its own scheduler instead of flushing them right away. findBy/waitFor
// return on the first matching DOM, so a click straight after can land
// before those effects run. When an effect resets optimistic state on
// new data (Chores: `useEffect(() => setLocalChores(null), [week])`,
// Dashboard: `useEffect(() => setChoreStatusById({}), [today.data])`),
// React flushes it right before rendering the click and the optimistic
// 'done' is wiped, so aria-pressed stays "false".
//
// Await this after the board is on screen and before interacting with
// completion state. It yields one macrotask inside act so the pending
// effects run first.

import { act } from '@testing-library/react';

export async function settleEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
