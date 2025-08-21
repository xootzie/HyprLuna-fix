# Move color setting to a separate function that runs only when needed
function set_kitty_colors
    set color_file ~/.cache/ags/user/generated/kitty-colors.conf
    if test -f $color_file
        kitty @ set-colors --all --configured $color_file
    else
        echo "Color scheme file not found: $color_file"
    end
end

if status is-interactive
    set fish_greeting
    
    # Only run starship init if it exists
    type -q starship; and starship init fish | source

    # Only try to read sequences if the file exists
    set -l seq_file ~/.cache/ags/user/generated/terminal/sequences.txt
    if test -f $seq_file
        cat $seq_file
    end
end

# Your aliases here
alias pamcan=pacman
alias settings="gjs ~/.config/ags/assets/settings.js"
alias bar="nvim ~/.config/ags/modules/bar/main.js"
alias barmodes="nvim ~/.config/ags/modules/bar/modes"
alias config="nvim ~/.ags/config.json"
alias default="micro ~/.config/ags/modules/.configuration/user_options.default.json"
alias colors="kitty @ set-colors -a -c ~/.cache/ags/user/generated/kitty-colors.conf"
