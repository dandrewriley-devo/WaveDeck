const x11 = require("x11");

const SIDEBAR_WIDTH = 300;

function calculateSidebarLayout(display, displays, width = SIDEBAR_WIDTH) {
  if (!display?.bounds || !display?.workArea) throw new Error("No display is available for Sidebar Mode.");

  const allDisplays = displays?.length ? displays : [display];
  const virtualRight = Math.max(...allDisplays.map((item) => item.bounds.x + item.bounds.width));
  const displayRight = display.bounds.x + display.bounds.width;
  const rightStrut = Math.max(width, virtualRight - displayRight + width);
  const startY = Math.max(0, Math.round(display.workArea.y));
  const endY = Math.max(startY, Math.round(display.workArea.y + display.workArea.height - 1));

  return {
    bounds: {
      x: Math.round(display.workArea.x + display.workArea.width - width),
      y: Math.round(display.workArea.y),
      width,
      height: Math.round(display.workArea.height)
    },
    canUseDesktopStrut: displayRight >= virtualRight,
    strut: [0, rightStrut, 0, 0],
    partialStrut: [0, rightStrut, 0, 0, 0, 0, startY, endY, 0, 0, 0, 0]
  };
}

function getX11WindowId(window) {
  const handle = window.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) {
    throw new Error("WaveDeck could not identify its X11 window.");
  }
  return handle.readUInt32LE(0);
}

function internAtom(X, name) {
  return new Promise((resolve, reject) => {
    X.InternAtom(false, name, (error, atom) => error ? reject(error) : resolve(atom));
  });
}

function withX11Client(task) {
  return new Promise((resolve, reject) => {
    x11.createClient((connectionError, display) => {
      if (connectionError) {
        reject(new Error(`Could not connect to the X11 desktop: ${connectionError.message}`));
        return;
      }

      const X = display.client;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        try { X.terminate(); } catch {}
        if (error) reject(error);
        else resolve(true);
      };

      X.once("error", (error) => finish(new Error(`The desktop rejected Sidebar Mode: ${error.message}`)));

      Promise.resolve(task(X)).then(() => {
        X.GetInputFocus((error) => finish(error || null));
      }, finish);
    });
  });
}

async function setReservedSpace(window, layout) {
  const windowId = getX11WindowId(window);
  await withX11Client(async (X) => {
    const [cardinal, strut, partial] = await Promise.all([
      internAtom(X, "CARDINAL"),
      internAtom(X, "_NET_WM_STRUT"),
      internAtom(X, "_NET_WM_STRUT_PARTIAL")
    ]);
    X.ChangeProperty(0, windowId, strut, cardinal, 32, layout.strut);
    X.ChangeProperty(0, windowId, partial, cardinal, 32, layout.partialStrut);
  });
}

async function clearReservedSpace(window) {
  const windowId = getX11WindowId(window);
  await withX11Client(async (X) => {
    const [strut, partial] = await Promise.all([
      internAtom(X, "_NET_WM_STRUT"),
      internAtom(X, "_NET_WM_STRUT_PARTIAL")
    ]);
    X.DeleteProperty(windowId, strut);
    X.DeleteProperty(windowId, partial);
  });
}

function sidebarAvailability() {
  if (process.platform !== "linux") {
    return { available: false, reason: "Sidebar Mode is only available on Linux." };
  }
  if (!process.env.DISPLAY || String(process.env.XDG_SESSION_TYPE).toLowerCase() === "wayland") {
    return {
      available: false,
      reason: "Sidebar Mode requires a Linux Mint X11 session."
    };
  }
  return { available: true, reason: "" };
}

module.exports = {
  SIDEBAR_WIDTH,
  calculateSidebarLayout,
  clearReservedSpace,
  getX11WindowId,
  setReservedSpace,
  sidebarAvailability
};
