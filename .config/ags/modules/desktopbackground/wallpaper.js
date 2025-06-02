const { Gdk, GdkPixbuf, Gio, GLib, Gtk } = imports.gi;
import Widget from 'resource:///com/github/Aylur/ags/widget.js';
import * as Utils from 'resource:///com/github/Aylur/ags/utils.js';
const { Box } = Widget;
import { monitors } from '../.commondata/hyprlanddata.js';

export default (monitor = 0) => {
    return Box({
        className: 'desktop-background',
        setup: (self) => {
            const monitorData = monitors[monitor] || { width: 1920, height: 1080 };
            self.set_size_request(monitorData.width, monitorData.height);
        },
    });
}
