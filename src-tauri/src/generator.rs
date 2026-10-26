use anyhow::{Result, ensure};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
}

fn random_index(upper: usize) -> Result<usize> {
    let bound = 256 - (256 % upper);
    loop {
        let mut byte = [0];
        getrandom::fill(&mut byte)
            .map_err(|e| anyhow::anyhow!("Random generator unavailable: {e}"))?;
        if (byte[0] as usize) < bound {
            return Ok(byte[0] as usize % upper);
        }
    }
}

pub fn password(options: &Options) -> Result<String> {
    ensure!(
        (8..=128).contains(&options.length),
        "Password length must be 8–128"
    );
    let mut groups = Vec::new();
    for (enabled, chars) in [
        (options.uppercase, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
        (options.lowercase, "abcdefghijklmnopqrstuvwxyz"),
        (options.digits, "0123456789"),
        (options.symbols, "!@#$%^&*()-_=+[]{}:,.?"),
    ] {
        if enabled {
            groups.push(chars.as_bytes());
        }
    }
    ensure!(!groups.is_empty(), "Select at least one character group");
    let alphabet = groups.concat();
    let mut output = Vec::with_capacity(options.length);
    for group in groups {
        output.push(group[random_index(group.len())?]);
    }
    while output.len() < options.length {
        output.push(alphabet[random_index(alphabet.len())?]);
    }
    for i in (1..output.len()).rev() {
        let j = random_index(i + 1)?;
        output.swap(i, j);
    }
    Ok(String::from_utf8(output)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_passwords_meet_selected_constraints() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..100 {
            let value = password(&Options {
                length: 24,
                uppercase: true,
                lowercase: true,
                digits: true,
                symbols: true,
            })
            .unwrap();
            assert_eq!(value.len(), 24);
            assert!(value.chars().any(|c| c.is_ascii_uppercase()));
            assert!(value.chars().any(|c| c.is_ascii_lowercase()));
            assert!(value.chars().any(|c| c.is_ascii_digit()));
            assert!(value.chars().any(|c| !c.is_ascii_alphanumeric()));
            assert!(seen.insert(value));
        }
        assert!(
            password(&Options {
                length: 20,
                uppercase: false,
                lowercase: false,
                digits: false,
                symbols: false
            })
            .is_err()
        );
        assert!(
            password(&Options {
                length: 129,
                uppercase: true,
                lowercase: true,
                digits: true,
                symbols: true
            })
            .is_err()
        );
    }
}
