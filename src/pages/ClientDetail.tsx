import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, MailWarning, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { InsuredMember, MemberInput, Policy, PolicyFilter } from "../lib/types";
import { date, initials, titleCase } from "../lib/format";
import { ClientForm } from "../components/ClientForm";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { PolicyForm } from "../components/PolicyForm";
import { PolicyTable } from "../components/PolicyTable";
import { RenewModal } from "../components/RenewModal";
import {
  AsyncPanel,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
} from "../components/ui";

const RELATIONSHIPS = ["self", "spouse", "son", "daughter", "father", "mother", "other"];

export function ClientDetailPage() {
  const { id } = useParams();
  const clientId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | undefined>();
  const [renewing, setRenewing] = useState<Policy | undefined>();
  const [memberDraft, setMemberDraft] = useState<InsuredMember | "new" | undefined>();

  const [filter, setFilter] = useState<PolicyFilter>({
    clientId,
    page: 1,
    pageSize: 20,
    sort: "expiry",
    descending: true,
  });

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient(clientId),
  });
  const members = useQuery({
    queryKey: ["members", clientId],
    queryFn: () => api.listMembers(clientId),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: number) => api.deleteMember(memberId),
    onSuccess: () => {
      toast.success("Member removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const setArchived = useMutation({
    mutationFn: (archived: boolean) => api.setClientArchived(clientId, archived),
    onSuccess: (_result, archived) => {
      toast.success(archived ? "Client archived" : "Client restored");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const removeClient = useMutation({
    mutationFn: () => api.deleteClient(clientId),
    onSuccess: () => {
      toast.success("Client deleted");
      navigate("/clients");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (client.isLoading) return <Spinner />;
  // An address that names no client of ours — a deleted client, a mistyped id —
  // is a different thing from a book that would not answer, and the two are
  // worth telling apart before any of the page is drawn.
  if (client.error instanceof ApiError && client.error.kind === "not_found") {
    return (
      <EmptyState
        title="Client not found"
        description="No client sits at this address. They may have been deleted, or the address may be mistyped."
      />
    );
  }
  if (client.isError || !client.data) {
    return (
      <ErrorState
        error={client.error}
        title="This client could not be read"
        onRetry={() => client.refetch()}
      />
    );
  }
  const data = client.data;

  return (
    <div className="space-y-4">
      <Link
        to="/clients"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" />
        All clients
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-base font-semibold text-brand-800">
            {initials(data.fullName)}
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{data.fullName}</h1>
            <p className="text-sm text-slate-500">
              {data.clientCode}
              {data.city ? ` · ${data.city}` : ""}
              {data.occupation ? ` · ${data.occupation}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={data.activePolicies > 0 ? "ok" : "muted"}>
                {data.activePolicies} active
              </Badge>
              <Badge tone="muted">{data.totalPolicies} total</Badge>
              {data.remindersOptedOut && <Badge tone="warning">Reminders off</Badge>}
              {data.isArchived && <Badge tone="warning">Archived</Badge>}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditingPolicy(undefined);
              setPolicyOpen(true);
            }}
          >
            Add policy
          </Button>
        </div>
      </header>

      {!data.email && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          <MailWarning className="size-4 shrink-0 text-amber-600" />
          No email address on file, so this client cannot receive renewal reminders.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Contact & details">
          <dl className="space-y-2.5 text-sm">
            <Detail label="Email" value={data.email} />
            <Detail label="Mobile" value={data.phone} />
            <Detail label="Alternate" value={data.altPhone} />
            <Detail label="Date of birth" value={data.dateOfBirth ? date(data.dateOfBirth) : null} />
            <Detail label="Gender" value={data.gender ? titleCase(data.gender) : null} />
            <Detail
              label="Address"
              value={
                [data.addressLine1, data.addressLine2, data.city, data.state, data.pincode]
                  .filter(Boolean)
                  .join(", ") || null
              }
            />
            <Detail label="PAN" value={data.pan} />
            <Detail label="Next expiry" value={data.nextExpiry ? date(data.nextExpiry) : null} />
          </dl>
          {data.notes && (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {data.notes}
            </p>
          )}
        </Card>

        <Card
          title="Members covered"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<UserPlus className="size-3.5" />}
              onClick={() => setMemberDraft("new")}
            >
              Add
            </Button>
          }
          bodyClassName=""
        >
          <AsyncPanel query={members} errorTitle="The members could not be read">
            {(members.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Add family members to attach them to health and travel policies.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.data?.map((member) => (
                  <li key={member.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      className="group min-w-0 flex-1 cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
                      onClick={() => setMemberDraft(member)}
                    >
                      <p className="truncate text-sm font-medium text-slate-700 group-hover:underline">
                        {member.fullName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {titleCase(member.relationship)}
                        {member.dateOfBirth ? ` · ${date(member.dateOfBirth)}` : ""}
                      </p>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${member.fullName}`}
                      title={`Edit ${member.fullName}`}
                      onClick={() => setMemberDraft(member)}
                    >
                      <Pencil className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${member.fullName}`}
                      title={`Remove ${member.fullName}`}
                      onClick={() => {
                        if (window.confirm(`Remove ${member.fullName}?`)) {
                          removeMember.mutate(member.id);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5 text-slate-400" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </AsyncPanel>
        </Card>

        <Card title="Book value">
          <dl className="space-y-2.5 text-sm">
            <Detail label="Client since" value={date(data.createdAt.slice(0, 10))} />
            <Detail label="Last updated" value={date(data.updatedAt.slice(0, 10))} />
            <Detail label="Language" value={data.preferredLanguage.toUpperCase()} />
          </dl>
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setArchived.mutate(!data.isArchived)}
            >
              {data.isArchived ? "Restore client" : "Archive client"}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-rose-600 hover:bg-rose-50"
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${data.fullName} and all ${data.totalPolicies} policy records? This cannot be undone.`,
                  )
                ) {
                  removeClient.mutate();
                }
              }}
            >
              Delete permanently
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Policies" bodyClassName="">
        <PolicyTable
          filter={filter}
          onFilterChange={setFilter}
          showClient={false}
          onEdit={(policy) => {
            setEditingPolicy(policy);
            setPolicyOpen(true);
          }}
          onRenew={setRenewing}
          emptyTitle="No policies yet"
          emptyDescription="Add the client's first policy to start tracking renewals."
        />
      </Card>

      <DocumentsPanel clientId={clientId} />

      <ClientForm open={editOpen} client={data} onClose={() => setEditOpen(false)} />
      <PolicyForm
        open={policyOpen}
        policy={editingPolicy}
        fixedClientId={editingPolicy ? undefined : clientId}
        onClose={() => setPolicyOpen(false)}
      />
      <RenewModal policy={renewing} onClose={() => setRenewing(undefined)} />
      {memberDraft && (
        <MemberModal
          draft={memberDraft}
          clientId={clientId}
          onClose={() => setMemberDraft(undefined)}
        />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-xs tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-700">{value || "—"}</dd>
    </div>
  );
}

/** Mounted only while it is open, so every opening starts from the member it
 * was opened on rather than from the last draft. */
function MemberModal({
  draft,
  clientId,
  onClose,
}: {
  draft: InsuredMember | "new";
  clientId: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const existing = draft === "new" ? undefined : draft;

  const [form, setForm] = useState<MemberInput>({
    clientId,
    fullName: existing?.fullName ?? "",
    relationship: existing?.relationship ?? "spouse",
    dateOfBirth: existing?.dateOfBirth ?? "",
    gender: existing?.gender ?? "",
    notes: existing?.notes ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (existing) await api.updateMember(existing.id, form);
      else await api.createMember(form);
    },
    onSuccess: () => {
      toast.success(existing ? "Member updated" : "Member added");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={existing ? `Edit ${existing.fullName}` : "Add member"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" required>
          <Input
            value={form.fullName}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Relationship">
            <Select
              value={form.relationship ?? "other"}
              onChange={(event) => setForm({ ...form, relationship: event.target.value })}
            >
              {RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input
              type="date"
              value={form.dateOfBirth ?? ""}
              onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Gender">
          <Select
            value={form.gender ?? ""}
            onChange={(event) => setForm({ ...form, gender: event.target.value })}
          >
            <option value="">Not recorded</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
