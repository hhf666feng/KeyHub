// Static native-window contract only: no app launch, vault access, or dependencies.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const source = await readFile(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const main = config.app.windows.find(window => window.label === "main");
assert.ok(main, "main window must exist");

function rustFunction(name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf("{", start);
  let depth = 1;
  for (let index = open + 1; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

function rustConstant(name) {
  const match = source.match(new RegExp(`const ${name}: f64 = ([\\d.]+);`));
  assert.ok(match, `${name} must be a logical-pixel constant`);
  return Number(match[1]);
}

test("main window defaults to a 1200x800 logical workspace", () => {
  assert.equal(main.width, 1200);
  assert.equal(main.height, 800);
  assert.equal(main.center, true);
  assert.equal(main.decorations, false);
});

test("main window has a 760x600 minimum without an upper cap", () => {
  assert.equal(main.minWidth, 760);
  assert.equal(main.minHeight, 600);
  assert.equal(main.maxWidth ?? null, null);
  assert.equal(main.maxHeight ?? null, null);
});

test("main window is resizable and maximizable", () => {
  assert.equal(main.resizable, true);
  assert.equal(main.maximizable, true);
});

test("runtime geometry agrees with the configured logical sizes", () => {
  assert.equal(rustConstant("WINDOW_LOGICAL_WIDTH"), main.width);
  assert.equal(rustConstant("WINDOW_LOGICAL_HEIGHT"), main.height);
  assert.equal(rustConstant("WINDOW_MIN_LOGICAL_WIDTH"), main.minWidth);
  assert.equal(rustConstant("WINDOW_MIN_LOGICAL_HEIGHT"), main.minHeight);
});

test("startup fits only down to the monitor work area with safe monitor fallback", () => {
  const geometry = rustFunction("configure_workspace_window");
  assert.match(rustFunction("run_gui"), /configure_workspace_window\(&window\)\?/);
  assert.match(geometry, /current_monitor\(\)\s*\.ok\(\)\s*\.flatten\(\)/);
  assert.match(geometry, /or_else\(\|\|\s*window\.primary_monitor\(\)\.ok\(\)\.flatten\(\)\)/);
  assert.match(geometry, /scale_factor\.is_finite\(\)\s*&&\s*scale_factor > 0\.0/);
  assert.match(geometry, /work_area\.size\.width > 0\s*&&\s*work_area\.size\.height > 0/);
  assert.match(geometry, /work_area\.size\.to_logical::<f64>\(monitor\.scale_factor\(\)\)/);
  assert.match(geometry, /size\.width = size\.width\.min\(available\.width\)/);
  assert.match(geometry, /size\.height = size\.height\.min\(available\.height\)/);
  assert.doesNotMatch(geometry, /\.max\(/, "small monitors must not be forced above their work area");
});

test("runtime relaxes minimums on undersized monitors and permits unbounded resizing", () => {
  const geometry = rustFunction("configure_workspace_window");
  assert.match(geometry, /set_min_size\(Some\(LogicalSize::new\(\s*WINDOW_MIN_LOGICAL_WIDTH\.min\(size\.width\),\s*WINDOW_MIN_LOGICAL_HEIGHT\.min\(size\.height\)/);
  assert.ok(geometry.indexOf("set_min_size") < geometry.indexOf("set_size("), "relax minimums before resizing");
  assert.match(geometry, /set_max_size\(None::<LogicalSize<f64>>\)/);
  assert.match(geometry, /set_size\(size\)/);
  assert.match(geometry, /set_resizable\(true\)/);
  assert.match(geometry, /set_maximizable\(true\)/);
  assert.doesNotMatch(source, /set_max_size\(Some\(|set_resizable\(false\)|set_maximizable\(false\)/);
});

test("initial position uses the work area origin, including offset monitors", () => {
  const geometry = rustFunction("configure_workspace_window");
  assert.match(geometry, /size\.to_physical::<u32>\(monitor\.scale_factor\(\)\)/);
  assert.match(geometry, /set_position\(tauri::PhysicalPosition::new\(/);
  assert.match(geometry, /work_area\.position\.x\s*\+\s*\(work_area\.size\.width\.saturating_sub\(physical\.width\) \/ 2\) as i32/);
  assert.match(geometry, /work_area\.position\.y\s*\+\s*\(work_area\.size\.height\.saturating_sub\(physical\.height\) \/ 2\) as i32/);
});

test("DPI changes and reopening never reset the user-selected size", () => {
  assert.doesNotMatch(source, /ScaleFactorChanged/);
  assert.doesNotMatch(source, /\b(?:460|690)(?:\.0)?\b/);
  const lifecycle = source.replace(rustFunction("toggle_quick_panel"), '').replace(rustFunction("toggle_workspace_zoom"), '');
  assert.equal((lifecycle.match(/\.set_size\(/g) ?? []).length, 1, "resize the workspace only during initial setup or explicit zoom; panel has independent geometry");
  assert.doesNotMatch(rustFunction("show_main_window"), /set_(?:size|min_size|max_size)/);
});

test("custom maximize action uses current-screen zoom, preserving existing actions", () => {
  const action = rustFunction("window_action");
  assert.match(action, /"maximize"\s*=>\s*\{?\s*toggle_workspace_zoom\(&window\)\.await/);
  const zoom = rustFunction("toggle_workspace_zoom");
  assert.match(zoom, /current_monitor\(\)/);
  assert.match(zoom, /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]*window\.is_maximized\(\)/);
  assert.match(action, /"minimize"\s*=>\s*window\.minimize\(\)\.map_err\(command_error\)/);
  assert.match(action, /"close"\s*=>\s*\{/);
  assert.match(action, /should_hide_on_close\(&close_behavior, tray_available\)/);
  assert.match(action, /_\s*=>\s*Err\("Unknown window operation"\.to_owned\(\)\)/);
});
