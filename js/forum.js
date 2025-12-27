// js/forum.js (module) — Forum + Threads/Replies + Edit/Delete + Logout toggle + User Profiles + Profile Pictures
// - Shows avatar next to username on posts/replies
// - Hides avatar when displayName is "Anonymous"
// - Auth + Profile messages are inline (no alert popups for those)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// NOTE: Firebase Storage requires billing on many projects.
// This file uses Cloudinary for profile photo uploads instead.

// -------------------------------
// Firebase config (yours)
// -------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyB6VV5G6wRHc00Offwrql47nhRfK6mChwU",
  authDomain: "kino-forum-1980.firebaseapp.com",
  projectId: "kino-forum-1980",
  storageBucket: "kino-forum-1980.firebasestorage.app",
  messagingSenderId: "787404143040",
  appId: "1:787404143040:web:ed78b42eaf3a27ddce3025"
};

// -------------------------------
// Init
// -------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// -------------------------------
// Constants
// -------------------------------
const ANONYMOUS_NAME = "Anonymous";


const ROLE_ADMIN = "admin";
const ROLE_MODERATOR = "moderator";

// -------------------------------
// DOM helpers
// -------------------------------
const el = (id) => document.getElementById(id);
const safeText = (s) => (s ?? "").toString();
const show = (node) => node?.classList.remove("hidden");
const hide = (node) => node?.classList.add("hidden");

// -------------------------------
// UI refs
// -------------------------------
// Auth UI
const authBox = el("auth-box");
const userStatus = el("user-status");
const logoutBtn = el("logout-btn");

// Login inputs
const usernameInput = el("username"); // optional
const emailInput = el("email");
const passwordInput = el("password");

// Inline auth error (red text inside the form)
const authError = el("auth-error");
function setAuthError(msg) {
  if (!authError) return;
  authError.textContent = msg || "";
  if (msg) authError.classList.remove("hidden");
  else authError.classList.add("hidden");
}
function clearAuthError() { setAuthError(""); }

function friendlyAuthError(e) {
  const code = e?.code || "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Incorrect email or password.";
  }
  if (code === "auth/invalid-email") return "Please enter a valid email address.";
  if (code === "auth/missing-password") return "Please enter a password.";
  if (code === "auth/weak-password") return "Password is too weak (use at least 6 characters).";
  if (code === "auth/email-already-in-use") return "That email is already registered. Try logging in.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please try again later.";
  if (code === "auth/invalid-login-credentials") return "Incorrect password or email. Please try again.";
  return e?.message ? `Error: ${e.message}` : "Something went wrong. Please try again.";
}

// Escape HTML and keep line breaks for display (for updates, etc.)
const escapeHtml = (str) =>
  (str ?? "").toString().replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));

function formatMultilineText(text) {
  const escaped = escapeHtml(text || "");
  // Normalize Windows line endings then convert \n to <br>
  return escaped.replace(/\r\n/g, "\n").split("\n").join("<br>");
}

// -------------------------------
// Cloudinary config (shared)
// -------------------------------
const CLOUDINARY_CLOUD_NAME = "ddxdtdbxh";
const CLOUDINARY_UPLOAD_PRESET = "kino-forum"; // same one you use for profile photos

// Thread create UI
const threadCreate = el("thread-create");
const threadTitle = el("thread-title");
const threadBody = el("thread-body");
const threadTagBtn = el("thread-tag-btn");
const threadAttachBtn = el("thread-attach-btn");
const threadAttachmentsInput = el("thread-attachments");
const threadAttachmentsSummary = el("thread-attachments-summary");
const threadAttachmentPreview = el("thread-attachment-preview");

// Thread list UI
const threadListBox = el("thread-list");
const threadsDiv = el("threads");
const threadSearchInput = el("thread-search");
const tagFilterBtn = el("tag-filter-btn");

// Thread view UI
const threadView = el("thread-view");
const viewTitle = el("view-title");
const viewBody = el("view-body");
const viewAuthor = el("view-author");
const viewTime = el("view-time");
const viewActions = el("view-actions");
const viewAuthorAvatar = el("view-author-avatar");
const viewAttachments = el("view-attachments");

// Replies UI
const repliesDiv = el("replies");
const replyBox = el("reply-box");
const replyText = el("reply-text");


// Profile UI (in the modal)
const profileBox = el("profile-box");
const profileImg = el("profile-img");
const profilePhotoInput = el("profile-photo");
const profileNameInput = el("profile-name");
const profileBioInput = el("profile-bio");

const openProfileBtn = el("open-profile-btn");
const profileModal = el("profile-modal");

// Inline profile messages
const profileError = el("profile-error");
const profileSuccess = el("profile-success");


// -------------------------------
// Site updates (admin news)
// -------------------------------
const updatesCreate = el("updates-create");
const updateBody = el("update-body");
const postUpdateBtn = el("post-update-btn");
const updatesList = el("updates-list");

let unsubUpdates = null;

// Moderation UI
const modToolsBtn = el("mod-tools-btn");
const modModal = el("mod-modal");
const modLogList = el("mod-log-list");

const threadError = el("thread-error");

function setThreadError(msg) {
  if (!threadError) return;
  threadError.textContent = msg || "";
  threadError.hidden = !msg;
}

function updateAdminUI() {
  if (updatesCreate) {
    if (isAdminRole()) show(updatesCreate);
    else hide(updatesCreate);
  }
}


function startUpdatesListener() {
  if (!updatesList) return;

  const q = query(
    collection(db, "site_updates"),
    orderBy("created", "desc")
  );

  unsubUpdates?.();
  unsubUpdates = onSnapshot(q, (snap) => {
    updatesList.innerHTML = "";

    if (snap.empty) {
      updatesList.innerHTML =
        `<p class="post-text" style="opacity:.6">No updates yet.</p>`;
      return;
    }

    snap.forEach((d) => {
      const data = d.data();

      const div = document.createElement("div");
      div.className = "forum-post";

const bodyHtml = formatMultilineText(data.body || "");

div.innerHTML = `
  <div class="post-header">
    <span class="post-author">${data.author || "Admin"}</span>
    <span class="post-time">${formatTimestamp(data.created)}</span>
  </div>
  <div class="post-text">${bodyHtml}</div>
`;


      // Admin delete button
      if (isAdminRole()) {
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.onclick = () =>
          deleteDoc(doc(db, "site_updates", d.id));
        div.appendChild(del);
      }

      updatesList.appendChild(div);
    });
  });
}

postUpdateBtn?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || !isAdminRole()) return;

  const body = safeText(updateBody.value).trim();
  if (!body) return;

  const author = await getUsernameForUser(user);

  await addDoc(collection(db, "site_updates"), {
    body,
    author,
    uid: user.uid,
    created: serverTimestamp()
  });

  updateBody.value = "";
});

// Generic image upload for profile pictures
async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    let msg = "Profile image upload failed.";
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {
      try {
        msg = (await res.text()) || msg;
      } catch {}
    }
    console.error("Cloudinary profile upload error:", msg);
    throw new Error(msg);
  }

  const data = await res.json();
  return data.secure_url; // this is what your profile code expects
}


// Current attachments selected for the new thread (max 5)
let selectedAttachmentFiles = [];
const MAX_ATTACHMENTS = 5;

function getAttachmentLimitInfo(file) {
  let maxMB = 20; // default for static images / other small files
  let label = "20MB";

  const type = file.type || "";

  if (type === "image/gif") {
    maxMB = 50;
    label = "50MB (GIF)";
  } else if (type.startsWith("video/") || type.startsWith("audio/")) {
    maxMB = 50;
    label = "50MB (video/audio)";
  }

  return {
    maxMB,
    maxBytes: maxMB * 1024 * 1024,
    label
  };
}


function rebuildAttachmentInputFromSelected() {
  if (!threadAttachmentsInput) return;

  const dt = new DataTransfer();
  selectedAttachmentFiles.forEach((file) => dt.items.add(file));
  threadAttachmentsInput.files = dt.files;
}

function refreshAttachmentUI() {
  // 1) sync input.files
  rebuildAttachmentInputFromSelected();

  // 2) summary text
  if (threadAttachmentsSummary) {
    if (!selectedAttachmentFiles.length) {
      threadAttachmentsSummary.textContent = "";
    } else if (selectedAttachmentFiles.length === 1) {
      threadAttachmentsSummary.textContent = selectedAttachmentFiles[0].name;
    } else {
      threadAttachmentsSummary.textContent =
        `${selectedAttachmentFiles.length} files selected (max ${MAX_ATTACHMENTS})`;
    }
  }

  // 3) preview
  if (!threadAttachmentPreview) return;
  threadAttachmentPreview.innerHTML = "";

  selectedAttachmentFiles.forEach((file, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "thread-attachment-preview-item";

    let content;

    if (file.type.startsWith("image/")) {
      // image preview
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.alt = "";
      content = img;
    } else if (file.type.startsWith("video/")) {
      // video preview (muted autoplay loop)
      const vid = document.createElement("video");
      vid.src = URL.createObjectURL(file);
      vid.muted = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.autoplay = true;
      vid.controls = false; // keep clean in the small preview
      content = vid;
    } else {
      // audio / other – keep as text name
      const span = document.createElement("span");
      span.className = "attachments-summary";
      span.textContent = file.name;
      content = span;
    }

    // attach the media / label
    wrapper.appendChild(content);

    // remove (X) button
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "thread-attachment-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedAttachmentFiles.splice(index, 1);
      refreshAttachmentUI();
    });

    wrapper.appendChild(removeBtn);
    threadAttachmentPreview.appendChild(wrapper);
  });
}

// --- Attachments: open picker + live preview ---

if (threadAttachBtn && threadAttachmentsInput) {
  threadAttachBtn.addEventListener("click", () => {
    threadAttachmentsInput.click(); // opens native file picker
  });
}

if (threadAttachmentsInput) {
  threadAttachmentsInput.addEventListener("change", () => {
    setThreadError(""); // clear any previous error

    const newlyChosen = Array.from(threadAttachmentsInput.files || []);

    newlyChosen.forEach((file) => {
      // size check BEFORE adding
      const { maxBytes, maxMB, label } = getAttachmentLimitInfo(file);
      if (file.size > maxBytes) {
        setThreadError(
          `"${file.name}" exceeds size limit (${maxMB}MB).`
        );
        return; // skip this file
      }

      // merge new files into selectedAttachmentFiles, avoid duplicates
      const isDuplicate = selectedAttachmentFiles.some(
        (f) =>
          f.name === file.name &&
          f.size === file.size &&
          f.lastModified === file.lastModified
      );
      if (!isDuplicate) {
        selectedAttachmentFiles.push(file);
      }
    });

    // enforce max 5
    if (selectedAttachmentFiles.length > MAX_ATTACHMENTS) {
      selectedAttachmentFiles = selectedAttachmentFiles.slice(0, MAX_ATTACHMENTS);
    }

    // update input, summary, and preview (with delete buttons)
    refreshAttachmentUI();
  });
}

function showProfileError(msg) {
  if (!profileError) return;
  profileError.textContent = msg || "";
  profileError.hidden = !msg;
  if (profileSuccess) profileSuccess.hidden = true;
}
function showProfileSuccess(msg) {
  if (!profileSuccess) return;
  profileSuccess.textContent = msg || "";
  profileSuccess.hidden = !msg;
  if (profileError) profileError.hidden = true;
}

// -------------------------------
// Tag button + search wiring
// -------------------------------
if (threadTagBtn) {
  threadTagBtn.addEventListener("click", () => {
    showTagSelector({
      title: "Select tags for this thread",
      initialSet: currentCreateTags,
      onApply: (set) => {
        currentCreateTags = set;
        updateThreadTagButtonLabel();
      }
    });
  });
}

if (tagFilterBtn) {
  tagFilterBtn.addEventListener("click", () => {
    showTagSelector({
      title: "Filter by tags",
      initialSet: activeFilterTags,
      onApply: (set) => {
        activeFilterTags = set;
        updateTagFilterButtonLabel();
        renderThreads(); // re-filter the list
      }
    });
  });
}

if (threadSearchInput) {
  threadSearchInput.addEventListener("input", () => {
    currentSearchText = threadSearchInput.value || "";
    renderThreads();
  });
}

// -------------------------------
// Dialog modal (confirm / edit / timeout picker)
// -------------------------------
let dialogModal = null;
let dialogTitleEl = null;
let dialogContentEl = null;
let dialogButtonsEl = null;

function ensureDialogModal() {
  if (dialogModal) return;

  dialogModal = document.createElement("div");
  dialogModal.id = "dialog-modal";
  dialogModal.className = "modal-overlay hidden";
  dialogModal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="dialog-title"></h3>
        <button type="button" id="dialog-close-btn">✕</button>
      </div>
      <div id="dialog-content" class="forum-box" style="margin-bottom:10px;"></div>
      <div id="dialog-buttons" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;"></div>
    </div>
  `;
  document.body.appendChild(dialogModal);

  dialogTitleEl = dialogModal.querySelector("#dialog-title");
  dialogContentEl = dialogModal.querySelector("#dialog-content");
  dialogButtonsEl = dialogModal.querySelector("#dialog-buttons");

  const closeBtn = dialogModal.querySelector("#dialog-close-btn");
  closeBtn.onclick = closeDialogModal;

  // NEW: close when clicking on the backdrop
  dialogModal.addEventListener("click", (event) => {
    if (event.target === dialogModal) {
      closeDialogModal();
    }
  });
}

function openDialogModal() {
  ensureDialogModal();
  show(dialogModal);
  document.body.style.overflow = "hidden";
}

function closeDialogModal() {
  if (!dialogModal) return;
  hide(dialogModal);
  document.body.style.overflow = "";
}

// Simple yes/no confirm dialog
function showConfirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm }) {
  ensureDialogModal();

  dialogTitleEl.textContent = title || "Confirm";
  dialogContentEl.innerHTML = `<p>${message}</p>`;
  dialogButtonsEl.innerHTML = "";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = cancelLabel;
  cancelBtn.onclick = () => {
    closeDialogModal();
  };

  const okBtn = document.createElement("button");
  okBtn.textContent = confirmLabel;
  okBtn.onclick = () => {
    closeDialogModal();
    if (typeof onConfirm === "function") onConfirm();
  };

  dialogButtonsEl.appendChild(cancelBtn);
  dialogButtonsEl.appendChild(okBtn);

  openDialogModal();
}

// Timeout duration picker dialog

// Text edit dialog (used for replies)
function showEditReplyDialog(initialText, onSave) {
  ensureDialogModal();

  dialogTitleEl.textContent = "Edit reply";
  dialogContentEl.innerHTML = "";

  const textarea = document.createElement("textarea");
  textarea.style.width = "100%";
  textarea.style.minHeight = "120px";
  textarea.value = initialText || "";
  dialogContentEl.appendChild(textarea);

  dialogButtonsEl.innerHTML = "";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    closeDialogModal();
  };

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.onclick = () => {
    const newText = textarea.value.trim();
    if (!newText) {
      alert("Reply cannot be empty.");
      return;
    }
    closeDialogModal();
    if (typeof onSave === "function") onSave(newText);
  };

  dialogButtonsEl.appendChild(cancelBtn);
  dialogButtonsEl.appendChild(saveBtn);

  openDialogModal();
}

// Thread edit dialog (title + body)
function showEditThreadDialog(initialTitle, initialBody, onSave) {
  ensureDialogModal();

  dialogTitleEl.textContent = "Edit thread";
  dialogContentEl.innerHTML = "";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Title";
  titleInput.style.width = "100%";
  titleInput.style.marginBottom = "8px";
  titleInput.value = initialTitle || "";

  const bodyTextarea = document.createElement("textarea");
  bodyTextarea.style.width = "100%";
  bodyTextarea.style.minHeight = "140px";
  bodyTextarea.value = initialBody || "";

  dialogContentEl.appendChild(titleInput);
  dialogContentEl.appendChild(bodyTextarea);

  dialogButtonsEl.innerHTML = "";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    closeDialogModal();
  };

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.onclick = () => {
    const newTitle = titleInput.value.trim();
    const newBody = bodyTextarea.value.trim();
    if (!newBody) {
      alert("Body cannot be empty.");
      return;
    }
    closeDialogModal();
    if (typeof onSave === "function") {
      onSave({
        title: newTitle || "(no title)",
        body: newBody
      });
    }
  };

  dialogButtonsEl.appendChild(cancelBtn);
  dialogButtonsEl.appendChild(saveBtn);

  openDialogModal();
}

// Generic tag selector (used for create + filter)
function showTagSelector({ title, initialSet, onApply }) {
  ensureDialogModal();

  dialogTitleEl.textContent = title || "Select tags";
  dialogContentEl.innerHTML = "";
  dialogButtonsEl.innerHTML = "";

  const selected = new Set(initialSet ? Array.from(initialSet) : []);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexWrap = "wrap";
  list.style.gap = "8px";

  AVAILABLE_TAGS.forEach((tag) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tag;
    btn.classList.add("tag-pill-btn");
    if (selected.has(tag)) btn.classList.add("is-selected");

    btn.onclick = () => {
      if (selected.has(tag)) {
        selected.delete(tag);
      } else {
        selected.add(tag);
      }
      btn.classList.toggle("is-selected");
    };

    list.appendChild(btn);
  });

  dialogContentEl.appendChild(list);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    closeDialogModal();
  };

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.onclick = () => {
    if (typeof onApply === "function") {
      onApply(selected);
    }
    closeDialogModal();
  };

  dialogButtonsEl.appendChild(cancelBtn);
  dialogButtonsEl.appendChild(applyBtn);

  openDialogModal();
}

function updateThreadTagButtonLabel() {
  if (!threadTagBtn) return;
  const count = currentCreateTags.size;
  threadTagBtn.textContent = count ? `Tags (${count})` : "Tags";
}

function updateTagFilterButtonLabel() {
  if (!tagFilterBtn) return;
  if (!activeFilterTags.size) {
    tagFilterBtn.textContent = "Tags";
  } else {
    tagFilterBtn.textContent = "Tags: " + Array.from(activeFilterTags).join(", ");
  }
}

// -------------------------------
// Tagging + search constants
// -------------------------------
const AVAILABLE_TAGS = [
  "Question",
  "Art",
  "Meme",
  "Site Recommendation",
  "Other"
];

// In-memory state for tags + search
let currentCreateTags = new Set();     // tags for the thread being created
let activeFilterTags = new Set();      // tags used for filtering the list
let currentSearchText = "";            // text search
let allThreads = [];                   // [{ id, data }]


// -------------------------------
// State / listeners
// -------------------------------
let currentThreadId = null;
let unsubThreads = null;
let unsubThreadDoc = null;
let unsubReplies = null;
let currentUserRole = null;         // "admin" | "moderator" | null
let currentUserIsBanned = false;
let currentUserMutedUntil = null;   // Firestore Timestamp or null
let unsubModerationLogs = null;

function isAdminRole() {
  return currentUserRole === ROLE_ADMIN;
}

function isModeratorRole() {
  return currentUserRole === ROLE_ADMIN || currentUserRole === ROLE_MODERATOR;
}

function userCanModerate() {
  return isModeratorRole();
}

function isCurrentlyMuted() {
  if (!currentUserMutedUntil) return false;
  try {
    const ts = currentUserMutedUntil;
    const ms = typeof ts.toMillis === "function"
      ? ts.toMillis()
      : new Date(ts).getTime();
    return ms > Date.now();
  } catch {
    return false;
  }
}

function formatMuteUntil(ts) {
  if (!ts) return "";
  try {
    const date = typeof ts.toDate === "function"
      ? ts.toDate()
      : new Date(ts);
    return date.toLocaleString();
  } catch {
    return "";
  }
}

// -------------------------------
// Time formatting
// -------------------------------
function formatTimestamp(ts) {
  try {
    const d =
      ts?.toDate?.() instanceof Date
        ? ts.toDate()
        : ts instanceof Date
          ? ts
          : null;
    if (!d) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

// -------------------------------
// Name + anonymity helpers
// -------------------------------
function isAnonymousName(name) {
  return safeText(name).trim() === ANONYMOUS_NAME;
}

async function ensureAnonymousProfile(user) {
  if (!user) return;
  if (!user.displayName) {
    try {
      await updateProfile(user, { displayName: ANONYMOUS_NAME });
    } catch (e) {
      console.warn("Could not set displayName:", e);
    }
  }
}

async function getUsernameForUser(user) {
  if (!user) return ANONYMOUS_NAME;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const u = snap.exists() ? (snap.data()?.username ?? snap.data()?.displayName) : null;
    if (u && safeText(u).trim()) return safeText(u).trim();
  } catch {
    // ignore
  }

  return user.displayName?.trim() || ANONYMOUS_NAME;
}

// -------------------------------
// Public profile cache (hydrate names/avatars on posts)
// -------------------------------
const profileCache = new Map();

async function getPublicProfile(uid) {
  if (!uid) return null;
  if (profileCache.has(uid)) return profileCache.get(uid);

  const promise = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const data = snap.exists() ? snap.data() : {};
      const displayName =
        safeText(data.displayName).trim() ||
        safeText(data.username).trim() ||
        ANONYMOUS_NAME;

      const photoURL = safeText(data.photoURL).trim() || "";
      return { displayName, photoURL };
    } catch (e) {
      console.warn("Profile fetch failed:", e);
      return null;
    }
  })();

  profileCache.set(uid, promise);
  return promise;
}

// Hydrate an EXISTING header that already has a ".post-author" span inside ".author-with-avatar"
async function hydrateHeaderFromUid(headerEl, authorSpanEl, uid) {
  const p = await getPublicProfile(uid);
  if (!p) return;

  const name = p.displayName || ANONYMOUS_NAME;
  if (authorSpanEl) authorSpanEl.textContent = name;

  const left = headerEl?.querySelector?.(".author-with-avatar");
  if (!left) return;

  // Remove existing avatar if any
  const existing = left.querySelector?.("img.post-avatar");
  if (existing) existing.remove();

  if (p.photoURL && !isAnonymousName(name)) {
    const img = document.createElement("img");
    img.src = p.photoURL;
    img.alt = "avatar";
    img.className = "post-avatar";
    left.insertBefore(img, left.firstChild);
  }
}

async function hydrateThreadAuthor(uid) {
  const p = await getPublicProfile(uid);
  if (!p) return;

  const name = p.displayName || ANONYMOUS_NAME;
  if (viewAuthor) viewAuthor.textContent = name;

  if (viewAuthorAvatar) {
    if (p.photoURL && !isAnonymousName(name)) {
      viewAuthorAvatar.src = p.photoURL;
      viewAuthorAvatar.classList.remove("hidden");
    } else {
      viewAuthorAvatar.src = "";
      viewAuthorAvatar.classList.add("hidden");
    }
  }
}

// -------------------------------
// Profile: load/save
// -------------------------------
async function loadProfile(uid) {
  if (!profileBox) return;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : {};

    const displayName =
      safeText(data.displayName).trim() ||
      safeText(data.username).trim() ||
      safeText(auth.currentUser?.displayName).trim() ||
      ANONYMOUS_NAME;

    if (profileNameInput) profileNameInput.value = displayName === ANONYMOUS_NAME ? "" : displayName;
    if (profileBioInput) profileBioInput.value = data.bio || "";

    const photoURL = data.photoURL || auth.currentUser?.photoURL || "";
    if (profileImg) {
      if (isAnonymousName(displayName)) {
        profileImg.src = "";
        profileImg.style.display = "none";
      } else {
        profileImg.style.display = "";
        profileImg.src = photoURL || "";
      }
    }
  } catch (e) {
    console.error("Load profile failed:", e);
  }
}

// Modal open/close
window.openProfileModal = async function () {
  const user = auth.currentUser;
  if (!user) {
    setAuthError("Please log in to edit your profile.");
    return;
  }
  showProfileError("");
  showProfileSuccess("");
  show(profileModal);
  document.body.style.overflow = "hidden";
  await loadProfile(user.uid);
};

window.closeProfileModal = function () {
  hide(profileModal);
  document.body.style.overflow = "";
};

window.closeProfileModalOnBackdrop = function (event) {
  if (event.target === profileModal) window.closeProfileModal();
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && profileModal && !profileModal.classList.contains("hidden")) {
    window.closeProfileModal();
  }
});

// Save profile (inline messages)
window.saveProfile = async function () {
  const user = auth.currentUser;
  if (!user) return showProfileError("You must be logged in.");

  const desiredName = safeText(profileNameInput?.value).trim();
  const displayName = desiredName || ANONYMOUS_NAME;
  const bio = safeText(profileBioInput?.value).trim();
  const file = profilePhotoInput?.files?.[0];

  try {
    // validate file if provided
    if (file) {
      if (!file.type.startsWith("image/")) throw new Error("Please select a valid image file.");
      if (file.size > 2 * 1024 * 1024) throw new Error("Image size must be under 2MB.");
    }

    let photoURL = user.photoURL || null;

    if (file) {
      photoURL = await uploadToCloudinary(file);
      await updateProfile(user, { photoURL });
    }

    await updateProfile(user, { displayName });

    await setDoc(
      doc(db, "users", user.uid),
      {
        displayName,
        username: displayName,
        bio,
        photoURL,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    if (profilePhotoInput) profilePhotoInput.value = "";
    showProfileSuccess("Profile saved successfully.");
    await loadProfile(user.uid);
  } catch (err) {
    console.error(err);
    showProfileError(err?.message || "Failed to save profile.");
  }
};

// Keep the button, but make it use the same inline flow (no alerts)
window.uploadProfilePhoto = async function () {
  showProfileError("");
  showProfileSuccess("");
  const user = auth.currentUser;
  if (!user) return showProfileError("You must be logged in.");

  const file = profilePhotoInput?.files?.[0];
  if (!file) return showProfileError("Choose an image first.");
  if (!file.type.startsWith("image/")) return showProfileError("Please upload an image file.");

  const MAX_MB = 2;
  if (file.size > MAX_MB * 1024 * 1024) return showProfileError(`Image too large (max ${MAX_MB}MB).`);

  try {
    const photoURL = await uploadToCloudinary(file);
    await updateProfile(user, { photoURL });

    await setDoc(
      doc(db, "users", user.uid),
      { photoURL, updatedAt: serverTimestamp() },
      { merge: true }
    );

    if (profilePhotoInput) profilePhotoInput.value = "";
    await loadProfile(user.uid);
    showProfileSuccess("Photo updated!");
  } catch (e) {
    console.error("Upload failed:", e);
    showProfileError("Upload failed: " + (e?.message ?? e));
  }
};

window.openModerationModal = function () {
  if (!isModeratorRole()) return;
  if (!modModal) return;
  show(modModal);
  document.body.style.overflow = "hidden";
};

window.closeModerationModal = function () {
  if (!modModal) return;
  hide(modModal);
  document.body.style.overflow = "";
};

async function uploadThreadAttachment(file) {
  const CLOUD_NAME = "ddxdtdbxh";
  const UPLOAD_PRESET = "kino-forum"; // same preset you use for profiles

  // Decide resource type based on MIME type
  let resourceType = "image"; // default
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    resourceType = "video";   // Cloudinary treats audio via video pipeline
  } else if (!file.type.startsWith("image/")) {
    resourceType = "raw";
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: "POST", body: formData });
  if (!res.ok) {
    let msg = "Attachment upload failed.";
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {
      try {
        msg = (await res.text()) || msg;
      } catch {}
    }
    console.error("Cloudinary attachment upload error:", msg);
    throw new Error(msg);
  }

  const data = await res.json();

  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type,   // "image", "video", "raw", ...
    format: data.format,
    bytes: data.bytes,
    originalFilename: data.original_filename
  };
}

async function timeoutUser(targetUid, minutes, extra = {}) {
  const user = auth.currentUser;
  if (!user || !isModeratorRole()) return;
  const until = new Date(Date.now() + minutes * 60 * 1000);

  try {
    await setDoc(
      doc(db, "users", targetUid),
      { mutedUntil: until },
      { merge: true }
    );
    await logModeration("timeout", { targetUid, minutes, mutedUntil: until, ...extra });
  } catch (e) {
    console.error("Timeout failed:", e);
  }
}

async function uploadAttachmentToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    console.error("Cloudinary upload failed", await res.text());
    throw new Error("Cloudinary upload failed");
  }

  const data = await res.json();

  // This object will be stored in Firestore
  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type, // "image", "video", "raw", etc.
    format: data.format,
    bytes: data.bytes
  };
}


// ---------- Timeout duration dialog ----------
let timeoutDialogModal = null;
let timeoutDialogContent = null;
let timeoutDialogButtons = null;

function ensureTimeoutDialog() {
  if (timeoutDialogModal) return;

  timeoutDialogModal = document.createElement("div");
  timeoutDialogModal.id = "timeout-dialog-modal";
  timeoutDialogModal.className = "modal-overlay hidden";
  timeoutDialogModal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>Select timeout duration</h3>
        <button type="button" id="timeout-dialog-close">✕</button>
      </div>
      <div id="timeout-dialog-content" class="forum-box" style="margin-bottom:10px;"></div>
      <div id="timeout-dialog-buttons" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;"></div>
    </div>
  `;
  document.body.appendChild(timeoutDialogModal);

  timeoutDialogContent = timeoutDialogModal.querySelector("#timeout-dialog-content");
  timeoutDialogButtons = timeoutDialogModal.querySelector("#timeout-dialog-buttons");
  const closeBtn = timeoutDialogModal.querySelector("#timeout-dialog-close");
  closeBtn.onclick = closeTimeoutDialog;

  // NEW: close when clicking on the backdrop
  timeoutDialogModal.addEventListener("click", (event) => {
    if (event.target === timeoutDialogModal) {
      closeTimeoutDialog();
    }
  });
}

function openTimeoutDialog() {
  ensureTimeoutDialog();
  show(timeoutDialogModal);
  document.body.style.overflow = "hidden";
}

function closeTimeoutDialog() {
  if (!timeoutDialogModal) return;
  hide(timeoutDialogModal);
  document.body.style.overflow = "";
}

// Call this to show clickable options and get selection
function showTimeoutDialog(onSelect) {
  ensureTimeoutDialog();

  const options = [
    { label: "30 minutes", minutes: 30 },
    { label: "1 hour", minutes: 60 },
    { label: "12 hours", minutes: 12 * 60 },
    { label: "24 hours", minutes: 24 * 60 },
    { label: "2 days", minutes: 2 * 24 * 60 },
    { label: "7 days", minutes: 7 * 24 * 60 },
    { label: "14 days", minutes: 14 * 24 * 60 },
    { label: "30 days", minutes: 30 * 24 * 60 }
  ];

  timeoutDialogContent.innerHTML = "";
  timeoutDialogButtons.innerHTML = "";

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexWrap = "wrap";
  list.style.gap = "8px";

  options.forEach((opt) => {
    const b = document.createElement("button");
    b.textContent = opt.label;
    b.onclick = () => {
      closeTimeoutDialog();
      if (typeof onSelect === "function") {
        onSelect(opt);
      }
    };
    list.appendChild(b);
  });

  timeoutDialogContent.appendChild(list);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    closeTimeoutDialog();
  };
  timeoutDialogButtons.appendChild(cancelBtn);

  openTimeoutDialog();
}

async function banUser(targetUid, extra = {}) {
  const user = auth.currentUser;
  if (!user || !isAdminRole()) return;

  try {
    await setDoc(
      doc(db, "users", targetUid),
      { banned: true },
      { merge: true }
    );
    await logModeration("ban", { targetUid, ...extra });
  } catch (e) {
    console.error("Ban failed:", e);
  }
}

function startModerationLogListener() {
  if (!modLogList) return null;

  const q = query(
    collection(db, "moderationLogs"),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      modLogList.innerHTML = "";
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const item = document.createElement("div");
        item.className = "mod-log-item";

        const when = d.createdAt ? formatTimestamp(d.createdAt) : "";
        const actor = d.actorDisplayName || d.actorUid || "Unknown";
        const target = d.targetUid ? ` → user ${d.targetUid}` : "";
        const action = d.action || "action";

        item.textContent = `[${when}] ${actor}: ${action}${target}`;
        modLogList.appendChild(item);
      });
    },
    (err) => console.error("Moderation log listener error:", err)
  );
}

// -------------------------------
// UI view switching
// -------------------------------
function showListView() {
  currentThreadId = null;
  hide(threadView);
  show(threadListBox);
}

function showThreadView() {
  hide(threadListBox);
  show(threadView);
}

// -------------------------------
// Auth actions (INLINE errors, no alerts)
// -------------------------------
window.login = async function () {
  clearAuthError();

  const email = safeText(emailInput?.value).trim();
  const password = safeText(passwordInput?.value);

  if (!email || !password) {
    setAuthError("Please enter email and password.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await ensureAnonymousProfile(cred.user);
  } catch (e) {
    console.error("Login failed:", e);
    setAuthError(friendlyAuthError(e));
  }
};

window.register = async function () {
  clearAuthError();

  let username = safeText(usernameInput?.value).trim();
  const email = safeText(emailInput?.value).trim();
  const password = safeText(passwordInput?.value);

  if (!email || !password) {
    setAuthError("Please enter email and password.");
    return;
  }
  if (!username) username = ANONYMOUS_NAME;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(cred.user, { displayName: username });

    await setDoc(
      doc(db, "users", cred.user.uid),
      {
        username,
        displayName: username,
        bio: "",
        photoURL: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    clearAuthError();
  } catch (e) {
    console.error("Register failed:", e);
    setAuthError(friendlyAuthError(e));
  }
};

window.logout = async function () {
  try {
    await signOut(auth);
  } catch (e) {
    console.error("Logout failed:", e);
    // leaving this as a console error only (no popups)
  }
};

// -------------------------------
// Rendering helpers
// -------------------------------
function makeForumPostCard({
  author,
  authorPhotoURL,
  authorUid,
  timeText,
  title,
  text,
  tags,
  actionsNode
}) {
  const card = document.createElement("div");
  card.className = "forum-post";

  const header = document.createElement("div");
  header.className = "post-header";

  // Left group: avatar + author
  const left = document.createElement("span");
  left.className = "author-with-avatar";

  if (authorPhotoURL && !isAnonymousName(author)) {
    const img = document.createElement("img");
    img.src = authorPhotoURL;
    img.alt = "avatar";
    img.className = "post-avatar";
    left.appendChild(img);
  }

  const a = document.createElement("span");
  a.className = "post-author";
  a.textContent = author || ANONYMOUS_NAME;
  left.appendChild(a);

  // Right group: tags + date (your “dots” area)
  const right = document.createElement("span");
  right.className = "post-meta-right";

const t = document.createElement("span");
t.className = "post-time";
t.textContent = timeText || "";
right.appendChild(t);

if (tags && tags.length) {
  const tagsRow = document.createElement("div");
  tagsRow.className = "thread-tags-row";

  tags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "thread-tag-pill";
    pill.textContent = tag;
    tagsRow.appendChild(pill);
  });

  right.appendChild(tagsRow);
}

  header.appendChild(left);
  header.appendChild(right);

  const body = document.createElement("div");
  body.className = "post-text";

  if (title) {
    const titleDiv = document.createElement("div");
    titleDiv.className = "post-text";
    titleDiv.style.fontWeight = "600";
    titleDiv.style.marginBottom = "6px";
    titleDiv.textContent = title;
    body.appendChild(titleDiv);
  }

  const textDiv = document.createElement("div");
  textDiv.className = "post-text";
  textDiv.textContent = text || "";
  body.appendChild(textDiv);

  card.appendChild(header);
  card.appendChild(body);

  if (actionsNode) card.appendChild(actionsNode);

  // Hydrate with latest profile name/avatar (uses users/{uid})
  if (authorUid) hydrateHeaderFromUid(header, a, authorUid);

  return card;
}

// -------------------------------
// Threads: list listener
// -------------------------------
// Apply search + tag filters and render the thread list
function renderThreads() {
  if (!threadsDiv) return;
  threadsDiv.innerHTML = "";

  const search = currentSearchText.trim().toLowerCase();
  const selectedTags = Array.from(activeFilterTags);

  allThreads.forEach(({ id, data }) => {
    let matches = true;

    // Text search: title + body + author
    if (search) {
      const haystack = [
        data.title || "",
        data.body || "",
        data.author || ""
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        matches = false;
      }
    }

    // Tag filter (ANY selected tag matches)
    if (matches && selectedTags.length) {
      const threadTags = (data.tags || []).map((t) => t.toLowerCase());
      if (!threadTags.length) {
        matches = false;
      } else {
        const hasAny = selectedTags.some((t) =>
          threadTags.includes(t.toLowerCase())
        );
        if (!hasAny) matches = false;
      }
    }

    if (!matches) return;

    // Actions container (tags + Open button)
    const actions = document.createElement("div");
    actions.style.marginTop = "10px";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
    openBtn.onclick = () => openThread(id);
    actions.appendChild(openBtn);

    const preview =
      (data.body || "").length > 140
        ? (data.body || "").slice(0, 140) + "..."
        : (data.body || "");

const card = makeForumPostCard({
  author: data.author || ANONYMOUS_NAME,
  authorPhotoURL: data.authorPhotoURL || "",
  authorUid: data.uid || "",
  timeText: formatTimestamp(data.created),
  title: data.title || "(no title)",
  text: preview,
  tags: data.tags || [],
  actionsNode: actions
});

    threadsDiv.appendChild(card);
  });

  // Optional: show a small message if nothing matched
  if (!threadsDiv.hasChildNodes()) {
    const empty = document.createElement("div");
    empty.className = "post-text";
    empty.style.opacity = "0.7";
    empty.textContent = "No threads found.";
    threadsDiv.appendChild(empty);
  }
}

// -------------------------------
// Threads: list listener
// -------------------------------
function startThreadsListener() {
  const q = query(collection(db, "threads"), orderBy("created", "desc"));

  unsubThreads?.();
  unsubThreads = onSnapshot(
    q,
    (snap) => {
      allThreads = [];
      snap.forEach((d) => {
        allThreads.push({ id: d.id, data: d.data() });
      });
      renderThreads();
    },
    (err) => console.error("Threads feed error:", err)
  );
}

// -------------------------------
// Create thread
// -------------------------------
window.createThread = async function () {
  const user = auth.currentUser;
  if (!user) {
    setAuthError("Log in to create a thread.");
    return;
  }

  const title = safeText(threadTitle?.value).trim();
  const body = safeText(threadBody?.value).trim();
  if (!title || !body) return;

  // Clear previous thread-level error if the helper exists
  if (typeof setThreadError === "function") {
    setThreadError("");
  }

  // Collect attachment files from the input (current selection)
  const MAX_ATTACHMENTS = 5;
  let attachmentFiles = [];
  if (threadAttachmentsInput && threadAttachmentsInput.files?.length) {
    attachmentFiles = Array.from(threadAttachmentsInput.files);
  }

  // Final size check before upload, if helper exists
  if (attachmentFiles.length && typeof getAttachmentLimitInfo === "function") {
    for (const file of attachmentFiles) {
      const { maxBytes, maxMB } = getAttachmentLimitInfo(file);
      if (file.size > maxBytes) {
        if (typeof setThreadError === "function") {
          setThreadError(`"${file.name}" exceeds size limit (${maxMB}MB).`);
        }
        return; // cancel thread creation
      }
    }
  }

  try {
    const author = await getUsernameForUser(user);
    const authorPhotoURL = !isAnonymousName(author) ? (user.photoURL || "") : "";

    // --- Upload attachments if any (respect max 5) ---
    let attachments = [];
    if (attachmentFiles.length) {
      const filesToUpload = attachmentFiles.slice(0, MAX_ATTACHMENTS);
      const uploads = filesToUpload.map((file) => uploadThreadAttachment(file));
      attachments = await Promise.all(uploads);
    }

    // Tags for this thread (from your tag selector)
    const tags = Array.from(currentCreateTags || []);

    const ref = await addDoc(collection(db, "threads"), {
      title,
      body,
      author,
      authorPhotoURL,
      uid: user.uid,
      created: serverTimestamp(),
      updated: serverTimestamp(),
      replyCount: 0,
      tags,
      attachments // Cloudinary attachment metadata array
    });

    // Reset tag state if you’re using it
    if (typeof currentCreateTags !== "undefined" && currentCreateTags instanceof Set) {
      currentCreateTags = new Set();
      if (typeof updateThreadTagButtonLabel === "function") {
        updateThreadTagButtonLabel();
      }
    }

    // Reset form fields
    if (threadTitle) threadTitle.value = "";
    if (threadBody) threadBody.value = "";

    // Reset attachment UI
    if (threadAttachmentsInput) threadAttachmentsInput.value = "";
    if (threadAttachmentsSummary) threadAttachmentsSummary.textContent = "";
    if (threadAttachmentPreview) threadAttachmentPreview.innerHTML = "";

    // If you’re using a global selectedAttachmentFiles array, clear it safely
    if (typeof selectedAttachmentFiles !== "undefined") {
      selectedAttachmentFiles = [];
    }

    openThread(ref.id);
  } catch (e) {
    console.error("Create thread failed:", e);
    if (typeof setThreadError === "function") {
      setThreadError(e.message || "Failed to create thread.");
    }
  }
};

// -------------------------------
// Thread view + actions + replies
// -------------------------------
// -------------------------------
// Thread view + actions + replies
// -------------------------------
function clearThreadView() {
  if (viewTitle) viewTitle.textContent = "";
  if (viewBody) viewBody.textContent = "";
  if (viewAuthor) viewAuthor.textContent = ANONYMOUS_NAME;
  if (viewTime) viewTime.textContent = "";
  if (viewActions) viewActions.innerHTML = "";
  if (repliesDiv) repliesDiv.innerHTML = "";
  if (viewAttachments) viewAttachments.innerHTML = "";
  if (viewAuthorAvatar) {
    viewAuthorAvatar.src = "";
    viewAuthorAvatar.classList.add("hidden");
  }
}

function renderThreadAttachments(attachments) {
  if (!viewAttachments) return;
  viewAttachments.innerHTML = "";

  if (!attachments || !attachments.length) return;

  attachments.forEach((att) => {
    const url = att.url || att.secure_url;
    if (!url) return;

    const type = (att.resourceType || att.type || "").toLowerCase();
    let media;

    if (type === "image" || /\.(png|jpe?g|gif|webp)$/i.test(url)) {
      media = document.createElement("img");
      media.src = url;
      media.alt = "";
      media.loading = "lazy";
    } else if (type === "video" || /\.(mp4|webm|ogg)$/i.test(url)) {
      media = document.createElement("video");
      media.src = url;
      media.controls = true;
    } else if (type === "audio" || /\.(mp3|wav|ogg)$/i.test(url)) {
      media = document.createElement("audio");
      media.src = url;
      media.controls = true;
    } else {
      media = document.createElement("a");
      media.href = url;
      media.target = "_blank";
      media.rel = "noopener";
      media.textContent = att.originalFilename || "Download attachment";
    }

    media.classList.add("thread-attachment-media");

    const card = document.createElement("div");
    card.className = "thread-attachment-card";
    card.appendChild(media);

    viewAttachments.appendChild(card);
  });
}

function renderThreadActions(threadId, threadData) {
  if (!viewActions) return;
  viewActions.innerHTML = "";

  const user = auth.currentUser;
  const isOwner = user && threadData.uid === user.uid;
  const canModerate = userCanModerate();

  // if neither owner nor moderator/admin, no actions at all
  if (!isOwner && !canModerate) return;

  // --- EDIT (owner only) ---
  if (isOwner) {
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.onclick = () => {
      showEditThreadDialog(
        threadData.title || "",
        threadData.body || "",
        async ({ title, body }) => {
          try {
            await updateDoc(doc(db, "threads", threadId), {
              title,
              body,
              updated: serverTimestamp()
            });

            // this branch is only for owner now, so no mod log needed
          } catch (e) {
            console.error("Edit thread failed:", e);
          }
        }
      );
    };
    viewActions.appendChild(editBtn);
  }

  // --- DELETE (owner OR moderator/admin) ---
  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete";
  delBtn.onclick = () => {
    showConfirmDialog({
      title: "Delete thread",
      message: "Are you sure you want to delete this thread?",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: async () => {
        try {
          if (!isOwner && canModerate) {
            await logModeration("deleteThread", {
              threadId,
              threadOwnerUid: threadData.uid || ""
            });
          }
          await deleteDoc(doc(db, "threads", threadId));
          window.closeThread();
        } catch (e) {
          console.error("Delete thread failed:", e);
        }
      }
    });
  };
  viewActions.appendChild(delBtn);

  // --- TIMEOUT / BAN (moderator/admin only) ---
  if (canModerate && user && threadData.uid && user.uid !== threadData.uid) {
    const timeoutBtn = document.createElement("button");
    timeoutBtn.textContent = "Timeout…";
    timeoutBtn.onclick = () => {
      showTimeoutDialog(async (selection) => {
        await timeoutUser(threadData.uid, selection.minutes, {
          source: "thread",
          threadId,
          durationLabel: selection.label
        });
      });
    };
    viewActions.appendChild(timeoutBtn);

    if (isAdminRole()) {
      const banBtn = document.createElement("button");
      banBtn.textContent = "Ban user";
      banBtn.onclick = async () => {
        const ok = confirm(
          "Ban this user?\nThey will no longer be able to create threads or replies."
        );
        if (!ok) return;

        await banUser(threadData.uid, {
          source: "thread",
          threadId
        });
      };
      viewActions.appendChild(banBtn);
    }
  }
}

function openThread(threadId) {
  currentThreadId = threadId;
  showThreadView();
  clearThreadView();

  unsubThreadDoc?.();
  unsubThreadDoc = onSnapshot(
    doc(db, "threads", threadId),
    (snap) => {
      if (!snap.exists()) {
        window.closeThread();
        return;
      }
      const t = snap.data();
      if (viewTitle) viewTitle.textContent = t.title || "(no title)";
      if (viewBody) viewBody.textContent = t.body || "";
      if (viewAuthor) viewAuthor.textContent = t.author || ANONYMOUS_NAME;
      if (viewTime) viewTime.textContent = formatTimestamp(t.created);
      renderThreadAttachments(t.attachments || []);
      hydrateThreadAuthor(t.uid);
      renderThreadActions(threadId, t);
    },
    (err) => console.error("Thread listener error:", err)
  );

  startRepliesListener(threadId);
}

function renderThreadDetails(threadData) {
  // ... existing title/body stuff ...

  const attachments = threadData.attachments || [];
  if (attachments.length) {
    const container = document.createElement("div");
    container.className = "thread-attachments-view";

    attachments.forEach(att => {
      let node;

      if (att.resourceType === "image") {
        node = document.createElement("img");
        node.src = att.url;
        node.alt = "";
        node.style.maxWidth = "100%";
        node.style.borderRadius = "8px";
      } else if (att.resourceType === "video") {
        node = document.createElement("video");
        node.src = att.url;
        node.controls = true;
        node.style.maxWidth = "100%";
      } else {
        // audio or other files
        node = document.createElement("audio");
        node.src = att.url;
        node.controls = true;
      }

      node.style.display = "block";
      node.style.marginTop = "8px";
      container.appendChild(node);
    });

    threadBodyDiv.appendChild(container);
  }
}

function startRepliesListener(threadId) {
  const q = query(
    collection(db, "threads", threadId, "replies"),
    orderBy("created", "asc")
  );

  unsubReplies?.();
  unsubReplies = onSnapshot(
    q,
    (snap) => {
      if (!repliesDiv) return;
      repliesDiv.innerHTML = "";

      snap.forEach((d) => {
        const r = d.data();

        const actions = document.createElement("div");
        actions.style.marginTop = "10px";

        const user = auth.currentUser;
        const isOwner = user && r.uid === user.uid;
        const canModerate = userCanModerate();

        // -------- owner OR moderator/admin controls --------
if (isOwner || canModerate) {
  // --- EDIT (owner only) ---
  if (isOwner) {
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.onclick = () => {
      showEditReplyDialog(r.text || "", async (newText) => {
        try {
          await updateDoc(
            doc(db, "threads", threadId, "replies", d.id),
            {
              text: newText.trim(),
              updated: serverTimestamp()
            }
          );

          // no mod log needed: only owner can edit now
        } catch (e) {
          console.error("Edit reply failed:", e);
        }
      });
    };
    actions.appendChild(edit);
  }

  // --- DELETE (owner OR moderator/admin) ---
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.onclick = () => {
    showConfirmDialog({
      title: "Delete reply",
      message: "Are you sure you want to delete this reply?",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: async () => {
        try {
          if (!isOwner && canModerate) {
            await logModeration("deleteReply", {
              threadId,
              replyId: d.id,
              replyOwnerUid: r.uid || ""
            });
          }

          await deleteDoc(
            doc(db, "threads", threadId, "replies", d.id)
          );

          await updateDoc(doc(db, "threads", threadId), {
            replyCount: increment(-1),
            updated: serverTimestamp()
          });
        } catch (e) {
          console.error("Delete reply failed:", e);
        }
      }
    });
  };
  actions.appendChild(del);

  // --- extra mod tools (timeout / ban) stay below this, as you already have ---
  if (canModerate && user && r.uid && user.uid !== r.uid) {
    const timeoutBtn = document.createElement("button");
    timeoutBtn.textContent = "Timeout…";
    timeoutBtn.onclick = () => {
      showTimeoutDialog(async (selection) => {
        await timeoutUser(r.uid, selection.minutes, {
          source: "reply",
          threadId,
          replyId: d.id,
          durationLabel: selection.label
        });
      });
    };
    actions.appendChild(timeoutBtn);

    if (isAdminRole()) {
      const banBtn = document.createElement("button");
      banBtn.textContent = "Ban user";
      banBtn.onclick = () => {
        showConfirmDialog({
          title: "Ban user",
          message:
            "Ban this user? They will no longer be able to create threads or replies.",
          confirmLabel: "Ban",
          cancelLabel: "Cancel",
          onConfirm: async () => {
            await banUser(r.uid, {
              source: "reply",
              threadId,
              replyId: d.id
            });
          }
        });
      };
      actions.appendChild(banBtn);
    }
  }
}

        // -------- render reply card --------
        const card = makeForumPostCard({
          author: r.author || ANONYMOUS_NAME,
          authorPhotoURL: r.authorPhotoURL || "",
          authorUid: r.uid || "",
          timeText: formatTimestamp(r.created),
          title: null,
          text: r.text || "",
          actionsNode: actions.childNodes.length ? actions : null
        });

        repliesDiv.appendChild(card);
      });
    },
    (err) => console.error("Replies feed error:", err)
  );
}

window.closeThread = function () {
  unsubThreadDoc?.();
  unsubReplies?.();
  unsubThreadDoc = null;
  unsubReplies = null;

  clearThreadView();
  showListView();
};

// -------------------------------
// Reply
// -------------------------------
window.replyToThread = async function () {
  const user = auth.currentUser;
  if (!user) {
    setAuthError("Log in to reply.");
    return;
  }
  if (!currentThreadId) return;

  const text = safeText(replyText?.value).trim();
  if (!text) return;

  try {
    const author = await getUsernameForUser(user);
    const authorPhotoURL = !isAnonymousName(author) ? (user.photoURL || "") : "";

    await addDoc(collection(db, "threads", currentThreadId, "replies"), {
      text,
      author,
      authorPhotoURL,
      uid: user.uid,
      created: serverTimestamp(),
      updated: serverTimestamp()
    });

    await updateDoc(doc(db, "threads", currentThreadId), {
      replyCount: increment(1),
      updated: serverTimestamp()
    });

    if (replyText) replyText.value = "";
  } catch (e) {
    console.error("Reply failed:", e);
  }
};

// -------------------------------
// Auth state: toggle UI (Logout + Profile button)
// -------------------------------
onAuthStateChanged(auth, async (user) => {
  clearAuthError();

  // Reset role / flags each time auth changes
  currentUserRole = null;
  currentUserIsBanned = false;
  currentUserMutedUntil = null;

  if (user) {
    // Ensure profile doc exists
    await ensureAnonymousProfile(user);

    // Load role + ban/timeout flags from users/{uid}
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};

      const roleRaw = (data.role || "").toLowerCase();
      if (roleRaw === ROLE_ADMIN || roleRaw === ROLE_MODERATOR) {
        currentUserRole = roleRaw;
      }

      currentUserIsBanned = !!data.banned;
      currentUserMutedUntil = data.mutedUntil || null;
    } catch (e) {
      console.error("Failed to load user profile/flags:", e);
    }
  }

  // Auth box (login/register area)
  if (user) hide(authBox);
  else show(authBox);

  // Logout button
  if (user) show(logoutBtn);
  else hide(logoutBtn);

  const mutedNow = isCurrentlyMuted();

  // Thread create & reply box:
  // only when logged in AND not banned AND not muted
  if (user && !currentUserIsBanned && !mutedNow) {
    show(threadCreate);
    show(replyBox);
  } else {
    hide(threadCreate);
    hide(replyBox);
  }

  // Status text
  if (userStatus) {
    if (!user) {
      userStatus.textContent = "Not logged in";
    } else if (currentUserIsBanned) {
      userStatus.textContent =
        "You are banned and cannot create threads or replies.";
    } else if (mutedNow) {
      const untilText = formatMuteUntil(currentUserMutedUntil);
      userStatus.textContent =
        "You are temporarily timed out and cannot post" +
        (untilText ? ` until ${untilText}` : ".");
    } else {
      userStatus.textContent =
        `Logged in as: ${user.displayName || ANONYMOUS_NAME}`;
    }
  }

  // Profile button
  if (user) show(openProfileBtn);
  else hide(openProfileBtn);

  // Moderation button + log listener
  if (user && isModeratorRole()) {
    show(modToolsBtn);
    if (!unsubModerationLogs && typeof startModerationLogListener === "function") {
      unsubModerationLogs = startModerationLogListener();
    }
  } else {
    hide(modToolsBtn);
    if (unsubModerationLogs) {
      unsubModerationLogs();
      unsubModerationLogs = null;
    }
  }

  // Close mod/profile modals on logout
  if (!user) {
    window.closeProfileModal?.();
    window.closeModerationModal?.();
  }
  startUpdatesListener();
  updateAdminUI();

});


// Boot
startThreadsListener();
showListView();
