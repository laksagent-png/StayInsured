import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Client, Group, GroupInput } from "../lib/types";
import { plural } from "../lib/format";
import { Button, Field, Input, Modal, Textarea, useToast } from "./ui";

const EMPTY: GroupInput = {
  name: "",
  groupCode: "",
  headClientId: null,
  notes: "",
};

function toInput(group: Group): GroupInput {
  return {
    name: group.name,
    groupCode: group.groupCode,
    headClientId: group.headClientId,
    notes: group.notes ?? "",
  };
}

function blank(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length ? text : null;
}

/**
 * Opens a group, or edits one.
 *
 * The group head is a client rather than a name typed into this form, which is
 * why it is a search rather than a box. An introducer the agency deals with is
 * already in the book — they have a phone number and usually policies of their
 * own — and a group whose referrer were only a string could not be rung up.
 */
export function GroupForm({
  open,
  onClose,
  group,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  group?: Group;
  onSaved?: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<GroupInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [headSearch, setHeadSearch] = useState("");
  const [head, setHead] = useState<{ id: number; name: string; code: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setHeadSearch("");
    if (group) {
      setForm(toInput(group));
      setHead(
        group.headClientId
          ? {
              id: group.headClientId,
              name: group.headName ?? "This client",
              code: group.headClientCode ?? "",
            }
          : null,
      );
    } else {
      setForm(EMPTY);
      setHead(null);
      api.nextGroupCode().then((code) => setForm((current) => ({ ...current, groupCode: code })));
    }
  }, [open, group]);

  const set = <K extends keyof GroupInput>(key: K, value: GroupInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const search = headSearch.trim();
  const matches = useQuery({
    queryKey: ["clientSearch", search],
    queryFn: () =>
      api.listClients({ search, includeFamily: true, page: 1, pageSize: 6, sort: "name" }),
    enabled: open && !head && search.length >= 2,
  });

  const save = useMutation({
    mutationFn: async () => {
      const input: GroupInput = {
        name: form.name.trim(),
        groupCode: blank(form.groupCode),
        headClientId: head?.id ?? null,
        notes: blank(form.notes),
      };
      if (group) {
        await api.updateGroup(group.id, input);
        return group.id;
      }
      return api.createGroup(input);
    },
    onSuccess: (id) => {
      toast.success(group ? "Group updated" : "Group opened");
      onSaved?.(id);
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const submit = () => {
    if (!form.name.trim()) {
      setError("Give the group a name");
      return;
    }
    // Caught here as well as in the core, because the reason is worth saying
    // while the box is still on screen: a group without its referrer is a
    // referral nobody recorded.
    if (!head) {
      setError("Name the client who referred this group");
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="sm"
      title={group ? `Edit ${group.name}` : "New group"}
      description={
        group
          ? undefined
          : "A group is a set of clients worked as one book — a holding company's firms, or everyone one introducer brought in."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {group ? "Save changes" : "Open group"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Group name" required>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Sundaram Group"
            autoFocus
          />
        </Field>

        <Field label="Group code">
          <Input
            value={form.groupCode ?? ""}
            onChange={(event) => set("groupCode", event.target.value)}
          />
        </Field>

        {head ? (
          /* Not a Field, because a Field is a label and a label must not have a
             button inside it: the click would land on the label's control and
             the button would answer to the label's name. */
          <div className="block">
            <span className="field-label">Group head</span>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="min-w-0 truncate">
                {head.name}
                {head.code ? <span className="text-slate-400"> · {head.code}</span> : null}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setHead(null);
                  setHeadSearch("");
                }}
              >
                Change
              </Button>
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              The client who referred this group
            </span>
          </div>
        ) : (
          <Field
            label="Group head"
            required
            hint="The client who referred this group. They need not be in it."
          >
            <Input
              value={headSearch}
              onChange={(event) => setHeadSearch(event.target.value)}
              placeholder="Search the book by name"
            />
          </Field>
        )}

        {!head && (matches.data?.rows.length ?? 0) > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {matches.data?.rows.map((row: Client) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() =>
                    setHead({ id: row.id, name: row.fullName, code: row.clientCode })
                  }
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

        {!head && search.length >= 2 && (matches.data?.rows.length ?? 0) === 0 && !matches.isFetching && (
          <p className="text-xs text-slate-400">
            Nobody in the book by that name. A group head has to be a client, so add them from the
            clients screen first.
          </p>
        )}

        <Field label="Notes">
          <Textarea
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Renewals handled centrally, one invoice for all firms…"
          />
        </Field>

        <button type="submit" hidden />
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
    </Modal>
  );
}
