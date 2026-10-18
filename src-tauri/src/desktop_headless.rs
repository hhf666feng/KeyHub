use anyhow::{Result, bail};

pub fn fill_focused(_value: &str, _submit: bool) -> Result<()> {
    bail!(
        "This headless version of OpenKeylet does not include desktop focus input; use a browser, managed terminal, SSH, or API"
    )
}
