import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Client, ClientInput, ClientKind } from "../lib/types";
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
  gstin: "",
  preferredLanguage: "",
  notes: "",
  remindersOptedOut: false,
  kind: "individual",
  contactPerson: "",
  contactDesignation: "",
  registrationNo: "",
};

/**
 * A client as the form holds them.
 *
 * The save writes every column, so the preferred language is carried through
 * even though there is no box for it: a form that sent only what it draws would
 * empty it on the way past. The group is the one exception, and it is the core's
 * rather than the form's — `groupId` is left out of the payload entirely, and
 * the core keeps whatever the client already had. Membership is moved from the
 * group screens, where the operator can see what they are moving somebody into.
 */
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
    gstin: client.gstin ?? "",
    preferredLanguage: client.preferredLanguage ?? "",
    notes: client.notes ?? "",
    remindersOptedOut: client.remindersOptedOut,
    kind: client.kind,
    contactPerson: client.contactPerson ?? "",
    contactDesignation: client.contactDesignation ?? "",
    registrationNo: client.registrationNo ?? "",
  };
}

/** A box left empty means the field is not known, which is nothing at all. */
function blank(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length ? text : null;
}

/** The same shape as `looks_like_email` in the core, so both agree. */
function looksLikeEmail(value: string): boolean {
  const [local, domain, extra] = value.split("@");
  if (extra !== undefined || !local || !domain) return false;
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * What crosses the bridge: an untouched box is null rather than an empty
 * string, so the core is told the field is unknown rather than being asked to
 * store emptiness.
 *
 * Only the fields belonging to the chosen type are sent. Somebody who fills in a
 * date of birth and then realises they are entering a company sees those boxes
 * go, and what they can no longer see must not be what gets stored — otherwise
 * the record disagrees with the screen that wrote it, and the next person to
 * open it has no way of knowing.
 */
function toPayload(form: ClientInput): ClientInput {
  const company = form.kind === "company";
  return {
    fullName: form.fullName.trim(),
    clientCode: blank(form.clientCode),
    email: blank(form.email),
    phone: blank(form.phone),
    altPhone: blank(form.altPhone),
    dateOfBirth: company ? null : blank(form.dateOfBirth),
    gender: company ? null : blank(form.gender),
    addressLine1: blank(form.addressLine1),
    addressLine2: blank(form.addressLine2),
    city: blank(form.city),
    state: blank(form.state),
    pincode: blank(form.pincode),
    occupation: blank(form.occupation),
    pan: blank(form.pan),
    gstin: blank(form.gstin),
    preferredLanguage: blank(form.preferredLanguage),
    notes: blank(form.notes),
    remindersOptedOut: form.remindersOptedOut,
    kind: form.kind ?? "individual",
    contactPerson: company ? blank(form.contactPerson) : null,
    contactDesignation: company ? blank(form.contactDesignation) : null,
    registrationNo: company ? blank(form.registrationNo) : null,
  };
}

export function ClientForm({
  open,
  onClose,
  client,
  onSaved,
  defaultKind = "individual",
}: {
  open: boolean;
  onClose: () => void;
  client?: Client;
  onSaved?: (id: number) => void;
  /** What a new client starts as. A group screen opens this asking for a firm. */
  defaultKind?: ClientKind;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ClientInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (client) {
      setForm(toInput(client));
    } else {
      setForm({ ...EMPTY, kind: defaultKind });
      // Reserve the next code so two people entering at once do not collide.
      api.nextClientCode().then((code) => setForm((current) => ({ ...current, clientCode: code })));
    }
  }, [open, client, defaultKind]);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const input = toPayload(form);
      if (client) {
        await api.updateClient(client.id, input);
        return client.id;
      }
      return api.createClient(input);
    },
    onSuccess: (id) => {
      toast.success(client ? "Client updated" : "Client added");
      onSaved?.(id);
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  // An address the mail server will never reach is worth catching here: the
  // client stays in the book and quietly drops out of every reminder run.
  const submit = () => {
    const email = blank(form.email);
    if (email && !looksLikeEmail(email)) {
      setError(`"${email}" is not a valid email address`);
      return;
    }
    setError(null);
    save.mutate();
  };

  const company = form.kind === "company";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? `Edit ${client.fullName}` : company ? "New company" : "New client"}
      description="Only the name is required — the rest can be filled in as you learn it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {client ? "Save changes" : "Add client"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* The type is chosen first because it decides what the rest of the
            form asks for. A company has no birthday and no gender; what it has
            instead is somebody to ask for and a number the registrar issued. */}
        <Field
          label="Client type"
          className="sm:col-span-2"
          hint={
            company
              ? "A firm, LLP or partnership that holds cover in its own name"
              : "A person, and the kind of client most of the book is"
          }
        >
          <Select
            value={form.kind ?? "individual"}
            onChange={(event) => set("kind", event.target.value as ClientKind)}
          >
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </Select>
        </Field>

        <Field label={company ? "Company name" : "Full name"} required className="sm:col-span-2">
          <Input
            value={form.fullName}
            onChange={(event) => set("fullName", event.target.value)}
            placeholder={company ? "Sundaram Textiles Pvt Ltd" : "Rohit Sharma"}
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
            placeholder={company ? "accounts@sundaramtextiles.in" : "rohit@example.com"}
          />
        </Field>
        <Field label="Alternate phone">
          <Input
            value={form.altPhone ?? ""}
            onChange={(event) => set("altPhone", event.target.value)}
          />
        </Field>

        {company ? (
          <>
            {/* The name on the policy is the firm. This is the human who
                answers when the agency rings about a renewal. */}
            <Field label="Contact person" hint="Who to ask for">
              <Input
                value={form.contactPerson ?? ""}
                onChange={(event) => set("contactPerson", event.target.value)}
                placeholder="Meera Raghavan"
              />
            </Field>
            <Field label="Designation">
              <Input
                value={form.contactDesignation ?? ""}
                onChange={(event) => set("contactDesignation", event.target.value)}
                placeholder="HR Manager"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Date of birth">
              <Input
                type="date"
                value={form.dateOfBirth ?? ""}
                onChange={(event) => set("dateOfBirth", event.target.value)}
              />
            </Field>
            <Field label="Gender">
              <Select
                value={form.gender ?? ""}
                onChange={(event) => set("gender", event.target.value)}
              >
                <option value="">Not recorded</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </>
        )}

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
        <Field label={company ? "Industry" : "Occupation"}>
          <Input
            value={form.occupation ?? ""}
            onChange={(event) => set("occupation", event.target.value)}
            placeholder={company ? "Textile manufacturing" : ""}
          />
        </Field>

        <Field label="PAN">
          <Input
            value={form.pan ?? ""}
            onChange={(event) => set("pan", event.target.value.toUpperCase())}
            placeholder={company ? "AABCS1429B" : "ABCDE1234F"}
          />
        </Field>

        {/* A person's book rarely needs either of these, and a company's always
            does: the insurer asks for the GSTIN, and the registration number is
            how two firms with the same trading name are told apart. */}
        {company && (
          <>
            <Field label="GSTIN">
              <Input
                value={form.gstin ?? ""}
                onChange={(event) => set("gstin", event.target.value.toUpperCase())}
                placeholder="33AABCS1429B1ZN"
              />
            </Field>
            <Field label="Registration number" hint="CIN, LLPIN or as registered">
              <Input
                value={form.registrationNo ?? ""}
                onChange={(event) => set("registrationNo", event.target.value.toUpperCase())}
                placeholder="U17111TN2011PTC079123"
              />
            </Field>
          </>
        )}

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
            placeholder={
              company
                ? "Renewal signed off by the finance head, headcount reviewed each April…"
                : "Prefers a call before renewal, family floater under review…"
            }
          />
        </Field>

        {/*
          Enter in a field submits through the form's own button, and the one
          the agent presses sits in the modal's footer, outside the form.
        */}
        <button type="submit" hidden />
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
    </Modal>
  );
}
