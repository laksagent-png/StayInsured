/**
 * Putting a screen on the page the way the app does.
 *
 * The providers here mirror `src/main.tsx` — same query client settings, same
 * toaster — so a component under test behaves as it does in the running app.
 * Only the router differs: tests drive routes in memory.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import App from "@/App";
import { ToastProvider } from "@/components/ui";
import { createQueryClient } from "@/lib/queryClient";
import { backend } from "./backend";

export interface RenderApiOptions extends Omit<RenderOptions, "wrapper"> {
  /** Where the router starts, e.g. "/clients/1". */
  route?: string;
  /** The route pattern to mount the element at, when it reads route params. */
  path?: string;
}

export interface Rendered extends RenderResult {
  user: UserEvent;
  queryClient: QueryClient;
}

/**
 * The very client the app runs with, from `src/lib/queryClient.ts`.
 *
 * Caching and invalidation decide what a screen shows after a write, so a test
 * client of its own would be testing something the operator never runs.
 */
export function createTestQueryClient(): QueryClient {
  return createQueryClient();
}

/**
 * Reports where the router is, so a test can prove a click navigated:
 * `expect(currentRoute()).toBe("/clients/1")`.
 */
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location-probe" hidden>
      {`${location.pathname}${location.search}`}
    </span>
  );
}

/** The route the last rendered screen is on. */
export function currentRoute(): string {
  return document.querySelector('[data-testid="location-probe"]')?.textContent ?? "";
}

function Providers({
  children,
  client,
  route,
}: {
  children: ReactNode;
  client: QueryClient;
  route: string;
}) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          {children}
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * Renders a component inside the app's providers.
 *
 * Pass `path` when the component reads route parameters:
 * `renderWithProviders(<ClientDetailPage />, { route: "/clients/1", path: "/clients/:id" })`
 */
export function renderWithProviders(ui: ReactElement, options: RenderApiOptions = {}): Rendered {
  const { route = "/", path, ...rest } = options;
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();

  const element = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  const result = render(element, {
    wrapper: ({ children }) => (
      <Providers client={queryClient} route={route}>
        {children}
      </Providers>
    ),
    ...rest,
  });

  return { ...result, user, queryClient };
}

/** Renders the whole app — shell, routes and all — at a starting route. */
export function renderApp(options: { route?: string } = {}): Rendered {
  return renderWithProviders(<App />, { route: options.route ?? "/" });
}

/**
 * Waits until the screen has stopped asking the core things.
 *
 * The list screens debounce their search box by 250 ms and the effect runs on
 * mount, so every one of them asks a second, identical question shortly after
 * it appears. A test that inspects `lastCall` or turns a page inside that
 * window is racing it. `await settle()` after the first rows appear puts the
 * screen at rest first; it costs the quiet period twice, so use it once per
 * test rather than between every click.
 */
export async function settle(quietFor = 300): Promise<void> {
  await act(async () => {
    let seen = -1;
    while (seen !== backend().calls.length) {
      seen = backend().calls.length;
      await new Promise((resolve) => setTimeout(resolve, quietFor));
    }
  });
}

export * from "@testing-library/react";
export { userEvent };
