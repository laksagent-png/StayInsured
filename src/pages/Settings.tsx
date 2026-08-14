import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { DatabaseBackup, FolderOpen, KeyRound, MailCheck, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { Button, Card, Checkbox, Field, Input, Select, Spinner, useToast } from "../components/ui";

export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const session = useQuery({ queryKey: ["session"], queryFn: api.sessionState });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [autostart, setAutostart] = useState<boolean | undefined>();
  const [current, setCurrent] = useState("");
  const [replacement, setReplacement] = useState("");
  const [confirm, setConfirm] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testAddress, setTestAddress] = useState("");

  // The mail password lives in the keychain rather than in settings, so the
  // form only learns whether one is stored, never what it is.
  const reminders = useQuery({ queryKey: ["reminderOverview"], queryFn: api.reminderOverview });
  const smtpPasswordSet = reminders.data?.smtpPasswordSet ?? false;

  useEffect(() => {
    if (settings.data) {
      setDraft(settings.data);
      setTestAddress((address) => address || settings.data.provider_email || "");
    }
  }, [settings.data]);

  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => setAutostart(false));
  }, []);

  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const set = (key: string, value: string) =>
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));

  const saveSettings = useMutation({
    mutationFn: async () => {
      await api.saveSettings(draft);
      if (smtpPassword) await api.setSmtpPassword(smtpPassword);
    },
    onSuccess: () => {
      setSmtpPassword("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      toast.success("Settings saved");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  /// Saves first, so the test uses what is on screen rather than what was
  /// stored the last time the button was pressed.
  const sendTest = useMutation({
    mutationFn: async () => {
      await api.saveSettings(draft);
      if (smtpPassword) await api.setSmtpPassword(smtpPassword);
      await api.sendTestEmail(testAddress);
    },
    onSuccess: () => {
      setSmtpPassword("");
      queryClient.invalidateQueries({ queryKey: ["reminderOverview"] });
      toast.success(`Test sent to ${testAddress}. Check it arrived before switching reminders on.`);
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const backup = useMutation({
    mutationFn: api.backupNow,
    onSuccess: (path) => toast.success(`Backup written to ${path}`),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(current, replacement),
    onSuccess: () => {
      setCurrent("");
      setReplacement("");
      setConfirm("");
      toast.success("Password changed and the database re-encrypted");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const forget = useMutation({
    mutationFn: api.forgetDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success("This device will ask for the password next time");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const toggleAutostart = useMutation({
    mutationFn: async (value: boolean) => {
      if (value) await enable();
      else await disable();
      return value;
    },
    onSuccess: (value) => {
      setAutostart(value);
      toast.success(value ? "StayInsured will start at login" : "Start at login switched off");
    },
    onError: () => toast.error("Could not change the login setting"),
  });

  if (settings.isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Settings</h1>
          <p className="text-sm text-slate-500">
            Everything here stays on this machine. Nothing is sent anywhere.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Save className="size-4" />}
          loading={saveSettings.isPending}
          onClick={() => saveSettings.mutate()}
        >
          Save changes
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your agency">
          <div className="space-y-4">
            <Field label="Agency name" hint="Used in the sidebar and in client emails">
              <Input
                value={draft.provider_name ?? ""}
                onChange={(event) => set("provider_name", event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact email">
                <Input
                  value={draft.provider_email ?? ""}
                  onChange={(event) => set("provider_email", event.target.value)}
                />
              </Field>
              <Field label="Contact phone">
                <Input
                  value={draft.provider_phone ?? ""}
                  onChange={(event) => set("provider_phone", event.target.value)}
                />
              </Field>
            </div>
            <Field label="Address">
              <Input
                value={draft.provider_address ?? ""}
                onChange={(event) => set("provider_address", event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expiring soon window" hint="Days counted as 'expiring soon'">
                <Input
                  type="number"
                  value={draft.expiring_soon_window ?? "30"}
                  onChange={(event) => set("expiring_soon_window", event.target.value)}
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={draft.currency ?? "INR"}
                  onChange={(event) => set("currency", event.target.value)}
                >
                  <option value="INR">Indian Rupee (₹)</option>
                </Select>
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Security">
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
              Your client data is stored in an AES-256 encrypted database. The key comes from your
              password through Argon2id and is never written to disk in plain form.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Current password">
                <Input
                  type="password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </Field>
              <Field label="New password">
                <Input
                  type="password"
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
              </Field>
              <Field label="Confirm new">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
            </div>
            <Button
              icon={<KeyRound className="size-4" />}
              loading={changePassword.isPending}
              disabled={
                !current || replacement.length < 8 || replacement !== confirm
              }
              onClick={() => changePassword.mutate()}
            >
              Change password
            </Button>

            {session.data?.canUseKeychain && (
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-sm text-slate-600">
                  This device unlocks automatically using the system keychain.
                </p>
                <Button loading={forget.isPending} onClick={() => forget.mutate()}>
                  Stop trusting this device
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Data & backups">
          <div className="space-y-4">
            <Field
              label="Copy backups to"
              hint="Point this at a synced folder (Drive, Dropbox) to keep a copy off this machine"
            >
              <Input
                value={draft.backup_dir ?? ""}
                onChange={(event) => set("backup_dir", event.target.value)}
                placeholder="/Users/you/Google Drive/StayInsured"
              />
            </Field>
            <Field label="Backups to keep">
              <Input
                type="number"
                className="w-28"
                value={draft.backup_retention ?? "14"}
                onChange={(event) => set("backup_retention", event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<DatabaseBackup className="size-4" />}
                loading={backup.isPending}
                onClick={() => backup.mutate()}
              >
                Back up now
              </Button>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => api.revealDataDir()}>
                Open data folder
              </Button>
            </div>
            <p className="text-xs text-slate-400 break-all">{session.data?.dataDir}</p>
          </div>
        </Card>

        <Card title="Reminders">
          <div className="space-y-4">
            <Checkbox
              label="Send reminders automatically"
              hint="The daily run happens even with the window closed, as long as the app is in the menu bar."
              checked={draft.reminders_enabled === "true"}
              onChange={(value) => set("reminders_enabled", String(value))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send reminders at">
                <Input
                  type="time"
                  value={draft.reminder_send_time ?? "09:00"}
                  onChange={(event) => set("reminder_send_time", event.target.value)}
                />
              </Field>
              <Field label="Daily send cap" hint="Mailbox providers throttle bulk sending">
                <Input
                  type="number"
                  value={draft.daily_send_cap ?? "400"}
                  onChange={(event) => set("daily_send_cap", event.target.value)}
                />
              </Field>
            </div>
            <Checkbox
              label="Practice mode: work everything out but send nothing"
              hint="Leave this on until the wording and the timing look right."
              checked={draft.dry_run === "true"}
              onChange={(value) => set("dry_run", String(value))}
            />
            <Checkbox
              label="Start StayInsured at login"
              hint="Needed for reminders to fire when the window is closed"
              checked={autostart ?? false}
              onChange={(value) => toggleAutostart.mutate(value)}
            />
            <Checkbox
              label="Show desktop alerts for the day's expiries"
              checked={draft.desktop_alerts === "true"}
              onChange={(value) => set("desktop_alerts", String(value))}
            />
            <Checkbox
              label="Email me a daily digest of what is expiring"
              hint={`Sent to ${draft.provider_email || "your contact email"}.`}
              checked={draft.digest_enabled === "true"}
              onChange={(value) => set("digest_enabled", String(value))}
            />
          </div>
        </Card>

        <Card title="Sending email">
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
              Reminders go out through your own mailbox, so replies come back to you and no third
              party holds your client list. Most providers want the app password from your mail
              account here rather than the one you type into a browser.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Server" className="sm:col-span-2">
                <Input
                  value={draft.smtp_host ?? ""}
                  onChange={(event) => set("smtp_host", event.target.value)}
                  placeholder="smtp.gmail.com"
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={draft.smtp_port ?? "587"}
                  onChange={(event) => set("smtp_port", event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username">
                <Input
                  value={draft.smtp_username ?? ""}
                  onChange={(event) => set("smtp_username", event.target.value)}
                  placeholder="you@youragency.in"
                />
              </Field>
              <Field
                label="Password"
                hint={
                  smtpPasswordSet && !smtpPassword
                    ? "Saved in the system keychain. Type a new one to replace it."
                    : "Kept in the system keychain, never in the database."
                }
              >
                <Input
                  type="password"
                  value={smtpPassword}
                  onChange={(event) => setSmtpPassword(event.target.value)}
                  placeholder={smtpPasswordSet ? "••••••••" : ""}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send as" hint="The address clients will see and reply to">
                <Input
                  value={draft.smtp_from_email ?? ""}
                  onChange={(event) => set("smtp_from_email", event.target.value)}
                  placeholder="renewals@youragency.in"
                />
              </Field>
              <Field label="Shown as">
                <Input
                  value={draft.smtp_from_name ?? ""}
                  onChange={(event) => set("smtp_from_name", event.target.value)}
                  placeholder={draft.provider_name ?? "Your agency"}
                />
              </Field>
            </div>

            <Field label="Security">
              <Select
                value={draft.smtp_encryption ?? "starttls"}
                onChange={(event) => set("smtp_encryption", event.target.value)}
              >
                <option value="starttls">STARTTLS — usual, port 587</option>
                <option value="tls">TLS — port 465</option>
                <option value="none">None — only for a local test server</option>
              </Select>
            </Field>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button
                icon={<MailCheck className="size-4" />}
                loading={sendTest.isPending}
                disabled={!draft.smtp_host || !testAddress}
                onClick={() => sendTest.mutate()}
              >
                Send test
              </Button>
              <Input
                value={testAddress}
                onChange={(event) => setTestAddress(event.target.value)}
                placeholder="Where to send it"
                className="w-56"
              />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <ShieldCheck className="size-5 text-brand-600" />
          <span>
            StayInsured {version} · schema v{session.data?.schemaVersion} · closing the window keeps
            the app running in the menu bar so scheduled work can continue.
          </span>
        </div>
      </Card>
    </div>
  );
}
