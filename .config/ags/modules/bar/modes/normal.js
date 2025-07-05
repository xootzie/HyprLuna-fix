import Widget from "resource:///com/github/Aylur/ags/widget.js";
import WindowTitle from "../normal/spaceleft.js";
import Music from "../normal/mixed.js";
import System from "../normal/system.js";
import Indicators from "../normal/spaceright.js";
import { SideModule } from "./../../.commonwidgets/sidemodule.js";
import NormalOptionalWorkspaces from "../normal/workspaces_hyprland.js";
import ScrolledModule from "../../.commonwidgets/scrolledmodule.js";
import PinnedApps from "../modules/pinned_apps.js";
import kb_layout from "../modules/kb_layout.js";
import { BarGroup } from "../../.commonwidgets/bargroup.js";
import { RoundedCorner } from "../../.commonwidgets/cairo_roundedcorner.js";
const opts = userOptions.asyncGet();
const workspaces = opts.bar.elements.showWorkspaces;
const indicators = opts.bar.elements.showIndicators;

export const NormalBar = Widget.CenterBox({
    // className: "shadow-window",
    startWidget: Widget.CenterBox({
        startWidget: Widget.CenterBox({
            hexpand: true,
            vexpand: true,
            centerWidget: RoundedCorner("topleft", { className: "corner" }),
            startWidget: Widget.Box({
                css: `border-radius: 0 0 15px 0; min-width: 200px; padding-left: 20px;`,
                className: "bar-bg",
                children: [
                    ...(userOptions.asyncGet().bar.elements.showWindowTitle
                        ? [await WindowTitle()]
                        : []),
                ],
            }),
        }),
    }),

    centerWidget: Widget.CenterBox({
        css: `margin-left: 10rem; margin-right: 10rem;`,
        spacing: 12,
        startWidget: Widget.CenterBox({
            startWidget: Widget.Box({
                className: "bar-bg",
                css: `border-radius: 15px 0 15px 15px; padding: 0 4px;`,
                child: SideModule([Music()]),
            }),
            endWidget: RoundedCorner("topleft", { className: "corner" }),
        }),

        centerWidget: Widget.Box({
            vertical: true,
            css: `padding-top: 0.1rem;`,
            children: [
                ScrolledModule({
                    hexpand: true,
                    css: `border-radius: 15px 15px 15px 15px;`,
                    className: "bar-bg",
                    children: [
                        Widget.Box({
                            hexpand: true,
                            className: "bar-group bar-group-standalone",
                            css: `padding:0 12px; margin: 4px 5px`,
                            children: [
                                ...(workspaces
                                    ? [NormalOptionalWorkspaces()]
                                    : []),
                            ],
                        }),
                        BarGroup({ child: PinnedApps() }),
                    ],
                }),
            ],
        }),

        endWidget: Widget.CenterBox({
            startWidget: RoundedCorner("topright", { className: "corner" }),
            endWidget: Widget.Box({
                className: "bar-bg",
                css: `border-radius: 0 15px 15px 15px; padding: 0 4px;`,
                child: SideModule([System()]),
            }),
        }),
    }),

    endWidget: Widget.CenterBox({
        endWidget: Widget.CenterBox({
            centerWidget: RoundedCorner("topright", { className: "corner" }),
            endWidget: Widget.Box({
                css: `border-radius: 0 0 0 15px`,
                className: "bar-bg",
                children: [...(indicators ? [Indicators()] : [])],
            }),
        }),
    }),
});
