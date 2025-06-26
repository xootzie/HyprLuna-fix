use adw::prelude::*;
use adw::{
    ActionRow, Application, ApplicationWindow, HeaderBar, PreferencesGroup, PreferencesPage,
    ToolbarView, ViewStack, NavigationView, NavigationPage, WindowTitle,
};
use gtk4::{
    glib, Adjustment, Align, Button, Dialog, Entry, FileChooserAction, FileChooserDialog, Grid,
    Label, ListBox, ListBoxRow, ResponseType, ScrolledWindow, SelectionMode, SpinButton, Switch, Widget,
    Orientation, Box as GtkBox,
};
use json_comments::StripComments;
use serde_json::Value;
use std::cell::RefCell;
use std::fs;
use std::rc::Rc;



const APP_ID: &str = "com.github.hyprluna.Settings";

fn main() -> glib::ExitCode {
    let app = Application::builder().application_id(APP_ID).build();

    let config = match load_and_parse_config() {
        Ok(cfg) => Rc::new(RefCell::new(cfg)),
        Err(e) => {
            eprintln!("Error loading config: {}", e);
            return glib::ExitCode::FAILURE;
        }
    };

    app.connect_activate(move |app| {
        build_ui(app, Rc::clone(&config));
    });

    app.run()
}

fn load_and_parse_config() -> Result<Value, Box<dyn std::error::Error>> {
    let path = shellexpand::tilde("~/.ags/config.jsonc").into_owned();
    let content = fs::read_to_string(&path)?;
    let comment_reader = StripComments::new(content.as_bytes());
    let ast: Value = serde_json::from_reader(comment_reader)?;
    Ok(ast)
}

// Add some basic CSS for the sidebar
fn add_css() {
    let provider = gtk4::CssProvider::new();
    provider.load_from_data("
        .sidebar {
            background-color: @theme_bg_color;
            border-right: 1px solid @borders;
            min-width: 220px;
        }
        .sidebar-item {
            padding: 6px 12px;
            transition: background-color 100ms ease-in-out;
        }
        .sidebar-item:hover {
            background-color: alpha(@theme_fg_color, 0.05);
        }
        .sidebar-item:active {
            background-color: alpha(@theme_fg_color, 0.1);
        }
        .sidebar-item .expander {
            opacity: 0.5;
            transition: transform 200ms ease-in-out;
        }
        .sidebar-item .expander:dir(ltr) {
            transform: rotate(0deg);
        }
        .sidebar-item .expander:dir(rtl) {
            transform: rotate(180deg);
        }
        .sidebar-item .expander:checked {
            transform: rotate(90deg);
        }
        .depth-1 { padding-left: 8px; }
        .depth-2 { padding-left: 24px; }
        .depth-3 { padding-left: 40px; }
        .depth-4 { padding-left: 56px; }
    ");
    
    if let Some(display) = gtk4::gdk::Display::default() {
        gtk4::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}

fn build_sidebar_item_with_children(name: &str, value: &Value, depth: usize) -> (ListBoxRow, Option<Vec<(String, Value)>>) {
    let row = ListBoxRow::builder()
        .activatable(true)
        .selectable(true)
        .css_classes(&["sidebar-item", &format!("depth-{}", depth)])
        .build();
    
    let box_ = GtkBox::new(Orientation::Horizontal, 12);
    
    // Add indentation based on depth
    if depth > 0 {
        let indent = GtkBox::new(Orientation::Horizontal, 0);
        indent.set_size_request((depth * 12) as i32, -1);
        box_.append(&indent);
    }
    
    // Add expander if there are children
    let has_children = matches!(value, Value::Object(_) | Value::Array(_));
    let expander = if has_children {
        let expander = gtk4::Image::from_icon_name("pan-end-symbolic");
        expander.set_css_classes(&["expander"]);
        expander
    } else {
        gtk4::Image::new()
    };
    
    box_.append(&expander);
    
    let label = Label::new(Some(name));
    box_.append(&label);
    
    row.set_child(Some(&box_));
    
    // If it's an object or array, collect children
    let children = match value {
        Value::Object(map) => {
            Some(map.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        },
        Value::Array(arr) => {
            Some(arr.iter().enumerate().map(|(i, v)| (i.to_string(), v.clone())).collect())
        },
        _ => None
    };
    
    (row, children)
}

fn build_sidebar(config: &Value, view_stack: &ViewStack) -> (ScrolledWindow, ListBox) {
    let scrolled = ScrolledWindow::new();
    let list_box = ListBox::new();
    list_box.set_selection_mode(SelectionMode::Single);
    
    // Build sidebar items recursively
    fn add_items(
        list_box: &ListBox,
        items: &[(String, Value)],
        view_stack: &ViewStack,
        parent_path: &[String],
        depth: usize
    ) {
        for (key, value) in items {
            let (row, children) = build_sidebar_item_with_children(key, value, depth);
            let key_clone = key.clone();
            let parent_path = parent_path.to_vec();
            let view_stack = view_stack.clone();
            
            // Connect activation
            row.connect_activate(glib::clone!(@weak list_box => move |row| {
                let mut path = parent_path.clone();
                path.push(key_clone.clone());
                let page_name = path.join(".");
                
                // Toggle expander
                if let Some(box_) = row.child().and_then(|w| w.downcast::<GtkBox>().ok()) {
                    if let Some(expander) = box_.first_child().and_then(|w| w.downcast::<gtk4::Image>().ok()) {
                        if expander.icon_name() == Some("pan-end-symbolic") {
                            expander.set_icon_name(Some("pan-down-symbolic"));
                        } else {
                            expander.set_icon_name(Some("pan-end-symbolic"));
                        }
                    }
                }
                
                // Show the page
                if view_stack.child_by_name(&page_name).is_none() {
                    let page = build_settings_page(
                        Rc::new(RefCell::new(Value::Object(serde_json::Map::new()))), // Dummy config
                        view_stack,
                        Some(path.clone())
                    );
                    view_stack.add_titled(&page, Some(&page_name), &key_clone);
                }
                view_stack.set_visible_child_name(&page_name);
            }));
            
            list_box.append(&row);
            
            // Recursively add children if they exist
            if let Some(children) = children {
                let mut new_path = parent_path.to_vec();
                new_path.push(key.clone());
                add_items(list_box, &children, view_stack, &new_path, depth + 1);
            }
        }
    }
    
    // Add root items
    if let Value::Object(map) = config {
        let items: Vec<_> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        add_items(&list_box, &items, view_stack, &[], 0);
    }
    
    scrolled.set_child(Some(&list_box));
    scrolled.add_css_class("sidebar");
    (scrolled, list_box)
}

fn build_ui(app: &Application, config: Rc<RefCell<Value>>) {
    let window = ApplicationWindow::builder()
        .application(app)
        .default_width(1000)
        .default_height(700)
        .title("Hyprluna Settings")
        .build();

    // Create main container with sidebar and content
    let main_box = GtkBox::new(Orientation::Horizontal, 0);
    
    // Create the view stack for content
    let view_stack = ViewStack::new();
    
    // Create the sidebar
    let (sidebar_scrolled, _) = build_sidebar(&*config.borrow(), &view_stack);
    
    // Create content area
    let content_box = GtkBox::new(Orientation::Vertical, 0);
    
    // Add header bar
    let header_bar = HeaderBar::new();
    
    // Add window controls to header
    let window_controls = gtk4::WindowControls::new(gtk4::PackType::End);
    header_bar.pack_end(&window_controls);
    
    // Add import/export buttons
    let import_button = Button::with_label("Import");
    let export_button = Button::with_label("Export");
    let save_button = Button::with_label("Save");
    save_button.add_css_class("suggested-action");
    
    header_bar.pack_start(&import_button);
    header_bar.pack_start(&export_button);
    header_bar.pack_end(&save_button);
    
    // Add header bar to content
    content_box.append(&header_bar);
    
    // Add view stack to content
    let content_scrolled = ScrolledWindow::new();
    content_scrolled.set_child(Some(&view_stack));
    content_scrolled.set_hexpand(true);
    content_scrolled.set_vexpand(true);
    content_box.append(&content_scrolled);
    
    // Add sidebar and content to main box
    main_box.append(&sidebar_scrolled);
    main_box.append(&content_box);
    
    // Set up toast overlay
    let toast_overlay = adw::ToastOverlay::new();
    toast_overlay.set_child(Some(&main_box));
    
    // Set window content
    window.set_content(Some(&toast_overlay));

    // --- Connect Signals ---
    
    // Add the main settings page
    let main_page = build_settings_page(Rc::clone(&config), &view_stack, None);
    view_stack.add_titled(&main_page, Some("main"), "Settings");
    
    // Initially show the main page
    view_stack.set_visible_child_name("main");

    // Save Action
    let config_for_save = Rc::clone(&config);
    let toast_overlay_for_save = toast_overlay.clone();
    save_button.connect_clicked(move |_| {
        let config_path = shellexpand::tilde("~/.ags/config.jsonc").to_string();
        match fs::write(&config_path, serde_json::to_string_pretty(&*config_for_save.borrow()).unwrap()) {
            Ok(_) => {
                toast_overlay_for_save.add_toast(adw::Toast::new("Config saved successfully!"));
            }
            Err(e) => {
                toast_overlay_for_save.add_toast(adw::Toast::new(&format!("Failed to save: {}", e)));
            }
        }
    });

    // Import Action
    let window_for_import = window.clone();
    let config_for_import = Rc::clone(&config);
    let toast_overlay_for_import = toast_overlay.clone();
    let view_stack_for_import = view_stack.clone();
    import_button.connect_clicked(move |_| {
        let dialog = FileChooserDialog::new(
            Some("Import Config"),
            Some(&window_for_import),
            FileChooserAction::Open,
            &[("Cancel", ResponseType::Cancel), ("Import", ResponseType::Accept)],
        );
        let config_clone = Rc::clone(&config_for_import);
        let toast_clone = toast_overlay_for_import.clone();
        let view_stack_clone = view_stack_for_import.clone();
        dialog.connect_response(move |d, response| {
            if response == ResponseType::Accept {
                if let Some(file) = d.file() {
                    if let Some(path) = file.path() {
                        match fs::read_to_string(&path) {
                            Ok(content) => {
                                let comment_reader = StripComments::new(content.as_bytes());
                                match serde_json::from_reader(comment_reader) {
                                    Ok(new_config) => {
                                        *config_clone.borrow_mut() = new_config;
                                        while let Some(child) = view_stack_clone.pages().item(0) {
                                            if let Ok(widget) = child.downcast::<Widget>() {
                                                view_stack_clone.remove(&widget);
                                            }
                                        }
                                        let main_page = build_settings_page(Rc::clone(&config_clone), &view_stack_clone, None);
                                        view_stack_clone.add_titled(&main_page, Some("main"), "Hyprluna Settings");
                                        toast_clone.add_toast(adw::Toast::new("Imported successfully!"));
                                    }
                                    Err(e) => {
                                        toast_clone.add_toast(adw::Toast::new(&format!("Failed to parse config: {}", e)));
                                    }
                                }
                            }
                            Err(e) => {
                                toast_clone.add_toast(adw::Toast::new(&format!("Failed to read file: {}", e)));
                            }
                        }
                    }
                }
            }
            d.close();
        });
        dialog.show();
    });

    // Export Action - Copy ~/.ags/config.jsonc to selected location
    let window_for_export = window.clone();
    let toast_overlay_for_export = toast_overlay.clone();
    
    export_button.connect_clicked(move |_| {
        let dialog = FileChooserDialog::new(
            Some("Export Config"),
            Some(&window_for_export),
            FileChooserAction::Save,
            &[("Cancel", ResponseType::Cancel), ("Export", ResponseType::Accept)],
        );
        
        // Set default filename and add .jsonc extension if not present
        dialog.set_current_name("config.jsonc");
        
        let toast_clone = toast_overlay_for_export.clone();
        
        dialog.connect_response(move |d, response| {
            if response == ResponseType::Accept {
                if let Some(file) = d.file() {
                    if let Some(dest_path) = file.path() {
                        let src_path = shellexpand::tilde("~/.ags/config.jsonc").into_owned();
                        
                        // Ensure the destination has .jsonc extension
                        let dest_path = if dest_path.extension().is_none() {
                            dest_path.with_extension("jsonc")
                        } else {
                            dest_path.to_path_buf()
                        };
                        
                        match fs::copy(&src_path, &dest_path) {
                            Ok(_) => {
                                toast_clone.add_toast(adw::Toast::new(&format!("Config exported to {}", dest_path.display())));
                            }
                            Err(e) => {
                                toast_clone.add_toast(adw::Toast::new(&format!("Failed to export config: {}", e)));
                            }
                        }
                    }
                }
            }
            d.close();
        });
        dialog.show();
    });

    // --- Initial Page Build ---
    let main_page = build_settings_page(Rc::clone(&config), &view_stack, None);
    view_stack.add_titled(&main_page, Some("main"), "Hyprluna Settings");

    window.present();
}

fn build_settings_page(
    config: Rc<RefCell<Value>>,
    view_stack: &ViewStack,
    path: Option<Vec<String>>,
) -> PreferencesPage {
    let page = PreferencesPage::new();
    let group = PreferencesGroup::new();
    page.add(&group);

    let target_value = {
        let config_borrow = config.borrow();
        path.as_ref().map_or(&*config_borrow, |p| {
            p.iter().try_fold(&*config_borrow, |v, k| {
                if v.is_object() {
                    v.get(k)
                } else if v.is_array() {
                    k.parse::<usize>().ok().and_then(|idx| v.get(idx))
                } else {
                    None
                }
            }).unwrap_or(&Value::Null)
        }).clone()
    };

    let process_value = |key: String, value: Value, current_path: Vec<String>| {
        let mut row = ActionRow::builder().title(&key).build();

        match value {
            Value::Bool(val) => {
                let switch = Switch::builder().valign(Align::Center).active(val).build();
                row.add_suffix(&switch);
                row.set_activatable_widget(Some(&switch));
                let config_clone = Rc::clone(&config);
                let mut p = current_path.clone();
                p.push(key.clone());
                switch.connect_state_set(move |_, new_val| {
                    let mut config_mut = config_clone.borrow_mut();
                    let mut v = &mut *config_mut;
                    for k in &p[..p.len() - 1] {
                        v = if v.is_object() { v.get_mut(k).unwrap() } else { v.get_mut(k.parse::<usize>().unwrap()).unwrap() };
                    }
                    let final_key = p.last().unwrap();
                    if let Some(obj_mut) = v.as_object_mut() {
                        obj_mut.insert(final_key.clone(), Value::Bool(new_val));
                    } else if let Some(arr_mut) = v.as_array_mut() {
                        if let Ok(idx) = final_key.parse::<usize>() {
                            if let Some(elem) = arr_mut.get_mut(idx) { *elem = Value::Bool(new_val); }
                        }
                    }
                    glib::Propagation::Proceed
                });
            }
            Value::String(val) => {
                let entry = Entry::builder().valign(Align::Center).text(val).build();
                row.add_suffix(&entry);
                let config_clone = Rc::clone(&config);
                let mut p = current_path.clone();
                p.push(key.clone());
                entry.connect_changed(move |entry| {
                    let new_text = entry.text();
                    let mut config_mut = config_clone.borrow_mut();
                    let mut v = &mut *config_mut;
                    for k in &p[..p.len() - 1] {
                        v = if v.is_object() { v.get_mut(k).unwrap() } else { v.get_mut(k.parse::<usize>().unwrap()).unwrap() };
                    }
                    let final_key = p.last().unwrap();
                    if let Some(obj_mut) = v.as_object_mut() {
                        obj_mut.insert(final_key.clone(), Value::String(new_text.to_string()));
                    } else if let Some(arr_mut) = v.as_array_mut() {
                        if let Ok(idx) = final_key.parse::<usize>() {
                            if let Some(elem) = arr_mut.get_mut(idx) { *elem = Value::String(new_text.to_string()); }
                        }
                    }
                });
            }
            Value::Number(n) => {
                let adj = Adjustment::new(n.as_f64().unwrap_or(0.0), -1_000_000.0, 1_000_000.0, 1.0, 10.0, 0.0);
                let spin = SpinButton::new(Some(&adj), 1.0, 2);
                spin.set_valign(Align::Center);
                row.add_suffix(&spin);
                let config_clone = Rc::clone(&config);
                let mut p = current_path.clone();
                p.push(key.clone());
                spin.connect_value_changed(move |spin| {
                    let new_val = spin.value();
                    let mut config_mut = config_clone.borrow_mut();
                    let mut v = &mut *config_mut;
                    for k in &p[..p.len() - 1] {
                        v = if v.is_object() { v.get_mut(k).unwrap() } else { v.get_mut(k.parse::<usize>().unwrap()).unwrap() };
                    }
                    let final_key = p.last().unwrap();
                    if let Some(obj_mut) = v.as_object_mut() {
                        if let Some(num) = serde_json::Number::from_f64(new_val) {
                            obj_mut.insert(final_key.clone(), Value::Number(num));
                        }
                    } else if let Some(arr_mut) = v.as_array_mut() {
                        if let Ok(idx) = final_key.parse::<usize>() {
                            if let Some(elem) = arr_mut.get_mut(idx) {
                                if let Some(num) = serde_json::Number::from_f64(new_val) { *elem = Value::Number(num); }
                            }
                        }
                    }
                });
            }
            Value::Object(_) | Value::Array(_) => {
                row.set_activatable(true);
                row.add_css_class("nav-row");
                let config_clone = Rc::clone(&config);
                let view_stack_clone = view_stack.clone();
                let mut new_path = current_path.clone();
                new_path.push(key.clone());
                row.connect_activated(move |_| {
                    let sub_page = build_settings_page(Rc::clone(&config_clone), &view_stack_clone, Some(new_path.clone()));
                    let page_name = new_path.join(".");
                    view_stack_clone.add_titled(&sub_page, Some(&page_name), &key);
                    view_stack_clone.set_visible_child_name(&page_name);
                });
            }
            other => {
                let type_str = if other.is_null() { "Null" } else { "Unsupported" };
                row = ActionRow::builder()
                    .title(&key)
                    .subtitle(format!("Unsupported type: {}", type_str))
                    .build();
            }
        }
        group.add(&row);
    };

    if let Some(obj) = target_value.as_object() {
        let mut keys: Vec<String> = obj.keys().cloned().collect();
        keys.sort();
        for key in keys {
            if key == "__custom" { continue; }
            let value = obj.get(&key).unwrap().clone();
            process_value(key, value, path.clone().unwrap_or_default());
        }
    } else if let Some(arr) = target_value.as_array() {
        for (i, value) in arr.iter().enumerate() {
            process_value(i.to_string(), value.clone(), path.clone().unwrap_or_default());
        }
    }

    // Handle custom pages
    if let Some(p) = &path {
        if p.len() > 0 {
            let parent_path = &p[..p.len()-1];
            let current_key = p.last().unwrap();

            let parent_value = {
                let config_borrow = config.borrow();
                parent_path.iter().try_fold(&*config_borrow, |v, k| {
                    if v.is_object() { v.get(k) } else { k.parse::<usize>().ok().and_then(|idx| v.get(idx)) }
                }).unwrap_or(&Value::Null).clone()
            };

            if let Some(parent_obj) = parent_value.as_object() {
                if let Some(Value::Array(custom_keys)) = parent_obj.get("__custom") {
                    if custom_keys.iter().any(|v| v.as_str() == Some(current_key)) {
                        let add_button_group = PreferencesGroup::builder().title("Actions").build();
                        let add_button = Button::from_icon_name("list-add-symbolic");
                        add_button_group.add(&add_button);
                        page.add(&add_button_group);

                        let config_clone = Rc::clone(&config);
                        let view_stack_clone = view_stack.clone();
                        let path_clone = path.clone().unwrap();
                        let group_clone = group.clone();

                        add_button.connect_clicked(move |btn| {
                            show_add_model_dialog(
                                btn.native().unwrap().downcast_ref::<ApplicationWindow>().unwrap(),
                                Rc::clone(&config_clone),
                                &view_stack_clone,
                                &path_clone,
                                &group_clone,
                            );
                        });
                    }
                }
            }
        }
    }

    page
}

fn show_add_model_dialog(
    window: &ApplicationWindow,
    config: Rc<RefCell<Value>>,
    view_stack: &ViewStack,
    path: &Vec<String>,
    _group: &PreferencesGroup, // Not used directly, but kept for context
) {
    let dialog = Dialog::builder()
        .transient_for(window)
        .modal(true)
        .title("Add New GPT Model")
        .build();

    dialog.add_button("Cancel", ResponseType::Cancel);
    dialog.add_button("Add", ResponseType::Accept);
    dialog.set_default_response(ResponseType::Accept);

    let content_area = dialog.content_area();
    let grid = Grid::builder()
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .row_spacing(6)
        .column_spacing(6)
        .build();
    content_area.append(&grid);

    let fields = [
        ("id", "Model ID"),
        ("name", "Name"),
        ("logoName", "Logo Name"),
        ("description", "Description"),
        ("baseUrl", "Base URL"),
        ("keyUrl", "Key URL"),
        ("keyFile", "Key File"),
        ("model", "Model String"),
    ];

    let mut entries = Vec::new();
    for (i, (id, label_text)) in fields.iter().enumerate() {
                let label = Label::builder().label(*label_text).halign(Align::Start).build();
        let entry = Entry::new();
        grid.attach(&label, 0, i as i32, 1, 1);
        grid.attach(&entry, 1, i as i32, 1, 1);
        entries.push((id.to_string(), entry));
    }

    let config_clone = Rc::clone(&config);
    let view_stack_clone = view_stack.clone();
    let path_clone = path.clone();

    dialog.connect_response(move |d, response| {
        if response == ResponseType::Accept {
            let mut new_model_map = serde_json::Map::new();
            for (id, entry) in &entries {
                new_model_map.insert(id.clone(), Value::String(entry.text().to_string()));
            }
            let new_model = Value::Object(new_model_map);

            {
                let mut config_mut = config_clone.borrow_mut();
                let mut target_value = &mut *config_mut;
                for key in &path_clone {
                    target_value = if target_value.is_object() {
                        target_value.get_mut(key).unwrap()
                    } else {
                        target_value.get_mut(key.parse::<usize>().unwrap()).unwrap()
                    };
                }
                if let Some(array) = target_value.as_array_mut() {
                    array.push(new_model);
                }
            }

            // Refresh the view by replacing the page
            let page_name = path_clone.join(".");
            if let Some(child) = view_stack_clone.child_by_name(&page_name) {
                view_stack_clone.remove(&child);
            }
            let new_page = build_settings_page(Rc::clone(&config_clone), &view_stack_clone, Some(path_clone.clone()));
            let title = path_clone.last().cloned().unwrap_or_default();
            view_stack_clone.add_titled(&new_page, Some(&page_name), &title);
            view_stack_clone.set_visible_child_name(&page_name);
        }
        d.destroy();
    });

    dialog.present();
}
