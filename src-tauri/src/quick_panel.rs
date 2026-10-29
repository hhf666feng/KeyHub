use crate::model::VaultDocument;
use serde::Serialize;
use uuid::Uuid;

pub const WIDTH: f64 = 400.0;
pub const HEIGHT: f64 = 520.0;

pub fn allowed_command(command: &str) -> bool {
    matches!(
        command,
        "quick_state"
            | "quick_open_main"
            | "quick_action"
            | "plugin:event|listen"
            | "plugin:event|unlisten"
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    pub id: Uuid,
    pub name: String,
    pub item_type: String,
    pub favorite: bool,
    pub enabled: bool,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: Uuid,
    pub time: String,
    pub status: String,
    pub connection_name: String,
    pub action: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummary {
    pub credential_count: usize,
    pub enabled_count: usize,
    pub credentials: Vec<Credential>,
    pub activities: Vec<Activity>,
}

pub fn summarize(document: &VaultDocument, unlocked: bool) -> VaultSummary {
    let credentials = if unlocked {
        document
            .connections
            .iter()
            .map(|item| Credential {
                id: item.id,
                name: item.name.clone(),
                item_type: item.item_type().to_owned(),
                favorite: item.favorite,
                enabled: item.enabled,
                // A label of the configured module types, not proof of authorization.
                capabilities: item
                    .modules
                    .iter()
                    .filter_map(|module| match module.kind.as_str() {
                        "privateKey" => Some("ssh".to_owned()),
                        "apiCredential" => Some("http".to_owned()),
                        "password" => Some("fill".to_owned()),
                        _ => None,
                    })
                    .collect(),
            })
            .collect()
    } else {
        Vec::new()
    };
    let activities = if unlocked {
        document
            .activities
            .iter()
            .take(30)
            .map(|item| Activity {
                id: item.id,
                time: item.time.clone(),
                status: item.status.clone(),
                connection_name: item.connection_name.clone(),
                action: item.action.clone(),
            })
            .collect()
    } else {
        Vec::new()
    };
    VaultSummary {
        credential_count: document.connections.len(),
        enabled_count: document
            .connections
            .iter()
            .filter(|item| item.enabled)
            .count(),
        credentials,
        activities,
    }
}

pub fn resident_mode(requested: bool, tray_available: bool, macos: bool) -> bool {
    requested && tray_available && macos
}

// macOS reports tray coordinates in each screen's physical scale; CGDisplayBounds
// (used by monitor_from_point) uses points. Match the status-bar inset as well as X
// so overlapping physical ranges on mixed-DPI screens do not pick the wrong screen.
pub fn macos_monitor_index(monitors: &[[f64; 6]], anchor: [f64; 4]) -> Option<usize> {
    monitors
        .iter()
        .enumerate()
        .filter(|(_, monitor)| {
            let center = anchor[0] + anchor[2] / 2.0;
            center >= monitor[0] && center <= monitor[0] + monitor[2]
        })
        .min_by(|(_, first), (_, second)| {
            let score = |monitor: &[f64; 6]| {
                let scale = monitor[4];
                ((anchor[1] + anchor[3] - monitor[5]).abs()
                    + (anchor[3] - (monitor[5] - monitor[1])).abs())
                    / scale
            };
            score(first).total_cmp(&score(second))
        })
        .map(|(index, _)| index)
}

// All coordinates are physical; the tray and monitor may use a non-primary scale.
pub fn placement(work: [f64; 4], anchor: [f64; 4], scale: f64) -> [f64; 4] {
    let [left, top, width, height] = work;
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let panel_width = (WIDTH * scale).min(width.max(1.0));
    let panel_height = (HEIGHT * scale).min(height.max(1.0));
    let x = (anchor[0] + anchor[2] / 2.0 - panel_width / 2.0)
        .clamp(left, left + width.max(1.0) - panel_width);
    let below = anchor[1] + anchor[3] + 6.0 * scale;
    let y = if below + panel_height <= top + height {
        below
    } else {
        anchor[1] - panel_height - 6.0 * scale
    }
    .clamp(top, top + height.max(1.0) - panel_height);
    [x, y, panel_width, panel_height]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docking_never_hides_the_only_reachable_entry_point() {
        assert!(resident_mode(true, true, true));
        assert!(!resident_mode(true, false, true));
        assert!(!resident_mode(false, true, true));
        assert!(!resident_mode(true, true, false));
    }

    #[test]
    fn compact_webview_has_no_secret_mutation_or_general_command_access() {
        for command in [
            "quick_state",
            "quick_open_main",
            "quick_action",
            "plugin:event|listen",
            "plugin:event|unlisten",
        ] {
            assert!(allowed_command(command));
        }
        for command in [
            "owner_secret_view",
            "get_state",
            "copy_owner_value",
            "save_connection",
            "export_backup",
            "update_settings",
            "agent_mcp_register",
            "plugin:event|emit",
            "plugin:event|emit_to",
        ] {
            assert!(!allowed_command(command));
        }
    }

    #[test]
    fn tray_panel_fits_scaled_and_negative_origin_monitors() {
        assert_eq!(
            placement([0., 24., 1440., 876.], [1200., 0., 24., 24.], 1.),
            [1012., 30., 400., 520.]
        );
        let result = placement([-1920., 40., 1920., 1040.], [-30., 0., 28., 40.], 2.);
        assert_eq!(result, [-800., 40., 800., 1040.]);
        assert_eq!(
            placement([10., 20., 300., 240.], [100., 20., 24., 24.], 1.),
            [10., 20., 300., 240.]
        );
        let result = placement([0., 0., 1440., 860.], [1200., 860., 24., 30.], 1.);
        assert_eq!(result[1], 334.);
    }

    #[test]
    fn retina_status_item_does_not_select_overlapping_one_x_display() {
        let monitors = [
            [0., 0., 3024., 1964., 2., 48.],
            [1512., 0., 1920., 1080., 1., 24.],
        ];
        assert_eq!(
            macos_monitor_index(&monitors, [2800., 0., 44., 48.]),
            Some(0)
        );
        assert_eq!(
            macos_monitor_index(&monitors, [2800., 0., 22., 24.]),
            Some(1)
        );
        assert_eq!(
            macos_monitor_index(&[[-1920., 0., 1920., 1080., 1., 24.]], [-50., 0., 22., 24.]),
            Some(0)
        );
    }

    #[test]
    fn snapshot_is_metadata_only_and_locked_state_is_empty() {
        let id = Uuid::new_v4();
        let document: VaultDocument = serde_json::from_value(serde_json::json!({
            "version":12,
            "connections":[{"id":id,"name":"Example","itemType":"custom","enabled":true,
                "createdAt":"t","updatedAt":"t","description":"private-purpose-marker",
                "modules":[{"kind":"url","value":"https://private-host-marker.test"}],
                "encryptedSecrets":{"version":2,"nonce":"fake","ciphertext":"secret-cipher-marker"}}],
            "activities":[{"id":id,"time":"t","status":"error","source":"mcp","connectionName":"Example",
                "action":"HTTP","durationMs":1,"error":"private-error-marker"}]
        })).unwrap();
        let value = serde_json::to_value(summarize(&document, true)).unwrap();
        assert_eq!(value["credentials"][0]["name"], "Example");
        for marker in [
            "private-purpose-marker",
            "private-host-marker",
            "secret-cipher-marker",
            "private-error-marker",
        ] {
            assert!(!value.to_string().contains(marker));
        }
        let locked = summarize(&document, false);
        assert!(locked.credentials.is_empty());
        assert!(locked.activities.is_empty());
        assert_eq!(locked.credential_count, 1);
    }
}
