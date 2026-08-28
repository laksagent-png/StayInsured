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
  const groups = fixtures.groups.map((row) => ({ ...row }));
  const relations = fixtures.relations.map((row) => ({ ...row }));
  const cover = fixtures.cover.map((row) => ({ ...row }));
  const documents = fixtures.documents.map((row) => ({ ...row }));
  const settings = { ...fixtures.settings };
  const session = { ...fixtures.session, ...(scenario.session ?? {}) };

  const templates = fixtures.templates.map((row) => ({ ...row }));
  const rules = fixtures.reminderRules.map((row) => ({ ...row }));

  const empty = scenario.empty === true;
  const visibleClients = empty ? [] : clients;
  const visiblePolicies = empty ? [] : policies;
  const visibleGroups = empty ? [] : groups;

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
    // Browsing shows the policyholders; searching reaches the whole book.
    if (!filter.includeFamily && !filter.search) rows = rows.filter((row) => !row.isDependent);
    if (filter.missingEmail) rows = rows.filter((row) => !row.email);
    if (filter.kind) rows = rows.filter((row) => row.kind === filter.kind);
    if (filter.groupId != null) rows = rows.filter((row) => row.groupId === filter.groupId);
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
      group: (row) => lower(row.groupName ?? "zzzz"),
    };
    const key = keys[filter.sort ?? "name"] ?? keys.name;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return page(rows, filter);
  }

  function filterGroups(filter = {}) {
    let rows = visibleGroups.slice();

    if (!filter.includeArchived) rows = rows.filter((row) => !row.isArchived);
    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [row.name, row.groupCode, row.headName].some((value) => lower(value).includes(needle)),
      );
    }

    const keys = {
      name: (row) => lower(row.name),
      members: (row) => row.members,
      policies: (row) => row.activePolicies,
      premium: (row) => row.premiumUnderManagement,
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

  const emptyOverview = {
    ...fixtures.reminderOverview,
    enabled: false,
    smtpConfigured: false,
    smtpPasswordSet: false,
    activeRules: 0,
    dueToday: 0,
    queued: 0,
    failed: 0,
    sentToday: 0,
    lastSweep: null,
    clientsOptedOut: 0,
    expiringWithoutEmail: 0,
  };

  // The template preview renders against a real policy, exactly as the Rust
  // side does, so the picture in the guide shows a filled-in message.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const showDate = (iso) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    return `${d} ${months[m - 1]} ${y}`;
  };
  const samplePolicy = policies[0];
  const sample = {
    client_name: samplePolicy.clientName,
    client_code: samplePolicy.clientCode,
    client_email: samplePolicy.clientEmail,
    client_phone: samplePolicy.clientPhone,
    policy_number: samplePolicy.policyNumber,
    category_label: categoryLabels[samplePolicy.category],
    insurer_name: samplePolicy.insurerName,
    product_name: samplePolicy.productName ?? "",
    start_date: showDate(samplePolicy.startDate),
    expiry_date: showDate(samplePolicy.expiryDate),
    days_to_expiry: String(samplePolicy.daysToExpiry),
    policy_year: String(samplePolicy.policyYear),
    sum_insured: `₹${(samplePolicy.sumInsured ?? 0).toLocaleString("en-IN")}`,
    premium_amount: `₹${(samplePolicy.premiumAmount ?? 0).toLocaleString("en-IN")}`,
    nominee_name: samplePolicy.nomineeName ?? "",
    vehicle_number: samplePolicy.vehicleNumber ?? "",
    provider_name: settings.provider_name,
    provider_email: settings.provider_email,
    provider_phone: settings.provider_phone,
    provider_address: settings.provider_address,
    today: showDate(fixtures.today),
    expiring_count: "12",
    digest_table: "<table><tr><td>Ananya Sharma</td><td>Expires in 7 days</td></tr></table>",
  };

  const fill = (text) =>
    String(text ?? "").replace(/\{\{\{?\s*([a-z_]+)\s*\}?\}\}/g, (_, name) => sample[name] ?? "");

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
    delete_client: ({ id }) => [id],
    next_client_code: () => "CL-00014",

    // A group is a row, so it lists, opens, archives and deletes as itself.
    // Deleting one releases the clients filed in it rather than taking them.
    list_groups: ({ filter }) => filterGroups(filter),
    get_group: ({ id }) => groups.find((row) => row.id === id) ?? groups[0],
    next_group_code: () => "GR-00002",
    create_group: () => 99,
    update_group: () => null,
    set_group_archived: () => 2,
    delete_group: () => 2,
    set_client_group: () => null,

    set_family_archived: () => 0,

    // A family is edges between clients, read from either end: the word is the
    // one that was recorded, and `outgoing` says which way round it is stored.
    list_relatives: ({ clientId }) =>
      relations
        .filter((edge) => edge.clientId === clientId || edge.relatedClientId === clientId)
        .map((edge) => {
          const outgoing = edge.clientId === clientId;
          const other = clients.find(
            (row) => row.id === (outgoing ? edge.relatedClientId : edge.clientId),
          );
          return {
            clientId: other.id,
            clientCode: other.clientCode,
            fullName: other.fullName,
            relationship: edge.relationship,
            outgoing,
            dateOfBirth: other.dateOfBirth,
            gender: other.gender,
            isArchived: other.isArchived,
            ownPolicies: other.totalPolicies,
            notes: other.notes,
          };
        }),
    link_clients: () => null,
    unlink_clients: () => null,

    list_documents: ({ clientId }) =>
      documents
        .filter((row) => row.clientId === clientId)
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)),
    attach_document: () => 99,
    document_content: () => new ArrayBuffer(0),
    save_document_copy: () => null,
    delete_document: () => null,

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
    policy_insured_ids: ({ id }) =>
      cover.filter((row) => row.policyId === id).map((row) => row.clientId),
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

    list_templates: () => templates,
    create_template: () => 99,
    update_template: () => null,
    delete_template: () => null,
    template_placeholders: () => fixtures.placeholders,
    preview_template: ({ subject, bodyHtml }) => ({
      subject: fill(subject),
      html: fill(bodyHtml),
      text: fill(bodyHtml)
        .replace(/<[^>]+>/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
      unknownPlaceholders: (`${subject} ${bodyHtml}`.match(/\{\{\{?\s*([a-z_]+)\s*\}?\}\}/g) ?? [])
        .map((token) => token.replace(/[{}]/g, "").trim())
        .filter((name, index, all) => all.indexOf(name) === index)
        .filter((name) => !sample[name]),
      samplePolicy: `${samplePolicy.policyNumber} · ${samplePolicy.clientName}`,
    }),

    list_rules: () => rules,
    create_rule: () => 99,
    update_rule: () => null,
    delete_rule: () => null,

    reminder_overview: () => (empty ? emptyOverview : fixtures.reminderOverview),
    plan_reminders: () => (empty ? [] : fixtures.plannedReminders),
    run_reminders: ({ dryRun }) => ({
      dryRun: dryRun ?? false,
      queued: fixtures.plannedReminders.length,
      sent: dryRun ? 0 : fixtures.plannedReminders.length,
      failed: 0,
      skipped: 0,
      heldByCap: 0,
      desktopAlerts: 1,
      digestSent: !dryRun,
      issues: [],
    }),
    list_notifications: ({ filter = {} }) => {
      let rows = empty ? [] : fixtures.notifications.slice();
      if (filter.statuses?.length) {
        rows = rows.filter((row) => filter.statuses.includes(row.status));
      }
      return page(rows, filter);
    },
    retry_notification: () => null,
    cancel_notification: () => null,
    set_smtp_password: () => null,
    send_test_email: () => null,

    get_settings: () => settings,
    save_settings: ({ values }) => {
      Object.assign(settings, values);
      return null;
    },
    backup_now: () => `${session.dataDir}/backups/stayinsured-${fixtures.today}.db`,
    reveal_data_dir: () => null,

    "plugin:dialog|open": ({ options }) =>
      (options?.filters?.[0]?.extensions ?? []).includes("pdf")
        ? "/Users/you/Documents/star-health-renewal-2026.pdf"
        : "/Users/you/Documents/book-2026.xlsx",
    "plugin:dialog|save": () => "/Users/you/Documents/stayinsured-export.xlsx",
    "plugin:dialog|message": () => null,
    "plugin:autostart|is_enabled": () => true,
    "plugin:autostart|enable": () => null,
    "plugin:autostart|disable": () => null,
    "plugin:opener|open_url": () => null,
    "plugin:opener|open_path": () => null,
    "plugin:opener|reveal_item_in_dir": () => null,

    // The demo book reports a fixed version so the pictures do not have to be
    // retaken every release, and hides the window so the launch update check
    // stops before it can put a dialog in front of a screenshot.
    "plugin:app|version": () => fixtures.appVersion,
    "plugin:window|is_visible": () => false,
  };

  window.__DOCS_PENDING__ = 0;
  window.__DOCS_SETTLED_AT__ = 0;

  // Screens that listen for a background sweep unregister on unmount, and the
  // event plugin reaches for this directly rather than through `invoke`.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

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
