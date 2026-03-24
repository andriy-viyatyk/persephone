use std::ffi::c_void;
use std::mem;
use std::ptr;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::capture::CapturedMonitor;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// The cropped screenshot returned after a successful selection.
pub struct SnipResult {
    pub pixels: Vec<u8>, // BGRA, top-down
    pub width: u32,
    pub height: u32,
}

/// Show fullscreen overlays on every captured monitor.
/// Returns `Some(SnipResult)` on successful selection, `None` on cancel.
pub fn run(captures: Vec<CapturedMonitor>) -> Option<SnipResult> {
    if captures.is_empty() {
        return None;
    }

    unsafe { run_inner(captures) }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/// GDI resources for one overlay window.
struct MonitorGdi {
    hwnd: HWND,
    /// Memory DC with the original (full-brightness) screenshot.
    hdc_original: HDC,
    hbmp_original: HBITMAP,
    /// Pointer into the original DIB section's pixel buffer (for cropping).
    original_bits: *const u8,
    /// Memory DC with the dimmed screenshot.
    hdc_dimmed: HDC,
    hbmp_dimmed: HBITMAP,
    /// Back-buffer DC used for flicker-free painting.
    hdc_back: HDC,
    hbmp_back: HBITMAP,
    width: i32,
    height: i32,
}

/// Global application state accessed from the window procedure.
struct App {
    monitors: Vec<MonitorGdi>,
    dragging: bool,
    drag_idx: usize,
    start: (i32, i32),
    current: (i32, i32),
    completed: bool,
}

static mut APP: *mut App = ptr::null_mut();

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

unsafe fn run_inner(captures: Vec<CapturedMonitor>) -> Option<SnipResult> {
    let hinstance = GetModuleHandleW(ptr::null());

    // Register the overlay window class.
    let class_name = wide("JsNotepadSnipOverlay");
    let wc = WNDCLASSEXW {
        cbSize: mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: 0,
        hCursor: LoadCursorW(0, IDC_CROSS),
        hbrBackground: 0,
        lpszMenuName: ptr::null(),
        lpszClassName: class_name.as_ptr(),
        hIconSm: 0,
    };
    RegisterClassExW(&wc);

    // Initialise global state (before creating windows so the wnd_proc is safe).
    let app = Box::new(App {
        monitors: Vec::with_capacity(captures.len()),
        dragging: false,
        drag_idx: 0,
        start: (0, 0),
        current: (0, 0),
        completed: false,
    });
    APP = Box::into_raw(app);

    // Create one overlay window per captured monitor.
    for cap in &captures {
        let gdi = create_monitor_gdi(hinstance, &class_name, cap);
        (*APP).monitors.push(gdi);
    }

    // Show all overlays at once.
    for m in &(*APP).monitors {
        ShowWindow(m.hwnd, SW_SHOWNA);
    }
    // Activate the first overlay so it receives keyboard input.
    if let Some(first) = (*APP).monitors.first() {
        SetForegroundWindow(first.hwnd);
    }

    // ---- message loop ----
    let mut msg: MSG = mem::zeroed();
    while GetMessageW(&mut msg, 0, 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // ---- extract result ----
    let app = Box::from_raw(APP);
    APP = ptr::null_mut();

    let result = if app.completed {
        extract_selection(&app)
    } else {
        None
    };

    // ---- cleanup GDI ----
    for m in &app.monitors {
        DestroyWindow(m.hwnd);
        DeleteDC(m.hdc_back);
        DeleteObject(m.hbmp_back);
        DeleteDC(m.hdc_original);
        DeleteObject(m.hbmp_original);
        DeleteDC(m.hdc_dimmed);
        DeleteObject(m.hbmp_dimmed);
    }
    UnregisterClassW(class_name.as_ptr(), hinstance);

    result
}

/// Build GDI resources and create the overlay window for one monitor.
unsafe fn create_monitor_gdi(
    hinstance: HINSTANCE,
    class_name: &[u16],
    cap: &CapturedMonitor,
) -> MonitorGdi {
    let w = cap.width;
    let h = cap.height;
    let hdc_screen = GetDC(0);

    // Original screenshot (DIB section — gives us a bits pointer for cropping).
    let (hdc_orig, hbmp_orig, bits) = create_dib(hdc_screen, &cap.pixels, w, h);

    // Dimmed copy.
    let dimmed = dim_pixels(&cap.pixels);
    let (hdc_dim, hbmp_dim, _) = create_dib(hdc_screen, &dimmed, w, h);

    // Back-buffer (compatible bitmap — no pixel access needed).
    let hdc_back = CreateCompatibleDC(hdc_screen);
    let hbmp_back = CreateCompatibleBitmap(hdc_screen, w, h);
    SelectObject(hdc_back, hbmp_back);

    ReleaseDC(0, hdc_screen);

    // Create the window.
    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        class_name.as_ptr(),
        ptr::null(),
        WS_POPUP,
        cap.left,
        cap.top,
        w,
        h,
        0,
        0,
        hinstance,
        ptr::null(),
    );

    MonitorGdi {
        hwnd,
        hdc_original: hdc_orig,
        hbmp_original: hbmp_orig,
        original_bits: bits,
        hdc_dimmed: hdc_dim,
        hbmp_dimmed: hbmp_dim,
        hdc_back: hdc_back,
        hbmp_back: hbmp_back,
        width: w,
        height: h,
    }
}

/// Create a memory DC + DIB section and copy `pixels` into it.
/// Returns (hdc, hbitmap, bits_ptr).
unsafe fn create_dib(
    hdc_ref: HDC,
    pixels: &[u8],
    w: i32,
    h: i32,
) -> (HDC, HBITMAP, *const u8) {
    let hdc = CreateCompatibleDC(hdc_ref);

    let mut bmi: BITMAPINFO = mem::zeroed();
    bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h; // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    let mut bits: *mut c_void = ptr::null_mut();
    let hbmp = CreateDIBSection(hdc_ref, &bmi, DIB_RGB_COLORS, &mut bits, 0, 0);

    // Copy pixel data into the DIB section.
    if !bits.is_null() && !pixels.is_empty() {
        ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
    }

    SelectObject(hdc, hbmp);
    (hdc, hbmp, bits as *const u8)
}

/// Produce a dimmed copy of a BGRA pixel buffer (65% brightness).
fn dim_pixels(pixels: &[u8]) -> Vec<u8> {
    let mut out = pixels.to_vec();
    for chunk in out.chunks_exact_mut(4) {
        chunk[0] = (chunk[0] as u16 * 165 / 255) as u8;
        chunk[1] = (chunk[1] as u16 * 165 / 255) as u8;
        chunk[2] = (chunk[2] as u16 * 165 / 255) as u8;
    }
    out
}

/// Extract the selected rectangle from the original pixel data.
unsafe fn extract_selection(app: &App) -> Option<SnipResult> {
    let mon = &app.monitors[app.drag_idx];
    let (sx, sy, sw, sh) = selection_rect(app);

    // Clamp to monitor bounds.
    let x = sx.max(0);
    let y = sy.max(0);
    let w = sw.min(mon.width - x);
    let h = sh.min(mon.height - y);

    if w <= 0 || h <= 0 {
        return None;
    }

    let stride = mon.width as usize * 4;
    let row_bytes = w as usize * 4;
    let mut cropped = vec![0u8; (w as usize) * (h as usize) * 4];

    for row in 0..h as usize {
        let src = mon.original_bits.add((y as usize + row) * stride + x as usize * 4);
        let dst = cropped.as_mut_ptr().add(row * row_bytes);
        ptr::copy_nonoverlapping(src, dst, row_bytes);
    }

    Some(SnipResult {
        pixels: cropped,
        width: w as u32,
        height: h as u32,
    })
}

// ---------------------------------------------------------------------------
// Window procedure
// ---------------------------------------------------------------------------

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if APP.is_null() {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }
    let app = &mut *APP;

    match msg {
        WM_ERASEBKGND => 1, // we paint the full window ourselves

        WM_PAINT => {
            if let Some(idx) = find_window(app, hwnd) {
                paint(app, idx);
            }
            // Must call DefWindowProcW so Windows validates the
            // update region even if we didn't find the window.
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        WM_LBUTTONDOWN => {
            if let Some(idx) = find_window(app, hwnd) {
                let (x, y) = mouse_pos(lparam);
                app.dragging = true;
                app.drag_idx = idx;
                app.start = (x, y);
                app.current = (x, y);
                SetCapture(hwnd);
            }
            0
        }

        WM_MOUSEMOVE => {
            if app.dragging {
                app.current = mouse_pos(lparam);
                InvalidateRect(hwnd, ptr::null(), 0);
            }
            0
        }

        WM_LBUTTONUP => {
            if app.dragging {
                ReleaseCapture();
                app.current = mouse_pos(lparam);
                app.dragging = false;
                let (_, _, w, h) = selection_rect(app);
                app.completed = w > 5 && h > 5;
                PostQuitMessage(0);
            }
            0
        }

        WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
            if app.dragging {
                ReleaseCapture();
                app.dragging = false;
            }
            PostQuitMessage(0);
            0
        }

        WM_KEYDOWN => {
            if wparam as u16 == VK_ESCAPE {
                if app.dragging {
                    ReleaseCapture();
                    app.dragging = false;
                }
                PostQuitMessage(0);
            }
            0
        }

        WM_SETCURSOR => {
            if (lparam & 0xFFFF) as u32 == HTCLIENT {
                SetCursor(LoadCursorW(0, IDC_CROSS));
                return 1;
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

unsafe fn paint(app: &App, idx: usize) {
    let mon = &app.monitors[idx];

    let mut ps: PAINTSTRUCT = mem::zeroed();
    let hdc = BeginPaint(mon.hwnd, &mut ps);

    // 1. Blit dimmed screenshot → back buffer.
    BitBlt(
        mon.hdc_back, 0, 0, mon.width, mon.height,
        mon.hdc_dimmed, 0, 0, SRCCOPY,
    );

    // 2. If this is the active drag monitor, draw the selection highlight.
    if app.dragging && app.drag_idx == idx {
        let (x, y, w, h) = selection_rect(app);
        if w > 2 && h > 2 {
            // Bright (undimmed) pixels inside the selection.
            BitBlt(
                mon.hdc_back, x, y, w, h,
                mon.hdc_original, x, y, SRCCOPY,
            );
            // White 1px border.
            let pen = CreatePen(PS_SOLID as i32, 1, 0x00FF_FFFF); // white COLORREF
            let old_pen = SelectObject(mon.hdc_back, pen);
            let old_brush = SelectObject(mon.hdc_back, GetStockObject(NULL_BRUSH as i32));
            Rectangle(mon.hdc_back, x, y, x + w, y + h);
            SelectObject(mon.hdc_back, old_pen);
            SelectObject(mon.hdc_back, old_brush);
            DeleteObject(pen);
        }
    }

    // 3. Present back buffer → window.
    BitBlt(
        hdc, 0, 0, mon.width, mon.height,
        mon.hdc_back, 0, 0, SRCCOPY,
    );

    EndPaint(mon.hwnd, &ps);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn find_window(app: &App, hwnd: HWND) -> Option<usize> {
    app.monitors.iter().position(|m| m.hwnd == hwnd)
}

fn selection_rect(app: &App) -> (i32, i32, i32, i32) {
    let x = app.start.0.min(app.current.0);
    let y = app.start.1.min(app.current.1);
    let w = (app.start.0 - app.current.0).abs();
    let h = (app.start.1 - app.current.1).abs();
    (x, y, w, h)
}

fn mouse_pos(lparam: LPARAM) -> (i32, i32) {
    let x = (lparam & 0xFFFF) as i16 as i32;
    let y = ((lparam >> 16) & 0xFFFF) as i16 as i32;
    (x, y)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
