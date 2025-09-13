import { jest } from '@jest/globals';
import { GDriveAppData } from './GDriveAppData.js';

// Minimal mock of gapi client
function makeGapiMock({ filesList, filesGet, request }) {
  return {
    client: {
      setToken: jest.fn(),
      drive: {
        files: {
          list: jest.fn().mockImplementation(filesList),
          get: jest.fn().mockImplementation(filesGet),
        },
      },
      request: jest.fn().mockImplementation(request),
    },
  };
}

// Helpers to build multipart expectations aren't needed; we just assert call shapes

describe('GDriveAppData text file operations', () => {
  let gd;

  beforeEach(() => {
    gd = new GDriveAppData();
    global.gapi = makeGapiMock({
      filesList: async ({ spaces, q, fields, pageSize }) => ({
        result: { files: [] },
      }),
      filesGet: async ({ fileId, alt }) => ({ body: 'content' }),
      request: async () => ({ result: { ok: true } }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.gapi;
  });

  test('getFileIdByName returns null when not found', async () => {
    const id = await gd.getFileIdByName('foo.txt');
    expect(id).toBeNull();
    expect(gapi.client.drive.files.list).toHaveBeenCalled();
  });

  test('getFileIdByName returns id when found', async () => {
    gapi.client.drive.files.list.mockResolvedValueOnce({
      result: { files: [{ id: '123', name: 'foo.txt' }] },
    });
    const id = await gd.getFileIdByName('foo.txt');
    expect(id).toBe('123');
  });

  test('readTextFile returns empty string when file not found', async () => {
    const content = await gd.readTextFile('missing.txt');
    expect(content).toBe('');
  });

  test('readTextFile returns content when found', async () => {
    gapi.client.drive.files.list.mockResolvedValueOnce({
      result: { files: [{ id: 'abc', name: 'bar.txt' }] },
    });
    const content = await gd.readTextFile('bar.txt');
    expect(gapi.client.drive.files.get).toHaveBeenCalledWith({ fileId: 'abc', alt: 'media' });
    expect(content).toBe('content');
  });

  test('createOrOverwriteTextFile creates when not found', async () => {
    await gd.createOrOverwriteTextFile('new.txt', 'hello');
    expect(gapi.client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/upload/drive/v3/files',
        method: 'POST',
        params: { uploadType: 'multipart' },
      })
    );
  });

  test('createOrOverwriteTextFile overwrites when found', async () => {
    // First call in createOrOverwrite -> getFileIdByName -> files.list returns found
    gapi.client.drive.files.list.mockResolvedValueOnce({
      result: { files: [{ id: 'id-1', name: 'same.txt' }] },
    });
    // When updateTextFile internally calls getFileIdByName again, return same id
    gapi.client.drive.files.list.mockResolvedValueOnce({
      result: { files: [{ id: 'id-1', name: 'same.txt' }] },
    });
    await gd.createOrOverwriteTextFile('same.txt', 'hi');
    expect(gapi.client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: expect.stringMatching(/\/upload\/drive\/v3\/files\/id-1$/),
      })
    );
  });

  test('updateTextFile throws when not found', async () => {
    await expect(gd.updateTextFile('missing.txt', 'x')).rejects.toThrow('File not found');
  });

  test('updateTextFile updates when found', async () => {
    gapi.client.drive.files.list.mockResolvedValueOnce({
      result: { files: [{ id: 'id-2', name: 'exists.txt' }] },
    });
    await gd.updateTextFile('exists.txt', 'updated');
    expect(gapi.client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: expect.stringMatching(/\/upload\/drive\/v3\/files\/id-2$/),
      })
    );
  });
});
