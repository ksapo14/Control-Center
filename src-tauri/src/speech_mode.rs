use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const MINIMUM_CONFIDENCE: f64 = 0.72;
const MAX_PHRASES: usize = 200;

const RECOGNIZER_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$engine = $null
$subscription = $null
try {
  Add-Type -AssemblyName System.Speech
  $configuration = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $phrases = @($configuration.phrases | ForEach-Object { [string]$_ })
  if ($phrases.Count -eq 0) { throw 'No speech command phrases were provided.' }

  $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($recognizers.Count -eq 0) { throw 'Windows Speech Recognition is not installed.' }

  # The parameterless engine uses the user's configured default recognizer. This is
  # more reliable than reopening a RecognizerInfo on machines with legacy language packs.
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]$phrases)
  $builder = New-Object System.Speech.Recognition.GrammarBuilder($choices)
  $grammar = New-Object System.Speech.Recognition.Grammar($builder)
  $engine.LoadGrammar($grammar)
  $engine.SetInputToDefaultAudioDevice()

  $subscription = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -MessageData ([double]$configuration.minimumConfidence) -Action {
    $result = $Event.SourceEventArgs.Result
    if ($null -ne $result -and $result.Confidence -ge [double]$Event.MessageData) {
      $payload = @{ phrase = $result.Text; confidence = $result.Confidence } | ConvertTo-Json -Compress
      [Console]::Out.WriteLine("RESULT`t" + $payload)
      [Console]::Out.Flush()
    }
  }

  $description = [string]$recognizers[0].Description
  [Console]::Out.WriteLine("READY`t" + $description)
  [Console]::Out.Flush()
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

  while ($true) {
    Start-Sleep -Milliseconds 250
  }
} catch {
  [Console]::Out.WriteLine("ERROR`t" + $_.Exception.Message)
  [Console]::Out.Flush()
  exit 1
} finally {
  if ($null -ne $engine) {
    try { $engine.RecognizeAsyncCancel() } catch {}
    try { $engine.Dispose() } catch {}
  }
  if ($null -ne $subscription) {
    try { Unregister-Event -SubscriptionId $subscription.Id } catch {}
    try { Remove-Job -Id $subscription.Id -Force } catch {}
  }
}
"#;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRecognitionEvent {
    phrase: String,
    confidence: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModeStatus {
    active: bool,
    phrase_count: usize,
    recognizer: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognizerConfiguration<'a> {
    phrases: &'a [String],
    minimum_confidence: f64,
}

struct ActiveSpeechMode {
    child: Child,
    phrases: Vec<String>,
    recognizer: String,
}

impl Drop for ActiveSpeechMode {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct SpeechModeRuntime {
    active: Option<ActiveSpeechMode>,
    starting: bool,
    generation: u64,
}

#[derive(Clone, Default)]
pub struct SpeechModeManager {
    runtime: Arc<Mutex<SpeechModeRuntime>>,
}

fn normalize_phrase(value: &str) -> Option<String> {
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let length = normalized.chars().count();
    if !(2..=64).contains(&length)
        || !normalized
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, ' ' | '\'' | '-'))
    {
        return None;
    }
    Some(normalized)
}

fn normalize_phrases(phrases: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = phrases
        .iter()
        .filter_map(|phrase| normalize_phrase(phrase))
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        return Err("Add at least one valid speech command before enabling Speech Mode".into());
    }
    if normalized.len() > MAX_PHRASES {
        return Err(format!(
            "Speech Mode supports up to {MAX_PHRASES} active phrases"
        ));
    }
    Ok(normalized)
}

#[cfg(target_os = "windows")]
fn spawn_recognizer(
    app: AppHandle,
    phrases: Vec<String>,
    runtime: Arc<Mutex<SpeechModeRuntime>>,
    generation: u64,
) -> Result<ActiveSpeechMode, String> {
    let mut child = crate::hidden_command("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            RECOGNIZER_SCRIPT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            crate::command_error("Windows Speech Recognition could not start", error)
        })?;

    let configuration = serde_json::to_vec(&RecognizerConfiguration {
        phrases: &phrases,
        minimum_confidence: MINIMUM_CONFIDENCE,
    })
    .map_err(|error| crate::command_error("Speech configuration could not be encoded", error))?;

    let mut stdin = child.stdin.take().ok_or_else(|| {
        "Windows Speech Recognition did not open its configuration channel".to_string()
    })?;
    stdin
        .write_all(&configuration)
        .and_then(|_| stdin.flush())
        .map_err(|error| crate::command_error("Speech configuration could not be sent", error))?;
    drop(stdin);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Windows Speech Recognition did not open its result channel".to_string())?;
    let (startup_sender, startup_receiver) = mpsc::sync_channel::<Result<String, String>>(1);
    thread::spawn(move || {
        let mut startup_pending = true;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(recognizer) = line.strip_prefix("READY\t") {
                if startup_pending {
                    let _ = startup_sender.send(Ok(recognizer.to_owned()));
                    startup_pending = false;
                }
                continue;
            }
            if let Some(message) = line.strip_prefix("ERROR\t") {
                if startup_pending {
                    let _ = startup_sender.send(Err(message.to_owned()));
                    startup_pending = false;
                } else {
                    let _ = app.emit("speech-mode-error", message.to_owned());
                }
                continue;
            }
            if let Some(payload) = line.strip_prefix("RESULT\t") {
                if let Ok(recognition) = serde_json::from_str::<SpeechRecognitionEvent>(payload) {
                    let _ = app.emit("speech-command-recognized", recognition);
                }
            }
        }
        if startup_pending {
            let _ = startup_sender.send(Err(
                "Windows Speech Recognition stopped before it became ready".into(),
            ));
        }
    });

    let deadline = Instant::now() + Duration::from_secs(8);
    let startup = loop {
        let canceled = runtime
            .lock()
            .map_or(true, |state| state.generation != generation);
        if canceled {
            break Err("Speech Mode start was canceled".to_string());
        }
        let now = Instant::now();
        if now >= deadline {
            break Err("Windows Speech Recognition did not become ready in time".to_string());
        }
        let wait = (deadline - now).min(Duration::from_millis(100));
        match startup_receiver.recv_timeout(wait) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err("Windows Speech Recognition stopped before it became ready".into());
            }
        }
    };

    match startup {
        Ok(recognizer) => Ok(ActiveSpeechMode {
            child,
            phrases,
            recognizer,
        }),
        Err(message) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(message)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn spawn_recognizer(
    _app: AppHandle,
    _phrases: Vec<String>,
    _runtime: Arc<Mutex<SpeechModeRuntime>>,
    _generation: u64,
) -> Result<ActiveSpeechMode, String> {
    Err("Speech Mode currently uses the lightweight Windows speech engine".into())
}

fn status_for(active: Option<&ActiveSpeechMode>) -> SpeechModeStatus {
    SpeechModeStatus {
        active: active.is_some(),
        phrase_count: active.map_or(0, |runtime| runtime.phrases.len()),
        recognizer: active.map(|runtime| runtime.recognizer.clone()),
    }
}

fn clear_finished_recognizer(runtime: &mut SpeechModeRuntime) {
    let finished = runtime
        .active
        .as_mut()
        .is_some_and(|active| !matches!(active.child.try_wait(), Ok(None)));
    if finished {
        runtime.active.take();
    }
}

#[tauri::command]
pub fn start_speech_mode(
    app: AppHandle,
    manager: State<'_, SpeechModeManager>,
    phrases: Vec<String>,
) -> Result<SpeechModeStatus, String> {
    let phrases = normalize_phrases(phrases)?;
    let (previous, generation) = {
        let mut runtime = manager
            .runtime
            .lock()
            .map_err(|_| "Speech Mode state is unavailable".to_string())?;
        if runtime.starting {
            return Err("Speech Mode is already changing state".into());
        }
        clear_finished_recognizer(&mut runtime);
        if runtime
            .active
            .as_ref()
            .is_some_and(|active| active.phrases == phrases)
        {
            return Ok(status_for(runtime.active.as_ref()));
        }
        runtime.starting = true;
        runtime.generation = runtime.generation.wrapping_add(1);
        let generation = runtime.generation;
        (runtime.active.take(), generation)
    };
    drop(previous);

    let replacement = spawn_recognizer(app, phrases, manager.runtime.clone(), generation);
    let mut runtime = manager
        .runtime
        .lock()
        .map_err(|_| "Speech Mode state is unavailable".to_string())?;
    if runtime.generation != generation {
        drop(runtime);
        drop(replacement);
        return Err("Speech Mode start was canceled".into());
    }
    runtime.starting = false;
    match replacement {
        Ok(active) => {
            runtime.active = Some(active);
            Ok(status_for(runtime.active.as_ref()))
        }
        Err(message) => Err(message),
    }
}

#[tauri::command]
pub fn update_speech_mode_phrases(
    app: AppHandle,
    manager: State<'_, SpeechModeManager>,
    phrases: Vec<String>,
) -> Result<SpeechModeStatus, String> {
    let phrases = normalize_phrases(phrases)?;
    let (previous, generation) = {
        let mut runtime = manager
            .runtime
            .lock()
            .map_err(|_| "Speech Mode state is unavailable".to_string())?;
        if runtime.starting {
            return Err("Speech Mode is already changing state".into());
        }
        clear_finished_recognizer(&mut runtime);
        let Some(active) = runtime.active.as_ref() else {
            runtime.starting = true;
            runtime.generation = runtime.generation.wrapping_add(1);
            let generation = runtime.generation;
            drop(runtime);
            let replacement = spawn_recognizer(app, phrases, manager.runtime.clone(), generation);
            let mut runtime = manager
                .runtime
                .lock()
                .map_err(|_| "Speech Mode state is unavailable".to_string())?;
            if runtime.generation != generation {
                drop(runtime);
                drop(replacement);
                return Err("Speech Mode update was canceled".into());
            }
            runtime.starting = false;
            return match replacement {
                Ok(active) => {
                    runtime.active = Some(active);
                    Ok(status_for(runtime.active.as_ref()))
                }
                Err(message) => Err(message),
            };
        };
        if active.phrases == phrases {
            return Ok(status_for(runtime.active.as_ref()));
        }
        runtime.starting = true;
        runtime.generation = runtime.generation.wrapping_add(1);
        let generation = runtime.generation;
        (runtime.active.take(), generation)
    };
    drop(previous);

    let replacement = spawn_recognizer(app, phrases, manager.runtime.clone(), generation);
    let mut runtime = manager
        .runtime
        .lock()
        .map_err(|_| "Speech Mode state is unavailable".to_string())?;
    if runtime.generation != generation {
        drop(runtime);
        drop(replacement);
        return Err("Speech Mode update was canceled".into());
    }
    runtime.starting = false;
    match replacement {
        Ok(active) => {
            runtime.active = Some(active);
            Ok(status_for(runtime.active.as_ref()))
        }
        Err(message) => Err(message),
    }
}

#[tauri::command]
pub fn stop_speech_mode(manager: State<'_, SpeechModeManager>) -> Result<SpeechModeStatus, String> {
    let active = {
        let mut runtime = manager
            .runtime
            .lock()
            .map_err(|_| "Speech Mode state is unavailable".to_string())?;
        runtime.generation = runtime.generation.wrapping_add(1);
        runtime.starting = false;
        runtime.active.take()
    };
    drop(active);
    Ok(SpeechModeStatus {
        active: false,
        phrase_count: 0,
        recognizer: None,
    })
}

#[tauri::command]
pub fn get_speech_mode_status(
    manager: State<'_, SpeechModeManager>,
) -> Result<SpeechModeStatus, String> {
    let mut runtime = manager
        .runtime
        .lock()
        .map_err(|_| "Speech Mode state is unavailable".to_string())?;
    clear_finished_recognizer(&mut runtime);
    Ok(status_for(runtime.active.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::{normalize_phrase, normalize_phrases, MAX_PHRASES};

    #[test]
    fn phrase_normalization_is_case_and_space_insensitive() {
        assert_eq!(
            normalize_phrase("  Quick   Schedule  "),
            Some("quick schedule".into())
        );
    }

    #[test]
    fn unsafe_or_empty_phrases_are_rejected() {
        assert_eq!(normalize_phrase(""), None);
        assert_eq!(normalize_phrase("open; calc"), None);
        assert_eq!(normalize_phrase(&"a".repeat(65)), None);
    }

    #[test]
    fn phrase_lists_are_sorted_and_deduplicated() {
        assert_eq!(
            normalize_phrases(vec![
                "Planning".into(),
                "planning".into(),
                "Quick schedule".into()
            ])
            .unwrap(),
            vec!["planning".to_string(), "quick schedule".to_string()],
        );
    }

    #[test]
    fn phrase_list_limit_is_enforced() {
        let phrases = (0..=MAX_PHRASES)
            .map(|index| format!("phrase {index}"))
            .collect();
        assert!(normalize_phrases(phrases).is_err());
    }
}
