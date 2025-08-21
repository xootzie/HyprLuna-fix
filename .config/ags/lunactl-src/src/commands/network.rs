use anyhow::{Context, Result, anyhow};
use clap::{Args, Subcommand};
use std::process::Command;
use std::{thread, time::Duration};

#[derive(Args, Debug)]
pub struct NetworkArgs {
    #[command(subcommand)]
    command: NetworkCommands,
}

#[derive(Subcommand, Debug)]
enum NetworkCommands {
    /// Get the SSID of the current Wi-Fi network
    Ssid,
    /// Calculates network bandwidth for a given direction
    Bandwidth(BandwidthArgs),
}

#[derive(Args, Debug)]
struct BandwidthArgs {
    /// 'recv' for received, 'sent' for sent
    #[arg(index = 1, default_value = "recv")]
    direction: String,
}

// --- Bandwidth Helper Functions ---
fn get_bytes(direction: &str) -> Result<u64> {
    let content = std::fs::read_to_string("/proc/net/dev")
        .context("Failed to read /proc/net/dev")?;
    let mut total_bytes = 0;
    let column = if direction == "recv" { 1 } else { 9 };

    for line in content.lines().skip(2) {
        if line.contains("lo:") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(bytes_str) = parts.get(column) {
            if let Ok(bytes) = bytes_str.parse::<u64>() {
                total_bytes += bytes;
            }
        }
    }
    Ok(total_bytes)
}

fn format_bandwidth(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{} B/s", bytes);
    }
    let mut bandwidth = bytes as f64 / 1024.0;
    let units = ["KB/s", "MB/s", "GB/s", "TB/s"];
    let mut i = 0;
    while bandwidth >= 1024.0 && i < units.len() - 1 {
        bandwidth /= 1024.0;
        i += 1;
    }
    format!("{:.1} {}", bandwidth, units[i])
}

// --- Command Handlers ---
fn handle_bandwidth(args: &BandwidthArgs) -> Result<()> {
    if args.direction != "recv" && args.direction != "sent" {
        return Err(anyhow!("Invalid direction. Use 'recv' or 'sent'"));
    }

    let bytes1 = get_bytes(&args.direction)
        .context("Failed to get initial byte count")?;
    
    thread::sleep(Duration::from_secs(1));
    
    let bytes2 = get_bytes(&args.direction)
        .context("Failed to get second byte count")?;

    let bandwidth = bytes2.saturating_sub(bytes1);
    println!("{}", format_bandwidth(bandwidth));

    Ok(())
}

fn handle_ssid() -> Result<()> {
    let output = Command::new("nmcli")
        .args(["-t", "-f", "active,ssid", "dev", "wifi"])
        .output()
        .context("Failed to execute nmcli")?;
    if !output.status.success() {
        println!(""); // Print empty string if no wifi
        return Ok(());
    }
    let ssid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.starts_with("yes:"))
        .and_then(|line| line.split(':').nth(1))
        .unwrap_or("Disconnected")
        .to_string();
    println!("{}", ssid);
    Ok(())
}

pub fn handle_network_command(args: &NetworkArgs, _debug: bool) -> Result<()> {
    match &args.command {
        NetworkCommands::Bandwidth(bandwidth_args) => handle_bandwidth(bandwidth_args)?,
        NetworkCommands::Ssid => handle_ssid()?,
    }
    Ok(())
}
