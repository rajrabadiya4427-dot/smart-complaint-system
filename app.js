/* ==========================================================================
   SmartCity Care - Municipal Complaint Management System Logic
   ========================================================================== */

// --- Initial Complaints Data ---
const DEFAULT_COMPLAINTS = [];

// --- State Management ---
let complaints = [];
let currentUploadedImageBase64 = "";
let isAdminLoggedIn = false;
let currentUser = null;
let locomotiveScroll = null;

// --- DOM Elements & Init ---
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    // One-time cleanup of legacy demo seed data from early development
    const stored = localStorage.getItem("amc_complaints");
    if (stored && (stored.includes("AMC-2026-1001") || stored.includes("Aarav Mehta"))) {
        try {
            const parsed = JSON.parse(stored);
            const cleaned = parsed.filter(c => !["AMC-2026-1001", "AMC-2026-1002", "AMC-2026-1003", "AMC-2026-1004"].includes(c.id));
            localStorage.setItem("amc_complaints", JSON.stringify(cleaned));
        } catch (e) {}
    }

    initLocomotiveScroll();
    loadComplaintsFromStorage();
    setupEventListeners();
    renderUserComplaints();
    updateHomeStats();
    setCurrentYear();
    checkSessionState();
    setupGlobalSync();
}

function initLocomotiveScroll() {
    const scrollContainer = document.querySelector("#scroll-container");
    if (typeof LocomotiveScroll !== "undefined" && scrollContainer) {
        try {
            locomotiveScroll = new LocomotiveScroll({
                el: scrollContainer,
                smooth: true,
                multiplier: 0.9,
                touchMultiplier: 2,
                tablet: { smooth: true },
                smartphone: { smooth: true }
            });
        } catch (e) {
            console.warn("Locomotive Scroll initialization warning:", e);
        }
    }
}

/* ==========================================================================
   Global Database Configuration (Firebase Realtime Engine)
   ========================================================================== */
// Custom Firebase Realtime Database URL
const FIREBASE_DB_URL = "https://smart-complaint-system-dd5b9-default-rtdb.firebaseio.com/";

// Firebase Complaints URL Helper
function getFirebaseUrl(path = "") {
    let baseUrl = FIREBASE_DB_URL.trim();
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    if (!baseUrl.endsWith("/complaints")) baseUrl += "/complaints";
    return path ? `${baseUrl}/${path}.json` : `${baseUrl}.json`;
}

// Firebase Users Database URL Helper
function getFirebaseUserUrl(userKey = "") {
    let baseUrl = FIREBASE_DB_URL.trim();
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    if (baseUrl.endsWith("/complaints")) baseUrl = baseUrl.slice(0, -11);
    return userKey ? `${baseUrl}/users/${userKey}.json` : `${baseUrl}/users.json`;
}

let lastSyncedRawData = "";

function setupGlobalSync() {
    // Initial fetch from Firebase Realtime Database
    syncWithCloudDatabase();

    // 1. Cross-tab local storage listener
    window.addEventListener("storage", (e) => {
        if (e.key === "amc_complaints" || e.key === "amc_user") {
            syncDataGloballyLocally();
        }
    });

    // 2. Continuous 2.5s background polling across all devices globally
    setInterval(() => {
        syncWithCloudDatabase();
    }, 2500);
}

async function syncWithCloudDatabase() {
    try {
        const response = await fetch(getFirebaseUrl());
        if (response.ok) {
            const data = await response.json();
            if (data) {
                const cloudComplaints = Array.isArray(data) ? data : Object.values(data);
                const validList = cloudComplaints.filter(c => c && c.id);
                validList.sort((a, b) => (b.timestampSubmitted || 0) - (a.timestampSubmitted || 0));
                
                complaints = validList;
                saveComplaintsToStorageLocally();
                renderUserComplaints();
                renderAdminTable();
                updateHomeStats();
                return;
            } else if (data === null) {
                complaints = [];
                saveComplaintsToStorageLocally();
                renderUserComplaints();
                renderAdminTable();
                updateHomeStats();
                return;
            }
        }
    } catch (err) {
        console.warn("Firebase fetch warning:", err);
    }
    loadComplaintsFromStorageLocally();
}

function syncDataGloballyLocally() {
    const rawStored = localStorage.getItem("amc_complaints") || "[]";
    if (rawStored !== lastSyncedRawData) {
        lastSyncedRawData = rawStored;
        try {
            complaints = JSON.parse(rawStored);
        } catch (e) {
            complaints = [];
        }
        renderUserComplaints();
        renderAdminTable();
        updateHomeStats();
    }
}

async function saveComplaintToCloud(newComplaint) {
    complaints.unshift(newComplaint);
    saveComplaintsToStorageLocally();
    renderUserComplaints();
    renderAdminTable();
    updateHomeStats();

    try {
        await fetch(getFirebaseUrl(newComplaint.id), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newComplaint)
        });
    } catch (err) {
        console.warn("Firebase save warning:", err);
    }
}

async function updateStatusInCloud(id, newStatus) {
    const comp = complaints.find(c => c.id === id);
    if (comp) {
        comp.status = newStatus;
        if (newStatus === "Confirmed" || newStatus === "On Way" || newStatus === "Resolved") {
            if (!comp.timestampConfirmed) comp.timestampConfirmed = Date.now();
        } else if (newStatus === "Pending") {
            comp.timestampConfirmed = null;
        }
        saveComplaintsToStorageLocally();
        renderUserComplaints();
        renderAdminTable();
        updateHomeStats();

        try {
            await fetch(getFirebaseUrl(id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: newStatus,
                    timestampConfirmed: comp.timestampConfirmed || null
                })
            });
        } catch (err) {
            console.warn("Firebase status patch warning:", err);
        }
        showToast(`Status for ${id} updated to "${newStatus}". Synced globally!`, "success");
    }
}

async function deleteComplaintFromCloud(id) {
    if (confirm(`Are you sure you want to delete complaint ${id}?`)) {
        complaints = complaints.filter(c => c.id !== id);
        saveComplaintsToStorageLocally();
        renderAdminTable();
        renderUserComplaints();
        updateHomeStats();

        try {
            await fetch(getFirebaseUrl(id), {
                method: "DELETE"
            });
        } catch (err) {
            console.warn("Firebase delete warning:", err);
        }
        showToast(`Complaint ${id} removed from global system.`, "info");
    }
}

function loadComplaintsFromStorageLocally() {
    const stored = localStorage.getItem("amc_complaints");
    if (stored) {
        try {
            complaints = JSON.parse(stored);
        } catch (e) {
            complaints = [];
        }
    } else {
        complaints = [];
    }
    lastSyncedRawData = JSON.stringify(complaints);
}

function saveComplaintsToStorageLocally() {
    const dataStr = JSON.stringify(complaints);
    lastSyncedRawData = dataStr;
    localStorage.setItem("amc_complaints", dataStr);
}

// Session state checker
function checkSessionState() {
    const storedUser = localStorage.getItem("amc_user");
    const loggedOutNav = document.getElementById("loggedOutNav");
    const loggedInNav = document.getElementById("loggedInNav");
    const navUserName = document.getElementById("navUserName");
    const adminDashTrigger = document.getElementById("adminDashTrigger");
    const universalAuthModal = document.getElementById("universalAuthModal");

    if (storedUser) {
        try {
            currentUser = JSON.parse(storedUser);
        } catch (e) {
            currentUser = null;
        }
    }

    if (currentUser) {
        if (loggedOutNav) loggedOutNav.classList.add("hidden");
        if (loggedInNav) loggedInNav.classList.remove("hidden");
        if (navUserName) navUserName.textContent = currentUser.name || currentUser.email;

        if (currentUser.email === "smartservice@gmail.com") {
            isAdminLoggedIn = true;
            if (adminDashTrigger) adminDashTrigger.classList.remove("hidden");
        } else {
            isAdminLoggedIn = false;
            if (adminDashTrigger) adminDashTrigger.classList.add("hidden");
            // Auto fill citizen name in form if empty
            const nameInput = document.getElementById("userName");
            if (nameInput && !nameInput.value) nameInput.value = currentUser.name || "";
        }
        if (universalAuthModal) universalAuthModal.classList.add("hidden");
    } else {
        if (loggedOutNav) loggedOutNav.classList.remove("hidden");
        if (loggedInNav) loggedInNav.classList.add("hidden");
        isAdminLoggedIn = false;
        // Show compulsory login modal if user not logged in
        if (universalAuthModal) universalAuthModal.classList.remove("hidden");
    }
}

// Load Complaints from storage (filter legacy seed data)
function loadComplaintsFromStorage() {
    const stored = localStorage.getItem("amc_complaints");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            // Filter out old seed complaints if present
            complaints = parsed.filter(c => !["AMC-2026-1001", "AMC-2026-1002", "AMC-2026-1003", "AMC-2026-1004"].includes(c.id));
            saveComplaintsToStorage();
        } catch (e) {
            complaints = [];
            saveComplaintsToStorage();
        }
    } else {
        complaints = [];
        saveComplaintsToStorage();
    }
}

function saveComplaintsToStorage() {
    localStorage.setItem("amc_complaints", JSON.stringify(complaints));
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Navigation Hamburger
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const navMenu = document.getElementById("navMenu");
    if (hamburgerBtn && navMenu) {
        hamburgerBtn.addEventListener("click", () => {
            navMenu.classList.toggle("active");
        });
    }

    // Smooth Link Scrolling with Locomotive Scroll Support
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener("click", (e) => {
            const targetId = link.getAttribute("href");
            if (targetId && targetId !== "#") {
                const targetEl = document.querySelector(targetId);
                if (targetEl) {
                    e.preventDefault();
                    if (navMenu) navMenu.classList.remove("active");
                    if (locomotiveScroll) {
                        locomotiveScroll.scrollTo(targetEl);
                    } else {
                        targetEl.scrollIntoView({ behavior: "smooth" });
                    }
                }
            }
        });
    });

    // File Upload Preview & Drag Drop
    const photoInput = document.getElementById("photoInput");
    const removeImgBtn = document.getElementById("removeImgBtn");

    if (photoInput) {
        photoInput.addEventListener("change", handleFileSelect);
    }

    if (removeImgBtn) {
        removeImgBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            resetPhotoUpload();
        });
    }

    // Complaint Form Submit
    const complaintForm = document.getElementById("complaintForm");
    if (complaintForm) {
        complaintForm.addEventListener("submit", handleFormSubmit);
    }

    // Tracker Search & Filter
    const userSearchInput = document.getElementById("userSearchInput");
    const userStatusFilter = document.getElementById("userStatusFilter");
    if (userSearchInput) userSearchInput.addEventListener("input", renderUserComplaints);
    if (userStatusFilter) userStatusFilter.addEventListener("change", renderUserComplaints);

    // Universal Auth Modal Triggers
    const loginModalTrigger = document.getElementById("loginModalTrigger");
    const universalAuthModal = document.getElementById("universalAuthModal");
    const closeAuthModal = document.getElementById("closeAuthModal");
    const universalLoginForm = document.getElementById("universalLoginForm");

    if (loginModalTrigger && universalAuthModal) {
        loginModalTrigger.addEventListener("click", () => {
            universalAuthModal.classList.remove("hidden");
        });
    }

    if (closeAuthModal && universalAuthModal) {
        closeAuthModal.addEventListener("click", () => {
            if (!currentUser) {
                showToast("Please sign in to access full site features.", "info");
            }
            universalAuthModal.classList.add("hidden");
        });
    }

    if (universalLoginForm) {
        universalLoginForm.addEventListener("submit", handleUniversalLogin);
    }

    // Navbar Admin Dashboard Button
    const adminDashTrigger = document.getElementById("adminDashTrigger");
    if (adminDashTrigger) {
        adminDashTrigger.addEventListener("click", () => {
            if (isAdminLoggedIn) {
                showAdminDashboard();
            }
        });
    }

    // User Logout
    const userLogoutBtn = document.getElementById("userLogoutBtn");
    if (userLogoutBtn) {
        userLogoutBtn.addEventListener("click", handleLogout);
    }

    // Admin Logout
    const adminLogoutBtn = document.getElementById("adminLogoutBtn");
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener("click", () => {
            document.getElementById("adminDashboardView").classList.add("hidden");
            showToast("Exited Admin Dashboard view", "info");
        });
    }

    // Admin Search & Filter
    const adminSearchInput = document.getElementById("adminSearchInput");
    const adminStatusFilter = document.getElementById("adminStatusFilter");
    if (adminSearchInput) adminSearchInput.addEventListener("input", renderAdminTable);
    if (adminStatusFilter) adminStatusFilter.addEventListener("change", renderAdminTable);

    // Lightbox Modal Close
    const closeLightboxBtn = document.getElementById("closeLightboxBtn");
    const imageLightboxModal = document.getElementById("imageLightboxModal");
    if (closeLightboxBtn && imageLightboxModal) {
        closeLightboxBtn.addEventListener("click", () => {
            imageLightboxModal.classList.add("hidden");
        });
    }

    // Details Modal Close
    const closeDetailsModal = document.getElementById("closeDetailsModal");
    const detailsModal = document.getElementById("detailsModal");
    if (closeDetailsModal && detailsModal) {
        closeDetailsModal.addEventListener("click", () => {
            detailsModal.classList.add("hidden");
        });
    }
}

// File Select Reader
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
        showToast("Please upload a valid image file (JPG, PNG, WEBP)", "danger");
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast("Image size must be under 5MB", "danger");
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        currentUploadedImageBase64 = event.target.result;
        document.getElementById("imagePreview").src = currentUploadedImageBase64;
        document.getElementById("uploadPrompt").classList.add("hidden");
        document.getElementById("previewContainer").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
}

function resetPhotoUpload() {
    currentUploadedImageBase64 = "";
    document.getElementById("photoInput").value = "";
    document.getElementById("imagePreview").src = "";
    document.getElementById("previewContainer").classList.add("hidden");
    document.getElementById("uploadPrompt").classList.remove("hidden");
}

// Preselect service category from grid click
function preselectService(serviceName) {
    const serviceSelect = document.getElementById("serviceCategory");
    if (serviceSelect) {
        serviceSelect.value = serviceName;
    }
}

// --- Complaint Form Submission ---
function handleFormSubmit(e) {
    e.preventDefault();

    const userNameInput = document.getElementById("userName");
    const userRoleSelect = document.getElementById("userRole");
    const serviceCategorySelect = document.getElementById("serviceCategory");
    const prioritySelect = document.getElementById("priorityLevel");
    const locationInput = document.getElementById("complaintLocation");
    const descriptionTextarea = document.getElementById("complaintDescription");

    // Clear previous errors
    document.querySelectorAll(".form-group").forEach(fg => fg.classList.remove("has-error"));

    let isValid = true;

    if (!userNameInput.value.trim()) {
        userNameInput.parentElement.classList.add("has-error");
        isValid = false;
    }
    if (!userRoleSelect.value) {
        userRoleSelect.parentElement.classList.add("has-error");
        isValid = false;
    }
    if (!serviceCategorySelect.value) {
        serviceCategorySelect.parentElement.classList.add("has-error");
        isValid = false;
    }
    if (!locationInput.value.trim()) {
        locationInput.parentElement.classList.add("has-error");
        isValid = false;
    }
    const photoGroup = document.getElementById("photoGroup");

    if (!descriptionTextarea.value.trim()) {
        descriptionTextarea.parentElement.classList.add("has-error");
        isValid = false;
    }

    if (!currentUploadedImageBase64) {
        if (photoGroup) photoGroup.classList.add("has-error");
        isValid = false;
    }

    if (!isValid) {
        showToast("Please fill in all required fields and attach photo proof!", "danger");
        return;
    }

    // Create New Complaint Object
    const newId = `AMC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const nowMs = Date.now();
    const newComplaint = {
        id: newId,
        userName: userNameInput.value.trim(),
        userRole: userRoleSelect.value,
        serviceCategory: serviceCategorySelect.value,
        priority: prioritySelect.value || "Normal",
        location: locationInput.value.trim(),
        description: descriptionTextarea.value.trim(),
        photo: currentUploadedImageBase64,
        status: "Pending",
        timestampSubmitted: nowMs,
        timestampConfirmed: null,
        dateSubmitted: formattedDate,
        adminNote: ""
    };

    // Save to State, LocalStorage & Cloud DB
    saveComplaintToCloud(newComplaint);

    // Reset Form
    document.getElementById("complaintForm").reset();
    resetPhotoUpload();

    showToast(`Grievance submitted successfully! Complaint ID: ${newId}`, "success");

    // Scroll smoothly to track section
    const trackSection = document.getElementById("track-status");
    if (trackSection) {
        if (locomotiveScroll) {
            locomotiveScroll.scrollTo(trackSection);
        } else {
            trackSection.scrollIntoView({ behavior: "smooth" });
        }
    }
}

// --- Render User Complaints Cards ---
function renderUserComplaints() {
    const container = document.getElementById("userComplaintsList");
    const searchVal = (document.getElementById("userSearchInput")?.value || "").toLowerCase();
    const filterStatus = document.getElementById("userStatusFilter")?.value || "ALL";

    if (!container) return;

    const filtered = complaints.filter(c => {
        const matchesSearch = c.id.toLowerCase().includes(searchVal) ||
                              c.userName.toLowerCase().includes(searchVal) ||
                              c.location.toLowerCase().includes(searchVal) ||
                              c.serviceCategory.toLowerCase().includes(searchVal);

        const matchesStatus = (filterStatus === "ALL") || (c.status === filterStatus);
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-2 text-center" style="padding: 4rem 1.5rem; width: 100%; background: #fff; border-radius: 20px; border: 2px dashed #cbd5e1;">
                <i class="fa-solid fa-clipboard-list" style="font-size: 3.5rem; color: #60a5fa; margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-primary); font-size: 1.4rem; margin-bottom: 0.5rem;">No Active Grievances in Portal</h3>
                <p style="color: var(--text-secondary); font-size: 0.975rem; max-width: 520px; margin: 0 auto 1.5rem;">
                    When citizens or users submit a municipal complaint from the portal form above, their grievances will appear here globally in real-time.
                </p>
                <a href="#file-complaint" class="btn btn-primary">
                    <i class="fa-solid fa-paper-plane"></i> File a Complaint
                </a>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const statusBadgeClass = getStatusBadgeClass(c.status);
        const timelineHtml = renderTimeline(c.status);

        return `
            <div class="complaint-card">
                <div class="card-top">
                    <span class="complaint-id"><i class="fa-solid fa-hashtag"></i> ${c.id}</span>
                    <span class="status-badge ${statusBadgeClass}">${c.status}</span>
                </div>

                <div class="citizen-info">
                    <div class="user-avatar">${c.userName.charAt(0).toUpperCase()}</div>
                    <div class="user-details">
                        <h4>${escapeHtml(c.userName)}</h4>
                        <span class="role-tag"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(c.userRole)}</span>
                    </div>
                </div>

                <div class="complaint-meta">
                    <div><strong style="color: var(--text-primary);">${escapeHtml(c.serviceCategory)}</strong></div>
                    <div><i class="fa-solid fa-location-dot"></i> ${escapeHtml(c.location)}</div>
                    <div><i class="fa-regular fa-clock"></i> ${c.dateSubmitted}</div>
                </div>

                <p class="complaint-desc">${escapeHtml(c.description)}</p>

                ${(c.status === "Confirmed" || c.status === "On Way" || c.status === "Resolved") ? `
                    <div class="solved-location-banner">
                        <i class="fa-solid fa-circle-check"></i>
                        <span><strong>Problem Confirmed/Solved:</strong> ${escapeHtml(c.serviceCategory)} at ${escapeHtml(c.location)}</span>
                    </div>
                ` : ''}

                ${c.photo ? `<img src="${c.photo}" alt="Uploaded Complaint Photo Proof" class="complaint-thumbnail skeleton-loader" loading="lazy" onclick="openLightbox('${c.photo}', '${c.id} - ${escapeHtml(c.serviceCategory)}')">` : ''}

                <div class="timeline-tracker">
                    ${timelineHtml}
                </div>
            </div>
        `;
    }).join("");

    if (locomotiveScroll) {
        setTimeout(() => {
            locomotiveScroll.update();
        }, 100);
    }
}

// Generate Status Timeline HTML
function renderTimeline(status) {
    const steps = ["Pending", "Confirmed", "On Way", "Resolved"];
    const currentIndex = steps.indexOf(status);

    if (status === "Rejected") {
        return `
            <div style="text-align: center; color: var(--danger); font-size: 0.85rem; font-weight: 700; padding: 0.5rem; background: var(--danger-light); border-radius: 8px;">
                <i class="fa-solid fa-circle-xmark"></i> Grievance Rejected by Administration
            </div>
        `;
    }

    return `
        <div class="timeline-steps">
            <div class="step-item ${currentIndex >= 0 ? (currentIndex === 0 ? 'active' : 'completed') : ''}">
                <div class="step-icon"><i class="fa-solid fa-clock"></i></div>
                <span class="step-text">Pending</span>
            </div>
            <div class="step-item ${currentIndex >= 1 ? (currentIndex === 1 ? 'active' : 'completed') : ''}">
                <div class="step-icon"><i class="fa-solid fa-check"></i></div>
                <span class="step-text">Confirmed</span>
            </div>
            <div class="step-item ${currentIndex >= 2 ? (currentIndex === 2 ? 'active' : 'completed') : ''}">
                <div class="step-icon"><i class="fa-solid fa-truck-fast"></i></div>
                <span class="step-text">On Way</span>
            </div>
            <div class="step-item ${currentIndex >= 3 ? (currentIndex === 3 ? 'active' : 'completed') : ''}">
                <div class="step-icon"><i class="fa-solid fa-flag-checkered"></i></div>
                <span class="step-text">Resolved</span>
            </div>
        </div>
    `;
}

// --- Universal Authentication & Database Session Handlers ---
async function handleUniversalLogin(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value.trim();
    const errMsg = document.getElementById("loginErrMsg");

    if (!email || !password) {
        if (errMsg) {
            errMsg.textContent = "Please enter both Email and Password!";
            errMsg.classList.remove("hidden");
        }
        return;
    }

    if (errMsg) errMsg.classList.add("hidden");

    let userObj;

    // Check if credentials match Admin
    if (email.toLowerCase() === "smartservice@gmail.com" && password === "amc123") {
        userObj = {
            email: "smartservice@gmail.com",
            name: "Municipal Admin",
            role: "admin"
        };
        currentUser = userObj;
        localStorage.setItem("amc_user", JSON.stringify(userObj));
        isAdminLoggedIn = true;

        document.getElementById("universalAuthModal").classList.add("hidden");
        document.getElementById("universalLoginForm").reset();
        
        checkSessionState();
        showAdminDashboard();
        showToast("Welcome Municipal Administrator! Access granted to Dashboard.", "success");
        return;
    }

    // Standard Citizen Login & Firebase Cloud Database Authentication
    const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, "_");

    try {
        // Fetch user profile from Firebase Realtime Database
        const res = await fetch(getFirebaseUserUrl(emailKey));
        let existingUser = null;

        if (res.ok) {
            existingUser = await res.json();
        }

        if (existingUser && existingUser.email) {
            // Existing User: Verify Password
            if (existingUser.password === password) {
                userObj = {
                    email: existingUser.email,
                    name: existingUser.name,
                    role: "citizen"
                };
                currentUser = userObj;
                localStorage.setItem("amc_user", JSON.stringify(userObj));
                isAdminLoggedIn = false;

                document.getElementById("universalAuthModal").classList.add("hidden");
                document.getElementById("universalLoginForm").reset();

                checkSessionState();
                showToast(`Welcome back ${userObj.name}! Signed in successfully.`, "success");
            } else {
                // Incorrect Password
                if (errMsg) {
                    errMsg.textContent = "Incorrect password for this account! Please try again.";
                    errMsg.classList.remove("hidden");
                }
                showToast("Incorrect password for this email!", "danger");
            }
        } else {
            // New User: Save profile to Firebase Database
            const rawName = email.split('@')[0];
            const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            
            const newUserRecord = {
                email: email,
                password: password,
                name: formattedName,
                role: "citizen",
                createdAt: new Date().toISOString()
            };

            // Save to Firebase Database at /users/{emailKey}.json
            await fetch(getFirebaseUserUrl(emailKey), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newUserRecord)
            });

            userObj = {
                email: email,
                name: formattedName,
                role: "citizen"
            };
            currentUser = userObj;
            localStorage.setItem("amc_user", JSON.stringify(userObj));
            isAdminLoggedIn = false;

            document.getElementById("universalAuthModal").classList.add("hidden");
            document.getElementById("universalLoginForm").reset();

            checkSessionState();
            showToast(`Account registered & saved to cloud database! Welcome ${formattedName}.`, "success");
        }
    } catch (err) {
        console.warn("Database user auth error, fallback active:", err);
        const rawName = email.split('@')[0];
        const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        userObj = {
            email: email,
            name: formattedName,
            role: "citizen"
        };
        currentUser = userObj;
        localStorage.setItem("amc_user", JSON.stringify(userObj));
        isAdminLoggedIn = false;

        document.getElementById("universalAuthModal").classList.add("hidden");
        document.getElementById("universalLoginForm").reset();

        checkSessionState();
        showToast(`Welcome ${formattedName}! Signed in locally.`, "info");
    }
}

function handleLogout() {
    localStorage.removeItem("amc_user");
    currentUser = null;
    isAdminLoggedIn = false;

    const dashView = document.getElementById("adminDashboardView");
    if (dashView) dashView.classList.add("hidden");

    checkSessionState();
    showToast("Signed out successfully.", "info");
}

function showAdminDashboard() {
    loadComplaintsFromStorage();
    const dashView = document.getElementById("adminDashboardView");
    if (dashView) {
        dashView.classList.remove("hidden");
        renderAdminTable();
        updateAdminMetrics();
    }
}

function updateAdminMetrics() {
    document.getElementById("admTotal").textContent = complaints.length;
    document.getElementById("admPending").textContent = complaints.filter(c => c.status === "Pending").length;
    document.getElementById("admConfirmed").textContent = complaints.filter(c => c.status === "Confirmed").length;
    document.getElementById("admOnWay").textContent = complaints.filter(c => c.status === "On Way").length;
    document.getElementById("admResolved").textContent = complaints.filter(c => c.status === "Resolved").length;
}

// --- Render Admin Complaints Table ---
function renderAdminTable() {
    const tbody = document.getElementById("adminComplaintsTableBody");
    const searchVal = (document.getElementById("adminSearchInput")?.value || "").toLowerCase();
    const filterStatus = document.getElementById("adminStatusFilter")?.value || "ALL";

    if (!tbody) return;

    updateAdminMetrics();

    const filtered = complaints.filter(c => {
        const matchesSearch = c.id.toLowerCase().includes(searchVal) ||
                              c.userName.toLowerCase().includes(searchVal) ||
                              c.userRole.toLowerCase().includes(searchVal) ||
                              c.serviceCategory.toLowerCase().includes(searchVal) ||
                              c.location.toLowerCase().includes(searchVal);

        const matchesStatus = (filterStatus === "ALL") || (c.status === filterStatus);
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center" style="padding: 3rem; color: var(--text-muted);">
                    No complaints matching current filters.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(c => {
        return `
            <tr>
                <td><strong>${c.id}</strong></td>
                <td>
                    <strong>${escapeHtml(c.userName)}</strong><br>
                    <span class="role-tag">${escapeHtml(c.userRole)}</span>
                </td>
                <td>
                    ${escapeHtml(c.serviceCategory)}<br>
                    <small style="color: ${c.priority === 'Critical Emergency' ? 'var(--danger)' : 'var(--text-muted)'}; font-weight: 600;">
                        ${c.priority}
                    </small>
                </td>
                <td>
                    <i class="fa-solid fa-location-dot"></i> ${escapeHtml(c.location)}<br>
                    <small style="color: var(--text-muted);">${c.dateSubmitted}</small>
                </td>
                <td>
                    ${c.photo ? `<img src="${c.photo}" alt="Thumb" class="table-img-thumb" onclick="openLightbox('${c.photo}', '${c.id}')">` : '<span style="color:var(--text-muted);">No photo</span>'}
                </td>
                <td>
                    <span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span>
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <select class="status-select" onchange="updateComplaintStatus('${c.id}', this.value)">
                            <option value="Pending" ${c.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Confirmed" ${c.status === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="On Way" ${c.status === 'On Way' ? 'selected' : ''}>On Way</option>
                            <option value="Resolved" ${c.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                            <option value="Rejected" ${c.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                        <button class="btn btn-sm btn-outline" onclick="viewComplaintDetails('${c.id}')" title="View Full Details & Photo">
                            <i class="fa-solid fa-eye"></i> View
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteComplaint('${c.id}')" title="Delete Complaint">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// --- Update Status Handler ---
function updateComplaintStatus(id, newStatus) {
    updateStatusInCloud(id, newStatus);
}

// --- Delete Complaint ---
function deleteComplaint(id) {
    deleteComplaintFromCloud(id);
}

// --- View Full Details Modal ---
function viewComplaintDetails(id) {
    const c = complaints.find(item => item.id === id);
    if (!c) return;

    const modalHeader = document.getElementById("detailsHeader");
    const modalBody = document.getElementById("detailsBody");
    const detailsModal = document.getElementById("detailsModal");

    modalHeader.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <h3><i class="fa-solid fa-file-lines"></i> Complaint Details: ${c.id}</h3>
            <span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span>
        </div>
    `;

    modalBody.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; background: #f8fafc; padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border-color);">
            <div>
                <p style="margin-bottom: 0.5rem;"><strong>Citizen Name:</strong> ${escapeHtml(c.userName)}</p>
                <p style="margin-bottom: 0.5rem;"><strong>Citizen Role:</strong> <span class="role-tag">${escapeHtml(c.userRole)}</span></p>
                <p style="margin-bottom: 0.5rem;"><strong>Service Department:</strong> ${escapeHtml(c.serviceCategory)}</p>
                <p style="margin-bottom: 0.5rem;"><strong>Priority Level:</strong> <span style="color: ${c.priority === 'Critical Emergency' ? 'var(--danger)' : 'var(--primary)'}; font-weight: 700;">${c.priority}</span></p>
            </div>
            <div>
                <p style="margin-bottom: 0.5rem;"><strong>Location Address:</strong> ${escapeHtml(c.location)}</p>
                <p style="margin-bottom: 0.5rem;"><strong>Filing Date & Time:</strong> ${c.dateSubmitted}</p>
                ${isAdminLoggedIn ? `
                    <div style="margin-top: 0.75rem;">
                        <label style="font-weight: 700; font-size: 0.85rem; display: block; margin-bottom: 0.25rem;">Update Status:</label>
                        <select class="status-select" onchange="updateComplaintStatus('${c.id}', this.value); viewComplaintDetails('${c.id}');">
                            <option value="Pending" ${c.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Confirmed" ${c.status === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="On Way" ${c.status === 'On Way' ? 'selected' : ''}>On Way</option>
                            <option value="Resolved" ${c.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                            <option value="Rejected" ${c.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </div>
                ` : ''}
            </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
            <strong style="font-size: 1.05rem; display: block; margin-bottom: 0.5rem;"><i class="fa-solid fa-align-left"></i> Detailed Problem Description:</strong>
            <div class="complaint-desc" style="font-size: 1rem; line-height: 1.6; padding: 1rem; background: #ffffff; border-radius: 12px; border-left: 4px solid var(--primary); box-shadow: var(--shadow-sm);">${escapeHtml(c.description)}</div>
        </div>

        ${c.photo ? `
            <div>
                <strong style="font-size: 1.05rem; display: block; margin-bottom: 0.5rem;"><i class="fa-solid fa-camera"></i> Uploaded Photo Proof:</strong>
                <div style="margin-top: 0.5rem; text-align: center; background: #f1f5f9; padding: 1rem; border-radius: 12px;">
                    <img src="${c.photo}" alt="Uploaded Photo Proof" style="max-height: 320px; width: auto; max-width: 100%; border-radius: 12px; cursor: pointer; box-shadow: var(--shadow-md);" onclick="openLightbox('${c.photo}', '${c.id} - ${escapeHtml(c.serviceCategory)}')">
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Click photo to expand full screen</p>
                </div>
            </div>
        ` : ''}
    `;

    detailsModal.classList.remove("hidden");
}

// Lightbox Photo Opener
function openLightbox(imgSrc, captionText) {
    const modal = document.getElementById("imageLightboxModal");
    const img = document.getElementById("lightboxImg");
    const caption = document.getElementById("lightboxCaption");

    if (modal && img) {
        img.src = imgSrc;
        if (caption) caption.textContent = captionText;
        modal.classList.remove("hidden");
    }
}

// Utility: Badge CSS Classes
function getStatusBadgeClass(status) {
    switch (status) {
        case "Pending": return "badge-pending";
        case "Confirmed": return "badge-confirmed";
        case "On Way": return "badge-onway";
        case "Resolved": return "badge-resolved";
        case "Rejected": return "badge-rejected";
        default: return "badge-pending";
    }
}

// Utility: Update Hero Stats Counter
function updateHomeStats() {
    const resolvedCountEl = document.getElementById("statResolvedCount");
    const responseTimeEl = document.getElementById("statAvgResponseTime");
    const citizenCountEl = document.getElementById("statCitizenCount");

    // Confirmed / On Way / Resolved count as issues resolved
    const solvedList = complaints.filter(c => c.status === "Confirmed" || c.status === "On Way" || c.status === "Resolved");

    if (resolvedCountEl) {
        resolvedCountEl.textContent = solvedList.length;
    }

    if (citizenCountEl) {
        citizenCountEl.textContent = complaints.length;
    }

    if (responseTimeEl) {
        if (solvedList.length === 0) {
            responseTimeEl.textContent = "0 hrs";
        } else {
            let totalMinutes = 0;
            let countWithTime = 0;
            solvedList.forEach(c => {
                const subMs = c.timestampSubmitted || (c.dateSubmitted ? new Date(c.dateSubmitted).getTime() : Date.now());
                const confMs = c.timestampConfirmed || Date.now();
                if (!isNaN(subMs) && !isNaN(confMs) && confMs >= subMs) {
                    const diffMins = (confMs - subMs) / (1000 * 60);
                    totalMinutes += Math.max(1, diffMins);
                    countWithTime++;
                }
            });

            if (countWithTime === 0) {
                responseTimeEl.textContent = "0 hrs";
            } else {
                const avgMins = totalMinutes / countWithTime;
                if (avgMins < 60) {
                    responseTimeEl.textContent = Math.round(avgMins) + " mins";
                } else {
                    const avgHours = (avgMins / 60).toFixed(1);
                    responseTimeEl.textContent = avgHours + " hrs";
                }
            }
        }
    }
}

// Utility: Toast Notification System
function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "danger") icon = "fa-circle-exclamation";

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Utility: HTML Escape Sanitizer
function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, function (m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

function setCurrentYear() {
    const yearEl = document.getElementById("currentYear");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
}
