function getWorkArea(display) {
  const workArea = display?.workArea;
  if (!workArea || !Number.isFinite(workArea.x) || !Number.isFinite(workArea.y) ||
      !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) {
    throw new Error("No usable display work area is available.");
  }
  return workArea;
}

function calculateBottomRightBounds(display, width, height) {
  const workArea = getWorkArea(display);
  return {
    x: Math.round(workArea.x + Math.max(0, workArea.width - width)),
    y: Math.round(workArea.y + Math.max(0, workArea.height - height)),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function calculateCenteredBounds(display, width, height) {
  const workArea = getWorkArea(display);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function constrainBoundsToDisplay(display, bounds, { minWidth = 1, minHeight = 1 } = {}) {
  const workArea = getWorkArea(display);
  const requested = bounds && typeof bounds === "object" ? bounds : {};
  const width = Math.min(
    workArea.width,
    Math.max(Math.min(minWidth, workArea.width), Math.round(Number(requested.width) || minWidth))
  );
  const height = Math.min(
    workArea.height,
    Math.max(Math.min(minHeight, workArea.height), Math.round(Number(requested.height) || minHeight))
  );
  const requestedX = Number.isFinite(Number(requested.x)) ? Math.round(Number(requested.x)) : workArea.x;
  const requestedY = Number.isFinite(Number(requested.y)) ? Math.round(Number(requested.y)) : workArea.y;
  return {
    x: Math.min(Math.max(requestedX, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(requestedY, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  };
}

module.exports = { calculateBottomRightBounds, calculateCenteredBounds, constrainBoundsToDisplay };
