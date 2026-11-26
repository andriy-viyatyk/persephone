// persephone-snip: Native screen snip tool + Windows file-clipboard helper.
//
// No arguments (default): captures a screen selection and writes PNG bytes to
// stdout. Windows uses fullscreen overlays; Linux uses the desktop Screenshot
// portal. Cancellation exits 1 on Windows and exits 0 without output on Linux.
//
// Windows-only subcommands (US-807):
//   clipboard-read           — CF_HDROP file list + drop effect as JSON to stdout
//   clipboard-write [--cut]  — set CF_HDROP from stdin path list (see clipboard.rs)
//   clipboard-watch [--trusted-pid <pid>]
//                            — clipboard change events as JSON lines; copies owned by
//                              <pid> keep Chromium's CanIncludeInClipboardHistory marker
//                              from excluding them (see clipboard_watch.rs)
//   sso-cookies <uri>        — Windows single sign-on cookies for a Microsoft
//                              sign-in URI as one JSON line (see sso_cookies.rs)

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod clipboard;
#[cfg(windows)]
mod clipboard_watch;
#[cfg(windows)]
mod dialogs;
#[cfg(windows)]
mod overlay;
#[cfg(target_os = "linux")]
mod screenshot_linux;
#[cfg(windows)]
mod sso_cookies;

// clipboard-watch emits change events and health-check responses as JSON lines.

#[cfg(windows)]
use std::io::Write;

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SetProcessDpiAwarenessContext(value: isize) -> i32;
}
#[cfg(windows)]
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: isize = -4;

#[cfg(windows)]
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("clipboard-read") => clipboard::read(),
        Some("clipboard-write") => clipboard::write(std::env::args().any(|a| a == "--cut")),
        Some("clipboard-watch") => clipboard_watch::run(),
        Some("sso-cookies") => sso_cookies::run(std::env::args().nth(2)),
        Some("dialog-cancel") => dialogs::cancel(std::env::args().nth(2)),
        Some("dialog-info") => dialogs::info(std::env::args().nth(2)),
        _ => run_snip(),
    }
}

#[cfg(target_os = "linux")]
fn main() {
    if std::env::args_os().len() != 1 {
        eprintln!("persephone-snip: Linux supports only no-argument screen capture");
        std::process::exit(1);
    }

    if let Err(error) = screenshot_linux::capture() {
        eprintln!("persephone-snip: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn main() {
    eprintln!("persephone-snip: not supported on this platform yet");
    std::process::exit(1);
}

#[cfg(windows)]
fn run_snip() {
    // Declare Per-Monitor DPI V2 awareness so that EnumDisplayMonitors,
    // GetDC, BitBlt, and CreateWindowExW all use physical pixel coordinates.
    // Without this, mixed-DPI setups produce mismatched capture/window sizes.
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }

    // 1. Enumerate monitors.
    let monitors = capture::enumerate_monitors();
    if monitors.is_empty() {
        std::process::exit(1);
    }

    // 2. Capture each monitor's screen.
    let captures = capture::capture_monitors(&monitors);
    if captures.is_empty() {
        std::process::exit(1);
    }

    // 3. Show overlays and wait for selection.
    let result = match overlay::run(captures) {
        Some(r) => r,
        None => std::process::exit(1),
    };

    // 4. Encode as PNG and write to stdout.
    let png_data = encode_png(&result.pixels, result.width, result.height);

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    if out.write_all(&png_data).is_err() {
        std::process::exit(1);
    }
    let _ = out.flush();
}

/// Encode BGRA pixels as an RGB PNG.
#[cfg(windows)]
fn encode_png(bgra: &[u8], width: u32, height: u32) -> Vec<u8> {
    let pixel_count = (width as usize) * (height as usize);
    let mut rgb = Vec::with_capacity(pixel_count * 3);
    for chunk in bgra.chunks_exact(4) {
        rgb.push(chunk[2]); // R
        rgb.push(chunk[1]); // G
        rgb.push(chunk[0]); // B
    }

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("PNG header");
        writer.write_image_data(&rgb).expect("PNG data");
    }
    buf
}
