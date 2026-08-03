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
        } catch (e) { }
    }

    loadComplaintsFromStorage();
    setupEventListeners();
    renderUserComplaints();
    updateHomeStats();
    setCurrentYear();
    checkSessionState();
    setupGlobalSync();
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

    // Close Mobile Nav on link click
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
            if (navMenu) navMenu.classList.remove("active");
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
        trackSection.scrollIntoView({ behavior: "smooth" });
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
            <div class="col-span-1 md:col-span-2 lg:col-span-3 text-center py-16 px-6 w-full bg-white rounded-3xl border-2 border-dashed border-slate-300">
                <i class="fa-solid fa-clipboard-list text-6xl text-blue-400 mb-4"></i>
                <h3 class="text-slate-900 font-heading font-bold text-2xl mb-2">No Active Grievances in Portal</h3>
                <p class="text-slate-500 text-[0.95rem] max-w-[520px] mx-auto mb-6">
                    When citizens or users submit a municipal complaint from the portal form above, their grievances will appear here globally in real-time.
                </p>
                <a href="#file-complaint" class="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-[0_4px_15px_rgba(37,99,235,0.3)] hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-[0_8px_25px_rgba(37,99,235,0.4)] transition-all">
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
            <div class="bg-white rounded-3xl p-6 md:p-8 shadow-[0_2px_15px_rgba(0,0,0,0.04)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-slate-100 flex flex-col group relative overflow-hidden">
                <div class="flex justify-between items-start mb-6">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 font-bold text-xs rounded-lg uppercase tracking-wider font-heading"><i class="fa-solid fa-hashtag text-slate-400"></i> ${c.id}</span>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${statusBadgeClass}">${c.status}</span>
                </div>

                <div class="flex items-center gap-4 mb-6">
                    <div class="w-12 h-12 bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0 shadow-inner">${c.userName.charAt(0).toUpperCase()}</div>
                    <div class="flex flex-col">
                        <h4 class="font-bold text-slate-900 m-0 text-[1.05rem]">${escapeHtml(c.userName)}</h4>
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[0.7rem] font-bold uppercase tracking-wider mt-1 w-fit"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(c.userRole)}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-100/50">
                    <div class="text-slate-500 text-[0.85rem] flex items-center gap-2"><strong class="text-slate-800">${escapeHtml(c.serviceCategory)}</strong></div>
                    <div class="text-slate-500 text-[0.85rem] flex items-center gap-2 truncate" title="${escapeHtml(c.location)}"><i class="fa-solid fa-location-dot text-blue-400"></i> <span class="truncate">${escapeHtml(c.location)}</span></div>
                    <div class="text-slate-500 text-[0.85rem] flex items-center gap-2 sm:col-span-2"><i class="fa-regular fa-clock text-slate-400"></i> ${c.dateSubmitted}</div>
                </div>

                <p class="text-slate-600 text-[0.95rem] leading-relaxed mb-6 line-clamp-3">${escapeHtml(c.description)}</p>

                ${(c.status === "Confirmed" || c.status === "On Way" || c.status === "Resolved") ? `
                    <div class="flex items-start gap-3 bg-emerald-50 text-emerald-800 p-4 rounded-xl text-[0.9rem] mb-6 border border-emerald-100">
                        <i class="fa-solid fa-circle-check mt-0.5 text-emerald-500 text-lg"></i>
                        <span><strong>Problem Confirmed/Solved:</strong> ${escapeHtml(c.serviceCategory)} at ${escapeHtml(c.location)}</span>
                    </div>
                ` : ''}

                ${c.photo ? `<img src="${c.photo}" alt="Uploaded Complaint Photo Proof" class="w-full h-[200px] object-cover rounded-2xl mb-6 cursor-pointer hover:opacity-95 transition-opacity bg-slate-100 border border-slate-200/60" loading="lazy" onclick="openLightbox('${c.photo}', '${c.id} - ${escapeHtml(c.serviceCategory)}')">` : ''}

                <div class="mt-auto pt-6 border-t border-slate-100">
                    ${timelineHtml}
                </div>
            </div>
        `;
    }).join("");
}

// Generate Status Timeline HTML
function renderTimeline(status) {
    const steps = ["Pending", "Confirmed", "On Way", "Resolved"];
    const currentIndex = steps.indexOf(status);

    if (status === "Rejected") {
        return `
            <div class="text-center text-red-600 text-[0.85rem] font-bold p-3 bg-red-50 rounded-xl border border-red-100">
                <i class="fa-solid fa-circle-xmark mr-1"></i> Grievance Rejected by Administration
            </div>
        `;
    }

    const iconClasses = (idx) => {
        if (currentIndex === idx) return "bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.4)]"; // Active
        if (currentIndex > idx) return "bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]"; // Completed
        return "bg-slate-200 text-slate-400"; // Future
    };

    return `
        <div class="flex items-center justify-between relative isolate">
            <div class="absolute top-1/2 left-0 w-full h-1 bg-slate-100 -translate-y-1/2 -z-10 rounded-full"></div>
            ${currentIndex > 0 ? `<div class="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-emerald-400 to-emerald-500 -translate-y-1/2 -z-10 rounded-full transition-all duration-500" style="width: ${(currentIndex / 3) * 100}%"></div>` : ''}
            
            <div class="flex flex-col items-center gap-2 bg-white px-2">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-[0.8rem] transition-all duration-300 ${iconClasses(0)}"><i class="fa-solid fa-clock"></i></div>
                <span class="text-[0.65rem] uppercase tracking-wider transition-colors duration-300 ${currentIndex >= 0 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'}">Pending</span>
            </div>
            <div class="flex flex-col items-center gap-2 bg-white px-2">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-[0.8rem] transition-all duration-300 ${iconClasses(1)}"><i class="fa-solid fa-check"></i></div>
                <span class="text-[0.65rem] uppercase tracking-wider transition-colors duration-300 ${currentIndex >= 1 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'}">Confirmed</span>
            </div>
            <div class="flex flex-col items-center gap-2 bg-white px-2">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-[0.8rem] transition-all duration-300 ${iconClasses(2)}"><i class="fa-solid fa-truck-fast"></i></div>
                <span class="text-[0.65rem] uppercase tracking-wider transition-colors duration-300 ${currentIndex >= 2 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'}">On Way</span>
            </div>
            <div class="flex flex-col items-center gap-2 bg-white px-2">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-[0.8rem] transition-all duration-300 ${iconClasses(3)}"><i class="fa-solid fa-flag-checkered"></i></div>
                <span class="text-[0.65rem] uppercase tracking-wider transition-colors duration-300 ${currentIndex >= 3 ? 'text-slate-700 font-bold' : 'text-slate-400 font-medium'}">Resolved</span>
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
                <td colspan="7" class="text-center py-12 text-slate-500 font-medium">
                    No complaints matching current filters.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(c => {
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-5 py-4 whitespace-nowrap"><strong class="text-slate-900">${c.id}</strong></td>
                <td class="px-5 py-4">
                    <strong class="text-slate-800">${escapeHtml(c.userName)}</strong><br>
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[0.7rem] font-bold uppercase tracking-wider mt-1">${escapeHtml(c.userRole)}</span>
                </td>
                <td class="px-5 py-4">
                    <span class="text-slate-700 font-medium">${escapeHtml(c.serviceCategory)}</span><br>
                    <small class="${c.priority === 'Critical Emergency' ? 'text-red-500' : 'text-slate-500'} font-bold text-[0.75rem]">
                        ${c.priority}
                    </small>
                </td>
                <td class="px-5 py-4 max-w-[200px]">
                    <div class="truncate text-slate-700 font-medium"><i class="fa-solid fa-location-dot text-blue-400 mr-1"></i> ${escapeHtml(c.location)}</div>
                    <small class="text-slate-500 text-[0.75rem]">${c.dateSubmitted}</small>
                </td>
                <td class="px-5 py-4 text-center">
                    ${c.photo ? `<img src="${c.photo}" alt="Thumb" class="w-12 h-12 rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity border border-slate-200 mx-auto shadow-sm" onclick="openLightbox('${c.photo}', '${c.id}')">` : '<span class="text-slate-400 text-sm italic">No photo</span>'}
                </td>
                <td class="px-5 py-4">
                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[0.75rem] font-bold uppercase tracking-wide border ${getStatusBadgeClass(c.status)}">${c.status}</span>
                </td>
                <td class="px-5 py-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <select class="px-2 py-1.5 border border-slate-300 rounded-md text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-white font-medium cursor-pointer min-w-[100px]" onchange="updateComplaintStatus('${c.id}', this.value)">
                            <option value="Pending" ${c.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="Confirmed" ${c.status === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="On Way" ${c.status === 'On Way' ? 'selected' : ''}>On Way</option>
                            <option value="Resolved" ${c.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                            <option value="Rejected" ${c.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                        <button class="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-md hover:bg-blue-600 hover:text-white transition-colors border border-blue-100" onclick="viewComplaintDetails('${c.id}')" title="View Full Details & Photo">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button class="w-8 h-8 flex items-center justify-center bg-red-50 text-red-600 rounded-md hover:bg-red-600 hover:text-white transition-colors border border-red-100" onclick="deleteComplaint('${c.id}')" title="Delete Complaint">
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
        <div class="flex items-center justify-between w-full pr-6">
            <h3 class="font-heading font-bold text-xl text-slate-800 m-0 flex items-center gap-2"><i class="fa-solid fa-file-lines text-blue-600"></i> Complaint Details: ${c.id}</h3>
            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${getStatusBadgeClass(c.status)}">${c.status}</span>
        </div>
    `;

    modalBody.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div class="space-y-3">
                <p class="text-[0.95rem] m-0"><strong class="text-slate-800">Citizen Name:</strong> <span class="text-slate-600">${escapeHtml(c.userName)}</span></p>
                <p class="text-[0.95rem] m-0 flex items-center gap-2"><strong class="text-slate-800">Citizen Role:</strong> <span class="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[0.7rem] font-bold uppercase tracking-wider">${escapeHtml(c.userRole)}</span></p>
                <p class="text-[0.95rem] m-0"><strong class="text-slate-800">Service Department:</strong> <span class="text-slate-600">${escapeHtml(c.serviceCategory)}</span></p>
                <p class="text-[0.95rem] m-0"><strong class="text-slate-800">Priority Level:</strong> <span class="${c.priority === 'Critical Emergency' ? 'text-red-600' : 'text-blue-600'} font-bold">${c.priority}</span></p>
            </div>
            <div class="space-y-3">
                <p class="text-[0.95rem] m-0"><strong class="text-slate-800">Location Address:</strong> <span class="text-slate-600">${escapeHtml(c.location)}</span></p>
                <p class="text-[0.95rem] m-0"><strong class="text-slate-800">Filing Date & Time:</strong> <span class="text-slate-600">${c.dateSubmitted}</span></p>
                ${isAdminLoggedIn ? `
                    <div class="pt-3 mt-3 border-t border-slate-200">
                        <label class="font-bold text-[0.85rem] text-slate-800 block mb-1.5">Update Status:</label>
                        <select class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-white font-medium cursor-pointer" onchange="updateComplaintStatus('${c.id}', this.value); viewComplaintDetails('${c.id}');">
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

        <div class="mb-8">
            <strong class="text-[1.05rem] text-slate-800 block mb-3 flex items-center gap-2"><i class="fa-solid fa-align-left text-slate-400"></i> Detailed Problem Description:</strong>
            <div class="text-[0.95rem] leading-relaxed p-5 bg-white rounded-xl border-l-4 border-l-blue-500 border border-slate-200 shadow-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(c.description)}</div>
        </div>

        ${c.photo ? `
            <div>
                <strong class="text-[1.05rem] text-slate-800 block mb-3 flex items-center gap-2"><i class="fa-solid fa-camera text-slate-400"></i> Uploaded Photo Proof:</strong>
                <div class="mt-2 text-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <img src="${c.photo}" alt="Uploaded Photo Proof" class="max-h-[320px] w-auto max-w-full rounded-lg cursor-pointer shadow-md hover:opacity-90 transition-opacity border border-slate-300 mx-auto" onclick="openLightbox('${c.photo}', '${c.id} - ${escapeHtml(c.serviceCategory)}')">
                    <p class="text-[0.8rem] text-slate-500 mt-3 font-medium">Click photo to expand full screen</p>
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
        case "Pending": return "bg-amber-50 text-amber-600 border-amber-200";
        case "Confirmed": return "bg-blue-50 text-blue-600 border-blue-200";
        case "On Way": return "bg-indigo-50 text-indigo-600 border-indigo-200";
        case "Resolved": return "bg-emerald-50 text-emerald-600 border-emerald-200";
        case "Rejected": return "bg-red-50 text-red-600 border-red-200";
        default: return "bg-slate-50 text-slate-600 border-slate-200";
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
    let bgColors = "bg-slate-800 text-white border-slate-700";
    let icon = "fa-circle-info text-blue-400";
    
    if (type === "success") {
        bgColors = "bg-emerald-50 text-emerald-800 border-emerald-200 shadow-emerald-500/20";
        icon = "fa-circle-check text-emerald-500";
    }
    if (type === "danger") {
        bgColors = "bg-red-50 text-red-800 border-red-200 shadow-red-500/20";
        icon = "fa-circle-exclamation text-red-500";
    }
    if (type === "info") {
        bgColors = "bg-blue-50 text-blue-800 border-blue-200 shadow-blue-500/20";
        icon = "fa-circle-info text-blue-500";
    }

    toast.className = `flex items-center gap-3 px-5 py-3.5 rounded-xl border shadow-lg font-medium text-[0.95rem] max-w-sm pointer-events-auto transition-all duration-300 transform translate-x-0 opacity-100 ${bgColors}`;

    toast.innerHTML = `<i class="fa-solid ${icon} text-xl flex-shrink-0"></i> <span>${escapeHtml(message)}</span>`;
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
