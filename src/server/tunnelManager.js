import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SettingsModel, LogModel } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../');

export class TunnelManager {
  constructor() {
    this.process = null;
    this.customDomain = SettingsModel.get('custom_domain') || process.env.CUSTOM_DOMAIN || 'crm.gothedigitalfrog.com';
    this.publicUrl = SettingsModel.get('public_url') || (this.customDomain ? `https://${this.customDomain}` : null);
    this.quickTunnelUrl = null;
    this.status = 'idle'; // 'idle' | 'starting' | 'running' | 'error'
    this.orchestrator = null;
    this.binaryPath = path.join(projectRoot, 'bin', 'cloudflared');
  }

  setOrchestrator(orch) {
    this.orchestrator = orch;
  }

  getStatus() {
    const custom = SettingsModel.get('custom_domain') || process.env.CUSTOM_DOMAIN || 'crm.gothedigitalfrog.com';
    const primaryUrl = SettingsModel.get('public_url') || (custom ? `https://${custom}` : this.quickTunnelUrl);

    return {
      status: this.status,
      publicUrl: primaryUrl,
      customDomain: custom,
      quickTunnelUrl: this.quickTunnelUrl,
      scorecardUrl: `${primaryUrl.replace(/\/+$/, '')}/scorecard`,
      isLive: !!(primaryUrl || this.quickTunnelUrl)
    };
  }

  async start(port = 3000) {
    if (this.process && this.status === 'running') {
      return { success: true, ...this.getStatus() };
    }

    if (!fs.existsSync(this.binaryPath)) {
      console.warn('[TunnelManager] cloudflared binary not found at:', this.binaryPath);
      return { success: false, error: 'cloudflared binary missing in ./bin' };
    }

    const token = SettingsModel.get('cloudflare_tunnel_token') || process.env.CLOUDFLARE_TUNNEL_TOKEN;
    const customDomain = SettingsModel.get('custom_domain') || process.env.CUSTOM_DOMAIN || 'crm.gothedigitalfrog.com';

    this.status = 'starting';

    return new Promise((resolve) => {
      let resolved = false;

      // Mode A: Cloudflare Zero Trust Named Tunnel Token (routes directly to customDomain)
      if (token) {
        console.log(`[TunnelManager] Launching Named Cloudflare Tunnel with Token for ${customDomain}...`);
        this.process = spawn(this.binaryPath, ['tunnel', 'run', '--token', token]);
        this.publicUrl = `https://${customDomain}`;
        SettingsModel.set('public_url', this.publicUrl);
        this.status = 'running';

        this.process.stdout.on('data', (d) => console.log('[CloudflareTunnel]', d.toString().trim()));
        this.process.stderr.on('data', (d) => console.log('[CloudflareTunnel]', d.toString().trim()));

        this.process.on('close', (code) => {
          console.log(`[TunnelManager] Named tunnel closed with code ${code}`);
          this.status = 'idle';
        });

        this.process.on('error', (err) => {
          console.error('[TunnelManager] Named tunnel error:', err.message);
          this.status = 'error';
        });

        console.log(`\n===============================================================`);
        console.log(`🚀 NAMED CLOUDFLARE TUNNEL ACTIVE FOR ${customDomain.toUpperCase()}!`);
        console.log(`👉 Client Diagnostic Scorecard: https://${customDomain}/scorecard`);
        console.log(`👉 Public Outreach & Lead CRM:   https://${customDomain}`);
        console.log(`===============================================================\n`);

        LogModel.add('system', 'tunnel_online', `Named Cloudflare Tunnel active for ${customDomain}`);
        if (this.orchestrator) {
          this.orchestrator.broadcast('tunnel_online', this.getStatus());
        }

        resolved = true;
        resolve({ success: true, ...this.getStatus() });
        return;
      }

      // Mode B: Quick Tunnel (trycloudflare.com) with canonical custom domain support
      console.log(`[TunnelManager] Launching Cloudflare Tunnel for http://localhost:${port}...`);
      this.process = spawn(this.binaryPath, [
        'tunnel',
        '--url', `http://localhost:${port}`,
        '--no-tls-verify'
      ]);

      const onData = (chunk) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          const quickUrl = match[0];
          this.quickTunnelUrl = quickUrl;
          this.status = 'running';

          // If custom domain is configured, that remains the canonical public URL
          if (customDomain) {
            this.publicUrl = `https://${customDomain}`;
          } else {
            this.publicUrl = quickUrl;
          }
          SettingsModel.set('public_url', this.publicUrl);

          console.log(`\n===============================================================`);
          console.log(`🚀 LIVE CLOUDFLARE TUNNEL ACTIVE & ACCESSIBLE WORLDWIDE!`);
          console.log(`🌐 Official Custom Domain : https://${customDomain}`);
          console.log(`🔗 Quick Tunnel Fallback : ${quickUrl}`);
          console.log(`👉 Client Scorecard URL  : https://${customDomain}/scorecard`);
          console.log(`===============================================================\n`);

          LogModel.add('system', 'tunnel_online', `Cloudflare Tunnel active (Custom: https://${customDomain}, Quick: ${quickUrl})`);

          if (this.orchestrator) {
            this.orchestrator.broadcast('tunnel_online', this.getStatus());
          }

          if (!resolved) {
            resolved = true;
            resolve({ success: true, ...this.getStatus() });
          }
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stderr.on('data', onData);

      this.process.on('close', (code) => {
        console.log(`[TunnelManager] Tunnel process stopped with code: ${code}`);
        this.status = 'idle';
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: `Process stopped with code ${code}` });
        }
      });

      this.process.on('error', (err) => {
        console.error('[TunnelManager] Failed to spawn tunnel process:', err);
        this.status = 'error';
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      });

      // 20-second timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: !!(this.publicUrl || this.quickTunnelUrl), ...this.getStatus() });
        }
      }, 20000);
    });
  }

  stop() {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {}
      this.process = null;
    }
    this.status = 'idle';
  }
}

export const tunnelManager = new TunnelManager();
