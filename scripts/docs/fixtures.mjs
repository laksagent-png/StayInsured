/**
 * Demo book used to photograph the app for the how-to guide.
 *
 * Every number the guide shows is derived from this one dataset, and the clock
 * is frozen to TODAY, so re-running the capture produces the same pictures.
 */

export const TODAY = "2026-08-14";
export const FROZEN_NOW = Date.UTC(2026, 7, 14, 4, 30, 0); // 10:00 IST

const DAY = 86_400_000;

function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 7, 14)) / DAY);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Matches how the app writes a date on screen: 21 Aug 2026. */
function formatDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

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

const insurers = [
  { id: 1, name: "Star Health", shortCode: "STAR", claimHelpline: "1800 425 2255", supportEmail: "support@starhealth.in", website: "https://www.starhealth.in" },
  { id: 2, name: "HDFC ERGO", shortCode: "HDFCERGO", claimHelpline: "022 6234 6234", supportEmail: "care@hdfcergo.com", website: "https://www.hdfcergo.com" },
  { id: 3, name: "ICICI Lombard", shortCode: "ILOM", claimHelpline: "1800 2666", supportEmail: "customersupport@icicilombard.com", website: "https://www.icicilombard.com" },
  { id: 4, name: "LIC of India", shortCode: "LIC", claimHelpline: "022 6827 6827", supportEmail: "co_crmgrv@licindia.com", website: "https://licindia.in" },
  { id: 5, name: "Niva Bupa", shortCode: "NIVA", claimHelpline: "1860 500 8888", supportEmail: "customercare@nivabupa.com", website: "https://www.nivabupa.com" },
  { id: 6, name: "Tata AIG", shortCode: "TATAAIG", claimHelpline: "1800 266 7780", supportEmail: "customersupport@tataaig.com", website: "https://www.tataaig.com" },
  { id: 7, name: "Bajaj Allianz", shortCode: "BAGIC", claimHelpline: "1800 209 5858", supportEmail: "bagichelp@bajajallianz.co.in", website: "https://www.bajajallianz.com" },
  { id: 8, name: "New India Assurance", shortCode: "NIA", claimHelpline: "1800 209 1415", supportEmail: "tech.support@newindia.co.in", website: "https://www.newindia.co.in" },
].map((row) => ({ ...row, notes: null, isActive: true, policyCount: 0 }));

const products = [
  { id: 1, insurerId: 1, name: "Family Health Optima", category: "health", code: "SH-FHO" },
  { id: 2, insurerId: 2, name: "Optima Restore", category: "health", code: "HE-OR" },
  { id: 3, insurerId: 4, name: "Jeevan Anand", category: "life", code: "LIC-915" },
  { id: 4, insurerId: 3, name: "Motor Secure Comprehensive", category: "motor", code: "IL-MSC" },
  { id: 5, insurerId: 6, name: "Travel Guard", category: "travel", code: "TA-TG" },
  { id: 6, insurerId: 5, name: "ReAssure 2.0", category: "health", code: "NB-RA2" },
  { id: 7, insurerId: 2, name: "Personal Accident Shield", category: "personal_accident", code: "HE-PAS" },
].map((row) => ({
  ...row,
  insurerName: insurers.find((i) => i.id === row.insurerId).name,
  notes: null,
  isActive: true,
  policyCount: 0,
}));

const clients = [
  { id: 1, clientCode: "CL-00001", fullName: "Rohit Sharma", email: "rohit.sharma@example.com", phone: "98765 43210", city: "Pune", state: "Maharashtra", pincode: "411045", occupation: "Software engineer", pan: "ABCPS1234F", dateOfBirth: "1986-04-12", gender: "male", addressLine1: "Flat 402, Green Meadows", addressLine2: "Baner Road", notes: "Prefers a call before renewal. Reviewing a top-up on the floater." },
  { id: 2, clientCode: "CL-00002", fullName: "Anita Desai", email: "anita.desai@example.com", phone: "98200 11223", city: "Pune", state: "Maharashtra", pincode: "411001", occupation: "Architect", pan: "AKDPD9911K", dateOfBirth: "1979-11-02", gender: "female", addressLine1: "12 Sunder Villa", addressLine2: "Koregaon Park" },
  { id: 3, clientCode: "CL-00003", fullName: "Vikram Patel", email: null, phone: "99250 44556", city: "Ahmedabad", state: "Gujarat", pincode: "380015", occupation: "Trader", pan: "AWXPP4432M", dateOfBirth: "1974-01-23", gender: "male", addressLine1: "Shop 7, Satellite Plaza" },
  { id: 4, clientCode: "CL-00004", fullName: "Meera Iyer", email: "meera.iyer@example.com", phone: "98450 77889", city: "Bengaluru", state: "Karnataka", pincode: "560038", occupation: "Consultant", pan: "AMFPI7788Q", dateOfBirth: "1990-06-30", gender: "female", addressLine1: "301, Indiranagar Heights" },
  { id: 5, clientCode: "CL-00005", fullName: "Suresh Nair", email: "suresh.nair@example.com", phone: "94470 33221", city: "Kochi", state: "Kerala", pincode: "682016", occupation: "Merchant navy", pan: "ASNPN2211R", dateOfBirth: "1983-09-14", gender: "male", addressLine1: "Panampilly Nagar" },
  { id: 6, clientCode: "CL-00006", fullName: "Priya Menon", email: "priya.menon@example.com", phone: "98400 66554", city: "Chennai", state: "Tamil Nadu", pincode: "600020", occupation: "Doctor", pan: "APMPM6655T", dateOfBirth: "1988-02-08", gender: "female", addressLine1: "18 Adyar Gardens" },
  { id: 7, clientCode: "CL-00007", fullName: "Arjun Reddy", email: "arjun.reddy@example.com", phone: "90000 12345", city: "Hyderabad", state: "Telangana", pincode: "500034", occupation: "Restaurateur", pan: "AARPR1234N", dateOfBirth: "1981-12-19", gender: "male", addressLine1: "Road No. 12, Banjara Hills" },
  { id: 8, clientCode: "CL-00008", fullName: "Kavita Joshi", email: "kavita.joshi@example.com", phone: "97660 98765", city: "Nashik", state: "Maharashtra", pincode: "422005", occupation: "Teacher", pan: "AKJPJ9876L", dateOfBirth: "1992-07-25", gender: "female", addressLine1: "Sai Residency, College Road", remindersOptedOut: true, notes: "Asked to be contacted by phone only." },
].map((row) => ({
  altPhone: null,
  gstin: null,
  preferredLanguage: "en",
  remindersOptedOut: false,
  notes: null,
  isArchived: false,
  createdAt: "2024-04-08T09:12:00Z",
  updatedAt: "2026-07-28T11:40:00Z",
  addressLine2: null,
  ...row,
}));

const members = [
  { id: 1, clientId: 1, fullName: "Rohit Sharma", relationship: "self", dateOfBirth: "1986-04-12", gender: "male" },
  { id: 2, clientId: 1, fullName: "Sneha Sharma", relationship: "spouse", dateOfBirth: "1988-09-03", gender: "female" },
  { id: 3, clientId: 1, fullName: "Aarav Sharma", relationship: "son", dateOfBirth: "2016-01-19", gender: "male" },
  { id: 4, clientId: 2, fullName: "Anita Desai", relationship: "self", dateOfBirth: "1979-11-02", gender: "female" },
  { id: 5, clientId: 4, fullName: "Meera Iyer", relationship: "self", dateOfBirth: "1990-06-30", gender: "female" },
  { id: 6, clientId: 4, fullName: "Lakshmi Iyer", relationship: "mother", dateOfBirth: "1958-03-11", gender: "female" },
].map((row) => ({ notes: null, ...row }));

const documents = [
  { id: 1, clientId: 1, policyId: 2, policyNumber: "IL/MOT/778211", title: "Registration certificate", fileName: "mh12ab1234-rc.jpg", mimeType: "image/jpeg", sizeBytes: 736_120, uploadedAt: "2025-09-01 11:37:55" },
  { id: 2, clientId: 1, policyId: 1, policyNumber: "SH/2025/0091823", title: "Policy schedule 2025-26", fileName: "star-health-schedule.pdf", mimeType: "application/pdf", sizeBytes: 412_336, uploadedAt: "2025-08-21 09:14:02" },
  { id: 3, clientId: 1, policyId: 1, policyNumber: "SH/2025/0091823", title: "Proposal form, signed", fileName: "proposal-form-signed.pdf", mimeType: "application/pdf", sizeBytes: 1_284_910, uploadedAt: "2025-08-20 16:02:41" },
  { id: 4, clientId: 1, policyId: null, policyNumber: null, title: "PAN card", fileName: "pan-abcps1234f.png", mimeType: "image/png", sizeBytes: 168_442, uploadedAt: "2024-08-19 10:21:08" },
];

const rawPolicies = [
  { id: 1, chainId: "chain-a", policyYear: 2, previousPolicyId: 101, policyNumber: "SH/2025/0091823", clientId: 1, insurerId: 1, productId: 1, category: "health", status: "active", startDate: "2025-08-20", expiryDate: "2026-08-21", sumInsured: 1000000, premiumAmount: 24500, gstAmount: 4410, commissionRate: 12.5, nomineeName: "Sneha Sharma", nomineeRelation: "Spouse", notes: "Floater covering three members." },
  { id: 2, chainId: "chain-b", policyYear: 1, policyNumber: "IL/MOT/778211", clientId: 1, insurerId: 3, productId: 4, category: "motor", status: "active", startDate: "2025-09-01", expiryDate: "2026-08-31", sumInsured: 850000, premiumAmount: 12800, gstAmount: 2304, commissionRate: 10, vehicleNumber: "MH12AB1234" },
  { id: 3, chainId: "chain-c", policyYear: 3, previousPolicyId: 103, policyNumber: "HE/OR/554120", clientId: 2, insurerId: 2, productId: 2, category: "health", status: "active", startDate: "2025-08-18", expiryDate: "2026-08-17", sumInsured: 1500000, premiumAmount: 31200, gstAmount: 5616, commissionRate: 15, nomineeName: "Rahul Desai", nomineeRelation: "Son" },
  { id: 4, chainId: "chain-d", policyYear: 1, policyNumber: "LIC/915/220481", clientId: 2, insurerId: 4, productId: 3, category: "life", status: "active", startDate: "2019-04-01", expiryDate: "2039-03-31", sumInsured: 5000000, premiumAmount: 48000, gstAmount: 2160, commissionRate: 7.5, nomineeName: "Rahul Desai", nomineeRelation: "Son" },
  { id: 5, chainId: "chain-e", policyYear: 1, policyNumber: "NIA/MOT/330912", clientId: 3, insurerId: 8, productId: null, category: "motor", status: "expired", startDate: "2025-08-10", expiryDate: "2026-08-09", sumInsured: 640000, premiumAmount: 9600, gstAmount: 1728, commissionRate: 10, vehicleNumber: "GJ01CD5678" },
  { id: 6, chainId: "chain-f", policyYear: 1, policyNumber: "NB/RA2/119006", clientId: 4, insurerId: 5, productId: 6, category: "health", status: "active", startDate: "2025-08-25", expiryDate: "2026-08-29", sumInsured: 2000000, premiumAmount: 27800, gstAmount: 5004, commissionRate: 12.5, nomineeName: "Lakshmi Iyer", nomineeRelation: "Mother" },
  { id: 7, chainId: "chain-g", policyYear: 1, policyNumber: "TA/TG/908771", clientId: 5, insurerId: 6, productId: 5, category: "travel", status: "active", startDate: "2026-07-01", expiryDate: "2026-09-15", sumInsured: 4200000, premiumAmount: 4200, gstAmount: 756, commissionRate: 15 },
  { id: 8, chainId: "chain-h", policyYear: 2, previousPolicyId: 104, policyNumber: "SH/2025/0112947", clientId: 6, insurerId: 1, productId: 1, category: "health", status: "active", startDate: "2025-09-20", expiryDate: "2026-09-19", sumInsured: 1500000, premiumAmount: 33900, gstAmount: 6102, commissionRate: 12.5 },
  { id: 9, chainId: "chain-i", policyYear: 1, policyNumber: "BA/MOT/641203", clientId: 7, insurerId: 7, productId: null, category: "motor", status: "active", startDate: "2025-10-05", expiryDate: "2026-10-04", sumInsured: 1250000, premiumAmount: 14300, gstAmount: 2574, commissionRate: 10, vehicleNumber: "TS09EF9012" },
  { id: 10, chainId: "chain-j", policyYear: 1, policyNumber: "HE/PAS/700318", clientId: 8, insurerId: 2, productId: 7, category: "personal_accident", status: "active", startDate: "2025-10-12", expiryDate: "2026-10-11", sumInsured: 2500000, premiumAmount: 6400, gstAmount: 1152, commissionRate: 15 },
  { id: 11, chainId: "chain-k", policyYear: 1, policyNumber: "LIC/915/661074", clientId: 4, insurerId: 4, productId: 3, category: "life", status: "active", startDate: "2021-06-15", expiryDate: "2041-06-14", sumInsured: 7500000, premiumAmount: 36000, gstAmount: 1620, commissionRate: 7.5 },
  { id: 12, chainId: "chain-l", policyYear: 1, policyNumber: "SH/2024/0088410", clientId: 3, insurerId: 1, productId: 1, category: "health", status: "expired", startDate: "2025-07-30", expiryDate: "2026-07-29", sumInsured: 500000, premiumAmount: 21500, gstAmount: 3870, commissionRate: 12.5 },
  { id: 13, chainId: "chain-m", policyYear: 1, policyNumber: "IL/MOT/815540", clientId: 6, insurerId: 3, productId: 4, category: "motor", status: "active", startDate: "2025-11-02", expiryDate: "2026-11-01", sumInsured: 980000, premiumAmount: 11200, gstAmount: 2016, commissionRate: 10, vehicleNumber: "TN07GH3456" },

  // Earlier years, kept so the history chains have something to show.
  { id: 101, chainId: "chain-a", policyYear: 1, policyNumber: "SH/2024/0091823", clientId: 1, insurerId: 1, productId: 1, category: "health", status: "renewed", startDate: "2024-08-20", expiryDate: "2025-08-19", sumInsured: 1000000, premiumAmount: 22100, gstAmount: 3978, commissionRate: 12.5, isRenewed: true },
  { id: 102, chainId: "chain-c", policyYear: 1, policyNumber: "HE/OR/331885", clientId: 2, insurerId: 2, productId: 2, category: "health", status: "renewed", startDate: "2023-08-18", expiryDate: "2024-08-17", sumInsured: 1000000, premiumAmount: 26400, gstAmount: 4752, commissionRate: 15, isRenewed: true },
  { id: 103, chainId: "chain-c", policyYear: 2, previousPolicyId: 102, policyNumber: "HE/OR/442903", clientId: 2, insurerId: 2, productId: 2, category: "health", status: "renewed", startDate: "2024-08-18", expiryDate: "2025-08-17", sumInsured: 1500000, premiumAmount: 28800, gstAmount: 5184, commissionRate: 15, isRenewed: true, notes: "Sum insured raised to 15L." },
  { id: 104, chainId: "chain-h", policyYear: 1, policyNumber: "SH/2024/0112947", clientId: 6, insurerId: 1, productId: 1, category: "health", status: "renewed", startDate: "2024-09-20", expiryDate: "2025-09-19", sumInsured: 1000000, premiumAmount: 30400, gstAmount: 5472, commissionRate: 12.5, isRenewed: true },
];

const policies = rawPolicies.map((row) => {
  const client = clients.find((c) => c.id === row.clientId);
  const insurer = insurers.find((i) => i.id === row.insurerId);
  const product = products.find((p) => p.id === row.productId);
  return {
    previousPolicyId: null,
    productId: null,
    sumInsured: null,
    premiumAmount: null,
    gstAmount: null,
    premiumFrequency: "annual",
    paymentMode: "UPI",
    nextDueDate: null,
    commissionRate: null,
    nomineeName: null,
    nomineeRelation: null,
    vehicleNumber: null,
    notes: null,
    isRenewed: false,
    ...row,
    clientCode: client.clientCode,
    clientName: client.fullName,
    clientEmail: client.email,
    clientPhone: client.phone,
    clientCity: client.city,
    remindersOptedOut: client.remindersOptedOut,
    insurerName: insurer.name,
    productName: product ? product.name : null,
    commissionExpected: row.commissionRate && row.premiumAmount
      ? Math.round((row.premiumAmount * row.commissionRate) / 100)
      : null,
    createdAt: `${row.startDate}T06:30:00Z`,
    updatedAt: "2026-08-01T07:15:00Z",
    daysToExpiry: daysUntil(row.expiryDate),
  };
});

for (const insurer of insurers) {
  insurer.policyCount = policies.filter((p) => p.insurerId === insurer.id).length;
}
for (const product of products) {
  product.policyCount = policies.filter((p) => p.productId === product.id).length;
}
for (const client of clients) {
  const own = policies.filter((p) => p.clientId === client.id);
  client.totalPolicies = own.length;
  client.activePolicies = own.filter((p) => p.status === "active").length;
  client.nextExpiry = own
    .filter((p) => p.status === "active")
    .map((p) => p.expiryDate)
    .sort()[0] ?? null;
}

const active = policies.filter((p) => p.status === "active");
const overdue = policies.filter((p) => !p.isRenewed && p.status !== "cancelled" && p.daysToExpiry < 0);
const within = (from, to) => active.filter((p) => p.daysToExpiry >= from && p.daysToExpiry <= to);
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

const categoryOrder = ["health", "life", "motor", "travel", "home", "personal_accident", "critical_illness", "other"];

const dashboard = {
  totalClients: clients.length,
  activeClients: clients.filter((c) => !c.isArchived).length,
  activePolicies: active.length,
  expiringThisWeek: within(0, 7).length,
  expiringThisMonth: within(0, 30).length,
  expiredUnrenewed: overdue.length,
  premiumUnderManagement: sum(active, "premiumAmount"),
  commissionExpected: sum(active, "commissionExpected"),
  clientsWithoutEmail: clients.filter((c) => !c.email).length,
  buckets: [
    { label: "Overdue", rows: overdue },
    { label: "0-7 days", rows: within(0, 7) },
    { label: "8-15 days", rows: within(8, 15) },
    { label: "16-30 days", rows: within(16, 30) },
    { label: "31-60 days", rows: within(31, 60) },
    { label: "61-90 days", rows: within(61, 90) },
  ].map(({ label, rows }) => ({
    label,
    count: rows.length,
    premiumTotal: sum(rows, "premiumAmount"),
  })),
  byCategory: categoryOrder
    .map((category) => {
      const rows = active.filter((p) => p.category === category);
      return {
        category,
        policyCount: rows.length,
        premiumTotal: sum(rows, "premiumAmount"),
        sumInsuredTotal: sum(rows, "sumInsured"),
      };
    })
    .filter((entry) => entry.policyCount > 0),
  upcoming: within(0, 45).sort((a, b) => a.daysToExpiry - b.daysToExpiry),
  recentlyLapsed: overdue.sort((a, b) => b.daysToExpiry - a.daysToExpiry),
};

const importFields = [
  ["fullName", "Client name", "Client", true],
  ["clientCode", "Client code", "Client", false],
  ["email", "Email", "Client", false],
  ["phone", "Mobile", "Client", false],
  ["altPhone", "Alternate phone", "Client", false],
  ["dateOfBirth", "Date of birth", "Client", false],
  ["gender", "Gender", "Client", false],
  ["addressLine1", "Address", "Client", false],
  ["addressLine2", "Address line 2", "Client", false],
  ["city", "City", "Client", false],
  ["state", "State", "Client", false],
  ["pincode", "Pincode", "Client", false],
  ["occupation", "Occupation", "Client", false],
  ["pan", "PAN", "Client", false],
  ["policyNumber", "Policy number", "Policy", true],
  ["insurerName", "Insurer", "Policy", true],
  ["productName", "Plan / product", "Policy", false],
  ["category", "Category", "Policy", false],
  ["startDate", "Start date", "Policy", false],
  ["expiryDate", "Expiry date", "Policy", true],
  ["sumInsured", "Sum insured", "Policy", false],
  ["premiumAmount", "Premium", "Policy", false],
  ["gstAmount", "GST", "Policy", false],
  ["premiumFrequency", "Premium frequency", "Policy", false],
  ["paymentMode", "Payment mode", "Policy", false],
  ["commissionRate", "Commission %", "Policy", false],
  ["commissionExpected", "Commission amount", "Policy", false],
  ["nomineeName", "Nominee", "Policy", false],
  ["nomineeRelation", "Nominee relation", "Policy", false],
  ["vehicleNumber", "Vehicle number", "Policy", false],
  ["memberNames", "Covered members", "Policy", false],
  ["notes", "Notes", "Policy", false],
].map(([key, label, group, required]) => ({ key, label, group, required }));

const importPreview = {
  fileName: "book-2026.xlsx",
  sheetNames: ["Renewals", "Motor", "Notes"],
  sheet: "Renewals",
  headers: ["Customer Name", "Mobile", "Email id", "Policy No", "Insurance Company", "Plan", "Type", "Start", "Valid Till", "Sum Assured", "Premium", "Remarks"],
  sampleRows: [
    ["Rohit Sharma", "98765 43210", "rohit.sharma@example.com", "SH/2025/0091823", "Star Health", "Family Health Optima", "Mediclaim", "20/08/2025", "19/08/2026", "₹10,00,000", "24,500", "Family floater"],
    ["Anita Desai", "98200 11223", "anita.desai@example.com", "HE/OR/554120", "HDFC Ergo", "Optima Restore", "Health", "18/08/2025", "17/08/2026", "₹15,00,000", "31,200", ""],
    ["Vikram Patel", "99250 44556", "", "NIA/MOT/330912", "New India Assurance", "", "Two wheeler", "10/08/2025", "09/08/2026", "₹6,40,000", "9,600", "GJ01CD5678"],
    ["Meera Iyer", "98450 77889", "meera.iyer@example.com", "NB/RA2/119006", "Niva Bupa", "ReAssure 2.0", "Mediclaim", "25/08/2025", "24/08/2026", "₹20,00,000", "27,800", ""],
    ["Suresh Nair", "94470 33221", "suresh.nair@example.com", "TA/TG/908771", "Tata AIG", "Travel Guard", "Overseas", "01/07/2026", "15/09/2026", "$50,000", "4,200", "Schengen trip"],
  ],
  totalRows: 218,
  suggestedMapping: {
    fullName: "Customer Name",
    phone: "Mobile",
    email: "Email id",
    policyNumber: "Policy No",
    insurerName: "Insurance Company",
    productName: "Plan",
    category: "Type",
    startDate: "Start",
    expiryDate: "Valid Till",
    sumInsured: "Sum Assured",
    premiumAmount: "Premium",
    notes: "Remarks",
  },
  unmappedHeaders: [],
};

const dryRunReport = {
  dryRun: true,
  totalRows: 218,
  policiesInserted: 211,
  policiesUpdated: 4,
  clientsCreated: 96,
  clientsUpdated: 12,
  insurersCreated: 2,
  skipped: 1,
  failed: 2,
  issues: [
    { row: 47, column: "Valid Till", value: "31/02/2026", message: "Expiry date is not a real date" },
    { row: 132, column: "Policy No", value: "", message: "Policy number is empty, so the row cannot be identified" },
    { row: 188, column: "Premium", value: "on request", message: "Premium is not a number, imported without an amount" },
  ],
};

const finalReport = {
  ...dryRunReport,
  dryRun: false,
  skipped: 1,
  failed: 2,
};

const settings = {
  provider_name: "Sharma Insurance Services",
  provider_email: "desk@sharmainsurance.in",
  provider_phone: "020 4567 8899",
  provider_address: "204 Rajwada Chambers, FC Road, Pune 411005",
  currency: "INR",
  locale: "en-IN",
  date_format: "dd MMM yyyy",
  expiring_soon_window: "30",
  reminders_enabled: "true",
  reminder_send_time: "09:00",
  daily_send_cap: "400",
  dry_run: "false",
  desktop_alerts: "true",
  digest_enabled: "true",
  smtp_host: "smtp.gmail.com",
  smtp_port: "587",
  smtp_username: "desk@sharmainsurance.in",
  smtp_from_name: "Sharma Insurance Services",
  smtp_from_email: "renewals@sharmainsurance.in",
  smtp_encryption: "starttls",
  backup_dir: "/Users/you/Google Drive/StayInsured",
  backup_retention: "14",
};

// ---------------------------------------------------------------- reminders

const templates = [
  {
    id: 1,
    name: "Policy expiry reminder",
    trigger: "expiry_reminder",
    subject: "Your {{category_label}} policy expires on {{expiry_date}}",
    bodyHtml:
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">' +
      "<p>Dear {{client_name}},</p>" +
      "<p>This is a reminder that your <strong>{{category_label}}</strong> policy with " +
      "<strong>{{insurer_name}}</strong> is due to expire on <strong>{{expiry_date}}</strong>" +
      " — that is {{days_to_expiry}} days from today.</p>" +
      '<table cellpadding="6" style="border-collapse:collapse;margin:16px 0;font-size:14px">' +
      '<tr><td style="color:#6b7280">Policy number</td><td><strong>{{policy_number}}</strong></td></tr>' +
      '<tr><td style="color:#6b7280">Insurer</td><td>{{insurer_name}}</td></tr>' +
      '<tr><td style="color:#6b7280">Sum insured</td><td>{{sum_insured}}</td></tr>' +
      '<tr><td style="color:#6b7280">Premium</td><td>{{premium_amount}}</td></tr>' +
      "</table>" +
      "<p>To keep your cover running without a break, please renew before the expiry date. " +
      "Reply to this email or call us and we will take care of the paperwork.</p>" +
      "<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>",
    isActive: true,
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-07-14T09:20:00Z",
    usedByRules: 3,
  },
  {
    id: 2,
    name: "Final expiry notice",
    trigger: "expiry_reminder",
    subject: "Action needed: {{category_label}} policy expires {{expiry_date}}",
    bodyHtml:
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">' +
      "<p>Dear {{client_name}},</p>" +
      "<p>Your {{category_label}} policy <strong>{{policy_number}}</strong> expires on " +
      "<strong>{{expiry_date}}</strong>. After that date you are without cover.</p>" +
      "<p>Please get in touch today and we will complete the renewal for you.</p>" +
      "<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>",
    isActive: true,
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-04-01T06:00:00Z",
    usedByRules: 2,
  },
  {
    id: 3,
    name: "Lapsed policy follow up",
    trigger: "post_expiry",
    subject: "Your {{category_label}} policy has lapsed",
    bodyHtml:
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">' +
      "<p>Dear {{client_name}},</p>" +
      "<p>Our records show that policy <strong>{{policy_number}}</strong> with {{insurer_name}} " +
      "expired on {{expiry_date}} and has not yet been renewed.</p>" +
      "<p>Warm regards,<br />{{provider_name}}</p></div>",
    isActive: true,
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-04-01T06:00:00Z",
    usedByRules: 1,
  },
  {
    id: 4,
    name: "Renewal confirmation",
    trigger: "renewal_confirmation",
    subject: "Renewal confirmed — policy {{policy_number}}",
    bodyHtml:
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">' +
      "<p>Dear {{client_name}},</p>" +
      "<p>Your {{category_label}} cover with {{insurer_name}} has been renewed. " +
      "The new policy runs to <strong>{{expiry_date}}</strong>.</p>" +
      "<p>Warm regards,<br />{{provider_name}}</p></div>",
    isActive: true,
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-04-01T06:00:00Z",
    usedByRules: 0,
  },
  {
    id: 5,
    name: "Provider daily digest",
    trigger: "provider_digest",
    subject: "StayInsured: {{expiring_count}} policies need attention",
    bodyHtml:
      '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1f2937">' +
      "<p>Summary for {{today}}:</p>{{{digest_table}}}</div>",
    isActive: true,
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-04-01T06:00:00Z",
    usedByRules: 0,
  },
];

const reminderRules = [
  { id: 1, name: "60 days before expiry", offsetDays: 60, audience: "client", channel: "email", templateId: 1, sortOrder: 1, isActive: true },
  { id: 2, name: "30 days before expiry", offsetDays: 30, audience: "client", channel: "email", templateId: 1, sortOrder: 2, isActive: true },
  { id: 3, name: "15 days before expiry", offsetDays: 15, audience: "client", channel: "email", templateId: 1, sortOrder: 3, isActive: true },
  { id: 4, name: "7 days before expiry", offsetDays: 7, audience: "client", channel: "both", templateId: 2, sortOrder: 4, isActive: true },
  { id: 5, name: "1 day before expiry", offsetDays: 1, audience: "client", channel: "both", templateId: 2, sortOrder: 5, isActive: true },
  { id: 6, name: "7 days after expiry", offsetDays: -7, audience: "client", channel: "email", templateId: 3, sortOrder: 6, isActive: false },
].map((rule) => ({
  category: null,
  ...rule,
  templateName: templates.find((t) => t.id === rule.templateId)?.name ?? null,
}));

const placeholders = [
  { name: "client_name", description: "The client's full name" },
  { name: "client_code", description: "Their code, such as CL-00001" },
  { name: "client_email", description: "The address the message is going to" },
  { name: "client_phone", description: "Their phone number" },
  { name: "policy_number", description: "The policy number" },
  { name: "category_label", description: "Health, Motor, Life and so on" },
  { name: "insurer_name", description: "The insurer" },
  { name: "product_name", description: "The plan name" },
  { name: "start_date", description: "When the current year started" },
  { name: "expiry_date", description: "When cover ends" },
  { name: "days_to_expiry", description: "Whole days until expiry, negative once past" },
  { name: "policy_year", description: "How many years this cover has run" },
  { name: "sum_insured", description: "Sum insured, formatted as money" },
  { name: "premium_amount", description: "Premium, formatted as money" },
  { name: "nominee_name", description: "The nominee on the policy" },
  { name: "vehicle_number", description: "Registration number, for motor policies" },
  { name: "provider_name", description: "Your agency name" },
  { name: "provider_email", description: "Your agency email" },
  { name: "provider_phone", description: "Your agency phone" },
  { name: "provider_address", description: "Your agency address" },
  { name: "today", description: "Today's date" },
  { name: "expiring_count", description: "How many policies the digest covers" },
  { name: "digest_table", description: "The digest table itself, as HTML" },
];

/** Derived from the book, so the list agrees with the policies on every other screen. */
const plannedReminders = reminderRules
  .filter((rule) => rule.isActive)
  .flatMap((rule) =>
    active
      .filter((policy) => policy.daysToExpiry === rule.offsetDays)
      .map((policy) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        clientId: policy.clientId,
        clientName: policy.clientName,
        toAddress: policy.clientEmail,
        expiryDate: policy.expiryDate,
        daysToExpiry: rule.offsetDays,
        channel: rule.channel,
        subject: `Your ${categoryLabels[policy.category]} policy expires on ${formatDay(policy.expiryDate)}`,
        blockedReason: policy.clientEmail
          ? null
          : "No email address on the client",
      })),
  );

const notifications = [
  { id: 41, ruleId: 3, policyId: 8, clientId: 6, status: "sent", scheduledFor: "2026-09-04", sentAt: "2026-08-12T03:30:00Z", attempts: 1 },
  { id: 40, ruleId: 2, policyId: 9, clientId: 7, status: "sent", scheduledFor: "2026-09-04", sentAt: "2026-08-11T03:30:00Z", attempts: 1 },
  { id: 39, ruleId: 1, policyId: 10, clientId: 8, status: "sent", scheduledFor: "2026-08-12", sentAt: "2026-08-10T03:30:00Z", attempts: 1 },
  { id: 38, ruleId: 4, policyId: 5, clientId: 3, status: "skipped", scheduledFor: "2026-08-02", sentAt: null, attempts: 0, lastError: "No email address on the client" },
  { id: 37, ruleId: 2, policyId: 12, clientId: 3, status: "failed", scheduledFor: "2026-06-29", sentAt: null, attempts: 3, lastError: "The server rejected the username or password." },
  { id: 36, ruleId: 1, policyId: 13, clientId: 6, status: "sent", scheduledFor: "2026-09-02", sentAt: "2026-08-08T03:30:00Z", attempts: 1 },
].map((row) => {
  const policy = policies.find((p) => p.id === row.policyId);
  const rule = reminderRules.find((r) => r.id === row.ruleId);
  return {
    ruleName: rule?.name ?? null,
    policyNumber: policy?.policyNumber ?? null,
    clientName: policy?.clientName ?? null,
    policyPeriod: policy?.expiryDate ?? TODAY,
    audience: "client",
    channel: rule?.channel ?? "email",
    toAddress: policy?.clientEmail ?? null,
    subject: `Your ${categoryLabels[policy?.category ?? "other"]} policy expires on ${formatDay(policy?.expiryDate ?? TODAY)}`,
    lastError: null,
    createdAt: `${row.scheduledFor}T03:30:00Z`,
    ...row,
  };
});

const reminderOverview = {
  enabled: true,
  dryRun: false,
  smtpConfigured: true,
  smtpPasswordSet: true,
  fromEmail: settings.smtp_from_email,
  sendTime: settings.reminder_send_time,
  dailyCap: Number(settings.daily_send_cap),
  digestEnabled: true,
  desktopAlerts: true,
  activeRules: reminderRules.filter((rule) => rule.isActive).length,
  dueToday: plannedReminders.length,
  queued: notifications.filter((row) => row.status === "queued").length,
  failed: notifications.filter((row) => row.status === "failed").length,
  sentToday: 2,
  lastSweep: `${TODAY}T03:30:00Z`,
  clientsOptedOut: clients.filter((row) => row.remindersOptedOut).length,
  expiringWithoutEmail: active.filter((row) => row.daysToExpiry <= 30 && !row.clientEmail).length,
};

export const fixtures = {
  today: TODAY,
  frozenNow: FROZEN_NOW,
  // Deliberately not the version in package.json: the pictures should not all
  // change because a release went out.
  appVersion: "0.1.0",
  session: {
    initialised: true,
    unlocked: true,
    canUseKeychain: true,
    encrypted: true,
    schemaVersion: 3,
    dataDir: "/Users/you/Library/Application Support/com.stayinsured.app",
  },
  clients,
  members,
  documents,
  insurers,
  products,
  policies,
  dashboard,
  importFields,
  importPreview,
  dryRunReport,
  finalReport,
  settings,
  categoryOrder,
  templates,
  reminderRules,
  placeholders,
  plannedReminders,
  notifications,
  reminderOverview,
};
