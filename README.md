<div align="center">
    <h1 style="font-size:50px">⭐️HyprLuna Dotfiles🌙</h1>
      <div>
        <a href="https://discord.gg/qnAHD9keWr">
          <img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord">
        </a>
        <a href="https://archlinux.org/">
          <img src="https://img.shields.io/badge/Arch_Linux-Compatible-89DCEB?style=for-the-badge&logo=arch-linux&logoColor=white&labelColor=1E1E2E" alt="Arch Linux Compatible">
        </a>
              <a href="https://github.com/Lunaris-Project/HyprLuna/blob/main/LICENSE">
          <img src="https://img.shields.io/github/license/Lunaris-Project/HyprLuna?style=for-the-badge&logo=gnu&color=FAB387&labelColor=1E1E2E" alt="License">
        </a>
      </div>
      <div>
              <a href="https://github.com/Lunaris-Project/HyprLuna">
          <img src="https://img.shields.io/github/repo-size/Lunaris-Project/HyprLuna?style=for-the-badge&logo=github&color=F9E2AF&labelColor=1E1E2E&label=Size" alt="Repo Size">
                  </a>
        <a href="https://github.com/Lunaris-Project/HyprLuna/commits/main">
          <img src="https://img.shields.io/github/last-commit/Lunaris-Project/HyprLuna?style=for-the-badge&logo=git&color=F38BA8&labelColor=1E1E2E" alt="Last Commit">
        </a>
        <a href="https://github.com/Lunaris-Project/HyprLuna/stargazers">
          <img src="https://img.shields.io/github/stars/Lunaris-Project/HyprLuna?color=CBA6F7&labelColor=1E1E2E&style=for-the-badge&logo=starship&logoColor=CBA6F7" alt="Stars">
        </a>
      </div>
<p align="center">
 <img src="previews/HyprLuna.png" alt="Logo image" style="border-radius: 15px;">
</p>

<h1>✨ ShowCase ✨</h1>

<table>
  <tr>
    <td width="50%" align="center"><img src="previews/notch2.png" alt="HyprLuna Desktop with Notch" style="border-radius: 12px; width: 100%; height: auto;"></td>
    <td width="50%" align="center"><img src="previews/1.png" alt="HyprLuna Main Desktop" style="border-radius: 12px; width: 100%; height: auto;"></td>
  </tr>
  <!-- <tr>
    <td align="center"><b>Notch Style Interface</b></td>
    <td align="center"><b>Main Desktop</b></td>
  </tr> -->
  <tr>
    <td width="50%" align="center"><img src="previews/2.png" alt="Application Layout" style="border-radius: 12px; width: 100%; height: auto;"></td>
    <td width="50%" align="center"><img src="previews/3.png" alt="Terminal Workflow" style="border-radius: 12px; width: 100%; height: auto;"></td>
  </tr>
  <!-- <tr>
    <td align="center"><b>Application Layout</b></td>
    <td align="center"><b>Terminal Workflow</b></td>
  </tr> -->
  <tr>
    <td width="50%" align="center"><img src="previews/4.png" alt="Sidebar Widgets" style="border-radius: 12px; width: 100%; height: auto;"></td>
    <td width="50%" align="center"><img src="previews/5.png" alt="Notification Center" style="border-radius: 12px; width: 100%; height: auto;"></td>
  </tr>
  <!-- <tr>
    <td align="center"><b>Sidebar Widgets</b></td>
    <td align="center"><b>Notification Center</b></td>
  </tr> -->
  <tr>
    <td width="50%" align="center"><img src="previews/6.png" alt="Quick Settings" style="border-radius: 12px; width: 100%; height: auto;"></td>
    <td width="50%" align="center"><img src="previews/7.png" alt="Application Launcher" style="border-radius: 12px; width: 100%; height: auto;"></td>
  </tr>
  <!-- <tr>
    <td align="center"><b>Quick Settings</b></td>
    <td align="center"><b>Application Launcher</b></td>
  </tr> -->
</table>
<div>
</br>
<h1>Do you need help or join us? <a href="https://discord.gg/qnAHD9keWr">Join Here</a><h1>
</div>
<h1>👻 How to install? 👻</h1>
</div>

## 🆘 We need to install aur helper first (better use paru):

```bash
sudo pacman -S --needed base-devel
git clone https://aur.archlinux.org/paru.git
cd paru
makepkg -si
```

## 📦 Then we need install needed pkgs:

```bash
paru -S hyprland axel bc coreutils cliphist cmake curl rofi-wayland rsync wget ripgrep jq npm meson typescript gjs xdg-user-dirs brightnessctl ddcutil pavucontrol wireplumber libdbusmenu-gtk3 playerctl swww git gobject-introspection glib2-devel gvfs glib2 glibc gtk3 gtk-layer-shell libpulse pam gnome-bluetooth-3.0 gammastep libsoup3 libnotify networkmanager power-profiles-daemon upower adw-gtk-theme-git qt5ct qt5-wayland fontconfig ttf-readex-pro ttf-jetbrains-mono-nerd ttf-material-symbols-variable-git apple-fonts ttf-space-mono-nerd ttf-rubik-vf ttf-gabarito-git fish foot starship polkit-gnome gnome-keyring gnome-control-center blueberry webp-pixbuf-loader gtksourceview3 yad ydotool xdg-user-dirs-gtk tinyxml2 gtkmm3 gtksourceviewmm cairomm xdg-desktop-portal xdg-desktop-portal-gtk xdg-desktop-portal-hyprland gradience python-libsass python-pywalfox matugen-bin python-build python-pillow python-pywal python-setuptools-scm python-wheel swappy wf-recorder grim tesseract tesseract-data-eng slurp dart-sass python-pywayland python-psutil hypridle hyprutils hyprlock wlogout wl-clipboard hyprpicker ghostty ttf-noto-sans-cjk-vf noto-fonts-emoji metar ttf-material-symbols-variable-git
```

## We need also latest ags v1 repo

```bash
git clone --recursive https://github.com/Lunaris-Project/agsv1
cd agsv1
makepkg -si
cd
```

## Create backup: !!Not needed if you are in fresh installation!!

```bash
mkdir -p ~/HyprLuna-User-Bak
cp -r ~/.config ~/HyprLuna-User-Bak/
cp -r ~/.local ~/HyprLuna-User-Bak/
cp -r ~/.fonts ~/HyprLuna-User-Bak/ 2>/dev/null || echo "No .fonts directory to backup"
cp -r ~/.ags ~/HyprLuna-User-Bak/ 2>/dev/null || echo "No .ags directory to backup"
cp -r ~/Pictures ~/HyprLuna-User-Bak/
```

## Then clone HyprLuna repo:

```bash
git clone https://github.com/Lunaris-Project/HyprLuna.git ~/HyprLuna
cd ~/HyprLuna
cp -r .config ~/
cp -r .local ~/
cp -r .cursor ~/
cp -r .vscode ~/
cp -r .fonts ~/ 2>/dev/null || echo "No .fonts directory to copy"
cp -r .ags ~/ 2>/dev/null || echo "No .ags directory to copy"
cp -r Pictures ~/
chmod +x ~/.config/hypr/scripts/*
chmod +x ~/.config/ags/scripts/hyprland/*
sh ~/.config/ags/scripts/color_generation/wallpapers.sh -r
```
## Keybindings:
```bash
// now the keybinds are missy needs to be refactored SOON
```

<div align="center" style="background-color: #11111b; border-radius: 8px; padding: 15px;">

## 📝 License & Copyright
<img src="https://img.shields.io/github/license/Lunaris-Project/HyprLuna?style=for-the-badge&logo=gnu&color=FAB387&labelColor=1E1E2E" alt="License Badge"/>
<p>Copyright © 2025 <a href="https://github.com/Lunaris-Project">Lunaris Project</a></p>
<p>This project is licensed under the <a href="https://github.com/Lunaris-Project/HyprLuna/blob/main/LICENSE">MIT License</a>.</p>
<hr style="border: 2px solid #CBA6F7;">
<p>
<img src="https://img.shields.io/badge/Made%20with-%E2%9D%A4%EF%B8%8F-F38BA8?style=for-the-badge&labelColor=1E1E2E" alt="Made with Love"/>
<img src="https://img.shields.io/badge/Powered%20by-Lunaris--Team-89DCEB?style=for-the-badge&labelColor=1E1E2E" alt="Powered by Lunaris-Project Team"/>
</p>
<p><i>🌙 Stars light up the night sky, but the moon illuminates the path 🌙</i></p>
</div>
