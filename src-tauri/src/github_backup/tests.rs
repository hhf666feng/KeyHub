use super::*;
use crate::model::{ConnectionInput, ItemModule, SecretBundle};
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, Uri},
    response::{IntoResponse, Response as AxumResponse},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use uuid::Uuid;

#[derive(Default)]
struct MockState {
    bytes: Option<Vec<u8>>,
    public: bool,
    force_blob: bool,
    conflict_on_put: bool,
    force_status: Option<u16>,
    requests: usize,
    writes: usize,
}

struct MockGithub {
    state: Arc<Mutex<MockState>>,
    base: Url,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockGithub {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl MockGithub {
    async fn start() -> Self {
        let state = Arc::new(Mutex::new(MockState::default()));
        let router = Router::new()
            .fallback(mock_handler)
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self { state, base, task }
    }

    fn manager(&self) -> (TempDir, GithubBackup) {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::open(directory.path().join("vault")).unwrap();
        let mut manager = GithubBackup::new(vault).unwrap();
        manager.api_base = self.base.clone();
        (directory, manager)
    }
}

async fn mock_handler(
    State(state): State<Arc<Mutex<MockState>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> AxumResponse {
    let mut state = state.lock().unwrap();
    state.requests += 1;
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some("Bearer test-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if let Some(status) = state.force_status {
        return (
            StatusCode::from_u16(status).unwrap(),
            [("location", "http://127.0.0.1:1/do-not-follow")],
            "token-and-secret-marker-must-not-be-echoed",
        )
            .into_response();
    }
    if method == Method::GET && uri.path() == "/repos/test/vault" {
        return Json(json!({"id": 7, "private": !state.public, "archived": false,
            "disabled": false, "default_branch": "main"}))
        .into_response();
    }
    let content_path = format!("/repos/test/vault/contents/{CLOUD_FILE}");
    if method == Method::GET && uri.path() == content_path {
        return match &state.bytes {
            None => StatusCode::NOT_FOUND.into_response(),
            Some(bytes) => Json(
                json!({"type":"file", "sha":blob_sha(bytes), "size":bytes.len(),
                    "encoding": if state.force_blob { "none" } else { "base64" },
                    "content": if state.force_blob { String::new() } else { STANDARD.encode(bytes) }
                }),
            )
            .into_response(),
        };
    }
    if method == Method::GET && uri.path().starts_with("/repos/test/vault/git/blobs/") {
        let bytes = state.bytes.as_ref().unwrap();
        assert!(uri.path().ends_with(&blob_sha(bytes)));
        return Json(json!({"sha":blob_sha(bytes), "size":bytes.len(),
            "encoding":"base64", "content":STANDARD.encode(bytes)}))
        .into_response();
    }
    if method == Method::PUT && uri.path() == content_path {
        let request: Value = serde_json::from_slice(&body).unwrap();
        if state.conflict_on_put {
            state.conflict_on_put = false;
            return StatusCode::CONFLICT.into_response();
        }
        let current_sha = state.bytes.as_ref().map(|bytes| blob_sha(bytes));
        if request.get("sha").and_then(Value::as_str) != current_sha.as_deref() {
            return StatusCode::CONFLICT.into_response();
        }
        assert_eq!(request["branch"], "main");
        assert_eq!(request["message"], "Update encrypted OpenKeylet backup");
        let bytes = STANDARD
            .decode(request["content"].as_str().unwrap())
            .unwrap();
        let sha = blob_sha(&bytes);
        state.bytes = Some(bytes);
        state.writes += 1;
        return Json(json!({"content":{"sha":sha}})).into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

fn input(key: &str, mode: &str) -> ConnectInput {
    ConnectInput {
        repository: "test/vault".into(),
        token: "test-token".into(),
        recovery_key: key.into(),
        mode: mode.into(),
        recovery_key_saved: true,
    }
}

fn add_item(vault: &Vault, id: Uuid, name: &str, secret: &str) {
    let mut secrets = SecretBundle::default();
    secrets
        .named_secrets
        .insert("apiCredential".into(), secret.into());
    vault
        .save_connection(ConnectionInput {
            id: Some(id),
            name: name.into(),
            enabled: true,
            description: "private-description-marker".into(),
            modules: vec![ItemModule {
                kind: "apiCredential".into(),
                ..Default::default()
            }],
            http_auth_type: "bearer".into(),
            private_key_import_path: String::new(),
            auth_header: "Authorization".into(),
            auth_location: "header".into(),
            auth_prefix: "Bearer ".into(),
            api_auth_headers: vec![],
            test_path: "/".into(),
            remove_secret_names: vec![],
            secrets,
        })
        .unwrap();
}

#[test]
fn snapshots_are_authenticated_and_contain_no_unlock_material() {
    let key = generate_recovery_key().unwrap();
    let other_key = generate_recovery_key().unwrap();
    assert_ne!(key, other_key);
    let bytes = encrypt_snapshot(b"credential-and-project-marker", &key).unwrap();
    let text = String::from_utf8(bytes.clone()).unwrap();
    assert!(!text.contains("credential-and-project-marker"));
    assert!(!text.contains(&key));
    assert!(!text.contains("unlockKey"));
    assert_eq!(
        decrypt_snapshot(&bytes, &key).unwrap().as_slice(),
        b"credential-and-project-marker"
    );
    assert_eq!(
        decrypt_snapshot(&bytes, &other_key)
            .unwrap_err()
            .to_string(),
        "GITHUB_KEY_MISMATCH"
    );
    let mut changed: CloudFile = serde_json::from_slice(&bytes).unwrap();
    changed.payload.nonce = STANDARD.encode([0_u8; 24]).trim_end_matches('=').to_owned();
    assert!(decrypt_snapshot(&serde_json::to_vec(&changed).unwrap(), &key).is_err());
    changed.version = 2;
    assert_eq!(
        decrypt_snapshot(&serde_json::to_vec(&changed).unwrap(), &key)
            .unwrap_err()
            .to_string(),
        "GITHUB_BACKUP_INVALID"
    );
    assert!(
        decrypt_snapshot(
            br#"{"format":"mcp-vault-backup","unlockKey":"unsafe"}"#,
            &key
        )
        .is_err()
    );
}

#[test]
fn inputs_cannot_change_the_api_origin_or_inject_paths() {
    assert_eq!(
        parse_repository(" https://github.com/test/vault.git/ ").unwrap(),
        ("test".into(), "vault".into())
    );
    for value in [
        "../vault",
        "test/..",
        "test/vault/extra",
        "https://evil.test/x/y",
        "test/a?b",
        "test/a%2Fb",
        "test/a#ref",
    ] {
        assert!(parse_repository(value).is_err(), "{value}");
    }
    assert!(parse_recovery_key("123456").is_err());
    assert!(validate_token("token\nInjected: value").is_err());
    assert!(validate_token("").is_err());
    assert!(
        encrypt_snapshot(&vec![0; MAX_CLOUD_BYTES], &generate_recovery_key().unwrap()).is_err()
    );
}

#[tokio::test]
async fn backup_restores_on_another_device_and_keeps_local_credentials_private() {
    let mock = MockGithub::start().await;
    let (_source_directory, source) = mock.manager();
    let key = generate_recovery_key().unwrap();
    add_item(
        &source.vault,
        Uuid::new_v4(),
        "project-marker",
        "credential-marker",
    );
    source.connect(input(&key, "new")).await.unwrap();
    source.upload().await.unwrap();
    let local_file = fs::read_to_string(source.vault.data_dir().join(LOCAL_FILE)).unwrap();
    let remote_file = String::from_utf8(mock.state.lock().unwrap().bytes.clone().unwrap()).unwrap();
    for marker in [
        key.as_str(),
        "test-token",
        "project-marker",
        "credential-marker",
        "private-description-marker",
    ] {
        assert!(!local_file.contains(marker));
        assert!(!remote_file.contains(marker));
    }
    let status_json = serde_json::to_string(&source.status().unwrap()).unwrap();
    assert!(!status_json.contains(&key));
    assert!(!status_json.contains("test-token"));

    let (_target_directory, target) = mock.manager();
    assert!(
        target
            .connect(input(&key, "existing"))
            .await
            .unwrap()
            .needs_restore
    );
    assert_eq!(
        target.upload().await.err().unwrap().to_string(),
        "GITHUB_RESTORE_REQUIRED"
    );
    let restored = target.restore().await.unwrap();
    assert_eq!(restored.summary.added, 1);
    assert!(!restored.status.needs_restore);
    let entries = target.vault.export_connections().unwrap();
    assert_eq!(entries[0].0.name, "project-marker");
    assert_eq!(entries[0].1.get("apiCredential"), Some("credential-marker"));
    assert_eq!(target.restore().await.unwrap().summary.merged, 1);
    assert_eq!(target.vault.export_connections().unwrap().len(), 1);
    assert!(!target.disconnect().unwrap().connected);
    assert!(mock.state.lock().unwrap().bytes.is_some());
    assert_eq!(target.vault.export_connections().unwrap().len(), 1);
    assert!(target.recovery_key().is_err());
}

#[tokio::test]
async fn remote_changes_require_restore_and_conflicting_items_are_preserved() {
    let mock = MockGithub::start().await;
    let (_a, first) = mock.manager();
    let (_b, second) = mock.manager();
    let key = generate_recovery_key().unwrap();
    let id = Uuid::new_v4();
    add_item(&first.vault, id, "shared", "first-secret");
    first.connect(input(&key, "new")).await.unwrap();
    first.upload().await.unwrap();
    second.connect(input(&key, "existing")).await.unwrap();
    second.restore().await.unwrap();
    add_item(&first.vault, id, "shared", "updated-first-secret");
    first.upload().await.unwrap();
    let before = mock.state.lock().unwrap().bytes.clone();
    assert_eq!(
        second.upload().await.err().unwrap().to_string(),
        "GITHUB_REMOTE_CHANGED"
    );
    assert!(second.status().unwrap().needs_restore);
    assert_eq!(mock.state.lock().unwrap().bytes, before);
    let result = second.restore().await.unwrap();
    assert_eq!(result.summary.added, 1);
    let entries = second.vault.export_connections().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(
        entries
            .iter()
            .any(|(_, secret)| secret.get("apiCredential") == Some("first-secret"))
    );
    assert!(
        entries
            .iter()
            .any(|(_, secret)| secret.get("apiCredential") == Some("updated-first-secret"))
    );
    second.upload().await.unwrap();
}

#[tokio::test]
async fn wrong_keys_and_public_repositories_do_not_modify_local_or_remote_data() {
    let mock = MockGithub::start().await;
    let (_a, source) = mock.manager();
    let key = generate_recovery_key().unwrap();
    let mut unsaved = input(&key, "new");
    unsaved.recovery_key_saved = false;
    assert!(source.connect(unsaved).await.is_err());
    assert_eq!(mock.state.lock().unwrap().requests, 0);
    mock.state.lock().unwrap().public = true;
    assert_eq!(
        source
            .connect(input(&key, "new"))
            .await
            .err()
            .unwrap()
            .to_string(),
        "GITHUB_PRIVATE_REQUIRED"
    );
    assert!(!source.status().unwrap().connected);
    mock.state.lock().unwrap().public = false;
    source.connect(input(&key, "new")).await.unwrap();
    source.upload().await.unwrap();
    let (_b, target) = mock.manager();
    let before = fs::read(target.vault.data_dir().join("vault.json")).unwrap();
    assert_eq!(
        target
            .connect(input(&generate_recovery_key().unwrap(), "existing"))
            .await
            .err()
            .unwrap()
            .to_string(),
        "GITHUB_KEY_MISMATCH"
    );
    assert!(!target.status().unwrap().connected);
    assert_eq!(
        fs::read(target.vault.data_dir().join("vault.json")).unwrap(),
        before
    );
    assert_eq!(
        target
            .connect(input(&key, "new"))
            .await
            .err()
            .unwrap()
            .to_string(),
        "GITHUB_BACKUP_EXISTS"
    );
    mock.state.lock().unwrap().public = true;
    assert_eq!(
        source.upload().await.err().unwrap().to_string(),
        "GITHUB_PRIVATE_REQUIRED"
    );
    assert_eq!(
        source.restore().await.err().unwrap().to_string(),
        "GITHUB_PRIVATE_REQUIRED"
    );
    assert_eq!(mock.state.lock().unwrap().writes, 1);
}

#[tokio::test]
async fn optimistic_write_conflicts_and_remote_deletion_never_force_overwrite() {
    let mock = MockGithub::start().await;
    let (_directory, manager) = mock.manager();
    let key = generate_recovery_key().unwrap();
    manager.connect(input(&key, "new")).await.unwrap();
    manager.upload().await.unwrap();
    let before = mock.state.lock().unwrap().bytes.clone();
    mock.state.lock().unwrap().conflict_on_put = true;
    assert_eq!(
        manager.upload().await.err().unwrap().to_string(),
        "GITHUB_CONFLICT"
    );
    assert_eq!(mock.state.lock().unwrap().bytes, before);
    mock.state.lock().unwrap().bytes = None;
    assert_eq!(
        manager.upload().await.err().unwrap().to_string(),
        "GITHUB_REMOTE_CHANGED"
    );
    assert!(mock.state.lock().unwrap().bytes.is_none());
}

#[tokio::test]
async fn large_contents_use_the_pinned_blob_and_errors_are_redacted() {
    let mock = MockGithub::start().await;
    let (_directory, manager) = mock.manager();
    let key = generate_recovery_key().unwrap();
    manager.connect(input(&key, "new")).await.unwrap();
    manager.upload().await.unwrap();
    mock.state.lock().unwrap().force_blob = true;
    manager.restore().await.unwrap();
    for (status, expected) in [
        (401, "GITHUB_AUTH"),
        (403, "GITHUB_PERMISSION"),
        (429, "GITHUB_RATE_LIMIT"),
        (302, "GITHUB_REDIRECT"),
    ] {
        mock.state.lock().unwrap().force_status = Some(status);
        let error = manager.restore().await.err().unwrap().to_string();
        assert_eq!(error, expected);
        assert!(!error.contains("token-and-secret-marker"));
    }
}
