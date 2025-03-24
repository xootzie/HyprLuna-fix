const { Pango } = imports.gi;
import Widget from 'resource:///com/github/Aylur/ags/widget.js';
import Network from "resource:///com/github/Aylur/ags/service/network.js";
import * as Utils from 'resource:///com/github/Aylur/ags/utils.js';
import GLib from 'gi://GLib';
const { Box, Button, Entry, Icon, Label, Revealer, Scrollable, Slider, Stack, Overlay } = Widget;
const { execAsync, exec } = Utils;
import { MaterialIcon } from '../../.commonwidgets/materialicon.js';
import { setupCursorHover } from '../../.widgetutils/cursorhover.js';
import { ConfigToggle } from '../../.commonwidgets/configwidgets.js';
// import { download , upload } from '../../.commonwidgets/networkspeed.js';
const MATERIAL_SYMBOL_SIGNAL_STRENGTH = {
    'network-wireless-signal-excellent-symbolic': "signal_wifi_4_bar",
    'network-wireless-signal-good-symbolic': "network_wifi_3_bar",
    'network-wireless-signal-ok-symbolic': "network_wifi_2_bar",
    'network-wireless-signal-weak-symbolic': "network_wifi_1_bar",
    'network-wireless-signal-none-symbolic': "signal_wifi_0_bar",
}

// Helper function for translations
function getString(str) {
    // This is a simple implementation - in a real app, this would connect to a translation system
    return str;
}

// Resource management utilities
const ResourceManager = {
    timeouts: new Set(),
    intervals: new Set(),
    
    setTimeout(callback, delay) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.timeouts.delete(id);
            return callback() || GLib.SOURCE_REMOVE;
        });
        this.timeouts.add(id);
        return id;
    },
    
    clearTimeout(id) {
        if (this.timeouts.has(id)) {
            GLib.source_remove(id);
            this.timeouts.delete(id);
        }
    },
    
    setInterval(callback, delay) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            if (callback()) {
                return GLib.SOURCE_CONTINUE;
            }
            this.intervals.delete(id);
            return GLib.SOURCE_REMOVE;
        });
        this.intervals.add(id);
        return id;
    },
    
    clearInterval(id) {
        if (this.intervals.has(id)) {
            GLib.source_remove(id);
            this.intervals.delete(id);
        }
    },
    
    clearAll() {
        for (const id of this.timeouts) {
            GLib.source_remove(id);
        }
        this.timeouts.clear();
        
        for (const id of this.intervals) {
            GLib.source_remove(id);
        }
        this.intervals.clear();
    }
};

// Safe widget operations
const SafeOps = {
    isValidWidget(widget) {
        if (!widget) return false;
        try {
            return widget.get_parent() !== null;
        } catch (e) {
            return false;
        }
    },
    
    safeSet(widget, property, value) {
        if (!this.isValidWidget(widget)) return false;
        try {
            widget[property] = value;
            return true;
        } catch (e) {
            return false;
        }
    },
    
    safeConnect(widget, signal, callback) {
        if (!this.isValidWidget(widget)) return null;
        try {
            return widget.connect(signal, callback);
        } catch (e) {
            return null;
        }
    },
    
    safeDisconnect(widget, handlerId) {
        if (!widget || !handlerId) return;
        try {
            widget.disconnect(handlerId);
        } catch (e) {
            // Silent error handling
        }
    }
};

// Improved signal management system
class SignalManager {
    constructor() {
        this._connections = new WeakMap();
    }

    connect(widget, signal, callback) {
        if (!widget || !signal || !callback) return null;
        
        try {
            // Verify widget is still valid
            if (!widget.get_parent) return null;
            
            // Create or get the widget's signal map
            let signals = this._connections.get(widget);
            if (!signals) {
                signals = new Map();
                this._connections.set(widget, signals);
            }

            // If there's an existing handler, disconnect it first
            if (signals.has(signal)) {
                try {
                    const oldHandler = signals.get(signal);
                    if (oldHandler && oldHandler > 0) {
                        widget.disconnect(oldHandler);
                    }
                } catch (e) {
                    console.debug(`Failed to disconnect old handler for ${signal}:`, e);
                }
                signals.delete(signal);
            }

            // Connect the signal and store the handler ID
            const handlerId = widget.connect(signal, callback);
            if (handlerId && handlerId > 0) {
                signals.set(signal, handlerId);
                return handlerId;
            }
        } catch (e) {
            console.debug(`Failed to connect signal ${signal}:`, e);
        }
        return null;
    }

    disconnect(widget, signal) {
        if (!widget) return;
        
        try {
            const signals = this._connections.get(widget);
            if (signals && signals.has(signal)) {
                const handlerId = signals.get(signal);
                if (handlerId && handlerId > 0) {
                    try {
                        widget.disconnect(handlerId);
                    } catch (e) {
                        console.debug(`Failed to disconnect signal ${signal}:`, e);
                    }
                }
                signals.delete(signal);
                
                // Clean up the map if it's empty
                if (signals.size === 0) {
                    this._connections.delete(widget);
                }
            }
        } catch (e) {
            console.debug(`Failed to handle disconnect for ${signal}:`, e);
        }
    }

    disconnectAll(widget) {
        if (!widget) return;
        
        try {
            const signals = this._connections.get(widget);
            if (signals) {
                for (const [signal, handlerId] of signals) {
                    if (handlerId && handlerId > 0) {
                        try {
                            widget.disconnect(handlerId);
                        } catch (e) {
                            console.debug(`Failed to disconnect signal ${signal}:`, e);
                        }
                    }
                }
                signals.clear();
                this._connections.delete(widget);
            }
        } catch (e) {
            console.debug('Failed to disconnect all signals:', e);
            // Ensure the widget is removed from connections even if disconnection fails
            this._connections.delete(widget);
        }
    }
}

const signalManager = new SignalManager();

// Improved SafeNetworkHooks class
class SafeNetworkHooks {
    constructor() {
        this._widgets = new Map();
        this._isDestroyed = false;
        this._updateTimeout = null;
        this._cleanupInterval = null;
        this._networkChangedHandler = null;
        
        // Setup a global Network signal handler with debouncing
        try {
        this._networkChangedHandler = Network.connect('changed', () => {
            if (this._isDestroyed) return;
            
            if (this._updateTimeout) {
                    ResourceManager.clearTimeout(this._updateTimeout);
            }
            
                this._updateTimeout = ResourceManager.setTimeout(() => {
                this._safeDispatch();
                }, 50);
            });
        } catch (e) {
            console.debug('Failed to connect to Network changed signal:', e);
        }
        
        this._cleanupInterval = ResourceManager.setInterval(() => {
            return !this._isDestroyed && this._cleanup();
        }, 5000);
    }
    
    destroy() {
        if (this._isDestroyed) return;
        this._isDestroyed = true;
        
        // Clear timeouts first
        if (this._updateTimeout) {
            ResourceManager.clearTimeout(this._updateTimeout);
            this._updateTimeout = null;
        }
        
        if (this._cleanupInterval) {
            ResourceManager.clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        
        // Disconnect network handler if it exists and is valid
        if (this._networkChangedHandler && this._networkChangedHandler > 0) {
            try {
                Network.disconnect(this._networkChangedHandler);
            } catch (e) {
                console.debug('Failed to disconnect network handler:', e);
            }
            this._networkChangedHandler = null;
        }
        
        // Clean up all widget connections
        for (const [widget, state] of this._widgets) {
            if (state.destroyHandler && state.destroyHandler > 0) {
                try {
                    signalManager.disconnect(widget, 'destroy');
                } catch (e) {
                    console.debug('Failed to disconnect widget destroy handler:', e);
                }
            }
        }
        this._widgets.clear();
    }
    
    register(widget, callback) {
        if (!widget || !callback || this._isDestroyed) return null;
        
        const state = {
            callback,
            isDestroyed: false,
            destroyHandler: null
        };
        
        // Setup destroy handler using SignalManager
        try {
            state.destroyHandler = signalManager.connect(widget, 'destroy', () => {
                state.isDestroyed = true;
                this._widgets.delete(widget);
            });
        } catch (e) {
            console.debug('Failed to connect widget destroy handler:', e);
            return null;
        }
        
        this._widgets.set(widget, state);
        
        // Schedule an initial update
        ResourceManager.setTimeout(() => {
            if (!this._isDestroyed && !state.isDestroyed) {
                try {
                    callback(Network);
            } catch (e) {
                    console.debug('Failed to execute callback:', e);
                }
            }
            return false;
        }, 10);
        
        return state;
    }
    
    _safeDispatch() {
        if (this._isDestroyed) return;
        
        for (const [widget, state] of this._widgets) {
            if (state.isDestroyed) continue;
            
            try {
                if (widget && widget.get_parent()) {
                    state.callback(Network);
                } else {
                    state.isDestroyed = true;
                    if (state.destroyHandler && state.destroyHandler > 0) {
                        try {
                            signalManager.disconnect(widget, 'destroy');
            } catch (e) {
                            console.debug('Failed to disconnect widget destroy handler:', e);
                        }
                    }
                    this._widgets.delete(widget);
                }
            } catch (e) {
                console.debug('Failed to dispatch:', e);
                state.isDestroyed = true;
                if (state.destroyHandler && state.destroyHandler > 0) {
                    try {
                        signalManager.disconnect(widget, 'destroy');
            } catch (e) {
                        console.debug('Failed to disconnect widget destroy handler:', e);
            }
                }
                this._widgets.delete(widget);
            }
        }
    }
    
    _cleanup() {
        if (this._isDestroyed) return false;
        
        for (const [widget, state] of this._widgets) {
            try {
                if (!widget || !widget.get_parent()) {
                    if (state.destroyHandler && state.destroyHandler > 0) {
                        try {
                            signalManager.disconnect(widget, 'destroy');
            } catch (e) {
                            console.debug('Failed to disconnect widget destroy handler:', e);
                        }
                    }
                    this._widgets.delete(widget);
                }
            } catch (e) {
                console.debug('Failed to cleanup widget:', e);
                this._widgets.delete(widget);
            }
        }
        
        return true;
    }
}

// Create a single instance of SafeNetworkHooks
const networkHooks = new SafeNetworkHooks();

// Helper function to safely update a label with Network data
function safeUpdateLabel(label, value, defaultValue = '') {
    if (!label?.get_parent()) return;
    
    try {
        label.label = value || defaultValue;
                } catch (e) {
        console.debug('Failed to update label:', e);
    }
}

// Improved network label setup using AGS v1 hooks
function setupNetworkLabel(label, callback) {
    if (!label) return;
    
    // Use Widget.hook() for automatic signal cleanup
    label.hook(Network, () => {
        if (label?.get_parent()) {
            callback(Network);
        }
    });
}

// Create the network status widget using AGS v1 bindings
const NetworkStatus = () => Label({
    className: 'txt-subtext',
    vpack: 'center',
    // Bind the label directly to Network.wifi.state
    setup: (self) => {
        self.hook(Network, () => {
            self.label = Network.wifi?.state || '';
        });
    },
});

// Create the network name widget using AGS v1 bindings
const NetworkName = () => Box({
    vertical: true,
    hexpand: true,
    children: [
        Label({
            className: 'txt-smaller txt-subtext',
            label: getString("Current network"),
        }),
        Label({
            hpack: 'start',
            setup: (self) => {
                self.hook(Network, () => {
                    self.label = Network.wifi?.ssid || getString('Not Connected');
                });
            },
        }),
    ],
});

// Track active password entry to prevent it from disappearing
let activePasswordEntry = null;
let activePasswordSSID = null;
let connectAttempt = '';

// Helper function to check if a network is already registered
async function isNetworkRegistered(ssid) {
    try {
        // Get all connection profiles
        const result = await execAsync(['nmcli', '-t', '-f', 'NAME,TYPE', 'connection', 'show']);
        const connections = result.split('\n').filter(Boolean);
        
        // Check for exact matches and case-insensitive matches
        const isRegistered = connections.some(conn => {
            const [name, type] = conn.split(':');
            if (type !== 'wifi') return false;
            
            // Check for exact match or case-insensitive match
            return name === ssid || 
                   name.startsWith(`${ssid}_`) || 
                   name.toLowerCase() === ssid.toLowerCase() ||
                   name.toLowerCase().startsWith(`${ssid.toLowerCase()}_`);
        });
        
        // If we found a match, log it and return true
        if (isRegistered) {
            return true;
        }
        
        return false;
    } catch (e) {
        // Silent error handling
        return false;
    }
}

// Helper function to get all connection profiles for a specific SSID
async function getConnectionsForSSID(ssid) {
    try {
        const result = await execAsync(['nmcli', '-t', '-f', 'NAME,TYPE', 'connection', 'show']);
        const connections = result.split('\n').filter(Boolean);
        return connections
            .filter(conn => {
                const [name, type] = conn.split(':');
                return type === 'wifi' && (name === ssid || name.startsWith(`${ssid}_`));
            })
            .map(conn => conn.split(':')[0]);
    } catch (e) {
        // Silent error handling
        return [];
    }
}

const NetResource = (icon, command) => {
    const resourceLabel = Label({
        className: `txt-smaller txt-subtext`,
    });
    const widget = Button({
        child: Box({
            hpack: 'start',
            className: `spacing-h-4`,
            children: [
                MaterialIcon(icon, 'very-small'),
                resourceLabel,
            ],
            setup: (self) => self.poll(2000, () => execAsync(['bash', '-c', command])
                .then((output) => {
                    resourceLabel.label = output;
                }).catch(print))
            ,
        })
    });
    return widget;
}

// Improved WifiNetwork component using AGS v1 features
const WifiNetwork = (ap) => {
    const state = {
        connecting: false,
        expanded: false,
    };

    // Create the password entry
    const passwordEntry = Entry({
        className: 'sidebar-wifinetworks-password-entry',
        setup: self => {
            self.placeholderText = getString('Password');
        },
        visibility: false,
        onAccept: () => connect(),
    });

    // Create the password toggle button
    const passwordToggle = Button({
        className: 'sidebar-wifinetworks-password-toggle',
        child: MaterialIcon('visibility', 'small'),
        setup: setupCursorHover,
        onClicked: () => {
            passwordEntry.visibility = !passwordEntry.visibility;
            passwordToggle.child = MaterialIcon(
                passwordEntry.visibility ? 'visibility_off' : 'visibility',
                'small'
            );
        },
    });

    // Create the connect button
    const connectButton = Button({
        className: 'sidebar-wifinetworks-connect-button',
        child: Box({
        children: [
                MaterialIcon('wifi', 'small'),
                Label(getString('Connect')),
            ],
        }),
        setup: setupCursorHover,
        onClicked: () => connect(),
    });

    // Create the password box
    const passwordBox = Box({
        className: 'spacing-h-5',
        children: [
            passwordEntry,
            passwordToggle,
            connectButton,
        ],
    });

    // Create the password revealer
    const passwordRevealer = Revealer({
        transition: 'slide_down',
        transitionDuration: userOptions.asyncGet().animations.durationSmall,
        revealChild: false,
        child: passwordBox,
    });

    // Function to connect to the network
    const connect = async () => {
        if (state.connecting) return;
        state.connecting = true;
        connectButton.sensitive = false;

        try {
            await Network.wifi?.connectToAP(ap, passwordEntry.text);
            
            // Clear password and hide entry on success
            passwordEntry.text = '';
            state.expanded = false;
            passwordRevealer.revealChild = false;
            
                        Utils.notify({
                summary: getString('WiFi Connected'),
                body: `${getString('Successfully connected to')} ${ap.ssid}`,
                iconName: 'network-wireless-connected-symbolic',
            });
        } catch (error) {
            Utils.notify({
                summary: getString('Error'),
                body: `${getString('Failed to connect to')} ${ap.ssid}: ${error}`,
                iconName: 'dialog-error-symbolic',
                            urgency: 'critical',
                        });
        } finally {
            state.connecting = false;
            connectButton.sensitive = true;
        }
    };

    // Create the network button
    const networkButton = Button({
        className: 'sidebar-wifinetworks-network',
        child: Box({
            children: [
                MaterialIcon(ap.strength > 66 ? 'wifi' : 
                           ap.strength > 33 ? 'wifi_2_bar' : 'wifi_1_bar', 'small'),
                Label(ap.ssid || getString('Hidden Network')),
                Box({ hexpand: true }),
                MaterialIcon(ap.active ? 'check' : 'chevron_right', 'small'),
                    ],
                }),
                            setup: setupCursorHover,
                            onClicked: () => {
            if (ap.active) return;
            
            state.expanded = !state.expanded;
            passwordRevealer.revealChild = state.expanded;
            
            if (state.expanded) {
                passwordEntry.text = '';
                passwordEntry.grab_focus();
            }
        },
    });

    return Box({
        vertical: true,
        className: 'spacing-v-5',
        children: [
            networkButton,
            passwordRevealer,
        ],
    });
};

// Improved network list using AGS v1 features
const NetworkList = () => {
    const state = {
        networks: [],
        scanning: false,
    };

    const updateNetworks = () => {
        if (!Network.wifi?.accessPoints) {
            networksBox.children = [];
            return;
        }
        
        // Sort networks by strength
        const sortedNetworks = [...Network.wifi.accessPoints].sort((a, b) => b.strength - a.strength);
        
        // Update the list while preserving expanded state
        const oldChildren = new Map(networksBox.children.map(child => [
            child._ap?.ssid,
            child.children[1]?.revealChild || false
        ]));
        
        networksBox.children = sortedNetworks.map(ap => {
            const widget = WifiNetwork(ap);
            // Restore expanded state if it existed
            if (oldChildren.has(ap.ssid)) {
                widget.children[1].revealChild = oldChildren.get(ap.ssid);
            }
            widget._ap = ap; // Store reference for state preservation
            return widget;
        });
    };

    const networksBox = Box({
        vertical: true,
        className: 'spacing-v-5',
        connections: [['destroy', self => {
            self._wifiHook?.disconnect();
        }]],
    });

    const scanButton = Button({
        className: 'sidebar-button txt-norm',
        child: Box({
            className: 'spacing-h-5',
            children: [
                MaterialIcon('refresh', 'small'),
                Label(getString('Scan')),
            ],
        }),
        setup: setupCursorHover,
        onClicked: () => {
            if (state.scanning) return;
            
            state.scanning = true;
            scanButton.sensitive = false;
            
            Network.wifi?.scan()
                    .catch(error => {
                            Utils.notify({
                        summary: getString('Error'),
                        body: `${getString('Failed to scan for networks')}: ${error}`,
                        iconName: 'dialog-error-symbolic',
                                urgency: 'critical',
                            });
                })
                .finally(() => {
                    state.scanning = false;
                    scanButton.sensitive = true;
                });
        },
    });

    return Box({
        vertical: true,
        className: 'spacing-v-5',
        connections: [['destroy', self => {
            self._networkHook?.disconnect();
        }]],
        setup: (self) => {
            // Hook into network changes
            self._networkHook = self.hook(Network, () => {
                if (!Network.wifi) {
                    networksBox.children = [];
                return;
            }
            
                // Update networks list
                updateNetworks();
                
                // Re-hook the access points signal if wifi service changed
                networksBox._wifiHook?.disconnect();
                networksBox._wifiHook = networksBox.hook(Network.wifi, updateNetworks, 'notify::access-points');
            }, 'notify::wifi');
        },
        children: [
            scanButton,
            networksBox,
        ],
        });
    };
    
const handleConfirmation = async (action, state, actionsRevealer, confirmationRevealer) => {
    const ssid = Network.wifi?.ssid;
    if (!ssid) return;

    try {
        if (action === 'forget') {
            // Find and remove all connections for this SSID
            const connections = await execAsync(`nmcli -t -f NAME,TYPE connection show | grep ":wifi$" | grep -i "^${ssid}\\(_\\|:\\|$\\)" | cut -d':' -f1`);
            
            // Disconnect first
            await execAsync('nmcli device disconnect wlan0');
            
            // Delete each connection
            for (const conn of connections.split('\n').filter(Boolean)) {
                await execAsync(['nmcli', 'connection', 'delete', conn]);
            }
            
            // Remove secrets from keyring if available
            try {
                await execAsync(['secret-tool', 'clear', 'network', ssid]);
            } catch (e) {
                // Ignore keyring errors
            }
            
            Utils.notify({
                summary: getString("WiFi Network Forgotten"),
                body: `${getString("Successfully forgot")} ${ssid}.`,
                iconName: 'network-wireless-disconnected-symbolic',
            });
        } else if (action === 'disconnect') {
            const activeConn = await execAsync(`nmcli -t -f NAME,DEVICE connection show --active | grep ":wlan0$" | cut -d':' -f1`);
            
            if (activeConn) {
                // Temporarily disable autoconnect
                await execAsync(['nmcli', 'connection', 'modify', activeConn.trim(), 'connection.autoconnect', 'no']);
                
                // Disconnect
                await execAsync('nmcli device disconnect wlan0');
                
                // Re-enable autoconnect
                await execAsync(['nmcli', 'connection', 'modify', activeConn.trim(), 'connection.autoconnect', 'yes']);
            } else {
                // Just disconnect if no active connection
                await execAsync('nmcli device disconnect wlan0');
            }
            
                Utils.notify({
                summary: getString("WiFi Disconnected"),
                body: getString("Successfully disconnected from WiFi network."),
                    iconName: 'network-wireless-disconnected-symbolic',
            });
        }
    } catch (error) {
        Utils.notify({
            summary: getString("Error"),
            body: `${getString(action === 'forget' ? "Failed to forget" : "Failed to disconnect")}: ${error}`,
            iconName: 'dialog-error-symbolic',
            urgency: 'critical',
        });
    } finally {
        // Reset UI state
        if (state) {
            state.confirmationExpanded = false;
            state.actionsExpanded = false;
        }
        if (confirmationRevealer) {
            confirmationRevealer.revealChild = false;
        }
        if (actionsRevealer) {
            actionsRevealer.revealChild = false;
        }
    }
};

const CurrentNetwork = () => {
    const state = {
        actionsExpanded: false,
        confirmationExpanded: false,
        confirmationAction: '',
    };
    
    // Create the action buttons revealer
    const actionButtons = Box({
        className: 'spacing-h-5 margin-top-5',
        homogeneous: true,
        children: [
            Button({
                className: 'sidebar-button txt-norm icon-material',
                child: Box({
                    className: 'spacing-h-5',
                    children: [
                        MaterialIcon('delete', 'small'),
                        Label(getString('Forget')),
                    ],
                }),
                setup: setupCursorHover,
                onClicked: () => {
                    state.confirmationAction = 'forget';
                    state.confirmationExpanded = true;
                    confirmationRevealer.revealChild = true;
                    actionsRevealer.revealChild = false;
                },
            }),
            Button({
                className: 'sidebar-button txt-norm icon-material',
                child: Box({
                    className: 'spacing-h-5',
                    children: [
                        MaterialIcon('wifi_off', 'small'),
                        Label(getString('Disconnect')),
                    ],
                }),
                setup: setupCursorHover,
                onClicked: () => {
                    state.confirmationAction = 'disconnect';
                    state.confirmationExpanded = true;
                    confirmationRevealer.revealChild = true;
                    actionsRevealer.revealChild = false;
                },
            }),
        ],
    });
    
    // Create the confirmation buttons revealer
    const confirmationButtons = Box({
        className: 'spacing-h-5 margin-top-5',
        homogeneous: true,
        children: [
            Button({
                className: 'sidebar-button txt-norm icon-material',
                child: Box({
                    className: 'spacing-h-5',
                    children: [
                        MaterialIcon('close', 'small'),
                        Label(getString('Cancel')),
                    ],
                }),
                setup: setupCursorHover,
                onClicked: () => {
                    state.confirmationExpanded = false;
                    confirmationRevealer.revealChild = false;
                    actionsRevealer.revealChild = true;
                },
            }),
            Button({
                className: 'sidebar-button txt-norm icon-material destructive',
                child: Box({
                    className: 'spacing-h-5',
                    children: [
                        MaterialIcon('check', 'small'),
                        Label(getString('Confirm')),
                    ],
                }),
                setup: setupCursorHover,
                onClicked: () => {
                    handleConfirmation(state.confirmationAction, state, actionsRevealer, confirmationRevealer);
                },
            }),
        ],
    });
    
    // Create the revealers
    const actionsRevealer = Revealer({
        transition: 'slide_down',
        transitionDuration: userOptions.asyncGet().animations.durationSmall,
        revealChild: false,
        child: actionButtons,
    });
    
    const confirmationRevealer = Revealer({
        transition: 'slide_down',
        transitionDuration: userOptions.asyncGet().animations.durationSmall,
        revealChild: false,
        child: confirmationButtons,
    });
    
    // Create the expand button
    const expandButton = Button({
        className: 'sidebar-button txt-norm icon-material',
        child: MaterialIcon('more_vert', 'small'),
        setup: setupCursorHover,
        onClicked: () => {
            if (state.confirmationExpanded) {
                state.confirmationExpanded = false;
                confirmationRevealer.revealChild = false;
            } else if (state.actionsExpanded) {
                state.actionsExpanded = false;
                actionsRevealer.revealChild = false;
            } else {
                state.actionsExpanded = true;
                actionsRevealer.revealChild = true;
            }
        },
    });
  
    return Box({
            vertical: true,
            children: [
            Revealer({
                transition: 'slide_down',
                transitionDuration: userOptions.asyncGet().animations.durationLarge,
                    setup: (self) => {
                    self.hook(Network, () => {
                        self.revealChild = !!Network.wifi;
                    });
                },
                child: Box({
        vertical: true,
        className: 'spacing-v-10',
        children: [
            Box({
                className: 'sidebar-wifinetworks-network',
                vertical: true,
                children: [
                    Box({
                        className: 'spacing-h-10',
                        children: [
                            MaterialIcon('language', 'hugerass'),
                                        NetworkName(),
                            Box({ hexpand: true }),
                            expandButton,
                                    ],
                    }),
                    actionsRevealer,
                    confirmationRevealer,
                            ],
                        }),
                        Box({ className: 'separator-line' }),
                    ],
                }),
            }),
        ],
    });
};

export default (props) => {
    const networkList = Box({
        vertical: true,
        className: 'spacing-v-10',
        children: [Overlay({
            passThrough: true,
            child: Scrollable({
                vexpand: true,
                child: NetworkList(),
            }),
            overlays: [Box({
                className: 'sidebar-centermodules-scrollgradient-bottom'
            })]
        })]
    });
    const bottomBar = Box({
        homogeneous: true,
        children: [Button({
            hpack: 'center',
            className: 'txt-small txt sidebar-centermodules-bottombar-button',
            onClicked: () => {
                execAsync(['bash', '-c', userOptions.asyncGet().apps.network]).catch(print);
                closeEverything();
            },
            label: getString('More'),
            setup: setupCursorHover,
        })],
    })
    return Box({
        ...props,
        className: 'spacing-v-10',
        vertical: true,
        children: [
            CurrentNetwork(),
            networkList,
            bottomBar,
        ]
    });
}

// Cleanup all resources when the module is unloaded
export const cleanup = () => {
    networkHooks.destroy();
    ResourceManager.clearAll();
};
