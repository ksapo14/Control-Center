# Control Panel

Control Panel is an open-source, Windows-first desktop dashboard for frequently used system controls, apps, media, scheduling, and focus tools. It combines a React/TypeScript interface with a Rust backend powered by Tauri 2, giving the UI controlled access to native Windows features.

> [!IMPORTANT]
> This is personal, early-stage software (`v0.1.0`), not a finished Windows system utility. Review the [warnings and limitations](#warnings-and-limitations) before running it. In particular, the task manager can force-close applications and discard unsaved work.

## Open-source use

This project is free and open source under the [MIT License](LICENSE). Anyone may use, copy, modify, merge, publish, distribute, sublicense, or sell copies of this project, including for personal and commercial purposes, as long as the license and copyright notice are included.

Fork it, adapt the controls to your own computer, replace the integrations, redesign the interface, or use individual parts in another project. Contributions and derivative projects are welcome. The software is provided without warranty.

## What it includes

- A fullscreen, custom-framed Windows dashboard.
- System volume and supported internal or DDC/CI monitor brightness controls.
- Battery, CPU, memory, and available GPU activity readings.
- Bluetooth audio quick-connect and disconnect controls.
- An application launcher for selected desktop apps, websites, and VS Code folders.
- A task manager for viewing and force-closing visible application windows.
- Spotify playback status, transport controls, and playlist shortcuts.
- Gemini-assisted natural-language scheduling with editable single- or multi-event drafts, plus a lightweight tabular editor for creating multiple manual Google Calendar events at once.
- A local task checklist and habit tracker with due dates, daily/weekday/weekly rhythms, completion history, and calculated streaks.
- A configurable Pomodoro timer with an audio-reactive focus background. Separate blobs respond to bass, midrange, and treble energy from Windows loopback audio.
- Global media-key controls and native window minimize/close actions.

## Technology

| Layer | Main technologies |
| --- | --- |
| Desktop runtime | Tauri 2 |
| Native backend | Rust, Windows APIs, PowerShell/CIM |
| Interface | React 18, TypeScript, Vite |
| Styling and motion | Tailwind CSS, Framer Motion |
| Integrations | Spotify Web API, Gemini API, Google Calendar API |

The frontend lives in `src/`. Native commands and integrations live in `src-tauri/src/`. Most system-level features are deliberately implemented for Windows and return an unsupported-platform message elsewhere.

## Requirements

The complete desktop experience currently requires Windows 10 or Windows 11. A browser-only preview can show the interface on other platforms, but native controls will not work.

Install the following development prerequisites:

1. [Node.js](https://nodejs.org/) current LTS release, including npm.
2. [Rust](https://www.rust-lang.org/tools/install) through `rustup`, using the stable MSVC toolchain.
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** selected.
4. [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). It is normally already present on current Windows installations.
5. Git, if cloning the repository instead of downloading a source archive.

See the official [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) if the native build toolchain is not already installed.

You can confirm the main tools are available with:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

If Rust is installed with a non-MSVC default toolchain, switch it with:

```powershell
rustup default stable-msvc
```

## Install and run from source

1. Clone the repository or download and extract its source code.

   ```powershell
   git clone <repository-url>
   cd "Control Panel"
   ```

2. Install the locked JavaScript dependencies.

   ```powershell
   npm ci
   ```

3. Start the desktop app in development mode.

   ```powershell
   npm run tauri dev
   ```

The first native run can take several minutes because Cargo must download and compile the Rust dependency graph. Later builds are substantially faster.

To preview only the web interface, run:

```powershell
npm run dev
```

Then open `http://localhost:1420`. The browser preview is useful for interface work, but system controls, OAuth connections, application launching, and other Tauri commands require the desktop runtime.

## Build a release executable

Run the full production build:

```powershell
npm run tauri build
```

The current Tauri configuration has bundling disabled, so this creates a release executable rather than an installer. The executable will normally be located at:

```text
src-tauri/target/release/control-panel.exe
```

To produce MSI or NSIS installers for distribution, change `bundle.active` to `true` in `src-tauri/tauri.conf.json` and build again. Review Tauri's [Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/) first; installer builds can require additional Windows components and distributed unsigned binaries may trigger Microsoft SmartScreen warnings.

Useful validation commands:

```powershell
npm run build
cd src-tauri
cargo check
cargo fmt -- --check
```

## Personalize it for your computer

Several controls reflect the original personal setup and should be changed in a fork:

- **Bluetooth device:** `src/components/BluetoothWidget.tsx` currently targets `JLab GO Pop+`. Replace every instance with the exact Windows audio endpoint name you want to control.
- **Application buttons:** edit the launcher list in `src/components/AppLauncherWidget.tsx`. Native applications must also be added to the allowlist in the `launch_app` command in `src-tauri/src/lib.rs`; changing only the button is intentionally insufficient.
- **Spotify shortcuts:** edit the playlist entries near the top of `src/components/SpotifyWidget.tsx`.
- **Window behavior:** fullscreen mode, decorations, title, identifier, and bundling are configured in `src-tauri/tauri.conf.json`.
- **Theme and layout:** global styling is in `src/index.css` and Tailwind configuration is in `tailwind.config.js`.
- **Tasks and habits:** open **Tasks** in the top toolbar. Task rows support optional due dates; habit rows record completion against the local calendar date and calculate consecutive daily, weekday, or weekly streaks.
- **App-group layouts:** choose **Open window layout editor after launch** while creating an app group. Launching that group closes Control Center, waits briefly for the application windows, and opens the Window Workspace canvas for manual placement. Saved Window Workspace profiles remain available for automatic layouts.

Application discovery expects Chrome and VS Code in common Windows install locations. Minecraft Launcher and ChatGPT are resolved through the Windows Start Apps registry. A launcher will report an error when its target is not installed or has a different registered name.

## Optional Spotify setup

Spotify uses the Authorization Code flow with PKCE. The app stores only a Client ID; do not add a Spotify client secret.

1. Create an application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add this loopback redirect URI to the Spotify app settings:

   ```text
   http://127.0.0.1/spotify/callback
   ```

   The app adds a dynamically selected port during authorization. Spotify permits dynamic ports for an explicitly registered loopback IP URI. Do not substitute `localhost`.
3. Open Control Panel and enter the Spotify **Client ID** in the Spotify widget.
4. Select the connect action and finish authorization in the browser within three minutes.
5. Open Spotify on a controllable device and start playback once if no active device is detected.

Spotify playback modification generally requires a Spotify Premium account and remains subject to Spotify's developer-mode access rules, API policies, quotas, and service availability. The requested scopes are limited to playback state, currently playing content, and playback control.

For details, see Spotify's documentation for [PKCE authorization](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) and [loopback redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Optional Google Calendar setup

Quick Schedule creates reviewed events in the connected account's primary Google Calendar. It requests the `calendar.events` OAuth scope.

The **Manual events** tab provides Date, Title, Time from, Time to, and Color columns. Add as many rows as needed, review the table, and submit the complete set with one **Add to Calendar** action. Successfully created rows are cleared; if Google rejects an individual event, that row remains available for correction.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen. If the app is in external testing mode, add your Google account as a test user.
4. Create an OAuth 2.0 Client ID with the application type **Desktop app**.
5. Download the client JSON directly from Google Cloud.
6. In Control Panel, open **Quick schedule**, choose **Import JSON**, and select the downloaded Desktop OAuth JSON file.
7. Choose **Connect Google** and finish authorization in the browser within three minutes.

The imported OAuth client file is validated and copied into the local app configuration directory using Windows DPAPI encryption. The original downloaded JSON remains your responsibility: do not commit it, post it publicly, or send it to other people. Google may display an unverified-app warning while a privately developed OAuth app is in testing. Public distribution can require additional consent-screen configuration or verification. See Google's [Calendar authentication guidance](https://developers.google.com/workspace/calendar/api/auth).

## Optional Gemini Quick Schedule setup

The **Describe with Gemini** tab converts one natural-language sequence into one or more editable event drafts using `gemini-3.5-flash`. It does not create events automatically. Each result is validated by the Rust backend, shown in the review editor, and submitted to Google Calendar only when **Schedule** is selected.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Copy the checked-in template to a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Replace the placeholder in `.env`:

   ```dotenv
   GEMINI_API_KEY=your_key_here
   ```

4. Start or restart the desktop app with `npm run tauri dev`.

The backend reads `GEMINI_API_KEY` from the process environment or a local `.env` at runtime. For a standalone executable, either set the process environment variable or place `.env` beside the executable. Do not rename it to `VITE_GEMINI_API_KEY`: variables prefixed with `VITE_` are compiled into client-side JavaScript.

### Gemini scheduling pipeline

1. The React interface sends instructions, the current RFC 3339 timestamp, and the local IANA time zone to a Tauri command. It never receives the API key.
2. The Rust backend calls Gemini's Interactions API with the key in the `x-goog-api-key` header, a strict calendar-only system instruction, and a closed JSON schema. Transient `408`, `429`, connection, timeout, and `5xx` failures are retried with bounded exponential backoff and jitter.
3. The system instruction treats user text only as scheduling data, preserves explicit details, resolves relative dates against the supplied clock and time zone, defaults an omitted duration to 60 minutes, and flags ambiguities for review. It also rejects attempts inside the input to change roles, reveal instructions, or alter the output contract.
4. The backend parses the structured response and independently checks event count, title length, RFC 3339 timestamps, chronological order, optional-field limits, and Calendar color IDs.
5. Quick Schedule displays up to 25 editable drafts. A separate batch command validates the full edited set again before making Calendar API calls, and reports per-event failures without hiding successful creations.

Example input:

```text
Tomorrow: design review at 10 for 45 minutes, lunch with Sam at noon,
and focus time from 2–4. Make focus time sage.
```

## Local data and privacy

The app does not include analytics or a remote telemetry service. It does intentionally access local system information and optional third-party services to provide its features.

- Spotify and Google refresh tokens are encrypted with Windows Data Protection API (DPAPI), tying them to the current Windows user profile.
- Natural-language schedule instructions are sent to Google's Gemini API only when **Draft events** is selected. Review Google's API terms and data-use settings before sending sensitive calendar details.
- The imported Google Desktop OAuth client configuration is also DPAPI-encrypted. Existing plaintext app configuration from older versions is encrypted and removed the next time it is loaded.
- Spotify's Client ID is stored as plaintext because OAuth client IDs are public identifiers; no Spotify client secret is accepted or required.
- Disconnecting an integration removes its saved token; it may not revoke the application's access at the service. Revoke access from the relevant Google or Spotify account settings when needed.
- OAuth sign-in temporarily opens a listener on a random `127.0.0.1` port. A firewall or security product may ask for permission. The listener times out after three minutes.
- The Pomodoro visualizer captures the current Windows output stream through WASAPI loopback only while the timer is active. Audio is analyzed in memory into bass, midrange, and treble energy; the implementation does not save or upload the audio.
- Process titles, hardware telemetry, battery state, volume, and brightness are read locally for display.
- Tasks, habit definitions, and habit completion dates are saved only in browser local storage under `control-panel.tasks-habits`. They are included in Control Center backup exports and removed by the local-data reset action.

Tauri stores integration files in its application configuration directory, normally under the current Windows user's roaming AppData directory using the `com.local.controlpanel` identifier.

Rebuilding or updating the app does not clear tasks, habits, plans, app groups, layout profiles, or other `control-panel.*` preferences. They persist in the WebView data associated with the unchanged `com.local.controlpanel` application identifier. Data is removed only when you deliberately use **Reset all Control Panel settings**, clear the application's WebView data, uninstall it while removing application data, or change the Tauri identifier. Use **Export backup** before those operations or before moving the app to another computer.

### Secrets and environment variables

The repository does not contain API secrets. Local `.env` variants, private keys, downloaded credential JSON files, and integration token files are ignored by Git as a defense against accidental commits; `.env.example` contains only a placeholder.

Do not put secrets in variables prefixed with `VITE_`: Vite replaces those values during compilation and exposes them in the frontend bundle. `GEMINI_API_KEY` is read only by the Rust backend, sent in an authentication header, and never returned through a Tauri command. Keep `.env` local and rotate the key immediately if it is ever exposed.

## Warnings and limitations

Use this project at your own risk and review the source before trusting it with your system or accounts.

- **Force close can lose data.** The task manager invokes Windows `taskkill /F /T`. Save your work before using it. A small set of Windows shell processes and Control Panel itself are protected, but this is not a complete safety boundary.
- **System settings change immediately.** Volume, monitor brightness, Bluetooth audio state, and media playback are modified on the machine as soon as their controls are used.
- **Hardware support varies.** External brightness control requires a monitor and connection that support DDC/CI. Some docks, adapters, displays, or drivers do not expose this feature.
- **Bluetooth is device-specific.** The included quick-connect button is hard-coded for one headset and may fail until customized. Windows audio drivers do not all expose the reconnect controls used here.
- **The app is Windows-first.** Most native commands explicitly support Windows only. Other operating systems can render the frontend but do not have feature parity.
- **The build is not code-signed.** Windows may warn before running a downloaded or redistributed build. Never bypass a warning for a binary you did not build yourself or obtain from a source you trust.
- **OAuth grants write capabilities.** Spotify can control playback and Google Calendar can create events after authorization. Confirm the account and permissions shown on each consent screen.
- **AI drafts can be wrong.** Relative dates, names, durations, and other details can be misunderstood even with structured output and backend validation. Quick Schedule deliberately requires review before Calendar submission; confirm every draft, especially any item marked **Check details**.
- **External services can change.** Spotify and Google can alter APIs, account requirements, quotas, scopes, or verification rules independently of this project.
- **No automatic updates or support guarantee.** Pull, inspect, and rebuild newer revisions manually.
- **No warranty.** The MIT License provides this software “as is,” without guarantees of correctness, fitness, security, or continued compatibility.

## Project structure

```text
.
├── src/                         React and TypeScript interface
│   ├── components/              Dashboard widgets and dialogs
│   │   └── TaskHabitTracker.tsx Local task and habit checklist
│   └── lib/                     Frontend runtime helpers
├── src-tauri/
│   ├── src/lib.rs               Native Windows commands and Tauri setup
│   ├── src/gemini_schedule.rs   Gemini schema, system prompt, and draft validation
│   ├── src/spotify.rs           Spotify OAuth and Web API integration
│   ├── src/google_calendar.rs   Google OAuth and Calendar integration
│   ├── capabilities/            Tauri permission configuration
│   └── tauri.conf.json          Desktop window and build configuration
├── package.json                 Frontend scripts and dependencies
└── LICENSE                      MIT open-source license
```

## Contributing

Contributions are welcome. Before opening a pull request:

1. Keep native command inputs allowlisted and validated.
2. Do not commit OAuth credentials, access tokens, refresh tokens, generated build output, or machine-specific secrets.
3. Run the frontend build and Rust checks shown above.
4. Document new system permissions, network access, destructive behavior, or platform limitations.

## License

Control Panel is available under the [MIT License](LICENSE). You are free to use, copy, modify, and redistribute it in accordance with that license.
