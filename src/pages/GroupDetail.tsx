import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Folders, Pencil, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Client, ClientFilter, Group } from "../lib/types";
import { clientKindLabel, count, date, money, plural } from "../lib/format";
import { ClientForm } from "../components/ClientForm";
import { DataTable, type Column } from "../components/DataTable";
import { GroupForm } from "../components/GroupForm";
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
  Pagination,
  Spinner,
  useToast,
} from "../components/ui";

export function GroupDetailPage() {
  const { id } = useParams();
  const groupId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The roster is the client list narrowed to this group, so it arrives with
  // the archive rule, the paging and the sorting the clients screen already has
  // rather than a second list that would drift from it.
  const [filter, setFilter] = useState<ClientFilter & { page: number }>({
    groupId,
    page: 1,
    pageSize: 20,
    sort: "name",
    includeArchived: true,
  });

  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.getGroup(groupId),
  });
  const members = useQuery({
    queryKey: ["clients", filter],
    queryFn: () => api.listClients(filter),
    placeholderData: keepPreviousData,
  });

  const setArchived = useMutation({
    mutationFn: (archived: boolean) => api.setGroupArchived(groupId, archived),
    onSuccess: (moved, archived) =>
      toast.success(
        moved === 0
          ? archived
            ? "Group archived"
            : "Group restored"
          : `Group ${archived ? "archived" : "restored"} with ${plural(moved, "client")}`,
      ),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteGroup(groupId),
    onSuccess: (released) => {
      toast.success(
        released === 0
          ? "Group deleted"
          : `Group deleted. ${plural(released, "client")} stayed in the book.`,
      );
      navigate("/groups");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const takeOut = useMutation({
    mutationFn: (clientId: number) => api.setClientGroup(clientId, null),
    onSuccess: () => toast.success("Taken out of the group. They stay in the book."),
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (group.isLoading) return <Spinner />;
  if (group.error instanceof ApiError && group.error.kind === "not_found") {
    return (
      <EmptyState
        title="Group not found"
        description="No group sits at this address. It may have been deleted, or the address may be mistyped."
      />
    );
  }
  if (group.isError || !group.data) {
    return (
      <ErrorState
        error={group.error}
        title="This group could not be read"
        onRetry={() => group.refetch()}
      />
    );
  }
  const data = group.data;

  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Member",
      sortKey: "name",
      render: (row) => (
        <span className="min-w-0">
          <Link
            to={`/clients/${row.id}`}
            className="block truncate font-medium text-slate-800 hover:text-brand-700"
          >
            {row.fullName}
          </Link>
          <span className="block truncate text-xs text-slate-400">
            {row.clientCode}
            {row.contactPerson ? ` · ${row.contactPerson}` : row.city ? ` · ${row.city}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "kind",
      header: "Type",
      render: (row) => (
        <Badge tone={row.kind === "company" ? "info" : "muted"}>{clientKindLabel(row.kind)}</Badge>
      ),
    },
    {
      key: "policies",
      header: "Policies",
      sortKey: "policies",
      align: "center",
      render: (row) => (
        <span className="text-sm">
          <strong className="text-slate-700">{row.activePolicies}</strong>
          <span className="text-slate-400"> / {row.totalPolicies}</span>
        </span>
      ),
    },
    {
      key: "nextExpiry",
      header: "Next expiry",
      sortKey: "nextExpiry",
      render: (row) => <span className="text-xs text-slate-600">{date(row.nextExpiry)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.isArchived && <Badge tone="warning">Archived</Badge>}
          {/* Named for the client rather than labelled "Remove", so a roster of
              a dozen firms does not read as a dozen identical buttons. */}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Take ${row.fullName} out of ${data.name}`}
            title={`Take ${row.fullName} out of ${data.name}`}
            onClick={() => {
              if (
                window.confirm(
                  `Take ${row.fullName} out of ${data.name}? They stay in the book with their policies.`,
                )
              ) {
                takeOut.mutate(row.id);
              }
            }}
          >
            <UserMinus className="size-3.5 text-slate-400" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        to="/groups"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" />
        All groups
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-800">
            <Folders className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{data.name}</h1>
            <p className="text-sm text-slate-500">{data.groupCode}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="muted">{plural(data.members, "member")}</Badge>
              <Badge tone={data.activePolicies > 0 ? "ok" : "muted"}>
                {data.activePolicies} active
              </Badge>
              <Badge tone="muted">{data.totalPolicies} total</Badge>
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
            icon={<UserPlus className="size-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add member
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* The person who introduced the group, given a card of their own. They
            are a contact written on the group, not a client, so there is
            nowhere for the card to lead. */}
        <Card
          title="Group head"
          action={
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              Edit head
            </Button>
          }
        >
          {data.headName ? (
            <>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-sm font-medium text-slate-700">{data.headName}</p>
                {data.headDesignation && (
                  <p className="text-xs text-slate-400">{data.headDesignation}</p>
                )}
              </div>
              <dl className="mt-3 space-y-2.5 text-sm">
                <Detail label="Phone" value={data.headPhone} />
                <Detail label="Email" value={data.headEmail} />
              </dl>
              <p className="mt-3 text-xs text-slate-500">
                Who introduced this group. They are not a client and are not counted as a member.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
              No referrer on file
            </p>
          )}
        </Card>

        <Card title="Book value">
          <dl className="space-y-2.5 text-sm">
            <Detail label="Premium" value={money(data.premiumUnderManagement)} />
            <Detail label="Next expiry" value={data.nextExpiry ? date(data.nextExpiry) : null} />
            <Detail label="Opened" value={date(data.createdAt.slice(0, 10))} />
            <Detail label="Last updated" value={date(data.updatedAt.slice(0, 10))} />
          </dl>
          {data.notes && (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {data.notes}
            </p>
          )}
        </Card>

        <Card title="Manage">
          <div className="space-y-2">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setArchived.mutate(!data.isArchived)}
            >
              {data.isArchived ? "Restore group and members" : "Archive group and members"}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-rose-600 hover:bg-rose-50"
              icon={<Trash2 className="size-4" />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete group
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Archiving takes the members with it and reverses. Deleting removes the group only —
            every client in it stays in the book with their policies.
          </p>
        </Card>
      </div>

      <Card
        title="Members"
        action={
          members.data ? (
            <span className="text-xs text-slate-400">{count(members.data.total)} in the group</span>
          ) : null
        }
        bodyClassName=""
      >
        <AsyncPanel query={members} errorTitle="The members could not be read">
          <DataTable
            columns={columns}
            rows={members.data?.rows ?? []}
            rowKey={(row) => row.id}
            sort={filter.sort}
            descending={filter.descending}
            onSort={(key) =>
              setFilter((current) => ({
                ...current,
                sort: key,
                descending: current.sort === key ? !current.descending : false,
                page: 1,
              }))
            }
            empty={
              <EmptyState
                icon={<Folders className="size-9" />}
                title="Nobody in this group yet"
                description="Add the firms or people this group covers. They keep their own policies and their own page."
                action={
                  <Button
                    variant="primary"
                    icon={<UserPlus className="size-4" />}
                    onClick={() => setAddOpen(true)}
                  >
                    Add member
                  </Button>
                }
              />
            }
          />
          {members.data && members.data.total > 0 && (
            <Pagination
              page={members.data.page}
              pageSize={members.data.pageSize}
              total={members.data.total}
              onPage={(page) => setFilter((current) => ({ ...current, page }))}
            />
          )}
        </AsyncPanel>
      </Card>

      <GroupForm open={editOpen} group={data} onClose={() => setEditOpen(false)} />
      {addOpen && <AddMemberModal group={data} onClose={() => setAddOpen(false)} />}
      {deleteOpen && (
        <Modal
          open
          onClose={() => setDeleteOpen(false)}
          width="sm"
          title={`Delete ${data.name}?`}
          description="This removes the group. It cannot be undone."
          footer={<Button onClick={() => setDeleteOpen(false)}>Cancel</Button>}
        >
          <div className="space-y-3">
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              {data.members > 0
                ? `${plural(data.members, "client")} stay in the book with their policies, documents and history. Only the grouping goes.`
                : "There is nobody in this group, so nothing else is affected."}
            </p>
            <Button
              className="w-full justify-start text-rose-600 hover:bg-rose-50"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete the group, keep the clients
            </Button>
            <p className="text-xs text-slate-400">
              Archiving instead puts the group and its members away together, and can be undone.
            </p>
          </div>
        </Modal>
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
 * Puts a client into the group: one already in the book, or a company opened on
 * the spot.
 *
 * A member is a client, so this never stores a company inside a group. It finds
 * the row or creates one, and then says which group it belongs to — the same
 * shape the family panel uses for a relative, and for the same reason.
 */
function AddMemberModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);

  const search = name.trim();
  const matches = useQuery({
    queryKey: ["clientSearch", search],
    queryFn: () =>
      api.listClients({ search, includeFamily: true, page: 1, pageSize: 6, sort: "name" }),
    enabled: search.length >= 2,
  });

  const join = useMutation({
    mutationFn: (clientId: number) => api.setClientGroup(clientId, group.id),
    onSuccess: () => {
      toast.success(`Added to ${group.name}`);
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const candidates = matches.data?.rows ?? [];

  return (
    <>
      <Modal
        open={!newClientOpen}
        onClose={onClose}
        width="sm"
        title={`Add a member to ${group.name}`}
        description="Members are clients in their own right. Find one in the book, or open a company for them."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => setNewClientOpen(true)}>
              New company
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Search the book" hint="By name, code, phone or PAN">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sundaram Textiles"
              autoFocus
            />
          </Field>

          {candidates.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {candidates.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={join.isPending}
                    className="w-full cursor-pointer px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => {
                      setError(null);
                      join.mutate(row.id);
                    }}
                  >
                    <p className="text-sm text-slate-700">{row.fullName}</p>
                    <p className="text-xs text-slate-400">
                      {row.clientCode}
                      {` · ${clientKindLabel(row.kind)}`}
                      {/* Somebody already filed elsewhere is worth saying so
                          before they are moved: they leave that group by
                          joining this one. */}
                      {row.groupName
                        ? row.groupId === group.id
                          ? " · already in this group"
                          : ` · currently in ${row.groupName}`
                        : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {search.length >= 2 && candidates.length === 0 && !matches.isFetching && (
            <p className="text-xs text-slate-400">
              Nobody in the book by that name. Open a company for them instead.
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </div>
      </Modal>

      {/* Opened as a client first, then put into the group — the same two steps
          the search path takes, so there is one way membership is written and
          the client form stays a form about one client. The form starts on this
          group, so the operator is not asked which one they meant. */}
      <ClientForm
        open={newClientOpen}
        defaultKind="company"
        defaultGroupId={group.id}
        onClose={() => {
          setNewClientOpen(false);
          onClose();
        }}
        onSaved={() => toast.success(`Added to ${group.name}`)}
      />
    </>
  );
}
