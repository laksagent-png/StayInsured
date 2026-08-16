/** Stands in for `@tauri-apps/api/event`. */

import { bridge } from "../bridge";

export interface Event<T> {
  event: string;
  payload: T;
}

export type UnlistenFn = () => void;

/**
 * The app listens for two events: `session:locked` from the tray and
 * `reminders:swept` from the scheduler. Both arrive as a payload wrapped in an
 * object, because that is the shape `App.tsx` destructures.
 */
export async function listen<T>(event: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return bridge().on(event, (payload) => handler({ event, payload: payload as T }));
}
