// ==================== AUTHENTICATION & GLOBAL FETCH INTERCEPTOR ====================
let currentUser = null;
let authToken = sessionStorage.getItem('tg_auth_token') || localStorage.getItem('tg_auth_token') || null;

// Intercept window.fetch to automatically attach Bearer token and handle 401s
const _nativeFetch = window.fetch.bind(window);
const _rawFetch = async function(url, options = {}) {
  try {
    return await _nativeFetch(url, options);
  } catch (err) {
    if (typeof url === 'string' && url.startsWith('/') && window.location.hostname.includes('netlify.app')) {
      const fallbackUrl = `https://crm.thedigitalfrog.com${url}`;
      console.warn(`[Netlify Fallback] Failed fetching ${url}, retrying direct to ${fallbackUrl}`);
      return await _nativeFetch(fallbackUrl, options);
    }
    throw err;
  }
};

window.fetch = async function (url, options = {}) {
  options = options || {};
  options.headers = options.headers || {};

  if (options.headers instanceof Headers) {
    if (authToken && !options.headers.has('Authorization')) {
      options.headers.set('Authorization', `Bearer ${authToken}`);
    }
  } else if (typeof options.headers === 'object') {
    if (authToken && !options.headers['Authorization']) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }
  }

  try {
    const res = await _rawFetch(url, options);
    // If 401 Unauthorized, intercept and prompt login overlay (excluding login, password reset, or public scorecard)
    if (res.status === 401 && typeof url === 'string') {
      const isPublic = url.includes('/api/auth/login') || 
                       url.includes('/api/auth/forgot-password') || 
                       url.includes('/api/auth/reset-password') || 
                       url.includes('/api/scorecard/config') || 
                       url.includes('/api/scorecard/submit') || 
                       url.includes('/prescriptions/');
      if (!isPublic) {
        console.warn('[Auth Interceptor] 401 Unauthorized on:', url);
        authToken = null;
        currentUser = null;
        sessionStorage.removeItem('tg_auth_token');
        localStorage.removeItem('tg_auth_token');
        showLoginOverlay('Session expired or login required. Please sign in.');
      }
    }
    return res;
  } catch (err) {
    throw err;
  }
};

// Universal Clipboard copy with fallback for all browser contexts
async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed, using textarea fallback:', err);
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback clipboard copy failed:', err);
    return false;
  }
}

function showLoginOverlay(msg) {
  const container = document.getElementById('app-container');
  if (container) container.style.setProperty('display', 'none', 'important');
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.setProperty('display', 'flex', 'important');
  const badge = document.getElementById('user-profile-badge');
  const btnLogin = document.getElementById('btn-header-login');
  const errorAlert = document.getElementById('login-error-alert');
  const errorText = document.getElementById('login-error-text');

  if (badge) badge.style.display = 'none';
  if (btnLogin) btnLogin.style.display = 'inline-flex';

  if (msg && errorText && errorAlert) {
    errorText.innerText = msg;
    errorAlert.style.display = 'flex';
  } else if (errorAlert) {
    errorAlert.style.display = 'none';
  }

  const pubLink = document.getElementById('login-pub-scorecard-link');
  if (pubLink) {
    const base = (activePublicUrl || window.location.origin).replace(/\/+$/, '');
    pubLink.href = `${base}/scorecard`;
    pubLink.innerText = `${base}/scorecard ↗`;
  }
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.setProperty('display', 'none', 'important');
  const container = document.getElementById('app-container');
  if (container) container.style.setProperty('display', 'flex', 'important');
}

function showForgotPasswordView(e) {
  if (e) e.preventDefault();
  const loginFormWrap = document.getElementById('login-view-form');
  const forgotPwWrap = document.getElementById('forgot-pw-view');
  const errorAlert = document.getElementById('login-error-alert');
  if (errorAlert) errorAlert.style.display = 'none';

  if (loginFormWrap) loginFormWrap.style.display = 'none';
  if (forgotPwWrap) forgotPwWrap.style.display = 'block';

  const resetIdentifier = document.getElementById('reset-identifier');
  if (resetIdentifier) resetIdentifier.focus();
}

function showLoginView(e) {
  if (e) e.preventDefault();
  const loginFormWrap = document.getElementById('login-view-form');
  const forgotPwWrap = document.getElementById('forgot-pw-view');
  const errorAlert = document.getElementById('login-error-alert');
  if (errorAlert) errorAlert.style.display = 'none';

  if (forgotPwWrap) forgotPwWrap.style.display = 'none';
  if (loginFormWrap) loginFormWrap.style.display = 'block';

  const usernameInput = document.getElementById('login-username');
  if (usernameInput) usernameInput.focus();
}

function togglePasswordVisibilityById(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function toggleLoginPasswordVisibility() {
  const pwInput = document.getElementById('login-password');
  if (!pwInput) return;
  pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
}

async function requestResetCode() {
  const identifierInput = document.getElementById('reset-identifier');
  const btn = document.getElementById('btn-request-code');
  const statusDiv = document.getElementById('reset-code-status');
  const errorAlert = document.getElementById('login-error-alert');
  const errorText = document.getElementById('login-error-text');

  const email = identifierInput ? identifierInput.value.trim() : '';
  if (!email) {
    if (errorText) errorText.innerText = 'Please enter your registered Super Admin email.';
    if (errorAlert) errorAlert.style.display = 'flex';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Requesting OTP... ⏳';
  }
  if (errorAlert) errorAlert.style.display = 'none';

  try {
    const res = await _rawFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = '#10b981';
        statusDiv.innerHTML = `✅ <strong>Code generated!</strong> Check server terminal/logs or enter your <strong>Master Recovery Key</strong> below.`;
      }
      showLeadNotificationToast('🔑 Verification Code Generated', 'Check server terminal or use your Master Recovery Key.');
    } else {
      if (errorText) errorText.innerText = data.error || 'Unable to request password reset code.';
      if (errorAlert) errorAlert.style.display = 'flex';
    }
  } catch (err) {
    console.error('Request reset code error:', err);
    if (errorText) errorText.innerText = 'Connection error. Please try again.';
    if (errorAlert) errorAlert.style.display = 'flex';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Request 6-Digit OTP 📩';
    }
  }
}

async function doPasswordReset(e) {
  if (e) e.preventDefault();
  const identifierInput = document.getElementById('reset-identifier');
  const codeInput = document.getElementById('reset-code');
  const newPwInput = document.getElementById('reset-new-password');
  const confirmPwInput = document.getElementById('reset-confirm-password');
  const errorAlert = document.getElementById('login-error-alert');
  const errorText = document.getElementById('login-error-text');
  const submitBtn = document.getElementById('btn-submit-reset');

  const identifier = identifierInput ? identifierInput.value.trim() : '';
  const resetCode = codeInput ? codeInput.value.trim() : '';
  const newPassword = newPwInput ? newPwInput.value : '';
  const confirmPassword = confirmPwInput ? confirmPwInput.value : '';

  if (!identifier || !resetCode || !newPassword) {
    if (errorText) errorText.innerText = 'Please fill out all fields.';
    if (errorAlert) errorAlert.style.display = 'flex';
    return;
  }

  if (newPassword.length < 6) {
    if (errorText) errorText.innerText = 'New password must be at least 6 characters.';
    if (errorAlert) errorAlert.style.display = 'flex';
    return;
  }

  if (newPassword !== confirmPassword) {
    if (errorText) errorText.innerText = 'New passwords do not match.';
    if (errorAlert) errorAlert.style.display = 'flex';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying & Resetting... ⏳</span>';
  }
  if (errorAlert) errorAlert.style.display = 'none';

  try {
    const res = await _rawFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, resetCode, newPassword })
    });
    const data = await res.json();

    if (res.ok && data.success && data.token) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('tg_auth_token', authToken);
      hideLoginOverlay();
      showLoginView();
      applyRolePermissions();
      showLeadNotificationToast(`🎉 Password Reset Complete!`, `Signed in as ${currentUser.name || currentUser.username}.`);

      // Initialize all live feeds
      initWebSocket();
      checkPlatformStatuses(false);
      loadSearchKeywords();
      loadStats();
      loadLeads();
      if (currentUser.role === 'admin') {
        loadSettings();
      }
      loadTunnelStatus();
      checkCdpStatus();
      loadMapsStats();
      loadScorecardStats();
    } else {
      if (errorText) errorText.innerText = data.error || 'Failed to reset password. Check your code or key.';
      if (errorAlert) errorAlert.style.display = 'flex';
    }
  } catch (err) {
    console.error('Password reset error:', err);
    if (errorText) errorText.innerText = 'Server connection error during reset. Please try again.';
    if (errorAlert) errorAlert.style.display = 'flex';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Set New Password & Sign In 🔐</span>';
    }
  }
}

async function doLogin(e) {
  if (e) e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorAlert = document.getElementById('login-error-alert');
  const errorText = document.getElementById('login-error-text');
  const submitBtn = document.getElementById('btn-submit-login');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!username || !password) {
    if (errorText) errorText.innerText = 'Please enter both username/email and password.';
    if (errorAlert) errorAlert.style.display = 'flex';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying Credentials...</span>';
  }
  if (errorAlert) errorAlert.style.display = 'none';

  try {
    const res = await _rawFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok && data.success && data.token) {
      authToken = data.token;
      currentUser = data.user;
      sessionStorage.setItem('tg_auth_token', authToken);
      localStorage.setItem('tg_auth_token', authToken);
      hideLoginOverlay();
      applyRolePermissions();
      showLeadNotificationToast(`👋 Welcome, ${currentUser.name || currentUser.username}!`, `Signed in with ${currentUser.role.toUpperCase()} access.`);

      // Initialize all live feeds
      initWebSocket();
      checkPlatformStatuses(false);
      loadSearchKeywords();
      loadStats();
      loadLeads();
      if (currentUser.role === 'admin') {
        loadSettings();
      }
      loadTunnelStatus();
      checkCdpStatus();
      loadMapsStats();
      loadScorecardStats();

      const hashTab = window.location.hash.replace('#', '');
      if (hashTab) {
        switchTab(hashTab, false);
      }
    } else {
      if (errorText) errorText.innerText = data.error || 'Invalid email/username or password.';
      if (errorAlert) errorAlert.style.display = 'flex';
      if (passwordInput) passwordInput.value = '';
    }
  } catch (err) {
    console.error('Login error:', err);
    if (errorText) errorText.innerText = 'Unable to connect to server. Please try again.';
    if (errorAlert) errorAlert.style.display = 'flex';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Sign In to Growth Hub 🚀</span>';
    }
  }
}

async function logoutUser() {
  try {
    if (authToken) {
      await _rawFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    }
  } catch (e) {
    console.warn('Logout notification error:', e);
  }
  authToken = null;
  currentUser = null;
  sessionStorage.removeItem('tg_auth_token');
  localStorage.removeItem('tg_auth_token');
  showLoginOverlay('You have successfully signed out.');
}

async function checkAuthSession() {
  authToken = sessionStorage.getItem('tg_auth_token') || localStorage.getItem('tg_auth_token') || null;
  if (!authToken) {
    showLoginOverlay();
    return false;
  }
  try {
    const res = await _rawFetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        currentUser = data.user;
        applyRolePermissions();
        hideLoginOverlay();
        return true;
      }
    }
  } catch (e) {
    console.warn('Auth check error:', e);
  }
  authToken = null;
  currentUser = null;
  sessionStorage.removeItem('tg_auth_token');
  localStorage.removeItem('tg_auth_token');
  showLoginOverlay('Session expired or login required. Please sign in.');
  return false;
}

function applyRolePermissions() {
  const badge = document.getElementById('user-profile-badge');
  const avatar = document.getElementById('user-avatar-icon');
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const btnLogin = document.getElementById('btn-header-login');

  if (!currentUser) {
    if (badge) badge.style.display = 'none';
    if (btnLogin) btnLogin.style.display = 'inline-flex';
    return;
  }

  if (btnLogin) btnLogin.style.display = 'none';
  if (badge) badge.style.display = 'inline-flex';
  if (nameEl) nameEl.innerText = currentUser.name || currentUser.username;

  if (avatar) avatar.innerText = currentUser.role === 'admin' ? '👑' : '👤';
  if (roleEl) {
    roleEl.innerText = currentUser.role.toUpperCase();
    roleEl.className = `user-role-chip role-${currentUser.role}`;
  }

  // Admin tabs styling / restriction
  const adminTabs = ['autopilot', 'knowledge', 'accounts', 'settings'];
  adminTabs.forEach(tabKey => {
    const navBtn = document.getElementById(`nav-${tabKey}`);
    if (navBtn) {
      if (currentUser.role === 'assigned') {
        navBtn.style.opacity = '0.55';
        navBtn.title = '🔒 Restricted: Admin privilege required';
      } else {
        navBtn.style.opacity = '1';
        navBtn.title = '';
      }
    }
  });
}

// User & Team Management (Admin Only)
async function loadTeamUsers() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const tbody = document.getElementById('team-users-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/auth/users');
    if (!res.ok) return;
    const data = await res.json();
    const users = data.users || [];

    tbody.innerHTML = users.map(u => {
      const isSelf = u.id === currentUser.id;
      const roleBadge = u.role === 'admin' 
        ? '<span class="user-role-chip role-admin">👑 ADMIN</span>'
        : '<span class="user-role-chip role-assigned">👤 ASSIGNED</span>';
      const createdStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Initial';
      const lastLoginStr = u.last_login ? new Date(u.last_login).toLocaleString() : 'Never';

      return `
        <tr>
          <td>
            <strong>${escapeHtml(u.name || u.username)}</strong>
            <div class="user-mgmt-sub">@${escapeHtml(u.username)} ${u.email ? '• ' + escapeHtml(u.email) : ''}</div>
          </td>
          <td>${roleBadge}</td>
          <td class="text-dim">${createdStr}</td>
          <td class="text-dim">${lastLoginStr}</td>
          <td>
            ${isSelf 
              ? '<span class="user-role-chip role-admin" style="opacity:0.8;">(You)</span>' 
              : `<button class="btn btn-xs btn-outline-danger" onclick="deleteTeamUser(${u.id}, '${escapeHtml(u.username)}')" title="Delete account">🗑️ Delete</button>`
            }
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load team users:', err);
  }
}

async function createUserAccount(e) {
  if (e) e.preventDefault();
  const usernameInput = document.getElementById('new-user-username');
  const nameInput = document.getElementById('new-user-name');
  const passwordInput = document.getElementById('new-user-password');
  const roleInput = document.getElementById('new-user-role');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  const role = roleInput ? roleInput.value : 'assigned';

  if (!username || !password) {
    alert('Username and password are required');
    return;
  }

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, password, role })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showLeadNotificationToast('✅ Team Account Created', `Added @${username} as ${role.toUpperCase()}.`);
      if (usernameInput) usernameInput.value = '';
      if (nameInput) nameInput.value = '';
      if (passwordInput) passwordInput.value = '';
      loadTeamUsers();
    } else {
      alert(data.error || 'Failed to create user account');
    }
  } catch (err) {
    console.error('Create user error:', err);
    alert('Error creating user account');
  }
}

async function deleteTeamUser(id, username) {
  if (!confirm(`Are you sure you want to delete user account @${username}?`)) return;
  try {
    const res = await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showLeadNotificationToast('🗑️ User Removed', `Account @${username} deleted.`);
      loadTeamUsers();
    } else {
      alert(data.error || 'Failed to delete user');
    }
  } catch (err) {
    console.error('Delete user error:', err);
    alert('Error deleting user');
  }
}

// ==================== SUPER ADMIN SECURITY & RECOVERY KEY ====================
let currentRecoveryKey = '';
let isRecoveryKeyRevealed = false;

async function loadSuperAdminSecurity() {
  const displaySpan = document.getElementById('display-recovery-key');
  if (!displaySpan) return;

  try {
    const res = await fetch('/api/auth/recovery-key');
    if (res.ok) {
      const data = await res.json();
      currentRecoveryKey = data.recoveryKey || 'FROG-SURAJ-9921';
      displaySpan.innerText = isRecoveryKeyRevealed ? currentRecoveryKey : '••••-••••-••••';
    }
  } catch (err) {
    console.error('Failed to load recovery key:', err);
  }
}

function toggleRevealRecoveryKey() {
  const displaySpan = document.getElementById('display-recovery-key');
  const btn = document.getElementById('btn-reveal-key');
  if (!displaySpan || !currentRecoveryKey) return;

  isRecoveryKeyRevealed = !isRecoveryKeyRevealed;
  displaySpan.innerText = isRecoveryKeyRevealed ? currentRecoveryKey : '••••-••••-••••';
  if (btn) {
    btn.innerText = isRecoveryKeyRevealed ? 'Hide 🔒' : 'Reveal 👁️';
  }
}

async function copyRecoveryKey() {
  if (!currentRecoveryKey) {
    await loadSuperAdminSecurity();
  }
  if (!currentRecoveryKey) {
    alert('Recovery key not loaded yet.');
    return;
  }
  const copied = await copyToClipboard(currentRecoveryKey);
  if (copied) {
    showLeadNotificationToast('📋 Recovery Key Copied', 'Stored in clipboard. Keep it safely in your password manager!');
  } else {
    alert(`Your Master Recovery Key is: ${currentRecoveryKey}`);
  }
}

async function doSettingsChangePassword(e) {
  if (e) e.preventDefault();
  const currentInput = document.getElementById('change-pw-current');
  const newInput = document.getElementById('change-pw-new');
  const confirmInput = document.getElementById('change-pw-confirm');
  const statusSpan = document.getElementById('admin-security-status');
  const btn = document.getElementById('btn-submit-change-pw');

  const currentPassword = currentInput ? currentInput.value : '';
  const newPassword = newInput ? newInput.value : '';
  const confirmPassword = confirmInput ? confirmInput.value : '';

  if (!currentPassword || !newPassword) {
    alert('Please enter both your current password and a new password.');
    return;
  }
  if (newPassword.length < 6) {
    alert('New password must be at least 6 characters long.');
    return;
  }
  if (newPassword !== confirmPassword) {
    alert('New passwords do not match. Please verify.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Updating Password... ⏳</span>';
  }

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (statusSpan) {
        statusSpan.innerText = '✅ Password updated!';
        setTimeout(() => { if (statusSpan) statusSpan.innerText = ''; }, 4000);
      }
      showLeadNotificationToast('🔐 Password Changed', 'Your Super Admin password was updated successfully.');
      if (currentInput) currentInput.value = '';
      if (newInput) newInput.value = '';
      if (confirmInput) confirmInput.value = '';
    } else {
      alert(data.error || 'Failed to update password');
    }
  } catch (err) {
    console.error('Change password error:', err);
    alert('Error updating password');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Update Password 🔒</span>';
    }
  }
}

// State
let allLeads = [];
let currentActionLeadId = null;
let currentActionMode = 'engage'; // 'engage' | 'dm'
let ws = null;
let connectedPlatforms = ['threads', 'instagram', 'facebook']; // Default, updated dynamically
let currentViewMode = 'cards'; // 'cards' | 'table'
let currentPipelineStage = 'all'; // 'all' | 'discovered' | 'engaged' | 'dm_sent' | 'converted' | 'quality'
let currentSortBy = 'newest'; // 'newest' | 'intent' | 'freshness' | 'status'
let activeKeywords = [];
let modalKeywords = [];
let activePublicUrl = '';

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // First verify session
  const isAuthenticated = await checkAuthSession();
  if (!isAuthenticated) {
    showLoginOverlay();
    return;
  }

  initWebSocket();
  checkPlatformStatuses(false);
  loadSearchKeywords();
  loadStats();
  loadLeads();
  if (currentUser?.role === 'admin') {
    loadSettings();
  }
  loadTunnelStatus();
  checkCdpStatus();
  loadMapsStats();
  loadScorecardStats();

  // URL hash navigation support (#leads, #maps, #scorecard, #groups, #autopilot, etc.)
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab && ['overview', 'leads', 'maps', 'scorecard', 'groups', 'studio', 'autopilot', 'knowledge', 'accounts', 'settings'].includes(hashTab)) {
    switchTab(hashTab, false);
  }

  // Periodic poll for stats & CDP & live platform statuses
  setInterval(() => { if (authToken) loadStats(); }, 10000);
  setInterval(() => { if (authToken) loadMapsStats(); }, 12000);
  setInterval(() => { if (authToken) loadScorecardStats(); }, 12000);
  setInterval(() => { if (authToken) checkCdpStatus(); }, 15000);
  setInterval(() => { if (authToken) checkPlatformStatuses(false); }, 30000);
});

window.addEventListener('hashchange', () => {
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab && ['overview', 'leads', 'maps', 'scorecard', 'groups', 'studio', 'autopilot', 'knowledge', 'accounts', 'settings'].includes(hashTab)) {
    switchTab(hashTab, false);
  }
});

// ==================== TAB NAVIGATION ====================
function switchTab(tabId, updateHash = true) {
  // Role check: assigned specialists can only access overview, leads, maps, scorecard, studio
  if (currentUser && currentUser.role === 'assigned') {
    const adminTabs = ['autopilot', 'knowledge', 'accounts', 'settings'];
    if (adminTabs.includes(tabId)) {
      showLeadNotificationToast('🔒 Admin Restricted', 'Only Administrators have access to engine configuration and settings.');
      return;
    }
  }

  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetPane = document.getElementById(`tab-${tabId}`);
  const targetNav = document.getElementById(`nav-${tabId}`);

  if (targetPane) targetPane.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  const titles = {
    overview: 'Autonomous Growth Engine & Live Operations',
    leads: 'Social Lead Hunter & Opportunity CRM Pipeline',
    maps: 'Google Maps Local Business Hunter & AI Web Dev Engine',
    scorecard: 'Inbound Scorecard Leads & ℞ Digital Health Diagnostic Pipeline',
    groups: 'Facebook & LinkedIn Community Groups Hub (Admin Safe)',
    studio: 'Content Studio & Multi-Platform Publishing',
    autopilot: 'Autopilot Control Deck (Meta-Automation Engine)',
    knowledge: 'Knowledge Engine (Source of Truth & Grounding)',
    accounts: 'Persistent Browser Sessions (Zero APIs Required)',
    settings: 'Agent Reasoning Intelligence & Safety Rules'
  };
  document.getElementById('page-title').innerText = titles[tabId] || 'TDF Growth Hub & Lead Outreach Engine';

  if (updateHash && window.location.hash !== `#${tabId}`) {
    history.replaceState(null, '', `#${tabId}`);
  }

  if (tabId === 'maps') {
    loadMapsLeads();
    loadMapsStats();
  }
  if (tabId === 'scorecard') {
    loadScorecardLeads();
    loadScorecardStats();
  }
  if (tabId === 'groups') {
    loadDiscoveredGroups();
  }
  if (tabId === 'knowledge') loadKnowledgeFiles();
  if (tabId === 'autopilot') checkCdpStatus();
  if (tabId === 'settings') loadTeamUsers();
}

// ==================== WEBSOCKET & LIVE TERMINAL ====================
let wsFallbackTimer = null;

function startWebSocketFallback() {
  if (wsFallbackTimer) return;
  const indicator = document.getElementById('ws-indicator');
  if (indicator && indicator.innerText !== 'Connected & Listening') {
    indicator.innerText = 'Connected (Cloud Sync)';
  }
  wsFallbackTimer = setInterval(() => {
    if (authToken) {
      loadStats();
      loadTunnelStatus();
    }
  }, 8000);
}

function initWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const isNetlify = window.location.hostname.includes('netlify.app');
  let wsHost = window.location.host;
  let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // If on Netlify static hosting, connect directly to active backend Cloudflare tunnel
  if (isNetlify) {
    wsHost = 'crm.thedigitalfrog.com';
    wsProtocol = 'wss:';
  }

  const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  const wsUrl = `${wsProtocol}//${wsHost}${tokenQuery}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('WebSocket init exception:', err);
    startWebSocketFallback();
    return;
  }

  ws.onopen = () => {
    if (wsFallbackTimer) {
      clearInterval(wsFallbackTimer);
      wsFallbackTimer = null;
    }
    const indicator = document.getElementById('ws-indicator');
    if (indicator) indicator.innerText = 'Connected & Listening';
    appendTerminalLog('Connected to TDF Real-Time Event Hub', 'text-success');
    if (authToken) {
      try {
        ws.send(JSON.stringify({ type: 'auth', token: authToken }));
      } catch (e) {}
    }
  };

  ws.onerror = (err) => {
    console.warn('WebSocket connection error, starting HTTP sync fallback:', err);
    startWebSocketFallback();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        if (msg.tunnel?.publicUrl) {
          updatePublicTunnelUi(msg.tunnel.publicUrl);
        }
      } else if (msg.type === 'tunnel_online') {
        const url = msg.data?.publicUrl || msg.publicUrl;
        if (url) {
          updatePublicTunnelUi(url);
          appendTerminalLog(`🌐 Live Public Tunnel Active: ${url}`, 'text-emerald');
        }
      } else if (msg.type === 'log') {
        const isError = msg.data.error;
        appendTerminalLog(`[${msg.data.platform?.toUpperCase() || 'AGENT'}] ${msg.data.text}`, isError ? 'text-danger' : 'text-info');
      } else if (msg.type === 'engine_status') {
        appendTerminalLog(`⚡ Engine task [${msg.data.task}] finished with exit code ${msg.data.exitCode}`, msg.data.exitCode === 0 ? 'text-emerald' : 'text-warning');
        loadLeads();
        loadStats();
        checkCdpStatus();
      } else if (msg.type === 'scan_status') {
        if (msg.data.status === 'started') {
          appendTerminalLog(`🚀 Scan initiated across ${msg.data.platform}`, 'text-emerald');
        } else if (msg.data.status === 'completed') {
          const count = msg.data.totalCaptured || 0;
          appendTerminalLog(`✅ Scan cycle completed successfully. Discovered ${count} fresh inquiries.`, 'text-emerald');
          loadLeads();
          loadStats();
          if (count > 0) {
            showLeadNotificationToast('🎉 New Leads Captured!', `Captured ${count} new buyer requests across your connected channels.`);
          }
        } else if (msg.data.status === 'aborted') {
          appendTerminalLog(`⚠️ ${msg.data.reason || 'Scan aborted'}`, 'text-warning');
        }
      } else if (msg.type === 'leads_updated') {
        loadStats();
        loadLeads();
        if (msg.data?.newLeadsCount > 0) {
          showLeadNotificationToast('✨ Inquiries Pipeline Updated', `${msg.data.newLeadsCount} new leads ready for outreach.`);
        }
      } else if (msg.type === 'lead_verification_progress') {
        const p = msg.data;
        appendTerminalLog(`🛡️ [Verification] Checked ${p.current}/${p.total}: @${p.author} (Verified: ${p.verified}, Dead Purged: ${p.dead})`, 'text-info');
      } else if (msg.type === 'maps_lead_discovered') {
        const lead = msg.data;
        if (lead) {
          appendTerminalLog(`📍 [Google Maps] Discovered: ${lead.business_name} (${lead.has_website ? 'Has Site' : '🔥 NO WEBSITE'}, Phone: ${lead.phone || 'N/A'})`, lead.has_website ? 'text-info' : 'text-gold');
          loadMapsStats();
          loadMapsLeads();
        }
      } else if (msg.type === 'maps_lead_updated') {
        const lead = msg.data?.lead;
        if (lead) {
          appendTerminalLog(`⚡ [Google Maps] Re-verified: ${lead.business_name} (${lead.has_website ? 'Has Site' : '🔥 NO WEBSITE'}, Phone: ${lead.phone || 'N/A'})`, 'text-emerald');
          const idx = allMapsLeads.findIndex(l => l.id === lead.id);
          if (idx !== -1) allMapsLeads[idx] = lead;
          renderMapsCards(allMapsLeads);
          loadMapsStats();
        }
      } else if (msg.type === 'maps_reverify_progress') {
        const p = msg.data;
        appendTerminalLog(`🔄 [Maps Re-Verify] Checked ${p.current}/${p.total}: ${p.leadName}`, 'text-info');
      } else if (msg.type === 'maps_reverify_complete') {
        loadMapsStats();
        loadMapsLeads();
        showLeadNotificationToast('⚡ Re-Verification Complete', `Updated ${msg.data.updated || 0} leads with verified websites, phones & emails.`);
        const btn = document.getElementById('btn-maps-reverify-all');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '⚡ Re-Verify All Leads';
        }
      } else if (msg.type === 'social_hunter_progress') {
        const p = msg.data;
        const foundStr = Object.keys(p.socials || {}).join(', ') || 'searching...';
        appendTerminalLog(`🔍 [Social Hunter] (${p.current}/${p.total}) ${p.lead}: ${foundStr}`, 'text-info');
      } else if (msg.type === 'social_hunter_complete') {
        loadMapsStats();
        loadMapsLeads();
        showLeadNotificationToast('✅ Social Media Hunt Complete', `Enriched ${msg.data.count || 0} leads with verified social profiles.`);
        const btn = document.getElementById('btn-maps-find-all-socials');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '🔍 Find All Socials';
        }
      } else if (msg.type === 'social_engagement_batch_complete') {
        loadMapsStats();
        loadMapsLeads();
        showLeadNotificationToast('✅ Social Engagement Complete', `Pipeline finished: ${msg.data?.processed || 0} leads engaged.`);
        appendTerminalLog(`📱 Social engagement pipeline finished: ${msg.data?.processed || 0} leads engaged.`, 'text-emerald');
        const hBtn = document.getElementById('btn-header-engage-socials');
        if (hBtn) {
          hBtn.disabled = false;
          hBtn.innerHTML = `<span>📱 Engage Socials</span>`;
        }
      } else if (msg.type === 'maps_scan_complete') {
        loadMapsStats();
        loadMapsLeads();
        showLeadNotificationToast('📍 Google Maps Scan Complete', `Captured ${msg.data.count || 0} verified local leads. Ready to pitch!`);
      } else if (msg.type === 'scorecard_lead_new') {
        const lead = msg.data;
        appendTerminalLog(`📋 [Inbound Scorecard] New Test: ${lead.contactPerson} (${lead.businessName}) - Score: ${lead.scores?.overallScore}/100`, 'text-emerald');
        showLeadNotificationToast('📋 Inbound Scorecard Test Completed!', `${lead.contactPerson} from ${lead.businessName} just completed the test (Score: ${lead.scores?.overallScore}/100)!`);
        loadScorecardStats();
        if (window.location.hash === '#scorecard') {
          loadScorecardLeads();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  ws.onclose = () => {
    const indicator = document.getElementById('ws-indicator');
    if (indicator) indicator.innerText = 'Syncing (HTTP)...';
    startWebSocketFallback();
    setTimeout(initWebSocket, 6000);
  };
}

function appendTerminalLog(text, className = 'text-muted') {
  const time = new Date().toLocaleTimeString();
  const createLine = () => {
    const line = document.createElement('div');
    line.className = `terminal-line ${className}`;
    line.innerText = `[${time}] ${text}`;
    return line;
  };

  const terminal = document.getElementById('live-terminal');
  if (terminal) {
    terminal.appendChild(createLine());
    terminal.scrollTop = terminal.scrollHeight;
  }

  const autoTerminal = document.getElementById('autopilot-terminal');
  if (autoTerminal) {
    autoTerminal.appendChild(createLine());
    autoTerminal.scrollTop = autoTerminal.scrollHeight;
  }
}

function clearLiveLogs() {
  const t = document.getElementById('live-terminal');
  if (t) t.innerHTML = '<div class="terminal-line text-muted">Terminal cleared.</div>';
}

// ==================== KPI STATS & QUOTAS ====================
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const stats = data.stats || {};
    const quotas = data.quotas || {};

    document.getElementById('stat-total-leads').innerText = stats.total || 0;
    document.getElementById('stat-high-intent').innerText = stats.high_intent || 0;
    document.getElementById('stat-engaged').innerText = (stats.engaged || 0) + (stats.dm_sent || 0);
    document.getElementById('stat-converted').innerText = stats.converted || 0;
    document.getElementById('sidebar-lead-count').innerText = stats.total || 0;

    // Quotas progress bars
    updateQuotaProgress('threads', quotas.threads?.comments_count || 0, 20);
    updateQuotaProgress('linkedin', quotas.linkedin?.comments_count || 0, 20);
    updateQuotaProgress('facebook', quotas.facebook?.comments_count || 0, 20);
    updateQuotaProgress('instagram', (quotas.instagram?.comments_count || 0) + (quotas.instagram?.dms_count || 0), 20);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function updateQuotaProgress(platform, current, max) {
  const label = document.getElementById(`quota-${platform}-comments`);
  const bar = document.getElementById(`progress-${platform}`);
  if (label) label.innerText = `${current} / ${max}`;
  if (bar) {
    const percent = Math.min((current / max) * 100, 100);
    bar.style.width = `${percent}%`;
  }
}

// ==================== PLATFORM CONNECTION ENGINE ====================
async function checkPlatformStatuses(forceRefresh = false) {
  try {
    const res = await fetch(`/api/platforms${forceRefresh ? '?refresh=true' : ''}`);
    const data = await res.json();
    const platforms = data.platforms || [];

    connectedPlatforms = platforms.filter(p => p.loggedIn).map(p => p.platform);

    // Update banner pills
    const pillMap = {
      threads: document.getElementById('pill-threads'),
      instagram: document.getElementById('pill-instagram'),
      facebook: document.getElementById('pill-facebook'),
      linkedin: document.getElementById('pill-linkedin')
    };

    platforms.forEach(p => {
      const pill = pillMap[p.platform];
      if (pill) {
        if (p.loggedIn) {
          pill.className = 'channel-pill pill-active';
          pill.innerHTML = `${getPlatformIcon(p.platform)} ${capitalize(p.platform)} <small class="pill-status">🟢 Connected</small>`;
        } else {
          pill.className = 'channel-pill pill-inactive';
          pill.innerHTML = `${getPlatformIcon(p.platform)} ${capitalize(p.platform)} <small class="pill-status">⚪ Disconnected</small>`;
        }
      }
    });

    // Update platform filter dropdown labels
    const filterSelect = document.getElementById('filter-platform');
    if (filterSelect) {
      const currentVal = filterSelect.value;
      const connectedCount = connectedPlatforms.length;
      const opts = filterSelect.querySelectorAll('option');
      opts.forEach(opt => {
        if (opt.value === 'connected') {
          opt.textContent = `🟢 Connected Channels Only (${connectedCount} Active)`;
        } else if (opt.value === 'threads') {
          opt.textContent = `🧵 Threads (${connectedPlatforms.includes('threads') ? 'Connected' : 'Disconnected'})`;
        } else if (opt.value === 'instagram') {
          opt.textContent = `📸 Instagram (${connectedPlatforms.includes('instagram') ? 'Connected' : 'Disconnected'})`;
        } else if (opt.value === 'facebook') {
          opt.textContent = `👥 Facebook (${connectedPlatforms.includes('facebook') ? 'Connected' : 'Disconnected'})`;
        } else if (opt.value === 'linkedin') {
          opt.textContent = `💼 LinkedIn (${connectedPlatforms.includes('linkedin') ? 'Connected' : 'Disconnected'})`;
        }
      });
    }

    if (forceRefresh) {
      appendTerminalLog(`Channel auth check completed: ${connectedPlatforms.length} accounts verified.`, 'text-emerald');
      filterLeads();
    }
  } catch (err) {
    console.error('Failed to check platform auth:', err);
  }
}

function getPlatformIcon(platform) {
  const map = { threads: '🧵', instagram: '📸', facebook: '👥', linkedin: '💼' };
  return map[platform] || '🌐';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==================== SEARCH KEYWORDS & STRATEGY MANAGER ====================
async function loadSearchKeywords() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    let kw = settings.search_keywords;
    if (typeof kw === 'string') {
      try { kw = JSON.parse(kw); } catch (_) { kw = [kw]; }
    }
    activeKeywords = Array.isArray(kw) && kw.length > 0 ? kw : [
      'need a digital marketing agency',
      'looking for digital marketing agency',
      'recommend a marketing agency',
      'looking for social media manager',
      'who can run meta ads'
    ];
    renderKeywordChips();
  } catch (err) {
    console.error('Failed to load search keywords:', err);
  }
}

function renderKeywordChips() {
  const container = document.getElementById('keywords-chips-preview');
  const countBadge = document.getElementById('kw-active-count');
  const countBadge2 = document.getElementById('kw-count-badge');

  if (countBadge) countBadge.innerText = activeKeywords.length;
  if (countBadge2) countBadge2.innerText = activeKeywords.length;

  if (!container) return;

  if (activeKeywords.length === 0) {
    container.innerHTML = `<span class="text-dim" style="font-size:0.85rem;">No queries configured. Type a focus topic and click "Auto-Expand (AI)" to generate queries.</span>`;
    return;
  }

  // Display top chips with quick remove
  const displayLimit = 10;
  const visible = activeKeywords.slice(0, displayLimit);
  const remaining = activeKeywords.length - displayLimit;

  let html = visible.map((k, idx) => `
    <span class="kw-chip">
      <span class="kw-text">"${escapeHtml(k)}"</span>
      <button class="kw-del" onclick="removeKeywordChip(${idx})" title="Remove this search query">✕</button>
    </span>
  `).join('');

  if (remaining > 0) {
    html += `
      <span class="kw-chip kw-chip-more" onclick="openKeywordsModal()" title="View and edit all ${activeKeywords.length} queries">
        +${remaining} more queries...
      </span>
    `;
  }

  container.innerHTML = html;
}

async function removeKeywordChip(index) {
  activeKeywords.splice(index, 1);
  renderKeywordChips();
  try {
    await fetch('/api/keywords/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: activeKeywords })
    });
  } catch (e) {
    console.error(e);
  }
}

function openKeywordsModal() {
  modalKeywords = [...activeKeywords];
  const modal = document.getElementById('keywords-modal');
  if (modal) {
    modal.classList.add('active');
    renderModalKeywords();
  }
}

function closeKeywordsModal() {
  const modal = document.getElementById('keywords-modal');
  if (modal) modal.classList.remove('active');
}

function renderModalKeywords() {
  const container = document.getElementById('modal-kw-chips');
  const countEl = document.getElementById('modal-kw-count');
  if (countEl) countEl.innerText = modalKeywords.length;
  if (!container) return;

  if (modalKeywords.length === 0) {
    container.innerHTML = `<div class="text-dim" style="padding: 1rem; text-align: center;">No queries in list. Add a query above or generate with AI.</div>`;
    return;
  }

  container.innerHTML = modalKeywords.map((k, idx) => `
    <div class="kw-modal-chip">
      <span>"${escapeHtml(k)}"</span>
      <button onclick="removeModalKeyword(${idx})" class="kw-del-btn" title="Delete query">✕</button>
    </div>
  `).join('');
}

function addSingleKeyword() {
  const input = document.getElementById('kw-new-input');
  if (!input) return;
  const val = input.value.trim().toLowerCase();
  if (val && !modalKeywords.includes(val)) {
    modalKeywords.unshift(val);
    input.value = '';
    renderModalKeywords();
  }
}

function removeModalKeyword(idx) {
  modalKeywords.splice(idx, 1);
  renderModalKeywords();
}

function clearAllKeywords() {
  if (confirm('Clear all search queries?')) {
    modalKeywords = [];
    renderModalKeywords();
  }
}

async function saveKeywordsFromModal() {
  activeKeywords = [...modalKeywords];
  try {
    const res = await fetch('/api/keywords/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: activeKeywords })
    });
    const data = await res.json();
    if (data.success) {
      closeKeywordsModal();
      renderKeywordChips();
      appendTerminalLog(`Saved ${activeKeywords.length} search queries for lead scanning.`, 'text-emerald');
    }
  } catch (err) {
    alert('Failed to save queries: ' + err.message);
  }
}

async function expandKeywordsWithAI() {
  const topicInput = document.getElementById('kw-quick-topic');
  const btn = document.getElementById('btn-expand-kw');
  const topic = topicInput?.value.trim() || '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Expanding...</span>';
  }

  try {
    const res = await fetch('/api/keywords/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.keywords)) {
      // Merge unique keywords
      const merged = [...new Set([...activeKeywords, ...data.keywords])];
      activeKeywords = merged;
      renderKeywordChips();

      // Persist to backend
      await fetch('/api/keywords/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: activeKeywords })
      });

      appendTerminalLog(`✨ AI expanded search queries for "${topic || 'All Niche'}": Added ${data.keywords.length} high-intent phrases.`, 'text-emerald');
      showLearningToast('✨ Queries Expanded with AI', [
        `Generated <strong>${data.keywords.length} new high-intent queries</strong>.`,
        `Focus: <em>"${topic || 'Core Value Proposition'}"</em>`,
        `Ready for autonomous scanning across connected channels.`
      ], 'toast-positive');
    }
  } catch (err) {
    appendTerminalLog(`Keyword expansion error: ${err.message}`, 'text-danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>✨ Auto-Expand (AI)</span>';
    }
  }
}

async function expandTopicInModal() {
  const input = document.getElementById('kw-ai-topic-input');
  const btn = document.getElementById('btn-modal-expand');
  const topic = input?.value.trim() || '';

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Generating...';
  }

  try {
    const res = await fetch('/api/keywords/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.keywords)) {
      modalKeywords = [...new Set([...modalKeywords, ...data.keywords])];
      renderModalKeywords();
      if (input) input.value = '';
    }
  } catch (err) {
    alert('Error generating queries: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Generate 15 Queries ✨';
    }
  }
}

// ==================== AUDIO CHIME & NEW LEAD ALERTS ====================
function playLeadChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (_) {}
}

function showLeadNotificationToast(title, body) {
  playLeadChime();
  const existing = document.getElementById('live-lead-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'live-lead-toast';
  toast.className = 'live-lead-toast';
  toast.innerHTML = `
    <div class="toast-icon">✨</div>
    <div class="toast-content">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 6000);
}

function filterToNewLeads() {
  switchTab('leads');
  setPipelineStage('discovered');
  const leadsContainer = document.getElementById('tab-leads');
  if (leadsContainer) {
    leadsContainer.scrollIntoView({ behavior: 'smooth' });
  }
}

// ==================== LEAD HUNTER & CRM PIPELINE ====================
function cleanUrl(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

function formatTimestamp(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const now = Date.now();
    const diffMs = Math.max(0, now - d.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);

    let relative = '';
    if (diffHours < 1) {
      const mins = Math.max(1, Math.round(diffMs / (1000 * 60)));
      relative = `${mins}m ago`;
    } else if (diffHours < 24) {
      relative = `${Math.round(diffHours)}h ago`;
    } else {
      const days = Math.round(diffHours / 24);
      relative = `${days}d ago`;
    }

    const formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const formattedTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    return `<strong>${relative}</strong> <span class="ts-exact">(${formattedDate}, ${formattedTime})</span>`;
  } catch (_) {
    return isoStr;
  }
}

function setPipelineStage(stage) {
  currentPipelineStage = stage;
  document.querySelectorAll('#crm-pipeline-bar .stage-tab').forEach(tab => {
    if (tab.getAttribute('data-stage') === stage) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Sync outreach dropdown
  const outreachSelect = document.getElementById('filter-outreach');
  if (outreachSelect) {
    if (stage === 'all') outreachSelect.value = 'all';
    else if (stage === 'discovered') outreachSelect.value = 'new';
    else if (stage === 'engaged') outreachSelect.value = 'comment_done';
    else if (stage === 'dm_sent') outreachSelect.value = 'dm_done';
    else if (stage === 'converted') outreachSelect.value = 'converted';
  }

  filterLeads();
}

function onOutreachDropdownChange() {
  const val = document.getElementById('filter-outreach')?.value || 'all';
  if (val === 'all') {
    currentPipelineStage = 'all';
  } else if (val === 'new') {
    currentPipelineStage = 'discovered';
  } else if (val === 'comment_done') {
    currentPipelineStage = 'engaged';
  } else if (val === 'dm_done') {
    currentPipelineStage = 'dm_sent';
  } else if (val === 'reached_out') {
    currentPipelineStage = 'reached_out';
  } else if (val === 'converted') {
    currentPipelineStage = 'converted';
  }

  // Sync tab active states
  document.querySelectorAll('#crm-pipeline-bar .stage-tab').forEach(tab => {
    const tabStage = tab.getAttribute('data-stage');
    if (tabStage === currentPipelineStage || (val === 'all' && tabStage === 'all')) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  filterLeads();
}

function sortAndFilterLeads() {
  const sortSelect = document.getElementById('filter-sort');
  if (sortSelect) currentSortBy = sortSelect.value;
  const btn = document.getElementById('btn-sort-direction');
  if (btn) {
    if (currentSortBy === 'oldest' || currentSortBy === 'date_asc') {
      btn.innerHTML = '⬆️ Oldest First';
      btn.title = 'Switch to Newest First (Descending)';
    } else {
      btn.innerHTML = '⬇️ Newest First';
      btn.title = 'Switch to Oldest First (Ascending)';
    }
  }
  filterLeads();
}

function toggleSortDirection() {
  const sortSelect = document.getElementById('filter-sort');
  if (!sortSelect) return;
  if (sortSelect.value === 'newest' || sortSelect.value === 'date_desc') {
    sortSelect.value = 'oldest';
  } else {
    sortSelect.value = 'newest';
  }
  sortAndFilterLeads();
}

function setLeadView(mode) {
  currentViewMode = mode;
  document.getElementById('btn-view-cards')?.classList.toggle('active', mode === 'cards');
  document.getElementById('btn-view-table')?.classList.toggle('active', mode === 'table');
  filterLeads();
}

async function loadLeads() {
  try {
    const ageFilter = document.getElementById('filter-age')?.value || 'all';
    const sortBy = document.getElementById('filter-sort')?.value || 'newest';
    const res = await fetch(`/api/leads?limit=300&maxDays=${ageFilter}&sortBy=${sortBy}&connectedOnly=false`);
    if (!res.ok) {
      console.warn('Failed to load leads, status:', res.status);
      return;
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      allLeads = data;
    } else if (data && Array.isArray(data.leads)) {
      allLeads = data.leads;
    }
    filterLeads();
    updatePipelineCounters();
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

function updatePipelineCounters() {
  if (!Array.isArray(allLeads)) allLeads = [];
  // Disqualified and dead leads are excluded from pipeline counts
  const validLeads = allLeads.filter(l => l.feedback !== 'incorrect' && l.status !== 'disqualified' && l.verification_status !== 'dead');

  const total = validLeads.length;
  const newLeads = validLeads.filter(l => l.status === 'discovered' && !l.reached_out_at).length;
  const engaged = validLeads.filter(l => l.status === 'engaged' || Boolean(l.last_comment_url)).length;
  const dmSent = validLeads.filter(l => l.status === 'dm_sent').length;
  const converted = validLeads.filter(l => l.status === 'converted').length;
  const quality = validLeads.filter(l => l.feedback === 'correct').length;

  // Pipeline stage tabs
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setEl('count-stage-all', total);
  setEl('count-stage-new', newLeads);
  setEl('count-stage-engaged', engaged);
  setEl('count-stage-dm', dmSent);
  setEl('count-stage-converted', converted);
  setEl('count-stage-quality', quality);

  // Topbar notification bell
  const notifEl = document.getElementById('notif-lead-count');
  if (notifEl) {
    notifEl.innerText = newLeads;
    notifEl.style.display = newLeads > 0 ? 'inline-flex' : 'none';
  }

  // Sidebar counter - always unified with CRM total
  const sidebarEl = document.getElementById('sidebar-lead-count');
  if (sidebarEl) {
    sidebarEl.innerText = total;
    sidebarEl.classList.remove('has-new');
  }
}

function updateLeadCounter() {
  updatePipelineCounters();
}

function filterLeads() {
  if (!Array.isArray(allLeads)) allLeads = [];
  const platform = document.getElementById('filter-platform')?.value || 'all';
  const intent = document.getElementById('filter-intent')?.value || 'all';
  const age = document.getElementById('filter-age')?.value || 'all';
  const quality = document.getElementById('filter-quality')?.value || 'all';
  const outreachVal = document.getElementById('filter-outreach')?.value || 'all';

  const maxDays = age === 'all' ? 99999 : parseFloat(age);

  let filtered = allLeads.filter(lead => {
    // 1. Platform connection filter
    let matchPlatform = true;
    if (platform === 'connected' && connectedPlatforms && connectedPlatforms.length > 0) {
      matchPlatform = connectedPlatforms.includes(lead.platform);
    } else if (platform !== 'all' && platform !== 'connected') {
      matchPlatform = lead.platform === platform;
    }

    // 2. Buying intent filter
    let matchIntent = true;
    if (intent === 'high') matchIntent = lead.intent_score >= 70;
    if (intent === 'medium') matchIntent = lead.intent_score >= 45 && lead.intent_score < 70;

    // 3. Post age constraint
    const leadAge = lead.post_age_days !== undefined && lead.post_age_days !== null ? lead.post_age_days : 0;
    const matchAge = leadAge <= maxDays;

    // 4. Outreach & Pipeline Stage filter (Reachout, DM done, Comment done, New)
    let matchStage = true;
    if (outreachVal === 'new' || currentPipelineStage === 'discovered') {
      matchStage = (lead.status === 'discovered' && !lead.reached_out_at);
    } else if (outreachVal === 'comment_done') {
      matchStage = (lead.status === 'engaged' || Boolean(lead.last_comment_url));
    } else if (outreachVal === 'dm_done') {
      matchStage = (lead.status === 'dm_sent');
    } else if (outreachVal === 'reached_out') {
      matchStage = Boolean(lead.reached_out_at) || lead.status === 'engaged' || lead.status === 'dm_sent' || lead.status === 'converted';
    } else if (outreachVal === 'converted' || currentPipelineStage === 'converted') {
      matchStage = (lead.status === 'converted');
    } else if (currentPipelineStage === 'engaged') {
      matchStage = (lead.status === 'engaged' || Boolean(lead.last_comment_url));
    } else if (currentPipelineStage === 'dm_sent') {
      matchStage = (lead.status === 'dm_sent');
    } else if (currentPipelineStage === 'quality') {
      matchStage = (lead.feedback === 'correct');
    }

    // 5. Quality feedback filter
    let matchQuality = true;
    if (quality === 'correct') matchQuality = lead.feedback === 'correct';
    if (quality === 'incorrect') matchQuality = lead.feedback === 'incorrect';
    if (quality === 'unreviewed') matchQuality = !lead.feedback;

    // 6. Live verification filter (Defaults to 'all' so new unverified leads are fully visible)
    const verifiedFilter = document.getElementById('filter-verified')?.value || 'all';
    let matchVerified = true;
    if (verifiedFilter === 'verified') {
      matchVerified = lead.verification_status === 'verified';
    } else if (verifiedFilter === 'unverified') {
      matchVerified = !lead.verification_status || lead.verification_status === 'unverified';
    }

    // Disqualified leads & dead profiles stay hidden unless user selects "Not a Lead" from quality dropdown
    const notDisqualified = quality === 'incorrect' || (lead.feedback !== 'incorrect' && lead.status !== 'disqualified' && lead.verification_status !== 'dead');

    // 7. Search keyword filter (matches author, handle, post text, signal)
    const searchVal = (document.getElementById('social-lead-search')?.value || '').toLowerCase().trim();
    let matchSearch = true;
    if (searchVal) {
      const author = (lead.author_name || '').toLowerCase();
      const handle = (lead.author_handle || '').toLowerCase();
      const post = (lead.post_text || '').toLowerCase();
      const signal = (lead.intent_reason || '').toLowerCase();
      matchSearch = author.includes(searchVal) || handle.includes(searchVal) || post.includes(searchVal) || signal.includes(searchVal);
    }

    return matchPlatform && matchIntent && matchAge && matchStage && matchQuality && matchVerified && notDisqualified && matchSearch;
  });

  // Apply sorting
  const sortBy = document.getElementById('filter-sort')?.value || currentSortBy || 'newest';
  filtered.sort((a, b) => {
    if (sortBy === 'newest' || sortBy === 'date_desc') {
      const tA = new Date(a.discovered_at || a.created_at || a.post_date || 0).getTime();
      const tB = new Date(b.discovered_at || b.created_at || b.post_date || 0).getTime();
      return tB - tA;
    }
    if (sortBy === 'oldest' || sortBy === 'date_asc') {
      const tA = new Date(a.discovered_at || a.created_at || a.post_date || 0).getTime();
      const tB = new Date(b.discovered_at || b.created_at || b.post_date || 0).getTime();
      return tA - tB;
    }
    if (sortBy === 'intent') {
      const diff = (b.intent_score || 0) - (a.intent_score || 0);
      if (diff !== 0) return diff;
      return new Date(b.discovered_at || b.created_at || 0) - new Date(a.discovered_at || a.created_at || 0);
    }
    if (sortBy === 'freshness') {
      return (a.post_age_days ?? 99) - (b.post_age_days ?? 99);
    }
    if (sortBy === 'status') {
      const order = { discovered: 1, engaged: 2, dm_sent: 3, converted: 4, disqualified: 5 };
      return (order[a.status] || 99) - (order[b.status] || 99);
    }
    return 0;
  });

  renderLeads(filtered);
  updatePipelineCounters();
  updateAdvFiltersBadge();
}

function toggleAdvancedFilters() {
  const drawer = document.getElementById('adv-filters-drawer');
  if (!drawer) return;
  const isHidden = drawer.style.display === 'none' || !drawer.style.display;
  drawer.style.display = isHidden ? 'block' : 'none';
  const btn = document.getElementById('btn-toggle-adv-filters');
  if (btn) {
    if (isHidden) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }
}

function resetAdvancedFilters() {
  const fIntent = document.getElementById('filter-intent');
  const fAge = document.getElementById('filter-age');
  const fQuality = document.getElementById('filter-quality');
  const fVerified = document.getElementById('filter-verified');
  if (fIntent) fIntent.value = 'all';
  if (fAge) fAge.value = '7';
  if (fQuality) fQuality.value = 'all';
  if (fVerified) fVerified.value = 'all';
  updateAdvFiltersBadge();
  loadLeads();
}

function updateAdvFiltersBadge() {
  const fIntent = document.getElementById('filter-intent')?.value || 'all';
  const fAge = document.getElementById('filter-age')?.value || '7';
  const fQuality = document.getElementById('filter-quality')?.value || 'all';
  const fVerified = document.getElementById('filter-verified')?.value || 'all';

  let activeCount = 0;
  if (fIntent !== 'all') activeCount++;
  if (fAge !== '7') activeCount++;
  if (fQuality !== 'all') activeCount++;
  if (fVerified !== 'all') activeCount++;

  const badge = document.getElementById('adv-filter-count-badge');
  if (badge) {
    if (activeCount > 0) {
      badge.innerText = activeCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function renderLeads(leads) {
  const container = document.getElementById('leads-list');
  if (!leads || leads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <h3>No matching inquiries found</h3>
        <p>No leads currently match this filter criteria. Switch to "All Inquiries" or trigger a scan across your connected channels.</p>
      </div>`;
    return;
  }

  if (currentViewMode === 'table') {
    renderLeadsTable(leads, container);
  } else {
    renderLeadsCards(leads, container);
  }
}

function renderLeadsCards(leads, container) {
  const platformIcons = {
    threads: '🧵',
    linkedin: '💼',
    facebook: '👥',
    instagram: '📸'
  };

  container.innerHTML = leads.map(lead => {
    const icon = platformIcons[lead.platform] || '🌐';
    const isHigh = (lead.intent_score || 0) >= 70;
    const badgeClass = isHigh ? 'intent-high' : 'intent-med';
    const badgeText = isHigh ? `🔥 ${lead.intent_score}% High Match` : `💡 ${lead.intent_score}% Match`;

    const isEngaged = lead.status === 'engaged' || lead.status === 'dm_sent' || lead.status === 'converted';
    const statusText = lead.status === 'converted' ? '🏆 CONVERTED' : (lead.status === 'engaged' ? '💬 REACHED OUT' : (lead.status === 'dm_sent' ? '✉️ DM SENT' : (lead.status === 'disqualified' ? '🚫 DISQUALIFIED' : '✨ NEW LEAD')));
    const statusClass = lead.status === 'converted' ? 'status-converted' : (isEngaged ? 'status-engaged' : (lead.status === 'disqualified' ? 'status-disqualified' : 'status-discovered'));

    const postAgeDays = lead.post_age_days !== undefined && lead.post_age_days !== null ? lead.post_age_days : 0;
    const freshness = postAgeDays <= 2 ? '⚡ Fresh (<48h)' : (postAgeDays <= 7 ? '🕒 This Week' : '⚠️ >7d Old');

    return `
      <div class="lead-card-clean" id="lead-card-${lead.id}">
        <!-- Top Row: Icon, Author, Match Score & Status -->
        <div class="lead-card-clean-top">
          <div class="lead-card-clean-author">
            <span style="font-size: 1.25rem;">${icon}</span>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">
                ${escapeHtml(lead.author_name || 'Prospect')}
                <span style="font-size: 0.78rem; color: #94a3b8; font-weight: normal; margin-left: 4px;">${escapeHtml(formatHandle(lead.author_handle))}</span>
              </div>
              <div style="font-size: 0.75rem; color: #94a3b8;">
                ${lead.platform.toUpperCase()} • ${freshness}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <span class="lead-intent-badge ${badgeClass}" style="font-size: 0.75rem; padding: 2px 8px;">${badgeText}</span>
            <span class="lead-status-pill ${statusClass}" style="font-size: 0.72rem; padding: 2px 8px;">${statusText}</span>
          </div>
        </div>

        <!-- Prospect Inquiry Message / Post Content -->
        <div class="lead-card-clean-post">
          "${escapeHtml(lead.post_text || 'Active inquiry looking for solutions.')}"
        </div>

        <!-- AI Buying Signal Snippet -->
        <div style="font-size: 0.8rem; color: #a5b4fc; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 6px;">
          <span>🎯</span>
          <span><strong>AI Buying Signal:</strong> ${escapeHtml(lead.intent_reason || 'Verified customer looking for help')}</span>
        </div>

        <!-- Collapsible Details for Power Users (Zero Clutter by Default) -->
        <details style="margin-bottom: 0.75rem; font-size: 0.78rem; color: #94a3b8; background: rgba(0,0,0,0.2); border-radius: 6px; padding: 0.35rem 0.6rem;">
          <summary style="cursor: pointer; font-weight: 600; color: #cbd5e1;">🔍 View Timestamps & Feedback Training</summary>
          <div style="padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div>📅 <strong>Published:</strong> ${escapeHtml(lead.post_time_text || 'Recent')} (${postAgeDays <= 1 ? '<24h' : Math.round(postAgeDays) + 'd ago'})</div>
            <div>⚡ <strong>Discovered:</strong> ${formatTimestamp(lead.discovered_at || lead.created_at)}</div>
            ${lead.reached_out_at ? `<div>💬 <strong>Reached out:</strong> ${formatTimestamp(lead.reached_out_at)}</div>` : ''}
            <div style="margin-top: 0.35rem; display: flex; align-items: center; gap: 6px;">
              <span>Train AI:</span>
              <button class="btn btn-xs ${lead.feedback === 'correct' ? 'btn-primary' : 'btn-ghost'}" onclick="rateLeadQuality(${lead.id}, 'correct')">👍 Correct Lead</button>
              <button class="btn btn-xs ${lead.feedback === 'incorrect' ? 'btn-primary' : 'btn-ghost'}" onclick="rateLeadQuality(${lead.id}, 'incorrect')">👎 Not a Lead</button>
            </div>
          </div>
        </details>

        <!-- Clean Action Buttons: Clear, big, intuitive -->
        <div class="lead-card-clean-actions">
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <button class="btn btn-sm btn-primary" onclick="openActionModal(${lead.id}, 'engage')">
              <span>💬 ${isEngaged ? 'Post Another Comment' : 'Send AI Reply'}</span>
            </button>
            <button class="btn btn-sm btn-secondary" onclick="openActionModal(${lead.id}, 'dm')">
              <span>✉️ Send DM</span>
            </button>
            <a href="${escapeHtml(lead.post_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline">
              <span>🔗 Open Post ↗</span>
            </a>
          </div>
          <div style="display: flex; gap: 0.35rem; align-items: center;">
            ${lead.status !== 'converted' ? `
              <button class="btn btn-sm btn-outline text-emerald" onclick="markLeadStatus(${lead.id}, 'converted')" title="Mark as Converted Client">
                <span>🏆 Won</span>
              </button>
            ` : `
              <span style="color: #34d399; font-size: 0.78rem; font-weight: 700;">🎉 Client</span>
            `}
            <button class="btn btn-sm btn-outline text-danger" onclick="deleteSocialLead(${lead.id})" title="Delete lead">
              <span>🗑️</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLeadsTable(leads, container) {
  const platformIcons = { threads: '🧵', linkedin: '💼', facebook: '👥', instagram: '📸' };

  const rows = leads.map(lead => {
    const isNew = (lead.status === 'discovered' && !lead.reached_out_at);
    const newBadge = isNew ? '<span class="badge-new-lead"><span class="pulse-dot"></span> NEW LEAD</span>' : '';
    const icon = platformIcons[lead.platform] || '🌐';

    const isEngaged = lead.status === 'engaged' || lead.status === 'dm_sent' || lead.status === 'converted';
    const statusClass = lead.status === 'converted' ? 'status-converted' : (isEngaged ? 'status-engaged' : 'status-discovered');
    const statusText = lead.status === 'converted' ? '🏆 Converted' : (lead.status === 'engaged' ? '💬 Reached' : (lead.status === 'dm_sent' ? '✉️ DM Sent' : '📥 Discovered'));

    const initial = (lead.author_name && lead.author_name.trim()) ? lead.author_name.trim()[0].toUpperCase() : 'U';

    return `
      <tr id="lead-row-${lead.id}" class="${isNew ? 'tr-new-lead' : ''}">
        <td>
          <div class="table-author-cell">
            <div class="table-avatar">${initial}</div>
            <div>
              <strong>${escapeHtml(lead.author_name || 'Prospect')}</strong>
              <small class="text-dim">${escapeHtml(formatHandle(lead.author_handle))}</small>
            </div>
          </div>
        </td>
        <td>
          <span class="table-channel-pill">${icon} ${lead.platform.toUpperCase()}</span>
        </td>
        <td>
          <div class="table-badges-cell">
            ${newBadge}
            <span class="lead-status-pill ${statusClass}">${statusText}</span>
            ${lead.feedback === 'correct' ? '<span class="badge-quality verified">👍</span>' : ''}
          </div>
        </td>
        <td>
          <div class="table-intent-cell">
            <div class="intent-bar-mini">
              <div class="intent-fill-mini" style="width: ${lead.intent_score}%;"></div>
            </div>
            <strong>${lead.intent_score}%</strong>
          </div>
        </td>
        <td>
          <span class="text-dim" style="font-size:0.8rem;">${escapeHtml(lead.post_time_text || 'Recent')}</span>
        </td>
        <td>
          <a href="${escapeHtml(lead.post_url)}" target="_blank" class="table-post-link" title="Open original post">
            ${escapeHtml(cleanUrl(lead.post_url).slice(0, 28))}... ↗
          </a>
        </td>
        <td>
          <div class="table-actions-cell">
            <button class="btn btn-xs btn-primary" onclick="openActionModal(${lead.id}, 'engage')" title="Comment">💬 Comment</button>
            <button class="btn btn-xs btn-secondary" onclick="openActionModal(${lead.id}, 'dm')" title="Send DM">✉️ DM</button>
            <button class="btn-quality btn-quality-correct ${lead.feedback === 'correct' ? 'active' : ''}" onclick="rateLeadQuality(${lead.id}, 'correct')" title="Correct Lead">👍</button>
            <button class="btn-quality btn-quality-incorrect" onclick="rateLeadQuality(${lead.id}, 'incorrect')" title="Not a Lead">👎</button>
            <button class="btn btn-xs btn-outline-danger" onclick="deleteSocialLead(${lead.id})" title="Delete Lead">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="crm-table-container">
      <table class="crm-table">
        <thead>
          <tr>
            <th>Prospect</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Intent</th>
            <th>Age</th>
            <th>Original Post</th>
            <th>Outreach Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

async function rateLeadQuality(leadId, feedback) {
  const parsedId = parseInt(leadId, 10);
  const card = document.getElementById(`lead-card-${parsedId}`);
  const row = document.getElementById(`lead-row-${parsedId}`);
  const targetEl = card || row;

  try {
    // Immediately animate card or table row out for 'incorrect' before server responds (optimistic UI)
    if (feedback === 'incorrect' && targetEl) {
      targetEl.style.transition = 'transform 0.38s cubic-bezier(0.55,0,1,0.45), opacity 0.35s ease, max-height 0.4s ease 0.1s, margin 0.4s ease 0.1s, padding 0.4s ease 0.1s';
      targetEl.style.transform = 'translateX(-40px)';
      targetEl.style.opacity = '0';
      if (card) {
        card.style.maxHeight = card.scrollHeight + 'px';
        setTimeout(() => {
          card.style.maxHeight = '0';
          card.style.marginBottom = '0';
          card.style.paddingTop = '0';
          card.style.paddingBottom = '0';
          card.style.overflow = 'hidden';
        }, 340);
      }
    }

    const res = await fetch(`/api/leads/${parsedId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback })
    });
    const data = await res.json();

    if (data.success) {
      if (feedback === 'incorrect') {
        const authorHandle = data.lead?.author_handle || `#${parsedId}`;
        const keyword = data.lead?.keyword_matched;

        // Remove from in-memory list completely
        allLeads = allLeads.filter(l => l.id !== parsedId);

        // Remove DOM element fully after animation finishes
        setTimeout(() => { 
          if (targetEl && targetEl.parentElement) targetEl.remove(); 
          filterLeads();
        }, 400);

        // Update counters
        updateLeadCounter();
        loadStats();

        // Show learning toast
        showLearningToast('🛑 Not a Lead — Hidden & System Learned', [
          `Card removed from your pipeline.`,
          `<strong>@${authorHandle}</strong> permanently blocked — will never appear again.`,
          keyword ? `Exclusion filter applied for keyword "<strong>${keyword}</strong>".` : null,
          '⚡ Future scans will automatically skip similar posts.'
        ].filter(Boolean), 'toast-negative');

        appendTerminalLog(`Lead #${leadId} marked as Not a Lead → hidden from pipeline. @${authorHandle} blocked permanently.`, 'text-amber');

      } else if (feedback === 'correct') {
        // Update in-memory and re-render in place (stays visible, just updates badge)
        const idx = allLeads.findIndex(l => l.id === leadId);
        if (idx !== -1) allLeads[idx] = data.lead;
        filterLeads();
        loadStats();

        showLearningToast('✅ Correct Lead Confirmed', [
          'Lead kept in your pipeline.',
          data.lead?.keyword_matched ? `Keyword "<strong>${data.lead.keyword_matched}</strong>" weighted higher for future scans.` : null,
          'The system will prioritise similar posts next time.'
        ].filter(Boolean), 'toast-positive');
        appendTerminalLog(`Lead #${leadId} verified as Correct Lead. Positive patterns reinforced!`, 'text-emerald');

      } else {
        // Reset — put it back in list
        const idx = allLeads.findIndex(l => l.id === leadId);
        if (idx !== -1) allLeads[idx] = data.lead;
        filterLeads();
        loadStats();
        appendTerminalLog(`Lead #${leadId} quality rating reset.`, 'text-info');
      }
    }
  } catch (err) {
    // Revert card visibility on failure
    if (card) {
      card.style.transform = '';
      card.style.opacity = '';
      card.style.maxHeight = '';
    }
    alert(`Failed to save feedback: ${err.message}`);
  }
}

function showLearningToast(title, lines, cssClass = '') {
  // Remove any existing toast
  const existing = document.getElementById('learning-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'learning-toast';
  toast.className = `learning-toast ${cssClass}`;
  toast.innerHTML = `
    <div class="learning-toast-title">${title}</div>
    <ul class="learning-toast-list">
      ${lines.map(l => `<li>${l}</li>`).join('')}
    </ul>
    <button class="learning-toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.body.appendChild(toast);

  // Auto-dismiss after 6 seconds
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 6000);
}

async function triggerLeadScan() {
  const btnTop = document.getElementById('btn-run-scan');
  const btnToolbar = document.getElementById('btn-scan-connected');

  const setBtns = (disabled, text) => {
    if (btnTop) { btnTop.disabled = disabled; btnTop.innerHTML = text; }
    if (btnToolbar) { btnToolbar.disabled = disabled; btnToolbar.innerHTML = text; }
  };

  setBtns(true, '<span>Scanning Connected Channels...</span>');

  const topic = document.getElementById('kw-quick-topic')?.value.trim() || '';
  const filterPlat = document.getElementById('filter-platform')?.value || 'connected';
  const targetPlatform = (filterPlat === 'connected' || filterPlat === 'all') ? 'all' : filterPlat;

  // Validate connected channels before launching scan
  if (targetPlatform !== 'all' && connectedPlatforms.length > 0 && !connectedPlatforms.includes(targetPlatform)) {
    showLeadNotificationToast(`⚠️ Connect ${targetPlatform.toUpperCase()}`, `Please open Browser Profiles to connect ${targetPlatform.toUpperCase()} first.`);
    setBtns(false, `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Scan Connected Channels</span>`);
    return;
  }

  if (targetPlatform === 'all' && connectedPlatforms.length === 0) {
    showLeadNotificationToast('⚠️ No Accounts Connected', 'Please connect Threads, Instagram, or Facebook in Browser Profiles.');
    setBtns(false, `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Scan Connected Channels</span>`);
    return;
  }

  try {
    const res = await fetch('/api/leads/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        platform: targetPlatform,
        topic: topic,
        keywords: activeKeywords && activeKeywords.length > 0 ? activeKeywords : undefined
      })
    });
    const data = await res.json();
    appendTerminalLog(data.message, data.success ? 'text-emerald' : 'text-danger');
  } catch (err) {
    appendTerminalLog(`Scan error: ${err.message}`, 'text-danger');
  } finally {
    setTimeout(() => {
      setBtns(false, `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Scan Connected Channels</span>`);
    }, 4000);
  }
}

// ==================== MODAL (ENGAGE / DM) ====================
function openActionModal(leadId, mode) {
  const parsedId = parseInt(leadId, 10);
  const lead = allLeads.find(l => l.id === parsedId || l.id === leadId);
  if (!lead) return;

  currentActionLeadId = parsedId;
  currentActionMode = mode;

  const modal = document.getElementById('action-modal');
  const title = document.getElementById('modal-title');
  const label = document.getElementById('modal-field-label');
  const text = document.getElementById('modal-text');
  const info = document.getElementById('modal-lead-info');

  const displayHandle = formatHandle(lead.author_handle);

  info.innerHTML = `
    <div style="font-size: 0.85rem; margin-bottom: 0.75rem; line-height: 1.5; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.6rem 0.8rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
        <span><strong>Prospect:</strong> ${escapeHtml(lead.author_name || 'Prospect')} (${escapeHtml(displayHandle)})</span>
        <span style="background: var(--bg-surface); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${lead.platform.toUpperCase()}</span>
      </div>
      <div style="margin-top: 0.25rem;">
        <strong>Target Post Link:</strong> 
        <a href="${escapeHtml(lead.post_url)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); word-break: break-all; text-decoration: underline; font-family: monospace;">
          ${escapeHtml(cleanUrl(lead.post_url))} ↗
        </a>
      </div>
      <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 0.35rem; display: flex; align-items: center; gap: 4px;">
        <span>🎯</span>
        <span>Automation is locked to comment exclusively on this specific post URL.</span>
      </div>
    </div>
  `;

  const angleBar = document.getElementById('modal-angle-bar');

  if (mode === 'engage') {
    title.innerText = `Post AI Contextual Comment on ${lead.platform.toUpperCase()}`;
    label.innerText = 'AI-Synthesized Comment (Editable)';
    if (angleBar) angleBar.style.display = 'flex';

    let comment = lead.ai_comment || '';
    // If comment is missing or contains obsolete template boilerplate, regenerate on the fly
    const isObsolete = !comment ||
      comment.includes('Most people overlook this exact leverage point') ||
      comment.includes('Pattern break: the real unlock here') ||
      comment.includes('wishing you great candidates for the project') ||
      comment.includes('domain, the bottleneck') ||
      comment.includes('Decoupled system architecture: keeping the core MVP strictly focused') ||
      comment.includes('Building with modular components and clean API integrations') ||
      comment.includes('within $83 m') ||
      comment.includes('For builds under $150: keeping the core MVP');

    if (isObsolete) {
      text.value = 'Generating relatable, high-converting comment...';
      regenerateModalActionText();
    } else {
      text.value = comment;
      updateModalWordCount();
    }
  } else {
    title.innerText = `Send 1-on-1 Direct Message to ${displayHandle}`;
    label.innerText = 'Personalized Direct Message (Editable)';
    if (angleBar) angleBar.style.display = 'none';
    
    let dm = lead.last_dm || '';
    const isObsoleteDm = !dm ||
      dm.includes('streamline this workflow') ||
      dm.includes('Saw your note on paid acquisition') ||
      dm.includes('Saw your observation on Digital Marketing & Growth') ||
      dm.includes('Happy to help optimize cart recovery') ||
      dm.includes('We help brands streamline') ||
      dm.includes('saw your post on threads! We help');

    if (isObsoleteDm) {
      text.value = 'Generating bespoke, relatable DM...';
      regenerateModalActionText();
    } else {
      text.value = dm;
      updateModalWordCount();
    }
  }

  modal.classList.add('open');

  const submitBtn = document.getElementById('modal-submit-btn');
  submitBtn.onclick = () => submitModalAction();
}

function updateModalWordCount() {
  const text = document.getElementById('modal-text');
  const badge = document.getElementById('modal-word-badge');
  if (!text || !badge) return;

  const content = (text.value || '').trim();
  const words = content ? content.split(/\s+/).filter(Boolean).length : 0;

  if (words <= 48) {
    badge.style.color = '#10b981';
    badge.style.background = 'rgba(16, 185, 129, 0.12)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
    badge.innerText = `${words} words • High-Converting & Relatable ✨`;
  } else {
    badge.style.color = '#f59e0b';
    badge.style.background = 'rgba(245, 158, 11, 0.12)';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.25)';
    badge.innerText = `${words} words • High Word Count (Trim Recommended)`;
  }
}

async function regenerateModalActionText(angle = null) {
  if (!currentActionLeadId) return;
  const lead = allLeads.find(l => l.id === currentActionLeadId);
  if (!lead) return;

  const regenBtn = document.getElementById('modal-regen-btn');
  const text = document.getElementById('modal-text');
  if (regenBtn) {
    regenBtn.disabled = true;
    regenBtn.innerHTML = '<span>⏳</span> Synthesizing...';
  }

  try {
    const endpoint = currentActionMode === 'engage' 
      ? `/api/leads/${currentActionLeadId}/generate-comment` 
      : `/api/leads/${currentActionLeadId}/generate-dm`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ angle: angle || null })
    });

    const data = await res.json();
    if (data.success) {
      const generated = currentActionMode === 'engage' ? data.comment : data.dm;
      text.value = generated;
      if (currentActionMode === 'engage') {
        lead.ai_comment = generated;
      } else {
        lead.last_dm = generated;
      }
      updateModalWordCount();
    }
  } catch (err) {
    console.error('Failed to regenerate text:', err);
  } finally {
    if (regenBtn) {
      regenBtn.disabled = false;
      regenBtn.innerHTML = '<span>✨</span> Regenerate Shorter';
    }
  }
}

function applyCommentAngle(angle) {
  regenerateModalActionText(angle);
}

function closeModal() {
  const modal = document.getElementById('action-modal');
  if (modal) modal.classList.remove('open');
  const errBox = document.getElementById('modal-action-error');
  if (errBox) errBox.style.display = 'none';
  currentActionLeadId = null;
}

async function submitModalAction() {
  if (!currentActionLeadId) return;

  const targetLead = allLeads.find(l => l.id === currentActionLeadId);
  const textVal = document.getElementById('modal-text').value;
  const submitBtn = document.getElementById('modal-submit-btn');
  const errBox = document.getElementById('modal-action-error');
  if (errBox) errBox.style.display = 'none';

  submitBtn.disabled = true;
  submitBtn.innerText = 'Executing via Browser...';

  try {
    const endpoint = currentActionMode === 'engage' ? `/api/leads/${currentActionLeadId}/engage` : `/api/leads/${currentActionLeadId}/dm`;
    const payloadKey = currentActionMode === 'engage' ? 'customComment' : 'customDM';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [payloadKey]: textVal })
    });
    const result = await res.json();

    if (result.success) {
      const targetUrl = result.post_url || targetLead?.post_url || 'Target Post';
      appendTerminalLog(`Successfully executed ${currentActionMode} directly on: ${targetUrl}`, 'text-emerald');
      showLeadNotificationToast(`✅ Action Executed`, `Comment posted successfully on ${targetLead?.platform.toUpperCase() || 'post'}.`);
      closeModal();
      loadLeads();
      loadStats();
    } else {
      const rawError = result.error || result.reason || 'Action could not be completed';
      appendTerminalLog(`Action error on Lead #${currentActionLeadId}: ${rawError}`, 'text-danger');

      // Instead of raw alert, display rich in-modal recovery card with direct link
      const errMsgEl = document.getElementById('modal-action-error-msg');
      const openLink = document.getElementById('modal-error-open-link');

      let userFriendlyReason = rawError;
      if (rawError.includes('Timeout') || rawError.includes('waitForSelector')) {
        userFriendlyReason = `The comment box was collapsed or required manual interaction on this ${targetLead?.platform || 'social'} post. You can open the post in a new tab to comment directly.`;
      } else if (rawError.includes('login') || rawError.includes('session')) {
        userFriendlyReason = `Active ${targetLead?.platform || 'platform'} login required in Chrome (:9222). Please ensure you are logged into ${targetLead?.platform || 'social platform'} in your Chrome browser.`;
      }

      if (errBox && errMsgEl) {
        errMsgEl.innerText = userFriendlyReason;
        if (openLink) {
          const destUrl = (currentActionMode === 'dm' && targetLead?.author_url) ? targetLead.author_url : (targetLead?.post_url || '#');
          openLink.href = destUrl;
          openLink.innerHTML = currentActionMode === 'dm'
            ? `<span>👤 Open Prospect Profile ↗</span>`
            : `<span>🌐 Open Target Post in Tab ↗</span>`;
        }
        errBox.style.display = 'block';
      } else {
        alert(`Action Note: ${userFriendlyReason}`);
      }
    }
  } catch (err) {
    console.error('Modal action error:', err);
    const errBox = document.getElementById('modal-action-error');
    const errMsgEl = document.getElementById('modal-action-error-msg');
    if (errBox && errMsgEl) {
      errMsgEl.innerText = `Network/server error: ${err.message}`;
      errBox.style.display = 'block';
    } else {
      alert(`Error: ${err.message}`);
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Send Now via Browser';
  }
}

async function copyModalCommentAndAlert() {
  const textVal = document.getElementById('modal-text')?.value;
  if (!textVal) return;
  const copied = await copyToClipboard(textVal);
  if (copied) {
    showLeadNotificationToast('📋 Comment Copied', 'Paste directly into the post comment box (Ctrl+V / Cmd+V).');
  }
}

async function markCurrentLeadManuallyEngaged() {
  if (!currentActionLeadId) return;
  try {
    await markLeadStatus(currentActionLeadId, 'engaged');
    showLeadNotificationToast('✓ Marked as Engaged', `Lead #${currentActionLeadId} moved to Engaged stage.`);
    closeModal();
    loadLeads();
    loadStats();
  } catch (err) {
    console.error('Mark engaged error:', err);
  }
}

async function markLeadStatus(id, status) {
  try {
    await fetch(`/api/leads/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadLeads();
    loadStats();
  } catch (e) {
    console.error(e);
  }
}

async function deleteSocialLead(id) {
  if (!confirm('Are you sure you want to permanently delete this lead?')) return;
  try {
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showLeadNotificationToast('🗑️ Lead Deleted', 'Social lead removed from CRM.');
      allLeads = allLeads.filter(l => l.id !== id);
      renderLeads(allLeads);
      loadStats();
    } else {
      alert(data.error || 'Failed to delete lead');
    }
  } catch (err) {
    console.error('Delete lead error:', err);
    alert('Error deleting lead');
  }
}

// ==================== CONTENT STUDIO ====================
async function generateSocialPost() {
  const platform = document.getElementById('post-platform').value;
  const topic = document.getElementById('post-topic').value;
  const btn = document.getElementById('btn-gen-content');

  btn.disabled = true;
  btn.innerHTML = '<span>✨ Synthesizing Platform Post & Visual Concept...</span>';

  try {
    const res = await fetch('/api/posts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, topic })
    });
    const data = await res.json();

    document.getElementById('post-content').value = data.content || '';
    document.getElementById('image-prompt-text').innerText = data.image_prompt || 'Creative image prompt generated.';

    const tagList = document.getElementById('hashtags-list');
    if (data.hashtags && Array.isArray(data.hashtags)) {
      tagList.innerHTML = data.hashtags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
    }
  } catch (err) {
    alert(`Content generation error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>✨ Generate High-Converting Post & Visual Concept</span>';
  }
}

async function publishSocialPost() {
  const platform = document.getElementById('post-platform').value;
  const content = document.getElementById('post-content').value.trim();

  if (!content) {
    alert('Please generate or enter post content first.');
    return;
  }

  const btn = document.getElementById('btn-publish-post');
  btn.disabled = true;
  btn.innerHTML = '<span>Publishing via Browser Automation...</span>';

  try {
    const res = await fetch('/api/posts/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, content })
    });
    const data = await res.json();

    if (data.success) {
      appendTerminalLog(`Post published successfully to ${platform.toUpperCase()}`, 'text-emerald');
      alert(`Post published successfully to ${platform.toUpperCase()}!`);
      loadStats();
    } else {
      alert(`Publishing failed: ${data.error || 'Check login session'}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 Publish Now via Browser Control</span>';
  }
}

// ==================== BROWSER PROFILES & LOGIN ====================
async function openPlatformLogin(platform) {
  appendTerminalLog(`Opening persistent browser window for ${platform.toUpperCase()} login...`, 'text-info');
  try {
    const res = await fetch('/api/browser/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const data = await res.json();
    alert(data.message || `Browser opened for ${platform}! Log in once, and your session will be saved.`);
  } catch (err) {
    alert(`Login launcher error: ${err.message}`);
  }
}

function openLoginModal() {
  switchTab('accounts');
}

function formatNicheBadge(target) {
  const badge = document.getElementById('niche-badge');
  if (!badge) return;
  if (!target) {
    badge.innerHTML = `<span class="niche-chip" title="E-commerce, SaaS, and Digital Product Sales">🎯 <strong>Target Niche:</strong> E-commerce, SaaS, and Digital Product Sales</span>`;
    return;
  }
  
  badge.title = target;
  let shortText = target;
  if (target.length > 55) {
    const cleanFirst = target.split(/[.—]/)[0].trim();
    shortText = cleanFirst.length > 55 ? cleanFirst.slice(0, 52) + '...' : cleanFirst;
  }
  badge.innerHTML = `<span class="niche-chip" title="${escapeHtml(target)}">🎯 <strong>Target Niche:</strong> ${escapeHtml(shortText)}</span>`;
}

// ==================== SETTINGS & LIVE TUNNEL ====================
async function loadTunnelStatus() {
  try {
    const res = await fetch('/api/tunnel/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.publicUrl) {
      updatePublicTunnelUi(data.publicUrl);
    }
  } catch (err) {
    console.debug('Tunnel status check failed:', err);
  }
}

function updatePublicTunnelUi(url) {
  if (!url) return;
  activePublicUrl = url;
  const pill = document.getElementById('tunnel-pill');
  const dot = document.getElementById('tunnel-dot');
  const text = document.getElementById('tunnel-text');
  const openBtn = document.getElementById('btn-open-scorecard-pub');
  const pubInput = document.getElementById('setting-public-url');

  try {
    const parsed = new URL(url);
    const shortHost = parsed.hostname;
    if (text) text.innerText = `Live: ${shortHost}`;
    if (pill) {
      pill.title = `Public HTTPS Live Tunnel: ${url}/scorecard\nClick to copy client audit link`;
      pill.style.background = 'rgba(16, 185, 129, 0.15)';
      pill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      pill.style.color = '#10b981';
    }
    if (dot) dot.style.background = '#10b981';
    if (openBtn) openBtn.href = `${url}/scorecard`;
    if (pubInput) pubInput.value = url;
  } catch {
    if (text) text.innerText = `Live: ${url}`;
  }
}

async function restartTunnel() {
  const text = document.getElementById('tunnel-text');
  if (text) text.innerText = 'Refreshing tunnel...';
  try {
    appendTerminalLog('🔄 Refreshing Cloudflare Live Tunnel...', 'text-info');
    const res = await fetch('/api/tunnel/start', { method: 'POST' });
    const data = await res.json();
    if (data.publicUrl) {
      updatePublicTunnelUi(data.publicUrl);
      const pubInput = document.getElementById('setting-public-url');
      if (pubInput) pubInput.value = data.publicUrl;
      appendTerminalLog(`🌐 Cloudflare Live Tunnel online at ${data.publicUrl}`, 'text-emerald');
      showLeadNotificationToast('🌐 Live Tunnel Active', `Public Scorecard URL is live:\n${data.publicUrl}/scorecard`);
    } else {
      appendTerminalLog(`Tunnel refresh notice: ${data.error || 'Starting...'}`, 'text-warning');
    }
  } catch (err) {
    appendTerminalLog(`Failed to restart tunnel: ${err.message}`, 'text-danger');
  }
}

async function loadSettings() {
  try {
    loadSuperAdminSecurity();
    loadTeamUsers();
    loadReachInboxSettings();
    loadSocialAutomationSettings();
    const res = await fetch('/api/settings');
    const settings = await res.json();

    if (settings.niche_target) {
      document.getElementById('setting-niche').value = settings.niche_target;
      formatNicheBadge(settings.niche_target);
    }
    if (settings.search_keywords) {
      document.getElementById('setting-keywords').value = JSON.stringify(settings.search_keywords, null, 2);
    }
    if (settings.daily_max_comments) {
      document.getElementById('setting-max-comments').value = settings.daily_max_comments;
    }
    if (settings.daily_max_dms) {
      document.getElementById('setting-max-dms').value = settings.daily_max_dms;
    }
    if (settings.public_url) {
      const pubInput = document.getElementById('setting-public-url');
      if (pubInput) pubInput.value = settings.public_url;
      updatePublicTunnelUi(settings.public_url);
    }
    if (settings.topmate_url) {
      const tmInput = document.getElementById('setting-topmate-url');
      if (tmInput) tmInput.value = settings.topmate_url;
    }
    if (settings.cloudflare_tunnel_token) {
      const tokInput = document.getElementById('setting-tunnel-token');
      if (tokInput) tokInput.value = settings.cloudflare_tunnel_token;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const niche_target = document.getElementById('setting-niche').value;
  const gemini_api_key = document.getElementById('setting-api-key').value;
  const max_comments = document.getElementById('setting-max-comments').value;
  const max_dms = document.getElementById('setting-max-dms').value;
  const public_url = document.getElementById('setting-public-url')?.value;
  const topmate_url = document.getElementById('setting-topmate-url')?.value;
  const tunnel_token = document.getElementById('setting-tunnel-token')?.value;

  let search_keywords = [];
  try {
    search_keywords = JSON.parse(document.getElementById('setting-keywords').value);
  } catch {
    alert('Search keywords must be valid JSON array of strings');
    return;
  }

  const payload = {
    niche_target,
    search_keywords,
    daily_max_comments: max_comments,
    daily_max_dms: max_dms
  };
  if (gemini_api_key) payload.gemini_api_key = gemini_api_key;
  if (public_url) {
    payload.public_url = public_url.trim();
    updatePublicTunnelUi(payload.public_url);
  }
  if (topmate_url) payload.topmate_url = topmate_url.trim();
  if (tunnel_token !== undefined) payload.cloudflare_tunnel_token = tunnel_token.trim();

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    appendTerminalLog('Agent settings updated successfully', 'text-emerald');
    formatNicheBadge(niche_target);
    alert('Settings saved successfully!');
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  }
}

function formatHandle(handle) {
  if (!handle) return '@user';
  return '@' + String(handle).replace(/^@+/, '');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== META-AUTOMATION & CDP ====================
let activeKnowledgeFilename = null;

async function checkCdpStatus() {
  const pill = document.getElementById('cdp-pill');
  const text = document.getElementById('cdp-text');
  const tag = document.getElementById('engine-cdp-tag');
  try {
    const res = await fetch('/api/engine/status');
    const data = await res.json();
    if (data.cdp && data.cdp.active) {
      if (pill) {
        pill.classList.remove('disconnected');
        const bName = data.cdp.browser ? data.cdp.browser.split('/')[0] : 'Chrome';
        text.innerText = `CDP Active (${bName})`;
      }
      if (tag) {
        tag.innerText = `CDP Connected (:9222)`;
        tag.className = 'engine-status-tag cdp-tag';
      }
    } else {
      if (pill) {
        pill.classList.add('disconnected');
        text.innerText = 'CDP Disconnected';
      }
      if (tag) {
        tag.innerText = 'CDP Inactive';
        tag.className = 'engine-status-tag text-danger';
      }
    }

    const liveTag = document.getElementById('engine-live-tag');
    if (liveTag) {
      if (data.isRunning) {
        liveTag.innerText = `Running: ${data.activeTask}`;
        liveTag.style.background = 'rgba(245, 158, 11, 0.2)';
        liveTag.style.color = '#f59e0b';
      } else {
        liveTag.innerText = 'Engine Ready';
        liveTag.style.background = 'rgba(99, 102, 241, 0.15)';
        liveTag.style.color = '#a5b4fc';
      }
    }
  } catch (err) {
    if (pill) pill.classList.add('disconnected');
  }
}

async function launchCdpBrowser() {
  appendTerminalLog('Requesting Chrome CDP launch on port 9222...', 'text-warning');
  try {
    const res = await fetch('/api/engine/cdp/launch', { method: 'POST' });
    const data = await res.json();
    appendTerminalLog(data.message || 'CDP launch triggered', 'text-success');
    setTimeout(checkCdpStatus, 2000);
  } catch (err) {
    appendTerminalLog(`CDP launch error: ${err.message}`, 'text-danger');
  }
}

async function runEngineScan() {
  const limit = document.getElementById('scan-limit')?.value || 15;
  appendTerminalLog(`Initiating native Threads feed scan (limit: ${limit}) via threads-agent.js...`, 'text-emerald');
  try {
    const res = await fetch('/api/engine/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: parseInt(limit, 10) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    appendTerminalLog(data.message, 'text-success');
    checkCdpStatus();
  } catch (err) {
    appendTerminalLog(`Scan error: ${err.message}`, 'text-danger');
  }
}

async function runEngineAnalyze() {
  appendTerminalLog('Initiating AI Semantic Lead Analysis (threads-agent.js analyze)...', 'text-emerald');
  try {
    const res = await fetch('/api/engine/analyze', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    appendTerminalLog(data.message, 'text-success');
    checkCdpStatus();
  } catch (err) {
    appendTerminalLog(`Analyze error: ${err.message}`, 'text-danger');
  }
}

async function runSocialAutopilot() {
  appendTerminalLog('Launching multi-platform Social Autopilot runtime (agentic-social.js)...', 'text-amber');
  try {
    const res = await fetch('/api/engine/autopilot', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    appendTerminalLog(data.message, 'text-success');
    checkCdpStatus();
  } catch (err) {
    appendTerminalLog(`Autopilot error: ${err.message}`, 'text-danger');
  }
}

async function runJobAutopilot() {
  appendTerminalLog('Launching Freelancer/Upwork Job Revenue Engine (job-agent.js)...', 'text-pink');
  try {
    const res = await fetch('/api/engine/job', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    appendTerminalLog(data.message, 'text-success');
    checkCdpStatus();
  } catch (err) {
    appendTerminalLog(`Job error: ${err.message}`, 'text-danger');
  }
}

async function stopEngineTask() {
  appendTerminalLog('Sending emergency stop signal to engine runtime...', 'text-danger');
  try {
    const res = await fetch('/api/engine/stop', { method: 'POST' });
    const data = await res.json();
    appendTerminalLog(data.stopped ? `Stopped task: ${data.stopped}` : data.message, 'text-warning');
    checkCdpStatus();
  } catch (err) {
    appendTerminalLog(`Stop error: ${err.message}`, 'text-danger');
  }
}

async function syncEngineState() {
  appendTerminalLog('Synchronizing state and qualified leads into SQLite CRM...', 'text-info');
  try {
    const res = await fetch('/api/engine/status');
    const data = await res.json();
    appendTerminalLog(`Sync complete: ${data.sync?.synced || 0} qualified leads recorded`, 'text-success');
    loadLeads();
    loadStats();
  } catch (err) {
    appendTerminalLog(`Sync error: ${err.message}`, 'text-danger');
  }
}

function clearTerminal() {
  const t = document.getElementById('autopilot-terminal');
  if (t) t.innerHTML = '<div class="terminal-line text-dim">Terminal cleared.</div>';
}

// ==================== KNOWLEDGE BASE API ====================
async function loadKnowledgeFiles() {
  const listEl = document.getElementById('knowledge-file-list');
  if (!listEl) return;
  try {
    const res = await fetch('/api/knowledge');
    const data = await res.json();
    const files = data.files || [];
    listEl.innerHTML = '';

    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = `knowledge-file-item ${index === 0 && !activeKnowledgeFilename ? 'active' : (activeKnowledgeFilename === file.filename ? 'active' : '')}`;
      item.onclick = () => selectKnowledgeFile(file.filename);
      item.innerHTML = `
        <div class="file-item-top">
          <span class="file-item-name">${escapeHtml(file.title)}</span>
          <span class="file-item-size">${Math.round(file.size / 1024 * 10) / 10} KB</span>
        </div>
        <div class="file-item-desc">${escapeHtml(file.filename)}</div>
      `;
      listEl.appendChild(item);
    });

    if (files.length > 0 && !activeKnowledgeFilename) {
      selectKnowledgeFile(files[0].filename);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="text-danger p-4">Failed to load files: ${escapeHtml(err.message)}</div>`;
  }
}

async function selectKnowledgeFile(filename) {
  activeKnowledgeFilename = filename;
  document.querySelectorAll('.knowledge-file-item').forEach(el => {
    el.classList.toggle('active', el.querySelector('.file-item-desc')?.innerText === filename);
  });

  const editor = document.getElementById('knowledge-content-editor');
  const titleEl = document.getElementById('editor-active-filename');
  const metaEl = document.getElementById('editor-meta-info');
  const statusEl = document.getElementById('knowledge-status-text');

  if (titleEl) titleEl.innerText = filename;
  if (metaEl) metaEl.innerText = `knowledge/${filename}`;
  if (statusEl) statusEl.innerText = 'Loading...';
  if (editor) editor.value = 'Loading rule content from disk...';

  try {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(filename)}`);
    const data = await res.json();
    if (editor) editor.value = data.content || '';
    if (statusEl) statusEl.innerText = 'Loaded from disk';
  } catch (err) {
    if (editor) editor.value = `Error loading file: ${err.message}`;
    if (statusEl) statusEl.innerText = 'Error loading';
  }
}

async function saveActiveKnowledgeFile() {
  if (!activeKnowledgeFilename) return;
  const editor = document.getElementById('knowledge-content-editor');
  const statusEl = document.getElementById('knowledge-status-text');
  if (!editor) return;

  if (statusEl) statusEl.innerText = 'Saving changes...';
  try {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(activeKnowledgeFilename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (statusEl) statusEl.innerText = `Saved successfully (${data.bytes} bytes)!`;
    appendTerminalLog(`Updated knowledge rule: ${activeKnowledgeFilename}`, 'text-success');
    setTimeout(() => { if (statusEl) statusEl.innerText = 'Ready'; }, 4000);
  } catch (err) {
    if (statusEl) statusEl.innerText = `Save failed: ${err.message}`;
  }
}

// ==================== LIVE SOCIAL LEAD VERIFICATION ====================
async function verifyAllSocialLeads() {
  const btn = document.getElementById('btn-verify-leads');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Verifying Live Status...`;
  }
  showLeadNotificationToast('🛡️ Live Verification Started', 'Verifying all active social leads to confirm live profiles and purge dead/404 accounts...');
  try {
    const res = await fetch('/api/leads/verify-all', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showLeadNotificationToast('✅ Verification Complete', `${data.verifiedCount} active leads verified live! ${data.deadCount} dead/404 profiles purged.`);
      await loadLeads();
      await loadStats();
    } else {
      alert('Verification note: ' + (data.message || 'Complete'));
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🛡️ <span>Verify All Leads</span>`;
    }
  }
}

async function verifySingleLead(leadId) {
  try {
    showLeadNotificationToast('🛡️ Verifying Lead', `Checking live status for lead #${leadId}...`);
    const res = await fetch(`/api/leads/${leadId}/verify`, { method: 'POST' });
    const data = await res.json();
    if (data.valid) {
      showLeadNotificationToast('✅ Confirmed Live', `Lead #${leadId} is 100% active and live.`);
    } else {
      showLeadNotificationToast('❌ Dead Lead Purged', `Lead #${leadId} was purged: ${data.reason}`);
    }
    await loadLeads();
    await loadStats();
  } catch (e) {
    alert('Error verifying lead: ' + e.message);
  }
}

// ==================== GOOGLE MAPS LOCAL LEAD HUNTER ====================
let allMapsLeads = [];
let activeMapsPitchLead = null;
let mapsSearchDebounce = null;

async function loadMapsStats() {
  try {
    const res = await fetch('/api/maps/stats');
    const stats = await res.json();
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setEl('maps-stat-total', stats.total || 0);
    setEl('maps-stat-no-website', stats.no_website || 0);
    setEl('maps-stat-medical', stats.medical_leads || 0);
    setEl('maps-stat-phones', stats.with_phone || 0);
    setEl('maps-stat-emails', stats.with_email || 0);
    setEl('maps-stat-low-reviews', stats.low_reviews || 0);
    
    // Update sidebar counter
    const sidebarMaps = document.getElementById('sidebar-maps-count');
    if (sidebarMaps) {
      sidebarMaps.innerText = stats.medical_leads > 0 ? `${stats.medical_leads} DOCS` : (stats.no_website > 0 ? `${stats.no_website} NO-WEB` : (stats.total || 0));
    }
  } catch (err) {
    console.error('Failed to load Maps stats:', err);
  }
}

async function loadMapsLeads() {
  const container = document.getElementById('maps-leads-container');
  const websiteFilter = document.getElementById('maps-filter-website')?.value || 'all';
  const contactFilter = document.getElementById('maps-filter-contact')?.value || 'all';
  const statusFilter = document.getElementById('maps-filter-status')?.value || 'all';
  const sortBy = document.getElementById('maps-filter-sort')?.value || 'newest';
  const searchQuery = document.getElementById('maps-search-input')?.value || '';

  const params = new URLSearchParams();
  if (websiteFilter === 'medical') {
    params.set('is_medical', 'true');
  } else if (websiteFilter !== 'all') {
    params.set('has_website', websiteFilter);
  }
  if (contactFilter !== 'all') params.set('contact_method', contactFilter);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (sortBy) params.set('sortBy', sortBy);
  if (searchQuery) params.set('search', searchQuery);

  try {
    const res = await fetch(`/api/maps/leads?${params.toString()}`);
    if (!res.ok) {
      console.warn('Failed to load Maps leads, status:', res.status);
      return;
    }
    const data = await res.json();
    allMapsLeads = Array.isArray(data) ? data : (data.leads || []);
    renderMapsCards(allMapsLeads);
    const counterEl = document.getElementById('maps-results-count');
    if (counterEl) counterEl.innerText = `${allMapsLeads.length} leads found`;
  } catch (err) {
    console.error('Failed to load Maps leads:', err);
    if (container) container.innerHTML = `<div class="empty-state text-danger">Failed to load Google Maps leads: ${escapeHtml(err.message)}</div>`;
  }
}

function debounceMapsSearch() {
  clearTimeout(mapsSearchDebounce);
  mapsSearchDebounce = setTimeout(loadMapsLeads, 300);
}

function setMapsNiche(niche) {
  const input = document.getElementById('maps-query');
  if (input) input.value = niche;
}

async function triggerMapsScan() {
  const query = document.getElementById('maps-query')?.value.trim() || 'Plumbers';
  const location = document.getElementById('maps-location')?.value.trim() || 'Austin, TX';
  const limit = parseInt(document.getElementById('maps-limit')?.value || '20', 10);
  const noWebsiteOnly = document.getElementById('maps-no-website-toggle')?.checked ?? false;

  // Strict Policy Check: Exclude Bangladesh, Pakistan, Bhutan, Nepal, Sri Lanka, etc.
  const excludedKeywords = ['bangladesh', 'pakistan', 'bhutan', 'nepal', 'sri lanka', 'dhaka', 'karachi', 'lahore', 'islamabad', 'kathmandu', 'thimphu', 'colombo'];
  const fullSearch = `${query} ${location}`.toLowerCase();
  for (const kw of excludedKeywords) {
    if (fullSearch.includes(kw)) {
      alert(`⛔ Targeting Restricted: Targeting policy strictly excludes ${kw.toUpperCase()} and low-currency territories.\n\nPlease target high-value tier-1 markets (e.g. Austin, London, New York, Sydney, Toronto, Dubai, Mumbai).`);
      return;
    }
  }

  const btn = document.getElementById('btn-maps-scan');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Scanning Google Maps...`;
  }

  showLeadNotificationToast('📍 Google Maps Hunter Started', `Scanning "${query}" in "${location}" (${noWebsiteOnly ? '🔥 No Website Focus' : 'All Verified Listings'})...`);

  try {
    const res = await fetch('/api/maps/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location, limit, noWebsiteOnly })
    });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog(`Initiated Google Maps search for "${query}" in "${location}"`, 'text-emerald');
    } else {
      alert(data.error || 'Failed to start Maps scan');
    }
  } catch (err) {
    alert('Error starting Maps scan: ' + err.message);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `🚀 <span>Hunt Google Maps Leads</span>`;
      }
    }, 4000);
  }
}

const NICHE_MAP = {
  medical: { 
    icon: '🩺', badge: '℞', name: 'Doctor & Clinic', 
    roleTitle: 'Doctor',
    hoursTag: 'Zero Clinic Hours Required',
    timePlace: 'clinic time',
    gatekeeper: 'clinic coordinator or doctor',
    tabLabel: '🩺 ℞ Doctor\'s Rx Prescription', 
    auditTabLabel: '🔍 Social Media Audit & AI Avatar',
    callTabLabel: '📞 Receptionist & Call Script',
    v1Btn: '🔥 Version 1: Direct ℞ Doctor AI Avatar (No Fee Payment)', 
    v2Btn: '📋 Version 2: 2-Minute Practice Audit & Scorecard Invitation', 
    copyLabel: '📋 Copy Rx Pitch', 
    hint: '🩺 <strong>Authentic Clinical Prescription Format</strong>: Prescribes Doctor AI Avatar & Voice Cloned Reels to fix video absence, and respectfully asks for their consultation timings.',
    callHint: '💡 Phone script for calling the clinic coordinator or doctor directly, asking for consultation fee and timings',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with clinical Rx badge and consultation timings inquiry',
    step1Desc: 'Doctor records one clean talking sample on their phone once. Never needs to spend clinic time filming again.',
    step2Desc: 'AI Voice Cloning matches exact vocal timbre, clinical cadence, and facial movements across English, Hindi, and regional languages.',
    step3Desc: 'AI generates 15–20 high-yield patient education videos answering common fears and debunking myths on autopilot.',
    step4Desc: 'Comment-to-DM automation converts viewers into confirmed consultations and clinic footfall.',
    diagDefault: 'Inadequate Video Presence: Practice lacks consistent face-to-camera Doctor education Reels on Instagram/YouTube.'
  },
  legal: { 
    icon: '⚖️', badge: '⚖️', name: 'Legal Practice & Law Firm', 
    roleTitle: 'Managing Partner / Attorney',
    hoursTag: 'Zero Billable Hours Sacrificed',
    timePlace: 'billable hours',
    gatekeeper: 'legal assistant or managing partner',
    tabLabel: '⚖️ Legal Growth Blueprint & AI Video', 
    auditTabLabel: '🔍 Social Media Audit & Attorney AI',
    callTabLabel: '📞 Legal Assistant Call Script',
    v1Btn: '🔥 Version 1: Direct Attorney AI Video Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Legal Growth Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Legal Blueprint', 
    hint: '⚖️ <strong>Tailored Legal Practice Growth Blueprint</strong>: Positions Attorney AI Video & High-Yield Reels to acquire high-value retainers without sacrificing billable hours.',
    callHint: '💡 Phone script for calling the legal assistant or managing partner directly, asking for consultation availability',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with ⚖️ legal authority badge and operating hours inquiry',
    step1Desc: 'Attorney records one clean talking sample on phone once. Never needs to sacrifice billable client hours filming.',
    step2Desc: 'AI Voice Cloning matches exact vocal timbre, professional legal cadence, and case analysis presence.',
    step3Desc: 'AI generates 12–16 high-authority legal education videos explaining contract clauses, rights, and case precedents.',
    step4Desc: 'Comment-to-DM automation converts viewers into confirmed paid legal consultations and retained client cases.',
    diagDefault: 'Legal Retainer Gap: Firm relies on referrals and static graphics. Lacks partner face-to-camera short-form legal authority Reels.'
  },
  real_estate: { 
    icon: '🏡', badge: '🏡', name: 'Real Estate & Brokerage', 
    roleTitle: 'Principal Realtor & Broker',
    hoursTag: 'Zero Walkthrough Time Wasted',
    timePlace: 'showing & negotiation time',
    gatekeeper: 'brokerage assistant or principal broker',
    tabLabel: '🏡 Realtor Growth Blueprint & Walkthrough AI', 
    auditTabLabel: '🔍 Social Media Audit & Realtor AI',
    callTabLabel: '📞 Brokerage Desk Call Script',
    v1Btn: '🔥 Version 1: Direct Realtor AI Walkthrough Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Real Estate Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Real Estate Blueprint', 
    hint: '🏡 <strong>Tailored Real Estate Growth Blueprint</strong>: Positions Realtor AI Walkthroughs & Market Reels to secure exclusive buyer & seller listings 24/7.',
    callHint: '💡 Phone script for calling the brokerage front desk or realtor directly, asking for showing hours',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 🏡 real estate badge and showing hours inquiry',
    step1Desc: 'Realtor records one clean talking sample on phone once. Deliver daily walkthroughs and market updates on autopilot.',
    step2Desc: 'AI Voice Cloning matches exact vocal timbre and neighborhood authority cadence.',
    step3Desc: 'AI generates 12–16 market update & property breakdown Reels to capture active local buyers and sellers.',
    step4Desc: 'Comment-to-DM automation sends exclusive property listings and schedules walkthrough visits instantly.',
    diagDefault: 'Passive Listing Syndrome: Brokerage posts static photo flyers. Lacks video walkthroughs and market insight Reels.'
  },
  beauty: { 
    icon: '✨', badge: '✨', name: 'Luxury Salon & Spa', 
    roleTitle: 'Salon Owner & Creative Director',
    hoursTag: 'Zero Floor Hours Interrupted',
    timePlace: 'floor styling hours',
    gatekeeper: 'salon receptionist or creative director',
    tabLabel: '✨ Salon Growth Blueprint & Stylist AI', 
    auditTabLabel: '🔍 Social Media Audit & Stylist AI',
    callTabLabel: '📞 Salon Front Desk Call Script',
    v1Btn: '🔥 Version 1: Direct Stylist AI Avatar Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Salon Revenue Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Salon Blueprint', 
    hint: '✨ <strong>Tailored Salon & Spa Growth Blueprint</strong>: Generates transformation Reels & treatment education without interrupting stylist floor appointments.',
    callHint: '💡 Phone script for calling the salon manager or master stylist directly, asking for floor hours',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with ✨ beauty badge and floor hours inquiry',
    step1Desc: 'Creative director records one talking sample on smartphone once. Educate clients without interrupting floor appointments.',
    step2Desc: 'AI Voice Cloning matches warm, inviting styling tone and aesthetic expertise.',
    step3Desc: 'AI generates 15–20 aesthetic transformation & hair/skin care Reels showcasing treatment outcomes.',
    step4Desc: 'Comment-to-DM automation sends service menus and books salon chair appointments via WhatsApp.',
    diagDefault: 'Static Portfolio Void: Salon relies on static before/after photos. Lacks video transformation Reels explaining treatment care.'
  },
  fitness: { 
    icon: '🏋️', badge: '🏋️', name: 'Gym & Fitness Studio', 
    roleTitle: 'Head Coach & Founder',
    hoursTag: 'Zero Coaching Floor Hours Lost',
    timePlace: 'floor coaching hours',
    gatekeeper: 'front desk or head coach',
    tabLabel: '🏋️ Gym Growth Blueprint & Coach AI', 
    auditTabLabel: '🔍 Social Media Audit & Coach AI',
    callTabLabel: '📞 Gym Front Desk Call Script',
    v1Btn: '🔥 Version 1: Direct Coach AI Avatar Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Gym Acquisition Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Gym Blueprint', 
    hint: '🏋️ <strong>Tailored Gym & Fitness Growth Blueprint</strong>: Showcases head coach authority, workout breakdowns, and 24/7 trial intake without taking coach energy off the gym floor.',
    callHint: '💡 Phone script for calling the front desk or head coach directly, asking for coaching hours',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 🏋️ fitness badge and coaching hours inquiry',
    step1Desc: 'Head coach records one 2-minute sample once. Explain form, nutrition, and workout tips without leaving the gym floor.',
    step2Desc: 'AI Voice Cloning matches high-energy coach cadence and motivational tone.',
    step3Desc: 'AI generates 15–20 high-retention fitness and technique Reels driving gym trial passes and PT signups.',
    step4Desc: 'Comment-to-DM automation sends free trial passes and books gym fitness assessments via WhatsApp.',
    diagDefault: 'Coach Authority Deficit: Gym posts generic stock gym graphics. Lacks head coach form breakdowns and member win Reels.'
  },
  towing: { 
    icon: '🚗', badge: '🚗', name: 'Towing & Auto Fleet', 
    roleTitle: 'Fleet Owner & Operations Director',
    hoursTag: 'Zero Dispatch Downtime',
    timePlace: 'dispatch & fleet operations',
    gatekeeper: 'dispatch office or fleet manager',
    tabLabel: '🚗 24/7 Dispatch Blueprint & AI Engine', 
    auditTabLabel: '🔍 Social Media Audit & Fleet AI',
    callTabLabel: '📞 Dispatch Office Call Script',
    v1Btn: '🔥 Version 1: Direct 24/7 Dispatch AI Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Towing Dispatch Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Dispatch Blueprint', 
    hint: '🚗 <strong>Tailored 24/7 Towing & Fleet Blueprint</strong>: Captures emergency roadside calls in <60 seconds and secures high-value commercial fleet accounts.',
    callHint: '💡 Phone script for calling the dispatch office or fleet owner directly, asking for dispatch hours and hookup rate',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 🚗 towing badge and dispatch hours inquiry',
    step1Desc: 'Fleet owner records one 2-minute video sample once. Showcase roadside safety tips and driver advice automatically.',
    step2Desc: 'AI Voice Cloning matches clear, trustworthy dispatch tone across English and local languages.',
    step3Desc: 'AI generates 12–16 roadside safety & emergency towing Reels positioning your fleet as the #1 local operator.',
    step4Desc: 'Instant dispatch automation connects stranded drivers to your 24/7 hotline and captures commercial fleet accounts.',
    diagDefault: 'Missed Dispatch Vulnerability: High reliance on phone ringing without 24/7 instant WhatsApp dispatch capture or video trust.'
  },
  home_services: { 
    icon: '🛠️', badge: '🛠️', name: 'Contractor & Home Services', 
    roleTitle: 'Master Contractor & Owner',
    hoursTag: 'Zero Jobsite Hours Required',
    timePlace: 'jobsite hours',
    gatekeeper: 'office manager or master contractor',
    tabLabel: '🛠️ Contractor Growth Blueprint & AI Engine', 
    auditTabLabel: '🔍 Social Media Audit & Contractor AI',
    callTabLabel: '📞 Office & Dispatch Call Script',
    v1Btn: '🔥 Version 1: Direct Master Contractor AI Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Contractor Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Contractor Blueprint', 
    hint: '🛠️ <strong>Tailored Contractor Growth Blueprint</strong>: Builds homeowner trust with repair breakdowns and transparent estimate videos without taking you off the jobsite.',
    callHint: '💡 Phone script for calling the office coordinator or contractor directly, asking for estimate hours and service rates',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 🛠️ contractor badge and estimate hours inquiry',
    step1Desc: 'Master contractor records one clean talking sample on phone once. Never needs to take time off jobsites to film.',
    step2Desc: 'AI Voice Cloning matches authentic contractor tone, honest advice cadence, and trade terminology.',
    step3Desc: 'AI generates 15–20 home repair warning & maintenance Reels converting homeowners into booked service calls.',
    step4Desc: '24/7 AI Estimate Bot converts viewer comments into booked on-site estimates and completed service calls.',
    diagDefault: 'Contractor Trust Void: Relies on word-of-mouth and static logos. Lacks jobsite explanation videos that win $3k-$15k replacements.'
  },
  b2b_consulting: { 
    icon: '💼', badge: '💼', name: 'B2B Consulting & Advisory', 
    roleTitle: 'Founder & Managing Director',
    hoursTag: 'Zero Client Advisory Hours Wasted',
    timePlace: 'client advisory hours',
    gatekeeper: 'executive assistant or managing director',
    tabLabel: '💼 B2B Growth Blueprint & Founder AI', 
    auditTabLabel: '🔍 Social Media Audit & Founder AI',
    callTabLabel: '📞 Executive Assistant Call Script',
    v1Btn: '🔥 Version 1: Direct Founder Thought-Leadership AI Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute B2B Growth Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy B2B Blueprint', 
    hint: '💼 <strong>Tailored B2B Revenue Acceleration Blueprint</strong>: Establishes executive authority and fills your discovery call calendar on autopilot.',
    callHint: '💡 Phone script for calling the executive assistant or founder directly, asking for advisory hours and retainers',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 💼 B2B executive badge and advisory hours inquiry',
    step1Desc: 'Founder records one 2-minute sample once. Publish executive insights, teardowns, and framework breakdowns on autopilot.',
    step2Desc: 'AI Voice Cloning matches authoritative thought-leadership cadence and strategic presence.',
    step3Desc: 'AI generates 12–16 strategic framework & client case study Reels converting views into high-ticket retainers.',
    step4Desc: 'Automated DM Lead Funnel sends your Topmate discovery call link directly to high-intent founders.',
    diagDefault: 'Founder Invisibility Trap: Zero video thought leadership on LinkedIn or YouTube. Relies on slow word-of-mouth referrals.'
  },
  hospitality: { 
    icon: '🍽️', badge: '🍽️', name: 'Restaurant & Dining', 
    roleTitle: 'Restaurateur & Head Chef',
    hoursTag: 'Zero Kitchen & Service Hours Lost',
    timePlace: 'kitchen & service hours',
    gatekeeper: 'host / reservation desk or general manager',
    tabLabel: '🍽️ Dining Revenue Blueprint & Viral Reels', 
    auditTabLabel: '🔍 Social Media Audit & Chef AI',
    callTabLabel: '📞 Host & Reservation Call Script',
    v1Btn: '🔥 Version 1: Direct Culinary AI Avatar Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Restaurant Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Dining Blueprint', 
    hint: '🍽️ <strong>Tailored Restaurant & Dining Blueprint</strong>: Drives viral foodie reach, signature dish Reels, and direct WhatsApp table bookings without delivery app commission drain.',
    callHint: '💡 Phone script for calling the reservation desk or chef directly, asking for kitchen & service hours',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 🍽️ dining badge and service hours inquiry',
    step1Desc: 'Head chef or manager records one 2-minute sample once. Present weekly signature dishes, pairings, and specials on autopilot.',
    step2Desc: 'AI Voice Cloning matches passionate culinary tone and appetizing behind-the-scenes narration.',
    step3Desc: 'AI generates 15–20 viral culinary preparation & dining experience Reels driving direct table reservations.',
    step4Desc: 'Instant WhatsApp reservation bot books dining tables and VIP parties 24/7 without aggregator commissions.',
    diagDefault: 'Static Menu Drain: Posts static menu pictures. Lacks viral sizzling kitchen preparation Reels that pack dinner covers.'
  },
  general: { 
    icon: '📈', badge: '📈', name: 'Local Business & Retail', 
    roleTitle: 'Business Owner & Founder',
    hoursTag: 'Zero Operating Hours Required',
    timePlace: 'operating hours',
    gatekeeper: 'front desk or business owner',
    tabLabel: '📈 Business Growth Blueprint & AI Protocol', 
    auditTabLabel: '🔍 Social Media Audit & Owner AI',
    callTabLabel: '📞 Front Desk & Call Script',
    v1Btn: '🔥 Version 1: Direct Business Owner AI Avatar Protocol (Operating Hours)', 
    v2Btn: '📋 Version 2: 2-Minute Business Health Audit & Blueprint Invitation', 
    copyLabel: '📋 Copy Growth Blueprint', 
    hint: '📈 <strong>Tailored Local Business Growth Blueprint</strong>: Dominates local mobile discovery and deploys 24/7 AI lead capture to turn views into repeat paying customers.',
    callHint: '💡 Phone script for calling the front desk or business owner directly, asking for operating hours',
    waHint: '💡 Ready-to-send WhatsApp / Social DM message with 📈 business growth badge and operating hours inquiry',
    step1Desc: 'Owner records one clean talking sample on smartphone once. Explain services, customer FAQs, and behind-the-scenes on autopilot.',
    step2Desc: 'AI Voice Cloning matches authentic local business tone across English, Hindi, and regional languages.',
    step3Desc: 'AI generates 15–20 viral customer education Reels answering top FAQs and driving repeat sales.',
    step4Desc: 'Comment-to-DM automation converts social viewers directly into WhatsApp inquiries and store footfall.',
    diagDefault: 'Video Absence Void: Relies on static flyer graphics yielding under 1% engagement. Lacks face-to-camera short-form video.'
  }
};

function detectClientNiche(str = '') {
  const s = String(str || '').toLowerCase();
  if (s.includes('dent') || s.includes('oral') || s.includes('implant') || s.includes('doctor') || s.includes('clinic') || s.includes('derma') || s.includes('skin') || s.includes('medic') || s.includes('chiro') || s.includes('physio') || s.includes('ortho') || s.includes('surgeon')) return 'medical';
  if (s.includes('law') || s.includes('attorney') || s.includes('legal') || s.includes('advocate') || s.includes('counsel') || s.includes('litigat')) return 'legal';
  if (s.includes('realt') || s.includes('real estate') || s.includes('property') || s.includes('brokerage') || s.includes('housing')) return 'real_estate';
  if (s.includes('salon') || s.includes('spa') || s.includes('beauty') || s.includes('hair') || s.includes('aesthetic') || s.includes('nail') || s.includes('barber')) return 'beauty';
  if (s.includes('gym') || s.includes('fitness') || s.includes('crossfit') || s.includes('yoga') || s.includes('workout') || s.includes('trainer')) return 'fitness';
  if (s.includes('tow') || s.includes('roadside') || s.includes('wrecker') || s.includes('recovery') || s.includes('auto repair') || s.includes('mechanic') || s.includes('garage') || s.includes('collision') || s.includes('tire')) return 'towing';
  if (s.includes('plumb') || s.includes('hvac') || s.includes('roof') || s.includes('electric') || s.includes('contractor') || s.includes('pest') || s.includes('solar') || s.includes('clean') || s.includes('paint') || s.includes('handyman')) return 'home_services';
  if (s.includes('consult') || s.includes('account') || s.includes('tax') || s.includes('financial') || s.includes('cpa') || s.includes('wealth') || s.includes('agency') || s.includes('b2b') || s.includes('advisory')) return 'b2b_consulting';
  if (s.includes('restaurant') || s.includes('cafe') || s.includes('bistro') || s.includes('dining') || s.includes('food') || s.includes('bakery') || s.includes('bar') || s.includes('catering') || s.includes('hospitality')) return 'hospitality';
  return 'general';
}

function extractCleanEmailPitch(lead, rawContent = null) {
  let content = rawContent || lead.ai_email_pitch || lead.doctor_prescription || '';
  if (typeof content === 'string' && content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      content = parsed.rxEmail || parsed.version1?.rxEmail || parsed.emailPitch || '';
    } catch (_) {}
  }

  const isMed = Boolean(lead.is_medical || (lead.category && lead.category.toLowerCase().includes('dent')) || (lead.category && lead.category.toLowerCase().includes('medic')));
  let subject = isMed
    ? `Quick question regarding ${lead.business_name} (${lead.city || 'patient acquisition'})`
    : `Digital audit & video inquiry for ${lead.business_name}`;

  let body = String(content || '');
  if (body.includes('Subject:')) {
    const lines = body.split(/\r?\n/);
    const subLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
    if (subLine) {
      subject = subLine.replace(/subject:\s*/i, '').trim();
      body = lines.filter(l => !l.toLowerCase().startsWith('subject:')).join('\n').trim();
    }
  }

  return { subject, body };
}

const MAPS_NICHES = {
  medical: { name: 'Doctor & Clinic', icon: '🩺' },
  legal: { name: 'Law Firm & Attorney', icon: '⚖️' },
  real_estate: { name: 'Real Estate & Brokerage', icon: '🏢' },
  beauty: { name: 'Beauty, Salon & Aesthetic', icon: '✨' },
  fitness: { name: 'Gym & Fitness Center', icon: '🏋️' },
  home_services: { name: 'Home Services & Contractor', icon: '🛠️' },
  towing: { name: 'Towing & Auto Repair', icon: '🚗' },
  b2b_consulting: { name: 'B2B & Professional Advisory', icon: '💼' },
  restaurant: { name: 'Restaurant & Dining', icon: '🍽️' },
  general: { name: 'Local Business', icon: '📍' }
};

function detectBusinessNiche(category = '', name = '') {
  const s = `${category || ''} ${name || ''}`.toLowerCase();
  if (s.includes('dent') || s.includes('oral') || s.includes('implant') || s.includes('smile') ||
      s.includes('derma') || s.includes('skin') || s.includes('doctor') || s.includes('clinic') || 
      s.includes('ortho') || s.includes('eye') || s.includes('hospital') || s.includes('medic') || 
      s.includes('pediatric') || s.includes('physio') || s.includes('health') || s.includes('pharma') ||
      s.includes('chiro') || s.includes('surgeon')) {
    return 'medical';
  }
  if (s.includes('law') || s.includes('attorney') || s.includes('legal') || s.includes('advocate') || 
      s.includes('solicitor') || s.includes('barrister') || s.includes('court') || s.includes('litigat') ||
      s.includes('counsel')) {
    return 'legal';
  }
  if (s.includes('real estate') || s.includes('realt') || s.includes('property') || s.includes('estate') || 
      s.includes('brokerage') || s.includes('housing') || s.includes('builder') || s.includes('developer')) {
    return 'real_estate';
  }
  if (s.includes('salon') || s.includes('spa') || s.includes('beauty') || s.includes('hair') || 
      s.includes('aesthetic') || s.includes('nail') || s.includes('makeup') || s.includes('barber')) {
    return 'beauty';
  }
  if (s.includes('gym') || s.includes('fitness') || s.includes('crossfit') || s.includes('yoga') || 
      s.includes('pilates') || s.includes('workout') || s.includes('trainer') || s.includes('coach')) {
    return 'fitness';
  }
  if (s.includes('plumb') || s.includes('hvac') || s.includes('roof') || s.includes('electric') || 
      s.includes('contractor') || s.includes('pest') || s.includes('solar') || s.includes('clean') ||
      s.includes('handyman') || s.includes('paint')) {
    return 'home_services';
  }
  if (s.includes('tow') || s.includes('roadside') || s.includes('wrecker') || s.includes('auto repair') || 
      s.includes('mechanic') || s.includes('garage') || s.includes('tire')) {
    return 'towing';
  }
  if (s.includes('consult') || s.includes('account') || s.includes('tax') || s.includes('financial') || 
      s.includes('agency') || s.includes('marketing') || s.includes('software') || s.includes('b2b')) {
    return 'b2b_consulting';
  }
  if (s.includes('restaurant') || s.includes('cafe') || s.includes('bistro') || s.includes('dining')) {
    return 'restaurant';
  }
  return 'general';
}

function renderMapsLeadCard(lead) {
  try {
    const oppScore = lead.opportunity_score || 50;
    const hasWebsite = Boolean(lead.has_website);
    const nicheKey = detectBusinessNiche(lead.category, lead.business_name);
    const niche = MAPS_NICHES[nicheKey] || MAPS_NICHES.medical;
    const isMedical = Boolean(lead.is_medical || nicheKey === 'medical');

    const websiteBadge = hasWebsite 
      ? `<span class="maps-badge-site has-site" title="Active Website Verified: SEO, Speed-to-Lead, and AI Reels Optimization Pitch Ready">✅ HAS WEBSITE</span>` 
      : `<span class="maps-badge-site no-site" title="High-Ticket Hot Lead: No website found! Prime target for Website Development + AI Avatar Growth Package">🔥 NO WEBSITE</span>`;

    const nicheBadge = isMedical 
      ? `<span class="maps-badge-medical" title="Verified Healthcare & Clinic Lead: Tailored Doctor's Rx Prescription & AI Avatar Strategy Ready">🩺 DOCTOR / CLINIC Rx</span>`
      : `<span class="maps-badge-niche" style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.35); color: #a5b4fc; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 6px; letter-spacing: 0.03em;">${niche.icon} ${niche.name.toUpperCase()} BLUEPRINT</span>`;

    // Rating display
    const ratingDisplay = lead.rating 
      ? `<span class="maps-rating-pill">⭐ ${lead.rating} <small>(${lead.reviews_count || 0} reviews)</small></span>` 
      : `<span class="maps-rating-pill text-muted">No reviews yet</span>`;

    // Clean phone number for tel: and wa.me
    const rawPhone = lead.phone || '';
    const cleanDigits = rawPhone.replace(/[^\d+]/g, '');

    // Formatted WhatsApp URL with viral pattern-break outreach pitch
    const viralWaMsg = buildViralOutreachMessage(lead, 'outbound');
    const encodedWaPitch = encodeURIComponent(viralWaMsg);
    const waUrl = lead.whatsapp_url 
      ? `${lead.whatsapp_url}?text=${encodedWaPitch}` 
      : (cleanDigits ? `https://wa.me/${cleanDigits.replace(/^\+/, '')}?text=${encodedWaPitch}` : '#');

    // Clean Email address and pitch (No raw JSON, no ASCII clutter!)
    const email = lead.email || '';
    const cleanEmail = extractCleanEmailPitch(lead);
    const encodedEmailSubject = encodeURIComponent(cleanEmail.subject);
    const encodedEmailBody = encodeURIComponent(cleanEmail.body);
    const mailtoUrl = email ? `mailto:${email}?subject=${encodedEmailSubject}&body=${encodedEmailBody}` : '#';

    // Parse social handles
    let socials = {};
    try {
      socials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
    } catch (_) {}

    const socialBadges = [];
    if (socials.instagram) {
      const igHandle = socials.instagram.match(/instagram\.com\/([a-zA-Z0-9._-]+)/i)?.[1] || '';
      const dmLink = igHandle ? `https://ig.me/m/${igHandle}` : socials.instagram;
      socialBadges.push(`<a href="${escapeHtml(dmLink)}" target="_blank" rel="noopener noreferrer" class="social-chip ig" title="Send Instagram DM">📸 @${escapeHtml(igHandle || 'Instagram')}</a>`);
    }
    if (socials.facebook) {
      const fbHandle = socials.facebook.match(/facebook\.com\/([a-zA-Z0-9._-]+)/i)?.[1] || '';
      const dmLink = fbHandle ? `https://m.me/${fbHandle}` : socials.facebook;
      socialBadges.push(`<a href="${escapeHtml(dmLink)}" target="_blank" rel="noopener noreferrer" class="social-chip fb" title="Send Facebook Messenger DM">📘 FB</a>`);
    }
    if (socials.youtube) {
      socialBadges.push(`<a href="${escapeHtml(socials.youtube)}" target="_blank" rel="noopener noreferrer" class="social-chip yt" title="View YouTube Channel">▶️ YouTube</a>`);
    }
    if (socials.linkedin) {
      socialBadges.push(`<a href="${escapeHtml(socials.linkedin)}" target="_blank" rel="noopener noreferrer" class="social-chip li" title="View LinkedIn Profile">💼 LinkedIn</a>`);
    }

    return `
      <div class="maps-card ${!hasWebsite ? 'card-no-website' : ''} ${isMedical ? 'card-medical-lead' : ''}" id="maps-card-${lead.id}">
        <!-- Top Row -->
        <div class="maps-card-top">
          <div class="maps-card-title-group">
            <div class="maps-biz-name-row">
              <h3 class="maps-biz-name">${escapeHtml(lead.business_name)}</h3>
              ${nicheBadge}
              ${websiteBadge}
            </div>
            <div class="maps-card-submeta">
              <span class="maps-category-chip">🏷️ ${escapeHtml(lead.category || niche.name)}</span>
              ${ratingDisplay}
              <span class="maps-location-chip">📍 ${escapeHtml(lead.city || 'Local')}</span>
              ${rawPhone ? `<span class="contact-pill phone-pill" title="Verified Phone Number">📞 Phone Ready</span>` : ''}
              ${email ? `<span class="contact-pill email-pill" title="Verified Email Address">✉️ Email Ready</span>` : ''}
              ${socialBadges.join(' ')}
            </div>
          </div>
          <div class="maps-score-badge ${oppScore >= 90 ? 'score-high' : 'score-med'}">
            <span class="score-num">${oppScore}</span>
            <span class="score-label">${isMedical ? 'RX CLINICAL' : 'OPPORTUNITY'}</span>
          </div>
        </div>

        <!-- Opportunity Summary Callout -->
        <div class="maps-opp-box ${isMedical ? 'opp-medical' : (!hasWebsite ? 'opp-no-site' : '')}">
          <span class="opp-icon">${isMedical ? '🩺' : (!hasWebsite ? '🔥' : niche.icon)}</span>
          <div class="opp-text">
            <strong>${isMedical ? 'Clinical AI Avatar & Reels Pitch:' : `${niche.icon} ${niche.name} Growth Blueprint:`}</strong>
            <p>${escapeHtml(lead.opportunity_summary || '')}</p>
          </div>
        </div>

        <!-- Address & Contact Info Grid -->
        <div class="maps-contact-row">
          <div class="maps-contact-col">
            <span class="contact-label">Phone Number</span>
            <span class="contact-val">
              ${rawPhone 
                ? `<a href="tel:${cleanDigits}" class="phone-link" title="Click to call">📞 ${escapeHtml(rawPhone)}</a>` 
                : '<span class="text-dim">No phone published</span>'}
            </span>
          </div>

          <div class="maps-contact-col">
            <span class="contact-label">Direct Email</span>
            <span class="contact-val">
              ${email 
                ? `<a href="${mailtoUrl}" class="email-link" title="Click to compose email">✉️ ${escapeHtml(email)}</a>` 
                : '<span class="text-dim">No direct email found</span>'}
            </span>
          </div>

          <div class="maps-contact-col">
            <span class="contact-label">Address</span>
            <span class="contact-val" title="${escapeHtml(lead.address || 'Local Address')}">
              ${escapeHtml(lead.address ? lead.address.slice(0, 40) + (lead.address.length > 40 ? '...' : '') : 'Address available on Maps')}
            </span>
          </div>

          <div class="maps-contact-col">
            <span class="contact-label">Google Maps Link</span>
            <span class="contact-val">
              <a href="${escapeHtml(lead.maps_url)}" target="_blank" rel="noopener noreferrer" class="maps-link">
                View on Maps ↗
              </a>
            </span>
          </div>
        </div>

        <!-- Card Action Footer -->
        <div class="maps-card-actions">
          <div class="maps-actions-left">
            ${rawPhone ? `
              <a href="tel:${cleanDigits}" class="btn btn-sm btn-outline-call" title="Call directly">
                📞 Call Now
              </a>
              <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-success-wa" title="Open direct chat on WhatsApp Web with pre-filled AI pitch">
                💬 WhatsApp Direct
              </a>
            ` : ''}
            <button type="button" class="btn btn-sm btn-outline" onclick="triggerLeadEmailClick(${lead.id})" title="Send pre-filled email pitch with clean scorecard link">
              ✉️ Email Pitch
            </button>
            ${email ? `
              <button class="btn btn-sm btn-outline" onclick="openReachInboxModal(${lead.id})" title="Sync to ReachInbox campaign">
                🚀 ReachInbox
              </button>
            ` : ''}
            ${(socials.instagram || socials.threads) ? `
              <button class="btn btn-sm btn-outline-call" onclick="engageSingleSocialLead(${lead.id})" title="Auto-engage: Like recent post -> Expert comment -> DM with Scorecard">
                📱 Engage Social
              </button>
            ` : `
              <button class="btn btn-sm btn-outline-call" id="btn-find-socials-lead-${lead.id}" onclick="findSingleLeadSocials(${lead.id})" title="Hunt verified Instagram, Facebook, and LinkedIn links">
                🔍 Find Socials
              </button>
            `}
            <button class="btn btn-sm ${isMedical ? 'btn-primary btn-medical-rx' : 'btn-primary'}" onclick="openMapsPitchModal(${lead.id})" title="${isMedical ? 'View Doctor Rx Prescription, Social Audit & AI Avatar Plan' : `View ${niche.name} Growth Blueprint & AI Pitch`}">
              ${isMedical ? '🩺 View Doctor Rx & Audit' : `${niche.icon} View Growth Blueprint`}
            </button>
            <button class="btn btn-sm btn-ghost" id="btn-reverify-lead-${lead.id}" onclick="reverifySingleMapsLead(${lead.id})" title="Re-check website and hunt phone/email contacts">
              ⚡ Re-Verify
            </button>
          </div>

          <div class="maps-actions-right">
            <select class="status-select-sm" onchange="updateMapsLeadStatus(${lead.id}, this.value)" title="Update pipeline status">
              <option value="discovered" ${lead.status === 'discovered' ? 'selected' : ''}>✨ New</option>
              <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>📞 Contacted</option>
              <option value="interested" ${lead.status === 'interested' ? 'selected' : ''}>🎯 Interested</option>
              <option value="closed" ${lead.status === 'closed' ? 'selected' : ''}>🏆 Closed</option>
            </select>
            <button class="btn-del-sm" onclick="deleteMapsLead(${lead.id})" title="Remove lead">✕</button>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error rendering maps lead card:', err);
    return '';
  }
}

function renderMapsCards(leads) {
  const container = document.getElementById('maps-leads-container');
  if (!container) return;

  if (!leads || leads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📍</div>
        <h3>No matching verified Google Maps leads found</h3>
        <p>Try clearing filters or click <strong>"Hunt Google Maps Leads"</strong> or <strong>"⚡ Re-Verify All Leads"</strong> to discover reachable opportunities.</p>
      </div>`;
    return;
  }

  container.innerHTML = leads.map(lead => renderMapsLeadCard(lead)).join('');
}

function openMapsPitchModal(leadId) {
  const lead = allMapsLeads.find(l => l.id === leadId);
  if (!lead) return;

  activeMapsPitchLead = lead;
  const modal = document.getElementById('modal-maps-pitch');
  if (!modal) return;

  const isMedical = !!lead.is_medical;
  const nicheKey = isMedical ? 'medical' : detectClientNiche((lead.category || '') + ' ' + (lead.business_name || '') + ' ' + (lead.search_query || ''));
  const niche = NICHE_MAP[nicheKey] || (isMedical ? NICHE_MAP.medical : NICHE_MAP.general);

  document.getElementById('modal-pitch-business-name').innerText = lead.business_name;
  document.getElementById('modal-pitch-meta').innerText = `${lead.category || niche.name} • ${lead.city || 'Local'} • Phone: ${lead.phone || 'N/A'} • Email: ${lead.email || 'N/A'} • ${niche.icon} ${niche.name} Ready`;

  // Dynamic buttons, tab titles, and hints for this niche
  const btnV1 = document.getElementById('btn-pitch-v1');
  const btnV2 = document.getElementById('btn-pitch-v2');
  const tabBtnRx = document.getElementById('tab-btn-rx');
  const tabBtnAudit = document.getElementById('tab-btn-audit');
  const tabBtnCall = document.getElementById('tab-btn-call');
  const rxHint = document.getElementById('rx-pane-hint');
  const hintCall = document.getElementById('hint-pitch-call');
  const hintWa = document.getElementById('hint-pitch-wa');
  const hintEmail = document.getElementById('hint-pitch-email');
  const copyBtn = document.getElementById('btn-copy-rx');
  const padSymbol = document.getElementById('rx-pad-symbol');
  const padMainTitle = document.getElementById('rx-pad-main-title');
  const padSubTitle = document.getElementById('rx-pad-sub-title');
  const specBadge = document.getElementById('rx-specialty-badge');

  if (btnV1) btnV1.innerHTML = niche.v1Btn;
  if (btnV2) btnV2.innerHTML = niche.v2Btn;
  if (tabBtnRx) tabBtnRx.innerHTML = niche.tabLabel;
  if (tabBtnAudit) tabBtnAudit.innerHTML = niche.auditTabLabel;
  if (tabBtnCall) tabBtnCall.innerHTML = niche.callTabLabel;
  if (rxHint) rxHint.innerHTML = niche.hint;
  if (hintCall) hintCall.innerText = niche.callHint;
  if (hintWa) hintWa.innerText = niche.waHint;
  if (hintEmail) hintEmail.innerText = `💡 Value-first cold email proposal customized for ${lead.business_name}`;
  if (copyBtn) copyBtn.innerHTML = niche.copyLabel;
  if (padSymbol) padSymbol.innerText = niche.badge;
  if (padMainTitle) padMainTitle.innerText = isMedical ? 'CLINICAL GROWTH & PATIENT ACQUISITION PRESCRIPTION' : `${niche.name.toUpperCase()} GROWTH BLUEPRINT & AUDIT`;
  if (padSubTitle) padSubTitle.innerText = isMedical ? 'Personal Brand Authority & Viral Reels Protocol' : 'Founder Video Authority & 24/7 AI Lead Intake Engine';
  if (specBadge) specBadge.innerText = lead.category || niche.name;

  // Parse prescription and pitch versions
  let v1 = { rx: '', wa: '', call: '', email: '' };
  let v2 = { rx: '', wa: '', call: '', email: '' };

  if (lead.doctor_prescription) {
    try {
      const parsedRx = typeof lead.doctor_prescription === 'string' ? JSON.parse(lead.doctor_prescription) : lead.doctor_prescription;
      if (parsedRx && typeof parsedRx === 'object') {
        // Version 1 (AI Avatar Value - No fee payment)
        v1.rx = parsedRx.rxEmail || parsedRx.version1?.rxEmail || '';
        v1.wa = parsedRx.rxMessage || parsedRx.version1?.rxMessage || '';
        v1.call = parsedRx.receptionistScript || parsedRx.version1?.receptionistScript || '';
        v1.email = parsedRx.rxEmail || parsedRx.version1?.rxEmail || '';

        // Version 2 (2-Minute Audit & Scorecard Invitation)
        v2.rx = parsedRx.rxEmail_v2 || parsedRx.version2?.rxEmail || parsedRx.rxEmail || '';
        v2.wa = parsedRx.rxMessage_v2 || parsedRx.version2?.rxMessage || parsedRx.rxMessage || '';
        v2.call = parsedRx.receptionistScript_v2 || parsedRx.version2?.receptionistScript || parsedRx.receptionistScript || '';
        v2.email = parsedRx.rxEmail_v2 || parsedRx.version2?.rxEmail || parsedRx.rxEmail || '';
      }
    } catch (_) {
      v1.rx = lead.doctor_prescription;
      v1.wa = lead.ai_whatsapp_pitch || lead.doctor_prescription;
      v1.call = lead.ai_call_script || '';
      v1.email = lead.ai_email_pitch || lead.doctor_prescription;
    }
  }

  // Fallbacks to generic AI pitches if needed
  if (!v1.rx) v1.rx = lead.ai_email_pitch || `${niche.name} Growth Blueprint being synthesized...`;
  v1.wa = buildViralOutreachMessage(lead, 'outbound');
  if (!v1.call) v1.call = lead.ai_call_script || 'Generating call script...';
  if (!v1.email) v1.email = lead.ai_email_pitch || v1.rx;

  if (!v2.rx) v2.rx = v1.rx;
  v2.wa = buildViralOutreachMessage(lead, 'inbound');
  if (!v2.call) v2.call = v1.call;
  if (!v2.email) v2.email = v1.email;

  window.currentLeadPitches = { v1, v2, phone: lead.phone, whatsapp_url: lead.whatsapp_url };
  activeOutreachVersion = 'v1';

  // Apply default version 1
  applyOutreachPitchVersion('v1');

  // Parse social links for DM actions
  let socials = {};
  try {
    socials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
  } catch (_) {}

  // Facebook Messenger button
  const fbBtn = document.getElementById('btn-open-fb-dm');
  if (fbBtn) {
    if (socials.facebook) {
      const fbHandle = socials.facebook.match(/facebook\.com\/([a-zA-Z0-9._-]+)/i)?.[1] || '';
      fbBtn.href = fbHandle ? `https://m.me/${fbHandle}` : socials.facebook;
      fbBtn.style.display = 'inline-flex';
    } else {
      fbBtn.style.display = 'none';
    }
  }

  // Email button in Rx/Blueprint tab
  const emailRxBtn = document.getElementById('btn-open-email-rx');
  if (emailRxBtn) {
    emailRxBtn.style.display = 'inline-flex';
    emailRxBtn.title = lead.email ? `Draft & send email to ${lead.email}` : 'Enter recipient email and draft pitch';
  }

  // Populate Social Media Audit View
  renderSocialAuditModal(lead);

  // Switch to tailored Blueprint / Rx tab by default for all leads
  switchPitchSubTab('rx');

  modal.style.display = 'flex';
}

function applyOutreachPitchVersion(ver) {
  if (!window.currentLeadPitches) return;
  const data = window.currentLeadPitches[ver] || window.currentLeadPitches.v1;
  if (!data) return;

  const rxElem = document.getElementById('pitch-text-rx');
  const callElem = document.getElementById('pitch-text-call');
  const waElem = document.getElementById('pitch-text-whatsapp');
  const emailElem = document.getElementById('pitch-text-email');

  if (rxElem) rxElem.innerText = data.rx;
  if (callElem) callElem.innerText = data.call;
  if (waElem) waElem.innerText = data.wa;
  if (emailElem) {
    const cleanMail = extractCleanEmailPitch(activeMapsPitchLead || {}, data.email);
    emailElem.innerText = `Subject: ${cleanMail.subject}\n\n${cleanMail.body}`;
  }

  const emailRxBtn = document.getElementById('btn-open-email-rx');
  if (emailRxBtn) {
    emailRxBtn.style.display = 'inline-flex';
  }

  // Update WhatsApp links
  const phone = window.currentLeadPitches.phone || '';
  const cleanDigits = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  const encodedMsg = encodeURIComponent(data.wa);
  const waUrl = window.currentLeadPitches.whatsapp_url;

  const waBtn = document.getElementById('btn-open-wa-direct');
  if (waBtn) {
    waBtn.href = waUrl ? `${waUrl}?text=${encodedMsg}` : (cleanDigits ? `https://wa.me/${cleanDigits}?text=${encodedMsg}` : `https://web.whatsapp.com/send?text=${encodedMsg}`);
  }
  const waRxBtn = document.getElementById('btn-open-wa-rx');
  if (waRxBtn) {
    waRxBtn.href = waUrl ? `${waUrl}?text=${encodedMsg}` : (cleanDigits ? `https://wa.me/${cleanDigits}?text=${encodedMsg}` : `https://web.whatsapp.com/send?text=${encodedMsg}`);
  }
}

function switchOutreachVersion(ver) {
  const btnV1 = document.getElementById('btn-pitch-v1');
  const btnV2 = document.getElementById('btn-pitch-v2');
  if (btnV1 && btnV2) {
    if (ver === 'v1') {
      btnV1.className = 'btn btn-xs btn-primary';
      btnV2.className = 'btn btn-xs btn-outline';
    } else {
      btnV1.className = 'btn btn-xs btn-outline';
      btnV2.className = 'btn btn-xs btn-primary';
    }
  }
  applyOutreachPitchVersion(ver);
}

function renderSocialAuditModal(lead) {
  let audit = null;
  try {
    audit = lead.social_audit ? (typeof lead.social_audit === 'string' ? JSON.parse(lead.social_audit) : lead.social_audit) : null;
  } catch (_) {}

  const isMedical = !!lead.is_medical;
  const nicheKey = isMedical ? 'medical' : detectClientNiche((lead.category || '') + ' ' + (lead.business_name || '') + ' ' + (lead.search_query || ''));
  const niche = NICHE_MAP[nicheKey] || (isMedical ? NICHE_MAP.medical : NICHE_MAP.general);

  const scoreEl = document.getElementById('audit-score-num');
  const diagEl = document.getElementById('audit-diagnosis-text');
  const channelsContainer = document.getElementById('audit-channels-container');
  const hooksContainer = document.getElementById('audit-hooks-container');

  // Update AI Avatar Protocol Box
  const protoIcon = document.getElementById('audit-protocol-icon');
  const protoTitle = document.getElementById('audit-protocol-title');
  const protoTag = document.getElementById('audit-protocol-tag');
  const step1Desc = document.getElementById('audit-step1-desc');
  const step2Desc = document.getElementById('audit-step2-desc');
  const step3Desc = document.getElementById('audit-step3-desc');
  const step4Desc = document.getElementById('audit-step4-desc');
  const hooksHeading = document.getElementById('audit-hooks-heading');

  if (protoIcon) protoIcon.innerText = niche.icon;
  if (protoTitle) protoTitle.innerText = `${niche.roleTitle} AI Avatar & Voice Cloning Protocol`;
  if (protoTag) protoTag.innerText = niche.hoursTag;
  if (step1Desc) step1Desc.innerText = audit?.aiAvatarStrategy?.step1 || niche.step1Desc;
  if (step2Desc) step2Desc.innerText = audit?.aiAvatarStrategy?.step2 || niche.step2Desc;
  if (step3Desc) step3Desc.innerText = audit?.aiAvatarStrategy?.step3 || niche.step3Desc;
  if (step4Desc) step4Desc.innerText = audit?.aiAvatarStrategy?.step4 || niche.step4Desc;
  if (hooksHeading) hooksHeading.innerText = `🎯 3 Viral Reel Hooks Customized for this ${isMedical ? 'Practice' : 'Business'}`;

  if (scoreEl) scoreEl.innerText = audit?.overallScore || (lead.is_medical ? 38 : 45);
  if (diagEl) diagEl.innerText = audit?.diagnosis || niche.diagDefault;

  if (channelsContainer) {
    let socials = {};
    try {
      socials = lead.social_links ? (typeof lead.social_links === 'string' ? JSON.parse(lead.social_links) : lead.social_links) : {};
    } catch (_) {}

    const channelBadges = [];
    const targetKeys = ['instagram', 'facebook', 'youtube', 'linkedin', 'threads'];
    for (const k of targetKeys) {
      if (socials[k]) {
        let handle = '';
        if (k === 'instagram') handle = socials[k].match(/instagram\.com\/([a-zA-Z0-9._-]+)/i)?.[1] || '';
        if (k === 'facebook') handle = socials[k].match(/facebook\.com\/([a-zA-Z0-9._-]+)/i)?.[1] || '';
        channelBadges.push(`
          <div class="audit-channel-badge active">
            <span class="channel-status">✅ Found</span>
            <strong>${k.toUpperCase()}</strong>
            <a href="${escapeHtml(socials[k])}" target="_blank" rel="noopener noreferrer">${escapeHtml(handle ? '@' + handle : 'View Profile')} ↗</a>
          </div>
        `);
      } else {
        channelBadges.push(`
          <div class="audit-channel-badge missing">
            <span class="channel-status">❌ Missing / Inactive</span>
            <strong>${k.toUpperCase()}</strong>
            <span class="text-dim">Zero Reels Detected</span>
          </div>
        `);
      }
    }
    channelsContainer.innerHTML = channelBadges.join('');
  }

  if (hooksContainer) {
    const hooks = (audit?.sampleReelHooks && audit.sampleReelHooks.length > 0) ? audit.sampleReelHooks : [
      {
        title: "Customer Trust Secret",
        hook: `3 things you should NEVER do before hiring a ${lead.category || 'service'} in ${lead.city || 'our city'}!`,
        targetOutcome: "High virality, drives direct qualified inquiries."
      }
    ];

    hooksContainer.innerHTML = hooks.map((h, i) => `
      <div class="audit-hook-card">
        <div class="hook-top">
          <span class="hook-tag">Reel Hook #${i + 1}: ${escapeHtml(h.title)}</span>
          <button class="btn btn-xs btn-outline" onclick="copyReelHookText('${escapeHtml(h.hook).replace(/'/g, "\\'")}')">📋 Copy Hook Script</button>
        </div>
        <div class="hook-quote">"${escapeHtml(h.hook)}"</div>
        <div class="hook-goal">🎯 <em>Goal:</em> ${escapeHtml(h.targetOutcome)}</div>
      </div>
    `).join('');
  }
}

async function copyReelHookText(text) {
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (ok) {
    showLeadNotificationToast('📋 Hook Copied', 'Viral Reel Hook script copied to clipboard!');
  } else {
    alert('Copied hook script!');
  }
}

async function refreshActiveSocialAudit() {
  if (!activeMapsPitchLead) return;
  const btn = document.getElementById('btn-refresh-social-audit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Re-Auditing...`;
  }

  showLeadNotificationToast('🔍 Running Deep Social Audit', `Auditing channels and synthesizing viral hooks for ${activeMapsPitchLead.business_name}...`);

  try {
    const res = await fetch(`/api/maps/leads/${activeMapsPitchLead.id}/audit`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.lead) {
      activeMapsPitchLead = data.lead;
      const idx = allMapsLeads.findIndex(l => l.id === data.lead.id);
      if (idx !== -1) allMapsLeads[idx] = data.lead;
      renderSocialAuditModal(data.lead);
      renderMapsCards(allMapsLeads);
      showLeadNotificationToast('✅ Social Audit Complete', `Audit score: ${data.audit.overallScore}/100. 3 viral reel hooks ready!`);
    } else {
      alert(data.error || 'Failed to refresh social audit');
    }
  } catch (err) {
    alert('Audit error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ Re-Analyze Social Channels`;
    }
  }
}

function closeMapsPitchModal() {
  const modal = document.getElementById('modal-maps-pitch');
  if (modal) modal.style.display = 'none';
}

function switchPitchSubTab(type) {
  document.getElementById('tab-btn-rx')?.classList.toggle('active', type === 'rx');
  document.getElementById('tab-btn-audit')?.classList.toggle('active', type === 'audit');
  document.getElementById('tab-btn-call')?.classList.toggle('active', type === 'call');
  document.getElementById('tab-btn-wa')?.classList.toggle('active', type === 'whatsapp');
  document.getElementById('tab-btn-email')?.classList.toggle('active', type === 'email');

  const pRx = document.getElementById('pane-pitch-rx');
  const pAudit = document.getElementById('pane-pitch-audit');
  const pCall = document.getElementById('pane-pitch-call');
  const pWa = document.getElementById('pane-pitch-whatsapp');
  const pEmail = document.getElementById('pane-pitch-email');

  if (pRx) pRx.style.display = type === 'rx' ? 'block' : 'none';
  if (pAudit) pAudit.style.display = type === 'audit' ? 'block' : 'none';
  if (pCall) pCall.style.display = type === 'call' ? 'block' : 'none';
  if (pWa) pWa.style.display = type === 'whatsapp' ? 'block' : 'none';
  if (pEmail) pEmail.style.display = type === 'email' ? 'block' : 'none';
}

async function copyPitchText(type) {
  let text = '';
  if (type === 'rx') text = document.getElementById('pitch-text-rx')?.innerText || '';
  if (type === 'call') text = document.getElementById('pitch-text-call')?.innerText || '';
  if (type === 'whatsapp') text = document.getElementById('pitch-text-whatsapp')?.innerText || '';
  if (type === 'email') text = document.getElementById('pitch-text-email')?.innerText || '';

  if (text) {
    const ok = await copyToClipboard(text);
    if (ok) {
      showLeadNotificationToast('📋 Copied to Clipboard', `Pitch copied! Ready to paste into dialer, WhatsApp, or email.`);
    } else {
      alert('Copied pitch text!');
    }
  }
}

async function reverifySingleMapsLead(leadId) {
  const btn = document.getElementById(`btn-reverify-lead-${leadId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Verifying...`;
  }

  showLeadNotificationToast('⚡ Verifying Contact Details', 'Inspecting Google Maps place page and hunting contact channels...');

  try {
    const res = await fetch(`/api/maps/leads/${leadId}/reverify`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.lead) {
      const idx = allMapsLeads.findIndex(l => l.id === leadId);
      if (idx !== -1) allMapsLeads[idx] = data.lead;
      renderMapsCards(allMapsLeads);
      loadMapsStats();
      showLeadNotificationToast('✅ Lead 100% Verified', `${data.lead.business_name}: Website (${data.lead.has_website ? 'Verified' : 'No Site'}), Phone (${data.lead.phone || 'N/A'})`);
    } else {
      alert(data.error || 'Failed to re-verify lead');
    }
  } catch (err) {
    alert('Re-verify error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ Re-Verify`;
    }
  }
}

async function triggerBatchReverify() {
  const btn = document.getElementById('btn-maps-reverify-all');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Deep Scanning...`;
  }

  showLeadNotificationToast('⚡ Batch Re-Verification Started', 'Checking all existing leads for verified websites, phones, emails & socials...');

  try {
    const res = await fetch('/api/maps/reverify-all', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog('Initiated batch re-verification of all Google Maps leads in background', 'text-emerald');
    } else {
      alert(data.error || 'Failed to start batch re-verification');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ Re-Verify All Leads';
      }
    }
  } catch (err) {
    alert('Batch reverify error: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '⚡ Re-Verify All Leads';
    }
  }
}

async function findSingleLeadSocials(leadId) {
  const btn = document.getElementById(`btn-find-socials-lead-${leadId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Hunting...`;
  }

  showLeadNotificationToast('🔍 Hunting Social Profiles', 'Searching website DOM and Google for verified Instagram, Facebook, and LinkedIn links...');

  try {
    const res = await fetch(`/api/maps/leads/${leadId}/find-socials`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.lead) {
      const idx = allMapsLeads.findIndex(l => l.id === leadId);
      if (idx !== -1) allMapsLeads[idx] = data.lead;
      renderMapsCards(allMapsLeads);
      loadMapsStats();
      const addedList = data.newlyAdded && data.newlyAdded.length > 0 ? data.newlyAdded.join(', ') : 'Verified';
      showLeadNotificationToast('✅ Socials Updated', `${data.lead.business_name}: Found ${addedList}`);
    } else {
      alert(data.error || 'Failed to hunt socials for lead');
    }
  } catch (err) {
    alert('Social hunt error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🔍 Find Socials`;
    }
  }
}

async function headerTriggerFindSocials() {
  if (typeof switchTab === 'function') {
    switchTab('maps');
  }
  await triggerFindAllSocials();
}

async function headerTriggerEngageSocials() {
  if (typeof switchTab === 'function') {
    switchTab('maps');
  }
  await triggerAutoSocialEngagement();
}

async function triggerFindAllSocials() {
  const btn = document.getElementById('btn-maps-find-all-socials');
  const hBtn = document.getElementById('btn-header-find-socials');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-small"></span> Hunting Socials...`;
  }
  if (hBtn) {
    hBtn.disabled = true;
    hBtn.innerHTML = `<span class="spinner-small"></span> Hunting...`;
  }

  showLeadNotificationToast('🔍 Bulk Social Media Hunter', 'Searching verified Instagram, Facebook, and LinkedIn profiles for leads missing socials...');
  appendTerminalLog('🔍 Bulk Social Hunter started: extracting verified Instagram, Facebook & LinkedIn channels...', 'text-info');

  try {
    const res = await fetch('/api/maps/find-all-socials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 15 })
    });
    const data = await res.json();
    if (data.success) {
      showLeadNotificationToast('✅ Social Enrichment Complete', `Enriched ${data.count || 0} leads with verified social links!`);
      appendTerminalLog(`✅ Social hunter finished: ${data.count || 0} leads enriched with social media links.`, 'text-emerald');
      loadMapsLeads();
      loadMapsStats();
    } else {
      alert(data.error || data.message || 'Failed to start bulk social search');
    }
  } catch (err) {
    alert('Bulk social search error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🔍 Find All Socials`;
    }
    if (hBtn) {
      hBtn.disabled = false;
      hBtn.innerHTML = `<span>🔍 Find All Socials</span>`;
    }
  }
}

async function updateMapsLeadStatus(leadId, status) {
  try {
    await fetch(`/api/maps/leads/${leadId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const lead = allMapsLeads.find(l => l.id === leadId);
    if (lead) lead.status = status;
    loadMapsStats();
  } catch (err) {
    console.error('Failed to update status:', err);
  }
}

async function deleteMapsLead(leadId) {
  if (!confirm('Remove this lead from Google Maps CRM?')) return;
  try {
    await fetch(`/api/maps/leads/${leadId}`, { method: 'DELETE' });
    allMapsLeads = allMapsLeads.filter(l => l.id !== leadId);
    renderMapsCards(allMapsLeads);
    loadMapsStats();
  } catch (err) {
    console.error('Failed to delete lead:', err);
  }
}

function exportMapsCsv() {
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  window.open(`/api/maps/export/csv${tokenParam}`, '_blank');
}

// ==================== INBOUND SCORECARD LEADS CRM ====================
let allScorecardLeads = [];
let activeScorecardLead = null;

async function copyScorecardPublicLink() {
  const base = (activePublicUrl || window.location.origin).replace(/\/+$/, '');
  const url = `${base}/scorecard`;
  await copyToClipboard(url);
  showLeadNotificationToast('🔗 Live Test Link Copied!', `Public shareable audit link copied to clipboard:\n${url}\n\n(Works on any mobile phone, tablet, or client computer outside your laptop)`);
}

async function loadScorecardStats() {
  try {
    const res = await fetch('/api/scorecard/stats');
    if (!res.ok) return;
    const stats = await res.json();

    const elTotal = document.getElementById('sc-stat-total');
    const elUrgent = document.getElementById('sc-stat-urgent');
    const elAvg = document.getElementById('sc-stat-avg');
    const elBooked = document.getElementById('sc-stat-booked');
    const elSidebarCount = document.getElementById('sidebar-scorecard-count');

    if (elTotal) elTotal.innerText = stats.total || 0;
    if (elUrgent) elUrgent.innerText = stats.new_count || 0;
    if (elAvg) elAvg.innerText = `${stats.avg_score || 0}/100`;
    if (elBooked) elBooked.innerText = stats.booked || 0;

    if (elSidebarCount) {
      if (stats.new_count > 0) {
        elSidebarCount.innerText = stats.new_count;
        elSidebarCount.style.display = 'inline-block';
      } else {
        elSidebarCount.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Failed to load scorecard stats:', err);
  }
}

async function loadScorecardLeads() {
  const container = document.getElementById('scorecard-leads-container');
  if (!container) return;

  const status = document.getElementById('sc-filter-status')?.value || 'all';
  const sortBy = document.getElementById('sc-filter-sort')?.value || 'newest';

  try {
    const res = await fetch(`/api/scorecard/leads?status=${status}&sortBy=${sortBy}`);
    if (!res.ok) throw new Error('Failed to load scorecard leads');
    const data = await res.json();
    allScorecardLeads = Array.isArray(data) ? data : (data.leads || []);
    renderScorecardCards(allScorecardLeads);
    loadScorecardStats();
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Error loading scorecard leads</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

function filterScorecardCardsLocally() {
  const q = document.getElementById('sc-search-input')?.value.toLowerCase().trim() || '';
  if (!q) {
    renderScorecardCards(allScorecardLeads);
    return;
  }
  const filtered = allScorecardLeads.filter(l => 
    (l.business_name && l.business_name.toLowerCase().includes(q)) ||
    (l.contact_person && l.contact_person.toLowerCase().includes(q)) ||
    (l.city && l.city.toLowerCase().includes(q)) ||
    (l.business_type && l.business_type.toLowerCase().includes(q))
  );
  renderScorecardCards(filtered);
}

function renderScorecardCards(leads) {
  const container = document.getElementById('scorecard-leads-container');
  if (!container) return;

  if (!leads || leads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No Inbound Scorecard Submissions Found</h3>
        <p>Send your test link to prospective clinics or open the diagnostic assessment below.</p>
        <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
          <a href="/scorecard" target="_blank" class="btn btn-sm btn-primary">🚀 Take Sample Test</a>
          <button class="btn btn-sm btn-outline" onclick="copyScorecardPublicLink()">🔗 Copy Test Link</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = leads.map(l => {
    let scoreColor = '#10b981';
    let gradeLabel = 'STRONG';
    if (l.overall_score < 40) {
      scoreColor = '#ef4444';
      gradeLabel = 'CRITICAL AVDS';
    } else if (l.overall_score < 65) {
      scoreColor = '#f59e0b';
      gradeLabel = 'NEEDS ATTENTION';
    }

    const cleanPhone = (l.phone || '').replace(/[^\d+]/g, '');
    const cleanDigits = cleanPhone.replace(/^\+/, '');
    const defaultScenario = (l.source === 'scorecard_test') ? 'inbound' : 'outbound';
    const waMsg = buildViralOutreachMessage(l, defaultScenario);
    const waFollowup = encodeURIComponent(waMsg);
    const waUrl = cleanDigits ? `https://wa.me/${cleanDigits}?text=${waFollowup}` : `https://web.whatsapp.com/send?text=${waFollowup}`;
    const cleanCardName = getCleanSalutation(l);

    return `
      <div class="lead-card" id="sc-card-${l.id}" style="border-top: 3px solid ${scoreColor};">
        <div class="lead-card-header">
          <div class="lead-author-info">
            <div class="lead-author-avatar" style="background: rgba(6, 182, 212, 0.15); color: #38bdf8;">🩺</div>
            <div>
              <div class="lead-author-name" style="font-weight: 800; font-size: 1.05rem;">
                ${cleanCardName}
              </div>
              <div class="lead-author-handle" style="color: #cbd5e1; font-weight: 600;">
                ${l.business_name} • ${l.city || 'Local Area'}
              </div>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="display: inline-block; padding: 0.25rem 0.65rem; border-radius: 999px; font-weight: 800; font-size: 0.85rem; background: ${scoreColor}22; color: ${scoreColor}; border: 1px solid ${scoreColor}44;">
              ${l.overall_score}/100 ${gradeLabel}
            </div>
            <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 0.25rem;">
              ${new Date(l.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>

        <!-- Pillar Subscores -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 0.6rem; margin: 0.75rem 0;">
          <div style="text-align: center;">
            <div style="font-size: 0.95rem; font-weight: 700; color: #ef4444;">${l.video_score}/100</div>
            <div style="font-size: 0.68rem; color: #94a3b8;">🎥 Video Authority</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 0.95rem; font-weight: 700; color: #f59e0b;">${l.discovery_score}/100</div>
            <div style="font-size: 0.68rem; color: #94a3b8;">📍 Discovery & Maps</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 0.95rem; font-weight: 700; color: #3b82f6;">${l.conversion_score}/100</div>
            <div style="font-size: 0.68rem; color: #94a3b8;">⚡ Lead Response</div>
          </div>
        </div>

        <!-- Consultation & Contact Strip -->
        <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 0.85rem; line-height: 1.5;">
          ${l.consultation_fee ? `<div>💰 <strong>Fee:</strong> ${l.consultation_fee} • ⏰ <strong>Timings:</strong> ${l.work_timing || 'Flexible'}</div>` : ''}
          ${l.phone ? `<div>📞 <strong>Phone:</strong> ${l.phone}</div>` : ''}
          ${l.email ? `<div>✉️ <strong>Email:</strong> ${l.email}</div>` : ''}
        </div>

        <!-- Card Action Buttons -->
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 0.85rem;">
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <button class="btn btn-sm btn-primary" onclick="openScorecardDetailModal(${l.id})">
              <span>🩺 View Full ℞ & Answers</span>
            </button>
            <a href="${l.pdf_url || `/api/scorecard/leads/${l.id}/pdf`}" target="_blank" class="btn btn-sm btn-outline" style="border-color: #38bdf8; color: #38bdf8;" title="View Official Clinical PDF">
              <span>📄 ℞ PDF</span>
            </a>
            <a href="${waUrl}" target="_blank" class="btn btn-sm btn-success" title="Open viral WhatsApp pitch">
              <span>💬 WhatsApp</span>
            </a>
            <button type="button" class="btn btn-sm btn-outline" onclick="triggerScorecardEmailActionById(${l.id})" title="Send personalized cold email pitch with scorecard">
              <span>✉️ Send Email</span>
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <select class="filter-select" style="padding: 0.3rem 0.5rem; font-size: 0.78rem;" onchange="updateScorecardLeadStatus(${l.id}, this.value)">
              <option value="new" ${l.status === 'new' ? 'selected' : ''}>🔥 New</option>
              <option value="contacted" ${l.status === 'contacted' ? 'selected' : ''}>💬 Contacted</option>
              <option value="meeting_booked" ${l.status === 'meeting_booked' ? 'selected' : ''}>📅 Booked</option>
              <option value="converted" ${l.status === 'converted' ? 'selected' : ''}>🏆 Converted</option>
            </select>
            <button class="btn btn-xs btn-outline-danger" onclick="deleteScorecardLead(${l.id})" title="Delete Lead">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getCleanSalutation(lead) {
  const isMed = ((lead.business_type || '') + ' ' + (lead.business_name || '')).toLowerCase().match(/dental|clinic|doctor|dentist|health|physician|surgeon|aesthetic/i);
  let raw = (lead.contact_person || '').trim();
  // Strip duplicate Dr./Doctor
  raw = raw.replace(/^(?:dr\.?\s*|doctor\s*)+/i, '').trim();

  const isGeneric = !raw || 
    /^clinic director/i.test(raw) || 
    /team$/i.test(raw) || 
    raw.toLowerCase() === 'director' || 
    raw.toLowerCase() === 'doctor' ||
    raw.toLowerCase().includes('practice principal');

  if (isGeneric) {
    return isMed ? `Doctor & Practice Principal` : `${lead.business_name} Team`;
  }
  return isMed ? `Dr. ${raw}` : raw;
}

function buildViralOutreachMessage(lead, scenario = 'inbound') {
  const salutation = getCleanSalutation(lead);
  const pdfUrl = lead.pdf_url 
    ? (lead.pdf_url.startsWith('http') ? lead.pdf_url : `https://crm.thedigitalfrog.com${lead.pdf_url}`)
    : (lead.id ? `https://crm.thedigitalfrog.com/api/scorecard/leads/${lead.id}/pdf` : `https://crm.thedigitalfrog.com/scorecard`);

  const interactiveUrl = lead.id ? `https://crm.thedigitalfrog.com/scorecard?report=${lead.id}` : `https://crm.thedigitalfrog.com/scorecard`;
  const ratingText = lead.rating ? `${lead.rating}⭐ (${lead.reviews_count || 0} reviews)` : 'top-tier offline reputation';

  if (scenario === 'inbound') {
    // Scenario A: Inbound Self-Diagnostic (Lead submitted the test themselves on crm.thedigitalfrog.com/scorecard)
    return `Hello ${salutation},

Reviewing the clinical growth audit you just generated for ${lead.business_name} (Digital Score: ${lead.overall_score || 26}/100).

Seeing that score on paper is usually an eye-opener: your offline reputation is exceptional, but digitally you are virtually invisible to the 80% of local patients researching procedure explanations on Instagram Reels & YouTube before booking.

Patients in ${lead.city || 'your area'} aren't choosing better specialists — they're simply choosing the ones showing up on their feeds explaining procedures.

📄 Here is your official Rx Growth Prescription:
${pdfUrl}
(Live Interactive Audit: ${interactiveUrl})

Inside, we've mapped out:
1. 3 Custom Viral Educational Hooks for ${lead.business_name}
2. The AI Avatar Protocol: How we clone your likeness and voice from a single 2-minute phone recording to produce 15 educational Reels/month — without taking 1 minute away from your clinical schedule.

I rendered a 40-second private test sample showing what your AI Video Clone looks and sounds like. Can I drop that 40-second preview right here for you to check out?

— Suraj Jaiswal
Founder, The Digital Frog
📅 Calendar: https://topmate.io/isurajjaiswal`;
  } else {
    // Scenario B: Cold Outbound Lead Outreach (Discovered via Google Maps / Social)
    return `Hello ${salutation},

Quick question: why is a practice with ${ratingText} in ${lead.city || 'your area'} completely absent from local patient video feeds?

While researching top specialists in ${lead.city || 'your area'}, I noticed a massive discrepancy: your clinical reputation is top-tier, but rival clinics with half your experience are winning high-ticket private cases simply because their doctors appear regularly on Instagram Reels and YouTube.

We put together a private, confidential Rx Growth Prescription for ${lead.business_name}:
📄 Official Rx Practice Audit:
${pdfUrl}

It diagnoses 3 critical patient leakage points and scripts 3 viral educational Reel concepts tailored specifically for your clinic.

We also designed an AI Doctor Avatar protocol that produces 15 patient-education Reels a month in your authentic voice and likeness — from just a single 2-minute phone video, so you never sacrifice clinical hours to studio cameras.

Would you be open to a 30-second preview of what your AI Avatar looks like?

— Suraj Jaiswal
Practice Growth Strategist, The Digital Frog
📅 Calendar: https://topmate.io/isurajjaiswal`;
  }
}

function openScorecardDetailModal(leadId) {
  const lead = allScorecardLeads.find(l => l.id === leadId);
  if (!lead) return;

  activeScorecardLead = lead;
  const modal = document.getElementById('modal-scorecard-detail');
  if (!modal) return;

  const cleanTitleName = getCleanSalutation(lead);
  document.getElementById('modal-sc-doctor-title').innerText = `${cleanTitleName} (${lead.business_name})`;
  document.getElementById('modal-sc-meta').innerText = `${lead.business_type || 'Practice'} • ${lead.city || 'Local Area'} • Phone: ${lead.phone || 'N/A'} • Email: ${lead.email || 'N/A'}`;

  // Score badge & breakdown
  let scoreColor = '#10b981';
  let gradeText = 'STRONG';
  if (lead.overall_score < 40) {
    scoreColor = '#ef4444';
    gradeText = 'CRITICAL AVDS';
  } else if (lead.overall_score < 65) {
    scoreColor = '#f59e0b';
    gradeText = 'NEEDS ATTENTION';
  }
  const badge = document.getElementById('modal-sc-grade-badge');
  if (badge) {
    badge.innerText = `Score: ${lead.overall_score}/100 (${gradeText})`;
    badge.style.color = scoreColor;
    badge.style.background = `${scoreColor}22`;
  }

  document.getElementById('modal-sc-score-video').innerText = `${lead.video_score}/100`;
  document.getElementById('modal-sc-score-disc').innerText = `${lead.discovery_score}/100`;
  document.getElementById('modal-sc-score-conv').innerText = `${lead.conversion_score}/100`;

  document.getElementById('modal-sc-fee').innerText = lead.consultation_fee || 'Not Specified';
  document.getElementById('modal-sc-timing').innerText = lead.work_timing || 'Flexible';
  document.getElementById('modal-sc-status-select').value = lead.status || 'new';
  document.getElementById('modal-sc-notes-input').value = lead.notes || '';

  // Setup Viral Hook Scenario Section
  window.activeScorecardScenario = (lead.source === 'scorecard_test') ? 'inbound' : 'outbound';
  
  function updateScorecardModalViralUi() {
    const sc = window.activeScorecardScenario || 'inbound';
    const msg = buildViralOutreachMessage(lead, sc);
    const preview = document.getElementById('modal-sc-viral-msg-preview');
    if (preview) preview.value = msg;

    const desc = document.getElementById('sc-scenario-desc');
    if (desc) {
      desc.innerText = sc === 'inbound'
        ? 'Inbound copy: Cites self-test score & video absence wakeup call.'
        : 'Outbound copy: Discrepancy pattern break (high rating vs zero Reels presence).';
    }

    const tabIn = document.getElementById('sc-tab-inbound');
    const tabOut = document.getElementById('sc-tab-outbound');
    if (tabIn && tabOut) {
      if (sc === 'inbound') {
        tabIn.classList.add('active');
        tabOut.classList.remove('active');
      } else {
        tabOut.classList.add('active');
        tabIn.classList.remove('active');
      }
    }

    const cleanPhone = (lead.phone || '').replace(/[^\d+]/g, '');
    const cleanDigits = cleanPhone.replace(/^\+/, '');
    const encoded = encodeURIComponent(msg);
    const waUrl = cleanDigits ? `https://wa.me/${cleanDigits}?text=${encoded}` : `https://web.whatsapp.com/send?text=${encoded}`;

    const sendBtn = document.getElementById('modal-sc-viral-wa-send-btn');
    if (sendBtn) sendBtn.href = waUrl;

    const topWaBtn = document.getElementById('modal-sc-wa-btn');
    if (topWaBtn) topWaBtn.href = waUrl;
  }
  window.updateScorecardModalViralUi = updateScorecardModalViralUi;
  updateScorecardModalViralUi();

  // PDF Link
  const pdfBtn = document.getElementById('modal-sc-pdf-btn');
  if (pdfBtn) {
    pdfBtn.href = lead.pdf_url || `/api/scorecard/leads/${lead.id}/pdf`;
  }

  // Email button state
  const emailBtn = document.getElementById('modal-sc-email-btn');
  if (emailBtn) {
    emailBtn.title = lead.email ? `Draft & send email pitch to ${lead.email}` : 'Enter recipient email and draft pitch';
  }

  // Prescription text box - ensure never blank
  if (lead.prescription_text && lead.prescription_text !== 'No prescription generated.') {
    document.getElementById('modal-sc-rx-pre').innerText = lead.prescription_text;
  } else {
    document.getElementById('modal-sc-rx-pre').innerText = 'Loading official prescription...';
    fetch(`/api/scorecard/leads/${lead.id}/pdf`)
      .then(() => fetch('/api/scorecard/leads'))
      .then(r => r.json())
      .then(leads => {
        const updated = leads.find(l => l.id === lead.id);
        if (updated && updated.prescription_text) {
          lead.prescription_text = updated.prescription_text;
          lead.pdf_url = updated.pdf_url;
          document.getElementById('modal-sc-rx-pre').innerText = updated.prescription_text;
          if (pdfBtn) pdfBtn.href = updated.pdf_url || `/api/scorecard/leads/${lead.id}/pdf`;
          updateScorecardModalViralUi();
        }
      })
      .catch(() => {
        document.getElementById('modal-sc-rx-pre').innerText = 'Official clinical prescription ready. Click "View / Download ℞ PDF" above to review.';
      });
  }

  // Answers list
  let answersObj = {};
  try {
    answersObj = typeof lead.answers === 'string' ? JSON.parse(lead.answers) : lead.answers;
  } catch (_) {}

  const answersContainer = document.getElementById('modal-sc-answers-list');
  if (answersContainer) {
    const keys = Object.keys(answersObj || {});
    if (keys.length === 0) {
      answersContainer.innerHTML = '<div>No specific answers recorded.</div>';
    } else {
      answersContainer.innerHTML = keys.map(k => `
        <div style="border-left: 2px solid #38bdf8; padding-left: 0.6rem;">
          <strong style="color: #f8fafc;">${k.replace(/_/g, ' ').toUpperCase()}:</strong>
          <span style="color: #94a3b8; margin-left: 0.35rem;">${answersObj[k]}</span>
        </div>
      `).join('');
    }
  }

  modal.style.display = 'flex';
}

window.switchScorecardScenario = function(sc) {
  window.activeScorecardScenario = sc;
  if (typeof window.updateScorecardModalViralUi === 'function') {
    window.updateScorecardModalViralUi();
  }
};

window.copyCurrentScorecardViralMessage = async function() {
  const preview = document.getElementById('modal-sc-viral-msg-preview');
  if (preview && preview.value) {
    await copyToClipboard(preview.value);
    showLeadNotificationToast('📋 Copied!', 'Viral pattern-break message copied to clipboard.');
  }
};

function closeScorecardDetailModal() {
  const modal = document.getElementById('modal-scorecard-detail');
  if (modal) modal.style.display = 'none';
  activeScorecardLead = null;
}

async function copyScorecardModalRx() {
  const text = document.getElementById('modal-sc-rx-pre')?.innerText || '';
  if (text) {
    await copyToClipboard(text);
    showLeadNotificationToast('📋 Copied!', '℞ Prescription copied to clipboard.');
  }
}

async function updateScorecardStatusFromModal(newStatus) {
  if (!activeScorecardLead) return;
  await updateScorecardLeadStatus(activeScorecardLead.id, newStatus);
}

// ==================== SMART EMAIL COMPOSER & ACTIONS ====================
async function openSmartEmailComposer(recipientEmail, subject, body, leadName, leadId = null, leadType = null) {
  let email = (recipientEmail || '').trim();

  if (!email) {
    const input = prompt(`No direct email on file for ${leadName || 'this lead'}.\nPlease enter the recipient's email address:`, '');
    if (!input || !input.trim()) {
      const shouldCopy = confirm('Would you like to copy the cold email pitch & private scorecard link to your clipboard instead?');
      if (shouldCopy) {
        await copyToClipboard(`Subject: ${subject}\n\n${body}`).catch(() => {});
        showLeadNotificationToast('📋 Pitch Copied!', 'Cold email pitch & private audit link stored in clipboard. Ready to paste!');
      }
      return;
    }
    email = input.trim();
    if (leadId && leadType) {
      const endpoint = leadType === 'scorecard' ? `/api/scorecard/leads/${leadId}/email` : `/api/maps/leads/${leadId}/email`;
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      }).catch(() => {});
    }
  }

  // Always copy full email pitch to clipboard for convenience
  await copyToClipboard(`Subject: ${subject}\n\n${body}`).catch(() => {});

  const encSub = encodeURIComponent(subject);
  const encBody = encodeURIComponent(body);
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encSub}&body=${encBody}`;
  const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encSub}&body=${encBody}`;

  // Try opening Gmail Web in a new tab first
  const win = window.open(gmailUrl, '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    // Popup was blocked or user prefers mailto client
    window.location.href = mailtoUrl;
    showLeadNotificationToast('✉️ Opening Email App', `Drafting message to ${email}. Pitch text also copied to clipboard!`);
  } else {
    showLeadNotificationToast('✉️ Gmail Composer Opened!', `Pre-filled pitch for ${email} loaded in Gmail & copied to clipboard!`);
  }
}

async function triggerScorecardEmailAction() {
  if (!activeScorecardLead) return;
  const lead = activeScorecardLead;
  const origin = window.location.origin;
  const reportUrl = `${origin}/scorecard?report=${lead.id}`;
  const topmateUrl = 'https://topmate.io/isurajjaiswal';
  const name = lead.contact_person || 'Director';
  const business = lead.business_name || 'Practice';
  const city = lead.city || 'your area';

  const subject = `Quick question regarding ${business} (${city} patient acquisition)`;
  const body = `Hi ${name},

I reviewed ${business} and put together a private, 2-minute Digital Growth Audit & AI Video Roadmap specifically for your practice.

👉 View Your Custom Practice Scorecard & Video Audit:
${reportUrl}

It breaks down 3 key opportunities (including how competing practices in ${city} are winning high-ticket cases through short-form educational video) along with 3 viral video concepts tailored for your practice.

Would you be open to a brief 5-minute chat this week on how we can implement this for you on autopilot?

Feel free to pick a convenient briefing time here:
${topmateUrl}

Best regards,

Suraj Jaiswal
Founder, The Digital Frog | Medical AI & Patient Growth Engine
Calendar: ${topmateUrl}
Email: hello@surajjaiswal.com`;

  await openSmartEmailComposer(lead.email, subject, body, lead.business_name, lead.id, 'scorecard');
}

async function triggerScorecardEmailActionById(leadId) {
  const lead = allScorecardLeads.find(l => l.id === leadId);
  if (!lead) return;
  activeScorecardLead = lead;
  await triggerScorecardEmailAction();
}

async function triggerMapsEmailAction() {
  if (!activeMapsPitchLead) return;
  const lead = activeMapsPitchLead;
  const curVer = window.currentPitchVersion || 'v1';
  const currentPitch = window.currentLeadPitches?.[curVer] || window.currentLeadPitches?.v1 || {};
  const cleanMail = extractCleanEmailPitch(lead, currentPitch.email || lead.ai_email_pitch || '');

  const subject = cleanMail.subject || `Growth inquiry for ${lead.business_name}`;
  const body = cleanMail.body || lead.ai_email_pitch || '';

  await openSmartEmailComposer(lead.email, subject, body, lead.business_name, lead.id, 'maps');
}

async function triggerLeadEmailClick(leadId) {
  const lead = allMapsLeads.find(l => l.id === leadId);
  if (!lead) return;
  const cleanMail = extractCleanEmailPitch(lead);
  const subject = cleanMail.subject || `Growth inquiry for ${lead.business_name}`;
  const body = cleanMail.body || lead.ai_email_pitch || '';

  await openSmartEmailComposer(lead.email, subject, body, lead.business_name, lead.id, 'maps');
}

async function updateScorecardLeadStatus(leadId, status) {
  try {
    await fetch(`/api/scorecard/leads/${leadId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const lead = allScorecardLeads.find(l => l.id === leadId);
    if (lead) lead.status = status;
    loadScorecardStats();
  } catch (err) {
    console.error('Failed to update scorecard status:', err);
  }
}

async function saveScorecardNotesFromModal() {
  if (!activeScorecardLead) return;
  const notes = document.getElementById('modal-sc-notes-input')?.value || '';
  try {
    await fetch(`/api/scorecard/leads/${activeScorecardLead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
    activeScorecardLead.notes = notes;
    showLeadNotificationToast('✅ Note Saved', 'Follow-up note updated in CRM.');
  } catch (err) {
    alert('Failed to save note: ' + err.message);
  }
}

async function deleteScorecardLead(leadId) {
  if (!confirm('Delete this inbound scorecard lead from CRM?')) return;
  try {
    await fetch(`/api/scorecard/leads/${leadId}`, { method: 'DELETE' });
    allScorecardLeads = allScorecardLeads.filter(l => l.id !== leadId);
    renderScorecardCards(allScorecardLeads);
    loadScorecardStats();
  } catch (err) {
    console.error('Failed to delete lead:', err);
  }
}

// ==================== REACHINBOX INTEGRATION & CSV EXPORT ====================
let reachInboxTargetLeadId = null;

async function loadReachInboxSettings() {
  try {
    const res = await fetch('/api/reachinbox/config');
    if (!res.ok) return;
    const config = await res.json();
    const keyInput = document.getElementById('reachinbox-api-key');
    const cmpInput = document.getElementById('reachinbox-campaign-id');
    const autoSync = document.getElementById('reachinbox-auto-sync');
    const badge = document.getElementById('reachinbox-status-badge');

    if (keyInput && config.apiKey) keyInput.value = config.apiKey;
    if (cmpInput && config.campaignId) cmpInput.value = config.campaignId;
    if (autoSync && config.autoSync !== undefined) autoSync.checked = Boolean(config.autoSync);

    if (badge) {
      if (config.apiKey) {
        badge.innerText = '● ReachInbox Connected';
        badge.style.color = '#34d399';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else {
        badge.innerText = '○ API Key Required';
        badge.style.color = '#94a3b8';
        badge.style.background = 'rgba(148, 163, 184, 0.1)';
        badge.style.borderColor = 'rgba(148, 163, 184, 0.2)';
      }
    }
  } catch (err) {
    console.debug('Failed to load ReachInbox config:', err);
  }
}

async function saveReachInboxSettings(event) {
  if (event) event.preventDefault();
  const apiKey = document.getElementById('reachinbox-api-key')?.value.trim() || '';
  const campaignId = document.getElementById('reachinbox-campaign-id')?.value.trim() || '';
  const autoSync = document.getElementById('reachinbox-auto-sync')?.checked || false;

  try {
    const res = await fetch('/api/reachinbox/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, campaignId, autoSync })
    });
    const data = await res.json();
    if (data.success) {
      showLeadNotificationToast('✅ ReachInbox Saved', 'ReachInbox settings updated successfully.');
      loadReachInboxSettings();
    } else {
      alert(data.error || 'Failed to save ReachInbox settings');
    }
  } catch (err) {
    alert('Error saving ReachInbox settings: ' + err.message);
  }
}

async function testReachInboxConnection() {
  const resultDiv = document.getElementById('reachinbox-test-result');
  const apiKey = document.getElementById('reachinbox-api-key')?.value.trim();
  const campaignId = document.getElementById('reachinbox-campaign-id')?.value.trim();

  if (resultDiv) {
    resultDiv.innerHTML = '<span style="color: #60a5fa;">⏳ Testing ReachInbox connection...</span>';
  }

  try {
    const res = await fetch('/api/reachinbox/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, campaignId })
    });
    const data = await res.json();
    if (data.success) {
      if (resultDiv) {
        resultDiv.innerHTML = `<span style="color: #34d399;">✅ Connected! ReachInbox API verified. ${escapeHtml(data.message || '')}</span>`;
      }
      showLeadNotificationToast('🔌 ReachInbox Online', 'ReachInbox API connection verified.');
    } else {
      if (resultDiv) {
        resultDiv.innerHTML = `<span style="color: #ef4444;">❌ Connection failed: ${escapeHtml(data.error || 'Invalid API Key or Campaign')}</span>`;
      }
    }
  } catch (err) {
    if (resultDiv) {
      resultDiv.innerHTML = `<span style="color: #ef4444;">❌ Error: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function exportReachInboxCsv() {
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  window.open(`/api/maps/export-reachinbox${tokenParam}`, '_blank');
  showLeadNotificationToast('📥 Export Started', 'Downloading ReachInbox CSV with clean Scorecard URLs.');
}

function openReachInboxModal(singleLeadId = null) {
  reachInboxTargetLeadId = singleLeadId;
  const modal = document.getElementById('modal-reachinbox-sync');
  const countSpan = document.getElementById('reachinbox-sync-count');
  const cmpInput = document.getElementById('reachinbox-sync-campaign-id');
  const savedCmp = document.getElementById('reachinbox-campaign-id')?.value || '';
  const progressDiv = document.getElementById('reachinbox-sync-progress');

  if (progressDiv) progressDiv.style.display = 'none';

  if (cmpInput && savedCmp) {
    cmpInput.value = savedCmp;
  }

  if (singleLeadId) {
    const lead = allMapsLeads.find(l => l.id === singleLeadId);
    if (countSpan) {
      countSpan.innerText = lead ? `1 Lead (${lead.business_name})` : `Lead #${singleLeadId}`;
    }
  } else {
    const emailLeads = allMapsLeads.filter(l => l.email && l.email.includes('@'));
    if (countSpan) {
      countSpan.innerText = `${emailLeads.length} Verified Email Leads in CRM`;
    }
  }

  if (modal) modal.style.display = 'flex';
}

function closeReachInboxModal() {
  const modal = document.getElementById('modal-reachinbox-sync');
  if (modal) modal.style.display = 'none';
  reachInboxTargetLeadId = null;
}

async function submitReachInboxSync() {
  const btn = document.getElementById('btn-submit-reachinbox-sync');
  const cmpInput = document.getElementById('reachinbox-sync-campaign-id');
  const progressDiv = document.getElementById('reachinbox-sync-progress');
  const campaignId = cmpInput?.value.trim();

  if (btn) btn.disabled = true;
  if (progressDiv) {
    progressDiv.style.display = 'block';
    progressDiv.style.background = 'rgba(59, 130, 246, 0.15)';
    progressDiv.style.color = '#93c5fd';
    progressDiv.innerText = 'Pushing leads and custom scorecard URLs to ReachInbox...';
  }

  try {
    const payload = {};
    if (campaignId) payload.campaignId = campaignId;
    if (reachInboxTargetLeadId) payload.leadIds = [reachInboxTargetLeadId];

    const res = await fetch('/api/reachinbox/push-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (progressDiv) {
        progressDiv.style.background = 'rgba(16, 185, 129, 0.15)';
        progressDiv.style.color = '#34d399';
        progressDiv.innerText = `✅ Successfully synced ${data.synced || 0} leads to ReachInbox!`;
      }
      showLeadNotificationToast('🚀 ReachInbox Synced', `Pushed ${data.synced || 0} leads to campaign.`);
      setTimeout(() => {
        closeReachInboxModal();
      }, 1800);
    } else {
      if (progressDiv) {
        progressDiv.style.background = 'rgba(239, 68, 68, 0.15)';
        progressDiv.style.color = '#fca5a5';
        progressDiv.innerText = `❌ Sync failed: ${data.error || 'Check ReachInbox API key & Campaign ID'}`;
      }
    }
  } catch (err) {
    if (progressDiv) {
      progressDiv.style.background = 'rgba(239, 68, 68, 0.15)';
      progressDiv.style.color = '#fca5a5';
      progressDiv.innerText = `❌ Error: ${err.message}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==================== AUTO SCORECARD & SOCIAL PIPELINE ====================
async function triggerAutoScorecards() {
  appendTerminalLog('🔄 Generating diagnostic scorecards & public links for all Google Maps leads...', 'text-info');
  showLeadNotificationToast('⏳ Processing Scorecards', 'Generating clinical/business scorecards & clean email pitches for all leads...');
  try {
    const res = await fetch('/api/maps/auto-scorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog(`✅ Scorecards generated: ${data.total} processed (${data.created} new, ${data.updated} updated).`, 'text-emerald');
      showLeadNotificationToast('📋 Scorecards Ready', `Generated ${data.total} scorecards with live links.`);
      loadMapsLeads();
      loadScorecardLeads();
    } else {
      appendTerminalLog(`Scorecard generation error: ${data.error}`, 'text-danger');
    }
  } catch (err) {
    appendTerminalLog(`Failed to run auto-scorecards: ${err.message}`, 'text-danger');
  }
}

async function loadSocialAutomationSettings() {
  try {
    const res = await fetch('/api/social-engagement/status');
    if (!res.ok) return;
    const data = await res.json();

    const timesInput = document.getElementById('social-schedule-times');
    const likesInput = document.getElementById('social-daily-likes');
    const commentsInput = document.getElementById('social-daily-comments');
    const dmsInput = document.getElementById('social-daily-dms');
    const enabledInput = document.getElementById('social-auto-enabled');
    const badge = document.getElementById('social-scheduler-badge');

    if (timesInput && data.scheduleTimes) timesInput.value = data.scheduleTimes.join(', ');
    if (likesInput && data.quotas?.likes?.max) likesInput.value = data.quotas.likes.max;
    if (commentsInput && data.quotas?.comments?.max) commentsInput.value = data.quotas.comments.max;
    if (dmsInput && data.quotas?.dms?.max) dmsInput.value = data.quotas.dms.max;
    if (enabledInput && data.enabled !== undefined) enabledInput.checked = Boolean(data.enabled);

    if (badge) {
      if (data.enabled) {
        badge.innerText = `● Active (${data.scheduleTimes?.join(' & ') || 'Daily'})`;
        badge.style.color = '#34d399';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
      } else {
        badge.innerText = '○ Automation Paused';
        badge.style.color = '#94a3b8';
        badge.style.background = 'rgba(148, 163, 184, 0.1)';
      }
    }
  } catch (err) {
    console.debug('Failed to load social automation config:', err);
  }
}

async function saveSocialAutomationSettings(event) {
  if (event) event.preventDefault();
  const timesRaw = document.getElementById('social-schedule-times')?.value || '10:00, 15:00';
  const maxDailyLikes = parseInt(document.getElementById('social-daily-likes')?.value || '25', 10);
  const maxDailyComments = parseInt(document.getElementById('social-daily-comments')?.value || '15', 10);
  const maxDailyDMs = parseInt(document.getElementById('social-daily-dms')?.value || '10', 10);
  const enabled = document.getElementById('social-auto-enabled')?.checked ?? true;

  try {
    const res = await fetch('/api/social-engagement/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ times: timesRaw, maxLikes: maxDailyLikes, maxComments: maxDailyComments, maxDMs: maxDailyDMs, enabled })
    });
    const data = await res.json();
    if (data.success) {
      showLeadNotificationToast('✅ Social Automation Saved', 'Schedule & safety limits updated.');
      loadSocialAutomationSettings();
    } else {
      alert(data.error || 'Failed to save social automation config');
    }
  } catch (err) {
    alert('Error saving social automation: ' + err.message);
  }
}

async function triggerAutoSocialEngagement() {
  const hBtn = document.getElementById('btn-header-engage-socials');
  if (hBtn) {
    hBtn.disabled = true;
    hBtn.innerHTML = `<span class="spinner-small"></span> Engaging...`;
  }

  appendTerminalLog('📱 Starting automated social engagement pipeline (Like -> Comment -> DM)...', 'text-info');
  showLeadNotificationToast('📱 Social Pipeline Active', 'Running safe engagement batch adhering to platform rate limits...');
  const statusDiv = document.getElementById('social-auto-status');
  if (statusDiv) {
    statusDiv.innerHTML = '<span style="color: #34d399;">⏳ Executing social engagement batch...</span>';
  }

  try {
    const res = await fetch('/api/maps/leads/auto-engage-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 })
    });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog(`📱 Social engagement batch finished: ${data.processed || 0} leads engaged.`, 'text-emerald');
      showLeadNotificationToast('✅ Engagement Batch Done', `Engaged ${data.processed || 0} leads with scorecard DMs.`);
      if (statusDiv) {
        statusDiv.innerHTML = `<span style="color: #34d399;">✅ Batch complete: Engaged ${data.processed || 0} prospects successfully.</span>`;
      }
      loadMapsLeads();
    } else {
      appendTerminalLog(`Social batch notice: ${data.error || data.message}`, 'text-warning');
      if (statusDiv) {
        statusDiv.innerHTML = `<span style="color: #f59e0b;">Notice: ${escapeHtml(data.error || data.message || '')}</span>`;
      }
    }
  } catch (err) {
    appendTerminalLog(`Social batch error: ${err.message}`, 'text-danger');
    if (statusDiv) {
      statusDiv.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(err.message)}</span>`;
    }
  } finally {
    if (hBtn) {
      hBtn.disabled = false;
      hBtn.innerHTML = `<span>📱 Engage Socials</span>`;
    }
  }
}

async function engageSingleSocialLead(leadId) {
  const lead = allMapsLeads.find(l => l.id === leadId);
  const name = lead ? lead.business_name : `Lead #${leadId}`;
  appendTerminalLog(`📱 Initiating 3-step social engagement pipeline for ${name}...`, 'text-info');
  showLeadNotificationToast('📱 Social Outreach Running', `Liking recent post, posting expert comment & sending DM for ${name}...`);

  try {
    const res = await fetch(`/api/maps/leads/${leadId}/engage-social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      appendTerminalLog(`✅ Social engagement complete for ${name}!`, 'text-emerald');
      if (data.dynamicComment) {
        appendTerminalLog(`💬 Bespoke Comment: "${data.dynamicComment}"`, 'text-cyan');
      }
      if (data.scorecardUrl) {
        appendTerminalLog(`🔗 Audit Scorecard Delivered: ${data.scorecardUrl}`, 'text-emerald');
      }
      showLeadNotificationToast('✅ Social Engaged', `Successfully liked, commented & sent audit link to ${name}.`);
      loadMapsLeads();
    } else {
      const errReason = data.error || data.message || data.reason || data.dmError || 'Engagement halted';
      appendTerminalLog(`Social engagement note for ${name}: ${errReason}`, 'text-amber');
      alert(`Social Engagement Notice: ${errReason}`);
    }
  } catch (err) {
    appendTerminalLog(`Social engagement network error: ${err.message}`, 'text-danger');
    alert(`Failed to execute social engagement: ${err.message}`);
  }
}

// ==================== USER PROFILE & TEAM MANAGEMENT MODAL ====================

function openProfileTeamModal() {
  const modal = document.getElementById('modal-profile-team');
  if (modal) modal.style.display = 'flex';
  loadUserProfile();
  loadTeamMembersModalList();
}

function closeProfileTeamModal() {
  const modal = document.getElementById('modal-profile-team');
  if (modal) modal.style.display = 'none';
}

function switchProfileModalTab(tab) {
  const btnProfile = document.getElementById('tab-btn-my-profile');
  const btnTeam = document.getElementById('tab-btn-team-mgmt');
  const paneProfile = document.getElementById('pane-my-profile');
  const paneTeam = document.getElementById('pane-team-mgmt');

  if (tab === 'profile') {
    if (btnProfile) btnProfile.classList.add('active');
    if (btnTeam) btnTeam.classList.remove('active');
    if (paneProfile) paneProfile.style.display = 'block';
    if (paneTeam) paneTeam.style.display = 'none';
  } else {
    if (btnProfile) btnProfile.classList.remove('active');
    if (btnTeam) btnTeam.classList.add('active');
    if (paneProfile) paneProfile.style.display = 'none';
    if (paneTeam) paneTeam.style.display = 'block';
    loadTeamMembersModalList();
  }
}

async function loadUserProfile() {
  const usernameInput = document.getElementById('profile-username');
  const emailInput = document.getElementById('profile-email');
  if (usernameInput) usernameInput.value = currentUser?.username || 'admin';
  if (emailInput && currentUser?.email) emailInput.value = currentUser.email;

  try {
    const res = await fetch('/api/profile');
    if (res.ok) {
      const data = await res.json();
      if (emailInput && data.email) emailInput.value = data.email;
      if (usernameInput && data.username) usernameInput.value = data.username;
    }
  } catch (err) {
    console.warn('Could not load profile details:', err);
  }
}

async function saveUserProfile(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('profile-email')?.value?.trim();
  const newPassword = document.getElementById('profile-new-password')?.value;
  const statusDiv = document.getElementById('profile-save-status');

  if (statusDiv) statusDiv.innerHTML = '<span style="color: #60a5fa;">Saving profile changes...</span>';

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword: newPassword || undefined })
    });
    const data = await res.json();
    if (data.success) {
      if (statusDiv) statusDiv.innerHTML = '<span style="color: #34d399;">✅ Profile updated successfully!</span>';
      showLeadNotificationToast('✅ Profile Saved', 'Your personal details were updated.');
      if (currentUser && email) currentUser.email = email;
      const passInput = document.getElementById('profile-new-password');
      if (passInput) passInput.value = '';
    } else {
      if (statusDiv) statusDiv.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(data.error || 'Failed to update')}</span>`;
    }
  } catch (err) {
    if (statusDiv) statusDiv.innerHTML = `<span style="color: #ef4444;">Network error: ${escapeHtml(err.message)}</span>`;
  }
}

async function loadTeamMembersModalList() {
  const container = document.getElementById('team-members-modal-list');
  if (!container) return;

  try {
    const res = await fetch('/api/auth/users');
    if (!res.ok) {
      container.innerHTML = '<div class="text-dim" style="font-size: 0.85rem; padding: 0.5rem 0;">Only administrators can view team members.</div>';
      return;
    }
    const data = await res.json();
    const users = data.users || [];

    if (users.length === 0) {
      container.innerHTML = '<div class="text-dim" style="font-size: 0.85rem;">No other team members yet.</div>';
      return;
    }

    container.innerHTML = users.map(u => {
      const isSelf = u.id === currentUser?.id;
      const roleBadge = u.role === 'admin' 
        ? '<span class="user-role-chip role-admin" style="font-size: 0.68rem; padding: 2px 6px;">👑 Admin</span>' 
        : '<span class="user-role-chip role-assigned" style="font-size: 0.68rem; padding: 2px 6px;">👤 Team Member</span>';

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.85rem; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; margin-bottom: 0.45rem;">
          <div>
            <div style="font-weight: 600; color: #fff; font-size: 0.85rem;">
              ${escapeHtml(u.name || u.username)}
              <span style="color: #94a3b8; font-size: 0.75rem; margin-left: 4px;">(@${escapeHtml(u.username)})</span>
            </div>
            <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
              ${u.email ? escapeHtml(u.email) : 'No email set'} • Added: ${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Active'}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${roleBadge}
            ${!isSelf ? `
              <button class="btn btn-xs btn-outline-danger" onclick="deleteTeamMemberFromModal(${u.id}, '${escapeHtml(u.username)}')" title="Remove access">✕</button>
            ` : '<span style="font-size: 0.72rem; color: #94a3b8;">(You)</span>'}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="font-size: 0.85rem;">Failed to load team list: ${escapeHtml(err.message)}</div>`;
  }
}

async function addNewTeamMemberFromModal(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('team-add-username')?.value?.trim();
  const email = document.getElementById('team-add-email')?.value?.trim();
  const password = document.getElementById('team-add-password')?.value;
  const role = document.getElementById('team-add-role')?.value || 'user';
  const statusDiv = document.getElementById('team-add-status');

  if (!username || !password) {
    alert('Username and password are required');
    return;
  }

  if (statusDiv) statusDiv.innerHTML = '<span style="color: #60a5fa;">Creating account...</span>';

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, role, name: username })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (statusDiv) statusDiv.innerHTML = '<span style="color: #34d399;">✅ Team account created!</span>';
      showLeadNotificationToast('✅ Team Account Added', `User @${username} can now sign in.`);
      document.getElementById('team-add-username').value = '';
      document.getElementById('team-add-email').value = '';
      document.getElementById('team-add-password').value = '';
      loadTeamMembersModalList();
      if (typeof loadTeamUsers === 'function') loadTeamUsers();
    } else {
      if (statusDiv) statusDiv.innerHTML = `<span style="color: #ef4444;">${escapeHtml(data.error || 'Failed to create user')}</span>`;
    }
  } catch (err) {
    if (statusDiv) statusDiv.innerHTML = `<span style="color: #ef4444;">Network error: ${escapeHtml(err.message)}</span>`;
  }
}

async function deleteTeamMemberFromModal(id, username) {
  if (!confirm(`Are you sure you want to delete access for team member @${username}?`)) return;
  try {
    const res = await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showLeadNotificationToast('🗑️ Account Removed', `Removed @${username} from team.`);
      loadTeamMembersModalList();
      if (typeof loadTeamUsers === 'function') loadTeamUsers();
    } else {
      alert(data.error || 'Failed to delete user');
    }
  } catch (err) {
    alert(`Failed to delete user: ${err.message}`);
  }
}

// ==================== BULK DATA IMPORT & PURGE DEAD LEADS ====================

function openBulkImportModal(targetType = 'maps') {
  const modal = document.getElementById('modal-bulk-import');
  const typeSelect = document.getElementById('bulk-target-type');
  if (typeSelect) typeSelect.value = targetType;
  if (modal) modal.style.display = 'flex';
}

function closeBulkImportModal() {
  const modal = document.getElementById('modal-bulk-import');
  if (modal) modal.style.display = 'none';
  const progress = document.getElementById('bulk-import-progress');
  if (progress) progress.style.display = 'none';
}

function handleBulkFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const textInput = document.getElementById('bulk-text-input');
    if (textInput) textInput.value = event.target?.result || '';
  };
  reader.readAsText(file);
}

async function submitBulkImport() {
  const textInput = document.getElementById('bulk-text-input');
  const targetType = document.getElementById('bulk-target-type')?.value || 'maps';
  const progressDiv = document.getElementById('bulk-import-progress');
  const submitBtn = document.getElementById('btn-submit-bulk-import');

  const text = textInput ? textInput.value.trim() : '';
  if (!text) {
    alert('Please paste lead rows or upload a CSV file first.');
    return;
  }

  if (progressDiv) {
    progressDiv.style.display = 'block';
    progressDiv.style.background = 'rgba(99, 102, 241, 0.15)';
    progressDiv.style.color = '#a5b4fc';
    progressDiv.innerHTML = '⏳ Parsing CSV rows, enforcing country restrictions & calculating diagnostic opportunity scores...';
  }
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/leads/import-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetType })
    });
    const data = await res.json();

    if (data.success) {
      if (progressDiv) {
        progressDiv.style.background = 'rgba(16, 185, 129, 0.15)';
        progressDiv.style.color = '#34d399';
        progressDiv.innerHTML = `
          ✅ <strong>Import Completed!</strong><br>
          • Total Rows Processed: ${data.total || 0}<br>
          • Successfully Scored & Imported: ${data.imported || 0}<br>
          • Excluded (Restricted Countries): ${data.excluded || 0}<br>
          • Uncontactable / Dead Leads: ${data.dead || 0}<br>
          • Duplicates Skipped: ${data.duplicates || 0}
        `;
      }
      showLeadNotificationToast('✅ Bulk Import Success', `Imported & scored ${data.imported || 0} high-value leads.`);
      if (targetType === 'maps') {
        loadMapsLeads();
        loadMapsStats();
      } else {
        loadLeads();
        loadStats();
      }
      setTimeout(() => {
        closeBulkImportModal();
        if (textInput) textInput.value = '';
      }, 2500);
    } else {
      if (progressDiv) {
        progressDiv.style.background = 'rgba(239, 68, 68, 0.15)';
        progressDiv.style.color = '#f87171';
        progressDiv.innerHTML = `⚠️ Error: ${escapeHtml(data.error || 'Failed to import')}`;
      }
    }
  } catch (err) {
    if (progressDiv) {
      progressDiv.style.background = 'rgba(239, 68, 68, 0.15)';
      progressDiv.style.color = '#f87171';
      progressDiv.innerHTML = `Network error: ${escapeHtml(err.message)}`;
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function triggerPurgeDeadLeads(leadType = 'maps') {
  const confirmMsg = '🗑️ Are you sure you want to purge dead leads?\n\nThis will remove uncontactable leads that have no phone number, no direct email, and no valid website from your pipeline to keep your CRM 100% clean.';
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/leads/purge-dead', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadType })
    });
    const data = await res.json();
    if (data.success) {
      const count = data.totalPurged !== undefined ? data.totalPurged : (data.purgedCount || 0);
      showLeadNotificationToast('🧹 Dead Leads Purged', `Removed ${count} dead leads from pipeline.`);
      appendTerminalLog(`🧹 Purge complete: ${count} dead leads removed. Pipeline is 100% clean.`, 'text-emerald');
      if (leadType === 'maps') {
        loadMapsLeads();
        loadMapsStats();
      } else {
        loadLeads();
        loadStats();
      }
    } else {
      alert(`Purge notice: ${data.error || data.message}`);
    }
  } catch (err) {
    alert(`Failed to execute purge: ${err.message}`);
  }
}

// ==================== COMMUNITY GROUPS HUB (FACEBOOK & LINKEDIN) ====================

let currentGroupSubTab = 'discovered';
let allDiscoveredGroups = [];
let allJoinedGroups = [];

function switchGroupSubTab(tab) {
  currentGroupSubTab = tab;
  const btnDiscovered = document.getElementById('tab-btn-groups-discovered');
  const btnJoined = document.getElementById('tab-btn-groups-joined');
  const btnAssistant = document.getElementById('tab-btn-groups-assistant');
  const container = document.getElementById('groups-container');
  const assistantView = document.getElementById('groups-assistant-view');

  [btnDiscovered, btnJoined, btnAssistant].forEach(b => b?.classList.remove('active'));

  if (tab === 'discovered') {
    if (btnDiscovered) btnDiscovered.classList.add('active');
    if (container) container.style.display = 'grid';
    if (assistantView) assistantView.style.display = 'none';
    renderDiscoveredGroupsCards();
  } else if (tab === 'joined') {
    if (btnJoined) btnJoined.classList.add('active');
    if (container) container.style.display = 'grid';
    if (assistantView) assistantView.style.display = 'none';
    auditGroupsFromUi();
  } else if (tab === 'assistant') {
    if (btnAssistant) btnAssistant.classList.add('active');
    if (container) container.style.display = 'none';
    if (assistantView) assistantView.style.display = 'block';
  }
}

async function loadDiscoveredGroups() {
  if (allDiscoveredGroups.length === 0) {
    searchGroupsFromUi();
  }
}

async function searchGroupsFromUi() {
  const topic = document.getElementById('groups-search-topic')?.value?.trim() || 'local business clinic owners and medspa';
  const platform = document.getElementById('groups-platform-select')?.value || 'facebook';
  const container = document.getElementById('groups-container');
  const countBadge = document.getElementById('count-groups-discovered');

  if (container) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem;">
        <div class="spinner" style="width: 32px; height: 32px; margin: 0 auto 1rem auto; border: 3px solid rgba(255,255,255,0.1); border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <h3>Searching ${platform === 'facebook' ? 'Facebook' : 'LinkedIn'} for Active Communities...</h3>
        <p style="color: #94a3b8;">Scanning member activity, post velocity, and admin rules for "${escapeHtml(topic)}"...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/groups/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, platform })
    });
    const data = await res.json();
    allDiscoveredGroups = data.groups || [];
    if (countBadge) countBadge.innerText = allDiscoveredGroups.length;
    renderDiscoveredGroupsCards();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; color: #ef4444;">Failed to search groups: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderDiscoveredGroupsCards() {
  const container = document.getElementById('groups-container');
  if (!container) return;

  if (allDiscoveredGroups.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">👥</div>
        <h3>No Groups Found for this Keyword</h3>
        <p>Try searching for broader keywords like <em>"dental owners"</em>, <em>"realtors"</em>, or <em>"ecommerce founders"</em>.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = allDiscoveredGroups.map(g => {
    const platformIcon = g.platform === 'facebook' ? '👥 Facebook' : '💼 LinkedIn';
    return `
      <div class="group-card">
        <div class="group-header">
          <div class="group-name">${escapeHtml(g.name)}</div>
          <span class="user-role-chip role-assigned" style="font-size: 0.7rem;">${platformIcon}</span>
        </div>
        
        <div class="group-meta-chips">
          <span class="group-chip chip-active">🟢 Active Velocity</span>
          <span class="group-chip">👥 ${escapeHtml(g.members_count || '10k+')} members</span>
          <span class="group-chip">📝 ${escapeHtml(g.posts_per_day || '15+')} posts/day</span>
        </div>

        <div class="admin-rules-box">
          <strong style="color: #f59e0b;">🛡️ Admin Rules & Ban Safety:</strong>
          <div style="margin-top: 4px; line-height: 1.4;">${escapeHtml(g.admin_rules || 'No spam, no direct links in posts. Value-first discussion only.')}</div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; gap: 0.5rem;">
          <a href="${escapeHtml(g.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="flex: 1; text-align: center;">
            Open Group ↗
          </a>
          <button class="btn btn-sm btn-primary" onclick="prepareRulesAssistant('${escapeHtml(g.name).replace(/'/g, "\\'")}', '${escapeHtml(g.admin_rules || '').replace(/'/g, "\\'")}')" style="flex: 1;">
            ✨ Safe Playbook
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function auditGroupsFromUi() {
  const platform = document.getElementById('groups-platform-select')?.value || 'facebook';
  const container = document.getElementById('groups-container');
  const countBadge = document.getElementById('count-groups-joined');

  if (container) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem;">
        <div class="spinner" style="width: 32px; height: 32px; margin: 0 auto 1rem auto; border: 3px solid rgba(255,255,255,0.1); border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <h3>Auditing Joined Groups for Inactivity...</h3>
        <p style="color: #94a3b8;">Checking last post timestamps and member interaction rates...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/groups/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const data = await res.json();
    allJoinedGroups = data.groups || [];
    if (countBadge) countBadge.innerText = allJoinedGroups.length;
    renderJoinedGroupsCards();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; color: #ef4444;">Failed to audit groups: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderJoinedGroupsCards() {
  const container = document.getElementById('groups-container');
  if (!container) return;

  if (allJoinedGroups.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🧹</div>
        <h3>All Joined Groups are Active & Healthy!</h3>
        <p>No dead or silent groups detected (>30 days inactive).</p>
      </div>
    `;
    return;
  }

  container.innerHTML = allJoinedGroups.map(g => {
    const isSilent = Boolean(g.is_silent || (g.days_inactive && g.days_inactive > 30));
    return `
      <div class="group-card" style="${isSilent ? 'border-color: rgba(239, 68, 68, 0.4);' : ''}">
        <div class="group-header">
          <div class="group-name">${escapeHtml(g.name)}</div>
          <span class="user-role-chip role-assigned" style="font-size: 0.7rem;">${g.platform.toUpperCase()}</span>
        </div>

        <div class="group-meta-chips">
          ${isSilent 
            ? `<span class="group-chip chip-silent">⚠️ Silent >${g.days_inactive || 30} Days (Dead Group)</span>` 
            : `<span class="group-chip chip-active">🟢 Active Community</span>`}
          <span class="group-chip">Joined: ${escapeHtml(g.joined_at || 'Recent')}</span>
        </div>

        <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 0.85rem;">
          ${isSilent ? 'This group has been dead silent for over a month. Removing it keeps your feed and algorithm signals clean.' : 'Active discussions happening regularly.'}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
          <a href="${escapeHtml(g.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="flex: 1; text-align: center;">
            Open Group ↗
          </a>
          ${isSilent ? `
            <button class="btn btn-sm btn-outline-danger" onclick="leaveGroupFromUi(${g.id}, '${escapeHtml(g.name).replace(/'/g, "\\'")}')" style="flex: 1;">
              🗑️ Leave & Remove
            </button>
          ` : `
            <span style="font-size: 0.78rem; color: #34d399; font-weight: 600;">✓ Retain</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

async function leaveGroupFromUi(id, name) {
  if (!confirm(`Are you sure you want to leave and remove dead group "${name}"?`)) return;

  try {
    const res = await fetch(`/api/groups/${id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      showLeadNotificationToast('🧹 Left Group', `Removed "${name}" from joined groups.`);
      allJoinedGroups = allJoinedGroups.filter(g => g.id !== id);
      renderJoinedGroupsCards();
      const countBadge = document.getElementById('count-groups-joined');
      if (countBadge) countBadge.innerText = allJoinedGroups.length;
    } else {
      alert(`Could not leave group: ${data.error || data.message}`);
    }
  } catch (err) {
    alert(`Failed to leave group: ${err.message}`);
  }
}

function prepareRulesAssistant(groupName, rules) {
  switchGroupSubTab('assistant');
  const rulesInput = document.getElementById('group-rules-text');
  if (rulesInput && rules) rulesInput.value = rules;
  const postInput = document.getElementById('group-post-text');
  if (postInput) postInput.focus();
}

async function generateSafeGroupResponseFromUi() {
  const postText = document.getElementById('group-post-text')?.value?.trim();
  const authorName = document.getElementById('group-author-name')?.value?.trim() || 'Colleague';
  const groupRules = document.getElementById('group-rules-text')?.value?.trim() || 'No direct promo links, value-first advice only';
  const resultDiv = document.getElementById('group-response-result');
  const responseTextArea = document.getElementById('group-response-text');

  if (!postText) {
    alert('Please paste the member inquiry post first.');
    return;
  }

  if (resultDiv) resultDiv.style.display = 'block';
  if (responseTextArea) responseTextArea.value = '⏳ Reasoning through group rules and synthesizing high-authority, ban-safe advice...';

  try {
    const res = await fetch('/api/groups/generate-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postText, authorName, groupRules })
    });
    const data = await res.json();
    if (data.success && data.response) {
      if (responseTextArea) responseTextArea.value = data.response;
      showLeadNotificationToast('✨ Response Synthesized', 'Admin-safe advice generated.');
    } else {
      if (responseTextArea) responseTextArea.value = `Error: ${data.error || 'Failed to synthesize response'}`;
    }
  } catch (err) {
    if (responseTextArea) responseTextArea.value = `Network error: ${err.message}`;
  }
}

async function copyGroupResponseAndToast() {
  const text = document.getElementById('group-response-text')?.value;
  if (!text) return;
  const success = await copyToClipboard(text);
  if (success) {
    showLeadNotificationToast('📋 Copied to Clipboard', 'Ready to paste in the group discussion!');
  } else {
    alert('Failed to copy to clipboard.');
  }
}

