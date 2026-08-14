//! Placeholder substitution for the message templates.
//!
//! `{{name}}` inserts an escaped value; `{{{name}}}` inserts raw HTML and is
//! reserved for values the app builds itself, such as the digest table. A
//! placeholder that resolves to nothing becomes an empty string rather than
//! being left in the message, because `{{client_name}}` arriving in a client's
//! inbox is worse than a gap.

use std::collections::BTreeMap;

/// Every placeholder a template may use, with the description shown beside it
/// in the editor. Kept here so the editor and the renderer cannot disagree.
pub const CATALOGUE: &[(&str, &str)] = &[
    ("client_name", "The client's full name"),
    ("client_code", "Their code, such as CL-00001"),
    ("client_email", "The address the message is going to"),
    ("client_phone", "Their phone number"),
    ("policy_number", "The policy number"),
    ("category_label", "Health, Motor, Life and so on"),
    ("insurer_name", "The insurer"),
    ("product_name", "The plan name"),
    ("start_date", "When the current year started"),
    ("expiry_date", "When cover ends"),
    (
        "days_to_expiry",
        "Whole days until expiry, negative once past",
    ),
    ("policy_year", "How many years this cover has run"),
    ("sum_insured", "Sum insured, formatted as money"),
    ("premium_amount", "Premium, formatted as money"),
    ("nominee_name", "The nominee on the policy"),
    ("vehicle_number", "Registration number, for motor policies"),
    ("provider_name", "Your agency name"),
    ("provider_email", "Your agency email"),
    ("provider_phone", "Your agency phone"),
    ("provider_address", "Your agency address"),
    ("today", "Today's date"),
    ("expiring_count", "How many policies the digest covers"),
    ("digest_table", "The digest table itself, as HTML"),
];

/// Values a template can draw on. Missing keys render as empty.
#[derive(Debug, Default, Clone)]
pub struct Context {
    values: BTreeMap<String, String>,
}

impl Context {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&mut self, key: &str, value: impl Into<String>) -> &mut Self {
        self.values.insert(key.to_string(), value.into());
        self
    }

    /// Convenience for optional columns, where absent should mean empty rather
    /// than the word "None".
    pub fn set_opt(&mut self, key: &str, value: Option<impl Into<String>>) -> &mut Self {
        self.values
            .insert(key.to_string(), value.map(Into::into).unwrap_or_default());
        self
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }
}

pub fn render(template: &str, context: &Context) -> String {
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'{' || i + 1 >= bytes.len() || bytes[i + 1] != b'{' {
            let ch = template[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }

        let raw = template[i..].starts_with("{{{");
        let open = if raw { 3 } else { 2 };
        let close = if raw { "}}}" } else { "}}" };

        match template[i + open..].find(close) {
            Some(offset) => {
                let key = template[i + open..i + open + offset].trim();
                let value = context.get(key).unwrap_or("");
                out.push_str(&if raw {
                    value.to_string()
                } else {
                    escape_html(value)
                });
                i += open + offset + close.len();
            }
            // An unclosed brace is left exactly as written rather than eating
            // the rest of the template.
            None => {
                out.push('{');
                i += 1;
            }
        }
    }

    out
}

/// The placeholders a template actually uses, in the order they appear, without
/// duplicates. Used to warn about names that resolve to nothing.
pub fn placeholders_used(template: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        let after = &rest[start..];
        let raw = after.starts_with("{{{");
        let open = if raw { 3 } else { 2 };
        let close = if raw { "}}}" } else { "}}" };

        let Some(end) = after[open..].find(close) else {
            break;
        };
        let key = after[open..open + end].trim().to_string();
        if !key.is_empty() && !found.contains(&key) {
            found.push(key);
        }
        rest = &after[open + end + close.len()..];
    }

    found
}

/// Names that are not in the catalogue, so the editor can point at a typo
/// before it goes out to a client.
pub fn unknown_placeholders(template: &str) -> Vec<String> {
    placeholders_used(template)
        .into_iter()
        .filter(|key| !CATALOGUE.iter().any(|(name, _)| name == key))
        .collect()
}

pub fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}
