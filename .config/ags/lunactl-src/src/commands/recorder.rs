use anyhow::{Context, Result, anyhow};
use clap::{Args, Subcommand};
use std::process::{Command, Stdio};
use chrono::Local;
use xdg_user;
use notify_rust::Notification;
use std::fs;

#[derive(Args, Debug)]
pub struct RecorderArgs {
    #[clap(subcommand)]
    pub command: RecorderCommand,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum RecorderCommand {
    /// Toggles the recording state (starts if not running, stops if running).
    Toggle { 
        /// Record the entire focused screen instead of selecting an area.
        #[clap(long)]
        fullscreen: bool 
    },
}

fn is_process_running(process_name: &str) -> bool {
    Command::new("pidof")
        .arg(process_name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_command_output(command: &mut Command) -> Result<String> {
    let output = command.output()
        .with_context(|| format!("Failed to execute command: {}", command.get_program().to_string_lossy()))?;
        
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow!("Command failed: {}\nStderr: {}", command.get_program().to_string_lossy(), stderr))
    }
}

fn get_audio_source() -> Result<String> {
    let output = get_command_output(
        &mut Command::new("pactl").args(["list", "short", "sources"])
    )?;
    output.lines()
        .find(|line| line.contains("monitor"))
        .and_then(|line| line.split('\t').next())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("No audio monitor source found"))
}

fn get_active_monitor() -> Result<String> {
    let output = get_command_output(
        &mut Command::new("hyprctl").args(["activewindow", "-j"])
    )?;
    let monitor = serde_json::from_str::<serde_json::Value>(&output)
        .context("Failed to parse hyprctl output")?
        .get("monitor")
        .and_then(|m| m.as_i64())
        .ok_or_else(|| anyhow!("Invalid monitor data"))?;

    let output = get_command_output(
        &mut Command::new("hyprctl").args(["monitors", "-j"])
    )?;
    let monitors = serde_json::from_str::<Vec<serde_json::Value>>(&output)
        .context("Failed to parse monitors data")?;
        
    let monitor = monitors.get(monitor as usize)
        .ok_or_else(|| anyhow!("Monitor not found"))?;
        
    monitor.get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Invalid monitor name"))
}

fn get_slurp_geometry() -> Result<String> {
    get_command_output(&mut Command::new("slurp"))
        .context("Failed to get selection geometry with slurp")
}

pub fn handle_recorder_command(args: &RecorderArgs, _debug: bool) -> Result<()> {
    if is_process_running("wf-recorder") {
        get_command_output(&mut Command::new("killall").args(&["-SIGINT", "wf-recorder"]))?;
        Notification::new()
            .summary("Recording stopped")
            .appname("lunactl")
            .show()?;
    } else {
        let dirs = xdg_user::UserDirs::new()?;
        let videos_dir = dirs.videos()
            .ok_or_else(|| anyhow!("Videos directory not found in XDG config"))?;
        fs::create_dir_all(&videos_dir)?;
        let date = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let output_file = videos_dir.join(format!("rec_{}.mp4", date));

        Notification::new()
            .summary("Recording started")
            .body(output_file.to_str().unwrap_or("Invalid path"))
            .appname("lunactl")
            .show()
            .map_err(|e| anyhow!("Failed to show notification: {}", e))?;

        let mut cmd = Command::new("wf-recorder");
        cmd.args(&["-c", "h264_vaapi", "-d", "/dev/dri/renderD128"]);
        cmd.arg("-f").arg(&output_file);
        cmd.arg("--audio").arg(get_audio_source()?);

        match &args.command {
            RecorderCommand::Toggle { fullscreen } => {
                if *fullscreen {
                    cmd.arg("-o").arg(get_active_monitor()?);
                } else {
                    cmd.arg("-g").arg(get_slurp_geometry()?);
                }
            }
        }

        cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
    }
    Ok(())
}
