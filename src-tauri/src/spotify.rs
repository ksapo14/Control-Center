use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use url::Url;

const CLIENT_FILE: &str = "spotify-client.json";
const TOKEN_FILE: &str = "spotify-token.bin";
const CALLBACK_PATH: &str = "/spotify/callback";
const SPOTIFY_SCOPES: &str =
    "user-read-playback-state user-read-currently-playing user-modify-playback-state";

#[derive(Deserialize, Serialize)]
struct SpotifyClientConfig {
    client_id: String,
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
/// Spotify client configuration and authorization state exposed to the frontend.
pub(crate) struct SpotifyStatus {
    configured: bool,
    connected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// Normalized playback metadata used by the Spotify dashboard deck.
pub(crate) struct SpotifyPlayback {
    connected: bool,
    is_playing: bool,
    track_name: Option<String>,
    artists: Option<String>,
    album_name: Option<String>,
    device_name: Option<String>,
    progress_ms: u64,
    duration_ms: u64,
}

fn now_epoch() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("The system clock is unavailable: {error}"))
}

/// Resolves and creates the application-specific configuration directory.
///
/// # Arguments
/// * `app` - Tauri handle used for platform-aware path resolution.
///
/// # Returns
/// The writable configuration directory.
///
/// # Errors
/// Returns an error when the path cannot be resolved or created.
fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("The application data folder is unavailable: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("The application data folder could not be created: {error}"))?;
    Ok(directory)
}

fn client_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(CLIENT_FILE))
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(TOKEN_FILE))
}

/// Loads the saved public Spotify client configuration.
///
/// # Arguments
/// * `app` - Handle used to resolve storage.
///
/// # Returns
/// The configured client ID.
///
/// # Errors
/// Returns an error when configuration is absent, unreadable, or invalid.
fn load_client(app: &tauri::AppHandle) -> Result<SpotifyClientConfig, String> {
    let contents = fs::read_to_string(client_path(app)?).map_err(|_| {
        "Spotify is not configured yet. Enter the Client ID from your Spotify developer app"
            .to_string()
    })?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("The saved Spotify Client ID is invalid: {error}"))
}

#[cfg(target_os = "windows")]
/// Encrypts Spotify OAuth tokens for the current Windows user with DPAPI.
///
/// # Arguments
/// * `data` - Plaintext token bytes.
///
/// # Returns
/// DPAPI-protected bytes.
///
/// # Errors
/// Returns an error when Windows cannot protect the token.
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
            windows::core::w!("Control Panel Spotify"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows could not protect the Spotify token: {error}"))?;
        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
/// Decrypts Spotify OAuth tokens protected for the current Windows user.
///
/// # Arguments
/// * `data` - DPAPI-protected token bytes.
///
/// # Returns
/// The recovered plaintext bytes.
///
/// # Errors
/// Returns an error when Windows cannot unlock the token.
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
        .map_err(|error| format!("Windows could not unlock the Spotify token: {error}"))?;
        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
fn protect_bytes(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure Spotify token storage is currently configured for Windows".into())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_bytes(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure Spotify token storage is currently configured for Windows".into())
}

/// Saves the Spotify OAuth session in DPAPI-protected storage.
///
/// # Arguments
/// * `app` - Handle used to resolve storage.
/// * `tokens` - Access, refresh, and expiry values to persist.
///
/// # Returns
/// Success after the protected token file is written.
///
/// # Errors
/// Returns an error when serialization, encryption, or writing fails.
fn save_tokens(app: &tauri::AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    let serialized = serde_json::to_vec(tokens)
        .map_err(|error| format!("The Spotify token could not be prepared: {error}"))?;
    let encrypted = protect_bytes(&serialized)?;
    fs::write(token_path(app)?, encrypted)
        .map_err(|error| format!("The Spotify token could not be saved: {error}"))
}

fn load_tokens(app: &tauri::AppHandle) -> Result<StoredTokens, String> {
    let encrypted =
        fs::read(token_path(app)?).map_err(|_| "Spotify is not connected yet".to_string())?;
    let decrypted = unprotect_bytes(&encrypted)?;
    serde_json::from_slice(&decrypted)
        .map_err(|error| format!("The saved Spotify token is invalid: {error}"))
}

fn remove_tokens(app: &tauri::AppHandle) -> Result<(), String> {
    let path = token_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!("The saved Spotify connection could not be removed: {error}")
        })?;
    }
    Ok(())
}

/// Generates cryptographically random, URL-safe OAuth material.
///
/// # Arguments
/// * `byte_count` - Number of random bytes before Base64URL encoding.
///
/// # Returns
/// An unpadded Base64URL string.
fn random_urlsafe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Converts Spotify error payloads and common playback statuses into actionable messages.
///
/// # Arguments
/// * `response` - Unsuccessful HTTP response to consume.
/// * `context` - Operation-specific prefix.
///
/// # Returns
/// The best available Spotify error description with device guidance when relevant.
fn response_error(response: reqwest::blocking::Response, context: &str) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    let parsed = serde_json::from_str::<Value>(&body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("error_description").and_then(Value::as_str))
        })
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("error").and_then(Value::as_str))
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Spotify returned {status}"));
    if status == StatusCode::NOT_FOUND {
        format!("{context}: no active Spotify device was found. Open Spotify on a device, play anything once, and retry")
    } else if status == StatusCode::FORBIDDEN {
        format!("{context}: {message}. Spotify playback controls require Premium and an active controllable device")
    } else {
        format!("{context}: {message}")
    }
}

/// Sends a minimal completion page to the temporary OAuth callback connection.
///
/// # Arguments
/// * `stream` - Browser TCP connection accepted by the loopback listener.
/// * `success` - Whether authorization completed successfully.
///
/// # Side Effects
/// Writes and flushes an HTTP response; browser disconnect errors are intentionally ignored.
fn send_browser_response(stream: &mut std::net::TcpStream, success: bool) {
    let (title, message, color) = if success {
        (
            "Spotify connected",
            "You can close this tab and return to Control Panel.",
            "#d9a84e",
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

/// Runs the blocking PKCE browser authorization and persists the resulting token set.
///
/// # Arguments
/// * `app` - Handle used for browser launch and protected storage.
///
/// # Returns
/// Connected Spotify status.
///
/// # Errors
/// Returns an error for listener, browser, callback, token-exchange, or storage failures.
fn connect_blocking(app: tauri::AppHandle) -> Result<SpotifyStatus, String> {
    // --- Loopback Callback Setup ---
    let config = load_client(&app)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("The local Spotify sign-in callback could not start: {error}"))?;
    listener.set_nonblocking(true).map_err(|error| {
        format!("The Spotify sign-in callback could not be configured: {error}")
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("The Spotify sign-in callback address is unavailable: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);

    // --- PKCE Authorization Request ---
    let mut authorization_url = Url::parse("https://accounts.spotify.com/authorize")
        .map_err(|error| format!("The Spotify authorization URL is invalid: {error}"))?;
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", SPOTIFY_SCOPES)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge)
        .append_pair("state", &state);

    #[cfg(target_os = "windows")]
    #[allow(deprecated)]
    app.shell()
        .open(authorization_url.as_str(), None)
        .map_err(|error| format!("The Spotify sign-in page could not be opened: {error}"))?;

    #[cfg(not(target_os = "windows"))]
    return Err("Spotify sign-in is currently configured for Windows".into());

    // --- Browser Callback Validation ---
    let deadline = Instant::now() + Duration::from_secs(180);
    // The loopback listener remains bounded so abandoned browser flows cannot block a worker forever.
    let code = loop {
        if Instant::now() >= deadline {
            return Err(
                "Spotify sign-in timed out. Return to Control Panel and try Connect again".into(),
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
                if !path.starts_with(CALLBACK_PATH) {
                    send_browser_response(&mut stream, false);
                    continue;
                }
                let Ok(callback_url) = Url::parse(&format!("http://127.0.0.1{path}")) else {
                    send_browser_response(&mut stream, false);
                    continue;
                };
                let params = callback_url
                    .query_pairs()
                    .into_owned()
                    .collect::<std::collections::HashMap<_, _>>();
                if params.get("state") != Some(&state) {
                    send_browser_response(&mut stream, false);
                    return Err("Spotify sign-in returned an invalid security state".into());
                }
                if let Some(error) = params.get("error") {
                    send_browser_response(&mut stream, false);
                    return Err(format!("Spotify sign-in was not completed: {error}"));
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
            Err(error) => return Err(format!("The Spotify sign-in callback failed: {error}")),
        }
    };

    // --- Authorization-Code Exchange ---
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Spotify connection client could not start: {error}"))?;
    let response = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .map_err(|error| format!("Spotify could not exchange the authorization code: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Spotify sign-in failed"));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|error| format!("Spotify returned an invalid token response: {error}"))?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(|| "Spotify did not return a refresh token".to_string())?;
    save_tokens(
        &app,
        &StoredTokens {
            access_token: token.access_token,
            refresh_token,
            expires_at: now_epoch()? + token.expires_in.unwrap_or(3600).saturating_sub(60),
        },
    )?;
    Ok(SpotifyStatus {
        configured: true,
        connected: true,
    })
}

/// Refreshes an expired Spotify session and persists rotated token values.
///
/// # Arguments
/// * `app` - Handle used for client configuration and token storage.
/// * `tokens` - Existing OAuth session.
///
/// # Returns
/// The original tokens when still valid, otherwise the refreshed set.
///
/// # Errors
/// Returns an error when configuration, refresh, parsing, or storage fails.
fn refresh_tokens(
    app: &tauri::AppHandle,
    mut tokens: StoredTokens,
) -> Result<StoredTokens, String> {
    if tokens.expires_at > now_epoch()? + 30 {
        return Ok(tokens);
    }
    let config = load_client(app)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Spotify refresh client could not start: {error}"))?;
    let response = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("client_id", config.client_id.as_str()),
        ])
        .send()
        .map_err(|error| format!("Spotify could not refresh the connection: {error}"))?;
    if !response.status().is_success() {
        if response.status() == StatusCode::BAD_REQUEST {
            let _ = remove_tokens(app);
        }
        return Err(response_error(
            response,
            "Spotify connection refresh failed",
        ));
    }
    let refreshed: TokenResponse = response
        .json()
        .map_err(|error| format!("Spotify returned an invalid refresh response: {error}"))?;
    tokens.access_token = refreshed.access_token;
    if let Some(refresh_token) = refreshed.refresh_token {
        tokens.refresh_token = refresh_token;
    }
    tokens.expires_at = now_epoch()? + refreshed.expires_in.unwrap_or(3600).saturating_sub(60);
    save_tokens(app, &tokens)?;
    Ok(tokens)
}

/// Returns a usable Spotify bearer token, refreshing the saved session when needed.
///
/// # Arguments
/// * `app` - Handle used to load and persist OAuth state.
///
/// # Returns
/// A current access token.
///
/// # Errors
/// Returns an error when the session is missing or cannot be refreshed.
fn access_token(app: &tauri::AppHandle) -> Result<String, String> {
    refresh_tokens(app, load_tokens(app)?).map(|tokens| tokens.access_token)
}

/// Sends one authenticated Spotify Web API request with consistent response handling.
///
/// # Arguments
/// * `app` - Handle used to obtain an access token.
/// * `method` - HTTP method required by the endpoint.
/// * `endpoint` - API path relative to `/v1`.
/// * `body` - Optional JSON request body.
/// * `context` - Operation-specific error prefix.
///
/// # Returns
/// Parsed JSON, or `None` for successful no-content responses.
///
/// # Errors
/// Returns an error for authentication, transport, API, or JSON failures.
fn spotify_request(
    app: &tauri::AppHandle,
    method: Method,
    endpoint: &str,
    body: Option<Value>,
    context: &str,
) -> Result<Option<Value>, String> {
    let token = access_token(app)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("The Spotify API client could not start: {error}"))?;
    let mut request = client
        .request(method, format!("https://api.spotify.com/v1{endpoint}"))
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    } else {
        request = request.body(Vec::new());
    }
    let response = request
        .send()
        .map_err(|error| format!("{context}: {error}"))?;
    if response.status() == StatusCode::NO_CONTENT {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(response_error(response, context));
    }
    response
        .json::<Value>()
        .map(Some)
        .map_err(|error| format!("Spotify returned invalid playback data: {error}"))
}

#[tauri::command]
/// Reports whether a Spotify client ID and OAuth session are locally available.
///
/// # Arguments
/// * `app` - Handle used to inspect application storage.
///
/// # Returns
/// Current configuration and connection flags.
///
/// # Errors
/// Returns an error only when application storage paths cannot be resolved.
pub(crate) fn get_spotify_status(app: tauri::AppHandle) -> Result<SpotifyStatus, String> {
    let configured = client_path(&app)?.is_file();
    let connected = configured && load_tokens(&app).is_ok();
    Ok(SpotifyStatus {
        configured,
        connected,
    })
}

#[tauri::command]
/// Validates and saves a public Spotify client ID for PKCE authorization.
///
/// # Arguments
/// * `app` - Handle used for configuration storage.
/// * `client_id` - Client ID copied from the Spotify developer dashboard.
///
/// # Returns
/// Configured but disconnected Spotify status.
///
/// # Errors
/// Returns an error for malformed IDs or failed persistence.
///
/// # Side Effects
/// Replaces configuration and removes any session tied to the previous client.
pub(crate) fn configure_spotify(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<SpotifyStatus, String> {
    let client_id = client_id.trim();
    if client_id.len() < 16
        || client_id.len() > 128
        || !client_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(
            "Enter the Client ID exactly as shown in the Spotify developer dashboard".into(),
        );
    }
    let serialized = serde_json::to_vec_pretty(&SpotifyClientConfig {
        client_id: client_id.to_string(),
    })
    .map_err(|error| format!("The Spotify Client ID could not be prepared: {error}"))?;
    fs::write(client_path(&app)?, serialized)
        .map_err(|error| format!("The Spotify Client ID could not be saved: {error}"))?;
    remove_tokens(&app)?;
    Ok(SpotifyStatus {
        configured: true,
        connected: false,
    })
}

#[tauri::command]
/// Runs Spotify browser authorization on a blocking worker thread.
///
/// # Arguments
/// * `app` - Handle moved into the authorization workflow.
///
/// # Returns
/// Connected Spotify status.
///
/// # Errors
/// Returns authorization errors or an unexpected worker-task failure.
pub(crate) async fn connect_spotify(app: tauri::AppHandle) -> Result<SpotifyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || connect_blocking(app))
        .await
        .map_err(|error| format!("The Spotify connection task failed: {error}"))?
}

#[tauri::command]
/// Removes the local Spotify OAuth session while retaining client configuration.
///
/// # Arguments
/// * `app` - Handle used for token storage.
///
/// # Returns
/// Disconnected status with the remaining configuration flag.
///
/// # Errors
/// Returns an error when the token file cannot be removed.
pub(crate) fn disconnect_spotify(app: tauri::AppHandle) -> Result<SpotifyStatus, String> {
    remove_tokens(&app)?;
    Ok(SpotifyStatus {
        configured: client_path(&app)?.is_file(),
        connected: false,
    })
}

#[tauri::command]
/// Reads normalized playback state on a blocking worker thread.
///
/// # Arguments
/// * `app` - Handle used for authenticated API access.
///
/// # Returns
/// Current track, device, timing, and play-state metadata.
///
/// # Errors
/// Returns authentication, API, parsing, or worker-task errors.
pub(crate) async fn get_spotify_playback(app: tauri::AppHandle) -> Result<SpotifyPlayback, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // --- Playback Resource Request ---
        let response = spotify_request(
            &app,
            Method::GET,
            "/me/player",
            None,
            "Spotify playback could not be read",
        )?;
        let Some(value) = response else {
            return Ok(SpotifyPlayback {
                connected: true,
                is_playing: false,
                track_name: None,
                artists: None,
                album_name: None,
                device_name: None,
                progress_ms: 0,
                duration_ms: 0,
            });
        };
        // --- Frontend Playback Model ---
        let item = value.get("item");
        let artists = item
            .and_then(|item| item.get("artists"))
            .and_then(Value::as_array)
            .map(|artists| {
                artists
                    .iter()
                    .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|artists| !artists.is_empty());
        Ok(SpotifyPlayback {
            connected: true,
            is_playing: value
                .get("is_playing")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            track_name: item
                .and_then(|item| item.get("name"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            artists,
            album_name: item
                .and_then(|item| item.pointer("/album/name"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            device_name: value
                .pointer("/device/name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            progress_ms: value
                .get("progress_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            duration_ms: item
                .and_then(|item| item.get("duration_ms"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
        })
    })
    .await
    .map_err(|error| format!("The Spotify playback task failed: {error}"))?
}

#[tauri::command]
/// Starts an allowlisted Spotify collection on the active Connect device.
///
/// # Arguments
/// * `app` - Handle used for authenticated API access.
/// * `context_uri` - Playlist, album, or artist URI.
///
/// # Returns
/// Success after Spotify accepts the playback request.
///
/// # Errors
/// Returns an error for disallowed URI types or API and worker failures.
pub(crate) async fn spotify_play_context(
    app: tauri::AppHandle,
    context_uri: String,
) -> Result<(), String> {
    if !context_uri.starts_with("spotify:playlist:")
        && !context_uri.starts_with("spotify:album:")
        && !context_uri.starts_with("spotify:artist:")
    {
        return Err("That Spotify context is not allowed".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        spotify_request(
            &app,
            Method::PUT,
            "/me/player/play",
            Some(json!({ "context_uri": context_uri })),
            "Spotify could not start the playlist",
        )
        .map(|_| ())
    })
    .await
    .map_err(|error| format!("The Spotify playback task failed: {error}"))?
}

#[tauri::command]
/// Dispatches an allowlisted Spotify transport action on the active device.
///
/// # Arguments
/// * `app` - Handle used for authenticated API access.
/// * `action` - One of `play`, `pause`, `next`, or `previous`.
///
/// # Returns
/// Success after Spotify accepts the command.
///
/// # Errors
/// Returns an error for unsupported actions or API and worker failures.
pub(crate) async fn spotify_playback_action(
    app: tauri::AppHandle,
    action: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (method, endpoint) = match action.as_str() {
            "play" => (Method::PUT, "/me/player/play"),
            "pause" => (Method::PUT, "/me/player/pause"),
            "next" => (Method::POST, "/me/player/next"),
            "previous" => (Method::POST, "/me/player/previous"),
            _ => return Err("That Spotify playback action is not allowed".into()),
        };
        spotify_request(
            &app,
            method,
            endpoint,
            None,
            "Spotify could not update playback",
        )
        .map(|_| ())
    })
    .await
    .map_err(|error| format!("The Spotify playback task failed: {error}"))?
}
