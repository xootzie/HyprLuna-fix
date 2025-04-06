#!/bin/bash

# Hyprland Dotfiles Installation Script

# Function to print error messages
error() {
    echo -e "\e[31m[ERROR] $1\e[0m"
    exit 1
}

# Function to print success messages
success() {
    echo -e "\e[32m[SUCCESS] $1\e[0m"
}

# Function to print info messages
info() {
    echo -e "\e[34m[INFO] $1\e[0m"
}

# Check if running as root
if [ "$(id -u)" -eq 0 ]; then
    error "This script should not be run as root. Please run as a normal user."
fi

# Install base-devel
info "Installing base-devel packages..."
sudo pacman -S --needed --noconfirm base-devel || error "Failed to install base-devel"

# Install paru
info "Installing paru..."
if ! command -v paru &> /dev/null; then
    git clone https://aur.archlinux.org/paru.git || error "Failed to clone paru repository"
    cd paru || error "Failed to enter paru directory"
    makepkg -si --noconfirm || error "Failed to build and install paru"
    cd .. || error "Failed to return to previous directory"
    rm -rf paru || error "Failed to remove paru directory"
else
    info "paru is already installed"
fi

# Update system
info "Updating system..."
paru -Syu --noconfirm || error "Failed to update system"

# Install packages in groups to avoid potential issues
info "Installing package group 1/3..."
paru -S --noconfirm hyprland axel bc coreutils cliphist cmake curl rofi-wayland rsync wget ripgrep jq npm meson typescript gjs xdg-user-dirs brightnessctl ddcutil pavucontrol wireplumber libdbusmenu-gtk3 playerctl swww git gobject-introspection glib2-devel gvfs glib2 glibc gtk3 gtk-layer-shell libpulse pam gnome-bluetooth-3.0 gammastep || error "Failed to install package group 1"

info "Installing package group 2/3..."
paru -S --noconfirm libsoup3 libnotify networkmanager power-profiles-daemon upower adw-gtk-theme-git qt5ct qt5-wayland fontconfig ttf-readex-pro ttf-jetbrains-mono-nerd ttf-material-symbols-variable-git apple-fonts ttf-space-mono-nerd ttf-rubik-vf ttf-gabarito-git fish foot starship polkit-gnome gnome-keyring gnome-control-center blueberry webp-pixbuf-loader gtksourceview3 yad ydotool xdg-user-dirs-gtk tinyxml2 gtkmm3 gtksourceviewmm cairomm || error "Failed to install package group 2"

info "Installing package group 3/3..."
paru -S --noconfirm xdg-desktop-portal xdg-desktop-portal-gtk xdg-desktop-portal-hyprland gradience python-libsass python-pywalfox matugen-bin python-build python-pillow python-pywal python-setuptools-scm python-wheel swappy wf-recorder grim tesseract tesseract-data-eng slurp dart-sass python-pywayland python-psutil hypridle hyprutils hyprlock wlogout wl-clipboard hyprpicker ghostty ttf-noto-sans-cjk-vf noto-fonts-emoji metar ttf-material-symbols-variable-git || error "Failed to install package group 3"

# Install agsv1
info "Installing agsv1..."
if [ ! -d "agsv1" ]; then
    git clone --recursive https://github.com/Lunaris-Project/agsv1 || error "Failed to clone agsv1 repository"
    cd agsv1 || error "Failed to enter agsv1 directory"
    makepkg -si --noconfirm || error "Failed to build and install agsv1"
    cd .. || error "Failed to return to previous directory"
else
    info "agsv1 directory already exists, skipping installation"
fi

# Clone and copy dotfiles
info "Cloning and copying dotfiles..."
if [ ! -d "$HOME/HyprLuna" ]; then
    git clone https://github.com/Lunaris-Project/HyprLuna.git ~/HyprLuna || error "Failed to clone HyprLuna repository"
    cd ~/HyprLuna || error "Failed to enter HyprLuna directory"
    
    # Copy files
    cp -rv .config ~/ || error "Failed to copy .config directory"
    cp -rv .local ~/ || error "Failed to copy .local directory"
    cp -rv .cursor ~/ || error "Failed to copy .cursor directory"
    cp -rv .vscode ~/ || error "Failed to copy .vscode directory"
    
    # Optional directories
    [ -d ".fonts" ] && cp -rv .fonts ~/ || info "No .fonts directory to copy"
    [ -d ".ags" ] && cp -rv .ags ~/ || info "No .ags directory to copy"
    
    cp -rv Pictures ~/ || error "Failed to copy Pictures directory"
    
    # Make scripts executable
    chmod +x ~/.config/hypr/scripts/* || error "Failed to make hypr scripts executable"
    chmod +x ~/.config/ags/scripts/hyprland/* || error "Failed to make ags scripts executable"
    
    # Run wallpaper script
    info "Running wallpaper color generation script..."
    sh ~/.config/ags/scripts/color_generation/wallpapers.sh -r || error "Failed to run wallpaper script"
    
    success "Dotfiles installation completed successfully!"
else
    info "HyprLuna directory already exists, skipping dotfiles installation"
fi

# Final message
echo ""
success "Installation process completed!"
info "You may need to reboot your system for all changes to take effect."
