use std::ffi::c_void;
use std::mem;
use std::ptr;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Gdi::*;

/// Information about a display monitor.
pub struct MonitorInfo {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

/// A captured monitor screenshot with its position and pixel data.
pub struct CapturedMonitor {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub pixels: Vec<u8>, // BGRA, top-down row order
}

/// Enumerate all display monitors and return their virtual-screen bounds.
pub fn enumerate_monitors() -> Vec<MonitorInfo> {
    let mut monitors: Vec<MonitorInfo> = Vec::new();

    unsafe extern "system" fn callback(
        _hmonitor: HMONITOR,
        _hdc: HDC,
        rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(data as *mut Vec<MonitorInfo>);
        let r = &*rect;
        monitors.push(MonitorInfo {
            left: r.left,
            top: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
        });
        TRUE // continue enumeration
    }

    unsafe {
        EnumDisplayMonitors(
            0,
            ptr::null(),
            Some(callback),
            &mut monitors as *mut Vec<MonitorInfo> as LPARAM,
        );
    }

    monitors
}

/// Capture each monitor's screen content into a BGRA pixel buffer.
pub fn capture_monitors(monitors: &[MonitorInfo]) -> Vec<CapturedMonitor> {
    let mut captures = Vec::with_capacity(monitors.len());

    for mon in monitors {
        if mon.width <= 0 || mon.height <= 0 {
            continue;
        }
        if let Some(cap) = capture_one(mon) {
            captures.push(cap);
        }
    }

    captures
}

fn capture_one(mon: &MonitorInfo) -> Option<CapturedMonitor> {
    unsafe {
        let hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem == 0 {
            ReleaseDC(0, hdc_screen);
            return None;
        }

        let w = mon.width;
        let h = mon.height;

        // Create a compatible bitmap and capture the screen region into it.
        let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
        if hbmp == 0 {
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return None;
        }

        let old_bmp = SelectObject(hdc_mem, hbmp);
        BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, mon.left, mon.top, SRCCOPY);
        SelectObject(hdc_mem, old_bmp); // deselect before GetDIBits

        // Extract pixels as top-down 32-bit BGRA.
        let mut bmi: BITMAPINFO = mem::zeroed();
        bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // negative = top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let byte_count = (w as usize) * (h as usize) * 4;
        let mut pixels = vec![0u8; byte_count];

        let lines = GetDIBits(
            hdc_mem,
            hbmp,
            0,
            h as u32,
            pixels.as_mut_ptr() as *mut c_void,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        DeleteObject(hbmp);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);

        if lines == 0 {
            return None;
        }

        Some(CapturedMonitor {
            left: mon.left,
            top: mon.top,
            width: w,
            height: h,
            pixels,
        })
    }
}
