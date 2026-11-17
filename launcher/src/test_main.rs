use std::env;
use std::path::Path;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let current_exe = match env::current_exe() {
        Ok(path) => path,
        Err(error) => { eprintln!("Could not locate Persephone test runner: {error}"); return ExitCode::from(1); }
    };
    let app_exe = current_exe.parent().unwrap_or_else(|| Path::new(".")).join("persephone.exe");
    let mut command = Command::new(app_exe);
    command.arg("--test").args(env::args_os().skip(1));
    match command.status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(error) => { eprintln!("Could not start Persephone test runner: {error}"); ExitCode::from(1) }
    }
}
