// vocal_remover.rs — WannaCut Vocal Remover
//
// Cargo.toml dependencies needed:
// reqwest = { version = "0.12", features = ["json", "stream"] }
// serde_json = "1"
// serde = { version = "1", features = ["derive"] }
// chrono = { version = "0.4", features = ["serde"] }
// tokio = { version = "1", features = ["process"] }
// flate2 = "1"
// tar = "0.4"

use std::fs;
use std::path::{Path, PathBuf};
use chrono::Utc;
use serde_json::Value;
use crate::limits::limits_for;
use crate::plans::validate_offline;

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

#[cfg(target_os = "linux")]
const ENGINE_URL: &str = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/engines/htdemucs_engine_linux.tar.gz";
#[cfg(target_os = "windows")]
const ENGINE_URL: &str = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/engines/htdemucs_engine_windows.tar.gz";

const MODEL_URL: &str        = "https://pub-591b6277df304d089f3df855a0e82176.r2.dev/models/htdemucs.safetensors";
const ENGINE_DIRNAME: &str   = "htdemucs_inference";   // folder name inside tar.gz
const ENGINE_BINARY: &str    = "htdemucs_inference";   // executable inside the folder
const MODEL_FILENAME: &str   = "htdemucs.safetensors";
const USAGE_KEY_VOCAL: &str  = "usage_vocal_remover";

// ─────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────

#[derive(Debug)]
pub enum VocalRemoverError {
    LimitReached { used: u32, limit: u32 },
    EngineNotFound,
    ModelNotFound,
    DownloadFailed(String),
    ExtractFailed(String),
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
            VocalRemoverError::ExtractFailed(e) =>
                write!(f, "Extraction failed: {e}"),
            VocalRemoverError::InferenceError(e) =>
                write!(f, "Inference error: {e}"),
            VocalRemoverError::SettingsError(e) =>
                write!(f, "Settings error: {e}"),
        }
    }
}

// ─────────────────────────────────────────────
// PATHS
// engines dir:  {settings_folder}/engines/
// engine dir:   {settings_folder}/engines/htdemucs_inference/
// engine bin:   {settings_folder}/engines/htdemucs_inference/htdemucs_inference
// model:        {settings_folder}/models/htdemucs.safetensors
// ─────────────────────────────────────────────

fn engines_dir(settings_folder: &str) -> PathBuf {
    PathBuf::from(settings_folder).join("engines")
}

fn engine_dir(settings_folder: &str) -> PathBuf {
    engines_dir(settings_folder).join(ENGINE_DIRNAME)
}

fn engine_bin(settings_folder: &str) -> PathBuf {
    engine_dir(settings_folder).join(ENGINE_BINARY)
}

fn model_path(settings_folder: &str) -> PathBuf {
    PathBuf::from(settings_folder).join("models").join(MODEL_FILENAME)
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

    Ok(())
}

// ─────────────────────────────────────────────
// TAR.GZ EXTRACTION
// ─────────────────────────────────────────────

fn extract_engine(tar_path: &Path, dest_dir: &Path) -> Result<(), VocalRemoverError> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = fs::File::open(tar_path)
        .map_err(|e| VocalRemoverError::ExtractFailed(e.to_string()))?;

    let gz  = GzDecoder::new(file);
    let mut archive = Archive::new(gz);

    archive.unpack(dest_dir)
        .map_err(|e| VocalRemoverError::ExtractFailed(e.to_string()))?;

    // Make the binary and wrapper executable on Linux
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;

        let bin = dest_dir.join(ENGINE_DIRNAME).join(ENGINE_BINARY);
        let bin_inner = dest_dir.join(ENGINE_DIRNAME).join(format!("{ENGINE_BINARY}_bin"));

        for path in [&bin, &bin_inner] {
            if path.exists() {
                let mut perms = fs::metadata(path)
                    .map_err(|e| VocalRemoverError::ExtractFailed(e.to_string()))?
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(path, perms)
                    .map_err(|e| VocalRemoverError::ExtractFailed(e.to_string()))?;
            }
        }
    }

    // Remove the tar.gz after successful extraction
    let _ = fs::remove_file(tar_path);

    Ok(())
}

// ─────────────────────────────────────────────
// USAGE COUNTER
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

/// Check if engine folder and model are already present.
#[tauri::command]
pub fn vocal_remover_ready(settings_folder: String) -> serde_json::Value {
    serde_json::json!({
        "engine": engine_bin(&settings_folder).exists(),
        "model":  model_path(&settings_folder).exists(),
    })
}

/// Download engine tar.gz + model, extract engine.
#[tauri::command]
pub async fn vocal_remover_download(
    app: tauri::AppHandle,
    settings_folder: String,
) -> Result<(), String> {
    use tauri::Emitter;

    // ── Engine ────────────────────────────────────────────────────
    if !engine_bin(&settings_folder).exists() {
        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "engine", "status": "downloading"
        })).ok();

        // Download tar.gz to a temp path
        let tar_path = engines_dir(&settings_folder).join("htdemucs_engine.tar.gz");

        download_file(ENGINE_URL, &tar_path)
            .await
            .map_err(|e| e.to_string())?;

        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "engine", "status": "extracting"
        })).ok();

        // Extract into engines dir — creates htdemucs_inference/ subfolder
        extract_engine(&tar_path, &engines_dir(&settings_folder))
            .map_err(|e| e.to_string())?;

        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "engine", "status": "done"
        })).ok();
    }

    // ── Model ─────────────────────────────────────────────────────
    if !model_path(&settings_folder).exists() {
        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "model", "status": "downloading"
        })).ok();

        download_file(MODEL_URL, &model_path(&settings_folder))
            .await
            .map_err(|e| e.to_string())?;

        app.emit("vocal_remover_progress", serde_json::json!({
            "step": "model", "status": "done"
        })).ok();
    }

    Ok(())
}

/// Remove vocals from an audio file.
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
    let bin   = engine_bin(&settings_folder);
    let model = model_path(&settings_folder);

    if !bin.exists() {
        return Err(VocalRemoverError::EngineNotFound.to_string());
    }
    if !model.exists() {
        return Err(VocalRemoverError::ModelNotFound.to_string());
    }

    // ── 4. Output dir = extracted_audios of current project ───────
    let input      = Path::new(&audio_path);
    let output_dir = input.parent().unwrap_or(Path::new("."));

    // ── 5. Call engine subprocess ─────────────────────────────────
    let output = tokio::process::Command::new(&bin)
        .arg("--input")      .arg(&audio_path)
        .arg("--output_dir") .arg(output_dir)
        .arg("--mode")       .arg(output_mode.as_str())
        .arg("--model")      .arg(&model)
        .output()
        .await
        .map_err(|e| VocalRemoverError::InferenceError(e.to_string()).to_string())?;

    // ── 6. Parse JSON from stdout ─────────────────────────────────
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
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