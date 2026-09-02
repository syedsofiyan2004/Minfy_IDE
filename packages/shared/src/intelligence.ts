export interface GitFileStatus {
  path: string; // Relative to workspace root
  workingTreeStatus: 'M' | 'A' | 'D' | '?' | 'R' | 'U' | string;
  indexStatus: 'M' | 'A' | 'D' | 'R' | ' ' | string;
  isStaged: boolean;
  isUnstaged: boolean;
  isUntracked: boolean;
  isInsideWorkspace: boolean;
  origPath?: string; // For renames
}

export interface GitInfo {
  available: boolean;
  isRepository: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  detached: boolean;
  headCommit?: string;
  staged: GitFileStatus[];
  modified: GitFileStatus[];
  untracked: GitFileStatus[];
  deleted: GitFileStatus[];
  renamed: GitFileStatus[];
  totalChanges: number;
}

export interface DetectedLanguage {
  name: string;
  category: 'programming' | 'markup' | 'stylesheet' | 'data';
  confidence: 'high' | 'medium';
  primaryFile?: string;
}

export interface DetectedFramework {
  name: string;
  version?: string;
  category: 'frontend' | 'backend' | 'fullstack' | 'testing' | 'build';
}

export interface DetectedPackageManager {
  name: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'poetry' | 'pipenv' | 'uv' | 'maven' | 'gradle' | 'cargo' | 'nuget' | 'go' | string;
  lockfile?: string;
  isAmbiguous?: boolean;
}

export interface ProjectInfo {
  name: string;
  detectedLanguages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: DetectedPackageManager[];
  buildSystems: string[];
  infrastructure: string[]; // e.g. 'Docker', 'Terraform', 'Kubernetes', 'AWS CDK'
  ciCd: string[]; // e.g. 'GitHub Actions', 'Jenkins', 'GitLab CI'
  importantFiles: string[]; // e.g. ['package.json', 'README.md', 'Dockerfile']
}

export interface ProjectIntelligence {
  workspaceId: string;
  projectName: string;
  project: ProjectInfo;
  git: GitInfo;
  analyzedAt: string;
  analysisTimeMs: number;
}
