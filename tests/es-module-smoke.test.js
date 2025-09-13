import { GDriveAppData } from '../GDriveAppData.js';

describe('ESM smoke', () => {
  test('modules import and export expected classes', () => {
    expect(GDriveAppData).toBeDefined();
    expect(typeof GDriveAppData).toBe('function');
  });
});
