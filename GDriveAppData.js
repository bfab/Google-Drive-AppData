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
    await this.loadGisScript();
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => {
        this.accessToken = tokenResponse.access_token;
        this.isSignedIn = true;
        window.gapi.client.setToken({ access_token: this.accessToken });
        if (this.onSignedInChange) this.onSignedInChange(true);
      },
    });
    this.gisLoaded = true;
  }

  async signIn() {
    if (!this.gapiLoaded) await this.initGapiClient();
    if (!this.gisLoaded) await this.initGisClient();
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  signOut() {
    this.accessToken = null;
    this.isSignedIn = false;
    window.gapi.client.setToken(null);
    if (this.onSignedInChange) this.onSignedInChange(false);
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
}
