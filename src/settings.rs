use crate::customization::{self, Settings};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    name: String,
    label: String,
    hint: String,
    section: String,
    value: String,
    kind: &'static str,
    choices: Vec<String>,
    choice_hints: Vec<String>,
    color: Option<String>,
    alpha_enabled: bool,
    opacity: f32,
    unit: &'static str,
    slider: Option<Slider>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slider {
    min: f64,
    max: f64,
    step: f64,
    avatar_percent: bool,
}

fn slider(name: &str, value: &str, defaults: Option<&Settings>) -> Option<Slider> {
    value.parse::<f64>().ok().filter(|v| v.is_finite())?;
    let (min, max, step, avatar_percent) = match name {
        "--avatar-radius" => (0.0, 50.0, 0.5, false),
        "--blur-val" | "--liquid-blur-val" | "--liquid-saturation" | "--message-avatar-size" => {
            let fallback = match name {
                "--blur-val" => 24.0,
                "--liquid-blur-val" => 2.5,
                "--message-avatar-size" => 60.0,
                _ => 220.0,
            };
            let default = defaults
                .and_then(|s| s.fields.iter().find(|(n, _, _)| n == name))
                .and_then(|(_, v, _)| customization::display_value(name, v).parse::<f64>().ok())
                .filter(|v| v.is_finite() && *v > 0.0)
                .unwrap_or(fallback);
            // Bounds stay anchored to source defaults, never to the last saved customization.
            let min = (default * 90.0).round() / 100.0;
            let max = (default * 110.0).round() / 100.0;
            (min, max, 0.01, name == "--message-avatar-size")
        }
        _ => return None,
    };
    Some(Slider {
        min,
        max,
        step,
        avatar_percent,
    })
}

#[derive(Deserialize)]
pub struct Edit {
    pub name: String,
    pub value: String,
}

pub fn fields(settings: &Settings, defaults: Option<&Settings>) -> Vec<Field> {
    settings
        .fields
        .iter()
        .map(|(name, original, _)| {
            let core = original
                .strip_suffix("!important")
                .unwrap_or(original)
                .trim();
            let swatch = customization::swatch(core);
            let choices = customization::choices(name);
            let value = customization::display_value(name, original);
            let opacity = core
                .strip_prefix("rgba(")
                .and_then(|v| v.strip_suffix(')'))
                .and_then(|v| v.rsplit(',').next())
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or_else(|| swatch.map_or(1.0, |c| c.alpha as f32 / 255.0));
            let slider = slider(name, &value, defaults);
            Field {
                name: name.clone(),
                label: customization::label(name),
                hint: customization::explanation(name, &value).into(),
                section: customization::section(name).into(),
                value,
                slider,
                kind: if !choices.is_empty() {
                    "choice"
                } else if swatch.is_some() {
                    "color"
                } else if name.ends_with("-bg") {
                    "image"
                } else {
                    "number"
                },
                choices: choices.iter().map(|(label, _)| (*label).into()).collect(),
                choice_hints: choices
                    .iter()
                    .map(|(label, _)| customization::explanation(name, label).into())
                    .collect(),
                color: swatch.map(|c| format!("#{:02x}{:02x}{:02x}", c.red, c.green, c.blue)),
                alpha_enabled: core.starts_with("rgba(")
                    || (core.starts_with('#') && (core.len() == 5 || core.len() == 9)),
                opacity,
                unit: if core.ends_with("px") {
                    "pixels"
                } else if core.ends_with('%') {
                    "%"
                } else {
                    ""
                },
            }
        })
        .collect()
}

pub fn values(settings: &Settings, edits: &[Edit]) -> Result<Vec<String>, String> {
    if settings.fields.len() != edits.len() {
        return Err("The settings list changed. Go back and reopen Customize.".into());
    }
    settings
        .fields
        .iter()
        .zip(edits)
        .map(|((name, original, _), edit)| {
            if *name != edit.name {
                return Err("The settings order changed. Go back and reopen Customize.".into());
            }
            if name == "--avatar-radius"
                && edit.value != customization::display_value(name, original)
            {
                let suffix = if original.ends_with("!important") {
                    " !important"
                } else {
                    ""
                };
                return Ok(format!("{}%{}", edit.value.trim(), suffix));
            }
            Ok(customization::css_value(name, &edit.value, original))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_preserves_unchanged_values_and_rejects_mismatched_fields() {
        let parsed = customization::parse(":root {\n--main-color: #abc !important;\n--glass-dark: rgba(12, 16, 24, 0.24);\n--blur-val: 24px;\n}\n/* END OF USER SETTINGS */".into()).unwrap();
        let rows = fields(&parsed, None);
        assert_eq!(rows[0].color.as_deref(), Some("#aabbcc"));
        assert_eq!(rows[1].opacity, 0.24);
        assert!(rows[1].alpha_enabled);
        assert_eq!(rows[2].unit, "pixels");
        let mut edits = rows
            .iter()
            .map(|f| Edit {
                name: f.name.clone(),
                value: f.value.clone(),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            values(&parsed, &edits).unwrap(),
            parsed
                .fields
                .iter()
                .map(|(_, v, _)| v.clone())
                .collect::<Vec<_>>()
        );
        edits[2].value = "36".into();
        assert_eq!(values(&parsed, &edits).unwrap()[2], "36px");
        edits[0].name = "--wrong".into();
        assert!(values(&parsed, &edits).is_err());
        assert!(values(&parsed, &[]).is_err());
    }
    #[test]
    fn slider_bounds_use_source_defaults_and_do_not_drift_after_edits() {
        let defaults = customization::parse("--blur-val: 24px;\n--liquid-blur-val: 2.5px;\n--liquid-saturation: 220%;\n/* END OF USER SETTINGS */".into()).unwrap();
        let blur = slider("--blur-val", "26", Some(&defaults)).unwrap();
        assert_eq!((blur.min, blur.max), (21.6, 26.4));
        let liquid = slider("--liquid-blur-val", "2.6", Some(&defaults)).unwrap();
        assert_eq!((liquid.min, liquid.max), (2.25, 2.75));
        let saturation = slider("--liquid-saturation", "230", Some(&defaults)).unwrap();
        assert_eq!((saturation.min, saturation.max), (198.0, 242.0));
        let avatar = slider("--message-avatar-size", "40", None).unwrap();
        assert_eq!((avatar.min, avatar.max), (54.0, 66.0));
        assert!(avatar.avatar_percent);
        let radius = slider("--avatar-radius", "50", None).unwrap();
        assert_eq!((radius.min, radius.max), (0.0, 50.0));
    }
}
