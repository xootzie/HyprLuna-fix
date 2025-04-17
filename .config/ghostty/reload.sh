#!/bin/bash

# ابحث عن النوافذ المفتوحة من Ghostty
for win_id in $(hyprctl clients | grep -B 1 'com.mitchellh.ghostty' | grep -oP 'Window \K[0-9a-f]{14}'); do
    echo "Focusing window ID: $win_id"
    hyprctl dispatch focuswindow $win_id  # اعمل فوكوس للنافذة

    # ارسال مفتاح لإعادة تحميل Ghostty (مثال: Shift+Ctrl+,)
    wtype --window $win_id "Shift+Ctrl+,"  # اختصار المفتاح
    sleep 0.5  # تأخير بسيط بعد ارسال كل أمر
done
