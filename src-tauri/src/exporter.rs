use std::path::Path;

use rust_xlsxwriter::{Format, Workbook};

use crate::error::{AppError, AppResult};
use crate::models::{Client, Policy};
use crate::util;

/// Column headers paired with a value extractor, so xlsx and csv stay identical.
type PolicyColumn = (&'static str, fn(&Policy) -> String);

const POLICY_COLUMNS: &[PolicyColumn] = &[
    ("Client code", |p| p.client_code.clone()),
    ("Client name", |p| p.client_name.clone()),
    ("Email", |p| p.client_email.clone().unwrap_or_default()),
    ("Phone", |p| p.client_phone.clone().unwrap_or_default()),
    ("City", |p| p.client_city.clone().unwrap_or_default()),
    ("Policy number", |p| p.policy_number.clone()),
    ("Insurer", |p| p.insurer_name.clone()),
    ("Plan", |p| p.product_name.clone().unwrap_or_default()),
    ("Category", |p| {
        util::category_label(&p.category).to_string()
    }),
    ("Status", |p| title_case(&p.status)),
    ("Policy year", |p| p.policy_year.to_string()),
    ("Start date", |p| p.start_date.clone()),
    ("Expiry date", |p| p.expiry_date.clone()),
    ("Days to expiry", |p| p.days_to_expiry.to_string()),
    ("Sum insured", |p| number(p.sum_insured)),
    ("Premium", |p| number(p.premium_amount)),
    ("GST", |p| number(p.gst_amount)),
    ("Frequency", |p| title_case(&p.premium_frequency)),
    ("Payment mode", |p| {
        p.payment_mode.clone().unwrap_or_default()
    }),
    ("Commission %", |p| number(p.commission_rate)),
    ("Commission amount", |p| number(p.commission_expected)),
    ("Nominee", |p| p.nominee_name.clone().unwrap_or_default()),
    ("Vehicle number", |p| {
        p.vehicle_number.clone().unwrap_or_default()
    }),
    ("Notes", |p| p.notes.clone().unwrap_or_default()),
];

type ClientColumn = (&'static str, fn(&Client) -> String);

const CLIENT_COLUMNS: &[ClientColumn] = &[
    ("Client code", |c| c.client_code.clone()),
    ("Name", |c| c.full_name.clone()),
    ("Email", |c| c.email.clone().unwrap_or_default()),
    ("Phone", |c| c.phone.clone().unwrap_or_default()),
    ("Alternate phone", |c| {
        c.alt_phone.clone().unwrap_or_default()
    }),
    ("Date of birth", |c| {
        c.date_of_birth.clone().unwrap_or_default()
    }),
    ("Gender", |c| c.gender.clone().unwrap_or_default()),
    ("Address", |c| {
        [c.address_line1.clone(), c.address_line2.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ")
    }),
    ("City", |c| c.city.clone().unwrap_or_default()),
    ("State", |c| c.state.clone().unwrap_or_default()),
    ("Pincode", |c| c.pincode.clone().unwrap_or_default()),
    ("Occupation", |c| c.occupation.clone().unwrap_or_default()),
    ("PAN", |c| c.pan.clone().unwrap_or_default()),
    ("Active policies", |c| c.active_policies.to_string()),
    ("Total policies", |c| c.total_policies.to_string()),
    ("Next expiry", |c| c.next_expiry.clone().unwrap_or_default()),
    ("Reminders", |c| {
        if c.reminders_opted_out {
            "Opted out".into()
        } else {
            "On".into()
        }
    }),
    ("Notes", |c| c.notes.clone().unwrap_or_default()),
];

pub fn export_policies(rows: &[Policy], path: &Path) -> AppResult<usize> {
    let headers: Vec<&str> = POLICY_COLUMNS.iter().map(|(h, _)| *h).collect();
    let values: Vec<Vec<String>> = rows
        .iter()
        .map(|row| POLICY_COLUMNS.iter().map(|(_, get)| get(row)).collect())
        .collect();
    write(path, "Policies", &headers, &values)?;
    Ok(rows.len())
}

pub fn export_clients(rows: &[Client], path: &Path) -> AppResult<usize> {
    let headers: Vec<&str> = CLIENT_COLUMNS.iter().map(|(h, _)| *h).collect();
    let values: Vec<Vec<String>> = rows
        .iter()
        .map(|row| CLIENT_COLUMNS.iter().map(|(_, get)| get(row)).collect())
        .collect();
    write(path, "Clients", &headers, &values)?;
    Ok(rows.len())
}

fn write(path: &Path, sheet_name: &str, headers: &[&str], rows: &[Vec<String>]) -> AppResult<()> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("xlsx")
        .to_lowercase()
        .as_str()
    {
        "csv" => write_csv(path, headers, rows),
        "xlsx" => write_xlsx(path, sheet_name, headers, rows),
        other => Err(AppError::validation(format!(
            "Cannot export to .{other} files — choose .xlsx or .csv"
        ))),
    }
}

fn write_csv(path: &Path, headers: &[&str], rows: &[Vec<String>]) -> AppResult<()> {
    let mut writer = csv::Writer::from_path(path)?;
    writer.write_record(headers)?;
    for row in rows {
        writer.write_record(row)?;
    }
    writer.flush()?;
    Ok(())
}

fn write_xlsx(
    path: &Path,
    sheet_name: &str,
    headers: &[&str],
    rows: &[Vec<String>],
) -> AppResult<()> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet().set_name(sheet_name)?;

    let header_format = Format::new()
        .set_bold()
        .set_background_color(0x0F766E)
        .set_font_color(0xFFFFFF);

    for (index, header) in headers.iter().enumerate() {
        sheet.write_string_with_format(0, index as u16, *header, &header_format)?;
    }

    for (r, row) in rows.iter().enumerate() {
        for (c, value) in row.iter().enumerate() {
            // Numbers go in as numbers so totals and sorting work in Excel.
            match value.parse::<f64>() {
                Ok(number) if !value.is_empty() && value.len() < 15 => {
                    sheet.write_number((r + 1) as u32, c as u16, number)?;
                }
                _ => {
                    sheet.write_string((r + 1) as u32, c as u16, value)?;
                }
            }
        }
    }

    sheet.set_freeze_panes(1, 0)?;
    sheet.autofilter(0, 0, rows.len().max(1) as u32, (headers.len() - 1) as u16)?;
    for index in 0..headers.len() {
        sheet.set_column_width(index as u16, 18)?;
    }

    workbook.save(path)?;
    Ok(())
}

fn number(value: Option<f64>) -> String {
    match value {
        Some(v) if v.fract() == 0.0 => format!("{}", v as i64),
        Some(v) => format!("{v:.2}"),
        None => String::new(),
    }
}

fn title_case(value: &str) -> String {
    let spaced = value.replace('_', " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
