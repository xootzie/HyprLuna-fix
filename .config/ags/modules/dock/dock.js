const { Gtk, GLib } = imports.gi;
import Widget from 'resource:///com/github/Aylur/ags/widget.js';
import * as Utils from 'resource:///com/github/Aylur/ags/utils.js';
const { EventBox} = Widget;
import { RoundedCorner } from './../.commonwidgets/cairo_roundedcorner.js';
import Hyprland from 'resource:///com/github/Aylur/ags/service/hyprland.js';
import Applications from 'resource:///com/github/Aylur/ags/service/applications.js';
import Notifications from 'resource:///com/github/Aylur/ags/service/notifications.js';
const { Box, Revealer } = Widget;
import { setupCursorHover } from '../.widgetutils/cursorhover.js';
import { getAllFiles } from './icons.js'
import { getValidIcon } from '../.miscutils/icon_handling.js';

// Simple file to store dock pin state
const DOCK_PIN_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ags', 'dock_pinned']);

// Function to load pin state from file
const loadPinState = () => {
    try {
        if (GLib.file_test(DOCK_PIN_FILE, GLib.FileTest.EXISTS)) {
            const [success, contents] = GLib.file_get_contents(DOCK_PIN_FILE);
            if (success) {
                const text = new TextDecoder().decode(contents).trim();
                return text === 'true';
            }
        }
    } catch (error) {
        console.error('Error loading dock pin state:', error);
    }
    return false;
};

// Function to save pin state to file
const savePinState = (pinned) => {
    try {
        // Ensure directory exists
        const dir = GLib.path_get_dirname(DOCK_PIN_FILE);
        if (!GLib.file_test(dir, GLib.FileTest.EXISTS)) {
            GLib.mkdir_with_parents(dir, 0o755);
        }

        // Write state to file
        const data = new TextEncoder().encode(pinned ? 'true' : 'false');
        GLib.file_set_contents(DOCK_PIN_FILE, data);
    } catch (error) {
        console.error('Error saving dock pin state:', error);
    }
};

const icon_files = userOptions.asyncGet().icons.searchPaths.map(e => getAllFiles(e)).flat(1)
let dockSize = userOptions.asyncGet().dock.dockSize
const elevate = userOptions.asyncGet().etc.widgetCorners ? "dock-bg dock-round " : "elevation dock-bg"
let appSpacing = dockSize / 15

// Export isPinned as a variable that can be accessed from outside
// Initialize from saved state
export let isPinned = loadPinState();
let cachePath = new Map()

// Create a list of callbacks to be called when isPinned changes
const pinStateCallbacks = []

// Function to register a callback for pin state changes
export function onPinStateChanged(callback) {
    pinStateCallbacks.push(callback)
    return pinStateCallbacks.length - 1 // Return the index for potential removal
}

// Function to remove a callback
export function removePinStateCallback(index) {
    if (index >= 0 && index < pinStateCallbacks.length) {
        pinStateCallbacks[index] = null
    }
}

let timers = []

function clearTimes() {
    timers.forEach(e => GLib.source_remove(e))
    timers = []
}

function ExclusiveWindow(client) {
    const fn = [
        (client) => !(client !== null && client !== undefined),
        // Jetbrains
        (client) => client.title.includes("win"),
        // Vscode
        (client) => client.title === '' && client.class === ''
    ]

    for (const item of fn) { if (item(client)) { return true } }
    return false
}

const focus = ({ address }) => Utils.execAsync(`hyprctl dispatch focuswindow address:${address}`).catch(print);

const getIconPath = (appClass, fromCache = true) => {
    // Try to find the app in Applications.list to get its icon_name
    const app = Applications.list.find(a =>
        a.name?.toLowerCase() === appClass?.toLowerCase() ||
        a.desktop?.toLowerCase().includes(appClass?.toLowerCase())
    );

    // If found and has icon_name, use it directly
    if (app && app.icon_name) {
        if (fromCache && cachePath.has(appClass.toLowerCase())) {
            return cachePath.get(appClass.toLowerCase());
        }

        if (fromCache) {
            cachePath.set(appClass.toLowerCase(), app.icon_name);
        }

        return app.icon_name;
    }

    // Otherwise fall back to the standard icon lookup
    return getValidIcon(appClass, icon_files, fromCache, cachePath);
};

const DockSeparator = (props = {}) => Box({
    ...props,
    className: 'dock-separator',
})

export const PinButton = () => Widget.Button({
    tooltipText: 'Pin Dock',
    css: `margin: 0 ${appSpacing}px;padding: 0 10px`,
    child: Widget.Box({
        homogeneous: true,
        child: Widget.Icon({
            icon:"logo-symbolic",
            size:dockSize
        })
    }),
    onClicked: (self) => {
        // Toggle the pin state
        isPinned = !isPinned

        // Update the button appearance
        self.className = `${isPinned ? "pinned-dock-app-btn dock-app-btn-animate" : " dock-app-btn-animate"}`

        // Save the pin state to file to persist across reboots
        savePinState(isPinned);

        // Notify all registered callbacks about the pin state change
        pinStateCallbacks.forEach(callback => {
            if (callback) callback(isPinned)
        })
    },
    setup: (self) => {
        setupCursorHover(self);

        // Set initial button state based on loaded pin state
        self.className = `${isPinned ? "pinned-dock-app-btn dock-app-btn-animate" : " dock-app-btn-animate"}`;
    },
})

const AppButton = ({ icon, appClass, windowCount = 0, isPinned = false, ...rest }) => Widget.Revealer({
    attribute: {
        'workspace': 0,
        'windowCount': windowCount,
        'appClass': appClass,
        'isPinned': isPinned,
        'updateNotificationBadge': (self) => {
            try {
                // Get the app class from the attribute
                const appClass = self.attribute.appClass;
                if (!appClass) return;

                // Get notification count for this app
                let notifCount = 0;

                // Simplified notification detection
                try {
                    // Get app name in lowercase for easier matching
                    const appNameLower = appClass.toLowerCase();

                    // Find windows for this app
                    const appWindows = Hyprland.clients.filter(client => {
                        const clientClass = client.class?.toLowerCase() || '';
                        return clientClass.includes(appNameLower);
                    });

                    // Check window titles for notification counts
                    for (const window of appWindows) {
                        const title = window.title || '';

                        // Common patterns for notification counts
                        // Look for patterns like (3) or [5] in the window title
                        const bracketMatch = title.match(/[\(\[](\d+)[\)\]]/);
                        if (bracketMatch && bracketMatch[1]) {
                            const count = parseInt(bracketMatch[1]);
                            if (!isNaN(count) && count > notifCount) {
                                notifCount = count;
                            }
                        }

                        // Look for "X unread" or "X new" patterns
                        const textMatch = title.match(/(\d+)\s*(unread|new|message)/i);
                        if (textMatch && textMatch[1]) {
                            const count = parseInt(textMatch[1]);
                            if (!isNaN(count) && count > notifCount) {
                                notifCount = count;
                            }
                        }

                        // Check for keywords indicating notifications
                        if (notifCount === 0 && (
                            title.includes('New Message') ||
                            title.includes('Unread') ||
                            title.includes('notification')
                        )) {
                            notifCount = 1;
                        }
                    }
                } catch (e) {
                    // Ignore errors in window title parsing
                }

                // If no count from window titles, check regular notifications
                if (notifCount === 0) {
                    // Get all notifications for this app
                    const appNotifications = Notifications.notifications.filter(n => {
                        if (!n.appName) return false;

                        const notifAppName = n.appName.toLowerCase();
                        const thisAppName = appClass.toLowerCase();

                        // Try exact match first
                        if (notifAppName === thisAppName) return true;

                        // Try partial matches
                        if (notifAppName.includes(thisAppName) || thisAppName.includes(notifAppName)) return true;

                        // Try matching desktop entry name
                        if (thisAppName.includes('.') && notifAppName === thisAppName.split('.')[0]) return true;

                        return false;
                    });

                    notifCount = appNotifications.length;
                }

                // Update the notification badge
                if (self.child?.child?.child?.overlays?.[1]) {
                    const badge = self.child.child.child.overlays[1];

                    // Show badge only if there are notifications
                    badge.visible = notifCount > 0;

                    // Update the label if there are notifications
                    if (notifCount > 0 && badge.child?.child) {
                        badge.child.child.label = `${notifCount}`;
                        badge.show_all();
                    }
                }
            } catch (e) {
                console.log(`Error updating notification badge: ${e.message}`);
            }
        },
        'updateWindowIndicators': (self) => {
            try {
                // Update window indicators based on window count
                if (self.child?.child?.child?.overlays?.[0]) {
                    const indicator = self.child.child.child.overlays[0];

                    // Clear existing indicators
                    indicator.children = [];

                    // Get all windows for this app
                    const appClass = self.attribute.appClass;
                    if (!appClass) {
                        indicator.visible = false;
                        return;
                    }

                    // Find all windows for this app - use includes for better matching
                    const clients = Hyprland.clients.filter(client => {
                        const clientClass = client.class?.toLowerCase() || '';
                        return clientClass.includes(appClass.toLowerCase());
                    });

                    // Find the active client index (if any)
                    const activeClientIndex = clients.findIndex(client =>
                        client.address === Hyprland.active.client.address
                    );

                    // Update window count
                    const actualWindowCount = clients.length;
                    self.attribute.windowCount = actualWindowCount;

                    // Show indicators only if there are windows
                    indicator.visible = actualWindowCount > 0;

                    if (actualWindowCount > 0) {
                        // Add indicators for each window (up to 5)
                        const maxIndicators = Math.min(actualWindowCount, 5);
                        for (let i = 0; i < maxIndicators; i++) {
                            indicator.add(Widget.Box({
                                className: 'window-indicator' + (i === activeClientIndex ? ' active-window' : ''),
                            }));
                        }

                        // Add count for additional windows
                        if (actualWindowCount > 5) {
                            indicator.add(Widget.Label({
                                className: 'window-count',
                                label: `+${actualWindowCount - 5}`,
                            }));
                        }

                        // Force a redraw
                        indicator.show_all();
                    }
                }
            } catch (e) {
                // Suppress error logging
            }
        }
    },
    revealChild: false,
    transition: 'slide_right',
    transitionDuration: userOptions.asyncGet().animations.durationLarge,
    child: Widget.Button({
        ...rest,
        className: 'dock-app-btn dock-app-btn-animate',
        css: `margin: 0 ${appSpacing}px`,
        child: Widget.Box({
            child: Widget.Overlay({
                child: Widget.Box({
                    homogeneous: true,
                    className: 'dock-app-icon',
                    child: Widget.Icon({
                        icon: icon,
                        size: dockSize
                    }),
                }),
                overlays: [
                    // Window indicators at the bottom
                    Widget.Box({
                        className: 'window-indicators',
                        vpack: 'end',
                        hpack: 'center',
                        spacing: 4,
                    }),
                    // Notification badge at top right
                    Widget.Box({
                        className: 'notification-badge',
                        visible: false,
                        vpack: 'start',  // Position at the top
                        hpack: 'end',    // Position at the right
                        halign: Gtk.Align.END,    // Align to the right
                        valign: Gtk.Align.START,  // Align to the top
                        hexpand: false,
                        vexpand: false,
                        css: 'margin: 0.1rem; padding: 0.1rem;',
                        child: Widget.Box({
                            // Center box to center the label
                            homogeneous: true,  // This helps center the content
                            hexpand: true,
                            vexpand: true,
                            child: Widget.Label({
                                className: 'notification-count',
                                label: '0',
                                hexpand: true,
                                vexpand: true,
                                xalign: 0.5,  // Center horizontally (0-1 range)
                                yalign: 0.5,  // Center vertically (0-1 range)
                                css: 'margin: 0; padding: 0;',
                            }),
                        }),
                    }),
                ],
            }),
        }),
        setup: (button) => {
            setupCursorHover(button);

            // Use a safer approach to access the parent widget
            const safelySetupButton = () => {
                // Store a reference to the parent to avoid repeated access
                const parentWidget = button.get_parent();
                if (!parentWidget || !parentWidget.attribute) return;

                // Use the stored reference for all operations
                const parent = parentWidget;

                // Check if this is a pinned app or a taskbar app
                const isPinnedApp = parent.attribute.isPinned === true;

                // For pinned apps, we don't show notification badges or window indicators
                if (!isPinnedApp) {
                    // Initial update of notification badge
                    if (parent.attribute.updateNotificationBadge) {
                        parent.attribute.updateNotificationBadge(parent);
                    }

                    // Initial update of window indicators
                    if (parent.attribute.updateWindowIndicators) {
                        parent.attribute.updateWindowIndicators(parent);
                    }
                } else {
                    // For pinned apps, hide notification badge and window indicators
                    if (button.child?.child?.child?.overlays?.[0]) {
                        button.child.child.child.overlays[0].visible = false;
                    }
                    if (button.child?.child?.child?.overlays?.[1]) {
                        button.child.child.child.overlays[1].visible = false;
                    }
                }

                // Hook into notifications to update badge
                if (parent.hook) {
                    parent.hook(Notifications, (self) => {
                        if (self && self.attribute && self.attribute.updateNotificationBadge) {
                            self.attribute.updateNotificationBadge(self);
                        }
                    }, 'notified');

                    parent.hook(Notifications, (self) => {
                        if (self && self.attribute && self.attribute.updateNotificationBadge) {
                            self.attribute.updateNotificationBadge(self);
                        }
                    }, 'dismissed');

                    parent.hook(Notifications, (self) => {
                        if (self && self.attribute && self.attribute.updateNotificationBadge) {
                            self.attribute.updateNotificationBadge(self);
                        }
                    }, 'closed');
                }

                // Set up a timer to periodically check for notification updates
                const timerId = Utils.interval(1500, () => {
                    // Check if button still exists and is not destroyed
                    if (!button || button.is_destroyed) {
                        try {
                            GLib.source_remove(timerId);
                        } catch (e) {
                            // Silent fail
                        }
                        return false; // Stop the interval
                    }

                    try {
                        // Get the current parent (might have changed)
                        const currentParent = button.get_parent();
                        if (currentParent && currentParent.attribute &&
                            currentParent.attribute.updateNotificationBadge) {
                            currentParent.attribute.updateNotificationBadge(currentParent);
                        }
                    } catch (error) {
                        // If there's an error accessing the button, stop the interval
                        try {
                            GLib.source_remove(timerId);
                        } catch (e) {
                            // Silent fail
                        }
                        return false;
                    }
                    return true; // Keep the interval running
                });

                // Clean up the timer when the button is destroyed
                button.connect('destroy', () => {
                    if (timerId) {
                        try {
                            GLib.source_remove(timerId);
                        } catch (e) {
                            // Silent fail
                        }
                    }
                });
            };

            // Wait for the button to be fully initialized
            if (button.realized) {
                safelySetupButton();
            } else {
                button.connect('realize', safelySetupButton);
            }
        }
    })
});

const Taskbar = (monitor) => Widget.Box({
    className: 'dock-apps',
    attribute: {
        monitor: monitor,
        'map': new Map(),
        'clientSortFunc': (a, b) => {
            return a.attribute.workspace > b.attribute.workspace;
        },
        'update': (box) => {
            // Group clients by app class
            const appGroups = {};
            const activeClients = {};

            // First, group all clients by app class
            for (let i = 0; i < Hyprland.clients.length; i++) {
                const client = Hyprland.clients[i];
                if (client["pid"] == -1) continue;

                const appClass = client.class;
                if (!appGroups[appClass]) {
                    appGroups[appClass] = [];
                }

                appGroups[appClass].push(client);
                activeClients[client.address] = true;
            }

            // Clear buttons for apps that no longer have windows
            for (const [address, button] of box.attribute.map.entries()) {
                // Check if this is a group entry and if the app has no windows
                if (address.includes('group:')) {
                    const appClass = address.replace('group:', '');
                    const hasWindows = Object.keys(appGroups).some(groupAppClass =>
                        groupAppClass.toLowerCase() === appClass.toLowerCase() ||
                        groupAppClass.toLowerCase().includes(appClass.toLowerCase()) ||
                        appClass.toLowerCase().includes(groupAppClass.toLowerCase())
                    );

                    if (!hasWindows) {
                        // No windows for this app, remove it
                        button.revealChild = false;

                        // Store the timeout ID so we can clean it up if needed
                        const timeoutId = Utils.timeout(userOptions.asyncGet().animations.durationLarge, () => {
                            // Check if the widget still exists before trying to destroy it
                            if (button && !button.is_destroyed) {
                                try {
                                    button.destroy();
                                } catch (error) {
                                    // Suppress error logging
                                }
                            }

                            // Update the map
                            if (box && !box.is_destroyed) {
                                box.attribute.map.delete(address);
                            }
                        });

                        // Register the timeout for cleanup
                        if (globalThis.cleanupRegistry) {
                            globalThis.cleanupRegistry.registerTimeout(timeoutId);
                        }
                    }
                }
                // Handle individual client entries
                else if (!activeClients[address]) {
                    button.revealChild = false;

                    // Store the timeout ID so we can clean it up if needed
                    const timeoutId = Utils.timeout(userOptions.asyncGet().animations.durationLarge, () => {
                        // Check if the widget still exists before trying to destroy it
                        if (button && !button.is_destroyed) {
                            try {
                                button.destroy();
                            } catch (error) {
                                // Suppress error logging
                            }
                        }

                        // Update the map
                        if (box && !box.is_destroyed) {
                            box.attribute.map.delete(address);
                        }
                    });

                    // Register the timeout for cleanup
                    if (globalThis.cleanupRegistry) {
                        globalThis.cleanupRegistry.registerTimeout(timeoutId);
                    }
                }
            }

            // Create or update buttons for each app group
            for (const appClass in appGroups) {
                const clients = appGroups[appClass];
                const groupKey = `group:${appClass}`;
                const path = getIconPath(appClass);

                // Find the active client (if any)
                const activeClient = clients.find(client =>
                    client.address === Hyprland.active.client.address
                ) || clients[0];

                // Create or update the button
                if (box.attribute.map.has(groupKey)) {
                    // Update existing button
                    const button = box.attribute.map.get(groupKey);
                    button.attribute.windowCount = clients.length;
                    button.attribute.updateWindowIndicators(button);
                    button.set_tooltip_text(`${activeClient.title} (${appClass})`);
                } else {
                    // Create new button
                    const newButton = AppButton({
                        icon: path,
                        appClass: appClass,
                        windowCount: clients.length,
                        tooltipText: `${activeClient.title} (${appClass})`,
                        onClicked: () => {
                            // If there's only one window, focus it
                            if (clients.length === 1) {
                                focus(clients[0]);
                            } else {
                                // Otherwise, cycle through windows of this app
                                const activeIndex = clients.findIndex(c =>
                                    c.address === Hyprland.active.client.address
                                );
                                const nextIndex = (activeIndex + 1) % clients.length;
                                focus(clients[nextIndex]);
                            }
                        },
                    });

                    newButton.attribute.workspace = activeClient.workspace.id;
                    newButton.attribute.isPinned = false; // Mark as not pinned (taskbar app)
                    newButton.revealChild = true;
                    box.attribute.map.set(groupKey, newButton);
                }
            }

            // Update the children
            box.children = Array.from(box.attribute.map.values());
        },
        'add': (box, address) => {
            if (!address) {
                box.attribute.update(box);
                return;
            }

            const newClient = Hyprland.clients.find(client => {
                return client.address == address;
            });

            if (ExclusiveWindow(newClient)) { return }

            // Just update the whole taskbar when a client is added
            box.attribute.update(box);
        },
        'remove': (box, address) => {
            if (!address) return;

            // Just update the whole taskbar when a client is removed
            box.attribute.update(box);
        },
    },
    setup: (self) => {
        self.hook(Hyprland, (box, address) => box.attribute.add(box, address), 'client-added')
            .hook(Hyprland, (box, address) => box.attribute.remove(box, address), 'client-removed')
            .hook(Hyprland.active.client, () => {
                // Update all buttons when active client changes
                try {
                    // Make a copy of the values to avoid potential modification during iteration
                    const buttons = Array.from(self.attribute.map.values());

                    for (const button of buttons) {
                        if (!button) continue;

                        // Use a safer approach to access attributes
                        if (button.attribute && typeof button.attribute.updateWindowIndicators === 'function') {
                            try {
                                button.attribute.updateWindowIndicators(button);
                            } catch (e) {
                                // Suppress error logging to reduce console noise
                            }
                        }
                    }
                } catch (e) {
                    // Suppress error logging to reduce console noise
                }
            })
        Utils.timeout(100, () => self.attribute.update(self));
    },
});

/**
 * Find an application by its ID or name
 * @param {string} term - The application ID or name to search for
 * @returns {object|null} - The found application or null
 */
const findApp = (term) => {
    // First try direct query
    const queryResult = Applications.query(term)?.[0];
    if (queryResult) return { app: queryResult, term };

    // Handle special cases
    let searchTerm = term.toLowerCase();

    // Special case for Ghostty
    if (searchTerm === 'com.mitchellh.ghostty' || searchTerm === 'ghostty') {
        searchTerm = 'ghostty';
    }

    // Special case for JetBrains products
    if (searchTerm.includes('jetbrains')) {
        searchTerm = searchTerm.replace('jetbrains-', '');
    }

    // Try to find by desktop file or name with the possibly modified search term
    const app = Applications.list.find(a =>
        a.desktop?.toLowerCase().includes(searchTerm) ||
        a.name?.toLowerCase().includes(searchTerm)
    );

    if (app) return { app, term };

    return null;
};

const PinnedApps = () => Widget.Box({
    class_name: 'dock-apps',
    homogeneous: true,
    children: userOptions.asyncGet().dock.pinnedApps
        .map(findApp)
        .filter(result => result !== null)
        .map(({ app, term = true }) => {
            // Get the icon for the application
            // Our improved getIconPath will try app.icon_name first, then fall back to icon theme
            const icon = app.icon_name || getIconPath(app.name, false);

            // Get app class for notification matching
            const appClass = app.desktop?.split('.')[0] || app.name;

            const newButton = AppButton({
                icon: icon,
                appClass: appClass,
                isPinned: true, // Mark as pinned app
                onClicked: () => {
                    // Find all windows for this app
                    const appWindows = Hyprland.clients.filter(client =>
                        client.class.toLowerCase().includes(term)
                    );

                    if (appWindows.length === 0) {
                        // No windows, launch the app
                        app.launch();
                    } else if (appWindows.length === 1) {
                        // One window, focus it
                        focus(appWindows[0]);
                    } else {
                        // Multiple windows, cycle through them
                        const activeIndex = appWindows.findIndex(c =>
                            c.address === Hyprland.active.client.address
                        );
                        const nextIndex = (activeIndex + 1) % appWindows.length;
                        focus(appWindows[nextIndex]);
                    }
                },
                onMiddleClick: () => app.launch(),
                tooltipText: app.name,
                setup: (self) => {
                    self.revealChild = true;

                    // Use a safer approach to access the parent widget
                    const safelySetupButton = () => {
                        // Store a reference to the parent to avoid repeated access
                        const parentWidget = self.get_parent();
                        if (!parentWidget || !parentWidget.attribute) return;

                        // Update initial state
                        const updateState = (button) => {
                            if (!button) return;

                            // Find all windows for this app
                            const appWindows = Hyprland.clients.filter(client => {
                                const clientClass = client.class?.toLowerCase() || '';
                                return clientClass.includes(term.toLowerCase());
                            });

                            // For pinned apps, we don't want to show window indicators or notification badges
                            // We only update the running state and focused state

                            // Update running state
                            const running = appWindows.length > 0;
                            button.toggleClassName('notrunning', !running);

                            // Update focused state
                            const focused = appWindows.some(client =>
                                client.address === Hyprland.active.client.address
                            );
                            button.toggleClassName('focused', focused);

                            // Update tooltip
                            if (running) {
                                const activeWindow = appWindows.find(client =>
                                    client.address === Hyprland.active.client.address
                                ) || appWindows[0];
                                button.set_tooltip_text(activeWindow.title);
                            } else {
                                button.set_tooltip_text(app.name);
                            }
                        };

                        // Initial update
                        updateState(self);

                        // Hook for updates
                        if (self.hook) {
                            self.hook(Hyprland, button => {
                                if (button) updateState(button);
                            }, 'notify::clients');
                        }
                    };

                    // Wait for the button to be fully initialized
                    if (self.realized) {
                        safelySetupButton();
                    } else {
                        self.connect('realize', safelySetupButton);
                    }
                },
            });
            newButton.revealChild = true;
            return newButton;
        }),
});
export default (monitor = 0) => {
    const dockContent = Box({
        children:[
            userOptions.asyncGet().etc.widgetCorners ? RoundedCorner('bottomright', {vpack:"end",className: 'corner corner-colorscheme'}) : null,
            Box({
                className: `${elevate}`,
                css:`padding:${dockSize / 85}rem`,
                children:[
                    PinButton(),
                    PinnedApps(),
                    DockSeparator(),
                    Taskbar(),
                ]}),
            userOptions.asyncGet().etc.widgetCorners ? RoundedCorner('bottomleft',{vpack:"end", className: 'corner corner-colorscheme'}) : null,
        ]
    })
    const dockRevealer = Revealer({
        attribute: {
            'updateShow': self => { // I only use mouse to resize. I don't care about keyboard resize if that's a thing
                if (userOptions.asyncGet().dock.monitorExclusivity)
                    self.revealChild = Hyprland.active.monitor.id === monitor;
                else
                    self.revealChild = true;

                return self.revealChild
            }
        },
        // Set initial reveal state based on pin status
        revealChild: isPinned,
        transition: 'slide_up',
        transitionDuration: userOptions.asyncGet().animations.durationSmall,
        child: dockContent,
        setup: (self) => {
            const callback = (self, trigger) => {
                if (!userOptions.asyncGet().dock.trigger.includes(trigger)) return
                const flag = self.attribute.updateShow(self)

                if (flag) clearTimes();

                const hidden = userOptions.asyncGet().dock.autoHide.find(e => e["trigger"] === trigger)

                if (hidden) {
                    let id = Utils.timeout(hidden.interval, () => {
                        if (!isPinned) { self.revealChild = false }
                        timers = timers.filter(e => e !== id)
                    })
                    timers.push(id)
                }
            }

            self
                // .hook(Hyprland, (self) => self.attribute.updateShow(self))
                .hook(Hyprland.active.workspace, self => callback(self, "workspace-active"))
                .hook(Hyprland.active.client, self => callback(self, "client-active"))
                .hook(Hyprland, self => callback(self, "client-added"), "client-added")
                .hook(Hyprland, self => callback(self, "client-removed"), "client-removed")
        },
    })
    return EventBox({
        onHover: () => {
            dockRevealer.revealChild = true;
            clearTimes()
        },
        child: Box({
            homogeneous: true,
            css: `min-height: ${userOptions.asyncGet().dock.hiddenThickness}px;`,
            children: [dockRevealer],
        }),
        setup: self => self.on("leave-notify-event", () => {
            if (!isPinned) dockRevealer.revealChild = false;
            clearTimes()
        })
    })
}
