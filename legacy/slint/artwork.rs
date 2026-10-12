use image::{RgbaImage, imageops};
use std::path::Path;

pub fn generate(output: &Path) {
    let mut background = image::load_from_memory(include_bytes!("../assets/background.jpeg"))
        .unwrap()
        .resize_exact(1120, 630, imageops::FilterType::Triangle)
        .to_rgba8();
    for (x, _, pixel) in background.enumerate_pixels_mut() {
        let p = x as f32 / 1120.0;
        let alpha = if p < 0.4 {
            0.92 - p * 0.3
        } else if p < 0.7 {
            0.8 - (p - 0.4) * 2.0
        } else {
            0.2 - (p - 0.7) * 0.4
        };
        for (i, tint) in [22.0, 10.0, 10.0].into_iter().enumerate() {
            pixel[i] = (pixel[i] as f32 * (1.0 - alpha) + tint * alpha) as u8;
        }
    }
    background.save(output.join("background.png")).unwrap();
    let blurred = imageops::blur(&background, 9.0);
    for (name, x, y, w, h, r) in [
        ("panel", 38, 222, 500, 204, 21.0),
        ("install", 38, 476, 243, 54, 18.0),
        ("uninstall", 295, 476, 243, 54, 18.0),
        ("customize", 38, 544, 243, 54, 18.0),
        ("folder", 295, 544, 243, 54, 18.0),
        ("notification", 574, 532, 508, 66, 18.0),
    ] {
        surface(&blurred, x, y, w, h, r)
            .save(output.join(format!("{name}.png")))
            .unwrap();
    }
    let mut background = image::load_from_memory(include_bytes!("../assets/background.jpeg"))
        .unwrap()
        .resize_to_fill(900, 700, imageops::FilterType::Triangle)
        .to_rgba8();
    for pixel in background.pixels_mut() {
        for i in 0..3 {
            pixel[i] = (pixel[i] as f32 * 0.30) as u8;
        }
    }
    background
        .save(output.join("editor-background.png"))
        .unwrap();
    let blurred = imageops::blur(&background, 10.0);
    for (name, x, y, w, h, r) in [
        ("editor-content", 24, 124, 852, 480, 22.0),
        ("editor-save", 632, 622, 244, 54, 18.0),
        ("editor-notification", 24, 622, 590, 54, 18.0),
    ] {
        surface(&blurred, x, y, w, h, r)
            .save(output.join(format!("{name}.png")))
            .unwrap();
    }
    let mut definitions = "export global Artwork {\n".to_owned();
    for name in [
        "background",
        "panel",
        "install",
        "uninstall",
        "customize",
        "folder",
        "notification",
        "editor-background",
        "editor-content",
        "editor-save",
        "editor-notification",
    ] {
        let path = output
            .join(format!("{name}.png"))
            .to_string_lossy()
            .replace('\\', "/");
        definitions.push_str(&format!(
            "out property <image> {name}: @image-url(\"{path}\");\n"
        ));
    }
    definitions.push_str("}\n");
    std::fs::write(output.join("artworks.slint"), definitions).unwrap();
}
fn surface(
    background: &RgbaImage,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    radius: f32,
) -> RgbaImage {
    let mut crop = imageops::crop_imm(background, left, top, width, height).to_image();
    for (x, y, pixel) in crop.enumerate_pixels_mut() {
        let dx =
            ((x as f32 + 0.5 - width as f32 / 2.0).abs() - (width as f32 / 2.0 - radius)).max(0.0);
        let dy = ((y as f32 + 0.5 - height as f32 / 2.0).abs() - (height as f32 / 2.0 - radius))
            .max(0.0);
        let d = dx.hypot(dy);
        let coverage = (radius + 0.5 - d).clamp(0.0, 1.0);
        let border = (d - radius + 1.5).clamp(0.0, 1.0);
        let diagonal = x as f32 / width as f32 + y as f32 / height as f32;
        let sheen = (0.13 * (1.0 - diagonal).max(0.0) + 0.03 + border * 0.3).min(0.55);
        for i in 0..3 {
            pixel[i] = (pixel[i] as f32 * (1.0 - sheen) + 255.0 * sheen) as u8;
        }
        pixel[3] = (coverage * 255.0) as u8;
    }
    crop
}
