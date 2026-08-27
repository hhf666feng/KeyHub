#![cfg_attr(
    all(windows, not(debug_assertions), feature = "gui"),
    windows_subsystem = "windows"
)]

use anyhow::{Context, Result};
#[cfg(target_os = "macos")]
use mcp_vault::crypto::MasterKey;
#[cfg(feature = "gui")]
use mcp_vault::run_gui;
use mcp_vault::{backup, browser::BrowserBridge, mcp, model::SettingsPatch, vault::Vault};
use std::time::{Duration, Instant};
use std::{env, io::IsTerminal, path::PathBuf};
use tokio::time::sleep;

fn app_data_dir() -> Result<PathBuf> {
    dirs::data_dir()
        .map(|path| path.join("mcp-vault").join("v2"))
        .context("Unable to determine the local data directory")
}

#[tokio::main]
async fn main() {
    if let Err(error) = dispatch().await {
        eprintln!("KRU: {error:#}");
        std::process::exit(1);
    }
}

async fn dispatch() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.first().is_some_and(|arg| arg == "gui") {
        #[cfg(feature = "gui")]
        {
            run_gui()?;
            return Ok(());
        }
        #[cfg(not(feature = "gui"))]
        anyhow::bail!("This is the KRU headless version; use the mcp stdio, config, browser, or backup subcommand");
    }

    #[cfg(target_os = "macos")]
    if matches!(args.as_slice(), [command, action] if command == "key" && action == "migrate") {
        let data_dir = app_data_dir()?;
        if MasterKey::migrate_legacy_macos_key(&data_dir)? {
            Vault::open(data_dir)?;
            println!("The old keychain master key has been migrated; future KRU launches will no longer request keychain permissions");
        } else {
            println!("The app-private master key file already exists; no migration is needed");
        }
        return Ok(());
    }

    let vault = Vault::open(app_data_dir()?)?;
    match args.as_slice() {
        [command, transport] if command == "mcp" && transport == "stdio" => {
            mcp::serve_stdio(vault).await
        }
        [command, format] if command == "config" => {
            println!("{}", mcp::render_config(format)?);
            Ok(())
        }
        [command, action] if command == "browser" && action == "status" => {
            print_browser_status(&vault)
        }
        [command, action] if command == "browser" && action == "enable" => {
            set_browser_enabled(&vault, true, None)
        }
        [command, action, port] if command == "browser" && action == "enable" => {
            set_browser_enabled(&vault, true, Some(parse_port(port)?))
        }
        [command, action] if command == "browser" && action == "disable" => {
            set_browser_enabled(&vault, false, None)
        }
        [command, action] if command == "browser" && action == "pair" => {
            pair_browser(&vault, None).await
        }
        [command, action, port] if command == "browser" && action == "pair" => {
            pair_browser(&vault, Some(parse_port(port)?)).await
        }
        [command, action] if command == "browser" && action == "reset" => {
            reset_browser(&vault).await
        }
        [command, action, file] if command == "backup" && action == "export" => {
            backup::export_to_file(&vault, file)?;
            println!("Backup written to {file}");
            Ok(())
        }
        [command, action, file] if command == "backup" && action == "import" => {
            let summary = if backup::backup_requires_password(file)? {
                require_tty()?;
                let password = rpassword::prompt_password("Legacy backup password:")?;
                backup::import_legacy_from_file(&vault, file, &password)?
            } else {
                backup::import_from_file(&vault, file)?
            };
            println!(
                "Imported: added {}, merged duplicates {}",
                summary.added, summary.merged
            );
            Ok(())
        }
        _ => anyhow::bail!(
            "Usage: kru [gui] | mcp stdio | config <stdio-json|stdio-toml> | browser <status|enable [port]|disable|pair [port]|reset> | backup <export|import> <file> | key migrate (macOS)"
        ),
    }
}

fn parse_port(value: &str) -> Result<u16> {
    let port = value.parse::<u16>().context("Invalid browser bridge port")?;
    if port == 0 {
        anyhow::bail!("Browser bridge port must be between 1 and 65535");
    }
    Ok(port)
}

fn set_browser_enabled(vault: &Vault, enabled: bool, port: Option<u16>) -> Result<()> {
    vault.update_settings_patch(SettingsPatch {
        browser_enabled: Some(enabled),
        browser_port: port,
        ..SettingsPatch::default()
    })?;
    print_browser_status(vault)
}

fn print_browser_status(vault: &Vault) -> Result<()> {
    let settings = vault.settings()?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "enabled": settings.browser_enabled,
            "paired": settings.browser_paired,
            "port": settings.browser_port,
            "endpoint": format!("ws://127.0.0.1:{}/extension", settings.browser_port),
        }))?
    );
    Ok(())
}

async fn pair_browser(vault: &Vault, port: Option<u16>) -> Result<()> {
    let settings = vault.update_settings_patch(SettingsPatch {
        browser_enabled: Some(true),
        browser_port: port,
        ..SettingsPatch::default()
    })?;

    let bridge = BrowserBridge::new(vault.clone());
    bridge.sync().await;
    bridge.start_quick_pairing().await?;
    eprintln!(
        "A 120-second automatic pairing window is enabled; load or wake the KRU Chromium extension (port {}）…",
        settings.browser_port
    );
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(120) {
        if vault.settings()?.browser_paired {
            bridge.stop().await;
            println!("Browser extension paired successfully");
            return Ok(());
        }
        sleep(Duration::from_millis(250)).await;
    }
    bridge.stop().await;
    anyhow::bail!("Browser extension pairing timed out; confirm the extension port matches KRU and try again")
}

async fn reset_browser(vault: &Vault) -> Result<()> {
    let bridge = BrowserBridge::new(vault.clone());
    bridge.reset_pairing().await?;
    bridge.stop().await;
    print_browser_status(vault)
}

fn require_tty() -> Result<()> {
    if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
        anyhow::bail!("Backup password can only be read interactively from a real terminal; piping, arguments, and environment variables are not accepted")
    }
    Ok(())
}
