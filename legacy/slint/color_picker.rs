use windows_sys::Win32::UI::Controls::Dialogs::{
    CC_FULLOPEN, CC_RGBINIT, CHOOSECOLORW, ChooseColorW,
};
pub fn choose(current: slint::Color) -> Option<slint::Color> {
    let mut custom = [0u32; 16];
    let mut dialog = CHOOSECOLORW::default();
    dialog.lStructSize = std::mem::size_of::<CHOOSECOLORW>() as u32;
    dialog.rgbResult =
        current.red() as u32 | (current.green() as u32) << 8 | (current.blue() as u32) << 16;
    dialog.lpCustColors = custom.as_mut_ptr();
    dialog.Flags = CC_FULLOPEN | CC_RGBINIT;
    // The buffers remain alive for the duration of this synchronous Windows dialog.
    if unsafe { ChooseColorW(&mut dialog) } == 0 {
        return None;
    }
    Some(slint::Color::from_rgb_u8(
        dialog.rgbResult as u8,
        (dialog.rgbResult >> 8) as u8,
        (dialog.rgbResult >> 16) as u8,
    ))
}
