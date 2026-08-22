use std::collections::HashMap;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{ClientInput, PolicyInput};
use crate::repo::{clients, insurers, policies, products, relations};
use crate::util;

/// A field the importer can fill, with the header names it recognises.
pub struct FieldSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub required: bool,
    pub synonyms: &'static [&'static str],
}

pub const FIELDS: &[FieldSpec] = &[
    FieldSpec {
        key: "fullName",
        label: "Client name",
        group: "Client",
        required: true,
        synonyms: &[
            "client name",
            "customer name",
            "name",
            "insured name",
            "proposer name",
            "policy holder",
            "policyholder",
            "holder name",
        ],
    },
    FieldSpec {
        key: "clientCode",
        label: "Client code",
        group: "Client",
        required: false,
        synonyms: &[
            "client code",
            "client id",
            "customer id",
            "customer code",
            "code",
            "ref",
            "reference",
        ],
    },
    FieldSpec {
        key: "email",
        label: "Email",
        group: "Client",
        required: false,
        synonyms: &["email", "email id", "e mail", "mail", "email address"],
    },
    FieldSpec {
        key: "phone",
        label: "Mobile",
        group: "Client",
        required: false,
        synonyms: &[
            "phone",
            "mobile",
            "mobile no",
            "contact",
            "contact no",
            "cell",
            "phone number",
        ],
    },
    FieldSpec {
        key: "altPhone",
        label: "Alternate phone",
        group: "Client",
        required: false,
        synonyms: &[
            "alt phone",
            "alternate phone",
            "landline",
            "secondary phone",
            "phone 2",
        ],
    },
    FieldSpec {
        key: "dateOfBirth",
        label: "Date of birth",
        group: "Client",
        required: false,
        synonyms: &["dob", "date of birth", "birth date", "birthday"],
    },
    FieldSpec {
        key: "gender",
        label: "Gender",
        group: "Client",
        required: false,
        synonyms: &["gender", "sex"],
    },
    FieldSpec {
        key: "addressLine1",
        label: "Address",
        group: "Client",
        required: false,
        synonyms: &["address", "address 1", "address line 1", "street"],
    },
    FieldSpec {
        key: "addressLine2",
        label: "Address line 2",
        group: "Client",
        required: false,
        synonyms: &["address 2", "address line 2", "locality", "area"],
    },
    FieldSpec {
        key: "city",
        label: "City",
        group: "Client",
        required: false,
        synonyms: &["city", "town", "district"],
    },
    FieldSpec {
        key: "state",
        label: "State",
        group: "Client",
        required: false,
        synonyms: &["state", "province"],
    },
    FieldSpec {
        key: "pincode",
        label: "Pincode",
        group: "Client",
        required: false,
        synonyms: &[
            "pincode",
            "pin code",
            "postal code",
            "zip",
            "zipcode",
            "pin",
        ],
    },
    FieldSpec {
        key: "occupation",
        label: "Occupation",
        group: "Client",
        required: false,
        synonyms: &["occupation", "profession", "job"],
    },
    FieldSpec {
        key: "pan",
        label: "PAN",
        group: "Client",
        required: false,
        synonyms: &["pan", "pan no", "pan number"],
    },
    FieldSpec {
        key: "policyNumber",
        label: "Policy number",
        group: "Policy",
        required: true,
        synonyms: &[
            "policy no",
            "policy number",
            "policy",
            "certificate no",
            "policy id",
        ],
    },
    FieldSpec {
        key: "insurerName",
        label: "Insurer",
        group: "Policy",
        required: true,
        synonyms: &[
            "insurer",
            "insurance company",
            "company",
            "insurance provider",
            "underwriter",
            "insurer name",
        ],
    },
    FieldSpec {
        key: "productName",
        label: "Plan / product",
        group: "Policy",
        required: false,
        synonyms: &[
            "product",
            "plan",
            "plan name",
            "product name",
            "scheme",
            "policy type name",
        ],
    },
    FieldSpec {
        key: "category",
        label: "Category",
        group: "Policy",
        required: false,
        synonyms: &[
            "category",
            "type",
            "policy type",
            "line of business",
            "lob",
            "segment",
            "product category",
        ],
    },
    FieldSpec {
        key: "startDate",
        label: "Start date",
        group: "Policy",
        required: false,
        synonyms: &[
            "start date",
            "from date",
            "issue date",
            "commencement",
            "risk start",
            "inception",
            "policy start",
        ],
    },
    FieldSpec {
        key: "expiryDate",
        label: "Expiry date",
        group: "Policy",
        required: true,
        synonyms: &[
            "expiry date",
            "expiry",
            "end date",
            "to date",
            "valid till",
            "renewal date",
            "due date",
            "maturity date",
            "policy end",
        ],
    },
    FieldSpec {
        key: "sumInsured",
        label: "Sum insured",
        group: "Policy",
        required: false,
        synonyms: &[
            "sum insured",
            "sum assured",
            "si",
            "cover",
            "coverage",
            "cover amount",
        ],
    },
    FieldSpec {
        key: "premiumAmount",
        label: "Premium",
        group: "Policy",
        required: false,
        synonyms: &[
            "premium",
            "premium amount",
            "gross premium",
            "total premium",
            "amount",
        ],
    },
    FieldSpec {
        key: "gstAmount",
        label: "GST",
        group: "Policy",
        required: false,
        synonyms: &["gst", "tax", "gst amount", "service tax"],
    },
    FieldSpec {
        key: "premiumFrequency",
        label: "Premium frequency",
        group: "Policy",
        required: false,
        synonyms: &[
            "frequency",
            "premium frequency",
            "payment frequency",
            "mode of payment term",
        ],
    },
    FieldSpec {
        key: "paymentMode",
        label: "Payment mode",
        group: "Policy",
        required: false,
        synonyms: &["payment mode", "mode", "paid by", "payment method"],
    },
    FieldSpec {
        key: "commissionRate",
        label: "Commission %",
        group: "Policy",
        required: false,
        synonyms: &[
            "commission rate",
            "commission %",
            "comm %",
            "brokerage %",
            "commission percent",
        ],
    },
    FieldSpec {
        key: "commissionExpected",
        label: "Commission amount",
        group: "Policy",
        required: false,
        synonyms: &["commission", "commission amount", "brokerage", "payout"],
    },
    FieldSpec {
        key: "nomineeName",
        label: "Nominee",
        group: "Policy",
        required: false,
        synonyms: &["nominee", "nominee name", "beneficiary"],
    },
    FieldSpec {
        key: "nomineeRelation",
        label: "Nominee relation",
        group: "Policy",
        required: false,
        synonyms: &[
            "nominee relation",
            "nominee relationship",
            "relation with nominee",
        ],
    },
    FieldSpec {
        key: "vehicleNumber",
        label: "Vehicle number",
        group: "Policy",
        required: false,
        synonyms: &[
            "vehicle no",
            "vehicle number",
            "registration no",
            "reg no",
            "rc number",
        ],
    },
    FieldSpec {
        key: "memberNames",
        label: "Covered members",
        group: "Policy",
        required: false,
        synonyms: &[
            "members",
            "insured members",
            "covered members",
            "family members",
            "lives covered",
        ],
    },
    FieldSpec {
        key: "notes",
        label: "Notes",
        group: "Policy",
        required: false,
        synonyms: &["notes", "remarks", "comments", "description"],
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldInfo {
    pub key: String,
    pub label: String,
    pub group: String,
    pub required: bool,
}

pub fn field_catalogue() -> Vec<FieldInfo> {
    FIELDS
        .iter()
        .map(|f| FieldInfo {
            key: f.key.to_string(),
            label: f.label.to_string(),
            group: f.group.to_string(),
            required: f.required,
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_name: String,
    pub sheet_names: Vec<String>,
    pub sheet: String,
    pub headers: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
    pub total_rows: usize,
    /// field key -> header name
    pub suggested_mapping: HashMap<String, String>,
    pub unmapped_headers: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub path: String,
    pub sheet: Option<String>,
    /// field key -> header name
    pub mapping: HashMap<String, String>,
    pub default_category: Option<String>,
    /// Update clients and policies that already exist instead of skipping them.
    pub update_existing: Option<bool>,
    /// Validate and report without keeping any changes.
    pub dry_run: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub row: usize,
    pub column: Option<String>,
    pub value: Option<String>,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub dry_run: bool,
    pub total_rows: usize,
    pub policies_inserted: usize,
    pub policies_updated: usize,
    pub clients_created: usize,
    pub clients_updated: usize,
    pub insurers_created: usize,
    pub skipped: usize,
    pub failed: usize,
    pub issues: Vec<ImportIssue>,
}

/// Counters that must be wound back when a row is rolled back.
type Counters = (usize, usize, usize, usize, usize);

impl ImportReport {
    fn counters(&self) -> Counters {
        (
            self.policies_inserted,
            self.policies_updated,
            self.clients_created,
            self.clients_updated,
            self.insurers_created,
        )
    }

    fn restore(&mut self, counters: Counters) {
        (
            self.policies_inserted,
            self.policies_updated,
            self.clients_created,
            self.clients_updated,
            self.insurers_created,
        ) = counters;
    }

    /// Keeps the issue list bounded; a broken file should not produce a report
    /// with fifty thousand lines in it.
    fn note(&mut self, row: usize, message: String, blame: Option<Blame>) {
        if self.issues.len() < 300 {
            let (column, value) = match blame {
                Some(cell) => (Some(cell.column), cell.value),
                None => (None, None),
            };
            self.issues.push(ImportIssue {
                row,
                column,
                value,
                message,
            });
        }
    }
}

/// Header row plus data rows, already flattened to strings.
pub struct Sheet {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sheet_names: Vec<String>,
    pub sheet: String,
}

pub fn read_sheet(path: &Path, sheet: Option<&str>) -> AppResult<Sheet> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension == "csv" || extension == "txt" || extension == "tsv" {
        return read_delimited(path, &extension);
    }

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::Spreadsheet(format!("could not open the file: {e}")))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let chosen = match sheet {
        Some(name) if sheet_names.iter().any(|s| s == name) => name.to_string(),
        _ => sheet_names
            .first()
            .cloned()
            .ok_or_else(|| AppError::Spreadsheet("the workbook has no sheets".into()))?,
    };

    let range = workbook
        .worksheet_range(&chosen)
        .map_err(|e| AppError::Spreadsheet(format!("could not read sheet {chosen}: {e}")))?;

    let mut iter = range.rows();
    let headers = match iter.next() {
        Some(row) => row.iter().map(cell_to_string).collect::<Vec<_>>(),
        None => return Err(AppError::Spreadsheet("the sheet is empty".into())),
    };

    let rows = iter
        .map(|row| row.iter().map(cell_to_string).collect::<Vec<_>>())
        .filter(|row: &Vec<String>| row.iter().any(|cell| !cell.is_empty()))
        .collect();

    Ok(Sheet {
        headers,
        rows,
        sheet_names,
        sheet: chosen,
    })
}

fn read_delimited(path: &Path, extension: &str) -> AppResult<Sheet> {
    let delimiter = if extension == "tsv" { b'\t' } else { b',' };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_path(path)?;

    let headers = reader
        .headers()?
        .iter()
        .map(|h| h.trim().to_string())
        .collect::<Vec<_>>();

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record?;
        let row: Vec<String> = record.iter().map(|c| c.trim().to_string()).collect();
        if row.iter().any(|cell| !cell.is_empty()) {
            rows.push(row);
        }
    }

    Ok(Sheet {
        headers,
        rows,
        sheet_names: vec!["Sheet1".into()],
        sheet: "Sheet1".into(),
    })
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt
            .as_datetime()
            .map(|d| d.date().format("%Y-%m-%d").to_string())
            .or_else(|| util::excel_serial_to_iso(dt.as_f64()))
            .unwrap_or_default(),
        Data::DateTimeIso(s) => s.trim().to_string(),
        Data::DurationIso(s) => s.trim().to_string(),
        Data::Error(_) => String::new(),
    }
}

fn normalise_header(header: &str) -> String {
    header
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Matches spreadsheet headers to fields: exact synonym first, then containment,
/// so "Policy Expiry Date (DD/MM/YYYY)" still lands on expiryDate.
pub fn suggest_mapping(headers: &[String]) -> HashMap<String, String> {
    let normalised: Vec<(usize, String)> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (i, normalise_header(h)))
        .collect();

    let mut mapping = HashMap::new();
    let mut taken = vec![false; headers.len()];

    for pass in 0..2 {
        for field in FIELDS {
            if mapping.contains_key(field.key) {
                continue;
            }
            for (index, header) in &normalised {
                if taken[*index] || header.is_empty() {
                    continue;
                }
                let hit = field.synonyms.iter().any(|synonym| {
                    if pass == 0 {
                        header == synonym
                    } else {
                        header.contains(synonym)
                    }
                });
                if hit {
                    mapping.insert(field.key.to_string(), headers[*index].clone());
                    taken[*index] = true;
                    break;
                }
            }
        }
    }

    mapping
}

pub fn preview(path: &Path, sheet: Option<&str>) -> AppResult<ImportPreview> {
    let data = read_sheet(path, sheet)?;
    let suggested = suggest_mapping(&data.headers);
    let mapped: Vec<&String> = suggested.values().collect();
    let unmapped = data
        .headers
        .iter()
        .filter(|h| !h.is_empty() && !mapped.contains(h))
        .cloned()
        .collect();

    Ok(ImportPreview {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        sheet: data.sheet.clone(),
        sheet_names: data.sheet_names.clone(),
        sample_rows: data.rows.iter().take(8).cloned().collect(),
        total_rows: data.rows.len(),
        headers: data.headers,
        suggested_mapping: suggested,
        unmapped_headers: unmapped,
    })
}

/// Reads a mapped value out of a row.
struct RowReader<'a> {
    row: &'a [String],
    headers: &'a [String],
    indexes: &'a HashMap<String, usize>,
}

/// The cell a row failed on, so the report can point at it rather than at the
/// row: "row 4, Expiry Date, `31-02-2026`" is fixable, "row 4" is a hunt.
struct Blame {
    column: String,
    value: Option<String>,
}

impl<'a> RowReader<'a> {
    fn get(&self, field: &str) -> Option<String> {
        let index = self.indexes.get(field)?;
        self.row
            .get(*index)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    }

    /// Which column a field was read from, and what it held. A field that was
    /// never mapped has no column to blame, and a blank cell has no value.
    fn blame(&self, field: &str) -> Option<Blame> {
        let index = *self.indexes.get(field)?;
        Some(Blame {
            column: self.headers.get(index)?.clone(),
            value: self
                .row
                .get(index)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
        })
    }
}

pub fn run(conn: &Connection, options: &ImportOptions) -> AppResult<ImportReport> {
    let path = Path::new(&options.path);
    let data = read_sheet(path, options.sheet.as_deref())?;
    let dry_run = options.dry_run.unwrap_or(false);
    let update_existing = options.update_existing.unwrap_or(true);

    // Resolve the mapping to column positions once.
    let mut indexes: HashMap<String, usize> = HashMap::new();
    for (field, header) in &options.mapping {
        if header.trim().is_empty() {
            continue;
        }
        match data.headers.iter().position(|h| h == header) {
            Some(index) => {
                indexes.insert(field.clone(), index);
            }
            None => {
                return Err(AppError::validation(format!(
                    "The file has no column called \"{header}\""
                )))
            }
        }
    }

    for field in FIELDS.iter().filter(|f| f.required) {
        if !indexes.contains_key(field.key) {
            return Err(AppError::validation(format!(
                "{} still needs to be mapped to a column",
                field.label
            )));
        }
    }

    let mut report = ImportReport {
        dry_run,
        total_rows: data.rows.len(),
        ..Default::default()
    };

    // Everything happens in one transaction: a dry run rolls it back, and a real
    // run either lands completely or not at all.
    conn.execute_batch("BEGIN")?;
    let outcome = import_rows(conn, &data, &indexes, options, update_existing, &mut report);
    match outcome {
        Ok(()) if dry_run => conn.execute_batch("ROLLBACK")?,
        Ok(()) => {
            record_batch(conn, path, options, &report)?;
            conn.execute_batch("COMMIT")?;
        }
        Err(err) => {
            conn.execute_batch("ROLLBACK")?;
            return Err(err);
        }
    }

    Ok(report)
}

fn import_rows(
    conn: &Connection,
    data: &Sheet,
    indexes: &HashMap<String, usize>,
    options: &ImportOptions,
    update_existing: bool,
    report: &mut ImportReport,
) -> AppResult<()> {
    let default_category = options
        .default_category
        .clone()
        .unwrap_or_else(|| "other".into());

    for (offset, row) in data.rows.iter().enumerate() {
        // +2 because row 1 is the header and spreadsheets are 1-indexed.
        let row_number = offset + 2;
        let reader = RowReader {
            row,
            headers: &data.headers,
            indexes,
        };

        // Each row is its own savepoint. Without this, a row that creates a client
        // and then fails on the policy would leave the half-built client behind.
        let counters = report.counters();
        conn.execute_batch("SAVEPOINT import_row")?;

        // The cell to blame, when the failure is about one in particular.
        let mut blamed: Option<&'static str> = None;

        match import_row(
            conn,
            &reader,
            &default_category,
            update_existing,
            report,
            &mut blamed,
        ) {
            Ok(RowOutcome::Skipped(reason)) => {
                conn.execute_batch("RELEASE import_row")?;
                report.skipped += 1;
                report.note(row_number, reason, blamed.and_then(|f| reader.blame(f)));
            }
            Ok(_) => conn.execute_batch("RELEASE import_row")?,
            Err(err) => {
                conn.execute_batch("ROLLBACK TO import_row; RELEASE import_row")?;
                report.restore(counters);
                report.failed += 1;
                report.note(
                    row_number,
                    err.to_string(),
                    blamed.and_then(|f| reader.blame(f)),
                );
            }
        }
    }

    Ok(())
}

enum RowOutcome {
    Inserted,
    Updated,
    Skipped(String),
}

fn import_row(
    conn: &Connection,
    reader: &RowReader,
    default_category: &str,
    update_existing: bool,
    report: &mut ImportReport,
    blamed: &mut Option<&'static str>,
) -> AppResult<RowOutcome> {
    let name = reader.get("fullName").ok_or_else(|| {
        *blamed = Some("fullName");
        AppError::validation("Client name is blank")
    })?;

    let email = reader.get("email").filter(|e| {
        // A malformed address should not sink the row; it is reported and dropped.
        util::looks_like_email(e)
    });
    let phone = reader
        .get("phone")
        .as_deref()
        .and_then(util::normalise_phone);
    let code = reader.get("clientCode");

    let client_id = match clients::find_match(
        conn,
        code.as_deref(),
        email.as_deref(),
        phone.as_deref(),
        &name,
    )? {
        Some(id) => {
            if update_existing {
                let touched = fill_client_gaps(conn, id, reader)?;
                if touched {
                    report.clients_updated += 1;
                }
            }
            id
        }
        None => {
            let id = clients::create(
                conn,
                &ClientInput {
                    client_code: code.clone(),
                    full_name: name.clone(),
                    email: email.clone(),
                    phone: phone.clone(),
                    alt_phone: reader.get("altPhone"),
                    date_of_birth: reader.get("dateOfBirth"),
                    gender: reader
                        .get("gender")
                        .as_deref()
                        .and_then(util::normalise_gender),
                    address_line1: reader.get("addressLine1"),
                    address_line2: reader.get("addressLine2"),
                    city: reader.get("city"),
                    state: reader.get("state"),
                    pincode: reader.get("pincode"),
                    occupation: reader.get("occupation"),
                    pan: reader.get("pan"),
                    ..Default::default()
                },
            )?;
            report.clients_created += 1;
            id
        }
    };

    let policy_number = reader.get("policyNumber").ok_or_else(|| {
        *blamed = Some("policyNumber");
        AppError::validation("Policy number is blank")
    })?;
    let insurer_name = reader.get("insurerName").ok_or_else(|| {
        *blamed = Some("insurerName");
        AppError::validation("Insurer is blank")
    })?;

    let insurer_count_before: i64 =
        conn.query_row("SELECT COUNT(*) FROM insurers", [], |r| r.get(0))?;
    let insurer_id = insurers::find_or_create(conn, &insurer_name)?;
    let insurer_count_after: i64 =
        conn.query_row("SELECT COUNT(*) FROM insurers", [], |r| r.get(0))?;
    if insurer_count_after > insurer_count_before {
        report.insurers_created += 1;
    }

    let product_name = reader.get("productName");
    let category = reader
        .get("category")
        .map(|c| util::normalise_category(&c))
        .or_else(|| product_name.as_deref().map(util::normalise_category))
        .unwrap_or_else(|| default_category.to_string());

    let product_id = match product_name.as_deref() {
        Some(name) => products::find_or_create(conn, insurer_id, name, &category)?,
        None => None,
    };

    let expiry = reader
        .get("expiryDate")
        .and_then(|d| util::parse_date(&d))
        .ok_or_else(|| {
            *blamed = Some("expiryDate");
            AppError::validation("Expiry date is missing or unreadable")
        })?;
    let start = reader
        .get("startDate")
        .and_then(|d| util::parse_date(&d))
        .unwrap_or_else(|| back_date_one_year(&expiry));

    let existing_policy: Option<i64> = conn
        .query_row(
            "SELECT id FROM policies WHERE insurer_id = ?1 AND policy_number = ?2",
            params![insurer_id, policy_number],
            |row| row.get(0),
        )
        .ok();

    let input = PolicyInput {
        policy_number: policy_number.clone(),
        client_id,
        insurer_id,
        product_id,
        category,
        status: None,
        start_date: start,
        expiry_date: expiry,
        sum_insured: reader
            .get("sumInsured")
            .as_deref()
            .and_then(util::parse_number),
        premium_amount: reader
            .get("premiumAmount")
            .as_deref()
            .and_then(util::parse_number),
        gst_amount: reader
            .get("gstAmount")
            .as_deref()
            .and_then(util::parse_number),
        premium_frequency: reader.get("premiumFrequency").map(normalise_frequency),
        payment_mode: reader.get("paymentMode"),
        next_due_date: None,
        commission_rate: reader
            .get("commissionRate")
            .as_deref()
            .and_then(util::parse_number),
        commission_expected: reader
            .get("commissionExpected")
            .as_deref()
            .and_then(util::parse_number),
        nominee_name: reader.get("nomineeName"),
        nominee_relation: reader.get("nomineeRelation"),
        vehicle_number: reader.get("vehicleNumber"),
        notes: reader.get("notes"),
        // Set after the policy exists, once the names have been resolved to
        // clients: attaching them needs a policy to check the holder against.
        insured_client_ids: None,
    };

    let policy_id = match existing_policy {
        Some(id) if update_existing => {
            policies::update(conn, id, &input)?;
            report.policies_updated += 1;
            id
        }
        Some(_) => {
            *blamed = Some("policyNumber");
            return Ok(RowOutcome::Skipped(format!(
                "Policy {policy_number} already exists and updates are switched off"
            )));
        }
        None => {
            let id = policies::create(conn, &input)?;
            report.policies_inserted += 1;
            id
        }
    };

    // A cover list is a column of names, so each one is resolved to a client:
    // the holder themselves where the name is theirs, somebody already in the
    // family, an unambiguous client of that name, or a new client related to the
    // holder. Re-importing the same sheet finds the same people rather than
    // opening second copies of them.
    if let Some(list) = reader.get("memberNames") {
        let nominee = reader.get("nomineeName");
        let nominee_relation = reader.get("nomineeRelation");
        let mut insured_client_ids = Vec::new();

        for entry in list.split([',', ';', '/', '|']) {
            let (name, beside) = util::split_relationship(entry);

            // A cell that is only a relationship names nobody, and a client called
            // "Wife" would be worse than the cover going unrecorded: the next
            // import would match that name and cover somebody else's wife.
            // "Self" and its synonyms are the exception — that is the holder.
            if name.is_empty() {
                if beside == Some("self") {
                    insured_client_ids.push(client_id);
                }
                continue;
            }

            // Where the file wrote no word beside the name, the nominee columns
            // often carry one for exactly one of these people.
            let relationship = beside.map(str::to_owned).or_else(|| {
                let nominee = nominee.as_deref()?;
                nominee
                    .trim()
                    .eq_ignore_ascii_case(name)
                    .then(|| nominee_relation.clone())
                    .flatten()
            });

            insured_client_ids.push(relations::find_or_create_relative(
                conn,
                client_id,
                name,
                relationship.as_deref(),
            )?);
        }

        if !insured_client_ids.is_empty() {
            policies::set_members(conn, policy_id, &insured_client_ids)?;
        }
    }

    Ok(match existing_policy {
        Some(_) => RowOutcome::Updated,
        None => RowOutcome::Inserted,
    })
}

/// Fills blank client fields from the spreadsheet without overwriting anything
/// already recorded, so a partial import cannot erase better data.
fn fill_client_gaps(conn: &Connection, id: i64, reader: &RowReader) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE clients SET \
             email = COALESCE(NULLIF(email, ''), ?2), \
             phone = COALESCE(NULLIF(phone, ''), ?3), \
             alt_phone = COALESCE(NULLIF(alt_phone, ''), ?4), \
             date_of_birth = COALESCE(date_of_birth, ?5), \
             gender = COALESCE(gender, ?6), \
             address_line1 = COALESCE(NULLIF(address_line1, ''), ?7), \
             city = COALESCE(NULLIF(city, ''), ?8), \
             state = COALESCE(NULLIF(state, ''), ?9), \
             pincode = COALESCE(NULLIF(pincode, ''), ?10), \
             occupation = COALESCE(NULLIF(occupation, ''), ?11), \
             pan = COALESCE(NULLIF(pan, ''), ?12) \
         WHERE id = ?1",
        params![
            id,
            reader.get("email").filter(|e| util::looks_like_email(e)),
            reader
                .get("phone")
                .as_deref()
                .and_then(util::normalise_phone),
            reader
                .get("altPhone")
                .as_deref()
                .and_then(util::normalise_phone),
            reader
                .get("dateOfBirth")
                .as_deref()
                .and_then(util::parse_date),
            reader
                .get("gender")
                .as_deref()
                .and_then(util::normalise_gender),
            reader.get("addressLine1"),
            reader.get("city"),
            reader.get("state"),
            reader.get("pincode"),
            reader.get("occupation"),
            reader.get("pan").map(|p| p.to_uppercase()),
        ],
    )?;
    Ok(changed > 0)
}

fn normalise_frequency(raw: String) -> String {
    match raw.trim().to_lowercase().as_str() {
        "monthly" | "month" | "m" => "monthly".into(),
        "quarterly" | "quarter" | "q" => "quarterly".into(),
        "half yearly" | "half-yearly" | "semi annual" | "semi-annual" | "h" => "half_yearly".into(),
        "single" | "one time" | "single premium" => "single".into(),
        _ => "annual".into(),
    }
}

fn back_date_one_year(expiry: &str) -> String {
    chrono::NaiveDate::parse_from_str(expiry, "%Y-%m-%d")
        .map(|d| util::iso(d - chrono::Duration::days(364)))
        .unwrap_or_else(|_| util::today_iso())
}

fn record_batch(
    conn: &Connection,
    path: &Path,
    options: &ImportOptions,
    report: &ImportReport,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO import_batches (file_name, source_type, target, status, total_rows, inserted, \
             updated, skipped, failed, mapping_json, finished_at) \
         VALUES (?1, ?2, 'policies', 'completed', ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
        params![
            path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default(),
            report.total_rows as i64,
            report.policies_inserted as i64,
            report.policies_updated as i64,
            report.skipped as i64,
            report.failed as i64,
            serde_json::to_string(&options.mapping)?,
        ],
    )?;

    let batch_id = conn.last_insert_rowid();
    for issue in &report.issues {
        conn.execute(
            "INSERT INTO import_errors (batch_id, row_number, column_name, value, message) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                batch_id,
                issue.row as i64,
                issue.column,
                issue.value,
                issue.message
            ],
        )?;
    }
    Ok(())
}

/// Writes a spreadsheet with the expected headers and one example row, for
/// providers who have no existing file to import.
pub fn write_template(path: &Path) -> AppResult<()> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet().set_name("Policies")?;
    let header = Format::new().set_bold().set_background_color(0xE6F4F1);

    let columns: Vec<&FieldSpec> = FIELDS.iter().collect();
    for (index, field) in columns.iter().enumerate() {
        sheet.write_string_with_format(0, index as u16, field.label, &header)?;
        sheet.set_column_width(index as u16, 18)?;
    }

    let example: HashMap<&str, &str> = HashMap::from([
        ("fullName", "Rohit Sharma"),
        ("clientCode", "CL-00001"),
        ("email", "rohit@example.com"),
        ("phone", "9876543210"),
        ("dateOfBirth", "14/05/1985"),
        ("gender", "Male"),
        ("city", "Pune"),
        ("state", "Maharashtra"),
        ("pincode", "411001"),
        ("policyNumber", "HS/2026/00918273"),
        ("insurerName", "Star Health and Allied Insurance"),
        ("productName", "Family Health Optima"),
        ("category", "Health"),
        ("startDate", "01/04/2026"),
        ("expiryDate", "31/03/2027"),
        ("sumInsured", "1000000"),
        ("premiumAmount", "24500"),
        ("gstAmount", "4410"),
        ("premiumFrequency", "Annual"),
        ("paymentMode", "UPI"),
        ("commissionRate", "15"),
        ("commissionExpected", "3675"),
        ("nomineeName", "Anita Sharma"),
        ("nomineeRelation", "Spouse"),
        ("memberNames", "Rohit Sharma; Anita Sharma; Aarav Sharma"),
        ("notes", "Floater cover for the family"),
    ]);

    for (index, field) in columns.iter().enumerate() {
        if let Some(value) = example.get(field.key) {
            sheet.write_string(1, index as u16, *value)?;
        }
    }

    workbook.save(path)?;
    Ok(())
}
