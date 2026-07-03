const STORAGE_KEY = "speak-attension:mindmap:v1";
const COLOR_VALUES = {
  teal: "#0f766e",
  blue: "#2563eb",
  amber: "#d97706",
  rose: "#be3f55",
  slate: "#475569",
};

const els = {
  nodeCount: document.querySelector("#nodeCount"),
  leafCount: document.querySelector("#leafCount"),
  depthCount: document.querySelector("#depthCount"),
  saveStatus: document.querySelector("#saveStatus"),
  mindmapTree: document.querySelector("#mindmapTree"),
  mapCanvas: document.querySelector("#mapCanvas"),
  addChildBtn: document.querySelector("#addChildBtn"),
  addSiblingBtn: document.querySelector("#addSiblingBtn"),
  toggleCollapseBtn: document.querySelector("#toggleCollapseBtn"),
  deleteBtn: document.querySelector("#deleteBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
  nodeTitle: document.querySelector("#nodeTitle"),
  nodeNote: document.querySelector("#nodeNote"),
  nodeMeta: document.querySelector("#nodeMeta"),
  colorPicker: document.querySelector("#colorPicker"),
};

let state = loadMap();
let toastTimer = null;
let storageAvailable = true;

function createDefaultMap() {
  const rootId = createId();
  const ideasId = createId();
  const tasksId = createId();
  const memoId = createId();

  return {
    version: 1,
    rootId,
    selectedId: rootId,
    updatedAt: new Date().toISOString(),
    nodes: {
      [rootId]: {
        id: rootId,
        title: "中心テーマ",
        note: "ここから考えを広げます。",
        parentId: null,
        children: [ideasId, tasksId, memoId],
        collapsed: false,
        color: "teal",
      },
      [ideasId]: {
        id: ideasId,
        title: "アイデア",
        note: "思いついたことをそのまま置く枝。",
        parentId: rootId,
        children: [],
        collapsed: false,
        color: "blue",
      },
      [tasksId]: {
        id: tasksId,
        title: "やること",
        note: "次に動く内容を整理します。",
        parentId: rootId,
        children: [],
        collapsed: false,
        color: "amber",
      },
      [memoId]: {
        id: memoId,
        title: "メモ",
        note: "補足や参考情報を残します。",
        parentId: rootId,
        children: [],
        collapsed: false,
        color: "slate",
      },
    },
  };
}

function init() {
  bindEvents();
  renderAll();
  saveMap();
}

function bindEvents() {
  els.addChildBtn.addEventListener("click", () => addChild());
  els.addSiblingBtn.addEventListener("click", () => addSibling());
  els.toggleCollapseBtn.addEventListener("click", () => toggleSelectedCollapse());
  els.deleteBtn.addEventListener("click", () => deleteSelectedNode());
  els.resetBtn.addEventListener("click", resetMap);
  els.exportBtn.addEventListener("click", exportMap);
  els.importInput.addEventListener("change", importMap);

  els.nodeTitle.addEventListener("input", () => {
    updateSelectedNode({ title: els.nodeTitle.value });
  });
  els.nodeNote.addEventListener("input", () => {
    updateSelectedNode({ note: els.nodeNote.value });
  });

  els.colorPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    updateSelectedNode({ color: button.dataset.color });
    renderInspector();
  });

  els.mindmapTree.addEventListener("click", (event) => {
    const card = event.target.closest("[data-node-id]");
    if (!card) return;
    selectNode(card.dataset.nodeId);
    els.mapCanvas.focus({ preventScroll: true });
  });

  els.mindmapTree.addEventListener("dblclick", (event) => {
    const card = event.target.closest("[data-node-id]");
    if (!card) return;
    selectNode(card.dataset.nodeId);
    els.nodeTitle.focus();
    els.nodeTitle.select();
  });

  document.addEventListener("keydown", handleKeyboard);
}

function handleKeyboard(event) {
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "Enter") {
    event.preventDefault();
    addChild();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    addSibling();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedNode();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectRelative(-1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectRelative(1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveLeft();
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveRight();
  }
}

function loadMap() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createDefaultMap();
    return normalizeMap(JSON.parse(saved));
  } catch {
    return createDefaultMap();
  }
}

function saveMap() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  renderStats();
}

function normalizeMap(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid map");
  if (!payload.rootId || !payload.nodes || typeof payload.nodes !== "object") {
    throw new Error("Invalid map shape");
  }
  if (!payload.nodes[payload.rootId]) throw new Error("Root node is missing");

  const nodes = {};
  for (const [id, node] of Object.entries(payload.nodes)) {
    if (!node || typeof node !== "object") throw new Error("Invalid node");
    nodes[id] = {
      id,
      title: String(node.title || "無題").slice(0, 64),
      note: String(node.note || "").slice(0, 420),
      parentId: node.parentId === null ? null : String(node.parentId || ""),
      children: Array.isArray(node.children) ? node.children.map(String) : [],
      collapsed: Boolean(node.collapsed),
      color: COLOR_VALUES[node.color] ? node.color : "teal",
    };
  }

  for (const node of Object.values(nodes)) {
    node.children = node.children.filter((childId) => nodes[childId] && nodes[childId].parentId === node.id);
    if (node.id === payload.rootId) node.parentId = null;
  }

  const reachableIds = collectReachableIds(String(payload.rootId), nodes);
  for (const nodeId of Object.keys(nodes)) {
    if (!reachableIds.has(nodeId)) delete nodes[nodeId];
  }
  const selectedId = nodes[payload.selectedId] ? String(payload.selectedId) : String(payload.rootId);

  return {
    version: 1,
    rootId: String(payload.rootId),
    selectedId,
    updatedAt: isValidDate(payload.updatedAt) ? payload.updatedAt : new Date().toISOString(),
    nodes,
  };
}

function collectReachableIds(rootId, nodes) {
  const seen = new Set();
  const visit = (nodeId) => {
    if (seen.has(nodeId) || !nodes[nodeId]) return;
    seen.add(nodeId);
    nodes[nodeId].children = nodes[nodeId].children.filter((childId) => !seen.has(childId));
    for (const childId of nodes[nodeId].children) visit(childId);
  };
  visit(rootId);
  return seen;
}

function renderAll() {
  renderMap();
  renderInspector();
  renderStats();
}

function renderMap() {
  els.mindmapTree.innerHTML = "";
  els.mindmapTree.appendChild(renderLevel([state.rootId]));
  updateActionButtons();
}

function renderLevel(nodeIds) {
  const level = document.createElement("ul");
  level.className = "tree-level";
  for (const nodeId of nodeIds) {
    const node = state.nodes[nodeId];
    if (!node) continue;
    const branch = document.createElement("li");
    branch.className = [
      "tree-branch",
      node.children.length ? "has-children" : "",
      node.collapsed ? "collapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    branch.appendChild(renderNodeCard(node));

    if (node.children.length && !node.collapsed) {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "children-wrap";
      childrenWrap.appendChild(renderLevel(node.children));
      branch.appendChild(childrenWrap);
    }
    level.appendChild(branch);
  }
  return level;
}

function renderNodeCard(node) {
  const card = document.createElement("button");
  card.type = "button";
  card.dataset.nodeId = node.id;
  card.className = [
    "node-card",
    node.id === state.rootId ? "root" : "",
    node.id === state.selectedId ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  card.style.setProperty("--node-color", COLOR_VALUES[node.color] || COLOR_VALUES.teal);
  card.setAttribute("role", "treeitem");
  card.setAttribute("aria-selected", String(node.id === state.selectedId));
  card.setAttribute("aria-expanded", node.children.length ? String(!node.collapsed) : "false");

  const title = document.createElement("strong");
  title.textContent = node.title || "無題";
  card.appendChild(title);

  const note = document.createElement("p");
  note.textContent = node.note ? trimText(node.note, 72) : "メモなし";
  if (!node.note) note.className = "empty-note";
  card.appendChild(note);

  const footer = document.createElement("footer");
  const childCount = document.createElement("span");
  childCount.className = "child-count";
  childCount.textContent = `${node.children.length} 枝`;
  const stateText = document.createElement("span");
  stateText.textContent = node.children.length && node.collapsed ? "折りたたみ中" : "表示中";
  footer.append(childCount, stateText);
  card.appendChild(footer);

  return card;
}

function renderInspector() {
  const node = getSelectedNode();
  els.nodeTitle.value = node.title;
  els.nodeNote.value = node.note;
  els.nodeMeta.textContent = buildNodeMeta(node);

  els.colorPicker.querySelectorAll("[data-color]").forEach((button) => {
    button.classList.toggle("active", button.dataset.color === node.color);
  });
  updateActionButtons();
}

function renderStats() {
  const allNodes = Object.values(state.nodes);
  els.nodeCount.textContent = String(allNodes.length);
  els.leafCount.textContent = String(allNodes.filter((node) => node.children.length === 0).length);
  els.depthCount.textContent = String(getMaxDepth(state.rootId));
  els.saveStatus.textContent = storageAvailable ? formatTime(state.updatedAt) : "保存不可";
}

function updateActionButtons() {
  const node = getSelectedNode();
  const isRoot = node.id === state.rootId;
  els.addSiblingBtn.disabled = isRoot;
  els.deleteBtn.disabled = isRoot;
  els.toggleCollapseBtn.disabled = node.children.length === 0;
  els.toggleCollapseBtn.textContent = node.collapsed ? "展開" : "折りたたみ";
}

function selectNode(nodeId) {
  if (!state.nodes[nodeId]) return;
  state.selectedId = nodeId;
  renderAll();
  saveMap();
}

function updateSelectedNode(patch) {
  const node = getSelectedNode();
  Object.assign(node, patch);
  renderMap();
  saveMap();
}

function addChild(parentId = state.selectedId) {
  const parent = state.nodes[parentId];
  if (!parent) return;
  const child = createNode(parent.id);
  parent.children.push(child.id);
  parent.collapsed = false;
  state.nodes[child.id] = child;
  state.selectedId = child.id;
  renderAll();
  saveMap();
  focusTitleInput();
}

function addSibling() {
  const selected = getSelectedNode();
  if (selected.id === state.rootId) {
    showToast("中心ノードには兄弟を追加できません。子ノードを追加してください。");
    return;
  }
  const parent = state.nodes[selected.parentId];
  if (!parent) return;
  const sibling = createNode(parent.id);
  const selectedIndex = parent.children.indexOf(selected.id);
  parent.children.splice(selectedIndex + 1, 0, sibling.id);
  state.nodes[sibling.id] = sibling;
  state.selectedId = sibling.id;
  renderAll();
  saveMap();
  focusTitleInput();
}

function toggleSelectedCollapse() {
  const node = getSelectedNode();
  if (!node.children.length) return;
  node.collapsed = !node.collapsed;
  renderAll();
  saveMap();
}

function deleteSelectedNode() {
  const node = getSelectedNode();
  if (node.id === state.rootId) {
    showToast("中心ノードは削除できません。");
    return;
  }

  const childTotal = countDescendants(node.id);
  if (childTotal > 0 && !window.confirm(`このノードと子ノード ${childTotal} 件を削除します。よろしいですか？`)) {
    return;
  }

  const parent = state.nodes[node.parentId];
  if (parent) parent.children = parent.children.filter((childId) => childId !== node.id);
  removeSubtree(node.id);
  state.selectedId = parent?.id || state.rootId;
  renderAll();
  saveMap();
}

function resetMap() {
  if (!window.confirm("現在のマインドマップを初期状態に戻します。よろしいですか？")) return;
  state = createDefaultMap();
  renderAll();
  saveMap();
  showToast("初期状態に戻しました。");
}

function exportMap() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mindmap-${new Date().toISOString()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importMap(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      state = normalizeMap(JSON.parse(String(reader.result)));
      renderAll();
      saveMap();
      showToast("JSONを読み込みました。");
    } catch {
      showToast("JSONの形式が正しくありません。");
    } finally {
      els.importInput.value = "";
    }
  });
  reader.readAsText(file);
}

function createNode(parentId) {
  return {
    id: createId(),
    title: "新しいアイデア",
    note: "",
    parentId,
    children: [],
    collapsed: false,
    color: nextColor(parentId),
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextColor(parentId) {
  const colors = Object.keys(COLOR_VALUES);
  const parent = state?.nodes?.[parentId];
  const index = parent ? parent.children.length % colors.length : 0;
  return colors[index];
}

function getSelectedNode() {
  return state.nodes[state.selectedId] || state.nodes[state.rootId];
}

function countDescendants(nodeId) {
  const node = state.nodes[nodeId];
  if (!node) return 0;
  return node.children.reduce((sum, childId) => sum + 1 + countDescendants(childId), 0);
}

function removeSubtree(nodeId) {
  const node = state.nodes[nodeId];
  if (!node) return;
  for (const childId of node.children) removeSubtree(childId);
  delete state.nodes[nodeId];
}

function getMaxDepth(nodeId, depth = 1) {
  const node = state.nodes[nodeId];
  if (!node || !node.children.length) return depth;
  return Math.max(...node.children.map((childId) => getMaxDepth(childId, depth + 1)));
}

function getVisibleNodeIds(nodeId = state.rootId, list = []) {
  const node = state.nodes[nodeId];
  if (!node) return list;
  list.push(node.id);
  if (!node.collapsed) {
    for (const childId of node.children) getVisibleNodeIds(childId, list);
  }
  return list;
}

function selectRelative(offset) {
  const visibleIds = getVisibleNodeIds();
  const currentIndex = visibleIds.indexOf(state.selectedId);
  const nextIndex = Math.max(0, Math.min(visibleIds.length - 1, currentIndex + offset));
  selectNode(visibleIds[nextIndex]);
}

function moveLeft() {
  const node = getSelectedNode();
  if (node.children.length && !node.collapsed) {
    node.collapsed = true;
    renderAll();
    saveMap();
    return;
  }
  if (node.parentId) selectNode(node.parentId);
}

function moveRight() {
  const node = getSelectedNode();
  if (node.children.length && node.collapsed) {
    node.collapsed = false;
    renderAll();
    saveMap();
    return;
  }
  if (node.children.length) selectNode(node.children[0]);
}

function buildNodeMeta(node) {
  const depth = getNodeDepth(node.id);
  const descendants = countDescendants(node.id);
  return `深さ ${depth} / 子ノード ${node.children.length} / 配下 ${descendants}`;
}

function getNodeDepth(nodeId) {
  let depth = 1;
  let current = state.nodes[nodeId];
  while (current?.parentId) {
    depth += 1;
    current = state.nodes[current.parentId];
  }
  return depth;
}

function focusTitleInput() {
  requestAnimationFrame(() => {
    els.nodeTitle.focus();
    els.nodeTitle.select();
  });
}

function trimText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatTime(value) {
  if (!value) return "未保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未保存";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toastTimer = window.setTimeout(() => toast.remove(), 2600);
}

init();
