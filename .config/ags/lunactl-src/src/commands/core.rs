use anyhow::Result;
use clap::Subcommand;
use std::process::{Command, Stdio};
use std::env;

#[derive(Subcommand)]
#[derive(Debug)]
pub enum CoreCommands {
    /// Restart ags (killall agsv1 && agsv1 &)
    RestartAgs,
    /// Launch the graphical settings manager
    Settings,
}

pub fn handle_core_command(command: &CoreCommands) -> Result<()> {
    match command {
        CoreCommands::RestartAgs => {
            eprintln!("Attempting to restart ags...");

            // Try to kill the existing process, but don't fail if it's not running.
            let _ = Command::new("killall").arg("agsv1").status();

            // Start the new process, detached.
            Command::new("agsv1")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;

            eprintln!("ags restart signal sent.");
        }
        CoreCommands::Settings => {
            eprintln!("Launching settings UI...");
            let mut path = env::current_exe()?;
            path.pop();
            path.push("luna-settings");

            Command::new(path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            eprintln!("Settings UI launch signal sent.");
        }
    }
    Ok(())
}
