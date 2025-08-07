#!/bin/bash

echo "We'll be installing nix on your setup you'd have to be engaged in the process if you choose yes (y/N)"
read -r answer
answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')
if [[ "$answer" == "no" || "$answer" == "n" || -z "$answer" ]]; then
    echo "Bye"
    exit
elif [[ "$answer" != "yes" && "$answer" != "y" ]]; then
    echo "I don't understand."
    exit
fi

sh <(curl -L https://nixos.org/nix/install) --no-daemon
. ~/.nix-profile/etc/profile.d/nix.sh
export NIX_CONFIG="experimental-features = nix-command flakes"
nix profile add github:nurly3/agsv1
