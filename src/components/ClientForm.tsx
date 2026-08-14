import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Client, ClientInput } from "../lib/types";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from "./ui";

const EMPTY: ClientInput = {
  fullName: "",
  clientCode: "",
  email: "",
  phone: "",
  altPhone: "",
  dateOfBirth: "",
  gender: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  pincode: "",
  occupation: "",
  pan: "",
  notes: "",
  remindersOptedOut: false,
};

function toInput(client: Client): ClientInput {
  return {
    fullName: client.fullName,
    clientCode: client.clientCode,
    email: client.email ?? "",
    phone: client.phone ?? "",
    altPhone: client.altPhone ?? "",
    dateOfBirth: client.dateOfBirth ?? "",
    gender: client.gender ?? "",
    addressLine1: client.addressLine1 ?? "",
    addressLine2: client.addressLine2 ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    pincode: client.pincode ?? "",
    occupation: client.occupation ?? "",
    pan: client.pan ?? "",
    notes: client.notes ?? "",
    remindersOptedOut: client.remindersOptedOut,
  };
}

export function ClientForm({
  open,
  onClose,
  client,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client;
  onSaved?: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<ClientInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (client) {
      setForm(toInput(client));
    } else {
      setForm(EMPTY);
      // Reserve the next code so two people entering at once do not collide.
      api.nextClientCode().then((code) => setForm((current) => ({ ...current, clientCode: code })));
    }
  }, [open, client]);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      if (client) {
        await api.updateClient(client.id, form);
        return client.id;
      }
      return api.createClient(form);
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(client ? "Client updated" : "Client added");
      onSaved?.(id);
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? `Edit ${client.fullName}` : "New client"}
      description="Only the name is required — the rest can be filled in as you learn it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {client ? "Save changes" : "Add client"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2">
          <Input
            value={form.fullName}
            onChange={(event) => set("fullName", event.target.value)}
            placeholder="Rohit Sharma"
            autoFocus
          />
        </Field>

        <Field label="Client code">
          <Input
            value={form.clientCode ?? ""}
            onChange={(event) => set("clientCode", event.target.value)}
          />
        </Field>
        <Field label="Mobile">
          <Input
            value={form.phone ?? ""}
            onChange={(event) => set("phone", event.target.value)}
            placeholder="9876543210"
          />
        </Field>

        <Field label="Email" hint="Reminders cannot be sent without this">
          <Input
            type="email"
            value={form.email ?? ""}
            onChange={(event) => set("email", event.target.value)}
            placeholder="rohit@example.com"
          />
        </Field>
        <Field label="Alternate phone">
          <Input
            value={form.altPhone ?? ""}
            onChange={(event) => set("altPhone", event.target.value)}
          />
        </Field>

        <Field label="Date of birth">
          <Input
            type="date"
            value={form.dateOfBirth ?? ""}
            onChange={(event) => set("dateOfBirth", event.target.value)}
          />
        </Field>
        <Field label="Gender">
          <Select value={form.gender ?? ""} onChange={(event) => set("gender", event.target.value)}>
            <option value="">Not recorded</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>

        <Field label="Address" className="sm:col-span-2">
          <Input
            value={form.addressLine1 ?? ""}
            onChange={(event) => set("addressLine1", event.target.value)}
            placeholder="Flat 402, Green Meadows"
          />
        </Field>
        <Field label="Area / locality" className="sm:col-span-2">
          <Input
            value={form.addressLine2 ?? ""}
            onChange={(event) => set("addressLine2", event.target.value)}
          />
        </Field>

        <Field label="City">
          <Input value={form.city ?? ""} onChange={(event) => set("city", event.target.value)} />
        </Field>
        <Field label="State">
          <Input value={form.state ?? ""} onChange={(event) => set("state", event.target.value)} />
        </Field>

        <Field label="Pincode">
          <Input
            value={form.pincode ?? ""}
            onChange={(event) => set("pincode", event.target.value)}
          />
        </Field>
        <Field label="Occupation">
          <Input
            value={form.occupation ?? ""}
            onChange={(event) => set("occupation", event.target.value)}
          />
        </Field>

        <Field label="PAN">
          <Input
            value={form.pan ?? ""}
            onChange={(event) => set("pan", event.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
          />
        </Field>

        <div className="flex items-end pb-1">
          <Checkbox
            label="Do not send reminders"
            hint="Respect a client who asked not to be emailed"
            checked={form.remindersOptedOut ?? false}
            onChange={(value) => set("remindersOptedOut", value)}
          />
        </div>

        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Prefers a call before renewal, family floater under review…"
          />
        </Field>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
    </Modal>
  );
}
