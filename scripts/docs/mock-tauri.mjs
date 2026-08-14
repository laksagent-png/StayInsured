/**
 * Stands in for the Rust side while the guide screenshots are taken.
 *
 * The real React app runs untouched: it still calls `invoke`, still filters,
 * sorts and paginates through the same code paths. Only the answers come from
 * the demo book instead of an encrypted database, and the clock is frozen so
 * two capture runs produce identical pictures.
 *
 * This function is serialised into the page before any app code runs, so it
 * cannot reference anything outside its own body.
 */
export function installTauriMock({ fixtures, scenario = {} }) {
  const NativeDate = Date;
  const frozen = fixtures.frozenNow;

  class FrozenDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(frozen);
      else super(...args);
    }
    static now() {
      return frozen;
    }
  }
  window.Date = FrozenDate;

  const clients = fixtures.clients.map((row) => ({ ...row }));
  const policies = fixtures.policies.map((row) => ({ ...row }));
  const insurers = fixtures.insurers.map((row) => ({ ...row }));
  const products = fixtures.products.map((row) => ({ ...row }));
  const members = fixtures.members.map((row) => ({ ...row }));
  const settings = { ...fixtures.settings };
  const session = { ...fixtures.session, ...(scenario.session ?? {}) };

  const empty = scenario.empty === true;
  const visibleClients = empty ? [] : clients;
  const visiblePolicies = empty ? [] : policies;

  const lower = (value) => String(value ?? "").toLowerCase();
  const page = (rows, filter) => {
    const size = filter.pageSize ?? 25;
    const number = filter.page ?? 1;
    return {
      rows: rows.slice((number - 1) * size, number * size),
      total: rows.length,
      page: number,
      pageSize: size,
    };
  };

  function filterPolicies(filter = {}) {
    let rows = visiblePolicies.slice();

    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [row.policyNumber, row.clientName, row.vehicleNumber, row.clientCode].some((value) =>
          lower(value).includes(needle),
        ),
      );
    }
    if (filter.clientId) rows = rows.filter((row) => row.clientId === filter.clientId);
    if (filter.insurerId) rows = rows.filter((row) => row.insurerId === filter.insurerId);
    if (filter.productId) rows = rows.filter((row) => row.productId === filter.productId);
    if (filter.categories?.length) rows = rows.filter((row) => filter.categories.includes(row.category));
    if (filter.statuses?.length) rows = rows.filter((row) => filter.statuses.includes(row.status));
    if (filter.city) rows = rows.filter((row) => row.clientCity === filter.city);
    if (filter.expiryFrom) rows = rows.filter((row) => row.expiryDate >= filter.expiryFrom);
    if (filter.expiryTo) rows = rows.filter((row) => row.expiryDate <= filter.expiryTo);
    if (filter.minPremium != null) rows = rows.filter((row) => (row.premiumAmount ?? 0) >= filter.minPremium);
    if (filter.maxPremium != null) rows = rows.filter((row) => (row.premiumAmount ?? 0) <= filter.maxPremium);
    if (filter.expiringWithinDays != null) {
      rows = rows.filter((row) => row.daysToExpiry >= 0 && row.daysToExpiry <= filter.expiringWithinDays);
    }
    if (filter.unrenewedOnly) {
      rows = rows.filter((row) => !row.isRenewed && row.status !== "cancelled" && row.daysToExpiry < 0);
    }
    if (filter.latestOnly) {
      const best = new Map();
      for (const row of rows) {
        const current = best.get(row.chainId);
        if (!current || row.policyYear > current.policyYear) best.set(row.chainId, row);
      }
      rows = Array.from(best.values());
    }

    const keys = {
      expiry: (row) => row.expiryDate,
      client: (row) => lower(row.clientName),
      policyNumber: (row) => lower(row.policyNumber),
      category: (row) => row.category,
      premium: (row) => row.premiumAmount ?? 0,
    };
    const key = keys[filter.sort ?? "expiry"] ?? keys.expiry;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return page(rows, filter);
  }

  function filterClients(filter = {}) {
    let rows = visibleClients.slice();

    if (!filter.includeArchived) rows = rows.filter((row) => !row.isArchived);
    if (filter.missingEmail) rows = rows.filter((row) => !row.email);
    if (filter.city) rows = rows.filter((row) => row.city === filter.city);
    if (filter.category) {
      rows = rows.filter((row) =>
        visiblePolicies.some((policy) => policy.clientId === row.id && policy.category === filter.category),
      );
    }
    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [row.fullName, row.phone, row.email, row.clientCode, row.pan].some((value) =>
          lower(value).includes(needle),
        ),
      );
    }

    const keys = {
      name: (row) => lower(row.fullName),
      policies: (row) => row.activePolicies,
      nextExpiry: (row) => row.nextExpiry ?? "9999-12-31",
    };
    const key = keys[filter.sort ?? "name"] ?? keys.name;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return page(rows, filter);
  }

  const emptyDashboard = {
    totalClients: 0,
    activeClients: 0,
    activePolicies: 0,
    expiringThisWeek: 0,
    expiringThisMonth: 0,
    expiredUnrenewed: 0,
    premiumUnderManagement: 0,
    commissionExpected: 0,
    clientsWithoutEmail: 0,
    buckets: [],
    byCategory: [],
    upcoming: [],
    recentlyLapsed: [],
  };

  const categoryLabels = {
    health: "Health",
    life: "Life",
    motor: "Motor",
    travel: "Travel / International",
    home: "Home",
    personal_accident: "Personal Accident",
    critical_illness: "Critical Illness",
    other: "Other",
  };

  const handlers = {
    session_state: () => session,
    setup: () => ({ ...session, initialised: true, unlocked: true }),
    unlock: () => ({ ...session, unlocked: true }),
    unlock_with_keychain: () => ({ ...session, unlocked: true }),
    lock: () => ({ ...session, unlocked: false }),
    forget_device: () => ({ ...session, canUseKeychain: false }),
    change_password: () => null,

    load_dashboard: () => (empty ? emptyDashboard : fixtures.dashboard),
    category_options: () =>
      fixtures.categoryOrder.map((key, index) => ({
        id: index,
        label: categoryLabels[key],
        secondary: key,
      })),
    client_cities: () =>
      Array.from(new Set(visibleClients.map((row) => row.city).filter(Boolean))).sort(),

    list_clients: ({ filter }) => filterClients(filter),
    get_client: ({ id }) => clients.find((row) => row.id === id) ?? clients[0],
    create_client: () => 99,
    update_client: () => null,
    set_client_archived: () => null,
    delete_client: () => null,
    next_client_code: () => "CL-0009",

    list_members: ({ clientId }) => members.filter((row) => row.clientId === clientId),
    create_member: () => 99,
    update_member: () => null,
    delete_member: () => null,

    list_insurers: ({ includeInactive }) =>
      insurers.filter((row) => includeInactive || row.isActive),
    insurer_options: () =>
      insurers.map((row) => ({ id: row.id, label: row.name, secondary: row.shortCode })),
    create_insurer: () => 99,
    update_insurer: () => null,
    delete_insurer: () => null,
    list_products: ({ insurerId, includeInactive }) =>
      products.filter(
        (row) => (!insurerId || row.insurerId === insurerId) && (includeInactive || row.isActive),
      ),
    create_product: () => 99,
    update_product: () => null,
    delete_product: () => null,

    list_policies: ({ filter }) => filterPolicies(filter),
    get_policy: ({ id }) => policies.find((row) => row.id === id),
    policy_chain: ({ id }) => {
      const policy = policies.find((row) => row.id === id);
      if (!policy) return [];
      return policies
        .filter((row) => row.chainId === policy.chainId)
        .sort((a, b) => a.policyYear - b.policyYear);
    },
    policy_member_ids: ({ id }) => {
      const policy = policies.find((row) => row.id === id);
      if (!policy) return [];
      return members.filter((row) => row.clientId === policy.clientId).map((row) => row.id);
    },
    create_policy: () => 99,
    update_policy: () => null,
    renew_policy: () => 99,
    set_policy_status: () => null,
    delete_policy: () => null,
    refresh_statuses: () => visiblePolicies.length,

    import_fields: () => fixtures.importFields,
    preview_import: () => fixtures.importPreview,
    run_import: ({ options }) => (options.dryRun ? fixtures.dryRunReport : fixtures.finalReport),
    write_import_template: ({ path }) => path,
    export_policies: ({ filter }) => filterPolicies({ ...filter, pageSize: 10_000 }).total,
    export_clients: ({ filter }) => filterClients({ ...filter, pageSize: 10_000 }).total,

    get_settings: () => settings,
    save_settings: ({ values }) => {
      Object.assign(settings, values);
      return null;
    },
    backup_now: () => `${session.dataDir}/backups/stayinsured-${fixtures.today}.db`,
    reveal_data_dir: () => null,

    "plugin:dialog|open": () => "/Users/you/Documents/book-2026.xlsx",
    "plugin:dialog|save": () => "/Users/you/Documents/stayinsured-export.xlsx",
    "plugin:dialog|message": () => null,
    "plugin:autostart|is_enabled": () => true,
    "plugin:autostart|enable": () => null,
    "plugin:autostart|disable": () => null,
    "plugin:opener|open_url": () => null,
    "plugin:opener|open_path": () => null,
    "plugin:opener|reveal_item_in_dir": () => null,
  };

  window.__DOCS_PENDING__ = 0;
  window.__DOCS_SETTLED_AT__ = 0;

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    plugins: {},
    transformCallback: (callback) => {
      const id = Math.floor(Math.random() * 1_000_000);
      window[`_${id}`] = callback;
      return id;
    },
    unregisterCallback: () => {},
    convertFileSrc: (path) => path,
    invoke: async (command, args = {}) => {
      // The capture waits on these counters: a screen photographed while a
      // panel is still filling in looks different on the next run.
      window.__DOCS_PENDING__ += 1;
      try {
        const handler = handlers[command];
        if (!handler) {
          if (command.startsWith("plugin:")) return null;
          throw { kind: "internal", message: `No demo answer for "${command}"` };
        }
        return handler(args ?? {});
      } finally {
        window.__DOCS_PENDING__ -= 1;
        if (window.__DOCS_PENDING__ === 0) window.__DOCS_SETTLED_AT__ = performance.now();
      }
    },
  };
}
