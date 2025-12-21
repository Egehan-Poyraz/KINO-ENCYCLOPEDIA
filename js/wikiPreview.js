// js/wikiPreview.js
// Smart-positioned Wikipedia-style hover previews (delay + animation)

let previewData = {};

const SHOW_DELAY = 350;  // Wikipedia-ish
const HIDE_DELAY = 120;
const PAD = 12;          // distance from viewport edges
const GAP = 10;          // distance from link to tooltip
const TRANSITION_MS = 160;

// Create ONE shared tooltip so it can "float" anywhere without being clipped
const tooltip = document.createElement("div");
tooltip.className = "wiki-preview";
Object.assign(tooltip.style, {
  position: "fixed",
  left: "0px",
  top: "0px",
  width: "320px",
  zIndex: "9999",

  display: "none",
  opacity: "0",
  transform: "translateY(6px)",
  transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease`,

  pointerEvents: "none",      // don't steal hover
  fontSize: "14.5px",         // slightly bigger text
  lineHeight: "1.45"
});
document.addEventListener("DOMContentLoaded", () => {
  document.body.appendChild(tooltip);
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function positionTooltip(anchorEl) {
  const a = anchorEl.getBoundingClientRect();

  // Must be visible to measure
  const t = tooltip.getBoundingClientRect();

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: prefer right, fallback left
  const spaceRight = vw - a.right;
  const spaceLeft = a.left;

  let x;
  if (spaceRight >= t.width + GAP + PAD) {
    x = a.right + GAP;
  } else if (spaceLeft >= t.width + GAP + PAD) {
    x = a.left - t.width - GAP;
  } else {
    // Not enough space either side -> center-ish over anchor and clamp
    x = a.left + (a.width / 2) - (t.width / 2);
  }

  // Vertical: prefer below, fallback above
  const spaceBelow = vh - a.bottom;
  const spaceAbove = a.top;

  let y;
  if (spaceBelow >= t.height + GAP + PAD) {
    y = a.bottom + GAP;
  } else if (spaceAbove >= t.height + GAP + PAD) {
    y = a.top - t.height - GAP;
  } else {
    // Not enough space -> clamp around anchor
    y = a.bottom + GAP;
  }

  // Clamp to viewport edges
  x = clamp(x, PAD, vw - t.width - PAD);
  y = clamp(y, PAD, vh - t.height - PAD);

  tooltip.style.left = `${Math.round(x)}px`;
  tooltip.style.top = `${Math.round(y)}px`;
}

function showTooltipFor(linkEl) {
  const key = linkEl.dataset.preview;
  const data = previewData[key];
  if (!data) return;

tooltip.innerHTML = `
  <div style="
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
    align-items: stretch;
  ">
    <!-- TEXT -->
    <div style="min-width: 0;">
      <strong style="
        font-size: 16px;
        display: block;
        margin-bottom: 6px;
        line-height: 1.25;
      ">
        ${data.title}
      </strong>
      <p style="
        margin: 0;
        font-size: 14.5px;
        line-height: 1.45;
      ">
        ${data.summary}
      </p>
    </div>

    <!-- IMAGE -->
    <div style="
      width: 100%;
      height: 100%;
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255,255,255,0.06);
      display: flex;
    ">
      <img src="${data.image}" alt="${data.title}" style="
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      ">
    </div>
  </div>
`;


  tooltip.style.display = "block";

  // Place off-screen first, then measure and position
  tooltip.style.left = "-9999px";
  tooltip.style.top = "-9999px";

  // Next frame: position + animate in
  requestAnimationFrame(() => {
    positionTooltip(linkEl);
    tooltip.style.opacity = "1";
    tooltip.style.transform = "translateY(0)";
  });
}

function hideTooltip() {
  tooltip.style.opacity = "0";
  tooltip.style.transform = "translateY(6px)";
  window.setTimeout(() => {
    tooltip.style.display = "none";
  }, TRANSITION_MS);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load JSON previews (your HTML loads this script as a module) :contentReference[oaicite:2]{index=2}
  try {
    const res = await fetch("data/previews.json");
    previewData = await res.json();
  } catch (err) {
    console.error("Preview JSON error:", err);
    return;
  }

  let showTimer = null;
  let hideTimer = null;
  let activeLink = null;

  function scheduleShow(linkEl) {
    activeLink = linkEl;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTooltipFor(linkEl);
    }, SHOW_DELAY);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      activeLink = null;
      hideTooltip();
    }, HIDE_DELAY);
  }

  document.querySelectorAll(".wiki-link").forEach(link => {
    const key = link.dataset.preview;
    if (!key) return;

    link.addEventListener("mouseenter", () => scheduleShow(link));
    link.addEventListener("mouseleave", scheduleHide);
  });

  // Reposition if user scrolls/resizes while tooltip is visible
  window.addEventListener("scroll", () => {
    if (tooltip.style.display === "block" && activeLink) positionTooltip(activeLink);
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (tooltip.style.display === "block" && activeLink) positionTooltip(activeLink);
  });
});
