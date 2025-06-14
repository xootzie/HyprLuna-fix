use anyhow::{Context, Result, anyhow};
use clap::Args;
use std::process::Command;
use std::str;

#[derive(Args, Debug)]
pub struct ScaleArgs {
    /// The amount to adjust the text scaling factor by (e.g., 0.1 or -0.1)
    pub adjustment: f64,
}

pub fn handle_scale_command(args: &ScaleArgs, _debug: bool) -> Result<()> {
    // Get the current scaling factor
    let output = Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "text-scaling-factor"])
        .output()
        .context("Failed to execute gsettings get command")?;

    if !output.status.success() {
        let error_message = str::from_utf8(&output.stderr)
            .unwrap_or("Unknown error");
        return Err(anyhow!("Failed to get gsettings value: {}", error_message));
    }

    let current_str = str::from_utf8(&output.stdout)
        .context("Invalid UTF-8 in gsettings output")?
        .trim();

    let current: f64 = current_str
        .parse()
        .with_context(|| format!("Failed to parse scale value: {}", current_str))?;

    // Calculate the new scaling factor
    let mut new_scale = current + args.adjustment;

    // Ensure the new scaling factor is not less than a minimum
    const MIN_SCALE: f64 = 0.1;
    if new_scale < MIN_SCALE {
        new_scale = MIN_SCALE;
    }

    // Set the new scaling factor
    let status = Command::new("gsettings")
        .args(["set", "org.gnome.desktop.interface", "text-scaling-factor", &new_scale.to_string()])
        .status()
        .context("Failed to execute gsettings set command")?;

    if !status.success() {
        return Err(anyhow!("Failed to set gsettings value"));
    }

    Ok(())
}
