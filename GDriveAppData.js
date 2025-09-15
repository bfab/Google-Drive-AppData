// GDriveAppData.js
// Depends on googleClientConfig.js for CLIENT_ID

import { CLIENT_ID } from './googleClientConfig.js';

const DISCOVERY_DOCS = [
  'https://sheets.googleapis.com/$discovery/rest?version=v4',
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
];
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

export class GDriveAppData {
  constructor() {
    this.isSignedIn = false;
    this.accessToken = null;
    this.gapiLoaded = false;
    this.gisLoaded = false;
    this.tokenClient = null;
    this.onSignedInChange = null;
    this.tokenExpiry = null;    // epoch ms of token expiry
    this.refreshTimer = null;   // ID from setTimeout for refresh
    this._pendingRequest = null; // { resolve, reject, timerId } for the current token request
  }

  async loadGapiScript() {
    if (window.gapi) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async loadGisScript() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async initGapiClient() {
    if (this.gapiLoaded) return;
    await this.loadGapiScript();
    await new Promise((resolve) => {
      window.gapi.load('client', async () => {
        await window.gapi.client.init({
          apiKey: "", // not needed for Drive API with OAuth
          discoveryDocs: DISCOVERY_DOCS,
        });
        this.gapiLoaded = true;
        resolve();
      });
    });
  }

  async initGisClient() {
    if (this.gisLoaded && this.tokenClient) return;
    await this.loadGisScript();
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => this._handleTokenResponse(tokenResponse),
    });
    this.gisLoaded = true;
  }

  // Internal: central place that receives token responses from the tokenClient callback
  _handleTokenResponse(tokenResponse) {
    // update internal state if token received
    if (!tokenResponse || tokenResponse.error) {
      // token request failed (common when silent request is not authorized)
      // clear token state (but do not throw)
      this.accessToken = null;
      this.isSignedIn = false;
      window.gapi && window.gapi.client && window.gapi.client.setToken && window.gapi.client.setToken(null);
    } else {
      // got token, update state & schedule refresh
      this.accessToken = tokenResponse.access_token;
      this.isSignedIn = true;
      window.gapi && window.gapi.client && window.gapi.client.setToken && window.gapi.client.setToken({ access_token: this.accessToken });
      // expires_in may be provided (seconds). fallback to 1 hour if missing
      const expiresInSec = tokenResponse.expires_in || 3600;
      this.tokenExpiry = Date.now() + expiresInSec * 1000;
      this.scheduleTokenRefresh();
      if (this.onSignedInChange) this.onSignedInChange(true);
    }

    // resolve/reject any pending promise wrapper
    if (this._pendingRequest) {
      const pending = this._pendingRequest;
      this._pendingRequest = null;
      clearTimeout(pending.timerId);
      if (!tokenResponse || tokenResponse.error) {
        pending.reject(tokenResponse || new Error('Token response error'));
      } else {
        pending.resolve(tokenResponse);
      }
    }
  }

  // Promise wrapper around tokenClient.requestAccessToken that resolves when the callback is invoked.
  // opts example: { prompt: '' } or { prompt: 'consent' }
  _requestAccessToken(opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) return reject(new Error('tokenClient not initialized'));
      if (this._pendingRequest) return reject(new Error('Another token request is in progress'));

      // create pending holder and timeout
      const timerId = setTimeout(() => {
        if (this._pendingRequest) {
          const p = this._pendingRequest;
          this._pendingRequest = null;
          p.reject(new Error('Token request timed out'));
        }
      }, 15000);

      this._pendingRequest = { resolve, reject, timerId };

      try {
        // This triggers the callback we set in initGisClient -> _handleTokenResponse
        this.tokenClient.requestAccessToken(opts);
      } catch (err) {
        // immediate failure
        clearTimeout(timerId);
        this._pendingRequest = null;
        return reject(err);
      }
    });
  }

  // signIn: first try silent, fallback to interactive consent if needed.
  // returns the token response on success, throws on failure.
  async signIn() {
    if (!this.gapiLoaded) await this.initGapiClient();
    if (!this.gisLoaded) await this.initGisClient();

    // try silent first
    try {
      const resp = await this._requestAccessToken({ prompt: '' });
      return resp;
    } catch (silentErr) {
      // silent failed → fallback to interactive consent (pop-up)
      const resp = await this._requestAccessToken({ prompt: 'consent' });
      return resp;
    }
  }

  // Sign out: clear tokens and timers; revoke if possible
  signOut() {
    // stop refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    // clear any pending token request
    if (this._pendingRequest) {
      clearTimeout(this._pendingRequest.timerId);
      this._pendingRequest = null;
    }

    // revoke the access token (best-effort)
    try {
      if (this.accessToken && window.google && window.google.accounts && window.google.accounts.oauth2 && window.google.accounts.oauth2.revoke) {
        window.google.accounts.oauth2.revoke(this.accessToken, () => {});
      }
    } catch (e) {
      // ignore revoke errors
    }

    this.accessToken = null;
    this.isSignedIn = false;
    this.tokenExpiry = null;
    window.gapi && window.gapi.client && window.gapi.client.setToken && window.gapi.client.setToken(null);
    if (this.onSignedInChange) this.onSignedInChange(false);
  }

  // Token refresh scheduling: refresh ~5 minutes before expiry
  scheduleTokenRefresh() {
    // clear existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.tokenExpiry) return;

    const refreshInMs = this.tokenExpiry - Date.now() - 5 * 60 * 1000; // 5 minutes before expiry
    if (refreshInMs <= 0) {
      // already near/expired → refresh now
      this.refreshAccessToken();
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAccessToken();
    }, refreshInMs);
  }

  // Attempt a silent refresh (no popup

  // Attempt a silent refresh (no popup). If it fails, we log and stop — next interactive signIn can be called.
  refreshAccessToken() {
    if (!this.tokenClient) return;
    this._requestAccessToken({ prompt: '' })
      .catch((err) => {
        // silent refresh failed (user signed out, revoked access, or cookies blocked)
        // we clear token state so callers know they need to sign in again.
        console.warn('Silent token refresh failed:', err);
        this.accessToken = null;
        this.isSignedIn = false;
        this.tokenExpiry = null;
        window.gapi && window.gapi.client && window.gapi.client.setToken && window.gapi.client.setToken(null);
        if (this.onSignedInChange) this.onSignedInChange(false);
      });
  }

  async listFiles() {
    const res = await gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      fields: 'files(id, name, modifiedTime, size)',
    });
    return res.result.files;
  }

  // Helpers for text files in appDataFolder
  async getFileIdByName(name) {
    const q = `name='${name.replace(/'/g, "\\'")}' and 'appDataFolder' in parents and trashed=false`;
    const res = await gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      q,
      fields: 'files(id, name)',
      pageSize: 1,
    });
    const files = res.result.files || [];
    return files.length ? files[0].id : null;
  }

  async readTextFile(name) {
    const fileId = await this.getFileIdByName(name);
    if (!fileId) return '';
    const resp = await gapi.client.drive.files.get({ fileId, alt: 'media' });
    // gapi client returns body as string for text
    return resp.body || '';
  }

  async createOrOverwriteTextFile(name, content) {
    const fileId = await this.getFileIdByName(name);
    if (fileId) {
      return this.updateTextFile(name, content);
    }
    const metadata = { name, parents: ['appDataFolder'] };
    const boundary = 'foo_bar_baz_' + Math.random().toString(36).slice(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
      content +
      closeDelim;

    const res = await gapi.client.request({
      path: '/upload/drive/v3/files',
      method: 'POST',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    });
    return res.result;
  }

  async updateTextFile(name, content) {
    const fileId = await this.getFileIdByName(name);
    if (!fileId) {
      throw new Error(`File not found: ${name}`);
    }
    const metadata = { name };
    const boundary = 'foo_bar_baz_' + Math.random().toString(36).slice(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
      content +
      closeDelim;

    const res = await gapi.client.request({
      path: `/upload/drive/v3/files/${encodeURIComponent(fileId)}`,
      method: 'PATCH',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    });
    return res.result;
  }

  async deleteFileByName(name) {
    const fileId = await this.getFileIdByName(name);
    if (!fileId) return false;
    await gapi.client.drive.files.delete({ fileId });
    return true;
  }
}

