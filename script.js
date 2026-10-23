/* StudyShelf — student resource library with local CRUD and IndexedDB file storage. */
(() => {
  "use strict";
  const KEYS = { resources: "studyshelf.resources.v1", subjects: "studyshelf.subjects.v1", theme: "studyshelf.theme.v1", layout: "studyshelf.layout.v1", readOnly: "studyshelf.readonly.v1" };
  const DB_NAME = "studyshelf-files", DB_VERSION = 1, FILE_STORE = "attachments";
  const DEFAULT_SUBJECTS = [
    { id: "branch-aids", name: "AIDS", color: "lavender" },
    { id: "branch-cse", name: "CSE (CS)", color: "sky" },
    { id: "branch-it", name: "IT", color: "peach" },
    { id: "branch-aiml", name: "AIML", color: "mint" },
    { id: "branch-mech", name: "MECH", color: "butter" },
    { id: "branch-civil", name: "CIVIL", color: "rose" },
    { id: "branch-ece", name: "ECE", color: "sky" },
    { id: "branch-eee", name: "EEE", color: "butter" },
    { id: "branch-general", name: "General", color: "lavender" }
  ];
  const LEGACY_BRANCH_MAP = { "sub-computing": "branch-cse", "sub-math": "branch-cse", "sub-design": "branch-aids", "sub-general": "branch-general" };
  const ago = days => new Date(Date.now() - days * 86400000).toISOString();
  const DEMO_RESOURCES = [
    { id: "demo-1", title: "Database Systems — Normalization", content: "Lecture reference · Review 1NF, 2NF, and 3NF before the lab. Add your PDF using Edit material.", subjectId: "branch-cse", type: "lecture", favorite: true, pinned: true, createdAt: ago(1), updatedAt: ago(1) },
    { id: "demo-2", title: "Assignment 02 — Linear Algebra", content: "Assignment · Due Friday. Remember to show each step for the eigenvalue problems.", subjectId: "branch-aiml", type: "assignment", favorite: false, pinned: true, createdAt: ago(2), updatedAt: ago(1) },
    { id: "demo-3", title: "HCI Usability Heuristics", content: "Reference · Ten usability heuristics with examples for the group project critique.", subjectId: "branch-aids", type: "reference", favorite: true, pinned: false, createdAt: ago(3), updatedAt: ago(3) },
    { id: "demo-4", title: "Computer Networks — Past Paper", content: "Past paper · Practice subnetting and short-answer questions before the midterm.", subjectId: "branch-it", type: "past-paper", favorite: false, pinned: false, createdAt: ago(5), updatedAt: ago(4) },
    { id: "demo-5", title: "Calculus: Integration Techniques", content: "Lecture notes · Keep this nearby while working through the tutorial problems.", subjectId: "branch-civil", type: "lecture", favorite: false, pinned: false, createdAt: ago(8), updatedAt: ago(7) },
    { id: "demo-6", title: "Design Thinking — Required Reading", content: "Reading · Notes from the article and discussion questions for next class.", subjectId: "branch-mech", type: "reading", favorite: true, pinned: false, createdAt: ago(12), updatedAt: ago(9) }
  ];
  const TYPES = { lecture: "Lecture notes", assignment: "Assignment", reference: "Reference PDF", "past-paper": "Past paper", reading: "Reading", other: "Other" };
  const COLORS = ["lavender", "peach", "mint", "butter", "sky", "rose"];
  const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
  const el = { grid: $("#notesGrid"), empty: $("#emptyState"), search: $("#searchInput"), filter: $("#categoryFilter"), sort: $("#sortSelect"), subjectNav: $("#categoryNav"), dialog: $("#noteDialog"), form: $("#noteForm"), id: $("#noteId"), title: $("#noteTitle"), content: $("#noteContent"), subject: $("#noteCategory"), type: $("#noteType"), file: $("#resourceFile"), fileHelp: $("#fileHelp"), previewDialog: $("#previewDialog"), previewFrame: $("#previewFrame"), previewMessage: $("#previewUnsupported"), previewTitle: $("#previewTitle"), previewFileName: $("#previewFileName"), downloadOriginal: $("#downloadOriginalBtn"), deleteDialog: $("#deleteDialog"), subjectDialog: $("#categoryDialog"), subjectForm: $("#categoryForm"), subjectName: $("#categoryName"), subjectColor: $("#categoryColor"), status: $("#saveStatus"), toast: $("#toast") };
  function load(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (error) { console.warn("Could not read browser storage", error); return fallback; } }
  let subjects = load(KEYS.subjects, DEFAULT_SUBJECTS.map(s => ({ ...s })));
  if (!Array.isArray(subjects) || !subjects.length) subjects = DEFAULT_SUBJECTS.map(s => ({ ...s }));
  // Replace the previous generic sample subjects with branch categories, while retaining custom ones.
  const oldDefaultIds = new Set(Object.keys(LEGACY_BRANCH_MAP));
  subjects = subjects.filter(s => !oldDefaultIds.has(s.id));
  for (const branch of DEFAULT_SUBJECTS) if (!subjects.some(s => s.id === branch.id)) subjects.push({ ...branch });
  let resources = load(KEYS.resources, DEMO_RESOURCES.map(r => ({ ...r })));
  if (!Array.isArray(resources)) resources = DEMO_RESOURCES.map(r => ({ ...r }));
  resources = resources.map(r => {
    const mappedBranch = LEGACY_BRANCH_MAP[r.subjectId] || r.subjectId;
    return { ...r, favorite: Boolean(r.favorite), pinned: Boolean(r.pinned), subjectId: subjects.some(s => s.id === mappedBranch) ? mappedBranch : subjects[0].id, type: TYPES[r.type] ? r.type : "other", fileName: r.fileName || "" };
  });
  let view = "all", selectedSubject = "all", layout = localStorage.getItem(KEYS.layout) || "grid", readOnly = localStorage.getItem(KEYS.readOnly) === "true", pendingDelete = null, dbPromise, saveTimer, toastTimer, autoSaveTimer, previewURL = null, previewBlob = null, previewName = "";

  function esc(text = "") { return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function subjectFor(id) { return subjects.find(s => s.id === id) || subjects[0]; }
  function openDB() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("Could not open file storage"));
    });
    return dbPromise;
  }
  async function storeFile(id, file) {
    const db = await openDB();
    await new Promise((resolve, reject) => { const tx = db.transaction(FILE_STORE, "readwrite"); tx.objectStore(FILE_STORE).put(file, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  async function getFile(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => { const req = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).get(id); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); });
  }
  async function eraseFile(id) {
    try { const db = await openDB(); await new Promise((resolve, reject) => { const tx = db.transaction(FILE_STORE, "readwrite"); tx.objectStore(FILE_STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch (error) { console.warn("Could not remove attachment", error); }
  }
  function save(showFeedback = true) {
    try {
      localStorage.setItem(KEYS.resources, JSON.stringify(resources)); localStorage.setItem(KEYS.subjects, JSON.stringify(subjects));
      if (showFeedback) { el.status.classList.add("saving"); el.status.classList.remove("error"); el.status.lastChild.textContent = " Saving…"; clearTimeout(saveTimer); saveTimer = setTimeout(() => { el.status.classList.remove("saving"); el.status.lastChild.textContent = " All changes saved"; }, 450); }
    } catch (error) { console.error("Could not save resource details", error); el.status.classList.remove("saving"); el.status.classList.add("error"); el.status.lastChild.textContent = " Storage unavailable"; toast("Could not save. Browser storage may be full."); }
  }
  function toast(message) { el.toast.textContent = message; el.toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2500); }
  function dateLabel(value) {
    const date = new Date(value); if (Number.isNaN(date.getTime())) return "Just now";
    const today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function updateStats() {
    const weekAgo = Date.now() - 7 * 86400000;
    $("#statTotal").textContent = resources.length; $("#statFavorites").textContent = resources.filter(r => r.favorite).length;
    $("#statPinned").textContent = resources.filter(r => r.pinned).length; $("#statWeek").textContent = resources.filter(r => new Date(r.createdAt).getTime() >= weekAgo).length;
    $("#allCount").textContent = resources.length;
  }
  function renderSubjects() {
    const chosen = el.filter.value || "all", editorChoice = el.subject.value;
    el.subjectNav.innerHTML = subjects.map(s => `<button class="category-item" type="button" data-category="${esc(s.id)}"><span class="category-dot" style="background:var(--cat-${esc(s.color)})"></span>${esc(s.name)}<span class="category-count">${resources.filter(r => r.subjectId === s.id).length}</span></button>`).join("");
    el.filter.innerHTML = `<option value="all">All branches</option>${subjects.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}`;
    el.filter.value = subjects.some(s => s.id === chosen) ? chosen : "all";
    el.subject.innerHTML = subjects.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    if (subjects.some(s => s.id === editorChoice)) el.subject.value = editorChoice;
  }
  function visibleResources() {
    const query = el.search.value.trim().toLocaleLowerCase();
    return resources.filter(resource => {
      const subject = subjectFor(resource.subjectId);
      const matches = !query || `${resource.title} ${resource.content} ${subject.name} ${resource.fileName} ${TYPES[resource.type]}`.toLocaleLowerCase().includes(query);
      return matches && (view === "all" || (view === "pinned" && resource.pinned) || (view === "favorites" && resource.favorite)) && (selectedSubject === "all" || resource.subjectId === selectedSubject);
    }).sort((a, b) => {
      if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
      if (el.sort.value === "title") return a.title.localeCompare(b.title);
      const key = el.sort.value === "created" ? "createdAt" : "updatedAt";
      return new Date(b[key]).getTime() - new Date(a[key]).getTime();
    });
  }
  function card(resource) {
    const subject = subjectFor(resource.subjectId);
    const color = COLORS.includes(subject.color) ? subject.color : "lavender";
    const fileInfo = resource.fileName ? `<button class="resource-file-name file-link" type="button" data-action="preview" title="Preview ${esc(resource.fileName)}">▤ ${esc(resource.fileName)} <span aria-hidden="true">↗</span></button>` : `<span class="resource-file-name no-file">No file attached yet</span>`;
    return `<article class="note-card color-${color}${resource.pinned ? " is-pinned" : ""}" data-note-id="${esc(resource.id)}">
      <div class="note-card-top"><span class="note-category-pill" title="${esc(subject.name)}">${esc(subject.name)}</span><div class="note-card-actions">
      <button class="note-action pin-action${resource.pinned ? " is-active" : ""}" type="button" data-action="pin" aria-label="${resource.pinned ? "Unpin" : "Pin"} ${esc(resource.title)}" aria-pressed="${resource.pinned}" title="${resource.pinned ? "Unpin material" : "Pin material"}">◆</button>
      <button class="note-action favorite-action${resource.favorite ? " is-active" : ""}" type="button" data-action="favorite" aria-label="${resource.favorite ? "Remove" : "Add"} ${esc(resource.title)} ${resource.favorite ? "from" : "to"} favorites" aria-pressed="${resource.favorite}" title="${resource.favorite ? "Remove from favorites" : "Add to favorites"}">${resource.favorite ? "♥" : "♡"}</button>
      <button class="note-action" type="button" data-action="preview" aria-label="View ${esc(resource.title)} file" title="View material">◉</button>
      <button class="note-action" type="button" data-action="delete" aria-label="Delete ${esc(resource.title)}" title="Delete material">×</button></div></div>
      <div class="resource-type">${esc(TYPES[resource.type] || "Other")}</div><h3>${esc(resource.title)}</h3><p class="note-excerpt">${esc(resource.content || "Study resource saved for later reference.")}</p>${fileInfo}
      <div class="note-card-footer"><span class="note-date" title="Updated ${esc(new Date(resource.updatedAt).toLocaleString())}">${dateLabel(resource.updatedAt)}</span><button class="note-edit-button" type="button" data-action="edit">Edit details <span aria-hidden="true">↗</span></button></div></article>`;
  }
  function render() {
    updateStats(); renderSubjects();
    const result = visibleResources(), names = { all: "All materials", pinned: "Pinned", favorites: "Favorites" }, subject = subjects.find(s => s.id === selectedSubject);
    $("#breadcrumbCurrent").textContent = subject?.name || names[view];
    $("#notesHeading").childNodes[0].textContent = `${subject?.name || names[view]} `;
    const active = []; if (view !== "all") active.push(names[view].toLocaleLowerCase()); if (subject) active.push(subject.name); if (el.search.value.trim()) active.push(`“${el.search.value.trim()}”`);
    $("#activeFilterRow").hidden = !active.length; $("#activeFilterText").textContent = active.length ? `Showing ${active.join(" · ")}` : "";
    $("#visibleCount").textContent = result.length; el.grid.classList.toggle("list-layout", layout === "list");
    $$(".view-button").forEach(button => { const on = button.dataset.layout === layout; button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); });
    el.grid.innerHTML = result.map(card).join(""); el.grid.hidden = !result.length; el.empty.hidden = Boolean(result.length);
    if (!resources.length) { $("#emptyTitle").textContent = "Your library starts here"; $("#emptyMessage").textContent = "Add a lecture PDF, an assignment, or a useful reference to start your study library."; }
    else { $("#emptyTitle").textContent = view === "pinned" ? "No pinned materials yet" : view === "favorites" ? "No favorites just yet" : "No materials found"; $("#emptyMessage").textContent = "Try adjusting your search or filters, or add a study material."; }
    $("#resultsFooter").hidden = !result.length; $("#resultsText").textContent = `Showing ${result.length} of ${resources.length} ${resources.length === 1 ? "material" : "materials"}`;
    $("#emptyCreateBtn").hidden = readOnly;
  }
  function openEditor(resource = null) {
    if (readOnly) { toast("Read-only mode is on. Turn it off to edit materials."); return; }
    clearTimeout(autoSaveTimer); el.form.reset(); el.id.value = resource?.id || ""; $("#dialogTitle").textContent = resource ? "Edit study material" : "New study material";
    el.title.value = resource?.title || ""; el.content.value = resource?.content || ""; el.subject.value = resource?.subjectId || subjects[0].id; el.type.value = resource?.type || "lecture"; el.file.value = "";
    el.fileHelp.textContent = resource?.fileName ? `Current file: ${resource.fileName}. Choose a replacement or keep this file.` : "Files stay in this browser on this device.";
    countChars(); el.dialog.showModal(); requestAnimationFrame(() => el.title.focus());
  }
  function countChars() { $("#charCount").textContent = `${el.content.value.length.toLocaleString()} / 3,000`; }
  async function upsert(auto = false) {
    if (readOnly) return false;
    const title = el.title.value.trim(); if (!title) { el.title.focus(); return false; }
    const id = el.id.value || (crypto.randomUUID ? crypto.randomUUID() : `material-${Date.now()}`);
    const old = resources.find(r => r.id === id), now = new Date().toISOString(), chosenFile = el.file.files?.[0];
    let fileName = old?.fileName || "";
    if (chosenFile) {
      try { await storeFile(id, chosenFile); fileName = chosenFile.name; }
      catch (error) { console.error("Could not store attachment", error); toast("Could not save this file. Try a smaller file or a different browser."); return false; }
    }
    const resource = { id, title, content: el.content.value, subjectId: el.subject.value, type: el.type.value, favorite: old?.favorite || false, pinned: old?.pinned || false, fileName, createdAt: old?.createdAt || now, updatedAt: now };
    resources = old ? resources.map(r => r.id === id ? resource : r) : [resource, ...resources]; el.id.value = id; save(!auto); render();
    if (chosenFile) { el.file.value = ""; el.fileHelp.textContent = `Attached: ${fileName}. Choose a replacement or keep this file.`; }
    if (!auto) toast(old ? "Study material updated" : "Study material added"); return true;
  }
  function scheduleAutoSave() { if (!el.title.value.trim()) return; clearTimeout(autoSaveTimer); autoSaveTimer = setTimeout(() => { upsert(true); }, 750); }
  function toggle(id, property) {
    if (readOnly) return;
    const resource = resources.find(r => r.id === id); if (!resource) return;
    resource[property] = !resource[property]; resource.updatedAt = new Date().toISOString(); save(); render();
    toast(property === "pinned" ? (resource.pinned ? "Material pinned" : "Material unpinned") : (resource.favorite ? "Added to favorites" : "Removed from favorites"));
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function openPreview(resource) {
    if (!resource.fileName) { toast("No file attached. Choose Edit details to add one."); return; }
    try {
      const file = await getFile(resource.id);
      if (!file) { toast("This attachment is missing. Edit the material to add the file again."); return; }
      previewBlob = file; previewName = resource.fileName;
      const ext = resource.fileName.split(".").pop().toLowerCase();
      const inferredTypes = { pdf: "application/pdf", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
      const type = file.type || inferredTypes[ext] || "application/octet-stream";
      const canPreview = type === "application/pdf" || type.startsWith("image/") || type === "text/plain";
      el.previewTitle.textContent = resource.title; el.previewFileName.textContent = resource.fileName;
      el.previewMessage.hidden = canPreview; el.previewFrame.hidden = !canPreview;
      if (previewURL) URL.revokeObjectURL(previewURL);
      previewURL = canPreview ? URL.createObjectURL(file.type ? file : new Blob([file], { type })) : null;
      el.previewFrame.removeAttribute("src");
      if (previewURL) el.previewFrame.src = previewURL;
      el.previewDialog.showModal();
    } catch (error) { console.error("Could not load attachment", error); toast("Could not open this attachment in the browser."); }
  }
  function closePreview() {
    el.previewFrame.removeAttribute("src");
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null; previewBlob = null; previewName = "";
  }
  async function removeResource(id) {
    if (readOnly) return;
    await eraseFile(id); resources = resources.filter(r => r.id !== id); save(); render();
    el.deleteDialog.close(); pendingDelete = null; toast("Study material deleted");
  }
  function addSubject(name, color) {
    if (readOnly) return false;
    const clean = name.trim(); if (!clean) return false;
    if (subjects.some(s => s.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) { toast("That subject already exists"); return false; }
    subjects.push({ id: crypto.randomUUID ? crypto.randomUUID() : `subject-${Date.now()}`, name: clean, color }); save(); render();
    selectedSubject = subjects[subjects.length - 1].id; el.filter.value = selectedSubject; render(); toast("Subject added"); return true;
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme; localStorage.setItem(KEYS.theme, theme); const dark = theme === "dark";
    $("#themeToggle").setAttribute("aria-pressed", String(dark)); $("#themeToggle").setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
    $("#themeToggle .theme-icon").textContent = dark ? "☀" : "☾"; $("#themeToggle span:nth-child(2)").textContent = dark ? "Light mode" : "Dark mode";
    $("meta[name=theme-color]").content = dark ? "#17171c" : "#f7f7f4";
  }
  function applyReadOnly(enabled) {
    readOnly = Boolean(enabled);
    document.documentElement.classList.toggle("readonly-mode", readOnly);
    localStorage.setItem(KEYS.readOnly, String(readOnly));
    const button = $("#readOnlyToggle");
    button.setAttribute("aria-pressed", String(readOnly));
    button.setAttribute("aria-label", `${readOnly ? "Disable" : "Enable"} read-only mode`);
    button.querySelector(".theme-icon").textContent = readOnly ? "◉" : "○";
    button.querySelector("span:nth-child(2)").textContent = readOnly ? "Read-only on" : "Read-only mode";
    $("#readOnlyBadge").hidden = !readOnly;
    $("#emptyCreateBtn").hidden = readOnly;
  }

  // Navigation and filters.
  $$(".nav-item").forEach(button => button.addEventListener("click", () => { view = button.dataset.view; selectedSubject = "all"; el.filter.value = "all"; $$(".nav-item").forEach(b => b.classList.toggle("active", b === button)); render(); $("#sidebar").classList.remove("is-open"); }));
  el.subjectNav.addEventListener("click", event => { const button = event.target.closest("[data-category]"); if (!button) return; view = "all"; selectedSubject = button.dataset.category; el.filter.value = selectedSubject; $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === "all")); render(); });
  el.filter.addEventListener("change", () => { selectedSubject = el.filter.value; if (selectedSubject !== "all") view = "all"; $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view)); render(); });
  el.search.addEventListener("input", render); el.sort.addEventListener("change", render);
  $("#clearFiltersBtn").addEventListener("click", () => { view = "all"; selectedSubject = "all"; el.search.value = ""; el.filter.value = "all"; $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === "all")); render(); });
  $$(".view-button").forEach(button => button.addEventListener("click", () => { layout = button.dataset.layout; localStorage.setItem(KEYS.layout, layout); render(); }));

  // Create, edit, autosave and delete resources; attached file data uses IndexedDB.
  ["#createNoteBtn", "#topCreateBtn", "#emptyCreateBtn"].forEach(selector => $(selector).addEventListener("click", () => openEditor()));
  el.grid.addEventListener("click", event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const resource = resources.find(r => r.id === button.closest("[data-note-id]")?.dataset.noteId); if (!resource) return;
    if (button.dataset.action === "pin") toggle(resource.id, "pinned");
    else if (button.dataset.action === "favorite") toggle(resource.id, "favorite");
    else if (button.dataset.action === "edit") openEditor(resource);
    else if (button.dataset.action === "preview") openPreview(resource);
    else if (button.dataset.action === "delete") { pendingDelete = resource.id; el.deleteDialog.showModal(); }
  });
  el.form.addEventListener("submit", async event => { event.preventDefault(); if (await upsert()) el.dialog.close(); });
  el.content.addEventListener("input", () => { countChars(); scheduleAutoSave(); }); el.title.addEventListener("input", scheduleAutoSave);
  el.subject.addEventListener("change", scheduleAutoSave); el.type.addEventListener("change", scheduleAutoSave);
  el.file.addEventListener("change", () => { const file = el.file.files?.[0]; if (file) { el.fileHelp.textContent = `Selected: ${file.name} (${formatBytes(file.size)}).`; scheduleAutoSave(); } });
  function formatBytes(size) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }
  $$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => el.dialog.close()));
  el.dialog.addEventListener("click", event => { if (event.target === el.dialog) el.dialog.close(); }); el.dialog.addEventListener("close", () => clearTimeout(autoSaveTimer));
  $$('[data-close-preview]').forEach(button => button.addEventListener("click", () => el.previewDialog.close()));
  el.previewDialog.addEventListener("click", event => { if (event.target === el.previewDialog) el.previewDialog.close(); });
  el.previewDialog.addEventListener("close", closePreview);
  el.downloadOriginal.addEventListener("click", () => { if (previewBlob) downloadBlob(previewBlob, previewName); });
  $("#confirmDeleteBtn").addEventListener("click", () => { if (pendingDelete) removeResource(pendingDelete); });
  $$('[data-close-delete]').forEach(button => button.addEventListener("click", () => el.deleteDialog.close()));

  // Subjects, appearance, responsive navigation and keyboard shortcuts.
  $("#addCategoryBtn").addEventListener("click", () => { el.subjectForm.reset(); el.subjectDialog.showModal(); requestAnimationFrame(() => el.subjectName.focus()); });
  el.subjectForm.addEventListener("submit", event => { event.preventDefault(); if (addSubject(el.subjectName.value, el.subjectColor.value)) el.subjectDialog.close(); });
  $$('[data-close-category]').forEach(button => button.addEventListener("click", () => el.subjectDialog.close()));
  $("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#readOnlyToggle").addEventListener("click", () => applyReadOnly(!readOnly));
  $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
  document.addEventListener("click", event => { if (innerWidth <= 760 && !event.target.closest("#sidebar") && !event.target.closest("#menuToggle")) $("#sidebar").classList.remove("is-open"); });
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); el.search.focus(); }
    if (!readOnly && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !el.dialog.open && !el.subjectDialog.open) { event.preventDefault(); openEditor(); }
    if (event.key === "Escape" && $("#sidebar").classList.contains("is-open")) $("#sidebar").classList.remove("is-open");
  });

  const savedTheme = localStorage.getItem(KEYS.theme);
  applyTheme(savedTheme || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  applyReadOnly(readOnly);
  $("#todayLabel").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  render();
})();
