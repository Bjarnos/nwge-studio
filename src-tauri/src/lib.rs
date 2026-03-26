mod lua_ls;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const PACK_MAGIC: u32 = fourcc(b'N', b'W', b'G', b'E');
const PACK_VERSION_MAJOR: u16 = 1;
const PACK_VERSION_MINOR: u16 = 2;

const CHUNK_STRS: u32 = fourcc(b'S', b'T', b'R', b'S');
const CHUNK_SPRT: u32 = fourcc(b'S', b'P', b'R', b'T');
const CHUNK_IMAG: u32 = fourcc(b'I', b'M', b'A', b'G');
const CHUNK_OBJD: u32 = fourcc(b'O', b'B', b'J', b'D');
const CHUNK_ROOM: u32 = fourcc(b'R', b'O', b'O', b'M');
const CHUNK_SCRP: u32 = fourcc(b'S', b'C', b'R', b'P');
const CHUNK_META: u32 = fourcc(b'M', b'E', b'T', b'A');

const EVT_CREATE: u8 = 0;
const EVT_STEP: u8 = 1;
const EVT_DRAW: u8 = 2;
const EVT_DESTROY: u8 = 3;
const EVT_COLLISION: u8 = 4;
const EVT_BUTTON_PRESSED: u8 = 5;
const EVT_BUTTON_RELEASED: u8 = 6;
const EVT_BUTTON_DOWN: u8 = 7;
const EVT_ALARM: u8 = 8;

const SPRITE_FLAG_FORMAT_RGBA8888: u16 = 1;
const INVALID_ID16: u16 = u16::MAX;
const LAYER_BACKGROUND: u8 = 0;
const LAYER_TILES: u8 = 1;
const LAYER_INSTANCES: u8 = 2;
const BACKGROUND_FLAG_REPEAT_SPRITE: u16 = 0x0001;
const TILE_LAYER_FLAG_HAS_COLLISION: u16 = 0x0001;

const CONFIG_VALUE_STRING: u8 = 0;
const CONFIG_VALUE_NUMBER: u8 = 1;
const CONFIG_VALUE_BOOLEAN: u8 = 2;
const ALARM_EVENT_COUNT: usize = 12;
const PREVIEW_OUTPUT_EVENT: &str = "preview-output";
const DEFAULT_NWGE_API_BASE_URL: &str = "https://nwge-api.bjarnos.dev";
const ARTIFACT_CACHE_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const ARTIFACT_RUN_ID_HEADER: &str = "x-nwge-artifact-run-id";

fn default_theme_mode() -> String {
    "light".to_string()
}

fn temp_build_dir() -> PathBuf {
    std::env::temp_dir().join("nwge-studio").join("build")
}

fn temp_pack_path(name: &str) -> PathBuf {
    temp_build_dir().join(name)
}

fn preview_pack_path() -> PathBuf {
    temp_pack_path("studio-preview.pack")
}

fn operation_run_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{prefix}-{millis}")
}

fn preview_run_id() -> String {
    operation_run_id("preview")
}

fn preview_command_path(run_id: &str) -> PathBuf {
    temp_build_dir().join(format!("{run_id}-console.lua"))
}

fn output_run_id(prefix: &str) -> String {
    operation_run_id(prefix)
}

fn output_pack_path(prefix: &str) -> PathBuf {
    temp_pack_path(&format!("{prefix}.pack"))
}

fn output_pack_path_string(prefix: &str) -> String {
    output_pack_path(prefix).display().to_string()
}

#[derive(Default)]
struct PreviewSessionState {
    active: Mutex<Option<ActivePreviewSession>>,
}

#[derive(Debug, Clone)]
struct ActivePreviewSession {
    run_id: String,
    command_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewOutputPayload {
    run_id: String,
    stream: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewLaunchResult {
    pack_path: String,
    run_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactCacheMetadata {
    artifact_run_id: Option<String>,
}

#[derive(Debug, Clone)]
struct DownloadedArtifactArchive {
    output_dir: PathBuf,
    artifact_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportTargetStatus {
    ready: bool,
    missing: Vec<String>,
    note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportSupportResult {
    runtime_root: String,
    runtime_workspace_ready: bool,
    runtime_workspace_message: String,
    backend_base_url: String,
    pack: ExportTargetStatus,
    embedded: ExportTargetStatus,
    flash: ExportTargetStatus,
    simulator: ExportTargetStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedExportResult {
    output_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EmbeddedBuildStreamEvent {
    Log {
        stream: String,
        message: String,
    },
    Error {
        message: String,
    },
    Result {
        #[serde(alias = "downloadPath")]
        download_path: String,
        #[serde(default, alias = "fileName")]
        file_name: Option<String>,
    },
}

fn emit_preview_output(app: &AppHandle, run_id: &str, stream: &str, message: impl Into<String>) {
    let _ = app.emit(
        PREVIEW_OUTPUT_EVENT,
        PreviewOutputPayload {
            run_id: run_id.to_string(),
            stream: stream.to_string(),
            message: message.into(),
        },
    );
}

fn spawn_preview_stream_thread<R>(app: AppHandle, run_id: String, stream: &'static str, reader: R)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let message = line.trim_end_matches(['\r', '\n']);
                    emit_preview_output(&app, &run_id, stream, message);
                }
                Err(error) => {
                    emit_preview_output(
                        &app,
                        &run_id,
                        "stderr",
                        format!("Failed to read {stream} output: {error}"),
                    );
                    break;
                }
            }
        }
    });
}

fn tool_exists(command: &str) -> bool {
    if command.contains(std::path::MAIN_SEPARATOR) {
        return Path::new(command).is_file();
    }

    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    #[cfg(windows)]
    let path_exts: Vec<String> = std::env::var_os("PATHEXT")
        .and_then(|value| value.into_string().ok())
        .map(|value| {
            value
                .split(';')
                .map(|entry| entry.to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_else(|| vec![".exe".to_string(), ".cmd".to_string(), ".bat".to_string()]);

    for path in std::env::split_paths(&path_var) {
        let direct = path.join(command);
        if direct.is_file() {
            return true;
        }

        #[cfg(windows)]
        for ext in &path_exts {
            let with_ext = path.join(format!("{command}{ext}"));
            if with_ext.is_file() {
                return true;
            }
        }
    }

    false
}

fn has_runtime_root(runtime_root: &Path) -> bool {
    runtime_root.join("Makefile").is_file() && runtime_root.join("runtime").is_dir()
}

fn guess_runtime_root_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(value) = std::env::var("NWGE_RUNTIME_ROOT") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.to_path_buf());
            candidates.push(parent.join("nwge-runtime"));
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.to_path_buf());
                candidates.push(grandparent.join("nwge-runtime"));
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.clone());
    if let Some(parent) = manifest_dir.parent() {
        candidates.push(parent.to_path_buf());
        if let Some(grandparent) = parent.parent() {
            candidates.push(grandparent.join("nwge-runtime"));
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.to_path_buf());
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.to_path_buf());
                candidates.push(grandparent.join("nwge-runtime"));
            }
        }
    }

    candidates
        .into_iter()
        .find(|candidate| has_runtime_root(candidate))
}

fn artifact_cache_dir(name: &str) -> PathBuf {
    temp_build_dir().join("artifacts").join(name)
}

fn artifact_cache_disabled() -> bool {
    std::env::var("NWGE_DISABLE_ARTIFACT_CACHE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn file_is_fresh(path: &Path, ttl: Duration) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified_at) = metadata.modified() else {
        return false;
    };
    let Ok(age) = SystemTime::now().duration_since(modified_at) else {
        return false;
    };
    age <= ttl
}

fn cache_marker_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(".cache-ready")
}

fn cache_metadata_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(".cache-metadata.json")
}

fn cache_ready(cache_dir: &Path) -> bool {
    cache_marker_path(cache_dir).exists()
}

fn mark_cache_ready(cache_dir: &Path) -> Result<(), String> {
    fs::write(cache_marker_path(cache_dir), b"ok").map_err(|error| error.to_string())
}

fn load_cache_metadata(cache_dir: &Path) -> ArtifactCacheMetadata {
    let Ok(contents) = fs::read_to_string(cache_metadata_path(cache_dir)) else {
        return ArtifactCacheMetadata::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn store_cache_metadata(cache_dir: &Path, metadata: &ArtifactCacheMetadata) -> Result<(), String> {
    let payload = serde_json::to_vec(metadata).map_err(|error| error.to_string())?;
    fs::write(cache_metadata_path(cache_dir), payload).map_err(|error| error.to_string())
}

fn cache_metadata_matches_run_id(
    metadata: &ArtifactCacheMetadata,
    expected_run_id: Option<&str>,
) -> bool {
    match expected_run_id {
        Some(run_id) => metadata.artifact_run_id.as_deref() == Some(run_id),
        None => metadata.artifact_run_id.is_some(),
    }
}

fn artifact_cache_is_fresh(cache_dir: &Path) -> bool {
    !artifact_cache_disabled() && file_is_fresh(&cache_marker_path(cache_dir), ARTIFACT_CACHE_TTL)
}

fn artifact_request_query<'a>(pairs: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
    let mut query = pairs.to_vec();
    if artifact_cache_disabled() {
        query.push(("cache", "0"));
    }
    query
}

fn nwge_api_base_url() -> String {
    std::env::var("NWGE_API_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_NWGE_API_BASE_URL.to_string())
}

fn nwge_api_url(path: &str) -> String {
    format!("{}/{}", nwge_api_base_url(), path.trim_start_matches('/'))
}

fn resolve_runtime_root(runtime_root: &str) -> Result<PathBuf, String> {
    let trimmed = runtime_root.trim();
    if !trimmed.is_empty() {
        let path = PathBuf::from(trimmed);
        if has_runtime_root(&path) {
            return Ok(path);
        }
        return Err(format!(
            "Runtime workspace '{}' is missing the NWGE runtime Makefile.",
            path.display()
        ));
    }

    if let Some(path) = guess_runtime_root_path() {
        return Ok(path);
    }

    Err("NWGE runtime repository is not installed yet.".to_string())
}

fn runtime_repo_available(runtime_root: &str) -> bool {
    resolve_runtime_root(runtime_root).is_ok()
}

fn runtime_host_artifact_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "nwge-runtime-windows"
    } else if cfg!(target_os = "macos") {
        "nwge-runtime-macos"
    } else {
        "nwge-runtime-linux"
    }
}

fn runtime_host_bundle_name() -> &'static str {
    "nwge.nwb"
}

fn runtime_simulator_artifact_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "epsilon-simulator-windows"
    } else if cfg!(target_os = "macos") {
        "epsilon-simulator-macos"
    } else {
        "epsilon-simulator-linux"
    }
}

fn runtime_device_artifact_name() -> &'static str {
    "nwge-runtime-device"
}

fn runtime_device_bundle_name() -> &'static str {
    "nwge.nwa"
}

fn runtime_simulator_path(root: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        root.join("binaries").join("windows").join("epsilon.exe")
    } else if cfg!(target_os = "macos") {
        root.join("binaries")
            .join("macos")
            .join("Contents")
            .join("MacOS")
            .join("Epsilon")
    } else {
        root.join("binaries").join("linux").join("epsilon.bin")
    }
}

fn missing_tools(tools: &[&str]) -> Vec<String> {
    tools
        .iter()
        .filter(|tool| !tool_exists(tool))
        .map(|tool| (*tool).to_string())
        .collect()
}

fn embedded_export_missing_tools(_runtime_root: &str) -> Vec<String> {
    Vec::new()
}

fn flash_missing_tools(_runtime_root: &str) -> Vec<String> {
    missing_tools(&["npx"])
}

fn simulator_missing_tools(_runtime_root: &str) -> Vec<String> {
    Vec::new()
}

fn status_from_missing(missing: Vec<String>, note: impl Into<String>) -> ExportTargetStatus {
    ExportTargetStatus {
        ready: missing.is_empty(),
        missing,
        note: note.into(),
    }
}

fn ensure_tools_available(missing: Vec<String>, action: &str) -> Result<(), String> {
    if missing.is_empty() {
        return Ok(());
    }

    Err(format!(
        "{action} needs these tools first: {}.",
        missing.join(", ")
    ))
}

fn http_error_message(response: reqwest::blocking::Response) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    let trimmed = body.trim();
    if trimmed.is_empty() {
        format!("Backend request failed with status {status}.")
    } else {
        format!("Backend request failed with status {status}: {trimmed}")
    }
}

fn find_file_recursive(root: &Path, file_name: &str) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            if let Some(found) = find_file_recursive(&path, file_name)? {
                return Ok(Some(found));
            }
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == file_name)
            .unwrap_or(false)
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn extract_zip_archive(archive_bytes: &[u8], output_dir: &Path) -> Result<(), String> {
    let reader = Cursor::new(archive_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            format!(
                "Artifact archive entry '{}' escaped the extraction root.",
                entry.name()
            )
        })?;
        let output_path = output_dir.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let mut output_file = fs::File::create(&output_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output_file).map_err(|error| error.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            if let Some(mode) = entry.unix_mode() {
                fs::set_permissions(&output_path, fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

fn download_latest_artifact_archive(
    app: &AppHandle,
    run_id: &str,
    artifact_name: &str,
    expected_artifact_run_id: Option<&str>,
) -> Result<DownloadedArtifactArchive, String> {
    let extract_dir = artifact_cache_dir(&format!("{artifact_name}-archive"));
    let output_dir = extract_dir.join("contents");
    let cached_metadata = load_cache_metadata(&extract_dir);

    if artifact_cache_is_fresh(&extract_dir)
        && output_dir.exists()
        && cache_metadata_matches_run_id(&cached_metadata, expected_artifact_run_id)
    {
        emit_preview_output(
            app,
            run_id,
            "status",
            format!("Using cached '{artifact_name}' archive."), // TTL is 2 hours
        );
        return Ok(DownloadedArtifactArchive {
            output_dir,
            artifact_run_id: cached_metadata.artifact_run_id,
        });
    }

    if artifact_cache_disabled() && extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&extract_dir).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::new();
    let mut query = vec![("name", artifact_name)];
    if let Some(run_id) = expected_artifact_run_id {
        query.push(("run_id", run_id));
    }
    let url = reqwest::Url::parse_with_params(
        &nwge_api_url("/api/artifacts/archive/latest"),
        artifact_request_query(&query),
    )
    .map_err(|error| error.to_string())?;

    emit_preview_output(
        app,
        run_id,
        "status",
        format!("Downloading the '{artifact_name}' archive from the servers."),
    );

    let response = match client.get(url).send() {
        Ok(response) => response,
        Err(error) => {
            if cache_ready(&extract_dir)
                && output_dir.exists()
                && cache_metadata_matches_run_id(&cached_metadata, expected_artifact_run_id)
            {
                emit_preview_output(
                    app,
                    run_id,
                    "status",
                    format!("Server unreachable, reusing cached '{artifact_name}' archive."),
                );
                return Ok(DownloadedArtifactArchive {
                    output_dir,
                    artifact_run_id: cached_metadata.artifact_run_id,
                });
            }
            return Err(format!(
                "Failed to reach the servers at '{}': {error}",
                nwge_api_base_url()
            ));
        }
    };
    if !response.status().is_success() {
        let error = http_error_message(response);
        if cache_ready(&extract_dir)
            && output_dir.exists()
            && cache_metadata_matches_run_id(&cached_metadata, expected_artifact_run_id)
        {
            emit_preview_output(
                app,
                run_id,
                "status",
                format!("Server returned an error, reusing cached '{artifact_name}' archive."),
            );
            return Ok(DownloadedArtifactArchive {
                output_dir,
                artifact_run_id: cached_metadata.artifact_run_id,
            });
        }
        emit_preview_output(app, run_id, "stderr", &error);
        return Err(error);
    }

    let artifact_run_id = response
        .headers()
        .get(ARTIFACT_RUN_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let archive_bytes = response.bytes().map_err(|error| error.to_string())?;
    if let Some(expected_run_id) = expected_artifact_run_id {
        if artifact_run_id.as_deref() != Some(expected_run_id) {
            return Err(format!(
                "The server returned '{artifact_name}' from a different workflow run than expected.",
            ));
        }
    }
    if output_dir.exists() {
        fs::remove_dir_all(&output_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    extract_zip_archive(archive_bytes.as_ref(), &output_dir)?;
    store_cache_metadata(
        &extract_dir,
        &ArtifactCacheMetadata {
            artifact_run_id: artifact_run_id.clone(),
        },
    )?;
    mark_cache_ready(&extract_dir)?;
    Ok(DownloadedArtifactArchive {
        output_dir,
        artifact_run_id,
    })
}

fn download_latest_artifact(
    app: &AppHandle,
    run_id: &str,
    artifact_name: &str,
    bundle_name: &str,
) -> Result<PathBuf, String> {
    let extract_dir = artifact_cache_dir(artifact_name);
    let output_path = extract_dir.join(bundle_name);

    if artifact_cache_is_fresh(&extract_dir) && output_path.exists() {
        emit_preview_output(
            app,
            run_id,
            "status",
            format!("Using cached '{artifact_name}' download from the last 2 hours."),
        );
        return Ok(output_path);
    }

    if artifact_cache_disabled() && extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&extract_dir).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::new();
    let url = reqwest::Url::parse_with_params(
        &nwge_api_url("/api/artifacts/latest"),
        artifact_request_query(&[("name", artifact_name), ("bundle", bundle_name)]),
    )
    .map_err(|error| error.to_string())?;

    emit_preview_output(
        app,
        run_id,
        "status",
        format!("Downloading '{artifact_name}' from the servers."),
    );

    let response = match client.get(url).send() {
        Ok(response) => response,
        Err(error) => {
            if cache_ready(&extract_dir) && output_path.exists() {
                emit_preview_output(
                    app,
                    run_id,
                    "status",
                    format!("Server unreachable, reusing cached '{artifact_name}' download."),
                );
                return Ok(output_path);
            }
            return Err(format!(
                "Failed to reach the servers at '{}': {error}",
                nwge_api_base_url()
            ));
        }
    };
    if !response.status().is_success() {
        let error = http_error_message(response);
        if cache_ready(&extract_dir) && output_path.exists() {
            emit_preview_output(
                app,
                run_id,
                "status",
                format!("Server returned an error, reusing cached '{artifact_name}' download."),
            );
            return Ok(output_path);
        }
        emit_preview_output(app, run_id, "stderr", &error);
        return Err(error);
    }

    let bytes = response.bytes().map_err(|error| error.to_string())?;
    fs::write(&output_path, &bytes).map_err(|error| error.to_string())?;
    mark_cache_ready(&extract_dir)?;
    Ok(output_path)
}

fn run_command_with_streaming_output(
    app: &AppHandle,
    run_id: &str,
    status_message: impl Into<String>,
    command: &mut Command,
) -> Result<(), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Process stdout was unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Process stderr was unavailable.".to_string())?;

    emit_preview_output(app, run_id, "status", status_message);
    spawn_preview_stream_thread(app.clone(), run_id.to_string(), "stdout", stdout);
    spawn_preview_stream_thread(app.clone(), run_id.to_string(), "stderr", stderr);

    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() {
        emit_preview_output(app, run_id, "status", "Command completed successfully.");
        return Ok(());
    }

    let code = status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "terminated by signal".to_string());
    emit_preview_output(
        app,
        run_id,
        "status",
        format!("Command exited with code {code}."),
    );
    Err(format!(
        "Command exited with code {code}. Check the output pane for details."
    ))
}

fn button_event_arg0(button_name: &str) -> Option<u8> {
    match button_name {
        "key_left" => Some(8),
        "key_up" => Some(9),
        "key_down" => Some(10),
        "key_right" => Some(11),
        "key_ok" => Some(12),
        "key_back" => Some(13),
        "key_home" => Some(14),
        "key_on_off" => Some(15),
        "key_shift" => Some(16),
        "key_alpha" => Some(17),
        "key_xnt" => Some(18),
        "key_var" => Some(19),
        "key_toolbox" => Some(20),
        "key_backspace" => Some(21),
        "key_exp" => Some(22),
        "key_ln" => Some(23),
        "key_log" => Some(24),
        "key_imaginary" => Some(25),
        "key_comma" => Some(26),
        "key_power" => Some(27),
        "key_sine" => Some(28),
        "key_cosine" => Some(29),
        "key_tangent" => Some(30),
        "key_pi" => Some(31),
        "key_sqrt" => Some(32),
        "key_square" => Some(33),
        "key_seven" => Some(34),
        "key_eight" => Some(35),
        "key_nine" => Some(36),
        "key_left_parenthesis" => Some(37),
        "key_right_parenthesis" => Some(38),
        "key_four" => Some(39),
        "key_five" => Some(40),
        "key_six" => Some(41),
        "key_multiplication" => Some(42),
        "key_division" => Some(43),
        "key_one" => Some(44),
        "key_two" => Some(45),
        "key_three" => Some(46),
        "key_plus" => Some(47),
        "key_minus" => Some(48),
        "key_zero" => Some(49),
        "key_dot" => Some(50),
        "key_ee" => Some(51),
        "key_ans" => Some(52),
        "key_exe" => Some(53),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpriteFrame {
    id: String,
    pixels: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpriteAsset {
    id: String,
    name: String,
    width: u16,
    height: u16,
    #[serde(default)]
    frame_duration_ms: u16,
    origin_x: i16,
    origin_y: i16,
    bbox_left: u16,
    bbox_top: u16,
    bbox_right: u16,
    bbox_bottom: u16,
    frames: Vec<SpriteFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptAsset {
    id: String,
    name: String,
    code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigEntry {
    id: String,
    name: String,
    #[serde(alias = "type")]
    value_type: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectAsset {
    id: String,
    name: String,
    #[serde(default)]
    parent_object_id: String,
    sprite_id: String,
    create_script_id: String,
    step_script_id: String,
    draw_script_id: String,
    #[serde(default)]
    destroy_script_id: String,
    #[serde(default)]
    collision_script_id: String,
    #[serde(default)]
    collision_object_id: String,
    #[serde(default)]
    alarm_script_ids: Vec<String>,
    #[serde(default)]
    button_pressed_script_ids: HashMap<String, String>,
    #[serde(default)]
    button_down_script_ids: HashMap<String, String>,
    #[serde(default)]
    button_released_script_ids: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomPlacement {
    id: String,
    object_id: String,
    x: i16,
    y: i16,
    #[serde(default)]
    layer_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomBackgroundLayer {
    id: String,
    name: String,
    depth: i16,
    #[serde(default)]
    color: String,
    #[serde(default)]
    sprite_id: String,
    #[serde(default)]
    repeat: bool,
    #[serde(default = "default_parallax_factor")]
    parallax_x: f32,
    #[serde(default = "default_parallax_factor")]
    parallax_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomTileLayer {
    id: String,
    name: String,
    depth: i16,
    tileset_sprite_id: String,
    tile_width: u16,
    tile_height: u16,
    columns: u16,
    rows: u16,
    #[serde(default)]
    tiles: Vec<i32>,
    #[serde(default)]
    collisions: Vec<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomInstanceLayer {
    id: String,
    name: String,
    depth: i16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomAsset {
    id: String,
    name: String,
    width: u16,
    height: u16,
    #[serde(default)]
    camera_x: u16,
    #[serde(default)]
    camera_y: u16,
    #[serde(default)]
    camera_follow_object_id: String,
    #[serde(default)]
    background_layers: Vec<RoomBackgroundLayer>,
    #[serde(default)]
    create_script_ids: Vec<String>,
    #[serde(default)]
    step_script_ids: Vec<String>,
    #[serde(default)]
    draw_script_ids: Vec<String>,
    #[serde(default)]
    destroy_script_ids: Vec<String>,
    #[serde(default, skip_serializing)]
    create_script_id: String,
    #[serde(default, skip_serializing)]
    step_script_id: String,
    #[serde(default, skip_serializing)]
    draw_script_id: String,
    #[serde(default, skip_serializing)]
    destroy_script_id: String,
    #[serde(default)]
    tile_layers: Vec<RoomTileLayer>,
    #[serde(default)]
    instance_layers: Vec<RoomInstanceLayer>,
    #[serde(default)]
    placements: Vec<RoomPlacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StudioProject {
    name: String,
    #[serde(default = "default_theme_mode")]
    theme_mode: String,
    pack_path: String,
    project_path: String,
    #[serde(default)]
    runtime_root: String,
    #[serde(default)]
    icon_sprite_id: String,
    #[serde(default)]
    rooms: Vec<RoomAsset>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    room_name: String,
    #[serde(default)]
    room_width: u16,
    #[serde(default)]
    room_height: u16,
    #[serde(default)]
    camera_x: u16,
    #[serde(default)]
    camera_y: u16,
    sprites: Vec<SpriteAsset>,
    scripts: Vec<ScriptAsset>,
    #[serde(default)]
    config: Vec<ConfigEntry>,
    #[serde(default)]
    game_create_script_ids: Vec<String>,
    #[serde(default)]
    game_step_script_ids: Vec<String>,
    #[serde(default)]
    game_draw_script_ids: Vec<String>,
    #[serde(default)]
    game_destroy_script_ids: Vec<String>,
    #[serde(default, skip_serializing)]
    game_create_script_id: String,
    #[serde(default, skip_serializing)]
    game_step_script_id: String,
    #[serde(default, skip_serializing)]
    game_draw_script_id: String,
    #[serde(default, skip_serializing)]
    game_destroy_script_id: String,
    objects: Vec<ObjectAsset>,
    #[serde(default)]
    placements: Vec<RoomPlacement>,
}

#[derive(Clone, Copy)]
struct ChunkDirEntry {
    chunk_type: u32,
    offset: u32,
    size: u32,
    count: u32,
}

struct ChunkBuilder {
    chunk_type: u32,
    count: u32,
    data: Vec<u8>,
}

const fn fourcc(a: u8, b: u8, c: u8, d: u8) -> u32 {
    (a as u32) | ((b as u32) << 8) | ((c as u32) << 16) | ((d as u32) << 24)
}

fn push_u8(out: &mut Vec<u8>, value: u8) {
    out.push(value);
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_i16(out: &mut Vec<u8>, value: i16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(bytes);
}

fn write_u16_at(out: &mut [u8], offset: usize, value: u16) {
    out[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_i16_at(out: &mut [u8], offset: usize, value: i16) {
    out[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32_at(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn ensure_parent_dir(path: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn default_parallax_factor() -> f32 {
    1.0
}

fn parallax_to_fixed(value: f32) -> u16 {
    let clamped = if value.is_finite() {
        value.clamp(0.0, 4.0)
    } else {
        1.0
    };
    (clamped * 256.0).round() as u16
}

fn default_instance_layer() -> RoomInstanceLayer {
    RoomInstanceLayer {
        id: "instances".to_string(),
        name: "Instances".to_string(),
        depth: 0,
    }
}

fn default_background_layer() -> RoomBackgroundLayer {
    RoomBackgroundLayer {
        id: "background".to_string(),
        name: "Background".to_string(),
        depth: -200,
        color: "#ffffff".to_string(),
        sprite_id: String::new(),
        repeat: false,
        parallax_x: 1.0,
        parallax_y: 1.0,
    }
}

fn normalize_rooms(project: &StudioProject) -> Vec<RoomAsset> {
    if !project.rooms.is_empty() {
        return project
            .rooms
            .iter()
            .cloned()
            .map(|mut room| {
                if room.background_layers.is_empty() {
                    room.background_layers.push(default_background_layer());
                }
                if room.instance_layers.is_empty() {
                    room.instance_layers.push(default_instance_layer());
                }
                room
            })
            .collect();
    }

    vec![RoomAsset {
        id: "room-1".to_string(),
        name: if project.room_name.trim().is_empty() {
            "room_start".to_string()
        } else {
            project.room_name.clone()
        },
        width: if project.room_width == 0 {
            320
        } else {
            project.room_width
        },
        height: if project.room_height == 0 {
            240
        } else {
            project.room_height
        },
        camera_x: project.camera_x,
        camera_y: project.camera_y,
        camera_follow_object_id: String::new(),
        create_script_ids: Vec::new(),
        step_script_ids: Vec::new(),
        draw_script_ids: Vec::new(),
        destroy_script_ids: Vec::new(),
        create_script_id: String::new(),
        step_script_id: String::new(),
        draw_script_id: String::new(),
        destroy_script_id: String::new(),
        background_layers: vec![default_background_layer()],
        tile_layers: Vec::new(),
        instance_layers: vec![default_instance_layer()],
        placements: project
            .placements
            .clone()
            .into_iter()
            .map(|mut placement| {
                if placement.layer_id.is_empty() {
                    placement.layer_id = "instances".to_string();
                }
                placement
            })
            .collect(),
    }]
}

fn parse_hex_color_565(value: &str) -> u16 {
    let cleaned = value.trim().trim_start_matches('#');
    let expanded = match cleaned.len() {
        3 => {
            let chars: Vec<char> = cleaned.chars().collect();
            format!(
                "{}{}{}{}{}{}",
                chars[0], chars[0], chars[1], chars[1], chars[2], chars[2]
            )
        }
        6 => cleaned.to_string(),
        _ => "ffffff".to_string(),
    };

    let r = u8::from_str_radix(&expanded[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&expanded[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&expanded[4..6], 16).unwrap_or(255);
    (((u16::from(r) & 0xF8) << 8) | ((u16::from(g) & 0xFC) << 3) | (u16::from(b) >> 3)) as u16
}

fn merged_script_refs<'a>(script_ids: &'a [String], legacy_script_id: &'a str) -> Vec<&'a str> {
    if !script_ids.is_empty() {
        return script_ids
            .iter()
            .map(String::as_str)
            .filter(|entry| !entry.trim().is_empty())
            .collect();
    }
    if legacy_script_id.trim().is_empty() {
        Vec::new()
    } else {
        vec![legacy_script_id]
    }
}

fn validate_project(project: &StudioProject) -> Result<(), String> {
    let rooms = normalize_rooms(project);
    if rooms.is_empty() {
        return Err("Create at least one room before exporting.".into());
    }
    for room in &rooms {
        if room.name.trim().is_empty() {
            return Err("Room name cannot be empty.".into());
        }
        if room.width == 0 || room.height == 0 {
            return Err(format!("Room '{}' must have a non-zero size.", room.name));
        }
        if room.camera_x > room.width.saturating_sub(320)
            || room.camera_y > room.height.saturating_sub(240)
        {
            return Err(format!(
                "Room '{}' camera start falls outside the room bounds.",
                room.name
            ));
        }
        for layer in &room.tile_layers {
            if layer.tileset_sprite_id.trim().is_empty() {
                return Err(format!(
                    "Tile layer '{}' in room '{}' needs a tileset sprite.",
                    layer.name, room.name
                ));
            }
            let expected = usize::from(layer.columns) * usize::from(layer.rows);
            if layer.tiles.len() != expected {
                return Err(format!(
                    "Tile layer '{}' in room '{}' has {} tiles but expected {}.",
                    layer.name,
                    room.name,
                    layer.tiles.len(),
                    expected
                ));
            }
            if !layer.collisions.is_empty() && layer.collisions.len() != expected {
                return Err(format!(
                    "Tile layer '{}' in room '{}' has mismatched collision data.",
                    layer.name, room.name
                ));
            }
        }
    }

    for sprite in &project.sprites {
        if sprite.name.trim().is_empty() {
            return Err("Every sprite needs a name.".into());
        }
        if sprite.width == 0 || sprite.height == 0 {
            return Err(format!(
                "Sprite '{}' must have a non-zero size.",
                sprite.name
            ));
        }
        if sprite.frames.is_empty() {
            return Err(format!(
                "Sprite '{}' needs at least one frame.",
                sprite.name
            ));
        }
        if sprite.bbox_left > sprite.bbox_right || sprite.bbox_top > sprite.bbox_bottom {
            return Err(format!(
                "Sprite '{}' has an invalid bounding box.",
                sprite.name
            ));
        }
        if sprite.bbox_right >= sprite.width || sprite.bbox_bottom >= sprite.height {
            return Err(format!(
                "Sprite '{}' bounding box falls outside the sprite size.",
                sprite.name
            ));
        }
        let expected_len = usize::from(sprite.width) * usize::from(sprite.height) * 4;
        for frame in &sprite.frames {
            if frame.pixels.len() != expected_len {
                return Err(format!(
                    "Sprite '{}' frame data does not match {}x{} RGBA pixels.",
                    sprite.name, sprite.width, sprite.height
                ));
            }
        }
    }

    for script in &project.scripts {
        if script.name.trim().is_empty() {
            return Err("Every script needs a name.".into());
        }
    }

    for entry in &project.config {
        if entry.name.trim().is_empty() {
            return Err("Every project environment variable needs a name.".into());
        }
        if !entry
            .name
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
            || !entry
                .name
                .chars()
                .next()
                .map(|ch| ch == '_' || ch.is_ascii_alphabetic())
                .unwrap_or(false)
        {
            return Err(format!(
                "Project environment variable '{}' is not a valid Lua identifier.",
                entry.name
            ));
        }
        match entry.value_type.as_str() {
            "string" => {}
            "number" => {
                entry.value.parse::<f64>().map_err(|_| {
                    format!(
                        "Project environment variable '{}' must contain a valid number.",
                        entry.name
                    )
                })?;
            }
            "boolean" => {
                if entry.value != "true" && entry.value != "false" {
                    return Err(format!(
                        "Project environment variable '{}' must be true or false.",
                        entry.name
                    ));
                }
            }
            _ => {
                return Err(format!(
                    "Project environment variable '{}' uses an unsupported type.",
                    entry.name
                ))
            }
        }
    }

    for object in &project.objects {
        if object.name.trim().is_empty() {
            return Err("Every object needs a name.".into());
        }
        if !object.parent_object_id.is_empty()
            && !project
                .objects
                .iter()
                .any(|entry| entry.id == object.parent_object_id)
        {
            return Err(format!(
                "Object '{}' refers to a missing parent.",
                object.name
            ));
        }
    }

    for object in &project.objects {
        let mut seen = std::collections::HashSet::new();
        let mut current = object;
        while !current.parent_object_id.is_empty() {
            if !seen.insert(current.id.as_str()) {
                return Err(format!(
                    "Object '{}' has an inheritance cycle.",
                    object.name
                ));
            }
            current = project
                .objects
                .iter()
                .find(|entry| entry.id == current.parent_object_id)
                .ok_or_else(|| format!("Object '{}' refers to a missing parent.", object.name))?;
        }
    }

    Ok(())
}

fn build_string_chunk(strings: &[String]) -> Result<ChunkBuilder, String> {
    let mut data = Vec::new();
    let count = u32::try_from(strings.len()).map_err(|_| "Too many strings.".to_string())?;
    push_u32(&mut data, count);

    let offset_table_pos = data.len();
    data.resize(data.len() + strings.len() * 4, 0);

    let mut offsets = Vec::with_capacity(strings.len());
    for value in strings {
        let offset =
            u32::try_from(data.len()).map_err(|_| "String table is too large.".to_string())?;
        offsets.push(offset);
        push_bytes(&mut data, value.as_bytes());
        push_u8(&mut data, 0);
    }

    for (index, offset) in offsets.iter().enumerate() {
        let start = offset_table_pos + index * 4;
        data[start..start + 4].copy_from_slice(&offset.to_le_bytes());
    }

    Ok(ChunkBuilder {
        chunk_type: CHUNK_STRS,
        count,
        data,
    })
}

fn add_string_id(
    strings: &mut Vec<String>,
    string_ids: &mut HashMap<String, u16>,
    value: &str,
) -> Result<u16, String> {
    if let Some(existing) = string_ids.get(value) {
        return Ok(*existing);
    }
    let next = u16::try_from(strings.len())
        .map_err(|_| "Too many strings for the pack format.".to_string())?;
    strings.push(value.to_string());
    string_ids.insert(value.to_string(), next);
    Ok(next)
}

fn build_pack(project: &StudioProject) -> Result<Vec<u8>, String> {
    validate_project(project)?;
    let rooms = normalize_rooms(project);

    let mut strings = Vec::<String>::new();
    let mut string_ids = HashMap::<String, u16>::new();

    let mut sprite_ids = HashMap::<String, u16>::new();
    let mut script_ids = HashMap::<String, u16>::new();
    let mut object_ids = HashMap::<String, u16>::new();

    let _ = add_string_id(&mut strings, &mut string_ids, &project.name)?;

    for (index, sprite) in project.sprites.iter().enumerate() {
        sprite_ids.insert(
            sprite.id.clone(),
            u16::try_from(index + 1).map_err(|_| "Too many sprites.".to_string())?,
        );
        let _ = add_string_id(&mut strings, &mut string_ids, &sprite.name)?;
    }

    for (index, script) in project.scripts.iter().enumerate() {
        script_ids.insert(
            script.id.clone(),
            u16::try_from(index + 1).map_err(|_| "Too many scripts.".to_string())?,
        );
        let _ = add_string_id(&mut strings, &mut string_ids, &script.name)?;
    }

    for entry in &project.config {
        let _ = add_string_id(&mut strings, &mut string_ids, &entry.name)?;
        let _ = add_string_id(&mut strings, &mut string_ids, &entry.value)?;
    }

    for (index, object) in project.objects.iter().enumerate() {
        object_ids.insert(
            object.id.clone(),
            u16::try_from(index + 1).map_err(|_| "Too many objects.".to_string())?,
        );
        let _ = add_string_id(&mut strings, &mut string_ids, &object.name)?;
    }

    for room in &rooms {
        let _ = add_string_id(&mut strings, &mut string_ids, &room.name)?;
    }
    let string_chunk = build_string_chunk(&strings)?;

    let mut image_data = Vec::new();
    let mut sprite_chunk = ChunkBuilder {
        chunk_type: CHUNK_SPRT,
        count: u32::try_from(project.sprites.len()).map_err(|_| "Too many sprites.".to_string())?,
        data: Vec::new(),
    };

    let sprite_defs_size = project.sprites.len() * 30;
    let mut sprite_frame_infos = Vec::new();
    let mut next_frame_info_offset =
        u32::try_from(sprite_defs_size).map_err(|_| "Sprite section is too large.".to_string())?;

    for sprite in &project.sprites {
        let sprite_id = *sprite_ids
            .get(&sprite.id)
            .ok_or_else(|| format!("Missing sprite id for '{}'.", sprite.name))?;
        let name_string_id = *string_ids
            .get(&sprite.name)
            .ok_or_else(|| format!("Missing string id for sprite '{}'.", sprite.name))?;

        push_u16(&mut sprite_chunk.data, sprite_id);
        push_u16(&mut sprite_chunk.data, name_string_id);
        push_u16(&mut sprite_chunk.data, sprite.width);
        push_u16(&mut sprite_chunk.data, sprite.height);
        push_u16(
            &mut sprite_chunk.data,
            u16::try_from(sprite.frames.len())
                .map_err(|_| "Too many frames in a sprite.".to_string())?,
        );
        push_i16(&mut sprite_chunk.data, sprite.origin_x);
        push_i16(&mut sprite_chunk.data, sprite.origin_y);
        push_u16(&mut sprite_chunk.data, sprite.bbox_left);
        push_u16(&mut sprite_chunk.data, sprite.bbox_top);
        push_u16(&mut sprite_chunk.data, sprite.bbox_right);
        push_u16(&mut sprite_chunk.data, sprite.bbox_bottom);
        push_u32(&mut sprite_chunk.data, next_frame_info_offset);
        push_u16(&mut sprite_chunk.data, SPRITE_FLAG_FORMAT_RGBA8888);
        push_u16(&mut sprite_chunk.data, sprite.frame_duration_ms);

        let frame_info_bytes = sprite
            .frames
            .len()
            .checked_mul(8)
            .ok_or_else(|| "Sprite frame table overflowed.".to_string())?;
        next_frame_info_offset = next_frame_info_offset
            .checked_add(
                u32::try_from(frame_info_bytes)
                    .map_err(|_| "Too many sprite frames.".to_string())?,
            )
            .ok_or_else(|| "Sprite frame offsets overflowed.".to_string())?;

        for frame in &sprite.frames {
            let image_offset = u32::try_from(image_data.len())
                .map_err(|_| "Image data is too large.".to_string())?;
            push_bytes(&mut image_data, &frame.pixels);
            push_u32(&mut sprite_frame_infos, image_offset);
            push_u32(
                &mut sprite_frame_infos,
                u32::try_from(frame.pixels.len())
                    .map_err(|_| "Sprite image is too large.".to_string())?,
            );
        }
    }

    push_bytes(&mut sprite_chunk.data, &sprite_frame_infos);

    let image_chunk = ChunkBuilder {
        chunk_type: CHUNK_IMAG,
        count: u32::try_from(project.sprites.len()).map_err(|_| "Too many images.".to_string())?,
        data: image_data,
    };

    let mut object_chunk = ChunkBuilder {
        chunk_type: CHUNK_OBJD,
        count: u32::try_from(project.objects.len()).map_err(|_| "Too many objects.".to_string())?,
        data: Vec::new(),
    };

    let object_defs_size = project.objects.len() * 18;
    let mut object_handler_data = Vec::new();
    let mut next_handler_offset =
        u32::try_from(object_defs_size).map_err(|_| "Object section is too large.".to_string())?;

    for object in &project.objects {
        let object_id = *object_ids
            .get(&object.id)
            .ok_or_else(|| format!("Missing object id for '{}'.", object.name))?;
        let name_string_id = *string_ids
            .get(&object.name)
            .ok_or_else(|| format!("Missing string id for object '{}'.", object.name))?;
        let default_sprite_id = if object.sprite_id.is_empty() {
            INVALID_ID16
        } else {
            *sprite_ids
                .get(&object.sprite_id)
                .ok_or_else(|| format!("Object '{}' refers to a missing sprite.", object.name))?
        };

        let parent_object_id = if object.parent_object_id.is_empty() {
            INVALID_ID16
        } else {
            *object_ids
                .get(&object.parent_object_id)
                .ok_or_else(|| format!("Object '{}' refers to a missing parent.", object.name))?
        };

        let collision_target_id = if object.collision_object_id.is_empty() {
            INVALID_ID16
        } else {
            *object_ids.get(&object.collision_object_id).ok_or_else(|| {
                format!(
                    "Object '{}' refers to a missing collision target.",
                    object.name
                )
            })?
        };

        let events = [
            (EVT_CREATE, 0u8, 0u16, object.create_script_id.as_str()),
            (EVT_STEP, 0u8, 0u16, object.step_script_id.as_str()),
            (EVT_DRAW, 0u8, 0u16, object.draw_script_id.as_str()),
            (EVT_DESTROY, 0u8, 0u16, object.destroy_script_id.as_str()),
            (
                EVT_COLLISION,
                0u8,
                collision_target_id,
                object.collision_script_id.as_str(),
            ),
        ];

        let mut handlers = Vec::<(u8, u8, u16, u16)>::new();
        for (event_type, arg0, arg1, script_ref) in events {
            if script_ref.is_empty() {
                continue;
            }
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Object '{}' refers to a missing script.", object.name))?;
            handlers.push((event_type, arg0, arg1, script_id));
        }

        if object.alarm_script_ids.len() > ALARM_EVENT_COUNT {
            return Err(format!(
                "Object '{}' has more than {} alarm handlers.",
                object.name, ALARM_EVENT_COUNT
            ));
        }
        for (alarm_index, script_ref) in object.alarm_script_ids.iter().enumerate() {
            if script_ref.is_empty() {
                continue;
            }
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Object '{}' refers to a missing script.", object.name))?;
            handlers.push((
                EVT_ALARM,
                u8::try_from(alarm_index).map_err(|_| {
                    format!("Object '{}' has too many alarm handlers.", object.name)
                })?,
                0,
                script_id,
            ));
        }

        for (field_name, event_type, entries) in [
            (
                "buttonPressedScriptIds",
                EVT_BUTTON_PRESSED,
                &object.button_pressed_script_ids,
            ),
            (
                "buttonDownScriptIds",
                EVT_BUTTON_DOWN,
                &object.button_down_script_ids,
            ),
            (
                "buttonReleasedScriptIds",
                EVT_BUTTON_RELEASED,
                &object.button_released_script_ids,
            ),
        ] {
            let mut sorted_entries = entries.iter().collect::<Vec<_>>();
            sorted_entries.sort_by(|left, right| left.0.cmp(right.0));
            for (button_name, script_ref) in sorted_entries {
                if script_ref.is_empty() {
                    continue;
                }
                let arg0 = button_event_arg0(button_name).ok_or_else(|| {
                    format!(
                        "Object '{}' uses an unsupported button key '{}' in {}.",
                        object.name, button_name, field_name
                    )
                })?;
                let script_id = *script_ids.get(script_ref).ok_or_else(|| {
                    format!("Object '{}' refers to a missing script.", object.name)
                })?;
                handlers.push((event_type, arg0, 0, script_id));
            }
        }

        push_u16(&mut object_chunk.data, object_id);
        push_u16(&mut object_chunk.data, name_string_id);
        push_u16(&mut object_chunk.data, default_sprite_id);
        push_u16(&mut object_chunk.data, parent_object_id);
        push_u16(
            &mut object_chunk.data,
            u16::try_from(handlers.len())
                .map_err(|_| "Too many object event handlers.".to_string())?,
        );
        push_u32(
            &mut object_chunk.data,
            if handlers.is_empty() {
                0
            } else {
                next_handler_offset
            },
        );
        push_u16(&mut object_chunk.data, 0);
        push_u16(&mut object_chunk.data, 0);

        for (event_type, arg0, arg1, script_id) in handlers {
            push_u8(&mut object_handler_data, event_type);
            push_u8(&mut object_handler_data, arg0);
            push_u16(&mut object_handler_data, arg1);
            push_u16(&mut object_handler_data, script_id);
            next_handler_offset = next_handler_offset
                .checked_add(6)
                .ok_or_else(|| "Object handler offsets overflowed.".to_string())?;
        }
    }

    push_bytes(&mut object_chunk.data, &object_handler_data);

    let mut room_chunk = ChunkBuilder {
        chunk_type: CHUNK_ROOM,
        count: u32::try_from(rooms.len()).map_err(|_| "Too many rooms.".to_string())?,
        data: Vec::new(),
    };
    let room_def_size = 28usize;
    let layer_def_size = 11usize;
    room_chunk.data.resize(
        rooms
            .len()
            .checked_mul(room_def_size)
            .ok_or_else(|| "Room table is too large.".to_string())?,
        0,
    );

    for (room_index, room) in rooms.iter().enumerate() {
        let room_offset = room_index * room_def_size;
        let room_id = u16::try_from(room_index + 1).map_err(|_| "Too many rooms.".to_string())?;
        let room_name_string_id = *string_ids
            .get(&room.name)
            .ok_or_else(|| format!("Missing string id for room '{}'.", room.name))?;

        let mut ordered_layers: Vec<(String, u8, i16, usize)> = Vec::new();
        for (index, layer) in room.background_layers.iter().enumerate() {
            ordered_layers.push((layer.id.clone(), LAYER_BACKGROUND, layer.depth, index));
        }
        for (index, layer) in room.tile_layers.iter().enumerate() {
            ordered_layers.push((layer.id.clone(), LAYER_TILES, layer.depth, index));
        }
        for (index, layer) in room.instance_layers.iter().enumerate() {
            ordered_layers.push((layer.id.clone(), LAYER_INSTANCES, layer.depth, index));
        }
        ordered_layers.sort_by_key(|entry| entry.2);

        let layer_offset = u32::try_from(room_chunk.data.len())
            .map_err(|_| "Room chunk is too large.".to_string())?;
        let layer_count = u16::try_from(ordered_layers.len())
            .map_err(|_| format!("Room '{}' has too many layers.", room.name))?;
        let layer_defs_start = room_chunk.data.len();
        room_chunk
            .data
            .resize(layer_defs_start + ordered_layers.len() * layer_def_size, 0);

        let mut layer_ids = HashMap::<String, u16>::new();
        for (layer_index, (layer_id, _, _, _)) in ordered_layers.iter().enumerate() {
            layer_ids.insert(
                layer_id.clone(),
                u16::try_from(layer_index + 1)
                    .map_err(|_| format!("Room '{}' has too many layers.", room.name))?,
            );
        }

        let placement_offset = u32::try_from(room_chunk.data.len())
            .map_err(|_| "Room chunk is too large.".to_string())?;
        let placement_count = u16::try_from(room.placements.len())
            .map_err(|_| format!("Room '{}' has too many placements.", room.name))?;
        let default_instance_layer_id = room
            .instance_layers
            .first()
            .and_then(|layer| layer_ids.get(&layer.id))
            .copied()
            .unwrap_or(1);

        for placement in &room.placements {
            let object_id = *object_ids.get(&placement.object_id).ok_or_else(|| {
                format!(
                    "A room placement in '{}' refers to an object that no longer exists.",
                    room.name
                )
            })?;
            let layer_id = if placement.layer_id.is_empty() {
                default_instance_layer_id
            } else {
                *layer_ids.get(&placement.layer_id).ok_or_else(|| {
                    format!(
                        "A room placement in '{}' refers to a missing layer.",
                        room.name
                    )
                })?
            };
            push_u16(&mut room_chunk.data, object_id);
            push_i16(&mut room_chunk.data, placement.x);
            push_i16(&mut room_chunk.data, placement.y);
            push_u16(&mut room_chunk.data, layer_id);
        }

        for (layer_index, (layer_id, layer_type, depth, source_index)) in
            ordered_layers.iter().enumerate()
        {
            let base = layer_defs_start + layer_index * layer_def_size;
            let resolved_layer_id = *layer_ids
                .get(layer_id)
                .ok_or_else(|| format!("Missing room layer id for '{}'.", layer_id))?;

            let payload_offset = u32::try_from(room_chunk.data.len())
                .map_err(|_| "Room chunk is too large.".to_string())?;
            let mut flags = 0u16;

            match *layer_type {
                LAYER_BACKGROUND => {
                    let layer = &room.background_layers[*source_index];
                    let sprite_id = if layer.sprite_id.is_empty() {
                        INVALID_ID16
                    } else {
                        *sprite_ids.get(&layer.sprite_id).ok_or_else(|| {
                            format!(
                                "Background layer '{}' in room '{}' refers to a missing sprite.",
                                layer.name, room.name
                            )
                        })?
                    };
                    if layer.repeat {
                        flags |= BACKGROUND_FLAG_REPEAT_SPRITE;
                    }
                    push_u16(&mut room_chunk.data, sprite_id);
                    push_u16(&mut room_chunk.data, parse_hex_color_565(&layer.color));
                    push_u16(&mut room_chunk.data, parallax_to_fixed(layer.parallax_x));
                    push_u16(&mut room_chunk.data, parallax_to_fixed(layer.parallax_y));
                }
                LAYER_TILES => {
                    let layer = &room.tile_layers[*source_index];
                    let sprite_id = *sprite_ids.get(&layer.tileset_sprite_id).ok_or_else(|| {
                        format!(
                            "Tile layer '{}' in room '{}' refers to a missing tileset sprite.",
                            layer.name, room.name
                        )
                    })?;

                    let tile_data_offset = u32::try_from(room_chunk.data.len() + 18)
                        .map_err(|_| "Room chunk is too large.".to_string())?;
                    let collision_data_offset = if layer.collisions.iter().any(|value| *value) {
                        flags |= TILE_LAYER_FLAG_HAS_COLLISION;
                        let data_bytes = layer
                            .tiles
                            .len()
                            .checked_mul(2)
                            .ok_or_else(|| "Tile data is too large.".to_string())?;
                        u32::try_from(room_chunk.data.len() + 18 + data_bytes)
                            .map_err(|_| "Room chunk is too large.".to_string())?
                    } else {
                        0
                    };

                    push_u16(&mut room_chunk.data, sprite_id);
                    push_u16(&mut room_chunk.data, layer.tile_width);
                    push_u16(&mut room_chunk.data, layer.tile_height);
                    push_u16(&mut room_chunk.data, layer.columns);
                    push_u16(&mut room_chunk.data, layer.rows);
                    push_u32(&mut room_chunk.data, tile_data_offset);
                    push_u32(&mut room_chunk.data, collision_data_offset);

                    for tile in &layer.tiles {
                        let frame = if *tile < 0 {
                            INVALID_ID16
                        } else {
                            u16::try_from(*tile).map_err(|_| {
                                format!(
                                    "Tile layer '{}' in room '{}' has an out-of-range tile index.",
                                    layer.name, room.name
                                )
                            })?
                        };
                        push_u16(&mut room_chunk.data, frame);
                    }

                    if (flags & TILE_LAYER_FLAG_HAS_COLLISION) != 0 {
                        for collision in &layer.collisions {
                            push_u8(&mut room_chunk.data, if *collision { 1 } else { 0 });
                        }
                    }
                }
                LAYER_INSTANCES => {}
                _ => {}
            }

            write_u16_at(&mut room_chunk.data, base, resolved_layer_id);
            room_chunk.data[base + 2] = *layer_type;
            write_i16_at(&mut room_chunk.data, base + 3, *depth);
            write_u32_at(&mut room_chunk.data, base + 5, payload_offset);
            write_u16_at(&mut room_chunk.data, base + 9, flags);
        }

        let camera_follow_object_id = if room.camera_follow_object_id.is_empty() {
            INVALID_ID16
        } else {
            *object_ids
                .get(&room.camera_follow_object_id)
                .ok_or_else(|| {
                    format!(
                        "Room '{}' refers to a missing camera follow object.",
                        room.name
                    )
                })?
        };

        write_u16_at(&mut room_chunk.data, room_offset, room_id);
        write_u16_at(&mut room_chunk.data, room_offset + 2, room_name_string_id);
        write_u16_at(&mut room_chunk.data, room_offset + 4, room.width);
        write_u16_at(&mut room_chunk.data, room_offset + 6, room.height);
        write_u16_at(&mut room_chunk.data, room_offset + 8, layer_count);
        write_u16_at(&mut room_chunk.data, room_offset + 10, placement_count);
        write_u32_at(&mut room_chunk.data, room_offset + 12, layer_offset);
        write_u32_at(&mut room_chunk.data, room_offset + 16, placement_offset);
        write_u16_at(
            &mut room_chunk.data,
            room_offset + 20,
            room.camera_x.min(room.width.saturating_sub(320)),
        );
        write_u16_at(
            &mut room_chunk.data,
            room_offset + 22,
            room.camera_y.min(room.height.saturating_sub(240)),
        );
        write_u16_at(
            &mut room_chunk.data,
            room_offset + 24,
            camera_follow_object_id,
        );
        write_u16_at(&mut room_chunk.data, room_offset + 26, 0);
    }

    let mut room_event_entries = Vec::<(u16, Vec<(u8, u16)>)>::new();
    for (room_index, room) in rooms.iter().enumerate() {
        let room_id = u16::try_from(room_index + 1).map_err(|_| "Too many rooms.".to_string())?;
        let mut handlers = Vec::<(u8, u16)>::new();
        for script_ref in merged_script_refs(&room.create_script_ids, &room.create_script_id) {
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Room '{}' refers to a missing script.", room.name))?;
            handlers.push((EVT_CREATE, script_id));
        }
        for script_ref in merged_script_refs(&room.step_script_ids, &room.step_script_id) {
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Room '{}' refers to a missing script.", room.name))?;
            handlers.push((EVT_STEP, script_id));
        }
        for script_ref in merged_script_refs(&room.draw_script_ids, &room.draw_script_id) {
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Room '{}' refers to a missing script.", room.name))?;
            handlers.push((EVT_DRAW, script_id));
        }
        for script_ref in merged_script_refs(&room.destroy_script_ids, &room.destroy_script_id) {
            let script_id = *script_ids
                .get(script_ref)
                .ok_or_else(|| format!("Room '{}' refers to a missing script.", room.name))?;
            handlers.push((EVT_DESTROY, script_id));
        }

        if handlers.is_empty() {
            continue;
        }
        room_event_entries.push((room_id, handlers));
    }

    let mut game_handlers = Vec::new();
    for script_ref in merged_script_refs(
        &project.game_create_script_ids,
        &project.game_create_script_id,
    ) {
        let script_id = *script_ids
            .get(script_ref)
            .ok_or_else(|| format!("Game event refers to a missing script id '{}'.", script_ref))?;
        push_u8(&mut game_handlers, EVT_CREATE);
        push_u8(&mut game_handlers, 0);
        push_u16(&mut game_handlers, 0);
        push_u16(&mut game_handlers, script_id);
    }
    for script_ref in
        merged_script_refs(&project.game_step_script_ids, &project.game_step_script_id)
    {
        let script_id = *script_ids
            .get(script_ref)
            .ok_or_else(|| format!("Game event refers to a missing script id '{}'.", script_ref))?;
        push_u8(&mut game_handlers, EVT_STEP);
        push_u8(&mut game_handlers, 0);
        push_u16(&mut game_handlers, 0);
        push_u16(&mut game_handlers, script_id);
    }
    for script_ref in
        merged_script_refs(&project.game_draw_script_ids, &project.game_draw_script_id)
    {
        let script_id = *script_ids
            .get(script_ref)
            .ok_or_else(|| format!("Game event refers to a missing script id '{}'.", script_ref))?;
        push_u8(&mut game_handlers, EVT_DRAW);
        push_u8(&mut game_handlers, 0);
        push_u16(&mut game_handlers, 0);
        push_u16(&mut game_handlers, script_id);
    }
    for script_ref in merged_script_refs(
        &project.game_destroy_script_ids,
        &project.game_destroy_script_id,
    ) {
        let script_id = *script_ids
            .get(script_ref)
            .ok_or_else(|| format!("Game event refers to a missing script id '{}'.", script_ref))?;
        push_u8(&mut game_handlers, EVT_DESTROY);
        push_u8(&mut game_handlers, 0);
        push_u16(&mut game_handlers, 0);
        push_u16(&mut game_handlers, script_id);
    }

    let room_entry_count = u16::try_from(room_event_entries.len())
        .map_err(|_| "Too many room metadata entries.".to_string())?;
    let room_entries_bytes = u32::from(room_entry_count)
        .checked_mul(8)
        .ok_or_else(|| "Room metadata table is too large.".to_string())?;
    let mut next_room_handler_offset = 20u32
        .checked_add(room_entries_bytes)
        .ok_or_else(|| "Room metadata offsets overflowed.".to_string())?;
    let mut meta_room_entries = Vec::new();
    let mut meta_room_handlers = Vec::new();
    for (room_id, handlers) in room_event_entries {
        push_u16(&mut meta_room_entries, room_id);
        push_u16(
            &mut meta_room_entries,
            u16::try_from(handlers.len())
                .map_err(|_| "Too many room event handlers.".to_string())?,
        );
        push_u32(&mut meta_room_entries, next_room_handler_offset);

        for (event_type, script_id) in handlers {
            push_u8(&mut meta_room_handlers, event_type);
            push_u8(&mut meta_room_handlers, 0);
            push_u16(&mut meta_room_handlers, 0);
            push_u16(&mut meta_room_handlers, script_id);
            next_room_handler_offset = next_room_handler_offset
                .checked_add(6)
                .ok_or_else(|| "Room metadata offsets overflowed.".to_string())?;
        }
    }

    let game_handler_count = u16::try_from(game_handlers.len() / 6)
        .map_err(|_| "Too many game event handlers.".to_string())?;

    let mut config_entries = Vec::new();
    for entry in &project.config {
        let name_string_id = *string_ids.get(&entry.name).ok_or_else(|| {
            format!(
                "Missing string id for environment variable '{}'.",
                entry.name
            )
        })?;
        let value_string_id = *string_ids.get(&entry.value).ok_or_else(|| {
            format!(
                "Missing string id for environment variable value '{}'.",
                entry.name
            )
        })?;
        let value_type = match entry.value_type.as_str() {
            "string" => CONFIG_VALUE_STRING,
            "number" => CONFIG_VALUE_NUMBER,
            "boolean" => CONFIG_VALUE_BOOLEAN,
            _ => {
                return Err(format!(
                    "Project environment variable '{}' uses an unsupported type.",
                    entry.name
                ))
            }
        };
        push_u16(&mut config_entries, name_string_id);
        push_u16(&mut config_entries, value_string_id);
        push_u8(&mut config_entries, value_type);
        push_u8(&mut config_entries, 0);
        push_u16(&mut config_entries, 0);
    }

    let project_name_string_id = *string_ids
        .get(&project.name)
        .ok_or_else(|| format!("Missing string id for project '{}'.", project.name))?;

    let mut meta_chunk = ChunkBuilder {
        chunk_type: CHUNK_META,
        count: 1,
        data: Vec::new(),
    };
    push_u16(&mut meta_chunk.data, room_entry_count);
    push_u16(&mut meta_chunk.data, game_handler_count);
    push_u32(&mut meta_chunk.data, 20);
    let room_handlers_offset = 20u32
        .checked_add(
            u32::try_from(meta_room_entries.len())
                .map_err(|_| "Room metadata section is too large.".to_string())?,
        )
        .ok_or_else(|| "Metadata offsets overflowed.".to_string())?;
    let game_handlers_offset = room_handlers_offset
        .checked_add(
            u32::try_from(meta_room_handlers.len())
                .map_err(|_| "Room handler metadata is too large.".to_string())?,
        )
        .ok_or_else(|| "Metadata offsets overflowed.".to_string())?;
    push_u32(&mut meta_chunk.data, game_handlers_offset);
    push_u16(
        &mut meta_chunk.data,
        u16::try_from(project.config.len())
            .map_err(|_| "Too many project environment variable.".to_string())?,
    );
    push_u16(
        &mut meta_chunk.data,
        project_name_string_id
            .checked_add(1)
            .ok_or_else(|| "Project name string id overflowed.".to_string())?,
    );
    let config_offset = game_handlers_offset
        .checked_add(
            u32::try_from(game_handlers.len())
                .map_err(|_| "Game handler metadata is too large.".to_string())?,
        )
        .ok_or_else(|| "Metadata offsets overflowed.".to_string())?;
    push_u32(&mut meta_chunk.data, config_offset);
    push_bytes(&mut meta_chunk.data, &meta_room_entries);
    push_bytes(&mut meta_chunk.data, &meta_room_handlers);
    push_bytes(&mut meta_chunk.data, &game_handlers);
    push_bytes(&mut meta_chunk.data, &config_entries);

    let mut script_chunk = ChunkBuilder {
        chunk_type: CHUNK_SCRP,
        count: u32::try_from(project.scripts.len()).map_err(|_| "Too many scripts.".to_string())?,
        data: Vec::new(),
    };

    let script_entry_size = 16usize;
    let entries_size = project.scripts.len() * script_entry_size;
    let mut bytecode_offset =
        u32::try_from(entries_size).map_err(|_| "Script table is too large.".to_string())?;
    let mut script_bytes = Vec::new();

    for script in &project.scripts {
        let script_id = *script_ids
            .get(&script.id)
            .ok_or_else(|| format!("Missing script id for '{}'.", script.name))?;
        let name_string_id = *string_ids
            .get(&script.name)
            .ok_or_else(|| format!("Missing string id for script '{}'.", script.name))?;
        let bytes = script.code.as_bytes();
        let byte_count = u32::try_from(bytes.len())
            .map_err(|_| format!("Script '{}' is too large.", script.name))?;

        push_u16(&mut script_chunk.data, script_id);
        push_u16(&mut script_chunk.data, name_string_id);
        push_u32(&mut script_chunk.data, bytecode_offset);
        push_u32(&mut script_chunk.data, byte_count);
        push_u16(&mut script_chunk.data, 0);
        push_u16(&mut script_chunk.data, 0);

        push_bytes(&mut script_bytes, bytes);
        bytecode_offset = bytecode_offset
            .checked_add(byte_count)
            .ok_or_else(|| "Script bytecode offsets overflowed.".to_string())?;
    }

    push_bytes(&mut script_chunk.data, &script_bytes);

    let chunks = vec![
        string_chunk,
        image_chunk,
        sprite_chunk,
        object_chunk,
        room_chunk,
        meta_chunk,
        script_chunk,
    ];

    let header_size = 28u32;
    let directory_entry_size = 16u32;
    let directory_size = directory_entry_size
        * u32::try_from(chunks.len()).map_err(|_| "Too many chunks.".to_string())?;

    let mut offset = header_size + directory_size;
    let mut directory = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        let size =
            u32::try_from(chunk.data.len()).map_err(|_| "Chunk is too large.".to_string())?;
        directory.push(ChunkDirEntry {
            chunk_type: chunk.chunk_type,
            offset,
            size,
            count: chunk.count,
        });
        offset = offset
            .checked_add(size)
            .ok_or_else(|| "Pack size overflowed.".to_string())?;
    }

    let total_size = offset;
    let mut file = Vec::with_capacity(
        usize::try_from(total_size).map_err(|_| "Pack is too large.".to_string())?,
    );
    push_u32(&mut file, PACK_MAGIC);
    push_u16(&mut file, PACK_VERSION_MAJOR);
    push_u16(&mut file, PACK_VERSION_MINOR);
    push_u32(&mut file, total_size);
    push_u32(&mut file, header_size);
    push_u32(
        &mut file,
        u32::try_from(directory.len()).map_err(|_| "Too many directory entries.".to_string())?,
    );
    push_u32(&mut file, 0);
    push_u32(&mut file, 0);

    for entry in &directory {
        push_u32(&mut file, entry.chunk_type);
        push_u32(&mut file, entry.offset);
        push_u32(&mut file, entry.size);
        push_u32(&mut file, entry.count);
    }

    for chunk in &chunks {
        push_bytes(&mut file, &chunk.data);
    }

    Ok(file)
}

fn write_pack(path: &str, project: &StudioProject) -> Result<(), String> {
    let pack = build_pack(project)?;
    ensure_parent_dir(path)?;
    fs::write(path, pack).map_err(|error| error.to_string())
}

fn serialize_project_json(project: &StudioProject) -> Result<Vec<u8>, String> {
    serde_json::to_vec(project).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_project(path: String, project: StudioProject) -> Result<(), String> {
    ensure_parent_dir(&path)?;
    let payload = serialize_project_json(&project)?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_project(path: String) -> Result<StudioProject, String> {
    let payload = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_lua_api_markdown() -> Result<String, String> {
    lua_ls::read_api_doc_markdown()
}

#[tauri::command]
fn load_runtime_markdown_doc(doc_name: String) -> Result<String, String> {
    lua_ls::read_runtime_doc_markdown(&doc_name)
}

#[tauri::command]
fn export_pack(path: String, project: StudioProject) -> Result<(), String> {
    write_pack(&path, &project)
}

#[tauri::command]
fn guess_runtime_root() -> String {
    guess_runtime_root_path()
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn inspect_export_support(runtime_root: String) -> ExportSupportResult {
    let runtime_workspace_ready = runtime_repo_available(&runtime_root);
    let runtime_workspace_message = if runtime_workspace_ready {
        "Runtime workspace found. It is optional now, but still useful for local runtime development.".to_string()
    } else {
        "Runtime workspace is optional. Simulator and export artifacts are downloaded through the server proxy.".to_string()
    };
    let embedded = status_from_missing(
        embedded_export_missing_tools(&runtime_root),
        "Uploads the current pack to the servers so they can compile a device .nwa for you.",
    );
    let flash = status_from_missing(
        flash_missing_tools(&runtime_root),
        "Downloads the latest device .nwa from the servers, then flashes it with your local nwlink install.",
    );
    let simulator = status_from_missing(
        simulator_missing_tools(&runtime_root),
        "Downloads the latest host runtime archive and matching simulator archive from the servers, then launches them with your current pack.",
    );

    ExportSupportResult {
        runtime_root,
        runtime_workspace_ready,
        runtime_workspace_message,
        backend_base_url: nwge_api_base_url(),
        pack: ExportTargetStatus {
            ready: true,
            missing: Vec::new(),
            note: "Writes the current project pack only.".to_string(),
        },
        embedded,
        flash,
        simulator,
    }
}

fn export_with_embedded_pack_blocking(
    app: AppHandle,
    output_path: String,
    project: StudioProject,
    icon_png_bytes: Option<Vec<u8>>,
) -> Result<EmbeddedExportResult, String> {
    let run_id = output_run_id("embedded");
    ensure_parent_dir(&output_path)?;
    let pack_bytes = build_pack(&project)?;
    let client = reqwest::blocking::Client::new();
    let mut form = reqwest::blocking::multipart::Form::new()
        .text("appName", project.name.trim().to_string())
        .text(
            "outputFileName",
            Path::new(&output_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("nwge.nwa")
                .to_string(),
        )
        .part(
            "pack",
            reqwest::blocking::multipart::Part::bytes(pack_bytes)
                .file_name("project.pack")
                .mime_str("application/octet-stream")
                .map_err(|error| error.to_string())?,
        );

    if let Some(bytes) = icon_png_bytes {
        if !bytes.is_empty() {
            emit_preview_output(
                &app,
                &run_id,
                "status",
                "Prepared calculator icon from the selected project sprite.",
            );
            form = form.part(
                "icon",
                reqwest::blocking::multipart::Part::bytes(bytes)
                    .file_name("icon.png")
                    .mime_str("image/png")
                    .map_err(|error| error.to_string())?,
            );
        }
    }

    emit_preview_output(
        &app,
        &run_id,
        "status",
        "Uploading the project pack to our servers for cloud compilation.",
    );

    let response = client
        .post(nwge_api_url("/api/build/embedded/stream"))
        .multipart(form)
        .send()
        .map_err(|error| {
            format!(
                "Failed to reach the servers at '{}': {error}",
                nwge_api_base_url()
            )
        })?;
    if !response.status().is_success() {
        let error = http_error_message(response);
        emit_preview_output(&app, &run_id, "stderr", &error);
        return Err(error);
    }

    let mut reader = BufReader::new(response);
    let mut line = String::new();
    let mut download_path: Option<String> = None;
    let mut file_name: Option<String> = None;
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let event: EmbeddedBuildStreamEvent =
            serde_json::from_str(trimmed).map_err(|error| error.to_string())?;
        match event {
            EmbeddedBuildStreamEvent::Log { stream, message } => {
                emit_preview_output(&app, &run_id, &stream, message);
            }
            EmbeddedBuildStreamEvent::Error { message } => {
                emit_preview_output(&app, &run_id, "stderr", &message);
                return Err(message);
            }
            EmbeddedBuildStreamEvent::Result {
                download_path: path,
                file_name: streamed_file_name,
            } => {
                download_path = Some(path);
                file_name = streamed_file_name;
            }
        }
    }

    let download_path = download_path
        .ok_or_else(|| "The server finished without returning a build result.".to_string())?;
    let download_url = if let Some(name) = file_name {
        let encoded = reqwest::Url::parse_with_params(
            &nwge_api_url(&download_path),
            &[("fileName", name.as_str())],
        )
        .map_err(|error| error.to_string())?;
        encoded.to_string()
    } else {
        nwge_api_url(&download_path)
    };
    emit_preview_output(&app, &run_id, "status", "Downloading compiled .nwa.");
    let response = client.get(download_url).send().map_err(|error| {
        format!("Failed to download the compiled .nwa from the server: {error}")
    })?;
    if !response.status().is_success() {
        let error = http_error_message(response);
        emit_preview_output(&app, &run_id, "stderr", &error);
        return Err(error);
    }

    let nwa_bytes = response.bytes().map_err(|error| error.to_string())?;
    fs::write(&output_path, &nwa_bytes).map_err(|error| error.to_string())?;
    emit_preview_output(
        &app,
        &run_id,
        "status",
        format!("Downloaded compiled .nwa to '{output_path}'."),
    );

    Ok(EmbeddedExportResult { output_path })
}

#[tauri::command]
async fn export_with_embedded_pack(
    app: AppHandle,
    output_path: String,
    project: StudioProject,
    icon_png_bytes: Option<Vec<u8>>,
) -> Result<EmbeddedExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_with_embedded_pack_blocking(app, output_path, project, icon_png_bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn flash_to_calculator_blocking(app: AppHandle, project: StudioProject) -> Result<(), String> {
    ensure_tools_available(
        flash_missing_tools(&project.runtime_root),
        "Flashing to the calculator",
    )?;
    let run_id = output_run_id("flash");
    let pack_path_string = output_pack_path_string("studio-device-flash");
    write_pack(&pack_path_string, &project)?;
    let nwa_path = download_latest_artifact(
        &app,
        &run_id,
        runtime_device_artifact_name(),
        runtime_device_bundle_name(),
    )?;

    let mut command = Command::new("npx");
    command
        .arg("--yes")
        .arg("--")
        .arg("nwlink@0.0.19")
        .arg("install-nwa")
        .arg("--external-data")
        .arg(&pack_path_string)
        .arg(
            nwa_path
                .to_str()
                .ok_or_else(|| "Downloaded .nwa path is not valid UTF-8.".to_string())?,
        );

    run_command_with_streaming_output(&app, &run_id, "Flashing the calculator.", &mut command)
}

#[tauri::command]
async fn flash_to_calculator(app: AppHandle, project: StudioProject) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || flash_to_calculator_blocking(app, project))
        .await
        .map_err(|error| error.to_string())?
}

fn run_simulator_blocking(
    app: AppHandle,
    project: StudioProject,
) -> Result<PreviewLaunchResult, String> {
    ensure_tools_available(
        simulator_missing_tools(&project.runtime_root),
        "Running the simulator",
    )?;
    let pack_path = preview_pack_path();
    let pack_path_string = pack_path.display().to_string();
    write_pack(&pack_path_string, &project)?;
    let run_id = preview_run_id();
    let runtime_artifact =
        download_latest_artifact_archive(&app, &run_id, runtime_host_artifact_name(), None)?;
    let artifact_run_id = runtime_artifact.artifact_run_id.ok_or_else(|| {
        "The server did not report which workflow run produced the simulator runtime. Update nwge-api before launching previews.".to_string()
    })?;
    let simulator_artifact = download_latest_artifact_archive(
        &app,
        &run_id,
        runtime_simulator_artifact_name(),
        Some(&artifact_run_id),
    )?;
    let runtime_root = runtime_artifact.output_dir;
    let simulator_root = simulator_artifact.output_dir;
    let simulator_template = runtime_simulator_path(Path::new("runtime-artifact"));
    let simulator_file_name = simulator_template
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Simulator bundle name is not valid UTF-8.".to_string())?;
    let simulator_path =
        find_file_recursive(&simulator_root, simulator_file_name)?.ok_or_else(|| {
            format!(
                "The simulator archive did not contain '{}'.",
                simulator_file_name
            )
        })?;
    let nwb_path =
        find_file_recursive(&runtime_root, runtime_host_bundle_name())?.ok_or_else(|| {
            format!(
                "The runtime archive did not contain '{}'.",
                runtime_host_bundle_name()
            )
        })?;
    let command_path = preview_command_path(&run_id);
    let command_path_string = command_path.display().to_string();
    ensure_parent_dir(&command_path_string)?;
    fs::write(&command_path, b"").map_err(|error| error.to_string())?;

    let mut command = Command::new(&simulator_path);
    command
        .arg("--nwb")
        .arg(
            nwb_path
                .to_str()
                .ok_or_else(|| "Downloaded .nwb path is not valid UTF-8.".to_string())?,
        )
        .arg("--nwb-external-data")
        .arg(&pack_path_string)
        .env("NWGE_PREVIEW_COMMAND_PATH", &command_path)
        .env("NWGE_PREVIEW_RUN_ID", &run_id)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    {
        let preview_session = app.state::<PreviewSessionState>();
        let mut active = preview_session
            .active
            .lock()
            .map_err(|_| "Preview session lock was poisoned.".to_string())?;
        *active = Some(ActivePreviewSession {
            run_id: run_id.clone(),
            command_path: command_path.clone(),
        });
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Preview stdout was unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Preview stderr was unavailable.".to_string())?;

    emit_preview_output(&app, &run_id, "status", "Launching the simulator.");

    spawn_preview_stream_thread(app.clone(), run_id.clone(), "stdout", stdout);
    spawn_preview_stream_thread(app.clone(), run_id.clone(), "stderr", stderr);

    let wait_run_id = run_id.clone();
    std::thread::spawn(move || match child.wait() {
        Ok(status) if status.success() => {
            emit_preview_output(
                &app,
                &wait_run_id,
                "status",
                "Simulator process exited successfully.",
            );
        }
        Ok(status) => {
            let code = status
                .code()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "terminated by signal".to_string());
            emit_preview_output(
                &app,
                &wait_run_id,
                "status",
                format!("Simulator process exited with code {code}."),
            );
        }
        Err(error) => {
            emit_preview_output(
                &app,
                &wait_run_id,
                "stderr",
                format!("Failed while waiting for simulator process: {error}"),
            );
        }
    });

    Ok(PreviewLaunchResult {
        pack_path: pack_path_string,
        run_id,
    })
}

#[tauri::command]
async fn run_simulator(
    app: AppHandle,
    project: StudioProject,
) -> Result<PreviewLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_simulator_blocking(app, project))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn execute_preview_lua(
    preview_session: State<PreviewSessionState>,
    run_id: String,
    command: String,
) -> Result<(), String> {
    let session = preview_session
        .active
        .lock()
        .map_err(|_| "Preview session lock was poisoned.".to_string())?;
    let active = session
        .as_ref()
        .ok_or_else(|| "No active preview session is registered.".to_string())?;

    if active.run_id != run_id {
        return Err(
            "The active preview session changed. Launch preview again and retry.".to_string(),
        );
    }

    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Preview Lua command cannot be empty.".to_string());
    }

    let command_path = &active.command_path;
    let temp_path = command_path.with_extension("tmp");
    fs::write(&temp_path, trimmed).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, command_path).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PreviewSessionState::default())
        .manage(lua_ls::LuaLsState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            load_lua_api_markdown,
            load_runtime_markdown_doc,
            guess_runtime_root,
            inspect_export_support,
            export_pack,
            export_with_embedded_pack,
            flash_to_calculator,
            run_simulator,
            execute_preview_lua,
            lua_ls::lua_ls_sync_workspace,
            lua_ls::lua_ls_update_document,
            lua_ls::lua_ls_completion,
            lua_ls::lua_ls_hover,
            lua_ls::lua_ls_definition,
            lua_ls::lua_ls_get_diagnostics,
            lua_ls::lua_ls_shutdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_u16(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
    }

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ])
    }

    fn find_chunk<'a>(pack: &'a [u8], chunk_type: u32) -> &'a [u8] {
        let dir_offset = read_u32(pack, 12) as usize;
        let dir_count = read_u32(pack, 16) as usize;
        for index in 0..dir_count {
            let entry_offset = dir_offset + index * 16;
            if read_u32(pack, entry_offset) != chunk_type {
                continue;
            }
            let chunk_offset = read_u32(pack, entry_offset + 4) as usize;
            let chunk_size = read_u32(pack, entry_offset + 8) as usize;
            return &pack[chunk_offset..chunk_offset + chunk_size];
        }
        panic!("chunk not found");
    }

    fn test_project() -> StudioProject {
        StudioProject {
            name: "Test".to_string(),
            theme_mode: "light".to_string(),
            pack_path: String::new(),
            project_path: String::new(),
            runtime_root: String::new(),
            icon_sprite_id: String::new(),
            rooms: vec![RoomAsset {
                id: "room-1".to_string(),
                name: "room_start".to_string(),
                width: 320,
                height: 240,
                camera_x: 0,
                camera_y: 0,
                camera_follow_object_id: String::new(),
                create_script_ids: vec!["room-create".to_string()],
                step_script_ids: Vec::new(),
                draw_script_ids: Vec::new(),
                destroy_script_ids: Vec::new(),
                create_script_id: "room-create".to_string(),
                step_script_id: String::new(),
                draw_script_id: String::new(),
                destroy_script_id: String::new(),
                background_layers: vec![default_background_layer()],
                tile_layers: Vec::new(),
                instance_layers: vec![default_instance_layer()],
                placements: Vec::new(),
            }],
            room_name: String::new(),
            room_width: 0,
            room_height: 0,
            camera_x: 0,
            camera_y: 0,
            sprites: Vec::new(),
            scripts: vec![
                ScriptAsset {
                    id: "room-create".to_string(),
                    name: "room_create".to_string(),
                    code: "-- room".to_string(),
                },
                ScriptAsset {
                    id: "game-create".to_string(),
                    name: "game_create".to_string(),
                    code: "-- game".to_string(),
                },
            ],
            config: Vec::new(),
            game_create_script_ids: vec!["game-create".to_string()],
            game_step_script_ids: Vec::new(),
            game_draw_script_ids: Vec::new(),
            game_destroy_script_ids: Vec::new(),
            game_create_script_id: "game-create".to_string(),
            game_step_script_id: String::new(),
            game_draw_script_id: String::new(),
            game_destroy_script_id: String::new(),
            objects: Vec::new(),
            placements: Vec::new(),
        }
    }

    #[test]
    fn game_handlers_follow_room_metadata_in_meta_chunk() {
        let pack = build_pack(&test_project()).expect("pack should build");
        let meta = find_chunk(&pack, CHUNK_META);
        assert_eq!(read_u16(meta, 0), 1);
        assert_eq!(read_u16(meta, 2), 1);
        assert_eq!(read_u32(meta, 4), 20);
        assert_eq!(read_u32(meta, 8), 34);
        assert_eq!(read_u16(meta, 12), 0);
        assert_eq!(read_u16(meta, 14), 1);

        let room_handler_offset = 28usize;
        assert_eq!(meta[room_handler_offset], EVT_CREATE);
        assert_eq!(read_u16(meta, room_handler_offset + 4), 1);

        let game_handler_offset = read_u32(meta, 8) as usize;
        assert_eq!(meta[game_handler_offset], EVT_CREATE);
        assert_eq!(read_u16(meta, game_handler_offset + 4), 2);
    }

    #[test]
    fn meta_chunk_stores_project_name_string_id() {
        let pack = build_pack(&test_project()).expect("pack should build");
        let meta = find_chunk(&pack, CHUNK_META);
        let strs = find_chunk(&pack, CHUNK_STRS);

        let encoded_project_name_id = read_u16(meta, 14);
        assert_ne!(encoded_project_name_id, 0);
        let project_name_string_id = usize::from(encoded_project_name_id - 1);
        let string_count = read_u32(strs, 0) as usize;
        assert!(project_name_string_id < string_count);

        let offsets_base = 4usize;
        let string_offset = read_u32(strs, offsets_base + project_name_string_id * 4) as usize;
        let end = strs[string_offset..]
            .iter()
            .position(|byte| *byte == 0)
            .expect("string should be null-terminated");
        let value = std::str::from_utf8(&strs[string_offset..string_offset + end])
            .expect("project name should be utf-8");
        assert_eq!(value, "Test");
    }

    #[test]
    fn project_json_serialization_is_minified() {
        let payload =
            serialize_project_json(&test_project()).expect("project json should serialize");
        let json = String::from_utf8(payload).expect("project json should be utf-8");

        assert!(!json.contains('\n'));
        assert!(!json.contains('\t'));
        assert!(json.starts_with('{'));
    }
}
