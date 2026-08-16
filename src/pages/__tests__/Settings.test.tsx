/**
 * The settings screen: what it loads, what it sends back, and what it refuses.
 *
 * Every test drives the form the way an agent does — read a box, change it,
 * press the button — and then checks both what is drawn and the command that
 * left the screen.
 */

import { describe, expect, it } from "vitest";

import { SettingsPage } from "@/pages/Settings";
import {
  CORRECT_PASSWORD,
  DEFAULT_SETTINGS,
  act,
  backend,
  fireEvent,
  renderWithProviders,
  screen,
  tauriApp,
  tauriAutostart,
  waitFor,
} from "@/test";

// ---------------------------------------------------------------- helpers

/**
 * The box behind a label. The labels wrap their hint text as well, so these are
 * anchored patterns rather than exact strings.
 */
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

/** The dropdown behind a label. */
const chooser = (label: RegExp) => screen.getByLabelText(label) as HTMLSelectElement;

const button = (name: string) => screen.getByRole("button", { name });
const save = () => button("Save changes");
const sendTest = () => button("Send test");
const startAtLogin = () =>
  screen.getByRole("checkbox", { name: /Start StayInsured at login/ });
const testAddress = () => screen.getByPlaceholderText("Where to send it");

/** The values the screen last asked the core to store. */
function savedValues(): Record<string, string> | undefined {
  return backend().lastCall("save_settings")?.values as Record<string, string> | undefined;
}

/** Where a command sits in the order the screen sent things. */
const orderOf = (command: string) => backend().calls.findIndex((call) => call.command === command);

/**
 * Types a value into a box the keyboard cannot reach in jsdom: a number input
 * drops the minus sign of a half-typed negative, and a time input rejects every
 * intermediate value.
 */
function setValue(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** Lets anything a click started reach the fake core, so "nothing happened" is provable. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

/**
 * Runs a step the screen fires and forgets, so the rejection it leaves behind
 * lands here rather than failing the whole run.
 */
async function swallowingStrayRejections(step: () => Promise<void>) {
  const listeners = process.listeners("unhandledRejection") as RejectionListener[];
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", () => {});
  try {
    await step();
    await settle();
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of listeners) process.on("unhandledRejection", listener);
  }
}

async function renderSettings() {
  const view = renderWithProviders(<SettingsPage />);
  await screen.findByRole("heading", { name: "Settings" });
  return view;
}

// ---------------------------------------------------------------- loading

describe("settings, loading", () => {
  it("waits with a spinner while the settings arrive", async () => {
    const gate = backend().hold("get_settings");
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Loading")).toBeInTheDocument();

    gate.release();
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("reads the settings once", async () => {
    await renderSettings();

    expect(backend().countOf("get_settings")).toBe(1);
  });

  it("lays the settings out in the cards the guide describes", async () => {
    await renderSettings();

    for (const title of ["Your agency", "Security", "Data & backups", "Reminders", "Sending email"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("says so when the settings will not load", async () => {
    backend().fail("get_settings", { kind: "internal", message: "The book would not open" });
    await renderSettings();

    expect(screen.getByText(/would not open/i)).toBeInTheDocument();
  });

  // Was "draws an empty form when the settings will not load". The screen puts
  // the failure where the cards would be, so there are no boxes to read.
  it("draws no form when the settings will not load", async () => {
    backend().fail("get_settings", { kind: "internal", message: "The book would not open" });
    await renderSettings();

    expect(screen.queryByLabelText(/^Agency name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Contact email/)).not.toBeInTheDocument();
  });

  it("does not offer to save settings it never read", async () => {
    backend().fail("get_settings", { kind: "internal", message: "The book would not open" });
    const { user } = await renderSettings();

    await user.click(save());
    await settle();

    expect(savedValues()).not.toEqual({});
  });
});

// ---------------------------------------------------------------- your agency

describe("settings, the agency details", () => {
  it("fills every box from the stored settings", async () => {
    await renderSettings();

    expect(field(/^Agency name/)).toHaveValue(DEFAULT_SETTINGS.provider_name);
    expect(field(/^Contact email/)).toHaveValue(DEFAULT_SETTINGS.provider_email);
    expect(field(/^Contact phone/)).toHaveValue(DEFAULT_SETTINGS.provider_phone);
    expect(field(/^Address/)).toHaveValue(DEFAULT_SETTINGS.provider_address);
  });

  it("shows the formatting the book is kept in", async () => {
    await renderSettings();

    expect(field(/^Expiring soon window/)).toHaveValue(30);
    expect(chooser(/^Currency/)).toHaveValue("INR");
  });

  it("sends an edited agency name to the core", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Agency name/));
    await user.type(field(/^Agency name/), "Nova Insurance Services");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()?.provider_name).toBe("Nova Insurance Services");
  });

  it("sends an edited window and contact details", async () => {
    const { user } = await renderSettings();

    setValue(field(/^Expiring soon window/), "45");
    await user.clear(field(/^Contact phone/));
    await user.type(field(/^Contact phone/), "020 1111 2222");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toMatchObject({
      expiring_soon_window: "45",
      provider_phone: "020 1111 2222",
    });
  });

  it("saves the window it is showing when the setting is missing", async () => {
    delete backend().book.settings.expiring_soon_window;
    const { user } = await renderSettings();

    expect(field(/^Expiring soon window/)).toHaveValue(30);
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()?.expiring_soon_window).toBe("30");
  });
});

// ---------------------------------------------------------------- saving

describe("settings, saving", () => {
  it("sends the whole set of settings, with only the edited one changed", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Agency name/));
    await user.type(field(/^Agency name/), "Nova Insurance Services");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toEqual({
      ...DEFAULT_SETTINGS,
      provider_name: "Nova Insurance Services",
    });
  });

  it("sends the settings it never shows back untouched", async () => {
    const { user } = await renderSettings();

    setValue(field(/^Expiring soon window/), "45");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toMatchObject({
      locale: DEFAULT_SETTINGS.locale,
      date_format: DEFAULT_SETTINGS.date_format,
    });
  });

  // Was "sends the settings back unchanged when nothing was edited". Save is
  // only offered once something has been edited, so the whole map is proved
  // from a screen with one switch flipped.
  it("sends every other setting back at the value it was read at", async () => {
    const { user } = await renderSettings();

    await user.click(screen.getByRole("checkbox", { name: /Practice mode/ }));
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toEqual({ ...DEFAULT_SETTINGS, dry_run: "true" });
  });

  it("keeps the edit after the settings are read back", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Agency name/));
    await user.type(field(/^Agency name/), "Nova Insurance Services");
    await user.click(save());
    await screen.findByText("Settings saved");

    await waitFor(() => expect(backend().countOf("get_settings")).toBe(2));
    expect(field(/^Agency name/)).toHaveValue("Nova Insurance Services");
  });

  it("holds the button busy while the save is in flight", async () => {
    const gate = backend().hold("save_settings");
    const { user } = await renderSettings();

    setValue(field(/^Expiring soon window/), "45");
    await user.click(save());
    expect(save()).toBeDisabled();

    gate.release();
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();

    // A saved screen has nothing left to save, so the proof that the button is
    // no longer held busy is a fresh edit lighting it again.
    setValue(field(/^Expiring soon window/), "60");
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it("reports a save the core refuses", async () => {
    backend().fail("save_settings", { kind: "internal", message: "The database is read only" });
    const { user } = await renderSettings();

    setValue(field(/^Expiring soon window/), "45");
    await user.click(save());

    expect(await screen.findByText("The database is read only")).toBeInTheDocument();
    expect(screen.queryByText("Settings saved")).not.toBeInTheDocument();
  });

  it("keeps the edits on screen after a save fails", async () => {
    backend().fail("save_settings", { kind: "internal", message: "The database is read only" });
    const { user } = await renderSettings();

    await user.clear(field(/^Agency name/));
    await user.type(field(/^Agency name/), "Nova Insurance Services");
    await user.click(save());
    await screen.findByText("The database is read only");

    expect(field(/^Agency name/)).toHaveValue("Nova Insurance Services");
  });

  it("keeps the save button off until something changes", async () => {
    await renderSettings();

    expect(save()).toBeDisabled();
  });

  it("puts the save button back off when an edit is undone", async () => {
    await renderSettings();

    setValue(field(/^Expiring soon window/), "45");
    await waitFor(() => expect(save()).toBeEnabled());

    setValue(field(/^Expiring soon window/), DEFAULT_SETTINGS.expiring_soon_window);

    await waitFor(() => expect(save()).toBeDisabled());
  });

  it("keeps an edit made while the save is in flight", async () => {
    const gate = backend().hold("save_settings");
    const { user } = await renderSettings();

    await user.clear(field(/^Agency name/));
    await user.type(field(/^Agency name/), "Nova Insurance Services");
    await user.click(save());
    await user.clear(field(/^Contact phone/));
    await user.type(field(/^Contact phone/), "020 1111 2222");

    gate.release();
    await screen.findByText("Settings saved");
    await waitFor(() => expect(backend().countOf("get_settings")).toBe(2));

    expect(field(/^Contact phone/)).toHaveValue("020 1111 2222");
  });
});

// ---------------------------------------------------------------- numbers

describe("settings, the numeric boxes", () => {
  const boxes = [
    {
      name: "the expiring soon window",
      label: /^Expiring soon window/,
      key: "expiring_soon_window",
      refused: [
        ["nothing at all", ""],
        ["zero days", "0"],
        ["a negative number of days", "-5"],
      ],
    },
    {
      name: "the daily send cap",
      label: /^Daily send cap/,
      key: "daily_send_cap",
      refused: [
        ["nothing at all", ""],
        ["a negative cap", "-20"],
      ],
    },
    {
      name: "the mail server port",
      label: /^Port/,
      key: "smtp_port",
      refused: [
        ["nothing at all", ""],
        ["port zero", "0"],
        ["a negative port", "-587"],
        ["a port above the range", "70000"],
      ],
    },
    {
      name: "the number of backups to keep",
      label: /^Backups to keep/,
      key: "backup_retention",
      refused: [
        ["nothing at all", ""],
        ["keeping none", "0"],
        ["a negative count", "-2"],
      ],
    },
  ] as const;

  for (const box of boxes) {
    for (const [description, value] of box.refused) {
      it(`does not store ${description} as ${box.name}`, async () => {
        const { user } = await renderSettings();

        setValue(field(box.label), value);
        await user.click(save());
        await settle();

        expect(savedValues()?.[box.key]).not.toBe(value);
      });
    }
  }

  it("empties the box when the window is typed as words", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Expiring soon window/));
    await user.type(field(/^Expiring soon window/), "thirty");

    expect(field(/^Expiring soon window/)).toHaveValue(null);
  });

  it("does not store a window that was typed as words", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Expiring soon window/));
    await user.type(field(/^Expiring soon window/), "thirty");
    await user.click(save());
    await settle();

    expect(savedValues()?.expiring_soon_window).not.toBe("");
  });
});

// ---------------------------------------------------------------- reminders

describe("settings, reminders", () => {
  const named = (name: RegExp) => screen.getByRole("checkbox", { name });

  it("shows the reminder settings as they are stored", async () => {
    await renderSettings();

    expect(named(/Send reminders automatically/)).toBeChecked();
    expect(field(/^Send reminders at/)).toHaveValue("09:00");
    expect(field(/^Daily send cap/)).toHaveValue(400);
    expect(named(/Practice mode/)).not.toBeChecked();
    expect(named(/Show desktop alerts/)).toBeChecked();
    expect(named(/Email me a daily digest/)).toBeChecked();
  });

  it("names the address the digest goes to", async () => {
    await renderSettings();

    expect(screen.getByText(`Sent to ${DEFAULT_SETTINGS.provider_email}.`)).toBeInTheDocument();
  });

  it("sends the reminder switches as strings", async () => {
    const { user } = await renderSettings();

    await user.click(named(/Send reminders automatically/));
    await user.click(named(/Practice mode/));
    await user.click(named(/Show desktop alerts/));
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toMatchObject({
      reminders_enabled: "false",
      dry_run: "true",
      desktop_alerts: "false",
    });
  });

  it("sends an edited send time", async () => {
    const { user } = await renderSettings();

    setValue(field(/^Send reminders at/), "18:30");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()?.reminder_send_time).toBe("18:30");
  });

  it("shows start at login as the system reports it", async () => {
    tauriAutostart.isEnabled.mockResolvedValue(true);
    await renderSettings();

    await waitFor(() => expect(startAtLogin()).toBeChecked());
  });

  it("asks the system to start the app at login", async () => {
    const { user } = await renderSettings();

    await user.click(startAtLogin());

    expect(await screen.findByText("StayInsured will start at login")).toBeInTheDocument();
    expect(tauriAutostart.enable).toHaveBeenCalled();
    expect(startAtLogin()).toBeChecked();
  });

  it("switches start at login off again", async () => {
    tauriAutostart.isEnabled.mockResolvedValue(true);
    const { user } = await renderSettings();
    await waitFor(() => expect(startAtLogin()).toBeChecked());

    await user.click(startAtLogin());

    expect(await screen.findByText("Start at login switched off")).toBeInTheDocument();
    expect(tauriAutostart.disable).toHaveBeenCalled();
    expect(startAtLogin()).not.toBeChecked();
  });

  it("leaves the switch alone when the system refuses", async () => {
    tauriAutostart.enable.mockRejectedValue(new Error("Not permitted"));
    const { user } = await renderSettings();

    await user.click(startAtLogin());

    expect(await screen.findByText("Could not change the login setting")).toBeInTheDocument();
    expect(startAtLogin()).not.toBeChecked();
  });

  it("treats a system that will not answer as switched off", async () => {
    tauriAutostart.isEnabled.mockRejectedValue(new Error("No autostart here"));
    await renderSettings();

    await waitFor(() => expect(startAtLogin()).not.toBeChecked());
  });

  it("keeps start at login out of the saved settings", async () => {
    const { user } = await renderSettings();

    await user.click(startAtLogin());
    await screen.findByText("StayInsured will start at login");
    setValue(field(/^Expiring soon window/), "45");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(Object.keys(savedValues() ?? {})).toEqual(Object.keys(DEFAULT_SETTINGS));
  });
});

// ---------------------------------------------------------------- sending email

describe("settings, sending email", () => {
  it("fills the mail server details from the stored settings", async () => {
    await renderSettings();

    expect(field(/^Server/)).toHaveValue(DEFAULT_SETTINGS.smtp_host);
    expect(field(/^Port/)).toHaveValue(Number(DEFAULT_SETTINGS.smtp_port));
    expect(field(/^Username/)).toHaveValue(DEFAULT_SETTINGS.smtp_username);
    expect(field(/^Send as/)).toHaveValue(DEFAULT_SETTINGS.smtp_from_email);
    expect(field(/^Shown as/)).toHaveValue(DEFAULT_SETTINGS.smtp_from_name);
    expect(chooser(/^Security/)).toHaveValue("starttls");
  });

  it("sends the edited server details", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Server/));
    await user.type(field(/^Server/), "smtp.office365.com");
    setValue(field(/^Port/), "465");
    await user.selectOptions(chooser(/^Security/), "tls");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toMatchObject({
      smtp_host: "smtp.office365.com",
      smtp_port: "465",
      smtp_encryption: "tls",
    });
  });

  it("never shows the mail password it holds", async () => {
    await renderSettings();

    const box = field(/^Password/);
    expect(box).toHaveValue("");
    expect(box).toHaveAttribute("type", "password");
    expect(box).toHaveAttribute("placeholder", "••••••••");
    expect(screen.getByText(/Saved in the system keychain/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CORRECT_PASSWORD);
  });

  it("says the keychain is empty when no password is stored", async () => {
    backend().fail("reminder_overview", { kind: "internal", message: "No overview" });
    await renderSettings();

    expect(await screen.findByText(/never in the database/)).toBeInTheDocument();
    expect(field(/^Password/)).toHaveAttribute("placeholder", "");
  });

  it("puts a new mail password in the keychain once the settings are stored", async () => {
    const { user } = await renderSettings();

    await user.type(field(/^Password/), "app-password-1");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(backend().lastCall("set_smtp_password")).toEqual({ password: "app-password-1" });
    expect(orderOf("save_settings")).toBeLessThan(orderOf("set_smtp_password"));
  });

  it("empties the password box once it is in the keychain", async () => {
    const { user } = await renderSettings();

    await user.type(field(/^Password/), "app-password-1");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(field(/^Password/)).toHaveValue("");
  });

  it("leaves the keychain alone when the password box is untouched", async () => {
    const { user } = await renderSettings();

    // Any edit brings Save to life; it has to be one that leaves the password
    // box alone, which is what the test is about.
    setValue(field(/^Expiring soon window/), "45");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(backend().countOf("set_smtp_password")).toBe(0);
  });

  it("reports a keychain that will not take the password", async () => {
    backend().fail("set_smtp_password", { kind: "internal", message: "The keychain is locked" });
    const { user } = await renderSettings();

    await user.type(field(/^Password/), "app-password-1");
    await user.click(save());

    expect(await screen.findByText("The keychain is locked")).toBeInTheDocument();
  });

  it("can take the stored mail password out of the keychain", async () => {
    const { user } = await renderSettings();

    await user.click(button("Remove password"));
    await settle();

    expect(backend().lastCall("set_smtp_password")).toEqual({ password: null });
  });

  it("offers the contact address as where to send the test", async () => {
    await renderSettings();

    expect(testAddress()).toHaveValue(DEFAULT_SETTINGS.provider_email);
  });

  it("sends a test to the address on screen", async () => {
    const { user } = await renderSettings();

    await user.click(sendTest());

    expect(
      await screen.findByText(
        `Test sent to ${DEFAULT_SETTINGS.provider_email}. Check it arrived before switching reminders on.`,
      ),
    ).toBeInTheDocument();
    expect(backend().lastCall("send_test_email")).toEqual({ to: DEFAULT_SETTINGS.provider_email });
  });

  it("stores what is on screen before sending the test", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Server/));
    await user.type(field(/^Server/), "smtp.office365.com");
    await user.click(sendTest());
    await screen.findByText(/Test sent to/);

    expect(savedValues()?.smtp_host).toBe("smtp.office365.com");
    expect(orderOf("save_settings")).toBeLessThan(orderOf("send_test_email"));
  });

  it("cannot send a test without a server", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Server/));

    expect(sendTest()).toBeDisabled();
  });

  it("cannot send a test without somewhere to send it", async () => {
    const { user } = await renderSettings();

    await user.clear(testAddress());

    expect(sendTest()).toBeDisabled();
  });

  it("reports an address the core will not take", async () => {
    const { user } = await renderSettings();

    await user.clear(testAddress());
    await user.type(testAddress(), "not-an-address");
    await user.click(sendTest());

    expect(await screen.findByText("That is not an email address")).toBeInTheDocument();
  });

  it("reports a mailbox that turns the message away", async () => {
    backend().fail("send_test_email", {
      kind: "mail",
      message: "The server rejected the username or password.",
    });
    const { user } = await renderSettings();

    await user.click(sendTest());

    expect(
      await screen.findByText("The server rejected the username or password."),
    ).toBeInTheDocument();
  });

  it("holds the test button busy while the message goes out", async () => {
    const gate = backend().hold("send_test_email");
    const { user } = await renderSettings();

    await user.click(sendTest());
    await waitFor(() => expect(sendTest()).toBeDisabled());

    gate.release();
    expect(await screen.findByText(/Test sent to/)).toBeInTheDocument();
    await waitFor(() => expect(sendTest()).toBeEnabled());
  });

  it("does not save the settings when the test address is nonsense", async () => {
    const { user } = await renderSettings();

    await user.clear(testAddress());
    await user.type(testAddress(), "not-an-address");
    await user.click(sendTest());
    await screen.findByText("That is not an email address");

    expect(backend().countOf("save_settings")).toBe(0);
  });
});

// ---------------------------------------------------------------- backups

describe("settings, data and backups", () => {
  it("shows the backup folder and how many copies are kept", async () => {
    await renderSettings();

    expect(field(/^Copy backups to/)).toHaveValue(DEFAULT_SETTINGS.backup_dir);
    expect(field(/^Backups to keep/)).toHaveValue(Number(DEFAULT_SETTINGS.backup_retention));
  });

  it("sends an edited backup folder", async () => {
    const { user } = await renderSettings();

    await user.clear(field(/^Copy backups to/));
    await user.type(field(/^Copy backups to/), "/Volumes/Backup/StayInsured");
    setValue(field(/^Backups to keep/), "30");
    await user.click(save());
    await screen.findByText("Settings saved");

    expect(savedValues()).toMatchObject({
      backup_dir: "/Volumes/Backup/StayInsured",
      backup_retention: "30",
    });
  });

  it("names the file the backup was written to", async () => {
    const { user } = await renderSettings();

    await user.click(button("Back up now"));

    expect(
      await screen.findByText(/Backup written to .*\/backups\/stayinsured-2026-08-14\.db/),
    ).toBeInTheDocument();
    expect(backend().countOf("backup_now")).toBe(1);
  });

  it("holds the backup button busy while the copy is written", async () => {
    const gate = backend().hold("backup_now");
    const { user } = await renderSettings();

    await user.click(button("Back up now"));
    expect(button("Back up now")).toBeDisabled();

    gate.release();
    expect(await screen.findByText(/Backup written to/)).toBeInTheDocument();
  });

  it("reports a backup that could not be written", async () => {
    backend().fail("backup_now", { kind: "internal", message: "The backup folder is missing" });
    const { user } = await renderSettings();

    await user.click(button("Back up now"));

    expect(await screen.findByText("The backup folder is missing")).toBeInTheDocument();
  });

  it("opens the data folder", async () => {
    const { user } = await renderSettings();

    await user.click(button("Open data folder"));

    await waitFor(() => expect(backend().countOf("reveal_data_dir")).toBe(1));
  });

  it("reports a data folder that will not open", async () => {
    backend().fail("reveal_data_dir", { kind: "internal", message: "There is no such folder" });
    const { user } = await renderSettings();

    await swallowingStrayRejections(async () => {
      await user.click(button("Open data folder"));
    });

    expect(screen.getByText("There is no such folder")).toBeInTheDocument();
  });

  it("shows where the data is kept", async () => {
    await renderSettings();

    expect(await screen.findByText(backend().book.session.dataDir)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- security

describe("settings, the master password", () => {
  const fillPassword = async (
    user: ReturnType<typeof renderWithProviders>["user"],
    values: { current: string; replacement: string; confirm: string },
  ) => {
    await user.type(field(/^Current password/), values.current);
    await user.type(field(/^New password/), values.replacement);
    await user.type(field(/^Confirm new/), values.confirm);
  };

  it("keeps the change button off until the three boxes agree", async () => {
    await renderSettings();

    expect(button("Change password")).toBeDisabled();
  });

  it("changes the password and empties the boxes", async () => {
    const { user } = await renderSettings();

    await fillPassword(user, {
      current: CORRECT_PASSWORD,
      replacement: "a-longer-secret",
      confirm: "a-longer-secret",
    });
    await user.click(button("Change password"));

    expect(
      await screen.findByText("Password changed and the database re-encrypted"),
    ).toBeInTheDocument();
    expect(backend().lastCall("change_password")).toEqual({
      current: CORRECT_PASSWORD,
      replacement: "a-longer-secret",
    });
    expect(field(/^Current password/)).toHaveValue("");
    expect(field(/^New password/)).toHaveValue("");
    expect(field(/^Confirm new/)).toHaveValue("");
  });

  it("reports the wrong current password", async () => {
    const { user } = await renderSettings();

    await fillPassword(user, {
      current: "not-the-password",
      replacement: "a-longer-secret",
      confirm: "a-longer-secret",
    });
    await user.click(button("Change password"));

    expect(await screen.findByText("The current password is wrong")).toBeInTheDocument();
    expect(field(/^Current password/)).toHaveValue("not-the-password");
  });

  it("will not change the password on a mismatched confirmation", async () => {
    const { user } = await renderSettings();

    await fillPassword(user, {
      current: CORRECT_PASSWORD,
      replacement: "a-longer-secret",
      confirm: "a-longer-secrat",
    });

    expect(button("Change password")).toBeDisabled();
    await user.click(button("Change password"));
    await settle();
    expect(backend().countOf("change_password")).toBe(0);
  });

  it("will not change the password to one shorter than eight characters", async () => {
    const { user } = await renderSettings();

    await fillPassword(user, { current: CORRECT_PASSWORD, replacement: "short", confirm: "short" });

    expect(button("Change password")).toBeDisabled();
    await user.click(button("Change password"));
    await settle();
    expect(backend().countOf("change_password")).toBe(0);
  });

  it("says why a mismatched confirmation is refused", async () => {
    const { user } = await renderSettings();

    await fillPassword(user, {
      current: CORRECT_PASSWORD,
      replacement: "a-longer-secret",
      confirm: "a-longer-secrat",
    });

    expect(screen.getByText(/match/i)).toBeInTheDocument();
  });

  it("offers to stop trusting a device the keychain unlocks", async () => {
    await renderSettings();

    expect(
      screen.getByText("This device unlocks automatically using the system keychain."),
    ).toBeInTheDocument();
    expect(button("Stop trusting this device")).toBeInTheDocument();
  });

  it("says nothing about the keychain on a device it does not unlock", async () => {
    backend().book.session.canUseKeychain = false;
    await renderSettings();

    expect(screen.queryByRole("button", { name: "Stop trusting this device" })).not.toBeInTheDocument();
  });

  it("forgets the device and stops offering to", async () => {
    const { user } = await renderSettings();

    await user.click(button("Stop trusting this device"));

    expect(
      await screen.findByText("This device will ask for the password next time"),
    ).toBeInTheDocument();
    expect(backend().countOf("forget_device")).toBe(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop trusting this device" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("reports a device that will not be forgotten", async () => {
    backend().fail("forget_device", { kind: "internal", message: "The keychain is locked" });
    const { user } = await renderSettings();

    await user.click(button("Stop trusting this device"));

    expect(await screen.findByText("The keychain is locked")).toBeInTheDocument();
    expect(button("Stop trusting this device")).toBeInTheDocument();
  });

  it("claims encryption only from a core that encrypts", async () => {
    await renderSettings();

    expect(screen.getByText(/AES-256 encrypted database/)).toBeInTheDocument();
  });

  // The Electron edition for Windows 7 shares this screen over a plain SQLite
  // file. Left as it is, the section would tell an operator their data was safe on
  // a stolen laptop when it is readable by anyone holding the file.
  it("warns instead when the core leaves the file readable", async () => {
    backend().book.session.encrypted = false;
    const { user } = await renderSettings();

    expect(screen.getByText(/the database file itself is not encrypted/)).toBeInTheDocument();
    expect(screen.queryByText(/AES-256/)).not.toBeInTheDocument();

    await fillPassword(user, {
      current: CORRECT_PASSWORD,
      replacement: "a-longer-secret",
      confirm: "a-longer-secret",
    });
    await user.click(button("Change password"));

    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- about

describe("settings, about", () => {
  const about = () => screen.getByText(/schema v/, { selector: "span" });

  it("names the version and the schema behind it", async () => {
    tauriApp.getVersion.mockResolvedValue("1.2.3");
    await renderSettings();

    await waitFor(() => expect(about()).toHaveTextContent("StayInsured 1.2.3"));
    expect(about()).toHaveTextContent("schema v3");
  });

  it("still describes the app when the version cannot be read", async () => {
    tauriApp.getVersion.mockRejectedValue(new Error("No version here"));
    await renderSettings();

    expect(about()).toHaveTextContent("schema v3");
    expect(about()).toHaveTextContent("menu bar");
  });
});
