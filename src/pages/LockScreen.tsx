import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { SessionState } from "../lib/types";
import { Button, Checkbox, Field, Input, useToast } from "../components/ui";

/**
 * Both the first-run setup and the day-to-day unlock. The password is not a UI
 * gate: it derives the key the database itself is encrypted with, so there is no
 * way past this screen and no copy of the data outside it.
 */
export function LockScreen({
  session,
  autoUnlock = true,
}: {
  session?: SessionState;
  autoUnlock?: boolean;
}) {
  const isSetup = session ? !session.initialised : false;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDone = () => {
    queryClient.invalidateQueries({ queryKey: ["session"] });
  };

  const setup = useMutation({
    mutationFn: () => api.setup(password, displayName, remember),
    onSuccess: () => {
      toast.success("Your encrypted database is ready");
      onDone();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const unlock = useMutation({
    mutationFn: () => api.unlock(password, remember),
    onSuccess: onDone,
    onError: (err: ApiError) => setError(err.message),
  });

  const keychain = useMutation({
    mutationFn: api.unlockWithKeychain,
    onSuccess: onDone,
    onError: (err: ApiError) => setError(err.message),
  });

  // A trusted device unlocks itself as the app starts; the password screen is
  // then only a fallback. `autoUnlock` is off once the book has been open, so a
  // deliberate lock does not undo itself.
  useEffect(() => {
    if (autoUnlock && session?.canUseKeychain && !session.unlocked && session.initialised) {
      keychain.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUnlock, session?.canUseKeychain, session?.initialised]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < 8) {
        setError("Use a password of at least 8 characters");
        return;
      }
      if (password !== confirm) {
        setError("The two passwords do not match");
        return;
      }
      setup.mutate();
    } else {
      if (!password) {
        setError("Enter the password that opens this book");
        return;
      }
      unlock.mutate();
    }
  };

  // The keychain is deliberately left out: an attempt that hangs — a system
  // prompt nobody answered — must not shut the operator out of typing the
  // password they know.
  const busy = setup.isPending || unlock.isPending;

  return (
    <div className="grid h-full place-items-center bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="size-6" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">StayInsured</h1>
            <p className="text-sm text-slate-500">
              {isSetup ? "Set up your practice" : "Welcome back"}
            </p>
          </div>
        </div>

        {isSetup && (
          <p className="mb-5 rounded-lg bg-brand-50 px-3.5 py-3 text-sm text-brand-900">
            This password encrypts your client database on this machine. It is not stored anywhere
            and cannot be recovered, so keep a copy somewhere safe.
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          {isSetup && (
            <Field label="Agency name" hint="Shown in the app and in client emails">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Sharma Insurance Services"
                autoFocus
              />
            </Field>
          )}

          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoFocus={!isSetup}
              autoComplete={isSetup ? "new-password" : "current-password"}
            />
          </Field>

          {isSetup && (
            <Field label="Confirm password" required>
              <Input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          )}

          <Checkbox
            label="Trust this device"
            hint="Unlock automatically using the system keychain"
            checked={remember}
            onChange={setRemember}
          />

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={busy}
            icon={<KeyRound className="size-4" />}
          >
            {isSetup ? "Create encrypted database" : "Unlock"}
          </Button>
        </form>

        {session?.canUseKeychain && !isSetup && (
          <Button
            variant="ghost"
            className="mt-3 w-full"
            onClick={() => keychain.mutate()}
            loading={keychain.isPending}
          >
            Use the saved key on this device
          </Button>
        )}
      </div>
    </div>
  );
}
