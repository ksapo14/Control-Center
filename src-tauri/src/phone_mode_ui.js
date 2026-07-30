(() => {
  const tokenKey = "control-panel-phone-token";
  const themeColors = { black: "#030404", tan: "#060706", green: "#040806", blue: "#04070b", white: "#0a0b0a" };
  const calendarColors = [
    { id: "1", name: "Lavender", value: "#7986cb" }, { id: "2", name: "Sage", value: "#33b679" },
    { id: "3", name: "Grape", value: "#8e24aa" }, { id: "4", name: "Flamingo", value: "#e67c73" },
    { id: "5", name: "Banana", value: "#f6c026" }, { id: "6", name: "Tangerine", value: "#f5511d" },
    { id: "7", name: "Peacock", value: "#039be5" }, { id: "8", name: "Graphite", value: "#616161" },
    { id: "9", name: "Blueberry", value: "#3f51b5" }, { id: "10", name: "Basil", value: "#0b8043" },
    { id: "11", name: "Tomato", value: "#d60000" },
  ];

  const pairPanel = document.getElementById("pairPanel");
  const pairForm = document.getElementById("pairForm");
  const pairCode = document.getElementById("pairCode");
  const pairButton = document.getElementById("pairButton");
  const websiteForm = document.getElementById("websiteForm");
  const websiteAddress = document.getElementById("websiteAddress");
  const websiteButton = document.getElementById("websiteButton");
  const trackpad = document.getElementById("trackpad");
  const keyboardToggle = document.getElementById("keyboardToggle");
  const desktopKeyboard = document.getElementById("desktopKeyboard");
  const desktopKeyboardText = document.getElementById("desktopKeyboardText");
  const keyboardSend = document.getElementById("keyboardSend");
  const phoneCaptureForm = document.getElementById("phoneCaptureForm");
  const phoneCaptureText = document.getElementById("phoneCaptureText");
  const controls = document.getElementById("controls");
  const connection = document.getElementById("connection");
  const connectionText = document.getElementById("connectionText");
  const status = document.getElementById("status");
  const volume = document.getElementById("volume");
  const brightness = document.getElementById("brightness");
  const volumeValue = document.getElementById("volumeValue");
  const brightnessValue = document.getElementById("brightnessValue");
  const workspaceNotice = document.getElementById("workspaceNotice");
  const monitorList = document.getElementById("monitorList");
  const selectedWindowPanel = document.getElementById("selectedWindowPanel");
  const selectedWindowTitle = document.getElementById("selectedWindowTitle");
  const selectedWindowApp = document.getElementById("selectedWindowApp");
  const selectedMonitor = document.getElementById("selectedMonitor");
  const saveWorkspaceButton = document.getElementById("saveWorkspace");
  const geometryInputs = {
    x: document.getElementById("geometryX"), y: document.getElementById("geometryY"),
    width: document.getElementById("geometryWidth"), height: document.getElementById("geometryHeight"),
  };
  const calendarState = document.getElementById("calendarState");
  const scheduleNotice = document.getElementById("scheduleNotice");
  const eventRows = document.getElementById("eventRows");
  const submitEvents = document.getElementById("submitEvents");
  const createdEvents = document.getElementById("createdEvents");

  function readStoredToken() {
    try { return localStorage.getItem(tokenKey) || ""; } catch (_) { return ""; }
  }

  function storeToken(value) {
    try { localStorage.setItem(tokenKey, value); } catch (_) {
      // Safari can deny storage in private or restricted contexts; the in-memory token still works.
    }
  }

  function clearStoredToken() {
    try { localStorage.removeItem(tokenKey); } catch (_) {
      // Storage is optional and may remain unavailable for this browsing session.
    }
  }

  let token = readStoredToken();
  let workspace = null;
  let workspaceBaseline = new Map();
  let selectedHandle = null;
  let pointerInteraction = null;
  let workspaceBusy = false;
  let calendarConnected = false;
  let calendarBusy = false;
  let manualRowSequence = 0;
  let manualRows = [];
  let pointerFrame = null;
  let pointerSendPending = false;
  let queuedPointerX = 0;
  let queuedPointerY = 0;
  let scrollSendPending = false;
  let queuedScrollPixels = 0;
  const activeTrackpadPointers = new Map();
  let trackpadGestureStarted = 0;
  let trackpadGestureDistance = 0;
  let trackpadGestureMoved = false;
  let lastTrackpadCenter = null;

  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
  const selectedWindow = () => workspace?.windows.find((item) => item.handle === selectedHandle) || null;
  const currentWindowState = (item) => item?.minimized ? "minimized" : item?.maximized ? "maximized" : "normal";
  const windowSignature = (item) => JSON.stringify({
    monitorId: item.monitorId, x: item.x, y: item.y, width: item.width, height: item.height,
    minimized: item.minimized, maximized: item.maximized,
  });

  function applyTheme(theme) {
    const next = Object.prototype.hasOwnProperty.call(themeColors, theme) ? theme : "tan";
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[next]);
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function setInlineNotice(element, message, kind = "info") {
    element.textContent = message;
    element.classList.toggle("error", kind === "error");
    element.classList.toggle("success", kind === "success");
  }

  function setPaired(paired) {
    pairPanel.hidden = paired;
    controls.classList.toggle("visible", paired);
    connection.classList.toggle("connected", paired);
    connectionText.textContent = paired ? "Paired" : "Not paired";
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { credentials: "same-origin", ...options, headers });
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (response.status === 401 && path !== "/api/pair") {
      token = "";
      clearStoredToken();
      setPaired(false);
    }
    if (!response.ok) throw new Error(payload.error || "The computer rejected this request");
    return payload;
  }

  async function loadPublicStatus() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      applyTheme(data.theme);
    } catch (_) {
      // The last received theme remains useful while the computer is temporarily unreachable.
    }
  }

  async function action(type, value, options = {}) {
    try {
      const body = value === undefined ? { type } : { type, value };
      const result = await request("/api/action", { method: "POST", body: JSON.stringify(body) });
      if (!options.quiet) setStatus(result.message || "Done");
      return true;
    } catch (error) {
      setStatus(error.message || String(error), true);
      return false;
    }
  }

  function trackpadCenter() {
    if (!activeTrackpadPointers.size) return null;
    const points = [...activeTrackpadPointers.values()];
    return {
      x: points.reduce((total, point) => total + point.x, 0) / points.length,
      y: points.reduce((total, point) => total + point.y, 0) / points.length,
    };
  }

  function schedulePointerFlush() {
    if (pointerFrame !== null || pointerSendPending) return;
    pointerFrame = window.requestAnimationFrame(() => {
      pointerFrame = null;
      void flushPointerMove();
    });
  }

  async function flushPointerMove() {
    if (pointerSendPending) return;
    const x = clamp(Math.round(queuedPointerX), -500, 500);
    const y = clamp(Math.round(queuedPointerY), -500, 500);
    if (x === 0 && y === 0) return;
    queuedPointerX -= x;
    queuedPointerY -= y;
    pointerSendPending = true;
    await action("mouse_move", { x, y }, { quiet: true });
    pointerSendPending = false;
    if (Math.abs(queuedPointerX) >= .5 || Math.abs(queuedPointerY) >= .5) schedulePointerFlush();
  }

  function queuePointerMove(deltaX, deltaY) {
    const acceleration = Math.min(2.2, 1.15 + Math.hypot(deltaX, deltaY) / 22);
    queuedPointerX += deltaX * acceleration;
    queuedPointerY += deltaY * acceleration;
    schedulePointerFlush();
  }

  async function flushTrackpadScroll() {
    if (scrollSendPending || Math.abs(queuedScrollPixels) < 16) return;
    const steps = clamp(Math.trunc(queuedScrollPixels / 16), -12, 12);
    if (!steps) return;
    queuedScrollPixels -= steps * 16;
    scrollSendPending = true;
    await action("mouse_scroll", steps, { quiet: true });
    scrollSendPending = false;
    if (Math.abs(queuedScrollPixels) >= 16) void flushTrackpadScroll();
  }

  function queueTrackpadScroll(deltaY) {
    queuedScrollPixels += deltaY;
    void flushTrackpadScroll();
  }

  function beginTrackpadGesture(event) {
    event.preventDefault();
    trackpad.setPointerCapture?.(event.pointerId);
    activeTrackpadPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    trackpad.classList.add("active");
    if (activeTrackpadPointers.size === 1) {
      trackpadGestureStarted = performance.now();
      trackpadGestureDistance = 0;
      trackpadGestureMoved = false;
    } else {
      trackpadGestureMoved = true;
    }
    lastTrackpadCenter = trackpadCenter();
  }

  function moveTrackpadGesture(event) {
    const previous = activeTrackpadPointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const current = { x: event.clientX, y: event.clientY };
    activeTrackpadPointers.set(event.pointerId, current);
    if (activeTrackpadPointers.size === 1) {
      const deltaX = current.x - previous.x;
      const deltaY = current.y - previous.y;
      trackpadGestureDistance += Math.hypot(deltaX, deltaY);
      if (trackpadGestureDistance > 8) trackpadGestureMoved = true;
      queuePointerMove(deltaX, deltaY);
    } else {
      const center = trackpadCenter();
      if (center && lastTrackpadCenter) queueTrackpadScroll(center.y - lastTrackpadCenter.y);
      lastTrackpadCenter = center;
      trackpadGestureMoved = true;
    }
  }

  function endTrackpadGesture(event, cancelled = false) {
    if (!activeTrackpadPointers.has(event.pointerId)) return;
    event.preventDefault();
    const wasOnlyPointer = activeTrackpadPointers.size === 1;
    const shouldClick = !cancelled
      && wasOnlyPointer
      && !trackpadGestureMoved
      && performance.now() - trackpadGestureStarted < 320;
    activeTrackpadPointers.delete(event.pointerId);
    lastTrackpadCenter = trackpadCenter();
    if (!activeTrackpadPointers.size) trackpad.classList.remove("active");
    if (shouldClick) void action("mouse_click", "left", { quiet: true });
  }

  function switchView(viewId) {
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      const active = button.dataset.viewTarget === viewId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".app-view").forEach((view) => {
      const active = view.id === viewId;
      view.classList.toggle("active", active);
      view.hidden = !active;
    });
    if (viewId === "windowsView" && !workspace) void loadWorkspace();
    if (viewId === "scheduleView") void loadCalendarStatus();
  }

  function renderButtons(targetId, items, type, emptyMessage, labelKey) {
    const target = document.getElementById(targetId);
    target.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = emptyMessage;
      target.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const button = document.createElement("button");
      button.className = "utility";
      button.type = "button";
      button.textContent = item[labelKey];
      button.addEventListener("click", () => action(type, item.id));
      target.appendChild(button);
    });
  }

  async function loadControls() {
    try {
      const data = await request("/api/context");
      applyTheme(data.theme);
      if (Number.isInteger(data.volume)) {
        volume.value = data.volume;
        volumeValue.textContent = `${data.volume}%`;
      }
      if (Number.isInteger(data.brightness)) {
        brightness.value = data.brightness;
        brightnessValue.textContent = `${data.brightness}%`;
      }
      renderButtons("groups", data.groups || [], "group", "No app groups have been saved on the desktop.", "name");
      renderButtons("scenes", data.scenes || [], "scene", "No project scenes have been saved on the desktop.", "name");
      renderButtons("launchers", data.launchers || [], "launcher", "No quick-launch controls are currently available.", "label");
      setPaired(true);
      setStatus("Connected to the computer");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  function monitorForWindow(item) {
    return workspace?.monitors.find((monitor) => monitor.id === item.monitorId)
      || workspace?.monitors.find((monitor) => monitor.primary)
      || workspace?.monitors[0];
  }

  function positionWindowBlock(block, item, monitor) {
    const left = ((item.x - monitor.x) / Math.max(monitor.width, 1)) * 100;
    const top = ((item.y - monitor.y) / Math.max(monitor.height, 1)) * 100;
    const width = (item.width / Math.max(monitor.width, 1)) * 100;
    const height = (item.height / Math.max(monitor.height, 1)) * 100;
    block.style.left = `${clamp(left, 0, 100)}%`;
    block.style.top = `${clamp(top, 0, 100)}%`;
    block.style.width = `${clamp(width, 7, 100)}%`;
    block.style.height = `${clamp(height, 9, 100)}%`;
  }

  function updateSaveState() {
    const changed = workspace?.windows.some((item) => !item.protected && workspaceBaseline.get(item.handle) !== windowSignature(item));
    saveWorkspaceButton.disabled = workspaceBusy || !changed;
  }

  function updateGeometryFields(item) {
    if (!item) return;
    geometryInputs.x.value = item.x;
    geometryInputs.y.value = item.y;
    geometryInputs.width.value = item.width;
    geometryInputs.height.value = item.height;
  }

  function renderSelectedEditor() {
    const item = selectedWindow();
    selectedWindowPanel.hidden = !item;
    if (!item) return;
    selectedWindowTitle.textContent = item.title || item.name;
    selectedWindowApp.textContent = item.protected ? "Protected" : item.name;
    selectedMonitor.replaceChildren();
    workspace.monitors.forEach((monitor) => {
      const option = document.createElement("option");
      option.value = monitor.id;
      option.textContent = `${monitor.name}${monitor.primary ? " · Primary" : ""}`;
      option.selected = monitor.id === item.monitorId;
      selectedMonitor.appendChild(option);
    });
    selectedMonitor.disabled = item.protected;
    updateGeometryFields(item);
    Object.values(geometryInputs).forEach((input) => { input.disabled = item.protected; });
    document.querySelectorAll("[data-preset], [data-window-state]").forEach((button) => { button.disabled = item.protected; });
    document.querySelectorAll("[data-window-state]").forEach((button) => {
      button.classList.toggle("active", button.dataset.windowState === currentWindowState(item));
    });
  }

  function beginWindowPointer(event, item, monitor, mode, block) {
    selectedHandle = item.handle;
    document.querySelectorAll(".window-block").forEach((candidate) => candidate.classList.toggle("selected", candidate.dataset.handle === String(item.handle)));
    renderSelectedEditor();
    if (item.protected || workspaceBusy) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvasBounds = block.parentElement.getBoundingClientRect();
    pointerInteraction = {
      pointerId: event.pointerId,
      mode,
      item,
      monitor,
      block,
      startX: event.clientX,
      startY: event.clientY,
      start: { x: item.x, y: item.y, width: item.width, height: item.height },
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
    };
  }

  function continueWindowPointer(event) {
    const interaction = pointerInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = Math.round(((event.clientX - interaction.startX) / Math.max(interaction.canvasWidth, 1)) * interaction.monitor.width);
    const deltaY = Math.round(((event.clientY - interaction.startY) / Math.max(interaction.canvasHeight, 1)) * interaction.monitor.height);
    const item = interaction.item;
    const monitor = interaction.monitor;
    if (interaction.mode === "move") {
      item.x = clamp(interaction.start.x + deltaX, monitor.workX, monitor.workX + monitor.workWidth - item.width);
      item.y = clamp(interaction.start.y + deltaY, monitor.workY, monitor.workY + monitor.workHeight - item.height);
    } else {
      item.width = clamp(interaction.start.width + deltaX, 160, monitor.workX + monitor.workWidth - item.x);
      item.height = clamp(interaction.start.height + deltaY, 100, monitor.workY + monitor.workHeight - item.y);
    }
    item.minimized = false;
    item.maximized = false;
    positionWindowBlock(interaction.block, item, monitor);
    updateGeometryFields(item);
    updateSaveState();
  }

  function endWindowPointer(event) {
    if (pointerInteraction?.pointerId !== event.pointerId) return;
    pointerInteraction = null;
    renderSelectedEditor();
    updateSaveState();
  }

  function renderWorkspace() {
    monitorList.replaceChildren();
    if (!workspace?.monitors.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No connected display geometry is available.";
      monitorList.appendChild(empty);
      renderSelectedEditor();
      updateSaveState();
      return;
    }
    workspace.monitors.forEach((monitor) => {
      const card = document.createElement("section");
      card.className = "monitor-card";
      const meta = document.createElement("div");
      meta.className = "monitor-meta";
      const name = document.createElement("strong");
      name.textContent = monitor.name;
      const detail = document.createElement("span");
      detail.textContent = `${monitor.width} × ${monitor.height}${monitor.primary ? " · Primary" : ""}`;
      meta.append(name, detail);
      const canvas = document.createElement("div");
      canvas.className = "monitor-canvas";
      canvas.style.aspectRatio = `${monitor.width} / ${monitor.height}`;
      workspace.windows.filter((item) => item.monitorId === monitor.id).forEach((item) => {
        const block = document.createElement("div");
        block.className = `window-block${item.handle === selectedHandle ? " selected" : ""}${item.protected ? " protected" : ""}`;
        block.dataset.handle = String(item.handle);
        block.tabIndex = 0;
        block.setAttribute("role", "button");
        block.setAttribute("aria-label", `${item.name}: ${item.title}. ${item.protected ? "Protected window" : "Drag to move"}`);
        const app = document.createElement("strong");
        app.textContent = item.name;
        const title = document.createElement("span");
        title.textContent = item.title;
        block.append(app, title);
        positionWindowBlock(block, item, monitor);
        block.addEventListener("pointerdown", (event) => beginWindowPointer(event, item, monitor, "move", block));
        block.addEventListener("pointermove", continueWindowPointer);
        block.addEventListener("pointerup", endWindowPointer);
        block.addEventListener("pointercancel", endWindowPointer);
        block.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectedHandle = item.handle;
            renderWorkspace();
          }
        });
        if (!item.protected) {
          const handle = document.createElement("span");
          handle.className = "resize-handle";
          handle.setAttribute("aria-hidden", "true");
          handle.addEventListener("pointerdown", (event) => beginWindowPointer(event, item, monitor, "resize", block));
          handle.addEventListener("pointermove", continueWindowPointer);
          handle.addEventListener("pointerup", endWindowPointer);
          handle.addEventListener("pointercancel", endWindowPointer);
          block.appendChild(handle);
        }
        canvas.appendChild(block);
      });
      card.append(meta, canvas);
      monitorList.appendChild(card);
    });
    renderSelectedEditor();
    updateSaveState();
  }

  async function loadWorkspace(successMessage = "") {
    if (workspaceBusy) return;
    workspaceBusy = true;
    saveWorkspaceButton.disabled = true;
    setInlineNotice(workspaceNotice, "Reading connected displays and open windows…");
    try {
      const data = await request("/api/workspace");
      workspace = data;
      workspaceBaseline = new Map(data.windows.map((item) => [item.handle, windowSignature(item)]));
      selectedHandle = data.windows.some((item) => item.handle === selectedHandle)
        ? selectedHandle
        : (data.windows.find((item) => !item.protected)?.handle || data.windows[0]?.handle || null);
      setInlineNotice(
        workspaceNotice,
        successMessage || `${data.monitors.length} display${data.monitors.length === 1 ? "" : "s"} and ${data.windows.length} open window${data.windows.length === 1 ? "" : "s"} ready.`,
        successMessage ? "success" : "info",
      );
      renderWorkspace();
    } catch (error) {
      setInlineNotice(workspaceNotice, error.message || String(error), "error");
    } finally {
      workspaceBusy = false;
      updateSaveState();
    }
  }

  function moveSelectedToMonitor(target) {
    const item = selectedWindow();
    const source = item && monitorForWindow(item);
    if (!item || !source || item.protected) return;
    const relativeX = (item.x - source.workX) / Math.max(source.workWidth, 1);
    const relativeY = (item.y - source.workY) / Math.max(source.workHeight, 1);
    item.width = Math.min(item.width, target.workWidth);
    item.height = Math.min(item.height, target.workHeight);
    item.monitorId = target.id;
    item.x = clamp(target.workX + Math.round(relativeX * target.workWidth), target.workX, target.workX + target.workWidth - item.width);
    item.y = clamp(target.workY + Math.round(relativeY * target.workHeight), target.workY, target.workY + target.workHeight - item.height);
    renderWorkspace();
  }

  function applyPreset(preset) {
    const item = selectedWindow();
    const monitor = item && monitorForWindow(item);
    if (!item || !monitor || item.protected) return;
    const halfWidth = Math.floor(monitor.workWidth / 2);
    const halfHeight = Math.floor(monitor.workHeight / 2);
    const values = {
      full: [monitor.workX, monitor.workY, monitor.workWidth, monitor.workHeight],
      left: [monitor.workX, monitor.workY, halfWidth, monitor.workHeight],
      right: [monitor.workX + halfWidth, monitor.workY, monitor.workWidth - halfWidth, monitor.workHeight],
      "top-left": [monitor.workX, monitor.workY, halfWidth, halfHeight],
      "top-right": [monitor.workX + halfWidth, monitor.workY, monitor.workWidth - halfWidth, halfHeight],
      "bottom-left": [monitor.workX, monitor.workY + halfHeight, halfWidth, monitor.workHeight - halfHeight],
      "bottom-right": [monitor.workX + halfWidth, monitor.workY + halfHeight, monitor.workWidth - halfWidth, monitor.workHeight - halfHeight],
    }[preset];
    if (!values) return;
    [item.x, item.y, item.width, item.height] = values;
    item.minimized = false;
    item.maximized = false;
    renderWorkspace();
  }

  function applyGeometryInputs() {
    const item = selectedWindow();
    const monitor = item && monitorForWindow(item);
    if (!item || !monitor || item.protected) return;
    const width = clamp(Number(geometryInputs.width.value) || item.width, 160, monitor.workWidth);
    const height = clamp(Number(geometryInputs.height.value) || item.height, 100, monitor.workHeight);
    item.width = width;
    item.height = height;
    item.x = clamp(Number(geometryInputs.x.value), monitor.workX, monitor.workX + monitor.workWidth - width);
    item.y = clamp(Number(geometryInputs.y.value), monitor.workY, monitor.workY + monitor.workHeight - height);
    item.minimized = false;
    item.maximized = false;
    renderWorkspace();
  }

  async function saveWorkspace() {
    if (!workspace || workspaceBusy) return;
    const changed = workspace.windows.filter((item) => !item.protected && workspaceBaseline.get(item.handle) !== windowSignature(item));
    if (!changed.length) return;
    workspaceBusy = true;
    updateSaveState();
    setInlineNotice(workspaceNotice, `Applying ${changed.length} window change${changed.length === 1 ? "" : "s"}…`);
    try {
      await request("/api/workspace", {
        method: "POST",
        body: JSON.stringify({ windows: changed.map((item) => ({
          handle: item.handle, pid: item.pid, x: item.x, y: item.y, width: item.width, height: item.height,
          close: false, state: currentWindowState(item),
        })) }),
      });
      workspaceBusy = false;
      await loadWorkspace("Window layout saved and applied.");
    } catch (error) {
      workspaceBusy = false;
      setInlineNotice(workspaceNotice, error.message || String(error), "error");
      updateSaveState();
    }
  }

  function localDateValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function localTimeValue(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function nextManualRowId() {
    manualRowSequence += 1;
    return `event-${Date.now()}-${manualRowSequence}`;
  }

  function createManualRow(previous) {
    let start;
    if (previous) {
      start = new Date(`${previous.date}T${previous.to}:00`);
    } else {
      start = new Date();
      start.setMinutes(Math.ceil((start.getMinutes() + 1) / 30) * 30, 0, 0);
    }
    if (Number.isNaN(start.getTime())) start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      id: nextManualRowId(), date: localDateValue(start), title: "",
      from: localTimeValue(start), to: localTimeValue(end), colorId: previous?.colorId || "7",
    };
  }

  function renderManualRows() {
    eventRows.replaceChildren();
    manualRows.forEach((row, index) => {
      const card = document.createElement("article");
      card.className = "event-row";
      const head = document.createElement("div");
      head.className = "event-row-head";
      const title = document.createElement("strong");
      title.textContent = `Event ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-row";
      remove.setAttribute("aria-label", `Remove event ${index + 1}`);
      remove.textContent = "×";
      remove.disabled = calendarBusy;
      remove.addEventListener("click", () => {
        manualRows = manualRows.filter((item) => item.id !== row.id);
        if (!manualRows.length) manualRows = [createManualRow()];
        renderManualRows();
      });
      head.append(title, remove);
      card.appendChild(head);

      const makeField = (labelText, type, key) => {
        const label = document.createElement("label");
        label.className = "event-field";
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = type;
        input.value = row[key];
        input.required = true;
        input.disabled = calendarBusy;
        if (key === "title") { input.maxLength = 512; input.placeholder = "Event title"; }
        input.addEventListener("input", () => { row[key] = input.value; });
        label.appendChild(input);
        return label;
      };
      card.append(makeField("Date", "date", "date"), makeField("Title", "text", "title"));
      const timeGrid = document.createElement("div");
      timeGrid.className = "event-time-grid";
      timeGrid.append(makeField("Time from", "time", "from"), makeField("Time to", "time", "to"));
      card.appendChild(timeGrid);

      const colorLabel = document.createElement("label");
      colorLabel.className = "event-field";
      colorLabel.textContent = "Color";
      const colorRow = document.createElement("div");
      colorRow.className = "event-color-row";
      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.style.backgroundColor = calendarColors.find((color) => color.id === row.colorId)?.value || "#039be5";
      const select = document.createElement("select");
      select.disabled = calendarBusy;
      calendarColors.forEach((color) => {
        const option = document.createElement("option");
        option.value = color.id;
        option.textContent = color.name;
        option.selected = row.colorId === color.id;
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        row.colorId = select.value;
        dot.style.backgroundColor = calendarColors.find((color) => color.id === row.colorId)?.value || "#039be5";
      });
      colorRow.append(dot, select);
      colorLabel.appendChild(colorRow);
      card.appendChild(colorLabel);
      eventRows.appendChild(card);
    });
    document.getElementById("addEventRow").disabled = calendarBusy || manualRows.length >= 25;
    submitEvents.disabled = calendarBusy || !calendarConnected || !manualRows.length;
    submitEvents.textContent = `Add ${manualRows.length} event${manualRows.length === 1 ? "" : "s"} to Calendar`;
  }

  async function loadCalendarStatus() {
    calendarState.textContent = "Checking";
    calendarState.classList.remove("connected");
    try {
      const data = await request("/api/calendar/status");
      calendarConnected = Boolean(data.connected);
      calendarState.textContent = calendarConnected ? "Connected" : data.configured ? "Sign in needed" : "Setup needed";
      calendarState.classList.toggle("connected", calendarConnected);
      if (!calendarConnected) {
        setInlineNotice(scheduleNotice, "Connect Google Calendar from Quick Schedule on the desktop before scheduling from your phone.", "error");
      } else {
        setInlineNotice(scheduleNotice, "Add one or more events, then submit the complete batch.");
      }
    } catch (error) {
      calendarConnected = false;
      calendarState.textContent = "Unavailable";
      setInlineNotice(scheduleNotice, error.message || String(error), "error");
    }
    renderManualRows();
  }

  async function submitManualEvents(event) {
    event.preventDefault();
    if (!calendarConnected || calendarBusy) return;
    const events = [];
    for (const [index, row] of manualRows.entries()) {
      const start = new Date(`${row.date}T${row.from}:00`);
      const end = new Date(`${row.date}T${row.to}:00`);
      if (!row.title.trim()) {
        setInlineNotice(scheduleNotice, `Event ${index + 1} needs a title.`, "error");
        return;
      }
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        setInlineNotice(scheduleNotice, `Event ${index + 1} needs an end time after its start time.`, "error");
        return;
      }
      events.push({ title: row.title.trim(), start: start.toISOString(), end: end.toISOString(), description: null, location: null, colorId: row.colorId });
    }
    calendarBusy = true;
    createdEvents.replaceChildren();
    renderManualRows();
    setInlineNotice(scheduleNotice, `Adding ${events.length} event${events.length === 1 ? "" : "s"} to your primary calendar…`);
    try {
      const result = await request("/api/calendar/events", { method: "POST", body: JSON.stringify({ events }) });
      (result.created || []).forEach((item) => {
        const link = document.createElement("a");
        link.href = item.htmlLink;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = `Open ${item.summary}`;
        createdEvents.appendChild(link);
      });
      if (!result.failed?.length) {
        manualRows = [createManualRow()];
        setInlineNotice(scheduleNotice, `Added ${result.created.length} event${result.created.length === 1 ? "" : "s"} to Google Calendar.`, "success");
      } else {
        const failedIndexes = new Set(result.failed.map((item) => item.index));
        manualRows = manualRows.filter((_, index) => failedIndexes.has(index));
        const details = result.failed.map((item) => `${item.title}: ${item.error}`).join(" ");
        setInlineNotice(scheduleNotice, `${result.created.length} added; ${result.failed.length} failed. ${details}`, "error");
      }
    } catch (error) {
      setInlineNotice(scheduleNotice, error.message || String(error), "error");
    } finally {
      calendarBusy = false;
      renderManualRows();
    }
  }

  pairForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = pairCode.value.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setStatus("Enter all six digits from the desktop", true);
      return;
    }
    pairButton.disabled = true;
    try {
      const data = await request("/api/pair", { method: "POST", body: JSON.stringify({ code }) });
      token = data.token;
      if (!token) throw new Error("The computer did not return a pairing token");
      storeToken(token);
      pairCode.value = "";
      setPaired(true);
      setStatus("Pairing accepted. Loading controls…");
      await loadControls();
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      pairButton.disabled = false;
    }
  });

  pairCode.addEventListener("input", () => { pairCode.value = pairCode.value.replace(/\D/g, "").slice(0, 6); });
  websiteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = websiteAddress.value.trim();
    if (!address) {
      setStatus("Enter the website you want to open", true);
      websiteAddress.focus();
      return;
    }
    websiteButton.disabled = true;
    if (await action("open_website", address)) websiteAddress.value = "";
    websiteButton.disabled = false;
  });
  trackpad.addEventListener("pointerdown", beginTrackpadGesture);
  trackpad.addEventListener("pointermove", moveTrackpadGesture);
  trackpad.addEventListener("pointerup", (event) => endTrackpadGesture(event));
  trackpad.addEventListener("pointercancel", (event) => endTrackpadGesture(event, true));
  trackpad.addEventListener("contextmenu", (event) => event.preventDefault());
  trackpad.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void action("mouse_click", "left");
  });
  keyboardToggle.addEventListener("click", () => {
    const opening = desktopKeyboard.hidden;
    desktopKeyboard.hidden = !opening;
    keyboardToggle.setAttribute("aria-expanded", String(opening));
    keyboardToggle.querySelector("strong").textContent = opening ? "Close keyboard" : "Open keyboard";
    if (opening) desktopKeyboardText.focus();
  });
  desktopKeyboard.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!desktopKeyboardText.value) {
      desktopKeyboardText.focus();
      return;
    }
    keyboardSend.disabled = true;
    if (await action("type_text", desktopKeyboardText.value)) desktopKeyboardText.value = "";
    keyboardSend.disabled = false;
    desktopKeyboardText.focus();
  });
  document.querySelectorAll("[data-keyboard-key]").forEach((button) => button.addEventListener("click", () => action("keyboard_key", button.dataset.keyboardKey)));
  document.querySelectorAll("[data-mouse-click]").forEach((button) => button.addEventListener("click", () => action("mouse_click", button.dataset.mouseClick)));
  document.querySelectorAll("[data-scroll-steps]").forEach((button) => button.addEventListener("click", () => action("mouse_scroll", Number(button.dataset.scrollSteps))));
  document.querySelectorAll("[data-shortcut]").forEach((button) => button.addEventListener("click", () => action("shortcut", button.dataset.shortcut)));
  phoneCaptureForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = phoneCaptureText.value.trim();
    if (!text) return;
    if (await action("capture", text)) phoneCaptureText.value = "";
  });
  volume.addEventListener("input", () => { volumeValue.textContent = `${volume.value}%`; });
  volume.addEventListener("change", () => action("volume", Number(volume.value)));
  brightness.addEventListener("input", () => { brightnessValue.textContent = `${brightness.value}%`; });
  brightness.addEventListener("change", () => action("brightness", Number(brightness.value)));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => action(button.dataset.action)));
  document.querySelectorAll("[data-view-target]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewTarget)));
  document.getElementById("workspaceButton").addEventListener("click", () => switchView("windowsView"));
  document.getElementById("workspaceRefresh").addEventListener("click", loadWorkspace);
  document.getElementById("showDesktopButton").addEventListener("click", () => action("show_desktop"));
  document.getElementById("refreshButton").addEventListener("click", loadControls);
  document.getElementById("exitButton").addEventListener("click", async () => {
    if (!await action("exit_phone_mode")) return;
    token = "";
    clearStoredToken();
    setPaired(false);
    setStatus("Phone Mode ended. You can close this page.");
  });
  selectedMonitor.addEventListener("change", () => {
    const target = workspace?.monitors.find((monitor) => monitor.id === selectedMonitor.value);
    if (target) moveSelectedToMonitor(target);
  });
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.querySelectorAll("[data-window-state]").forEach((button) => button.addEventListener("click", () => {
    const item = selectedWindow();
    if (!item || item.protected) return;
    item.minimized = button.dataset.windowState === "minimized";
    item.maximized = button.dataset.windowState === "maximized";
    renderWorkspace();
  }));
  Object.values(geometryInputs).forEach((input) => input.addEventListener("change", applyGeometryInputs));
  saveWorkspaceButton.addEventListener("click", saveWorkspace);
  document.getElementById("addEventRow").addEventListener("click", () => {
    if (manualRows.length >= 25) return;
    manualRows.push(createManualRow(manualRows[manualRows.length - 1]));
    renderManualRows();
  });
  document.getElementById("scheduleForm").addEventListener("submit", submitManualEvents);

  manualRows = [createManualRow()];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById("scheduleTimezone").textContent = `Times use ${timezone}.`;
  renderManualRows();
  setPaired(false);
  void loadPublicStatus();
  window.setInterval(loadPublicStatus, 5_000);
  if (token) void loadControls();
})();
