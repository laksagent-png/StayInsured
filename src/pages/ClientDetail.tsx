import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, MailWarning, Pencil, Plus, Trash2, Unlink, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type {
  Client,
  DeleteScope,
  Policy,
  PolicyFilter,
  Relationship,
  Relative,
} from "../lib/types";
import { date, initials, plural, relationshipLabel, titleCase } from "../lib/format";
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

/** The words the core records, in the order a family is described in. */
const RELATIONSHIPS: Relationship[] = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "other",
];

export function ClientDetailPage() {
  const { id } = useParams();
  const clientId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | undefined>();
  const [renewing, setRenewing] = useState<Policy | undefined>();
  const [linking, setLinking] = useState<Relative | "new" | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const relatives = useQuery({
    queryKey: ["relatives", clientId],
    queryFn: () => api.listRelatives(clientId),
  });

  const unlink = useMutation({
    mutationFn: (relatedClientId: number) => api.unlinkClients(clientId, relatedClientId),
    onSuccess: () => {
      toast.success("Relationship removed. They are still in the book.");
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

  const setFamilyArchived = useMutation({
    mutationFn: (archived: boolean) => api.setFamilyArchived(clientId, archived),
    onSuccess: (moved, archived) => {
      toast.success(
        `${plural(moved, "client")} ${archived ? "archived" : "restored"}`,
      );
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const removeClient = useMutation({
    mutationFn: (scope: DeleteScope) => api.deleteClient(clientId, scope),
    onSuccess: (deleted) => {
      toast.success(
        deleted.length === 1 ? "Client deleted" : `${plural(deleted.length, "client")} deleted`,
      );
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
              {data.relatives > 0 && (
                <Badge tone="muted">{plural(data.relatives, "relative")}</Badge>
              )}
              {/* A client with no cover of their own, listed under somebody
                  else's. Worth saying on the page, because it is why they do not
                  appear when the book is browsed. */}
              {data.isDependent && <Badge tone="muted">Family member</Badge>}
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
          title="Family"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<UserPlus className="size-3.5" />}
              onClick={() => setLinking("new")}
            >
              Link relative
            </Button>
          }
          bodyClassName=""
        >
          <AsyncPanel query={relatives} errorTitle="The family could not be read">
            {(relatives.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Link a spouse, child or parent to cover them on a floater. Everybody in a family is
                a client in their own right.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {relatives.data?.map((relative) => (
                  <li key={relative.clientId} className="flex items-center gap-2 px-4 py-2.5">
                    {/* A relative is a client, so their name goes to their own
                        page rather than opening a sub-form of this one. */}
                    <Link
                      to={`/clients/${relative.clientId}`}
                      className="group min-w-0 flex-1 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
                    >
                      <p className="truncate text-sm font-medium text-slate-700 group-hover:underline">
                        {relative.fullName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {relationshipLabel(relative.relationship, relative.outgoing)}
                        {relative.dateOfBirth ? ` · ${date(relative.dateOfBirth)}` : ""}
                        {relative.ownPolicies > 0
                          ? ` · ${plural(relative.ownPolicies, "own policy", "own policies")}`
                          : ""}
                      </p>
                    </Link>
                    {relative.isArchived && <Badge tone="warning">Archived</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Change how ${relative.fullName} is related`}
                      title={`Change how ${relative.fullName} is related`}
                      onClick={() => setLinking(relative)}
                    >
                      <Pencil className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Unlink ${relative.fullName}`}
                      title={`Unlink ${relative.fullName}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Unlink ${relative.fullName} from ${data.fullName}? They stay in the book as a client.`,
                          )
                        ) {
                          unlink.mutate(relative.clientId);
                        }
                      }}
                    >
                      <Unlink className="size-3.5 text-slate-400" />
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
            {/* A household usually leaves together, and doing them one at a time
                is how half a family is left behind. This reaches the people
                linked to this client and stops there. */}
            {data.relatives > 0 && (
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setFamilyArchived.mutate(!data.isArchived)}
              >
                {data.isArchived ? "Restore family" : "Archive family"}
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full justify-start text-rose-600 hover:bg-rose-50"
              icon={<Trash2 className="size-4" />}
              onClick={() => setDeleteOpen(true)}
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
      {linking && (
        <RelativeModal draft={linking} client={data} onClose={() => setLinking(undefined)} />
      )}
      {deleteOpen && (
        <DeleteClientModal
          client={data}
          relatives={relatives.data ?? []}
          pending={removeClient.isPending}
          onConfirm={(scope) => removeClient.mutate(scope)}
          onClose={() => setDeleteOpen(false)}
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

/**
 * Records how somebody is related to this client, or corrects the word on a
 * relationship already recorded.
 *
 * A relative is a client, so the modal either finds one already in the book or
 * opens a client for them — it never stores a person inside another person.
 * Mounted only while it is open, so every opening starts from the row it was
 * opened on rather than from the last draft.
 */
function RelativeModal({
  draft,
  client,
  onClose,
}: {
  draft: Relative | "new";
  client: Client;
  onClose: () => void;
}) {
  const toast = useToast();
  const existing = draft === "new" ? undefined : draft;

  const [name, setName] = useState(existing?.fullName ?? "");
  const [picked, setPicked] = useState<Client | undefined>();
  const [relationship, setRelationship] = useState(existing?.relationship ?? "spouse");
  const [error, setError] = useState<string | null>(null);

  const search = name.trim();
  // Only once there is enough to narrow on: a single letter matches most of the
  // book and reads as noise under the box.
  const matches = useQuery({
    queryKey: ["clientSearch", search],
    queryFn: () =>
      api.listClients({ search, includeFamily: true, page: 1, pageSize: 6, sort: "name" }),
    enabled: !existing && !picked && search.length >= 2,
  });
  const candidates = (matches.data?.rows ?? []).filter((row) => row.id !== client.id);

  const save = useMutation({
    mutationFn: async () => {
      const relatedClientId = existing?.clientId ?? picked?.id ?? (await addPerson());
      await api.linkClients({ clientId: client.id, relatedClientId, relationship });
      return relatedClientId;
    },
    onSuccess: () => {
      toast.success(existing ? "Relationship updated" : "Relative linked");
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  /** A relative nobody has entered yet lives where the policyholder lives. */
  const addPerson = () =>
    api.createClient({
      fullName: search,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      city: client.city,
      state: client.state,
      pincode: client.pincode,
      preferredLanguage: client.preferredLanguage,
    });

  const chosen = existing?.fullName ?? picked?.fullName;
  const ready = Boolean(existing || picked || search.length > 1);

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={existing ? `How is ${existing.fullName} related?` : "Link a relative"}
      description={
        existing
          ? undefined
          : "Everybody in a family is a client. Search for them, or type a name to open a client for them."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {existing || picked ? "Save" : "Add and link"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {chosen ? (
          <Field label="Relative">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span>{chosen}</span>
              {!existing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPicked(undefined);
                    setName("");
                  }}
                >
                  Change
                </Button>
              )}
            </div>
          </Field>
        ) : (
          <Field label="Name" required hint="An existing client, or somebody new to the book">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Priya Sharma"
              autoFocus
            />
          </Field>
        )}

        {!chosen && candidates.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {candidates.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => setPicked(row)}
                >
                  <p className="text-sm text-slate-700">{row.fullName}</p>
                  <p className="text-xs text-slate-400">
                    {row.clientCode}
                    {row.city ? ` · ${row.city}` : ""}
                    {` · ${plural(row.totalPolicies, "policy", "policies")}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field
          label="Relationship"
          hint={`Read as "${titleCase(relationship)}: ${chosen || search || "…"}" on ${client.fullName}'s page`}
        >
          <Select
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as Relationship)}
          >
            {RELATIONSHIPS.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </Field>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * Deleting a client asks what else goes with them, because the family is now
 * made of clients and the answer is no longer obvious.
 *
 * The wide choice reaches the people linked to this client and stops there. It
 * does not follow the family outwards: an in-law's parents are their own
 * household, and a delete that walked the whole graph would take them too.
 */
function DeleteClientModal({
  client,
  relatives,
  pending,
  onConfirm,
  onClose,
}: {
  client: Client;
  relatives: Relative[];
  pending: boolean;
  onConfirm: (scope: DeleteScope) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={`Delete ${client.fullName}?`}
      description={`This removes the client and ${plural(client.totalPolicies, "policy record", "policy records")}, along with any documents. It cannot be undone.`}
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <div className="space-y-3">
        {relatives.length > 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <p className="font-medium text-slate-700">Family on file</p>
            <ul className="mt-1 space-y-0.5">
              {relatives.map((relative) => (
                <li key={relative.clientId}>
                  {relative.fullName} —{" "}
                  {relationshipLabel(relative.relationship, relative.outgoing).toLowerCase()}
                  {relative.ownPolicies > 0
                    ? `, ${plural(relative.ownPolicies, "policy", "policies")} of their own`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          className="w-full justify-start text-rose-600 hover:bg-rose-50"
          variant="ghost"
          icon={<Trash2 className="size-4" />}
          loading={pending}
          onClick={() => onConfirm("linksOnly")}
        >
          {relatives.length > 0
            ? "Delete this client only, and keep the family"
            : "Delete this client"}
        </Button>

        {relatives.length > 0 && (
          <>
            <Button
              className="w-full justify-start text-rose-600 hover:bg-rose-50"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              loading={pending}
              onClick={() => onConfirm("immediateFamily")}
            >
              {`Delete this client and ${plural(relatives.length, "relative")}`}
            </Button>
            <p className="text-xs text-slate-400">
              Keeping the family leaves everybody above as clients with their own policies; only the
              link to {client.fullName} goes.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
