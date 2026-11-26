use dbus::arg::{RefArg, Variant};
use dbus::blocking::Connection;
use dbus::message::MatchRule;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use url::Url;

const PORTAL_NAME: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const REQUEST_INTERFACE: &str = "org.freedesktop.portal.Request";
const SCREENSHOT_INTERFACE: &str = "org.freedesktop.portal.Screenshot";

struct PortalResponse {
    response: u32,
    results: HashMap<String, Variant<Box<dyn RefArg>>>,
    path: String,
    sender: String,
}

pub fn capture() -> Result<(), String> {
    let connection = Connection::new_session().map_err(|error| format!("session bus: {error}"))?;
    let token = random_token()?;
    let unique_name = connection.unique_name().to_string();
    let request_path = format!(
        "/org/freedesktop/portal/desktop/request/{}/{}",
        unique_name.trim_start_matches(':').replace('.', "_"),
        token
    );
    let responses = Arc::new(Mutex::new(VecDeque::new()));

    let mut response_rule = MatchRule::new_signal(REQUEST_INTERFACE, "Response");
    response_rule.sender = Some(PORTAL_NAME.into());
    let queued_responses = Arc::clone(&responses);
    let _response_match = connection
        .add_match(
            response_rule,
            move |(response, results): (u32, HashMap<String, Variant<Box<dyn RefArg>>>),
                  _,
                  message| {
                let event = PortalResponse {
                    response,
                    results,
                    path: message
                        .path()
                        .map(|path| path.to_string())
                        .unwrap_or_default(),
                    sender: message
                        .sender()
                        .map(|sender| sender.to_string())
                        .unwrap_or_default(),
                };
                if let Ok(mut queue) = queued_responses.lock() {
                    queue.push_back(event);
                }
                true
            },
        )
        .map_err(|error| format!("subscribe to screenshot portal: {error}"))?;

    let mut options: HashMap<&str, Variant<Box<dyn RefArg>>> = HashMap::new();
    options.insert("interactive", Variant(Box::new(true)));
    options.insert("handle_token", Variant(Box::new(token)));

    let proxy = connection.with_proxy(PORTAL_NAME, PORTAL_PATH, Duration::from_secs(30));
    let (returned_path,): (dbus::Path<'static>,) = proxy
        .method_call(SCREENSHOT_INTERFACE, "Screenshot", ("", options))
        .map_err(|error| format!("request screenshot: {error}"))?;
    let expected_path = returned_path.to_string();
    if expected_path != request_path {
        return Err("screenshot portal returned an unexpected request handle".to_string());
    }

    let response = loop {
        if let Some(response) = responses
            .lock()
            .map_err(|_| "portal response queue is unavailable".to_string())?
            .pop_front()
        {
            if response.path == expected_path && response.sender.starts_with(':') {
                break response;
            }
            continue;
        }
        connection
            .process(Duration::from_secs(60))
            .map_err(|error| format!("wait for screenshot portal: {error}"))?;
    };

    if response.response != 0 {
        return Ok(());
    }

    let uri = response
        .results
        .get("uri")
        .and_then(|value| value.0.as_str())
        .ok_or_else(|| "screenshot portal returned no URI".to_string())?;
    let url = Url::parse(uri).map_err(|error| format!("invalid screenshot URI: {error}"))?;
    if url.scheme() != "file" || url.host_str().is_some_and(|host| host != "localhost") {
        return Err("screenshot portal returned a non-local file URI".to_string());
    }
    let file_path = url
        .to_file_path()
        .map_err(|()| "screenshot portal returned an invalid local file URI".to_string())?;
    let png = fs::read(&file_path).map_err(|error| format!("read screenshot file: {error}"))?;

    if let Err(error) = fs::remove_file(&file_path) {
        eprintln!("persephone-snip: could not remove portal screenshot file: {error}");
    }

    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    output
        .write_all(&png)
        .and_then(|()| output.flush())
        .map_err(|error| format!("write screenshot to stdout: {error}"))
}

fn random_token() -> Result<String, String> {
    let mut random_bytes = [0_u8; 16];
    fs::File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut random_bytes))
        .map_err(|error| format!("generate portal request token: {error}"))?;
    Ok(random_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
