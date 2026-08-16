import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { api } from "./lib/api";
import type { SessionState } from "./lib/types";
import { offerUpdate } from "./lib/updates";
import { AppShell } from "./components/AppShell";
import { ErrorState, Spinner } from "./components/ui";
import { LockScreen } from "./pages/LockScreen";
import { DashboardPage } from "./pages/Dashboard";
import { ClientsPage } from "./pages/Clients";
import { ClientDetailPage } from "./pages/ClientDetail";
import { PoliciesPage } from "./pages/Policies";
import { RenewalsPage } from "./pages/Renewals";
import { RemindersPage } from "./pages/Reminders";
import { ImportPage } from "./pages/Import";
import { InsurersPage } from "./pages/Insurers";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.sessionState });
  const [hasBeenUnlocked, setHasBeenUnlocked] = useState(false);

  /**
   * Everything read out of the book goes, but the session stays: it is the query
   * this component picks the lock screen by. Emptying the whole cache instead
   * would strip the session query out from under its own observer, and the app
   * would carry on showing a book it can no longer read.
   */
  const onLocked = useCallback(
    (locked: SessionState) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      queryClient.setQueryData(["session"], locked);
    },
    [queryClient],
  );

  // Lock now in the tray menu closes the book without the interface asking it to.
  useEffect(() => {
    const unlisten = listen<SessionState>("session:locked", (event) => onLocked(event.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, [onLocked]);

  // Waiting for the book to be open means the offer reaches someone who is
  // sitting at the machine, rather than a locked screen.
  const unlocked = session.data?.unlocked ?? false;
  useEffect(() => {
    if (!unlocked) return;
    setHasBeenUnlocked(true);
    void offerUpdate();
  }, [unlocked]);

  if (session.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Starting StayInsured" />
      </div>
    );
  }

  // Without a session there is nothing to decide by, and the unlock form is the
  // wrong thing to show: an install that cannot be read would look merely
  // locked, and the password typed into it could never be checked.
  if (!session.data) {
    return (
      <div className="grid h-full place-items-center p-6">
        <ErrorState
          error={session.error}
          title="StayInsured could not start"
          onRetry={() => session.refetch()}
        />
      </div>
    );
  }

  if (!session.data.unlocked) {
    // The keychain opens the book as the app starts. Arriving here after it has
    // been open means someone closed it on purpose, and asking for the password
    // is the whole point of their having done so.
    return <LockScreen session={session.data} autoUnlock={!hasBeenUnlocked} />;
  }

  return (
    <AppShell onLocked={onLocked}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/renewals" element={<RenewalsPage />} />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/insurers" element={<InsurersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
