//! Personal vault item fields. Every value in this catalog is encrypted.
use crate::model::ItemModule;
use anyhow::{Result, ensure};

pub const CARD_FIELDS: &[&str] = &[
    "cardholderName",
    "cardNumber",
    "cardBrand",
    "cardExpMonth",
    "cardExpYear",
    "cardSecurityCode",
];
pub const IDENTITY_FIELDS: &[&str] = &[
    "identityTitle",
    "firstName",
    "middleName",
    "lastName",
    "company",
    "email",
    "phone",
    "address1",
    "address2",
    "address3",
    "city",
    "state",
    "postalCode",
    "country",
    "passportNumber",
    "licenseNumber",
    "nationalId",
];

pub fn personal_field(kind: &str) -> bool {
    CARD_FIELDS.contains(&kind) || IDENTITY_FIELDS.contains(&kind) || kind == "secureNote"
}

pub fn infer(modules: &[ItemModule]) -> &'static str {
    let has = |kind: &str| modules.iter().any(|m| m.kind == kind);
    if CARD_FIELDS.iter().any(|kind| has(kind)) {
        "card"
    } else if IDENTITY_FIELDS.iter().any(|kind| has(kind)) {
        "identity"
    } else if has("secureNote") {
        "secureNote"
    } else if has("host") || has("privateKey") {
        "ssh"
    } else if has("apiCredential") {
        "api"
    } else if has("username") || has("password") {
        "login"
    } else {
        "custom"
    }
}

pub fn normalize(requested: &str, modules: &[ItemModule]) -> Result<String> {
    let kind = if requested.is_empty() {
        infer(modules)
    } else {
        requested
    };
    ensure!(
        [
            "login",
            "card",
            "identity",
            "secureNote",
            "ssh",
            "api",
            "custom"
        ]
        .contains(&kind),
        "Unsupported item type"
    );
    Ok(kind.to_owned())
}
