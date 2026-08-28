import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Group, GroupInput } from "../lib/types";
import { Button, Field, Input, Modal, Textarea, useToast } from "./ui";

const EMPTY: GroupInput = {
  name: "",
  groupCode: "",
  headName: "",
  headDesignation: "",
  headPhone: "",
  headEmail: "",
  notes: "",
};

function toInput(group: Group): GroupInput {
  return {
    name: group.name,
    groupCode: group.groupCode,
    headName: group.headName ?? "",
    headDesignation: group.headDesignation ?? "",
    headPhone: group.headPhone ?? "",
    headEmail: group.headEmail ?? "",
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
 * The head is written on the group rather than looked up in the book. The
 * person who introduces a group is usually a broker, an HR manager or an
 * accountant — somebody worth ringing and never worth insuring — so naming one
 * is four boxes, and leaving all four empty is a group like any other.
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

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (group) {
      setForm(toInput(group));
    } else {
      setForm(EMPTY);
      api.nextGroupCode().then((code) => setForm((current) => ({ ...current, groupCode: code })));
    }
  }, [open, group]);

  const set = <K extends keyof GroupInput>(key: K, value: GroupInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const input: GroupInput = {
        name: form.name.trim(),
        groupCode: blank(form.groupCode),
        headName: blank(form.headName),
        headDesignation: blank(form.headDesignation),
        headPhone: blank(form.headPhone),
        headEmail: blank(form.headEmail),
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

        <Field label="Group head" hint="Who introduced this group">
          <Input
            value={form.headName ?? ""}
            onChange={(event) => set("headName", event.target.value)}
            placeholder="Nirmal Shah"
          />
        </Field>

        <Field label="Designation">
          <Input
            value={form.headDesignation ?? ""}
            onChange={(event) => set("headDesignation", event.target.value)}
            placeholder="Chartered accountant"
          />
        </Field>

        <Field label="Phone">
          <Input
            value={form.headPhone ?? ""}
            onChange={(event) => set("headPhone", event.target.value)}
            placeholder="98765 43210"
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            value={form.headEmail ?? ""}
            onChange={(event) => set("headEmail", event.target.value)}
            placeholder="nirmal@example.com"
          />
        </Field>

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
