use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use url::Url;

const CREDENTIALS_FILE: &str = "google-calendar-client.json";
const TOKEN_FILE: &str = "google-calendar-token.bin";
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";

#[derive(Clone, Deserialize, Serialize)]
struct GoogleClientCredentials {
    client_id: String,
    client_secret: String,
    auth_uri: String,
    token_uri: String,
}

#[derive(Deserialize, Serialize)]
struct GoogleCredentialFile {
    installed: Option<GoogleClientCredentials>,
}

#[derive(Deserialize, Serialize)]
struct StoredTokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleCalendarStatus {
    configured: bool,
    connected: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCalendarEventRequest {
    title: String,
    start: String,
    end: String,
    color_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedCalendarEvent {
    id: String,
    html_link: String,
    summary: String,
}

fn now_epoch() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("The system clock is unavailable: {error}"))
}

fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("The application data folder is unavailable: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("The application data folder could not be created: {error}"))?;
    Ok(directory)
}

fn credentials_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(CREDENTIALS_FILE))
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(TOKEN_FILE))
}

fn parse_credentials(contents: &str) -> Result<GoogleClientCredentials, String> {
    let file: GoogleCredentialFile = serde_json::from_str(contents)
        .map_err(|error| format!("That file is not valid Google OAuth JSON: {error}"))?;
    let credentials = file.installed.ok_or_else(|| {
        "Choose OAuth credentials created for a Desktop app, not a Web application".to_string()
    })?;

    if credentials.client_id.trim().is_empty()
        || credentials.auth_uri != "https://accounts.google.com/o/oauth2/auth"
            && credentials.auth_uri != "https://accounts.google.com/o/oauth2/v2/auth"
        || credentials.token_uri != "https://oauth2.googleapis.com/token"
    {
        return Err("The OAuth client file is missing the expected Google desktop fields".into());
    }

    Ok(credentials)
}

fn load_credentials(app: &tauri::AppHandle) -> Result<GoogleClientCredentials, String> {
    let contents = fs::read_to_string(credentials_path(app)?).map_err(|_| {
        "Google Calendar is not configured yet. Import the Desktop OAuth JSON first".to_string()
    })?;
    parse_credentials(&contents)
}

#[cfg(target_os = "windows")]
fn protect_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            windows::core::w!("Control Panel Google Calendar"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows could not protect the Calendar token: {error}"))?;
        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn unprotect_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows could not unlock the Calendar token: {error}"))?;
        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
fn protect_bytes(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure Google token storage is currently configured for Windows".into())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_bytes(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure Google token storage is currently configured for Windows".into())
}

fn save_tokens(app: &tauri::AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    let serialized = serde_json::to_vec(tokens)
        .map_err(|error| format!("The Calendar token could not be prepared: {error}"))?;
    let encrypted = protect_bytes(&serialized)?;
    fs::write(token_path(app)?, encrypted)
        .map_err(|error| format!("The Calendar token could not be saved: {error}"))
}

fn load_tokens(app: &tauri::AppHandle) -> Result<StoredTokens, String> {
    let encrypted = fs::read(token_path(app)?)
        .map_err(|_| "Google Calendar is not connected yet".to_string())?;
    let decrypted = unprotect_bytes(&encrypted)?;
    serde_json::from_slice(&decrypted)
        .map_err(|error| format!("The saved Calendar token is invalid: {error}"))
}

fn remove_tokens(app: &tauri::AppHandle) -> Result<(), String> {
    let path = token_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!("The saved Calendar connection could not be removed: {error}")
        })?;
    }
    Ok(())
}

fn random_urlsafe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn send_browser_response(stream: &mut std::net::TcpStream, success: bool) {
    let (title, message, color) = if success {
        (
            "Calendar connected",
            "You can close this tab and return to Control Panel.",
            "#daa64b",
        )
    } else {
        (
            "Connection failed",
            "Return to Control Panel for details and try again.",
            "#ef7b6d",
        )
    };
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title></head><body style=\"margin:0;background:#060706;color:#e7e5e4;font:16px Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center\"><main style=\"width:min(420px,calc(100% - 40px));padding:32px;border:1px solid #292c29;border-radius:16px;background:#101210;box-shadow:0 24px 64px #000\"><div style=\"width:10px;height:10px;border-radius:50%;background:{color};box-shadow:0 0 14px {color};margin-bottom:22px\"></div><h1 style=\"font-size:24px;margin:0 0 10px\">{title}</h1><p style=\"color:#a8a29e;line-height:1.55;margin:0\">{message}</p></main></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(), body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn response_error(response: reqwest::blocking::Response, context: &str) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .or_else(|| {
            serde_json::from_str::<Value>(&body).ok().and_then(|value| {
                value
                    .get("error_description")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
        })
        .unwrap_or_else(|| format!("Google returned {status}"));
    format!("{context}: {message}")
}

fn connect_blocking(app: tauri::AppHandle) -> Result<GoogleCalendarStatus, String> {
    let credentials = load_credentials(&app)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("The local Google sign-in callback could not start: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("The Google sign-in callback could not be configured: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("The Google sign-in callback address is unavailable: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);

    let mut authorization_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|error| format!("The Google authorization URL is invalid: {error}"))?;
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", &credentials.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", CALENDAR_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    #[cfg(target_os = "windows")]
    #[allow(deprecated)]
    app.shell()
        .open(authorization_url.as_str(), None)
        .map_err(|error| format!("The Google sign-in page could not be opened: {error}"))?;

    #[cfg(not(target_os = "windows"))]
    return Err("Google Calendar sign-in is currently configured for Windows".into());

    let deadline = Instant::now() + Duration::from_secs(180);
    let code = loop {
        if Instant::now() >= deadline {
            return Err(
                "Google sign-in timed out. Open Quick schedule and try Connect again".into(),
            );
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let size = stream.read(&mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..size]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback_url = Url::parse(&format!("http://127.0.0.1{path}"));
                let Ok(callback_url) = callback_url else {
                    send_browser_response(&mut stream, false);
                    continue;
                };
                let params = callback_url
                    .query_pairs()
                    .into_owned()
                    .collect::<std::collections::HashMap<_, _>>();
                if params.get("state") != Some(&state) {
                    send_browser_response(&mut stream, false);
                    return Err("Google sign-in returned an invalid security state".into());
                }
                if let Some(error) = params.get("error") {
                    send_browser_response(&mut stream, false);
                    return Err(format!("Google sign-in was not completed: {error}"));
                }
                if let Some(code) = params.get("code") {
                    send_browser_response(&mut stream, true);
                    break code.clone();
                }
                send_browser_response(&mut stream, false);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("The Google sign-in callback failed: {error}")),
        }
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Google connection client could not start: {error}"))?;
    let response = client
        .post(&credentials.token_uri)
        .form(&[
            ("client_id", credentials.client_id.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .map_err(|error| format!("Google could not exchange the authorization code: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Google sign-in failed"));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|error| format!("Google returned an unreadable token: {error}"))?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        "Google did not return offline access. Disconnect the app in your Google Account and try again".to_string()
    })?;
    save_tokens(
        &app,
        &StoredTokens {
            access_token: token.access_token,
            refresh_token,
            expires_at: now_epoch()?.saturating_add(token.expires_in.unwrap_or(3600)),
        },
    )?;

    Ok(GoogleCalendarStatus {
        configured: true,
        connected: true,
    })
}

fn refresh_access_token(
    app: &tauri::AppHandle,
    credentials: &GoogleClientCredentials,
    mut tokens: StoredTokens,
) -> Result<StoredTokens, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Google connection client could not start: {error}"))?;
    let response = client
        .post(&credentials.token_uri)
        .form(&[
            ("client_id", credentials.client_id.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|error| format!("Google Calendar could not refresh its connection: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(
            response,
            "Google Calendar needs to be connected again",
        ));
    }
    let refreshed: TokenResponse = response
        .json()
        .map_err(|error| format!("Google returned an unreadable refresh token: {error}"))?;
    tokens.access_token = refreshed.access_token;
    tokens.expires_at = now_epoch()?.saturating_add(refreshed.expires_in.unwrap_or(3600));
    save_tokens(app, &tokens)?;
    Ok(tokens)
}

fn access_token(app: &tauri::AppHandle, force_refresh: bool) -> Result<String, String> {
    let credentials = load_credentials(app)?;
    let tokens = load_tokens(app)?;
    if !force_refresh && tokens.expires_at > now_epoch()?.saturating_add(60) {
        return Ok(tokens.access_token);
    }
    Ok(refresh_access_token(app, &credentials, tokens)?.access_token)
}

fn send_event(
    client: &Client,
    token: &str,
    body: &Value,
) -> Result<reqwest::blocking::Response, String> {
    client
        .post("https://www.googleapis.com/calendar/v3/calendars/primary/events")
        .bearer_auth(token)
        .json(body)
        .send()
        .map_err(|error| format!("The event could not reach Google Calendar: {error}"))
}

fn create_event_blocking(
    app: tauri::AppHandle,
    request: CreateCalendarEventRequest,
) -> Result<CreatedCalendarEvent, String> {
    let title = request.title.trim();
    if title.is_empty() {
        return Err("Add a title before saving the event".into());
    }
    if title.chars().count() > 512 {
        return Err("The event title is too long".into());
    }
    if !request.start.ends_with('Z') || !request.end.ends_with('Z') || request.end <= request.start
    {
        return Err("Choose a valid end time after the start time".into());
    }
    if let Some(color) = &request.color_id {
        let valid = color
            .parse::<u8>()
            .is_ok_and(|value| (1..=11).contains(&value));
        if !valid {
            return Err("Choose one of the available Google Calendar colors".into());
        }
    }

    let mut body = json!({
        "summary": title,
        "start": { "dateTime": request.start },
        "end": { "dateTime": request.end }
    });
    if let Some(color) = request.color_id {
        body["colorId"] = Value::String(color);
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Google connection client could not start: {error}"))?;
    let token = access_token(&app, false)?;
    let mut response = send_event(&client, &token, &body)?;
    if response.status() == StatusCode::UNAUTHORIZED {
        let token = access_token(&app, true)?;
        response = send_event(&client, &token, &body)?;
    }
    if !response.status().is_success() {
        return Err(response_error(
            response,
            "Google Calendar could not create the event",
        ));
    }
    let event: Value = response
        .json()
        .map_err(|error| format!("Google returned an unreadable event: {error}"))?;

    Ok(CreatedCalendarEvent {
        id: event
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        html_link: event
            .get("htmlLink")
            .and_then(Value::as_str)
            .unwrap_or("https://calendar.google.com")
            .to_string(),
        summary: event
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or(title)
            .to_string(),
    })
}

#[tauri::command]
pub(crate) fn get_google_calendar_status(
    app: tauri::AppHandle,
) -> Result<GoogleCalendarStatus, String> {
    let configured = credentials_path(&app)?.is_file();
    let connected = configured && load_tokens(&app).is_ok();
    Ok(GoogleCalendarStatus {
        configured,
        connected,
    })
}

#[tauri::command]
pub(crate) fn import_google_calendar_credentials(
    app: tauri::AppHandle,
    path: String,
) -> Result<GoogleCalendarStatus, String> {
    let source = Path::new(&path);
    if !source.is_file() {
        return Err("The selected OAuth JSON file could not be found".into());
    }
    let contents = fs::read_to_string(source)
        .map_err(|error| format!("The OAuth JSON file could not be read: {error}"))?;
    let credentials = parse_credentials(&contents)?;
    let normalized = serde_json::to_string_pretty(&GoogleCredentialFile {
        installed: Some(credentials),
    })
    .map_err(|error| format!("The OAuth configuration could not be prepared: {error}"))?;
    fs::write(credentials_path(&app)?, normalized)
        .map_err(|error| format!("The OAuth configuration could not be saved: {error}"))?;
    remove_tokens(&app)?;
    Ok(GoogleCalendarStatus {
        configured: true,
        connected: false,
    })
}

#[tauri::command]
pub(crate) async fn connect_google_calendar(
    app: tauri::AppHandle,
) -> Result<GoogleCalendarStatus, String> {
    tauri::async_runtime::spawn_blocking(move || connect_blocking(app))
        .await
        .map_err(|error| format!("The Google sign-in task stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub(crate) fn disconnect_google_calendar(
    app: tauri::AppHandle,
) -> Result<GoogleCalendarStatus, String> {
    remove_tokens(&app)?;
    Ok(GoogleCalendarStatus {
        configured: credentials_path(&app)?.is_file(),
        connected: false,
    })
}

#[tauri::command]
pub(crate) async fn create_google_calendar_event(
    app: tauri::AppHandle,
    request: CreateCalendarEventRequest,
) -> Result<CreatedCalendarEvent, String> {
    tauri::async_runtime::spawn_blocking(move || create_event_blocking(app, request))
        .await
        .map_err(|error| format!("The Calendar request stopped unexpectedly: {error}"))?
}
