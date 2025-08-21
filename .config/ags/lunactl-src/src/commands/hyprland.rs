use anyhow::{Context, Result, bail};
use clap::{Args, Subcommand};
use serde::Deserialize;
use std::process::Command;

#[derive(Deserialize, Debug)]
struct HyprlandWorkspace {
    id: i32,
}

#[derive(Debug, Subcommand)]
pub enum HyprlandCommands {
    /// Switch to a workspace in the current group, optionally moving the active window.
    Workspace(WorkspaceArgs),
    /// Move active window to a workspace in the current group silently.
    MoveToWorkspace(SilentMoveArgs),
}

#[derive(Debug, Args)]
pub struct WorkspaceArgs {
    /// The workspace ID (e.g., 1-10) within the current group.
    pub id: i32,
    /// Move the active window along with switching the workspace.
    #[clap(long)]
    pub move_window: bool,
}

#[derive(Debug, Args)]
pub struct SilentMoveArgs {
    /// The workspace ID (e.g., 1-10) to move the window to.
    pub id: i32,
}

fn get_target_workspace_id(relative_id: i32) -> Result<i32> {
    let output = Command::new("hyprctl")
        .args(["-j", "activeworkspace"])
        .output()
        .context("Failed to execute hyprctl")?;

    if !output.status.success() {
        bail!("Failed to get active workspace from hyprctl");
    }

    let current_workspace: HyprlandWorkspace = serde_json::from_slice(&output.stdout)
        .context("Failed to parse hyprctl output")?;

    let current_id = current_workspace.id;
    let group_base = ((current_id - 1) / 10) * 10;
    Ok(group_base + relative_id)
}

fn dispatch_hyprctl(action: &str, target_id: i32) -> Result<()> {
    let status = Command::new("hyprctl")
        .arg("dispatch")
        .arg(action)
        .arg(target_id.to_string())
        .status()
        .context("Failed to execute hyprctl dispatch")?;

    if !status.success() {
        bail!("hyprctl dispatch failed with status: {}", status);
    }
    Ok(())
}

pub fn handle_hyprland_command(command: &HyprlandCommands, _debug: bool) -> Result<()> {
    match command {
        HyprlandCommands::Workspace(args) => {
            let target_id = get_target_workspace_id(args.id)?;
            if args.move_window {
                dispatch_hyprctl("movetoworkspace", target_id)?;
            }
            dispatch_hyprctl("workspace", target_id)
        }
        HyprlandCommands::MoveToWorkspace(args) => {
            let target_id = get_target_workspace_id(args.id)?;
            dispatch_hyprctl("movetoworkspacesilent", target_id)
        }
    }
}
