use anyhow::{Context, Result, anyhow};
use clap::{Args, Subcommand};
use std::{env, fs};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Args, Debug)]
pub struct ScreenshotArgs {
    #[command(subcommand)]
    action: ScreenshotAction,

    #[arg(long, short, help = "Send a notification")]
    notify: bool,

    #[arg(long, short, help = "Capture the cursor")]
    cursor: bool,

    #[arg(long, short, help = "Freeze the screen while selecting")]
    freeze: bool,

    #[arg(long, short, help = "Wait N seconds before screenshot")]
    wait: Option<u64>,

    #[arg(long, short, help = "Scale the screenshot")]
    scale: Option<f64>,
}

#[derive(Subcommand, Debug)]
pub enum ScreenshotAction {
    /// Copy screenshot to clipboard
    Copy { #[command(subcommand)] target: ScreenshotTarget },
    /// Save screenshot to a file
    Save { 
        #[command(subcommand)] 
        target: ScreenshotTarget, 
        path: Option<String> 
    },
    /// Both copy and save
    Copysave { 
        #[command(subcommand)] 
        target: ScreenshotTarget, 
        path: Option<String> 
    },
    /// Open screenshot in an editor
    Edit { #[command(subcommand)] target: ScreenshotTarget },
    /// Check for dependencies
    Check,
}

#[derive(Subcommand, Debug)]
pub enum ScreenshotTarget {
    /// The active window
    Active,
    /// The entire screen
    Screen,
    /// A specific output/monitor
    Output,
    /// A manually selected area
    Area,
}



// --- Helper Functions ---
fn check_command(command: &str, debug: bool) -> Result<()> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {}", command))
        .output()
        .with_context(|| format!("Failed to check for command: {}", command))?;
        
    if debug {
        if output.status.success() {
            println!("   {}: OK", command);
        } else {
            println!("   {}: NOT FOUND", command);
        }
    }
    
    Ok(())
}

fn get_target_directory() -> Result<PathBuf> {
    let pictures_dir = env::var("XDG_PICTURES_DIR")
        .or_else(|_| env::var("HOME").map(|home| format!("{}/Pictures", home)))
        .map(PathBuf::from)
        .map_err(|e| anyhow!("Failed to get pictures directory: {}", e))?;
        
    if !pictures_dir.exists() {
        std::fs::create_dir_all(&pictures_dir)
            .with_context(|| format!("Failed to create directory: {}", pictures_dir.display()))?;
    }
    
    Ok(pictures_dir)
}

fn generate_filename() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("screenshot_{}.png", now)
}

fn get_active_window_geom() -> Result<String> {
    let output = Command::new("hyprctl")
        .args(["-j", "activewindow"])
        .output()
        .context("Failed to execute hyprctl")?;

    if !output.status.success() {
        return Err(anyhow!("Failed to get active window geometry"));
    }

    let window: serde_json::Value = serde_json::from_slice(&output.stdout)
        .context("Failed to parse hyprctl output")?;

    let x = window["at"][0].as_i64().context("Failed to get x coordinate")?;
    let y = window["at"][1].as_i64().context("Failed to get y coordinate")?;
    let width = window["size"][0].as_i64().context("Failed to get width")?;
    let height = window["size"][1].as_i64().context("Failed to get height")?;

    Ok(format!("{},{},{},{}", x, y, width, height))
}

fn get_area_geom() -> Result<String> {
    let output = Command::new("slurp")
        .output()
        .context("Failed to execute slurp")?;

    if !output.status.success() {
        return Err(anyhow!("Failed to get area geometry"));
    }

    let geom = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();

    if geom.is_empty() {
        return Err(anyhow!("No area selected"));
    }

    Ok(geom)
}

fn get_active_output_name() -> Result<String> {
    let output = Command::new("hyprctl")
        .args(["-j", "monitors"])
        .output()
        .context("Failed to execute hyprctl")?;

    if !output.status.success() {
        return Err(anyhow!("Failed to get monitors"));
    }

    let monitors: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout)
        .context("Failed to parse hyprctl output")?;

    for monitor in monitors {
        if monitor["focused"].as_bool().unwrap_or(false) {
            return monitor["name"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| anyhow!("Failed to get monitor name"));
        }
    }

    Err(anyhow!("No active monitor found"))
}

// --- Main Command Handler ---
pub fn handle_screenshot_command(args: &ScreenshotArgs, debug: bool) -> Result<()> {
    if let ScreenshotAction::Check = args.action {
        if debug {
            println!("Checking if required tools are installed...");
        }
        let _ = check_command("grim", debug);
        let _ = check_command("slurp", debug);
        let _ = check_command("hyprctl", debug);
        let _ = check_command("wl-copy", debug);
        let _ = check_command("tee", debug);
        return Ok(());
    }

    let mut grim_command = Command::new("grim");
    if args.cursor {
        grim_command.arg("-c");
    }

    let (action, target, path) = match &args.action {
        ScreenshotAction::Save { target, path } => ("save", target, path),
        ScreenshotAction::Copy { target } => ("copy", target, &None),
        ScreenshotAction::Copysave { target, path } => ("copysave", target, path),
        _ => return Ok(()), // Check is handled above
    };

    match target {
        ScreenshotTarget::Active => grim_command.arg("-g").arg(get_active_window_geom()?), 
        ScreenshotTarget::Area => grim_command.arg("-g").arg(get_area_geom()?), 
        ScreenshotTarget::Output => grim_command.arg("-o").arg(get_active_output_name()?), 
        ScreenshotTarget::Screen => &mut grim_command, // No extra args needed
    };

    let file_path = match path {
        Some(p) => PathBuf::from(p),
        None => get_target_directory()?.join(generate_filename()),
    };

    match action {
        "save" => {
            grim_command.arg(file_path);
            let status = grim_command.status()?;
            if status.success() {
                println!("Screenshot saved.");
            }
        }
        "copy" => {
            grim_command.arg("-"); // Output to stdout
            let mut grim_process = grim_command.stdout(Stdio::piped()).spawn()?;
            if let Some(stdout) = grim_process.stdout.take() {
                let mut wl_copy_process = Command::new("wl-copy").stdin(stdout).spawn()?;
                wl_copy_process.wait()?;
            }
            grim_process.wait()?;
            println!("Screenshot copied.");
        }
        "copysave" => {
            fs::create_dir_all(file_path.parent().unwrap())?;
            grim_command.arg("-");
            let mut grim_process = grim_command.stdout(Stdio::piped()).spawn()?;
            if let Some(stdout) = grim_process.stdout.take() {
                let mut tee_process = Command::new("tee").arg(&file_path).stdin(stdout).stdout(Stdio::piped()).spawn()?;
                if let Some(tee_stdout) = tee_process.stdout.take() {
                    let mut wl_copy_process = Command::new("wl-copy").stdin(tee_stdout).spawn()?;
                    wl_copy_process.wait()?;
                }
                tee_process.wait()?;
            }
            grim_process.wait()?;
            println!("Screenshot saved and copied.");
        }
        _ => {},
    }

    Ok(())
}
