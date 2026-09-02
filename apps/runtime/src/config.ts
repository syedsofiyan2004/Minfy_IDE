import path from 'node:path';
import os from 'node:os';

export const CONFIG = {
  PORT: parseInt(process.env.MINFY_PORT || '4560', 10),
  HOST: '127.0.0.1', // Strictly loopback
  VERSION: '0.1.0',
  DATA_DIR: path.join(os.homedir(), '.minfy'),
  WORKSPACES_FILE: path.join(os.homedir(), '.minfy', 'workspaces.json'),
  MAX_FILE_SIZE_BYTES: 2 * 1024 * 1024, // 2MB max for text editor
  BINARY_CHECK_BYTES: 1024, // First 1KB checked for null bytes
};
