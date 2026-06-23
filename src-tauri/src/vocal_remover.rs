// vocal_remover.rs — WannaCut Vocal Remover
//
// Cargo.toml dependencies needed:
// hound = "3"
// reqwest = { version = "0.12", features = ["json", "stream"] }
// serde_json = "1"
// serde = { version = "1", features = ["derive"] }
// chrono = { version = "0.4", features = ["serde"] }
// tokio = { version = "1", features = ["process"] }

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Utc;
use serde_json::Value;
use crate::limits::limits_for;
use crate::plans::validate_offline;

// ─────────────────────────────────────────────
// CONSTANTS — update URLs after uploading to CDN
// ─────────────────────────────────────────────

#[cfg(target_os = "linux")]
const ENGINE_URL: &str = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/engines/htdemucs_inference_linux";
#[cfg(target_os = "windows")]
const ENGINE_URL: &str = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/engines/htdemucs_inference_windows.exe";

const MODEL_URL: &str   = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/models/htdemucs.safetensors";
const ENGINE_FILENAME: &str = "htdemucs_inference";
const MODEL_FILENAME: &str  = "htdemucs.safetensors";
const USAGE_KEY_VOCAL: &str = "usage_vocal_remover";

// ─────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────

#[derive(Debug)]
pub enum VocalRemoverError {
    LimitReached { used: u32, limit: u32 },
    EngineNotFound,
    ModelNotFound,
    DownloadFailed(String),
    AudioReadError(String),
    InferenceError(String),
    SettingsError(String),
}

impl std::fmt::Display for VocalRemoverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VocalRemoverError::LimitReached { used, limit } =>
                write!(f, "Daily limit reached ({used}/{limit}). Upgrade your plan."),
            VocalRemoverError::EngineNotFound =>
                write!(f, "Inference engine not found. Please download it first."),
            VocalRemoverError::ModelNotFound =>
                write!(f, "AI model not found. Please download it first."),
            VocalRemoverError::DownloadFailed(e) =>
                write!(f, "Download failed: {e}"),
            VocalRemoverError::AudioReadError(e) =>
                write!(f, "Failed to read audio: {e}"),
            VocalRemoverError::InferenceError(e) =>
                write!(f, "Inference error: {e}"),
            VocalRemoverError::SettingsError(e) =>
                write!(f, "Settings error: {e}"),
        }
    }
}

// ─────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────

fn engine_path(workspace: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    return PathBuf::from(workspace).join("engines").join(format!("{ENGINE_FILENAME}.exe"));
    #[cfg(not(target_os = "windows"))]
    return PathBuf::from(workspace).join("engines").join(ENGINE_FILENAME);
}

fn model_path(workspace: &str) -> PathBuf {
    PathBuf::from(workspace).join("models").join(MODEL_FILENAME)
}

// ─────────────────────────────────────────────
// DOWNLOAD HELPER
// ─────────────────────────────────────────────

async fn download_file(url: &str, dest: &Path) -> Result<(), VocalRemoverError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?;
    }

    let response = reqwest::get(url)
        .await
        .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?;

    if !response.status().is_success() {
        return Err(VocalRemoverError::DownloadFailed(
            format!("HTTP {}", response.status())
        ));
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?;

    fs::write(dest, bytes)
        .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?;

    // Make executable on Linux
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest)
            .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms)
            .map_err(|e| VocalRemoverError::DownloadFailed(e.to_string()))?;
    }

    Ok(())
}

// ─────────────────────────────────────────────
// USAGE COUNTER
// Stored in wannacut_settings.json:
// { "usage_vocal_remover": { "date": "2026-06-20", "count": 3 } }
// Uses load_raw_map pattern — never overwrites React fields.
// ─────────────────────────────────────────────

fn today_str() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

fn get_today_usage(settings_folder: &str, key: &str) -> u32 {
    let path = PathBuf::from(settings_folder).join("wannacut_settings.json");
    let Ok(json) = fs::read_to_string(&path) else { return 0 };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&json) else { return 0 };
    let Some(Value::Object(entry)) = map.get(key) else { return 0 };
    let today = today_str();
    match (entry.get("date"), entry.get("count")) {
        (Some(Value::String(date)), Some(Value::Number(count))) if date == &today =>
            count.as_u64().unwrap_or(0) as u32,
        _ => 0,
    }
}

fn increment_usage(settings_folder: &str, key: &str) -> Result<(), VocalRemoverError> {
    let path = PathBuf::from(settings_folder).join("wannacut_settings.json");
    let today = today_str();

    let mut map = match fs::read_to_string(&path) {
        Ok(json) => match serde_json::from_str::<Value>(&json) {
            Ok(Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        },
        Err(_) => serde_json::Map::new(),
    };

    let current = match map.get(key) {
        Some(Value::Object(entry)) =>
            match (entry.get("date"), entry.get("count")) {
                (Some(Value::String(d)), Some(Value::Number(c))) if d == &today =>
                    c.as_u64().unwrap_or(0) as u32,
                _ => 0,
            },
        _ => 0,
    };

    map.insert(key.to_string(), serde_json::json!({
        "date": today,
        "count": current + 1
    }));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| VocalRemoverError::SettingsError(e.to_string()))?;
    }

    let json = serde_json::to_string_pretty(&Value::Object(map))
        .map_err(|e| VocalRemoverError::SettingsError(e.to_string()))?;

    fs::write(&path, json)
        .map_err(|e| VocalRemoverError::SettingsError(e.to_string()))?;

    Ok(())
}

// ─────────────────────────────────────────────
// OUTPUT MODE
// ─────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    VocalsOnly,
    InstrumentalOnly,
    Both,
}

impl OutputMode {
    fn as_str(&self) -> &str {
        match self {
            OutputMode::VocalsOnly       => "vocals_only",
            OutputMode::InstrumentalOnly => "instrumental_only",
            OutputMode::Both             => "both",
        }
    }
}

// ─────────────────────────────────────────────
// TAURI COMMANDS
// ─────────────────────────────────────────────

/// Check if engine and model are already downloaded.
#[tauri::command]
pub fn vocal_remover_ready(workspace: String) -> serde_json::Value {
    serde_json::json!({
        "engine": engine_path(&workspace).exists(),
        "model":  model_path(&workspace).exists(),
    })
}

/// Download engine binary + model file (called on first use).
/// Shows progress via Tauri events.
#[tauri::command]
pub async fn vocal_remover_download(
    app: tauri::AppHandle,
    workspace: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let engine = engine_path(&workspace);
    let model  = model_path(&workspace);

    if !engine.exists() {
        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "engine", "status": "downloading"
        })).ok();

        download_file(ENGINE_URL, &engine)
            .await
            .map_err(|e| e.to_string())?;

        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "engine", "status": "done"
        })).ok();
    }

    if !model.exists() {
        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "model", "status": "downloading"
        })).ok();

        download_file(MODEL_URL, &model)
            .await
            .map_err(|e| e.to_string())?;

        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "model", "status": "done"
        })).ok();
    }

    Ok(())
}

/// Main command — remove vocals from an audio file.
///
/// React usage:
///   await invoke("remove_vocals", {
///     settingsFolder: wannacut_settings_folder,
///     workspace: rootPath,
///     audioPath: "/path/to/audio.wav",
///     outputMode: "vocals_only" | "instrumental_only" | "both",
///   })
///
/// Returns: { vocals?: string, instrumental?: string }
#[tauri::command]
pub async fn remove_vocals(
    settings_folder: String,
    workspace: String,
    audio_path: String,
    output_mode: OutputMode,
) -> Result<serde_json::Value, String> {

    // ── 1. Validate license ───────────────────────────────────────
    let license = validate_offline(&settings_folder)
        .map_err(|e| e.to_string())?;

    // ── 2. Check daily limit ──────────────────────────────────────
    let limits = limits_for(&license.plan);
    let used   = get_today_usage(&settings_folder, USAGE_KEY_VOCAL);

    if let Some(limit) = limits.vocal_remover_daily {
        if used >= limit {
            return Err(VocalRemoverError::LimitReached { used, limit }.to_string());
        }
    }

    // ── 3. Check engine and model exist ───────────────────────────
    let engine = engine_path(&workspace);
    let model  = model_path(&workspace);

    if !engine.exists() {
        return Err(VocalRemoverError::EngineNotFound.to_string());
    }
    if !model.exists() {
        return Err(VocalRemoverError::ModelNotFound.to_string());
    }

    // ── 4. Output dir = same folder as input ─────────────────────
    let input  = Path::new(&audio_path);
    let output_dir = input.parent().unwrap_or(Path::new("."));

    // ── 5. Call Python engine as subprocess ───────────────────────
    let output = tokio::process::Command::new(&engine)
        .arg("--input")      .arg(&audio_path)
        .arg("--output_dir") .arg(output_dir)
        .arg("--mode")       .arg(output_mode.as_str())
        .arg("--model")      .arg(&model)
        .output()
        .await
        .map_err(|e| VocalRemoverError::InferenceError(e.to_string()).to_string())?;

    // ── 6. Parse JSON result from stdout ─────────────────────────
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try to parse error JSON from stderr
        if let Ok(err_json) = serde_json::from_str::<Value>(&stderr) {
            if let Some(msg) = err_json.get("error").and_then(|v| v.as_str()) {
                return Err(VocalRemoverError::InferenceError(msg.to_string()).to_string());
            }
        }
        return Err(VocalRemoverError::InferenceError(stderr.to_string()).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: Value = serde_json::from_str(&stdout)
        .map_err(|e| VocalRemoverError::InferenceError(
            format!("Invalid engine output: {e}")
        ).to_string())?;

    // ── 7. Increment usage counter ────────────────────────────────
    increment_usage(&settings_folder, USAGE_KEY_VOCAL)
        .map_err(|e| e.to_string())?;

    Ok(result)
}