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

// Thread create UI
const threadCreate = el("thread-create");
const threadTitle = el("thread-title");
const threadBody = el("thread-body");

// Thread list UI
const threadListBox = el("thread-list");
const threadsDiv = el("threads");

// Thread view UI
const threadView = el("thread-view");
const viewTitle = el("view-title");
const viewBody = el("view-body");
const viewAuthor = el("view-author");
const viewTime = el("view-time");
const viewActions = el("view-actions");
const viewAuthorAvatar = el("view-author-avatar");

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
// State / listeners
// -------------------------------
let currentThreadId = null;
let unsubThreads = null;
let unsubThreadDoc = null;
let unsubReplies = null;

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

// Cloudinary upload
async function uploadToCloudinary(file) {
  const CLOUD_NAME = "ddxdtdbxh";
  const UPLOAD_PRESET = "kino-forum"; // your preset name
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: "POST", body: formData });
  if (!res.ok) {
    let msg = "Cloudinary upload failed.";
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {
      try { msg = (await res.text()) || msg; } catch {}
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.secure_url;
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
function makeForumPostCard({ author, authorPhotoURL, authorUid, timeText, title, text, actionsNode }) {
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

  const t = document.createElement("span");
  t.className = "post-time";
  t.textContent = timeText || "";

  header.appendChild(left);
  header.appendChild(t);

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
function startThreadsListener() {
  const q = query(collection(db, "threads"), orderBy("created", "desc"));

  unsubThreads?.();
  unsubThreads = onSnapshot(
    q,
    (snap) => {
      if (!threadsDiv) return;
      threadsDiv.innerHTML = "";

      snap.forEach((d) => {
        const data = d.data();

        const actions = document.createElement("div");
        actions.style.marginTop = "10px";

        const openBtn = document.createElement("button");
        openBtn.textContent = "Open";
        openBtn.onclick = () => openThread(d.id);
        actions.appendChild(openBtn);

        const preview =
          (data.body || "").length > 140 ? (data.body || "").slice(0, 140) + "..." : (data.body || "");

        const card = makeForumPostCard({
          author: data.author || ANONYMOUS_NAME,
          authorPhotoURL: data.authorPhotoURL || "",
          authorUid: data.uid || "",
          timeText: formatTimestamp(data.created),
          title: data.title || "(no title)",
          text: preview,
          actionsNode: actions
        });

        threadsDiv.appendChild(card);
      });
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

  try {
    const author = await getUsernameForUser(user);
    const authorPhotoURL = !isAnonymousName(author) ? (user.photoURL || "") : "";

    const ref = await addDoc(collection(db, "threads"), {
      title,
      body,
      author,
      authorPhotoURL,
      uid: user.uid,
      created: serverTimestamp(),
      updated: serverTimestamp(),
      replyCount: 0
    });

    if (threadTitle) threadTitle.value = "";
    if (threadBody) threadBody.value = "";

    openThread(ref.id);
  } catch (e) {
    console.error("Create thread failed:", e);
  }
};

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
  if (viewAuthorAvatar) {
    viewAuthorAvatar.src = "";
    viewAuthorAvatar.classList.add("hidden");
  }
}

function renderThreadActions(threadId, threadData) {
  if (!viewActions) return;
  viewActions.innerHTML = "";

  const user = auth.currentUser;
  const isOwner = user && threadData.uid === user.uid;
  if (!isOwner) return;

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.onclick = async () => {
    const newTitle = prompt("New title:", threadData.title || "");
    if (newTitle === null) return;

    const newBody = prompt("New body:", threadData.body || "");
    if (newBody === null) return;

    try {
      await updateDoc(doc(db, "threads", threadId), {
        title: newTitle.trim() || "(no title)",
        body: newBody.trim(),
        updated: serverTimestamp()
      });
    } catch (e) {
      console.error("Edit thread failed:", e);
    }
  };

  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete";
  delBtn.onclick = async () => {
    const ok = confirm(
      "Delete this thread?\n\nNote: Firestore does NOT automatically delete replies in a subcollection."
    );
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "threads", threadId));
      window.closeThread();
    } catch (e) {
      console.error("Delete thread failed:", e);
    }
  };

  viewActions.appendChild(editBtn);
  viewActions.appendChild(delBtn);
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
      hydrateThreadAuthor(t.uid);
      renderThreadActions(threadId, t);
    },
    (err) => console.error("Thread listener error:", err)
  );

  startRepliesListener(threadId);
}

function startRepliesListener(threadId) {
  const q = query(collection(db, "threads", threadId, "replies"), orderBy("created", "asc"));

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

        if (isOwner) {
          const edit = document.createElement("button");
          edit.textContent = "Edit";
          edit.onclick = async () => {
            const newText = prompt("Edit reply:", r.text || "");
            if (newText === null) return;
            try {
              await updateDoc(doc(db, "threads", threadId, "replies", d.id), {
                text: newText.trim(),
                updated: serverTimestamp()
              });
            } catch (e) {
              console.error("Edit reply failed:", e);
            }
          };

          const del = document.createElement("button");
          del.textContent = "Delete";
          del.onclick = async () => {
            const ok = confirm("Delete this reply?");
            if (!ok) return;
            try {
              await deleteDoc(doc(db, "threads", threadId, "replies", d.id));
              await updateDoc(doc(db, "threads", threadId), {
                replyCount: increment(-1),
                updated: serverTimestamp()
              });
            } catch (e) {
              console.error("Delete reply failed:", e);
            }
          };

          actions.appendChild(edit);
          actions.appendChild(del);
        }

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
  if (user) await ensureAnonymousProfile(user);

  // Auth form
  if (user) hide(authBox);
  else show(authBox);

  // Logout button
  if (user) show(logoutBtn);
  else hide(logoutBtn);

  // Create thread & reply box only when logged in
  if (user) {
    show(threadCreate);
    show(replyBox);
    if (userStatus) userStatus.textContent = `Logged in as: ${user.displayName || ANONYMOUS_NAME}`;
  } else {
    hide(threadCreate);
    hide(replyBox);
    if (userStatus) userStatus.textContent = "Not logged in";
  }

  // Profile button
  if (user) show(openProfileBtn);
  else hide(openProfileBtn);

  // Close modal on logout
  if (!user) {
    window.closeProfileModal?.();
  }
});

// Boot
startThreadsListener();
showListView();
