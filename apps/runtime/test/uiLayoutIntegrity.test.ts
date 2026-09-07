import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

describe('Milestone 7.5.1: Real IDE UI Architecture & Design System Integrity', () => {
  test('1. index.css declares --ai-panel-width and modal design system primitives', async () => {
    const cssPath = path.join(repoRoot, 'apps/web/src/index.css');
    const cssContent = await fs.readFile(cssPath, 'utf8');

    assert.ok(cssContent.includes('--ai-panel-width: 360px;'), 'Must define --ai-panel-width: 360px');
    assert.ok(cssContent.includes('.modal-overlay'), 'Must define .modal-overlay');
    assert.ok(cssContent.includes('.modal-card'), 'Must define .modal-card');
    assert.ok(cssContent.includes('.modal-header'), 'Must define .modal-header');
    assert.ok(cssContent.includes('.modal-body'), 'Must define .modal-body');
    assert.ok(cssContent.includes('.modal-btn-primary'), 'Must define .modal-btn-primary');
  });

  test('2. Modals strictly use Minfy design tokens with zero unconfigured Tailwind classes', async () => {
    const pmmPath = path.join(repoRoot, 'apps/web/src/components/AI/ProviderManagerModal.tsx');
    const bcmPath = path.join(repoRoot, 'apps/web/src/components/AI/BedrockConfigModal.tsx');

    const pmmContent = await fs.readFile(pmmPath, 'utf8');
    const bcmContent = await fs.readFile(bcmPath, 'utf8');

    // Confirm modal structure
    assert.ok(pmmContent.includes('modal-overlay'), 'ProviderManagerModal must use modal-overlay');
    assert.ok(pmmContent.includes('modal-card'), 'ProviderManagerModal must use modal-card');
    assert.ok(bcmContent.includes('modal-overlay'), 'BedrockConfigModal must use modal-overlay');
    assert.ok(bcmContent.includes('modal-card'), 'BedrockConfigModal must use modal-card');

    // Confirm no broken Tailwind utility classes remain
    const forbiddenPatterns = ['space-y-', 'fixed inset-0', 'backdrop-blur', '#181825', '#313244', '#cdd6f4'];
    for (const pattern of forbiddenPatterns) {
      assert.ok(!pmmContent.includes(pattern), `ProviderManagerModal should not contain Tailwind artifact "${pattern}"`);
      assert.ok(!bcmContent.includes(pattern), `BedrockConfigModal should not contain Tailwind artifact "${pattern}"`);
    }
  });

  test('3. AIPanel docks to the right side with 360px width and dedicated close button', async () => {
    const aiPanelPath = path.join(repoRoot, 'apps/web/src/components/AI/AIPanel.tsx');
    const aiPanelContent = await fs.readFile(aiPanelPath, 'utf8');

    assert.ok(aiPanelContent.includes('--ai-panel-width'), 'AIPanel must use --ai-panel-width');
    assert.ok(aiPanelContent.includes('borderLeft'), 'AIPanel must have borderLeft for right-side docking');
    assert.ok(aiPanelContent.includes('onClose'), 'AIPanel must accept onClose callback');
  });

  test('4. App.tsx docks AIPanel on the right of the editor without replacing Left Sidebar', async () => {
    const appPath = path.join(repoRoot, 'apps/web/src/App.tsx');
    const appContent = await fs.readFile(appPath, 'utf8');

    assert.ok(appContent.includes('aiPanelOpen'), 'App.tsx must maintain aiPanelOpen state');
    assert.ok(appContent.includes('toggleAiPanel'), 'App.tsx must define toggleAiPanel');
    // Ensure AIPanel is docked in the main-body beside editor-area-container
    const editorIndex = appContent.indexOf('editor-area-container');
    const aiPanelIndex = appContent.indexOf('<AIPanel');
    assert.ok(editorIndex !== -1, 'Editor area must be present');
    assert.ok(aiPanelIndex !== -1, 'AIPanel must be present');
    assert.ok(aiPanelIndex > editorIndex, 'AIPanel must be docked to the right of the editor-area-container');
  });

  test('5. TerminalPanel implements PTY resize protocol and ResizeObserver', async () => {
    const termPath = path.join(repoRoot, 'apps/web/src/components/Terminal/TerminalPanel.tsx');
    const termContent = await fs.readFile(termPath, 'utf8');

    assert.ok(termContent.includes("type: 'resize'"), 'TerminalPanel must send resize protocol messages');
    assert.ok(termContent.includes('ResizeObserver'), 'TerminalPanel must employ ResizeObserver');
    assert.ok(termContent.includes('PowerShell'), 'TerminalPanel header must indicate PowerShell shell');
  });
});
