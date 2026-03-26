use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(test)]
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

const DIAGNOSTICS_EVENT: &str = "lua-ls-diagnostics";
const LSP_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaWorkspaceScript {
    pub id: String,
    pub name: String,
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaWorkspaceInput {
    pub project_name: String,
    pub project_path: String,
    pub scripts: Vec<LuaWorkspaceScript>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaDocumentInput {
    pub uri: String,
    pub text: String,
    pub version: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaPositionInput {
    pub uri: String,
    pub text: String,
    pub version: i32,
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaWorkspaceResponse {
    pub root_uri: String,
    pub script_uris: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaLspLocation {
    pub uri: String,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[derive(Default)]
pub struct LuaLsState {
    client: Mutex<Option<LuaLsClient>>,
}

struct LuaLsClient {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: i64,
    workspace_dir: PathBuf,
    root_uri: String,
    script_uris: HashMap<String, String>,
    opened_documents: HashMap<String, i32>,
    diagnostics: Arc<Mutex<HashMap<String, Value>>>,
    pending: Arc<Mutex<HashMap<i64, Sender<Result<Value, String>>>>>,
}

struct LuaLsRuntimePaths {
    log_dir: PathBuf,
    meta_dir: PathBuf,
    api_dir: PathBuf,
}

#[cfg(test)]
#[derive(Debug, Default)]
struct LuaApiSpec {
    aliases: Vec<LuaApiAlias>,
    classes: Vec<LuaApiClass>,
    globals: Vec<LuaApiGlobal>,
    functions: Vec<LuaApiFunction>,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiAlias {
    name: String,
    value: String,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiClass {
    name: String,
    fields: Vec<LuaApiField>,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiField {
    name: String,
    field_type: String,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiGlobal {
    name: String,
    global_type: String,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiFunction {
    name: String,
    params: Vec<LuaApiParam>,
    returns: Vec<String>,
}

#[cfg(test)]
#[derive(Debug)]
struct LuaApiParam {
    name: String,
    param_type: String,
    optional: bool,
}

fn lua_ls_settings(api_library_path: &Path) -> Value {
    json!({
        "completion": {
            "callSnippet": "Both"
        },
        "diagnostics": {
            "globals": [
                "input",
                "input.down",
                "input.pressed",
                "input.released",
                "draw",
                "draw.sprite",
                "draw.text",
                "room",
                "room.goto_room",
                "room.current",
                "instance",
                "instance.create",
                "instance.destroy",
                "instance.find",
                "instance.place_meeting",
                "instance.set_alarm",
                "instance.get_alarm",
                "collision",
                "collision.place_meeting",
                "wait",
                "self",
                "self.id",
                "self.object_id",
                "self.sprite_id",
                "self.x",
                "self.y",
                "self.x_previous",
                "self.y_previous",
                "self.image_index",
                "self.scale",
                "self.layer_id",
                "self.active",
                "self.visible",
                "other",
                "other.id",
                "other.object_id",
                "other.sprite_id",
                "other.x",
                "other.y",
                "other.x_previous",
                "other.y_previous",
                "other.image_index",
                "other.scale",
                "other.layer_id",
                "other.active",
                "other.visible"
            ]
        },
        "hint": {
            "enable": true
        },
        "runtime": {
            "version": "Lua 5.4"
        },
        "telemetry": {
            "enable": false
        },
        "workspace": {
            "checkThirdParty": false,
            "library": [
                api_library_path.to_string_lossy().to_string()
            ],
            "preloadFileSize": 500,
            "maxPreload": 2000
        }
    })
}

impl Drop for LuaLsClient {
    fn drop(&mut self) {
        let _ = self.send_notification("exit", json!(null));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn stable_hash(input: &str) -> String {
    let mut hash: u64 = 1469598103934665603;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

fn slugify(value: &str) -> String {
    let mut slug = String::with_capacity(value.len());
    let mut last_was_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "script".to_string()
    } else {
        slug.to_string()
    }
}

fn path_to_file_uri(path: &Path) -> String {
    Url::from_file_path(path)
        .expect("absolute filesystem paths should always convert to file URIs")
        .to_string()
}

fn file_uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let url = Url::parse(uri).map_err(|error| format!("Invalid file URI '{uri}': {error}"))?;
    if url.scheme() != "file" {
        return Err(format!("Unsupported URI: {uri}"));
    }
    url.to_file_path()
        .map_err(|()| format!("Could not convert file URI to path: {uri}"))
}

fn workspace_seed(input: &LuaWorkspaceInput) -> String {
    if input.project_path.trim().is_empty() {
        format!(
            "{}-{}",
            slugify(&input.project_name),
            stable_hash(&input.project_name)
        )
    } else {
        format!(
            "{}-{}",
            slugify(&input.project_name),
            stable_hash(&input.project_path)
        )
    }
}

fn build_workspace_dir(input: &LuaWorkspaceInput) -> PathBuf {
    std::env::temp_dir()
        .join("nwge-studio")
        .join("lua-ls")
        .join(workspace_seed(input))
}

fn build_runtime_paths(workspace_dir: &Path) -> LuaLsRuntimePaths {
    LuaLsRuntimePaths {
        log_dir: workspace_dir.join(".lua-ls-log"),
        meta_dir: workspace_dir.join(".lua-ls-meta"),
        api_dir: workspace_dir.join(".nwge-api"),
    }
}

const DEFAULT_NWGE_API_STUB: &str = r#"---@meta

---@alias nwge.ButtonName
---| 'key_left'
---| 'key_up'
---| 'key_down'
---| 'key_right'
---| 'key_ok'
---| 'key_back'
---| 'key_home'
---| 'key_on_off'
---| 'key_shift'
---| 'key_alpha'
---| 'key_xnt'
---| 'key_var'
---| 'key_toolbox'
---| 'key_backspace'
---| 'key_exp'
---| 'key_ln'
---| 'key_log'
---| 'key_imaginary'
---| 'key_comma'
---| 'key_power'
---| 'key_sine'
---| 'key_cosine'
---| 'key_tangent'
---| 'key_pi'
---| 'key_sqrt'
---| 'key_square'
---| 'key_seven'
---| 'key_eight'
---| 'key_nine'
---| 'key_left_parenthesis'
---| 'key_right_parenthesis'
---| 'key_four'
---| 'key_five'
---| 'key_six'
---| 'key_multiplication'
---| 'key_division'
---| 'key_one'
---| 'key_two'
---| 'key_three'
---| 'key_plus'
---| 'key_minus'
---| 'key_zero'
---| 'key_dot'
---| 'key_ee'
---| 'key_ans'
---| 'key_exe'

---@class nwge.Instance
---@field id integer
---@field object_id integer
---@field sprite_id integer
---@field x integer
---@field y integer
---@field x_previous integer
---@field y_previous integer
---@field image_index integer
---@field scale integer
---@field layer_id integer
---@field active boolean
---@field visible boolean

---@class nwge.InputModule
local input = {}

---@param button nwge.ButtonName|integer
---@return boolean
function input.down(button) end

---@param button nwge.ButtonName|integer
---@return boolean
function input.pressed(button) end

---@param button nwge.ButtonName|integer
---@return boolean
function input.released(button) end

---@class nwge.DrawModule
local draw = {}

---@param sprite_id integer
---@param x integer
---@param y integer
---@param frame? integer
---@param scale? integer
function draw.sprite(sprite_id, x, y, frame, scale) end

---@param x integer
---@param y integer
---@param text string
function draw.text(x, y, text) end

---@class nwge.RoomModule
local room = {}

---@param room_id integer
---@return boolean
function room.goto_room(room_id) end

---@return integer
function room.current() end

---@class nwge.InstanceModule
local instance = {}

---@param object_id integer
---@param x integer
---@param y integer
---@param layer_id? integer
---@return nwge.Instance|nil
function instance.create(object_id, x, y, layer_id) end

---@param target? nwge.Instance|integer
function instance.destroy(target) end

---@param instance_id integer
---@return nwge.Instance|nil
function instance.find(instance_id) end

---@param target nwge.Instance
---@param alarm_index integer
---@param seconds? number
function instance.set_alarm(target, alarm_index, seconds) end

---@param target nwge.Instance
---@param alarm_index integer
---@return number|nil
function instance.get_alarm(target, alarm_index) end

---@param target nwge.Instance
---@param x integer
---@param y integer
---@param object_id? integer
---@return boolean
function instance.place_meeting(target, x, y, object_id) end

---@class nwge.CollisionModule
local collision = {}

---@param target nwge.Instance
---@param x integer
---@param y integer
---@param object_id? integer
---@return nwge.Instance|nil
function collision.place_meeting(target, x, y, object_id) end

---@param seconds number
function wait(seconds) end

---@type nwge.InputModule
_G.input = input

---@type nwge.DrawModule
_G.draw = draw

---@type nwge.RoomModule
_G.room = room

---@type nwge.InstanceModule
_G.instance = instance

---@type nwge.CollisionModule
_G.collision = collision

---@type nwge.Instance
_G.self = {}

---@type nwge.Instance|nil
_G.other = nil
"#;

fn candidate_api_doc_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = std::env::var("NWGE_LUA_API_DOC") {
        paths.push(PathBuf::from(path));
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    paths.push(
        manifest_dir
            .join("..")
            .join("..")
            .join("nwge-runtime")
            .join("docs")
            .join("lua-api.md"),
    );

    paths
}

fn candidate_runtime_docs_dirs() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = std::env::var("NWGE_RUNTIME_DOCS_DIR") {
        paths.push(PathBuf::from(path));
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    paths.push(
        manifest_dir
            .join("..")
            .join("..")
            .join("nwge-runtime")
            .join("docs"),
    );

    paths
}

fn candidate_api_stub_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = std::env::var("NWGE_LUA_API_STUB") {
        paths.push(PathBuf::from(path));
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    paths.push(
        manifest_dir
            .join("..")
            .join("..")
            .join("nwge-runtime")
            .join("docs")
            .join("lua-api-stub.lua"),
    );

    paths
}

fn find_api_doc_path() -> Option<PathBuf> {
    candidate_api_doc_paths()
        .into_iter()
        .find(|path| path.exists())
}

fn find_api_stub_path() -> Option<PathBuf> {
    candidate_api_stub_paths()
        .into_iter()
        .find(|path| path.exists())
}

pub fn read_api_doc_markdown() -> Result<String, String> {
    let path =
        find_api_doc_path().ok_or_else(|| "Lua API documentation was not found.".to_string())?;
    fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))
}

pub fn read_runtime_doc_markdown(doc_name: &str) -> Result<String, String> {
    let allowed = ["lua-api.md", "studio-editors.md", "studio-tutorial.md"];
    if !allowed.contains(&doc_name) {
        return Err(format!("Unsupported runtime doc '{}'.", doc_name));
    }

    let path = candidate_runtime_docs_dirs()
        .into_iter()
        .map(|dir| dir.join(doc_name))
        .find(|path| path.exists())
        .ok_or_else(|| format!("Runtime documentation '{}' was not found.", doc_name))?;

    fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))
}

fn read_api_stub_source() -> Result<String, String> {
    let path = find_api_stub_path().ok_or_else(|| "Lua API stub was not found.".to_string())?;
    fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))
}

#[cfg(test)]
fn extract_api_spec_block(markdown: &str) -> Result<&str, String> {
    let start_marker = "```nwge-api";
    let start = markdown
        .find(start_marker)
        .ok_or_else(|| "Missing ```nwge-api block.".to_string())?;
    let after_start = &markdown[start + start_marker.len()..];
    let after_newline = after_start
        .strip_prefix("\r\n")
        .or_else(|| after_start.strip_prefix('\n'))
        .ok_or_else(|| "The ```nwge-api block must start on the next line.".to_string())?;
    let end = after_newline
        .find("\n```")
        .or_else(|| after_newline.find("\r\n```"))
        .ok_or_else(|| "Missing closing fence for ```nwge-api block.".to_string())?;
    Ok(&after_newline[..end])
}

#[cfg(test)]
fn parse_api_param(raw: &str) -> Result<LuaApiParam, String> {
    let (raw_name, raw_type) = raw
        .split_once(':')
        .ok_or_else(|| format!("Invalid function parameter '{raw}'. Expected name:type."))?;
    let name = raw_name.trim();
    let param_type = raw_type.trim();
    if name.is_empty() || param_type.is_empty() {
        return Err(format!("Invalid function parameter '{raw}'."));
    }

    let optional = name.ends_with('?');
    let clean_name = name.trim_end_matches('?').to_string();
    Ok(LuaApiParam {
        name: clean_name,
        param_type: param_type.to_string(),
        optional,
    })
}

#[cfg(test)]
fn parse_api_function(signature: &str) -> Result<LuaApiFunction, String> {
    let open_paren = signature
        .find('(')
        .ok_or_else(|| format!("Invalid function declaration '{signature}'."))?;
    let close_paren = signature
        .rfind(')')
        .ok_or_else(|| format!("Invalid function declaration '{signature}'."))?;
    if close_paren < open_paren {
        return Err(format!("Invalid function declaration '{signature}'."));
    }

    let name = signature[..open_paren].trim();
    if name.is_empty() {
        return Err(format!("Invalid function declaration '{signature}'."));
    }

    let params_raw = signature[open_paren + 1..close_paren].trim();
    let params = if params_raw.is_empty() {
        Vec::new()
    } else {
        params_raw
            .split(',')
            .map(|param| parse_api_param(param.trim()))
            .collect::<Result<Vec<_>, _>>()?
    };

    let returns = signature[close_paren + 1..]
        .trim()
        .strip_prefix("->")
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(LuaApiFunction {
        name: name.to_string(),
        params,
        returns,
    })
}

#[cfg(test)]
fn parse_lua_api_spec(markdown: &str) -> Result<LuaApiSpec, String> {
    let block = extract_api_spec_block(markdown)?;
    let mut spec = LuaApiSpec::default();
    let mut current_class: Option<usize> = None;

    for raw_line in block.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some(rest) = line.strip_prefix("alias ") {
            let (name, value) = rest
                .split_once('=')
                .ok_or_else(|| format!("Invalid alias declaration '{line}'."))?;
            spec.aliases.push(LuaApiAlias {
                name: name.trim().to_string(),
                value: value.trim().to_string(),
            });
            current_class = None;
            continue;
        }

        if let Some(name) = line.strip_prefix("class ") {
            spec.classes.push(LuaApiClass {
                name: name.trim().to_string(),
                fields: Vec::new(),
            });
            current_class = Some(spec.classes.len() - 1);
            continue;
        }

        if let Some(rest) = line.strip_prefix("field ") {
            let (name, field_type) = rest
                .split_once(' ')
                .ok_or_else(|| format!("Invalid field declaration '{line}'."))?;
            let class_index = current_class
                .ok_or_else(|| format!("Field '{name}' must appear after a class declaration."))?;
            spec.classes[class_index].fields.push(LuaApiField {
                name: name.trim().to_string(),
                field_type: field_type.trim().to_string(),
            });
            continue;
        }

        if let Some(rest) = line.strip_prefix("global ") {
            let (name, global_type) = rest
                .split_once(' ')
                .ok_or_else(|| format!("Invalid global declaration '{line}'."))?;
            spec.globals.push(LuaApiGlobal {
                name: name.trim().to_string(),
                global_type: global_type.trim().to_string(),
            });
            current_class = None;
            continue;
        }

        if let Some(rest) = line.strip_prefix("function ") {
            spec.functions.push(parse_api_function(rest.trim())?);
            current_class = None;
            continue;
        }

        return Err(format!("Unknown api directive '{line}'."));
    }

    Ok(spec)
}

#[cfg(test)]
fn generate_stub_from_api_spec(spec: &LuaApiSpec) -> Result<String, String> {
    let mut output = String::from("---@meta\n\n");

    for alias in &spec.aliases {
        output.push_str(&format!("---@alias {} {}\n\n", alias.name, alias.value));
    }

    let mut module_names = BTreeSet::new();
    for function in &spec.functions {
        if let Some((module_name, _)) = function.name.split_once('.') {
            module_names.insert(module_name.to_string());
        }
    }

    let globals_by_name: BTreeMap<&str, &LuaApiGlobal> = spec
        .globals
        .iter()
        .map(|global| (global.name.as_str(), global))
        .collect();

    let mut module_functions: BTreeMap<&str, Vec<&LuaApiFunction>> = BTreeMap::new();
    for function in &spec.functions {
        if let Some((module_name, _)) = function.name.split_once('.') {
            module_functions
                .entry(module_name)
                .or_default()
                .push(function);
        }
    }

    for class in &spec.classes {
        if let Some(functions) = spec
            .globals
            .iter()
            .find(|global| global.global_type == class.name)
            .and_then(|global| module_functions.get(global.name.as_str()))
        {
            output.push_str(&format!("---@class {}\n", class.name));
            for field in &class.fields {
                output.push_str(&format!("---@field {} {}\n", field.name, field.field_type));
            }
            for function in functions {
                let method_name = function
                    .name
                    .split_once('.')
                    .map(|(_, method_name)| method_name)
                    .unwrap_or(function.name.as_str());
                output.push_str(&format!(
                    "---@field {} {}\n",
                    method_name,
                    format_function_type(function)
                ));
            }
            output.push('\n');
        }
    }

    let documented_classes_with_module_fields: BTreeSet<&str> = spec
        .globals
        .iter()
        .filter(|global| module_functions.contains_key(global.name.as_str()))
        .map(|global| global.global_type.as_str())
        .collect();

    for class in &spec.classes {
        if documented_classes_with_module_fields.contains(class.name.as_str()) {
            continue;
        }
        output.push_str(&format!("---@class {}\n", class.name));
        for field in &class.fields {
            output.push_str(&format!("---@field {} {}\n", field.name, field.field_type));
        }
        output.push('\n');
    }

    for module_name in module_names {
        let global = globals_by_name
            .get(module_name.as_str())
            .ok_or_else(|| format!("Missing global declaration for module '{module_name}'."))?;
        output.push_str(&format!("---@type {}\n", global.global_type));
        output.push_str(&format!("local {} = {{}}\n\n", module_name));
    }

    for function in &spec.functions {
        for param in &function.params {
            if param.optional {
                output.push_str(&format!("---@param {}? {}\n", param.name, param.param_type));
            } else {
                output.push_str(&format!("---@param {} {}\n", param.name, param.param_type));
            }
        }
        for return_type in &function.returns {
            output.push_str(&format!("---@return {}\n", return_type));
        }

        let params = function
            .params
            .iter()
            .map(|param| param.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        output.push_str(&format!("function {}({}) end\n\n", function.name, params));
    }

    for global in &spec.globals {
        let has_module_functions = spec
            .functions
            .iter()
            .any(|function| function.name.starts_with(&format!("{}.", global.name)));
        output.push_str(&format!("---@type {}\n", global.global_type));
        if has_module_functions {
            output.push_str(&format!("_G.{0} = {0}\n\n", global.name));
        } else if global.global_type.contains("|nil") {
            output.push_str(&format!("_G.{} = nil\n\n", global.name));
        } else {
            output.push_str(&format!("_G.{} = {{}}\n\n", global.name));
        }
    }

    Ok(output)
}

#[cfg(test)]
fn format_function_type(function: &LuaApiFunction) -> String {
    let params = function
        .params
        .iter()
        .map(|param| {
            if param.optional {
                format!("{}?: {}", param.name, param.param_type)
            } else {
                format!("{}: {}", param.name, param.param_type)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    if function.returns.is_empty() {
        format!("fun({params})")
    } else {
        format!("fun({params}): {}", function.returns.join(", "))
    }
}

fn nwge_api_stub_source() -> String {
    let Some(path) = find_api_stub_path() else {
        return DEFAULT_NWGE_API_STUB.to_string();
    };

    match read_api_stub_source() {
        Ok(stub) => stub,
        Err(error) => {
            eprintln!(
                "[lua-ls] failed to build NWGE api stub from '{}': {}",
                path.display(),
                error
            );
            DEFAULT_NWGE_API_STUB.to_string()
        }
    }
}

fn write_nwge_api_stub(api_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(api_dir).map_err(|error| error.to_string())?;
    fs::write(api_dir.join("nwge.lua"), nwge_api_stub_source()).map_err(|error| error.to_string())
}

fn build_script_path(root: &Path, script: &LuaWorkspaceScript) -> PathBuf {
    let file_name = format!("{}-{}.lua", slugify(&script.name), slugify(&script.id));
    root.join("scripts").join(file_name)
}

fn locate_server_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let binary_name = server_binary_name();

    if let Ok(value) = std::env::var("NWGS_LUA_LANGUAGE_SERVER") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Ok(path);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for path in resource_binary_candidates(&resource_dir, binary_name) {
            if path.exists() {
                return Ok(path);
            }
        }
    }

    let bundled = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("lua-language-server")
        .join("bin")
        .join(binary_name);
    if bundled.exists() {
        return Ok(bundled);
    }

    if let Ok(path) = which_like(binary_name) {
        return Ok(path);
    }

    Err(format!(
        "Lua language server was not found. Expected src-tauri/resources/lua-language-server/bin/{binary_name}, the packaged resource directory, {binary_name} in PATH, or NWGS_LUA_LANGUAGE_SERVER."
    ))
}

fn server_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "lua-language-server.exe"
    } else {
        "lua-language-server"
    }
}

fn resource_binary_candidates(resource_dir: &Path, binary_name: &str) -> [PathBuf; 2] {
    [
        resource_dir
            .join("lua-language-server")
            .join("bin")
            .join(binary_name),
        resource_dir
            .join("resources")
            .join("lua-language-server")
            .join("bin")
            .join(binary_name),
    ]
}

fn which_like(binary: &str) -> Result<PathBuf, String> {
    let command = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    let output = Command::new(command)
        .arg(binary)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("Could not find '{binary}' in PATH."));
    }
    let path = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    let trimmed = path
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or("");
    if trimmed.is_empty() {
        return Err(format!("Could not find '{binary}' in PATH."));
    }
    Ok(PathBuf::from(trimmed))
}

fn write_lsp_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let content = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", content.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|error| error.to_string())?;
    stdin
        .write_all(&content)
        .map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

fn write_lsp_message_locked(stdin: &Arc<Mutex<ChildStdin>>, payload: &Value) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "LuaLS stdin lock was poisoned.".to_string())?;
    write_lsp_message(&mut stdin, payload)
}

fn read_lsp_message(reader: &mut BufReader<ChildStdout>) -> Result<Option<Value>, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(None);
        }

        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| error.to_string())?,
            );
        }
    }

    let content_length =
        content_length.ok_or_else(|| "Missing Content-Length header.".to_string())?;
    let mut content = vec![0_u8; content_length];
    reader
        .read_exact(&mut content)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&content).map_err(|error| error.to_string())
}

fn spawn_output_threads(
    app: AppHandle,
    stdout: ChildStdout,
    stdin: Arc<Mutex<ChildStdin>>,
    stderr: ChildStderr,
    pending: Arc<Mutex<HashMap<i64, Sender<Result<Value, String>>>>>,
    diagnostics: Arc<Mutex<HashMap<String, Value>>>,
    api_library_path: PathBuf,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_lsp_message(&mut reader) {
                Ok(Some(message)) => {
                    if let Some(id) = message.get("id").and_then(Value::as_i64) {
                        if message.get("method").is_some() {
                            let method = message
                                .get("method")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let params = message.get("params").cloned().unwrap_or(Value::Null);
                            let result = match method {
                                "workspace/configuration" => {
                                    let items = params
                                        .get("items")
                                        .and_then(Value::as_array)
                                        .cloned()
                                        .unwrap_or_default();
                                    Value::Array(
                                        items
                                            .iter()
                                            .map(|item| {
                                                match item.get("section").and_then(Value::as_str) {
                                                    Some("Lua") => {
                                                        lua_ls_settings(&api_library_path)
                                                    }
                                                    Some("files.associations") => Value::Null,
                                                    Some("files.exclude") => json!({}),
                                                    Some("editor.semanticHighlighting.enabled") => {
                                                        Value::Null
                                                    }
                                                    Some("editor.acceptSuggestionOnEnter") => {
                                                        json!("on")
                                                    }
                                                    _ => Value::Null,
                                                }
                                            })
                                            .collect(),
                                    )
                                }
                                "client/registerCapability"
                                | "client/unregisterCapability"
                                | "window/workDoneProgress/create"
                                | "workspace/applyEdit" => Value::Null,
                                "window/showMessageRequest" => Value::Null,
                                _ => Value::Null,
                            };
                            let response = json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": result,
                            });
                            let _ = write_lsp_message_locked(&stdin, &response);
                            continue;
                        }

                        let sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
                        if let Some(sender) = sender {
                            let result = if let Some(error) = message.get("error") {
                                Err(error.to_string())
                            } else {
                                Ok(message.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = sender.send(result);
                        }
                        continue;
                    }

                    let Some(method) = message.get("method").and_then(Value::as_str) else {
                        continue;
                    };
                    if method == "textDocument/publishDiagnostics" {
                        let params = message.get("params").cloned().unwrap_or(Value::Null);
                        if let Some(uri) = params.get("uri").and_then(Value::as_str) {
                            if let Ok(mut map) = diagnostics.lock() {
                                map.insert(uri.to_string(), params.clone());
                            }
                            let _ = app.emit(DIAGNOSTICS_EVENT, params);
                        }
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let payload = json!({
                        "uri": "",
                        "diagnostics": [],
                        "message": format!("LuaLS stream error: {error}")
                    });
                    let _ = app.emit(DIAGNOSTICS_EVENT, payload);
                    break;
                }
            }
        }
    });

    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => eprintln!("[lua-ls] {}", line.trim_end()),
                Err(_) => break,
            }
        }
    });
}

impl LuaLsClient {
    fn new(app: &AppHandle, input: &LuaWorkspaceInput) -> Result<Self, String> {
        let workspace_dir = build_workspace_dir(input);
        fs::create_dir_all(workspace_dir.join("scripts")).map_err(|error| error.to_string())?;
        let runtime_paths = build_runtime_paths(&workspace_dir);
        fs::create_dir_all(&runtime_paths.log_dir).map_err(|error| error.to_string())?;
        fs::create_dir_all(&runtime_paths.meta_dir).map_err(|error| error.to_string())?;
        write_nwge_api_stub(&runtime_paths.api_dir)?;

        let binary = locate_server_binary(app)?;
        let mut command = Command::new(&binary);
        command
            .current_dir(&workspace_dir)
            .arg(format!(
                "--logpath={}",
                runtime_paths.log_dir.to_string_lossy()
            ))
            .arg(format!(
                "--metapath={}",
                runtime_paths.meta_dir.to_string_lossy()
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start Lua language server '{}': {error}",
                    binary.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "LuaLS stdin was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "LuaLS stdout was unavailable.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "LuaLS stderr was unavailable.".to_string())?;
        let stdin = Arc::new(Mutex::new(stdin));

        let diagnostics = Arc::new(Mutex::new(HashMap::new()));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        spawn_output_threads(
            app.clone(),
            stdout,
            stdin.clone(),
            stderr,
            pending.clone(),
            diagnostics.clone(),
            runtime_paths.api_dir.clone(),
        );

        let mut client = Self {
            child,
            stdin,
            next_id: 1,
            workspace_dir: workspace_dir.clone(),
            root_uri: path_to_file_uri(&workspace_dir),
            script_uris: HashMap::new(),
            opened_documents: HashMap::new(),
            diagnostics,
            pending,
        };

        client.initialize()?;
        client.apply_configuration()?;
        Ok(client)
    }

    fn initialize(&mut self) -> Result<(), String> {
        let result = self.send_request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": self.root_uri,
                "capabilities": {
                    "textDocument": {
                        "completion": {
                            "completionItem": {
                                "snippetSupport": true,
                                "documentationFormat": ["markdown", "plaintext"]
                            }
                        },
                        "hover": {
                            "contentFormat": ["markdown", "plaintext"]
                        },
                        "definition": {
                            "linkSupport": false
                        },
                        "publishDiagnostics": {
                            "relatedInformation": true
                        },
                        "synchronization": {
                            "didSave": true,
                            "dynamicRegistration": false
                        }
                    },
                    "workspace": {
                        "configuration": false,
                        "workspaceFolders": true
                    }
                },
                "workspaceFolders": [
                    {
                        "uri": self.root_uri,
                        "name": "NumWorks Game Engine Studio"
                    }
                ],
                "clientInfo": {
                    "name": "nwge-studio",
                    "version": "0.1.0"
                }
            }),
        )?;

        if result.is_null() {
            return Err("LuaLS initialize returned no result.".to_string());
        }

        self.send_notification("initialized", json!({}))?;
        Ok(())
    }

    fn apply_configuration(&mut self) -> Result<(), String> {
        self.send_notification(
            "workspace/didChangeConfiguration",
            json!({
                    "settings": {
                    "Lua": lua_ls_settings(&build_runtime_paths(&self.workspace_dir).api_dir)
                }
            }),
        )
    }

    fn send_request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "LuaLS pending request lock was poisoned.".to_string())?
            .insert(id, sender);

        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        if let Err(error) = write_lsp_message_locked(&self.stdin, &payload) {
            self.pending.lock().ok().and_then(|mut map| map.remove(&id));
            return Err(error);
        }

        receiver
            .recv_timeout(LSP_TIMEOUT)
            .map_err(|_| format!("Timed out waiting for LuaLS response to '{method}'."))?
    }

    fn send_notification(&mut self, method: &str, params: Value) -> Result<(), String> {
        write_lsp_message_locked(
            &self.stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            }),
        )
    }

    fn sync_workspace(
        &mut self,
        input: &LuaWorkspaceInput,
    ) -> Result<LuaWorkspaceResponse, String> {
        let scripts_dir = self.workspace_dir.join("scripts");
        fs::create_dir_all(&scripts_dir).map_err(|error| error.to_string())?;
        clear_directory(&scripts_dir)?;

        let mut next_uris = HashMap::new();
        for script in &input.scripts {
            let path = build_script_path(&self.workspace_dir, script);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&path, script.code.as_bytes()).map_err(|error| error.to_string())?;
            next_uris.insert(script.id.clone(), path_to_file_uri(&path));
        }

        self.script_uris = next_uris.clone();
        Ok(LuaWorkspaceResponse {
            root_uri: self.root_uri.clone(),
            script_uris: next_uris,
        })
    }

    fn update_document(&mut self, input: &LuaDocumentInput) -> Result<(), String> {
        let path = file_uri_to_path(&input.uri)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, input.text.as_bytes()).map_err(|error| error.to_string())?;

        let already_open = self.opened_documents.contains_key(&input.uri);
        if already_open {
            self.send_notification(
                "textDocument/didChange",
                json!({
                    "textDocument": {
                        "uri": input.uri,
                        "version": input.version,
                    },
                    "contentChanges": [
                        {
                            "text": input.text,
                        }
                    ]
                }),
            )?;
        } else {
            self.send_notification(
                "textDocument/didOpen",
                json!({
                    "textDocument": {
                        "uri": input.uri,
                        "languageId": "lua",
                        "version": input.version,
                        "text": input.text,
                    }
                }),
            )?;
        }

        self.opened_documents
            .insert(input.uri.clone(), input.version);
        Ok(())
    }

    fn completion(&mut self, input: &LuaPositionInput) -> Result<Value, String> {
        self.update_document(&LuaDocumentInput {
            uri: input.uri.clone(),
            text: input.text.clone(),
            version: input.version,
        })?;

        self.send_request(
            "textDocument/completion",
            json!({
                "textDocument": { "uri": input.uri },
                "position": {
                    "line": input.line,
                    "character": input.character,
                }
            }),
        )
    }

    fn hover(&mut self, input: &LuaPositionInput) -> Result<Value, String> {
        self.update_document(&LuaDocumentInput {
            uri: input.uri.clone(),
            text: input.text.clone(),
            version: input.version,
        })?;

        self.send_request(
            "textDocument/hover",
            json!({
                "textDocument": { "uri": input.uri },
                "position": {
                    "line": input.line,
                    "character": input.character,
                }
            }),
        )
    }

    fn definition(&mut self, input: &LuaPositionInput) -> Result<Vec<LuaLspLocation>, String> {
        self.update_document(&LuaDocumentInput {
            uri: input.uri.clone(),
            text: input.text.clone(),
            version: input.version,
        })?;

        let result = self.send_request(
            "textDocument/definition",
            json!({
                "textDocument": { "uri": input.uri },
                "position": {
                    "line": input.line,
                    "character": input.character,
                }
            }),
        )?;

        parse_locations(&result)
    }

    fn diagnostics_for(&self, uri: &str) -> Value {
        self.diagnostics
            .lock()
            .ok()
            .and_then(|map| map.get(uri).cloned())
            .unwrap_or_else(|| json!({ "uri": uri, "diagnostics": [] }))
    }

    fn shutdown(&mut self) {
        let _ = self.send_request("shutdown", Value::Null);
        let _ = self.send_notification("exit", Value::Null);
    }
}

fn parse_locations(value: &Value) -> Result<Vec<LuaLspLocation>, String> {
    let Some(items) = value.as_array() else {
        if value.is_null() {
            return Ok(Vec::new());
        }
        if let Some(location) = parse_location(value) {
            return Ok(vec![location]);
        }
        return Err("LuaLS returned an unexpected definition payload.".to_string());
    };

    Ok(items.iter().filter_map(parse_location).collect())
}

fn parse_location(value: &Value) -> Option<LuaLspLocation> {
    let uri = value.get("uri")?.as_str()?.to_string();
    let range = value.get("range")?;
    Some(LuaLspLocation {
        uri,
        start_line: range.get("start")?.get("line")?.as_u64()? as u32,
        start_character: range.get("start")?.get("character")?.as_u64()? as u32,
        end_line: range.get("end")?.get("line")?.as_u64()? as u32,
        end_character: range.get("end")?.get("character")?.as_u64()? as u32,
    })
}

fn clear_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn with_client<T>(
    app: &AppHandle,
    state: &State<'_, LuaLsState>,
    workspace_hint: Option<&LuaWorkspaceInput>,
    action: impl FnOnce(&mut LuaLsClient) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "LuaLS state lock was poisoned.".to_string())?;

    if guard.is_none() {
        let hint =
            workspace_hint.ok_or_else(|| "LuaLS has not been initialized yet.".to_string())?;
        *guard = Some(LuaLsClient::new(app, hint)?);
    } else if let Some(hint) = workspace_hint {
        let expected_dir = build_workspace_dir(hint);
        let current_dir = guard
            .as_ref()
            .map(|client| client.workspace_dir.clone())
            .ok_or_else(|| "LuaLS was not available.".to_string())?;
        if current_dir != expected_dir {
            if let Some(client) = guard.as_mut() {
                client.shutdown();
            }
            *guard = Some(LuaLsClient::new(app, hint)?);
        }
    }

    let client = guard
        .as_mut()
        .ok_or_else(|| "LuaLS was not available.".to_string())?;
    action(client)
}

#[tauri::command]
pub fn lua_ls_sync_workspace(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    input: LuaWorkspaceInput,
) -> Result<LuaWorkspaceResponse, String> {
    with_client(&app, &state, Some(&input), |client| {
        client.sync_workspace(&input)
    })
}

#[tauri::command]
pub fn lua_ls_update_document(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    input: LuaDocumentInput,
) -> Result<(), String> {
    with_client(&app, &state, None, |client| client.update_document(&input))
}

#[tauri::command]
pub fn lua_ls_completion(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    input: LuaPositionInput,
) -> Result<Value, String> {
    with_client(&app, &state, None, |client| client.completion(&input))
}

#[tauri::command]
pub fn lua_ls_hover(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    input: LuaPositionInput,
) -> Result<Value, String> {
    with_client(&app, &state, None, |client| client.hover(&input))
}

#[tauri::command]
pub fn lua_ls_definition(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    input: LuaPositionInput,
) -> Result<Vec<LuaLspLocation>, String> {
    with_client(&app, &state, None, |client| client.definition(&input))
}

#[tauri::command]
pub fn lua_ls_get_diagnostics(
    app: AppHandle,
    state: State<'_, LuaLsState>,
    uri: String,
) -> Result<Value, String> {
    with_client(
        &app,
        &state,
        None,
        |client| Ok(client.diagnostics_for(&uri)),
    )
}

#[tauri::command]
pub fn lua_ls_shutdown(state: State<'_, LuaLsState>) -> Result<(), String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "LuaLS state lock was poisoned.".to_string())?;
    if let Some(client) = guard.as_mut() {
        client.shutdown();
    }
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{format_function_type, generate_stub_from_api_spec, parse_lua_api_spec};

    #[test]
    fn module_methods_are_attached_to_module_type() {
        let markdown = r#"
```nwge-api
class nwge.InputModule
global input nwge.InputModule
function input.pressed(button: string) -> boolean
```
"#;

        let spec = parse_lua_api_spec(markdown).expect("api spec should parse");
        let stub = generate_stub_from_api_spec(&spec).expect("stub should generate");

        assert!(stub.contains("---@class nwge.InputModule"));
        assert!(stub.contains("---@field pressed fun(button: string): boolean"));
        assert!(stub.contains("function input.pressed(button) end"));
    }

    #[test]
    fn function_type_marks_optional_parameters() {
        let markdown = r#"
```nwge-api
class nwge.RoomModule
global room nwge.RoomModule
function room.get(room_id?: integer) -> string|nil
```
"#;

        let spec = parse_lua_api_spec(markdown).expect("api spec should parse");
        let stub = generate_stub_from_api_spec(&spec).expect("stub should generate");

        assert!(stub.contains("---@field get fun(room_id?: integer): string|nil"));
        assert_eq!(
            format_function_type(&spec.functions[0]),
            "fun(room_id?: integer): string|nil"
        );
    }
}
