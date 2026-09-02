import { useState, useEffect, useCallback, useRef } from 'react';
import { Workspace, FileNode, FileContentResult, ProjectIntelligence } from '@minfy/shared';
import { api } from './api/client.js';
import { Header } from './components/Header.js';
import { ActivityBar, ActivityView } from './components/ActivityBar/ActivityBar.js';
import { FileTree } from './components/Explorer/FileTree.js';
import { SourceControlView } from './components/SourceControl/SourceControlView.js';
import { ProjectIntelligenceView } from './components/Project/ProjectIntelligenceView.js';
import { AIPanel } from './components/AI/AIPanel.js';
import { CodeEditor } from './components/Editor/CodeEditor.js';
import { UnsavedChangesModal } from './components/Editor/UnsavedChangesModal.js';
import { TerminalPanel } from './components/Terminal/TerminalPanel.js';
import { WorkspaceSelector } from './components/WorkspaceSelector.js';
import { ToastContainer, ToastMessage } from './components/Toast.js';

type PendingNavigation =
  | { type: 'file'; node: FileNode }
  | { type: 'path'; path: string }
  | { type: 'workspace'; ws: Workspace };

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<Workspace[]>([]);
  const [runtimeConnected, setRuntimeConnected] = useState<boolean>(true);

  // Active Sidebar View (Milestone 2 & 3 Activity Bar)
  const [activeView, setActiveView] = useState<ActivityView>('explorer');

  // File tree state
  const [fileNodes, setFileNodes] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Intelligence & Git state (Milestone 2)
  const [intelligence, setIntelligence] = useState<ProjectIntelligence | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState<boolean>(false);

  // Active Editor state
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [fileData, setFileData] = useState<FileContentResult | null>(null);
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Dirty State Protection (Milestone 1.1)
  const [isEditorDirty, setIsEditorDirty] = useState<boolean>(false);
  const [currentBufferContent, setCurrentBufferContent] = useState<string>('');
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [isSavingPending, setIsSavingPending] = useState<boolean>(false);

  // Panels state
  const [terminalOpen, setTerminalOpen] = useState<boolean>(true);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Browser refresh protection when editor has unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditorDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditorDirty]);

  // Heartbeat runtime check
  useEffect(() => {
    const checkRuntime = async () => {
      try {
        await api.checkStatus();
        setRuntimeConnected(true);
      } catch {
        setRuntimeConnected(false);
      }
    };

    checkRuntime();
    const interval = setInterval(checkRuntime, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recent workspaces
  const fetchRecentWorkspaces = useCallback(async () => {
    try {
      const list = await api.listWorkspaces();
      setRecentWorkspaces(list);
    } catch {
      // ignore
    }
  }, []);

  // Fetch Project Intelligence & Git Status (Milestone 2)
  const loadIntelligence = useCallback(
    async (ws: Workspace, forceRefresh = false) => {
      try {
        setIntelligenceLoading(true);
        const data = await api.getIntelligence(ws.id, forceRefresh);
        setIntelligence(data);
      } catch (err: any) {
        console.warn('Failed to load project intelligence:', err);
      } finally {
        setIntelligenceLoading(false);
      }
    },
    []
  );

  // Load tree root for active workspace
  const loadWorkspaceTree = useCallback(async (ws: Workspace) => {
    try {
      setTreeLoading(true);
      setTreeError(null);
      const res = await api.listTree(ws.id, '');
      setFileNodes(res.items);
    } catch (err: any) {
      setTreeError(err.message || 'Failed to list workspace contents');
      addToast('error', `Failed to load explorer: ${err.message}`);
    } finally {
      setTreeLoading(false);
    }
  }, [addToast]);

  // Direct workspace selection executor
  const performSelectWorkspace = useCallback(async (ws: Workspace) => {
    setWorkspace(ws);
    setActiveFile(null);
    setFileData(null);
    setFileError(null);
    setIsEditorDirty(false);
    setCurrentBufferContent('');

    // Update URL param without full reload
    const url = new URL(window.location.href);
    url.searchParams.set('workspaceId', ws.id);
    window.history.pushState({}, '', url.toString());

    await Promise.all([
      loadWorkspaceTree(ws),
      loadIntelligence(ws),
    ]);
  }, [loadWorkspaceTree, loadIntelligence]);

  // Handle setting active workspace with unsaved guard
  const handleSelectWorkspace = useCallback(async (ws: Workspace) => {
    if (isEditorDirty && activeFile) {
      setPendingNavigation({ type: 'workspace', ws });
      return;
    }
    await performSelectWorkspace(ws);
  }, [isEditorDirty, activeFile, performSelectWorkspace]);

  // Open workspace by path
  const handleOpenPath = async (dirPath: string) => {
    try {
      const res = await api.registerWorkspace(dirPath);
      await handleSelectWorkspace(res.workspace);
      addToast('success', `Opened workspace: ${res.workspace.name}`);
    } catch (err: any) {
      addToast('error', `Could not open path: ${err.message}`);
      throw err;
    }
  };

  // Initial load: parse query params
  const initialLoadedRef = useRef(false);
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;

    const init = async () => {
      await fetchRecentWorkspaces();
      const params = new URLSearchParams(window.location.search);
      const wsId = params.get('workspaceId');

      if (wsId) {
        try {
          const ws = await api.getWorkspace(wsId);
          await performSelectWorkspace(ws);
        } catch {
          addToast('error', `Workspace ${wsId} not found`);
        }
      }
    };
    init();
  }, [fetchRecentWorkspaces, performSelectWorkspace, addToast]);

  // Helper to recursively update tree node children
  const updateNodeChildren = (
    nodes: FileNode[],
    targetPath: string,
    children: FileNode[]
  ): FileNode[] => {
    return nodes.map((node) => {
      if (node.path === targetPath) {
        return {
          ...node,
          children,
          isLoaded: true,
          hasChildren: children.length > 0,
        };
      }
      if (node.children && node.children.length > 0) {
        return {
          ...node,
          children: updateNodeChildren(node.children, targetPath, children),
        };
      }
      return node;
    });
  };

  // Lazy load directory children
  const handleLoadDirectory = async (folderNode: FileNode) => {
    if (!workspace) return;
    try {
      const res = await api.listTree(workspace.id, folderNode.path);
      setFileNodes((prev) => updateNodeChildren(prev, folderNode.path, res.items));
    } catch (err: any) {
      addToast('error', `Failed to open folder ${folderNode.name}: ${err.message}`);
    }
  };

  // Direct file opening executor
  const performOpenFile = async (fileNode: FileNode) => {
    if (!workspace) return;
    setActiveFile(fileNode);
    setFileLoading(true);
    setFileError(null);
    setIsEditorDirty(false);

    try {
      const res = await api.readFile(workspace.id, fileNode.path);
      setFileData(res);
      setCurrentBufferContent(res.content || '');
    } catch (err: any) {
      setFileError(err.message || 'Unable to open this file.');
      addToast('error', `Error reading file: ${err.message}`);
    } finally {
      setFileLoading(false);
    }
  };

  // Open file in editor with unsaved guard
  const handleSelectFile = async (fileNode: FileNode) => {
    if (activeFile && fileNode.path === activeFile.path) {
      return; // Already on this file
    }

    if (isEditorDirty && activeFile) {
      setPendingNavigation({ type: 'file', node: fileNode });
      return;
    }

    await performOpenFile(fileNode);
  };

  // Open file by string path (from Source Control / Project view)
  const handleOpenFilePath = async (filePath: string) => {
    if (!workspace) return;
    const cleanPath = filePath.replace(/\\/g, '/');
    const name = cleanPath.split('/').pop() || cleanPath;
    const ext = name.includes('.') ? `.${name.split('.').pop()}` : undefined;

    const syntheticNode: FileNode = {
      id: `${workspace.id}:${cleanPath}`,
      name,
      path: cleanPath,
      type: 'file',
      extension: ext,
    };

    if (activeFile && syntheticNode.path === activeFile.path) {
      return;
    }

    if (isEditorDirty && activeFile) {
      setPendingNavigation({ type: 'path', path: cleanPath });
      return;
    }

    await performOpenFile(syntheticNode);
  };

  // Save active file
  const handleSaveFile = async (subPath: string, content: string) => {
    if (!workspace) return;
    try {
      const res = await api.saveFile(workspace.id, subPath, content);
      setFileData((prev) => (prev ? { ...prev, content, size: res.size } : null));
      setIsEditorDirty(false);
      addToast('success', `Saved ${activeFile?.name || subPath}`);

      // Refresh intelligence & git status in background after save
      loadIntelligence(workspace, true);
    } catch (err: any) {
      addToast('error', `Failed to save ${subPath}: ${err.message}`);
      throw err;
    }
  };

  // Unsaved Modal Actions
  const handleModalSaveAndContinue = async () => {
    if (!activeFile) return;
    try {
      setIsSavingPending(true);
      await handleSaveFile(activeFile.path, currentBufferContent);
      setIsEditorDirty(false);
      const nav = pendingNavigation;
      setPendingNavigation(null);

      if (nav) {
        if (nav.type === 'file') {
          await performOpenFile(nav.node);
        } else if (nav.type === 'path') {
          await handleOpenFilePath(nav.path);
        } else if (nav.type === 'workspace') {
          await performSelectWorkspace(nav.ws);
        }
      }
    } catch (err: any) {
      addToast('error', `Cannot proceed: ${err.message || 'Save failed'}`);
    } finally {
      setIsSavingPending(false);
    }
  };

  const handleModalDiscardChanges = async () => {
    setIsEditorDirty(false);
    const nav = pendingNavigation;
    setPendingNavigation(null);

    if (nav) {
      if (nav.type === 'file') {
        await performOpenFile(nav.node);
      } else if (nav.type === 'path') {
        await handleOpenFilePath(nav.path);
      } else if (nav.type === 'workspace') {
        await performSelectWorkspace(nav.ws);
      }
    }
  };

  const handleModalCancel = () => {
    setPendingNavigation(null);
  };

  // Create file or folder
  const handleCreateEntry = async (entryPath: string, type: 'file' | 'directory') => {
    if (!workspace) return;
    try {
      const res = await api.createEntry(workspace.id, entryPath, type);
      addToast('success', `Created ${type === 'directory' ? 'folder' : 'file'}: ${res.node.name}`);
      // Refresh tree & intelligence
      await Promise.all([
        loadWorkspaceTree(workspace),
        loadIntelligence(workspace, true),
      ]);
      if (type === 'file') {
        handleSelectFile(res.node);
      }
    } catch (err: any) {
      addToast('error', `Creation failed: ${err.message}`);
      throw err;
    }
  };

  // Full Refresh action
  const handleFullRefresh = async () => {
    if (!workspace) return;
    await Promise.all([
      loadWorkspaceTree(workspace),
      loadIntelligence(workspace, true),
    ]);
    addToast('info', 'Refreshed workspace and intelligence');
  };

  return (
    <div className="app-container">
      {/* Top Header */}
      <Header
        workspace={workspace}
        runtimeConnected={runtimeConnected}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        aiPanelOpen={activeView === 'ai'}
        onToggleAiPanel={() => setActiveView(activeView === 'ai' ? 'explorer' : 'ai')}
        onRefreshWorkspace={workspace ? handleFullRefresh : undefined}
      />

      {/* Main Content Body */}
      {workspace ? (
        <div className="main-body">
          {/* Leftmost Activity Bar (Milestone 2 & 3) */}
          <ActivityBar
            activeView={activeView}
            onChangeView={setActiveView}
            changesCount={intelligence?.git.totalChanges || 0}
          />

          {/* Left Sidebar Views */}
          {activeView === 'explorer' && (
            <FileTree
              nodes={fileNodes}
              loading={treeLoading}
              error={treeError}
              activeFilePath={activeFile?.path || null}
              onSelectFile={handleSelectFile}
              onLoadDirectory={handleLoadDirectory}
              onRefresh={() => loadWorkspaceTree(workspace)}
              onCreateEntry={handleCreateEntry}
            />
          )}

          {activeView === 'source-control' && (
            <SourceControlView
              gitInfo={intelligence?.git || null}
              loading={intelligenceLoading}
              onRefresh={() => loadIntelligence(workspace, true)}
              onOpenFile={handleOpenFilePath}
              activeFilePath={activeFile?.path || null}
            />
          )}

          {activeView === 'project' && (
            <ProjectIntelligenceView
              intelligence={intelligence}
              loading={intelligenceLoading}
              onRefresh={() => loadIntelligence(workspace, true)}
              onOpenFile={handleOpenFilePath}
            />
          )}

          {activeView === 'ai' && (
            <AIPanel />
          )}

          {/* Center Editor & Terminal Area */}
          <div className="editor-area-container">
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <CodeEditor
                activeFile={activeFile}
                fileData={fileData}
                loading={fileLoading}
                error={fileError}
                onSave={handleSaveFile}
                onDirtyChange={(dirty, content) => {
                  setIsEditorDirty(dirty);
                  setCurrentBufferContent(content);
                }}
              />
            </div>

            {/* Bottom Integrated Terminal */}
            <TerminalPanel
              workspaceId={workspace.id}
              isOpen={terminalOpen}
              onClose={() => setTerminalOpen(false)}
            />
          </div>
        </div>
      ) : (
        <WorkspaceSelector
          recentWorkspaces={recentWorkspaces}
          onSelectWorkspace={handleSelectWorkspace}
          onOpenPath={handleOpenPath}
        />
      )}

      {/* Unsaved Changes Confirmation Modal (Milestone 1.1) */}
      <UnsavedChangesModal
        isOpen={pendingNavigation !== null}
        filename={activeFile?.name || 'Current file'}
        isSaving={isSavingPending}
        onSaveAndContinue={handleModalSaveAndContinue}
        onDiscardChanges={handleModalDiscardChanges}
        onCancel={handleModalCancel}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
