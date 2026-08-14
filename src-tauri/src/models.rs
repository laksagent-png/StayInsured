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
}

pub const CLIENT_COLUMNS: &str = "c.id, c.client_code, c.full_name, c.email, c.phone, c.alt_phone, \
     c.date_of_birth, c.gender, c.address_line1, c.address_line2, c.city, c.state, c.pincode, \
     c.occupation, c.pan, c.gstin, c.preferred_language, c.reminders_opted_out, c.notes, \
     c.is_archived, c.created_at, c.updated_at";

impl Client {
    /// Expects `CLIENT_COLUMNS` followed by active_policies, total_policies, next_expiry.
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
    pub missing_email: Option<bool>,
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

// ---------------------------------------------------------------- members

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsuredMember {
    pub id: i64,
    pub client_id: i64,
    pub full_name: String,
    pub relationship: String,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub notes: Option<String>,
}

impl InsuredMember {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            client_id: row.get(1)?,
            full_name: row.get(2)?,
            relationship: row.get(3)?,
            date_of_birth: row.get(4)?,
            gender: row.get(5)?,
            notes: row.get(6)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberInput {
    pub client_id: i64,
    pub full_name: String,
    pub relationship: Option<String>,
    pub date_of_birth: Option<String>,
    pub gender: Option<String>,
    pub notes: Option<String>,
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
    pub member_ids: Option<Vec<i64>>,
}

/// Creating the next year of an existing policy. Anything left out is carried
/// forward from the policy being renewed.
#[derive(Debug, Deserialize)]
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

// ---------------------------------------------------------------- misc

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub initialised: bool,
    pub unlocked: bool,
    pub can_use_keychain: bool,
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
