use chrono::{Datelike, Duration, Local, NaiveDate};

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn today_iso() -> String {
    today().format("%Y-%m-%d").to_string()
}

pub fn iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// Accepts the date shapes that turn up in real agency spreadsheets and returns
/// an ISO string. Day-first is assumed for ambiguous values because the target
/// users write DD/MM/YYYY.
pub fn parse_date(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    // Already ISO, possibly with a time component.
    if let Some(head) = text.split(['T', ' ']).next() {
        if let Ok(d) = NaiveDate::parse_from_str(head, "%Y-%m-%d") {
            return Some(iso(d));
        }
    }

    for format in [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d-%b-%Y",
        "%d %b %Y",
        "%d-%B-%Y",
        "%d %B %Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%Y/%m/%d",
    ] {
        if let Ok(d) = NaiveDate::parse_from_str(text, format) {
            return Some(iso(d));
        }
    }

    // Excel stores dates as a day count from 1899-12-30.
    if let Ok(serial) = text.parse::<f64>() {
        if (20_000.0..80_000.0).contains(&serial) {
            let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
            return Some(iso(base + Duration::days(serial.trunc() as i64)));
        }
    }

    None
}

pub fn excel_serial_to_iso(serial: f64) -> Option<String> {
    let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
    Some(iso(base + Duration::days(serial.trunc() as i64)))
}

/// Strips currency symbols, thousands separators and stray text from a number.
/// "₹10,00,000" and "Rs. 24,500.50" both come through intact.
pub fn parse_number(raw: &str) -> Option<f64> {
    let negative = raw.trim_start().starts_with('-') || raw.contains('(');
    let mut cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();

    // Leading dots come from prefixes like "Rs." rather than from the number.
    while cleaned.starts_with('.') {
        cleaned.remove(0);
    }

    // Several dots means they are grouping separators; only the last can be decimal.
    if cleaned.matches('.').count() > 1 {
        let split = cleaned.rfind('.').unwrap();
        let (whole, fraction) = cleaned.split_at(split);
        cleaned = format!("{}{}", whole.replace('.', ""), fraction);
    }

    if cleaned.trim_matches('.').is_empty() {
        return None;
    }

    cleaned
        .parse::<f64>()
        .ok()
        .map(|value| if negative { -value } else { value })
}

/// Renders an ISO date the way the agency writes it, following the
/// `date_format` setting. Anything unrecognised falls back to day-first, which
/// is what the seeded default uses.
pub fn format_date(iso_date: &str, pattern: &str) -> String {
    let Ok(date) = NaiveDate::parse_from_str(iso_date, "%Y-%m-%d") else {
        return iso_date.to_string();
    };
    let strftime = match pattern.trim() {
        "yyyy-MM-dd" => "%Y-%m-%d",
        "MM/dd/yyyy" => "%m/%d/%Y",
        "dd-MM-yyyy" => "%d-%m-%Y",
        "dd MMM yyyy" => "%d %b %Y",
        _ => "%d/%m/%Y",
    };
    date.format(strftime).to_string()
}

/// Money in the Indian convention: a group of three, then groups of two, so
/// 1000000 reads as 10,00,000 rather than 1,000,000.
pub fn format_money(amount: f64, currency: &str) -> String {
    let symbol = match currency.trim().to_ascii_uppercase().as_str() {
        "INR" | "" => "₹",
        "USD" => "$",
        "EUR" => "€",
        "GBP" => "£",
        other => return format!("{other} {}", group_indian(amount)),
    };
    format!("{symbol}{}", group_indian(amount))
}

fn group_indian(amount: f64) -> String {
    let negative = amount < 0.0;
    let rounded = (amount.abs() * 100.0).round() / 100.0;
    let whole = rounded.trunc() as i64;
    let paise = ((rounded - rounded.trunc()) * 100.0).round() as i64;

    let digits = whole.to_string();
    let grouped = if digits.len() <= 3 {
        digits
    } else {
        let (head, tail) = digits.split_at(digits.len() - 3);
        let mut parts: Vec<String> = Vec::new();
        let head_chars: Vec<char> = head.chars().collect();
        let mut index = head_chars.len();
        while index > 2 {
            parts.push(head_chars[index - 2..index].iter().collect());
            index -= 2;
        }
        parts.push(head_chars[..index].iter().collect());
        parts.reverse();
        format!("{},{tail}", parts.join(","))
    };

    let body = if paise > 0 {
        format!("{grouped}.{paise:02}")
    } else {
        grouped
    };
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

/// Whole days from today until the date, negative once it is in the past.
pub fn days_until(iso_date: &str) -> Option<i64> {
    let date = NaiveDate::parse_from_str(iso_date, "%Y-%m-%d").ok()?;
    Some((date - today()).num_days())
}

/// Adds a year (minus a day) to a start date, the usual annual policy term.
pub fn default_expiry(start: &str) -> Option<String> {
    let d = NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
    let next = NaiveDate::from_ymd_opt(d.year() + 1, d.month(), d.day())
        .or_else(|| NaiveDate::from_ymd_opt(d.year() + 1, d.month(), 28))?;
    Some(iso(next - Duration::days(1)))
}

pub const CATEGORIES: &[&str] = &[
    "health",
    "life",
    "motor",
    "travel",
    "home",
    "personal_accident",
    "critical_illness",
    "other",
];

/// Maps whatever the spreadsheet calls a product line onto our category set.
pub fn normalise_category(raw: &str) -> String {
    let text = raw.trim().to_lowercase();
    if text.is_empty() {
        return "other".into();
    }
    if CATEGORIES.contains(&text.as_str()) {
        return text;
    }
    let has = |needles: &[&str]| needles.iter().any(|n| text.contains(n));

    if has(&[
        "mediclaim",
        "health",
        "hospital",
        "family floater",
        "medical",
    ]) {
        "health".into()
    } else if has(&[
        "term",
        "endowment",
        "ulip",
        "life",
        "money back",
        "pension",
        "annuity",
    ]) {
        "life".into()
    } else if has(&[
        "motor",
        "car",
        "bike",
        "two wheeler",
        "2 wheeler",
        "vehicle",
        "auto",
    ]) {
        "motor".into()
    } else if has(&["travel", "trip", "international", "overseas", "student"]) {
        "travel".into()
    } else if has(&["home", "house", "property", "fire", "householder"]) {
        "home".into()
    } else if has(&["accident", "pa "]) {
        "personal_accident".into()
    } else if has(&["critical", "cancer"]) {
        "critical_illness".into()
    } else {
        "other".into()
    }
}

pub fn category_label(category: &str) -> &'static str {
    match category {
        "health" => "Health",
        "life" => "Life",
        "motor" => "Motor",
        "travel" => "Travel / International",
        "home" => "Home",
        "personal_accident" => "Personal Accident",
        "critical_illness" => "Critical Illness",
        _ => "Other",
    }
}

pub fn normalise_gender(raw: &str) -> Option<String> {
    match raw.trim().to_lowercase().as_str() {
        "m" | "male" | "man" => Some("male".into()),
        "f" | "female" | "woman" => Some("female".into()),
        "" => None,
        _ => Some("other".into()),
    }
}

pub fn normalise_relationship(raw: &str) -> String {
    let text = raw.trim().to_lowercase();
    match text.as_str() {
        "self" | "proposer" | "primary" => "self".into(),
        "spouse" | "wife" | "husband" | "partner" => "spouse".into(),
        "son" | "child (male)" => "son".into(),
        "daughter" | "child (female)" => "daughter".into(),
        "father" | "dad" => "father".into(),
        "mother" | "mom" | "mum" => "mother".into(),
        _ => "other".into(),
    }
}

/// Keeps only digits (and a leading +) from a phone number.
pub fn normalise_phone(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let plus = trimmed.starts_with('+');
    let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    Some(if plus { format!("+{digits}") } else { digits })
}

pub fn looks_like_email(value: &str) -> bool {
    let v = value.trim();
    let mut parts = v.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
                && !v.contains(char::is_whitespace)
        }
        _ => false,
    }
}

/// Title-cases a name without mangling initials or hyphenated parts.
pub fn tidy_name(raw: &str) -> String {
    raw.split_whitespace()
        .map(|word| {
            if word.chars().all(|c| c.is_uppercase() || !c.is_alphabetic()) && word.len() <= 3 {
                word.to_string()
            } else {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => {
                        first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
