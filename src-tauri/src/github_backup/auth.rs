//! Read an explicitly selected local GitHub CLI login without exposing its token to the renderer.
use super::*;
use std::{path::PathBuf, process::Stdio};
use tokio::io::AsyncReadExt;

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct AuthInput {
    #[serde(default)]
    pub auth_source: String,
    #[serde(default)]
    pub token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub login: String,
}

fn cli_path() -> Result<PathBuf> {
    // Resolve absolute PATH entries ourselves; never search the working directory.
    let name = if cfg!(windows) { "gh.exe" } else { "gh" };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .filter(|path| path.is_absolute())
        .map(|path| path.join(name))
        .find(|path| path.is_file())
        .context("GITHUB_CLI_MISSING")
}

async fn read_cli_token(mut command: tokio::process::Command) -> Result<Zeroizing<String>> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn().context("GITHUB_CLI_AUTH")?;
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let mut bytes = Zeroizing::new(Vec::new());
        child
            .stdout
            .take()
            .context("GITHUB_CLI_AUTH")?
            .take(4097)
            .read_to_end(&mut bytes)
            .await
            .context("GITHUB_CLI_AUTH")?;
        if bytes.len() > 4096 {
            bail!("GITHUB_CLI_AUTH");
        }
        if !child.wait().await.context("GITHUB_CLI_AUTH")?.success() {
            bail!("GITHUB_CLI_AUTH");
        }
        let token = Zeroizing::new(
            std::str::from_utf8(&bytes)
                .map_err(|_| anyhow::anyhow!("GITHUB_CLI_AUTH"))?
                .trim()
                .to_owned(),
        );
        validate_token(&token).map_err(|_| anyhow::anyhow!("GITHUB_CLI_AUTH"))?;
        Ok(token)
    })
    .await;
    result.map_err(|_| anyhow::anyhow!("GITHUB_CLI_TIMEOUT"))?
}

pub(super) async fn token(source: &str, supplied: &str) -> Result<Zeroizing<String>> {
    match source {
        "" | "token" => {
            validate_token(supplied.trim())?;
            Ok(Zeroizing::new(supplied.trim().to_owned()))
        }
        "cli" => {
            let mut command = tokio::process::Command::new(cli_path()?);
            command
                .args(["auth", "token", "--hostname", "github.com"])
                .env_remove("GH_TOKEN")
                .env_remove("GITHUB_TOKEN")
                .env("GH_HOST", "github.com")
                .env("GH_PROMPT_DISABLED", "1");
            read_cli_token(command).await
        }
        _ => bail!("GITHUB_AUTH_SOURCE"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn auth_sources_are_explicit_and_tokens_are_not_serializable() {
        assert_eq!(
            &**token("token", " synthetic-token ").await.unwrap(),
            "synthetic-token"
        );
        assert!(token("unknown", "secret").await.is_err());
        assert!(token("token", "line\nbreak").await.is_err());
        assert!(
            !serde_json::to_string(&AccountStatus {
                login: "alice".into()
            })
            .unwrap()
            .contains("token")
        );
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn cli_output_is_bounded_and_errors_do_not_echo_credentials() {
        let mut command = tokio::process::Command::new("cmd.exe");
        command.args(["/d", "/c", "echo synthetic-token"]);
        assert_eq!(&**read_cli_token(command).await.unwrap(), "synthetic-token");
        let mut failed = tokio::process::Command::new("cmd.exe");
        failed.args(["/d", "/c", "echo sensitive-marker & exit /b 1"]);
        assert_eq!(
            read_cli_token(failed).await.unwrap_err().to_string(),
            "GITHUB_CLI_AUTH"
        );
        let mut oversized = tokio::process::Command::new("cmd.exe");
        oversized.args([
            "/d",
            "/c",
            "for /L %i in (1,1,5000) do @echo synthetic-overflow",
        ]);
        assert_eq!(
            read_cli_token(oversized).await.unwrap_err().to_string(),
            "GITHUB_CLI_AUTH"
        );
    }
}
