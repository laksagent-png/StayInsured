use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// Paged result shared by every list endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub rows: Vec<T>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

// ---------------------------------------------------------------- clients

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: i64,
    pub client_code: String,
    pub full_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub alt_phone: Option<String>,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub pincode: Option<String>,
    pub occupation: Option<String>,
    pub pan: Option<String>,
    pub gstin: Option<String>,
    pub preferred_language: String,
    pub reminders_opted_out: bool,
    pub notes: Option<String>,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Populated by list queries; zero when a single client is fetched.
    pub active_policies: i64,
    pub total_policies: i64,
    pub next_expiry: Option<String>,
    /// People related to this client, either direction of the edge.
    pub relatives: i64,
    /// No policy of their own and listed under somebody else. Derived on every
    /// read rather than stored, so it stops being true the moment they hold
    /// cover.
    pub is_dependent: bool,
}

pub const CLIENT_COLUMNS: &str =
    "c.id, c.client_code, c.full_name, c.email, c.phone, c.alt_phone, \
     c.date_of_birth, c.gender, c.address_line1, c.address_line2, c.city, c.state, c.pincode, \
     c.occupation, c.pan, c.gstin, c.preferred_language, c.reminders_opted_out, c.notes, \
     c.is_archived, c.created_at, c.updated_at";

impl Client {
    /// Expects `CLIENT_COLUMNS` followed by active_policies, total_policies,
    /// next_expiry, relatives, is_dependent.
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            client_code: row.get(1)?,
            full_name: row.get(2)?,
            email: row.get(3)?,
            phone: row.get(4)?,
            alt_phone: row.get(5)?,
            date_of_birth: row.get(6)?,
            gender: row.get(7)?,
            address_line1: row.get(8)?,
            address_line2: row.get(9)?,
            city: row.get(10)?,
            state: row.get(11)?,
            pincode: row.get(12)?,
            occupation: row.get(13)?,
            pan: row.get(14)?,
            gstin: row.get(15)?,
            preferred_language: row.get(16)?,
            reminders_opted_out: row.get::<_, i64>(17)? != 0,
            notes: row.get(18)?,
            is_archived: row.get::<_, i64>(19)? != 0,
            created_at: row.get(20)?,
            updated_at: row.get(21)?,
            active_policies: row.get(22).unwrap_or(0),
            total_policies: row.get(23).unwrap_or(0),
            next_expiry: row.get(24).unwrap_or(None),
            relatives: row.get(25).unwrap_or(0),
            is_dependent: row.get::<_, i64>(26).unwrap_or(0) != 0,
        })
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    pub client_code: Option<String>,
    pub full_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub alt_phone: Option<String>,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub pincode: Option<String>,
    pub occupation: Option<String>,
    pub pan: Option<String>,
    pub gstin: Option<String>,
    pub preferred_language: Option<String>,
    pub reminders_opted_out: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFilter {
    pub search: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub category: Option<String>,
    pub include_archived: Option<bool>,
    /// Brings dependents into the list. They are always found by search; this is
    /// about whether browsing shows them.
    pub include_family: Option<bool>,
    pub missing_email: Option<bool>,
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

// ---------------------------------------------------------------- family

/// One client related to another: the person, and which way the edge between
/// them runs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relative {
    pub client_id: i64,
    pub client_code: String,
    pub full_name: String,
    pub relationship: String,
    /// Which side of the stored edge this person sits on. `true` — they are the
    /// subject's `relationship`, read as "son: Aarav". `false` — the subject is
    /// theirs, read as "son of: Rajesh".
    ///
    /// The edge is never inverted into the opposite word, because doing so needs
    /// a gender to choose between father and mother, and a dependent imported as
    /// a name has none. Reading the one stored word from either side needs
    /// nothing the book does not hold.
    pub outgoing: bool,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub is_archived: bool,
    /// Policies in this person's own name, which is what makes them a
    /// policyholder rather than somebody's dependent.
    pub own_policies: i64,
    pub notes: Option<String>,
}

impl Relative {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            client_id: row.get(0)?,
            client_code: row.get(1)?,
            full_name: row.get(2)?,
            relationship: row.get(3)?,
            outgoing: row.get::<_, i64>(4)? != 0,
            date_of_birth: row.get(5)?,
            gender: row.get(6)?,
            is_archived: row.get::<_, i64>(7)? != 0,
            own_policies: row.get(8)?,
            notes: row.get(9)?,
        })
    }
}

/// A whole family: everybody reachable from one client, and the edges between
/// them. There is no family row to fetch — a family is what a walk over
/// `client_relations` finds, so this is assembled rather than selected.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Family {
    pub members: Vec<FamilyMember>,
    pub edges: Vec<FamilyEdge>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyMember {
    pub client_id: i64,
    pub client_code: String,
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub is_archived: bool,
    pub own_policies: i64,
    /// Edges walked to reach this person. Zero is the client asked about.
    pub steps: i64,
}

impl FamilyMember {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            client_id: row.get(0)?,
            client_code: row.get(1)?,
            full_name: row.get(2)?,
            date_of_birth: row.get(3)?,
            gender: row.get(4)?,
            is_archived: row.get::<_, i64>(5)? != 0,
            own_policies: row.get(6)?,
            steps: 0,
        })
    }
}

/// A stored edge, in the direction it is stored: `related_client_id` is the
/// `relationship` of `client_id`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyEdge {
    pub client_id: i64,
    pub related_client_id: i64,
    pub relationship: String,
}

impl FamilyEdge {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            client_id: row.get(0)?,
            related_client_id: row.get(1)?,
            relationship: row.get(2)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationInput {
    pub client_id: i64,
    pub related_client_id: i64,
    pub relationship: String,
}

/// What a client delete takes with it. Relationship edges always go; whether the
/// people on the other end do is the operator's decision, and it reaches only
/// one step out so that recording an in-law never widens what a delete removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteScope {
    /// The client alone. Their family stay in the book as clients.
    LinksOnly,
    /// The client and the people directly related to them.
    ImmediateFamily,
}

// ---------------------------------------------------------------- documents

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub client_id: i64,
    pub policy_id: Option<i64>,
    pub policy_number: Option<String>,
    pub title: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub uploaded_at: String,
}

impl Document {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            client_id: row.get(1)?,
            policy_id: row.get(2)?,
            policy_number: row.get(3)?,
            title: row.get(4)?,
            file_name: row.get(5)?,
            mime_type: row.get(6)?,
            size_bytes: row.get(7)?,
            uploaded_at: row.get(8)?,
        })
    }
}

/// Attaching names the file to copy in; the bytes are read by the backend rather
/// than carried across the bridge.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInput {
    pub client_id: i64,
    pub policy_id: Option<i64>,
    pub title: Option<String>,
    pub path: String,
}

// ---------------------------------------------------------------- insurers & products

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insurer {
    pub id: i64,
    pub name: String,
    pub short_code: Option<String>,
    pub website: Option<String>,
    pub claim_helpline: Option<String>,
    pub support_email: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub policy_count: i64,
}

impl Insurer {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            short_code: row.get(2)?,
            website: row.get(3)?,
            claim_helpline: row.get(4)?,
            support_email: row.get(5)?,
            notes: row.get(6)?,
            is_active: row.get::<_, i64>(7)? != 0,
            policy_count: row.get(8).unwrap_or(0),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsurerInput {
    pub name: String,
    pub short_code: Option<String>,
    pub website: Option<String>,
    pub claim_helpline: Option<String>,
    pub support_email: Option<String>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub insurer_id: i64,
    pub insurer_name: String,
    pub name: String,
    pub category: String,
    pub code: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub policy_count: i64,
}

impl Product {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            insurer_id: row.get(1)?,
            insurer_name: row.get(2)?,
            name: row.get(3)?,
            category: row.get(4)?,
            code: row.get(5)?,
            notes: row.get(6)?,
            is_active: row.get::<_, i64>(7)? != 0,
            policy_count: row.get(8).unwrap_or(0),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInput {
    pub insurer_id: i64,
    pub name: String,
    pub category: String,
    pub code: Option<String>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

// ---------------------------------------------------------------- policies

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub id: i64,
    pub chain_id: String,
    pub policy_year: i64,
    pub previous_policy_id: Option<i64>,
    pub policy_number: String,
    pub client_id: i64,
    pub client_code: String,
    pub client_name: String,
    pub client_email: Option<String>,
    pub client_phone: Option<String>,
    pub client_city: Option<String>,
    pub reminders_opted_out: bool,
    pub insurer_id: i64,
    pub insurer_name: String,
    pub product_id: Option<i64>,
    pub product_name: Option<String>,
    pub category: String,
    pub status: String,
    pub start_date: String,
    pub expiry_date: String,
    pub sum_insured: Option<f64>,
    pub premium_amount: Option<f64>,
    pub gst_amount: Option<f64>,
    pub premium_frequency: String,
    pub payment_mode: Option<String>,
    pub next_due_date: Option<String>,
    pub commission_rate: Option<f64>,
    pub commission_expected: Option<f64>,
    pub nominee_name: Option<String>,
    pub nominee_relation: Option<String>,
    pub vehicle_number: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub days_to_expiry: i64,
    pub is_renewed: bool,
}

/// Column list matching `Policy::from_row`, selected from the policy_overview view.
pub const POLICY_COLUMNS: &str = "id, chain_id, policy_year, previous_policy_id, policy_number, \
     client_id, client_code, client_name, client_email, client_phone, client_city, \
     reminders_opted_out, insurer_id, insurer_name, product_id, product_name, category, status, \
     start_date, expiry_date, sum_insured, premium_amount, gst_amount, premium_frequency, \
     payment_mode, next_due_date, commission_rate, commission_expected, nominee_name, \
     nominee_relation, vehicle_number, notes, created_at, updated_at, days_to_expiry, is_renewed";

impl Policy {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            chain_id: row.get(1)?,
            policy_year: row.get(2)?,
            previous_policy_id: row.get(3)?,
            policy_number: row.get(4)?,
            client_id: row.get(5)?,
            client_code: row.get(6)?,
            client_name: row.get(7)?,
            client_email: row.get(8)?,
            client_phone: row.get(9)?,
            client_city: row.get(10)?,
            reminders_opted_out: row.get::<_, i64>(11)? != 0,
            insurer_id: row.get(12)?,
            insurer_name: row.get(13)?,
            product_id: row.get(14)?,
            product_name: row.get(15)?,
            category: row.get(16)?,
            status: row.get(17)?,
            start_date: row.get(18)?,
            expiry_date: row.get(19)?,
            sum_insured: row.get(20)?,
            premium_amount: row.get(21)?,
            gst_amount: row.get(22)?,
            premium_frequency: row.get(23)?,
            payment_mode: row.get(24)?,
            next_due_date: row.get(25)?,
            commission_rate: row.get(26)?,
            commission_expected: row.get(27)?,
            nominee_name: row.get(28)?,
            nominee_relation: row.get(29)?,
            vehicle_number: row.get(30)?,
            notes: row.get(31)?,
            created_at: row.get(32)?,
            updated_at: row.get(33)?,
            days_to_expiry: row.get(34).unwrap_or(0),
            is_renewed: row.get::<_, i64>(35).unwrap_or(0) != 0,
        })
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInput {
    pub policy_number: String,
    pub client_id: i64,
    pub insurer_id: i64,
    pub product_id: Option<i64>,
    pub category: String,
    pub status: Option<String>,
    pub start_date: String,
    pub expiry_date: String,
    pub sum_insured: Option<f64>,
    pub premium_amount: Option<f64>,
    pub gst_amount: Option<f64>,
    pub premium_frequency: Option<String>,
    pub payment_mode: Option<String>,
    pub next_due_date: Option<String>,
    pub commission_rate: Option<f64>,
    pub commission_expected: Option<f64>,
    pub nominee_name: Option<String>,
    pub nominee_relation: Option<String>,
    pub vehicle_number: Option<String>,
    pub notes: Option<String>,
    /// The clients this policy year covers. Named for clients rather than for
    /// members so that a caller still passing the old member ids fails at the
    /// name instead of resolving them against the wrong table.
    pub insured_client_ids: Option<Vec<i64>>,
}

/// Creating the next year of an existing policy. Anything left out is carried
/// forward from the policy being renewed.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewalInput {
    pub policy_id: i64,
    pub policy_number: Option<String>,
    pub start_date: Option<String>,
    pub expiry_date: Option<String>,
    pub sum_insured: Option<f64>,
    pub premium_amount: Option<f64>,
    pub gst_amount: Option<f64>,
    pub commission_rate: Option<f64>,
    pub commission_expected: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyFilter {
    pub search: Option<String>,
    pub client_id: Option<i64>,
    pub insurer_id: Option<i64>,
    pub product_id: Option<i64>,
    pub categories: Option<Vec<String>>,
    pub statuses: Option<Vec<String>>,
    pub expiry_from: Option<String>,
    pub expiry_to: Option<String>,
    pub expiring_within_days: Option<i64>,
    pub min_premium: Option<f64>,
    pub max_premium: Option<f64>,
    pub city: Option<String>,
    /// Only the most recent policy in each renewal chain.
    pub latest_only: Option<bool>,
    pub unrenewed_only: Option<bool>,
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

// ---------------------------------------------------------------- dashboard

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryBreakdown {
    pub category: String,
    pub policy_count: i64,
    pub premium_total: f64,
    pub sum_insured_total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryBucket {
    pub label: String,
    pub count: i64,
    pub premium_total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub total_clients: i64,
    pub active_clients: i64,
    pub active_policies: i64,
    pub expiring_this_week: i64,
    pub expiring_this_month: i64,
    pub expired_unrenewed: i64,
    pub premium_under_management: f64,
    pub commission_expected: f64,
    pub clients_without_email: i64,
    pub buckets: Vec<ExpiryBucket>,
    pub by_category: Vec<CategoryBreakdown>,
    pub upcoming: Vec<Policy>,
    pub recently_lapsed: Vec<Policy>,
}

// ---------------------------------------------------------------- reminders

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailTemplate {
    pub id: i64,
    pub name: String,
    pub trigger: String,
    pub subject: String,
    pub body_html: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    /// How many reminder rules send this template; a template in use cannot be
    /// deleted out from under them.
    pub used_by_rules: i64,
}

pub const TEMPLATE_COLUMNS: &str = "t.id, t.name, t.trigger, t.subject, t.body_html, t.is_active, \
     t.created_at, t.updated_at, \
     (SELECT COUNT(*) FROM reminder_rules r WHERE r.template_id = t.id) AS used_by_rules";

impl EmailTemplate {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            trigger: row.get(2)?,
            subject: row.get(3)?,
            body_html: row.get(4)?,
            is_active: row.get::<_, i64>(5)? != 0,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            used_by_rules: row.get(8).unwrap_or(0),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailTemplateInput {
    pub name: String,
    pub trigger: String,
    pub subject: String,
    pub body_html: String,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placeholder {
    pub name: String,
    pub description: String,
}

/// A rendered template, as it would arrive.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePreview {
    pub subject: String,
    pub html: String,
    pub text: String,
    /// Names in the template that no value will ever fill — almost always a typo.
    pub unknown_placeholders: Vec<String>,
    /// The policy the sample values came from, or none when the book is empty.
    pub sample_policy: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRule {
    pub id: i64,
    pub name: String,
    /// Days before expiry; negative means after it.
    pub offset_days: i64,
    pub category: Option<String>,
    pub audience: String,
    pub channel: String,
    pub template_id: Option<i64>,
    pub template_name: Option<String>,
    pub is_active: bool,
    pub sort_order: i64,
}

pub const RULE_COLUMNS: &str = "r.id, r.name, r.offset_days, r.category, r.audience, r.channel, \
     r.template_id, (SELECT t.name FROM email_templates t WHERE t.id = r.template_id) AS template_name, \
     r.is_active, r.sort_order";

impl ReminderRule {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            offset_days: row.get(2)?,
            category: row.get(3)?,
            audience: row.get(4)?,
            channel: row.get(5)?,
            template_id: row.get(6)?,
            template_name: row.get(7)?,
            is_active: row.get::<_, i64>(8)? != 0,
            sort_order: row.get(9)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRuleInput {
    pub name: String,
    pub offset_days: i64,
    pub category: Option<String>,
    pub audience: String,
    pub channel: String,
    pub template_id: Option<i64>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i64>,
}

/// One row of the outbox.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub rule_id: Option<i64>,
    pub rule_name: Option<String>,
    pub policy_id: Option<i64>,
    pub policy_number: Option<String>,
    pub client_id: Option<i64>,
    pub client_name: Option<String>,
    pub policy_period: String,
    pub audience: String,
    pub channel: String,
    pub to_address: Option<String>,
    pub subject: Option<String>,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub scheduled_for: String,
    pub sent_at: Option<String>,
    pub created_at: String,
}

pub const NOTIFICATION_COLUMNS: &str = "n.id, n.rule_id, \
     (SELECT r.name FROM reminder_rules r WHERE r.id = n.rule_id) AS rule_name, \
     n.policy_id, (SELECT p.policy_number FROM policies p WHERE p.id = n.policy_id) AS policy_number, \
     n.client_id, (SELECT c.full_name FROM clients c WHERE c.id = n.client_id) AS client_name, \
     n.policy_period, n.audience, n.channel, n.to_address, n.subject, n.status, n.attempts, \
     n.last_error, n.scheduled_for, n.sent_at, n.created_at";

impl Notification {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            rule_id: row.get(1)?,
            rule_name: row.get(2)?,
            policy_id: row.get(3)?,
            policy_number: row.get(4)?,
            client_id: row.get(5)?,
            client_name: row.get(6)?,
            policy_period: row.get(7)?,
            audience: row.get(8)?,
            channel: row.get(9)?,
            to_address: row.get(10)?,
            subject: row.get(11)?,
            status: row.get(12)?,
            attempts: row.get(13)?,
            last_error: row.get(14)?,
            scheduled_for: row.get(15)?,
            sent_at: row.get(16)?,
            created_at: row.get(17)?,
        })
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationFilter {
    pub statuses: Option<Vec<String>>,
    pub client_id: Option<i64>,
    pub policy_id: Option<i64>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// A reminder the sweep would queue, shown before anything is written.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedReminder {
    pub rule_id: i64,
    pub rule_name: String,
    pub policy_id: i64,
    pub policy_number: String,
    pub client_id: i64,
    pub client_name: String,
    pub to_address: Option<String>,
    pub expiry_date: String,
    pub days_to_expiry: i64,
    pub channel: String,
    pub subject: String,
    /// Set when the reminder will not go out, saying why.
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRun {
    pub dry_run: bool,
    pub queued: usize,
    pub sent: usize,
    pub failed: usize,
    pub skipped: usize,
    /// Reminders left queued because the daily cap was reached.
    pub held_by_cap: usize,
    pub desktop_alerts: usize,
    pub digest_sent: bool,
    pub issues: Vec<String>,
}

/// What the reminders screen needs to describe the current state in a sentence.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderOverview {
    pub enabled: bool,
    pub dry_run: bool,
    pub smtp_configured: bool,
    pub smtp_password_set: bool,
    pub from_email: String,
    pub send_time: String,
    pub daily_cap: i64,
    pub digest_enabled: bool,
    pub desktop_alerts: bool,
    pub active_rules: i64,
    pub due_today: i64,
    pub queued: i64,
    pub failed: i64,
    pub sent_today: i64,
    pub last_sweep: Option<String>,
    pub clients_opted_out: i64,
    pub expiring_without_email: i64,
}

// ---------------------------------------------------------------- misc

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub initialised: bool,
    pub unlocked: bool,
    pub can_use_keychain: bool,
    /// Whether the password protects the file or only the screens. Always true
    /// here: this core opens SQLCipher with a key derived from the password, so
    /// there is no reading the book without it.
    ///
    /// It is reported rather than assumed because the lock screen and the security
    /// section of Settings promise the operator that their data is encrypted, and a
    /// promise a backend cannot keep should not be printed. The Electron edition in
    /// `legacy-windows/` reuses these same screens over a plain SQLite file and
    /// answers false, at which point they say what is actually true there.
    pub encrypted: bool,
    pub schema_version: i32,
    pub data_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupItem {
    pub id: i64,
    pub label: String,
    pub secondary: Option<String>,
}

impl LookupItem {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            label: row.get(1)?,
            secondary: row.get(2)?,
        })
    }
}

/// Helper for optional text coming from forms: blank strings become NULL so that
/// unique indexes and "missing email" filters behave predictably.
pub fn blank_to_none(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
