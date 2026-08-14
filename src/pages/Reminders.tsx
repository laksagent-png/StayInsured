import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, BellRing, CheckCircle2, Clock, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type {
  EmailTemplate,
  Notification,
  NotificationStatus,
  PlannedReminder,
  ReminderOverview,
  ReminderRule,
} from "../lib/types";
import { categoryLabel, count, date, relativeDays } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import { RuleForm, timingLabel } from "../components/RuleForm";
import { TemplateEditor } from "../components/TemplateEditor";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  Select,
  Spinner,
  useToast,
} from "../components/ui";

type TabId = "due" | "rules" | "messages" | "history";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "due", label: "Due today" },
  { id: "rules", label: "Rules" },
  { id: "messages", label: "Messages" },
  { id: "history", label: "History" },
];

const STATUS_TONES: Record<NotificationStatus, "ok" | "warning" | "danger" | "muted" | "info"> = {
  sent: "ok",
  queued: "info",
  failed: "danger",
  skipped: "warning",
  cancelled: "muted",
};

export function RemindersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("due");

  const overview = useQuery({ queryKey: ["reminderOverview"], queryFn: api.reminderOverview });

  // The sweep can run while the window sits in the tray, so the screen listens
  // rather than showing figures from whenever it was last opened.
  useEffect(() => {
    const unlisten = listen("reminders:swept", () => {
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      queryClient.invalidateQueries({ queryKey: ["plannedReminders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [queryClient]);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.runReminders(dryRun),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      queryClient.invalidateQueries({ queryKey: ["plannedReminders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (result.dryRun) {
        toast.success(
          `${count(result.queued)} would go out, ${count(result.skipped)} would be skipped. Nothing was sent.`,
        );
      } else {
        toast.success(
          `${count(result.sent)} sent, ${count(result.queued)} queued, ${count(result.failed)} failed.`,
        );
      }
      if (result.issues.length > 0) toast.error(result.issues[0]);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (overview.isLoading) return <Spinner label="Loading reminders" />;
  const state = overview.data;
  if (!state) return null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Reminders</h1>
          <p className="text-sm text-slate-500">
            {state.enabled
              ? `Sending automatically at ${state.sendTime} each day.`
              : "Automatic sending is off. You can still send today's batch by hand."}
            {state.lastSweep && ` Last run ${date(state.lastSweep.slice(0, 10))}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Clock className="size-4" />}
            loading={run.isPending && run.variables === true}
            onClick={() => run.mutate(true)}
          >
            Try without sending
          </Button>
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            loading={run.isPending && run.variables === false}
            disabled={!state.smtpConfigured}
            onClick={() => {
              if (window.confirm(`Send today's reminders to ${state.dueToday} clients now?`)) {
                run.mutate(false);
              }
            }}
          >
            Send now
          </Button>
        </div>
      </header>

      <SetupNotices state={state} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Due today" value={state.dueToday} icon={<BellRing className="size-4" />} />
        <Figure label="Waiting to send" value={state.queued} icon={<Clock className="size-4" />} />
        <Figure
          label="Sent today"
          value={state.sentToday}
          icon={<CheckCircle2 className="size-4" />}
          hint={`Cap of ${count(state.dailyCap)} a day`}
        />
        <Figure
          label="Failed"
          value={state.failed}
          icon={<AlertTriangle className="size-4" />}
          tone={state.failed > 0 ? "danger" : "muted"}
        />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={
              tab === item.id
                ? "-mb-px border-b-2 border-brand-600 px-3 py-2 text-sm font-medium text-brand-700"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "due" && <DueTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "messages" && <MessagesTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}

/** The handful of things that stop reminders working, said plainly. */
function SetupNotices({ state }: { state: ReminderOverview }) {
  const notices: Array<{ tone: "warning" | "info"; text: string }> = [];

  if (!state.smtpConfigured) {
    notices.push({
      tone: "warning",
      text: "No mail server is set up yet, so nothing can be sent. Add it under Settings.",
    });
  } else if (!state.smtpPasswordSet) {
    notices.push({
      tone: "warning",
      text: "The mail password is not saved, so sending will be refused. Add it under Settings.",
    });
  }
  if (state.smtpConfigured && state.dryRun) {
    notices.push({
      tone: "info",
      text: "Practice mode is on: the daily run works everything out but sends nothing. Turn it off in Settings when you are ready.",
    });
  }
  if (state.expiringWithoutEmail > 0) {
    notices.push({
      tone: "info",
      text:
        state.expiringWithoutEmail === 1
          ? "One policy expiring soon belongs to a client with no email address, so it will be listed as skipped."
          : `${count(state.expiringWithoutEmail)} policies expiring soon belong to clients with no email address, so they will be listed as skipped.`,
    });
  }
  if (state.clientsOptedOut > 0) {
    notices.push({
      tone: "info",
      text:
        state.clientsOptedOut === 1
          ? "One client has opted out and will never be written to."
          : `${count(state.clientsOptedOut)} clients have opted out and will never be written to.`,
    });
  }

  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <p
          key={notice.text}
          className={
            notice.tone === "warning"
              ? "flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
              : "flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800"
          }
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{notice.text}</span>
          <Link
            to="/settings"
            className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
          >
            Settings
          </Link>
        </p>
      ))}
    </div>
  );
}

function Figure({
  label,
  value,
  icon,
  hint,
  tone = "muted",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  hint?: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
      </div>
      <p
        className={
          tone === "danger"
            ? "mt-1 text-2xl font-semibold text-rose-600"
            : "mt-1 text-2xl font-semibold text-slate-800"
        }
      >
        {count(value)}
      </p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function DueTab() {
  const planned = useQuery({ queryKey: ["plannedReminders"], queryFn: api.planReminders });

  const columns: Column<PlannedReminder>[] = [
    {
      key: "client",
      header: "Client",
      render: (row) => (
        <span className="block">
          <Link
            to={`/clients/${row.clientId}`}
            className="font-medium text-slate-800 hover:text-brand-700"
          >
            {row.clientName}
          </Link>
          <span className="block text-xs text-slate-400">{row.toAddress ?? "No email"}</span>
        </span>
      ),
    },
    {
      key: "policy",
      header: "Policy",
      render: (row) => (
        <span className="block">
          <span className="block text-sm text-slate-700">{row.policyNumber}</span>
          <span className="block text-xs text-slate-400">
            Expires {date(row.expiryDate)} · {relativeDays(row.daysToExpiry)}
          </span>
        </span>
      ),
    },
    {
      key: "rule",
      header: "Rule",
      render: (row) => <span className="text-sm text-slate-600">{row.ruleName}</span>,
    },
    {
      key: "subject",
      header: "Subject",
      render: (row) => <span className="text-sm text-slate-600">{row.subject}</span>,
    },
    {
      key: "status",
      header: "",
      align: "right",
      render: (row) =>
        row.blockedReason ? (
          <Badge tone="warning">{row.blockedReason}</Badge>
        ) : (
          <Badge tone="ok">Ready</Badge>
        ),
    },
  ];

  if (planned.isLoading) return <Spinner label="Working out what is due" />;
  const rows = planned.data ?? [];

  return (
    <Card bodyClassName="p-0">
      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="Nothing is due today"
          description="Reminders appear here on the day a rule matches a policy. Anything already sent for this policy year will not appear again."
        />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => `${row.ruleId}-${row.policyId}`} />
      )}
    </Card>
  );
}

function RulesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ReminderRule | "new">();

  const rules = useQuery({ queryKey: ["rules"], queryFn: api.listRules });

  const toggle = useMutation({
    mutationFn: (rule: ReminderRule) =>
      api.updateRule(rule.id, {
        name: rule.name,
        offsetDays: rule.offsetDays,
        category: rule.category,
        audience: rule.audience,
        channel: rule.channel,
        templateId: rule.templateId,
        isActive: !rule.isActive,
        sortOrder: rule.sortOrder,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Rule removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<ReminderRule>[] = [
    {
      key: "name",
      header: "Rule",
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-slate-800">{row.name}</span>
          <span className="block text-xs text-slate-400">{timingLabel(row.offsetDays)}</span>
        </span>
      ),
    },
    {
      key: "applies",
      header: "Applies to",
      render: (row) => (
        <span className="text-sm text-slate-600">
          {row.category ? categoryLabel(row.category) : "All policy types"}
        </span>
      ),
    },
    {
      key: "message",
      header: "Message",
      render: (row) => (
        <span className="text-sm text-slate-600">{row.templateName ?? "—"}</span>
      ),
    },
    {
      key: "how",
      header: "How",
      render: (row) => (
        <span className="text-sm text-slate-600">
          {row.audience === "client" ? "Client" : "Me"} ·{" "}
          {row.channel === "both" ? "email and desktop" : row.channel}
        </span>
      ),
    },
    {
      key: "active",
      header: "Active",
      align: "center",
      render: (row) => (
        <button type="button" onClick={() => toggle.mutate(row)} title="Turn this rule on or off">
          <Badge tone={row.isActive ? "ok" : "muted"}>{row.isActive ? "On" : "Off"}</Badge>
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDraft(row)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Remove "${row.name}"? History of what it sent is kept.`)) {
                remove.mutate(row.id);
              }
            }}
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        title="When reminders go out"
        action={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDraft("new")}>
            Add rule
          </Button>
        }
        bodyClassName="p-0"
      >
        {rules.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            columns={columns}
            rows={rules.data ?? []}
            rowKey={(row) => row.id}
            empty="No rules yet. Add one to start reminding clients."
          />
        )}
      </Card>
      {draft && <RuleForm rule={draft} onClose={() => setDraft(undefined)} />}
    </>
  );
}

function MessagesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EmailTemplate | "new">();

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Message removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<EmailTemplate>[] = [
    {
      key: "name",
      header: "Message",
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-slate-800">{row.name}</span>
          <span className="block text-xs text-slate-400">{row.subject}</span>
        </span>
      ),
    },
    {
      key: "used",
      header: "Used by",
      align: "center",
      render: (row) => (
        <span className="text-sm text-slate-600">
          {row.usedByRules === 0 ? "—" : `${count(row.usedByRules)} rules`}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDraft(row)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Remove "${row.name}"?`)) remove.mutate(row.id);
            }}
          >
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        title="What the messages say"
        action={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDraft("new")}>
            New message
          </Button>
        }
        bodyClassName="p-0"
      >
        {templates.isLoading ? (
          <Spinner />
        ) : (
          <DataTable columns={columns} rows={templates.data ?? []} rowKey={(row) => row.id} />
        )}
      </Card>
      {draft && <TemplateEditor template={draft} onClose={() => setDraft(undefined)} />}
    </>
  );
}

function HistoryTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus | "">("");
  const [page, setPage] = useState(1);
  const [reading, setReading] = useState<Notification>();

  const history = useQuery({
    queryKey: ["notifications", status, page],
    queryFn: () =>
      api.listNotifications({
        statuses: status ? [status] : undefined,
        page,
        pageSize: 25,
      }),
  });

  const retry = useMutation({
    mutationFn: (id: number) => api.retryNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      toast.success("Back in the queue for the next run");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      toast.success("Cancelled");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<Notification>[] = [
    {
      key: "who",
      header: "To",
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-slate-800">
            {row.clientName ?? "You"}
          </span>
          <span className="block text-xs text-slate-400">{row.toAddress ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "subject",
      header: "Message",
      render: (row) => (
        <span className="block">
          <span className="block text-sm text-slate-700">{row.subject ?? "—"}</span>
          <span className="block text-xs text-slate-400">
            {row.ruleName ?? "Daily digest"}
            {row.policyNumber ? ` · ${row.policyNumber}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      sortKey: "scheduledFor",
      render: (row) => (
        <span className="text-sm text-slate-600">
          {date((row.sentAt ?? row.scheduledFor).slice(0, 10))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <span className="inline-flex flex-col items-center gap-0.5">
          <Badge tone={STATUS_TONES[row.status]}>{row.status}</Badge>
          {row.attempts > 1 && (
            <span className="text-xs text-slate-400">{row.attempts} tries</span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setReading(row)}>
            View
          </Button>
          {(row.status === "failed" || row.status === "skipped") && (
            <Button size="sm" variant="ghost" onClick={() => retry.mutate(row.id)}>
              Send again
            </Button>
          )}
          {row.status === "queued" && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(row.id)}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        title="Everything that has gone out"
        action={
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as NotificationStatus | "");
              setPage(1);
            }}
            className="w-40"
          >
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="queued">Waiting</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        }
        bodyClassName="p-0"
      >
        {history.isLoading ? (
          <Spinner />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={history.data?.rows ?? []}
              rowKey={(row) => row.id}
              empty="Nothing has been sent yet."
            />
            <Pagination
              page={history.data?.page ?? 1}
              pageSize={history.data?.pageSize ?? 25}
              total={history.data?.total ?? 0}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      {reading && (
        <Modal
          open
          onClose={() => setReading(undefined)}
          width="md"
          title={reading.subject ?? "Reminder"}
          description={`${reading.toAddress ?? "—"} · ${reading.status}`}
        >
          <dl className="space-y-2 text-sm">
            <Row label="Rule" value={reading.ruleName ?? "Daily digest"} />
            <Row label="Policy" value={reading.policyNumber ?? "—"} />
            <Row label="Scheduled" value={date(reading.scheduledFor.slice(0, 10))} />
            <Row
              label="Sent"
              value={reading.sentAt ? date(reading.sentAt.slice(0, 10)) : "Not yet"}
            />
            <Row label="Attempts" value={String(reading.attempts)} />
            {reading.lastError && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {reading.lastError}
              </div>
            )}
          </dl>
        </Modal>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value}</dd>
    </div>
  );
}
