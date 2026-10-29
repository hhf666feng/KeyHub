use super::*;
use tempfile::tempdir;

fn create_input(name: &str) -> ItemsCreateInput {
    serde_json::from_value(json!({
        "name": name,
        "description": "Speech transcription API",
        "folder": "Work",
        "modules": [
            {"kind": "url", "value": "https://asr.example.test/v1"},
            {"kind": "apiCredential"}
        ]
    }))
    .unwrap()
}

fn value(result: &CallToolResult) -> Value {
    assert_eq!(result.is_error, Some(false), "{result:?}");
    result.structured_content.clone().unwrap()
}

#[tokio::test]
async fn creates_a_persistent_searchable_blank_api_item_without_owner_unlock() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    vault.set_owner_pin("123456").unwrap();
    let server = VaultMcp::new(vault.clone());
    let output = value(&server.items_create(Parameters(create_input("ASR"))).await);
    assert_eq!(output["created"], true);
    assert_eq!(output["item"]["name"], "ASR");
    assert_eq!(output["requiresOwnerInput"], true);
    assert_eq!(output["missingFields"], json!(["apiCredential"]));
    assert_eq!(output["item"]["actions"], json!([]));
    let modules = output["item"]["modules"].as_array().unwrap();
    let secret = modules
        .iter()
        .find(|module| module["kind"] == "apiCredential")
        .unwrap();
    assert_eq!(secret["configured"], false);
    assert_eq!(secret["agentVisible"], false);
    assert!(secret.get("value").is_none());
    let saved = vault.list_connections().unwrap().pop().unwrap();
    assert_eq!(saved.item_type, "api");
    assert_eq!(saved.folder, "Work");
    assert!(saved.enabled);
    assert!(vault.get_secret_value(saved.id, "apiCredential").is_err());
    assert!(
        vault
            .get_connection(saved.id)
            .unwrap()
            .secrets
            .non_empty_values()
            .is_empty()
    );
    assert_eq!(vault.activities().unwrap().len(), 1);
    let reopened = VaultMcp::new(Vault::open(directory.path().into()).unwrap());
    let found = value(
        &reopened
            .items_search(Parameters(ItemsSearchInput {
                query: Some("ASR".into()),
            }))
            .await,
    );
    assert_eq!(found["items"][0]["name"], "ASR");
    assert_eq!(found["items"][0]["actions"], json!([]));
    vault.set_connection_enabled(saved.id, false).unwrap();
    let hidden = value(
        &server
            .items_search(Parameters(ItemsSearchInput::default()))
            .await,
    );
    assert_eq!(hidden["items"], json!([]));
}

#[tokio::test]
async fn concurrent_duplicate_creation_never_overwrites_or_adds_a_second_item() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    let mut jobs = Vec::new();
    for _ in 0..4 {
        let vault = vault.clone();
        jobs.push(std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(VaultMcp::new(vault).items_create(Parameters(create_input("ASR"))))
        }));
    }
    let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
    assert_eq!(
        results
            .iter()
            .filter(|result| result.is_error == Some(false))
            .count(),
        1
    );
    assert_eq!(vault.list_connections().unwrap().len(), 1);
    let duplicate = VaultMcp::new(vault.clone())
        .items_create(Parameters(create_input(" asr ")))
        .await;
    assert_eq!(duplicate.is_error, Some(true));
    assert_eq!(vault.list_connections().unwrap()[0].name, "ASR");
}

#[tokio::test]
async fn rejects_secret_values_and_invalid_modules_without_partial_writes_or_echoes() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    let server = VaultMcp::new(vault.clone());
    for kind in [
        "username",
        "password",
        "apiCredential",
        "privateKey",
        "totp",
        "customSecret",
        "secureNote",
    ] {
        let input = serde_json::from_value(json!({
            "name": "Rejected", "modules": [{"kind": kind, "name": "CUSTOM_KEY", "value": "secret-never-echo-7391"}]
        })).unwrap();
        let output = server.items_create(Parameters(input)).await;
        assert_eq!(output.is_error, Some(true), "{kind}");
        assert!(
            !serde_json::to_string(&output)
                .unwrap()
                .contains("secret-never-echo-7391")
        );
    }
    for modules in [
        json!([]),
        json!([{"kind":"passkey"}]),
        json!([{"kind":"apiCredential"},{"kind":"apiCredential"}]),
        json!([{"kind":"customSecret","name":"password"}]),
        json!([{"kind":"port","value":"0"}]),
        json!([{"kind":"url","value":"https://user:secret@example.test"}]),
    ] {
        let input = serde_json::from_value(json!({"name":"Rejected", "modules": modules})).unwrap();
        assert_eq!(
            server.items_create(Parameters(input)).await.is_error,
            Some(true)
        );
    }
    assert!(vault.list_connections().unwrap().is_empty());

    for name in ["", "   ", &"x".repeat(81)] {
        assert_eq!(
            server
                .items_create(Parameters(create_input(name)))
                .await
                .is_error,
            Some(true)
        );
    }
    assert!(vault.list_connections().unwrap().is_empty());
}

#[tokio::test]
async fn owner_completion_of_api_skeleton_reuses_automatic_auth_without_disclosure() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    let server = VaultMcp::new(vault.clone());
    value(&server.items_create(Parameters(create_input("ASR"))).await);
    let public = vault.list_connections().unwrap().pop().unwrap();
    let mut completed = json!({
        "name": "ASR", "description": "Speech transcription API", "folder": "Work",
        "modules": [{"kind":"url","value":"https://asr.example.test/v1"},{"kind":"apiCredential"}]
    });
    completed["id"] = json!(public.id);
    completed["httpAuthType"] = json!("auto");
    completed["secrets"] = json!({"namedSecrets":{"apiCredential":"test-api-key-owner-only-7391"}});
    vault
        .save_connection_checked(
            serde_json::from_value(completed).unwrap(),
            Some(&public.updated_at),
        )
        .unwrap();
    let saved = vault.get_connection(public.id).unwrap();
    assert_eq!(saved.stored.http_auth_type, "bearer");
    assert_eq!(saved.stored.auth_header, "Authorization");
    let found = value(
        &server
            .items_search(Parameters(ItemsSearchInput {
                query: Some("ASR".into()),
            }))
            .await,
    );
    assert!(
        found["items"][0]["actions"]
            .as_array()
            .unwrap()
            .contains(&json!("http_send"))
    );
    assert!(!found.to_string().contains("test-api-key-owner-only-7391"));
}

#[test]
fn creation_schema_does_not_accept_updates_secret_bundles_or_visibility_overrides() {
    for extra in [
        json!({"id":"existing"}),
        json!({"secrets":{"token":"no"}}),
        json!({"enabled":false}),
    ] {
        let mut input = json!({"name":"ASR","modules":[{"kind":"apiCredential"}]});
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(serde_json::from_value::<ItemsCreateInput>(input).is_err());
    }
    assert!(
        serde_json::from_value::<ItemsCreateInput>(json!({
            "name":"ASR","modules":[{"kind":"apiCredential","agentVisible":true}]
        }))
        .is_err()
    );
}

#[test]
fn malformed_creation_arguments_do_not_echo_input_in_serde_errors() {
    for input in [
        json!({"name":"ASR","modules":"secret-marker-7391"}),
        json!({"name":"ASR","modules":[{"kind":"apiCredential","secret-marker-7391":true}]}),
    ] {
        let error = serde_json::from_value::<ItemsCreateInput>(input).unwrap_err();
        assert!(!error.to_string().contains("secret-marker-7391"));
    }
}

#[tokio::test]
async fn incomplete_current_selection_never_falls_back_to_another_items_credentials() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    let existing = serde_json::from_value(json!({
        "name":"Configured service", "modules":[{"kind":"apiCredential"}],
        "secrets":{"namedSecrets":{"apiCredential":"test-service-token"}}, "httpAuthType":"auto"
    }))
    .unwrap();
    vault.save_connection(existing).unwrap();
    let server = VaultMcp::new(vault);
    value(&server.items_create(Parameters(create_input("ASR"))).await);
    assert!(server.resolve_item_for_action("", Some("http")).is_err());
    server
        .resolve_item_for_action("Configured service", Some("http"))
        .unwrap();
    value(
        &server
            .items_search(Parameters(ItemsSearchInput {
                query: Some("ASR".into()),
            }))
            .await,
    );
    assert!(server.resolve_item_for_action("", Some("http")).is_err());
    assert!(
        server
            .resolve_item_for_action("Configured service", Some("http"))
            .is_ok()
    );
}

#[tokio::test]
async fn invalid_module_identifiers_do_not_echo_input_in_validation_errors() {
    let directory = tempdir().unwrap();
    let server = VaultMcp::new(Vault::open(directory.path().into()).unwrap());
    for module in [
        json!({"kind":"secret-marker-7391"}),
        json!({"kind":"customSecret","name":"secret-marker-7391\ninvalid"}),
    ] {
        let input = serde_json::from_value(json!({"name":"ASR", "modules":[module]})).unwrap();
        let result = server.items_create(Parameters(input)).await;
        assert_eq!(result.is_error, Some(true));
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("secret-marker-7391")
        );
    }
}

#[tokio::test]
async fn supports_hidden_custom_fields_and_owner_completion_enables_normal_actions() {
    let directory = tempdir().unwrap();
    let vault = Vault::open(directory.path().into()).unwrap();
    let server = VaultMcp::new(vault.clone());
    let input = serde_json::from_value(json!({
        "name":"Environment", "itemType":"custom", "modules":[{"kind":"customSecret","name":"ASR_API_KEY"}]
    })).unwrap();
    let output = value(&server.items_create(Parameters(input)).await);
    assert_eq!(output["missingFields"], json!(["ASR_API_KEY"]));
    assert_eq!(output["item"]["modules"][0]["agentVisible"], false);
    let public = vault.list_connections().unwrap().pop().unwrap();
    let completed: crate::model::ConnectionInput = serde_json::from_value(json!({
        "id": public.id, "name":public.name, "modules":[{"kind":"customSecret","name":"ASR_API_KEY"}],
        "secrets":{"namedSecrets":{"ASR_API_KEY":"owner-only-marker-7391"}}
    })).unwrap();
    vault
        .save_connection_checked(completed, Some(&public.updated_at))
        .unwrap();
    let found = value(
        &server
            .items_search(Parameters(ItemsSearchInput::default()))
            .await,
    );
    assert!(
        found["items"][0]["actions"]
            .as_array()
            .unwrap()
            .contains(&json!("http_send"))
    );
    assert!(!found.to_string().contains("owner-only-marker-7391"));
}
