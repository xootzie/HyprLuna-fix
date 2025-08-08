#!/bin/bash

#!/bin/bash

echo "We'll copy binaries and libraries from the repo to /usr do you wish to continue? (y/N)"
read -r answer
answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')
if [[ "$answer" == "no" || "$answer" == "n" || -z "$answer" ]]; then
    echo "Bye"
    exit
elif [[ "$answer" != "yes" && "$answer" != "y" ]]; then
    echo "I don't understand."
    exit
fi

cp -r ./ags_bin_lib/com.github.Aylur.ags/ /usr/share/
cp -r ./ags_bin_lib/agsv1/ /usr/lib/
ln -sf /usr/share/com.github.Aylur.ags/com.github.Aylur.ags /usr/bin/agsv1
