use crate::{
    crypto::{decrypt_bytes, encrypt_bytes},
    model::{ImportSummary, PortableConnection, SecretBundle, SecretEnvelope},
    vault::Vault,
};
use anyhow::{Context, Result, bail};
use atomic_write_file::AtomicWriteFile;
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};
use zeroize::Zeroize;

const AUTOMATIC_BACKUP_AAD: &[u8] = b"kru/backup/v3";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    format: String,
    version: u8,
    cipher: String,
    unlock_key: String,
    payload: SecretEnvelope,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload {
    format: String,
    version: u8,
    created_at: String,
    connections: Vec<BackupConnection>,
}

#[derive(Serialize, Deserialize)]
struct BackupConnection {
    connection: PortableConnection,
    secrets: SecretBundle,
}

pub fn export_to_file(vault: &Vault, path: impl AsRef<Path>) -> Result<()> {
    reject_vault_internal_export_path(vault, path.as_ref())?;
    let payload = backup_payload(vault)?;
    let mut plain = serde_json::to_vec(&payload).context("Unable to serialize backup")?;
    let mut key = [0_u8; 32];
    getrandom::fill(&mut key).map_err(|error| anyhow::anyhow!("Unable to generate backup key:{error}"))?;
    let encrypted = encrypt_bytes(&key, &plain, AUTOMATIC_BACKUP_AAD);
    plain.zeroize();
    let payload = encrypted?;
    let unlock_key = STANDARD_NO_PAD.encode(key);
    key.zeroize();
    let file = BackupFile {
        format: "mcp-vault-backup".to_owned(),
        version: 3,
        cipher: "xchacha20poly1305".to_owned(),
        unlock_key,
        payload,
    };
    write_backup_file(path.as_ref(), &file)
}

fn backup_payload(vault: &Vault) -> Result<BackupPayload> {
    let connections = vault
        .export_connections()?
        .into_iter()
        .map(|(connection, secrets)| BackupConnection {
            connection,
            secrets,
        })
        .collect();
    Ok(BackupPayload {
        format: "mcp-vault-portable".to_owned(),
        version: 3,
        created_at: Utc::now().to_rfc3339(),
        connections,
    })
}

fn write_backup_file(path: &Path, file: &BackupFile) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(&file).context("Unable to generate backup file")?;
    let mut writer = AtomicWriteFile::open(path).context("Unable to create backup file")?;
    writer.write_all(&bytes).context("Unable to write backup file")?;
    writer.commit().context("Unable to commit backup file")?;
    Ok(())
}

fn reject_vault_internal_export_path(vault: &Vault, path: &Path) -> Result<()> {
    let data_dir = fs::canonicalize(vault.data_dir()).context("Unable to confirm vault directory")?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .context("Unable to confirm current directory")?
            .join(path)
    };
    let target = if absolute.exists() {
        fs::canonicalize(&absolute).context("Unable to confirm backup destination path")?
    } else {
        let parent = absolute.parent().context("Invalid backup destination path")?;
        let name = absolute.file_name().context("Invalid backup file name")?;
        fs::canonicalize(parent)
            .context("Unable to confirm backup destination directory")?
            .join(name)
    };
    if target.starts_with(&data_dir) {
        bail!("Backup files cannot be saved inside the KRU data directory; choose another location");
    }
    Ok(())
}

pub fn import_from_file(vault: &Vault, path: impl AsRef<Path>) -> Result<ImportSummary> {
    let file = read_backup_file(path.as_ref())?;
    validate_backup_file(&file)?;
    let mut plain = decrypt_automatic_backup(&file)?;
    let result = merge_backup_payload(vault, &plain);
    plain.zeroize();
    result
}

fn read_backup_file(path: &Path) -> Result<BackupFile> {
    let bytes = fs::read(path).context("Unable to read backup file")?;
    serde_json::from_slice(&bytes).context("Invalid backup file format")
}

fn validate_backup_file(file: &BackupFile) -> Result<()> {
    if file.format != "mcp-vault-backup" || file.version != 3 {
        bail!("Unsupported backup file version");
    }
    if file.cipher != "xchacha20poly1305" {
        bail!("Unsupported backup encryption method");
    }
    Ok(())
}

fn decrypt_automatic_backup(file: &BackupFile) -> Result<Vec<u8>> {
    let decoded = STANDARD_NO_PAD
        .decode(&file.unlock_key)
        .context("Invalid backup auto-unlock material")?;
    let mut key: [u8; 32] = decoded
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid backup auto-unlock material length"))?;
    let result = decrypt_bytes(&key, &file.payload, AUTOMATIC_BACKUP_AAD);
    key.zeroize();
    result
}

fn merge_backup_payload(vault: &Vault, plain: &[u8]) -> Result<ImportSummary> {
    let payload: BackupPayload = serde_json::from_slice(plain).context("Backup contents are corrupted")?;
    if payload.format != "mcp-vault-portable" || payload.version != 3 {
        bail!("Unsupported backup content version");
    }
    vault.merge_connections(
        payload
            .connections
            .into_iter()
            .map(|item| (item.connection, item.secrets))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ConnectionInput, SecretBundle};
    use tempfile::tempdir;
    use uuid::Uuid;

    fn input(id: Uuid, name: &str, token: &str) -> ConnectionInput {
        let mut secrets = SecretBundle::default();
        secrets
            .named_secrets
            .insert("apiCredential".into(), token.to_owned());
        ConnectionInput {
            id: Some(id),
            modules: vec![
                crate::model::ItemModule {
                    kind: "url".into(),
                    value: "https://api.example.test/v1/".into(),
                    ..Default::default()
                },
                crate::model::ItemModule {
                    kind: "apiCredential".into(),
                    ..Default::default()
                },
            ],
            name: name.into(),
            enabled: true,
            description: String::new(),
            http_auth_type: "bearer".into(),
            private_key_import_path: String::new(),
            auth_header: "X-API-Key".into(),
            auth_location: "header".into(),
            auth_prefix: String::new(),
            api_auth_headers: vec![],
            allowed_methods: vec!["GET".into()],
            allowed_path_prefixes: vec!["/v1/".into()],
            test_path: String::new(),
            remove_secret_names: vec![],
            secrets,
        }
    }

    #[test]
    fn automatic_backup_contains_no_marker_plaintext() {
        let directory = tempdir().unwrap();
        let vault = Vault::open(directory.path().join("vault")).unwrap();
        vault
            .save_connection(input(
                Uuid::new_v4(),
                "private-service-marker",
                "marker-secret-123",
            ))
            .unwrap();
        let path = directory.path().join("test.mvault");
        export_to_file(&vault, &path).unwrap();
        let contents = fs::read_to_string(path).unwrap();
        assert!(!contents.contains("marker-secret-123"));
        assert!(!contents.contains("private_key"));
        assert!(contents.contains("xchacha20poly1305"));
        assert!(contents.contains("unlockKey"));
    }

    #[test]
    fn export_refuses_to_overwrite_files_inside_the_vault_directory() {
        let directory = tempdir().unwrap();
        let vault = Vault::open(directory.path().join("vault")).unwrap();

        for name in ["vault.json", "master.key", "vault.lock", "backup.mvault"] {
            let error = export_to_file(&vault, vault.data_dir().join(name)).unwrap_err();
            assert!(error.to_string().contains("Data directory"));
        }
    }

    #[test]
    fn import_appends_conflicts_numbers_names_and_merges_reimports() {
        let directory = tempdir().unwrap();
        let source = Vault::open(directory.path().join("source")).unwrap();
        let target = Vault::open(directory.path().join("target")).unwrap();
        let shared_id = Uuid::new_v4();
        source
            .save_connection(input(shared_id, "service", "backup-token-123"))
            .unwrap();
        source
            .save_connection(input(Uuid::new_v4(), "service(2)", "backup-token-456"))
            .unwrap();
        target
            .save_connection(input(shared_id, "service", "local-token-123"))
            .unwrap();

        let path = directory.path().join("merge.mvault");
        export_to_file(&source, &path).unwrap();
        let summary = import_from_file(&target, &path).unwrap();
        assert_eq!(summary.added, 2);
        assert_eq!(summary.merged, 0);
        let connections = target.list_connections().unwrap();
        assert_eq!(connections.len(), 3);
        assert_eq!(connections[0].name, "service");
        assert_eq!(connections[1].name, "service(2)");
        assert_eq!(connections[2].name, "service(3)");
        assert_eq!(
            target
                .get_connection(shared_id)
                .unwrap()
                .secrets
                .get("apiCredential"),
            Some("local-token-123")
        );

        let mut locally_edited = input(connections[1].id, "service(2)", "backup-token-123");
        locally_edited.description = "local note".to_owned();
        target.save_connection(locally_edited).unwrap();

        let summary = import_from_file(&target, &path).unwrap();
        assert_eq!(summary.added, 0);
        assert_eq!(summary.merged, 2);
        assert_eq!(target.list_connections().unwrap().len(), 3);
    }

    #[test]
    fn import_treats_an_existing_numbered_name_as_literal_until_the_base_exists() {
        let directory = tempdir().unwrap();
        let source = Vault::open(directory.path().join("source-numbered")).unwrap();
        let target = Vault::open(directory.path().join("target-numbered")).unwrap();
        source
            .save_connection(input(Uuid::new_v4(), "service", "shared-token"))
            .unwrap();
        source
            .save_connection(input(Uuid::new_v4(), "service(2)", "backup-token"))
            .unwrap();
        target
            .save_connection(input(Uuid::new_v4(), "service(2)", "shared-token"))
            .unwrap();

        let path = directory.path().join("numbered.mvault");
        export_to_file(&source, &path).unwrap();
        let summary = import_from_file(&target, &path).unwrap();
        assert_eq!(summary.added, 2);
        assert_eq!(summary.merged, 0);
        let names = target
            .list_connections()
            .unwrap()
            .into_iter()
            .map(|item| item.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["service(2)", "service", "service(3)"]);

        let summary = import_from_file(&target, &path).unwrap();
        assert_eq!(summary.added, 0);
        assert_eq!(summary.merged, 2);
    }
}
