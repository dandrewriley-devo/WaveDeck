const { execFile } = require("child_process");

function callCinnamon(code, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile("gdbus", [
      "call",
      "--session",
      "--dest", "org.Cinnamon",
      "--object-path", "/org/Cinnamon",
      "--method", "org.Cinnamon.Eval",
      code
    ], { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim();
        reject(new Error(detail || "Cinnamon desktop integration is unavailable."));
        return;
      }
      if (!String(stdout).trim().startsWith("(true,")) {
        const detail = String(stdout).trim().slice(0, 500);
        reject(new Error(`Cinnamon rejected the request: ${detail || "unknown error"}`));
        return;
      }
      resolve(true);
    });
  });
}

function windowLookupCode(ownerPid, expectedTitle = "WaveDeck Sidebar") {
  const pid = Math.round(ownerPid);
  const titleLiteral = JSON.stringify(String(expectedTitle));
  return `
    var actors = global.get_window_actors();
    var bestWindow = null;
    var bestScore = -1;
    for (var i = 0; i < actors.length; i++) {
      var candidate = actors[i].meta_window;
      if (!candidate && actors[i].get_meta_window) candidate = actors[i].get_meta_window();
      if (!candidate) continue;

      var candidatePid = candidate.get_pid ? candidate.get_pid() : -1;
      var title = candidate.get_title ? candidate.get_title() : "";
      var wmClass = candidate.get_wm_class ? candidate.get_wm_class() : "";
      var score = 0;
      if (candidatePid === ${pid}) score += 100;
      if (title === ${titleLiteral}) score += 1000;
      else if (title && title.indexOf("WaveDeck") >= 0) score += 10;
      if (wmClass && wmClass.toLowerCase().indexOf("wavedeck") >= 0) score += 20;

      if (score > bestScore) {
        bestWindow = candidate;
        bestScore = score;
      }
    }
  `;
}

function cleanupCode(ownerPid = process.pid, restoreWindow = false, expectedTitle = "WaveDeck Sidebar") {
  const lookup = windowLookupCode(ownerPid, expectedTitle);
  return `(function () {
    var Main = imports.ui.main;
    var Mainloop = imports.mainloop;
    var Meta = imports.gi.Meta;
    if (global._waveDeckSBGeometryRetryId) {
      Mainloop.source_remove(global._waveDeckSBGeometryRetryId);
      global._waveDeckSBGeometryRetryId = 0;
    }
    if (global._waveDeckSBPostStrutVerifyId) {
      Mainloop.source_remove(global._waveDeckSBPostStrutVerifyId);
      global._waveDeckSBPostStrutVerifyId = 0;
    }
    if (global._waveDeckSBStrutWatchId) {
      Mainloop.source_remove(global._waveDeckSBStrutWatchId);
      global._waveDeckSBStrutWatchId = 0;
    }
    if (global._waveDeckSBStrut) {
      Main.layoutManager.removeChrome(global._waveDeckSBStrut);
      global._waveDeckSBStrut.destroy();
      global._waveDeckSBStrut = null;
    }
    if (Main.layoutManager._chrome && Main.layoutManager._chrome.updateRegions) {
      Main.layoutManager._chrome.updateRegions();
    } else {
      Main.layoutManager.updateChrome();
    }

    ${lookup}
    var restored = false;
    if (${restoreWindow ? "true" : "false"} && bestWindow && global._waveDeckSBFloatingRect) {
      var saved = global._waveDeckSBFloatingRect;
      if (bestWindow.unmaximize) bestWindow.unmaximize(Meta.MaximizeFlags.BOTH);
      bestWindow.move_resize_frame(false, saved.x, saved.y, saved.width, saved.height);
      restored = true;
    }
    global._waveDeckSBFloatingRect = null;
    global._waveDeckSBDockRect = null;
    global._waveDeckSBWindow = null;
    global._waveDeckSBSettleCount = 0;
    global._waveDeckSBSettleAttempts = 0;
    global._waveDeckSBPostStrutVerifyId = 0;
    global._waveDeckSBCreateStrut = null;
    global._waveDeckSBApplyDockGeometry = null;
    return restored ? "removed-and-restored" : "removed";
  })()`;
}

function reservationCode(ownerPid, expectedTitle = "WaveDeck Sidebar") {
  const pid = Math.round(ownerPid);
  const lookup = windowLookupCode(pid, expectedTitle);

  return `(function () {
    var Main = imports.ui.main;
    var Mainloop = imports.mainloop;
    var GLib = imports.gi.GLib;
    var Meta = imports.gi.Meta;
    var St = imports.gi.St;
    if (global._waveDeckSBGeometryRetryId) {
      Mainloop.source_remove(global._waveDeckSBGeometryRetryId);
      global._waveDeckSBGeometryRetryId = 0;
    }
    if (global._waveDeckSBPostStrutVerifyId) {
      Mainloop.source_remove(global._waveDeckSBPostStrutVerifyId);
      global._waveDeckSBPostStrutVerifyId = 0;
    }
    if (global._waveDeckSBStrutWatchId) {
      Mainloop.source_remove(global._waveDeckSBStrutWatchId);
      global._waveDeckSBStrutWatchId = 0;
    }
    if (global._waveDeckSBStrut) {
      Main.layoutManager.removeChrome(global._waveDeckSBStrut);
      global._waveDeckSBStrut.destroy();
      global._waveDeckSBStrut = null;
    }
    // Flush any stale WaveDeck strut before reading the monitor work area;
    // otherwise a previous interrupted run could leave a one-sidebar gap.
    if (Main.layoutManager._chrome && Main.layoutManager._chrome.updateRegions) {
      Main.layoutManager._chrome.updateRegions();
    } else {
      Main.layoutManager.updateChrome();
    }

    ${lookup}
    if (!bestWindow || bestScore < 1000) {
      throw new Error("WaveDeck sidebar window not found");
    }
    if (!bestWindow.get_window_type || bestWindow.get_window_type() !== Meta.WindowType.DOCK) {
      throw new Error("WaveDeck sidebar window is not a Linux dock");
    }

    var floatingRect = bestWindow.get_frame_rect();
    if (!floatingRect || floatingRect.width <= 0 || floatingRect.height <= 0) {
      throw new Error("WaveDeck window geometry is unavailable");
    }

    var monitorIndex = bestWindow.get_monitor();
    var workspace = global.workspace_manager.get_active_workspace();
    var workArea = workspace.get_work_area_for_monitor(monitorIndex);
    if (!workArea || workArea.width <= 0 || workArea.height <= 0) {
      throw new Error("Cinnamon could not read the monitor work area");
    }

    // Electron's 300-unit window width is not necessarily 300 Cinnamon stage
    // units on a scaled monitor. Use the real Meta.Window frame width so the
    // player and its reserved strip occupy the exact same rectangle.
    var dockWidth = Math.min(floatingRect.width, workArea.width);
    var dockX = workArea.x + workArea.width - dockWidth;
    var dockY = workArea.y;
    var dockHeight = workArea.height;

    global._waveDeckSBFloatingRect = {
      x: floatingRect.x,
      y: floatingRect.y,
      width: floatingRect.width,
      height: floatingRect.height
    };
    global._waveDeckSBDockRect = {
      x: dockX,
      y: dockY,
      width: dockWidth,
      height: dockHeight
    };
    global._waveDeckSBWindow = bestWindow;
    global._waveDeckSBApplyDockGeometry = function () {
      var target = global._waveDeckSBWindow;
      var desired = global._waveDeckSBDockRect;
      if (!target || !desired) return false;
      var current = target.get_frame_rect();
      if (!current ||
          Math.abs(current.x - desired.x) > 1 ||
          Math.abs(current.y - desired.y) > 1 ||
          Math.abs(current.width - desired.width) > 1 ||
          Math.abs(current.height - desired.height) > 1) {
        target.move_resize_frame(false, desired.x, desired.y, desired.width, desired.height);
        return false;
      }
      return true;
    };

    if (bestWindow.unmaximize) bestWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    global._waveDeckSBApplyDockGeometry();

    global._waveDeckSBCreateStrut = function () {
      if (global._waveDeckSBStrut) return;
      var desired = global._waveDeckSBDockRect;
      if (!desired) return;

      var actor = new St.Widget({
        name: "wavedeck-sidebar-strut",
        reactive: false,
        opacity: 0
      });
      actor.set_position(desired.x, desired.y);
      actor.set_size(desired.width, desired.height);
      global._waveDeckSBStrut = actor;
      Main.layoutManager.addChrome(actor, {
        affectsStruts: true,
        affectsInputRegion: false,
        visibleInFullscreen: false
      });
      if (Main.layoutManager._chrome && Main.layoutManager._chrome.updateRegions) {
        Main.layoutManager._chrome.updateRegions();
      } else {
        Main.layoutManager.updateChrome();
      }

      // A true _NET_WM_WINDOW_TYPE_DOCK window is exempt from the normal work
      // area constraint. Verify once after the strut changes the work area;
      // this is safe for the dock window and would not be safe for a normal one.
      global._waveDeckSBPostStrutVerifyId = Mainloop.timeout_add(250, function () {
        if (global._waveDeckSBApplyDockGeometry) global._waveDeckSBApplyDockGeometry();
        global._waveDeckSBPostStrutVerifyId = 0;
        return false;
      });
      global._waveDeckSBCreateStrut = null;

      global._waveDeckSBStrutWatchId = Mainloop.timeout_add_seconds(1, function () {
        if (GLib.file_test("/proc/${pid}", GLib.FileTest.EXISTS)) {
          if (global._waveDeckSBApplyDockGeometry) global._waveDeckSBApplyDockGeometry();
          return true;
        }
        if (global._waveDeckSBStrut) {
          Main.layoutManager.removeChrome(global._waveDeckSBStrut);
          global._waveDeckSBStrut.destroy();
          global._waveDeckSBStrut = null;
        }
        if (Main.layoutManager._chrome && Main.layoutManager._chrome.updateRegions) {
          Main.layoutManager._chrome.updateRegions();
        } else {
          Main.layoutManager.updateChrome();
        }
        global._waveDeckSBFloatingRect = null;
        global._waveDeckSBDockRect = null;
        global._waveDeckSBWindow = null;
        global._waveDeckSBSettleCount = 0;
        global._waveDeckSBSettleAttempts = 0;
        global._waveDeckSBPostStrutVerifyId = 0;
        global._waveDeckSBApplyDockGeometry = null;
        global._waveDeckSBStrutWatchId = 0;
        return false;
      });
    };

    // Electron can briefly restore its old floating height after the first
    // move. Leave the work area unreserved until two checks in a row match.
    // The replacement window is already a dock, so it remains eligible to
    // occupy this rectangle after the matching strut changes the work area.
    global._waveDeckSBSettleCount = 0;
    global._waveDeckSBSettleAttempts = 0;
    global._waveDeckSBGeometryRetryId = Mainloop.timeout_add(200, function () {
      if (!GLib.file_test("/proc/${pid}", GLib.FileTest.EXISTS)) {
        global._waveDeckSBGeometryRetryId = 0;
        global._waveDeckSBApplyDockGeometry = null;
        global._waveDeckSBCreateStrut = null;
        return false;
      }

      global._waveDeckSBSettleAttempts += 1;
      var matches = global._waveDeckSBApplyDockGeometry &&
        global._waveDeckSBApplyDockGeometry();
      if (matches) global._waveDeckSBSettleCount += 1;
      else global._waveDeckSBSettleCount = 0;

      if (global._waveDeckSBSettleCount >= 2) {
        var createStrut = global._waveDeckSBCreateStrut;
        global._waveDeckSBGeometryRetryId = 0;
        if (createStrut) createStrut();
        return false;
      }
      return true;
    });
    return "docked:" + monitorIndex + ":" + dockX + "," + dockY + "," + dockWidth + "," + dockHeight;
  })()`;
}

function setCinnamonReservedSpace(ownerPid = process.pid, expectedTitle = "WaveDeck Sidebar") {
  return callCinnamon(reservationCode(ownerPid, expectedTitle));
}

function clearCinnamonReservedSpace(
  ownerPid = process.pid,
  restoreWindow = false,
  expectedTitle = "WaveDeck Sidebar"
) {
  return callCinnamon(cleanupCode(ownerPid, restoreWindow, expectedTitle));
}

module.exports = {
  callCinnamon,
  cleanupCode,
  clearCinnamonReservedSpace,
  reservationCode,
  setCinnamonReservedSpace,
  windowLookupCode
};
