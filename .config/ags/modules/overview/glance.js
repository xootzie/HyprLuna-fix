import Widget from "resource:///com/github/Aylur/ags/widget.js";
import PopupWindow from "../.widgethacks/popupwindow.js";
import OptionalOverview from "./overview_hyprland.js";
import clickCloseRegion from "../.commonwidgets/clickcloseregion.js";
import Hyprland from "resource:///com/github/Aylur/ags/service/hyprland.js";
import App from "resource:///com/github/Aylur/ags/app.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";

export default (id = "") => {
  // Create the window
  const win = PopupWindow({
    name: `glance`,
    keymode: "on-demand",
    anchor: ["top", "left", "right"],
    child: Widget.Box({
      vertical: true,
      vexpand: true,
      children: [
        OptionalOverview(),
        userOptions.asyncGet().etc.clickCloseRegion
          ? clickCloseRegion({
              name: "glance",
              multimonitor: false,
              fillMonitor: "horizontal",
            })
          : null,
      ],
      setup: (self) => {
        // Add key bindings for Alt+Tab behavior
        self.keybind("Tab", () => {
          // Focus next window when Tab is pressed
          Hyprland.messageAsync("dispatch cyclenext").catch(console.error);

          // Update the overview to reflect the new focus
          Utils.timeout(50, () => {
            const overviewTick = globalThis.overviewTick;
            if (overviewTick) overviewTick.setValue(!overviewTick.value);
          });
        });

        self.keybind("ISO_Left_Tab", () => {
          // Focus previous window when Shift+Tab is pressed
          Hyprland.messageAsync("dispatch cycleprev").catch(console.error);

          // Update the overview to reflect the new focus
          Utils.timeout(50, () => {
            const overviewTick = globalThis.overviewTick;
            if (overviewTick) overviewTick.setValue(!overviewTick.value);
          });
        });

        // Close the window when Alt is released (simulating Alt+Tab behavior)
        self.keybind(
          "Alt_L",
          () => {
            App.closeWindow("glance");
          },
          "release"
        );

        self.keybind(
          "Alt_R",
          () => {
            App.closeWindow("glance");
          },
          "release"
        );
      },
    }),
  });

  return win;
};
