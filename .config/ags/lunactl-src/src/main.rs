use anyhow::Result;
use clap::{Parser, Subcommand};
mod commands;
use commands::network::NetworkArgs;

use commands::screenshot::ScreenshotArgs;
use commands::idle_inhibitor::IdleInhibitorArgs;
use commands::recorder::RecorderArgs;

use commands::core::{handle_core_command, CoreCommands};
use commands::hyprland::{handle_hyprland_command, HyprlandCommands};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(global = true, long, help = "Enable debug logging")]
    debug: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Core commands for ags management
    #[command(subcommand)]
    Core(CoreCommands),
    /// Hyprland related commands
    #[command(subcommand)]
    Hyprland(HyprlandCommands),
    /// Network related commands
    Network(Box<NetworkArgs>),
    Screenshot(ScreenshotArgs),
    /// Prevents the system from becoming idle
    IdleInhibitor(IdleInhibitorArgs),
    Recorder(RecorderArgs),
    RestartAgs(commands::restart_ags::RestartAgsArgs),
    Scale(commands::scale::ScaleArgs),
    /// Parse Hyprland keybinds and output as JSON
    GetKeybinds(commands::get_keybinds::GetKeybindsArgs),
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let result = match &cli.command {
        Commands::Core(command) => handle_core_command(command),
        Commands::Hyprland(args) => handle_hyprland_command(args, cli.debug),
        Commands::Network(command) => commands::network::handle_network_command(command, cli.debug),
        Commands::Screenshot(args) => commands::screenshot::handle_screenshot_command(args, cli.debug),
        Commands::IdleInhibitor(args) => commands::idle_inhibitor::handle_idle_inhibitor_command(args, cli.debug),
        Commands::Recorder(args) => commands::recorder::handle_recorder_command(args, cli.debug),
        Commands::RestartAgs(args) => commands::restart_ags::handle_restart_ags_command(args, cli.debug),
        Commands::Scale(args) => commands::scale::handle_scale_command(args, cli.debug),
        Commands::GetKeybinds(args) => commands::get_keybinds::handle_get_keybinds_command(args, cli.debug),
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }

    Ok(())
}
