use rand::{rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::Read,
    net::{IpAddr, Ipv4Addr, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};

const PHONE_MODE_PORT_START: u16 = 4768;
const PHONE_MODE_PORT_END: u16 = 4777;
const MAX_BODY_BYTES: u64 = 16 * 1024;
const MAX_PAIRING_FAILURES: usize = 20;
const PHONE_TOKEN_COOKIE: &str = "control_panel_phone_token";
const PHONE_UI: &str = include_str!("phone_mode_ui.html");
const PHONE_CSS: &str = include_str!("phone_mode_ui.css");
const PHONE_JS: &str = include_str!("phone_mode_ui.js");
const PHONE_ICON: &str = include_str!("phone_mode_icon.svg");
const PHONE_ICON_PNG_BASE64: &str = include_str!("phone_mode_icon.png.b64");

#[derive(Clone, Default)]
pub struct PhoneModeManager {
    inner: Arc<Mutex<PhoneModeRuntime>>,
}

#[derive(Default)]
struct PhoneModeRuntime {
    active: Option<ActivePhoneMode>,
}

#[derive(Clone)]
struct ActivePhoneMode {
    id: String,
    status: PhoneModeStatus,
    stop: Arc<AtomicBool>,
    context: Arc<Mutex<PhoneModeContext>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneModeStatus {
    url: String,
    pairing_code: String,
    port: u16,
    paired: bool,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneModeContext {
    launchers: Vec<PhoneLauncher>,
    groups: Vec<PhoneGroup>,
    #[serde(default)]
    scenes: Vec<PhoneScene>,
    theme: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneLauncher {
    id: String,
    label: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneGroup {
    id: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneScene {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairRequest {
    code: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ActionRequest {
    #[serde(rename = "type")]
    action_type: String,
    value: Option<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneControlAction {
    #[serde(rename = "type")]
    action_type: String,
    value: Option<String>,
}

impl PhoneModeManager {
    fn status(&self) -> Result<Option<PhoneModeStatus>, String> {
        let runtime = self
            .inner
            .lock()
            .map_err(|_| "Phone Mode state is unavailable".to_string())?;
        Ok(runtime.active.as_ref().map(|active| active.status.clone()))
    }

    fn deactivate(&self, session_id: Option<&str>) -> Result<bool, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Phone Mode state is unavailable".to_string())?;
        let should_remove = runtime
            .active
            .as_ref()
            .map(|active| session_id.is_none_or(|id| active.id == id))
            .unwrap_or(false);
        if !should_remove {
            return Ok(false);
        }
        if let Some(active) = runtime.active.take() {
            active.stop.store(true, Ordering::Release);
        }
        Ok(true)
    }

    fn mark_paired(&self, session_id: &str) -> Result<bool, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Phone Mode state is unavailable".to_string())?;
        let Some(active) = runtime
            .active
            .as_mut()
            .filter(|active| active.id == session_id)
        else {
            return Ok(false);
        };
        let changed = !active.status.paired;
        active.status.paired = true;
        Ok(changed)
    }
}

fn normalize_context(context: PhoneModeContext) -> Result<PhoneModeContext, String> {
    if context.launchers.len() > 100 || context.groups.len() > 50 || context.scenes.len() > 30 {
        return Err("Phone Mode received too many controls".into());
    }

    let mut launcher_ids = HashSet::new();
    let launchers = context
        .launchers
        .into_iter()
        .filter_map(|launcher| {
            let id = launcher.id.trim().to_string();
            let label = launcher.label.trim().to_string();
            if id.is_empty()
                || label.is_empty()
                || id.chars().count() > 128
                || label.chars().count() > 48
                || !launcher_ids.insert(id.clone())
            {
                return None;
            }
            Some(PhoneLauncher { id, label })
        })
        .collect();

    let mut group_ids = HashSet::new();
    let groups = context
        .groups
        .into_iter()
        .filter_map(|group| {
            let id = group.id.trim().to_string();
            let name = group.name.trim().to_string();
            if id.is_empty()
                || name.is_empty()
                || id.chars().count() > 128
                || name.chars().count() > 48
                || !group_ids.insert(id.clone())
            {
                return None;
            }
            Some(PhoneGroup { id, name })
        })
        .collect();

    let mut scene_ids = HashSet::new();
    let scenes = context
        .scenes
        .into_iter()
        .filter_map(|scene| {
            let id = scene.id.trim().to_string();
            let name = scene.name.trim().to_string();
            if id.is_empty()
                || name.is_empty()
                || id.chars().count() > 128
                || name.chars().count() > 64
                || !scene_ids.insert(id.clone())
            {
                return None;
            }
            Some(PhoneScene { id, name })
        })
        .collect();

    let theme = match context.theme.as_str() {
        "black" | "tan" | "green" | "blue" | "white" => context.theme,
        _ => "tan".to_string(),
    };

    Ok(PhoneModeContext {
        launchers,
        groups,
        scenes,
        theme,
    })
}

fn local_ipv4() -> Result<Ipv4Addr, String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| format!("The local network interface could not be opened: {error}"))?;
    socket
        .connect((Ipv4Addr::new(8, 8, 8, 8), 80))
        .map_err(|error| format!("No active local network route was found: {error}"))?;
    match socket
        .local_addr()
        .map_err(|error| format!("The local network address could not be read: {error}"))?
        .ip()
    {
        IpAddr::V4(address) if !address.is_loopback() => Ok(address),
        _ => Err("Connect this computer to Wi-Fi or Ethernet before starting Phone Mode".into()),
    }
}

fn random_token(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pairing_code() -> String {
    format!("{:06}", OsRng.gen_range(0_u32..1_000_000))
}

fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The control panel window was not found".to_string())?;
    window
        .show()
        .map_err(|error| format!("The control panel could not be shown: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("The control panel could not be restored: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("The control panel could not receive focus: {error}"))
}

fn hide_main_window(app: &AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "The control panel window was not found".to_string())?
        .hide()
        .map_err(|error| format!("The control panel could not be hidden: {error}"))
}

/// Prefers the stable Phone Mode port while allowing another running app instance to coexist.
fn bind_phone_mode_server() -> Result<(Server, u16), String> {
    let mut last_error = None;
    for port in PHONE_MODE_PORT_START..=PHONE_MODE_PORT_END {
        match Server::http((Ipv4Addr::UNSPECIFIED, port)) {
            Ok(server) => return Ok((server, port)),
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(format!(
        "Phone Mode could not use any port from {PHONE_MODE_PORT_START} through {PHONE_MODE_PORT_END}. Stop the other service using that range and try again: {}",
        last_error.unwrap_or_else(|| "no available socket was reported".to_string())
    ))
}

#[tauri::command]
pub fn start_phone_mode(
    app: AppHandle,
    manager: State<'_, PhoneModeManager>,
    context: PhoneModeContext,
) -> Result<PhoneModeStatus, String> {
    if let Some(status) = manager.status()? {
        return Ok(status);
    }

    let context = normalize_context(context)?;
    let address = local_ipv4()?;
    let (server, port) = bind_phone_mode_server()?;
    let code = pairing_code();
    let token = random_token(32);
    let session_id = random_token(16);
    let stop = Arc::new(AtomicBool::new(false));
    let shared_context = Arc::new(Mutex::new(context));
    let status = PhoneModeStatus {
        url: format!("http://{address}:{port}/"),
        pairing_code: code.clone(),
        port,
        paired: false,
    };

    {
        let mut runtime = manager
            .inner
            .lock()
            .map_err(|_| "Phone Mode state is unavailable".to_string())?;
        runtime.active = Some(ActivePhoneMode {
            id: session_id.clone(),
            status: status.clone(),
            stop: Arc::clone(&stop),
            context: Arc::clone(&shared_context),
        });
    }

    let server_manager = manager.inner().clone();
    let server_app = app.clone();
    let thread_session_id = session_id.clone();
    let thread_result = thread::Builder::new()
        .name("control-panel-phone-mode".into())
        .spawn(move || {
            run_server(
                server,
                server_app.clone(),
                server_manager.clone(),
                thread_session_id.clone(),
                address,
                port,
                code,
                token,
                shared_context,
                Arc::clone(&stop),
            );
            if server_manager
                .deactivate(Some(&thread_session_id))
                .unwrap_or(false)
            {
                let _ = restore_main_window(&server_app);
                let _ = server_app.emit("phone-mode-stopped", ());
            }
        });

    if let Err(error) = thread_result {
        let _ = manager.deactivate(Some(&session_id));
        return Err(format!(
            "Phone Mode could not start its network worker: {error}"
        ));
    }

    Ok(status)
}

#[tauri::command]
pub fn stop_phone_mode(app: AppHandle, manager: State<'_, PhoneModeManager>) -> Result<(), String> {
    manager.deactivate(None)?;
    restore_main_window(&app)?;
    let _ = app.emit("phone-mode-stopped", ());
    Ok(())
}

#[tauri::command]
pub fn get_phone_mode_status(
    manager: State<'_, PhoneModeManager>,
) -> Result<Option<PhoneModeStatus>, String> {
    manager.status()
}

#[tauri::command]
pub fn update_phone_mode_context(
    manager: State<'_, PhoneModeManager>,
    context: PhoneModeContext,
) -> Result<(), String> {
    let context = normalize_context(context)?;
    let shared_context = {
        let runtime = manager
            .inner
            .lock()
            .map_err(|_| "Phone Mode state is unavailable".to_string())?;
        runtime
            .active
            .as_ref()
            .map(|active| Arc::clone(&active.context))
            .ok_or_else(|| "Phone Mode is not running".to_string())?
    };
    *shared_context
        .lock()
        .map_err(|_| "Phone Mode controls are unavailable".to_string())? = context;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_server(
    server: Server,
    app: AppHandle,
    manager: PhoneModeManager,
    session_id: String,
    local_address: Ipv4Addr,
    port: u16,
    pairing_code: String,
    bearer_token: String,
    context: Arc<Mutex<PhoneModeContext>>,
    stop: Arc<AtomicBool>,
) {
    let failed_pairings = Arc::new(AtomicUsize::new(0));
    while !stop.load(Ordering::Acquire) {
        match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => handle_request(
                request,
                &app,
                &manager,
                &session_id,
                local_address,
                port,
                &pairing_code,
                &bearer_token,
                &context,
                &failed_pairings,
            ),
            Ok(None) => {}
            Err(_) => break,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_request(
    mut request: Request,
    app: &AppHandle,
    manager: &PhoneModeManager,
    session_id: &str,
    local_address: Ipv4Addr,
    port: u16,
    pairing_code: &str,
    bearer_token: &str,
    context: &Arc<Mutex<PhoneModeContext>>,
    failed_pairings: &Arc<AtomicUsize>,
) {
    if !host_is_allowed(&request, local_address, port) {
        respond_json(request, 421, json!({ "error": "This host is not allowed" }));
        return;
    }

    let path = request.url().split('?').next().unwrap_or("/");
    match (request.method(), path) {
        (&Method::Get, "/") => respond_text(request, 200, "text/html; charset=utf-8", PHONE_UI),
        (&Method::Get, "/phone_mode_ui.css") => {
            respond_text(request, 200, "text/css; charset=utf-8", PHONE_CSS)
        }
        (&Method::Get, "/phone_mode_ui.js") => {
            respond_text(request, 200, "text/javascript; charset=utf-8", PHONE_JS)
        }
        (&Method::Get, "/manifest.webmanifest") => respond_text(
            request,
            200,
            "application/manifest+json; charset=utf-8",
            r##"{"name":"Control Panel Phone","short_name":"Control Panel","start_url":"/","display":"standalone","background_color":"#0b0d0c","theme_color":"#0b0d0c","icons":[{"src":"/apple-touch-icon.png","sizes":"180x180","type":"image/png","purpose":"any maskable"},{"src":"/phone-icon.svg","sizes":"any","type":"image/svg+xml","purpose":"any maskable"}]}"##,
        ),
        (&Method::Get, "/apple-touch-icon.png") => {
            match STANDARD.decode(PHONE_ICON_PNG_BASE64.trim()) {
                Ok(bytes) => respond_bytes(request, 200, "image/png", bytes),
                Err(_) => respond_json(
                    request,
                    500,
                    json!({ "error": "The app icon is unavailable" }),
                ),
            }
        }
        (&Method::Get, "/phone-icon.svg") => {
            respond_text(request, 200, "image/svg+xml; charset=utf-8", PHONE_ICON)
        }
        (&Method::Get, "/api/status") => {
            let paired = manager
                .status()
                .ok()
                .flatten()
                .is_some_and(|status| status.paired);
            let theme = context
                .lock()
                .map(|context| context.theme.clone())
                .unwrap_or_else(|_| "tan".to_string());
            respond_json(
                request,
                200,
                json!({ "active": true, "paired": paired, "theme": theme }),
            );
        }
        (&Method::Post, "/api/pair") => {
            if !has_json_content_type(&request) {
                respond_json(request, 415, json!({ "error": "JSON is required" }));
                return;
            }
            if failed_pairings.load(Ordering::Acquire) >= MAX_PAIRING_FAILURES {
                respond_json(
                    request,
                    429,
                    json!({ "error": "Too many pairing attempts. Restart Phone Mode on the computer." }),
                );
                return;
            }
            let payload = match read_json::<PairRequest>(&mut request) {
                Ok(payload) => payload,
                Err(error) => {
                    respond_json(request, 400, json!({ "error": error }));
                    return;
                }
            };
            if !constant_time_equal(payload.code.trim().as_bytes(), pairing_code.as_bytes()) {
                failed_pairings.fetch_add(1, Ordering::AcqRel);
                respond_json(
                    request,
                    401,
                    json!({ "error": "The pairing code is incorrect" }),
                );
                return;
            }
            failed_pairings.store(0, Ordering::Release);
            respond_pair_success(request, bearer_token);
        }
        (&Method::Get, "/api/context") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            let context = match context.lock() {
                Ok(context) => context.clone(),
                Err(_) => {
                    respond_json(
                        request,
                        500,
                        json!({ "error": "Phone controls are unavailable" }),
                    );
                    return;
                }
            };
            let first_pairing = manager.mark_paired(session_id).unwrap_or(false);
            respond_json(
                request,
                200,
                json!({
                    "launchers": context.launchers,
                    "groups": context.groups,
                    "scenes": context.scenes,
                    "theme": context.theme,
                    "volume": crate::get_system_volume().ok(),
                    "brightness": crate::get_system_brightness().ok(),
                }),
            );
            if first_pairing {
                let transition_app = app.clone();
                let _ = thread::Builder::new()
                    .name("control-panel-phone-paired".into())
                    .spawn(move || {
                        let _ = transition_app.emit("phone-mode-paired", ());
                        let _ = hide_main_window(&transition_app);
                    });
            }
        }
        (&Method::Get, "/api/workspace") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            match crate::get_window_workspace() {
                Ok(workspace) => respond_json(request, 200, json!(workspace)),
                Err(error) => respond_json(request, 400, json!({ "error": error })),
            }
        }
        (&Method::Post, "/api/workspace") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            if !has_json_content_type(&request) {
                respond_json(request, 415, json!({ "error": "JSON is required" }));
                return;
            }
            let payload = match read_json::<crate::ApplyWindowWorkspaceRequest>(&mut request) {
                Ok(payload) => payload,
                Err(error) => {
                    respond_json(request, 400, json!({ "error": error }));
                    return;
                }
            };
            match crate::apply_window_workspace(payload) {
                Ok(()) => respond_json(
                    request,
                    200,
                    json!({ "ok": true, "message": "Window layout applied" }),
                ),
                Err(error) => respond_json(request, 400, json!({ "error": error })),
            }
        }
        (&Method::Get, "/api/calendar/status") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            match crate::google_calendar::get_google_calendar_status(app.clone()) {
                Ok(status) => respond_json(request, 200, json!(status)),
                Err(error) => respond_json(request, 400, json!({ "error": error })),
            }
        }
        (&Method::Post, "/api/calendar/events") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            if !has_json_content_type(&request) {
                respond_json(request, 415, json!({ "error": "JSON is required" }));
                return;
            }
            let payload = match read_json::<crate::google_calendar::BatchCreateCalendarEventsRequest>(
                &mut request,
            ) {
                Ok(payload) => payload,
                Err(error) => {
                    respond_json(request, 400, json!({ "error": error }));
                    return;
                }
            };
            match crate::google_calendar::create_google_calendar_events_for_phone(
                app.clone(),
                payload,
            ) {
                Ok(result) => respond_json(request, 200, json!(result)),
                Err(error) => respond_json(request, 400, json!({ "error": error })),
            }
        }
        (&Method::Post, "/api/action") => {
            if !is_authorized(&request, bearer_token) {
                respond_json(
                    request,
                    401,
                    json!({ "error": "Pair with the computer to continue" }),
                );
                return;
            }
            if !has_json_content_type(&request) {
                respond_json(request, 415, json!({ "error": "JSON is required" }));
                return;
            }
            let payload = match read_json::<ActionRequest>(&mut request) {
                Ok(payload) => payload,
                Err(error) => {
                    respond_json(request, 400, json!({ "error": error }));
                    return;
                }
            };
            match execute_action(app, manager, session_id, payload, context) {
                Ok(message) => {
                    respond_json(request, 200, json!({ "ok": true, "message": message }))
                }
                Err(error) => respond_json(request, 400, json!({ "error": error })),
            }
        }
        _ => respond_json(request, 404, json!({ "error": "Not found" })),
    }
}

fn execute_action(
    app: &AppHandle,
    manager: &PhoneModeManager,
    session_id: &str,
    payload: ActionRequest,
    context: &Arc<Mutex<PhoneModeContext>>,
) -> Result<&'static str, String> {
    match payload.action_type.as_str() {
        "volume" => {
            let level = action_level(&payload)?;
            crate::set_system_volume(level)?;
            Ok("Volume updated")
        }
        "brightness" => {
            let level = action_level(&payload)?;
            crate::set_system_brightness(level)?;
            Ok("Brightness updated")
        }
        "media_previous" => {
            crate::media_control("previous".into())?;
            Ok("Previous track")
        }
        "media_play_pause" => {
            crate::media_control("play_pause".into())?;
            Ok("Playback toggled")
        }
        "media_next" => {
            crate::media_control("next".into())?;
            Ok("Next track")
        }
        "launcher" | "group" | "scene" => {
            let value = payload
                .value
                .as_ref()
                .and_then(Value::as_str)
                .ok_or_else(|| "This control is missing its identifier".to_string())?;
            let is_allowed = {
                let context = context
                    .lock()
                    .map_err(|_| "Phone controls are unavailable".to_string())?;
                if payload.action_type == "launcher" {
                    context
                        .launchers
                        .iter()
                        .any(|launcher| launcher.id == value)
                } else if payload.action_type == "group" {
                    context.groups.iter().any(|group| group.id == value)
                } else {
                    context.scenes.iter().any(|scene| scene.id == value)
                }
            };
            if !is_allowed {
                return Err("That control is no longer available".into());
            }
            app.emit(
                "phone-control-action",
                PhoneControlAction {
                    action_type: payload.action_type,
                    value: Some(value.to_string()),
                },
            )
            .map_err(|error| format!("The desktop control could not be dispatched: {error}"))?;
            Ok("Command sent")
        }
        "capture" => {
            let value = payload
                .value
                .as_ref()
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.chars().count() <= 2_000)
                .ok_or_else(|| "Capture text must be between 1 and 2,000 characters".to_string())?;
            app.emit(
                "phone-control-action",
                PhoneControlAction {
                    action_type: payload.action_type,
                    value: Some(value.to_string()),
                },
            )
            .map_err(|error| format!("The capture could not be sent to the desktop: {error}"))?;
            Ok("Saved to the capture inbox")
        }
        "open_workspace" => {
            app.emit(
                "phone-control-action",
                PhoneControlAction {
                    action_type: payload.action_type,
                    value: None,
                },
            )
            .map_err(|error| format!("The window workspace could not be opened: {error}"))?;
            let _ = restore_main_window(app);
            Ok("Window workspace opened on the computer")
        }
        "show_desktop" => {
            restore_main_window(app)?;
            Ok("Desktop controls restored")
        }
        "exit_phone_mode" => {
            manager.deactivate(Some(session_id))?;
            restore_main_window(app)?;
            let _ = app.emit("phone-mode-stopped", ());
            Ok("Phone Mode ended")
        }
        _ => Err("That phone action is not allowed".into()),
    }
}

fn action_level(payload: &ActionRequest) -> Result<u32, String> {
    let level = payload
        .value
        .as_ref()
        .and_then(Value::as_u64)
        .ok_or_else(|| "The requested level must be a whole number".to_string())?;
    if level > 100 {
        return Err("The requested level must be between 0 and 100".into());
    }
    Ok(level as u32)
}

fn read_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_string(&mut body)
        .map_err(|_| "The request body could not be read".to_string())?;
    if body.len() as u64 > MAX_BODY_BYTES {
        return Err("The request body is too large".into());
    }
    serde_json::from_str(&body).map_err(|_| "The request JSON is invalid".into())
}

fn host_is_allowed(request: &Request, local_address: Ipv4Addr, port: u16) -> bool {
    let Some(host) = header_value(request, "Host") else {
        return false;
    };
    let allowed = [
        format!("{local_address}:{port}"),
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
    ];
    allowed
        .iter()
        .any(|candidate| host.eq_ignore_ascii_case(candidate))
}

fn has_json_content_type(request: &Request) -> bool {
    header_value(request, "Content-Type")
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
}

fn is_authorized(request: &Request, token: &str) -> bool {
    header_value(request, "Authorization").is_some_and(|value| bearer_token_matches(value, token))
        || header_value(request, "Cookie").is_some_and(|value| cookie_token_matches(value, token))
}

fn bearer_token_matches(value: &str, token: &str) -> bool {
    value
        .strip_prefix("Bearer ")
        .is_some_and(|provided| constant_time_equal(provided.as_bytes(), token.as_bytes()))
}

fn cookie_token_matches(value: &str, token: &str) -> bool {
    value.split(';').any(|cookie| {
        let Some((name, provided)) = cookie.trim().split_once('=') else {
            return false;
        };
        name == PHONE_TOKEN_COOKIE
            && constant_time_equal(provided.trim().as_bytes(), token.as_bytes())
    })
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn header_value<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

fn response_header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static HTTP header is valid")
}

fn add_security_headers<R: Read>(response: &mut Response<R>) {
    response.add_header(response_header("Cache-Control", "no-store"));
    response.add_header(response_header("X-Content-Type-Options", "nosniff"));
    response.add_header(response_header("X-Frame-Options", "DENY"));
    response.add_header(response_header("Referrer-Policy", "no-referrer"));
    response.add_header(response_header(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
    ));
    response.add_header(response_header(
        "Cross-Origin-Resource-Policy",
        "same-origin",
    ));
    response.add_header(response_header(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ));
}

fn respond_text(request: Request, status: u16, content_type: &str, body: &str) {
    let mut response = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(response_header("Content-Type", content_type));
    add_security_headers(&mut response);
    let _ = request.respond(response);
}

fn respond_json(request: Request, status: u16, body: Value) {
    let mut response = Response::from_string(body.to_string())
        .with_status_code(StatusCode(status))
        .with_header(response_header(
            "Content-Type",
            "application/json; charset=utf-8",
        ));
    add_security_headers(&mut response);
    let _ = request.respond(response);
}

fn respond_pair_success(request: Request, token: &str) {
    let mut response = Response::from_string(json!({ "token": token }).to_string())
        .with_status_code(StatusCode(200))
        .with_header(response_header(
            "Content-Type",
            "application/json; charset=utf-8",
        ))
        .with_header(response_header(
            "Set-Cookie",
            &format!("{PHONE_TOKEN_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict"),
        ));
    add_security_headers(&mut response);
    let _ = request.respond(response);
}

fn respond_bytes(request: Request, status: u16, content_type: &str, body: Vec<u8>) {
    let mut response = Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(response_header("Content-Type", content_type));
    add_security_headers(&mut response);
    let _ = request.respond(response);
}

#[cfg(test)]
mod phone_mode_tests {
    use super::{bearer_token_matches, cookie_token_matches};

    const TOKEN: &str = "phone-session-token";

    #[test]
    fn accepts_the_session_token_from_a_bearer_header() {
        assert!(bearer_token_matches("Bearer phone-session-token", TOKEN));
        assert!(!bearer_token_matches("Bearer stale-token", TOKEN));
        assert!(!bearer_token_matches("phone-session-token", TOKEN));
    }

    #[test]
    fn accepts_the_session_token_from_a_cookie_header() {
        assert!(cookie_token_matches(
            "theme=tan; control_panel_phone_token=phone-session-token; compact=true",
            TOKEN
        ));
        assert!(!cookie_token_matches(
            "control_panel_phone_token=stale-token",
            TOKEN
        ));
        assert!(!cookie_token_matches(
            "other_cookie=phone-session-token",
            TOKEN
        ));
    }
}
