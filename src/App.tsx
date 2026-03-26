import {
  ButtonHTMLAttributes,
  CSSProperties,
  ChangeEvent,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  Fragment,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { marked, Renderer } from "marked";
import {
  AppWindow,
  ArrowRight,
  Box,
  Circle,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Eraser,
  FileCode2,
  FolderOpen,
  Gamepad2,
  Image,
  LayoutGrid,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Move,
  Package,
  PaintBucket,
  Paintbrush,
  Pencil,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Square,
  X,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { editor as MonacoEditor, languages } from "monaco-editor";
import "./App.css";

const DEFAULT_RUNTIME_ROOT = "";
const DEFAULT_PROJECT_PATH = "";
const DEFAULT_PACK_PATH = "";
const ROOM_EDITOR_SCALE = 2;
const ROOM_VIEW_WIDTH = 320;
const ROOM_VIEW_HEIGHT = 240;
const SPRITE_PREVIEW_TARGET_SIZE = 96;
const SPRITE_PREVIEW_MAX_SCALE = 12;
const SPRITE_EDITOR_MIN_ZOOM = 8;
const SPRITE_EDITOR_MAX_ZOOM = 40;
const SPRITE_EDITOR_DEFAULT_ZOOM = 20;
const SPRITE_EDITOR_MAX_BRUSH_SIZE = 8;
const SPRITE_HISTORY_LIMIT = 100;
const MAX_IMPORT_DIMENSION = ROOM_VIEW_WIDTH;
const RECENT_PROJECTS_STORAGE_KEY = "nwge.recentProjects";
const LUA_LS_MARKER_OWNER = "lua-language-server";
const ALARM_EVENT_COUNT = 12;
const PREVIEW_OUTPUT_EVENT = "preview-output";
const MAX_OUTPUT_ENTRIES = 400;
const DEFAULT_RESOURCE_PANE_WIDTH = 230;
const MIN_RESOURCE_PANE_WIDTH = 180;
const COLLAPSED_RESOURCE_PANE_WIDTH = 52;
const DEFAULT_PROPERTIES_PANE_WIDTH = 260;
const MIN_PROPERTIES_PANE_WIDTH = 220;
const DEFAULT_OUTPUT_PANE_HEIGHT = 218;
const MIN_OUTPUT_PANE_HEIGHT = 84;
const COLLAPSED_OUTPUT_PANE_HEIGHT = 42;
const MIN_WORKSPACE_WIDTH = 320;
const MIN_WORKSPACE_HEIGHT = 220;
const STUDIO_PANE_RESIZER_SIZE = 8;
const DEVICE_ICON_WIDTH = 55;
const DEVICE_ICON_HEIGHT = 56;

type ThemeMode = "light" | "dark";
type WorkspaceView = "project" | "room" | "object" | "script" | "sprite" | "preview";
type ScriptRef = "" | string;
type StandardEventField =
  | "createScriptId"
  | "stepScriptId"
  | "drawScriptId"
  | "destroyScriptId"
  | "collisionScriptId";
type ButtonEventField = "buttonPressedScriptIds" | "buttonDownScriptIds" | "buttonReleasedScriptIds";
type RoomEventField = "createScriptIds" | "stepScriptIds" | "drawScriptIds" | "destroyScriptIds";
type GameEventField = "gameCreateScriptIds" | "gameStepScriptIds" | "gameDrawScriptIds" | "gameDestroyScriptIds";
type ConfigValueType = "string" | "number" | "boolean";
type RoomTool = "select" | "place" | "erase" | "move" | "preview";
type TileEditMode = "art" | "collision";
type SpriteTool = "draw" | "erase" | "line" | "rectangle" | "circle" | "fill" | "move" | "select";
type ResourceSectionKey = "settings" | "rooms" | "objects" | "sprites" | "scripts";
type IconName =
  | "app"
  | "project"
  | "preview"
  | "room"
  | "object"
  | "sprite"
  | "script"
  | "save"
  | "open"
  | "import"
  | "add"
  | "duplicate"
  | "delete"
  | "close"
  | "event"
  | "select"
  | "place"
  | "erase"
  | "move"
  | "paint"
  | "package"
  | "continue"
  | "more"
  | "rename"
  | "expandOpen"
  | "expandClosed";

type SpriteFrame = {
  id: string;
  pixels: number[];
  previewUrl: string;
};

type SpriteAsset = {
  id: string;
  name: string;
  width: number;
  height: number;
  frameDurationMs: number;
  originX: number;
  originY: number;
  bboxLeft: number;
  bboxTop: number;
  bboxRight: number;
  bboxBottom: number;
  frames: SpriteFrame[];
};

type ScriptAsset = {
  id: string;
  name: string;
  code: string;
};

type ConfigEntry = {
  id: string;
  name: string;
  valueType: ConfigValueType;
  value: string;
};

type ObjectAsset = {
  id: string;
  name: string;
  parentObjectId: string;
  spriteId: string;
  createScriptId: ScriptRef;
  stepScriptId: ScriptRef;
  drawScriptId: ScriptRef;
  destroyScriptId: ScriptRef;
  collisionScriptId: ScriptRef;
  collisionObjectId: ScriptRef;
  alarmScriptIds: string[];
  buttonPressedScriptIds: Record<string, ScriptRef>;
  buttonDownScriptIds: Record<string, ScriptRef>;
  buttonReleasedScriptIds: Record<string, ScriptRef>;
};

type RoomPlacement = {
  id: string;
  objectId: string;
  x: number;
  y: number;
  layerId: string;
};

type RoomBackgroundLayer = {
  id: string;
  name: string;
  depth: number;
  color: string;
  spriteId: string;
  repeat: boolean;
  parallaxX: number;
  parallaxY: number;
};

type RoomTileLayer = {
  id: string;
  name: string;
  depth: number;
  tilesetSpriteId: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  tiles: number[];
  collisions: boolean[];
};

type RoomInstanceLayer = {
  id: string;
  name: string;
  depth: number;
};

type RoomLayerKind = "background" | "tile" | "instance";

type RoomAsset = {
  id: string;
  name: string;
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  cameraFollowObjectId: ScriptRef;
  createScriptIds: string[];
  stepScriptIds: string[];
  drawScriptIds: string[];
  destroyScriptIds: string[];
  backgroundLayers: RoomBackgroundLayer[];
  tileLayers: RoomTileLayer[];
  instanceLayers: RoomInstanceLayer[];
  placements: RoomPlacement[];
};

type StudioProject = {
  name: string;
  themeMode: ThemeMode;
  packPath: string;
  projectPath: string;
  runtimeRoot: string;
  iconSpriteId: string;
  rooms: RoomAsset[];
  sprites: SpriteAsset[];
  scripts: ScriptAsset[];
  config: ConfigEntry[];
  gameCreateScriptIds: string[];
  gameStepScriptIds: string[];
  gameDrawScriptIds: string[];
  gameDestroyScriptIds: string[];
  objects: ObjectAsset[];
};

type ProjectFile = Omit<StudioProject, "sprites"> & {
  sprites: Array<Omit<SpriteAsset, "frames"> & { frames: Array<Omit<SpriteFrame, "previewUrl">> }>;
};

type ToastTone = "neutral" | "success" | "error";

type ToastState = {
  message: string;
  tone: ToastTone;
};

type OutputStream = "stdout" | "stderr" | "status" | "command";

type OutputEntry = {
  id: number;
  runId: string;
  stream: OutputStream;
  message: string;
};

type DragPlacementState = {
  placementId: string;
  offsetX: number;
  offsetY: number;
};

type RoomPaintStrokeState = {
  pointerId: number;
  mode: TileEditMode;
  value: number | boolean;
};

type RecentProjectEntry = {
  path: string;
  name: string;
};

type TreeSectionState = Record<ResourceSectionKey, boolean>;

type RoomPointerState = {
  inside: boolean;
  x: number;
  y: number;
};

type ResizablePane = "resources" | "properties" | "output";

type PaneResizeState = {
  pane: ResizablePane;
  startX: number;
  startY: number;
  resourceWidth: number;
  propertiesWidth: number;
  outputHeight: number;
};

type SpriteSelection = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type SpriteEditorInteraction = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  basePixels: number[];
  previewPixels: number[];
  selectionPreview: SpriteSelection | null;
  moveSelection: SpriteSelection | null;
};

type SpriteHistoryEntry = {
  past: number[][];
  future: number[][];
};

type ImportedImage = {
  baseName: string;
  width: number;
  height: number;
  pixels: number[];
};

type LuaWorkspaceResponse = {
  rootUri: string;
  scriptUris: Record<string, string>;
};

type LuaLsDefinition = {
  uri: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
};

type LuaLsDiagnosticsPayload = {
  uri: string;
  diagnostics?: Array<{
    message?: string;
    severity?: number;
    source?: string;
    range?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
  }>;
};

type PreviewOutputPayload = {
  runId: string;
  stream: OutputStream;
  message: string;
};

type PreviewLaunchResult = {
  packPath: string;
  runId: string;
};

type ExportTargetStatus = {
  ready: boolean;
  missing: string[];
  note: string;
};

type ExportSupportResult = {
  runtimeRoot: string;
  runtimeWorkspaceReady: boolean;
  runtimeWorkspaceMessage: string;
  backendBaseUrl: string;
  pack: ExportTargetStatus;
  embedded: ExportTargetStatus;
  flash: ExportTargetStatus;
  simulator: ExportTargetStatus;
};

type EmbeddedExportResult = {
  outputPath: string;
};

type OutputTraceReference = {
  scriptName: string;
  line: number;
  start: number;
  end: number;
};

type PendingScriptNavigation = {
  scriptId: string;
  line: number;
};

type RuntimeDocId = "lua-api" | "studio-editors" | "studio-tutorial";
type RuntimeDocLoadState = "loading" | "ready" | "error";

const RUNTIME_DOCS: Array<{ id: RuntimeDocId; title: string; fileName: string }> = [
  { id: "lua-api", title: "Lua API", fileName: "lua-api.md" },
  { id: "studio-editors", title: "Studio Editors", fileName: "studio-editors.md" },
  { id: "studio-tutorial", title: "Quick Tutorial", fileName: "studio-tutorial.md" },
];

const RUNTIME_DOC_FILE_TO_ID: Record<string, RuntimeDocId> = Object.fromEntries(
  RUNTIME_DOCS.map((entry) => [entry.fileName, entry.id]),
) as Record<string, RuntimeDocId>;

const EVENT_BINDINGS: Array<{
  field: StandardEventField;
  label: string;
  icon: IconName;
  hint: string;
}> = [
  { field: "createScriptId", label: "Create", icon: "event", hint: "Start-up logic" },
  { field: "stepScriptId", label: "Step", icon: "move", hint: "Per-frame update" },
  { field: "drawScriptId", label: "Draw", icon: "paint", hint: "Custom render" },
  { field: "collisionScriptId", label: "Collision", icon: "object", hint: "Overlap response" },
  { field: "destroyScriptId", label: "Destroy", icon: "delete", hint: "Cleanup" },
];

const BUTTON_EVENT_FIELDS: Array<{ field: ButtonEventField; label: string }> = [
  { field: "buttonPressedScriptIds", label: "Pressed" },
  { field: "buttonDownScriptIds", label: "Down" },
  { field: "buttonReleasedScriptIds", label: "Released" },
];

const BUTTON_EVENT_KEYS = [
  { id: "key_left", label: "Left" },
  { id: "key_up", label: "Up" },
  { id: "key_down", label: "Down" },
  { id: "key_right", label: "Right" },
  { id: "key_ok", label: "OK" },
  { id: "key_back", label: "Back" },
  { id: "key_home", label: "Home" },
  { id: "key_on_off", label: "On/Off" },
  { id: "key_shift", label: "Shift" },
  { id: "key_alpha", label: "Alpha" },
  { id: "key_xnt", label: "xnt" },
  { id: "key_var", label: "Var" },
  { id: "key_toolbox", label: "Toolbox" },
  { id: "key_backspace", label: "Backspace" },
  { id: "key_exp", label: "Exp" },
  { id: "key_ln", label: "Ln" },
  { id: "key_log", label: "Log" },
  { id: "key_imaginary", label: "Imaginary" },
  { id: "key_comma", label: "Comma" },
  { id: "key_power", label: "Power" },
  { id: "key_sine", label: "Sine" },
  { id: "key_cosine", label: "Cosine" },
  { id: "key_tangent", label: "Tangent" },
  { id: "key_pi", label: "Pi" },
  { id: "key_sqrt", label: "Sqrt" },
  { id: "key_square", label: "Square" },
  { id: "key_seven", label: "7" },
  { id: "key_eight", label: "8" },
  { id: "key_nine", label: "9" },
  { id: "key_left_parenthesis", label: "(" },
  { id: "key_right_parenthesis", label: ")" },
  { id: "key_four", label: "4" },
  { id: "key_five", label: "5" },
  { id: "key_six", label: "6" },
  { id: "key_multiplication", label: "*" },
  { id: "key_division", label: "/" },
  { id: "key_one", label: "1" },
  { id: "key_two", label: "2" },
  { id: "key_three", label: "3" },
  { id: "key_plus", label: "+" },
  { id: "key_minus", label: "-" },
  { id: "key_zero", label: "0" },
  { id: "key_dot", label: "." },
  { id: "key_ee", label: "EE" },
  { id: "key_ans", label: "Ans" },
  { id: "key_exe", label: "EXE" },
] as const;

const LIFECYCLE_EVENTS = [
  { key: "create", label: "Create" },
  { key: "step", label: "Step" },
  { key: "draw", label: "Draw" },
  { key: "destroy", label: "Destroy" },
] as const;

const ROOM_TOOLS: Array<{ id: RoomTool; label: string; icon: IconName }> = [
  { id: "select", label: "Select", icon: "select" },
  { id: "place", label: "Place", icon: "place" },
  { id: "erase", label: "Erase", icon: "erase" },
  { id: "move", label: "Move", icon: "move" },
  { id: "preview", label: "Preview", icon: "preview" },
];

const SPRITE_TOOLS: Array<{ id: SpriteTool; label: string; icon: LucideIcon }> = [
  { id: "draw", label: "Draw", icon: Paintbrush },
  { id: "erase", label: "Erase", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Square", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "fill", label: "Fill", icon: PaintBucket },
  { id: "move", label: "Move", icon: Move },
  { id: "select", label: "Select", icon: MousePointer2 },
];

const ICONS: Record<IconName, LucideIcon> = {
  app: AppWindow,
  project: Settings2,
  preview: Gamepad2,
  room: LayoutGrid,
  object: Box,
  sprite: Image,
  script: FileCode2,
  save: Save,
  open: FolderOpen,
  import: Upload,
  add: Plus,
  duplicate: Copy,
  delete: Trash2,
  close: X,
  event: Sparkles,
  select: MousePointer2,
  place: Plus,
  erase: Eraser,
  move: Move,
  paint: Paintbrush,
  package: Package,
  continue: ArrowRight,
  more: MoreHorizontal,
  rename: Pencil,
  expandOpen: ChevronDown,
  expandClosed: ChevronRight,
};

function AppIcon({
  name,
  className,
  size = 16,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className={className ?? "app-icon"} size={size} strokeWidth={1.9} />;
}

function ActionButton({
  icon,
  label,
  className,
  children,
  ...props
}: {
  icon: IconName;
  label: string;
  children?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [className, children ? "button-with-label" : ""].filter(Boolean).join(" ");
  return (
    <button {...props} className={classes} aria-label={label} title={label}>
      <AppIcon name={icon} className="button-icon" />
      <span className="button-label">{children ?? label}</span>
    </button>
  );
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "The action failed unexpectedly.";
    }
  }
  return "The action failed unexpectedly.";
}

function blankPixels(width: number, height: number) {
  return new Array(width * height * 4).fill(0);
}

function clonePixels(pixels: number[]) {
  return pixels.slice();
}

function pixelOffset(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function getPixelRgba(pixels: number[], width: number, x: number, y: number) {
  const offset = pixelOffset(width, x, y);
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]] as const;
}

function setPixelRgba(pixels: number[], width: number, x: number, y: number, rgba: readonly [number, number, number, number]) {
  const offset = pixelOffset(width, x, y);
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

function hexToRgba(hex: string): [number, number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3 ? normalized.split("").map((part) => `${part}${part}`).join("") : normalized;
  const safe = expanded.padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(safe.slice(0, 2), 16),
    Number.parseInt(safe.slice(2, 4), 16),
    Number.parseInt(safe.slice(4, 6), 16),
    255,
  ];
}

function rgbaToCss(rgba: readonly [number, number, number, number]) {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})`;
}

function normalizeSpriteSelection(left: number, top: number, right: number, bottom: number): SpriteSelection {
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  };
}

function pointInSpriteSelection(selection: SpriteSelection, x: number, y: number) {
  return x >= selection.left && x <= selection.right && y >= selection.top && y <= selection.bottom;
}

function colorsMatch(left: readonly number[], right: readonly number[]) {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3];
}

function stampBrush(
  pixels: number[],
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  brushSize: number,
  rgba: readonly [number, number, number, number],
) {
  const radius = Math.max(0, (brushSize - 1) / 2);
  const extent = Math.max(0, Math.ceil(radius));

  for (let offsetY = -extent; offsetY <= extent; offsetY += 1) {
    for (let offsetX = -extent; offsetX <= extent; offsetX += 1) {
      const x = centerX + offsetX;
      const y = centerY + offsetY;
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }
      if (brushSize > 1 && Math.hypot(offsetX, offsetY) > radius + 0.35) {
        continue;
      }
      setPixelRgba(pixels, width, x, y, rgba);
    }
  }
}

function rasterizeLine(x0: number, y0: number, x1: number, y1: number) {
  const points: Array<[number, number]> = [];
  let currentX = x0;
  let currentY = y0;
  const deltaX = Math.abs(x1 - x0);
  const deltaY = Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = deltaX - deltaY;

  while (true) {
    points.push([currentX, currentY]);
    if (currentX === x1 && currentY === y1) {
      return points;
    }
    const doubledError = error * 2;
    if (doubledError > -deltaY) {
      error -= deltaY;
      currentX += stepX;
    }
    if (doubledError < deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function applyStrokeBetweenPoints(
  sourcePixels: number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  brushSize: number,
  rgba: readonly [number, number, number, number],
) {
  const nextPixels = clonePixels(sourcePixels);
  for (const [x, y] of rasterizeLine(startX, startY, endX, endY)) {
    stampBrush(nextPixels, width, height, x, y, brushSize, rgba);
  }
  return nextPixels;
}

function applyRectangleOutline(
  sourcePixels: number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  brushSize: number,
  rgba: readonly [number, number, number, number],
) {
  let nextPixels = clonePixels(sourcePixels);
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);

  nextPixels = applyStrokeBetweenPoints(nextPixels, width, height, left, top, right, top, brushSize, rgba);
  nextPixels = applyStrokeBetweenPoints(nextPixels, width, height, right, top, right, bottom, brushSize, rgba);
  nextPixels = applyStrokeBetweenPoints(nextPixels, width, height, right, bottom, left, bottom, brushSize, rgba);
  nextPixels = applyStrokeBetweenPoints(nextPixels, width, height, left, bottom, left, top, brushSize, rgba);
  return nextPixels;
}

function applyEllipseOutline(
  sourcePixels: number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  brushSize: number,
  rgba: readonly [number, number, number, number],
) {
  const nextPixels = clonePixels(sourcePixels);
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const radiusX = Math.max(0.5, (right - left) / 2);
  const radiusY = Math.max(0.5, (bottom - top) / 2);
  const centerX = left + radiusX;
  const centerY = top + radiusY;
  const steps = Math.max(24, Math.ceil(2 * Math.PI * Math.max(radiusX, radiusY) * 4));

  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const x = Math.round(centerX + Math.cos(angle) * radiusX);
    const y = Math.round(centerY + Math.sin(angle) * radiusY);
    stampBrush(nextPixels, width, height, x, y, brushSize, rgba);
  }

  return nextPixels;
}

function floodFillPixels(
  sourcePixels: number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillRgba: readonly [number, number, number, number],
) {
  const targetRgba = getPixelRgba(sourcePixels, width, startX, startY);
  if (colorsMatch(targetRgba, fillRgba)) {
    return sourcePixels;
  }

  const nextPixels = clonePixels(sourcePixels);
  const queue: number[] = [startX, startY];
  const visited = new Uint8Array(width * height);

  while (queue.length > 0) {
    const y = queue.pop() ?? 0;
    const x = queue.pop() ?? 0;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }

    const index = y * width + x;
    if (visited[index]) {
      continue;
    }
    visited[index] = 1;

    if (!colorsMatch(getPixelRgba(nextPixels, width, x, y), targetRgba)) {
      continue;
    }

    setPixelRgba(nextPixels, width, x, y, fillRgba);
    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return nextPixels;
}

function translatePixels(sourcePixels: number[], width: number, height: number, offsetX: number, offsetY: number) {
  const nextPixels = blankPixels(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
        continue;
      }
      setPixelRgba(nextPixels, width, targetX, targetY, getPixelRgba(sourcePixels, width, x, y));
    }
  }

  return nextPixels;
}

function moveSelectedPixels(
  sourcePixels: number[],
  width: number,
  height: number,
  selection: SpriteSelection,
  offsetX: number,
  offsetY: number,
) {
  const nextPixels = clonePixels(sourcePixels);

  for (let y = selection.top; y <= selection.bottom; y += 1) {
    for (let x = selection.left; x <= selection.right; x += 1) {
      setPixelRgba(nextPixels, width, x, y, [0, 0, 0, 0]);
    }
  }

  for (let y = selection.top; y <= selection.bottom; y += 1) {
    for (let x = selection.left; x <= selection.right; x += 1) {
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
        continue;
      }
      setPixelRgba(nextPixels, width, targetX, targetY, getPixelRgba(sourcePixels, width, x, y));
    }
  }

  return nextPixels;
}

function applyColorToSelection(
  sourcePixels: number[],
  width: number,
  selection: SpriteSelection,
  fillRgba: readonly [number, number, number, number],
) {
  const nextPixels = clonePixels(sourcePixels);

  for (let y = selection.top; y <= selection.bottom; y += 1) {
    for (let x = selection.left; x <= selection.right; x += 1) {
      const current = getPixelRgba(nextPixels, width, x, y);
      if (current[3] === 0) {
        continue;
      }
      setPixelRgba(nextPixels, width, x, y, [fillRgba[0], fillRgba[1], fillRgba[2], current[3]]);
    }
  }

  return nextPixels;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function maxCameraOffset(roomSize: number, viewSize: number) {
  return Math.max(0, roomSize - viewSize);
}

function clampCameraCoordinate(value: number, roomSize: number, viewSize: number) {
  return clamp(Math.round(value), 0, maxCameraOffset(roomSize, viewSize));
}

function clampParallaxFactor(value: number) {
  return clamp(Number.isFinite(value) ? value : 1, 0, 4);
}

function parallaxFixedToFactor(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampParallaxFactor(value);
}

function createBackgroundLayer(index: number): RoomBackgroundLayer {
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? "Background" : `Background ${index + 1}`,
    depth: -200 + index * 100,
    color: "#d8d8d8",
    spriteId: "",
    repeat: false,
    parallaxX: 1,
    parallaxY: 1,
  };
}

function createTileLayer(index: number, roomWidth: number, roomHeight: number, spriteId = ""): RoomTileLayer {
  const tileWidth = 16;
  const tileHeight = 16;
  const columns = Math.max(1, Math.ceil(roomWidth / tileWidth));
  const rows = Math.max(1, Math.ceil(roomHeight / tileHeight));
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? "Tiles" : `Tiles ${index + 1}`,
    depth: -100 + index * 100,
    tilesetSpriteId: spriteId,
    tileWidth,
    tileHeight,
    columns,
    rows,
    tiles: new Array(columns * rows).fill(-1),
    collisions: new Array(columns * rows).fill(false),
  };
}

function createInstanceLayer(index: number): RoomInstanceLayer {
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? "Instances" : `Instances ${index + 1}`,
    depth: index * 100,
  };
}

function roomLayerLabel(kind: RoomLayerKind) {
  switch (kind) {
    case "background":
      return "Background";
    case "tile":
      return "Tile";
    case "instance":
      return "Instance";
  }
}

function tileCellIndex(layer: RoomTileLayer, tileX: number, tileY: number) {
  if (tileX < 0 || tileY < 0 || tileX >= layer.columns || tileY >= layer.rows) {
    return -1;
  }
  return tileY * layer.columns + tileX;
}

function normalizeScriptRefs(value: unknown, legacyValue?: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : typeof legacyValue === "string"
        ? [legacyValue]
        : [];

  return Array.from(
    new Set(source.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)),
  );
}

function normalizeScriptMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, ScriptRef>;
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, ScriptRef] => typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

function normalizeAlarmScriptIds(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: ALARM_EVENT_COUNT }, (_, index) =>
    typeof source[index] === "string" ? source[index] : "",
  );
}

function resolveInheritedObjectSpriteId(
  objectId: string,
  objects: ObjectAsset[],
  seen = new Set<string>(),
): string {
  const entry = objects.find((objectEntry) => objectEntry.id === objectId);
  if (!entry || seen.has(objectId)) {
    return "";
  }
  if (entry.spriteId) {
    return entry.spriteId;
  }
  if (!entry.parentObjectId) {
    return "";
  }
  seen.add(objectId);
  return resolveInheritedObjectSpriteId(entry.parentObjectId, objects, seen);
}

function resolveInheritedEventScriptId(
  objectId: string,
  field: StandardEventField,
  objects: ObjectAsset[],
  seen = new Set<string>(),
): string {
  const entry = objects.find((objectValue) => objectValue.id === objectId);
  if (!entry || seen.has(objectId)) {
    return "";
  }
  if (entry[field]) {
    return entry[field];
  }
  if (!entry.parentObjectId) {
    return "";
  }
  seen.add(objectId);
  return resolveInheritedEventScriptId(entry.parentObjectId, field, objects, seen);
}

function resolveInheritedMappedEventScriptId(
  objectId: string,
  field: ButtonEventField,
  key: string,
  objects: ObjectAsset[],
  seen = new Set<string>(),
): string {
  const entry = objects.find((objectValue) => objectValue.id === objectId);
  if (!entry || seen.has(objectId)) {
    return "";
  }
  if (entry[field]?.[key]) {
    return entry[field][key] ?? "";
  }
  if (!entry.parentObjectId) {
    return "";
  }
  seen.add(objectId);
  return resolveInheritedMappedEventScriptId(entry.parentObjectId, field, key, objects, seen);
}

function resolveInheritedAlarmScriptId(
  objectId: string,
  alarmIndex: number,
  objects: ObjectAsset[],
  seen = new Set<string>(),
): string {
  const entry = objects.find((objectValue) => objectValue.id === objectId);
  if (!entry || seen.has(objectId)) {
    return "";
  }
  if (entry.alarmScriptIds[alarmIndex]) {
    return entry.alarmScriptIds[alarmIndex] ?? "";
  }
  if (!entry.parentObjectId) {
    return "";
  }
  seen.add(objectId);
  return resolveInheritedAlarmScriptId(entry.parentObjectId, alarmIndex, objects, seen);
}

function pixelsToDataUrl(width: number, height: number, pixels: number[]) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }
  const imageData = context.createImageData(width, height);
  imageData.data.set(Uint8ClampedArray.from(pixels));
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

async function buildProjectIconPngBytes(project: StudioProject) {
  const sprite = project.sprites.find((entry) => entry.id === project.iconSpriteId);
  const frame = sprite?.frames[0];
  if (!sprite || !frame) {
    return null;
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sprite.width;
  sourceCanvas.height = sprite.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    throw new Error("Could not prepare the calculator icon source canvas.");
  }

  const sourceImageData = sourceContext.createImageData(sprite.width, sprite.height);
  sourceImageData.data.set(Uint8ClampedArray.from(frame.pixels));
  sourceContext.putImageData(sourceImageData, 0, 0);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = DEVICE_ICON_WIDTH;
  outputCanvas.height = DEVICE_ICON_HEIGHT;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) {
    throw new Error("Could not prepare the calculator icon canvas.");
  }

  const scale = Math.min(DEVICE_ICON_WIDTH / sprite.width, DEVICE_ICON_HEIGHT / sprite.height);
  const targetWidth = Math.max(1, Math.round(sprite.width * scale));
  const targetHeight = Math.max(1, Math.round(sprite.height * scale));
  const offsetX = Math.floor((DEVICE_ICON_WIDTH - targetWidth) / 2);
  const offsetY = Math.floor((DEVICE_ICON_HEIGHT - targetHeight) / 2);

  outputContext.clearRect(0, 0, DEVICE_ICON_WIDTH, DEVICE_ICON_HEIGHT);
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(sourceCanvas, 0, 0, sprite.width, sprite.height, offsetX, offsetY, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) => outputCanvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Could not encode the calculator icon as PNG.");
  }

  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function readRecentProjects(): RecentProjectEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as RecentProjectEntry[];
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.path === "string" && typeof entry.name === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecentProjects(entries: RecentProjectEntry[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(entries.slice(0, 8)));
}

function rememberRecentProject(current: RecentProjectEntry[], entry: RecentProjectEntry) {
  const next = [entry, ...current.filter((item) => item.path !== entry.path)].slice(0, 8);
  writeRecentProjects(next);
  return next;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function makeHeadingId(value: string) {
  const normalized = stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "section";
}

function normalizeMarkdownHref(href: string, currentDocId: RuntimeDocId) {
  if (href.startsWith("#")) {
    return { href, internal: true, docId: currentDocId, anchor: href.slice(1) };
  }

  const docMatch = href.match(/^(?:\.\/)?([^/]+\.md)(#.+)?$/);
  if (docMatch) {
    const docId = RUNTIME_DOC_FILE_TO_ID[docMatch[1]];
    if (docId) {
      const anchor = docMatch[2]?.slice(1) ?? "";
      return { href: anchor ? `#${anchor}` : "#", internal: true, docId, anchor };
    }
  }

  return { href, internal: false };
}

function markdownToHtml(markdown: string, currentDocId: RuntimeDocId) {
  const renderer = new Renderer();

  renderer.heading = function({ tokens, depth }) {
    const plainText = this.parser.parseInline(tokens, this.parser.textRenderer);
    const html = this.parser.parseInline(tokens);
    const headingId = makeHeadingId(plainText);
    return `<h${depth} id="${escapeHtml(headingId)}">${html}</h${depth}>`;
  };

  renderer.link = function({ href, title, tokens }) {
    const html = this.parser.parseInline(tokens);
    const normalized = normalizeMarkdownHref(href, currentDocId);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const externalAttrs = normalized.internal ? "" : ' target="_blank" rel="noreferrer"';
    const internalAttrs = normalized.internal
      ? ` data-doc-id="${escapeHtml(normalized.docId ?? currentDocId)}" data-doc-anchor="${escapeHtml(normalized.anchor ?? "")}"`
      : "";
    return `<a href="${escapeHtml(normalized.href)}"${titleAttr}${internalAttrs}${externalAttrs}>${html}</a>`;
  };

  return marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer,
  });
}

function applyMonacoTheme(monaco: Monaco, mode: ThemeMode) {
  const selection = mode === "dark" ? "#4b5f82" : "#8ea9cf";

  monaco.editor.defineTheme("nwge-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": cssVar("--code-bg"),
      "editor.foreground": cssVar("--text-main"),
      "editorLineNumber.foreground": cssVar("--text-dim"),
      "editorLineNumber.activeForeground": cssVar("--text-main"),
      "editor.selectionBackground": selection,
      "editor.inactiveSelectionBackground": selection,
      "editor.lineHighlightBackground": cssVar("--code-line"),
      "editorCursor.foreground": cssVar("--accent-blue"),
      "editorWidget.background": cssVar("--panel-face"),
      "editorWidget.border": cssVar("--edge-dark"),
      "editorSuggestWidget.background": cssVar("--panel-face"),
      "editorSuggestWidget.border": cssVar("--edge-dark"),
      "editorHoverWidget.background": cssVar("--panel-face"),
      "editorHoverWidget.border": cssVar("--edge-dark"),
    },
  });

  monaco.editor.defineTheme("nwge-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": cssVar("--code-bg"),
      "editor.foreground": cssVar("--text-main"),
      "editorLineNumber.foreground": cssVar("--text-dim"),
      "editorLineNumber.activeForeground": cssVar("--text-main"),
      "editor.selectionBackground": selection,
      "editor.inactiveSelectionBackground": selection,
      "editor.lineHighlightBackground": cssVar("--code-line"),
      "editorCursor.foreground": cssVar("--accent-blue"),
      "editorWidget.background": cssVar("--panel-face"),
      "editorWidget.border": cssVar("--edge-dark"),
      "editorSuggestWidget.background": cssVar("--panel-face"),
      "editorSuggestWidget.border": cssVar("--edge-dark"),
      "editorHoverWidget.background": cssVar("--panel-face"),
      "editorHoverWidget.border": cssVar("--edge-dark"),
    },
  });

  monaco.editor.setTheme(mode === "dark" ? "nwge-dark" : "nwge-light");
}

function makeFrame(width: number, height: number, pixels = blankPixels(width, height)): SpriteFrame {
  return makeFrameWithId(crypto.randomUUID(), width, height, pixels);
}

function makeFrameWithId(id: string, width: number, height: number, pixels = blankPixels(width, height)): SpriteFrame {
  const normalizedPixels = clonePixels(pixels);
  return {
    id,
    pixels: normalizedPixels,
    previewUrl: pixelsToDataUrl(width, height, normalizedPixels),
  };
}

function monoRowsToPixels(rows: number[], width: number, height: number) {
  const pixels = blankPixels(width, height);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? 0;
    for (let x = 0; x < width; x += 1) {
      const bit = (row >> (7 - (x % 8))) & 1;
      const index = (y * width + x) * 4;
      pixels[index + 0] = bit ? 20 : 0;
      pixels[index + 1] = bit ? 36 : 0;
      pixels[index + 2] = bit ? 52 : 0;
      pixels[index + 3] = bit ? 255 : 0;
    }
  }
  return pixels;
}

function makeDefaultRoom(index: number, objectId = "", spriteId = ""): RoomAsset {
  const backgroundLayer = createBackgroundLayer(0);
  const tileLayer = createTileLayer(0, 320, 240, spriteId);
  const instanceLayer = createInstanceLayer(0);
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? "room_start" : `room_${index + 1}`,
    width: 320,
    height: 240,
    cameraX: 0,
    cameraY: 0,
    cameraFollowObjectId: "",
    createScriptIds: [],
    stepScriptIds: [],
    drawScriptIds: [],
    destroyScriptIds: [],
    backgroundLayers: [backgroundLayer],
    tileLayers: [tileLayer],
    instanceLayers: [instanceLayer],
    placements: objectId
      ? [
          {
            id: crypto.randomUUID(),
            objectId,
            x: 40,
            y: 120,
            layerId: "",
          },
        ]
      : [],
  };
}

function serializeProject(project: StudioProject): ProjectFile {
  return {
    ...project,
    sprites: project.sprites.map((sprite) => ({
      ...sprite,
      frameDurationMs: sprite.frameDurationMs,
      frames: sprite.frames.map((frame) => ({
        id: frame.id,
        pixels: frame.pixels,
      })),
    })),
  };
}

function createProjectSignature(project: StudioProject) {
  return JSON.stringify(serializeProject(project));
}

function hydrateProject(project: ProjectFile): StudioProject {
  const legacyRoomWidth = (project as Partial<{ roomWidth: number }>).roomWidth ?? ROOM_VIEW_WIDTH;
  const legacyRoomHeight = (project as Partial<{ roomHeight: number }>).roomHeight ?? ROOM_VIEW_HEIGHT;
  const fallbackRoom = makeDefaultRoom(0);
  const rooms = Array.isArray((project as Partial<StudioProject>).rooms) && (project as Partial<StudioProject>).rooms?.length
    ? ((project as Partial<StudioProject>).rooms as RoomAsset[])
    : [
        {
          ...fallbackRoom,
          name: (project as Partial<{ roomName: string }>).roomName ?? fallbackRoom.name,
          width: legacyRoomWidth,
          height: legacyRoomHeight,
          cameraX: clampCameraCoordinate(
            (project as Partial<{ cameraX: number }>).cameraX ?? 0,
            legacyRoomWidth,
            ROOM_VIEW_WIDTH,
          ),
          cameraY: clampCameraCoordinate(
            (project as Partial<{ cameraY: number }>).cameraY ?? 0,
            legacyRoomHeight,
            ROOM_VIEW_HEIGHT,
          ),
          placements: ((project as Partial<{ placements: RoomPlacement[] }>).placements ?? []).map((placement) => ({
            ...placement,
            layerId: placement.layerId || fallbackRoom.instanceLayers[0].id,
          })),
          tileLayers: [],
        },
      ];

  return {
    ...project,
    themeMode: project.themeMode ?? "light",
    runtimeRoot: project.runtimeRoot ?? DEFAULT_RUNTIME_ROOT,
    iconSpriteId: project.iconSpriteId ?? "",
    gameCreateScriptIds: normalizeScriptRefs(
      (project as Partial<StudioProject> & { gameCreateScriptId?: string }).gameCreateScriptIds,
      (project as Partial<StudioProject> & { gameCreateScriptId?: string }).gameCreateScriptId,
    ),
    gameStepScriptIds: normalizeScriptRefs(
      (project as Partial<StudioProject> & { gameStepScriptId?: string }).gameStepScriptIds,
      (project as Partial<StudioProject> & { gameStepScriptId?: string }).gameStepScriptId,
    ),
    gameDrawScriptIds: normalizeScriptRefs(
      (project as Partial<StudioProject> & { gameDrawScriptId?: string }).gameDrawScriptIds,
      (project as Partial<StudioProject> & { gameDrawScriptId?: string }).gameDrawScriptId,
    ),
    gameDestroyScriptIds: normalizeScriptRefs(
      (project as Partial<StudioProject> & { gameDestroyScriptId?: string }).gameDestroyScriptIds,
      (project as Partial<StudioProject> & { gameDestroyScriptId?: string }).gameDestroyScriptId,
    ),
    objects: project.objects.map((entry) => {
      const normalizedEntry = { ...(entry as ObjectAsset & { persistent?: boolean }) };
      Reflect.deleteProperty(normalizedEntry, "persistent");
      return {
        ...normalizedEntry,
        parentObjectId: entry.parentObjectId ?? "",
        destroyScriptId: entry.destroyScriptId ?? "",
        alarmScriptIds: normalizeAlarmScriptIds((entry as Partial<ObjectAsset>).alarmScriptIds),
        buttonPressedScriptIds: normalizeScriptMap((entry as Partial<ObjectAsset>).buttonPressedScriptIds),
        buttonDownScriptIds: normalizeScriptMap((entry as Partial<ObjectAsset>).buttonDownScriptIds),
        buttonReleasedScriptIds: normalizeScriptMap((entry as Partial<ObjectAsset>).buttonReleasedScriptIds),
      };
    }),
    config: (project.config ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name ?? "",
      valueType:
        (entry as Partial<{ valueType: ConfigValueType; type: ConfigValueType }>).valueType
        ?? (entry as Partial<{ valueType: ConfigValueType; type: ConfigValueType }>).type
        ?? "string",
      value: entry.value ?? "",
    })),
    rooms: rooms.map((room, index) => {
      const seeded = makeDefaultRoom(index);
      const width = room.width ?? seeded.width;
      const height = room.height ?? seeded.height;
      const instanceLayers = (room.instanceLayers?.length ? room.instanceLayers : seeded.instanceLayers).map((layer, layerIndex) => ({
        id: layer.id ?? crypto.randomUUID(),
        name: layer.name ?? createInstanceLayer(layerIndex).name,
        depth: typeof layer.depth === "number" ? layer.depth : createInstanceLayer(layerIndex).depth,
      }));
      const defaultLayerId = instanceLayers[0]?.id ?? "";
      return {
        ...room,
        width,
        height,
        cameraX: clampCameraCoordinate(room.cameraX ?? 0, width, ROOM_VIEW_WIDTH),
        cameraY: clampCameraCoordinate(room.cameraY ?? 0, height, ROOM_VIEW_HEIGHT),
        cameraFollowObjectId: room.cameraFollowObjectId ?? "",
        createScriptIds: normalizeScriptRefs(
          (room as Partial<RoomAsset> & { createScriptId?: string }).createScriptIds,
          (room as Partial<RoomAsset> & { createScriptId?: string }).createScriptId,
        ),
        stepScriptIds: normalizeScriptRefs(
          (room as Partial<RoomAsset> & { stepScriptId?: string }).stepScriptIds,
          (room as Partial<RoomAsset> & { stepScriptId?: string }).stepScriptId,
        ),
        drawScriptIds: normalizeScriptRefs(
          (room as Partial<RoomAsset> & { drawScriptId?: string }).drawScriptIds,
          (room as Partial<RoomAsset> & { drawScriptId?: string }).drawScriptId,
        ),
        destroyScriptIds: normalizeScriptRefs(
          (room as Partial<RoomAsset> & { destroyScriptId?: string }).destroyScriptIds,
          (room as Partial<RoomAsset> & { destroyScriptId?: string }).destroyScriptId,
        ),
        backgroundLayers: (room.backgroundLayers?.length ? room.backgroundLayers : seeded.backgroundLayers).map((layer, layerIndex) => ({
          id: layer.id ?? crypto.randomUUID(),
          name: layer.name ?? createBackgroundLayer(layerIndex).name,
          depth: typeof layer.depth === "number" ? layer.depth : createBackgroundLayer(layerIndex).depth,
          color: layer.color ?? "#d8d8d8",
          spriteId: layer.spriteId ?? "",
          repeat: layer.repeat ?? false,
          parallaxX: parallaxFixedToFactor((layer as Partial<RoomBackgroundLayer>).parallaxX ?? 1),
          parallaxY: parallaxFixedToFactor((layer as Partial<RoomBackgroundLayer>).parallaxY ?? 1),
        })),
        tileLayers: (room.tileLayers ?? []).map((layer) => {
          const columns = layer.columns || Math.max(1, Math.floor(width / Math.max(layer.tileWidth || 16, 1)));
          const rows = layer.rows || Math.max(1, Math.floor(height / Math.max(layer.tileHeight || 16, 1)));
          const expected = columns * rows;
          return {
            id: layer.id ?? crypto.randomUUID(),
            name: layer.name ?? "Tiles",
            depth: typeof layer.depth === "number" ? layer.depth : -100,
            tilesetSpriteId: layer.tilesetSpriteId ?? "",
            tileWidth: layer.tileWidth || 16,
            tileHeight: layer.tileHeight || 16,
            columns,
            rows,
            tiles: layer.tiles?.length === expected ? layer.tiles : new Array(expected).fill(-1),
            collisions: layer.collisions?.length === expected ? layer.collisions : new Array(expected).fill(false),
          };
        }),
        instanceLayers,
        placements: (room.placements ?? []).map((placement) => ({
          ...placement,
          layerId: placement.layerId || defaultLayerId,
        })),
      };
    }),
    sprites: project.sprites.map((sprite) => ({
      ...sprite,
      frameDurationMs: clamp((sprite as Partial<SpriteAsset>).frameDurationMs ?? 0, 0, 65535),
      frames: sprite.frames.map((frame) => makeFrameWithId(frame.id, sprite.width, sprite.height, frame.pixels)),
    })),
  };
}

function createBlankSprite(index: number): SpriteAsset {
  const width = 16;
  const height = 16;
  const pixels = blankPixels(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const indexOffset = (y * width + x) * 4;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const checker = (x + y) % 2 === 0;
      const tone = border ? 72 : checker ? 188 : 208;
      pixels[indexOffset + 0] = tone;
      pixels[indexOffset + 1] = tone;
      pixels[indexOffset + 2] = tone;
      pixels[indexOffset + 3] = 255;
    }
  }

  return {
    id: crypto.randomUUID(),
    name: `spr_${index + 1}`,
    width,
    height,
    frameDurationMs: 0,
    originX: Math.floor(width / 2),
    originY: Math.floor(height / 2),
    bboxLeft: 0,
    bboxTop: 0,
    bboxRight: width - 1,
    bboxBottom: height - 1,
    frames: [makeFrame(width, height, pixels)],
  };
}

type RenamableResourceKind = "sprite" | "object" | "room" | "script" | "config";

function buildCopyName(name: string) {
  const trimmed = name.trim();
  return trimmed ? `${trimmed} Copy` : "Copy";
}

function ensureUniqueName(existingNames: string[], requestedName: string, excludedName = "") {
  const normalizedExisting = new Set(
    existingNames.filter((entry) => entry && entry !== excludedName).map((entry) => entry.toLocaleLowerCase()),
  );
  const baseName = requestedName.trim() || "resource";
  let candidate = baseName;
  let copyIndex = 2;
  while (normalizedExisting.has(candidate.toLocaleLowerCase())) {
    candidate = `${baseName} ${copyIndex}`;
    copyIndex += 1;
  }
  return candidate;
}

function cloneSpriteAsset(sprite: SpriteAsset, name: string): SpriteAsset {
  return {
    ...sprite,
    id: crypto.randomUUID(),
    name,
    frames: sprite.frames.map((frame) => makeFrame(sprite.width, sprite.height, frame.pixels)),
  };
}

function cloneScriptAsset(script: ScriptAsset, name: string): ScriptAsset {
  return {
    ...script,
    id: crypto.randomUUID(),
    name,
  };
}

function cloneObjectAsset(entry: ObjectAsset, name: string): ObjectAsset {
  return {
    ...entry,
    id: crypto.randomUUID(),
    name,
  };
}

function cloneRoomAsset(room: RoomAsset, name: string): RoomAsset {
  const layerIdMap = new Map<string, string>();
  const backgroundLayers = room.backgroundLayers.map((layer) => {
    const id = crypto.randomUUID();
    layerIdMap.set(layer.id, id);
    return { ...layer, id };
  });
  const tileLayers = room.tileLayers.map((layer) => {
    const id = crypto.randomUUID();
    layerIdMap.set(layer.id, id);
    return { ...layer, id };
  });
  const instanceLayers = room.instanceLayers.map((layer) => {
    const id = crypto.randomUUID();
    layerIdMap.set(layer.id, id);
    return { ...layer, id };
  });

  return {
    ...room,
    id: crypto.randomUUID(),
    name,
    backgroundLayers,
    tileLayers,
    instanceLayers,
    placements: room.placements.map((placement) => ({
      ...placement,
      id: crypto.randomUUID(),
      layerId: layerIdMap.get(placement.layerId) ?? placement.layerId,
    })),
  };
}

function getAssetRenamePatterns(kind: RenamableResourceKind) {
  switch (kind) {
    case "sprite":
      return [
        /((?:draw\.(?:sprite|sprite_ui)|sprite\.(?:get|find|exists)|asset\.(?:sprite|sprite_exists))\(\s*)(["'])([^"']*)\2/g,
      ];
    case "object":
      return [
        /((?:object\.(?:get|find|exists)|asset\.(?:object|object_exists)|instance\.(?:create|find_all))\(\s*)(["'])([^"']*)\2/g,
        /((?:instance\.place_meeting|collision\.place_meeting)\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*)(["'])([^"']*)\2/g,
      ];
    case "room":
      return [
        /((?:room\.(?:goto_room|find|exists|get)|asset\.(?:room|room_exists))\(\s*)(["'])([^"']*)\2/g,
      ];
    case "script":
      return [
        /((?:script\.(?:get|find|exists)|asset\.(?:script|script_exists))\(\s*)(["'])([^"']*)\2/g,
      ];
    case "config":
      return [
        /(os\.getenv\(\s*)(["'])([^"']*)\2/g,
      ];
    default:
      return [];
  }
}

function renameReferencesInScripts(scripts: ScriptAsset[], kind: RenamableResourceKind, oldName: string, newName: string) {
  if (!oldName || oldName === newName) {
    return scripts;
  }

  const patterns = getAssetRenamePatterns(kind);
  if (patterns.length === 0) {
    return scripts;
  }

  return scripts.map((script) => {
    let nextCode = script.code;
    for (const pattern of patterns) {
      nextCode = nextCode.replace(pattern, (match, prefix: string, quote: string, value: string) =>
        value === oldName ? `${prefix}${quote}${newName}${quote}` : match,
      );
    }
    return nextCode === script.code ? script : { ...script, code: nextCode };
  });
}

type FocusedEventSelection =
  | { kind: "standard"; field: StandardEventField }
  | { kind: "alarm"; alarmIndex: number }
  | { kind: "button"; field: ButtonEventField; buttonId: string };

function eventSelectionLabel(selection: FocusedEventSelection) {
  if (selection.kind === "standard") {
    return EVENT_BINDINGS.find((binding) => binding.field === selection.field)?.label ?? "Event";
  }
  if (selection.kind === "alarm") {
    return `Alarm ${selection.alarmIndex}`;
  }
  const phase = BUTTON_EVENT_FIELDS.find((entry) => entry.field === selection.field)?.label ?? "Button";
  const button = BUTTON_EVENT_KEYS.find((entry) => entry.id === selection.buttonId)?.label ?? selection.buttonId;
  return `Button ${phase}: ${button}`;
}

function getEventSelectionHint(selection: FocusedEventSelection) {
  if (selection.kind === "standard") {
    return EVENT_BINDINGS.find((binding) => binding.field === selection.field)?.hint ?? "";
  }
  if (selection.kind === "alarm") {
    return "Timed callback";
  }
  return "Calculator key input";
}

function resolveObjectEventScriptId(
  objectId: string,
  selection: FocusedEventSelection,
  objects: ObjectAsset[],
) {
  if (selection.kind === "standard") {
    return resolveInheritedEventScriptId(objectId, selection.field, objects);
  }
  if (selection.kind === "alarm") {
    return resolveInheritedAlarmScriptId(objectId, selection.alarmIndex, objects);
  }
  return resolveInheritedMappedEventScriptId(objectId, selection.field, selection.buttonId, objects);
}

function assignObjectEventScript(entry: ObjectAsset, selection: FocusedEventSelection, scriptId: ScriptRef) {
  if (selection.kind === "standard") {
    return { ...entry, [selection.field]: scriptId };
  }
  if (selection.kind === "alarm") {
    const alarmScriptIds = entry.alarmScriptIds.slice();
    while (alarmScriptIds.length <= selection.alarmIndex) {
      alarmScriptIds.push("");
    }
    alarmScriptIds[selection.alarmIndex] = scriptId;
    return { ...entry, alarmScriptIds };
  }
  return {
    ...entry,
    [selection.field]: {
      ...entry[selection.field],
      [selection.buttonId]: scriptId,
    },
  };
}

function defaultObjectEventCode(selection: FocusedEventSelection) {
  if (selection.kind === "standard") {
    switch (selection.field) {
      case "createScriptId":
      case "stepScriptId":
      case "destroyScriptId":
        return ["return function(self)", "  ", "end"].join("\n");
      case "drawScriptId":
        return ["return function(self)", "  draw.sprite(self.sprite_id, self.x, self.y, self.image_index)", "end"].join("\n");
      case "collisionScriptId":
        return ["return function(self, other)", "  if other then", "    ", "  end", "end"].join("\n");
    }
  }

  if (selection.kind === "alarm") {
    return ["return function(self)", "  ", "end"].join("\n");
  }

  return ["return function(self)", "  ", "end"].join("\n");
}

function buildObjectEventScriptName(objectName: string, selection: FocusedEventSelection) {
  if (selection.kind === "standard") {
    const suffixMap: Record<StandardEventField, string> = {
      createScriptId: "create",
      stepScriptId: "step",
      drawScriptId: "draw",
      destroyScriptId: "destroy",
      collisionScriptId: "collision",
    };
    return `${objectName}_${suffixMap[selection.field]}`;
  }
  if (selection.kind === "alarm") {
    return `${objectName}_alarm_${selection.alarmIndex}`;
  }
  const phaseMap: Record<ButtonEventField, string> = {
    buttonPressedScriptIds: "button_pressed",
    buttonDownScriptIds: "button_down",
    buttonReleasedScriptIds: "button_released",
  };
  return `${objectName}_${phaseMap[selection.field]}_${selection.buttonId.replace(/^key_/, "")}`;
}

async function fileToImage(file: File): Promise<ImportedImage> {
  const url = URL.createObjectURL(file);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const width = Math.max(1, bitmap.width);
    const height = Math.max(1, bitmap.height);

    if (width > MAX_IMPORT_DIMENSION || height > MAX_IMPORT_DIMENSION) {
      throw new Error(
        `Imported images larger than ${MAX_IMPORT_DIMENSION}x${MAX_IMPORT_DIMENSION} are blocked. Your image is ${width}x${height}.`,
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser could not prepare the imported image.");
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);

    return {
      baseName: file.name.replace(/\.[^.]+$/, "") || "spr_imported",
      width,
      height,
      pixels: Array.from(context.getImageData(0, 0, width, height).data),
    };
  } catch (error) {
    throw new Error(error instanceof Error ? `Image import failed: ${error.message}` : "Image import failed.");
  } finally {
    bitmap?.close();
    URL.revokeObjectURL(url);
  }
}

async function fileToSprite(file: File) {
  const image = await fileToImage(file);
  return {
    id: crypto.randomUUID(),
    name: image.baseName,
    width: image.width,
    height: image.height,
    frameDurationMs: 0,
    originX: Math.floor(image.width / 2),
    originY: Math.floor(image.height / 2),
    bboxLeft: 0,
    bboxTop: 0,
    bboxRight: image.width - 1,
    bboxBottom: image.height - 1,
    frames: [makeFrame(image.width, image.height, image.pixels)],
  } satisfies SpriteAsset;
}

function lspPositionToMonaco(value?: number) {
  return typeof value === "number" ? value + 1 : undefined;
}

function lspDocumentationToString(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => lspDocumentationToString(entry)).filter(Boolean).join("\n\n");
  }
  if (typeof value === "object") {
    const objectValue = value as { value?: unknown; language?: unknown };
    if (typeof objectValue.value === "string") {
      if (typeof objectValue.language === "string" && objectValue.language) {
        return ["```" + objectValue.language, objectValue.value, "```"].join("\n");
      }
      return objectValue.value;
    }
  }
  return undefined;
}

function lspRangeToMonaco(
  range:
    | {
        start?: { line?: number; character?: number };
        end?: { line?: number; character?: number };
      }
    | undefined,
  fallbackLine: number,
  fallbackColumn: number,
) {
  return {
    startLineNumber: lspPositionToMonaco(range?.start?.line) ?? fallbackLine,
    startColumn: lspPositionToMonaco(range?.start?.character) ?? fallbackColumn,
    endLineNumber: lspPositionToMonaco(range?.end?.line) ?? fallbackLine,
    endColumn: lspPositionToMonaco(range?.end?.character) ?? fallbackColumn,
  };
}

function lspSeverityToMonaco(monaco: Monaco, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

function lspCompletionKindToMonaco(monaco: Monaco, kind?: number) {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Unit;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 19:
      return monaco.languages.CompletionItemKind.Folder;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    case 22:
      return monaco.languages.CompletionItemKind.Struct;
    case 23:
      return monaco.languages.CompletionItemKind.Event;
    case 24:
      return monaco.languages.CompletionItemKind.Operator;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function isLuaLsFileUri(uri: string) {
  return uri.startsWith("file://");
}

function parseOutputTraceReferences(message: string) {
  const references: OutputTraceReference[] = [];
  const patterns = [
    /\[string\s+"@([^"\n]+)\.lua"\]:(\d+)/g,
    /\b([A-Za-z0-9_./-]+)\.lua:(\d+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(message);
    while (match) {
      const scriptName = match[1];
      const line = Number.parseInt(match[2], 10);
      if (scriptName && Number.isFinite(line)) {
        const label = `${scriptName}.lua:${line}`;
        const start = message.indexOf(label, match.index);
        if (start >= 0) {
          references.push({
            scriptName,
            line,
            start,
            end: start + label.length,
          });
        }
      }
      match = pattern.exec(message);
    }
  }

  references.sort((left, right) => left.start - right.start);
  return references.filter((reference, index) => index === 0 || reference.start >= references[index - 1].end);
}

function slugifyProjectName(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "nwge-game";
}

function createStarterProject(): StudioProject {
  const width = 8;
  const height = 8;
  const playerPixels = monoRowsToPixels([60, 126, 219, 255, 255, 102, 36, 36], width, height);
  const idleFrame = makeFrame(width, height, playerPixels);
  const blinkPixels = clonePixels(playerPixels);
  const leftEyeOffset = (2 * width + 2) * 4;
  const rightEyeOffset = (2 * width + 5) * 4;
  blinkPixels[leftEyeOffset] = 20;
  blinkPixels[leftEyeOffset + 1] = 36;
  blinkPixels[leftEyeOffset + 2] = 52;
  blinkPixels[leftEyeOffset + 3] = 255;
  blinkPixels[rightEyeOffset] = 20;
  blinkPixels[rightEyeOffset + 1] = 36;
  blinkPixels[rightEyeOffset + 2] = 52;
  blinkPixels[rightEyeOffset + 3] = 255;
  const blinkFrame = makeFrame(width, height, blinkPixels);

  const spriteId = crypto.randomUUID();
  const createScriptId = crypto.randomUUID();
  const stepScriptId = crypto.randomUUID();
  const drawScriptId = crypto.randomUUID();
  const collisionScriptId = crypto.randomUUID();
  const objectId = crypto.randomUUID();

  return {
    name: "Pocket Runner",
    themeMode: "dark",
    packPath: DEFAULT_PACK_PATH,
    projectPath: DEFAULT_PROJECT_PATH,
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    iconSpriteId: spriteId,
    sprites: [
      {
        id: spriteId,
        name: "spr_player",
        width,
        height,
        frameDurationMs: 0,
        originX: 4,
        originY: 4,
        bboxLeft: 0,
        bboxTop: 0,
        bboxRight: 7,
        bboxBottom: 7,
        frames: [idleFrame, blinkFrame],
      },
    ],
    scripts: [
      {
        id: createScriptId,
        name: "obj_player_create",
        code: ["return function(self)", "  self.image_index = 0", "end"].join("\n"),
      },
      {
        id: stepScriptId,
        name: "obj_player_step",
        code: [
          "return function(self)",
          "  if input.down('key_left') then self.x = self.x - 2 end",
          "  if input.down('key_right') then self.x = self.x + 2 end",
          "  if input.down('key_up') then self.y = self.y - 2 end",
          "  if input.down('key_down') then self.y = self.y + 2 end",
          "  if input.pressed('key_ok') then",
          "    self.image_index = 1",
          "    wait(.3)",
          "    self.image_index = 0",
          "  end",
          "end",
        ].join("\n"),
      },
      {
        id: drawScriptId,
        name: "obj_player_draw",
        code: [
          "return function(self)",
          "  draw.sprite(self.sprite_id, self.x, self.y, self.image_index)",
          "  draw.text(6, 6, 'Studio preview pack')",
          "end",
        ].join("\n"),
      },
      {
        id: collisionScriptId,
        name: "obj_player_collision",
        code: [
          "return function(self, other)",
          "  if other then",
          "    print('collision with instance ' .. other.id)",
          "  end",
          "end",
        ].join("\n"),
      },
    ],
    config: [
      { id: crypto.randomUUID(), name: "GAME_TITLE", valueType: "string", value: "Studio Preview" },
      { id: crypto.randomUUID(), name: "PLAYER_SPEED", valueType: "number", value: "2" },
      { id: crypto.randomUUID(), name: "DEBUG_MODE", valueType: "boolean", value: "true" },
    ],
    gameCreateScriptIds: [],
    gameStepScriptIds: [],
    gameDrawScriptIds: [],
    gameDestroyScriptIds: [],
    objects: [
      {
        id: objectId,
        name: "obj_player",
        parentObjectId: "",
        spriteId,
        createScriptId,
        stepScriptId,
        drawScriptId,
        destroyScriptId: "",
        collisionScriptId,
        collisionObjectId: "",
        alarmScriptIds: new Array(ALARM_EVENT_COUNT).fill(""),
        buttonPressedScriptIds: {},
        buttonDownScriptIds: {},
        buttonReleasedScriptIds: {},
      },
    ],
    rooms: [
      (() => {
        const room = makeDefaultRoom(0, objectId, spriteId);
        const instanceLayerId = room.instanceLayers[0]?.id ?? "";
        room.cameraFollowObjectId = objectId;
        room.placements = room.placements.map((placement) => ({ ...placement, layerId: instanceLayerId }));
        return room;
      })(),
    ],
  };
}

const starterProject = createStarterProject();

function App() {
  const [project, setProject] = useState<StudioProject>(starterProject);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("room");
  const [selectedSpriteId, setSelectedSpriteId] = useState(starterProject.sprites[0]?.id ?? "");
  const [selectedFrameId, setSelectedFrameId] = useState(starterProject.sprites[0]?.frames[0]?.id ?? "");
  const [selectedScriptId, setSelectedScriptId] = useState(starterProject.scripts[0]?.id ?? "");
  const [selectedObjectId, setSelectedObjectId] = useState(starterProject.objects[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(starterProject.rooms[0]?.id ?? "");
  const [selectedPlacementId, setSelectedPlacementId] = useState(starterProject.rooms[0]?.placements[0]?.id ?? "");
  const [selectedRoomLayerKind, setSelectedRoomLayerKind] = useState<RoomLayerKind>("instance");
  const [selectedRoomLayerId, setSelectedRoomLayerId] = useState(starterProject.rooms[0]?.instanceLayers[0]?.id ?? "");
  const [selectedTileIndex, setSelectedTileIndex] = useState(0);
  const [tileEditMode, setTileEditMode] = useState<TileEditMode>("art");
  const [showTileCollisionOverlay, setShowTileCollisionOverlay] = useState(true);
  const [focusedEventKind, setFocusedEventKind] = useState<FocusedEventSelection["kind"]>("standard");
  const [focusedEventField, setFocusedEventField] = useState<StandardEventField>("createScriptId");
  const [focusedAlarmIndex, setFocusedAlarmIndex] = useState(0);
  const [focusedButtonField, setFocusedButtonField] = useState<ButtonEventField>("buttonPressedScriptIds");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(BUTTON_EVENT_KEYS[0]?.id ?? "key_left");
  const [roomTool, setRoomTool] = useState<RoomTool>("select");
  const [spriteTool, setSpriteTool] = useState<SpriteTool>("draw");
  const [spriteZoom, setSpriteZoom] = useState(SPRITE_EDITOR_DEFAULT_ZOOM);
  const [spriteBrushSize, setSpriteBrushSize] = useState(1);
  const [spriteColor, setSpriteColor] = useState("#1a1a1a");
  const [spriteSelection, setSpriteSelection] = useState<SpriteSelection | null>(null);
  const [spriteInteraction, setSpriteInteraction] = useState<SpriteEditorInteraction | null>(null);
  const [roomGridSize, setRoomGridSize] = useState(16);
  const [showRoomGrid, setShowRoomGrid] = useState(true);
  const [snapRoomGrid, setSnapRoomGrid] = useState(true);
  const [toast, setToast] = useState<ToastState>({
    message: "Studio ready. Select a resource from the tree to begin editing.",
    tone: "neutral",
  });
  const [busyAction, setBusyAction] = useState("");
  const [dragPlacement, setDragPlacement] = useState<DragPlacementState | null>(null);
  const [roomPaintStroke, setRoomPaintStroke] = useState<RoomPaintStrokeState | null>(null);
  const [roomPointer, setRoomPointer] = useState<RoomPointerState>({ inside: false, x: 0, y: 0 });
  const [scriptUris, setScriptUris] = useState<Record<string, string>>({});
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => readRecentProjects());
  const [showLauncher, setShowLauncher] = useState(true);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportSupport, setExportSupport] = useState<ExportSupportResult | null>(null);
  const [treeSections, setTreeSections] = useState<TreeSectionState>({
    settings: true,
    rooms: true,
    objects: true,
    sprites: true,
    scripts: true,
  });
  const [resourceSearch, setResourceSearch] = useState("");
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
  const [activePreviewRunId, setActivePreviewRunId] = useState("");
  const [previewConsoleCommand, setPreviewConsoleCommand] = useState("");
  const [resourcePaneWidth, setResourcePaneWidth] = useState(DEFAULT_RESOURCE_PANE_WIDTH);
  const [propertiesPaneWidth, setPropertiesPaneWidth] = useState(DEFAULT_PROPERTIES_PANE_WIDTH);
  const [outputPaneHeight, setOutputPaneHeight] = useState(DEFAULT_OUTPUT_PANE_HEIGHT);
  const [resourcePaneCollapsed, setResourcePaneCollapsed] = useState(false);
  const [outputPaneCollapsed, setOutputPaneCollapsed] = useState(true);
  const [savedProjectSignature, setSavedProjectSignature] = useState(() => createProjectSignature(starterProject));
  const [paneResizeState, setPaneResizeState] = useState<PaneResizeState | null>(null);
  const [runtimeDocMarkdown, setRuntimeDocMarkdown] = useState<Record<RuntimeDocId, string>>({
    "lua-api": "",
    "studio-editors": "",
    "studio-tutorial": "",
  });
  const [runtimeDocState, setRuntimeDocState] = useState<Record<RuntimeDocId, RuntimeDocLoadState>>({
    "lua-api": "loading",
    "studio-editors": "loading",
    "studio-tutorial": "loading",
  });
  const [runtimeDocError, setRuntimeDocError] = useState<Record<RuntimeDocId, string>>({
    "lua-api": "",
    "studio-editors": "",
    "studio-tutorial": "",
  });
  const [selectedRuntimeDocId, setSelectedRuntimeDocId] = useState<RuntimeDocId>("lua-api");
  const [pendingRuntimeDocAnchor, setPendingRuntimeDocAnchor] = useState("");

  const studioGridRef = useRef<HTMLDivElement | null>(null);
  const docsPanelBodyRef = useRef<HTMLDivElement | null>(null);
  const roomStageRef = useRef<HTMLDivElement | null>(null);
  const spriteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spriteInteractionRef = useRef<SpriteEditorInteraction | null>(null);
  const spriteHistoryRef = useRef<Record<string, SpriteHistoryEntry>>({});
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const workspaceSyncTimerRef = useRef<number | null>(null);
  const documentSyncTimerRef = useRef<number | null>(null);
  const luaDocumentVersionsRef = useRef<Record<string, number>>({});
  const importSpriteInputRef = useRef<HTMLInputElement | null>(null);
  const importFrameInputRef = useRef<HTMLInputElement | null>(null);
  const outputEntryIdRef = useRef(0);
  const outputConsoleRef = useRef<HTMLDivElement | null>(null);
  const pendingScriptNavigationRef = useRef<PendingScriptNavigation | null>(null);

  const selectedSprite = useMemo(
    () => project.sprites.find((sprite) => sprite.id === selectedSpriteId) ?? null,
    [project.sprites, selectedSpriteId],
  );
  const selectedFrame = useMemo(
    () => selectedSprite?.frames.find((frame) => frame.id === selectedFrameId) ?? selectedSprite?.frames[0] ?? null,
    [selectedFrameId, selectedSprite],
  );
  const spriteDisplayPixels = spriteInteraction?.previewPixels ?? selectedFrame?.pixels ?? null;
  const activeSpriteSelection = spriteInteraction?.selectionPreview ?? spriteSelection;
  const selectedScript = useMemo(
    () => project.scripts.find((script) => script.id === selectedScriptId) ?? null,
    [project.scripts, selectedScriptId],
  );
  const selectedObject = useMemo(
    () => project.objects.find((entry) => entry.id === selectedObjectId) ?? null,
    [project.objects, selectedObjectId],
  );
  const selectedRoom = useMemo(
    () => project.rooms.find((room) => room.id === selectedRoomId) ?? project.rooms[0] ?? null,
    [project.rooms, selectedRoomId],
  );
  const selectedPlacement = useMemo(
    () => selectedRoom?.placements.find((placement) => placement.id === selectedPlacementId) ?? null,
    [selectedPlacementId, selectedRoom],
  );
  const selectedBackgroundLayer = useMemo(
    () => selectedRoom?.backgroundLayers.find((layer) => layer.id === selectedRoomLayerId) ?? selectedRoom?.backgroundLayers[0] ?? null,
    [selectedRoom, selectedRoomLayerId],
  );
  const selectedTileLayer = useMemo(
    () => selectedRoom?.tileLayers.find((layer) => layer.id === selectedRoomLayerId) ?? selectedRoom?.tileLayers[0] ?? null,
    [selectedRoom, selectedRoomLayerId],
  );
  const selectedInstanceLayer = useMemo(
    () => selectedRoom?.instanceLayers.find((layer) => layer.id === selectedRoomLayerId) ?? selectedRoom?.instanceLayers[0] ?? null,
    [selectedRoom, selectedRoomLayerId],
  );
  const orderedRoomLayers = useMemo(() => {
    if (!selectedRoom) {
      return [] as Array<{ kind: RoomLayerKind; id: string; name: string; depth: number }>;
    }
    return [
      ...selectedRoom.backgroundLayers.map((layer) => ({ kind: "background" as const, id: layer.id, name: layer.name, depth: layer.depth })),
      ...selectedRoom.tileLayers.map((layer) => ({ kind: "tile" as const, id: layer.id, name: layer.name, depth: layer.depth })),
      ...selectedRoom.instanceLayers.map((layer) => ({ kind: "instance" as const, id: layer.id, name: layer.name, depth: layer.depth })),
    ].sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name));
  }, [selectedRoom]);
  const activeRoomLayer =
    selectedRoomLayerKind === "background"
      ? selectedBackgroundLayer
      : selectedRoomLayerKind === "tile"
        ? selectedTileLayer
        : selectedInstanceLayer;

  const objectSpriteLookup = useMemo(() => {
    const spriteById = new Map(project.sprites.map((sprite) => [sprite.id, sprite]));
    return new Map(
      project.objects.map((entry) => [
        entry.id,
        spriteById.get(resolveInheritedObjectSpriteId(entry.id, project.objects)) ?? null,
      ]),
    );
  }, [project.objects, project.sprites]);

  const selectedObjectSprite = selectedObject
    ? project.sprites.find((sprite) => sprite.id === resolveInheritedObjectSpriteId(selectedObject.id, project.objects)) ?? null
    : null;
  const selectedTileSprite = selectedTileLayer
    ? project.sprites.find((sprite) => sprite.id === selectedTileLayer.tilesetSpriteId) ?? null
    : null;
  const focusedEventSelection: FocusedEventSelection =
    focusedEventKind === "alarm"
      ? { kind: "alarm", alarmIndex: focusedAlarmIndex }
      : focusedEventKind === "button"
        ? { kind: "button", field: focusedButtonField, buttonId: focusedButtonId }
        : { kind: "standard", field: focusedEventField };
  const focusedEventMeta = {
    label: eventSelectionLabel(focusedEventSelection),
    icon: focusedEventSelection.kind === "standard"
      ? EVENT_BINDINGS.find((binding) => binding.field === focusedEventField)?.icon ?? "event"
      : "event" as IconName,
    hint: getEventSelectionHint(focusedEventSelection),
  };
  const focusedEventScriptId = selectedObject
    ? resolveObjectEventScriptId(selectedObject.id, focusedEventSelection, project.objects)
    : "";
  const focusedEventScript = project.scripts.find((script) => script.id === focusedEventScriptId) ?? null;
  const selectedScriptUri = selectedScript ? scriptUris[selectedScript.id] ?? "" : "";
  const focusedEventScriptUri = focusedEventScript ? scriptUris[focusedEventScript.id] ?? "" : "";
  const liveSpritePreviewUrl = useMemo(
    () => (selectedSprite && spriteDisplayPixels ? pixelsToDataUrl(selectedSprite.width, selectedSprite.height, spriteDisplayPixels) : ""),
    [selectedSprite, spriteDisplayPixels],
  );
  const selectedTileOptions = useMemo(() => {
    if (!selectedTileLayer || !selectedTileSprite || selectedTileSprite.frames.length === 0) {
      return [] as Array<{ index: number; previewUrl: string }>;
    }
    return selectedTileSprite.frames.map((frame, index) => ({
      index,
      previewUrl: frame.previewUrl,
    }));
  }, [selectedTileLayer, selectedTileSprite]);
  const runtimeDocHtml = useMemo(
    () =>
      Object.fromEntries(
        RUNTIME_DOCS.map((entry) => [entry.id, markdownToHtml(runtimeDocMarkdown[entry.id], entry.id)]),
      ) as Record<RuntimeDocId, string>,
    [runtimeDocMarkdown],
  );
  const roomViewportWidth = Math.min(selectedRoom?.width ?? ROOM_VIEW_WIDTH, ROOM_VIEW_WIDTH);
  const roomViewportHeight = Math.min(selectedRoom?.height ?? ROOM_VIEW_HEIGHT, ROOM_VIEW_HEIGHT);
  const currentProjectSignature = useMemo(() => createProjectSignature(project), [project]);
  const hasUnsavedChanges = currentProjectSignature !== savedProjectSignature;
  const normalizedResourceSearch = resourceSearch.trim().toLocaleLowerCase();
  const matchesResourceSearch = (value: string) => normalizedResourceSearch === "" || value.toLocaleLowerCase().includes(normalizedResourceSearch);
  const filteredRooms = useMemo(
    () => project.rooms.filter((room) => matchesResourceSearch(room.name)),
    [normalizedResourceSearch, project.rooms],
  );
  const filteredObjects = useMemo(
    () => project.objects.filter((entry) => matchesResourceSearch(entry.name)),
    [normalizedResourceSearch, project.objects],
  );
  const filteredSprites = useMemo(
    () => project.sprites.filter((sprite) => matchesResourceSearch(sprite.name)),
    [normalizedResourceSearch, project.sprites],
  );
  const filteredScripts = useMemo(
    () => project.scripts.filter((script) => matchesResourceSearch(script.name)),
    [normalizedResourceSearch, project.scripts],
  );
  const hasResourceMatches =
    normalizedResourceSearch === ""
    || matchesResourceSearch("Project")
    || matchesResourceSearch("Preview")
    || filteredRooms.length > 0
    || filteredObjects.length > 0
    || filteredSprites.length > 0
    || filteredScripts.length > 0;
  const studioGridStyle = useMemo(
    () =>
      ({
        "--resource-pane-width": `${resourcePaneCollapsed ? COLLAPSED_RESOURCE_PANE_WIDTH : resourcePaneWidth}px`,
        "--properties-pane-width": `${propertiesPaneWidth}px`,
        "--output-pane-height": `${outputPaneCollapsed ? COLLAPSED_OUTPUT_PANE_HEIGHT : outputPaneHeight}px`,
        "--studio-pane-resizer-size": `${STUDIO_PANE_RESIZER_SIZE}px`,
      }) as CSSProperties,
    [outputPaneCollapsed, outputPaneHeight, propertiesPaneWidth, resourcePaneCollapsed, resourcePaneWidth],
  );

  const gameEventFieldMap: Record<(typeof LIFECYCLE_EVENTS)[number]["key"], GameEventField> = {
    create: "gameCreateScriptIds",
    step: "gameStepScriptIds",
    draw: "gameDrawScriptIds",
    destroy: "gameDestroyScriptIds",
  };

  const roomEventFieldMap: Record<(typeof LIFECYCLE_EVENTS)[number]["key"], RoomEventField> = {
    create: "createScriptIds",
    step: "stepScriptIds",
    draw: "drawScriptIds",
    destroy: "destroyScriptIds",
  };

  useEffect(() => {
    let cancelled = false;

    setRuntimeDocState({
      "lua-api": "loading",
      "studio-editors": "loading",
      "studio-tutorial": "loading",
    });

    for (const doc of RUNTIME_DOCS) {
      void invoke<string>("load_runtime_markdown_doc", { docName: doc.fileName })
        .then((markdown) => {
          if (cancelled) {
            return;
          }
          setRuntimeDocMarkdown((current) => ({ ...current, [doc.id]: markdown }));
          setRuntimeDocError((current) => ({ ...current, [doc.id]: "" }));
          setRuntimeDocState((current) => ({ ...current, [doc.id]: "ready" }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setRuntimeDocMarkdown((current) => ({ ...current, [doc.id]: "" }));
          setRuntimeDocError((current) => ({ ...current, [doc.id]: describeError(error) }));
          setRuntimeDocState((current) => ({ ...current, [doc.id]: "error" }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const panel = docsPanelBodyRef.current;
    if (!panel) {
      return;
    }

    const selectedDocState = runtimeDocState[selectedRuntimeDocId];
    if (selectedDocState !== "ready") {
      return;
    }

    if (pendingRuntimeDocAnchor) {
      const target = panel.querySelector<HTMLElement>(`#${CSS.escape(pendingRuntimeDocAnchor)}`);
      if (target) {
        target.scrollIntoView({ block: "start" });
      }
      setPendingRuntimeDocAnchor("");
      return;
    }

    panel.scrollTo({ top: 0 });
  }, [pendingRuntimeDocAnchor, runtimeDocState, selectedRuntimeDocId]);

  useEffect(() => {
    if (!selectedSprite && project.sprites[0]) {
      setSelectedSpriteId(project.sprites[0].id);
    }
    if (selectedSprite && !selectedFrame) {
      setSelectedFrameId(selectedSprite.frames[0]?.id ?? "");
    }
  }, [project.sprites, selectedFrame, selectedSprite]);

  useEffect(() => {
    spriteInteractionRef.current = null;
    setSpriteSelection(null);
    setSpriteInteraction(null);
  }, [selectedFrameId, selectedSpriteId]);

  useEffect(() => {
    const canvas = spriteCanvasRef.current;
    if (!canvas || !selectedSprite || !spriteDisplayPixels) {
      return;
    }

    const scaledWidth = selectedSprite.width * spriteZoom;
    const scaledHeight = selectedSprite.height * spriteZoom;
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, scaledWidth, scaledHeight);

    for (let y = 0; y < selectedSprite.height; y += 1) {
      for (let x = 0; x < selectedSprite.width; x += 1) {
        context.fillStyle = (x + y) % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
        context.fillRect(x * spriteZoom, y * spriteZoom, spriteZoom, spriteZoom);
      }
    }

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = selectedSprite.width;
    sourceCanvas.height = selectedSprite.height;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) {
      return;
    }

    const imageData = sourceContext.createImageData(selectedSprite.width, selectedSprite.height);
    imageData.data.set(Uint8ClampedArray.from(spriteDisplayPixels));
    sourceContext.putImageData(imageData, 0, 0);

    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight);

    if (spriteZoom >= 8) {
      context.strokeStyle = "rgba(0, 0, 0, 0.2)";
      context.lineWidth = 1;
      for (let x = 0; x <= selectedSprite.width; x += 1) {
        const lineX = x * spriteZoom + 0.5;
        context.beginPath();
        context.moveTo(lineX, 0);
        context.lineTo(lineX, scaledHeight);
        context.stroke();
      }
      for (let y = 0; y <= selectedSprite.height; y += 1) {
        const lineY = y * spriteZoom + 0.5;
        context.beginPath();
        context.moveTo(0, lineY);
        context.lineTo(scaledWidth, lineY);
        context.stroke();
      }
    }

    if (activeSpriteSelection) {
      const selectionLeft = activeSpriteSelection.left * spriteZoom + 0.5;
      const selectionTop = activeSpriteSelection.top * spriteZoom + 0.5;
      const selectionWidth = (activeSpriteSelection.right - activeSpriteSelection.left + 1) * spriteZoom - 1;
      const selectionHeight = (activeSpriteSelection.bottom - activeSpriteSelection.top + 1) * spriteZoom - 1;

      context.save();
      context.fillStyle = "rgba(88, 101, 242, 0.14)";
      context.fillRect(selectionLeft - 0.5, selectionTop - 0.5, selectionWidth + 1, selectionHeight + 1);
      context.setLineDash([6, 4]);
      context.lineWidth = 2;
      context.strokeStyle = "rgba(255, 255, 255, 0.95)";
      context.strokeRect(selectionLeft, selectionTop, selectionWidth, selectionHeight);
      context.lineDashOffset = -5;
      context.strokeStyle = "rgba(17, 24, 39, 0.9)";
      context.strokeRect(selectionLeft, selectionTop, selectionWidth, selectionHeight);
      context.restore();
    }
  }, [activeSpriteSelection, selectedSprite, spriteDisplayPixels, spriteZoom]);

  useEffect(() => {
    if (!selectedScript && project.scripts[0]) {
      setSelectedScriptId(project.scripts[0].id);
    }
    if (!selectedObject && project.objects[0]) {
      setSelectedObjectId(project.objects[0].id);
    }
  }, [project.objects, project.scripts, selectedObject, selectedScript]);

  useEffect(() => {
    if (!selectedRoom && project.rooms[0]) {
      setSelectedRoomId(project.rooms[0].id);
    }
    if (selectedPlacementId && !selectedPlacement) {
      setSelectedPlacementId(selectedRoom?.placements[0]?.id ?? "");
    }
  }, [project.rooms, selectedPlacement, selectedPlacementId, selectedRoom]);

  useEffect(() => {
    if (!selectedRoom) {
      return;
    }

    const activeLayerExists =
      (selectedRoomLayerKind === "background" && selectedRoom.backgroundLayers.some((layer) => layer.id === selectedRoomLayerId))
      || (selectedRoomLayerKind === "tile" && selectedRoom.tileLayers.some((layer) => layer.id === selectedRoomLayerId))
      || (selectedRoomLayerKind === "instance" && selectedRoom.instanceLayers.some((layer) => layer.id === selectedRoomLayerId));

    if (activeLayerExists) {
      return;
    }

    if (selectedRoom.instanceLayers[0]) {
      setSelectedRoomLayerKind("instance");
      setSelectedRoomLayerId(selectedRoom.instanceLayers[0].id);
      return;
    }
    if (selectedRoom.tileLayers[0]) {
      setSelectedRoomLayerKind("tile");
      setSelectedRoomLayerId(selectedRoom.tileLayers[0].id);
      return;
    }
    if (selectedRoom.backgroundLayers[0]) {
      setSelectedRoomLayerKind("background");
      setSelectedRoomLayerId(selectedRoom.backgroundLayers[0].id);
    }
  }, [selectedRoom, selectedRoomLayerId, selectedRoomLayerKind]);

  useEffect(() => {
    if (selectedTileOptions.length === 0) {
      setSelectedTileIndex(0);
      return;
    }
    setSelectedTileIndex((current) => clamp(current, 0, selectedTileOptions.length - 1));
  }, [selectedTileOptions]);

  useEffect(() => {
    document.documentElement.dataset.theme = project.themeMode;
    if (monacoRef.current) {
      applyMonacoTheme(monacoRef.current, project.themeMode);
    }
  }, [project.themeMode]);

  useEffect(() => {
    document.title = `${hasUnsavedChanges ? "* " : ""}${project.name} - NumWorks Game Engine Studio`;
  }, [hasUnsavedChanges, project.name]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape") {
        if (!isEditableTarget && workspaceView === "room" && selectedPlacementId) {
          event.preventDefault();
          setSelectedPlacementId("");
          setDragPlacement(null);
        }
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!isEditableTarget && workspaceView === "sprite") {
        if (key === "z" && event.shiftKey) {
          event.preventDefault();
          redoSpriteEdit();
          return;
        }

        if (key === "z") {
          event.preventDefault();
          undoSpriteEdit();
          return;
        }

        if (key === "y") {
          event.preventDefault();
          redoSpriteEdit();
          return;
        }
      }

      if (key === "n") {
        event.preventDefault();
        if (!busyAction) {
          startNewProject();
        }
        return;
      }

      if (key === "o") {
        event.preventDefault();
        if (!busyAction) {
          void loadProject();
        }
        return;
      }

      if (key === "s") {
        event.preventDefault();
        if (!busyAction) {
          void saveProject();
        }
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [busyAction, loadProject, redoSpriteEdit, saveProject, selectedPlacementId, startNewProject, undoSpriteEdit, workspaceView]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const applyDiagnostics = (payload: LuaLsDiagnosticsPayload) => {
      const monaco = monacoRef.current;
      if (!monaco || !payload.uri) {
        return;
      }
      const model = monaco.editor.getModel(monaco.Uri.parse(payload.uri));
      if (!model) {
        return;
      }
      const markers = (payload.diagnostics ?? []).map((diagnostic) => ({
        message: diagnostic.message ?? "LuaLS reported a problem.",
        severity: lspSeverityToMonaco(monaco, diagnostic.severity),
        source: diagnostic.source ?? "LuaLS",
        ...lspRangeToMonaco(diagnostic.range, 1, 1),
      }));
      monaco.editor.setModelMarkers(model, LUA_LS_MARKER_OWNER, markers);
    };

    void listen<LuaLsDiagnosticsPayload>("lua-ls-diagnostics", (event) => {
      applyDiagnostics(event.payload);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      void invoke("lua_ls_shutdown").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen<PreviewOutputPayload>(PREVIEW_OUTPUT_EVENT, (event) => {
      const id = outputEntryIdRef.current;
      outputEntryIdRef.current += 1;
      setOutputEntries((current) => [
        ...current.slice(-(MAX_OUTPUT_ENTRIES - 1)),
        { id, runId: event.payload.runId, stream: event.payload.stream, message: event.payload.message },
      ]);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const node = outputConsoleRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [outputEntries]);

  useEffect(() => {
    if (!showExportPanel) {
      return;
    }

    let cancelled = false;
    void invoke<ExportSupportResult>("inspect_export_support", { runtimeRoot: project.runtimeRoot })
      .then((status) => {
        if (!cancelled) {
          setExportSupport(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExportSupport(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.runtimeRoot, showExportPanel]);

  function applyPendingScriptNavigation() {
    const pending = pendingScriptNavigationRef.current;
    const editor = editorRef.current;
    if (!pending || !editor || workspaceView !== "script" || selectedScriptId !== pending.scriptId) {
      return false;
    }

    const model = editor.getModel();
    const expectedUri = scriptUris[pending.scriptId];
    if (expectedUri && model?.uri.toString() !== expectedUri) {
      return false;
    }
    const maxLine = model?.getLineCount() ?? pending.line;
    const line = Math.max(1, Math.min(pending.line, maxLine));
    const column = model?.getLineFirstNonWhitespaceColumn(line) || 1;

    editor.focus();
    editor.setPosition({ lineNumber: line, column });
    editor.revealLineInCenter(line);
    pendingScriptNavigationRef.current = null;
    return true;
  }

  useEffect(() => {
    applyPendingScriptNavigation();
  }, [selectedScriptId, workspaceView, selectedScriptUri, scriptUris]);

  useEffect(() => {
    if (!paneResizeState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = studioGridRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      if (paneResizeState.pane === "resources") {
        const maxWidth = Math.max(
          MIN_RESOURCE_PANE_WIDTH,
          rect.width - paneResizeState.propertiesWidth - MIN_WORKSPACE_WIDTH - STUDIO_PANE_RESIZER_SIZE * 2,
        );
        const nextWidth = clamp(
          paneResizeState.resourceWidth + (event.clientX - paneResizeState.startX),
          MIN_RESOURCE_PANE_WIDTH,
          maxWidth,
        );
        setResourcePaneWidth(nextWidth);
        return;
      }

      if (paneResizeState.pane === "properties") {
        const maxWidth = Math.max(
          MIN_PROPERTIES_PANE_WIDTH,
          rect.width - paneResizeState.resourceWidth - MIN_WORKSPACE_WIDTH - STUDIO_PANE_RESIZER_SIZE * 2,
        );
        const nextWidth = clamp(
          paneResizeState.propertiesWidth - (event.clientX - paneResizeState.startX),
          MIN_PROPERTIES_PANE_WIDTH,
          maxWidth,
        );
        setPropertiesPaneWidth(nextWidth);
        return;
      }

      const maxHeight = Math.max(MIN_OUTPUT_PANE_HEIGHT, rect.height - MIN_WORKSPACE_HEIGHT - STUDIO_PANE_RESIZER_SIZE);
      const nextHeight = clamp(
        paneResizeState.outputHeight - (event.clientY - paneResizeState.startY),
        MIN_OUTPUT_PANE_HEIGHT,
        maxHeight,
      );
      setOutputPaneHeight(nextHeight);
    };

    const stopResize = () => setPaneResizeState(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    document.body.classList.add("is-resizing-panes");
    document.body.style.cursor = paneResizeState.pane === "output" ? "row-resize" : "col-resize";

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("is-resizing-panes");
      document.body.style.cursor = "";
    };
  }, [paneResizeState]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!hasUnsavedChanges) {
          return;
        }
        const shouldClose = await confirm(`"${project.name}" has unsaved changes. Close the studio anyway?`, {
          title: "Unsaved Changes",
          kind: "warning",
        });
        if (!shouldClose) {
          event.preventDefault();
        }
      })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [hasUnsavedChanges, project.name]);

  useEffect(() => {
    if (workspaceSyncTimerRef.current) {
      window.clearTimeout(workspaceSyncTimerRef.current);
    }

    workspaceSyncTimerRef.current = window.setTimeout(() => {
      void invoke<LuaWorkspaceResponse>("lua_ls_sync_workspace", {
        input: {
          projectName: project.name,
          projectPath: project.projectPath,
          scripts: project.scripts.map((script) => ({
            id: script.id,
            name: script.name,
            code: script.code,
          })),
        },
      })
        .then((response) => {
          setScriptUris(response.scriptUris);
        })
        .catch((error) => {
          console.error("[lua-ls:sync_workspace]", error);
          setToast({ message: `LuaLS sync failed: ${describeError(error)}`, tone: "error" });
        });
    }, 150);

    return () => {
      if (workspaceSyncTimerRef.current) {
        window.clearTimeout(workspaceSyncTimerRef.current);
      }
    };
  }, [project.name, project.projectPath, project.scripts]);

  useEffect(() => {
    if (!dragPlacement || !selectedRoom) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = roomStageRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const rawX = Math.round((event.clientX - rect.left) / ROOM_EDITOR_SCALE - dragPlacement.offsetX);
      const rawY = Math.round((event.clientY - rect.top) / ROOM_EDITOR_SCALE - dragPlacement.offsetY);
      const x = snapRoomGrid ? Math.round(rawX / roomGridSize) * roomGridSize : rawX;
      const y = snapRoomGrid ? Math.round(rawY / roomGridSize) * roomGridSize : rawY;
      updateRoom(selectedRoom.id, (room) => ({
        ...room,
        placements: room.placements.map((placement) =>
          placement.id === dragPlacement.placementId
            ? {
                ...placement,
                x: clamp(x, 0, room.width),
                y: clamp(y, 0, room.height),
              }
            : placement,
        ),
      }));
    };

    const handlePointerUp = () => setDragPlacement(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragPlacement, roomGridSize, selectedRoom, snapRoomGrid]);

  useEffect(() => {
    if (!selectedScript || !selectedScriptUri || !isLuaLsFileUri(selectedScriptUri)) {
      return;
    }

    const nextVersion = luaDocumentVersionsRef.current[selectedScriptUri] ?? 1;
    void invoke("lua_ls_update_document", {
      input: {
        uri: selectedScriptUri,
        text: selectedScript.code,
        version: nextVersion,
      },
    }).catch((error) => {
      console.error("[lua-ls:update_document]", error);
    });

    void invoke<LuaLsDiagnosticsPayload>("lua_ls_get_diagnostics", { uri: selectedScriptUri })
      .then((payload) => {
        const monaco = monacoRef.current;
        if (!monaco) {
          return;
        }
        const model = monaco.editor.getModel(monaco.Uri.parse(selectedScriptUri));
        if (!model) {
          return;
        }
        const markers = (payload.diagnostics ?? []).map((diagnostic) => ({
          message: diagnostic.message ?? "LuaLS reported a problem.",
          severity: lspSeverityToMonaco(monaco, diagnostic.severity),
          source: diagnostic.source ?? "LuaLS",
          ...lspRangeToMonaco(diagnostic.range, 1, 1),
        }));
        monaco.editor.setModelMarkers(model, LUA_LS_MARKER_OWNER, markers);
      })
      .catch((error) => {
        console.error("[lua-ls:get_diagnostics]", error);
      });
  }, [selectedScript, selectedScriptUri]);

  function updateProject(recipe: (current: StudioProject) => StudioProject) {
    setProject((current) => recipe(current));
  }

  function setProjectField<K extends keyof StudioProject>(key: K, value: StudioProject[K]) {
    updateProject((current) => ({ ...current, [key]: value }));
  }

  function updateSprite(spriteId: string, recipe: (sprite: SpriteAsset) => SpriteAsset) {
    updateProject((current) => ({
      ...current,
      sprites: current.sprites.map((sprite) => (sprite.id === spriteId ? recipe(sprite) : sprite)),
    }));
  }

  function updateSpriteFramePixels(spriteId: string, frameId: string, pixels: number[]) {
    updateSprite(spriteId, (sprite) => ({
      ...sprite,
      frames: sprite.frames.map((frame) =>
        frame.id === frameId ? makeFrameWithId(frame.id, sprite.width, sprite.height, pixels) : frame,
      ),
    }));
  }

  function pushSpriteHistory(frameId: string, previousPixels: number[]) {
    const current = spriteHistoryRef.current[frameId] ?? { past: [], future: [] };
    spriteHistoryRef.current[frameId] = {
      past: [...current.past, clonePixels(previousPixels)].slice(-SPRITE_HISTORY_LIMIT),
      future: [],
    };
  }

  function commitSpritePixels(pixels: number[]) {
    if (!selectedSprite || !selectedFrame) {
      return;
    }
    pushSpriteHistory(selectedFrame.id, selectedFrame.pixels);
    updateSpriteFramePixels(selectedSprite.id, selectedFrame.id, pixels);
  }

  function undoSpriteEdit() {
    if (!selectedSprite || !selectedFrame) {
      return;
    }

    const history = spriteHistoryRef.current[selectedFrame.id];
    if (!history || history.past.length === 0) {
      return;
    }

    const previousPixels = history.past[history.past.length - 1];
    spriteHistoryRef.current[selectedFrame.id] = {
      past: history.past.slice(0, -1),
      future: [clonePixels(selectedFrame.pixels), ...history.future].slice(0, SPRITE_HISTORY_LIMIT),
    };
    updateSpriteFramePixels(selectedSprite.id, selectedFrame.id, previousPixels);
  }

  function redoSpriteEdit() {
    if (!selectedSprite || !selectedFrame) {
      return;
    }

    const history = spriteHistoryRef.current[selectedFrame.id];
    if (!history || history.future.length === 0) {
      return;
    }

    const [nextPixels, ...remainingFuture] = history.future;
    spriteHistoryRef.current[selectedFrame.id] = {
      past: [...history.past, clonePixels(selectedFrame.pixels)].slice(-SPRITE_HISTORY_LIMIT),
      future: remainingFuture,
    };
    updateSpriteFramePixels(selectedSprite.id, selectedFrame.id, nextPixels);
  }

  function applyCurrentColorToSelection() {
    if (!selectedSprite || !selectedFrame || !spriteSelection) {
      return;
    }
    commitSpritePixels(applyColorToSelection(selectedFrame.pixels, selectedSprite.width, spriteSelection, hexToRgba(spriteColor)));
  }

  function resolveSpritePointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selectedSprite) {
      return null;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(Math.floor((event.clientX - bounds.left) / spriteZoom), 0, selectedSprite.width - 1);
    const y = clamp(Math.floor((event.clientY - bounds.top) / spriteZoom), 0, selectedSprite.height - 1);
    return { x, y };
  }

  function buildSpriteToolPixels(
    tool: SpriteTool,
    basePixels: number[],
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) {
    if (!selectedSprite) {
      return basePixels;
    }

    const fillRgba = hexToRgba(spriteColor);
    const strokeRgba = tool === "erase" ? ([0, 0, 0, 0] as const) : fillRgba;

    switch (tool) {
      case "draw":
      case "erase":
      case "line":
        return applyStrokeBetweenPoints(
          basePixels,
          selectedSprite.width,
          selectedSprite.height,
          startX,
          startY,
          endX,
          endY,
          spriteBrushSize,
          strokeRgba,
        );
      case "rectangle":
        return applyRectangleOutline(
          basePixels,
          selectedSprite.width,
          selectedSprite.height,
          startX,
          startY,
          endX,
          endY,
          spriteBrushSize,
          strokeRgba,
        );
      case "circle":
        return applyEllipseOutline(
          basePixels,
          selectedSprite.width,
          selectedSprite.height,
          startX,
          startY,
          endX,
          endY,
          spriteBrushSize,
          strokeRgba,
        );
      case "fill":
        return floodFillPixels(basePixels, selectedSprite.width, selectedSprite.height, endX, endY, fillRgba);
      case "move":
        return translatePixels(basePixels, selectedSprite.width, selectedSprite.height, endX - startX, endY - startY);
      case "select":
        return basePixels;
      default:
        return basePixels;
    }
  }

  function handleSpritePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !selectedFrame) {
      return;
    }

    const point = resolveSpritePointer(event);
    if (!point) {
      return;
    }

    const basePixels = clonePixels(selectedFrame.pixels);

    if (spriteTool === "fill") {
      commitSpritePixels(buildSpriteToolPixels(spriteTool, basePixels, point.x, point.y, point.x, point.y));
      return;
    }

    const initialPreview =
      spriteTool === "move"
        ? basePixels
        : buildSpriteToolPixels(spriteTool, basePixels, point.x, point.y, point.x, point.y);
    const moveSelection = spriteTool === "move" && spriteSelection && pointInSpriteSelection(spriteSelection, point.x, point.y) ? spriteSelection : null;
    const selectionPreview =
      spriteTool === "select"
        ? normalizeSpriteSelection(point.x, point.y, point.x, point.y)
        : moveSelection
          ? normalizeSpriteSelection(moveSelection.left, moveSelection.top, moveSelection.right, moveSelection.bottom)
          : spriteSelection;

    const nextInteraction = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      basePixels,
      previewPixels: initialPreview,
      selectionPreview,
      moveSelection,
    };

    spriteInteractionRef.current = nextInteraction;
    setSpriteInteraction(nextInteraction);

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSpritePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!spriteInteraction || spriteInteraction.pointerId !== event.pointerId) {
      return;
    }

    const point = resolveSpritePointer(event);
    if (!point) {
      return;
    }

    if (spriteTool === "draw" || spriteTool === "erase") {
      setSpriteInteraction((current) =>
        current && current.pointerId === event.pointerId
          ? (() => {
              const nextInteraction = {
              ...current,
              lastX: point.x,
              lastY: point.y,
              previewPixels: buildSpriteToolPixels(
                spriteTool,
                current.previewPixels,
                current.lastX,
                current.lastY,
                point.x,
                point.y,
              ),
            };
              spriteInteractionRef.current = nextInteraction;
              return nextInteraction;
            })()
          : current,
      );
      return;
    }

    if (spriteTool === "select") {
      setSpriteInteraction((current) =>
        current && current.pointerId === event.pointerId
          ? (() => {
              const nextInteraction = {
                ...current,
                lastX: point.x,
                lastY: point.y,
                selectionPreview: normalizeSpriteSelection(current.startX, current.startY, point.x, point.y),
              };
              spriteInteractionRef.current = nextInteraction;
              return nextInteraction;
            })()
          : current,
      );
      return;
    }

    setSpriteInteraction((current) =>
      current && current.pointerId === event.pointerId
        ? (() => {
            const offsetX = point.x - current.startX;
            const offsetY = point.y - current.startY;
            const movedSelection = current.moveSelection
              ? normalizeSpriteSelection(
                  current.moveSelection.left + offsetX,
                  current.moveSelection.top + offsetY,
                  current.moveSelection.right + offsetX,
                  current.moveSelection.bottom + offsetY,
                )
              : current.selectionPreview;
            const nextInteraction = {
              ...current,
              lastX: point.x,
              lastY: point.y,
              previewPixels: current.moveSelection
                ? moveSelectedPixels(current.basePixels, selectedSprite?.width ?? 0, selectedSprite?.height ?? 0, current.moveSelection, offsetX, offsetY)
                : buildSpriteToolPixels(spriteTool, current.basePixels, current.startX, current.startY, point.x, point.y),
              selectionPreview: movedSelection,
            };
            spriteInteractionRef.current = nextInteraction;
            return nextInteraction;
          })()
        : current,
    );
  }

  function finishSpriteInteraction(pointerId: number) {
    const activeInteraction = spriteInteractionRef.current;
    if (!activeInteraction || activeInteraction.pointerId !== pointerId) {
      return;
    }
    if (spriteTool === "select") {
      setSpriteSelection(activeInteraction.selectionPreview);
      spriteInteractionRef.current = null;
      setSpriteInteraction(null);
      return;
    }
    commitSpritePixels(activeInteraction.previewPixels);
    if (activeInteraction.moveSelection && activeInteraction.selectionPreview) {
      setSpriteSelection(activeInteraction.selectionPreview);
    }
    spriteInteractionRef.current = null;
    setSpriteInteraction(null);
  }

  function cancelSpriteInteraction(pointerId: number) {
    const activeInteraction = spriteInteractionRef.current;
    if (!activeInteraction || activeInteraction.pointerId !== pointerId) {
      return;
    }
    spriteInteractionRef.current = null;
    setSpriteInteraction(null);
  }

  function updateScript(scriptId: string, recipe: (script: ScriptAsset) => ScriptAsset) {
    updateProject((current) => ({
      ...current,
      scripts: current.scripts.map((script) => (script.id === scriptId ? recipe(script) : script)),
    }));
  }

  function updateObject(objectId: string, recipe: (entry: ObjectAsset) => ObjectAsset) {
    updateProject((current) => ({
      ...current,
      objects: current.objects.map((entry) => (entry.id === objectId ? recipe(entry) : entry)),
    }));
  }

  function updateRoom(roomId: string, recipe: (room: RoomAsset) => RoomAsset) {
    updateProject((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (room.id === roomId ? recipe(room) : room)),
    }));
  }

  function selectRoomLayer(kind: RoomLayerKind, layerId: string) {
    setSelectedRoomLayerKind(kind);
    setSelectedRoomLayerId(layerId);
    if (kind === "instance") {
      setSelectedPlacementId(
        selectedRoom?.placements.find((placement) => placement.layerId === layerId)?.id
        ?? selectedRoom?.placements[0]?.id
        ?? "",
      );
    } else {
      setSelectedPlacementId("");
    }
  }

  function updateSelectedBackgroundLayer(recipe: (layer: RoomBackgroundLayer) => RoomBackgroundLayer) {
    if (!selectedRoom || !selectedBackgroundLayer) {
      return;
    }
    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      backgroundLayers: room.backgroundLayers.map((layer) => (layer.id === selectedBackgroundLayer.id ? recipe(layer) : layer)),
    }));
  }

  function updateSelectedTileLayer(recipe: (layer: RoomTileLayer) => RoomTileLayer) {
    if (!selectedRoom || !selectedTileLayer) {
      return;
    }
    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      tileLayers: room.tileLayers.map((layer) => (layer.id === selectedTileLayer.id ? recipe(layer) : layer)),
    }));
  }

  function updateSelectedInstanceLayer(recipe: (layer: RoomInstanceLayer) => RoomInstanceLayer) {
    if (!selectedRoom || !selectedInstanceLayer) {
      return;
    }
    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      instanceLayers: room.instanceLayers.map((layer) => (layer.id === selectedInstanceLayer.id ? recipe(layer) : layer)),
    }));
  }

  function updateRoomBounds(width: number, height: number) {
    if (!selectedRoom) {
      return;
    }

    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      width,
      height,
      cameraX: clampCameraCoordinate(room.cameraX, width, ROOM_VIEW_WIDTH),
      cameraY: clampCameraCoordinate(room.cameraY, height, ROOM_VIEW_HEIGHT),
      tileLayers: room.tileLayers.map((layer) => {
        const columns = Math.max(1, Math.floor(width / Math.max(layer.tileWidth, 1)));
        const rows = Math.max(1, Math.floor(height / Math.max(layer.tileHeight, 1)));
        const expected = columns * rows;
        return {
          ...layer,
          columns,
          rows,
          tiles: layer.tiles.slice(0, expected).concat(new Array(Math.max(0, expected - layer.tiles.length)).fill(-1)),
          collisions: layer.collisions
            .slice(0, expected)
            .concat(new Array(Math.max(0, expected - layer.collisions.length)).fill(false)),
        };
      }),
    }));
  }

  function addBackgroundLayer() {
    if (!selectedRoom) {
      return;
    }
    const layer = createBackgroundLayer(selectedRoom.backgroundLayers.length);
    updateRoom(selectedRoom.id, (room) => ({ ...room, backgroundLayers: [...room.backgroundLayers, layer] }));
    selectRoomLayer("background", layer.id);
  }

  function addTileLayer() {
    if (!selectedRoom) {
      return;
    }
    const layer = createTileLayer(selectedRoom.tileLayers.length, selectedRoom.width, selectedRoom.height, project.sprites[0]?.id ?? "");
    updateRoom(selectedRoom.id, (room) => ({ ...room, tileLayers: [...room.tileLayers, layer] }));
    selectRoomLayer("tile", layer.id);
  }

  function addInstanceLayer() {
    if (!selectedRoom) {
      return;
    }
    const layer = createInstanceLayer(selectedRoom.instanceLayers.length);
    updateRoom(selectedRoom.id, (room) => ({ ...room, instanceLayers: [...room.instanceLayers, layer] }));
    selectRoomLayer("instance", layer.id);
  }

  function removeSelectedLayer() {
    if (!selectedRoom) {
      return;
    }

    if (selectedRoomLayerKind === "background" && selectedBackgroundLayer && selectedRoom.backgroundLayers.length > 1) {
      const replacement = selectedRoom.backgroundLayers.find((layer) => layer.id !== selectedBackgroundLayer.id);
      updateRoom(selectedRoom.id, (room) => ({
        ...room,
        backgroundLayers: room.backgroundLayers.filter((layer) => layer.id !== selectedBackgroundLayer.id),
      }));
      if (replacement) {
        selectRoomLayer("background", replacement.id);
      }
      return;
    }

    if (selectedRoomLayerKind === "tile" && selectedTileLayer && selectedRoom.tileLayers.length > 1) {
      const replacement = selectedRoom.tileLayers.find((layer) => layer.id !== selectedTileLayer.id);
      updateRoom(selectedRoom.id, (room) => ({
        ...room,
        tileLayers: room.tileLayers.filter((layer) => layer.id !== selectedTileLayer.id),
      }));
      if (replacement) {
        selectRoomLayer("tile", replacement.id);
      }
      return;
    }

    if (selectedRoomLayerKind === "instance" && selectedInstanceLayer && selectedRoom.instanceLayers.length > 1) {
      const replacement = selectedRoom.instanceLayers.find((layer) => layer.id !== selectedInstanceLayer.id) ?? selectedRoom.instanceLayers[0];
      updateRoom(selectedRoom.id, (room) => ({
        ...room,
        instanceLayers: room.instanceLayers.filter((layer) => layer.id !== selectedInstanceLayer.id),
        placements: room.placements.map((placement) =>
          placement.layerId === selectedInstanceLayer.id
            ? { ...placement, layerId: replacement?.id ?? room.instanceLayers[0]?.id ?? "" }
            : placement,
        ),
      }));
      if (replacement) {
        selectRoomLayer("instance", replacement.id);
      }
    }
  }

  function setCameraPosition(x: number, y: number) {
    if (!selectedRoom) {
      return;
    }

    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      cameraX: clampCameraCoordinate(x, room.width, ROOM_VIEW_WIDTH),
      cameraY: clampCameraCoordinate(y, room.height, ROOM_VIEW_HEIGHT),
    }));
  }

  async function runAction(action: string, work: () => Promise<void>) {
    setBusyAction(action);
    try {
      await work();
    } catch (error) {
      console.error(`[studio:${action}]`, error);
      setToast({ message: describeError(error), tone: "error" });
    } finally {
      setBusyAction("");
    }
  }

  function scheduleLuaDocumentSync(editor: MonacoEditor.IStandaloneCodeEditor) {
    const model = editor.getModel();
    if (!model || model.getLanguageId() !== "lua") {
      return;
    }

    const uri = model.uri.toString();
    if (!isLuaLsFileUri(uri)) {
      return;
    }

    const version = model.getVersionId();
    luaDocumentVersionsRef.current[uri] = version;

    if (documentSyncTimerRef.current) {
      window.clearTimeout(documentSyncTimerRef.current);
    }

    documentSyncTimerRef.current = window.setTimeout(() => {
      void invoke("lua_ls_update_document", {
        input: {
          uri,
          text: model.getValue(),
          version,
        },
      }).catch((error) => {
        console.error("[lua-ls:update_document]", error);
      });
    }, 120);
  }

  function registerLuaLsProviders(monaco: Monaco) {
    const globalKey = "__nwgeLuaLsConfigured";
    const target = monaco.languages as unknown as Record<string, unknown>;
    if (target[globalKey]) {
      return;
    }
    target[globalKey] = true;

    monaco.languages.registerCompletionItemProvider("lua", {
      triggerCharacters: [".", ":", '"', "'"],
      provideCompletionItems: async (model, position) => {
        if (!isLuaLsFileUri(model.uri.toString())) {
          return { suggestions: [] };
        }
        try {
          const result = await invoke<any>("lua_ls_completion", {
            input: {
              uri: model.uri.toString(),
              text: model.getValue(),
              version: model.getVersionId(),
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          });

          const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
          const word = model.getWordUntilPosition(position);
          const fallbackRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: languages.CompletionItem[] = items.map((item: any) => {
            const textEditRange = item?.textEdit?.range
              ? lspRangeToMonaco(item.textEdit.range, position.lineNumber, position.column)
              : fallbackRange;
            const insertText =
              typeof item?.textEdit?.newText === "string"
                ? item.textEdit.newText
                : typeof item?.insertText === "string"
                  ? item.insertText
                  : typeof item?.label === "string"
                    ? item.label
                    : "";

            return {
              label: item?.label ?? insertText,
              kind: lspCompletionKindToMonaco(monaco, item?.kind),
              detail: typeof item?.detail === "string" ? item.detail : undefined,
              documentation: lspDocumentationToString(item?.documentation),
              insertText,
              insertTextRules:
                item?.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              filterText: typeof item?.filterText === "string" ? item.filterText : undefined,
              sortText: typeof item?.sortText === "string" ? item.sortText : undefined,
              range: textEditRange,
            };
          });

          return { suggestions };
        } catch (error) {
          console.error("[lua-ls:completion]", error);
          return { suggestions: [] };
        }
      },
    });

    monaco.languages.registerHoverProvider("lua", {
      provideHover: async (model, position) => {
        if (!isLuaLsFileUri(model.uri.toString())) {
          return null;
        }
        try {
          const result = await invoke<any>("lua_ls_hover", {
            input: {
              uri: model.uri.toString(),
              text: model.getValue(),
              version: model.getVersionId(),
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          });

          if (!result?.contents) {
            return null;
          }

          const value = lspDocumentationToString(result.contents);
          if (!value) {
            return null;
          }

          return {
            contents: [{ value }],
            range: result.range
              ? new monaco.Range(
                  lspPositionToMonaco(result.range.start?.line) ?? position.lineNumber,
                  lspPositionToMonaco(result.range.start?.character) ?? position.column,
                  lspPositionToMonaco(result.range.end?.line) ?? position.lineNumber,
                  lspPositionToMonaco(result.range.end?.character) ?? position.column,
                )
              : undefined,
          };
        } catch (error) {
          console.error("[lua-ls:hover]", error);
          return null;
        }
      },
    });

    monaco.languages.registerDefinitionProvider("lua", {
      provideDefinition: async (model, position) => {
        if (!isLuaLsFileUri(model.uri.toString())) {
          return [];
        }
        try {
          const locations = await invoke<LuaLsDefinition[]>("lua_ls_definition", {
            input: {
              uri: model.uri.toString(),
              text: model.getValue(),
              version: model.getVersionId(),
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          });

          return locations
            .filter((location) => location.uri === model.uri.toString())
            .map((location) => ({
              uri: model.uri,
              range: new monaco.Range(
                location.startLine + 1,
                location.startCharacter + 1,
                location.endLine + 1,
                location.endCharacter + 1,
              ),
            }));
        } catch (error) {
          console.error("[lua-ls:definition]", error);
          return [];
        }
      },
    });
  }

  function handleScriptEditorBeforeMount(monaco: Monaco) {
    applyMonacoTheme(monaco, project.themeMode);
  }

  function handleScriptEditorMount(editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyMonacoTheme(monaco, project.themeMode);
    registerLuaLsProviders(monaco);
    scheduleLuaDocumentSync(editor);
    applyPendingScriptNavigation();

    editor.onDidChangeModelContent(() => {
      scheduleLuaDocumentSync(editor);
    });

    editor.onDidChangeModel(() => {
      scheduleLuaDocumentSync(editor);
      window.setTimeout(() => {
        applyPendingScriptNavigation();
      }, 0);
    });
  }

  function navigateToScriptLocation(scriptId: string, line: number) {
    pendingScriptNavigationRef.current = { scriptId, line };
    if (workspaceView === "script" && selectedScriptId === scriptId && applyPendingScriptNavigation()) {
      return;
    }
    setSelectedScriptId(scriptId);
    setWorkspaceView("script");
  }

  function appendOutputEntry(stream: OutputStream, message: string, runId = activePreviewRunId) {
    const id = outputEntryIdRef.current;
    outputEntryIdRef.current += 1;
    setOutputEntries((current) => [
      ...current.slice(-(MAX_OUTPUT_ENTRIES - 1)),
      { id, runId, stream, message },
    ]);
  }

  function renderOutputMessage(message: string): ReactNode {
    const references = parseOutputTraceReferences(message);
    if (references.length === 0) {
      return message;
    }

    const scriptByName = new Map(project.scripts.map((script) => [script.name, script]));
    const segments: ReactNode[] = [];
    let cursor = 0;

    references.forEach((reference, index) => {
      if (reference.start > cursor) {
        segments.push(
          <Fragment key={`text-${index}-${cursor}`}>{message.slice(cursor, reference.start)}</Fragment>,
        );
      }

      const script = scriptByName.get(reference.scriptName);
      const label = message.slice(reference.start, reference.end);
      if (script) {
        segments.push(
          <button
            key={`link-${index}-${reference.start}`}
            type="button"
            className="output-link"
            onClick={() => navigateToScriptLocation(script.id, reference.line)}
            title={`Open ${script.name} at line ${reference.line}`}
          >
            {label}
          </button>,
        );
      } else {
        segments.push(<Fragment key={`plain-${index}-${reference.start}`}>{label}</Fragment>);
      }

      cursor = reference.end;
    });

    if (cursor < message.length) {
      segments.push(<Fragment key={`tail-${cursor}`}>{message.slice(cursor)}</Fragment>);
    }

    return segments;
  }

  function selectProjectView() {
    setWorkspaceView("project");
  }

  function selectRoomView(roomId: string) {
    setSelectedRoomId(roomId);
    const room = project.rooms.find((entry) => entry.id === roomId);
    setSelectedPlacementId(room?.placements[0]?.id ?? "");
    setSelectedRoomLayerKind("instance");
    setSelectedRoomLayerId(room?.instanceLayers[0]?.id ?? room?.tileLayers[0]?.id ?? room?.backgroundLayers[0]?.id ?? "");
    setWorkspaceView("room");
  }

  function selectObjectView(objectId: string) {
    setSelectedObjectId(objectId);
    setWorkspaceView("object");
  }

  function selectSpriteView(spriteId: string) {
    const sprite = project.sprites.find((entry) => entry.id === spriteId);
    setSelectedSpriteId(spriteId);
    setSelectedFrameId(sprite?.frames[0]?.id ?? "");
    setWorkspaceView("sprite");
  }

  function selectScriptView(scriptId: string) {
    setSelectedScriptId(scriptId);
    setWorkspaceView("script");
  }

  function openProjectBox() {
    setShowLauncher(true);
  }

  async function refreshExportSupport(runtimeRoot = project.runtimeRoot) {
    const status = await invoke<ExportSupportResult>("inspect_export_support", { runtimeRoot });
    setExportSupport(status);
    return status;
  }

  function openExportPanel() {
    setShowExportPanel(true);
  }

  function beginPaneResize(pane: ResizablePane, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setPaneResizeState({
      pane,
      startX: event.clientX,
      startY: event.clientY,
      resourceWidth: resourcePaneWidth,
      propertiesWidth: propertiesPaneWidth,
      outputHeight: outputPaneHeight,
    });
  }

  function toggleTreeSection(key: ResourceSectionKey) {
    setTreeSections((current) => ({ ...current, [key]: !current[key] }));
  }

  function renameResource(kind: RenamableResourceKind, resourceId: string, nextRawName: string) {
    const nextName = nextRawName.trim();
    if (!nextName) {
      return;
    }

    updateProject((current) => {
      switch (kind) {
        case "sprite": {
          const target = current.sprites.find((sprite) => sprite.id === resourceId);
          if (!target || target.name === nextName) {
            return current;
          }
          return {
            ...current,
            sprites: current.sprites.map((sprite) => (sprite.id === resourceId ? { ...sprite, name: nextName } : sprite)),
            scripts: renameReferencesInScripts(current.scripts, kind, target.name, nextName),
          };
        }
        case "object": {
          const target = current.objects.find((entry) => entry.id === resourceId);
          if (!target || target.name === nextName) {
            return current;
          }
          return {
            ...current,
            objects: current.objects.map((entry) => (entry.id === resourceId ? { ...entry, name: nextName } : entry)),
            scripts: renameReferencesInScripts(current.scripts, kind, target.name, nextName),
          };
        }
        case "room": {
          const target = current.rooms.find((room) => room.id === resourceId);
          if (!target || target.name === nextName) {
            return current;
          }
          return {
            ...current,
            rooms: current.rooms.map((room) => (room.id === resourceId ? { ...room, name: nextName } : room)),
            scripts: renameReferencesInScripts(current.scripts, kind, target.name, nextName),
          };
        }
        case "script": {
          const target = current.scripts.find((script) => script.id === resourceId);
          if (!target || target.name === nextName) {
            return current;
          }
          return {
            ...current,
            scripts: renameReferencesInScripts(
              current.scripts.map((script) => (script.id === resourceId ? { ...script, name: nextName } : script)),
              kind,
              target.name,
              nextName,
            ),
          };
        }
        case "config": {
          const target = current.config.find((entry) => entry.id === resourceId);
          if (!target || target.name === nextName) {
            return current;
          }
          return {
            ...current,
            config: current.config.map((entry) => (entry.id === resourceId ? { ...entry, name: nextName } : entry)),
            scripts: renameReferencesInScripts(current.scripts, kind, target.name, nextName),
          };
        }
        default:
          return current;
      }
    });
  }

  function promptRenameResource(kind: RenamableResourceKind, resourceId: string, currentName: string) {
    const nextName = window.prompt(`Rename ${kind}`, currentName);
    if (!nextName) {
      return;
    }
    renameResource(kind, resourceId, nextName);
    if (nextName.trim() !== currentName) {
      setToast({ message: `Renamed ${kind} to ${nextName.trim()}.`, tone: "success" });
    }
  }

  function duplicateSprite(spriteId: string) {
    const source = project.sprites.find((sprite) => sprite.id === spriteId);
    if (!source) {
      return;
    }
    const sprite = cloneSpriteAsset(
      source,
      ensureUniqueName(project.sprites.map((entry) => entry.name), buildCopyName(source.name)),
    );
    updateProject((current) => ({ ...current, sprites: [...current.sprites, sprite] }));
    setSelectedSpriteId(sprite.id);
    setSelectedFrameId(sprite.frames[0]?.id ?? "");
    setWorkspaceView("sprite");
    setToast({ message: `Duplicated sprite ${source.name}.`, tone: "success" });
  }

  function duplicateScript(scriptId: string) {
    const source = project.scripts.find((script) => script.id === scriptId);
    if (!source) {
      return;
    }
    const script = cloneScriptAsset(
      source,
      ensureUniqueName(project.scripts.map((entry) => entry.name), buildCopyName(source.name)),
    );
    updateProject((current) => ({ ...current, scripts: [...current.scripts, script] }));
    setSelectedScriptId(script.id);
    setWorkspaceView("script");
    setToast({ message: `Duplicated script ${source.name}.`, tone: "success" });
  }

  function duplicateObject(objectId: string) {
    const source = project.objects.find((entry) => entry.id === objectId);
    if (!source) {
      return;
    }
    const entry = cloneObjectAsset(
      source,
      ensureUniqueName(project.objects.map((candidate) => candidate.name), buildCopyName(source.name)),
    );
    updateProject((current) => ({ ...current, objects: [...current.objects, entry] }));
    setSelectedObjectId(entry.id);
    setWorkspaceView("object");
    setToast({ message: `Duplicated object ${source.name}.`, tone: "success" });
  }

  function duplicateRoom(roomId: string) {
    const source = project.rooms.find((room) => room.id === roomId);
    if (!source) {
      return;
    }
    const room = cloneRoomAsset(
      source,
      ensureUniqueName(project.rooms.map((candidate) => candidate.name), buildCopyName(source.name)),
    );
    updateProject((current) => ({ ...current, rooms: [...current.rooms, room] }));
    setSelectedRoomId(room.id);
    setSelectedPlacementId(room.placements[0]?.id ?? "");
    setSelectedRoomLayerKind("instance");
    setSelectedRoomLayerId(room.instanceLayers[0]?.id ?? room.tileLayers[0]?.id ?? room.backgroundLayers[0]?.id ?? "");
    setWorkspaceView("room");
    setToast({ message: `Duplicated room ${source.name}.`, tone: "success" });
  }

  function renderResourceTreeRow({
    id,
    label,
    icon,
    active,
    onSelect,
    onDuplicate,
    onRename,
    onDelete,
    draggable = false,
    dragData,
  }: {
    id: string;
    label: string;
    icon: IconName;
    active: boolean;
    onSelect: () => void;
    onDuplicate: () => void;
    onRename: () => void;
    onDelete: () => void;
    draggable?: boolean;
    dragData?: string;
  }) {
    return (
      <div key={id} className="tree-row">
        <button
          className={active ? "tree-item active" : "tree-item"}
          draggable={draggable}
          onDragStart={dragData ? (event) => event.dataTransfer.setData("application/x-nwge-object-id", dragData) : undefined}
          onClick={onSelect}
        >
          <AppIcon name={icon} className="tree-icon" />
          <span>{label}</span>
        </button>
        <div className="tree-item-actions">
          <ActionButton className="mini-button tree-inline-button" icon="duplicate" label={`Duplicate ${label}`} onClick={onDuplicate} />
          <ActionButton className="mini-button tree-inline-button" icon="rename" label={`Rename ${label}`} onClick={onRename} />
          <ActionButton className="mini-button danger tree-inline-button" icon="delete" label={`Delete ${label}`} onClick={onDelete} />
        </div>
      </div>
    );
  }

  function appendUniqueScript(scriptIds: string[], scriptId: string) {
    if (!scriptId || scriptIds.includes(scriptId)) {
      return scriptIds;
    }
    return [...scriptIds, scriptId];
  }

  function removeScriptRef(scriptIds: string[], scriptId: string) {
    return scriptIds.filter((entry) => entry !== scriptId);
  }

  function addProjectEventScript(field: GameEventField, scriptId: string) {
    updateProject((current) => ({ ...current, [field]: appendUniqueScript(current[field], scriptId) }));
  }

  function removeProjectEventScript(field: GameEventField, scriptId: string) {
    updateProject((current) => ({ ...current, [field]: removeScriptRef(current[field], scriptId) }));
  }

  function addRoomEventScript(roomId: string, field: RoomEventField, scriptId: string) {
    updateRoom(roomId, (room) => ({ ...room, [field]: appendUniqueScript(room[field], scriptId) }));
  }

  function removeRoomEventScript(roomId: string, field: RoomEventField, scriptId: string) {
    updateRoom(roomId, (room) => ({ ...room, [field]: removeScriptRef(room[field], scriptId) }));
  }

  function assignScriptToFocusedEvent(scriptId: string) {
    if (!selectedObject) {
      return;
    }
    updateObject(selectedObject.id, (entry) => assignObjectEventScript(entry, focusedEventSelection, scriptId));
  }

  function clearFocusedEvent() {
    if (!selectedObject) {
      return;
    }
    updateObject(selectedObject.id, (entry) => assignObjectEventScript(entry, focusedEventSelection, ""));
  }

  function addSprite() {
    const sprite = createBlankSprite(project.sprites.length);
    updateProject((current) => ({ ...current, sprites: [...current.sprites, sprite] }));
    setSelectedSpriteId(sprite.id);
    setSelectedFrameId(sprite.frames[0]?.id ?? "");
    setWorkspaceView("sprite");
  }

  function addFrame() {
    if (!selectedSprite) {
      return;
    }
    const frame = makeFrame(selectedSprite.width, selectedSprite.height, blankPixels(selectedSprite.width, selectedSprite.height));
    updateSprite(selectedSprite.id, (sprite) => ({ ...sprite, frames: [...sprite.frames, frame] }));
    setSelectedFrameId(frame.id);
  }

  function deleteSprite(spriteId: string) {
    const replacementSelection = project.sprites.find((sprite) => sprite.id !== spriteId)?.id ?? "";
    updateProject((current) => ({
      ...current,
      iconSpriteId: current.iconSpriteId === spriteId ? "" : current.iconSpriteId,
      sprites: current.sprites.filter((sprite) => sprite.id !== spriteId),
      objects: current.objects.map((entry) => (entry.spriteId === spriteId ? { ...entry, spriteId: "" } : entry)),
    }));
    setSelectedSpriteId((current) => (current === spriteId ? replacementSelection : current));
    setSelectedFrameId("");
  }

  function deleteFrame(spriteId: string, frameId: string) {
    const sprite = project.sprites.find((entry) => entry.id === spriteId);
    const replacementSelection = sprite?.frames.find((frame) => frame.id !== frameId)?.id ?? "";
    updateSprite(spriteId, (currentSprite) => ({
      ...currentSprite,
      frames: currentSprite.frames.filter((frame) => frame.id !== frameId),
    }));
    setSelectedFrameId((current) => (current === frameId ? replacementSelection : current));
  }

  function addScript() {
    const script = {
      id: crypto.randomUUID(),
      name: `script_${project.scripts.length + 1}`,
      code: ["return function(self, other)", "  ", "end"].join("\n"),
    } satisfies ScriptAsset;
    updateProject((current) => ({ ...current, scripts: [...current.scripts, script] }));
    setSelectedScriptId(script.id);
    setWorkspaceView("script");
  }

  function createScriptForFocusedEvent() {
    if (!selectedObject) {
      return;
    }
    const script = {
      id: crypto.randomUUID(),
      name: buildObjectEventScriptName(selectedObject.name, focusedEventSelection),
      code: defaultObjectEventCode(focusedEventSelection),
    } satisfies ScriptAsset;
    updateProject((current) => ({
      ...current,
      scripts: [...current.scripts, script],
      objects: current.objects.map((entry) =>
        entry.id === selectedObject.id ? assignObjectEventScript(entry, focusedEventSelection, script.id) : entry,
      ),
    }));
    setSelectedScriptId(script.id);
  }

  function deleteScript(scriptId: string) {
    const replacementSelection = project.scripts.find((script) => script.id !== scriptId)?.id ?? "";
    updateProject((current) => ({
      ...current,
      scripts: current.scripts.filter((script) => script.id !== scriptId),
      gameCreateScriptIds: current.gameCreateScriptIds.filter((entry) => entry !== scriptId),
      gameStepScriptIds: current.gameStepScriptIds.filter((entry) => entry !== scriptId),
      gameDrawScriptIds: current.gameDrawScriptIds.filter((entry) => entry !== scriptId),
      gameDestroyScriptIds: current.gameDestroyScriptIds.filter((entry) => entry !== scriptId),
      objects: current.objects.map((entry) => ({
        ...entry,
        createScriptId: entry.createScriptId === scriptId ? "" : entry.createScriptId,
        stepScriptId: entry.stepScriptId === scriptId ? "" : entry.stepScriptId,
        drawScriptId: entry.drawScriptId === scriptId ? "" : entry.drawScriptId,
        destroyScriptId: entry.destroyScriptId === scriptId ? "" : entry.destroyScriptId,
        collisionScriptId: entry.collisionScriptId === scriptId ? "" : entry.collisionScriptId,
        alarmScriptIds: entry.alarmScriptIds.map((entryId) => (entryId === scriptId ? "" : entryId)),
        buttonPressedScriptIds: Object.fromEntries(
          Object.entries(entry.buttonPressedScriptIds).map(([key, value]) => [key, value === scriptId ? "" : value]),
        ),
        buttonDownScriptIds: Object.fromEntries(
          Object.entries(entry.buttonDownScriptIds).map(([key, value]) => [key, value === scriptId ? "" : value]),
        ),
        buttonReleasedScriptIds: Object.fromEntries(
          Object.entries(entry.buttonReleasedScriptIds).map(([key, value]) => [key, value === scriptId ? "" : value]),
        ),
      })),
      rooms: current.rooms.map((room) => ({
        ...room,
        createScriptIds: room.createScriptIds.filter((entry) => entry !== scriptId),
        stepScriptIds: room.stepScriptIds.filter((entry) => entry !== scriptId),
        drawScriptIds: room.drawScriptIds.filter((entry) => entry !== scriptId),
        destroyScriptIds: room.destroyScriptIds.filter((entry) => entry !== scriptId),
      })),
    }));
    setSelectedScriptId((current) => (current === scriptId ? replacementSelection : current));
  }

  function addObject() {
    const object = {
      id: crypto.randomUUID(),
      name: `obj_${project.objects.length + 1}`,
      parentObjectId: "",
      spriteId: project.sprites[0]?.id ?? "",
      createScriptId: "",
      stepScriptId: "",
      drawScriptId: "",
      destroyScriptId: "",
      collisionScriptId: "",
      collisionObjectId: "",
      alarmScriptIds: new Array(ALARM_EVENT_COUNT).fill(""),
      buttonPressedScriptIds: {},
      buttonDownScriptIds: {},
      buttonReleasedScriptIds: {},
    } satisfies ObjectAsset;
    updateProject((current) => ({ ...current, objects: [...current.objects, object] }));
    setSelectedObjectId(object.id);
    setWorkspaceView("object");
  }

  function deleteObject(objectId: string) {
    const replacementSelection = project.objects.find((entry) => entry.id !== objectId)?.id ?? "";
    updateProject((current) => ({
      ...current,
      objects: current.objects
        .filter((entry) => entry.id !== objectId)
        .map((entry) => ({
          ...entry,
          parentObjectId: entry.parentObjectId === objectId ? "" : entry.parentObjectId,
          collisionObjectId: entry.collisionObjectId === objectId ? "" : entry.collisionObjectId,
        })),
      rooms: current.rooms.map((room) => ({
        ...room,
        placements: room.placements.filter((placement) => placement.objectId !== objectId),
        cameraFollowObjectId: room.cameraFollowObjectId === objectId ? "" : room.cameraFollowObjectId,
      })),
    }));
    setSelectedObjectId((current) => (current === objectId ? replacementSelection : current));
    setSelectedPlacementId((current) => {
      const placement = selectedRoom?.placements.find((entry) => entry.id === current);
      return placement?.objectId === objectId ? "" : current;
    });
  }

  function addPlacement(objectId = (selectedObjectId || project.objects[0]?.id) ?? "", x = 32, y = 32) {
    if (!selectedRoom || !objectId) {
      return;
    }
    const layerId =
      selectedRoomLayerKind === "instance" && selectedInstanceLayer
        ? selectedInstanceLayer.id
        : selectedRoom.instanceLayers[0]?.id ?? "";
    const placement = {
      id: crypto.randomUUID(),
      objectId,
      x,
      y,
      layerId,
    } satisfies RoomPlacement;
    updateRoom(selectedRoom.id, (room) => ({ ...room, placements: [...room.placements, placement] }));
    setSelectedPlacementId(placement.id);
    setSelectedObjectId(objectId);
  }

  function updatePlacement(placementId: string, recipe: (placement: RoomPlacement) => RoomPlacement) {
    if (!selectedRoom) {
      return;
    }
    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      placements: room.placements.map((placement) => (placement.id === placementId ? recipe(placement) : placement)),
    }));
  }

  function removePlacement(placementId: string) {
    if (!selectedRoom) {
      return;
    }
    const replacementSelection = selectedRoom.placements.find((placement) => placement.id !== placementId)?.id ?? "";
    updateRoom(selectedRoom.id, (room) => ({
      ...room,
      placements: room.placements.filter((placement) => placement.id !== placementId),
    }));
    setSelectedPlacementId((current) => (current === placementId ? replacementSelection : current));
  }

  function addRoom() {
    const room = makeDefaultRoom(project.rooms.length, project.objects[0]?.id ?? "", project.sprites[0]?.id ?? "");
    const instanceLayerId = room.instanceLayers[0]?.id ?? "";
    room.placements = room.placements.map((placement) => ({ ...placement, layerId: instanceLayerId }));
    updateProject((current) => ({ ...current, rooms: [...current.rooms, room] }));
    setSelectedRoomId(room.id);
    setSelectedPlacementId(room.placements[0]?.id ?? "");
    setSelectedRoomLayerKind("instance");
    setSelectedRoomLayerId(instanceLayerId);
    setWorkspaceView("room");
  }

  function deleteRoom(roomId: string) {
    if (project.rooms.length <= 1) {
      const replacement = makeDefaultRoom(0, project.objects[0]?.id ?? "", project.sprites[0]?.id ?? "");
      updateProject((current) => ({ ...current, rooms: [replacement] }));
      setSelectedRoomId(replacement.id);
      setSelectedPlacementId(replacement.placements[0]?.id ?? "");
      setSelectedRoomLayerKind("instance");
      setSelectedRoomLayerId(replacement.instanceLayers[0]?.id ?? "");
      return;
    }

    const replacementSelection = project.rooms.find((room) => room.id !== roomId)?.id ?? "";
    updateProject((current) => ({ ...current, rooms: current.rooms.filter((room) => room.id !== roomId) }));
    setSelectedRoomId((current) => (current === roomId ? replacementSelection : current));
    setSelectedPlacementId("");
  }

  function addConfigEntry() {
    const entry = {
      id: crypto.randomUUID(),
      name: `ENV_${project.config.length + 1}`,
      valueType: "string",
      value: "",
    } satisfies ConfigEntry;
    updateProject((current) => ({ ...current, config: [...current.config, entry] }));
  }

  function deleteConfigEntry(configId: string) {
    updateProject((current) => ({
      ...current,
      config: current.config.filter((entry) => entry.id !== configId),
    }));
  }

  async function chooseProjectPathForSave() {
    const path = await save({
      defaultPath: buildDefaultProjectPath(),
      filters: [{ name: "NWGE Project", extensions: ["nwgs", "json"] }],
    });
    if (path) {
      setProjectField("projectPath", path);
    }
    return path;
  }

  async function chooseProjectPathForLoad() {
    const path = await open({
      defaultPath: project.projectPath || undefined,
      multiple: false,
      filters: [{ name: "NWGE Project", extensions: ["nwgs", "json"] }],
    });
    if (typeof path === "string") {
      setProjectField("projectPath", path);
      return path;
    }
    return null;
  }

  async function choosePackPath() {
    const path = await save({
      defaultPath: buildDefaultPackPath(),
      filters: [{ name: "Game Pack", extensions: ["pack"] }],
    });
    if (path) {
      setProjectField("packPath", path);
    }
    return path;
  }

  function buildDefaultProjectPath() {
    if (project.projectPath.trim()) {
      return project.projectPath;
    }
    return `${slugifyProjectName(project.name)}.nwgs.json`;
  }

  function buildDefaultPackPath() {
    if (project.packPath.trim().toLowerCase().endsWith(".pack")) {
      return project.packPath;
    }
    if (project.projectPath.trim()) {
      return project.projectPath.replace(/\.(nwgs|json)$/i, ".pack");
    }
    return `${slugifyProjectName(project.name)}.pack`;
  }

  function buildDefaultEmbeddedExportPath() {
    if (project.packPath.trim().toLowerCase().endsWith(".pack")) {
      return project.packPath.replace(/\.pack$/i, ".nwa");
    }
    if (project.projectPath.trim()) {
      return project.projectPath.replace(/\.(nwgs|json)$/i, ".nwa");
    }
    return `${slugifyProjectName(project.name)}.nwa`;
  }

  async function chooseEmbeddedExportPath() {
    const path = await save({
      defaultPath: buildDefaultEmbeddedExportPath(),
      filters: [{ name: "NumWorks App", extensions: ["nwa"] }],
    });
    return path ?? null;
  }

  function applyLoadedProject(nextProject: StudioProject) {
    setProject(nextProject);
    setSavedProjectSignature(createProjectSignature(nextProject));
    setSelectedSpriteId(nextProject.sprites[0]?.id ?? "");
    setSelectedFrameId(nextProject.sprites[0]?.frames[0]?.id ?? "");
    setSelectedScriptId(nextProject.scripts[0]?.id ?? "");
    setSelectedObjectId(nextProject.objects[0]?.id ?? "");
    setSelectedRoomId(nextProject.rooms[0]?.id ?? "");
    setSelectedPlacementId(nextProject.rooms[0]?.placements[0]?.id ?? "");
    setSelectedRoomLayerKind("instance");
    setSelectedRoomLayerId(nextProject.rooms[0]?.instanceLayers[0]?.id ?? nextProject.rooms[0]?.tileLayers[0]?.id ?? nextProject.rooms[0]?.backgroundLayers[0]?.id ?? "");
    setWorkspaceView("room");
    setShowLauncher(false);
  }

  function trackRecentProject(path: string, name: string) {
    setRecentProjects((current) => rememberRecentProject(current, { path, name }));
  }

  function startNewProject() {
    const nextProject = createStarterProject();
    applyLoadedProject(nextProject);
    setToast({ message: "Started a new project workspace.", tone: "success" });
  }

  async function loadProjectFromPath(path: string) {
    const loaded = await invoke<ProjectFile>("load_project", { path });
    const nextProject = {
      ...hydrateProject(loaded),
      projectPath: path,
    };
    applyLoadedProject(nextProject);
    trackRecentProject(path, nextProject.name);
    setToast({ message: `Loaded project from ${path}.`, tone: "success" });
  }

  async function loadProjectFromDialog() {
    const path = await chooseProjectPathForLoad();
    if (!path) {
      return;
    }
    await loadProjectFromPath(path);
  }

  async function saveProject() {
    await runAction("save", async () => {
      const path = await chooseProjectPathForSave();
      if (!path) {
        return;
      }
      const nextProject = {
        ...project,
        projectPath: path,
      };
      await invoke("save_project", {
        path,
        project: serializeProject(nextProject),
      });
      setProject(nextProject);
      setSavedProjectSignature(createProjectSignature(nextProject));
      trackRecentProject(path, nextProject.name);
      setShowLauncher(false);
      setToast({ message: `Saved project to ${path}.`, tone: "success" });
    });
  }

  async function loadProject() {
    await runAction("load", async () => {
      await loadProjectFromDialog();
    });
  }

  function beginExportAction() {
    setShowExportPanel(false);
    setOutputPaneCollapsed(false);
  }

  async function exportPack() {
    await runAction("export", async () => {
      const targetPath = await choosePackPath();
      if (!targetPath) {
        return;
      }
      beginExportAction();
      await invoke("export_pack", {
        path: targetPath,
        project: serializeProject(project),
      });
      setToast({
        message: `Exported ${project.name} to ${targetPath}.`,
        tone: "success",
      });
    });
  }

  async function exportWithEmbeddedPack() {
    await runAction("embedded-export", async () => {
      const outputPath = await chooseEmbeddedExportPath();
      if (!outputPath) {
        return;
      }
      beginExportAction();
      setOutputEntries([]);
      setActivePreviewRunId("");
      setPreviewConsoleCommand("");
      const result = await invoke<EmbeddedExportResult>("export_with_embedded_pack", {
        outputPath,
        project: serializeProject(project),
        iconPngBytes: await buildProjectIconPngBytes(project),
      });
      setToast({
        message: `Exported the compiled .nwa to ${result.outputPath}.`,
        tone: "success",
      });
      if (showExportPanel) {
        void refreshExportSupport(project.runtimeRoot).catch(() => undefined);
      }
    });
  }

  async function flashCalculator() {
    await runAction("flash", async () => {
      beginExportAction();
      setOutputEntries([]);
      setActivePreviewRunId("");
      setPreviewConsoleCommand("");
      await invoke("flash_to_calculator", {
        project: serializeProject(project),
      });
      setToast({ message: "Downloaded the latest device artifact and flashed it to the calculator.", tone: "success" });
      if (showExportPanel) {
        void refreshExportSupport(project.runtimeRoot).catch(() => undefined);
      }
    });
  }

  function showMissingExportToolsWarning(title: string, status: ExportTargetStatus) {
    if (status.missing.includes("npx")) {
      setToast({
        message: "Flash To Calculator needs npx installed locally. Install Node.js/npm so npx is available on your PATH, then try again.",
        tone: "error",
      });
      return;
    }

    setToast({
      message: `${title} needs these tools first: ${status.missing.join(", ")}.`,
      tone: "error",
    });
  }

  async function runSimulator() {
    await runAction("simulator", async () => {
      beginExportAction();
      setOutputEntries([]);
      setActivePreviewRunId("");
      setPreviewConsoleCommand("");
      const result = await invoke<PreviewLaunchResult>("run_simulator", {
        project: serializeProject(project),
      });
      setActivePreviewRunId(result.runId);
      setToast({
        message: `Downloaded the latest runtime and simulator archives and launched them with ${result.packPath}.`,
        tone: "success",
      });
      setWorkspaceView("preview");
    });
  }

  async function runPreviewConsoleCommand() {
    const command = previewConsoleCommand.trim();
    if (!command) {
      return;
    }
    if (!activePreviewRunId) {
      throw new Error("Launch the preview before running simulator Lua commands.");
    }

    appendOutputEntry("command", `> ${command}`);
    await invoke("execute_preview_lua", {
      runId: activePreviewRunId,
      command,
    });
    setPreviewConsoleCommand("");
  }

  async function handleSpriteImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const sprite = await fileToSprite(file);
    updateProject((current) => ({ ...current, sprites: [...current.sprites, sprite] }));
    setSelectedSpriteId(sprite.id);
    setSelectedFrameId(sprite.frames[0].id);
    setWorkspaceView("sprite");
    setToast({
      message: `Imported ${sprite.name} as a ${sprite.width}x${sprite.height} sprite.`,
      tone: "success",
    });
  }

  async function handleFrameImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedSprite) {
      return;
    }

    const image = await fileToImage(file);
    if (image.width !== selectedSprite.width || image.height !== selectedSprite.height) {
      throw new Error(
        `Frame import failed: expected ${selectedSprite.width}x${selectedSprite.height}, got ${image.width}x${image.height}.`,
      );
    }

    const frame = makeFrame(selectedSprite.width, selectedSprite.height, image.pixels);
    updateSprite(selectedSprite.id, (sprite) => ({ ...sprite, frames: [...sprite.frames, frame] }));
    setSelectedFrameId(frame.id);
    setToast({ message: `Imported a new frame into ${selectedSprite.name}.`, tone: "success" });
  }

  function roomPointFromClient(clientX: number, clientY: number) {
    const rect = roomStageRef.current?.getBoundingClientRect();
    if (!rect || !selectedRoom) {
      return null;
    }

    const rawX = Math.round((clientX - rect.left) / ROOM_EDITOR_SCALE);
    const rawY = Math.round((clientY - rect.top) / ROOM_EDITOR_SCALE);
    const x = clamp(rawX, 0, selectedRoom.width);
    const y = clamp(rawY, 0, selectedRoom.height);
    return { x, y };
  }

  function applyTileBrush(worldX: number, worldY: number, value: number) {
    if (!selectedRoom || !selectedTileLayer) {
      return;
    }
    const tileX = Math.floor(worldX / Math.max(selectedTileLayer.tileWidth, 1));
    const tileY = Math.floor(worldY / Math.max(selectedTileLayer.tileHeight, 1));
    const index = tileCellIndex(selectedTileLayer, tileX, tileY);
    if (index < 0) {
      return;
    }
    updateSelectedTileLayer((layer) => {
      const tiles = layer.tiles.slice();
      tiles[index] = value;
      return { ...layer, tiles };
    });
  }

  function applyTileCollisionBrush(worldX: number, worldY: number, solid: boolean) {
    if (!selectedRoom || !selectedTileLayer) {
      return;
    }
    const tileX = Math.floor(worldX / Math.max(selectedTileLayer.tileWidth, 1));
    const tileY = Math.floor(worldY / Math.max(selectedTileLayer.tileHeight, 1));
    const index = tileCellIndex(selectedTileLayer, tileX, tileY);
    if (index < 0) {
      return;
    }
    updateSelectedTileLayer((layer) => {
      const collisions = layer.collisions.slice();
      collisions[index] = solid;
      return { ...layer, collisions };
    });
  }

  function applyActiveTileBrush(worldX: number, worldY: number) {
    if (selectedRoomLayerKind !== "tile") {
      return;
    }
    if (tileEditMode === "collision") {
      applyTileCollisionBrush(worldX, worldY, roomTool === "place");
      return;
    }
    applyTileBrush(worldX, worldY, roomTool === "place" ? selectedTileIndex : -1);
  }

  function handleRoomPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const point = roomPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setRoomPointer({ inside: true, x: point.x, y: point.y });

    if (
      roomPaintStroke
      && roomPaintStroke.pointerId === event.pointerId
      && selectedRoomLayerKind === "tile"
      && roomTool !== "select"
      && roomTool !== "move"
      && roomTool !== "preview"
    ) {
      if (roomPaintStroke.mode === "collision") {
        applyTileCollisionBrush(point.x, point.y, Boolean(roomPaintStroke.value));
      } else {
        applyTileBrush(point.x, point.y, typeof roomPaintStroke.value === "number" ? roomPaintStroke.value : -1);
      }
    }
  }

  function handleRoomStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      selectedRoomLayerKind !== "tile"
      || (roomTool !== "place" && roomTool !== "erase")
      || event.target !== event.currentTarget
    ) {
      return;
    }

    const point = roomPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    event.preventDefault();
    const value =
      tileEditMode === "collision"
        ? roomTool === "place"
        : roomTool === "place"
          ? selectedTileIndex
          : -1;
    setRoomPaintStroke({
      pointerId: event.pointerId,
      mode: tileEditMode,
      value,
    });
    applyActiveTileBrush(point.x, point.y);
  }

  function handleRoomStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (roomPaintStroke?.pointerId === event.pointerId) {
      setRoomPaintStroke(null);
    }
  }

  function handleRoomDrop(event: DragEvent<HTMLDivElement>) {
    if (!selectedRoom || selectedRoomLayerKind !== "instance") {
      return;
    }

    event.preventDefault();
    const objectId = event.dataTransfer.getData("application/x-nwge-object-id");
    const point = roomPointFromClient(event.clientX, event.clientY);
    if (!objectId || !point) {
      return;
    }

    addPlacement(objectId, point.x, point.y);
  }

  function beginPlacementDrag(event: ReactPointerEvent<HTMLButtonElement>, placement: RoomPlacement) {
    if (roomTool !== "move" && roomTool !== "select") {
      return;
    }

    event.preventDefault();
    const rect = roomStageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const offsetX = (event.clientX - rect.left) / ROOM_EDITOR_SCALE - placement.x;
    const offsetY = (event.clientY - rect.top) / ROOM_EDITOR_SCALE - placement.y;
    setDragPlacement({ placementId: placement.id, offsetX, offsetY });
    setSelectedPlacementId(placement.id);
    setSelectedObjectId(placement.objectId);
    selectRoomLayer("instance", placement.layerId);
  }

  function handleRoomStageClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectedRoom) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    const point = roomPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (roomTool === "place") {
      if (selectedRoomLayerKind === "tile") {
        applyActiveTileBrush(point.x, point.y);
        return;
      }
      const x = snapRoomGrid ? Math.round(point.x / roomGridSize) * roomGridSize : point.x;
      const y = snapRoomGrid ? Math.round(point.y / roomGridSize) * roomGridSize : point.y;
      addPlacement(selectedObjectId, x, y);
      return;
    }

    if (roomTool === "erase" && selectedRoomLayerKind === "tile") {
      applyActiveTileBrush(point.x, point.y);
      return;
    }

    if (roomTool === "select" || roomTool === "move") {
      setSelectedPlacementId("");
      return;
    }

    if (roomTool === "preview") {
      setWorkspaceView("preview");
    }
  }

  function handlePlacementClick(placementId: string) {
    const placement = selectedRoom?.placements.find((entry) => entry.id === placementId) ?? null;
    if (roomTool === "erase") {
      removePlacement(placementId);
      return;
    }
    setSelectedPlacementId(placementId);
    if (placement) {
      setSelectedObjectId(placement.objectId);
      selectRoomLayer("instance", placement.layerId);
    }
  }

  function renderBackgroundLayer(layer: RoomBackgroundLayer, preview = false) {
    if (!selectedRoom) {
      return null;
    }
    const sprite = project.sprites.find((entry) => entry.id === layer.spriteId) ?? null;
    const frame = sprite?.frames[0] ?? null;
    const scale = preview ? 1 : ROOM_EDITOR_SCALE;
    const cameraX = preview ? selectedRoom.cameraX : selectedRoom.cameraX * ROOM_EDITOR_SCALE;
    const cameraY = preview ? selectedRoom.cameraY : selectedRoom.cameraY * ROOM_EDITOR_SCALE;
    const parallaxX = cameraX * layer.parallaxX;
    const parallaxY = cameraY * layer.parallaxY;
    return (
      <div
        key={layer.id}
        className="room-background-layer"
        style={{
          backgroundColor: layer.color,
          backgroundImage: frame ? `url(${frame.previewUrl})` : undefined,
          backgroundRepeat: layer.repeat ? "repeat" : "no-repeat",
          backgroundPosition: `${-parallaxX}px ${-parallaxY}px`,
          backgroundSize: frame ? `${sprite?.width ? sprite.width * scale : 0}px ${sprite?.height ? sprite.height * scale : 0}px` : undefined,
          zIndex: 0,
        }}
      />
    );
  }

  function renderTileLayer(layer: RoomTileLayer, preview = false) {
    const sprite = project.sprites.find((entry) => entry.id === layer.tilesetSpriteId) ?? null;
    const scale = preview ? 1 : ROOM_EDITOR_SCALE;
    return (
      <div key={layer.id} className="room-tile-layer" style={{ zIndex: 1 }}>
        {sprite && sprite.frames.length > 0
          ? layer.tiles.map((tile, index) => {
              if (tile < 0) {
                return null;
              }
              const tileX = index % layer.columns;
              const tileY = Math.floor(index / layer.columns);
              const frame = sprite.frames[tile];
              if (!frame) {
                return null;
              }
              return (
                <img
                  key={`${layer.id}-tile-${index}`}
                  className="room-tile"
                  src={frame.previewUrl}
                  alt=""
                  style={{
                    left: tileX * layer.tileWidth * scale,
                    top: tileY * layer.tileHeight * scale,
                    width: layer.tileWidth * scale,
                    height: layer.tileHeight * scale,
                  }}
                />
              );
            })
          : null}
        {!preview && showTileCollisionOverlay
          ? layer.collisions.map((solid, index) => {
              if (!solid) {
                return null;
              }
              const tileX = index % layer.columns;
              const tileY = Math.floor(index / layer.columns);
              const isSelectedLayer = selectedRoomLayerKind === "tile" && selectedRoomLayerId === layer.id;
              return (
                <div
                  key={`${layer.id}-collision-${index}`}
                  className={isSelectedLayer ? "room-tile-collision active" : "room-tile-collision"}
                  style={{
                    left: tileX * layer.tileWidth * scale,
                    top: tileY * layer.tileHeight * scale,
                    width: layer.tileWidth * scale,
                    height: layer.tileHeight * scale,
                  }}
                />
              );
            })
          : null}
      </div>
    );
  }

  function renderScriptRack(
    title: string,
    scriptIds: string[],
    onAdd: (scriptId: string) => void,
    onRemove: (scriptId: string) => void,
  ) {
    const availableScripts = project.scripts.filter((script) => !scriptIds.includes(script.id));
    return (
      <div className="rack-box" key={title}>
        <div className="rack-header">
          <span>{title}</span>
          <small>{scriptIds.length} linked</small>
        </div>
        <div className="rack-list">
          {scriptIds.length > 0 ? (
            scriptIds.map((scriptId) => {
              const script = project.scripts.find((entry) => entry.id === scriptId);
              return (
                <div key={`${title}-${scriptId}`} className="rack-item">
                  <strong>{script?.name ?? "Missing script"}</strong>
                  <ActionButton className="mini-button danger" icon="delete" label={`Remove ${title} script`} onClick={() => onRemove(scriptId)} />
                </div>
              );
            })
          ) : (
            <div className="rack-empty">No scripts attached.</div>
          )}
        </div>
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) {
              onAdd(event.target.value);
              event.target.value = "";
            }
          }}
        >
          <option value="">Add script...</option>
          {availableScripts.map((script) => (
            <option key={script.id} value={script.id}>
              {script.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderLuaEditor(script: ScriptAsset | null, uri: string) {
    if (!script) {
      return <div className="editor-empty">No Lua script selected.</div>;
    }

    const path = uri || `inmemory://nwge/${script.id}.lua`;
    return (
      <div className="code-shell">
        <Editor
          key={path}
          height="100%"
          language="lua"
          path={path}
          beforeMount={handleScriptEditorBeforeMount}
          onMount={handleScriptEditorMount}
          theme={project.themeMode === "dark" ? "nwge-dark" : "nwge-light"}
          value={script.code}
          onChange={(value) => updateScript(script.id, (entry) => ({ ...entry, code: value ?? "" }))}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "Consolas, 'Liberation Mono', monospace",
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            roundedSelection: false,
            wordWrap: "off",
            fixedOverflowWidgets: true,
          }}
        />
      </div>
    );
  }

  function renderProjectWorkspace() {
    const projectIconSprite = project.sprites.find((sprite) => sprite.id === project.iconSpriteId);
    const projectIconPreview = projectIconSprite?.frames[0]?.previewUrl ?? "";

    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Global Settings</p>
            <h2>{project.name}</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="add" label="New Environment Variable" onClick={addConfigEntry}>
              New Environment Variable
            </ActionButton>
          </div>
        </div>

        <div className="project-grid">
          <div className="classic-group">
            <div className="group-title">Project Setup</div>
            <div className="form-grid">
              <label className="form-row">
                <span>Name</span>
                <input value={project.name} onChange={(event) => setProjectField("name", event.target.value)} />
              </label>
              <label className="form-row">
                <span>Theme</span>
                <select
                  value={project.themeMode}
                  onChange={(event) => setProjectField("themeMode", event.target.value as ThemeMode)}
                >
                  <option value="light">Classic Light</option>
                  <option value="dark">Classic Dark</option>
                </select>
              </label>
              <label className="form-row span-2">
                <span>Calculator Icon</span>
                <div className="project-icon-field">
                  <select value={project.iconSpriteId} onChange={(event) => setProjectField("iconSpriteId", event.target.value)}>
                    <option value="">Default runtime icon</option>
                    {project.sprites.map((sprite) => (
                      <option key={sprite.id} value={sprite.id}>
                        {sprite.name}
                      </option>
                    ))}
                  </select>
                  <div className="project-icon-preview" aria-label="Calculator icon preview">
                    {projectIconPreview
                      ? <img src={projectIconPreview} alt={`${project.name} icon preview`} />
                      : <span>Default</span>}
                  </div>
                </div>
                <div className="project-icon-note">
                  {projectIconSprite
                    ? "Uses the first frame and scales it to the NumWorks icon size for embedded .nwa exports."
                    : "Uses the runtime's default calculator icon until you choose a sprite."}
                </div>
              </label>
              <label className="form-row">
                <span>Startup Room</span>
                <select value={selectedRoom?.id ?? ""} onChange={(event) => selectRoomView(event.target.value)}>
                  {project.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="preview-note project-setup-note span-2">
                Save Project and export actions now prompt for destinations when needed, so you no longer have to manage project, pack, or runtime paths here.
              </div>
            </div>
          </div>

          <div className="classic-group">
            <div className="group-title">Global Lifecycle</div>
            <div className="rack-grid">
              {LIFECYCLE_EVENTS.map((eventMeta) =>
                renderScriptRack(
                  `Game ${eventMeta.label}`,
                  project[gameEventFieldMap[eventMeta.key]],
                  (scriptId) => addProjectEventScript(gameEventFieldMap[eventMeta.key], scriptId),
                  (scriptId) => removeProjectEventScript(gameEventFieldMap[eventMeta.key], scriptId),
                ),
              )}
            </div>
          </div>
        </div>

        <div className="classic-group">
          <div className="group-title">Environment Variables</div>
          <div className="config-table">
            <div className="config-head">
              <span>Name</span>
              <span>Type</span>
              <span>Value</span>
              <span />
            </div>
            {project.config.map((entry) => (
              <div key={entry.id} className="config-row">
                <input
                  value={entry.name}
                  onChange={(event) => renameResource("config", entry.id, event.target.value)}
                />
                <select
                  value={entry.valueType}
                  onChange={(event) =>
                    updateProject((current) => ({
                      ...current,
                      config: current.config.map((item) =>
                        item.id === entry.id ? { ...item, valueType: event.target.value as ConfigValueType } : item,
                      ),
                    }))
                  }
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                </select>
                {entry.valueType === "boolean" ? (
                  <select
                    value={entry.value === "false" ? "false" : "true"}
                    onChange={(event) =>
                      updateProject((current) => ({
                        ...current,
                        config: current.config.map((item) =>
                          item.id === entry.id ? { ...item, value: event.target.value } : item,
                        ),
                      }))
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    value={entry.value}
                    onChange={(event) =>
                      updateProject((current) => ({
                        ...current,
                        config: current.config.map((item) =>
                          item.id === entry.id ? { ...item, value: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                )}
                <ActionButton className="mini-button danger" icon="delete" label="Delete environment variable" onClick={() => deleteConfigEntry(entry.id)} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderSpriteWorkspace() {
    if (!selectedSprite) {
      return <section className="workspace-pane empty-pane">No sprite selected.</section>;
    }

    const spritePreviewScale = Math.max(
      1,
      Math.min(
        SPRITE_PREVIEW_MAX_SCALE,
        Math.floor(SPRITE_PREVIEW_TARGET_SIZE / Math.max(selectedSprite.width, selectedSprite.height)) || 1,
      ),
    );
    const previewWidth = selectedSprite.width * spritePreviewScale;
    const previewHeight = selectedSprite.height * spritePreviewScale;
    const bboxLeft = Math.min(selectedSprite.bboxLeft, selectedSprite.bboxRight);
    const bboxTop = Math.min(selectedSprite.bboxTop, selectedSprite.bboxBottom);
    const bboxRight = Math.max(selectedSprite.bboxLeft, selectedSprite.bboxRight);
    const bboxBottom = Math.max(selectedSprite.bboxTop, selectedSprite.bboxBottom);
    const spriteEditorColor = hexToRgba(spriteColor);
    const selectionWidth = activeSpriteSelection ? activeSpriteSelection.right - activeSpriteSelection.left + 1 : 0;
    const selectionHeight = activeSpriteSelection ? activeSpriteSelection.bottom - activeSpriteSelection.top + 1 : 0;

    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Sprite Editor</p>
            <h2>{selectedSprite.name}</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="duplicate" label="Duplicate Sprite" onClick={() => duplicateSprite(selectedSprite.id)}>
              Duplicate
            </ActionButton>
            <ActionButton className="tool-button" icon="rename" label="Rename Sprite" onClick={() => promptRenameResource("sprite", selectedSprite.id, selectedSprite.name)}>
              Rename
            </ActionButton>
            <ActionButton className="tool-button" icon="add" label="New Frame" onClick={addFrame}>
              New Frame
            </ActionButton>
            <ActionButton className="tool-button" icon="import" label="Import Frame" onClick={() => importFrameInputRef.current?.click()}>
              Import Frame
            </ActionButton>
            <ActionButton className="tool-button danger" icon="delete" label="Delete Sprite" onClick={() => deleteSprite(selectedSprite.id)}>
              Delete
            </ActionButton>
          </div>
        </div>

        <div className="sprite-layout">
          <div className="classic-group">
            <div className="group-title">Editor</div>
            <div className="sprite-editor-toolbar">
              <div className="sprite-tool-grid" role="toolbar" aria-label="Sprite tools">
                {SPRITE_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={spriteTool === tool.id ? "sprite-tool active" : "sprite-tool"}
                      onClick={() => setSpriteTool(tool.id)}
                      aria-pressed={spriteTool === tool.id}
                      title={tool.label}
                    >
                      <Icon aria-hidden size={15} strokeWidth={1.9} />
                      <span>{tool.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="sprite-tool-controls">
                <label className="stacked-label sprite-color-field">
                  <span>Color</span>
                  <div className="sprite-color-control">
                    <input type="color" value={spriteColor} onChange={(event) => setSpriteColor(event.target.value)} />
                    <div className="sprite-color-swatch">
                      <span className="sprite-color-dot" style={{ background: rgbaToCss(spriteEditorColor) }} />
                      <code>{spriteColor.toUpperCase()}</code>
                    </div>
                  </div>
                </label>

                <div className="sprite-selection-actions">
                  <button type="button" className="mini-button" onClick={applyCurrentColorToSelection} disabled={!spriteSelection}>
                    Apply To Selection
                  </button>
                  <button type="button" className="mini-button" onClick={() => setSpriteSelection(null)} disabled={!spriteSelection}>
                    Clear Selection
                  </button>
                </div>

                <label className="stacked-label">
                  <span>Brush Width</span>
                  <div className="sprite-range-row">
                    <input
                      type="range"
                      min="1"
                      max={String(SPRITE_EDITOR_MAX_BRUSH_SIZE)}
                      value={spriteBrushSize}
                      onChange={(event) => setSpriteBrushSize(clamp(Number(event.target.value) || 1, 1, SPRITE_EDITOR_MAX_BRUSH_SIZE))}
                    />
                    <strong>{spriteBrushSize}px</strong>
                  </div>
                </label>

                <label className="stacked-label">
                  <span>Zoom</span>
                  <div className="sprite-zoom-row">
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => setSpriteZoom((current) => clamp(current - 4, SPRITE_EDITOR_MIN_ZOOM, SPRITE_EDITOR_MAX_ZOOM))}
                    >
                      <Minus aria-hidden size={14} strokeWidth={1.9} />
                    </button>
                    <input
                      type="range"
                      min={String(SPRITE_EDITOR_MIN_ZOOM)}
                      max={String(SPRITE_EDITOR_MAX_ZOOM)}
                      step="2"
                      value={spriteZoom}
                      onChange={(event) => setSpriteZoom(clamp(Number(event.target.value) || SPRITE_EDITOR_DEFAULT_ZOOM, SPRITE_EDITOR_MIN_ZOOM, SPRITE_EDITOR_MAX_ZOOM))}
                    />
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => setSpriteZoom((current) => clamp(current + 4, SPRITE_EDITOR_MIN_ZOOM, SPRITE_EDITOR_MAX_ZOOM))}
                    >
                      <Plus aria-hidden size={14} strokeWidth={1.9} />
                    </button>
                    <strong>{spriteZoom}x</strong>
                  </div>
                </label>
              </div>
            </div>

            <div className="sprite-editor-stage">
              <canvas
                ref={spriteCanvasRef}
                className="sprite-editor-canvas"
                width={selectedSprite.width * spriteZoom}
                height={selectedSprite.height * spriteZoom}
                style={{ width: selectedSprite.width * spriteZoom, height: selectedSprite.height * spriteZoom }}
                onPointerDown={handleSpritePointerDown}
                onPointerMove={handleSpritePointerMove}
                onPointerUp={(event) => finishSpriteInteraction(event.pointerId)}
                onPointerCancel={(event) => cancelSpriteInteraction(event.pointerId)}
              />
            </div>

            <div className="sprite-editor-status">
              <span>Tool: {SPRITE_TOOLS.find((tool) => tool.id === spriteTool)?.label ?? "Draw"}</span>
              <span>Frame: {selectedSprite.frames.findIndex((frame) => frame.id === selectedFrame?.id) + 1 || 1}</span>
              <span>Size: {selectedSprite.width} x {selectedSprite.height}</span>
              {activeSpriteSelection ? <span>Selection: {selectionWidth} x {selectionHeight}</span> : null}
            </div>

            <div className="group-title sprite-preview-title">Preview</div>
            <div className="sprite-preview-stage">
              <div className="sprite-preview-stack" style={{ width: previewWidth, height: previewHeight }}>
                {liveSpritePreviewUrl ? <img src={liveSpritePreviewUrl} alt={selectedSprite.name} className="sprite-preview-image" /> : null}
                <div
                  className="sprite-bbox-box"
                  style={{
                    left: bboxLeft * spritePreviewScale,
                    top: bboxTop * spritePreviewScale,
                    width: (bboxRight - bboxLeft + 1) * spritePreviewScale,
                    height: (bboxBottom - bboxTop + 1) * spritePreviewScale,
                  }}
                >
                  <span className="sprite-bbox-label">BBox</span>
                </div>
                <div
                  className="sprite-origin-marker"
                  style={{
                    left: selectedSprite.originX * spritePreviewScale,
                    top: selectedSprite.originY * spritePreviewScale,
                  }}
                  aria-label={`Origin ${selectedSprite.originX}, ${selectedSprite.originY}`}
                  title={`Origin ${selectedSprite.originX}, ${selectedSprite.originY}`}
                >
                  <Crosshair className="sprite-origin-icon" aria-hidden size={18} strokeWidth={2.1} />
                </div>
              </div>
            </div>
            <div className="frame-strip">
              {selectedSprite.frames.map((frame, index) => (
                <button
                  type="button"
                  key={frame.id}
                  className={frame.id === selectedFrameId ? "frame-chip active" : "frame-chip"}
                  onClick={() => setSelectedFrameId(frame.id)}
                >
                  <img src={frame.previewUrl} alt="" />
                  <span>Frame {index + 1}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="classic-group">
            <div className="group-title">Sprite Properties</div>
            <div className="form-grid">
              <label className="form-row">
                <span>Name</span>
                <input value={selectedSprite.name} onChange={(event) => renameResource("sprite", selectedSprite.id, event.target.value)} />
              </label>
              <label className="form-row">
                <span>Width</span>
                <input value={String(selectedSprite.width)} readOnly />
              </label>
              <label className="form-row">
                <span>Height</span>
                <input value={String(selectedSprite.height)} readOnly />
              </label>
              <label className="form-row">
                <span>Frame Time (ms)</span>
                <input
                  type="number"
                  min="0"
                  max="65535"
                  value={selectedSprite.frameDurationMs}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      frameDurationMs: clamp(Number(event.target.value) || 0, 0, 65535),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>Origin X</span>
                <input
                  type="number"
                  value={selectedSprite.originX}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      originX: clamp(Number(event.target.value) || 0, 0, sprite.width),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>Origin Y</span>
                <input
                  type="number"
                  value={selectedSprite.originY}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      originY: clamp(Number(event.target.value) || 0, 0, sprite.height),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>BBox Left</span>
                <input
                  type="number"
                  value={selectedSprite.bboxLeft}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      bboxLeft: clamp(Number(event.target.value) || 0, 0, sprite.width - 1),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>BBox Top</span>
                <input
                  type="number"
                  value={selectedSprite.bboxTop}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      bboxTop: clamp(Number(event.target.value) || 0, 0, sprite.height - 1),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>BBox Right</span>
                <input
                  type="number"
                  value={selectedSprite.bboxRight}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      bboxRight: clamp(Number(event.target.value) || 0, 0, sprite.width - 1),
                    }))
                  }
                />
              </label>
              <label className="form-row">
                <span>BBox Bottom</span>
                <input
                  type="number"
                  value={selectedSprite.bboxBottom}
                  onChange={(event) =>
                    updateSprite(selectedSprite.id, (sprite) => ({
                      ...sprite,
                      bboxBottom: clamp(Number(event.target.value) || 0, 0, sprite.height - 1),
                    }))
                  }
                />
              </label>
            </div>
            {selectedFrame && selectedSprite.frames.length > 1 ? (
              <div className="footer-actions">
                <ActionButton className="mini-button danger" icon="delete" label="Delete Current Frame" onClick={() => deleteFrame(selectedSprite.id, selectedFrame.id)}>
                  Delete Current Frame
                </ActionButton>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  function renderScriptWorkspace() {
    if (!selectedScript) {
      return <section className="workspace-pane empty-pane">No script selected.</section>;
    }

    const selectedRuntimeDoc = RUNTIME_DOCS.find((entry) => entry.id === selectedRuntimeDocId) ?? RUNTIME_DOCS[0];

    function openRuntimeDoc(docId: RuntimeDocId, anchor = "") {
      setSelectedRuntimeDocId(docId);
      setPendingRuntimeDocAnchor(anchor);
    }

    function handleRuntimeDocClick(event: ReactMouseEvent<HTMLDivElement>) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const docId = anchor.dataset.docId as RuntimeDocId | undefined;
      if (!docId) {
        return;
      }

      event.preventDefault();
      openRuntimeDoc(docId, anchor.dataset.docAnchor ?? "");
    }

    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Lua Script</p>
            <h2>{selectedScript.name}</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="duplicate" label="Duplicate Script" onClick={() => duplicateScript(selectedScript.id)}>
              Duplicate
            </ActionButton>
            <ActionButton className="tool-button" icon="rename" label="Rename Script" onClick={() => promptRenameResource("script", selectedScript.id, selectedScript.name)}>
              Rename
            </ActionButton>
            <ActionButton className="tool-button" icon="add" label="New Script" onClick={addScript}>
              New Script
            </ActionButton>
            <ActionButton className="tool-button danger" icon="delete" label="Delete Script" onClick={() => deleteScript(selectedScript.id)}>
              Delete
            </ActionButton>
          </div>
        </div>

        <div className="classic-group">
          <div className="group-title">Script Properties</div>
          <div className="form-grid short-grid">
            <label className="form-row span-2">
              <span>Name</span>
              <input value={selectedScript.name} onChange={(event) => renameResource("script", selectedScript.id, event.target.value)} />
            </label>
            <label className="form-row">
              <span>Lines</span>
              <input value={String(selectedScript.code.split("\n").length)} readOnly />
            </label>
          </div>
        </div>

        <div className="script-workbench">
          <div className="editor-panel">{renderLuaEditor(selectedScript, selectedScriptUri)}</div>
          <aside className="docs-panel">
            <div className="docs-panel-header">
              <div>
                <p className="section-kicker">Runtime Docs</p>
                <h3>{selectedRuntimeDoc.title}</h3>
              </div>
              <div className="docs-tab-row" role="tablist" aria-label="Runtime docs">
                {RUNTIME_DOCS.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedRuntimeDocId === doc.id}
                    className={selectedRuntimeDocId === doc.id ? "docs-tab active" : "docs-tab"}
                    onClick={() => openRuntimeDoc(doc.id)}
                  >
                    {doc.title}
                  </button>
                ))}
              </div>
            </div>
            <div ref={docsPanelBodyRef} className="docs-panel-body" onClick={handleRuntimeDocClick}>
              {runtimeDocState[selectedRuntimeDocId] === "ready" ? (
                <div className="docs-markdown" dangerouslySetInnerHTML={{ __html: runtimeDocHtml[selectedRuntimeDocId] }} />
              ) : runtimeDocState[selectedRuntimeDocId] === "error" ? (
                <div className="docs-status">
                  Unable to load `{selectedRuntimeDoc.fileName}`: {runtimeDocError[selectedRuntimeDocId]}
                </div>
              ) : (
                <div className="docs-status">Loading `{selectedRuntimeDoc.fileName}`...</div>
              )}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  function renderObjectWorkspace() {
    if (!selectedObject) {
      return <section className="workspace-pane empty-pane">No object selected.</section>;
    }

    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Object Editor</p>
            <h2>{selectedObject.name}</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="duplicate" label="Duplicate Object" onClick={() => duplicateObject(selectedObject.id)}>
              Duplicate
            </ActionButton>
            <ActionButton className="tool-button" icon="rename" label="Rename Object" onClick={() => promptRenameResource("object", selectedObject.id, selectedObject.name)}>
              Rename
            </ActionButton>
            <ActionButton className="tool-button" icon="event" label="New Event Script" onClick={createScriptForFocusedEvent}>
              New Event Script
            </ActionButton>
            <ActionButton className="tool-button danger" icon="delete" label="Delete Object" onClick={() => deleteObject(selectedObject.id)}>
              Delete
            </ActionButton>
          </div>
        </div>

        <div className="classic-group">
          <div className="group-title">Object Setup</div>
          <div className="form-grid">
            <label className="form-row">
              <span>Name</span>
              <input value={selectedObject.name} onChange={(event) => renameResource("object", selectedObject.id, event.target.value)} />
            </label>
            <label className="form-row">
              <span>Sprite</span>
              <select value={selectedObject.spriteId} onChange={(event) => updateObject(selectedObject.id, (entry) => ({ ...entry, spriteId: event.target.value }))}>
                <option value="">None</option>
                {project.sprites.map((sprite) => (
                  <option key={sprite.id} value={sprite.id}>
                    {sprite.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span>Parent</span>
              <select value={selectedObject.parentObjectId} onChange={(event) => updateObject(selectedObject.id, (entry) => ({ ...entry, parentObjectId: event.target.value }))}>
                <option value="">None</option>
                {project.objects
                  .filter((entry) => entry.id !== selectedObject.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>

        <div className="object-editor-layout">
          <div className="classic-group">
            <div className="group-title">Events</div>
            <div className="property-note">
              Standard events inherit from parent objects. Alarm and button events can be selected below for editing.
            </div>
            <div className="event-list">
              {EVENT_BINDINGS.map((binding) => {
                const scriptId = resolveInheritedEventScriptId(selectedObject.id, binding.field, project.objects);
                const script = project.scripts.find((entry) => entry.id === scriptId) ?? null;
                return (
                  <button
                    key={binding.field}
                    className={focusedEventKind === "standard" && binding.field === focusedEventField ? "event-row active" : "event-row"}
                    onClick={() => {
                      setFocusedEventKind("standard");
                      setFocusedEventField(binding.field);
                    }}
                  >
                    <AppIcon name={binding.icon} className="event-row-icon" />
                    <span className="event-row-copy">
                      <strong>{binding.label}</strong>
                      <small>{script?.name ?? binding.hint}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="stacked-label">
              <span>Alarm Event</span>
              <select
                value={focusedAlarmIndex}
                onChange={(event) => {
                  setFocusedEventKind("alarm");
                  setFocusedAlarmIndex(Number(event.target.value) || 0);
                }}
              >
                {Array.from({ length: ALARM_EVENT_COUNT }, (_, index) => (
                  <option key={index} value={index}>
                    Alarm {index}
                  </option>
                ))}
              </select>
              <small>
                {project.scripts.find((script) => script.id === resolveInheritedAlarmScriptId(selectedObject.id, focusedAlarmIndex, project.objects))?.name
                  ?? "No alarm script attached"}
              </small>
            </label>
            <label className="stacked-label">
              <span>Button Event</span>
              <select
                value={focusedButtonField}
                onChange={(event) => {
                  setFocusedEventKind("button");
                  setFocusedButtonField(event.target.value as ButtonEventField);
                }}
              >
                {BUTTON_EVENT_FIELDS.map((entry) => (
                  <option key={entry.field} value={entry.field}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <select
                value={focusedButtonId}
                onChange={(event) => {
                  setFocusedEventKind("button");
                  setFocusedButtonId(event.target.value);
                }}
              >
                {BUTTON_EVENT_KEYS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <small>
                {project.scripts.find(
                  (script) =>
                    script.id === resolveInheritedMappedEventScriptId(selectedObject.id, focusedButtonField, focusedButtonId, project.objects),
                )?.name ?? "No button script attached"}
              </small>
            </label>
            <div className="event-controls">
              <ActionButton className="mini-button" icon="event" label="Create Event Script" onClick={createScriptForFocusedEvent}>
                New Script
              </ActionButton>
              <ActionButton
                className="mini-button"
                icon="open"
                label="Open Event Script"
                onClick={() => {
                  if (focusedEventScript) {
                    setSelectedScriptId(focusedEventScript.id);
                    setWorkspaceView("script");
                  }
                }}
                disabled={!focusedEventScript}
              >
                Open Script
              </ActionButton>
              <ActionButton className="mini-button danger" icon="delete" label="Clear Event Script" onClick={clearFocusedEvent} disabled={!focusedEventScriptId}>
                Clear Event
              </ActionButton>
            </div>
            <label className="stacked-label">
              <span>Attach Existing Script</span>
              <select value={focusedEventScriptId} onChange={(event) => assignScriptToFocusedEvent(event.target.value)}>
                <option value="">None</option>
                {project.scripts.map((script) => (
                  <option key={script.id} value={script.id}>
                    {script.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="classic-group object-script-group">
            <div className="group-title">{focusedEventMeta.label} Event Script</div>
            {focusedEventScript ? (
              <>
                <div className="event-script-header">
                  <div className="script-identity">
                    <AppIcon name={focusedEventMeta.icon} className="event-pill" />
                    <div>
                      <strong>{focusedEventScript.name}</strong>
                      <small>{focusedEventScript.code.split("\n").length} lines</small>
                    </div>
                  </div>
                </div>
                <div className="event-script-editor">{renderLuaEditor(focusedEventScript, focusedEventScriptUri)}</div>
              </>
            ) : (
              <div className="event-empty">
                <p>No script is attached to the {focusedEventMeta.label} event.</p>
                <div className="footer-actions">
                  <ActionButton className="mini-button" icon="event" label="Create Event Script" onClick={createScriptForFocusedEvent}>
                    Create Event Script
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderRoomWorkspace() {
    if (!selectedRoom) {
      return <section className="workspace-pane empty-pane">No room selected.</section>;
    }

    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Room Editor</p>
            <h2>{selectedRoom.name}</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="duplicate" label="Duplicate Room" onClick={() => duplicateRoom(selectedRoom.id)}>
              Duplicate
            </ActionButton>
            <ActionButton className="tool-button" icon="rename" label="Rename Room" onClick={() => promptRenameResource("room", selectedRoom.id, selectedRoom.name)}>
              Rename
            </ActionButton>
            <ActionButton className="tool-button" icon="add" label="New Room" onClick={addRoom}>
              New Room
            </ActionButton>
            <ActionButton className="tool-button danger" icon="delete" label="Delete Room" onClick={() => deleteRoom(selectedRoom.id)}>
              Delete
            </ActionButton>
          </div>
        </div>

        <div className="room-toolbar">
          {ROOM_TOOLS.map((tool) => (
            <button
              key={tool.id}
              className={roomTool === tool.id ? "tool-toggle active" : "tool-toggle"}
              aria-label={tool.label}
              title={tool.label}
              onClick={() => {
                if (tool.id === "preview") {
                  setWorkspaceView("preview");
                } else {
                  setWorkspaceView("room");
                  setRoomTool(tool.id);
                }
              }}
            >
              <AppIcon name={tool.icon} className="button-icon" />
              <span className="button-label">{tool.label}</span>
            </button>
          ))}
          <div className="toolbar-spacer" />
          {selectedRoomLayerKind === "tile" ? (
            <>
              <label className="toggle-inline">
                <input
                  type="radio"
                  name="tile-edit-mode"
                  checked={tileEditMode === "art"}
                  onChange={() => setTileEditMode("art")}
                />
                Tiles
              </label>
              <label className="toggle-inline">
                <input
                  type="radio"
                  name="tile-edit-mode"
                  checked={tileEditMode === "collision"}
                  onChange={() => setTileEditMode("collision")}
                />
                Collision
              </label>
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={showTileCollisionOverlay}
                  onChange={(event) => setShowTileCollisionOverlay(event.target.checked)}
                />
                Solid Overlay
              </label>
            </>
          ) : null}
          <label className="toggle-inline">
            <input type="checkbox" checked={showRoomGrid} onChange={(event) => setShowRoomGrid(event.target.checked)} />
            Grid
          </label>
          <label className="toggle-inline">
            <input type="checkbox" checked={snapRoomGrid} onChange={(event) => setSnapRoomGrid(event.target.checked)} />
            Snap
          </label>
          <label className="inline-number">
            <span>Grid</span>
            <input
              type="number"
              min={4}
              max={64}
              value={roomGridSize}
              onChange={(event) => setRoomGridSize(clamp(Number(event.target.value) || 16, 4, 64))}
            />
          </label>
        </div>

        <div className="room-layout">
          <div className="classic-group room-group">
            <div className="group-title">Scene</div>
            <div className="room-info-strip">
              <span>Tool: {roomTool}</span>
              <span>Layer: {activeRoomLayer ? `${roomLayerLabel(selectedRoomLayerKind)} ${activeRoomLayer.name}` : "None"}</span>
              {selectedRoomLayerKind === "tile" ? <span>Tile Mode: {tileEditMode === "art" ? "tiles" : "collision"}</span> : null}
              <span>Room: {selectedRoom.width} x {selectedRoom.height}</span>
              <span>Camera: {selectedRoom.cameraX}, {selectedRoom.cameraY}</span>
              <span>Mouse: {roomPointer.inside ? `${roomPointer.x}, ${roomPointer.y}` : "--, --"}</span>
            </div>
            <div className="room-stage-wrap">
              <div
                ref={roomStageRef}
                className="room-stage"
                style={{
                  width: selectedRoom.width * ROOM_EDITOR_SCALE,
                  height: selectedRoom.height * ROOM_EDITOR_SCALE,
                  backgroundSize: showRoomGrid
                    ? `${roomGridSize * ROOM_EDITOR_SCALE}px ${roomGridSize * ROOM_EDITOR_SCALE}px`
                    : undefined,
                }}
                onPointerDown={handleRoomStagePointerDown}
                onPointerMove={handleRoomPointerMove}
                onPointerUp={handleRoomStagePointerUp}
                onPointerCancel={handleRoomStagePointerUp}
                onPointerLeave={() => setRoomPointer((current) => ({ ...current, inside: false }))}
                onClick={handleRoomStageClick}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleRoomDrop}
              >
                <div className="room-axis room-axis-top">0</div>
                <div className="room-axis room-axis-right">{selectedRoom.width}</div>
                <div className="room-axis room-axis-bottom">{selectedRoom.height}</div>

                {orderedRoomLayers.map((layer, layerIndex) => {
                  if (layer.kind === "background") {
                    const entry = selectedRoom.backgroundLayers.find((candidate) => candidate.id === layer.id);
                    return entry ? <div key={layer.id} style={{ zIndex: layerIndex }}>{renderBackgroundLayer(entry)}</div> : null;
                  }
                  if (layer.kind === "tile") {
                    const entry = selectedRoom.tileLayers.find((candidate) => candidate.id === layer.id);
                    return entry ? <div key={layer.id} style={{ zIndex: layerIndex }}>{renderTileLayer(entry)}</div> : null;
                  }
                  return selectedRoom.placements
                    .filter((placement) => placement.layerId === layer.id)
                    .map((placement) => {
                      const sprite = objectSpriteLookup.get(placement.objectId);
                      const preview = sprite?.frames[0]?.previewUrl ?? "";
                      const objectName = project.objects.find((entry) => entry.id === placement.objectId)?.name ?? "obj";
                      return (
                        <button
                          key={placement.id}
                          className={placement.id === selectedPlacementId ? "room-instance active" : "room-instance"}
                          style={{
                            zIndex: layerIndex + 1,
                            left: placement.x * ROOM_EDITOR_SCALE,
                            top: placement.y * ROOM_EDITOR_SCALE,
                            width: Math.max((sprite?.width ?? 12) * ROOM_EDITOR_SCALE, 12),
                            height: Math.max((sprite?.height ?? 12) * ROOM_EDITOR_SCALE, 12),
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePlacementClick(placement.id);
                          }}
                          onPointerDown={(event) => beginPlacementDrag(event, placement)}
                        >
                          {preview ? <img src={preview} alt={objectName} /> : <span>{objectName.slice(0, 2).toUpperCase()}</span>}
                        </button>
                      );
                    });
                })}

                <div
                  className="camera-box"
                  style={{
                    left: selectedRoom.cameraX * ROOM_EDITOR_SCALE,
                    top: selectedRoom.cameraY * ROOM_EDITOR_SCALE,
                    width: roomViewportWidth * ROOM_EDITOR_SCALE,
                    height: roomViewportHeight * ROOM_EDITOR_SCALE,
                  }}
                >
                  View
                </div>
              </div>
            </div>
          </div>

          <div className="room-sidebar">
            <div className="classic-group room-palette-group">
              <div className="group-title">Layers</div>
              <div className="room-layer-actions">
                <ActionButton className="mini-button" icon="add" label="Add Background Layer" onClick={addBackgroundLayer} />
                <ActionButton className="mini-button" icon="add" label="Add Tile Layer" onClick={addTileLayer} />
                <ActionButton className="mini-button" icon="add" label="Add Instance Layer" onClick={addInstanceLayer} />
                <ActionButton className="mini-button danger" icon="delete" label="Delete Selected Layer" onClick={removeSelectedLayer} />
              </div>
              <div className="room-layer-list">
                {orderedRoomLayers.map((layer) => (
                  <button
                    key={layer.id}
                    className={layer.id === selectedRoomLayerId && layer.kind === selectedRoomLayerKind ? "room-layer-row active" : "room-layer-row"}
                    onClick={() => selectRoomLayer(layer.kind, layer.id)}
                  >
                    <strong>{layer.name}</strong>
                    <span>{roomLayerLabel(layer.kind)} · depth {layer.depth}</span>
                  </button>
                ))}
              </div>
            </div>

            {selectedRoomLayerKind === "tile" ? (
              <div className="classic-group room-palette-group">
                <div className="group-title">Tile Palette</div>
                <div className="property-note">
                  {tileEditMode === "collision"
                    ? "`Place` paints solid collision cells, and `Erase` clears them on the active tile layer."
                    : "`Place` paints the selected tile, and `Erase` clears it on the active tile layer."}
                </div>
                <div className="tile-palette">
                  {selectedTileOptions.map((tile) => (
                    <button
                      key={tile.index}
                      className={tile.index === selectedTileIndex ? "tile-chip active" : "tile-chip"}
                      onClick={() => {
                        setSelectedTileIndex(tile.index);
                        setTileEditMode("art");
                        setRoomTool("place");
                      }}
                    >
                      <img
                        className="tile-chip-preview"
                        src={tile.previewUrl}
                        alt=""
                        style={{
                          width: selectedTileLayer?.tileWidth ? selectedTileLayer.tileWidth * 2 : 32,
                          height: selectedTileLayer?.tileHeight ? selectedTileLayer.tileHeight * 2 : 32,
                        }}
                      />
                      <span>Tile {tile.index}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="classic-group room-palette-group">
                <div className="group-title">Object Palette</div>
                <div className="object-palette">
                  {project.objects.map((entry) => {
                    const sprite = objectSpriteLookup.get(entry.id);
                    return (
                      <button
                        key={entry.id}
                        className={entry.id === selectedObjectId ? "palette-tile active" : "palette-tile"}
                        draggable={selectedRoomLayerKind === "instance"}
                        onDragStart={(event) => event.dataTransfer.setData("application/x-nwge-object-id", entry.id)}
                        onClick={() => {
                          setSelectedObjectId(entry.id);
                          setRoomTool("place");
                        }}
                      >
                        <div className="palette-thumb">
                          {sprite?.frames[0] ? <img src={sprite.frames[0].previewUrl} alt={entry.name} /> : <span>OB</span>}
                        </div>
                        <span>{entry.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderPreviewWorkspace() {
    return (
      <section className="workspace-pane">
        <div className="workspace-header">
          <div>
            <p className="section-kicker">Preview</p>
            <h2>Run Simulator</h2>
          </div>
          <div className="header-actions">
            <ActionButton className="tool-button" icon="package" label="Open Export Panel" onClick={openExportPanel}>
              Export
            </ActionButton>
            <ActionButton className="tool-button" icon="preview" label="Run Simulator" onClick={runSimulator}>
              Run Simulator
            </ActionButton>
          </div>
        </div>

        <div className="preview-layout">
          <div className="classic-group preview-group">
            <div className="group-title">Calculator View</div>
            <div className="preview-monitor">
              {selectedRoom ? (
                <div className="preview-screen">
                  <div className="preview-camera">
                    <div
                      className="preview-room"
                      style={{
                        width: selectedRoom.width,
                        height: selectedRoom.height,
                        transform: `translate(${-selectedRoom.cameraX}px, ${-selectedRoom.cameraY}px)`,
                      }}
                    >
                      {orderedRoomLayers.map((layer, layerIndex) => {
                        if (layer.kind === "background") {
                          const entry = selectedRoom.backgroundLayers.find((candidate) => candidate.id === layer.id);
                          return entry ? <div key={layer.id} style={{ zIndex: layerIndex }}>{renderBackgroundLayer(entry, true)}</div> : null;
                        }
                        if (layer.kind === "tile") {
                          const entry = selectedRoom.tileLayers.find((candidate) => candidate.id === layer.id);
                          return entry ? <div key={layer.id} style={{ zIndex: layerIndex }}>{renderTileLayer(entry, true)}</div> : null;
                        }
                        return selectedRoom.placements
                          .filter((placement) => placement.layerId === layer.id)
                          .map((placement) => {
                            const sprite = objectSpriteLookup.get(placement.objectId);
                            const preview = sprite?.frames[0]?.previewUrl ?? "";
                            return (
                              <div
                                key={placement.id}
                                className="preview-instance"
                                style={{
                                  zIndex: layerIndex + 1,
                                  left: placement.x,
                                  top: placement.y,
                                  width: sprite?.width ?? 8,
                                  height: sprite?.height ?? 8,
                                }}
                              >
                                {preview ? <img src={preview} alt="" /> : null}
                              </div>
                            );
                          });
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderExportPanel() {
    const packStatus = exportSupport?.pack ?? {
      ready: true,
      missing: [],
      note: "Writes the current project pack only.",
    };
    const embeddedStatus = exportSupport?.embedded ?? {
      ready: true,
      missing: [],
      note: "Uploads the current pack to the servers so they can compile a device .nwa for you.",
    };
    const flashStatus = exportSupport?.flash ?? {
      ready: false,
      missing: ["npx"],
      note: "Downloads the latest device .nwa from our servers, then installs it with nwlink.",
    };
    const simulatorStatus = exportSupport?.simulator ?? {
      ready: true,
      missing: [],
      note: "Downloads the latest host runtime archive and matching simulator archive from our servers, then launches them together.",
    };

    function renderRequirementText(status: ExportTargetStatus) {
      if (status.missing.length === 0) {
        return "" //"No extra local tools required.";
      }
      if (status.missing.includes("npx")) {
        return "Requires npx from a local Node.js/npm install.";
      }
      return `Requires: ${status.missing.join(", ")}.`;
    }

    function renderActionCard(
      eyebrow: string,
      title: string,
      description: string,
      status: ExportTargetStatus,
      label: string,
      icon: IconName,
      accent: "pack" | "embedded" | "flash" | "simulator",
      onClick: () => void,
    ) {
      const readyLabel = status.ready ? "Ready" : "Needs setup";
      return (
        <div className={`classic-group export-card export-card-${accent} ${status.ready ? "is-ready" : "is-missing"}`}>
          <div className="export-card-head">
            <div className={`export-card-icon export-card-icon-${accent}`}>
              <AppIcon name={icon} />
            </div>
            <div className="export-card-heading">
              <p className="export-card-eyebrow">{eyebrow}</p>
              <div className="group-title">{title}</div>
            </div>
          </div>
          <p className="export-card-copy">{description}</p>
          <div className="export-meta">
            <div className={status.ready ? "export-status ready" : "export-status missing"}>{readyLabel}</div>
            <div className="export-requirement">{renderRequirementText(status)}</div>
          </div>
          <div className="preview-note export-note">{status.note}</div>
          {!status.ready && status.missing.includes("npx") ? (
            <div className="export-warning">
              Install Node.js so <code>npx</code> is available before flashing to a calculator.
            </div>
          ) : null}
          <ActionButton
            className="tool-button export-action-button"
            icon={icon}
            label={label}
            onClick={() => {
              setShowExportPanel(false);
              if (!status.ready) {
                showMissingExportToolsWarning(title, status);
                return;
              }
              onClick();
            }}
            disabled={busyAction !== ""}
          >
            {label}
          </ActionButton>
        </div>
      );
    }

    return (
      <div className="launcher-overlay">
        <div className="launcher-window export-window">
          <div className="launcher-head">
            <div>
              <p className="section-kicker">Export</p>
              <h2>Build And Deploy</h2>
            </div>
            <ActionButton className="mini-button" icon="close" label="Close Export Panel" onClick={() => setShowExportPanel(false)} />
          </div>
          <div className="export-grid launcher-group">
            {renderActionCard(
              "Pack File",
              "Export To Pack",
              "Write the compiled NWGE pack without touching the runtime toolchains.",
              packStatus,
              "Export To Pack",
              "package",
              "pack",
              () => {
                void exportPack();
              },
            )}
            {renderActionCard(
              "Remote Build",
              "Export With Embedded Pack",
              "Send the generated pack to the servers and download the compiled device .nwa file.",
              embeddedStatus,
              "Export Embedded",
              "package",
              "embedded",
              () => {
                void exportWithEmbeddedPack();
              },
            )}
            {renderActionCard(
              "Calculator Deploy",
              "Flash To Calculator",
              "Download the latest device .nwa from the servers and install it together with the current pack.",
              flashStatus,
              "Flash Calculator",
              "continue",
              "flash",
              () => {
                void flashCalculator();
              },
            )}
            {renderActionCard(
              "Desktop Preview",
              "Run Simulator",
              "Download the latest host runtime archive plus the matching simulator archive from the servers and launch them with the current pack.",
              simulatorStatus,
              "Run Simulator",
              "preview",
              "simulator",
              () => {
                void runSimulator();
              },
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderOutputPane() {
    return (
      <section className={outputPaneCollapsed ? "output-pane collapsed" : "output-pane"}>
        <div className="pane-header output-header">
          <div className="pane-caption">Output</div>
          <div className="pane-actions">
            {!outputPaneCollapsed ? (
              <ActionButton className="mini-button" icon="delete" label="Clear output" onClick={() => setOutputEntries([])}>
                Clear
              </ActionButton>
            ) : null}
            <ActionButton
              className="mini-button"
              icon={outputPaneCollapsed ? "expandClosed" : "expandOpen"}
              label={outputPaneCollapsed ? "Expand output" : "Minify output"}
              aria-expanded={!outputPaneCollapsed}
              onClick={() => setOutputPaneCollapsed((current) => !current)}
            />
          </div>
        </div>
        {!outputPaneCollapsed ? (
          <>
            <div className="output-console" ref={outputConsoleRef}>
              {outputEntries.length > 0 ? (
                outputEntries.map((entry) => (
                  <div key={entry.id} className={`output-line output-line-${entry.stream}`}>
                    {renderOutputMessage(entry.message)}
                  </div>
                ))
              ) : (
                <div className="output-empty">Build, flash, and simulator output will appear here.</div>
              )}
            </div>
            {activePreviewRunId ? (
              <form
                className="output-command-bar"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAction("preview-console", runPreviewConsoleCommand);
                }}
              >
                <input
                  className="output-command-input"
                  value={previewConsoleCommand}
                  onChange={(event) => setPreviewConsoleCommand(event.target.value)}
                  placeholder="Run Lua in the simulator console, for example: room.name()"
                  spellCheck={false}
                  disabled={busyAction !== ""}
                />
                <ActionButton
                  className="mini-button"
                  icon="continue"
                  type="submit"
                  label="Run Lua command"
                  disabled={busyAction !== "" || previewConsoleCommand.trim() === ""}
                >
                  Run Lua
                </ActionButton>
              </form>
            ) : null}
          </>
        ) : null}
      </section>
    );
  }

  function renderPropertiesPanel() {
    if (workspaceView === "room" && selectedPlacement && selectedRoom) {
      return (
        <>
          <div className="property-header">
            <span className="property-title">Instance Properties</span>
          </div>
          <div className="property-body">
            <label className="property-row">
              <span>Object</span>
              <select value={selectedPlacement.objectId} onChange={(event) => updatePlacement(selectedPlacement.id, (placement) => ({ ...placement, objectId: event.target.value }))}>
                {project.objects.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="property-row">
              <span>X</span>
              <input
                type="number"
                value={selectedPlacement.x}
                onChange={(event) =>
                  updatePlacement(selectedPlacement.id, (placement) => ({
                    ...placement,
                    x: clamp(Number(event.target.value) || 0, 0, selectedRoom.width),
                  }))
                }
              />
            </label>
            <label className="property-row">
              <span>Y</span>
              <input
                type="number"
                value={selectedPlacement.y}
                onChange={(event) =>
                  updatePlacement(selectedPlacement.id, (placement) => ({
                    ...placement,
                    y: clamp(Number(event.target.value) || 0, 0, selectedRoom.height),
                  }))
                }
              />
            </label>
            <label className="property-row">
              <span>Layer</span>
              <select value={selectedPlacement.layerId} onChange={(event) => updatePlacement(selectedPlacement.id, (placement) => ({ ...placement, layerId: event.target.value }))}>
                {selectedRoom.instanceLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="property-note">
              Instance variables are not available yet. This panel is reserved for per-instance overrides.
            </div>
            <div className="property-actions">
              <ActionButton className="mini-button" icon="open" label="Open Object" onClick={() => selectObjectView(selectedPlacement.objectId)}>
                Open Object
              </ActionButton>
              <ActionButton className="mini-button danger" icon="delete" label="Delete Instance" onClick={() => removePlacement(selectedPlacement.id)}>
                Delete Instance
              </ActionButton>
            </div>
          </div>
        </>
      );
    }

    if (workspaceView === "room" && selectedRoom) {
      return (
        <>
          <div className="property-header">
            <span className="property-title">Room Properties</span>
          </div>
          <div className="property-body">
            <label className="property-row">
              <span>Name</span>
              <input value={selectedRoom.name} onChange={(event) => renameResource("room", selectedRoom.id, event.target.value)} />
            </label>
            <label className="property-row">
              <span>Width</span>
              <input
                type="number"
                value={selectedRoom.width}
                onChange={(event) =>
                  updateRoomBounds(clamp(Number(event.target.value) || ROOM_VIEW_WIDTH, 1, 4096), selectedRoom.height)
                }
              />
            </label>
            <label className="property-row">
              <span>Height</span>
              <input
                type="number"
                value={selectedRoom.height}
                onChange={(event) =>
                  updateRoomBounds(selectedRoom.width, clamp(Number(event.target.value) || ROOM_VIEW_HEIGHT, 1, 4096))
                }
              />
            </label>
            <label className="property-row">
              <span>Background</span>
              <input
                type="color"
                value={selectedRoom.backgroundLayers[0]?.color ?? "#d8d8d8"}
                onChange={(event) =>
                  updateRoom(selectedRoom.id, (room) => ({
                    ...room,
                    backgroundLayers: room.backgroundLayers.map((layer, index) =>
                      index === 0 ? { ...layer, color: event.target.value } : layer,
                    ),
                  }))
                }
              />
            </label>
            {selectedRoomLayerKind === "background" && selectedBackgroundLayer ? (
              <>
                <label className="property-row">
                  <span>Bg Name</span>
                  <input value={selectedBackgroundLayer.name} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, name: event.target.value }))} />
                </label>
                <label className="property-row">
                  <span>Bg Depth</span>
                  <input type="number" value={selectedBackgroundLayer.depth} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, depth: Number(event.target.value) || 0 }))} />
                </label>
                <label className="property-row">
                  <span>Bg Sprite</span>
                  <select value={selectedBackgroundLayer.spriteId} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, spriteId: event.target.value }))}>
                    <option value="">None</option>
                    {project.sprites.map((sprite) => (
                      <option key={sprite.id} value={sprite.id}>
                        {sprite.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="property-row">
                  <span>Bg Color</span>
                  <input type="color" value={selectedBackgroundLayer.color} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, color: event.target.value }))} />
                </label>
                <label className="property-row checkbox-row">
                  <span>Repeat</span>
                  <input type="checkbox" checked={selectedBackgroundLayer.repeat} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, repeat: event.target.checked }))} />
                </label>
                <label className="property-row">
                  <span>Parallax X</span>
                  <input type="number" step="0.1" value={selectedBackgroundLayer.parallaxX} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, parallaxX: clampParallaxFactor(Number(event.target.value) || 0) }))} />
                </label>
                <label className="property-row">
                  <span>Parallax Y</span>
                  <input type="number" step="0.1" value={selectedBackgroundLayer.parallaxY} onChange={(event) => updateSelectedBackgroundLayer((layer) => ({ ...layer, parallaxY: clampParallaxFactor(Number(event.target.value) || 0) }))} />
                </label>
              </>
            ) : null}
            {selectedRoomLayerKind === "tile" && selectedTileLayer ? (
              <>
                <label className="property-row">
                  <span>Tile Name</span>
                  <input value={selectedTileLayer.name} onChange={(event) => updateSelectedTileLayer((layer) => ({ ...layer, name: event.target.value }))} />
                </label>
                <label className="property-row">
                  <span>Tile Depth</span>
                  <input type="number" value={selectedTileLayer.depth} onChange={(event) => updateSelectedTileLayer((layer) => ({ ...layer, depth: Number(event.target.value) || 0 }))} />
                </label>
                <label className="property-row">
                  <span>Tileset</span>
                  <select value={selectedTileLayer.tilesetSpriteId} onChange={(event) => updateSelectedTileLayer((layer) => ({ ...layer, tilesetSpriteId: event.target.value }))}>
                    <option value="">None</option>
                    {project.sprites.map((sprite) => (
                      <option key={sprite.id} value={sprite.id}>
                        {sprite.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="property-row">
                  <span>Edit Mode</span>
                  <select value={tileEditMode} onChange={(event) => setTileEditMode(event.target.value as TileEditMode)}>
                    <option value="art">Tile Art</option>
                    <option value="collision">Collision Mask</option>
                  </select>
                </label>
                <label className="property-row checkbox-row">
                  <span>Show Solids</span>
                  <input
                    type="checkbox"
                    checked={showTileCollisionOverlay}
                    onChange={(event) => setShowTileCollisionOverlay(event.target.checked)}
                  />
                </label>
                <div className="property-actions">
                  <ActionButton
                    className="mini-button"
                    icon="paint"
                    label="Derive collision from non-empty tiles"
                    onClick={() =>
                      updateSelectedTileLayer((layer) => ({
                        ...layer,
                        collisions: layer.tiles.map((tile) => tile >= 0),
                      }))
                    }
                  >
                    Fill From Tiles
                  </ActionButton>
                  <ActionButton
                    className="mini-button danger"
                    icon="delete"
                    label="Clear collision mask"
                    onClick={() =>
                      updateSelectedTileLayer((layer) => ({
                        ...layer,
                        collisions: new Array(layer.columns * layer.rows).fill(false),
                      }))
                    }
                  >
                    Clear Solids
                  </ActionButton>
                </div>
                <div className="property-note">
                  {tileEditMode === "collision"
                    ? "Use `Place` and `Erase` directly on the room stage to paint solid cells for collision.tile_meeting(...)."
                    : "Use `Place` and `Erase` directly on the room stage to paint visible tile art."}
                </div>
              </>
            ) : null}
            {selectedRoomLayerKind === "instance" && selectedInstanceLayer ? (
              <>
                <label className="property-row">
                  <span>Layer Name</span>
                  <input value={selectedInstanceLayer.name} onChange={(event) => updateSelectedInstanceLayer((layer) => ({ ...layer, name: event.target.value }))} />
                </label>
                <label className="property-row">
                  <span>Layer Depth</span>
                  <input type="number" value={selectedInstanceLayer.depth} onChange={(event) => updateSelectedInstanceLayer((layer) => ({ ...layer, depth: Number(event.target.value) || 0 }))} />
                </label>
              </>
            ) : null}
            <label className="property-row">
              <span>Grid Size</span>
              <input
                type="number"
                value={roomGridSize}
                onChange={(event) => setRoomGridSize(clamp(Number(event.target.value) || 16, 4, 64))}
              />
            </label>
            <label className="property-row">
              <span>Camera X</span>
              <input type="number" value={selectedRoom.cameraX} onChange={(event) => setCameraPosition(Number(event.target.value) || 0, selectedRoom.cameraY)} />
            </label>
            <label className="property-row">
              <span>Camera Y</span>
              <input type="number" value={selectedRoom.cameraY} onChange={(event) => setCameraPosition(selectedRoom.cameraX, Number(event.target.value) || 0)} />
            </label>
            <label className="property-row">
              <span>Follow Object</span>
              <select
                value={selectedRoom.cameraFollowObjectId}
                onChange={(event) => updateRoom(selectedRoom.id, (room) => ({ ...room, cameraFollowObjectId: event.target.value }))}
              >
                <option value="">None</option>
                {project.objects.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="property-stack">
              {LIFECYCLE_EVENTS.map((eventMeta) =>
                renderScriptRack(
                  `Room ${eventMeta.label}`,
                  selectedRoom[roomEventFieldMap[eventMeta.key]],
                  (scriptId) => addRoomEventScript(selectedRoom.id, roomEventFieldMap[eventMeta.key], scriptId),
                  (scriptId) => removeRoomEventScript(selectedRoom.id, roomEventFieldMap[eventMeta.key], scriptId),
                ),
              )}
            </div>
          </div>
        </>
      );
    }

    if (workspaceView === "object" && selectedObject) {
      return (
        <>
          <div className="property-header">
            <span className="property-title">Object Properties</span>
          </div>
          <div className="property-body">
            <div className="property-preview">
              {selectedObjectSprite?.frames[0] ? <img src={selectedObjectSprite.frames[0].previewUrl} alt={selectedObject.name} /> : <span>NO SPRITE</span>}
            </div>
            <label className="property-row">
              <span>Name</span>
              <input value={selectedObject.name} onChange={(event) => renameResource("object", selectedObject.id, event.target.value)} />
            </label>
            <label className="property-row">
              <span>Sprite</span>
              <select value={selectedObject.spriteId} onChange={(event) => updateObject(selectedObject.id, (entry) => ({ ...entry, spriteId: event.target.value }))}>
                <option value="">None</option>
                {project.sprites.map((sprite) => (
                  <option key={sprite.id} value={sprite.id}>
                    {sprite.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="property-row">
              <span>Collision With</span>
              <select value={selectedObject.collisionObjectId} onChange={(event) => updateObject(selectedObject.id, (entry) => ({ ...entry, collisionObjectId: event.target.value }))}>
                <option value="">Any object</option>
                {project.objects
                  .filter((entry) => entry.id !== selectedObject.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="property-note">
              Depth and visibility are typically controlled through room layering and Draw logic in the runtime.
            </div>
          </div>
        </>
      );
    }

    if (workspaceView === "script" && selectedScript) {
      return (
        <>
          <div className="property-header">
            <span className="property-title">Script Properties</span>
          </div>
          <div className="property-body">
            <label className="property-row">
              <span>Name</span>
              <input value={selectedScript.name} onChange={(event) => renameResource("script", selectedScript.id, event.target.value)} />
            </label>
            <div className="property-stat">
              <span>Lines</span>
              <strong>{selectedScript.code.split("\n").length}</strong>
            </div>
            <div className="property-stat">
              <span>Language Server</span>
              <strong>{selectedScriptUri ? "Attached" : "Preparing"}</strong>
            </div>
          </div>
        </>
      );
    }

    if (workspaceView === "sprite" && selectedSprite) {
      return (
        <>
          <div className="property-header">
            <span className="property-title">Sprite Properties</span>
          </div>
          <div className="property-body">
            <div className="property-preview">
              {selectedFrame ? <img src={selectedFrame.previewUrl} alt={selectedSprite.name} /> : <span>NO FRAME</span>}
            </div>
            <div className="property-stat">
              <span>Frames</span>
              <strong>{selectedSprite.frames.length}</strong>
            </div>
            <div className="property-stat">
              <span>Size</span>
              <strong>{selectedSprite.width} x {selectedSprite.height}</strong>
            </div>
            <div className="property-stat">
              <span>Origin</span>
              <strong>{selectedSprite.originX}, {selectedSprite.originY}</strong>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="property-header">
          <span className="property-title">Project Overview</span>
        </div>
        <div className="property-body">
          <div className="property-stat">
            <span>Rooms</span>
            <strong>{project.rooms.length}</strong>
          </div>
          <div className="property-stat">
            <span>Objects</span>
            <strong>{project.objects.length}</strong>
          </div>
          <div className="property-stat">
            <span>Sprites</span>
            <strong>{project.sprites.length}</strong>
          </div>
          <div className="property-stat">
            <span>Scripts</span>
            <strong>{project.scripts.length}</strong>
          </div>
        </div>
      </>
    );
  }

  function renderWorkspace() {
    switch (workspaceView) {
      case "project":
        return renderProjectWorkspace();
      case "sprite":
        return renderSpriteWorkspace();
      case "script":
        return renderScriptWorkspace();
      case "object":
        return renderObjectWorkspace();
      case "preview":
        return renderPreviewWorkspace();
      case "room":
      default:
        return renderRoomWorkspace();
    }
  }

  return (
    <main className="studio-root">
      <input
        ref={importSpriteInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void runAction("import-sprite", async () => {
            await handleSpriteImport(event);
          });
        }}
      />
      <input
        ref={importFrameInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void runAction("import-frame", async () => {
            await handleFrameImport(event);
          });
        }}
      />

      <div className="studio-window">
        <header className="window-top">
          <div className="title-bar">
            <div className="title-block">
              <span className="app-badge">
                <AppIcon name="app" size={14} />
              </span>
              <div>
                <strong>NumWorks Game Engine Studio</strong>
                <span>{project.name}{hasUnsavedChanges ? " *" : ""}</span>
              </div>
            </div>
            <div className={`status-chip tone-${toast.tone}`}>{busyAction ? `${busyAction}...` : toast.message}</div>
          </div>

          <div className="toolbar-row">
            <ActionButton className="tool-button" icon="object" label="New Object" onClick={addObject}>
              New Object
            </ActionButton>
            <ActionButton className="tool-button" icon="sprite" label="New Sprite" onClick={addSprite}>
              New Sprite
            </ActionButton>
            <ActionButton className="tool-button" icon="import" label="Import Sprite" onClick={() => importSpriteInputRef.current?.click()}>
              Import Sprite
            </ActionButton>
            <ActionButton className="tool-button" icon="script" label="New Script" onClick={addScript}>
              New Script
            </ActionButton>
            <ActionButton className="tool-button" icon="room" label="New Room" onClick={addRoom}>
              New Room
            </ActionButton>
            <div className="toolbar-separator" />
            <ActionButton className="tool-button" icon="save" label="Save Project" onClick={saveProject} disabled={busyAction !== ""}>
              Save
            </ActionButton>
            <ActionButton className="tool-button" icon="open" label="Open Project" onClick={loadProject} disabled={busyAction !== ""}>
              Open
            </ActionButton>
            <ActionButton className="tool-button" icon="package" label="Open Export Panel" onClick={openExportPanel} disabled={busyAction !== ""}>
              Export
            </ActionButton>
            <ActionButton className="tool-button" icon="preview" label="Run Simulator" onClick={runSimulator} disabled={busyAction !== ""}>
              Run Simulator
            </ActionButton>
            <div className="toolbar-separator" />
            <ActionButton className="tool-button" icon="project" label="Project Box" onClick={openProjectBox}>
              Project Box
            </ActionButton>
          </div>
        </header>

        <div className="studio-grid" ref={studioGridRef} style={studioGridStyle}>
          <aside className={resourcePaneCollapsed ? "resource-pane collapsed" : "resource-pane"}>
            <div className="pane-header">
              <div className="pane-caption">Resources</div>
              <div className="pane-actions">
                <ActionButton
                  className="mini-button"
                  icon={resourcePaneCollapsed ? "expandClosed" : "expandOpen"}
                  label={resourcePaneCollapsed ? "Expand resources" : "Minify resources"}
                  aria-expanded={!resourcePaneCollapsed}
                  onClick={() => setResourcePaneCollapsed((current) => !current)}
                />
              </div>
            </div>

            {!resourcePaneCollapsed ? (
              <>
                <div className="resource-search">
                  <input
                    type="search"
                    value={resourceSearch}
                    onChange={(event) => setResourceSearch(event.target.value)}
                    placeholder="Search resources"
                    aria-label="Search resources"
                  />
                </div>

                <div className="tree-section">
                  <div className="tree-head">
                    <button className="tree-toggle" onClick={() => toggleTreeSection("settings")}>
                      <AppIcon name={treeSections.settings ? "expandOpen" : "expandClosed"} className="tree-toggle-icon" />
                      <span>Settings</span>
                    </button>
                  </div>
                  {treeSections.settings ? (
                    <div className="tree-list">
                      {matchesResourceSearch("Project") ? (
                        <button className={workspaceView === "project" ? "tree-item active" : "tree-item"} onClick={selectProjectView}>
                          <AppIcon name="project" className="tree-icon" />
                          <span>Project</span>
                        </button>
                      ) : null}
                      {matchesResourceSearch("Preview") ? (
                        <button className={workspaceView === "preview" ? "tree-item active" : "tree-item"} onClick={() => setWorkspaceView("preview")}>
                          <AppIcon name="preview" className="tree-icon" />
                          <span>Preview</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="tree-section">
                  <div className="tree-head">
                    <button className="tree-toggle" onClick={() => toggleTreeSection("rooms")}>
                      <AppIcon name={treeSections.rooms ? "expandOpen" : "expandClosed"} className="tree-toggle-icon" />
                      <span>Rooms</span>
                    </button>
                    <ActionButton className="mini-button" icon="add" label="Add Room" onClick={addRoom} />
                  </div>
                  {treeSections.rooms ? (
                    <div className="tree-list">
                      {filteredRooms.map((room) =>
                        renderResourceTreeRow({
                          id: room.id,
                          label: room.name,
                          icon: "room",
                          active: workspaceView === "room" && selectedRoomId === room.id,
                          onSelect: () => selectRoomView(room.id),
                          onDuplicate: () => duplicateRoom(room.id),
                          onRename: () => promptRenameResource("room", room.id, room.name),
                          onDelete: () => deleteRoom(room.id),
                        }),
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="tree-section">
                  <div className="tree-head">
                    <button className="tree-toggle" onClick={() => toggleTreeSection("objects")}>
                      <AppIcon name={treeSections.objects ? "expandOpen" : "expandClosed"} className="tree-toggle-icon" />
                      <span>Objects</span>
                    </button>
                    <ActionButton className="mini-button" icon="add" label="Add Object" onClick={addObject} />
                  </div>
                  {treeSections.objects ? (
                    <div className="tree-list">
                      {filteredObjects.map((entry) =>
                        renderResourceTreeRow({
                          id: entry.id,
                          label: entry.name,
                          icon: "object",
                          active: workspaceView === "object" && selectedObjectId === entry.id,
                          onSelect: () => selectObjectView(entry.id),
                          onDuplicate: () => duplicateObject(entry.id),
                          onRename: () => promptRenameResource("object", entry.id, entry.name),
                          onDelete: () => deleteObject(entry.id),
                          draggable: true,
                          dragData: entry.id,
                        }),
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="tree-section">
                  <div className="tree-head">
                    <button className="tree-toggle" onClick={() => toggleTreeSection("sprites")}>
                      <AppIcon name={treeSections.sprites ? "expandOpen" : "expandClosed"} className="tree-toggle-icon" />
                      <span>Sprites</span>
                    </button>
                    <ActionButton className="mini-button" icon="add" label="Add Sprite" onClick={addSprite} />
                  </div>
                  {treeSections.sprites ? (
                    <div className="tree-list">
                      {filteredSprites.map((sprite) =>
                        renderResourceTreeRow({
                          id: sprite.id,
                          label: sprite.name,
                          icon: "sprite",
                          active: workspaceView === "sprite" && selectedSpriteId === sprite.id,
                          onSelect: () => selectSpriteView(sprite.id),
                          onDuplicate: () => duplicateSprite(sprite.id),
                          onRename: () => promptRenameResource("sprite", sprite.id, sprite.name),
                          onDelete: () => deleteSprite(sprite.id),
                        }),
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="tree-section">
                  <div className="tree-head">
                    <button className="tree-toggle" onClick={() => toggleTreeSection("scripts")}>
                      <AppIcon name={treeSections.scripts ? "expandOpen" : "expandClosed"} className="tree-toggle-icon" />
                      <span>Scripts</span>
                    </button>
                    <ActionButton className="mini-button" icon="add" label="Add Script" onClick={addScript} />
                  </div>
                  {treeSections.scripts ? (
                    <div className="tree-list">
                      {filteredScripts.map((script) =>
                        renderResourceTreeRow({
                          id: script.id,
                          label: script.name,
                          icon: "script",
                          active: workspaceView === "script" && selectedScriptId === script.id,
                          onSelect: () => selectScriptView(script.id),
                          onDuplicate: () => duplicateScript(script.id),
                          onRename: () => promptRenameResource("script", script.id, script.name),
                          onDelete: () => deleteScript(script.id),
                        }),
                      )}
                    </div>
                  ) : null}
                </div>

                {!hasResourceMatches ? <div className="resource-search-empty">No matching resources.</div> : null}
              </>
            ) : null}
          </aside>

          <div
            className={resourcePaneCollapsed ? "pane-resizer pane-resizer-vertical resource-resizer disabled" : "pane-resizer pane-resizer-vertical resource-resizer"}
            aria-hidden="true"
            onPointerDown={(event) => beginPaneResize("resources", event)}
          />

          <section className="workspace-area">{renderWorkspace()}</section>

          <div
            className="pane-resizer pane-resizer-vertical properties-resizer"
            aria-hidden="true"
            onPointerDown={(event) => beginPaneResize("properties", event)}
          />

          <aside className="properties-pane">
            <div className="pane-header">
              <div className="pane-caption">Properties</div>
            </div>
            {renderPropertiesPanel()}
          </aside>

          <div
            className={outputPaneCollapsed ? "pane-resizer pane-resizer-horizontal output-resizer disabled" : "pane-resizer pane-resizer-horizontal output-resizer"}
            aria-hidden="true"
            onPointerDown={(event) => beginPaneResize("output", event)}
          />

          {renderOutputPane()}
        </div>

        {showLauncher ? (
          <div className="launcher-overlay">
            <div className="launcher-window">
              <div className="launcher-head">
                <div>
                  <p className="section-kicker">Project Box</p>
                  <h2>Open Workspace</h2>
                </div>
                <ActionButton className="mini-button" icon="close" label="Close Project Box" onClick={() => setShowLauncher(false)} />
              </div>

              <div className="launcher-actions">
                <ActionButton className="tool-button" icon="add" label="New Project" onClick={startNewProject}>
                  New Project
                </ActionButton>
                <ActionButton className="tool-button" icon="open" label="Open Project" onClick={() => void loadProject()}>
                  Open Project
                </ActionButton>
                <ActionButton className="tool-button" icon="continue" label="Continue Current Project" onClick={() => setShowLauncher(false)}>
                  Continue
                </ActionButton>
              </div>

              <div className="classic-group launcher-group">
                <div className="group-title">Recent Projects</div>
                {recentProjects.length > 0 ? (
                  <div className="recent-list">
                    {recentProjects.map((entry) => (
                      <button
                        key={entry.path}
                        className="recent-item"
                        onClick={() =>
                          void runAction("load", async () => {
                            await loadProjectFromPath(entry.path);
                          })
                        }
                      >
                        <strong>{entry.name}</strong>
                        <span>{entry.path}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rack-empty">No recent projects yet.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {showExportPanel ? renderExportPanel() : null}
      </div>
    </main>
  );
}

export default App;
