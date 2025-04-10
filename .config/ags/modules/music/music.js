const { GLib, Gtk, GdkPixbuf, Gdk } = imports.gi;
import PopupWindow from "../.widgethacks/popupwindow.js";
import App from "resource:///com/github/Aylur/ags/app.js";
import Widget from "resource:///com/github/Aylur/ags/widget.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";
import Mpris from "resource:///com/github/Aylur/ags/service/mpris.js";
import userOptions from "../.configuration/user_options.js";
import { RoundedCorner } from "../.commonwidgets/cairo_roundedcorner.js";
const { Box, Icon, Label, Button } = Widget;
import { AnimatedCircProg } from "../.commonwidgets/cairo_circularprogress.js";
import { hasPlasmaIntegration } from "../.miscutils/system.js";
import CavaService from "../../services/cava.js";
import clickCloseRegion from "../.commonwidgets/clickcloseregion.js";
import Audio from 'resource:///com/github/Aylur/ags/service/audio.js';
const elevate = userOptions.asyncGet().etc.widgetCorners
  ? "osd-round osd-music "
  : "osd-music elevation elevate-music ";
const mode = userOptions.asyncGet().etc.enableAmberol ? "amberoled " : "";

var lastCoverPath = "";

// Store the last manually selected player
let lastSelectedPlayer = null;

export const getPlayer = () => {
    // Get all players except playerctld
    const players = Mpris.players.filter(p => p.busName !== "playerctld");
    if (players.length === 0) return null;

    // If we have a last selected player and it's still available, use it
    if (lastSelectedPlayer) {
        const found = players.find(p => p.busName === lastSelectedPlayer.busName);
        if (found) return found;
        lastSelectedPlayer = null; // Clear if not found
    }

    // If no selected player, return first available player
    return players[0];
};

function lengthStr(length) {
  const min = Math.floor(length / 60);
  const sec = Math.floor(length % 60);
  const sec0 = sec < 10 ? "0" : "";
  return `${min}:${sec0}${sec}`;
}

function detectMediaSource(link) {
  if (link.startsWith("file://")) {
    if (link.includes("firefox-mpris")) return "󰈹  Firefox";
    return "󰎆   Lofi";
  }
  let url = link.replace(/(^\w+:|^)\/\//, "");
  let domain = url.match(/(?:[a-z]+\.)?([a-z]+\.[a-z]+)/i)[1];
  if (domain == "ytimg.com") return "󰗃   Youtube";
  if (domain == "discordapp.net") return "󰙯   Discord";
  if (domain == "scdn.co") return "   Spotify";
  if (domain == "sndcdn.com") return "󰓀   SoundCloud";
  return domain;
}

const DEFAULT_MUSIC_FONT = "Gabarito, sans-serif";
function getTrackfont(player) {
  const title = player.trackTitle;
  const artists = player.trackArtists.join(" ");
  if (
    artists.includes("TANO*C") ||
    artists.includes("USAO") ||
    artists.includes("Kobaryo")
  )
    return "Chakra Petch"; // Rigid square replacement
  if (title.includes("東方")) return "Crimson Text, serif"; // Serif for Touhou stuff
  return DEFAULT_MUSIC_FONT;
}

function trimTrackTitle(title) {
  if (!title) return "";
  const cleanPatterns = [
    /【[^】]*】/, // Remove certain bracketed text (e.g., Touhou/weeb stuff)
    " [FREE DOWNLOAD]", // Remove literal text such as F-777's suffix
  ];
  cleanPatterns.forEach((expr) => (title = title.replace(expr, "")));
  return title;
}

const TrackProgress = ({ player, ...rest }) => {
  const _updateProgress = (circprog) => {
    if (!player) {
      circprog.css = `font-size: 0px;`;
      return;
    }
    // Update circular progress; the font size scales with playback progress.
    circprog.css = `font-size: ${Math.max(
      (player.position / player.length) * 100,
      0
    )}px;`;
  };
  
  return AnimatedCircProg({
    ...rest,
    className: "osd-music-circprog",
    vpack: "center",
    extraSetup: (self) => {
      let mprisSignalId = null;
      let pollId = null;
      
      // Connect to Mpris signal
      mprisSignalId = self.hook(Mpris, _updateProgress);
      
      // Set up polling
      pollId = self.poll(3000, _updateProgress);
      
      // Clean up on destroy
      self.connect("destroy", () => {
        // Disconnect Mpris signal
        if (mprisSignalId) {
          try {
            Mpris.disconnect(mprisSignalId);
          } catch (e) {
            // Silent error handling
          }
          mprisSignalId = null;
        }
        
        // Remove poll
        if (pollId) {
          try {
            self.removePoll(pollId);
          } catch (e) {
            // Silent error handling - fallback to GLib.Source.remove if removePoll fails
            try {
              GLib.Source.remove(pollId);
            } catch (e2) {
              // Silent error handling
            }
          }
          pollId = null;
        }
      });
    },
  });
};

const TrackTitle = ({ player, ...rest }) =>
  Label({
    ...rest,
    label: "Play Some Music",
    xalign: 0,
    truncate: "end",
    className: "osd-music-title txt-shadow",
    setup: (self) => {
      if (player) {
        self.hook(
          player,
          (self) => {
            self.label =
              player.trackTitle.length > 0
                ? trimTrackTitle(player.trackTitle)
                : "No media";
            const fontForThisTrack = getTrackfont(player);
            self.css = `font-family: ${fontForThisTrack}, ${DEFAULT_MUSIC_FONT};`;
          },
          "notify::track-title"
        );
      } else {
        self.label = "No music playing";
      }
    },
  });

const TrackArtists = ({ player, ...rest }) =>
  Label({
    ...rest,
    xalign: 0,
    label: "HyprLuna",
    className: "osd-music-artists txt-shadow",
    truncate: "end",
    setup: (self) => {
      if (player) {
        self.hook(
          player,
          (self) => {
            self.label =
              player.trackArtists.length > 0
                ? player.trackArtists.join(", ")
                : "";
          },
          "notify::track-artists"
        );
      } else {
        self.label = "";
      }
    },
  });

const CoverArt = ({ player, ...rest }) => {
  const DEFAULT_COVER_SIZE = 150;
  let currentCoverPath = null;
  const drawingArea = Widget.DrawingArea({
    className: "osd-music-cover-art shadow-window",
    vpack: "start",
    setup: (self) => {
      self.set_size_request(DEFAULT_COVER_SIZE, DEFAULT_COVER_SIZE);
      self.connect("draw", (widget, cr) => {
        if (!currentCoverPath) return;
        try {
          // Load the full image
          let pixbuf = GdkPixbuf.Pixbuf.new_from_file(currentCoverPath);
          const imgWidth = pixbuf.get_width();
          const imgHeight = pixbuf.get_height();
          
          // Calculate scale factor to fit within the area while maintaining aspect ratio
          const scale = Math.min(
            DEFAULT_COVER_SIZE / imgWidth,
            DEFAULT_COVER_SIZE / imgHeight
          );
          const newWidth = Math.round(imgWidth * scale);
          const newHeight = Math.round(imgHeight * scale);
          
          // Center the image
          const offsetX = (DEFAULT_COVER_SIZE - newWidth) / 2;
          const offsetY = (DEFAULT_COVER_SIZE - newHeight) / 2;
          
          // Scale the image
          pixbuf = pixbuf.scale_simple(
            newWidth,
            newHeight,
            GdkPixbuf.InterpType.BILINEAR
          );

          // Create rounded corners clip region
          const radius = 16;
          cr.arc(radius, radius, radius, Math.PI, 1.5 * Math.PI);
          cr.arc(
            DEFAULT_COVER_SIZE - radius,
            radius,
            radius,
            1.5 * Math.PI,
            2 * Math.PI
          );
          cr.arc(
            DEFAULT_COVER_SIZE - radius,
            DEFAULT_COVER_SIZE - radius,
            radius,
            0,
            0.5 * Math.PI
          );
          cr.arc(
            radius,
            DEFAULT_COVER_SIZE - radius,
            radius,
            0.5 * Math.PI,
            Math.PI
          );
          cr.closePath();
          cr.clip();

          // Paint the scaled image
          Gdk.cairo_set_source_pixbuf(cr, pixbuf, offsetX, offsetY);
          cr.paint();
        } catch (e) {
          console.error("Error drawing cover art:", e);
        }
      });
    },
  });

  let fallbackIcon = Icon({
    className: "onSurfaceVariant",
    icon: "logo-symbolic",
    css: `min-width:150px;min-height:150px`,
    size: "100",
    visible: false,
  });

  return Widget.Box({
    ...rest,
    css: `margin-right:0.8rem;margin-left:0.4rem;`,
    child: Widget.Overlay({
      child: fallbackIcon,
      overlays: [drawingArea],
    }),
    setup: (self) => {
      const updateCover = () => {
        // Show cover if player exists and has media, regardless of play state
        if (!player || !player.trackTitle) {
          currentCoverPath = null;
          drawingArea.queue_draw();
          return;
        }

        if (!player.coverPath) {
          currentCoverPath = null;
          drawingArea.queue_draw();
          return;
        }

        const newPath = player.coverPath;
        if (newPath === currentCoverPath) return;

        currentCoverPath = newPath;

        if (newPath.startsWith("http")) {
          Utils.fetch(newPath)
            .then((filePath) => {
              currentCoverPath = filePath;
              drawingArea.queue_draw();
            })
            .catch(() => {
              currentCoverPath = null;
            });
        } else {
          drawingArea.queue_draw();
        }
      };

      if (player) {
        self.hook(player, updateCover, "notify::cover-path");
        self.hook(player, updateCover, "notify::track-title");
        updateCover();
      }
    },
  });
};

const TrackControls = ({ player, ...rest }) => {
  let menu = null;
  let signalIds = [];
  
  const cleanupMenu = () => {
    if (menu) {
      signalIds.forEach(id => {
        try {
          if (menu && id > 0) menu.disconnect(id);
        } catch (e) {
          // Silent cleanup
        }
      });
      signalIds = [];
      
      try {
        menu.destroy();
      } catch (e) {
        // Silent cleanup
      }
      menu = null;
    }
  };
  
  return Widget.Revealer({
    revealChild: true,
    transition: "slide_right",
    transitionDuration: userOptions.asyncGet().animations.durationLarge,
    child: Widget.Box({
      ...rest,
      vpack: "center",
      className: "osd-music-controls spacing-h-3",
      setup: (self) => {
        self.connect('destroy', () => {
          cleanupMenu();
        });
      },
      children: [
        Button({
          className: "osd-music-controlbtn",
          onClicked: () => {
            if (!player || !player.previous) return;
            player.previous();
          },
          child: Label({
            className: "icon-material osd-music-controlbtn-txt",
            label: "skip_previous",
          }),
        }),
        Button({
          className: "osd-music-controlbtn",
          child: Widget.Label({
            className: "icon-material osd-music-controlbtn-txt",
            label: "queue_music",
          }),
          onClicked: (button) => {
            const players = Mpris.players.filter(p => p.busName !== "playerctld");
            if (players.length <= 1) return;

            cleanupMenu();

            menu = Widget.Menu({
              className: "osd-music-player-menu",
              children: players.map(p => Widget.MenuItem({
                child: Widget.Box({
                  spacing: 8,
                  children: [
                    Widget.Label({
                      label: p.name,
                      xalign: 0,
                      hexpand: true,
                    }),
                    p.playBackStatus === "Playing" ? 
                      Widget.Label({
                        className: "icon-material",
                        label: "play_arrow",
                      }) : null,
                  ],
                }),
                onActivate: () => {
                  // Set as last selected player
                  lastSelectedPlayer = p;
                  
                  // Force an update of the widget
                  const window = App.getWindow('music');
                  if (!window) return;
                  
                  const musicBox = window.get_child();
                  if (!musicBox || !musicBox.children) return;
                  
                  // Find the widget that has our update function
                  const findMusicWidget = (widget) => {
                    if (!widget) return null;
                    if (widget.updatePlayer) return widget;
                    if (!widget.children) return null;
                    
                    for (const child of widget.children) {
                      const found = findMusicWidget(child);
                      if (found) return found;
                    }
                    return null;
                  };
                  
                  // Start search from the Box that contains our music widget
                  const container = musicBox.children[1];
                  if (!container) return;
                  
                  const musicWidget = findMusicWidget(container);
                  if (musicWidget && musicWidget.updatePlayer) {
                    musicWidget.updatePlayer(p);
                  }
                },
              })),
            });

            signalIds.push(
              menu.connect('destroy', () => {
                menu = null;
                signalIds = [];
              })
            );

            menu.popup_at_widget(button, Gdk.Gravity.SOUTH, Gdk.Gravity.NORTH, null);
          },
        }),
        Button({
          className: "osd-music-controlbtn",
          child: Widget.Label({
            className: "icon-material osd-music-controlbtn-txt",
            label: "shuffle",
          }),
          setup: function (self) {
            self.hook(Mpris, () => {
              if (!player) return;
              self.toggleClassName("active", player.shuffleStatus);
            });
          },
          onClicked: function () {
            if (!player) return;
            const newState = !player.shuffleStatus;
            Utils.execAsync([
              "playerctl",
              "--player", player.name,
              "shuffle",
              newState ? "On" : "Off",
            ]).catch((err) => console.error("Failed to set shuffle:", err));
            this.toggleClassName("active", newState);
          },
        }),
        Button({
          className: "osd-music-controlbtn",
          child: Widget.Label({
            className: "icon-material osd-music-controlbtn-txt",
            label: "repeat",
          }),
          setup: function (self) {
            self.hook(Mpris, () => {
              if (!player) return;
              const status = player.loopStatus || "None";
              self.child.label =
                status === "None"
                  ? "repeat"
                  : status === "Track"
                  ? "repeat_one"
                  : "repeat";
              self.toggleClassName("active", status !== "None");
            });
          },
          onClicked: function () {
            if (!player) return;
            const currentStatus = player.loopStatus || "None";
            let newStatus;
            switch (currentStatus) {
              case "None":
                newStatus = "Track";
                break;
              case "Track":
                newStatus = "Playlist";
                break;
              default:
                newStatus = "None";
            }

            Utils.execAsync([
              "playerctl",
              "--player", player.name,
              "loop",
              newStatus
            ]).catch((err) =>
              console.error("Failed to set loop status:", err)
            );

            this.child.label =
              newStatus === "None"
                ? "repeat"
                : newStatus === "Track"
                ? "repeat_one"
                : "repeat";
            this.toggleClassName("active", newStatus !== "None");
          },
        }),
        Button({
          className: "osd-music-controlbtn",
          onClicked: () => (player && player.next ? player.next() : null),
          child: Label({
            className: "icon-material osd-music-controlbtn-txt",
            label: "skip_next",
          }),
        }),
      ],
    }),
  });
};

const TrackSource = ({ player, ...rest }) =>
  Widget.Revealer({
    revealChild: true,
    transition: "slide_left",
    transitionDuration: userOptions.asyncGet().animations.durationLarge,
    child: Widget.Box({
      ...rest,
      homogeneous: true,
      children: [
        Label({
          hpack: "start",
          opacity: 0.6,
          css: `margin-top:0.75rem`,
          className: "txt-large onSurfaceVariant",
          setup: (self) => {
            let signalId = null;
            let isDestroyed = false;
            
            const updateLabel = () => {
              if (!isDestroyed) {
                self.label = player ? detectMediaSource(player.trackCoverUrl) : "";
              }
            };
            
            if (player) {
              // Use hook instead of direct connect
              self.hook(player, updateLabel, "notify::cover-path");
              updateLabel(); // Initial update
            } else {
              self.label = "";
            }
            
            // Cleanup on destroy
            self.connect("destroy", () => {
              isDestroyed = true;
              // No need to manually disconnect when using hook
            });
          },
        }),
      ],
    }),
  });

const TrackTime = ({ player, ...rest }) => {
  return Widget.Revealer({
    revealChild: true,
    transition: "slide_left",
    transitionDuration: userOptions.asyncGet().animations.durationLarge,
    child: Widget.Box({
      ...rest,
      vpack: "center",
      className: "osd-music-pill spacing-h-5",
      children: [
        Label({
          setup: (self) => {
            let pollId = null;
            let isDestroyed = false;
            
            const updatePosition = () => {
              if (!isDestroyed && player) {
                self.label = lengthStr(player.position);
              }
              return !isDestroyed;
            };
            
            if (player) {
              pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                if (isDestroyed) {
                  if (pollId) {
                    GLib.Source.remove(pollId);
                    pollId = null;
                  }
                  return GLib.SOURCE_REMOVE;
                }
                return updatePosition();
              });
            } else {
              self.label = "0:00";
            }
            
            // Ensure cleanup happens before GC
            self.connect("destroy", () => {
              isDestroyed = true;
              if (pollId) {
                GLib.Source.remove(pollId);
                pollId = null;
              }
            });
          },
        }),
        Label({ label: "/" }),
        Label({
          setup: (self) => {
            let isDestroyed = false;
            
            const updateLength = () => {
              if (!isDestroyed && player) {
                self.label = lengthStr(player.length);
              }
            };
            
            if (player) {
              // Use hook instead of direct connect
              self.hook(player, updateLength, "notify::length");
              updateLength(); // Initial update
            } else {
              self.label = "0:00";
            }
            
            // Cleanup on destroy
            self.connect("destroy", () => {
              isDestroyed = true;
              // No need to manually disconnect when using hook
            });
          },
        }),
      ],
    }),
  });
};

const PlayState = ({ player }) => {
  const trackCircProg = TrackProgress({ player: player });
  return Widget.Button({
    className: "osd-music-playstate",
    onClicked: () => {
      if (player && player.playPause) {
        player.playPause();
      }
    },
    child: Widget.Overlay({
      child: trackCircProg,
      overlays: [
        Widget.Button({
          className: "osd-music-playstate-btn",
          onClicked: () => {
            if (player && player.playPause) {
              player.playPause();
            }
          },
          child: Widget.Label({
            justification: "center",
            hpack: "fill",
            vpack: "center",
            setup: (self) => {
              let isDestroyed = false;
              
              const updatePlayState = () => {
                if (!isDestroyed) {
                  if (player) {
                    self.label = `${
                      player.playBackStatus == "Playing"
                        ? "pause"
                        : "play_arrow"
                    }`;
                  } else {
                    self.label = "play_arrow";
                  }
                }
              };
              
              if (player) {
                // Use hook instead of direct connect
                self.hook(player, updatePlayState, "notify::play-back-status");
                updatePlayState(); // Initial update
              } else {
                self.label = "play_arrow";
              }
              
              // Cleanup on destroy
              self.connect("destroy", () => {
                isDestroyed = true;
                // No need to manually disconnect when using hook
              });
            },
          }),
        }),
      ],
      passThrough: true,
    }),
  });
};

const CavaVisualizer = () => {
  const bars = Array(50)
    .fill(0)
    .map(() =>
      Widget.Box({
        vertical: true,
        className: "cava-bar-wrapper",
        hpack: "center",
        vpack: "center",
        hexpand: true,
        children: [
          Widget.Box({
            className: "cava-bar cava-bar-low cava-bar-up",
            hpack: "center",
            vpack: "end",
          }),
          Widget.Box({
            className: "cava-bar cava-bar-low cava-bar-down",
            hpack: "center",
            vpack: "start",
          }),
        ],
      })
    );

  let isActive = false;
  let updateTimeout = null;
  let isDestroyed = false;
  
  // Store references to bar elements to avoid GC issues
  const barElements = [];
  
  // Function to safely update a widget property
  const safeUpdate = (widget, property, value) => {
    if (!widget || isDestroyed) return false;
    
    try {
      // Try to access a property to check if widget is valid
      const test = widget.css;
      // If we get here, the widget is likely still valid
      widget[property] = value;
      return true;
    } catch (e) {
      // Widget is likely destroyed
      return false;
    }
  };
  
  // Initialize bar elements array
  const initBars = () => {
    barElements.length = 0; // Clear existing elements
    
    bars.forEach((barWrapper) => {
      if (barWrapper && barWrapper.children && barWrapper.children.length >= 2) {
        barElements.push({
          wrapper: barWrapper,
          upBar: barWrapper.children[0],
          downBar: barWrapper.children[1],
          valid: true
        });
      }
    });
  };
  
  // Call once to initialize
  initBars();

  const updateBars = () => {
    if (!isActive || isDestroyed) return;
    
    // Clear any existing timeout to prevent duplicates
    if (updateTimeout) {
      try {
        GLib.Source.remove(updateTimeout);
        updateTimeout = null;
      } catch (e) {
        // Silent error handling
      }
    }

    try {
      const output = CavaService.output;
      if (!output || typeof output !== "string") {
        // Schedule next update if still active
        if (!isDestroyed && isActive) {
          updateTimeout = Utils.timeout(8, updateBars);
        }
        return;
      }

      const values = output.split("").map((c) => {
        const code = c.charCodeAt(0);
        return code >= 0x30 && code <= 0x39 ? code - 0x30 : 0;
      });

      const step = Math.floor(values.length / barElements.length);
      
      // Update each bar individually
      for (let i = 0; i < barElements.length; i++) {
        if (isDestroyed) break;
        
        const barData = barElements[i];
        if (!barData || !barData.valid) continue;
        
        try {
          const start = i * step;
          const end = start + step;
          const avg = values.slice(start, end).reduce((a, b) => a + b, 0) / step || 0;
          const height = Math.max(1, Math.pow(avg, 1.9) * 4);
          const intensity = avg > 6 ? "high" : avg > 3 ? "med" : "low";
          
          const { upBar, downBar } = barData;
          
          const barCss = `
            min-height: ${height}px;
            min-width: 8px;
            margin: 0 2px;
            transition: all 100ms cubic-bezier(0.4, 0, 0.2, 1);
          `;

          // Update properties safely - use separate calls to avoid chained operations
          let upValid = false;
          let downValid = false;
          
          try {
            // Update CSS first
            upValid = safeUpdate(upBar, "css", barCss);
            if (upValid) {
              // Only try to update class if CSS update succeeded
              upValid = safeUpdate(upBar, "className", `cava-bar cava-bar-${intensity} cava-bar-up`);
            }
          } catch (e) {
            upValid = false;
          }
          
          try {
            // Update CSS first
            downValid = safeUpdate(downBar, "css", barCss);
            if (downValid) {
              // Only try to update class if CSS update succeeded
              downValid = safeUpdate(downBar, "className", `cava-bar cava-bar-${intensity} cava-bar-down`);
            }
          } catch (e) {
            downValid = false;
          }
          
          // Mark as invalid if either widget is no longer valid
          if (!upValid || !downValid) {
            barData.valid = false;
          }
        } catch (err) {
          barData.valid = false;
        }
      }

      // Schedule next update if still active
      if (!isDestroyed && isActive) {
        updateTimeout = Utils.timeout(8, updateBars);
      }
    } catch (e) {
      // Silent error handling
    }
  };

  const startUpdates = () => {
    if (isActive || isDestroyed) return;
    isActive = true;
    CavaService.start();
    updateBars();
  };

  const stopUpdates = () => {
    if (!isActive || isDestroyed) return;
    isActive = false;

    try {
      // Stop the Cava service
      try {
        CavaService.stop();
      } catch (e) {
        // Silent error handling
      }

      // Clear any pending timeout
      if (updateTimeout) {
        try {
          GLib.Source.remove(updateTimeout);
        } catch (e) {
          // Silent error handling
        }
        updateTimeout = null;
      }

      // Reset all bars to their initial state
      for (let i = 0; i < barElements.length; i++) {
        if (isDestroyed) break;
        
        const barData = barElements[i];
        if (!barData || !barData.valid) continue;
        
        try {
          const { upBar, downBar } = barData;
          
          const barCss = `
            min-height: 1px;
            min-width: 8px;
            margin: 0 2px;
          `;
          
          // Update properties safely
          const upValid = safeUpdate(upBar, "css", barCss) && 
                        safeUpdate(upBar, "className", "cava-bar cava-bar-low cava-bar-up");
                        
          const downValid = safeUpdate(downBar, "css", barCss) && 
                          safeUpdate(downBar, "className", "cava-bar cava-bar-low cava-bar-down");
          
          // Mark as invalid if either widget is no longer valid
          if (!upValid || !downValid) {
            barData.valid = false;
          }
        } catch (err) {
          barData.valid = false;
        }
      }
    } catch (e) {
      // Silent error handling
    }
  };

  return Widget.Box({
    className: "cava-visualizer",
    spacing: 0,
    homogeneous: true,
    vexpand: false,
    children: bars,
    setup: (self) => {
      // Start monitoring player status
      const mprisSignalId = self.hook(Mpris, () => {
        const player = getPlayer();
        if (!player || player.playBackStatus !== "Playing") {
          stopUpdates();
          return;
        }
        startUpdates();
      });

      // Monitor window visibility
      let windowSignalId = null;
      Utils.timeout(100, () => {
        if (isDestroyed) return false;
        
        const window = App.getWindow("music");
        if (!window) return false;

        windowSignalId = window.connect("notify::visible", () => {
          if (isDestroyed) return;
          const player = getPlayer();
          if (window.visible && player?.playBackStatus === "Playing") {
            startUpdates();
          } else {
            stopUpdates();
          }
        });

        // Initial check
        if (window.visible) {
          const player = getPlayer();
          if (player?.playBackStatus === "Playing") {
            startUpdates();
          }
        }
        
        return false; // Don't repeat
      });

      // Cleanup - use connect instead of on for more reliable destruction
      self.connect("destroy", () => {
        // Mark as destroyed first to prevent new updates
        isDestroyed = true;
        
        // Stop all updates
        stopUpdates();
        
        // Disconnect window signal if it exists
        if (windowSignalId) {
          const window = App.getWindow("music");
          if (window) {
            try {
              window.disconnect(windowSignalId);
            } catch (e) {
              // Silent error handling
            }
          }
          windowSignalId = null;
        }
        
        // Clear all references to widgets
        for (let i = 0; i < barElements.length; i++) {
          if (barElements[i]) {
            barElements[i].upBar = null;
            barElements[i].downBar = null;
            barElements[i].wrapper = null;
            barElements[i].valid = false;
          }
        }
        
        // Clear any pending timeout immediately
        if (updateTimeout) {
          try {
            GLib.Source.remove(updateTimeout);
          } catch (e) {
            // Silent error handling
          }
          updateTimeout = null;
        }
        
        // Stop cava service
        try {
          CavaService.stop();
        } catch (e) {
          // Silent error handling
        }
        
        // Clear all bar references
        barElements.length = 0;
      });
    },
  });
};

const VolumeControl = () => {
  return Widget.Box({
    className: "osd-music-volume spacing-h-5",
    children: [
      Widget.Label({
        className: "icon-material",
        label: "volume_up",
      }),
      Widget.Slider({
        className: "osd-music-volume-slider",
        hexpand: true,
        drawValue: false,
        onChange: ({ value }) => {
          if (!Audio.speaker) return;
          Audio.speaker.volume = value;
        },
        setup: (self) => {
          if (!Audio.speaker) return;
          
          // Initial value
          self.value = Audio.speaker.volume;
          
          // Update on volume change
          self.hook(Audio, (self) => {
            if (!Audio.speaker) return;
            self.value = Audio.speaker.volume;
          }, 'speaker-changed');
        },
      }),
    ],
  });
};

const PlayerSwitcher = () => {
  return Widget.Box({
    className: "osd-music-player-switcher",
    children: [
      Widget.Button({
        className: "osd-music-player-menu-btn osd-music-controlbtn",
        child: Widget.Label({
          className: "icon-material osd-music-controlbtn-txt",
          label: "queue_music",
        }),
        onClicked: (button) => {
          const players = Mpris.players.filter(p => p.busName !== "playerctld");
          if (players.length <= 1) return;

          const menu = Widget.Menu({
            className: "osd-music-player-menu",
            children: players.map(player => Widget.MenuItem({
              child: Widget.Box({
                spacing: 8,
                children: [
                  Widget.Label({
                    label: player.name,
                    xalign: 0,
                    hexpand: true,
                  }),
                  player.playBackStatus === "Playing" ? 
                    Widget.Label({
                      className: "icon-material",
                      label: "play_arrow",
                    }) : null,
                ],
              }),
              onActivate: () => {
                const window = App.getWindow('music');
                if (!window) return;
                
                const musicBox = window.get_child();
                if (!musicBox || !musicBox.children) return;
                
                // Find the music widget
                const findMusicWidget = (widget) => {
                  if (!widget || !widget.children) return null;
                  for (const child of widget.children) {
                    if (child.updatePlayer) return child;
                    const found = findMusicWidget(child);
                    if (found) return found;
                  }
                  return null;
                };
                
                const musicWidget = findMusicWidget(musicBox);
                if (musicWidget && musicWidget.updatePlayer) {
                  musicWidget.updatePlayer(p);
                }
              },
            })),
          });
          menu.popup_at_widget(button, Gdk.Gravity.SOUTH, Gdk.Gravity.NORTH, null);
        },
      }),
    ],
  });
};

const createContent = (player) =>
  Widget.Box({
    vertical: true,
    children: [
      Box({
        spacing: 10,
        children: [
          Box({
            spacing: 15,
            children: [
              CoverArt({ 
                player: player,
                css: 'min-width: 80px; min-height: 80px;'
              }),
              Box({
                vertical: true,
                vpack: "center",
                children: [
                  TrackTitle({ player: player }),
                  TrackArtists({ player: player }),
                  TrackSource({ player: player }),
                ],
              }),
            ],
          }),
        ],
      }),
      Box({
        className: "cava-container",
        vexpand: true,
        child: userOptions.asyncGet().etc.cava.enabled ? CavaVisualizer() : null,
      }),
      Box({
        className: "spacing-v-5",
        vertical: true,
        children: [
          VolumeControl(),
          Box({
            className: "spacing-h-10",
            children: [
              TrackControls({ player: player }),
              Widget.Box({ hexpand: true }),
              ...(hasPlasmaIntegration ? [TrackTime({ player: player })] : []),
              PlayState({ player: player }),
            ],
          }),
        ],
      }),
    ],
  });

const musicWidget = () => {
  let currentContent = null;
  let currentPlayer = null;
  let signalIds = [];
  
  const widget = Box({
    className: `normal-music ${mode} ${elevate}`,
    css: 'min-height: 180px; margin: 0; border-radius: 12px 12px 0 0;',
    vpack: "end",
    setup: (self) => {
      const updateChildren = (newPlayer) => {
        const player = newPlayer || getPlayer();
        if (!player) return;
        
        // Only update if player changed
        if (currentPlayer?.busName !== player.busName) {
          currentPlayer = player;
          
          // If we don't have content yet, create it
          if (!currentContent) {
            currentContent = createContent(player);
            self.children = [currentContent];
          } else {
            // Update existing content instead of recreating
            const coverArt = currentContent.children[0].children[0].children[0];
            const trackInfo = currentContent.children[0].children[0].children[1];
            const controls = currentContent.children[2].children[1];
            
            // Update cover art
            if (coverArt.updateCover) {
              coverArt.updateCover(player);
            }
            
            // Update track info
            if (trackInfo.children[0].hook) {
              trackInfo.children[0].hook(player, () => {
                trackInfo.children[0].label = player.trackTitle || "No media";
                const fontForThisTrack = getTrackfont(player);
                trackInfo.children[0].css = `font-family: ${fontForThisTrack}, ${DEFAULT_MUSIC_FONT};`;
              }, "notify::track-title");
            }
            
            if (trackInfo.children[1].hook) {
              trackInfo.children[1].hook(player, () => {
                trackInfo.children[1].label = player.trackArtists.join(", ") || "";
              }, "notify::track-artists");
            }
            
            if (trackInfo.children[2].children[0].hook) {
              trackInfo.children[2].children[0].hook(player, () => {
                trackInfo.children[2].children[0].label = detectMediaSource(player.trackCoverUrl);
              }, "notify::cover-path");
            }
            
            // Update controls
            controls.children.forEach(control => {
              if (control.updatePlayer) {
                control.updatePlayer(player);
              }
            });
          }
          
          // Force widget update
          if (self.show_all) self.show_all();
        }
      };

      // Store signal IDs for cleanup
      signalIds = [
        self.hook(Mpris, () => {
          updateChildren();
        }, "notify::players"),
        
        self.hook(Mpris, () => {
          const player = getPlayer();
          updateChildren(player);
        }, "player-changed")
      ];
      
      // Initial update
      updateChildren();

      // Export the update function
      self.updatePlayer = updateChildren;

      // Cleanup on destroy
      self.connect('destroy', () => {
        currentContent = null;
        currentPlayer = null;
        signalIds = [];
      });
    },
  });

  return widget;
};

export default () =>
  PopupWindow({
    keymode: "on-demand",
    anchor: ["bottom"],
    layer: "top",
    name: "music",
    child: Box({
      vertical: true,
      children: [
        clickCloseRegion({
          name: "music",
          multimonitor: false,
          fillMonitor: "vertical",
        }),
        Box({
          vpack: "end",
          children: [
            userOptions.asyncGet().etc.widgetCorners ? RoundedCorner("bottomright", {
              className: "corner corner-amberoled",
              vpack: "end",
            }) : null,
            musicWidget(),
            userOptions.asyncGet().etc.widgetCorners ? RoundedCorner("bottomleft", {
              className: "corner corner-amberoled",
              vpack: "end",
            }) : null,
          ],
        }),
      ],
    }),
  });
