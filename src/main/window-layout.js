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

module.exports = { calculateBottomRightBounds, calculateCenteredBounds };
