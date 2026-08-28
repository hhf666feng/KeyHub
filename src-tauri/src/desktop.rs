use anyhow::{Context, Result, bail};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

// Keep desktop filling aligned with the managed terminal and SSH command path.
// A private key or certificate bundle can legitimately exceed the old 64 KB
// ceiling, while a 1 MiB guard still prevents an accidental unbounded keystroke
// injection into the foreground application.
const MAX_FILL_BYTES: usize = 1_048_576;

pub fn fill_focused(value: &str, submit: bool) -> Result<()> {
    validate_fill_value(value)?;

    #[cfg(target_os = "windows")]
    if fill_standard_windows_control(value)? {
        if submit {
            press_enter()?;
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .is_ok_and(|value| value.eq_ignore_ascii_case("wayland"))
    {
        bail!("Wayland does not allow KRU to reliably type into an arbitrary focused window; use a browser or managed terminal instead");
    }

    let mut enigo = Enigo::new(&Settings::default()).context("Unable to initialize desktop input")?;
    enigo.text(value).context("Unable to type into the currently focused control")?;
    if submit {
        enigo
            .key(Key::Return, Direction::Click)
            .context("Unable to submit the currently focused control")?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn press_enter() -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default()).context("Unable to initialize desktop input")?;
    enigo
        .key(Key::Return, Direction::Click)
        .context("Unable to submit the currently focused control")
}

fn validate_fill_value(value: &str) -> Result<()> {
    if value.len() > MAX_FILL_BYTES {
        bail!("Secret field exceeds 1 MiB and cannot be written through desktop input");
    }
    if value.contains('\0') {
        bail!("Secret field contains a null character that desktop input cannot type");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn fill_standard_windows_control(value: &str) -> Result<bool> {
    use std::mem::size_of;
    use windows::Win32::{
        Foundation::{LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            GUITHREADINFO, GetClassNameW, GetGUIThreadInfo, SEND_MESSAGE_TIMEOUT_FLAGS,
            SMTO_ABORTIFHUNG, SMTO_BLOCK, SendMessageTimeoutW, WM_SETTEXT,
        },
    };

    let mut thread = GUITHREADINFO {
        cbSize: size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetGUIThreadInfo(0, &mut thread) }.is_err() || thread.hwndFocus.0.is_null() {
        return Ok(false);
    }

    let mut class_name = [0_u16; 256];
    let class_length = unsafe { GetClassNameW(thread.hwndFocus, &mut class_name) };
    if class_length <= 0 {
        return Ok(false);
    }
    let class_name = String::from_utf16_lossy(&class_name[..class_length as usize]);
    if !class_name.to_ascii_lowercase().contains("edit") {
        return Ok(false);
    }

    let wide = value
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut control_result = 0_usize;
    let dispatched = unsafe {
        SendMessageTimeoutW(
            thread.hwndFocus,
            WM_SETTEXT,
            WPARAM(0),
            LPARAM(wide.as_ptr() as isize),
            SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_ABORTIFHUNG.0 | SMTO_BLOCK.0),
            1_000,
            Some(&mut control_result),
        )
    };
    if dispatched.0 == 0 {
        bail!("Foreground input control is unresponsive; writing canceled");
    }
    if control_result == 0 {
        bail!("Foreground input control refused the write");
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_fill_accepts_large_values_up_to_the_shared_boundary() {
        assert!(validate_fill_value(&"x".repeat(MAX_FILL_BYTES)).is_ok());
        assert!(validate_fill_value(&"x".repeat(MAX_FILL_BYTES + 1)).is_err());
        assert!(validate_fill_value("contains\0nul").is_err());
    }
}
