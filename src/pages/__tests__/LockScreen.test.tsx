/**
 * The one screen every session starts at: creating the book on first run,
 * opening it with a password, and the trusted-device keychain path that opens
 * it before anyone types anything.
 */

import { describe, expect, it } from "vitest";

import { CORRECT_PASSWORD, backend, renderWithProviders, screen, waitFor } from "@/test";
import type { SessionState } from "@/lib/types";
import { LockScreen } from "@/pages/LockScreen";

/** A book that exists and is closed, which is what the screen usually sees. */
function closed(over: Partial<SessionState> = {}): SessionState {
  return {
    initialised: true,
    unlocked: false,
    canUseKeychain: false,
    encrypted: true,
    schemaVersion: 3,
    dataDir: "/Users/you/Library/Application Support/com.stayinsured.app",
    ...over,
  };
}

const passwordBox = () => screen.getByLabelText(/^Password/);
const unlockButton = () => screen.getByRole("button", { name: /^Unlock$/ });

describe("first run", () => {
  it("asks for an agency name and the password twice", async () => {
    renderWithProviders(<LockScreen session={closed({ initialised: false })} />);

    expect(await screen.findByText("Set up your practice")).toBeInTheDocument();
    expect(screen.getByText(/cannot be recovered/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Agency name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm password/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create encrypted database/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /saved key/ })).not.toBeInTheDocument();
  });

  it("refuses a password shorter than eight characters before asking the core", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed({ initialised: false })} />);

    await user.type(passwordBox(), "short12");
    await user.type(screen.getByLabelText(/Confirm password/), "short12");
    await user.click(screen.getByRole("button", { name: /Create encrypted database/ }));

    expect(await screen.findByText("Use a password of at least 8 characters")).toBeInTheDocument();
    expect(backend().countOf("setup")).toBe(0);
  });

  it("refuses two passwords that do not match", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed({ initialised: false })} />);

    await user.type(passwordBox(), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-passward");
    await user.click(screen.getByRole("button", { name: /Create encrypted database/ }));

    expect(await screen.findByText("The two passwords do not match")).toBeInTheDocument();
    expect(backend().countOf("setup")).toBe(0);
  });

  it("creates the book with the agency name and the trust choice", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed({ initialised: false })} />);

    await user.type(screen.getByLabelText(/Agency name/), "Sharma Insurance Services");
    await user.type(passwordBox(), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-password");
    await user.click(screen.getByRole("checkbox", { name: /Trust this device/ }));
    await user.click(screen.getByRole("button", { name: /Create encrypted database/ }));

    await waitFor(() => {
      expect(backend().lastCall("setup")).toEqual({
        password: "a-long-enough-password",
        displayName: "Sharma Insurance Services",
        remember: true,
      });
    });
    expect(await screen.findByText("Your encrypted database is ready")).toBeInTheDocument();
  });

  it("holds the button shut while the database is being built", async () => {
    const gate = backend().hold("setup");
    const { user } = renderWithProviders(<LockScreen session={closed({ initialised: false })} />);
    const create = () => screen.getByRole("button", { name: /Create encrypted database/ });

    await user.type(passwordBox(), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-password");
    await user.click(create());

    await waitFor(() => expect(create()).toBeDisabled());
    await user.click(create());
    expect(backend().countOf("setup")).toBe(1);

    gate.release();
    expect(await screen.findByText("Your encrypted database is ready")).toBeInTheDocument();
  });

  it("shows why the core refused to create the book", async () => {
    backend().fail("setup", {
      kind: "already_initialised",
      message: "This machine already has a book",
    });
    const { user } = renderWithProviders(<LockScreen session={closed({ initialised: false })} />);

    await user.type(passwordBox(), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-password");
    await user.click(screen.getByRole("button", { name: /Create encrypted database/ }));

    expect(await screen.findByText("This machine already has a book")).toBeInTheDocument();
  });
});

// The screens are shared with the Electron edition for Windows 7, which opens a
// plain SQLite file. Someone told their data is encrypted when it is not may leave
// a laptop or a backup somewhere they otherwise would not, so a core that cannot
// encrypt says so and this screen stops claiming it.
describe("a core that does not encrypt", () => {
  it("promises a locked app rather than an encrypted file", async () => {
    renderWithProviders(<LockScreen session={closed({ initialised: false, encrypted: false })} />);

    expect(await screen.findByText(/does not encrypt the database file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create client book/ })).toBeInTheDocument();
    expect(screen.queryByText(/cannot be recovered/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Create encrypted database/ }),
    ).not.toBeInTheDocument();
  });

  it("does not call the finished book encrypted", async () => {
    const { user } = renderWithProviders(
      <LockScreen session={closed({ initialised: false, encrypted: false })} />,
    );

    await user.type(passwordBox(), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-password");
    await user.click(screen.getByRole("button", { name: /Create client book/ }));

    expect(await screen.findByText("Your client book is ready")).toBeInTheDocument();
    expect(screen.queryByText(/encrypted/)).not.toBeInTheDocument();
  });
});

describe("unlocking", () => {
  it("greets a returning operator with only a password", async () => {
    renderWithProviders(<LockScreen session={closed()} />);

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Agency name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Confirm password/)).not.toBeInTheDocument();
    expect(unlockButton()).toBeInTheDocument();
  });

  it("sends the password and the trust choice to the core", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.type(passwordBox(), CORRECT_PASSWORD);
    await user.click(screen.getByRole("checkbox", { name: /Trust this device/ }));
    await user.click(unlockButton());

    await waitFor(() => {
      expect(backend().lastCall("unlock")).toEqual({
        password: CORRECT_PASSWORD,
        remember: true,
      });
    });
    expect(screen.queryByText(/does not open this book/)).not.toBeInTheDocument();
  });

  it("opens the book when the Enter key is used instead of the button", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.type(passwordBox(), `${CORRECT_PASSWORD}{Enter}`);

    await waitFor(() => {
      expect(backend().lastCall("unlock")).toMatchObject({ password: CORRECT_PASSWORD });
    });
  });

  it("says the password is wrong in the core's own words", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.type(passwordBox(), "not-the-password");
    await user.click(unlockButton());

    expect(await screen.findByText("That password does not open this book")).toBeInTheDocument();
  });

  it("clears the wrong-password message when the right one is tried", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.type(passwordBox(), "not-the-password");
    await user.click(unlockButton());
    await screen.findByText("That password does not open this book");

    await user.clear(passwordBox());
    await user.type(passwordBox(), CORRECT_PASSWORD);
    await user.click(unlockButton());

    await waitFor(() => {
      expect(screen.queryByText("That password does not open this book")).not.toBeInTheDocument();
    });
    expect(backend().lastCall("unlock")).toMatchObject({ password: CORRECT_PASSWORD });
  });

  it("does not ask the core about an empty password", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.click(unlockButton());

    expect(backend().countOf("unlock")).toBe(0);
  });

  it("holds the button shut while the core is working, so one press is one attempt", async () => {
    const gate = backend().hold("unlock");
    const { user } = renderWithProviders(<LockScreen session={closed()} />);

    await user.type(passwordBox(), CORRECT_PASSWORD);
    await user.click(unlockButton());

    await waitFor(() => expect(unlockButton()).toBeDisabled());
    await user.click(unlockButton());
    expect(backend().countOf("unlock")).toBe(1);

    gate.release();
    await waitFor(() => expect(unlockButton()).toBeEnabled());
  });
});

describe("a trusted device", () => {
  it("opens the book from the keychain as the app starts", async () => {
    renderWithProviders(<LockScreen session={closed({ canUseKeychain: true })} />);

    await waitFor(() => expect(backend().countOf("unlock_with_keychain")).toBe(1));
    expect(backend().countOf("unlock")).toBe(0);
  });

  it("falls back to the password when the saved key has gone", async () => {
    backend().book.session.canUseKeychain = false;
    const { user } = renderWithProviders(<LockScreen session={closed({ canUseKeychain: true })} />);

    expect(await screen.findByText("This device is not remembered")).toBeInTheDocument();

    await user.type(passwordBox(), CORRECT_PASSWORD);
    await user.click(unlockButton());

    await waitFor(() => {
      expect(backend().lastCall("unlock")).toMatchObject({ password: CORRECT_PASSWORD });
    });
  });

  it("offers the saved key as a button to press", async () => {
    const { user } = renderWithProviders(<LockScreen session={closed({ canUseKeychain: true })} />);

    await waitFor(() => expect(backend().countOf("unlock_with_keychain")).toBe(1));
    await user.click(screen.getByRole("button", { name: /Use the saved key on this device/ }));

    await waitFor(() => expect(backend().countOf("unlock_with_keychain")).toBe(2));
  });

  it("stays closed after a deliberate lock, rather than undoing it", async () => {
    renderWithProviders(<LockScreen session={closed({ canUseKeychain: true })} autoUnlock={false} />);

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    await waitFor(() => expect(unlockButton()).toBeEnabled());
    expect(backend().countOf("unlock_with_keychain")).toBe(0);
  });

  it("keeps the saved-key button out of first run, where there is no key yet", async () => {
    renderWithProviders(
      <LockScreen session={closed({ initialised: false, canUseKeychain: true })} />,
    );

    expect(await screen.findByText("Set up your practice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /saved key/ })).not.toBeInTheDocument();
    expect(backend().countOf("unlock_with_keychain")).toBe(0);
  });

  it("lets the password be used while the keychain is still thinking", async () => {
    backend().hold("unlock_with_keychain");
    const { user } = renderWithProviders(<LockScreen session={closed({ canUseKeychain: true })} />);

    await user.type(passwordBox(), CORRECT_PASSWORD);
    await user.click(unlockButton());

    await waitFor(() => {
      expect(backend().lastCall("unlock")).toMatchObject({ password: CORRECT_PASSWORD });
    });
  });
});
