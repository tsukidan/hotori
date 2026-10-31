use std::{fs, io, path::Path};

pub struct Settings {
    pub original: String,
    pub fields: Vec<(String, String, std::ops::Range<usize>)>,
}

pub fn display_value(name: &str, value: &str) -> String {
    let value = value.strip_suffix("!important").unwrap_or(value).trim();
    let choices = choices(name);
    if let Some(label) = choices
        .iter()
        .find_map(|(label, css)| (*css == value).then_some(*label))
    {
        return label.into();
    }
    if name == "--main-bg" || name == "--settings-bg" {
        if value == "none" {
            return String::new();
        }
        return value
            .strip_prefix("url(")
            .and_then(|v| v.strip_suffix(')'))
            .unwrap_or(value)
            .trim()
            .trim_matches(['\'', '"'])
            .to_owned();
    }
    value
        .strip_suffix("px")
        .or_else(|| value.strip_suffix('%'))
        .unwrap_or(value)
        .to_owned()
}

pub fn css_value(name: &str, input: &str, original: &str) -> String {
    let input = input.trim();
    if input == display_value(name, original) {
        return original.to_owned();
    }
    let mut value = if let Some(css) = choices(name)
        .iter()
        .find_map(|(label, css)| (*label == input).then_some(*css))
    {
        css.to_owned()
    } else if name == "--main-bg" || name == "--settings-bg" {
        if input.is_empty() {
            "none".to_owned()
        } else {
            format!("url('{input}')")
        }
    } else {
        let core = original
            .strip_suffix("!important")
            .unwrap_or(original)
            .trim();
        if core.ends_with("px") {
            format!("{input}px")
        } else if core.ends_with('%') {
            format!("{input}%")
        } else {
            input.to_owned()
        }
    };
    if original.ends_with("!important") {
        value.push_str(" !important");
    }
    value
}

pub fn choices(name: &str) -> Vec<(&'static str, &'static str)> {
    match name {
        "--blur-profile" => vec![
            ("Acrylic", "var(--blur-acrylic)"),
            ("Liquid Glass", "var(--blur-liquid)"),
            ("No Glass", "var(--blur-none)"),
        ],
        "--glass-background" => vec![
            ("Dark Glass", "var(--glass-dark)"),
            ("Light Glass", "var(--glass-light)"),
        ],
        "--show-friends-sidebar" => vec![("Hidden", "0"), ("Shown", "1")],
        "--server-list-layout" => vec![
            ("Vertical", "var(--vertical)"),
            ("Horizontal", "var(--horizontal)"),
        ],
        _ => vec![],
    }
}

pub fn label(name: &str) -> String {
    match name {
        "--blur-profile" => "Glass Profile",
        "--glass-background" => "Glass Background",
        "--main-bg" => "Main Background",
        "--settings-bg" => "Settings Background",
        "--bg-overlay-top" => "Main Background · Top Dimming",
        "--bg-overlay-bottom" => "Main Background · Bottom Dimming",
        "--settings-bg-overlay-top" => "Settings Background · Top Dimming",
        "--settings-bg-overlay-bottom" => "Settings Background · Bottom Dimming",
        "--blur-val" => "Acrylic Blur",
        "--liquid-blur-val" => "Liquid Glass Blur",
        "--liquid-saturation" => "Liquid Glass Color Intensity",
        "--glass-light" => "Light Glass Tint",
        "--glass-dark" => "Dark Glass Tint",
        "--main-color" => "Accent Color",
        "--text-normal" => "Message Text",
        "--text-muted" => "Muted Text",
        "--interactive-normal" => "Default Icon Color",
        "--interactive-hover" => "Icon Hover Color",
        "--interactive-active" => "Active Icon Color",
        "--channels-default" => "Channel Names",
        "--header-primary" => "Primary Headings",
        "--header-secondary" => "Secondary Headings",
        "--icon-primary" => "Primary Icons",
        "--secondary-ui-color" => "Secondary Labels & Buttons",
        "--chat-input-gap" => "Typing Indicator Spacing",
        "--message-avatar-size" => "Message Avatar Size",
        "--avatar-radius" => "Avatar Roundness",
        "--mention-glass-tint" => "Mention Highlight",
        "--mention-glass-hover" => "Mention Hover Highlight",
        "--mention-glass-accent" => "Mention Accent Color",
        "--show-friends-sidebar" => "Friends Sidebar",
        "--server-list-layout" => "Server List Layout",
        _ => return name.trim_start_matches("--").replace('-', " "),
    }
    .into()
}

pub fn explanation(name: &str, value: &str) -> &'static str {
    match name {
        "--show-friends-sidebar" => {
            if value == "Shown" {
                "Shows Discord’s persistent right-side Friends sidebar. The main Friends page and server member list stay available."
            } else {
                "Hides the entire right-side Friends sidebar and its layout space. The main Friends page and server member list stay available."
            }
        }
        "--blur-profile" => match value {
            "Liquid Glass" => "Clearer glass with refractive edges and vivid colors.",
            "No Glass" => "Removes glass tint, borders, shadows, and blur.",
            _ => "Soft frosted panels that blur the background.",
        },
        "--glass-background" => {
            if value == "Light Glass" {
                "A light translucent tint, independent of Discord’s appearance."
            } else {
                "A dark translucent tint, independent of Discord’s appearance."
            }
        }
        "--main-bg" => "Wallpaper behind your messages and channels.",
        "--settings-bg" => "Wallpaper displayed on Discord’s settings pages.",
        n if n.contains("overlay") => "Controls wallpaper darkening. Higher opacity means darker.",
        "--blur-val" => "100% is the theme default. Adjust acrylic blur between 50% and 150%.",
        "--liquid-blur-val" => "100% is the theme default. Adjust liquid glass blur between 50% and 150%.",
        "--liquid-saturation" => {
            "100% is the theme default. Adjust between 50% and 150% of its color intensity."
        }
        "--glass-light" | "--glass-dark" => {
            "Choose the tint and transparency for this glass preset."
        }
        "--main-color" => "Main accent for buttons, links, and navigation.",
        "--chat-input-gap" => "Extra space above the message box while someone is typing.",
        "--message-avatar-size" => {
            "100% is the theme default. Adjust avatar size between 90% and 110%."
        }
        "--avatar-radius" => "0% is square; 100% is a full circle.",
        "--server-list-layout" => {
            if value == "Horizontal" {
                "Places your servers across the top of Discord."
            } else {
                "Keeps your servers in a column on the left."
            }
        }
        n if n.contains("mention") => "Personalize messages that mention you.",
        _ => "Choose a color using the swatch button.",
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

impl Color {
    fn from_rgb_u8(red: u8, green: u8, blue: u8) -> Self {
        Self::from_argb_u8(255, red, green, blue)
    }
    fn from_argb_u8(alpha: u8, red: u8, green: u8, blue: u8) -> Self {
        Self {
            red,
            green,
            blue,
            alpha,
        }
    }
}

pub fn swatch(value: &str) -> Option<Color> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let hex = if hex.len() == 3 || hex.len() == 4 {
            hex.chars().flat_map(|c| [c, c]).collect::<String>()
        } else {
            hex.to_owned()
        };
        if hex.len() != 6 && hex.len() != 8 {
            return None;
        }
        let n = u32::from_str_radix(&hex, 16).ok()?;
        return Some(if hex.len() == 6 {
            Color::from_rgb_u8((n >> 16) as u8, (n >> 8) as u8, n as u8)
        } else {
            Color::from_argb_u8(n as u8, (n >> 24) as u8, (n >> 16) as u8, (n >> 8) as u8)
        });
    }
    let numbers = value
        .strip_prefix("rgba(")?
        .strip_suffix(')')?
        .split(',')
        .map(|s| s.trim().parse::<f32>())
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if numbers.len() != 4 || numbers.iter().any(|n| !n.is_finite()) {
        return None;
    }
    Some(Color::from_argb_u8(
        (numbers[3].clamp(0.0, 1.0) * 255.0) as u8,
        numbers[0] as u8,
        numbers[1] as u8,
        numbers[2] as u8,
    ))
}

pub fn section(name: &str) -> &'static str {
    match name {
        "--blur-profile" | "--glass-background" => "Glass appearance",
        "--main-bg" | "--settings-bg" => "Wallpapers",
        n if n.contains("overlay") => "Background dimming",
        "--blur-val" | "--liquid-blur-val" | "--liquid-saturation" => "Blur & saturation",
        "--glass-light" | "--glass-dark" => "Glass tints",
        "--main-color" => "Accent color",
        "--chat-input-gap" => "Message spacing",
        "--message-avatar-size" | "--avatar-radius" => "Avatars",
        n if n.contains("mention") => "Mention highlights",
        "--show-friends-sidebar" => "Friends sidebar",
        n if n.contains("server-list") => "Server list",
        _ => "Text & icon colors",
    }
}

pub fn parse(css: String) -> io::Result<Settings> {
    let end = css
        .find("END OF USER SETTINGS")
        .ok_or_else(|| io::Error::other("User settings marker is missing"))?;
    let mut fields = Vec::new();
    let mut offset = 0;
    for line in css[..end].split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("--") {
            if let (Some(colon), Some(semicolon)) = (line.find(':'), line.find(';')) {
                let name = line[..colon].trim().to_owned();
                if name == "--server-list-top-padding"
                    || name == "--server-list-horizontal-height"
                    || name == "--chat-input-gap"
                {
                    offset += line.len();
                    continue;
                }
                let value = line[colon + 1..semicolon].trim();
                let start =
                    offset + colon + 1 + line[colon + 1..semicolon].find(value).unwrap_or(0);
                fields.push((name, value.to_owned(), start..start + value.len()));
            }
        }
        offset += line.len();
    }
    if fields.is_empty() {
        return Err(io::Error::other("No editable settings found"));
    }
    Ok(Settings {
        original: css,
        fields,
    })
}

fn validate(name: &str, value: &str) -> io::Result<()> {
    let bad = || io::Error::other(format!("Invalid value for {name}"));
    if value.is_empty()
        || value.contains([';', '{', '}', '\n', '\r'])
        || value.contains("/*")
        || value.contains("*/")
    {
        return Err(bad());
    }
    let core = value.strip_suffix("!important").unwrap_or(value).trim();
    let valid = match name {
        "--blur-profile" => [
            "var(--blur-acrylic)",
            "var(--blur-liquid)",
            "var(--blur-none)",
        ]
        .contains(&core),
        "--glass-background" => ["var(--glass-light)", "var(--glass-dark)"].contains(&core),
        "--show-friends-sidebar" => ["0", "1"].contains(&core),
        "--server-list-layout" => ["var(--vertical)", "var(--horizontal)"].contains(&core),
        "--main-bg" | "--settings-bg" => {
            let url = display_value(name, core);
            core == "none"
                || ((url.is_empty()
                    || url.starts_with("https://")
                    || url.starts_with("http://")
                    || crate::wallpapers::valid_uri(&url))
                    && !url.contains(['\'', '"', '(', ')', ' '])
                    && (core.starts_with("url('") && core.ends_with("')")
                        || core.starts_with("url(\"") && core.ends_with("\")")))
        }
        n if n.contains("overlay")
            || n == "--glass-light"
            || n == "--glass-dark"
            || n == "--mention-glass-tint"
            || n == "--mention-glass-hover" =>
        {
            core.strip_prefix("rgba(")
                .and_then(|v| v.strip_suffix(')'))
                .map(|v| {
                    let numbers: Vec<_> = v.split(',').map(|s| s.trim().parse::<f32>()).collect();
                    numbers.len() == 4
                        && numbers.iter().enumerate().all(|(i, v)| {
                            v.as_ref().is_ok_and(|n| {
                                n.is_finite() && *n >= 0.0 && *n <= if i == 3 { 1.0 } else { 255.0 }
                            })
                        })
                })
                .unwrap_or(false)
        }
        "--blur-val"
        | "--liquid-blur-val"
        | "--chat-input-gap"
        | "--message-avatar-size"
        | "--server-list-top-padding"
        | "--server-list-horizontal-height" => unit(core, "px"),
        "--liquid-saturation" => unit(core, "%"),
        "--avatar-radius" => unit(core, "px") || unit(core, "%"),
        _ => core.strip_prefix('#').is_some_and(|v| {
            [3, 4, 6, 8].contains(&v.len()) && v.chars().all(|c| c.is_ascii_hexdigit())
        }),
    };
    if valid { Ok(()) } else { Err(bad()) }
}
fn unit(value: &str, suffix: &str) -> bool {
    value
        .strip_suffix(suffix)
        .and_then(|v| v.parse::<f32>().ok())
        .is_some_and(|v| v.is_finite() && (0.0..=1000.0).contains(&v))
}

pub fn save(path: &Path, settings: &Settings, values: &[String]) -> io::Result<Settings> {
    if values.len() != settings.fields.len() {
        return Err(io::Error::other("Settings count changed"));
    }
    if fs::read_to_string(path)? != settings.original {
        return Err(io::Error::other(
            "Theme changed outside the installer. Reopen Customize to load it again.",
        ));
    }
    let mut updated = settings.original.clone();
    for ((name, original, range), value) in settings.fields.iter().zip(values).rev() {
        // Preserve supported existing values verbatim, even if newer CSS syntax is used.
        if value != original {
            validate(name, value)?;
            if original.ends_with("!important") && !value.ends_with("!important") {
                return Err(io::Error::other(format!("Keep !important for {name}")));
            }
            updated.replace_range(range.clone(), value);
        }
    }
    let next = parse(updated)?;
    fs::write(path, &next.original)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn friends_sidebar_choices_map_to_valid_css() {
        let name = "--show-friends-sidebar";
        assert_eq!(display_value(name, "0"), "Hidden");
        assert_eq!(display_value(name, "1 !important"), "Shown");
        assert_eq!(css_value(name, "Shown", "0"), "1");
        assert_eq!(css_value(name, "Hidden", "1 !important"), "0 !important");
        assert!(validate(name, "0").is_ok());
        assert!(validate(name, "1 !important").is_ok());
        for invalid in ["2", "-1", "true", "Shown", "0.5"] {
            assert!(validate(name, invalid).is_err());
        }
    }
    #[test]
    fn friendly_choices_and_hidden_fields_preserve_css() {
        assert_eq!(
            display_value("--blur-profile", "var(--blur-liquid)"),
            "Liquid Glass"
        );
        assert_eq!(
            css_value("--blur-profile", "Acrylic", "var(--blur-liquid)"),
            "var(--blur-acrylic)"
        );
        assert_eq!(display_value("--blur-val", "24px"), "24");
        assert_eq!(css_value("--blur-val", "12.5", "24px"), "12.5px");
        let css = "--main-color: #ffffff;\n--server-list-top-padding: 12px;\n--server-list-horizontal-height: 80px;\n--server-list-layout: var(--vertical);\n/* END OF USER SETTINGS */";
        let settings = parse(css.into()).unwrap();
        assert_eq!(settings.fields.len(), 2);
        assert_eq!(
            &settings.original[settings.fields[1].2.clone()],
            "var(--vertical)"
        );
        assert_eq!(label("--main-bg"), "Main Background");
    }
    #[test]
    fn wallpaper_inputs_and_color_swatches_round_trip() {
        let original = "url(\"https://example.com/original.jpg\")";
        assert_eq!(
            display_value("--main-bg", original),
            "https://example.com/original.jpg"
        );
        assert_eq!(
            css_value("--main-bg", "https://example.com/original.jpg", original),
            original
        );
        let new = css_value("--main-bg", "https://example.com/new.jpg", original);
        assert_eq!(new, "url('https://example.com/new.jpg')");
        assert!(validate("--main-bg", &new).is_ok());
        assert_eq!(
            css_value("--text-normal", "#123456", "#fff !important"),
            "#123456 !important"
        );
        assert_eq!(swatch("#ec5757").unwrap().red, 236);
        assert_eq!(swatch("rgba(12, 16, 24, 0.24)").unwrap().alpha, 61);
        assert!(swatch("not a color").is_none());
    }
    #[test]
    fn limits_edits_to_user_settings_and_rejects_css_injection() {
        let css = ":root {\n --main-color: #ec5757; /* keep */\n}\n/* END OF USER SETTINGS */\n:root { --main-color: red; }";
        let parsed = parse(css.into()).unwrap();
        assert_eq!(parsed.fields.len(), 1);
        let mut changed = parsed.original.clone();
        changed.replace_range(parsed.fields[0].2.clone(), "#ffffff");
        assert!(changed.ends_with(":root { --main-color: red; }"));
        assert!(validate("--main-color", "#ffffff; body {display:none}").is_err());
        assert!(validate("--blur-val", "-4px").is_err());
        assert!(validate("--blur-profile", "var(--blur-liquid)").is_ok());
    }
    #[test]
    fn save_preserves_implementation_without_backups_and_detects_external_changes() {
        let folder = std::env::temp_dir().join(format!("hotori-customize-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(crate::installer::DESTINATION);
        let css = ":root {\r\n --main-color: #ec5757; /* keep */\r\n}\r\n/* END OF USER SETTINGS */\r\n:root { --main-color: red; }";
        fs::write(&path, css).unwrap();
        let parsed = parse(css.into()).unwrap();
        save(&path, &parsed, &["#ffffff".into()]).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            css.replacen("#ec5757", "#ffffff", 1)
        );
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        assert!(save(&path, &parsed, &["#000000".into()]).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
}
