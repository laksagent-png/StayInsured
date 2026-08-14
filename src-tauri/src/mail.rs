//! Sending mail through the agency's own mailbox.
//!
//! The agency sends from its own SMTP account rather than a service account of
//! ours, so replies land where the client expects and there is no third party
//! holding the book's contact list.

use lettre::message::{header::ContentType, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::repo::settings;
use crate::vault;

/// How the connection is protected. `starttls` upgrades a plain connection and
/// is what most providers want on port 587; `tls` is implicit TLS on 465.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encryption {
    StartTls,
    Tls,
    None,
}

impl Encryption {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "tls" | "ssl" | "implicit" => Self::Tls,
            "none" | "plain" | "" => Self::None,
            _ => Self::StartTls,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_name: String,
    pub from_email: String,
    pub encryption: Encryption,
}

impl SmtpConfig {
    /// Everything but the password comes from `settings`; the password lives in
    /// the OS keychain.
    pub fn load(conn: &Connection) -> AppResult<Self> {
        Ok(Self {
            host: settings::get_or(conn, "smtp_host", "").trim().to_string(),
            port: settings::get_i64(conn, "smtp_port", 587).clamp(1, 65_535) as u16,
            username: settings::get_or(conn, "smtp_username", "").trim().to_string(),
            password: vault::recall_smtp_password().unwrap_or_default(),
            from_name: settings::get_or(conn, "smtp_from_name", "")
                .trim()
                .to_string(),
            from_email: settings::get_or(conn, "smtp_from_email", "")
                .trim()
                .to_string(),
            encryption: Encryption::parse(&settings::get_or(conn, "smtp_encryption", "starttls")),
        })
    }

    /// The minimum needed to attempt a send. Checked before queueing so the
    /// operator is told to finish setup instead of collecting failed rows.
    pub fn is_usable(&self) -> bool {
        !self.host.is_empty() && !self.from_email.is_empty()
    }

    fn sender(&self) -> AppResult<Mailbox> {
        let address = self
            .from_email
            .parse()
            .map_err(|_| AppError::mail(format!("`{}` is not a valid address", self.from_email)))?;
        Ok(Mailbox::new(
            Some(if self.from_name.is_empty() {
                self.from_email.clone()
            } else {
                self.from_name.clone()
            }),
            address,
        ))
    }
}

/// One message ready to go out.
pub struct Outgoing {
    pub to_name: String,
    pub to_email: String,
    pub subject: String,
    pub html: String,
}

pub struct Mailer {
    transport: SmtpTransport,
    from: Mailbox,
}

impl Mailer {
    pub fn connect(config: &SmtpConfig) -> AppResult<Self> {
        if config.host.is_empty() {
            return Err(AppError::mail("No mail server is set up yet."));
        }

        let mut builder = SmtpTransport::builder_dangerous(&config.host).port(config.port);

        builder = match config.encryption {
            Encryption::None => builder.tls(Tls::None),
            Encryption::StartTls => builder.tls(Tls::Required(tls_params(&config.host)?)),
            Encryption::Tls => builder.tls(Tls::Wrapper(tls_params(&config.host)?)),
        };

        if !config.username.is_empty() {
            builder = builder.credentials(Credentials::new(
                config.username.clone(),
                config.password.clone(),
            ));
        }

        Ok(Self {
            transport: builder.build(),
            from: config.sender()?,
        })
    }

    /// Opens a connection and authenticates without sending anything, which is
    /// what the **Send test** button needs to report a usable answer.
    pub fn check(&self) -> AppResult<()> {
        match self.transport.test_connection() {
            Ok(true) => Ok(()),
            Ok(false) => Err(AppError::mail("The mail server refused the connection.")),
            Err(e) => Err(AppError::mail(describe(&e))),
        }
    }

    pub fn send(&self, message: &Outgoing) -> AppResult<()> {
        let to_address = message
            .to_email
            .parse()
            .map_err(|_| AppError::mail(format!("`{}` is not a valid address", message.to_email)))?;
        let recipient = Mailbox::new(Some(message.to_name.clone()), to_address);

        // Both parts are sent: some clients, and some corporate gateways, will
        // only show the plain text one.
        let email = Message::builder()
            .from(self.from.clone())
            .to(recipient)
            .subject(&message.subject)
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(to_plain_text(&message.html)),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(message.html.clone()),
                    ),
            )
            .map_err(|e| AppError::mail(e.to_string()))?;

        self.transport
            .send(&email)
            .map(|_| ())
            .map_err(|e| AppError::mail(describe(&e)))
    }
}

fn tls_params(host: &str) -> AppResult<TlsParameters> {
    TlsParameters::new(host.to_string()).map_err(|e| AppError::mail(describe(&e)))
}

/// lettre's own messages name internals the operator cannot act on, so the
/// common failures are translated into something worth reading.
fn describe(err: &lettre::transport::smtp::Error) -> String {
    let detail = err.to_string();
    if err.is_client() && detail.contains("authentication") {
        return "The server rejected the username or password.".into();
    }
    if err.is_transient() {
        return format!("The server asked us to try again later: {detail}");
    }
    if err.is_permanent() {
        return format!("The server refused the message: {detail}");
    }
    detail
}

/// A readable plain-text fallback from the HTML body. Block-level tags become
/// line breaks so the text keeps the shape of the message rather than running
/// into one paragraph.
pub fn to_plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '<' {
            out.push(ch);
            continue;
        }

        let mut tag = String::new();
        for inner in chars.by_ref() {
            if inner == '>' {
                break;
            }
            tag.push(inner);
        }

        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();

        match name.as_str() {
            "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "table" => out.push('\n'),
            // Only the opening tag separates cells, or every row would come
            // out with the columns double-spaced.
            "td" | "th" if !closing => out.push('\t'),
            _ => {}
        }
    }

    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    let mut lines: Vec<String> = Vec::new();
    for line in decoded.lines() {
        let trimmed = line.trim().to_string();
        // Collapse runs of blank lines left behind by nested tags.
        if trimmed.is_empty() && lines.last().map(|l: &String| l.is_empty()).unwrap_or(true) {
            continue;
        }
        lines.push(trimmed);
    }
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}
