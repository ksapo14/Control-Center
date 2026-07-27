use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Command};
use tauri::Manager;

mod google_calendar;
mod spotify;

fn command_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn powershell_output(script: &str) -> Result<String, String> {
    let output = hidden_command("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| command_error("PowerShell could not start", error))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            "Windows rejected the system request".into()
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(target_os = "windows")]
fn start_apps_id(names: &[&str]) -> Result<String, String> {
    let safe_names = names
        .iter()
        .map(|name| format!("'{}'", name.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "$names=@({safe_names}); Get-StartApps | Where-Object {{ $names -contains $_.Name }} | Select-Object -First 1 -ExpandProperty AppID"
    );
    let output = hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| command_error("Could not query installed applications", error))?;

    if !output.status.success() {
        return Err("Windows could not query the Start menu".into());
    }

    let app_id = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if app_id.is_empty() {
        Err(format!("{} is not installed", names[0]))
    } else {
        Ok(app_id)
    }
}

#[cfg(target_os = "windows")]
fn launch_start_app(names: &[&str]) -> Result<(), String> {
    let app_id = start_apps_id(names)?;
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{app_id}"))
        .spawn()
        .map(|_| ())
        .map_err(|error| command_error("Windows could not launch the application", error))
}

#[cfg(target_os = "windows")]
fn chrome_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates
            .push(PathBuf::from(local_app_data).join("Google\\Chrome\\Application\\chrome.exe"));
    }
    if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
        candidates
            .push(PathBuf::from(program_files).join("Google\\Chrome\\Application\\chrome.exe"));
    }
    if let Some(program_files_x86) = std::env::var_os("PROGRAMFILES(X86)") {
        candidates
            .push(PathBuf::from(program_files_x86).join("Google\\Chrome\\Application\\chrome.exe"));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[tauri::command]
fn launch_app(app_name: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return match app_name.as_str() {
            "Minecraft Launcher" => launch_start_app(&["Minecraft Launcher", "Minecraft"]),
            "Chrome" => {
                if let Some(executable) = chrome_executable() {
                    Command::new(executable)
                        .spawn()
                        .map(|_| ())
                        .map_err(|error| command_error("Chrome could not be launched", error))
                } else {
                    launch_start_app(&["Google Chrome", "Chrome"])
                }
            }
            "ChatGPT (Beta)" => launch_start_app(&["ChatGPT (Beta)", "ChatGPT"]),
            "NeatNotes" => Command::new("explorer.exe")
                .arg("shell:AppsFolder\\StameSoftwares.NeatNotes_vas53b8yfkk7r!App")
                .spawn()
                .map(|_| ())
                .map_err(|error| command_error("NeatNotes could not be launched", error)),
            _ => Err("That application is not on the control panel allowlist".into()),
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app_name;
        Err("Application launching is currently configured for Windows".into())
    }
}

#[tauri::command]
fn launch_chrome_site(site: String) -> Result<(), String> {
    let url = match site.as_str() {
        "youtube" => "https://www.youtube.com/",
        "github" => "https://github.com/",
        "gemini" => "https://gemini.google.com/",
        _ => return Err("That website is not on the control panel allowlist".into()),
    };

    #[cfg(target_os = "windows")]
    {
        let executable = chrome_executable().ok_or_else(|| {
            "Google Chrome was not found in a standard install location".to_string()
        })?;
        return Command::new(executable)
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| command_error("Chrome could not open the website", error));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("Chrome website launching is currently configured for Windows".into())
    }
}

#[cfg(target_os = "windows")]
fn vscode_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates
            .push(PathBuf::from(local_app_data).join("Programs\\Microsoft VS Code\\Code.exe"));
    }
    if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
        candidates.push(PathBuf::from(program_files).join("Microsoft VS Code\\Code.exe"));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[tauri::command]
fn open_vscode_directory(path: String) -> Result<(), String> {
    let directory = PathBuf::from(path);
    if !directory.is_dir() {
        return Err("The selected directory no longer exists".into());
    }

    #[cfg(target_os = "windows")]
    {
        let executable = vscode_executable().ok_or_else(|| {
            "Visual Studio Code was not found in a standard install location".to_string()
        })?;
        return Command::new(executable)
            .arg(directory)
            .spawn()
            .map(|_| ())
            .map_err(|error| command_error("Visual Studio Code could not be launched", error));
    }

    #[cfg(not(target_os = "windows"))]
    Command::new("code")
        .arg(directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| command_error("Visual Studio Code could not be launched", error))
}

#[cfg(target_os = "windows")]
struct ComApartment(bool);

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(target_os = "windows")]
fn initialize_com() -> Result<ComApartment, String> {
    use windows::{
        core::HRESULT,
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };

    const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106_u32 as i32);
    let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if result == RPC_E_CHANGED_MODE {
        return Ok(ComApartment(false));
    }

    result
        .ok()
        .map(|_| ComApartment(true))
        .map_err(|error| command_error("Windows COM could not initialize", error))
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum BluetoothAudioAction {
    Connect,
    Disconnect,
}

#[cfg(target_os = "windows")]
fn request_bluetooth_audio_action(
    device_name: &str,
    action: BluetoothAudioAction,
) -> Result<(), String> {
    use std::{ffi::c_void, mem::size_of, ptr::null_mut};
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
            Media::{
                Audio::{
                    eAll, IDeviceTopology, IMMDeviceEnumerator, IPart, MMDeviceEnumerator,
                    DEVICE_STATE, DEVICE_STATEMASK_ALL, DEVICE_STATE_ACTIVE,
                },
                KernelStreaming::{
                    IKsControl, KSPROPSETID_BtAudio, KSIDENTIFIER, KSIDENTIFIER_0,
                    KSIDENTIFIER_0_0, KSPROPERTY_ONESHOT_DISCONNECT, KSPROPERTY_ONESHOT_RECONNECT,
                    KSPROPERTY_TYPE_GET,
                },
            },
            System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ},
        },
    };

    let _com = initialize_com()?;
    let target = device_name.to_lowercase();

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| command_error("Windows audio devices are unavailable", error))?;
        let endpoints = enumerator
            .EnumAudioEndpoints(eAll, DEVICE_STATE(DEVICE_STATEMASK_ALL))
            .map_err(|error| command_error("Could not enumerate Windows audio devices", error))?;
        let endpoint_count = endpoints
            .GetCount()
            .map_err(|error| command_error("Could not count Windows audio devices", error))?;

        let mut matched_device = false;
        let mut actionable_device = false;
        let mut successful_requests = 0_u32;
        let mut last_error = None;

        for endpoint_index in 0..endpoint_count {
            let endpoint = match endpoints.Item(endpoint_index) {
                Ok(endpoint) => endpoint,
                Err(error) => {
                    last_error = Some(command_error("Could not inspect an audio endpoint", error));
                    continue;
                }
            };
            let friendly_name = endpoint
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .map(|value| value.to_string())
                .unwrap_or_default();

            if !friendly_name.to_lowercase().contains(&target) {
                continue;
            }

            matched_device = true;
            let is_active = endpoint.GetState().ok() == Some(DEVICE_STATE_ACTIVE);
            match action {
                BluetoothAudioAction::Connect if is_active => return Ok(()),
                BluetoothAudioAction::Disconnect if !is_active => continue,
                _ => actionable_device = true,
            }

            let topology: IDeviceTopology = match endpoint.Activate(CLSCTX_ALL, None) {
                Ok(topology) => topology,
                Err(error) => {
                    last_error = Some(command_error(
                        "Could not open the Bluetooth audio topology",
                        error,
                    ));
                    continue;
                }
            };
            let connector_count = match topology.GetConnectorCount() {
                Ok(count) => count,
                Err(error) => {
                    last_error = Some(command_error(
                        "Could not inspect Bluetooth audio connectors",
                        error,
                    ));
                    continue;
                }
            };

            for connector_index in 0..connector_count {
                let attempt = (|| -> Result<(), String> {
                    let connector = topology.GetConnector(connector_index).map_err(|error| {
                        command_error("Could not open an audio connector", error)
                    })?;
                    let connected_part: IPart = connector
                        .GetConnectedTo()
                        .map_err(|error| command_error("Audio connector is not attached", error))?
                        .cast()
                        .map_err(|error| {
                            command_error("Could not inspect the Bluetooth audio part", error)
                        })?;
                    let bluetooth_topology =
                        connected_part.GetTopologyObject().map_err(|error| {
                            command_error("Could not inspect the Bluetooth device topology", error)
                        })?;
                    let device_id = bluetooth_topology.GetDeviceId().map_err(|error| {
                        command_error("Could not read the Bluetooth audio device ID", error)
                    })?;
                    let bluetooth_device_result =
                        enumerator.GetDevice(PCWSTR(device_id.0.cast_const()));
                    CoTaskMemFree(Some(device_id.0.cast::<c_void>() as *const c_void));
                    let bluetooth_device = bluetooth_device_result.map_err(|error| {
                        command_error("Could not open the Bluetooth audio device", error)
                    })?;
                    let ks_control: IKsControl = bluetooth_device
                        .Activate(CLSCTX_ALL, None)
                        .map_err(|error| {
                            command_error("Bluetooth reconnect control is unavailable", error)
                        })?;
                    let property_id = match action {
                        BluetoothAudioAction::Connect => KSPROPERTY_ONESHOT_RECONNECT.0,
                        BluetoothAudioAction::Disconnect => KSPROPERTY_ONESHOT_DISCONNECT.0,
                    };
                    let property = KSIDENTIFIER {
                        Anonymous: KSIDENTIFIER_0 {
                            Anonymous: KSIDENTIFIER_0_0 {
                                Set: KSPROPSETID_BtAudio,
                                Id: property_id as u32,
                                Flags: KSPROPERTY_TYPE_GET,
                            },
                        },
                    };
                    let mut bytes_returned = 0_u32;
                    ks_control
                        .KsProperty(
                            &property,
                            size_of::<KSIDENTIFIER>() as u32,
                            null_mut(),
                            0,
                            &mut bytes_returned,
                        )
                        .map_err(|error| {
                            command_error("Windows rejected the Bluetooth audio request", error)
                        })?;
                    Ok(())
                })();

                match attempt {
                    Ok(()) => match action {
                        BluetoothAudioAction::Connect => return Ok(()),
                        BluetoothAudioAction::Disconnect => {
                            successful_requests += 1;
                            break;
                        }
                    },
                    Err(error) => last_error = Some(error),
                }
            }
        }

        if !matched_device {
            Err(format!(
                "{device_name} was not found. Confirm that it is paired in Windows."
            ))
        } else if matches!(action, BluetoothAudioAction::Disconnect)
            && (!actionable_device || successful_requests > 0)
        {
            Ok(())
        } else {
            Err(last_error.unwrap_or_else(|| {
                format!("Windows could not change the connection for {device_name}")
            }))
        }
    }
}

#[tauri::command]
fn connect_bluetooth_device(device_name: String) -> Result<(), String> {
    if device_name != "JLab GO Pop+" {
        return Err("That device is not on the control panel allowlist".into());
    }

    #[cfg(target_os = "windows")]
    {
        request_bluetooth_audio_action(&device_name, BluetoothAudioAction::Connect)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Bluetooth quick-connect is currently configured for Windows".into())
    }
}

#[tauri::command]
fn disconnect_bluetooth_device(device_name: String) -> Result<(), String> {
    if device_name != "JLab GO Pop+" {
        return Err("That device is not on the control panel allowlist".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::{thread::sleep, time::Duration};

        let mut last_error = None;
        for _ in 0..2 {
            match request_bluetooth_audio_action(&device_name, BluetoothAudioAction::Disconnect) {
                Ok(()) => {
                    for _ in 0..10 {
                        sleep(Duration::from_millis(250));
                        if !get_bluetooth_device_status(device_name.clone())? {
                            return Ok(());
                        }
                    }
                    last_error = Some(format!(
                        "Windows accepted the disconnect request, but {device_name} is still connected"
                    ));
                }
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or_else(|| format!("Windows could not disconnect {device_name}")))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Bluetooth disconnect is currently configured for Windows".into())
    }
}

#[tauri::command]
fn get_bluetooth_device_status(device_name: String) -> Result<bool, String> {
    if device_name != "JLab GO Pop+" {
        return Err("That device is not on the control panel allowlist".into());
    }

    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::{
            Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
            Media::Audio::{
                eAll, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATEMASK_ALL,
                DEVICE_STATE_ACTIVE,
            },
            System::Com::{CoCreateInstance, CLSCTX_ALL, STGM_READ},
        };

        let _com = initialize_com()?;
        let target = device_name.to_lowercase();
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| command_error("Windows audio devices are unavailable", error))?;
        let endpoints = enumerator
            .EnumAudioEndpoints(eAll, DEVICE_STATE(DEVICE_STATEMASK_ALL))
            .map_err(|error| command_error("Could not enumerate Windows audio devices", error))?;
        let endpoint_count = endpoints
            .GetCount()
            .map_err(|error| command_error("Could not count Windows audio devices", error))?;

        for index in 0..endpoint_count {
            let endpoint = endpoints
                .Item(index)
                .map_err(|error| command_error("Could not inspect an audio endpoint", error))?;
            let friendly_name = endpoint
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .map(|value| value.to_string())
                .unwrap_or_default();
            if friendly_name.to_lowercase().contains(&target)
                && endpoint.GetState().ok() == Some(DEVICE_STATE_ACTIVE)
            {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Bluetooth status is currently configured for Windows".into())
}

#[cfg(target_os = "windows")]
fn endpoint_volume() -> Result<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume, String>
{
    use windows::Win32::{
        Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{CoCreateInstance, CLSCTX_ALL},
    };

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| command_error("Windows audio endpoint was not found", error))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|error| command_error("The default audio output was not found", error))?;
        device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .map_err(|error| command_error("The master volume control is unavailable", error))
    }
}

#[cfg(target_os = "windows")]
static AUDIO_METER_START: std::sync::Once = std::sync::Once::new();
#[cfg(target_os = "windows")]
static AUDIO_BASS_BITS: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0_f32.to_bits());
#[cfg(target_os = "windows")]
static AUDIO_MIDS_BITS: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0_f32.to_bits());
#[cfg(target_os = "windows")]
static AUDIO_TREBLE_BITS: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0_f32.to_bits());
#[cfg(target_os = "windows")]
static AUDIO_METER_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "windows")]
static AUDIO_LAST_REQUEST_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioBands {
    bass: f32,
    mids: f32,
    treble: f32,
}

#[cfg(target_os = "windows")]
fn audio_meter_clock_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn clear_audio_bands() {
    use std::sync::atomic::Ordering;

    AUDIO_BASS_BITS.store(0_f32.to_bits(), Ordering::Relaxed);
    AUDIO_MIDS_BITS.store(0_f32.to_bits(), Ordering::Relaxed);
    AUDIO_TREBLE_BITS.store(0_f32.to_bits(), Ordering::Relaxed);
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum AudioSampleEncoding {
    Float32,
    Pcm16,
    Pcm24,
    Pcm32,
}

#[cfg(target_os = "windows")]
struct AudioMixFormat {
    sample_rate: f32,
    channels: usize,
    block_align: usize,
    bytes_per_sample: usize,
    encoding: AudioSampleEncoding,
}

#[cfg(target_os = "windows")]
impl AudioMixFormat {
    unsafe fn from_wave_format(
        format: *const windows::Win32::Media::Audio::WAVEFORMATEX,
    ) -> Result<Self, String> {
        use windows::{
            core::GUID,
            Win32::Media::Audio::{WAVEFORMATEX, WAVEFORMATEXTENSIBLE},
        };

        const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
        const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
        const KSDATAFORMAT_SUBTYPE_PCM: GUID =
            GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
        const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
            GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

        let base = unsafe { std::ptr::read_unaligned(format as *const WAVEFORMATEX) };
        let encoding = match base.wFormatTag {
            WAVE_FORMAT_IEEE_FLOAT if base.wBitsPerSample == 32 => AudioSampleEncoding::Float32,
            1 => match base.wBitsPerSample {
                16 => AudioSampleEncoding::Pcm16,
                24 => AudioSampleEncoding::Pcm24,
                32 => AudioSampleEncoding::Pcm32,
                bits => return Err(format!("Unsupported PCM sample size: {bits} bits")),
            },
            WAVE_FORMAT_EXTENSIBLE => {
                let extensible =
                    unsafe { std::ptr::read_unaligned(format as *const WAVEFORMATEXTENSIBLE) };
                let sub_format =
                    unsafe { std::ptr::addr_of!(extensible.SubFormat).read_unaligned() };
                if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && base.wBitsPerSample == 32 {
                    AudioSampleEncoding::Float32
                } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                    match base.wBitsPerSample {
                        16 => AudioSampleEncoding::Pcm16,
                        24 => AudioSampleEncoding::Pcm24,
                        32 => AudioSampleEncoding::Pcm32,
                        bits => return Err(format!("Unsupported PCM sample size: {bits} bits")),
                    }
                } else {
                    return Err("Unsupported Windows audio mix format".into());
                }
            }
            tag => return Err(format!("Unsupported Windows audio format tag: {tag}")),
        };

        let channels = usize::from(base.nChannels);
        if channels == 0 || base.nSamplesPerSec == 0 {
            return Err("Windows returned an invalid audio mix format".into());
        }

        Ok(Self {
            sample_rate: base.nSamplesPerSec as f32,
            channels,
            block_align: usize::from(base.nBlockAlign),
            bytes_per_sample: usize::from(base.wBitsPerSample / 8),
            encoding,
        })
    }

    fn channel_sample(&self, data: &[u8], frame: usize, channel: usize) -> f32 {
        let frame_start = frame * self.block_align;
        let offset = frame_start + channel * self.bytes_per_sample;
        let sample = match self.encoding {
            AudioSampleEncoding::Float32 => {
                let bytes = [
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ];
                f32::from_le_bytes(bytes)
            }
            AudioSampleEncoding::Pcm16 => {
                let bytes = [data[offset], data[offset + 1]];
                f32::from(i16::from_le_bytes(bytes)) / 32_768.0
            }
            AudioSampleEncoding::Pcm24 => {
                let raw = i32::from(data[offset])
                    | (i32::from(data[offset + 1]) << 8)
                    | (i32::from(data[offset + 2]) << 16);
                let signed = if raw & 0x0080_0000 != 0 {
                    raw | !0x00ff_ffff
                } else {
                    raw
                };
                signed as f32 / 8_388_608.0
            }
            AudioSampleEncoding::Pcm32 => {
                let bytes = [
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ];
                i32::from_le_bytes(bytes) as f32 / 2_147_483_648.0
            }
        };
        if sample.is_finite() {
            sample
        } else {
            0.0
        }
    }
}

#[cfg(target_os = "windows")]
struct AudioBandAnalyzer {
    low_states: Vec<f32>,
    high_states: Vec<f32>,
    bass_envelope: f32,
    mids_envelope: f32,
    treble_envelope: f32,
    low_coefficient: f32,
    high_coefficient: f32,
}

#[cfg(target_os = "windows")]
impl AudioBandAnalyzer {
    fn new(sample_rate: f32, channels: usize) -> Self {
        let coefficient =
            |cutoff: f32| 1.0 - (-2.0 * std::f32::consts::PI * cutoff / sample_rate).exp();
        Self {
            low_states: vec![0.0; channels],
            high_states: vec![0.0; channels],
            bass_envelope: 0.0,
            mids_envelope: 0.0,
            treble_envelope: 0.0,
            low_coefficient: coefficient(250.0),
            high_coefficient: coefficient(4_000.0),
        }
    }

    fn process(&mut self, format: &AudioMixFormat, data: Option<&[u8]>, frames: usize) {
        let mut bass_energy = 0.0;
        let mut mids_energy = 0.0;
        let mut treble_energy = 0.0;

        for frame in 0..frames {
            for channel in 0..format.channels {
                let sample =
                    data.map_or(0.0, |buffer| format.channel_sample(buffer, frame, channel));
                self.low_states[channel] +=
                    self.low_coefficient * (sample - self.low_states[channel]);
                self.high_states[channel] +=
                    self.high_coefficient * (sample - self.high_states[channel]);

                let bass = self.low_states[channel];
                let mids = self.high_states[channel] - self.low_states[channel];
                let treble = sample - self.high_states[channel];
                bass_energy += bass * bass;
                mids_energy += mids * mids;
                treble_energy += treble * treble;
            }
        }

        if frames == 0 {
            return;
        }

        let divisor = (frames * format.channels) as f32;
        let targets = [
            (bass_energy / divisor).sqrt() * 4.4,
            (mids_energy / divisor).sqrt() * 3.6,
            (treble_energy / divisor).sqrt() * 5.4,
        ];
        let smooth = |current: f32, target: f32| {
            let amount = if target > current { 0.62 } else { 0.14 };
            current + (target.clamp(0.0, 1.0) - current) * amount
        };

        self.bass_envelope = smooth(self.bass_envelope, targets[0]);
        self.mids_envelope = smooth(self.mids_envelope, targets[1]);
        self.treble_envelope = smooth(self.treble_envelope, targets[2]);
    }

    fn bands(&self) -> AudioBands {
        AudioBands {
            bass: self.bass_envelope,
            mids: self.mids_envelope,
            treble: self.treble_envelope,
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod audio_band_tests {
    use super::*;

    fn analyze_frequency(frequency: f32) -> AudioBands {
        const SAMPLE_RATE: f32 = 48_000.0;
        const FRAMES_PER_CHUNK: usize = 480;
        let format = AudioMixFormat {
            sample_rate: SAMPLE_RATE,
            channels: 2,
            block_align: 8,
            bytes_per_sample: 4,
            encoding: AudioSampleEncoding::Float32,
        };
        let mut analyzer = AudioBandAnalyzer::new(SAMPLE_RATE, format.channels);

        for chunk in 0..20 {
            let mut samples = Vec::with_capacity(FRAMES_PER_CHUNK * format.block_align);
            for frame in 0..FRAMES_PER_CHUNK {
                let index = chunk * FRAMES_PER_CHUNK + frame;
                let left = (2.0 * std::f32::consts::PI * frequency * index as f32 / SAMPLE_RATE)
                    .sin()
                    * 0.15;
                samples.extend_from_slice(&left.to_le_bytes());
                samples.extend_from_slice(&(-left).to_le_bytes());
            }
            analyzer.process(&format, Some(&samples), FRAMES_PER_CHUNK);
        }

        analyzer.bands()
    }

    #[test]
    fn separates_bass_mids_and_treble_without_stereo_cancellation() {
        let bass = analyze_frequency(80.0);
        assert!(bass.bass > bass.mids && bass.bass > bass.treble);

        let mids = analyze_frequency(1_000.0);
        assert!(mids.mids > mids.bass && mids.mids > mids.treble);

        let treble = analyze_frequency(10_000.0);
        assert!(treble.treble > treble.bass && treble.treble > treble.mids);
    }
}

#[cfg(target_os = "windows")]
fn start_audio_band_meter() {
    use std::{sync::atomic::Ordering, thread, time::Duration};
    use windows::Win32::{
        Media::Audio::{
            eMultimedia, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
            MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
        },
        System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL},
    };

    AUDIO_METER_START.call_once(|| {
        let _ = thread::Builder::new()
            .name("control-panel-audio-meter".into())
            .spawn(|| {
                let Ok(_com) = initialize_com() else {
                    return;
                };

                loop {
                    let idle_for = audio_meter_clock_ms()
                        .saturating_sub(AUDIO_LAST_REQUEST_MS.load(Ordering::Relaxed));
                    if idle_for > 750 {
                        AUDIO_METER_READY.store(false, Ordering::Relaxed);
                        clear_audio_bands();
                        thread::sleep(Duration::from_millis(250));
                        continue;
                    }

                    let capture = unsafe {
                        CoCreateInstance::<_, IMMDeviceEnumerator>(
                            &MMDeviceEnumerator,
                            None,
                            CLSCTX_ALL,
                        )
                        .and_then(|enumerator| {
                            enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
                        })
                        .and_then(|device| device.Activate::<IAudioClient>(CLSCTX_ALL, None))
                        .and_then(|client| {
                            let mix_format = client.GetMixFormat()?;
                            let parsed_format = AudioMixFormat::from_wave_format(mix_format)
                                .map_err(|message| {
                                    windows::core::Error::new(
                                        windows::core::HRESULT(0x8000_4005_u32 as i32),
                                        message,
                                    )
                                });
                            let initialized = client.Initialize(
                                AUDCLNT_SHAREMODE_SHARED,
                                AUDCLNT_STREAMFLAGS_LOOPBACK,
                                0,
                                0,
                                mix_format,
                                None,
                            );
                            CoTaskMemFree(Some(mix_format.cast()));
                            let format = parsed_format?;
                            initialized?;
                            let capture = client.GetService::<IAudioCaptureClient>()?;
                            client.Start()?;
                            Ok((client, capture, format))
                        })
                    };

                    let Ok((client, capture, format)) = capture else {
                        AUDIO_METER_READY.store(false, Ordering::Relaxed);
                        clear_audio_bands();
                        thread::sleep(Duration::from_secs(1));
                        continue;
                    };

                    let mut analyzer = AudioBandAnalyzer::new(format.sample_rate, format.channels);
                    AUDIO_METER_READY.store(true, Ordering::Relaxed);
                    loop {
                        let idle_for = audio_meter_clock_ms()
                            .saturating_sub(AUDIO_LAST_REQUEST_MS.load(Ordering::Relaxed));
                        if idle_for > 750 {
                            let _ = unsafe { client.Stop() };
                            AUDIO_METER_READY.store(false, Ordering::Relaxed);
                            clear_audio_bands();
                            break;
                        }

                        let packet_result = (|| -> Result<(), windows::core::Error> {
                            unsafe {
                                let mut packet_frames = capture.GetNextPacketSize()?;
                                while packet_frames > 0 {
                                    let mut data = std::ptr::null_mut();
                                    let mut frames = 0;
                                    let mut flags = 0;
                                    capture.GetBuffer(
                                        &mut data,
                                        &mut frames,
                                        &mut flags,
                                        None,
                                        None,
                                    )?;
                                    let byte_length = frames as usize * format.block_align;
                                    let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                                    let samples = if silent || data.is_null() {
                                        None
                                    } else {
                                        Some(std::slice::from_raw_parts(data, byte_length))
                                    };
                                    analyzer.process(&format, samples, frames as usize);
                                    capture.ReleaseBuffer(frames)?;
                                    packet_frames = capture.GetNextPacketSize()?;
                                }
                            }
                            Ok(())
                        })();

                        if packet_result.is_err() {
                            let _ = unsafe { client.Stop() };
                            AUDIO_METER_READY.store(false, Ordering::Relaxed);
                            clear_audio_bands();
                            break;
                        }

                        let bands = analyzer.bands();
                        AUDIO_BASS_BITS.store(bands.bass.to_bits(), Ordering::Relaxed);
                        AUDIO_MIDS_BITS.store(bands.mids.to_bits(), Ordering::Relaxed);
                        AUDIO_TREBLE_BITS.store(bands.treble.to_bits(), Ordering::Relaxed);
                        thread::sleep(Duration::from_millis(12));
                    }
                }
            });
    });
}

#[tauri::command]
fn get_system_audio_bands() -> Result<AudioBands, String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;

        AUDIO_LAST_REQUEST_MS.store(audio_meter_clock_ms(), Ordering::Relaxed);
        start_audio_band_meter();
        if !AUDIO_METER_READY.load(Ordering::Relaxed) {
            return Ok(AudioBands::default());
        }
        return Ok(AudioBands {
            bass: f32::from_bits(AUDIO_BASS_BITS.load(Ordering::Relaxed)),
            mids: f32::from_bits(AUDIO_MIDS_BITS.load(Ordering::Relaxed)),
            treble: f32::from_bits(AUDIO_TREBLE_BITS.load(Ordering::Relaxed)),
        });
    }

    #[cfg(not(target_os = "windows"))]
    Err("Audio-reactive motion is currently configured for Windows".into())
}

#[tauri::command]
fn get_system_volume() -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        let _com = initialize_com()?;
        let level = endpoint_volume()?
            .GetMasterVolumeLevelScalar()
            .map_err(|error| command_error("The system volume could not be read", error))?;
        return Ok((level.clamp(0.0, 1.0) * 100.0).round() as u32);
    }

    #[cfg(not(target_os = "windows"))]
    Err("System volume is currently configured for Windows".into())
}

#[tauri::command]
fn set_system_volume(level: u32) -> Result<(), String> {
    let level = level.min(100);

    #[cfg(target_os = "windows")]
    unsafe {
        let _com = initialize_com()?;
        return endpoint_volume()?
            .SetMasterVolumeLevelScalar(level as f32 / 100.0, std::ptr::null())
            .map_err(|error| command_error("The system volume could not be changed", error));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = level;
        Err("System volume is currently configured for Windows".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatteryStatus {
    level: Option<u8>,
    charging: bool,
    present: bool,
}

#[tauri::command]
fn get_battery_status() -> Result<BatteryStatus, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

        let mut status = SYSTEM_POWER_STATUS::default();
        GetSystemPowerStatus(&mut status)
            .map_err(|error| command_error("Battery status could not be read", error))?;
        let present = status.BatteryFlag != 128;
        let level = if present && status.BatteryLifePercent <= 100 {
            Some(status.BatteryLifePercent)
        } else {
            None
        };

        return Ok(BatteryStatus {
            level,
            charging: status.ACLineStatus == 1,
            present,
        });
    }

    #[cfg(not(target_os = "windows"))]
    Err("Battery status is currently configured for Windows".into())
}

#[tauri::command]
fn get_system_brightness() -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        let script = "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1 -ExpandProperty CurrentBrightness";
        if let Ok(level) = powershell_output(script).and_then(|output| {
            output
                .lines()
                .last()
                .unwrap_or_default()
                .trim()
                .parse::<u32>()
                .map(|value| value.min(100))
                .map_err(|error| command_error("Display brightness could not be parsed", error))
        }) {
            return Ok(level);
        }
        return get_external_monitor_brightness();
    }

    #[cfg(not(target_os = "windows"))]
    Err("Display brightness is currently configured for Windows".into())
}

#[tauri::command]
fn set_system_brightness(level: u32) -> Result<(), String> {
    let level = level.min(100);

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "$method=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; if(-not $method){{throw 'No controllable internal display was found'}}; $method | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=0;Brightness=[byte]{level}}} -ErrorAction Stop | Out-Null"
        );
        if powershell_output(&script).is_ok() {
            return Ok(());
        }
        return set_external_monitor_brightness(level);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = level;
        Err("Display brightness is currently configured for Windows".into())
    }
}

#[cfg(target_os = "windows")]
fn logical_monitors() -> Vec<windows::Win32::Graphics::Gdi::HMONITOR> {
    use windows::{
        core::BOOL,
        Win32::{
            Foundation::{LPARAM, RECT},
            Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
        },
    };

    unsafe extern "system" fn collect_monitor(
        monitor: HMONITOR,
        _device_context: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(data.0 as *mut Vec<HMONITOR>);
        monitors.push(monitor);
        BOOL(1)
    }

    let mut monitors = Vec::new();
    unsafe {
        let data = LPARAM((&mut monitors as *mut Vec<HMONITOR>) as isize);
        let _ = EnumDisplayMonitors(None, None, Some(collect_monitor), data);
    }
    monitors
}

#[cfg(target_os = "windows")]
fn get_external_monitor_brightness() -> Result<u32, String> {
    use windows::Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR,
    };

    unsafe {
        for logical in logical_monitors() {
            let mut count = 0_u32;
            if GetNumberOfPhysicalMonitorsFromHMONITOR(logical, &mut count).is_err() || count == 0 {
                continue;
            }
            let mut physical = vec![PHYSICAL_MONITOR::default(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(logical, &mut physical).is_err() {
                continue;
            }

            let mut found = None;
            for monitor in &physical {
                let mut minimum = 0_u32;
                let mut current = 0_u32;
                let mut maximum = 0_u32;
                if GetMonitorBrightness(
                    monitor.hPhysicalMonitor,
                    &mut minimum,
                    &mut current,
                    &mut maximum,
                ) != 0
                    && maximum > minimum
                {
                    found = Some(
                        (((current.saturating_sub(minimum)) as f64 / (maximum - minimum) as f64)
                            * 100.0)
                            .round()
                            .clamp(0.0, 100.0) as u32,
                    );
                    break;
                }
            }
            let _ = DestroyPhysicalMonitors(&physical);
            if let Some(level) = found {
                return Ok(level);
            }
        }
    }

    Err("No brightness-capable internal or DDC/CI display was found".into())
}

#[cfg(target_os = "windows")]
fn set_external_monitor_brightness(level: u32) -> Result<(), String> {
    use windows::Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
    };

    let mut changed = 0_u32;
    unsafe {
        for logical in logical_monitors() {
            let mut count = 0_u32;
            if GetNumberOfPhysicalMonitorsFromHMONITOR(logical, &mut count).is_err() || count == 0 {
                continue;
            }
            let mut physical = vec![PHYSICAL_MONITOR::default(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(logical, &mut physical).is_err() {
                continue;
            }

            for monitor in &physical {
                let mut minimum = 0_u32;
                let mut current = 0_u32;
                let mut maximum = 0_u32;
                if GetMonitorBrightness(
                    monitor.hPhysicalMonitor,
                    &mut minimum,
                    &mut current,
                    &mut maximum,
                ) != 0
                    && maximum > minimum
                {
                    let target = minimum
                        + (((maximum - minimum) as f64 * level as f64 / 100.0).round() as u32);
                    if SetMonitorBrightness(monitor.hPhysicalMonitor, target) != 0 {
                        changed += 1;
                    }
                }
            }
            let _ = DestroyPhysicalMonitors(&physical);
        }
    }

    if changed > 0 {
        Ok(())
    } else {
        Err("No brightness-capable internal or DDC/CI display was found".into())
    }
}

#[derive(Serialize)]
struct SystemMetrics {
    cpu: u32,
    ram: u32,
    gpu: Option<u32>,
}

#[cfg(target_os = "windows")]
fn filetime_value(time: windows::Win32::Foundation::FILETIME) -> u64 {
    ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64
}

#[cfg(target_os = "windows")]
fn read_cpu_usage() -> Result<u32, String> {
    use std::{thread::sleep, time::Duration};
    use windows::Win32::{Foundation::FILETIME, System::Threading::GetSystemTimes};

    unsafe fn sample() -> Result<(u64, u64, u64), String> {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user))
            .map_err(|error| command_error("CPU counters could not be read", error))?;
        Ok((
            filetime_value(idle),
            filetime_value(kernel),
            filetime_value(user),
        ))
    }

    let before = unsafe { sample()? };
    sleep(Duration::from_millis(120));
    let after = unsafe { sample()? };
    let idle = after.0.saturating_sub(before.0);
    let total = after
        .1
        .saturating_sub(before.1)
        .saturating_add(after.2.saturating_sub(before.2));
    if total == 0 {
        return Ok(0);
    }
    Ok(
        (((total.saturating_sub(idle)) as f64 / total as f64) * 100.0)
            .round()
            .clamp(0.0, 100.0) as u32,
    )
}

#[tauri::command]
fn get_system_metrics() -> Result<SystemMetrics, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use std::mem::size_of;
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

        let cpu = read_cpu_usage()?;
        let mut memory = MEMORYSTATUSEX {
            dwLength: size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        GlobalMemoryStatusEx(&mut memory)
            .map_err(|error| command_error("Memory usage could not be read", error))?;

        let gpu_script = "$samples=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue; if($samples){[math]::Round(($samples | Measure-Object -Property UtilizationPercentage -Sum).Sum)}else{$counter=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples; if($counter){$groups=$counter | Group-Object { $_.InstanceName -replace '^pid_\\d+_','' }; $loads=$groups | ForEach-Object { ($_.Group | Measure-Object -Property CookedValue -Sum).Sum }; [math]::Round(($loads | Measure-Object -Maximum).Maximum)}}";
        let gpu = powershell_output(gpu_script)
            .ok()
            .and_then(|value| value.lines().last()?.trim().parse::<u32>().ok())
            .map(|value| value.min(100));

        return Ok(SystemMetrics {
            cpu,
            ram: memory.dwMemoryLoad.min(100),
            gpu,
        });
    }

    #[cfg(not(target_os = "windows"))]
    Err("System telemetry is currently configured for Windows".into())
}

#[tauri::command]
fn media_control(action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use std::mem::size_of;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
            VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP,
        };

        let key: VIRTUAL_KEY = match action.as_str() {
            "play_pause" => VK_MEDIA_PLAY_PAUSE,
            "stop" => VK_MEDIA_STOP,
            "next" => VK_MEDIA_NEXT_TRACK,
            "previous" => VK_MEDIA_PREV_TRACK,
            _ => return Err("That media action is not allowed".into()),
        };
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: key,
                        ..Default::default()
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: key,
                        dwFlags: KEYEVENTF_KEYUP,
                        ..Default::default()
                    },
                },
            },
        ];
        let sent = SendInput(&inputs, size_of::<INPUT>() as i32);
        if sent != inputs.len() as u32 {
            return Err("Windows did not accept the media key".into());
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Err("Media controls are currently configured for Windows".into())
    }
}

#[derive(Deserialize)]
struct RawOpenApplication {
    pid: u32,
    name: String,
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenApplication {
    pid: u32,
    name: String,
    title: String,
    protected: bool,
    protected_reason: Option<String>,
}

fn application_protection(pid: u32, name: &str) -> Option<String> {
    if pid == std::process::id() {
        return Some("Control Panel stays open while you manage other apps".into());
    }

    let process_name = name.trim().trim_end_matches(".exe").to_ascii_lowercase();
    let is_windows_shell = matches!(
        process_name.as_str(),
        "applicationframehost"
            | "dwm"
            | "explorer"
            | "searchapp"
            | "searchhost"
            | "shellexperiencehost"
            | "startmenuexperiencehost"
            | "textinputhost"
            | "winlogon"
    );

    is_windows_shell.then(|| "Windows shell process is protected".into())
}

#[tauri::command]
fn list_open_applications() -> Result<Vec<OpenApplication>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $apps=@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } | ForEach-Object { [pscustomobject]@{ pid=[uint32]$_.Id; name=$_.ProcessName; title=$_.MainWindowTitle } }); ConvertTo-Json -InputObject $apps -Compress"#;
        let output = powershell_output(script)?;
        if output.is_empty() {
            return Ok(Vec::new());
        }

        let mut applications = serde_json::from_str::<Vec<RawOpenApplication>>(&output)
            .map_err(|error| command_error("Open applications could not be parsed", error))?
            .into_iter()
            .map(|application| {
                let protected_reason = application_protection(application.pid, &application.name);
                OpenApplication {
                    pid: application.pid,
                    name: application.name,
                    title: application.title,
                    protected: protected_reason.is_some(),
                    protected_reason,
                }
            })
            .collect::<Vec<_>>();

        applications.sort_by(|left, right| {
            left.title
                .to_ascii_lowercase()
                .cmp(&right.title.to_ascii_lowercase())
                .then(left.pid.cmp(&right.pid))
        });
        return Ok(applications);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Open application management is currently configured for Windows".into())
}

#[tauri::command]
fn force_close_application(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("That application is no longer available".into());
    }

    #[cfg(target_os = "windows")]
    {
        let application = list_open_applications()?
            .into_iter()
            .find(|application| application.pid == pid)
            .ok_or_else(|| "That application no longer has an open window".to_string())?;
        if let Some(reason) = application.protected_reason {
            return Err(reason);
        }

        let pid_value = pid.to_string();
        let output = hidden_command("taskkill.exe")
            .args(["/PID", &pid_value, "/T", "/F"])
            .output()
            .map_err(|error| command_error("Windows could not start taskkill", error))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            return Err(if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("Windows could not end {}", application.title)
            });
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pid;
        Err("Force close is currently configured for Windows".into())
    }
}

#[tauri::command]
fn minimize_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The control panel window was not found".to_string())?;
    window
        .minimize()
        .map_err(|error| command_error("The window could not be minimized", error))
}

#[tauri::command]
fn close_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The control panel window was not found".to_string())?;
    window
        .close()
        .map_err(|error| command_error("The window could not be closed", error))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            launch_app,
            launch_chrome_site,
            open_vscode_directory,
            connect_bluetooth_device,
            disconnect_bluetooth_device,
            get_bluetooth_device_status,
            get_system_volume,
            get_system_audio_bands,
            set_system_volume,
            get_system_brightness,
            set_system_brightness,
            get_battery_status,
            get_system_metrics,
            media_control,
            list_open_applications,
            force_close_application,
            minimize_main_window,
            close_main_window,
            google_calendar::get_google_calendar_status,
            google_calendar::import_google_calendar_credentials,
            google_calendar::connect_google_calendar,
            google_calendar::disconnect_google_calendar,
            google_calendar::create_google_calendar_event,
            spotify::get_spotify_status,
            spotify::configure_spotify,
            spotify::connect_spotify,
            spotify::disconnect_spotify,
            spotify::get_spotify_playback,
            spotify::spotify_play_context,
            spotify::spotify_playback_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the control panel");
}
