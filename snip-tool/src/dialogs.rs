use std::io::Write;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindow, GetWindowTextW, GetWindowTextLengthW, IsWindow,
    SendMessageW, GW_OWNER, IDCANCEL, WM_CLOSE, WM_COMMAND,
};

struct Enumeration {
    owner: HWND,
    windows: Vec<(HWND, String)>,
}

unsafe extern "system" fn collect_owned_dialogs(hwnd: HWND, parameter: LPARAM) -> BOOL {
    let enumeration = &mut *(parameter as *mut Enumeration);
    if GetWindow(hwnd, GW_OWNER) != enumeration.owner {
        return 1;
    }

    let mut class_name = [0u16; 32];
    let class_length = GetClassNameW(hwnd, class_name.as_mut_ptr(), class_name.len() as i32);
    if class_length <= 0 || String::from_utf16_lossy(&class_name[..class_length as usize]) != "#32770" {
        return 1;
    }

    let title_length = GetWindowTextLengthW(hwnd).max(0) as usize;
    let mut title = vec![0u16; title_length + 1];
    let copied = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
    enumeration.windows.push((hwnd, String::from_utf16_lossy(&title[..copied])));
    1
}

fn enumerate(owner: HWND) -> Vec<(HWND, String)> {
    let mut enumeration = Enumeration { owner, windows: Vec::new() };
    unsafe {
        EnumWindows(
            Some(collect_owned_dialogs),
            &mut enumeration as *mut Enumeration as LPARAM,
        );
    }
    enumeration.windows
}

fn json_string(value: &str) -> String {
    let mut escaped = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            control if control.is_control() => escaped.push(' '),
            character => escaped.push(character),
        }
    }
    escaped.push('"');
    escaped
}

fn parse_owner(owner: Option<String>) -> Option<HWND> {
    let value = owner?.parse::<usize>().ok()?;
    // 0 would match every unowned #32770 window, including other applications' dialogs.
    if value == 0 {
        return None;
    }
    Some(value as HWND)
}

fn print_result(cancelled: usize, titles: &[String]) {
    let titles = titles.iter().map(|title| json_string(title)).collect::<Vec<_>>().join(",");
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    let _ = writeln!(output, "{{\"cancelled\":{cancelled},\"titles\":[{titles}]}}");
}

pub fn info(owner: Option<String>) {
    let Some(owner) = parse_owner(owner) else {
        print_result(0, &[]);
        return;
    };
    let titles = enumerate(owner).into_iter().map(|(_, title)| title).collect::<Vec<_>>();
    print_result(0, &titles);
}

/// Up to ~1 s for the window to be destroyed.
unsafe fn wait_until_gone(hwnd: HWND) -> bool {
    for _ in 0..20 {
        if IsWindow(hwnd) == 0 {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    IsWindow(hwnd) == 0
}

pub fn cancel(owner: Option<String>) {
    let Some(owner) = parse_owner(owner) else {
        print_result(0, &[]);
        return;
    };
    let dialogs = enumerate(owner);
    let mut cancelled = 0;
    let mut titles = Vec::with_capacity(dialogs.len());
    for (hwnd, title) in dialogs {
        titles.push(title);
        unsafe {
            SendMessageW(hwnd, WM_COMMAND, IDCANCEL as WPARAM, 0);
            // The common item dialog tears its window down after the message returns.
            if !wait_until_gone(hwnd) {
                SendMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            if wait_until_gone(hwnd) {
                cancelled += 1;
            }
        }
    }
    print_result(cancelled, &titles);
}
