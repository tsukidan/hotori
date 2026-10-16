"use strict";
const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core?.invoke;
let busy = false;
let updatingTheme = false;
let checkingApp = false;
let installingApp = false;
let status = { ready: false, installed: false };
let fields = [];
let navigationTimer;
let savedValues = new Map();
let categoryGroups = new Map();

function message(id, text, error = false, symbol = "info", detailSymbol = "") {
  if (id === "home-status") {
    const [heading, ...details] = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const copy = element("span", "status-copy");
    copy.append(element("strong", "status-heading", heading));
    if (details.length) {
      const detail = element("span", "status-detail");
      if (detailSymbol) detail.append(icon(detailSymbol));
      detail.append(element("span", "status-detail-text", details.join(" ")));
      copy.append(document.createTextNode("\n"), detail);
    }
    $(id).replaceChildren(icon(error ? "alert" : symbol), copy);
  } else $(id).textContent = text;
  $(id).dataset.error = String(error);
}

function updateButtons() {
  $("install").disabled = busy || !status.ready || status.installed;
  $("install").querySelector(".button-label").textContent = busy ? "Working…" : status.installed ? "Installed" : "Install";
  $("update-theme").disabled = busy || !status.installed;
  $("update-theme").querySelector(".button-label").textContent = busy && updatingTheme ? "Updating…" : "Update theme";
  $("uninstall").disabled = busy || !status.installed;
  $("customize").disabled = busy || !status.installed;
  $("folder").disabled = busy || !invoke;
  $("update-app").disabled = busy || checkingApp || !invoke;
  $("update-app").querySelector(".button-label").textContent = checkingApp ? "Checking…" : "Update Hotori";
  $("app-update-cancel").disabled = installingApp;
  $("app-update-install").disabled = installingApp;
  $("back").disabled = busy;
  $("reset-defaults").disabled = busy || !invoke;
  updateCategoryButtons();
}

async function refresh() {
  if (!invoke || busy) return;
  try {
    status = await invoke("get_status");
    document.querySelector(".vencord-notice").hidden = status.ready;
    updateButtons();
  } catch (error) { message("home-status", String(error), true); }
}

function navigate(page) {
  const settings = page === "settings";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  clearTimeout(navigationTimer);
  $("app").classList.add("navigating");
  $("app").dataset.page = page;
  $("installer-page").inert = settings;
  $("settings-page").inert = !settings;
  navigationTimer = setTimeout(() => {
    $("app").classList.remove("navigating");
    (settings ? $("settings-title") : $("customize")).focus({ preventScroll: true });
  }, reduceMotion ? 0 : 340);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const iconPaths = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12" rx="1.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  "app-update": '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 17V7m-4 4 4-4 4 4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  sliders: '<path d="M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4-6v6m0 4v6m4-6v6"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3z"/>',
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/>',
  glass: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 13 5-5m-2 8 5-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  blur: '<circle cx="12" cy="12" r="9"/><path d="M8 6v12m4-14v16m4-14v12"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c4 0 3-11-6-11Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="7" r=".7"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
  pointer: '<path d="m5 3 15 9-7 2-3 7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  circle: '<rect x="3" y="3" width="18" height="18" rx="7"/>',
  message: '<path d="M4 3h16v14H9l-5 4zM8 7h8M8 11h5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7"); svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  // Markup is exclusively from the local icon catalog, never theme input.
  svg.innerHTML = iconPaths[name] || iconPaths.sliders;
  return svg;
}

function initializeDock() {
  const dock = $("command-dock");
  const items = [...dock.querySelectorAll(".dock-item")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pointerY = null;
  let frame = 0;
  const reset = () => {
    items.forEach(item => {
      item.style.removeProperty("--dock-scale");
      item.style.removeProperty("--dock-shift");
      item.style.removeProperty("--dock-spread");
    });
  };
  const paint = () => {
    frame = 0;
    if (reduceMotion.matches || pointerY === null) { reset(); return; }
    // Measure stationary rows so magnification never feeds back into pointer distance.
    const centers = items.map(item => {
      const rect = item.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    items.forEach((item, index) => {
      const distance = centers[index] - pointerY;
      const influence = Math.max(0, 1 - Math.abs(distance) / 115);
      const weight = influence * influence;
      item.style.setProperty("--dock-scale", (1 + weight * .42).toFixed(3));
      item.style.setProperty("--dock-shift", `${(-weight * 10).toFixed(2)}px`);
      item.style.setProperty("--dock-spread", `${(Math.sign(distance) * influence * 8).toFixed(2)}px`);
    });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  dock.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    pointerY = event.clientY;
    schedule();
  });
  dock.addEventListener("pointerleave", () => { pointerY = null; schedule(); });
  dock.addEventListener("focusin", event => {
    const item = event.target.closest(".dock-item");
    if (!item) return;
    const rect = item.getBoundingClientRect();
    pointerY = rect.top + rect.height / 2;
    schedule();
  });
  dock.addEventListener("focusout", event => {
    if (!dock.contains(event.relatedTarget)) { pointerY = null; schedule(); }
  });
  reduceMotion.addEventListener("change", schedule);
}
function fieldIcon(field) {
  if (field.name.includes("avatar")) return field.name.includes("radius") ? "circle" : "user";
  if (field.name.includes("blur") || field.name.includes("saturation")) return "blur";
  if (field.name.includes("overlay")) return "sun";
  if (field.kind === "image") return "image";
  if (field.name.includes("server-list")) return "server";
  if (field.name.includes("interactive") || field.name.includes("icon")) return "pointer";
  if (field.section === "Text & icon colors") return "text";
  if (field.name.includes("mention") || field.name.includes("chat-input")) return "message";
  return field.kind === "color" ? "palette" : "glass";
}
function disclosure(title, symbol, open, submenu = false) {
  const details = element("details", submenu ? "submenu" : "settings-section");
  details.open = open;
  const summary = element("summary");
  const heading = element(submenu ? "h4" : "h3", submenu ? "submenu-heading" : "section-heading");
  heading.append(icon(symbol), document.createTextNode(title));
  summary.append(heading, icon("chevron"));
  const content = element("div", submenu ? "submenu-content" : "section-content");
  details.append(summary, content);
  return { details, content };
}
function categoryFor(field) {
  return ({ "Glass appearance": "Glass Appearance", "Blur & saturation": "Glass Appearance", "Glass tints": "Glass Appearance",
    "Wallpapers": "Wallpapers", "Background dimming": "Wallpapers", "Accent color": "Colors", "Text & icon colors": "Colors",
    "Avatars": "Avatars", "Message spacing": "Messages", "Mention highlights": "Messages", "Server list": "Server List" })[field.section] || "Colors";
}
function updateCategoryButtons() {
  for (const [category, group] of categoryGroups) {
    const dirty = fields.some(field => categoryFor(field) === category && field.value !== savedValues.get(field.name));
    group.save.disabled = busy || !invoke || !dirty;
    group.save.dataset.dirty = String(dirty);
    group.save.dataset.state = busy && group.saving ? "saving" : dirty ? "dirty" : group.saved ? "saved" : "unchanged";
    group.save.querySelector(".button-label").textContent = group.saving ? "Saving…" : dirty ? "Save changes" : group.saved ? "Saved" : "Save changes";
    group.note.textContent = dirty ? "Unsaved changes" : group.saved ? "Changes saved" : "No changes";
  }
}
async function saveCategory(category) {
  const group = categoryGroups.get(category);
  if (busy || !invoke || group.save.disabled) return;
  const submitted = new Map(fields.filter(field => categoryFor(field) === category).map(field => [field.name, field.value]));
  const edits = fields.map(field => ({ name: field.name, value: submitted.has(field.name) ? submitted.get(field.name) : savedValues.get(field.name) }));
  busy = true; group.saving = true; updateButtons();
  try {
    const updated = await invoke("save_settings", { edits });
    for (const field of fields) if (submitted.has(field.name)) {
      const canonical = updated.find(saved => saved.name === field.name).value;
      savedValues.set(field.name, canonical);
      // Keep any new edits made while the save was in flight.
      if (field.value === submitted.get(field.name)) field.value = canonical;
    }
    group.saved = true;
    message("settings-status", `${category} saved. Other unsaved changes stay in the editor.`);
  } catch (error) { message("settings-status", String(error), true); }
  finally { busy = false; group.saving = false; updateButtons(); }
}

function wallpaperControl(field, control) {
  const localPrefix = "vencord:///themes/hotori-assets/";
  const input = element("input", "input"); input.type = "text"; input.spellcheck = false;
  input.placeholder = "https://example.com/image.jpg";
  const actions = element("div", "wallpaper-actions");
  const local = element("button", "button", "Choose local image"); local.type = "button"; local.prepend(icon("folder"));
  const link = element("button", "button", "Use image link"); link.type = "button"; link.prepend(icon("image"));
  const clear = element("button", "button", "Clear background"); clear.type = "button"; clear.prepend(icon("trash"));
  const picker = element("input", "wallpaper-picker"); picker.type = "file"; picker.hidden = true; picker.tabIndex = -1; picker.accept = "image/png,image/jpeg,image/gif,image/webp";
  picker.setAttribute("aria-label", `${field.label} local image`);
  const notice = element("p", "wallpaper-notice");
  const feedback = element("p", "wallpaper-feedback"); feedback.setAttribute("role", "status");
  const preview = element("img", "wallpaper-preview"); preview.alt = `${field.label} preview`; preview.hidden = true; preview.referrerPolicy = "no-referrer";
  let previewRequest = 0;
  const isLocal = () => field.value.startsWith(localPrefix);
  const sync = () => {
    input.readOnly = isLocal();
    input.value = isLocal() ? "Local image selected" : field.value;
    updateCategoryButtons();
    local.setAttribute("aria-pressed", String(isLocal()));
    link.setAttribute("aria-pressed", String(!isLocal()));
    notice.textContent = isLocal()
      ? "This image stays on your computer and won’t be uploaded. Hotori keeps a copy, so moving or deleting the original won’t affect it."
      : "Discord will load this image from the provided website. The link must point directly to an image. Previewing also contacts that website.";
  };
  const showPreview = async (data) => {
    const request = ++previewRequest;
    preview.hidden = true; preview.removeAttribute("src"); feedback.textContent = "";
    if (!field.value) return;
    try {
      const src = data || (isLocal() ? await invoke("wallpaper_preview", { uri: field.value }) : field.value);
      if (request !== previewRequest) return;
      if (!isLocal() && !/^https?:\/\//i.test(src)) throw new Error("Enter a direct HTTP or HTTPS image link.");
      preview.onload = () => { if (request === previewRequest) { preview.hidden = false; feedback.textContent = ""; } };
      preview.onerror = () => { if (request === previewRequest) { preview.hidden = true; feedback.textContent = "Could not preview this image. Check the link or choose another file."; } };
      preview.src = src;
    } catch (error) { if (request === previewRequest) feedback.textContent = String(error); }
  };
  input.addEventListener("input", () => { if (!input.readOnly) field.value = input.value.trim(); });
  input.addEventListener("change", () => showPreview());
  local.addEventListener("click", () => picker.click());
  link.addEventListener("click", () => {
    if (isLocal()) { field.value = ""; sync(); showPreview(); }
    input.focus();
  });
  clear.addEventListener("click", () => { field.value = ""; picker.value = ""; sync(); showPreview(); });
  picker.addEventListener("change", async () => {
    const file = picker.files[0]; if (!file || busy) return;
    if (file.size > 10 * 1024 * 1024) { feedback.textContent = "Choose an image smaller than 10 MB."; picker.value = ""; return; }
    busy = true; updateButtons(); local.disabled = link.disabled = clear.disabled = true;
    feedback.textContent = "Copying your image locally…";
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read this image.")); reader.readAsDataURL(file);
      });
      const check = new Image(); check.src = data; await check.decode();
      field.value = await invoke("import_wallpaper", { data });
      sync(); await showPreview(data);
      message("settings-status", "Local image copied. Save changes to apply it to your theme.");
    } catch (error) { feedback.textContent = `Could not use this image: ${error}`; }
    finally { busy = false; updateButtons(); local.disabled = link.disabled = clear.disabled = false; picker.value = ""; }
  });
  actions.append(local, link, clear); control.append(actions, input, picker, notice, preview, feedback);
  sync(); showPreview();
  return input;
}

function renderFields() {
  const fragment = document.createDocumentFragment();
  const layouts = [
    ["Server List", "server", true], ["Glass Appearance", "glass", true],
    ["Wallpapers", "image", true], ["Colors", "palette", true],
    ["Avatars", "user", true], ["Messages", "message", true],
  ];
  const sections = new Map();
  for (const [title, symbol, open] of layouts) {
    const group = disclosure(title, symbol, open);
    sections.set(title, group); fragment.append(group.details);
  }
  const submenus = new Map();
  function target(section, title, symbol, grid = false) {
    const parent = sections.get(section).content;
    if (!title) return parent;
    const key = `${section}/${title}`;
    if (!submenus.has(key)) {
      const group = disclosure(title, symbol, true, true);
      if (grid) group.content.classList.add("color-grid");
      parent.append(group.details); submenus.set(key, group.content);
    }
    return submenus.get(key);
  }
  function destination(field) {
    switch (field.section) {
      case "Glass appearance": return target("Glass Appearance");
      case "Blur & saturation": return target("Glass Appearance", "Blur & Intensity", "blur");
      case "Glass tints": return target("Glass Appearance", "Tint Presets", "palette", true);
      case "Wallpapers": return target("Wallpapers");
      case "Background dimming": return target("Wallpapers", field.name.startsWith("--settings") ? "Settings Background Dimming" : "Main Background Dimming", "sun", true);
      case "Accent color": return target("Colors");
      case "Text & icon colors": return target("Colors", /interactive|icon/.test(field.name) ? "Icon Colors" : "Text Colors", /interactive|icon/.test(field.name) ? "pointer" : "text", true);
      case "Avatars": return target("Avatars");
      case "Message spacing": return target("Messages");
      case "Mention highlights": return target("Messages", "Mention Highlights", "message", true);
      case "Server list": return target("Server List");
      default: return target("Colors", "Other Colors", "palette", true);
    }
  }
  fields.forEach((field, index) => {
    const row = element("div", `setting-row${field.kind === "color" ? " color-field" : ""}`);
    row.dataset.name = field.name;
    const info = element("div", "setting-info");
    const label = element("label", "setting-label");
    label.append(icon(fieldIcon(field)), document.createTextNode(field.label));
    label.htmlFor = `field-${index}`;
    const hint = element("p", "setting-hint", field.hint);
    hint.id = `hint-${index}`;
    label.title = field.hint;
    info.append(label, hint);
    const control = element("div", "setting-control");
    let input;
    if (field.kind === "choice") {
      input = element("select");
      const choices = field.choices.includes(field.value) ? field.choices : [field.value, ...field.choices];
      choices.forEach((choice) => {
        const option = element("option", "", choice); option.value = choice; input.append(option);
      });
      input.value = field.value;
      input.addEventListener("change", () => {
        field.value = input.value;
        hint.textContent = field.choiceHints[field.choices.indexOf(input.value)] || field.hint;
      });
      control.append(input);
    } else if (field.slider) {
      const spec = field.slider;
      const isBlur = field.name === "--blur-val" || field.name === "--liquid-blur-val";
      const isRoundness = field.name === "--avatar-radius";
      const baseline = (spec.min + spec.max) / 2;
      const toDisplay = value => spec.avatarPercent ? 100 + (Number(value) - 40) * 20 / 30
        : isRoundness ? Math.min(100, Number(value) * 2)
        : isBlur ? Number(value) / baseline * 100 : Number(value);
      const toTheme = value => spec.avatarPercent ? 40 + (value - 100) * 30 / 20
        : isRoundness ? value / 2 : isBlur ? value * baseline / 100 : value;
      const unit = spec.avatarPercent || isRoundness || isBlur || field.unit === "%" ? "%" : field.unit === "pixels" ? "px" : "";
      input = element("input"); input.type = "range";
      input.min = Math.ceil(Number(toDisplay(spec.min).toFixed(8)));
      input.max = Math.floor(Number(toDisplay(spec.max).toFixed(8)));
      input.step = "1";
      input.value = Math.round(toDisplay(field.value));
      const output = element("output", "range-output"); output.htmlFor = `field-${index}`;
      const update = () => {
        output.textContent = `${Math.round(toDisplay(field.value))}${unit}`;
        input.setAttribute("aria-valuetext", output.textContent);
      };
      update();
      input.addEventListener("input", () => {
        field.value = String(Number(toTheme(Number(input.value)).toFixed(8)));
        update();
      });
      const endpoints = element("div", "range-endpoints");
      endpoints.append(element("span", "", `${input.min}${unit}`), element("span", "", `${input.max}${unit}`));
      control.append(output, input, endpoints);
      if (field.name !== "--avatar-radius" && (Number(field.value) < spec.min || Number(field.value) > spec.max)) {
        hint.textContent += " Your existing value is outside this range and is preserved until you move the slider.";
      }
    } else if (field.kind === "image") {
      input = wallpaperControl(field, control);
    } else if (field.kind === "color") {
      const colorLine = element("div", "color-input");
      const hexAlpha = field.alphaEnabled && field.value.startsWith("#");
      input = element("input"); input.type = "color"; input.value = field.color;
      const value = element("span", "color-value", input.value.toUpperCase());
      colorLine.append(input, value); control.append(colorLine);
      const colorChanged = () => {
        value.textContent = input.value.toUpperCase();
        const rgb = input.value.slice(1).match(/../g).map((c) => parseInt(c, 16));
        field.value = hexAlpha ? input.value + Math.round(field.opacity * 255).toString(16).padStart(2, "0")
          : field.alphaEnabled ? `rgba(${rgb.join(", ")}, ${field.opacity})` : input.value;
      };
      input.addEventListener("input", colorChanged);
      if (field.alphaEnabled) {
        const opacityLine = element("label", "opacity-input");
        const slider = element("input"); slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "1"; slider.value = field.opacity * 100;
        slider.setAttribute("aria-label", `${field.label} opacity`);
        const output = element("output", "", `${Math.round(field.opacity * 100)}%`);
        slider.addEventListener("input", () => { field.opacity = Number(slider.value) / 100; output.textContent = `${slider.value}%`; colorChanged(); });
        opacityLine.append(document.createTextNode("Opacity"), slider, output); control.append(opacityLine);
      }
    } else {
      input = element("input", "input");
      input.type = field.kind === "number" && /^\d*\.?\d+$/.test(field.value) ? "number" : "text";
      if (input.type === "number") { input.step = "any"; input.min = "0"; }
      input.value = field.value; input.spellcheck = false;
      input.addEventListener("input", () => { field.value = input.value; });
      const unitInput = element("div", "unit-input"); unitInput.append(input);
      if (field.unit) unitInput.append(element("span", "", field.unit));
      control.append(unitInput);
    }
    input.id = `field-${index}`;
    input.title = field.hint;
    input.setAttribute("aria-describedby", hint.id);
    row.append(info, control); destination(field).append(row);
  });
  categoryGroups = new Map();
  for (const [category, group] of sections) {
    if (!group.content.children.length) { group.details.remove(); continue; }
    const footer = element("div", "category-footer");
    const note = element("span", "category-status", "No changes"); note.setAttribute("role", "status");
    const save = element("button", "button primary category-save"); save.type = "button";
    save.setAttribute("aria-label", `Save ${category}`); save.dataset.category = category;
    save.append(icon("save"), element("span", "button-label", "Save changes"));
    save.addEventListener("click", () => saveCategory(category));
    footer.append(note, save); group.content.append(footer);
    categoryGroups.set(category, { save, note, saved: false, saving: false });
  }
  $("settings-list").replaceChildren(fragment);
  $("settings-form").scrollTop = 0;
  updateCategoryButtons();
}

async function operation(command, success) {
  if (busy || !invoke) return;
  busy = true; updateButtons();
  try {
    await invoke(command);
    message("home-status", success, false, command === "install_theme" ? "check" : "trash");
  } catch (error) { message("home-status", String(error), true); }
  finally { busy = false; await refresh(); updateButtons(); }
}

async function checkForAppUpdate() {
  checkingApp = true; updateButtons();
  try {
    const result = await invoke("check_app_update");
    $("app-update-bubble").hidden = !result.available;
    return result;
  } catch (error) {
    $("app-update-bubble").hidden = true;
    throw error;
  } finally { checkingApp = false; updateButtons(); }
}

$("update-app").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; updateButtons();
  message("home-status", "Checking for a Hotori app update…", false, "app-update");
  try {
    const result = await checkForAppUpdate();
    if (result.available) {
      $("app-update-description").textContent = `Hotori ${result.version} is available. You’re using ${result.currentVersion}. Hotori will close and reopen to finish the update.`;
      message("app-update-status", "Your theme settings and wallpapers will be preserved.");
      $("app-update-progress").hidden = true;
      $("app-update-progress").value = 0;
      $("app-update-dialog").showModal();
      message("home-status", `Hotori ${result.version} is available.`, false, "app-update");
    } else message("home-status", `You’re up to date. Hotori ${result.currentVersion} is installed.`);
  } catch (error) { message("home-status", String(error), true); }
  finally { busy = false; updateButtons(); }
});
$("app-update-cancel").addEventListener("click", () => { if (!installingApp) $("app-update-dialog").close(); });
$("app-update-dialog").addEventListener("cancel", event => { if (installingApp) event.preventDefault(); });
$("app-update-install").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; installingApp = true; updateButtons();
  $("app-update-progress").hidden = false;
  message("app-update-status", "Downloading the update…");
  let unlisten;
  try {
    if (window.__TAURI__?.event) unlisten = await window.__TAURI__.event.listen("app-update-progress", ({ payload }) => {
      $("app-update-progress").value = payload.percent;
      message("app-update-status", payload.phase === "verifying" ? "Verifying the update and preparing to restart…" : `Downloading Hotori… ${payload.percent}%`);
    });
    await invoke("install_app_update");
    message("app-update-status", "Restarting Hotori…");
  } catch (error) {
    message("app-update-status", String(error), true);
    $("app-update-progress").hidden = true;
  } finally {
    if (unlisten) unlisten();
    busy = false; installingApp = false; updateButtons();
  }
});

$("install").addEventListener("click", () => operation("install_theme", "Installed. Enable Hotori in Vencord’s Themes settings."));
$("update-theme").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; updatingTheme = true; updateButtons();
  message("home-status", "Downloading the latest Hotori theme… Your saved settings will be preserved.", false, "download");
  try {
    const result = await invoke("update_theme");
    message("home-status", result.changed ? `Theme updated to v${result.version}. Your customization settings were preserved.` : `Theme v${result.version} is already up to date. Your settings are unchanged.`, false, "check");
  } catch (error) { message("home-status", `Could not update theme: ${error}`, true); }
  finally { busy = false; updatingTheme = false; await refresh(); updateButtons(); }
});
$("uninstall").addEventListener("click", () => operation("uninstall_theme", "Theme uninstalled."));
$("folder").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; updateButtons();
  try {
    const openedFolder = await invoke("open_theme_folder");
    if (openedFolder) message("home-status", "Opened your Vencord themes folder.", false, "folder");
    else {
      $("vencord-dialog").showModal();
      message("home-status", "Opened the Vencord download page.");
    }
  } catch (error) { message("home-status", String(error), true); }
  finally { busy = false; await refresh(); updateButtons(); }
});
$("customize").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; updateButtons();
  try {
    fields = await invoke("load_settings");
    savedValues = new Map(fields.map(field => [field.name, field.value]));
    renderFields();
    message("settings-status", "Save changes in each category. Back discards only unsaved changes.");
    navigate("settings");
  } catch (error) { message("home-status", `Could not load settings: ${error}`, true); }
  finally { busy = false; updateButtons(); }
});
$("reset-defaults").addEventListener("click", async () => {
  if (busy || !invoke) return;
  busy = true; updateButtons();
  const scroll = $("settings-form").scrollTop;
  try {
    fields = await invoke("reset_settings");
    savedValues = new Map(fields.map(field => [field.name, field.value]));
    renderFields();
    $("settings-form").scrollTop = scroll;
    message("settings-status", "All customization options reset and saved to defaults.");
  } catch (error) { message("settings-status", String(error), true); }
  finally { busy = false; updateButtons(); }
});
$("back").addEventListener("click", () => { if (!busy) navigate("installer"); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("app").dataset.page === "settings" && !busy) navigate("installer");
});
$("settings-form").addEventListener("submit", event => event.preventDefault());
$("settings-form").addEventListener("input", updateCategoryButtons);
$("settings-form").addEventListener("change", updateCategoryButtons);
// Clear/link buttons change the value programmatically before this bubble listener runs.
$("settings-form").addEventListener("click", updateCategoryButtons);

async function initializeTitlebar() {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow();
  if (!appWindow) {
    document.querySelectorAll(".window-button").forEach(button => button.disabled = true);
    return;
  }
  const reportError = error => message($("app").dataset.page === "settings" ? "settings-status" : "home-status", String(error), true);
  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized();
    const button = $("window-maximize");
    const label = maximized ? "Restore" : "Maximize";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.replaceChildren(icon(maximized ? "restore" : "maximize"));
  };
  $("window-minimize").addEventListener("click", () => appWindow.minimize().catch(reportError));
  $("window-maximize").addEventListener("click", () => appWindow.toggleMaximize().then(syncMaximized).catch(reportError));
  $("window-close").addEventListener("click", () => appWindow.close().catch(reportError));
  try {
    await syncMaximized();
    document.querySelector(".titlebar").dataset.focused = String(await appWindow.isFocused());
    await appWindow.onResized(() => syncMaximized().catch(reportError));
    await appWindow.onFocusChanged(({ payload }) => { document.querySelector(".titlebar").dataset.focused = String(payload); });
  } catch (error) { reportError(error); }
}

async function initialize() {
  if (!invoke) {
    message("home-status", "Interface preview. Open Hotori to install or customize your theme.");
    updateButtons(); return;
  }
  await refresh();
  message("home-status", status.installed ? "Hotori is installed. Make it yours in Customize." : status.ready ? "Ready to install Hotori." : "Install Vencord first. Open Themes Folder will take you to its download page.", false, status.installed ? "check" : status.ready ? "download" : "alert", status.installed ? "sliders" : "");
  // A failed startup check keeps the optional bubble hidden and leaves theme status intact.
  checkForAppUpdate().catch(() => {});
  setInterval(() => { if (!document.hidden) refresh(); }, 2000);
  window.addEventListener("focus", refresh);
}
document.querySelectorAll("[data-icon]").forEach(node => node.replaceWith(icon(node.dataset.icon)));
initializeDock();
initializeTitlebar();
initialize();
