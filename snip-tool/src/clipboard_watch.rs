use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{
    GetLastError, SetLastError, ERROR_SUCCESS, HGLOBAL, HWND,
};
use windows_sys::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardFormatNameW, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    RegisterClipboardFormatW, RemoveClipboardFormatListener,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    PostMessageW, PostQuitMessage, RegisterClassExW, WNDCLASSEXW, HWND_MESSAGE,
    WM_CLIPBOARDUPDATE, WM_CLOSE, WM_DESTROY,
};

use crate::clipboard;

const EXCLUDE_FORMAT_NAME: &str = "ExcludeClipboardContentFromMonitorProcessing";
const CAN_INCLUDE_FORMAT_NAME: &str = "CanIncludeInClipboardHistory";
const WINDOW_CLASS_NAME: &str = "PersephoneClipboardWatch";

/// Extra whole-snapshot attempts when the first one cannot open the clipboard.
///
/// `open_clipboard_retry()` already spends 10 x 50 ms, which covers an ordinary
/// Win32 writer. It does NOT cover Chromium's async clipboard API: a
/// `navigator.clipboard.write()` — which is how Persephone's own image Copy
/// writes — holds the clipboard past that budget, so the first snapshot fails,
/// the event is fail-closed as `inspectionFailed`, and the copy silently never
/// reaches the history. The clipboard is readable about a second later.
///
/// Two extra attempts put the total budget near 1.8 s, which covers it while
/// staying under the consumer's deaf-detection debounce (three pongs at a
/// one-second interval) so a slow writer is not mistaken for a wedged listener.
/// This is bounded retry after a notification, not polling: nothing here looks
/// for changes, it only re-reads the change Windows already reported.
const INSPECT_RETRY_ATTEMPTS: u32 = 2;
const INSPECT_RETRY_DELAY_MS: u64 = 150;

struct OutputState {
    writer: BufWriter<io::Stdout>,
    last_emitted_sequence: Option<u32>,
}

struct ClipboardFormat {
    id: u32,
    name: Option<String>,
}

struct ClipboardSnapshot {
    formats: Vec<ClipboardFormat>,
    exclude_present: bool,
    can_include_present: bool,
    can_include_value: Option<u32>,
    inspection_failed: bool,
    files: Option<(Vec<String>, &'static str)>,
}

pub(crate) fn run() -> ! {
    let exit_code = match run_inner() {
        Ok(code) => code,
        Err(error) => {
            report_error(&error);
            1
        }
    };
    std::process::exit(exit_code);
}

fn run_inner() -> Result<i32, String> {
    let exclude_format = register_format(EXCLUDE_FORMAT_NAME)?;
    let can_include_format = register_format(CAN_INCLUDE_FORMAT_NAME)?;

    let class_name: Vec<u16> = WINDOW_CLASS_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
    if instance == 0 {
        return Err("GetModuleHandleW failed".to_string());
    }

    let window_class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: 0,
        lpfnWndProc: Some(window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: instance,
        hIcon: 0,
        hCursor: 0,
        hbrBackground: 0,
        lpszMenuName: std::ptr::null(),
        lpszClassName: class_name.as_ptr(),
        hIconSm: 0,
    };
    if unsafe { RegisterClassExW(&window_class) } == 0 {
        return Err("RegisterClassExW failed".to_string());
    }

    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            std::ptr::null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            0,
            instance,
            std::ptr::null(),
        )
    };
    if hwnd == 0 {
        return Err("CreateWindowExW failed".to_string());
    }

    if unsafe { AddClipboardFormatListener(hwnd) } == 0 {
        let cleanup_error = destroy_window(hwnd);
        return Err(match cleanup_error {
            Some(error) => format!("AddClipboardFormatListener failed; {error}"),
            None => "AddClipboardFormatListener failed".to_string(),
        });
    }

    let output = Arc::new(Mutex::new(OutputState {
        writer: BufWriter::new(io::stdout()),
        last_emitted_sequence: None,
    }));
    if let Err(error) = write_protocol_line(&output, b"clipboard-watch: ready\n", None) {
        report_cleanup_failure(hwnd);
        return Err(error);
    }

    let input_failed = Arc::new(AtomicBool::new(false));
    let input_thread = spawn_input_thread(
        hwnd,
        Arc::clone(&output),
        Arc::clone(&input_failed),
    );
    if let Err(error) = input_thread {
        report_cleanup_failure(hwnd);
        return Err(error);
    }

    let mut message = unsafe { std::mem::zeroed() };
    loop {
        let result = unsafe { GetMessageW(&mut message, 0, 0, 0) };
        if result == -1 {
            report_cleanup_failure(hwnd);
            return Err("GetMessageW failed".to_string());
        }
        if result == 0 {
            break;
        }

        if message.message == WM_CLIPBOARDUPDATE {
            let sequence = unsafe { GetClipboardSequenceNumber() };
            let timestamp_ms = unix_timestamp_ms();
            let snapshot =
                snapshot_clipboard_retrying(exclude_format, can_include_format, sequence);
            let event = serialize_event(sequence, timestamp_ms, &snapshot);
            if let Err(error) = write_protocol_line(&output, event.as_bytes(), Some(sequence)) {
                report_cleanup_failure(hwnd);
                return Err(error);
            }
        } else {
            unsafe {
                DispatchMessageW(&message);
            }
        }
    }

    if input_failed.load(Ordering::Acquire) {
        Ok(1)
    } else if message.wParam == 0 {
        Ok(0)
    } else {
        Ok(1)
    }
}

fn register_format(name: &str) -> Result<u32, String> {
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let id = unsafe { RegisterClipboardFormatW(wide.as_ptr()) };
    if id == 0 {
        Err(format!("RegisterClipboardFormatW failed for {name}"))
    } else {
        Ok(id)
    }
}

fn spawn_input_thread(
    hwnd: HWND,
    output: Arc<Mutex<OutputState>>,
    input_failed: Arc<AtomicBool>,
) -> Result<thread::JoinHandle<()>, String> {
    thread::Builder::new()
        .name("clipboard-watch-stdin".to_string())
        .spawn(move || input_loop(hwnd, output, input_failed))
        .map_err(|error| format!("failed to start clipboard-watch stdin thread: {error}"))
}

fn input_loop(hwnd: HWND, output: Arc<Mutex<OutputState>>, input_failed: Arc<AtomicBool>) {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                if !post_close(hwnd) {
                    input_failed.store(true, Ordering::Release);
                    return;
                }
                return;
            }
            Ok(_) => {
                if line.trim() == r#"{"type":"ping"}"# {
                    let sequence = unsafe { GetClipboardSequenceNumber() };
                    if let Err(error) = write_pong(&output, sequence) {
                        report_error(&error);
                        input_failed.store(true, Ordering::Release);
                        let _ = post_close(hwnd);
                        return;
                    }
                }
            }
            Err(error) => {
                report_error(&format!("stdin read failed: {error}"));
                input_failed.store(true, Ordering::Release);
                let _ = post_close(hwnd);
                return;
            }
        }
    }
}

fn post_close(hwnd: HWND) -> bool {
    if unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } == 0 {
        report_error("PostMessageW(WM_CLOSE) failed");
        false
    } else {
        true
    }
}

fn write_pong(output: &Arc<Mutex<OutputState>>, sequence: u32) -> Result<(), String> {
    let mut line = format!(
        "{{\"type\":\"pong\",\"sequence\":{sequence},\"lastEmittedSequence\":"
    );
    let mut state = output
        .lock()
        .map_err(|_| "stdout state mutex poisoned".to_string())?;
    match state.last_emitted_sequence {
        Some(last_sequence) => line.push_str(&last_sequence.to_string()),
        None => line.push_str("null"),
    }
    line.push_str("}\n");
    state
        .writer
        .write_all(line.as_bytes())
        .map_err(|error| format!("stdout write failed: {error}"))?;
    state
        .writer
        .flush()
        .map_err(|error| format!("stdout flush failed: {error}"))
}

fn write_protocol_line(
    output: &Arc<Mutex<OutputState>>,
    line: &[u8],
    event_sequence: Option<u32>,
) -> Result<(), String> {
    let mut state = output
        .lock()
        .map_err(|_| "stdout state mutex poisoned".to_string())?;
    state
        .writer
        .write_all(line)
        .map_err(|error| format!("stdout write failed: {error}"))?;
    state
        .writer
        .flush()
        .map_err(|error| format!("stdout flush failed: {error}"))?;
    if let Some(sequence) = event_sequence {
        state.last_emitted_sequence = Some(sequence);
    }
    Ok(())
}

/// Snapshot the clipboard, retrying a bounded number of times while the content
/// this event is about is still the content on the clipboard.
///
/// The sequence guard is what makes the retry sound: an unchanged sequence means
/// nothing has replaced what `WM_CLIPBOARDUPDATE` reported, so a later
/// successful inspection describes the same content. Once it changes, a newer
/// `WM_CLIPBOARDUPDATE` is already queued for that content and this one stops.
fn snapshot_clipboard_retrying(
    exclude_format: u32,
    can_include_format: u32,
    sequence: u32,
) -> ClipboardSnapshot {
    let mut snapshot = snapshot_clipboard(exclude_format, can_include_format);
    let mut attempt = 0;
    while snapshot.inspection_failed && attempt < INSPECT_RETRY_ATTEMPTS {
        if unsafe { GetClipboardSequenceNumber() } != sequence {
            break;
        }
        thread::sleep(std::time::Duration::from_millis(INSPECT_RETRY_DELAY_MS));
        snapshot = snapshot_clipboard(exclude_format, can_include_format);
        attempt += 1;
    }
    snapshot
}

fn snapshot_clipboard(exclude_format: u32, can_include_format: u32) -> ClipboardSnapshot {
    if !clipboard::open_clipboard_retry() {
        return failed_snapshot();
    }

    let mut snapshot = match unsafe { inspect_clipboard_locked(exclude_format, can_include_format) }
    {
        Ok(snapshot) => snapshot,
        Err(()) => failed_snapshot(),
    };
    if unsafe { CloseClipboard() } == 0 {
        snapshot.formats.clear();
        snapshot.inspection_failed = true;
        snapshot.files = None;
    }
    snapshot
}

unsafe fn inspect_clipboard_locked(
    exclude_format: u32,
    can_include_format: u32,
) -> Result<ClipboardSnapshot, ()> {
    let mut formats = Vec::new();
    let mut current = 0;
    loop {
        SetLastError(ERROR_SUCCESS);
        let next = EnumClipboardFormats(current);
        if next == 0 {
            if GetLastError() != ERROR_SUCCESS {
                return Err(());
            }
            break;
        }
        formats.push(ClipboardFormat {
            id: next,
            name: clipboard_format_name(next),
        });
        current = next;
    }

    let exclude_present = IsClipboardFormatAvailable(exclude_format) != 0;
    let can_include_present = IsClipboardFormatAvailable(can_include_format) != 0;
    let can_include_value = if can_include_present {
        match read_dword_format(can_include_format) {
            Ok(value) => Some(value),
            Err(()) => {
                return Ok(ClipboardSnapshot {
                    formats: Vec::new(),
                    exclude_present,
                    can_include_present: true,
                    can_include_value: None,
                    inspection_failed: true,
                    files: None,
                });
            }
        }
    } else {
        None
    };

    let excluded = exclude_present
        || (can_include_present && can_include_value != Some(1));
    let has_hdrop = formats.iter().any(|format| format.id == clipboard::CF_HDROP);
    let files = if !excluded && has_hdrop {
        clipboard::read_clipboard_locked()
    } else {
        None
    };

    Ok(ClipboardSnapshot {
        formats,
        exclude_present,
        can_include_present,
        can_include_value,
        inspection_failed: false,
        files,
    })
}

unsafe fn read_dword_format(format: u32) -> Result<u32, ()> {
    let handle = GetClipboardData(format);
    if handle == 0 {
        return Err(());
    }
    let hglobal = handle as HGLOBAL;
    if GlobalSize(hglobal) < std::mem::size_of::<u32>() {
        return Err(());
    }
    let ptr = GlobalLock(hglobal) as *const u8;
    if ptr.is_null() {
        return Err(());
    }
    let value = std::ptr::read_unaligned(ptr as *const u32);
    SetLastError(ERROR_SUCCESS);
    let unlock_result = GlobalUnlock(hglobal);
    if unlock_result == 0 && GetLastError() != ERROR_SUCCESS {
        return Err(());
    }
    Ok(value)
}

fn clipboard_format_name(id: u32) -> Option<String> {
    if let Some(name) = standard_format_name(id) {
        return Some(name.to_string());
    }

    let mut buffer = [0u16; 256];
    let length = unsafe {
        GetClipboardFormatNameW(id, buffer.as_mut_ptr(), buffer.len() as i32)
    };
    if length <= 0 || length as usize > buffer.len() {
        None
    } else {
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn standard_format_name(id: u32) -> Option<&'static str> {
    match id {
        1 => Some("CF_TEXT"),
        2 => Some("CF_BITMAP"),
        3 => Some("CF_METAFILEPICT"),
        4 => Some("CF_SYLK"),
        5 => Some("CF_DIF"),
        6 => Some("CF_TIFF"),
        7 => Some("CF_OEMTEXT"),
        8 => Some("CF_DIB"),
        9 => Some("CF_PALETTE"),
        10 => Some("CF_PENDATA"),
        11 => Some("CF_RIFF"),
        12 => Some("CF_WAVE"),
        13 => Some("CF_UNICODETEXT"),
        14 => Some("CF_ENHMETAFILE"),
        15 => Some("CF_HDROP"),
        16 => Some("CF_LOCALE"),
        17 => Some("CF_DIBV5"),
        0x80 => Some("CF_OWNERDISPLAY"),
        0x81 => Some("CF_DSPTEXT"),
        0x82 => Some("CF_DSPBITMAP"),
        0x83 => Some("CF_DSPMETAFILEPICT"),
        0x8e => Some("CF_DSPENHMETAFILE"),
        _ => None,
    }
}

fn serialize_event(
    sequence: u32,
    timestamp_ms: u64,
    snapshot: &ClipboardSnapshot,
) -> String {
    let excluded = snapshot.inspection_failed
        || snapshot.exclude_present
        || (snapshot.can_include_present && snapshot.can_include_value != Some(1));
    let mut json = format!(
        "{{\"type\":\"clipboard-change\",\"sequence\":{sequence},\"timestampMs\":{timestamp_ms},\"formats\":["
    );
    for (index, format) in snapshot.formats.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push_str(&format!("{{\"id\":{},\"name\":", format.id));
        append_optional_json_string(&mut json, format.name.as_deref());
        json.push('}');
    }
    json.push_str("],\"exclusion\":{");
    json.push_str(
        "\"excludeClipboardContentFromMonitorProcessing\":",
    );
    json.push_str(if snapshot.exclude_present { "true" } else { "false" });
    json.push_str(",\"canIncludeInClipboardHistory\":{\"present\":");
    json.push_str(if snapshot.can_include_present { "true" } else { "false" });
    json.push_str(",\"value\":");
    match snapshot.can_include_value {
        Some(value) => json.push_str(&value.to_string()),
        None => json.push_str("null"),
    }
    json.push_str("},\"inspectionFailed\":");
    json.push_str(if snapshot.inspection_failed { "true" } else { "false" });
    json.push_str(",\"excluded\":");
    json.push_str(if excluded { "true" } else { "false" });
    json.push_str("},\"files\":");
    if excluded {
        json.push_str("null");
    } else if let Some((paths, drop_effect)) = &snapshot.files {
        json.push_str("{\"paths\":[");
        for (index, path) in paths.iter().enumerate() {
            if index > 0 {
                json.push(',');
            }
            json.push('"');
            json.push_str(&clipboard::json_escape(path));
            json.push('"');
        }
        json.push_str("],\"dropEffect\":\"");
        json.push_str(drop_effect);
        json.push_str("\"}");
    } else {
        json.push_str("null");
    }
    json.push('}');
    json.push('\n');
    json
}

fn append_optional_json_string(json: &mut String, value: Option<&str>) {
    match value {
        Some(value) => {
            json.push('"');
            json.push_str(&clipboard::json_escape(value));
            json.push('"');
        }
        None => json.push_str("null"),
    }
}

fn failed_snapshot() -> ClipboardSnapshot {
    ClipboardSnapshot {
        formats: Vec::new(),
        exclude_present: false,
        can_include_present: false,
        can_include_value: None,
        inspection_failed: true,
        files: None,
    }
}

fn unix_timestamp_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().min(u64::MAX as u128) as u64,
        Err(_) => 0,
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    match message {
        WM_CLOSE => {
            if DestroyWindow(hwnd) == 0 {
                report_error("DestroyWindow failed while handling WM_CLOSE");
                RemoveClipboardFormatListener(hwnd);
                PostQuitMessage(1);
            }
            0
        }
        WM_DESTROY => {
            if RemoveClipboardFormatListener(hwnd) == 0 {
                report_error("RemoveClipboardFormatListener failed");
            }
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

fn destroy_window(hwnd: HWND) -> Option<String> {
    if unsafe { DestroyWindow(hwnd) } == 0 {
        Some("DestroyWindow failed during cleanup".to_string())
    } else {
        None
    }
}

fn report_cleanup_failure(hwnd: HWND) {
    if let Some(error) = destroy_window(hwnd) {
        report_error(&error);
    }
}

fn report_error(message: &str) {
    let stderr = io::stderr();
    let mut writer = stderr.lock();
    let _ = writeln!(writer, "clipboard-watch: {message}");
}
