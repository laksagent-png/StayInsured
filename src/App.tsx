import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { api } from "./lib/api";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
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
  const session = useQuery({
    queryKey: ["session"],
    queryFn: api.sessionState,
    staleTime: 0,
  });

  if (session.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Starting StayInsured" />
      </div>
    );
  }

  if (!session.data?.unlocked) {
    return <LockScreen session={session.data} />;
  }

  return (
    <AppShell>
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
