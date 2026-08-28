import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Folders, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Group, GroupFilter } from "../lib/types";
import { count, date, money, plural } from "../lib/format";
import { GroupForm } from "../components/GroupForm";
import { DataTable, type Column } from "../components/DataTable";
import {
  AsyncPanel,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Pagination,
  useToast,
} from "../components/ui";
import { useListFilter } from "../lib/useListFilter";

export function GroupsPage() {
  const toast = useToast();

  const { filter, setFilter, searchText, setSearchText, sortBy, goToPage } = useListFilter<
    GroupFilter & { page: number }
  >({
    page: 1,
    pageSize: 25,
    sort: "name",
  });
  const [editing, setEditing] = useState<Group | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const groups = useQuery({
    queryKey: ["groups", filter],
    queryFn: () => api.listGroups(filter),
    placeholderData: keepPreviousData,
  });

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.setGroupArchived(id, archived),
    // The count is the point of the message. Archiving a group moves everybody
    // in it, and an operator who thought they were putting away one row should
    // be told they put away eleven.
    onSuccess: (moved, { archived }) =>
      toast.success(
        moved === 0
          ? archived
            ? "Group archived"
            : "Group restored"
          : `Group ${archived ? "archived" : "restored"} with ${plural(moved, "client")}`,
      ),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const narrowed = Boolean(filter.search);

  const columns: Column<Group>[] = [
    {
      key: "name",
      header: "Group",
      sortKey: "name",
      render: (row) => (
        <span className="min-w-0">
          <Link
            to={`/groups/${row.id}`}
            className="block truncate font-medium text-slate-800 hover:text-brand-700"
          >
            {row.name}
          </Link>
          <span className="block truncate text-xs text-slate-400">{row.groupCode}</span>
        </span>
      ),
    },
    {
      key: "head",
      header: "Group head",
      render: (row) =>
        row.headClientId ? (
          <Link
            to={`/clients/${row.headClientId}`}
            className="block truncate text-xs text-slate-600 hover:text-brand-700"
          >
            {row.headName}
            <span className="block text-slate-400">{row.headClientCode}</span>
          </Link>
        ) : (
          // The referrer was deleted and the group outlived them, which the core
          // allows on purpose. Saying so is how it gets put right.
          <span className="text-xs text-amber-600">No referrer on file</span>
        ),
    },
    {
      key: "members",
      header: "Members",
      sortKey: "members",
      align: "center",
      render: (row) => <span className="text-sm text-slate-700">{row.members}</span>,
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
      key: "premium",
      header: "Premium",
      sortKey: "premium",
      align: "right",
      render: (row) => (
        <span className="text-sm text-slate-700">{money(row.premiumUnderManagement)}</span>
      ),
    },
    {
      key: "nextExpiry",
      header: "Next expiry",
      sortKey: "nextExpiry",
      render: (row) => <span className="text-xs text-slate-600">{date(row.nextExpiry)}</span>,
    },
    {
      key: "flags",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.isArchived && <Badge tone="warning">Archived</Badge>}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row);
              setFormOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              archive.mutate({ id: row.id, archived: !row.isArchived });
            }}
          >
            {row.isArchived ? "Restore" : "Archive"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Groups</h1>
          <p className="text-sm text-slate-500">
            {groups.data
              ? `${count(groups.data.total)} on the desk`
              : groups.isLoading
                ? "Loading"
                : null}
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          New group
        </Button>
      </header>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Group name, code or the referrer's name"
              className="pl-9"
            />
          </div>
          <div className="pb-1.5">
            <Checkbox
              label="Include archived"
              checked={filter.includeArchived ?? false}
              onChange={(value) => setFilter({ includeArchived: value, page: 1 })}
            />
          </div>
        </div>
      </Card>

      <Card bodyClassName="">
        <AsyncPanel query={groups} errorTitle="The group list could not be read">
          <DataTable
            columns={columns}
            rows={groups.data?.rows ?? []}
            rowKey={(row) => row.id}
            sort={filter.sort}
            descending={filter.descending}
            onSort={sortBy}
            empty={
              <EmptyState
                icon={<Folders className="size-9" />}
                title={narrowed ? "No groups match" : "No groups yet"}
                description={
                  narrowed
                    ? "Try clearing the search, or open the group you were looking for."
                    : "Open a group when several clients come in together — a holding company's firms, or everyone one introducer brought you."
                }
                action={
                  <Button
                    variant="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                      setEditing(undefined);
                      setFormOpen(true);
                    }}
                  >
                    Open a group
                  </Button>
                }
              />
            }
          />
          {groups.data && groups.data.total > 0 && (
            <Pagination
              page={groups.data.page}
              pageSize={groups.data.pageSize}
              total={groups.data.total}
              onPage={goToPage}
            />
          )}
        </AsyncPanel>
      </Card>

      <GroupForm open={formOpen} group={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
