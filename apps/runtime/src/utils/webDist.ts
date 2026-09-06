import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveWebDistPath(): string | null {
  const candidates = [
    process.env.MINFY_WEB_DIST,
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../web/dist'),
    path.resolve(__dirname, '../../../../apps/web/dist'),
    path.resolve(__dirname, '../../../apps/web/dist'),
    path.resolve(__dirname, '../web/dist'),
  ].filter(Boolean) as string[];

  for (const cand of candidates) {
    if (fs.existsSync(path.join(cand, 'index.html'))) {
      return cand;
    }
  }
  return null;
}
