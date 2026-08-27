use anyhow::{Context, Result};
use atomic_write_file::AtomicWriteFile;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

const BUILD_EPOCH_FILE: &str = "mcp-build-epoch";

pub fn activate_build(data_dir: &Path, executable: &Path) -> Result<String> {
    let build_id = executable_fingerprint(executable)?;
    write_epoch_if_changed(data_dir, &build_id)?;
    Ok(build_id)
}

pub fn invalidate(data_dir: &Path) -> Result<()> {
    write_epoch(data_dir, &format!("stopped:{}", uuid::Uuid::new_v4()))
}

pub fn exit_process_when_changed(data_dir: PathBuf, expected: String) -> Result<()> {
    thread::Builder::new()
        .name("kru-mcp-build-epoch".to_owned())
        .spawn(move || {
            let path = data_dir.join(BUILD_EPOCH_FILE);
            loop {
                thread::sleep(Duration::from_millis(500));
                if std::fs::read_to_string(&path)
                    .ok()
                    .is_some_and(|value| value.trim() != expected)
                {
                    std::process::exit(0);
                }
            }
        })
        .context("Unable to start KRU MCP build generation monitor")?;
    Ok(())
}

fn executable_fingerprint(executable: &Path) -> Result<String> {
    let mut file = File::open(executable)
        .with_context(|| format!("Unable to read KRU executable:{}", executable.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn write_epoch_if_changed(data_dir: &Path, value: &str) -> Result<()> {
    let path = data_dir.join(BUILD_EPOCH_FILE);
    if std::fs::read_to_string(&path)
        .ok()
        .is_some_and(|current| current.trim() == value)
    {
        return Ok(());
    }
    write_epoch(data_dir, value)
}

fn write_epoch(data_dir: &Path, value: &str) -> Result<()> {
    std::fs::create_dir_all(data_dir).context("Unable to create the KRU data directory")?;
    let path = data_dir.join(BUILD_EPOCH_FILE);
    let mut file = AtomicWriteFile::open(&path).context("Unable to create KRU build generation file")?;
    file.write_all(value.as_bytes())
        .context("Unable to write KRU build generation file")?;
    file.commit().context("Unable to save KRU build generation file")?;
    Ok(())
}
