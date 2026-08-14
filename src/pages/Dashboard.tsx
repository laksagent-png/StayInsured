import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowRight, MailWarning, TrendingUp, Users } from "lucide-react";

import { api } from "../lib/api";
import { categoryLabel, count, date, money, moneyCompact, relativeDays, urgencyTone } from "../lib/format";
import { Badge, Card, EmptyState, Spinner } from "../components/ui";

const CATEGORY_COLOURS = [
  "#0d9488",
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#6366f1",
  "#94a3b8",
];

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });

  if (isLoading) return <Spinner label="Reading your book" />;
  if (!data) return null;

  const isEmpty = data.totalClients === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Today at a glance</h1>
        <p className="text-sm text-slate-500">
          Renewals are ordered by urgency, so the top of each list is where the money is.
        </p>
      </div>

      {isEmpty ? (
        <Card>
          <EmptyState
            icon={<Users className="size-10" />}
            title="No clients yet"
            description="Import an existing spreadsheet to fill the book in one go, or add your first client by hand."
            action={
              <div className="flex gap-2">
                <Link
                  to="/import"
                  className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Import a spreadsheet
                </Link>
                <Link
                  to="/clients"
                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add a client
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="Expiring this week"
              value={count(data.expiringThisWeek)}
              tone={data.expiringThisWeek > 0 ? "danger" : "ok"}
              hint={`${count(data.expiringThisMonth)} within 30 days`}
              to="/renewals"
            />
            <Tile
              label="Unrenewed & expired"
              value={count(data.expiredUnrenewed)}
              tone={data.expiredUnrenewed > 0 ? "warning" : "ok"}
              hint="Cover has stopped for these clients"
              to="/policies?view=lapsed"
            />
            <Tile
              label="Premium under management"
              value={moneyCompact(data.premiumUnderManagement)}
              tone="brand"
              hint={`${count(data.activePolicies)} active policies`}
            />
            <Tile
              label="Commission expected"
              value={moneyCompact(data.commissionExpected)}
              tone="info"
              hint={`${count(data.activeClients)} active clients`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Renewal pipeline" className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: "#64748b" }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      formatter={(value: number, name) =>
                        name === "premiumTotal" ? money(value) : count(value)
                      }
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <Bar dataKey="count" name="Policies" radius={[6, 6, 0, 0]}>
                      {data.buckets.map((bucket) => (
                        <Cell
                          key={bucket.label}
                          fill={bucket.label === "Overdue" ? "#f43f5e" : "#0d9488"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Mix by category">
              {data.byCategory.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No active policies</p>
              ) : (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.byCategory}
                          dataKey="policyCount"
                          nameKey="category"
                          innerRadius={40}
                          outerRadius={68}
                          paddingAngle={2}
                        >
                          {data.byCategory.map((entry, index) => (
                            <Cell
                              key={entry.category}
                              fill={CATEGORY_COLOURS[index % CATEGORY_COLOURS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name) => [count(value), categoryLabel(String(name))]}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {data.byCategory.slice(0, 6).map((entry, index) => (
                      <li key={entry.category} className="flex items-center gap-2 text-xs">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length] }}
                        />
                        <span className="flex-1 text-slate-600">
                          {categoryLabel(entry.category)}
                        </span>
                        <span className="text-slate-400">{count(entry.policyCount)}</span>
                        <span className="w-16 text-right text-slate-500">
                          {moneyCompact(entry.premiumTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          {data.clientsWithoutEmail > 0 && (
            <Link
              to="/clients?missingEmail=1"
              className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100"
            >
              <MailWarning className="size-5 shrink-0 text-amber-600" />
              <span className="flex-1">
                <strong>{count(data.clientsWithoutEmail)} clients have no email address.</strong>{" "}
                They will be skipped when reminders start going out.
              </span>
              <ArrowRight className="size-4" />
            </Link>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Next 45 days"
              action={
                <Link to="/renewals" className="text-xs font-medium text-brand-700 hover:underline">
                  Open renewals
                </Link>
              }
              bodyClassName=""
            >
              {data.upcoming.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  Nothing expires in the next 45 days.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.upcoming.map((policy) => (
                    <li key={policy.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/clients/${policy.clientId}`}
                          className="block truncate text-sm font-medium text-slate-700 hover:text-brand-700"
                        >
                          {policy.clientName}
                        </Link>
                        <span className="block truncate text-xs text-slate-400">
                          {categoryLabel(policy.category)} · {policy.insurerName} ·{" "}
                          {policy.policyNumber}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-slate-500">
                          {date(policy.expiryDate)}
                        </span>
                        <Badge tone={urgencyTone(policy.daysToExpiry, policy.status)}>
                          {relativeDays(policy.daysToExpiry)}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Recently lapsed" bodyClassName="">
              {data.recentlyLapsed.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  <TrendingUp className="mx-auto mb-2 size-6 text-emerald-400" />
                  Everything current has been renewed.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recentlyLapsed.map((policy) => (
                    <li key={policy.id} className="flex items-center gap-3 px-4 py-2.5">
                      <AlertTriangle className="size-4 shrink-0 text-rose-500" />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/clients/${policy.clientId}`}
                          className="block truncate text-sm font-medium text-slate-700 hover:text-brand-700"
                        >
                          {policy.clientName}
                        </Link>
                        <span className="block truncate text-xs text-slate-400">
                          {categoryLabel(policy.category)} · expired {date(policy.expiryDate)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {money(policy.premiumAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "brand" | "danger" | "warning" | "ok" | "info";
  to?: string;
}) {
  const accents: Record<string, string> = {
    brand: "border-brand-200 bg-brand-50/60",
    danger: "border-rose-200 bg-rose-50/60",
    warning: "border-amber-200 bg-amber-50/60",
    ok: "border-emerald-200 bg-emerald-50/50",
    info: "border-sky-200 bg-sky-50/60",
  };

  const body = (
    <div className={`card border p-4 transition ${accents[tone]} ${to ? "hover:shadow-sm" : ""}`}>
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-slate-800">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );

  return to ? <Link to={to}>{body}</Link> : body;
}
