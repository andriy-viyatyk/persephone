// js-notepad-launcher: Fast entry point for file/URL opening.
//
// When js-notepad is running, sends arguments via Named Pipe and exits instantly.
// When not running, spawns js-notepad.exe with the arguments.
//
// Protocol:
//   SHOW\n                          — bring existing window to front
//   OPEN <absolute-path-or-url>\n   — open a file or URL
//   DIFF <absolute-path1>\t<absolute-path2>\n — open diff comparison
//   END\n                           — signal end of messages
//
// Usage:
//   js-notepad-launcher.exe                   (no args: show or launch)
//   js-notepad-launcher.exe <file-or-url> ...
//   js-notepad-launcher.exe diff <file1> <file2>

#![windows_subsystem = "windows"]

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;

const DETACHED_PROCESS: u32 = 0x00000008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const ASFW_ANY: u32 = 0xFFFFFFFF;

#[link(name = "user32")]
extern "system" {
    fn AllowSetForegroundWindow(process_id: u32) -> i32;
}

/// Grant any process permission to steal foreground focus.
/// The launcher is the foreground app (just launched by Explorer),
/// so Windows allows it to pass this right to js-notepad.
fn allow_foreground() {
    unsafe { AllowSetForegroundWindow(ASFW_ANY); }
}

fn get_pipe_path() -> String {
    let username = env::var("USERNAME").unwrap_or_else(|_| "unknown".to_string());
    format!(r"\\.\pipe\js-notepad-{}", username)
}

fn is_url(arg: &str) -> bool {
    arg.starts_with("http://") || arg.starts_with("https://")
}

fn resolve_path(arg: &str) -> String {
    if is_url(arg) {
        return arg.to_string();
    }

    let path = Path::new(arg);
    if path.is_absolute() {
        return arg.to_string();
    }

    // Resolve relative path against current working directory
    match env::current_dir() {
        Ok(cwd) => {
            let resolved = cwd.join(path);
            // Use canonicalize to resolve . and .. components
            match fs::canonicalize(&resolved) {
                Ok(canonical) => canonical.to_string_lossy().to_string(),
                // If canonicalize fails (file doesn't exist yet), use the joined path
                Err(_) => resolved.to_string_lossy().to_string(),
            }
        }
        Err(_) => arg.to_string(),
    }
}

/// Strip the \\?\ prefix that canonicalize adds on Windows
fn clean_path(path: String) -> String {
    if let Some(stripped) = path.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        path
    }
}

fn resolve_arg(arg: &str) -> String {
    clean_path(resolve_path(arg))
}

fn try_send_via_pipe(pipe_path: &str, messages: &str) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(pipe_path)?;

    file.write_all(messages.as_bytes())?;
    file.flush()?;

    Ok(())
}

fn get_exe_path() -> PathBuf {
    // js-notepad.exe is in the same directory as the launcher
    let launcher_path = env::current_exe().unwrap_or_default();
    let launcher_dir = launcher_path.parent().unwrap_or_else(|| Path::new("."));
    launcher_dir.join("js-notepad.exe")
}

fn spawn_electron(args: &[String]) {
    let exe_path = get_exe_path();

    let mut cmd = Command::new(&exe_path);
    cmd.args(args);

    // Set CWD so Electron's second-instance handler can resolve relative paths
    if let Ok(cwd) = env::current_dir() {
        cmd.current_dir(cwd);
    }

    // Detach the child process so the launcher can exit immediately
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);

    // We don't care if spawn fails — nothing we can do about it
    let _ = cmd.spawn();
}

fn main() {
    let raw_args: Vec<String> = env::args().skip(1).collect();

    if raw_args.is_empty() {
        // No arguments — try to bring existing instance to front via pipe
        let pipe_path = get_pipe_path();
        allow_foreground();
        if try_send_via_pipe(&pipe_path, "SHOW\nEND\n").is_ok() {
            return; // Existing instance activated
        }
        // No running instance — launch the app
        spawn_electron(&[]);
        return;
    }

    // Detect "diff" mode: js-notepad-launcher.exe diff <file1> <file2>
    let is_diff = raw_args[0].eq_ignore_ascii_case("diff") && raw_args.len() >= 3;

    // Build the pipe message
    let message = if is_diff {
        let first = resolve_arg(&raw_args[1]);
        let second = resolve_arg(&raw_args[2]);
        format!("DIFF {}\t{}\nEND\n", first, second)
    } else {
        let mut msg = String::new();
        for arg in &raw_args {
            let resolved = resolve_arg(arg);
            msg.push_str(&format!("OPEN {}\n", resolved));
        }
        msg.push_str("END\n");
        msg
    };

    // Try to send via Named Pipe (app is running)
    let pipe_path = get_pipe_path();
    allow_foreground();
    if try_send_via_pipe(&pipe_path, &message).is_ok() {
        // Success — message delivered, exit immediately
        return;
    }

    // Pipe not available — spawn Electron with the resolved arguments
    if is_diff {
        let first = resolve_arg(&raw_args[1]);
        let second = resolve_arg(&raw_args[2]);
        spawn_electron(&["diff".to_string(), first, second]);
    } else {
        let resolved: Vec<String> = raw_args.iter().map(|a| resolve_arg(a)).collect();
        spawn_electron(&resolved);
    }
}
