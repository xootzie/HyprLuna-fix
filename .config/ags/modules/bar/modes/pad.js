import Widget from 'resource:///com/github/Aylur/ags/widget.js';

/*
* To achieve the macOS-style bar, you will need to add some CSS.
* You can add the following to your style.css file:
*
* .bar {
*   background-color: rgba(0, 0, 0, 0.8);
*   color: white;
*   padding: 0px 8px;
*   border-radius: 15px;
*   margin: 5px;
* }
*
* .bar-left, .bar-center, .bar-right {
*   padding: 0px 8px;
* }
*
*/
export const PadBar = Widget.CenterBox({
    class_name: 'bar', // Use 'bar' class for styling
    start_widget: Widget.Box({
        class_name: 'bar-left',
        hpack: 'start',
        children: [
            Widget.Label({ label: 'Module 1' }),
            Widget.Label({ label: 'Module 2' }),
        ],
    }),
    center_widget: Widget.Box({
        class_name: 'bar-center',
        hpack: 'center',
        children: [
            Widget.Label({ label: 'Module 3' }),
        ],
    }),
    end_widget: Widget.Box({
        class_name: 'bar-right',
        hpack: 'end',
        children: [
            Widget.Label({ label: 'Module 4' }),
            Widget.Label({ label: 'Module 5' }),
        ],
    }),
});
