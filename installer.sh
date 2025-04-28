#!/bin/bash
# by SnowF & Gemini
# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
REPO_URL="https://github.com/Lunaris-Project/HyprLuna.git"
AGSV1_REPO_URL="https://github.com/Lunaris-Project/agsv1"
HYPRLUNA_DIR="$HOME/HyprLuna"
BACKUP_DIR="$HOME/HyprLuna-User-Bak"
PARU_TEMP_DIR=$(mktemp -d)  # Temporary directory for building paru
AGSV1_TEMP_DIR=$(mktemp -d) # Temporary directory for building agsv1

# List of packages to install via paru (from HTML Step 2)
# Note: The original list includes 'visual-stuido-code-bin' which is misspelled.
# Correcting it to 'visual-studio-code-bin'.
# Also, adding 'git' explicitly just in case, although it's a prerequisite.
REQUIRED_PACKAGES=(
    git hyprland axel bc coreutils cliphist cmake curl rofi-wayland rsync wget ripgrep jq npm meson typescript gjs xdg-user-dirs
    brightnessctl ddcutil pavucontrol wireplumber libdbusmenu-gtk3 kitty playerctl swww gobject-introspection glib2-devel gvfs glib2
    glibc gtk3 gtk-layer-shell libpulse pam gnome-bluetooth-3.0 gammastep libsoup3 libnotify networkmanager power-profiles-daemon
    upower adw-gtk-theme-git qt5ct qt5-wayland fontconfig ttf-readex-pro ttf-jetbrains-mono-nerd ttf-material-symbols-variable-git
    apple-fonts ttf-space-mono-nerd ttf-rubik-vf bibata-cursor-theme-bin bibata-rainbow-cursor-theme bibata-extra-cursor-theme
    bibata-cursor-translucent ttf-gabarito-git fish foot starship polkit-gnome gnome-keyring gnome-control-center
    blueberry webp-pixbuf-loader gtksourceview3 yad ydotool xdg-user-dirs-gtk tinyxml2 gtkmm3 gtksourceviewmm cairomm xdg-desktop-portal
    xdg-desktop-portal-gtk xdg-desktop-portal-hyprland gradience python-libsass python-pywalfox matugen-bin python-build python-pillow
    python-pywal python-setuptools-scm python-wheel swappy wf-recorder grim tesseract tesseract-data-eng slurp dart-sass python-pywayland
    python-psutil hypridle hyprutils hyprlock wlogout wl-clipboard hyprpicker ghostty ttf-noto-sans-cjk-vf noto-fonts-emoji cava metar
    ttf-material-symbols-variable-git gowall go overskride visual-studio-code-bin mpv github-desktop-bin
)

# Directories that will be copied from the HyprLuna repo to your home directory
# !! WARNING !! These will overwrite existing files/directories in your home folder.
DOTFILES_DIRS=(".config" ".local" ".cache" ".vscode" ".fonts" ".ags" "Pictures") # Pictures is risky!

# --- Functions ---

# Function to display messages in color
print_step() {
    echo -e "\n\e[34m-->\e[0m \e[1m$1\e[0m"
}

print_info() {
    echo -e "\e[32mINFO:\e[0m $1"
}

print_warning() {
    echo -e "\e[33mWARNING:\e[0m $1"
}

print_error() {
    echo -e "\e[31mERROR:\e[0m $1" >&2
}

# --- Script Start ---

print_step "Starting HyprLuna Installation Script"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "This script should be run as a normal user, not root."
    print_error "The script will use 'sudo' internally where needed."
    exit 1
fi

# Check if on Arch Linux (basic check)
if ! grep -q "ID=arch" /etc/os-release; then
    print_warning "This script is designed for Arch Linux / Arch-based distributions."
    print_warning "It may not work correctly on other systems."
    read -p "Do you want to continue anyway? (y/n): " consent < /dev/tty
    if [ "$consent" != "y" ]; then
        print_info "Installation aborted by user."
        exit 1
    fi
fi

# Check if git is installed (prerequisite)
if ! command -v git &>/dev/null; then
    print_error "Git is required but not installed."
    print_error "Please install git first using: sudo pacman -S git"
    exit 1
fi

# --- Step 1: Install AUR Helper (paru) ---
print_step "Step 1: Installing AUR Helper (paru)"

# Clean up temporary directories on script exit
trap 'rm -rf "$PARU_TEMP_DIR" "$AGSV1_TEMP_DIR"' EXIT

# Check if paru is already installed
if command -v paru &>/dev/null; then
    print_info "paru is already installed. Skipping paru installation."
else
    print_info "Installing base-devel package group..."
    sudo pacman -S --needed base-devel --noconfirm || {
        print_error "Failed to install base-devel."
        exit 1
    }

    print_info "Cloning paru repository..."
    git clone https://aur.archlinux.org/paru.git "$PARU_TEMP_DIR/paru" || {
        print_error "Failed to clone paru repository."
        exit 1
    }

    print_info "Building and installing paru..."
    cd "$PARU_TEMP_DIR/paru" || {
        print_error "Failed to change directory to paru temp dir."
        exit 1
    }
    makepkg -si --noconfirm || {
        print_error "Failed to build and install paru. Please check the output above."
        exit 1
    }
    cd - >/dev/null # Go back to the previous directory

    print_info "paru installed successfully."
fi


# --- Step 2: Install Required Packages ---
print_step "Step 2: Installing Required Packages via paru"

# Check if paru is usable now
if ! command -v paru &>/dev/null; then
    print_error "paru command not found after installation attempt."
    print_error "Please install paru manually and re-run the script."
    exit 1
fi

# The main command for the silent installation attempt
PARU_INSTALL_CMD="paru -S --needed ${REQUIRED_PACKAGES[@]} --noconfirm"

print_info "Using paru to install necessary system and AUR packages."
# Inform the user that paru/pacman might prompt if conflicts occur
print_info "You will likely be prompted for your password and asked to confirm installations (by paru/pacman directly if conflict occurs)."

# Attempt the installation silently first using --noconfirm
if ! $PARU_INSTALL_CMD; then
    # If the silent attempt fails, likely due to conflicts or other issues
    print_warning "Package installation failed!"
    print_warning "This often happens due to conflicting packages (like python-pywal vs python-pywal16) or dependency issues."

    # Loop to present options to the user until a valid choice is made
    while true; do
        print_info "Please choose how to proceed:"
        print_info "  1) Retry installation interactively (allows paru/pacman to ask about conflicts, recommended)."
        print_info "  2) Skip package installation step (NOT recommended, may lead to issues)."
        print_info "  3) Exit the script."
        # Use < /dev/tty to ensure reading input from the terminal even if the script is piped
        read -p "Enter choice [1]: " choice < /dev/tty

        # Set the default choice to 1 if the user just presses Enter
        choice=${choice:-1}

        # Process the user's choice
        case "$choice" in
            1)
                print_info "Retrying package installation interactively..."
                # Rerun the command without --noconfirm to allow paru to ask the user about conflicts
                # If this attempt also fails, the set -e at the start will stop the script
                paru -S --needed "${REQUIRED_PACKAGES[@]}"
                # Exit the while loop if the interactive attempt finishes (successfully or by user abort)
                break
                ;;
            2)
                print_warning "Skipping package installation step as requested."
                # Exit the while loop
                break
                ;;
            3)
                print_info "Exiting script at package installation step as requested."
                exit 1 # Exit the script
                ;;
            *)
                # If the user entered an invalid choice
                print_warning "Invalid choice. Please enter 1, 2, or 3."
                ;;
        esac
    done

fi # End of if ! $PARU_INSTALL_CMD block

# The script continues here after the package installation step is completed (successfully or skipped)
print_info "Required packages process completed (or was skipped)."

# --- Step 3: Install Latest AGS v1 ---
print_step "Step 3: Installing Latest AGS v1"

# Check if ags is already installed and seems recent enough (basic check)
if command -v ags &>/dev/null; then
    print_info "AGS seems to be installed. Skipping AGS v1 build."
    print_warning "Note: The script did not verify the specific version. If you encounter issues, consider removing and rebuilding AGS v1 manually."
else
    print_info "Installing typescript globally via npm..."
    # Check if npm is available, if not, it should have been installed in step 2.
    if ! command -v npm &>/dev/null; then
        print_error "npm command not found. It should have been installed in Step 2. Please check package installation."
        exit 1
    fi
    sudo npm i -g typescript || {
        print_error "Failed to install typescript globally."
        exit 1
    }

    print_info "Cloning agsv1 repository..."
    git clone --recursive "$AGSV1_REPO_URL" "$AGSV1_TEMP_DIR/agsv1" || {
        print_error "Failed to clone agsv1 repository."
        exit 1
    }

    print_info "Building and installing agsv1..."
    cd "$AGSV1_TEMP_DIR/agsv1" || {
        print_error "Failed to change directory to agsv1 temp dir."
        exit 1
    }
    makepkg -si --noconfirm || {
        print_error "Failed to build and install agsv1. Please check the output above."
        exit 1
    }
    cd - >/dev/null # Go back to the previous directory

    print_info "AGS v1 installed successfully."
fi

# --- Step 4: Create Backup (Optional) ---
print_step "Step 4: Creating Backup of Existing Configuration (Optional)"

read -p "Do you want to create a backup of your existing configuration directories? (y/n): " backup_consent < /dev/tty
if [ "$backup_consent" = "y" ]; then
    print_info "Creating backup in $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR" || {
        print_error "Failed to create backup directory $BACKUP_DIR."
        exit 1
    }

    for dir in "${DOTFILES_DIRS[@]}"; do
        if [ -d "$HOME/$dir" ]; then
            print_info "Backing up $HOME/$dir..."
            cp -r "$HOME/$dir" "$BACKUP_DIR/"
        else
            print_warning "Directory $HOME/$dir not found, skipping backup."
        fi
    done
    print_info "Backup complete. Your original configurations are in $BACKUP_DIR"
else
    print_info "Skipping backup step."
fi

# --- Step 5: Clone and Setup HyprLuna ---
print_step "Step 5: Cloning and Setting up HyprLuna Dotfiles"

print_warning "========================================================="
print_warning "  CRITICAL STEP: OVERWRITING EXISTING CONFIGURATIONS!"
print_warning "========================================================="
print_warning "This step will copy HyprLuna dotfiles from the cloned repository"
print_warning "into your home directory (~/). This will OVERWRITE existing files"
print_warning "and directories such as: ~/.config, ~/.local, ~/.cache, ~/.vscode,"
print_warning "~/.fonts, ~/.ags, and potentially files in your ~/Pictures directory."
print_warning "If you have important configurations in these directories that you haven't"
print_warning "backed up elsewhere (beyond the optional script backup), ABORT NOW."
print_warning "Existing directories will be renamed with a '.bak_before_install' suffix as a safety measure."
print_warning ""
read -p "Are you absolutely sure you want to proceed and overwrite? (y/n): " overwrite_consent < /dev/tty

if [ "$overwrite_consent" != "y" ]; then
    print_info "Installation aborted by user before copying dotfiles."
    exit 1
fi

print_info "Cloning HyprLuna repository..."
# Remove existing clone directory if it exists, to ensure a fresh clone
if [ -d "$HYPRLUNA_DIR" ]; then
    print_info "Removing existing HyprLuna clone directory: $HYPRLUNA_DIR"
    rm -rf "$HYPRLUNA_DIR" || {
        print_error "Failed to remove existing HyprLuna clone directory."
        exit 1
    }
fi
git clone "$REPO_URL" "$HYPRLUNA_DIR" || {
    print_error "Failed to clone HyprLuna repository."
    exit 1
}

print_info "Copying dotfiles from $HYPRLUNA_DIR to your home directory..."
cd "$HYPRLUNA_DIR" || {
    print_error "Failed to change directory to HyprLuna repository."
    exit 1
}

for dir in "${DOTFILES_DIRS[@]}"; do
    if [ -d "./$dir" ]; then # Check if the directory exists in the cloned repo
        print_info "Processing $dir..."
        if [ -d "$HOME/$dir" ]; then
            print_warning "Renaming existing $HOME/$dir to $HOME/${dir}.bak_before_install..."
            mv "$HOME/$dir" "$HOME/${dir}.bak_before_install" || {
                print_error "Failed to rename existing $HOME/$dir."
                continue
            }
        fi
        print_info "Copying $dir to $HOME/..."
        # The original command is cp -r ./Pictures ~/ which copies the Pictures *directory*
        # from the repo into the home directory. This might result in ~/Pictures/Pictures.
        # Let's stick to the source command but ensure the old one is backed up.
        cp -r "./$dir" "$HOME/" || {
            print_error "Failed to copy $dir."
            continue
        }
        print_info "$dir copied."
    else
        print_warning "Directory ./$dir not found in the cloned repository, skipping copy."
    fi
done

print_info "Setting execute permissions for scripts..."
chmod +x "$HOME"/.config/hypr/scripts/* || print_warning "Failed to set execute permissions for hypr/scripts."
chmod +x "$HOME"/.config/ags/scripts/hyprland/* || print_warning "Failed to set execute permissions for ags/scripts/hyprland."

print_info "Running wallpaper generation script..."
sh "$HOME"/.config/ags/scripts/color_generation/wallpapers.sh -r || print_warning "Wallpaper script failed. You may need to run this manually."

cd - >/dev/null # Go back to the original directory

print_info "HyprLuna dotfiles copied and initial setup steps completed."

# --- Post-Installation Instructions ---
print_step "HyprLuna Installation Script Finished"

print_info "Installation is mostly complete."
print_info "You need to log out of your current session and log back in."
print_info "At the login screen (greeter), select 'Hyprland' as your session."
print_info "Then log in with your username and password."

if [ "$backup_consent" = "y" ]; then
    print_info "Your original configurations were backed up to: $BACKUP_DIR"
fi

print_info "If Hyprland doesn't start or you encounter issues, you can check logs:"
print_info "cat ~/.local/share/hyprland/hyprland.log"
print_info "Refer to our discord server: https://discord.gg/qnAHD9keWr for help."
print_info "After logging in, you can explore the HyprLuna setup!"

exit 0 # Script finished successfully
