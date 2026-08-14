import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../lib/api";
import { Badge, Button, Input } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/renewals", label: "Renewals", icon: CalendarClock, badge: "renewals" },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/policies", label: "Policies", icon: ShieldCheck },
  { to: "/insurers", label: "Insurers & plans", icon: Building2 },
  { to: "/import", label: "Import data", icon: FileSpreadsheet },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const lock = useMutation({
    mutationFn: api.lock,
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  // Cmd/Ctrl+K focuses search, the one shortcut a data-entry tool really needs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dueCount = dashboard.data?.expiringThisMonth ?? 0;
  const providerName = settings.data?.provider_name || "StayInsured";

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white shadow-sm">
            <ShieldCheck className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-800">
              {providerName}
            </span>
            <span className="block text-xs text-slate-400">Client & policy desk</span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                  isActive
                    ? "bg-brand-50 font-medium text-brand-800"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                ].join(" ")
              }
            >
              <Icon className="size-4" />
              <span className="flex-1">{label}</span>
              {"badge" in rest && rest.badge === "renewals" && dueCount > 0 && (
                <Badge tone="warning">{dueCount}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-2">
          <Button
            variant="ghost"
            className="w-full justify-start"
            icon={<Lock className="size-4" />}
            onClick={() => lock.mutate()}
            loading={lock.isPending}
          >
            Lock app
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur">
          <form
            className="relative max-w-md flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (search.trim()) {
                navigate(`/policies?q=${encodeURIComponent(search.trim())}`);
              }
            }}
          >
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clients, policy numbers, vehicles…"
              className="pl-9"
            />
            <kbd className="absolute top-2 right-2.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
              ⌘K
            </kbd>
          </form>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            {dashboard.data && (
              <>
                <Badge tone="muted">{dashboard.data.activePolicies} active policies</Badge>
                {dashboard.data.expiringThisWeek > 0 && (
                  <Badge tone="danger">{dashboard.data.expiringThisWeek} due this week</Badge>
                )}
              </>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
