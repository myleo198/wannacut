/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

use std::fs;
use std::path::PathBuf;

use std::process::Command;
use tauri::command;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::thread;
use tiny_http::{Header, Response, Server};

use std::path::Path;

use std::process::Stdio;
use tauri_plugin_shell::ShellExt;

use std::io::Write;


use std::process::Child;
use tauri::State;

use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;

use serde_json::json;

//  Updated state to hold the Tauri Sidecar CommandChild
pub struct ExportState(pub Mutex<Option<CommandChild>>);
pub struct YtDlpState(pub Mutex<Option<std::process::Child>>);

pub struct YtDlpPid(pub AtomicU32); // 0 = nenhum processo ativo

use wgpu;


mod plans;
mod limits;
mod vocal_remover;







#[derive(serde::Serialize)]
struct Project {
    name: String,
    path: String,
    thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Dimensions {
    pub x: f64,
    pub y: f64,
}

#[derive(serde::Serialize)]
pub struct VideoMetadata {
    duration: f64,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Keyframe {
    pub id: String,
    pub time: f64,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Keyframes {
    pub volume: Option<Vec<Keyframe>>,
    pub opacity: Option<Vec<Keyframe>>,
    pub speed: Option<Vec<Keyframe>>,
    pub rotation3d: Option<Vec<Keyframe>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
    pub beginmoment: f64,
    #[serde(rename = "trackId")]
    pub track_id: String, // Mantive String para bater com seu código anterior, mas mudei o binding
    #[serde(rename = "type")]
    pub clip_type: String,
    #[serde(default)]
    pub mute: Option<bool>,
    pub fadein: Option<f64>,
    pub fadeout: Option<f64>,
    pub fadeinAudio: Option<f64>,
    pub fadeoutAudio: Option<f64>,

    // Opcional: para suportar a nova estrutura de keyframes
    pub keyframes: Option<Keyframes>,

    #[serde(rename = "activeKeyframeView")]
    pub active_keyframe_view: Option<String>,
}

use tauri::Emitter; // Adicione este import no topo

// 1. Você PRECISA desta struct definida para os erros E0425 sumirem
#[derive(Serialize, Deserialize, Clone)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub type_: Option<String>,
    pub description: String,
    pub image: Option<String>,
    pub link: Option<String>,
    pub link_text: Option<String>,
    pub repeat: bool,
}

#[derive(Deserialize)]
struct EffectsData {
    effects: Vec<Effect>,
}

#[derive(Deserialize)]
struct Effect {
    id: String,
    file: String,
    plan: String,
}

struct FontsData {
    effects: Vec<Effect>,
}

#[derive(Deserialize)]
struct Fonts {
    id: String,
    file: String,
    plan: String,
}


// ============================================================
// FREESOUND COMMANDS — adicionar ao main.rs
// ============================================================
// Dependência já existente: reqwest (com feature "json")
// Nenhuma crate nova necessária.
// ============================================================

// ─── Structs de resposta da API ──────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct FreesoundSound {
    pub id: u64,
    pub name: String,
    pub username: String,
    pub duration: f64,
    pub license: String,         // URL completa da licença
    pub previews: FreesoundPreviews,
    pub download: String,        // URL de download (requer auth)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct FreesoundPreviews {
    #[serde(rename = "preview-hq-mp3")]
    pub preview_hq_mp3: Option<String>,
    #[serde(rename = "preview-lq-mp3")]
    pub preview_lq_mp3: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct FreesoundSearchResponse {
    results: Vec<FreesoundSound>,
}

// ─── Busca de sons ───────────────────────────────────────────

/// Lê a chave da API do Freesound do arquivo wannacut_settings.json
/// localizado dentro da settingsFolder. Retorna None se não existir.
#[tauri::command]
async fn read_freesound_api_key(settings_folder: String) -> Result<Option<String>, String> {
    let settings_path = std::path::Path::new(&settings_folder).join("wannacut_settings.json");
    if !settings_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Erro ao ler wannacut_settings.json: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear wannacut_settings.json: {}", e))?;
    let key = json.get("freesound_api_key")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    Ok(key)
}

/// Salva a chave da API do Freesound no wannacut_settings.json
#[tauri::command]
async fn save_freesound_api_key(settings_folder: String, api_key: String) -> Result<(), String> {
    let settings_path = std::path::Path::new(&settings_folder).join("wannacut_settings.json");

    let mut json: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Erro ao ler wannacut_settings.json: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    json["freesound_api_key"] = serde_json::Value::String(api_key);

    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Erro ao serializar settings: {}", e))?;
    std::fs::write(&settings_path, serialized)
        .map_err(|e| format!("Erro ao salvar wannacut_settings.json: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn search_freesound(
    query: String,
    license_filter: String, // "cc0" | "ccby" | "ccnc" | "" (todos)
    api_key: String,        // chave por usuário, lida do wannacut_settings.json
) -> Result<Vec<FreesoundSound>, String> {
    // Monta o filtro de licença para a API do Freesound
    // Freesound license field values:
    //   "Creative Commons 0"           → CC0
    //   "Attribution"                  → CC BY
    //   "Attribution Noncommercial"    → CC BY-NC
    let license_query = match license_filter.to_lowercase().as_str() {
        "cc0"  => Some("license:\"Creative Commons 0\""),
        "ccby" => Some("license:\"Attribution\""),
        "ccnc" => Some("license:\"Attribution Noncommercial\""),
        _      => None,
    };

    let mut full_query = query.clone();
    if let Some(lq) = license_query {
        full_query = format!("{} {}", full_query, lq);
    }

    let client = reqwest::Client::new();
    let url = format!(
        "https://freesound.org/apiv2/search/text/?query={}&fields=id,name,username,duration,license,previews,download&token={}",
        urlencoding_simple(&full_query),
        api_key
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Freesound request error: {}", e))?;

    let data: FreesoundSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Freesound JSON parse error: {}", e))?;

    Ok(data.results)
}

// ─── Download de som ─────────────────────────────────────────
// Usa o preview HQ (MP3) para não exigir login OAuth.
// O preview é público e de qualidade adequada para edição.

#[tauri::command]
async fn download_freesound(
    sound_id: u64,
    sound_name: String,
    preview_url: String,   // URL do preview-hq-mp3
    project_path: String,  // currentProjectPath do App.tsx
) -> Result<String, String> {
    use std::fs;

    let client = reqwest::Client::new();

    let response = client
        .get(&preview_url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read bytes error: {}", e))?;

    // Sanitiza o nome do arquivo
    let safe_name = sound_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();

    // Garante extensão .mp3
    let file_name = if safe_name.ends_with(".mp3") {
        safe_name
    } else {
        format!("{}_{}.mp3", safe_name, sound_id)
    };

    // Destino: <project_path>/videos/<file_name>
    let dest_dir = format!("{}/videos", project_path);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Create dir error: {}", e))?;

    let dest_path = format!("{}/{}", dest_dir, file_name);
    fs::write(&dest_path, bytes).map_err(|e| format!("Write file error: {}", e))?;

    Ok(file_name) // retorna o nome do arquivo para o frontend recarregar assets
}

// ══════════════════════════════════════════════════════════════
// PEXELS IMAGE LIBRARY
// ══════════════════════════════════════════════════════════════

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PexelsPhotoSrc {
    original: String,
    large2x: String,
    large: String,
    medium: String,
    small: String,
    portrait: String,
    landscape: String,
    tiny: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PexelsPhoto {
    id: u64,
    width: u32,
    height: u32,
    url: String,
    photographer: String,
    photographer_url: String,
    alt: String,
    src: PexelsPhotoSrc,
}

#[derive(serde::Deserialize, Debug)]
struct PexelsSearchResponse {
    photos: Vec<PexelsPhoto>,
}

/// Lê a chave da API do Pexels do arquivo wannacut_settings.json
#[tauri::command]
async fn read_pexels_api_key(settings_folder: String) -> Result<Option<String>, String> {
    let settings_path = std::path::Path::new(&settings_folder).join("wannacut_settings.json");
    if !settings_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Erro ao ler wannacut_settings.json: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear wannacut_settings.json: {}", e))?;
    let key = json.get("pexels_api_key")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    Ok(key)
}

/// Salva a chave da API do Pexels no wannacut_settings.json (mesma estrutura do Freesound)
#[tauri::command]
async fn save_pexels_api_key(settings_folder: String, api_key: String) -> Result<(), String> {
    let settings_path = std::path::Path::new(&settings_folder).join("wannacut_settings.json");

    let mut json: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Erro ao ler wannacut_settings.json: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    json["pexels_api_key"] = serde_json::Value::String(api_key);

    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Erro ao serializar settings: {}", e))?;
    std::fs::write(&settings_path, serialized)
        .map_err(|e| format!("Erro ao salvar wannacut_settings.json: {}", e))?;

    Ok(())
}

// ── Pexels Video types ────────────────────────────────────────
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct PexelsVideoFile {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    file_type: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    link: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct PexelsVideoPicture {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    picture: String,
    #[serde(default)]
    nr: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct PexelsVideoUser {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    name: String,
    // A API pode retornar null neste campo
    #[serde(default)]
    url: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PexelsVideo {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    user: PexelsVideoUser,
    #[serde(default)]
    video_files: Vec<PexelsVideoFile>,
    #[serde(default)]
    video_pictures: Vec<PexelsVideoPicture>,
    // Campos extras que a API manda e precisamos aceitar
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    full_res: Option<serde_json::Value>,  // vem como null
    #[serde(default)]
    tags: Vec<serde_json::Value>,          // vem como []
}

#[derive(serde::Deserialize, Debug)]
struct PexelsVideoSearchResponse {
    #[serde(default)]
    videos: Vec<PexelsVideo>,
}

/// Busca imagens no Pexels
#[tauri::command]
async fn search_pexels(
    query: String,
    orientation: String, // "landscape" | "portrait" | "square" | "" (all)
    api_key: String,
) -> Result<Vec<PexelsPhoto>, String> {
    let client = reqwest::Client::new();

    let mut url = format!(
        "https://api.pexels.com/v1/search?query={}&per_page=20",
        urlencoding_simple(&query)
    );
    if !orientation.is_empty() && orientation != "all" {
        url = format!("{}&orientation={}", url, orientation);
    }

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .send()
        .await
        .map_err(|e| format!("Pexels request error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Pexels API error: HTTP {}", status));
    }

    let data: PexelsSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Pexels JSON parse error: {}", e))?;

    Ok(data.photos)
}

/// Busca vídeos no Pexels
#[tauri::command]
async fn search_pexels_videos(
    query: String,
    orientation: String, // "landscape" | "portrait" | "square" | ""
    api_key: String,
) -> Result<Vec<PexelsVideo>, String> {
    let client = reqwest::Client::new();

    let mut url = format!(
        "https://api.pexels.com/videos/search?query={}&per_page=20",
        urlencoding_simple(&query)
    );
    if !orientation.is_empty() && orientation != "all" {
        url = format!("{}&orientation={}", url, orientation);
    }

    let response = client
        .get(&url)
        .header("Authorization", &api_key)
        .send()
        .await
        .map_err(|e| format!("Pexels video request error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Pexels Video API error: HTTP {}", status));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Pexels video read body error: {}", e))?;

    let data: PexelsVideoSearchResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Pexels video JSON parse error: {} — body preview: {}", e, &body[..body.len().min(300)]))?;

    Ok(data.videos)
}

/// Faz download de uma imagem Pexels para a pasta do projeto
#[tauri::command]
async fn download_pexels(
    photo_id: u64,
    photo_url: String,
    alt: String,
    project_path: String,
) -> Result<String, String> {
    use std::fs;

    let client = reqwest::Client::new();
    let response = client
        .get(&photo_url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read bytes error: {}", e))?;

    let safe_name: String = if alt.trim().is_empty() {
        format!("pexels_{}", photo_id)
    } else {
        alt.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect()
    };

    let file_name = format!("{}_{}.jpg", safe_name, photo_id);
    let dest_dir = format!("{}/videos", project_path);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Create dir error: {}", e))?;
    let dest_path = format!("{}/{}", dest_dir, file_name);
    fs::write(&dest_path, bytes).map_err(|e| format!("Write file error: {}", e))?;

    Ok(file_name)
}

/// Faz download de um vídeo Pexels para a pasta do projeto
#[tauri::command]
async fn download_pexels_video(
    video_id: u64,
    video_url: String,  // link do video_file HD ou SD
    author: String,
    project_path: String,
) -> Result<String, String> {
    use std::fs;

    let client = reqwest::Client::new();
    let response = client
        .get(&video_url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read bytes error: {}", e))?;

    let safe_name: String = if author.trim().is_empty() {
        format!("pexels_video_{}", video_id)
    } else {
        author.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect()
    };

    let file_name = format!("{}_{}.mp4", safe_name, video_id);
    let dest_dir = format!("{}/videos", project_path);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Create dir error: {}", e))?;
    let dest_path = format!("{}/{}", dest_dir, file_name);
    fs::write(&dest_path, bytes).map_err(|e| format!("Write file error: {}", e))?;

    Ok(file_name)
}

// ─── Helper interno ──────────────────────────────────────────

fn urlencoding_simple(s: &str) -> String {
    let mut encoded = String::new();
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => encoded.push(c),
            ' ' => encoded.push('+'),
            c => {
                for byte in c.to_string().as_bytes() {
                    encoded.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    encoded
}

#[tauri::command]
async fn check_notifications(settings_path: String) -> Result<Vec<Notification>, String> {
    let path = std::path::Path::new(&settings_path).join("seen_notifications.json");

    // 2. Usando o reqwest que você acabou de adicionar
    let url = "https://wannacut.app/notifications.json";
    let client = reqwest::Client::new();

    // Especificamos que o erro vindo do reqwest é um reqwest::Error para o compilador não se perder
    let response = client
        .get(url)
        .header("User-Agent", "WannaCut-App")
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let remote_msgs: Vec<Notification> =
        serde_json::from_value(data["messages"].clone()).unwrap_or_default();

    // 3. Lógica de leitura do arquivo local
    let seen_ids: Vec<String> = if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    let mut to_show = Vec::new();
    let mut updated_seen_ids = seen_ids.clone();

    for msg in remote_msgs {
        let already_seen = seen_ids.contains(&msg.id);
        if !already_seen || msg.repeat {
            to_show.push(msg.clone());
            if !already_seen {
                updated_seen_ids.push(msg.id.clone());
            }
        }
    }

    // Salva os novos IDs vistos
    std::fs::write(path, serde_json::to_string(&updated_seen_ids).unwrap()).ok();

    Ok(to_show)
}

#[derive(Serialize)]
struct ExportPayload {
    export_path: String,
    total_duration: f64,
    project_dimentions: Dimensions,
    clips: Vec<Clip>,
}

use tauri::Runtime; // Certifique-se de usar Emitter no Tauri v2

#[derive(Serialize, Deserialize, Debug)]
pub struct ProjectSettings {
    name: String,
    width: u32,
    height: u32,
    fps: f32,
    #[serde(rename = "backgroundColor")] // Mapeia o camelCase do TS para o snake_case do Rust
    background_color: String,
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
}

#[tauri::command]
async fn get_asset_dimensions(path: String) -> Result<Dimensions, String> {
    let path_obj = Path::new(&path);

    let extension = path_obj
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or("Arquivo sem extensão válida")?;

    // --- LÓGICA PARA IMAGENS ---
    if ["jpg", "jpeg", "png", "webp", "bmp"].contains(&extension.as_str()) {
        let img =
            image::image_dimensions(&path).map_err(|e| format!("Erro ao ler imagem: {}", e))?;
        return Ok(Dimensions {
            x: img.0 as f64,
            y: img.1 as f64,
        });
    }

    // --- LÓGICA PARA VÍDEOS (Via OpenCV) ---
    // OpenCV abre o arquivo e lê o cabeçalho via FFmpeg interno do sistema
    // --- LÓGICA PARA VÍDEOS (Via FFmpeg) ---
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            &path,
        ])
        .output()
        .map_err(|e| format!("Erro ao executar ffprobe: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();

    if parts.len() < 2 {
        return Err("Não foi possível determinar as dimensões do vídeo".to_string());
    }

    let width: f64 = parts[0]
        .parse()
        .map_err(|e| format!("Erro ao parsear width: {}", e))?;
    let height: f64 = parts[1]
        .parse()
        .map_err(|e| format!("Erro ao parsear height: {}", e))?;

    if width == 0.0 || height == 0.0 {
        return Err("Não foi possível determinar as dimensões do vídeo".to_string());
    }

    Ok(Dimensions {
        x: width,
        y: height,
    })
}

#[tauri::command]
async fn create_project_setup(
    root_path: String,
    project_name: String,
    config: ProjectSettings,
) -> Result<String, String> {
    let mut project_path = PathBuf::from(&root_path);
    project_path.push(&project_name);

    if project_path.exists() {
        return Err("A project with this name already exists in this folder.".into());
    }

    fs::create_dir_all(&project_path).map_err(|e| format!("Failed to create directory: {}", e))?;

    let mut config_file = project_path.clone();
    config_file.push("projectConfig.json");

    let json_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_file, json_content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    println!("🚀 New project initialized at: {:?}", project_path);

    std::fs::create_dir_all(&project_path).map_err(|e| e.to_string())?;
    std::fs::create_dir(project_path.join("videos")).map_err(|e| e.to_string())?;
    std::fs::create_dir(project_path.join("exports")).map_err(|e| e.to_string())?;

    Ok(project_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn save_project_config(path: String, config: ProjectSettings) -> Result<String, String> {
    let current_dir = PathBuf::from(&path);
    let parent_dir = current_dir
        .parent()
        .ok_or("Não foi possível encontrar a pasta pai")?;

    let new_dir = parent_dir.join(&config.name);

    let mut config_file_path = current_dir.clone();
    config_file_path.push("projectConfig.json");

    let json_content =
        serde_json::to_string_pretty(&config).map_err(|e| format!("Erro ao gerar JSON: {}", e))?;

    fs::write(&config_file_path, json_content)
        .map_err(|e| format!("Erro ao gravar projectConfig.json: {}", e))?;

    if current_dir != new_dir {
        if new_dir.exists() {
            return Err("Already exist a project with this name!".into());
        }

        fs::rename(&current_dir, &new_dir).map_err(|e| format!("Err to rename project: {}", e))?;
    }

    // Retornamos o NOVO caminho da pasta para o Frontend atualizar o estado
    Ok(new_dir.to_string_lossy().into_owned())
}
#[tauri::command]
async fn load_project_config(path: String) -> Result<ProjectSettings, String> {
    println!("🔍 Tentando ler projeto em: {}", path);

    let mut config_path = PathBuf::from(&path);
    config_path.push("projectConfig.json");

    // 1. Verificar se o caminho existe fisicamente
    if !config_path.exists() {
        let err_msg = format!("Arquivo não encontrado: {:?}", config_path);
        println!("❌ {}", err_msg);
        return Err(err_msg);
    }

    // 2. Tentar ler o arquivo
    let content = fs::read_to_string(&config_path).map_err(|e| {
        let err = format!("Erro de leitura no disco: {}", e);
        println!("❌ {}", err);
        err
    })?;

    // 3. Tentar parsear o JSON
    let settings: ProjectSettings = serde_json::from_str(&content).map_err(|e| {
        let err = format!("JSON Inválido ou campos faltando: {}", e);
        println!("❌ {}", err);
        err
    })?;

    println!("✅ Projeto '{}' carregado com sucesso!", settings.name);
    Ok(settings)
}

#[tauri::command]
async fn export_video(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ExportState>,
    project_path: String,
    export_path: String,
    wannacut_settings: String,
    project_dimensions: serde_json::Value,
    clips: serde_json::Value,
) -> Result<(), String> {
    // 1. Criar o objeto de configuração

    let config_data = serde_json::json!({
        "project_path": project_path,
        "wannacut_settings": wannacut_settings,
        "export_path": export_path,
        "project_dimensions": project_dimensions,
        "clips": clips
    });

    // 2. Definir o caminho do JSON dentro da pasta do projeto
    let project_dir = std::path::PathBuf::from(&project_path);

    // Garante que a pasta do projeto existe
    if !project_dir.exists() {
        return Err(format!("A pasta do projeto não existe: {}", project_path));
    }

    let config_path = project_dir.join("export_config.json");

    // 3. Salvar/Sobrescrever o JSON
    let json_string = serde_json::to_string_pretty(&config_data)
        .map_err(|e| format!("Erro ao serializar JSON: {}", e))?;

    std::fs::write(&config_path, json_string)
        .map_err(|e| format!("Erro ao gravar export_config.json no projeto: {}", e))?;

    let config_path_str = config_path.to_string_lossy().to_string();

    // 4. Iniciar o Sidecar Python
    let (mut rx, child) = app_handle
        .shell()
        .sidecar("exporter")
        .map_err(|e| format!("Sidecar não encontrado: {}", e))?
        .env("PYTHONUNBUFFERED", "1")
        .arg(&config_path_str) // Passamos o caminho completo do JSON dentro do projeto
        .spawn()
        .map_err(|e| format!("Falha ao iniciar processo Python: {}", e))?;

    // Guardar processo para cancelamento
    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    // 5. Monitorização do progresso (Stderr)
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stderr(line_bytes) => {
                    let raw = String::from_utf8_lossy(&line_bytes);
                    for line in raw.lines() {
                        let line = line.trim();

                        if line.contains("PERCENT:") {
                            if let Some(val_str) = line.split("PERCENT:").last() {
                                if let Ok(percent) = val_str.parse::<u32>() {
                                    // Log para você acompanhar no terminal
                                    println!("Progresso Real: {}%", percent);
                                    let _ = app_handle.emit("export-progress", percent);
                                }
                            }
                        }
                        // println!("[Python Log]: {}", line); // Opcional
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    println!("Renderização concluída com código: {:?}", status.code);
                    // Opcional: manter o json no projeto para histórico ou apagar
                    // let _ = std::fs::remove_file(config_path);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn cancel_export(state: State<'_, ExportState>) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(child) = lock.take() {
        //  Kill the Tauri Sidecar process
        child
            .kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
    }
    Ok(())
}

fn build_complex_filter(clips: &[Clip]) -> String {
    let mut filters = Vec::new();
    let mut inputs = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        // Trim the source file and reset timestamps to the timeline start
        // [vX] represents the video stream of the current clip
        let filter = format!(
            "[{}:v]trim=start={}:duration={},setpts=PTS-STARTPTS+{}/TB[v{}]",
            i, clip.beginmoment, clip.duration, clip.start, i
        );
        filters.push(filter);
        inputs.push(format!("[v{}]", i));
    }

    // Merge all video streams into one using overlay or concat
    // For simple linear editing, we use concat. For tracks, we would use overlay.
    let concat = format!("{}concat=n={}:v=1:a=0[outv]", inputs.join(""), clips.len());
    filters.push(concat);

    filters.join(";")
}

#[tauri::command]
fn list_project_files(project_path: String) -> Result<Vec<String>, String> {
    let paths = fs::read_dir(project_path).map_err(|e| e.to_string())?;
    let mut files: Vec<String> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".project"))
        .collect();
    files.sort(); // Sort by name (timestamp-based sorting)
    Ok(files)
}

#[tauri::command]
fn read_specific_file(project_path: String, file_name: String) -> Result<String, String> {
    let mut path = PathBuf::from(project_path);
    path.push(file_name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project_data(project_path: String, data: String, timestamp: u64) -> Result<(), String> {
    let mut path = PathBuf::from(&project_path);
    let filename = format!("main{}.project", timestamp);
    path.push(filename);

    // 1. Write the new file
    fs::write(&path, data).map_err(|e| e.to_string())?;

    // 2. Clean up old files (Keep only the 50,000 newest)
    let paths = fs::read_dir(&project_path).map_err(|e| e.to_string())?;
    let mut project_files: Vec<_> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("project"))
        .collect();

    // Sort by name (which includes timestamp)
    project_files.sort();

    // If we exceed the limit, delete the oldest ones
    let limit = 50000;
    if project_files.len() > limit {
        let to_delete = project_files.len() - limit;
        for i in 0..to_delete {
            let _ = fs::remove_file(&project_files[i]);
        }
    }

    Ok(())
}

#[tauri::command]
fn list_fonts_new(path: String) -> Vec<String> {
    let mut fonts = Vec::new();
    if let Ok(entries) = fs::read_dir(format!("{}/fonts", path)) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Some(name) = entry.file_name().to_str() {
                fonts.push(name.to_string());
            }
        }
    }
    fonts
}

// No main.rs

#[tauri::command]
async fn fetch_cloud_fonts() -> Result<serde_json::Value, String> {
    let url = "https://wannacut.app/fonts.json";
    let client = reqwest::Client::new();

    let response = client
        .get(url)
        .header("User-Agent", "WannaCut-App")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(json)
}

// Hierarquia de planos: free < pro < ultimate
fn plan_level(plan: &str) -> u8 {
    match plan {
        "free"     => 0,
        "pro"      => 1,
        "ultimate" => 2,
        _          => 0,
    }
}

#[tauri::command]
async fn download_font_file(
    id: String,      // ID da fonte (ex: "2")
    path: String,         // caminho local onde salvar
    settings_folder: String, // para ler o plano do usuário offline
) -> Result<(), String> {

    // 1. Busca fonts.json diretamente do servidor (fonte confiável)
    let client = reqwest::Client::new();
    let fonts_json: serde_json::Value = client
        .get("https://wannacut.app/fonts.json")
        .header("User-Agent", "WannaCut-App")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar fonts.json: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear fonts.json: {e}"))?;



    // 2. Localiza a fonte pelo ID
    let font = fonts_json["fonts"]
        .as_array()
        .and_then(|arr| arr.iter().find(|f| f["id"].as_str() == Some(&id)))
        .ok_or_else(|| format!("Fonte com id '{id}' não encontrada"))?;

    let font_file = font["file"]
        .as_str()
        .ok_or("Campo 'file' ausente na fonte")?;

    let required_plan = font["plan"]
        .as_str()
        .unwrap_or("free");

    // 3. Verifica o plano do usuário localmente (sem confiar no frontend)
    let license = crate::plans::validate_offline(&settings_folder)
        .map_err(|e| format!("Erro ao ler licença: {e}"))?;

    
    let user_plan_string = license.plan.label().to_lowercase();
    let user_plan = user_plan_string.as_str();

    // 4. Compara os níveis de plano
    if plan_level(user_plan) < plan_level(required_plan) {
        return Err(format!(
            "Access denied: this font requires a '{required_plan}' plan, but your current plan is '{user_plan}'."
        ));
    }

    // 5. Monta a URL real a partir do nome do arquivo (nunca do frontend)
    let download_url = format!(
        "https://wannacut.app/fonts/{font_file}"
    );

    // 6. Baixa e salva
    let content = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro no download: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes: {e}"))?;

    std::fs::write(&path, content)
        .map_err(|e| format!("Erro ao salvar arquivo: {e}"))?;

    Ok(())
}


#[tauri::command]
fn list_fonts(fonts_path: String) -> Result<Vec<String>, String> {
    let mut fonts = Vec::new();
    let path = Path::new(&fonts_path);

    if !path.exists() {
        return Ok(fonts);
    }

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if let Some(ext) = p.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str == "ttf" || ext_str == "otf" {
                fonts.push(p.to_string_lossy().into_owned());
            }
        }
    }
    Ok(fonts)
}

// Function to load the last saved state of the project
#[tauri::command]
fn load_latest_project(project_path: String) -> Result<String, String> {
    let paths = fs::read_dir(project_path).map_err(|e| e.to_string())?;

    // Filter files ending with .project and find the one with the highest timestamp in name
    let mut project_files: Vec<_> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("project"))
        .collect();

    project_files.sort(); // Sorts alphabetically/numerically

    if let Some(latest) = project_files.last() {
        fs::read_to_string(latest).map_err(|e| e.to_string())
    } else {
        Err("No project file found".into())
    }
}

#[tauri::command]
fn load_specific_project(project_path: String, file_name: String) -> Result<String, String> {
    // 1. Construct the full path: project_path/file_name
    let mut path = PathBuf::from(&project_path);
    path.push(&file_name);

    // 2. Validate that the file exists and is indeed a file
    if !path.exists() {
        return Err(format!("File not found: {}", file_name));
    }

    // 3. Read content and return as String (JSON)
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// Função para baixar o binário inicial se ele não existir
async fn download_initial_binary(bin_path: &Path) -> Result<(), String> {
    println!("Binary not found. Starting download of official yt-dlp...");

    let url = if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to connect to GitHub: {}", e))?;

    let content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to download binary: {}", e))?;

    let mut file =
        File::create(bin_path).map_err(|e| format!("Failed to create binary file: {}", e))?;

    file.write_all(&content)
        .map_err(|e| format!("Failed to write binary to disk: {}", e))?;

    // No Linux/Mac, we need to grant execution permissions to the downloaded file
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(bin_path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(bin_path, perms).ok();
    }

    println!("yt-dlp download completed successfully.");
    Ok(())
}

// Função para atualizar o yt-dlp existente
async fn update_ytdlp(bin_path: &Path) -> Result<(), String> {
    println!("Iniciando Lazy Update do yt-dlp...");
    let output = Command::new(bin_path)
        .arg("-U")
        .output()
        .map_err(|e| format!("Falha ao executar comando de update: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erro interno no update: {}", err))
    }
}

#[tauri::command]
async fn download_video(
    app_handle: tauri::AppHandle,
    project_path: String,
    settings_folder: String,
    url: String,
    download_mode: String, // "video_best" | "video_1080" | "video_720" | "video_480" | "audio_mp3" | "audio_wav"
    yt_pid: State<'_, YtDlpPid>,
) -> Result<String, String> {
    let is_audio_only = download_mode.starts_with("audio_");

    
    let subfolder = "videos";
    let mut download_path = PathBuf::from(&project_path);
    download_path.push(subfolder);

    let bin_dir = PathBuf::from(&settings_folder).join("bin");
    let bin_name = if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" };
    let bin_path = bin_dir.join(bin_name);

    if !download_path.exists() {
        fs::create_dir_all(&download_path).map_err(|e| e.to_string())?;
    }
    if !bin_dir.exists() {
        fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    }
    if !bin_path.exists() {
        download_initial_binary(&bin_path).await?;
    }

    // Monta os argumentos de formato conforme o modo escolhido
    let format_args: Vec<&str> = match download_mode.as_str() {
        "video_1080" => vec![
            "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
            "--merge-output-format", "mp4",
        ],
        "video_720" => vec![
            "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
            "--merge-output-format", "mp4",
        ],
        "video_480" => vec![
            "-f", "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]",
            "--merge-output-format", "mp4",
        ],
        "audio_mp3" => vec![
            "-f", "bestaudio",
            "-x", "--audio-format", "mp3",
            "--audio-quality", "192K",
        ],
        "audio_wav" => vec![
            "-f", "bestaudio",
            "-x", "--audio-format", "wav",
        ],
        // "video_best" ou qualquer valor desconhecido
        _ => vec![
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
        ],
    };

    let run_download_with_progress = |path_to_bin: &Path, app: &tauri::AppHandle| -> Result<std::process::Output, String> {
        use std::io::BufRead;

        let mut args: Vec<String> = vec![
            "--no-check-certificate".into(),
            "--prefer-free-formats".into(),
            "--add-header".into(),
            "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".into(),
        ];
        for a in &format_args {
            args.push(a.to_string());
        }
        args.push("--newline".into());
        args.push("--progress".into());
        args.push("-o".into());
        args.push(format!("{}/%(title)s.%(ext)s", download_path.to_string_lossy()));
        args.push(url.clone());

        let mut child = Command::new(path_to_bin)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Erro ao iniciar yt-dlp: {}", e))?;

        // Guarda o PID para cancelamento
        yt_pid.0.store(child.id(), Ordering::SeqCst);

        if let Some(stdout) = child.stdout.take() {
            let app_clone = app.clone();
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.contains("[download]") && line.contains('%') {
                        if let Some(pct_str) = line.split('%').next() {
                            let trimmed = pct_str.split_whitespace().last().unwrap_or("0");
                            if let Ok(pct) = trimmed.parse::<f64>() {
                                let pct_u32 = pct.clamp(0.0, 100.0) as u32;
                                let _ = app_clone.emit("yt-download-progress", pct_u32);
                            }
                        }
                    }
                }
            }
        }

        let output = child.wait_with_output()
        .map_err(|e| format!("Erro ao aguardar yt-dlp: {}", e))?;

        // Checa se foi cancelado ANTES de limpar o PID
        let was_cancelled = yt_pid.0.load(Ordering::SeqCst) == 0;

        // Limpa o PID ao terminar
        yt_pid.0.store(0, Ordering::SeqCst);

        if was_cancelled {
            return Err("__CANCELLED__".into());
        }

        if output.status.success() {
            let _ = app.emit("yt-download-progress", 100u32);
        }

        Ok(output)
    };

    let output = run_download_with_progress(&bin_path, &app_handle)?;
    if output.status.success() {
        return Ok("Download completed successfully".into());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("update") || stderr.contains("403") || stderr.contains("Sign in") {
        update_ytdlp(&bin_path).await?;
        let output_retry = run_download_with_progress(&bin_path, &app_handle)?;
        if output_retry.status.success() {
            return Ok("Download successful after core update".into());
        } else {
            let err_retry = String::from_utf8_lossy(&output_retry.stderr);
            return Err(format!("Falha persistente após update: {}", err_retry));
        }
    }

    Err(format!("yt-dlp error: {}", stderr))
}


#[tauri::command]
async fn cancel_video_download(yt_pid: State<'_, YtDlpPid>) -> Result<(), String> {
    let pid = yt_pid.0.load(std::sync::atomic::Ordering::SeqCst);
    if pid == 0 {
        return Ok(()); // Nenhum download ativo
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }

    yt_pid.0.store(0, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}


#[tauri::command]
async fn generate_thumbnail(
    project_path: String,
    file_name: String,
    time_seconds: f64,
) -> Result<String, String> {
    let thumbnail_folder = std::path::Path::new(&project_path).join("thumbnails");

    // Create folder if does not exist
    if !thumbnail_folder.exists() {
        std::fs::create_dir_all(&thumbnail_folder).map_err(|e| e.to_string())?;
    }

    // Paths based on project structure
    let video_path = PathBuf::from(&project_path).join("videos").join(&file_name);
    let output_name = format!("{}-{}.png", file_name, time_seconds);
    let output_path = PathBuf::from(&project_path)
        .join("thumbnails")
        .join(&output_name);

    // If the thumbnail already exists, skip generation to save resources
    if output_path.exists() {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    // Execute FFmpeg from system PATH
    // -ss: fast seek to timestamp / -i: input / -frames:v 1: capture one frame / -q:v 2: quality level
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-ss",
            &time_seconds.to_string(), // Seek to specific time
            "-i",
            &video_path.to_string_lossy(), // Input source
            "-frames:v",
            "1", // Grab exactly 1 frame
            "-update",
            "1",  // ESSENTIAL: Specifies a single image output rather than a sequence
            "-y", // Overwrite if exists (prevents hanging on prompts)
            &output_path.to_string_lossy(), // Output path
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if output.status.success() {
        Ok(output_path.to_string_lossy().into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

use serde_json::Value;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
async fn get_video_frame(path: String, time_ms: f64) -> Result<String, String> {
    let time_secs = time_ms / 1000.0;

    // FFmpeg extrai o frame como JPEG para stdout
    let output = Command::new("ffmpeg")
        .args([
            "-ss",
            &format!("{:.3}", time_secs),
            "-i",
            &path,
            "-frames:v",
            "1",
            "-f",
            "image2",
            "-vcodec",
            "mjpeg",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("Erro ao executar ffmpeg: {}", e))?;

    if output.stdout.is_empty() {
        return Err("Unable to read the video frame".into());
    }

    let b64 = general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}


/// into the final audio file requested by the user (mp3 or wav).
///
/// JS invoke (renderBridge.tsx):
///   invoke("assemble_exported_audio", { projectPath, targetPath, codec, duration })
///
/// `save_export_audio` writes the mix to:
///   <project_path>/export_audio_mix.wav
#[command]
async fn assemble_exported_audio(
    project_path: String,
    target_path: String,
    codec: String,
    duration: f64,
) -> Result<(), String> {
    let project_dir = PathBuf::from(&project_path);
    let source_wav  = project_dir.join("export_audio_mix.wav");
    let target      = PathBuf::from(&target_path);

    // ── Validate source ────────────────────────────────────────────────────
    if !source_wav.exists() {
        return Err(format!(
            "[assemble_exported_audio] Source WAV not found: {}\n\
             Make sure renderAudioOffline ran before this command.",
            source_wav.display()
        ));
    }

    // Ensure the destination directory exists
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("[assemble_exported_audio] Could not create output dir: {e}"))?;
    }

    println!(
        "[assemble_exported_audio] codec={codec} | duration={duration:.2}s\n  \
         src  = {}\n  dest = {}",
        source_wav.display(),
        target.display()
    );

    match codec.to_lowercase().as_str() {
        // ── WAV → WAV: simple file copy, no FFmpeg needed ─────────────────
        "wav" => {
            std::fs::copy(&source_wav, &target)
                .map_err(|e| format!("[assemble_exported_audio] Failed to copy WAV: {e}"))?;
            println!("[assemble_exported_audio] WAV copy done.");
        }

        // ── WAV → MP3: encode with FFmpeg (libmp3lame) ────────────────────
        "mp3" => {
            if target.exists() {
                let _ = std::fs::remove_file(&target);
            }

            let status = Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i", source_wav.to_str().unwrap(),
                    "-vn",
                    "-acodec", "libmp3lame",
                    "-q:a", "2",        // VBR ~190 kbps
                    "-ar", "44100",
                    "-ac", "2",
                    target.to_str().unwrap(),
                ])
                .status()
                .map_err(|e| format!("[assemble_exported_audio] FFmpeg spawn failed: {e}"))?;

            if !status.success() {
                return Err(format!(
                    "[assemble_exported_audio] FFmpeg exited with status: {status}"
                ));
            }

            println!("[assemble_exported_audio] MP3 encode done.");
        }

        other => {
            return Err(format!(
                "[assemble_exported_audio] Unknown codec: '{other}'. Expected 'mp3' or 'wav'."
            ));
        }
    }

    // ── Cleanup intermediate WAV ───────────────────────────────────────────
    let _ = std::fs::remove_file(&source_wav);

    Ok(())
}
/// Retorna um frame de preview em resolução reduzida (thumbnail rápida).
/// Útil para scrubbing na timeline sem sobrecarregar o processo.
/// `width` define a largura máxima do preview (altura é proporcional).
#[tauri::command]
async fn get_preview_frame(
    path: String,
    time_ms: f64,
    width: Option<u32>,
) -> Result<String, String> {
    let time_secs = time_ms / 1000.0;
    let preview_width = width.unwrap_or(320);

    let output = Command::new("ffmpeg")
        .args([
            "-ss",
            &format!("{:.3}", time_secs),
            "-i",
            &path,
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={}:-1", preview_width),
            "-f",
            "image2",
            "-vcodec",
            "mjpeg",
            "-q:v",
            "5",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("Erro ao executar ffmpeg: {}", e))?;

    if output.stdout.is_empty() {
        return Err("Unable to read the preview frame".into());
    }

    let b64 = general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
async fn import_asset(project_path: String, file_path: String) -> Result<String, String> {
    let source = PathBuf::from(&file_path);
    let filename = source.file_name().ok_or("Invalid file name")?;

    let mut target = PathBuf::from(&project_path);
    target.push("videos");
    target.push(filename);

    fs::copy(&source, &target).map_err(|e| e.to_string())?;

    Ok(filename.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_assets(project_path: String) -> Result<Vec<String>, String> {
    let mut videos_path = PathBuf::from(project_path);
    videos_path.push("videos");

    let mut assets = Vec::new();
    if let Ok(entries) = fs::read_dir(videos_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                assets.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    Ok(assets)
}

use std::time::SystemTime;

// Certifique-se de que sua Struct Project tenha um campo para ordenação (não precisa ir para o frontend se não quiser)
// Mas para o Rust ordenar, precisamos rastrear essa data temporariamente.
struct ProjectWithTime {
    project: Project,
    modified_time: SystemTime,
}

#[tauri::command]
fn list_projects(root_path: String) -> Result<Vec<Project>, String> {
    let mut projects_with_time = Vec::new();
    let paths = fs::read_dir(root_path).map_err(|e| e.to_string())?;

    for path in paths.flatten() {
        let project_path = path.path();

        if project_path.is_dir() {
            // Data padrão: a data de modificação da própria pasta do projeto
            let mut project_latest_time = path
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            let mut latest_thumbnail = None;
            let thumb_dir = project_path.join("thumbnails");

            // Tenta ler a pasta de thumbnails
            if let Ok(thumb_entries) = fs::read_dir(thumb_dir) {
                let mut latest_thumb_time = SystemTime::UNIX_EPOCH;

                for thumb_entry in thumb_entries.flatten() {
                    let p = thumb_entry.path();

                    if p.is_file() {
                        if let Ok(metadata) = thumb_entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                // Atualiza a maior data encontrada na thumbnail
                                if modified > latest_thumb_time {
                                    latest_thumb_time = modified;
                                    latest_thumbnail = Some(p.to_string_lossy().into_owned());
                                }
                                // Se este arquivo for o mais recente do projeto inteiro, atualiza o marco do projeto
                                if modified > project_latest_time {
                                    project_latest_time = modified;
                                }
                            }
                        }
                    }
                }
            }

            // Adiciona na nossa lista temporária com o timestamp
            projects_with_time.push(ProjectWithTime {
                project: Project {
                    name: path.file_name().to_string_lossy().into_owned(),
                    path: project_path.to_string_lossy().into_owned(),
                    thumbnail: latest_thumbnail,
                },
                modified_time: project_latest_time,
            });
        }
    }

    // --- O PULO DO GATO: Ordenação ---
    // Ordena do mais RECENTE para o mais VELHO (b.modified_time.cmp(&a.modified_time))
    projects_with_time.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));

    // Extrai apenas os objetos `Project` de dentro da struct temporária para retornar ao frontend
    let sorted_projects = projects_with_time.into_iter().map(|p| p.project).collect();

    Ok(sorted_projects)
}

#[tauri::command]
fn delete_project(path: String) -> Result<(), String> {
    let project_path = std::path::PathBuf::from(path);
    if project_path.exists() && project_path.is_dir() {
        std::fs::remove_dir_all(project_path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Project folder not found".into())
    }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    // We use PathBuf for consistency with other functions like 'import_asset'
    let path_buf = std::path::PathBuf::from(&path);

    // 1. Safety checks
    if !path_buf.exists() {
        return Err("File path not found".to_string());
    }

    if !path_buf.is_file() {
        return Err("The provided path is not a file".to_string());
    }

    // 2. Execute deletion
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}

#[command]
async fn get_duration(path: String) -> Result<VideoMetadata, String> {
    // Command: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 path
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            &path,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let duration = duration_str
        .parse::<f64>()
        .map_err(|_| "Failed to parse duration")?;

    Ok(VideoMetadata { duration })
}

use base64::{engine::general_purpose, Engine as _};

#[tauri::command]
async fn get_image_data(path: String) -> Result<String, String> {
    use std::fs;

    // Lê os bytes brutos da imagem
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;

    // Converte para Base64 (estou assumindo que você usa a crate base64)
    use base64::{engine::general_purpose, Engine as _};
    let b64 = general_purpose::STANDARD.encode(bytes);

    // Detecta a extensão para o MIME type correto
    let mime = if path.to_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };

    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Lê um arquivo de áudio e devolve como data URL em base64.
///
/// Usado no lugar de convertFileSrc()/asset:// para o preview de áudio em
/// AudioRef2: alguns nomes de arquivo com caracteres Unicode (ex: "：" fullwidth
/// colon, "–" en-dash) fazem o protocolo asset:// do Tauri falhar silenciosamente
/// no <audio> com MEDIA_ERR_SRC_NOT_SUPPORTED, mesmo com o arquivo existindo e o
/// path/scope corretos. Como aqui o nome do arquivo nunca entra numa URL — ele
/// viaja como argumento de invoke() —, o problema não ocorre.
#[tauri::command]
async fn get_audio_data(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(bytes);

    let lower = path.to_lowercase();
    let mime = if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else {
        "audio/mpeg"
    };

    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn move_file(source: String, destination: String) -> Result<String, String> {
    let src_path = Path::new(&source);
    let dest_path = Path::new(&destination);

    // 1. Check if source file exists
    if !src_path.exists() {
        return Err("Source file does not exist".to_string());
    }

    // 2. Perform the copy and delete operation (move)
    // fs::rename is the standard way to move files
    match fs::rename(src_path, dest_path) {
        Ok(_) => Ok("File transferred successfully".to_string()),
        Err(e) => Err(format!("Failed to transfer file: {}", e)),
    }
}

#[tauri::command]
async fn extract_audio(project_path: String, file_name: String) -> Result<String, String> {
    let video_path = Path::new(&project_path).join("videos").join(&file_name);
    let output_folder = Path::new(&project_path).join("extracted_audios");

    // Create directory if it doesn't exist
    if !output_folder.exists() {
        fs::create_dir_all(&output_folder).map_err(|e| e.to_string())?;
    }

    // Output filename will be the same as input, but with .mp3 extension (for compatibility)
    let audio_file_name = format!(
        "{}.mp3",
        Path::new(&file_name).file_stem().unwrap().to_str().unwrap()
    );
    let output_path = output_folder.join(&audio_file_name);

    // If audio is already extracted, skip to improve performance
    if output_path.exists() {
        return Ok(audio_file_name);
    }

    // FFmpeg Command: -i (input), -vn (no video), -acodec libmp3lame (audio codec)
    let status = Command::new("ffmpeg")
        .arg("-i")
        .arg(&video_path)
        .arg("-vn")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-q:a")
        .arg("2") // High quality setting
        .arg(&output_path)
        .output()
        .map_err(|e| e.to_string())?;

    if status.status.success() {
        Ok(audio_file_name)
    } else {
        let error = String::from_utf8_lossy(&status.stderr);
        Err(format!("Error extracting audio: {}", error))
    }
}

#[tauri::command]
async fn get_waveform_data(path: String, samples: usize) -> Result<Vec<f32>, String> {
    // Use ffmpeg to read audio and output raw data (f32)
    let output = Command::new("ffmpeg")
        .args([
            "-i", &path, "-ar",
            "8000", // Reduce sample rate to 8kHz (sufficient for waveform visualization)
            "-ac", "1", // Convert to Mono
            "-f", "f32le", // Format as Float 32-bit Little Endian
            "-",     // Direct output to stdout
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let bytes = output.stdout;
    let f32_data: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect();

    if f32_data.is_empty() {
        return Ok(vec![]);
    }

    // Downsample the array to the desired number of 'samples' (e.g., 100 peaks per clip)
    let chunk_size = f32_data.len() / samples;
    let mut peaks = Vec::new();

    for chunk in f32_data.chunks(chunk_size.max(1)) {
        // Calculate the absolute peak value for the current chunk
        let max = chunk.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
        peaks.push(max);
    }

    Ok(peaks)
}

#[tauri::command]
fn copy_file(source: String, destination: String) -> Result<String, String> {
    let src_path = Path::new(&source);
    let dest_path = Path::new(&destination);

    // Validate if the source exists before attempting to copy
    if !src_path.exists() {
        return Err("Source file not found".to_string());
    }

    // Attempt to copy the file bytes
    // fs::copy returns the number of bytes copied on success
    match fs::copy(src_path, dest_path) {
        Ok(bytes) => Ok(format!("Successfully copied {} bytes", bytes)),
        Err(e) => Err(format!("Copy failed: {}", e)),
    }
}

#[tauri::command]
async fn transfer_folder_content(old_path: String, new_path: String) -> Result<(), String> {
    let old_dir = Path::new(&old_path);
    let new_dir = Path::new(&new_path);

    if !old_dir.exists() {
        return Ok(());
    } // Nada para transferir

    fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(old_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dest = new_dir.join(entry.file_name());

        // Se for o arquivo de config ou pastas de assets, movemos
        if entry.path().is_dir() {
            // Lógica simples de mover diretório
            let mut options = fs_extra::dir::CopyOptions::new();
            options.copy_inside = true;
            fs_extra::dir::move_dir(&old_dir, &new_dir, &options)
                .map_err(|err| format!("Error in moving the directory: {}", err))?;
        } else {
            fs::rename(entry.path(), dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}


#[tauri::command]
async fn get_system_gpus() -> Vec<String> {
    let instance = wgpu::Instance::default();
    instance.enumerate_adapters(wgpu::Backends::all())
        .iter()
        .map(|adapter| adapter.get_info().name)
        .collect()
}

#[tauri::command]
async fn read_settings_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_settings_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn init_workspace_structure(path: String) -> Result<(), String> {
    let base_path = Path::new(&path);

    if !base_path.exists() {
        fs::create_dir_all(base_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Mantenha o seu init_settings_structure apenas para as pastas técnicas:
#[tauri::command]
async fn init_settings_structure(path: String) -> Result<(), String> {
    let base = Path::new(&path);
    let folders = ["effects", "transitions", "fonts", "presets"];

    for folder in folders {
        let p = base.join(folder);
        if !p.exists() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_font_folder(path: String) -> Result<(), String> {
    // Constrói o caminho completo para a pasta de fontes
    let font_path = std::path::Path::new(&path).join("fonts");

    // Cria a pasta caso ela ainda não exista (evita erro ao abrir)
    if !font_path.exists() {
        std::fs::create_dir_all(&font_path).map_err(|e| e.to_string())?;
    }

    // Lógica para abrir o gerenciador de arquivos dependendo do SO
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(font_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(font_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(font_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn sync_video_effect(settings_folder: String, video_name: String) -> Result<String, String> {
    let effects_path = std::path::Path::new(&settings_folder).join("effects");
    let file_path = effects_path.join(&video_name);

    // Cria a pasta se não existir
    if !effects_path.exists() {
        std::fs::create_dir_all(&effects_path).map_err(|e| e.to_string())?;
    }

    // Se já existe, retorna o caminho
    if file_path.exists() {
        return Ok(file_path.to_string_lossy().into_owned());
    }

    // Download do servidor
    let url = format!("https://wannacut.app/assets/effects/{}", video_name);
    let client = reqwest::Client::new();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    let content = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().into_owned())
}


#[tauri::command]
fn send_notification_system(title: String, body: String) {
    Command::new("notify-send")
        .arg(&title)
        .arg(&body)
        .spawn()
        .ok();
}

fn main() {
    thread::spawn(move || {
        // Somente estas origens (o próprio app Tauri) podem receber resposta deste
        // servidor local. Isso substitui o antigo "Access-Control-Allow-Origin: *",
        // que permitia que QUALQUER site aberto no navegador do usuário lesse
        // arquivos locais via fetch() enquanto o WannaCut estivesse aberto.
        const ALLOWED_ORIGINS: [&str; 4] = [
            "tauri://localhost",       // produção (macOS/Linux)
            "http://tauri.localhost",  // produção (Windows/WebView2)
            "https://tauri.localhost",
            "http://localhost:1420",   // dev server (ajuste se sua porta do Vite for outra)
        ];

        // Só arquivos de mídia usados pelo editor podem ser servidos. Mesmo que um
        // caminho arbitrário seja pedido, arquivos fora dessa lista (ex: chaves SSH,
        // .env, arquivos de configuração) nunca são retornados.
        const ALLOWED_EXTENSIONS: [&str; 10] =
            ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mov", "webm", "avi", "mkv"];

        let server = match Server::http("127.0.0.1:1234") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Falha ao iniciar servidor local de mídia: {}", e);
                return;
            }
        };

        for request in server.incoming_requests() {
            // --- 1) Validação de origem no servidor ---
            // Requisições sem header Origin (ex: <video src> carregado pelo próprio
            // WebView) são aceitas; requisições com Origin precisam bater com a
            // allowlist. Isso bloqueia a requisição antes mesmo de tocar no disco,
            // em vez de depender só do navegador respeitar o header de CORS.
            let origin_header = request
                .headers()
                .iter()
                .find(|h| h.field.as_str().to_ascii_lowercase() == "origin")
                .map(|h| h.value.as_str().to_string());

            let origin_allowed = match &origin_header {
                None => true,
                Some(origin) => ALLOWED_ORIGINS.contains(&origin.as_str()),
            };

            if !origin_allowed {
                let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                continue;
            }

            // --- 2) Resolução e validação do path ---
            let url = request.url().trim_start_matches('/');
            let decoded_path = percent_encoding::percent_decode_str(url)
                .decode_utf8_lossy()
                .into_owned();

            // canonicalize() resolve "..", symlinks etc. Se o caminho não existir ou
            // não puder ser resolvido, cai fora sem revelar detalhes do erro.
            let canonical_path = match Path::new(&decoded_path).canonicalize() {
                Ok(p) if p.is_file() => p,
                _ => {
                    let _ =
                        request.respond(Response::from_string("Not Found").with_status_code(404));
                    continue;
                }
            };

            let extension_lower = canonical_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());

            let extension_ok = extension_lower
                .as_deref()
                .map(|e| ALLOWED_EXTENSIONS.contains(&e))
                .unwrap_or(false);

            if !extension_ok {
                let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
                continue;
            }

            let path = canonical_path;

            // --- 3) Leitura e resposta, com tratamento de erro em vez de unwrap() ---
            // (requisições malformadas não derrubam mais a thread do servidor)
            let mut file = match File::open(&path) {
                Ok(f) => f,
                Err(_) => {
                    let _ = request
                        .respond(Response::from_string("Internal Server Error").with_status_code(500));
                    continue;
                }
            };

            let file_size = match file.metadata() {
                Ok(m) => m.len(),
                Err(_) => {
                    let _ = request
                        .respond(Response::from_string("Internal Server Error").with_status_code(500));
                    continue;
                }
            };

            let content_type = match extension_lower.as_deref() {
                Some("mp3") => "audio/mpeg",
                Some("wav") => "audio/wav",
                Some("m4a") => "audio/mp4",
                Some("ogg") => "audio/ogg",
                Some("flac") => "audio/flac",
                Some("mp4") => "video/mp4",
                Some("mov") => "video/quicktime",
                Some("webm") => "video/webm",
                Some("avi") => "video/x-msvideo",
                Some("mkv") => "video/x-matroska",
                _ => "application/octet-stream",
            };

            // Lógica de Range Header
            let range_header = request
                .headers()
                .iter()
                .find(|h| h.field.as_str().to_ascii_lowercase() == "range")
                .map(|h| h.value.as_str().to_string());

            let mut response = if let Some(range) = range_header {
                // Parse range: "bytes=start-end"
                let range = range.replace("bytes=", "");
                let parts: Vec<&str> = range.split('-').collect();
                let start = parts.get(0).and_then(|p| p.parse::<u64>().ok()).unwrap_or(0);
                let end = parts
                    .get(1)
                    .filter(|p| !p.is_empty())
                    .and_then(|p| p.parse::<u64>().ok())
                    .unwrap_or(file_size.saturating_sub(1))
                    .min(file_size.saturating_sub(1));

                if file_size == 0 || start > end || file.seek(SeekFrom::Start(start)).is_err() {
                    let _ = request.respond(
                        Response::from_string("Range Not Satisfiable").with_status_code(416),
                    );
                    continue;
                }

                let length = end - start + 1;
                let mut buffer = vec![0; length as usize];
                if file.read_exact(&mut buffer).is_err() {
                    let _ = request.respond(
                        Response::from_string("Internal Server Error").with_status_code(500),
                    );
                    continue;
                }

                let mut res = Response::from_data(buffer).with_status_code(206);
                if let Ok(h) = Header::from_bytes(
                    &b"Content-Range"[..],
                    format!("bytes {}-{}/{}", start, end, file_size).as_bytes(),
                ) {
                    res.add_header(h);
                }
                res
            } else {
                let mut buffer = Vec::new();
                if file.read_to_end(&mut buffer).is_err() {
                    let _ = request.respond(
                        Response::from_string("Internal Server Error").with_status_code(500),
                    );
                    continue;
                }
                Response::from_data(buffer).with_status_code(200)
            };

            // Headers Obrigatórios
            response.add_header(
                Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
            );

            // Nunca "*": só ecoa a origem de volta se ela estiver na allowlist.
            if let Some(origin) = origin_header
                .as_deref()
                .filter(|o| ALLOWED_ORIGINS.contains(o))
            {
                if let Ok(h) =
                    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], origin.as_bytes())
                {
                    response.add_header(h);
                }
            }

            response
                .add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());

            let _ = request.respond(response);
        }
    });

    // ---------------------------------------------------------------------------
    // ENGINE EXPORT: recebe frames PNG e WAV do frontend e monta o vídeo final
    // ---------------------------------------------------------------------------

    /// Salva um frame PNG (base64) na pasta de frames temporários do projeto.
    /// Chamado a cada frame renderizado pelo motor Three.js no frontend.
    #[tauri::command]
    async fn save_export_frame(
        project_path: String,
        frame_index: u32,
        png_base64: String,
    ) -> Result<(), String> {
        use base64::{engine::general_purpose, Engine as _};

        let frames_dir = std::path::Path::new(&project_path).join("export_frames");
        std::fs::create_dir_all(&frames_dir)
            .map_err(|e| format!("Erro ao criar pasta de frames: {}", e))?;

        let frame_path = frames_dir.join(format!("{:06}.png", frame_index));

        let b64_data = png_base64.split(',').last().unwrap_or(&png_base64);
        let bytes = general_purpose::STANDARD
            .decode(b64_data)
            .map_err(|e| format!("Erro ao decodificar base64 do frame {}: {}", frame_index, e))?;

        std::fs::write(&frame_path, bytes)
            .map_err(|e| format!("Erro ao salvar frame {}: {}", frame_index, e))?;

        Ok(())
    }

    /// Salva um frame PNG (base64) diretamente na pasta de assets do projeto (videos/).
    /// Usado pelo menu "Add Frame to Project" no editor.
    #[tauri::command]
    async fn save_frame_as_asset(
        project_path: String,
        file_name: String,
        png_base64: String,
    ) -> Result<(), String> {
        use base64::{engine::general_purpose, Engine as _};

        let videos_dir = std::path::Path::new(&project_path).join("videos");
        std::fs::create_dir_all(&videos_dir)
            .map_err(|e| format!("Erro ao criar pasta de assets: {}", e))?;

        let file_path = videos_dir.join(&file_name);

        let b64_data = png_base64.split(',').last().unwrap_or(&png_base64);
        let bytes = general_purpose::STANDARD
            .decode(b64_data)
            .map_err(|e| format!("Erro ao decodificar base64 do frame: {}", e))?;

        std::fs::write(&file_path, bytes)
            .map_err(|e| format!("Erro ao salvar frame como asset: {}", e))?;

        Ok(())
    }

    /// Salva o WAV de áudio gerado pelo OfflineAudioContext do frontend.
    /// O frontend já faz todo o mix, efeitos e volume — o Rust só guarda o arquivo.
    #[tauri::command]
    async fn save_export_audio(project_path: String, wav_base64: String) -> Result<(), String> {
        use base64::{engine::general_purpose, Engine as _};

        let audio_path = std::path::Path::new(&project_path).join("export_audio_mix.wav");

        let b64_data = wav_base64.split(',').last().unwrap_or(&wav_base64);
        let bytes = general_purpose::STANDARD
            .decode(b64_data)
            .map_err(|e| format!("Erro ao decodificar base64 do WAV: {}", e))?;

        std::fs::write(&audio_path, bytes).map_err(|e| format!("Erro ao salvar WAV: {}", e))?;

        Ok(())
    }

    /// Retorna os argumentos de aceleração de hardware para o FFmpeg com base na GPU escolhida.
    /// O nome da GPU vem do wannacut_settings.json (campo `gpu`, escolhido pelo usuário).
    fn get_hwaccel_args(gpu_name: Option<&str>) -> Vec<String> {
        let name = match gpu_name {
            Some(n) if !n.is_empty() => n.to_lowercase(),
            _ => return vec![],
        };
        if name.contains("nvidia") || name.contains("geforce") || name.contains("quadro") || name.contains("rtx") || name.contains("gtx") {
            vec!["-hwaccel".into(), "cuda".into()]
        } else if name.contains("amd") || name.contains("radeon") {
            vec!["-hwaccel".into(), "vaapi".into(), "-vaapi_device".into(), "/dev/dri/renderD128".into()]
        } else if name.contains("intel") {
            vec!["-hwaccel".into(), "qsv".into()]
        } else {
            // GPU genérica reconhecida mas sem backend específico: deixa o FFmpeg decidir
            vec!["-hwaccel".into(), "auto".into()]
        }
    }

    /// Após todos os frames e o WAV serem salvos, monta o vídeo final com FFmpeg:
    ///   1. PNGs → vídeo sem áudio
    ///   2. Vídeo + WAV → arquivo final (ou só vídeo se não há WAV)
    ///
    /// O frontend já fez todo o processamento de áudio (mix, efeitos, volume, posicionamento).
    /// O Rust apenas combina os dois streams com FFmpeg.

    #[tauri::command]
   async fn assemble_exported_video(
        app_handle: tauri::AppHandle,
        project_path: String,
        target_path: String,
        fps: u32,
        duration: f64,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let proj = std::path::Path::new(&project_path);
        let frames_dir = proj.join("export_frames");
        let audio_wav_path = proj.join("export_audio_mix.wav");
        let video_only_path = proj.join("export_video_only.mp4");
        let frame_pattern = frames_dir.join("%06d.png");

        // -----------------------------------------------------------------------
        // PASSO 1: PNGs → vídeo sem áudio
        // -----------------------------------------------------------------------
        let step1 = app_handle
            .shell()
            .command("ffmpeg") // Corrigido para .command() minúsculo (comando global)
            .args([
                "-y",
                "-framerate",
                &fps.to_string(),
                "-i",
                &frame_pattern.to_string_lossy(),
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-vf",
                &format!("scale={}:{}", width, height),
                &video_only_path.to_string_lossy(),
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg (frames→video) falhou: {}", e))?;

        if !step1.status.success() {
            return Err(format!(
                "FFmpeg (frames→video) erro: {}",
                String::from_utf8_lossy(&step1.stderr)
            ));
        }

        // -----------------------------------------------------------------------
        // PASSO 2: Combina vídeo + WAV (ou só vídeo se não há áudio)
        // O WAV já foi gerado pelo OfflineAudioContext no frontend com:
        //   - posicionamento correto de cada clip (start, beginmoment, duration)
        //   - todos os efeitos aplicados (pitch, alien, microphone)
        //   - curva de volume com keyframes e fades
        // -----------------------------------------------------------------------
        let has_audio = audio_wav_path.exists();

        let mut final_args: Vec<String> = vec!["-y".into()];
        final_args.push("-i".into());
        final_args.push(video_only_path.to_string_lossy().to_string());

        if has_audio {
            final_args.push("-i".into());
            final_args.push(audio_wav_path.to_string_lossy().to_string());
            final_args.push("-c:v".into());
            final_args.push("copy".into());
            final_args.push("-c:a".into());
            final_args.push("aac".into());
            final_args.push("-b:a".into());
            final_args.push("192k".into());
            final_args.push("-t".into());
            final_args.push(format!("{:.6}", duration));
        } else {
            final_args.push("-c".into());
            final_args.push("copy".into());
        }

        final_args.push(target_path.clone());

        let step2 = app_handle
            .shell()
            .command("ffmpeg") // Corrigido de .sidecar() para .command() global
            .args(final_args) // O Tauri v2 consome o Vec<String> diretamente aqui
            .output()
            .await
            .map_err(|e| format!("FFmpeg (mux final) falhou: {}", e))?;

        if !step2.status.success() {
            return Err(format!(
                "FFmpeg (mux final) erro: {}",
                String::from_utf8_lossy(&step2.stderr)
            ));
        }

        // -----------------------------------------------------------------------
        // LIMPEZA
        // -----------------------------------------------------------------------
        let _ = std::fs::remove_dir_all(&frames_dir);
        let _ = std::fs::remove_file(&video_only_path);
        let _ = std::fs::remove_file(&audio_wav_path);

        // Emissão do progresso final para o frontend
        let _ = app_handle.emit("export-progress", 100u32);

        Ok(())
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // Dialog plugin for system file pickers
        // Custom protocol for serving local video files with range-request support
        .manage(ExportState(Mutex::new(None)))
        .manage(YtDlpPid(std::sync::atomic::AtomicU32::new(0)))

        .invoke_handler(tauri::generate_handler![
            save_export_frame,
            save_frame_as_asset,
            save_export_audio,
            assemble_exported_video,
            list_projects,
            delete_project,
            import_asset,
            list_assets,
            download_video,
            cancel_video_download,
            load_latest_project,
            save_project_data,
            list_project_files,
            read_specific_file,
            load_specific_project,
            rename_file,
            get_duration,
            generate_thumbnail,
            delete_file,
            get_video_frame,
            extract_audio,
            get_waveform_data,
            export_video,
            cancel_export,
            move_file,
            copy_file,
            load_project_config,
            save_project_config,
            create_project_setup,
            get_asset_dimensions,
            get_system_gpus,
            read_settings_file,
            save_settings_file,
            init_settings_structure,
            init_workspace_structure,
            transfer_folder_content,
            list_fonts,
            get_image_data,
            get_audio_data,
            check_notifications,
            download_font_file,
            fetch_cloud_fonts,
            open_font_folder,
            sync_video_effect,
            get_preview_frame,
            send_notification_system,
            assemble_exported_audio,
            search_freesound,
            download_freesound,
            read_freesound_api_key,
            save_freesound_api_key,
            search_pexels,
            search_pexels_videos,
            download_pexels,
            download_pexels_video,
            read_pexels_api_key,
            save_pexels_api_key,
            plans::activate_license,
            plans::get_license_state,
            plans::deactivate_license,
            vocal_remover::vocal_remover_ready,
            vocal_remover::vocal_remover_download,
            vocal_remover::remove_vocals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}