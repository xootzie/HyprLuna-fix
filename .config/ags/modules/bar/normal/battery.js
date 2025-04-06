import Widget from "resource:///com/github/Aylur/ags/widget.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";
import Battery from "resource:///com/github/Aylur/ags/service/battery.js";
import { MaterialIcon } from "../../.commonwidgets/materialicon.js";
import { AnimatedCircProg } from "../../.commonwidgets/cairo_circularprogress.js";
const { Box, Label, Button, Overlay, Revealer, Stack, EventBox } = Widget;
const { execAsync } = Utils;
const { GLib } = imports.gi;

const options = userOptions.asyncGet();

// Limited size cache with improved memory usage
const batteryProgressCache = new Map();
const MAX_CACHE_SIZE = 10; // Limit cache size to prevent memory bloat

const BarBatteryProgress = () => {
  const _updateProgress = (circprog) => {
    // Check if battery is available
    if (!Battery?.available) {
      if (circprog._lastValue !== 0) {
        circprog.css = `font-size: 0px;`;
        circprog._lastValue = 0;
      }
      return;
    }
    
    // Ensure the percent value is valid and non-negative
    const percent = Math.max(0, Battery.percent);
    const key = `${percent}-${Battery.charged}-${Battery.charging}`;

    // Only update if value changed
    if (circprog._lastKey !== key) {
      if (!batteryProgressCache.has(key)) {
        // Limit cache size to prevent memory bloat
        if (batteryProgressCache.size >= MAX_CACHE_SIZE) {
          // Delete oldest entry (first key)
          const firstKey = batteryProgressCache.keys().next().value;
          batteryProgressCache.delete(firstKey);
        }
        
        const css = `font-size: ${percent}px;`;
        batteryProgressCache.set(key, css);
      }

      circprog.css = batteryProgressCache.get(key);
      circprog._lastKey = key;
      
      const lowBattery = percent <= options.battery.low;
      if (circprog._lastLow !== lowBattery) {
        circprog.toggleClassName("bar-batt-circprog-low", lowBattery);
        circprog._lastLow = lowBattery;
      }
      
      if (circprog._lastCharged !== Battery.charged) {
        circprog.toggleClassName("bar-batt-circprog-full", Battery.charged);
        circprog._lastCharged = Battery.charged;
      }
      
      if (circprog._lastCharging !== Battery.charging) {
        circprog.toggleClassName("bar-batt-charging", Battery.charging);
        circprog._lastCharging = Battery.charging;
      }
    }
  };

  return AnimatedCircProg({
    className: "bar-batt-circprog",
    vpack: "center",
    hpack: "center",
    extraSetup: (self) => {
      self._lastKey = "";
      self._lastValue = -1;
      self._lastLow = null;
      self._lastCharged = null;
      self._lastCharging = null;
      self._batteryHandler = Battery.connect("changed", () => _updateProgress(self));
      
      // Make sure to safely disconnect when destroyed
      self.connect("destroy", () => {
        if (self._batteryHandler) {
          if (globalThis.safeDisconnect) {
            globalThis.safeDisconnect(Battery, self._batteryHandler);
          } else {
            try {
              Battery.disconnect(self._batteryHandler);
            } catch (e) {
              console.log("Failed to disconnect battery handler:", e);
            }
          }
          self._batteryHandler = 0;
        }
      });
      
      // Initial update
      _updateProgress(self);
    },
  });
};

const BarBattery = () => {
  let isRevealed = false;

  // Create Revealer only once
  const percentageRevealer = Revealer({
    transitionDuration: options.animations.durationLarge,
    transition: "slide_right",
    revealChild: false, // Initially hidden
    child: Label({
      className: "bar-batt-percent",
      css: "margin-left: 8px;",
      setup: (self) => {
        self._lastValue = "";
        
        self.hook(Battery, () => {
          // Check if battery is available
          if (!Battery?.available) {
            if (self._lastValue !== "No battery") {
              self.label = "No battery";
              self._lastValue = "No battery";
            }
            return;
          }
          
          const newValue = `${Battery.percent}% ${Battery.charging ? "" : " "}`;
          if (self._lastValue !== newValue) {
            self.label = newValue;
            self._lastValue = newValue;
          }
        });
      },
    }),
  });

  const handleScroll = (direction) => {
    execAsync(`brightnessctl set ${direction > 0 ? "10%+" : "10%-"}`);
  };

  return Box({
    className: "spacing-h-10 bar-batt-txt",
    children: [
      EventBox({
        onScrollUp: () => handleScroll(1), // Increase brightness
        onScrollDown: () => handleScroll(-1), // Decrease brightness
        onPrimaryClick: () => {
          isRevealed = !isRevealed;
          percentageRevealer.revealChild = isRevealed;
        },
        child: Box({
          className: "bar-batt-container",
          children: [
            Overlay({
              child: Box({
                vpack: "center",
                className: "bar-batt",
                homogeneous: true,
                children: [MaterialIcon("", "large")],
                setup: (self) => {
                  self._lastLow = null;
                  self._lastCharged = null;
                  self._lastCharging = null;
                  
                  self.hook(Battery, (box) => {
                    // Check if battery is available
                    if (!Battery?.available) {
                      if (self._lastLow !== false) {
                        box.removeClass("bar-batt-low");
                        box.removeClass("bar-batt-full");
                        box.removeClass("bar-batt-charging");
                        self._lastLow = false;
                        self._lastCharged = false;
                        self._lastCharging = false;
                      }
                      return;
                    }
                    
                    const lowBattery = Battery.percent <= userOptions.asyncGet().battery.low;
                    if (self._lastLow !== lowBattery) {
                      box.toggleClassName("bar-batt-low", lowBattery);
                      self._lastLow = lowBattery;
                    }
                    
                    if (self._lastCharged !== Battery.charged) {
                      box.toggleClassName("bar-batt-full", Battery.charged);
                      self._lastCharged = Battery.charged;
                    }
                    
                    if (self._lastCharging !== Battery.charging) {
                      box.toggleClassName("bar-batt-charging", Battery.charging);
                      self._lastCharging = Battery.charging;
                    }
                  });
                },
              }),
              overlays: [BarBatteryProgress()],
            }),
          ],
        }),
      }),
      percentageRevealer, // Revealer added only once
    ],
  });
};

// Only create this module once, not on every render
const cachedBatteryModule = Box({
  className: "spacing-h-4",
  children: [
    Stack({
      transition: "slide_up_down",
      transitionDuration: userOptions.asyncGet().animations.durationLarge,
      children: {
        laptop: BarBattery(),
        hidden: Widget.Box({}),
      },
      setup: (stack) => {
        const updateVisibility = () => {
          if (globalThis.devMode?.value || Battery?.available) {
            stack.shown = "laptop";
          } else {
            stack.shown = "hidden";
          }
        };
        
        // React to dev mode changes
        if (globalThis.devMode) {
          stack.hook(globalThis.devMode, updateVisibility);
        }
        
        // React to battery availability changes
        stack.hook(Battery, updateVisibility);
        
        // Initial state
        updateVisibility();
      },
    }),
  ],
});

// Export a function that returns the cached module to prevent recreation
export default () => EventBox({
  onScrollUp: () => execAsync(`brightnessctl set 10%+`),
  onScrollDown: () => execAsync(`brightnessctl set 10%-`),
  child: Widget.Box({
    children: [cachedBatteryModule],
  }),
});
