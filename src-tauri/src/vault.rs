use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const KEYCHAIN_SERVICE: &str = "com.stayinsured.app";
const KEY_ACCOUNT: &str = "database-key";
/// The mail password is kept beside the database key rather than in `settings`,
/// so it never travels inside an export or a backup copied to a cloud folder.
const SMTP_ACCOUNT: &str = "smtp-password";

/// Sits next to the database in clear text. It holds no secret — only the
/// parameters needed to turn the password back into the key, which is why it can
/// be read before anything is decrypted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub version: u32,
    pub salt_hex: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Vault {
    /// ~64 MiB and 3 passes: comfortably above brute-force convenience while
    /// staying under a second on the kind of machine this app runs on.
    pub fn create() -> Self {
        let mut salt = [0u8; 16];
        rand::rng().fill_bytes(&mut salt);
        Self {
            version: 1,
            salt_hex: to_hex(&salt),
            m_cost: 65_536,
            t_cost: 3,
            p_cost: 1,
        }
    }

    pub fn exists(path: &Path) -> bool {
        path.exists()
    }

    pub fn load(path: &Path) -> AppResult<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        std::fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    /// Stretches the password into the 32-byte database key.
    pub fn derive_key(&self, password: &str) -> AppResult<String> {
        let salt = from_hex(&self.salt_hex)?;
        let params = Params::new(self.m_cost, self.t_cost, self.p_cost, Some(32))
            .map_err(|e| AppError::other(format!("invalid key parameters: {e}")))?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

        let mut key = [0u8; 32];
        argon
            .hash_password_into(password.as_bytes(), &salt, &mut key)
            .map_err(|e| AppError::other(format!("key derivation failed: {e}")))?;
        Ok(to_hex(&key))
    }
}

/// Password hash stored in the users table. Separate from the database key so
/// that adding staff accounts later does not require re-keying the database.
pub fn hash_password(password: &str) -> AppResult<String> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    let mut raw = [0u8; 16];
    rand::rng().fill_bytes(&mut raw);
    let salt = SaltString::encode_b64(&raw)
        .map_err(|e| AppError::other(format!("cannot build salt: {e}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::other(format!("cannot hash password: {e}")))
}

pub fn verify_password(password: &str, phc: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    PasswordHash::new(phc)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

pub fn remember_key(key_hex: &str) -> AppResult<()> {
    remember(KEY_ACCOUNT, key_hex)
}

pub fn recall_key() -> Option<String> {
    recall(KEY_ACCOUNT)
}

pub fn forget_key() -> AppResult<()> {
    forget(KEY_ACCOUNT)
}

pub fn remember_smtp_password(password: &str) -> AppResult<()> {
    remember(SMTP_ACCOUNT, password)
}

pub fn recall_smtp_password() -> Option<String> {
    recall(SMTP_ACCOUNT)
}

pub fn forget_smtp_password() -> AppResult<()> {
    forget(SMTP_ACCOUNT)
}

fn remember(account: &str, secret: &str) -> AppResult<()> {
    entry(account)?
        .set_password(secret)
        .map_err(|e| AppError::other(format!("could not save to the OS keychain: {e}")))
}

fn recall(account: &str) -> Option<String> {
    entry(account).ok()?.get_password().ok()
}

fn forget(account: &str) -> AppResult<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::other(format!("could not clear the keychain: {e}"))),
    }
}

fn entry(account: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|e| AppError::other(format!("keychain unavailable: {e}")))
}

pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        out.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    out
}

pub fn from_hex(text: &str) -> AppResult<Vec<u8>> {
    if text.len() % 2 != 0 {
        return Err(AppError::other("malformed hex value"));
    }
    (0..text.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&text[i..i + 2], 16)
                .map_err(|_| AppError::other("malformed hex value"))
        })
        .collect()
}
