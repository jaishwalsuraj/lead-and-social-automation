import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { LeadModel, LogModel, PostModel, QuotaModel, SettingsModel, GoogleMapsLeadModel, ScorecardLeadModel, UserModel } from '../db/database.js';
import { browserManager } from '../browser/browserManager.js';
import { orchestrator } from '../agent/orchestrator.js';
import { reasoner } from '../agent/geminiReasoner.js';
import { metaEngineBridge } from '../agent/metaEngineBridge.js';
import { googleMapsAdapter } from '../platforms/googleMaps.js';
import { leadVerifier } from '../agent/leadVerifier.js';
import { ScorecardEngine, scorecardQuestions, detectNiche } from '../agent/scorecardEngine.js';
import { ScorecardPdfGenerator } from '../agent/pdfGenerator.js';
import { tunnelManager } from './tunnelManager.js';
import { MapsScorecardBridge } from '../agent/mapsScorecardBridge.js';
import { ReachInboxClient } from '../agent/reachInboxClient.js';
import { socialEngagementEngine } from '../agent/socialEngagementEngine.js';
import { checkCountryExclusion, validateSearchTargeting } from '../utils/countryFilter.js';
import { GroupsEngine } from '../platforms/groupsEngine.js';
import { BulkLeadImporter } from '../agent/bulkLeadImporter.js';
import { socialLinkHunter } from '../agent/socialLinkHunter.js';

import { loginRateLimiter, forgotPwRateLimiter, resetPwRateLimiter, publicApiRateLimiter, applySecurityHeaders, isPathSafe } from './security.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(applySecurityHeaders);
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// Attach WebSocket clients to orchestrator for real-time logs and events with authentication guard
tunnelManager.setOrchestrator(orchestrator);
wss.on('connection', (ws, req) => {
  let authenticatedUser = null;
  try {
    const url = new URL(req.url, 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      authenticatedUser = verifyAuthToken(queryToken);
    }
  } catch (_) {}

  if (authenticatedUser) {
    orchestrator.registerWsClient(ws);
    ws.send(JSON.stringify({ 
      type: 'authenticated',
      auth_success: true,
      message: 'Connected to TDF Growth Hub (Authenticated)',
      tunnel: tunnelManager.getStatus(),
      user: authenticatedUser.username
    }));
  } else {
    // Grace period for client to send { type: 'auth', token: '...' } message
    const authTimeout = setTimeout(() => {
      if (!authenticatedUser) {
        try { 
          ws.send(JSON.stringify({ type: 'auth_required', message: 'Authentication required for real-time stream' }));
          ws.close(4001, 'Authentication required'); 
        } catch (_) {}
      }
    }, 12000);

    ws.on('message', (msgRaw) => {
      try {
        const msg = JSON.parse(msgRaw.toString());
        if (msg.type === 'auth' && msg.token) {
          const user = verifyAuthToken(msg.token);
          if (user) {
            authenticatedUser = user;
            clearTimeout(authTimeout);
            orchestrator.registerWsClient(ws);
            ws.send(JSON.stringify({
              type: 'authenticated',
              auth_success: true,
              message: 'Authenticated real-time stream active',
              tunnel: tunnelManager.getStatus(),
              user: user.username
            }));
          } else {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid authentication token' }));
            ws.close(4003, 'Invalid token');
          }
        }
      } catch (_) {}
    });
  }
});

// ==================== AUTHENTICATION & SECURITY MIDDLEWARE ====================
const SESSION_SECRET = process.env.SESSION_SECRET || 'antigravity-frog-growth-secret-token-key-2026';

function createAuthToken(user) {
  const payload = `${user.id}:${user.username}:${user.role}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

function verifyAuthToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 5) return null;
    const [id, username, role, timestamp, signature] = parts;
    const payload = `${id}:${username}:${role}:${timestamp}`;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (signature !== expectedSig) return null;
    const ageMs = Date.now() - parseInt(timestamp, 10);
    // Token valid for 30 days
    if (ageMs > 30 * 24 * 60 * 60 * 1000) return null;
    return { id: parseInt(id, 10), username, role };
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = headerToken || req.query.token;
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required to view leads or progress' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required for this operation' });
  }
  next();
}

// ==================== AUTH API ROUTES ====================

// User login (Admin & Assigned) with brute-force protection
app.post('/api/auth/login', (req, res) => {
  const identifier = (req.body.username || req.body.email || '').trim();
  const password = req.body.password;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username or email and password are required' });
  }

  // Rate limiting: max 5 failed attempts per 15 min per IP/account
  const rate = loginRateLimiter.check(req, identifier);
  if (!rate.allowed) {
    LogModel.add('security', 'login_lockout', `Brute force protection triggered for ${identifier}. Locked for ${rate.waitSeconds}s.`);
    return res.status(429).json({ error: `Too many failed login attempts. Please wait ${rate.waitSeconds} seconds before trying again.`, retryAfter: rate.waitSeconds });
  }

  const user = UserModel.findByUsername(identifier) || UserModel.findByEmail(identifier);
  if (!user || !UserModel.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Reset rate limiter on successful login
  loginRateLimiter.reset(req, identifier);
  UserModel.updateLastLogin(user.id);
  const token = createAuthToken(user);
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      email: user.email
    }
  });
});

// Current user profile
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = UserModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// List team users (Admin only)
app.get('/api/auth/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: UserModel.getAll() });
});

// Create team user (Admin only)
app.post('/api/auth/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, name, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (UserModel.findByUsername(username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  try {
    const id = UserModel.create({
      username,
      password,
      role: role === 'admin' ? 'admin' : 'assigned',
      name: name || username,
      email
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete team user (Admin only)
app.delete('/api/auth/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    UserModel.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Request password reset verification code (rate-limited)
app.post('/api/auth/forgot-password', (req, res) => {
  const { email, identifier } = req.body;
  const target = (email || identifier || '').trim();
  if (!target) {
    return res.status(400).json({ error: 'Please enter your registered email or username' });
  }

  // Rate limit: max 3 requests per 15 min per IP/target
  const rate = forgotPwRateLimiter.check(req, target);
  if (!rate.allowed) {
    return res.status(429).json({ error: `Too many password reset requests. Please wait ${rate.waitSeconds} seconds before trying again.` });
  }

  const user = UserModel.findByEmail(target) || UserModel.findByUsername(target);
  if (!user) {
    return res.status(404).json({ error: 'No account registered with this email or username' });
  }

  // Generate secure 6-digit OTP code (valid for 15 minutes)
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  UserModel.setResetToken(user.id, resetCode, expiresAt);
  LogModel.add('security', 'password_reset_requested', `Password reset code generated for ${user.email || user.username}`);

  console.log(`\n======================================================`);
  console.log(`🔐 [SECURITY] PASSWORD RESET REQUESTED FOR: ${user.email}`);
  console.log(`👉 6-DIGIT VERIFICATION CODE: ${resetCode}`);
  console.log(`⏰ CODE EXPIRES IN:           15 MINUTES`);
  console.log(`======================================================\n`);

  res.json({
    success: true,
    message: 'Reset verification code generated (valid for 15 minutes). Use your 6-digit OTP code or Master Recovery Key to complete the reset.',
    email: user.email,
    expiresInMinutes: 15
  });
});

// Complete password reset using 6-digit OTP code or Master Recovery Key (rate-limited + lockout)
app.post('/api/auth/reset-password', (req, res) => {
  const { identifier, email, resetCode, newPassword } = req.body;
  const target = (identifier || email || '').trim();
  const code = (resetCode || '').trim();

  if (!target) {
    return res.status(400).json({ error: 'Email or username is required' });
  }
  if (!code) {
    return res.status(400).json({ error: 'Reset verification code or recovery key is required' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  // Rate limit: max 5 reset attempts. If exceeded, invalidate active OTP for security!
  const rate = resetPwRateLimiter.check(req, target);
  if (!rate.allowed) {
    const u = UserModel.findByEmail(target) || UserModel.findByUsername(target);
    if (u) UserModel.clearResetToken(u.id);
    return res.status(429).json({ error: `Too many incorrect reset attempts. The current OTP has been invalidated for security. Please request a new code.` });
  }

  const user = UserModel.findByEmail(target) || UserModel.findByUsername(target);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Verify code against either permanent recovery_key or active time-limited reset_token
  const isMasterKey = user.recovery_key && user.recovery_key.toUpperCase() === code.toUpperCase();
  const isOtpValid = user.reset_token && user.reset_token === code && user.reset_expires && new Date(user.reset_expires) > new Date();

  if (!isMasterKey && !isOtpValid) {
    return res.status(400).json({ error: 'Invalid or expired verification code / recovery key' });
  }

  // Reset limiter on success
  resetPwRateLimiter.reset(req, target);
  UserModel.updatePassword(user.id, newPassword);
  UserModel.updateLastLogin(user.id);
  const token = createAuthToken(user);
  LogModel.add('security', 'password_reset_success', `Password successfully reset for ${user.email || user.username}`);

  res.json({
    success: true,
    message: 'Password updated successfully! Welcome back.',
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      email: user.email
    }
  });
});

// Get Master Recovery Key for Super Admin (Admin only)
app.get('/api/auth/recovery-key', requireAuth, requireAdmin, (req, res) => {
  const key = UserModel.getRecoveryKey(req.user.id);
  res.json({ recoveryKey: key });
});

// Change user password
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword, targetUserId } = req.body;
  const targetId = (req.user.role === 'admin' && targetUserId) ? targetUserId : req.user.id;
  const user = UserModel.findById(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (req.user.id === targetId) {
    const fullUser = UserModel.findByUsername(user.username);
    if (!UserModel.verifyPassword(fullUser, currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  UserModel.updatePassword(targetId, newPassword);
  LogModel.add('security', 'password_change', `Password changed for user ${user.username}`);
  res.json({ success: true, message: 'Password updated successfully' });
});

// ==================== REST API ROUTES ====================

// System Stats
app.get('/api/stats', requireAuth, (req, res) => {
  const stats = LeadModel.getStats();
  const quotas = {
    threads: QuotaModel.getToday('threads'),
    instagram: QuotaModel.getToday('instagram'),
    facebook: QuotaModel.getToday('facebook'),
    linkedin: QuotaModel.getToday('linkedin')
  };
  res.json({ stats, quotas });
});

// Platform Auth Check (Admin only)
app.get(['/api/platforms', '/api/platforms/status'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const statuses = await browserManager.getConnectedPlatforms(forceRefresh);
    res.json({ platforms: statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open Interactive Login Window (Admin only)
app.post('/api/browser/login', requireAuth, requireAdmin, async (req, res) => {
  const { platform } = req.body;
  try {
    const result = await browserManager.launchInteractiveLogin(platform || 'threads');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lead Management
app.get('/api/leads', requireAuth, async (req, res) => {
  const { status, limit, maxDays, feedback, connectedOnly, sortBy } = req.query;
  const parsedLimit = parseInt(limit || '200', 10);
  const safeLimit = isNaN(parsedLimit) || parsedLimit <= 0 ? 200 : Math.min(parsedLimit, 1000);
  const parsedMaxDays = maxDays !== undefined ? (maxDays === 'all' ? 99999 : (parseFloat(maxDays) || 7)) : 7;

  const options = {
    limit: safeLimit,
    maxDays: parsedMaxDays,
    sortBy: sortBy || 'newest'
  };
  if (status && status !== 'all') {
    options.status = status;
  }
  if (feedback && feedback !== 'all') {
    options.feedback = feedback;
  }

  let leads = LeadModel.getAll(options);

  // If connectedOnly requested, filter out disconnected channels
  if (connectedOnly === 'true') {
    try {
      const statuses = await browserManager.getConnectedPlatforms();
      const connected = new Set(statuses.filter(s => s.loggedIn).map(s => s.platform));
      leads = leads.filter(l => connected.has(l.platform));
    } catch (_) {}
  }

  res.json(leads);
});

// Dynamic AI Keyword Expander
app.post('/api/keywords/expand', requireAuth, async (req, res) => {
  const { topic, niche } = req.body;
  try {
    const targetNiche = niche || SettingsModel.get('niche_target') || 'E-commerce, SaaS, and Digital Product Sales';
    const keywords = await reasoner.expandSearchKeywords(topic || '', targetNiche);
    res.json({ success: true, keywords, topic, niche: targetNiche });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save Search Keywords
app.post('/api/keywords/save', requireAuth, (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords)) {
    return res.status(400).json({ error: 'Keywords must be an array of strings' });
  }
  SettingsModel.set('search_keywords', JSON.stringify(keywords));
  res.json({ success: true, keywords });
});

// Record User Lead Feedback (Quality Correct vs Incorrect)
app.post('/api/leads/:id/feedback', requireAuth, (req, res) => {
  const { feedback, notes } = req.body;
  try {
    const updatedLead = LeadModel.setFeedback(req.params.id, feedback, notes);
    orchestrator.broadcast('leads_updated', { stats: LeadModel.getStats() });
    res.json({ success: true, lead: updatedLead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Learned Lead Intelligence Rules
app.get(['/api/leads/learning/rules', '/api/leads/rules'], requireAuth, (req, res) => {
  const { type } = req.query;
  res.json(LeadModel.getLearningRules(type || null));
});

// Get Permanently Blocked Authors (marked "Not a Lead")
app.get('/api/leads/blocked-authors', requireAuth, (req, res) => {
  res.json(LeadModel.getBlockedAuthors());
});

// Verify All Active Social Leads (Purges 404s, deleted/disabled accounts)
app.post('/api/leads/verify-all', requireAuth, async (req, res) => {
  try {
    orchestrator.broadcast('log', { platform: 'system', text: '🛡️ Starting Live Lead Verification across all social profiles...' });
    const result = await leadVerifier.verifyAllActiveLeads((progress) => {
      orchestrator.broadcast('lead_verification_progress', progress);
    });
    orchestrator.broadcast('leads_updated', { stats: LeadModel.getStats() });
    orchestrator.broadcast('log', { 
      platform: 'system', 
      text: `✅ Verification Complete: ${result.verifiedCount} active confirmed, ${result.deadCount} dead/deleted profiles purged.` 
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify Single Lead
app.post('/api/leads/:id/verify', requireAuth, async (req, res) => {
  try {
    const result = await leadVerifier.verifyLead(req.params.id);
    orchestrator.broadcast('leads_updated', { stats: LeadModel.getStats() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger Lead Scan (uses connected platforms only & supports topic / custom keywords)
app.post('/api/leads/scan', requireAuth, async (req, res) => {
  if (orchestrator.isRunning) {
    return res.status(409).json({ 
      success: false, 
      message: 'A lead scan is already running. Please wait for the current scan cycle to complete.' 
    });
  }

  const { platform, topic, keywords } = req.body;
  // Trigger scan asynchronously so HTTP request doesn't timeout
  orchestrator.runLeadScan(platform || 'all', { topic, keywords }).catch(e => console.error('[Scan Error]', e));
  res.json({ 
    success: true, 
    message: `Lead scanning started for ${platform || 'connected platforms'}`,
    topic: topic || null
  });
});

// Engage Lead (Comment)
app.post('/api/leads/:id/engage', requireAuth, async (req, res) => {
  try {
    const { customComment } = req.body;
    const result = await orchestrator.engageLead(req.params.id, customComment);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send DM Follow-Up
app.post('/api/leads/:id/dm', requireAuth, async (req, res) => {
  try {
    const { customDM } = req.body;
    const result = await orchestrator.sendFollowUpDM(req.params.id, customDM);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate Contextual AI Comment (Short, High-Converting)
app.post('/api/leads/:id/generate-comment', requireAuth, async (req, res) => {
  try {
    const lead = LeadModel.getById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    
    const { angle } = req.body;
    const settings = SettingsModel.getAll();
    const newComment = await reasoner.synthesizeComment(
      lead.post_text, 
      lead.author_name, 
      { pain_point: lead.keyword_matched || '', reason: lead.intent_reason || '' },
      settings.niche_target,
      angle || null
    );
    
    LeadModel.updateComment(lead.id, newComment);
    res.json({ success: true, comment: newComment, lead_id: lead.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate AI 1-on-1 DM
app.post('/api/leads/:id/generate-dm', requireAuth, async (req, res) => {
  try {
    const lead = LeadModel.getById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    
    const settings = SettingsModel.getAll();
    const newDM = await reasoner.synthesizeDM(lead, [], settings.niche_target);
    LeadModel.updateDM(lead.id, newDM);
    res.json({ success: true, dm: newDM, lead_id: lead.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Lead Status
app.post('/api/leads/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  LeadModel.updateStatus(req.params.id, status);
  res.json({ success: true, lead: LeadModel.getById(req.params.id) });
});

// Get Single Social Lead
app.get('/api/leads/:id', requireAuth, (req, res) => {
  const lead = LeadModel.getById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(lead);
});

// Update Social Lead Notes
app.post('/api/leads/:id/notes', requireAuth, (req, res) => {
  const { notes } = req.body;
  LeadModel.updateNotes(req.params.id, notes || '');
  res.json({ success: true, notes });
});

// Delete Social Lead
app.delete('/api/leads/:id', requireAuth, (req, res) => {
  try {
    LeadModel.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Content Studio: Generate Post
app.post('/api/posts/generate', requireAuth, async (req, res) => {
  const { platform, topic, niche } = req.body;
  try {
    const content = await reasoner.generateSocialContent(platform || 'linkedin', topic, niche);
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Content Studio: Publish Post
app.post('/api/posts/publish', requireAuth, async (req, res) => {
  const { platform, content } = req.body;
  try {
    const result = await orchestrator.publishPost(platform, content);
    if (result.success) {
      PostModel.create({
        platform,
        content,
        image_path: null,
        status: 'published',
        scheduled_at: null
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Content Studio Posts
app.get('/api/posts', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    res.json(PostModel.getAll(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get System Activity Logs
app.get('/api/logs', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    res.json({ logs: LogModel.getRecent(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings (Admin only)
app.get('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const settings = SettingsModel.getAll();
  const tunnelStatus = tunnelManager.getStatus();
  settings.public_url = tunnelStatus.publicUrl || settings.public_url || `${req.protocol}://${req.get('host')}`;
  settings.tunnel_status = tunnelStatus.status;
  settings.is_live = tunnelStatus.isLive;
  res.json(settings);
});

app.post('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const newSettings = req.body;
  for (const [key, value] of Object.entries(newSettings)) {
    SettingsModel.set(key, value);
  }
  res.json({ success: true, settings: SettingsModel.getAll() });
});

// Cloudflare Public Tunnel Management (Status is public, Start is Admin only)
app.get('/api/tunnel/status', (req, res) => {
  res.json(tunnelManager.getStatus());
});

app.post('/api/tunnel/start', requireAuth, requireAdmin, async (req, res) => {
  const port = process.env.PORT || 3000;
  const result = await tunnelManager.start(port);
  res.json(result);
});

// ==================== GOOGLE MAPS LOCAL LEAD HUNTER ROUTES ====================

// Trigger Google Maps Local Lead Scan
app.post('/api/maps/scan', requireAuth, async (req, res) => {
  const { query, location, limit, noWebsiteOnly } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Business category or keyword is required' });
  }

  const targetCheck = validateSearchTargeting(query, location || '');
  if (!targetCheck.allowed) {
    return res.status(400).json({ error: targetCheck.error });
  }

  orchestrator.broadcast('log', {
    platform: 'google_maps',
    text: `📍 Starting Google Maps hunt: "${query}" in "${location || 'Local'}" (${noWebsiteOnly ? '🔥 NO WEBSITE ONLY' : 'All Listings'})...`
  });

  googleMapsAdapter.scanLeads({
    query: query || 'plumbers',
    location: location || 'Austin, TX',
    limit: parseInt(limit || '20', 10),
    noWebsiteOnly: !!noWebsiteOnly,
    onProgress: (prog) => {
      orchestrator.broadcast('maps_scan_progress', prog);
      orchestrator.broadcast('maps_lead_discovered', prog.lead);
    }
  }).then(result => {
    orchestrator.broadcast('maps_scan_complete', {
      count: result.count,
      stats: GoogleMapsLeadModel.getStats()
    });
    orchestrator.broadcast('log', {
      platform: 'google_maps',
      text: `✅ Google Maps hunt completed: Found ${result.count || 0} local business leads.`
    });
  }).catch(err => {
    orchestrator.broadcast('log', { platform: 'google_maps', text: `Google Maps scan error: ${err.message}`, error: true });
  });

  res.json({
    success: true,
    message: `Google Maps scan initiated for "${query}" in "${location || 'Local'}"`
  });
});

// Get Google Maps Leads
app.get('/api/maps/leads', requireAuth, (req, res) => {
  try {
    const leads = GoogleMapsLeadModel.getAll(req.query);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Google Maps Leads Summary Stats
app.get('/api/maps/stats', requireAuth, (req, res) => {
  try {
    const stats = GoogleMapsLeadModel.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Google Maps Lead Status
app.post('/api/maps/leads/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  try {
    GoogleMapsLeadModel.updateStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate AI Pitches & Doctor Rx Prescription for Google Maps Lead
app.post(['/api/maps/leads/:id/pitch', '/api/maps/leads/:id/generate-pitch'], requireAuth, (req, res) => {
  try {
    const lead = GoogleMapsLeadModel.getById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const isMedical = !!lead.is_medical || googleMapsAdapter.isMedicalLead(lead.business_name, lead.category, lead.search_query);

    const doctorPitches = googleMapsAdapter.generateDoctorPrescription({
      name: lead.business_name,
      category: lead.category,
      city: lead.city,
      phone: lead.phone,
      email: lead.email,
      rating: lead.rating,
      reviewsCount: lead.reviews_count,
      hasWebsite: !!lead.has_website,
      websiteUrl: lead.website_url,
      socialLinks: lead.social_links
    });

    let pitches = googleMapsAdapter.synthesizeLocalPitches({
      name: lead.business_name,
      category: lead.category,
      city: lead.city,
      phone: lead.phone,
      rating: lead.rating,
      reviewsCount: lead.reviews_count,
      hasWebsite: !!lead.has_website,
      websiteUrl: lead.website_url,
      opportunityType: lead.opportunity_type
    });

    if (isMedical) {
      pitches = {
        callScript: doctorPitches.receptionistScript,
        whatsappPitch: doctorPitches.rxMessage,
        emailPitch: doctorPitches.rxEmail
      };
    }

    GoogleMapsLeadModel.updatePitches(lead.id, {
      ai_call_script: pitches.callScript,
      ai_whatsapp_pitch: pitches.whatsappPitch,
      ai_email_pitch: pitches.emailPitch,
      doctor_prescription: doctorPitches.rxEmail
    });

    res.json({ success: true, pitches, isMedical, doctorPrescription: doctorPitches.rxEmail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run or Refresh Social Media Audit & AI Avatar Plan for Lead
app.post(['/api/maps/leads/:id/audit', '/api/maps/leads/:id/deep-audit'], requireAuth, (req, res) => {
  try {
    const lead = GoogleMapsLeadModel.getById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const isMedical = !!lead.is_medical || googleMapsAdapter.isMedicalLead(lead.business_name, lead.category, lead.search_query);
    const audit = googleMapsAdapter.generateSocialAudit({
      name: lead.business_name,
      category: lead.category,
      city: lead.city,
      rating: lead.rating,
      reviewsCount: lead.reviews_count,
      hasWebsite: !!lead.has_website,
      websiteUrl: lead.website_url,
      socialLinks: lead.social_links,
      isMedical
    });

    GoogleMapsLeadModel.updateSocialAudit(lead.id, audit);
    res.json({ success: true, audit, lead: GoogleMapsLeadModel.getById(lead.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Google Maps Lead
app.delete('/api/maps/leads/:id', requireAuth, (req, res) => {
  try {
    GoogleMapsLeadModel.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export Google Maps Leads to CSV
app.get('/api/maps/export/csv', requireAuth, (req, res) => {
  try {
    const csvData = GoogleMapsLeadModel.exportCsv(req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="google_maps_leads.csv"');
    res.send(csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-verify single Google Maps Lead
app.post('/api/maps/leads/:id/reverify', requireAuth, async (req, res) => {
  try {
    const updatedLead = await googleMapsAdapter.reverifyLead(req.params.id);
    orchestrator.broadcast('maps_lead_updated', { lead: updatedLead });
    res.json({ success: true, lead: updatedLead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch Re-verify all Google Maps Leads
app.post('/api/maps/reverify-all', requireAuth, (req, res) => {
  googleMapsAdapter.reverifyAllExistingLeads((progress) => {
    orchestrator.broadcast('maps_reverify_progress', progress);
  }).then(result => {
    orchestrator.broadcast('maps_reverify_complete', {
      ...result,
      stats: GoogleMapsLeadModel.getStats()
    });
  }).catch(err => {
    orchestrator.broadcast('log', { platform: 'google_maps', text: `Batch reverify failed: ${err.message}`, error: true });
  });

  res.json({ success: true, message: 'Batch re-verification started in background' });
});

// Hunt & Enrich Social Media links for a single Google Maps Lead
app.post('/api/maps/leads/:id/find-socials', requireAuth, async (req, res) => {
  try {
    const result = await socialLinkHunter.enrichLead(req.params.id);
    const updatedLead = GoogleMapsLeadModel.getById(req.params.id);
    orchestrator.broadcast('maps_lead_updated', { lead: updatedLead });
    res.json({ success: true, ...result, lead: updatedLead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Hunt & Enrich Social Media links for all Google Maps leads missing socials
app.post('/api/maps/find-all-socials', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.body.limit || '15', 10), 30);
  
  socialLinkHunter.enrichBatchLeads({
    limit,
    onProgress: (prog) => {
      orchestrator.broadcast('social_hunter_progress', prog);
    }
  }).then(result => {
    orchestrator.broadcast('social_hunter_complete', {
      ...result,
      stats: GoogleMapsLeadModel.getStats()
    });
  }).catch(err => {
    orchestrator.broadcast('log', { platform: 'google_maps', text: `Social hunt notice: ${err.message}`, error: true });
  });

  res.json({ success: true, message: 'Bulk social media hunt started in background' });
});

// ==================== REACHINBOX & COLD EMAIL OUTREACH ROUTES ====================

// Get ReachInbox configuration (API Key & Campaign ID)
app.get('/api/reachinbox/config', requireAuth, (req, res) => {
  const apiKey = SettingsModel.get('reachinbox_api_key') || '';
  const campaignId = SettingsModel.get('reachinbox_campaign_id') || '';
  const autoSync = SettingsModel.get('reachinbox_auto_sync') === 'true';
  res.json({
    hasApiKey: !!apiKey,
    apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : '',
    campaignId,
    autoSync
  });
});

// Update ReachInbox configuration
app.post('/api/reachinbox/config', requireAuth, requireAdmin, (req, res) => {
  const { apiKey, campaignId, autoSync } = req.body;
  if (apiKey !== undefined && apiKey !== '••••') {
    SettingsModel.set('reachinbox_api_key', apiKey.trim());
  }
  if (campaignId !== undefined) {
    SettingsModel.set('reachinbox_campaign_id', campaignId.trim());
  }
  if (autoSync !== undefined) {
    SettingsModel.set('reachinbox_auto_sync', autoSync ? 'true' : 'false');
  }
  LogModel.add('reachinbox', 'config_updated', 'ReachInbox settings updated by admin');
  res.json({ success: true, message: 'ReachInbox configuration saved.' });
});

// Test connection to ReachInbox API
app.post('/api/reachinbox/test', requireAuth, async (req, res) => {
  const apiKey = req.body.apiKey ? req.body.apiKey.trim() : null;
  const result = await ReachInboxClient.testConnection(apiKey);
  res.json(result);
});

// Push selected leads to ReachInbox campaign
app.post('/api/reachinbox/push-leads', requireAuth, async (req, res) => {
  try {
    const { leadIds, campaignId } = req.body;
    let leads = [];
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      const placeholders = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM google_maps_leads WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`).all(...leadIds);
    } else {
      leads = db.prepare(`SELECT * FROM google_maps_leads WHERE email IS NOT NULL AND email != '' LIMIT 50`).all();
    }

    if (leads.length === 0) {
      return res.status(400).json({ error: 'No leads with valid email addresses found to sync.' });
    }

    const result = await ReachInboxClient.syncLeadsToCampaign({ leads, campaignIdOverride: campaignId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export Google Maps leads formatted specifically for ReachInbox CSV import
app.get('/api/maps/export-reachinbox', requireAuth, (req, res) => {
  try {
    const leads = GoogleMapsLeadModel.getAll({ limit: 1000 });
    const csvContent = ReachInboxClient.generateReachInboxCsv(leads);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reachinbox_leads_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch generate clean scorecards and links for all Google Maps leads
app.post('/api/maps/auto-scorecard', requireAuth, (req, res) => {
  try {
    const result = MapsScorecardBridge.syncAllMapsLeadsScorecards();
    res.json({ success: true, ...result, message: `Successfully generated scorecards and clean email links for ${result.updated} leads.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SOCIAL ENGAGEMENT PIPELINE ROUTES ====================

// Engage a single lead on social media (Like recent post -> Expert comment -> Direct Message)
app.post('/api/maps/leads/:id/engage-social', requireAuth, async (req, res) => {
  try {
    const result = await socialEngagementEngine.engageLeadSocial(req.params.id);
    orchestrator.broadcast('social_engagement_update', { leadId: req.params.id, result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run automated batch social engagement
app.post('/api/maps/leads/auto-engage-batch', requireAuth, async (req, res) => {
  try {
    const batchSize = Math.min(parseInt(req.body.batchSize || '5', 10), 15);
    if (socialEngagementEngine.isProcessing) {
      return res.json({ success: false, message: 'Social engagement automation is already running in background' });
    }

    res.json({
      success: true,
      message: 'Automated social engagement pipeline started in background',
      batchSize
    });

    // Run in background so HTTP request does not hang or timeout
    (async () => {
      try {
        const result = await socialEngagementEngine.runAutomatedEngagementBatch(batchSize);
        orchestrator.broadcast('social_engagement_batch_complete', result);
      } catch (err) {
        console.error('[SocialEngagementEngine] Background batch error:', err.message);
        orchestrator.broadcast('social_engagement_batch_error', { error: err.message });
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get social engagement scheduler status and quotas
app.get('/api/social-engagement/status', requireAuth, (req, res) => {
  const enabled = SettingsModel.get('auto_engage_enabled') !== 'false';
  const times = SettingsModel.get('auto_engage_times') || '10:00,15:00';
  const igQuota = QuotaModel.getToday('instagram');
  const maxLikes = parseInt(SettingsModel.get('daily_max_likes') || '25', 10);
  const maxComments = parseInt(SettingsModel.get('daily_max_comments') || '15', 10);
  const maxDMs = parseInt(SettingsModel.get('daily_max_dms') || '10', 10);

  res.json({
    enabled,
    scheduleTimes: times.split(',').map(s => s.trim()),
    isProcessing: socialEngagementEngine.isProcessing,
    quotas: {
      likes: { count: igQuota.likes_count || 0, max: maxLikes },
      comments: { count: igQuota.comments_count || 0, max: maxComments },
      dms: { count: igQuota.dms_count || 0, max: maxDMs }
    }
  });
});

// Update social engagement schedule config
app.post('/api/social-engagement/config', requireAuth, requireAdmin, (req, res) => {
  const { enabled, times, maxLikes, maxComments, maxDMs } = req.body;
  if (enabled !== undefined) SettingsModel.set('auto_engage_enabled', enabled ? 'true' : 'false');
  if (times !== undefined) SettingsModel.set('auto_engage_times', times.trim());
  if (maxLikes !== undefined) SettingsModel.set('daily_max_likes', String(maxLikes));
  if (maxComments !== undefined) SettingsModel.set('daily_max_comments', String(maxComments));
  if (maxDMs !== undefined) SettingsModel.set('daily_max_dms', String(maxDMs));

  LogModel.add('system', 'schedule_config_updated', 'Social engagement scheduler settings updated');
  res.json({ success: true, message: 'Engagement scheduler configuration updated.' });
});

// ==================== GROUPS ENGINE & AUTHORITY BUILDING ROUTES ====================

// Search active Facebook groups in target niche
app.post('/api/groups/search', requireAuth, async (req, res) => {
  try {
    const { topic, limit } = req.body;
    const groups = await GroupsEngine.searchFacebookGroups(topic || 'clinic owners dentists', parseInt(limit || '10', 10));
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit joined groups (detect dead/inactive communities) - Supports GET and POST
app.all('/api/groups/audit', requireAuth, async (req, res) => {
  try {
    const platform = req.query.platform || req.body?.platform || 'facebook';
    const groups = await GroupsEngine.auditJoinedGroups(platform);
    const silentCount = groups.filter(g => g.is_silent || (g.days_inactive && g.days_inactive > 30)).length;
    res.json({ success: true, groups, silentCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave / remove a group
app.post('/api/groups/:id/leave', requireAuth, (req, res) => {
  try {
    GroupsEngine.leaveGroup(req.params.id);
    res.json({ success: true, message: 'Group status updated to left.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Synthesize admin-compliant, value-first response
app.post('/api/groups/generate-response', requireAuth, async (req, res) => {
  try {
    const { postText, authorName, groupRules } = req.body;
    const response = await GroupsEngine.synthesizeSafeGroupResponse(postText || '', authorName || 'Member', groupRules || '');
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== BULK LEAD IMPORT & PURGE DEAD LEADS ====================

// Bulk lead import from CSV text or JSON records
app.post('/api/leads/import-bulk', requireAuth, async (req, res) => {
  try {
    const { csvText, text, records } = req.body;
    const rawContent = csvText || text;
    let leadRecords = [];
    if (Array.isArray(records) && records.length > 0) {
      leadRecords = records;
    } else if (rawContent) {
      leadRecords = BulkLeadImporter.parseCsv(rawContent);
    } else {
      return res.status(400).json({ error: 'Please provide CSV content or an array of lead records.' });
    }

    if (leadRecords.length === 0) {
      return res.status(400).json({ error: 'No valid records found in the uploaded data.' });
    }

    const result = await BulkLeadImporter.importAndEnrich(leadRecords);
    orchestrator.broadcast('leads_updated', { stats: GoogleMapsLeadModel.getStats() });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1-Click Purge Dead Leads
app.delete('/api/leads/purge-dead', requireAuth, requireAdmin, (req, res) => {
  try {
    const result = BulkLeadImporter.purgeDeadLeads();
    orchestrator.broadcast('leads_updated', { stats: GoogleMapsLeadModel.getStats() });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== USER PROFILE & TEAM DETAILS ====================

app.get('/api/profile', requireAuth, (req, res) => {
  const user = UserModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    username: user.username,
    email: user.email || '',
    role: user.role,
    created_at: user.created_at,
    last_login: user.last_login
  });
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { email, newPassword } = req.body;
  const user = UserModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (email && email.includes('@')) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim().toLowerCase(), user.id);
  }
  if (newPassword && newPassword.length >= 8) {
    UserModel.updatePassword(user.id, newPassword);
  }

  res.json({ success: true, message: 'Profile updated successfully.' });
});

// ==================== SCORECARD & DIGITAL HEALTH ASSESSMENT ROUTES ====================

// Public Scorecard Web Page Route (STRICTLY OPEN / NO LOGIN)
app.get(['/scorecard', '/audit-test', '/diagnostic'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/scorecard.html'));
});

// Get Scorecard Questions & Config (STRICTLY OPEN / NO LOGIN)
app.get('/api/scorecard/config', (req, res) => {
  try {
    const topmateUrl = SettingsModel.get('topmate_url') || 'https://topmate.io/isurajjaiswal';
    const agencyName = SettingsModel.get('agency_name') || 'The Digital Frog';
    const founderName = SettingsModel.get('founder_name') || 'Suraj Jaiswal';

    res.json({
      questions: scorecardQuestions,
      topmateUrl,
      agencyName,
      founderName
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Public Scorecard Report (STRICTLY OPEN / NO LOGIN - Accessible to Prospects via Email/SMS Link)
app.get('/api/scorecard/public-report/:id', publicApiRateLimiter.middleware(), (req, res) => {
  try {
    const lead = ScorecardLeadModel.getById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Scorecard report not found or expired.' });
    }

    let answers = {};
    let rxData = {};
    try { answers = typeof lead.answers === 'string' ? JSON.parse(lead.answers) : (lead.answers || {}); } catch (_) {}
    try { rxData = typeof lead.prescription_data === 'string' ? JSON.parse(lead.prescription_data) : (lead.prescription_data || {}); } catch (_) {}

    const topmateUrl = SettingsModel.get('topmate_url') || 'https://topmate.io/isurajjaiswal';
    const agencyName = SettingsModel.get('agency_name') || 'The Digital Frog';
    const founderName = SettingsModel.get('founder_name') || 'Suraj Jaiswal';

    res.json({
      success: true,
      report: {
        id: lead.id,
        businessName: lead.business_name,
        contactPerson: lead.contact_person,
        businessType: lead.business_type,
        city: lead.city,
        overallScore: lead.overall_score,
        videoScore: lead.video_score,
        discoveryScore: lead.discovery_score,
        conversionScore: lead.conversion_score,
        prescriptionText: lead.prescription_text,
        prescriptionData: rxData,
        pdfUrl: lead.pdf_url || `/api/scorecard/leads/${lead.id}/pdf`,
        topmateUrl,
        agencyName,
        founderName,
        createdAt: lead.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Scorecard Assessment (STRICTLY OPEN / NO LOGIN FOR PROSPECTS)
app.post('/api/scorecard/submit', publicApiRateLimiter.middleware(), async (req, res) => {
  try {
    const businessName = req.body.businessName || req.body.business_name;
    const businessType = req.body.businessType || req.body.business_type;
    const rawPerson = (req.body.contactPerson || req.body.contact_person || '').trim();
    let contactPerson = rawPerson.replace(/^(?:dr\.?\s*|doctor\s*)+/i, '').trim();
    const isMed = detectNiche(`${businessType || ''} ${businessName || ''}`) === 'medical';
    if (isMed && contactPerson) {
      contactPerson = `Dr. ${contactPerson}`;
    } else if (!contactPerson) {
      contactPerson = rawPerson || (isMed ? 'Doctor & Practice Principal' : 'Business Principal');
    }

    const phone = req.body.phone;
    const email = req.body.email;
    const city = req.body.city;
    const consultationFee = req.body.consultationFee || req.body.consultation_fee;
    const workTiming = req.body.workTiming || req.body.work_timing;
    const answers = req.body.answers || {};

    if (!businessName || !contactPerson) {
      return res.status(400).json({ error: 'Business/Clinic Name and Doctor/Contact Person are required.' });
    }

    const topmateUrl = SettingsModel.get('topmate_url') || 'https://topmate.io/isurajjaiswal';
    const agencyName = SettingsModel.get('agency_name') || 'The Digital Frog';
    const founderName = SettingsModel.get('founder_name') || 'Suraj Jaiswal';

    // 1. Calculate weighted scores
    const scores = ScorecardEngine.calculateScores(answers);

    // 2. Synthesize authentic ℞ Prescription
    const rxResult = ScorecardEngine.generatePrescription({
      businessName,
      contactPerson,
      businessType,
      city,
      consultationFee,
      workTiming,
      scores,
      answers,
      topmateUrl,
      agencyName,
      founderName
    });

    // 3. Save to scorecard_leads database
    const leadId = ScorecardLeadModel.create({
      business_name: businessName,
      contact_person: contactPerson,
      phone: phone || null,
      email: email || null,
      business_type: businessType || 'General',
      city: city || null,
      consultation_fee: consultationFee || null,
      work_timing: workTiming || null,
      overall_score: scores.overallScore,
      video_score: scores.videoScore,
      discovery_score: scores.discoveryScore,
      conversion_score: scores.conversionScore,
      answers,
      prescription_text: rxResult.prescriptionText,
      prescription_data: rxResult,
      status: 'new'
    });

    // 4. Generate High-Res Official ℞ PDF
    let pdfUrl = null;
    let pdfPath = null;
    try {
      const pdfRes = await ScorecardPdfGenerator.generatePrescriptionPdf({
        leadId,
        businessName,
        contactPerson,
        businessType,
        city,
        consultationFee,
        workTiming,
        scores,
        prescriptionText: rxResult.prescriptionText,
        prescriptionData: rxResult,
        topmateUrl,
        agencyName,
        founderName,
        email
      });
      pdfUrl = pdfRes.publicUrl;
      pdfPath = pdfRes.filePath;
      ScorecardLeadModel.updatePdf(leadId, pdfPath, pdfUrl);
    } catch (pdfErr) {
      console.warn('[Scorecard PDF Generation Warning]:', pdfErr.message);
    }

    // 5. Log and notify via WebSocket
    LogModel.add('scorecard', 'test_completed', `Diagnostic test completed by ${contactPerson} (${businessName}) - Score: ${scores.overallScore}/100`, { leadId, score: scores.overallScore, pdfUrl });
    
    orchestrator.broadcast('scorecard_lead_new', {
      id: leadId,
      businessName,
      contactPerson,
      phone,
      email,
      scores,
      prescriptionText: rxResult.prescriptionText,
      consultationFee,
      workTiming,
      city,
      pdfUrl
    });

    res.json({
      success: true,
      leadId,
      scores,
      niche: rxResult.niche,
      nicheProfile: rxResult.nicheProfile,
      prescriptionText: rxResult.prescriptionText,
      diagnosticSymptom: rxResult.diagnosticSymptom,
      reelHooks: rxResult.reelHooks,
      topmateUrl,
      agencyName,
      founderName,
      pdfUrl,
      emailSentTo: email || null
    });
  } catch (err) {
    console.error('[Scorecard Submit Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download/View Generated Prescription PDF for a lead (Auto-generates if missing!)
app.get('/api/scorecard/leads/:id/pdf', async (req, res) => {
  try {
    let lead = ScorecardLeadModel.getById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found.' });
    }

    const safePdfBase = path.resolve('public', 'prescriptions');
    let resolvedPath = lead.pdf_path ? path.resolve(lead.pdf_path) : null;

    // If PDF is not yet generated or missing on disk, generate it dynamically!
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      console.log(`[ScorecardPDF] Auto-generating missing PDF on-demand for lead #${lead.id} (${lead.business_name})...`);
      
      let answers = {};
      try {
        answers = typeof lead.answers === 'string' ? JSON.parse(lead.answers) : (lead.answers || {});
      } catch (_) {}

      const scores = {
        overallScore: lead.overall_score || 45,
        videoScore: lead.video_score || 25,
        discoveryScore: lead.discovery_score || 45,
        conversionScore: lead.conversion_score || 55,
        grade: (lead.overall_score >= 80 ? 'A' : lead.overall_score >= 65 ? 'B' : lead.overall_score >= 45 ? 'C' : 'D'),
        statusSummary: (lead.overall_score || 45) < 50 ? 'Critical Video Growth Deficiency' : 'High Patient Growth Potential'
      };

      const topmateUrl = process.env.TOPMATE_URL || 'https://topmate.io/isurajjaiswal';
      const agencyName = 'The Digital Frog';
      const founderName = 'Suraj Jaiswal';

      const rxResult = ScorecardEngine.generatePrescription({
        businessName: lead.business_name,
        contactPerson: lead.contact_person,
        businessType: lead.business_type,
        city: lead.city,
        consultationFee: lead.consultation_fee,
        workTiming: lead.work_timing,
        scores,
        answers,
        topmateUrl,
        agencyName,
        founderName
      });

      const pdfRes = await ScorecardPdfGenerator.generatePrescriptionPdf({
        leadId: lead.id,
        businessName: lead.business_name,
        contactPerson: lead.contact_person,
        businessType: lead.business_type,
        city: lead.city,
        consultationFee: lead.consultation_fee,
        workTiming: lead.work_timing,
        scores,
        prescriptionText: rxResult.prescriptionText,
        prescriptionData: rxResult,
        topmateUrl,
        agencyName,
        founderName,
        email: lead.email
      });

      ScorecardLeadModel.updatePdf(lead.id, pdfRes.filePath, pdfRes.publicUrl);
      db.prepare('UPDATE scorecard_leads SET prescription_text = ?, prescription_data = ? WHERE id = ?')
        .run(rxResult.prescriptionText, JSON.stringify(rxResult), lead.id);

      resolvedPath = path.resolve(pdfRes.filePath);
    }

    if (!isPathSafe(safePdfBase, resolvedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid file location.' });
    }
    const downloadName = path.basename(resolvedPath);
    res.download(resolvedPath, downloadName);
  } catch (err) {
    console.error('[ScorecardPDF] Error serving PDF:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all Scorecard Leads for CRM
app.get('/api/scorecard/leads', requireAuth, (req, res) => {
  try {
    const leads = ScorecardLeadModel.getAll(req.query);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Scorecard Leads Summary Stats
app.get('/api/scorecard/stats', requireAuth, (req, res) => {
  try {
    const stats = ScorecardLeadModel.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Scorecard Lead Status
app.post('/api/scorecard/leads/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  try {
    ScorecardLeadModel.updateStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Scorecard Lead Email
app.post('/api/scorecard/leads/:id/email', requireAuth, (req, res) => {
  const { email } = req.body;
  try {
    if (email && email.trim()) {
      db.prepare('UPDATE scorecard_leads SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email.trim(), req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Google Maps Lead Email
app.post('/api/maps/leads/:id/email', requireAuth, (req, res) => {
  const { email } = req.body;
  try {
    if (email && email.trim()) {
      db.prepare('UPDATE google_maps_leads SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email.trim(), req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Scorecard Lead Notes
app.post('/api/scorecard/leads/:id/notes', requireAuth, (req, res) => {
  const { notes } = req.body;
  try {
    ScorecardLeadModel.updateNotes(req.params.id, notes);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Scorecard Lead
app.delete('/api/scorecard/leads/:id', requireAuth, (req, res) => {
  try {
    ScorecardLeadModel.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== META-AUTOMATION ENGINE ROUTES ====================

// Engine & CDP Status
app.get('/api/engine/status', requireAuth, async (req, res) => {
  try {
    const cdpStatus = await metaEngineBridge.isCdpActive(9222);
    const syncRes = metaEngineBridge.syncStateToDatabase();
    res.json({
      cdp: cdpStatus,
      activeTask: metaEngineBridge.activeTaskName,
      isRunning: !!metaEngineBridge.activeChild,
      sync: syncRes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger Engine Threads Scan (Admin only)
app.post('/api/engine/scan', requireAuth, requireAdmin, (req, res) => {
  const { limit } = req.body;
  try {
    metaEngineBridge.scan(
      limit || 20,
      (line, isErr) => orchestrator.broadcast('log', { platform: 'threads', text: line, error: isErr }),
      (code) => orchestrator.broadcast('engine_status', { task: 'scan', exitCode: code })
    );
    res.json({ success: true, message: 'Native Threads scan started over CDP' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trigger Engine Semantic Lead Analysis (Admin only)
app.post('/api/engine/analyze', requireAuth, requireAdmin, (req, res) => {
  try {
    metaEngineBridge.analyze(
      (line, isErr) => orchestrator.broadcast('log', { platform: 'ai', text: line, error: isErr }),
      (code) => orchestrator.broadcast('engine_status', { task: 'analyze', exitCode: code })
    );
    res.json({ success: true, message: 'AI Semantic Lead Analysis started' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trigger Full Social Autopilot (Admin only)
app.post('/api/engine/autopilot', requireAuth, requireAdmin, (req, res) => {
  try {
    metaEngineBridge.runSocialAutopilot(
      (line, isErr) => orchestrator.broadcast('log', { platform: 'social', text: line, error: isErr }),
      (code) => orchestrator.broadcast('engine_status', { task: 'autopilot', exitCode: code })
    );
    res.json({ success: true, message: 'Social Autopilot initiated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trigger Job Revenue Engine (Admin only)
app.post('/api/engine/job', requireAuth, requireAdmin, (req, res) => {
  try {
    metaEngineBridge.runJobAutopilot(
      (line, isErr) => orchestrator.broadcast('log', { platform: 'jobs', text: line, error: isErr }),
      (code) => orchestrator.broadcast('engine_status', { task: 'job', exitCode: code })
    );
    res.json({ success: true, message: 'Job Autopilot initiated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stop Active Engine Process (Admin only)
app.post('/api/engine/stop', requireAuth, requireAdmin, (req, res) => {
  res.json(metaEngineBridge.stopActive());
});

// Launch Chrome with CDP Port 9222 (Admin only)
app.post('/api/engine/cdp/launch', requireAuth, requireAdmin, (req, res) => {
  try {
    metaEngineBridge.executeScript(
      'scripts/launch-browser-cdp.js',
      ['--browser=chrome'],
      (line) => orchestrator.broadcast('log', { platform: 'cdp', text: line }),
      (code) => orchestrator.broadcast('log', { platform: 'cdp', text: `CDP Launcher exited with code ${code}` })
    );
    res.json({ success: true, message: 'Launching Chrome with remote debugging on port 9222' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== KNOWLEDGE BASE API ROUTES (Admin only) ====================

// List all knowledge files
app.get('/api/knowledge', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json({ files: metaEngineBridge.getKnowledgeList() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read specific knowledge file
app.get('/api/knowledge/:filename', requireAuth, requireAdmin, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || !filename.endsWith('.md') || path.basename(filename) !== filename) {
      return res.status(400).json({ error: 'Only markdown knowledge files (.md) are accessible' });
    }
    const content = metaEngineBridge.getKnowledgeFile(filename);
    res.json({ filename, content });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Update specific knowledge file
app.post('/api/knowledge/:filename', requireAuth, requireAdmin, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || !filename.endsWith('.md') || path.basename(filename) !== filename) {
      return res.status(400).json({ error: 'Only markdown knowledge files (.md) can be modified' });
    }
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    const result = metaEngineBridge.saveKnowledgeFile(filename, content);
    LogModel.add('knowledge', 'update', `Updated knowledge file ${filename}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global Express error handler to prevent stack trace leaks
app.use((err, req, res, next) => {
  console.error('[Internal Error Catch]:', err.message);
  res.status(err.status || 500).json({
    error: 'An internal server error occurred'
  });
});

// Process-level resilience against crashes
process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Unhandled Rejection]:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 TDF Growth Hub & Lead Outreach Engine running at http://localhost:${PORT}`);
  LogModel.add('system', 'server_online', `Control Center server started on port ${PORT}`);

  // Automatically start Cloudflare Live HTTPS Tunnel so client links work worldwide
  try {
    const tunnelRes = await tunnelManager.start(PORT);
    if (tunnelRes.success) {
      console.log(`🌍 Live Public URL Active: ${tunnelRes.publicUrl}`);
    }
  } catch (err) {
    console.warn('[Tunnel Notice] Automatic tunnel startup:', err.message);
  }

  // Start fixed-time social media automated engagement scheduler (10:00 AM & 3:00 PM)
  socialEngagementEngine.startFixedTimeScheduler();
});
