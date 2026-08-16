import { MutationCache, QueryClient } from "@tanstack/react-query";

/**
 * Mark a mutation that changes nothing in the book — opening the file picker,
 * writing a copy to disk, exporting a spreadsheet — so it does not send every
 * screen back to the core for answers that cannot have changed.
 */
export const readsOnly = { writes: false } as const;

/**
 * The one query client, shared by the app and its tests.
 *
 * Every successful write re-asks the whole cache. A renewal moves the tab
 * counts, the sidebar badge, the dashboard and the client it belongs to, and
 * naming those keys at each call site is how they fall out of step; a read here
 * is a local SQLite query, so asking again costs almost nothing.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Local database reads are cheap, but refetching on every window focus
        // makes the app feel jumpy on a desktop.
        refetchOnWindowFocus: false,
        retry: false,
        // Nothing is held as fresh. A read is a local SQLite query, and the
        // core moves on its own — the reminder sweep sends and the nightly
        // status pass expires policies while the window sits there — so a
        // screen that is asked for again asks the book again. Screens that
        // held their own `staleTime: 0` to escape a shared default is how the
        // list filters started disagreeing with what was on screen.
        staleTime: 0,
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation): void => {
        if (mutation.meta?.writes === false) return;
        void client.invalidateQueries();
      },
    }),
  });
  return client;
}
