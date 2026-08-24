#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{Context, Result};
#[cfg(feature = "gui")]
use mcp_vault::run_gui;
use mcp_vault::{backup, mcp, vault::Vault};
use std::{env, io::IsTerminal, path::PathBuf};

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
        anyhow::bail!("This is the KRU headless version; use the mcp stdio, config, or backup subcommand");
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
        [command, action, file] if command == "backup" && action == "export" => {
            require_tty()?;
            let password = rpassword::prompt_password("Backup password:")?;
            let confirm = rpassword::prompt_password("Enter again:")?;
            if password != confirm {
                anyhow::bail!("The passwords do not match");
            }
            backup::export_to_file(&vault, file, &password)?;
            println!("Backup written to {file}");
            Ok(())
        }
        [command, action, file] if command == "backup" && action == "import" => {
            require_tty()?;
            let password = rpassword::prompt_password("Backup password:")?;
            let summary = backup::import_from_file(&vault, file, &password)?;
            println!("Imported: added {}, update {}", summary.added, summary.updated);
            Ok(())
        }
        _ => anyhow::bail!(
            "Usage: kru [gui] | mcp stdio | config <stdio-json|stdio-toml> | backup <export|import> <file>"
        ),
    }
}

fn require_tty() -> Result<()> {
    if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
        anyhow::bail!("Backup password can only be read interactively from a real terminal; piping, arguments, and environment variables are not accepted")
    }
    Ok(())
}
