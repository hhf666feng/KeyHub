use anyhow::{Result, bail};

pub fn fill_focused(_value: &str) -> Result<()> {
    bail!("This headless KRU version does not include desktop focus input; use a browser, managed terminal, SSH, or API")
}
