use anyhow::{Context, Result};
use clap::Args;
use std::process::Command;

#[derive(Args, Debug)]
pub struct RestartAgsArgs {}

pub fn handle_restart_ags_command(_args: &RestartAgsArgs, _debug: bool) -> Result<()> {
    // Kill the process. Ignore the error if the process doesn't exist.
    let _ = Command::new("killall").arg("agsv1").status();

    // Start the process in the background
    Command::new("agsv1")
        .spawn()
        .context("Failed to start AGS")?;

    Ok(())
}
