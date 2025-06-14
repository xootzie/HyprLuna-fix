use anyhow::{Context, Result};
use clap::Args;
use regex::Regex;
use serde::Serialize;
use std::path::PathBuf;

const TITLE_REGEX: &str = r"#+!";
const HIDE_COMMENT: &str = "[hidden]";
const COMMENT_BIND_PATTERN: &str = "#/#";

#[derive(Debug, Serialize, Clone)]
pub struct KeyBinding {
    pub mods: Vec<String>,
    pub key: String,
    pub dispatcher: String,
    pub params: String,
    pub comment: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Section {
    pub children: Vec<Section>,
    pub keybinds: Vec<KeyBinding>,
    pub name: String,
}

impl Section {
    pub fn new(name: &str) -> Self {
        Section {
            children: Vec::new(),
            keybinds: Vec::new(),
            name: name.to_string(),
        }
    }
}

/// Command line arguments for get-keybinds command
#[derive(Args, Debug)]
pub struct GetKeybindsArgs {
    /// Path to the keybinds configuration file
    #[arg(short, long, default_value = "/home/samouly/.config/hypr/hyprland/keybinds/default.conf")]
    /// Path to the keybinds configuration file
    #[arg(short, long, default_value = "$HOME/.config/hypr/hyprland.conf")]
    path: String,
}

fn expand_path(path: &str) -> PathBuf {
    let expanded = shellexpand::full(path).unwrap_or_else(|_| path.into());
    PathBuf::from(expanded.as_ref())
}

fn read_content(path: &str) -> Result<Vec<String>> {
    let expanded_path = expand_path(path);
    if !expanded_path.exists() {
        return Err(anyhow::anyhow!("File not found: {}", expanded_path.display()));
    }
    
    let content = std::fs::read_to_string(&expanded_path)
        .with_context(|| format!("Failed to read file: {}", expanded_path.display()))?;
    
    Ok(content.lines().map(String::from).collect())
}

fn autogenerate_comment(dispatcher: &str, params: &str) -> String {
    match dispatcher.to_lowercase().as_str() {
        "resizewindow" => "Resize window".to_string(),
        "movewindow" => "Move window".to_string(),
        "togglefloating" => "Toggle floating".to_string(),
        "fullscreen" => "Toggle fullscreen".to_string(),
        "workspace" => format!("Switch to workspace {}", params.split_whitespace().next().unwrap_or("")),
        "movetoworkspace" => format!("Move to workspace {}", params.split_whitespace().next().unwrap_or("")),
        "exec" => {
            let cmd = params.split_whitespace().next().unwrap_or("");
            if cmd.contains("rofi") {
                if cmd.contains("drun") {
                    "Open application launcher".to_string()
                } else if cmd.contains("emoji") {
                    "Open emoji picker".to_string()
                } else {
                    format!("Run: {}", cmd)
                }
            } else {
                format!("Run: {}", cmd)
            }
        },
        _ => format!("{} {}", dispatcher, params).trim().to_string(),
    }
}

fn get_keybind_at_line(lines: &[String], line_number: usize, line_start: usize) -> Option<KeyBinding> {
    let line = lines.get(line_number)?.get(line_start..)?.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    // Parse the bind line
    let parts: Vec<&str> = line.splitn(4, ',').map(|s| s.trim()).collect();
    if parts.len() < 4 {
        return None;
    }

    let key_part = parts[1];
    let dispatcher = parts[2];
    let params = parts[3..].join(",");

    // Parse modifiers and key
    let key_parts: Vec<&str> = key_part.split_whitespace().collect();
    let (mods, key) = if key_parts.len() > 1 {
        (key_parts[..key_parts.len()-1].to_vec(), key_parts[key_parts.len()-1])
    } else {
        (vec![], key_part)
    };

    // Check for hidden keybinds
    if params.contains(HIDE_COMMENT) {
        return None;
    }

    // Extract comment or generate one
    let comment = if let Some(comment_start) = params.find('#') {
        params[comment_start+1..].trim().to_string()
    } else {
        autogenerate_comment(dispatcher, &params)
    };

    Some(KeyBinding {
        mods: mods.into_iter().map(String::from).collect(),
        key: key.to_string(),
        dispatcher: dispatcher.to_string(),
        params: params.split('#').next().unwrap_or("").trim().to_string(),
        comment,
    })
}

fn get_binds_recursive(
    lines: &[String],
    line_num: &mut usize,
    current_scope: usize,
    mut current_section: Section
) -> Section {
    let title_re = Regex::new(TITLE_REGEX).unwrap();
    
    while *line_num < lines.len() {
        let line = &lines[*line_num];
        
        // Check for section headers
        if let Some(m) = title_re.find(line) {
            if m.start() == 0 {
                let heading_scope = m.end();
                
                // If we're at a higher or equal level, go up a level
                if heading_scope <= current_scope {
                    return current_section;
                }
                
                let section_name = line[heading_scope..].trim();
                *line_num += 1;
                
                // Create a new section and recursively parse its contents
                let child_section = get_binds_recursive(
                    lines,
                    line_num,
                    heading_scope,
                    Section::new(section_name)
                );
                
                current_section.children.push(child_section);
                continue;
            }
        }
        
        // Parse keybinds
        if line.trim().starts_with(COMMENT_BIND_PATTERN) {
            if let Some(keybind) = get_keybind_at_line(lines, *line_num, COMMENT_BIND_PATTERN.len()) {
                current_section.keybinds.push(keybind);
            }
        } else if line.trim().starts_with("bind") {
            if let Some(keybind) = get_keybind_at_line(lines, *line_num, 0) {
                current_section.keybinds.push(keybind);
            }
        }
        
        *line_num += 1;
    }
    
    current_section
}

/// Parse the keybinds configuration file and return the root section
fn parse_keybinds(path: &str) -> Result<Vec<Section>> {
    let lines = read_content(path)?;
    let mut line_num = 0;
    
    // Start with an empty root section and parse the file
    let root = get_binds_recursive(&lines, &mut line_num, 0, Section::new(""));
    
    // Return the root's children directly since the UI expects an array of sections
    Ok(root.children)
}

/// Handle the get-keybinds command
pub fn handle_get_keybinds_command(
    args: &GetKeybindsArgs, 
    debug: bool
) -> Result<()> {
    // Parse the keybinds configuration file
    if debug {
        eprintln!("Parsing keybinds from: {}", &args.path);
    }
    
    let root_section = parse_keybinds(&args.path)
        .context("Failed to parse keybinds configuration")?;
    
    if debug {
        eprintln!("Found {} top-level sections", root_section.len());
    }
    
    // Convert to JSON and print
    let json = serde_json::to_string(&root_section)
        .context("Failed to serialize keybinds to JSON")?;
        
    // Print only the JSON to stdout, no extra newlines or debug info
    print!("{}", json);
    
    Ok(())
}
