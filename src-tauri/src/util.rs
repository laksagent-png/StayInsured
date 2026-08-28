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

/// The day a term of `years` bought from `start` runs out: the same date that
/// many years on, less a day. A 29 February start falls back to the 28th, which
/// is the day the insurer writes.
pub fn expiry_after(start: &str, years: i64) -> Option<String> {
    let d = NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
    let year = d.year() + i32::try_from(years).ok()?;
    let next = NaiveDate::from_ymd_opt(year, d.month(), d.day())
        .or_else(|| NaiveDate::from_ymd_opt(year, d.month(), 28))?;
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

/// The riders a health policy can be sold with, matching the words the
/// add-policy screen offers. Stored on `policies.riders` as a comma-separated
/// list in this order, so two policies carrying the same set read the same.
pub const RIDERS: &[&str] = &[
    "safeguard",
    "safeguard_plus",
    "pa_main_member",
    "future_ready",
    "fast_forwarded",
];

/// What a motor policy is written on, matching the `CHECK` on
/// `policies.vehicle_type`. Two of them bring a further question with them:
/// a goods carrying vehicle is rated on its gross weight and a passenger
/// vehicle on its seats.
pub const VEHICLE_TYPES: &[&str] = &["pvt_car", "goods_carrying", "passenger", "two_wheeler"];

/// Which covers a motor policy was sold with. Not `POLICY_TYPES`, which says
/// how a year was written; a motor policy has both answers at once.
pub const COVER_TYPES: &[&str] = &[
    "bundle_1_3",
    "bundle_3_3",
    "standalone_od",
    "package",
    "liability",
];

/// Whether the cover is one life or a family sharing a sum insured.
pub const PLAN_TYPES: &[&str] = &["individual", "family_floater"];

/// How the year was written. Not a status: see `006_health_details.sql`.
pub const POLICY_TYPES: &[&str] = &["fresh", "portability", "renewal"];

/// The most years of health cover sold in one go.
pub const MAX_TERM: i64 = 5;

/// Puts a rider list into `RIDERS` order and drops anything repeated, so that
/// the stored text depends on the set chosen rather than the order of clicking.
/// `None` when nothing is left, which is what an empty list means.
pub fn canonical_riders(chosen: &[String]) -> Option<String> {
    let ordered: Vec<&str> = RIDERS
        .iter()
        .copied()
        .filter(|rider| chosen.iter().any(|c| c.trim() == *rider))
        .collect();
    (!ordered.is_empty()).then(|| ordered.join(","))
}

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

/// How the agency says a rider's name, which `title_case` cannot work out from
/// the stored word. Kept beside `riderLabels` in `src/lib/format.ts`.
pub fn rider_label(rider: &str) -> &str {
    match rider {
        "safeguard" => "Safeguard",
        "safeguard_plus" => "Safeguard +",
        "pa_main_member" => "PA to main member",
        "future_ready" => "Future Ready",
        "fast_forwarded" => "Fast Forwarded",
        other => other,
    }
}

/// How the agency says a vehicle type. Kept beside `vehicleTypeLabels` in
/// `src/lib/format.ts`.
pub fn vehicle_type_label(vehicle_type: &str) -> &str {
    match vehicle_type {
        "pvt_car" => "Private car",
        "goods_carrying" => "Goods carrying vehicle",
        "passenger" => "Passenger vehicle",
        "two_wheeler" => "Two wheeler",
        other => other,
    }
}

/// How the agency says a cover type. The bundles are written the way the
/// proposal writes them — 1+3 and 3+3 — which no rule could derive from the
/// stored word.
pub fn cover_type_label(cover_type: &str) -> &str {
    match cover_type {
        "bundle_1_3" => "Bundle (1+3)",
        "bundle_3_3" => "Bundle (3+3)",
        "standalone_od" => "Standalone OD",
        "package" => "Package",
        "liability" => "Liability",
        other => other,
    }
}

/// Whether the cover type sold includes own damage. A policy with no cover type
/// covers neither half, so it has no own damage period and no own damage
/// premium until the agent says which covers were bought.
///
/// An empty answer is no answer: an unanswered box arrives as `""` from a form
/// and as `None` from a book that predates the question, and neither says a
/// cover was sold. The repositories run `blank_to_none` before asking, but the
/// two words this is asked in have to mean the same thing wherever it is asked
/// from — that is what makes this one definition rather than a convention every
/// caller has to remember.
pub fn cover_has_own_damage(cover_type: Option<&str>) -> bool {
    matches!(cover_type, Some(word) if !word.is_empty() && word != "liability")
}

/// Whether the cover type sold includes third party. Same reasoning as
/// `cover_has_own_damage`, empty answer included.
pub fn cover_has_third_party(cover_type: Option<&str>) -> bool {
    matches!(cover_type, Some(word) if !word.is_empty() && word != "standalone_od")
}

pub fn normalise_gender(raw: &str) -> Option<String> {
    match raw.trim().to_lowercase().as_str() {
        "m" | "male" | "man" => Some("male".into()),
        "f" | "female" | "woman" => Some("female".into()),
        "" => None,
        _ => Some("other".into()),
    }
}

/// The words `clients.kind` accepts, matching its `CHECK`.
pub const CLIENT_KINDS: &[&str] = &["individual", "company"];

/// What a spreadsheet or a form means by the entity it is describing. Anything
/// unrecognised is a person, because that is what the book held before companies
/// were in it and a file that says nothing is describing the old kind.
pub fn normalise_client_kind(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "company" | "corporate" | "corporation" | "business" | "firm" | "entity"
        | "organisation" | "organization" | "employer" | "pvt ltd" | "private limited" | "ltd"
        | "llp" => "company".into(),
        _ => "individual".into(),
    }
}

/// The words `client_relations.relationship` accepts, matching its `CHECK`.
pub const RELATIONSHIPS: &[&str] = &[
    "spouse", "son", "daughter", "father", "mother", "brother", "sister", "other",
];

/// The relationship a word stands for, or `None` when the word is not one at all.
///
/// `normalise_relationship` answers `other` for everything it does not know, which
/// cannot tell a stranger's name from a relationship written beside it. Telling
/// those apart is what this is for, so it is the one place the vocabulary lives.
/// `self` is in it because registers write it, though it is not a relationship the
/// schema stores — see `is_self_relationship`.
pub fn recognised_relationship(raw: &str) -> Option<&'static str> {
    Some(match raw.trim().to_lowercase().as_str() {
        "spouse" | "wife" | "husband" | "partner" => "spouse",
        "son" | "child (male)" => "son",
        "daughter" | "child (female)" => "daughter",
        "father" | "dad" | "papa" => "father",
        "mother" | "mom" | "mum" | "mummy" => "mother",
        "brother" | "bro" => "brother",
        "sister" | "sis" => "sister",
        "self" | "proposer" | "primary" | "insured" | "policyholder" => "self",
        _ => return None,
    })
}

/// Whether a spreadsheet or an operator means the policyholder themselves rather
/// than a second person. There is no `self` relationship: a client does not
/// relate to themselves, so a life named this way resolves to the client's own
/// row.
pub fn is_self_relationship(raw: Option<&str>) -> bool {
    raw.and_then(recognised_relationship) == Some("self")
}

pub fn normalise_relationship(raw: &str) -> String {
    match recognised_relationship(raw) {
        Some("self") | None => "other".into(),
        Some(word) => word.into(),
    }
}

/// Splits a cover list entry into the person and the relationship written beside
/// them. A register writes `Sneha Sharma (Wife)`, `Wife - Sneha Sharma` or
/// `Sneha Sharma - Wife`, and all three used to be read as the whole name: the
/// book gained a client called "Sneha Sharma (wife)", and the one fact the file
/// was offering about her was thrown away.
///
/// Only a word the app recognises is taken as a relationship, so a bracket or a
/// hyphen inside somebody's own name stays part of it. An entry that is nothing
/// but a relationship comes back with an empty name, because there is no person
/// in it — the caller decides what to do about that.
pub fn split_relationship(entry: &str) -> (&str, Option<&'static str>) {
    let text = entry.trim();

    if let Some(whole) = recognised_relationship(text) {
        return ("", Some(whole));
    }

    // Trailing bracket: the common shape, and unambiguous.
    if let Some(open) = text.rfind(['(', '[']) {
        let closer = if text[open..].starts_with('(') {
            ')'
        } else {
            ']'
        };
        if let Some(inner) = text[open + 1..].trim_end().strip_suffix(closer) {
            if let Some(word) = recognised_relationship(inner) {
                return (text[..open].trim(), Some(word));
            }
        }
    }

    // A separator, with the word on either side of it. The name is whatever is
    // left, which is why an unrecognised word is left alone rather than guessed
    // at: "Anne-Marie Fernandes" is a name, not a relationship and a name.
    for separator in [':', '-', '\u{2013}', '\u{2014}'] {
        if let Some((left, right)) = text.split_once(separator) {
            if let Some(word) = recognised_relationship(left) {
                if !right.trim().is_empty() {
                    return (right.trim(), Some(word));
                }
            }
        }
        if let Some((left, right)) = text.rsplit_once(separator) {
            if let Some(word) = recognised_relationship(right) {
                if !left.trim().is_empty() {
                    return (left.trim(), Some(word));
                }
            }
        }
    }

    (text, None)
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
