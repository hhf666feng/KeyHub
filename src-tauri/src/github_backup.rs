//! Opt-in encrypted snapshots in a user-owned GitHub private repository.
//!
//! This is backup/merge-restore, not an automatic multi-writer sync protocol.
//! Only encrypted snapshots leave this device. Repository history retains older
//! ciphertext; disconnecting removes local authorization, not remote history.

use crate::{
    backup,
    crypto::{decrypt_bytes, encrypt_bytes},
    model::{ImportSummary, SecretEnvelope},
    vault::Vault,
};
use anyhow::{Context, Result, bail};
use atomic_write_file::AtomicWriteFile;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use chrono::Utc;
use reqwest::{
    Client, Method, Response, StatusCode,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha1::{Digest, Sha1};
use std::{fs, io::Write, time::Duration};
use url::Url;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const CLOUD_FILE: &str = "openkeylet.vault.json";
const LOCAL_FILE: &str = "github-backup.json";
const CLOUD_FORMAT: &str = "openkeylet-cloud-backup";
const LOCAL_FORMAT: &str = "openkeylet-github-device";
const CLOUD_AAD: &[u8] = b"openkeylet/cloud-backup/v1";
const MAX_CLOUD_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_CLOUD_BYTES * 2;

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInput {
    pub repository: String,
    pub token: String,
    pub recovery_key: String,
    pub mode: String,
    pub recovery_key_saved: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub connected: bool,
    pub repository: String,
    pub branch: String,
    pub needs_restore: bool,
    pub has_remote_backup: bool,
    pub last_backup_at: Option<String>,
    pub last_restore_at: Option<String>,
    pub remote_backup_at: Option<String>,
    pub remote_item_count: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub summary: ImportSummary,
    pub status: BackupStatus,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
struct DeviceConfig {
    format: String,
    owner: String,
    repo: String,
    repository_id: u64,
    branch: String,
    token: String,
    recovery_key: String,
    base_sha: Option<String>,
    needs_restore: bool,
    has_remote_backup: bool,
    last_backup_at: Option<String>,
    last_restore_at: Option<String>,
    remote_backup_at: Option<String>,
    remote_item_count: Option<usize>,
}

impl DeviceConfig {
    fn status(&self) -> BackupStatus {
        BackupStatus {
            connected: true,
            repository: format!("{}/{}", self.owner, self.repo),
            branch: self.branch.clone(),
            needs_restore: self.needs_restore,
            has_remote_backup: self.has_remote_backup,
            last_backup_at: self.last_backup_at.clone(),
            last_restore_at: self.last_restore_at.clone(),
            remote_backup_at: self.remote_backup_at.clone(),
            remote_item_count: self.remote_item_count,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CloudFile {
    format: String,
    version: u8,
    cipher: String,
    payload: SecretEnvelope,
}

#[derive(Deserialize)]
struct Repository {
    id: u64,
    private: bool,
    archived: bool,
    #[serde(default)]
    disabled: bool,
    default_branch: String,
}

#[derive(Deserialize)]
struct ContentFile {
    #[serde(rename = "type")]
    kind: String,
    sha: String,
    size: usize,
    #[serde(default)]
    encoding: String,
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct Blob {
    sha: String,
    size: usize,
    encoding: String,
    content: String,
}

struct RemoteFile {
    sha: String,
    bytes: Vec<u8>,
}

pub struct GithubBackup {
    vault: Vault,
    client: Client,
    api_base: Url,
}

impl GithubBackup {
    pub fn new(vault: Vault) -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("OpenKeylet/", env!("CARGO_PKG_VERSION")))
            // Never follow a repository rename or an attacker-controlled redirect
            // while holding a GitHub token. The user can reconnect explicitly.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(40))
            .build()
            .context("GITHUB_NETWORK")?;
        Ok(Self {
            vault,
            client,
            api_base: Url::parse("https://api.github.com/").expect("static GitHub URL"),
        })
    }

    pub fn status(&self) -> Result<BackupStatus> {
        Ok(self
            .load()?
            .map(|config| config.status())
            .unwrap_or_default())
    }

    pub fn recovery_key(&self) -> Result<String> {
        Ok(self.connected()?.recovery_key.clone())
    }

    pub fn disconnect(&self) -> Result<BackupStatus> {
        match fs::remove_file(self.vault.data_dir().join(LOCAL_FILE)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => bail!("GITHUB_LOCAL_STATE"),
        }
        Ok(BackupStatus::default())
    }

    pub async fn connect(&self, input: ConnectInput) -> Result<BackupStatus> {
        if !input.recovery_key_saved {
            bail!("GITHUB_KEY_NOT_SAVED");
        }
        if !matches!(input.mode.as_str(), "new" | "existing") {
            bail!("GITHUB_MODE_INVALID");
        }
        let (owner, repo) = parse_repository(&input.repository)?;
        let token = input.token.trim();
        validate_token(token)?;
        let recovery_key = input.recovery_key.trim();
        parse_recovery_key(recovery_key)?;
        let repository = self.repository(&owner, &repo, token).await?;
        let mut config = DeviceConfig {
            format: LOCAL_FORMAT.to_owned(),
            owner,
            repo,
            repository_id: repository.id,
            branch: repository.default_branch,
            token: token.to_owned(),
            recovery_key: recovery_key.to_owned(),
            base_sha: None,
            needs_restore: false,
            has_remote_backup: false,
            last_backup_at: None,
            last_restore_at: None,
            remote_backup_at: None,
            remote_item_count: None,
        };
        let remote = self.remote_file(&config).await?;
        match (input.mode.as_str(), remote) {
            ("new", Some(_)) => bail!("GITHUB_BACKUP_EXISTS"),
            ("existing", None) => bail!("GITHUB_BACKUP_MISSING"),
            ("existing", Some(remote)) => {
                let plain = decrypt_snapshot(&remote.bytes, recovery_key)?;
                let (created_at, count) =
                    backup::inspect_cloud_snapshot(&plain).context("GITHUB_BACKUP_INVALID")?;
                // Merely seeing the remote SHA is not permission to overwrite it.
                // A newly connected device must first restore this snapshot.
                config.needs_restore = true;
                config.has_remote_backup = true;
                config.remote_backup_at = Some(created_at);
                config.remote_item_count = Some(count);
            }
            ("new", None) => (),
            _ => unreachable!(),
        }
        self.save(&config)?;
        Ok(config.status())
    }

    pub async fn upload(&self) -> Result<BackupStatus> {
        let mut config = self.connected()?;
        if config.needs_restore {
            bail!("GITHUB_RESTORE_REQUIRED");
        }
        self.check_repository(&config).await?;
        let remote = self.remote_file(&config).await?;
        if remote.as_ref().map(|file| file.sha.as_str()) != config.base_sha.as_deref() {
            config.needs_restore = true;
            config.has_remote_backup = remote.is_some();
            self.save(&config)?;
            bail!("GITHUB_REMOTE_CHANGED");
        }
        let plain = backup::cloud_snapshot(&self.vault).context("GITHUB_LOCAL_VAULT")?;
        let (created_at, count) =
            backup::inspect_cloud_snapshot(&plain).context("GITHUB_LOCAL_VAULT")?;
        let encrypted = encrypt_snapshot(&plain, &config.recovery_key)?;
        let expected_sha = blob_sha(&encrypted);
        let mut payload = serde_json::json!({
            "message": "Update encrypted OpenKeylet backup",
            "content": STANDARD.encode(&encrypted),
            "branch": config.branch,
        });
        if let Some(sha) = &config.base_sha {
            payload["sha"] = serde_json::Value::String(sha.clone());
        }
        // The SHA is GitHub's compare-and-swap guard. No forced writes or
        // automatic retries: a lost response is resolved by a later restore.
        let response = self
            .request(
                Method::PUT,
                &config.owner,
                &config.repo,
                &["contents", CLOUD_FILE],
                &config.token,
            )?
            .json(&payload)
            .send()
            .await
            .context("GITHUB_UPLOAD_UNCONFIRMED")?;
        check_response(&response)?;
        let result: serde_json::Value = read_json(response).await?;
        if result
            .pointer("/content/sha")
            .and_then(|value| value.as_str())
            != Some(&expected_sha)
        {
            bail!("GITHUB_UPLOAD_UNCONFIRMED");
        }
        config.base_sha = Some(expected_sha);
        config.has_remote_backup = true;
        config.remote_backup_at = Some(created_at);
        config.remote_item_count = Some(count);
        config.last_backup_at = Some(Utc::now().to_rfc3339());
        self.save(&config)?;
        Ok(config.status())
    }

    pub async fn restore(&self) -> Result<RestoreResult> {
        let mut config = self.connected()?;
        self.check_repository(&config).await?;
        let remote = self
            .remote_file(&config)
            .await?
            .context("GITHUB_BACKUP_MISSING")?;
        let plain = decrypt_snapshot(&remote.bytes, &config.recovery_key)?;
        let (created_at, count) =
            backup::inspect_cloud_snapshot(&plain).context("GITHUB_BACKUP_INVALID")?;
        // Merge is transactional: duplicate entries are skipped and differing
        // entries are retained under distinct names. Local entries are not lost.
        let summary =
            backup::restore_cloud_snapshot(&self.vault, &plain).context("GITHUB_RESTORE_FAILED")?;
        config.base_sha = Some(remote.sha);
        config.needs_restore = false;
        config.has_remote_backup = true;
        config.remote_backup_at = Some(created_at);
        config.remote_item_count = Some(count);
        config.last_restore_at = Some(Utc::now().to_rfc3339());
        self.save(&config)?;
        Ok(RestoreResult {
            summary,
            status: config.status(),
        })
    }

    fn load(&self) -> Result<Option<DeviceConfig>> {
        let path = self.vault.data_dir().join(LOCAL_FILE);
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => bail!("GITHUB_LOCAL_STATE"),
        };
        if bytes.len() > 64 * 1024 {
            bail!("GITHUB_LOCAL_STATE");
        }
        let envelope = serde_json::from_slice(&bytes).context("GITHUB_LOCAL_STATE")?;
        let config: DeviceConfig = self
            .vault
            .unprotect_local_state(&envelope)
            .context("GITHUB_LOCAL_STATE")?;
        if config.format != LOCAL_FORMAT {
            bail!("GITHUB_LOCAL_STATE");
        }
        Ok(Some(config))
    }

    fn connected(&self) -> Result<DeviceConfig> {
        self.load()?.context("GITHUB_NOT_CONNECTED")
    }

    fn save(&self, config: &DeviceConfig) -> Result<()> {
        let envelope = self
            .vault
            .protect_local_state(config)
            .context("GITHUB_LOCAL_STATE")?;
        let bytes = serde_json::to_vec(&envelope).context("GITHUB_LOCAL_STATE")?;
        let mut file = AtomicWriteFile::open(self.vault.data_dir().join(LOCAL_FILE))
            .context("GITHUB_LOCAL_STATE")?;
        file.write_all(&bytes).context("GITHUB_LOCAL_STATE")?;
        file.commit().context("GITHUB_LOCAL_STATE")?;
        Ok(())
    }

    fn request(
        &self,
        method: Method,
        owner: &str,
        repo: &str,
        suffix: &[&str],
        token: &str,
    ) -> Result<reqwest::RequestBuilder> {
        let mut url = self.api_base.clone();
        url.path_segments_mut()
            .expect("HTTP base URL")
            .extend(["repos", owner, repo])
            .extend(suffix);
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| anyhow::anyhow!("GITHUB_TOKEN_INVALID"))?;
        authorization.set_sensitive(true);
        Ok(self
            .client
            .request(method, url)
            .header(AUTHORIZATION, authorization)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10"))
    }

    async fn repository(&self, owner: &str, repo: &str, token: &str) -> Result<Repository> {
        let response = self
            .request(Method::GET, owner, repo, &[], token)?
            .send()
            .await
            .context("GITHUB_NETWORK")?;
        check_response(&response)?;
        let repository: Repository = read_json(response).await?;
        if !repository.private {
            bail!("GITHUB_PRIVATE_REQUIRED");
        }
        if repository.archived || repository.disabled {
            bail!("GITHUB_REPOSITORY_READ_ONLY");
        }
        if repository.id == 0 || repository.default_branch.is_empty() {
            bail!("GITHUB_RESPONSE_INVALID");
        }
        Ok(repository)
    }

    async fn check_repository(&self, config: &DeviceConfig) -> Result<()> {
        let repository = self
            .repository(&config.owner, &config.repo, &config.token)
            .await?;
        if repository.id != config.repository_id {
            bail!("GITHUB_REPOSITORY_CHANGED");
        }
        if repository.default_branch != config.branch {
            bail!("GITHUB_BRANCH_CHANGED");
        }
        Ok(())
    }

    async fn remote_file(&self, config: &DeviceConfig) -> Result<Option<RemoteFile>> {
        let response = self
            .request(
                Method::GET,
                &config.owner,
                &config.repo,
                &["contents", CLOUD_FILE],
                &config.token,
            )?
            .query(&[("ref", &config.branch)])
            .send()
            .await
            .context("GITHUB_NETWORK")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        check_response(&response)?;
        let file: ContentFile = read_json(response).await?;
        if file.kind != "file" || !valid_sha(&file.sha) {
            bail!("GITHUB_BACKUP_INVALID");
        }
        if file.size > MAX_CLOUD_BYTES {
            bail!("GITHUB_BACKUP_TOO_LARGE");
        }
        let bytes = if file.encoding == "base64" {
            decode_content(&file.content)?
        } else {
            // Contents API omits inline content above 1 MB. Pin the blob SHA
            // instead of following download_url or reading a moving branch.
            let response = self
                .request(
                    Method::GET,
                    &config.owner,
                    &config.repo,
                    &["git", "blobs", &file.sha],
                    &config.token,
                )?
                .send()
                .await
                .context("GITHUB_NETWORK")?;
            check_response(&response)?;
            let blob: Blob = read_json(response).await?;
            if blob.sha != file.sha || blob.encoding != "base64" || blob.size != file.size {
                bail!("GITHUB_BACKUP_INVALID");
            }
            decode_content(&blob.content)?
        };
        if bytes.len() != file.size || blob_sha(&bytes) != file.sha {
            bail!("GITHUB_BACKUP_INVALID");
        }
        Ok(Some(RemoteFile {
            sha: file.sha,
            bytes,
        }))
    }
}

pub fn generate_recovery_key() -> Result<String> {
    let mut key = Zeroizing::new([0_u8; 32]);
    getrandom::fill(key.as_mut()).map_err(|_| anyhow::anyhow!("GITHUB_RANDOM_FAILED"))?;
    Ok(format!("okv1_{}", URL_SAFE_NO_PAD.encode(key.as_ref())))
}

fn parse_recovery_key(value: &str) -> Result<Zeroizing<[u8; 32]>> {
    let encoded = value.strip_prefix("okv1_").context("GITHUB_KEY_INVALID")?;
    if encoded.len() != 43 {
        bail!("GITHUB_KEY_INVALID");
    }
    let decoded = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(encoded)
            .context("GITHUB_KEY_INVALID")?,
    );
    let key: [u8; 32] = decoded
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("GITHUB_KEY_INVALID"))?;
    Ok(Zeroizing::new(key))
}

fn encrypt_snapshot(plain: &[u8], recovery_key: &str) -> Result<Vec<u8>> {
    if plain.len() > MAX_CLOUD_BYTES {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    let key = parse_recovery_key(recovery_key)?;
    let file = CloudFile {
        format: CLOUD_FORMAT.to_owned(),
        version: 1,
        cipher: "xchacha20poly1305".to_owned(),
        payload: encrypt_bytes(&key, plain, CLOUD_AAD).context("GITHUB_ENCRYPTION_FAILED")?,
    };
    let bytes = serde_json::to_vec(&file).context("GITHUB_ENCRYPTION_FAILED")?;
    if bytes.len() > MAX_CLOUD_BYTES {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    Ok(bytes)
}

fn decrypt_snapshot(bytes: &[u8], recovery_key: &str) -> Result<Zeroizing<Vec<u8>>> {
    if bytes.len() > MAX_CLOUD_BYTES {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    let file: CloudFile = serde_json::from_slice(bytes).context("GITHUB_BACKUP_INVALID")?;
    if file.format != CLOUD_FORMAT || file.version != 1 || file.cipher != "xchacha20poly1305" {
        bail!("GITHUB_BACKUP_INVALID");
    }
    let key = parse_recovery_key(recovery_key)?;
    Ok(Zeroizing::new(
        decrypt_bytes(&key, &file.payload, CLOUD_AAD).context("GITHUB_KEY_MISMATCH")?,
    ))
}

fn parse_repository(input: &str) -> Result<(String, String)> {
    let repository = input
        .trim()
        .strip_prefix("https://github.com/")
        .unwrap_or(input.trim());
    let repository = repository.trim_end_matches('/');
    let repository = repository.strip_suffix(".git").unwrap_or(repository);
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 100
                || matches!(*part, "." | "..")
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        bail!("GITHUB_REPOSITORY_INVALID");
    }
    Ok((parts[0].to_owned(), parts[1].to_owned()))
}

fn validate_token(token: &str) -> Result<()> {
    if token.is_empty() || token.len() > 2048 || !token.bytes().all(|c| c.is_ascii_graphic()) {
        bail!("GITHUB_TOKEN_INVALID");
    }
    Ok(())
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 40 && sha.bytes().all(|c| c.is_ascii_hexdigit())
}

fn blob_sha(bytes: &[u8]) -> String {
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", bytes.len()));
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}

fn decode_content(content: &str) -> Result<Vec<u8>> {
    if content.len() > MAX_RESPONSE_BYTES {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    let compact: String = content
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    let bytes = STANDARD.decode(compact).context("GITHUB_BACKUP_INVALID")?;
    if bytes.len() > MAX_CLOUD_BYTES {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    Ok(bytes)
}

fn check_response(response: &Response) -> Result<()> {
    if response.status().is_success() {
        return Ok(());
    }
    // Never echo GitHub response bodies: error messages can contain supplied
    // content, repository descriptions or credentials from a proxy.
    match response.status() {
        StatusCode::UNAUTHORIZED => bail!("GITHUB_AUTH"),
        StatusCode::FORBIDDEN
            if response
                .headers()
                .get("x-ratelimit-remaining")
                .is_some_and(|value| value == "0")
                || response.headers().contains_key("retry-after") =>
        {
            bail!("GITHUB_RATE_LIMIT")
        }
        StatusCode::FORBIDDEN => bail!("GITHUB_PERMISSION"),
        StatusCode::TOO_MANY_REQUESTS => bail!("GITHUB_RATE_LIMIT"),
        StatusCode::NOT_FOUND => bail!("GITHUB_NOT_FOUND"),
        StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => bail!("GITHUB_CONFLICT"),
        status if status.is_redirection() => bail!("GITHUB_REDIRECT"),
        _ => bail!("GITHUB_REMOTE_ERROR"),
    }
}

async fn read_json<T: DeserializeOwned>(mut response: Response) -> Result<T> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        bail!("GITHUB_BACKUP_TOO_LARGE");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.context("GITHUB_NETWORK")? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            bail!("GITHUB_BACKUP_TOO_LARGE");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).context("GITHUB_RESPONSE_INVALID")
}

#[cfg(test)]
mod tests;
