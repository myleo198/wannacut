// vocal_remover.rs — WannaCut Vocal Remover
//
// Cargo.toml dependencies needed:
// burn = { version = "0.16", features = ["ndarray", "wgpu"] }
// burn-import = "0.16"          ← for loading the model
// hound = "3"                   ← WAV read/write
// chrono = { version = "0.4", features = ["serde"] }
// serde_json = "1"
// serde = { version = "1", features = ["derive"] }
//
// Model file (downloaded once on first use):
//   {workspace}/models/htdemucs.bin   ← burn SafeTensors format
//
// Model download URL (host on your own CDN/R2):
//   https://wannacut.app/models/htdemucs.bin

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::Value;

use crate::limits::limits_for;
use crate::plans::{validate_offline, Plan};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const MODEL_URL: &str = "https://wannacut.app/models/htdemucs.bin";
const MODEL_FILENAME: &str = "htdemucs.bin";
const USAGE_KEY_VOCAL: &str = "usage_vocal_remover";

// ─────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────

#[derive(Debug)]
pub enum VocalRemoverError {
    LimitReached { used: u32, limit: u32 },
    PlanRequired(String),
    ModelNotFound,
    ModelDownloadFailed(String),
    AudioReadError(String),
    AudioWriteError(String),
    InferenceError(String),
    SettingsError(String),
}

impl std::fmt::Display for VocalRemoverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VocalRemoverError::LimitReached { used, limit } =>
                write!(f, "Daily limit reached ({used}/{limit}). Upgrade your plan for more uses."),
            VocalRemoverError::PlanRequired(msg) =>
                write!(f, "{msg}"),
            VocalRemoverError::ModelNotFound =>
                write!(f, "AI model not found. Please download it first."),
            VocalRemoverError::ModelDownloadFailed(e) =>
                write!(f, "Failed to download model: {e}"),
            VocalRemoverError::AudioReadError(e) =>
                write!(f, "Failed to read audio file: {e}"),
            VocalRemoverError::AudioWriteError(e) =>
                write!(f, "Failed to write output audio: {e}"),
            VocalRemoverError::InferenceError(e) =>
                write!(f, "AI inference error: {e}"),
            VocalRemoverError::SettingsError(e) =>
                write!(f, "Settings error: {e}"),
        }
    }
}

// ─────────────────────────────────────────────
// USAGE COUNTER
// Stored in wannacut_settings.json as:
// {
//   "usage_vocal_remover": { "date": "2026-06-20", "count": 3 }
// }
// Uses the same load_raw_map / save_raw_map from plans.rs
// so React fields are never overwritten.
// ─────────────────────────────────────────────

fn today_str() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Returns how many times the user ran vocal remover today.
fn get_today_usage(settings_folder: &str, key: &str) -> u32 {
    let path = PathBuf::from(settings_folder).join("wannacut_settings.json");
    let Ok(json) = fs::read_to_string(&path) else { return 0 };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&json) else { return 0 };

    let Some(Value::Object(entry)) = map.get(key) else { return 0 };
    let today = today_str();

    match (entry.get("date"), entry.get("count")) {
        (Some(Value::String(date)), Some(Value::Number(count))) if date == &today => {
            count.as_u64().unwrap_or(0) as u32
        }
        _ => 0,
    }
}

/// Increments the usage counter for today. Resets automatically on a new day.
fn increment_usage(settings_folder: &str, key: &str) -> Result<(), VocalRemoverError> {
    let path = PathBuf::from(settings_folder).join("wannacut_settings.json");
    let today = today_str();

    // Load full map to preserve React fields
    let mut map = match fs::read_to_string(&path) {
        Ok(json) => match serde_json::from_str::<Value>(&json) {
            Ok(Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        },
        Err(_) => serde_json::Map::new(),
    };

    let current_count = match map.get(key) {
        Some(Value::Object(entry)) => {
            match (entry.get("date"), entry.get("count")) {
                (Some(Value::String(date)), Some(Value::Number(count))) if date == &today => {
                    count.as_u64().unwrap_or(0) as u32
                }
                _ => 0,
            }
        }
        _ => 0,
    };

    let new_entry = serde_json::json!({
        "date": today,
        "count": current_count + 1
    });

    map.insert(key.to_string(), new_entry);

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
// MODEL PATH
// ─────────────────────────────────────────────

fn model_path(workspace: &str) -> PathBuf {
    PathBuf::from(workspace).join("models").join(MODEL_FILENAME)
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

// ─────────────────────────────────────────────
// TAURI COMMANDS
// ─────────────────────────────────────────────

/// Check if the model file is already downloaded.
#[tauri::command]
pub fn vocal_remover_model_exists(workspace: String) -> bool {
    model_path(&workspace).exists()
}

/// Download the model file if not present. Call this before remove_vocals.
/// Returns progress as a percentage via Tauri events (future: use channels).
#[tauri::command]
pub async fn vocal_remover_download_model(workspace: String) -> Result<(), String> {
    let path = model_path(&workspace);

    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let response = reqwest::get(MODEL_URL)
        .await
        .map_err(|e| VocalRemoverError::ModelDownloadFailed(e.to_string()).to_string())?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| VocalRemoverError::ModelDownloadFailed(e.to_string()).to_string())?;

    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(())
}

/// Main command — removes vocals from an audio file.
///
/// React usage:
///   await invoke("remove_vocals", {
///     settingsFolder: wannacut_settings_folder,
///     workspace: rootPath,
///     audioPath: "/path/to/audio.wav",
///     outputMode: "vocals_only" | "instrumental_only" | "both",
///   })
///
/// Returns: path(s) to the output file(s).
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
    let used = get_today_usage(&settings_folder, USAGE_KEY_VOCAL);

    if let Some(limit) = limits.vocal_remover_daily {
        if used >= limit {
            return Err(VocalRemoverError::LimitReached { used, limit }.to_string());
        }
    }

    // ── 3. Check model exists ─────────────────────────────────────
    let model_file = model_path(&workspace);
    if !model_file.exists() {
        return Err(VocalRemoverError::ModelNotFound.to_string());
    }

    // ── 4. Choose backend based on plan ──────────────────────────
    // Ultimate → GPU (wgpu), Pro/Free → CPU (ndarray)
    let use_gpu = matches!(license.plan, Plan::Ultimate);

    // ── 5. Run inference ──────────────────────────────────────────
    let input_path = Path::new(&audio_path);
    let stem = input_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let parent = input_path
        .parent()
        .unwrap_or(Path::new("."));

    let result = run_demucs(
        &model_file,
        input_path,
        parent,
        &stem,
        &output_mode,
        use_gpu,
    )
    .map_err(|e| e.to_string())?;

    // ── 6. Increment usage counter ────────────────────────────────
    increment_usage(&settings_folder, USAGE_KEY_VOCAL)
        .map_err(|e| e.to_string())?;

    Ok(result)
}

// ─────────────────────────────────────────────
// INFERENCE — burn backend
// ─────────────────────────────────────────────

fn run_demucs(
    model_path: &Path,
    input_path: &Path,
    output_dir: &Path,
    stem_name: &str,
    output_mode: &OutputMode,
    use_gpu: bool,
) -> Result<serde_json::Value, VocalRemoverError> {
    // ── Load audio ────────────────────────────────────────────────
    let mut reader = hound::WavReader::open(input_path)
        .map_err(|e| VocalRemoverError::AudioReadError(e.to_string()))?;

    let spec = reader.spec();
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
        .collect::<Result<_, _>>()
        .map_err(|e| VocalRemoverError::AudioReadError(e.to_string()))?;

    // ── Run model ─────────────────────────────────────────────────
    // TODO: replace with real burn inference when model is ready.
    // The structure below shows how the backend selection works.
    //
    // if use_gpu {
    //     let device = WgpuDevice::default();
    //     let model = HtDemucs::<Wgpu>::load(model_path, &device)?;
    //     model.forward(tensor)
    // } else {
    //     let device = NdArrayDevice::Cpu;
    //     let model = HtDemucs::<NdArray>::load(model_path, &device)?;
    //     model.forward(tensor)
    // }
    //
    // For now, returns a placeholder until the burn model wrapper is built.

    let _ = use_gpu; // will be used when inference is implemented
    let _ = model_path;

    // Placeholder: copy input as output until inference is wired up
    let (vocals_samples, instrumental_samples) = split_placeholder(&samples);

    // ── Write output files ────────────────────────────────────────
    let out_spec = hound::WavSpec {
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut output_paths = serde_json::Map::new();

    match output_mode {
        OutputMode::VocalsOnly => {
            let path = output_dir.join(format!("{stem_name}_vocals.wav"));
            write_wav(&path, &vocals_samples, out_spec)?;
            output_paths.insert("vocals".into(), Value::String(path.to_string_lossy().into()));
        }
        OutputMode::InstrumentalOnly => {
            let path = output_dir.join(format!("{stem_name}_instrumental.wav"));
            write_wav(&path, &instrumental_samples, out_spec)?;
            output_paths.insert("instrumental".into(), Value::String(path.to_string_lossy().into()));
        }
        OutputMode::Both => {
            let v_path = output_dir.join(format!("{stem_name}_vocals.wav"));
            let i_path = output_dir.join(format!("{stem_name}_instrumental.wav"));
            write_wav(&v_path, &vocals_samples, out_spec)?;
            write_wav(&i_path, &instrumental_samples, out_spec.clone())?;
            output_paths.insert("vocals".into(), Value::String(v_path.to_string_lossy().into()));
            output_paths.insert("instrumental".into(), Value::String(i_path.to_string_lossy().into()));
        }
    }

    Ok(Value::Object(output_paths))
}

// ─────────────────────────────────────────────
// PLACEHOLDER SPLIT
// Replace with real burn inference output.
// ─────────────────────────────────────────────

fn split_placeholder(samples: &[f32]) -> (Vec<f32>, Vec<f32>) {
    // Mid-side separation — crude but works as a placeholder for centered vocals
    // Real separation will come from the burn htdemucs model
    let mut vocals = Vec::with_capacity(samples.len());
    let mut instrumental = Vec::with_capacity(samples.len());

    let chunks = samples.chunks(2);
    for chunk in chunks {
        if chunk.len() == 2 {
            let mid  = (chunk[0] + chunk[1]) * 0.5; // center = vocal
            let side = (chunk[0] - chunk[1]) * 0.5; // sides  = instrumental
            vocals.push(mid);
            vocals.push(mid);
            instrumental.push(side);
            instrumental.push(-side);
        }
    }

    (vocals, instrumental)
}

// ─────────────────────────────────────────────
// WAV WRITER HELPER
// ─────────────────────────────────────────────

fn write_wav(
    path: &Path,
    samples: &[f32],
    spec: hound::WavSpec,
) -> Result<(), VocalRemoverError> {
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| VocalRemoverError::AudioWriteError(e.to_string()))?;

    for &sample in samples {
        let s = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer
            .write_sample(s)
            .map_err(|e| VocalRemoverError::AudioWriteError(e.to_string()))?;
    }

    writer
        .finalize()
        .map_err(|e| VocalRemoverError::AudioWriteError(e.to_string()))?;

    Ok(())
}
