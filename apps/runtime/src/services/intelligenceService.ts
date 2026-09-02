import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  ProjectIntelligence,
  ProjectInfo,
  DetectedLanguage,
  DetectedFramework,
  DetectedPackageManager,
  Workspace,
} from '@minfy/shared';
import { gitService } from './gitService.js';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  'bin',
  'obj',
  '.turbo',
  '.cache',
]);

const IMPORTANT_FILE_CANDIDATES = [
  'README.md',
  'readme.md',
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Cargo.toml',
  'go.mod',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Jenkinsfile',
  '.gitignore',
  'cdk.json',
];

export class IntelligenceService {
  private cache: Map<string, ProjectIntelligence> = new Map();

  public invalidateCache(workspaceId: string) {
    this.cache.delete(workspaceId);
  }

  public async analyzeWorkspace(workspace: Workspace, forceRefresh = false): Promise<ProjectIntelligence> {
    if (!forceRefresh && this.cache.has(workspace.id)) {
      return this.cache.get(workspace.id)!;
    }

    const startTime = Date.now();
    const rootPath = path.resolve(workspace.rootPath);

    // Parallel fetch: Git status & Filesystem scan
    const [gitInfo, projectInfo] = await Promise.all([
      gitService.getGitInfo(rootPath),
      this.scanProject(workspace.name, rootPath),
    ]);

    const intelligence: ProjectIntelligence = {
      workspaceId: workspace.id,
      projectName: workspace.name,
      project: projectInfo,
      git: gitInfo,
      analyzedAt: new Date().toISOString(),
      analysisTimeMs: Date.now() - startTime,
    };

    this.cache.set(workspace.id, intelligence);
    return intelligence;
  }

  private async scanProject(projectName: string, rootPath: string): Promise<ProjectInfo> {
    const languagesMap = new Map<string, DetectedLanguage>();
    const frameworksMap = new Map<string, DetectedFramework>();
    const packageManagers: DetectedPackageManager[] = [];
    const buildSystems = new Set<string>();
    const infrastructure = new Set<string>();
    const ciCd = new Set<string>();
    const importantFiles: string[] = [];

    // Check important files at root
    for (const candidate of IMPORTANT_FILE_CANDIDATES) {
      const filePath = path.join(rootPath, candidate);
      if (fsSync.existsSync(filePath)) {
        importantFiles.push(candidate);
      }
    }

    // 1. JavaScript / TypeScript analysis (package.json)
    const pkgPath = path.join(rootPath, 'package.json');
    if (fsSync.existsSync(pkgPath)) {
      languagesMap.set('JavaScript', { name: 'JavaScript', category: 'programming', confidence: 'high' });
      buildSystems.add('Node.js');

      try {
        const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        // TypeScript check
        if (allDeps['typescript'] || fsSync.existsSync(path.join(rootPath, 'tsconfig.json'))) {
          languagesMap.set('TypeScript', { name: 'TypeScript', category: 'programming', confidence: 'high' });
        }

        // Frameworks
        if (allDeps['next']) frameworksMap.set('Next.js', { name: 'Next.js', version: allDeps['next'], category: 'fullstack' });
        if (allDeps['react']) frameworksMap.set('React', { name: 'React', version: allDeps['react'], category: 'frontend' });
        if (allDeps['vue']) frameworksMap.set('Vue', { name: 'Vue', version: allDeps['vue'], category: 'frontend' });
        if (allDeps['nuxt']) frameworksMap.set('Nuxt', { name: 'Nuxt', version: allDeps['nuxt'], category: 'fullstack' });
        if (allDeps['@angular/core']) frameworksMap.set('Angular', { name: 'Angular', version: allDeps['@angular/core'], category: 'frontend' });
        if (allDeps['svelte']) frameworksMap.set('Svelte', { name: 'Svelte', version: allDeps['svelte'], category: 'frontend' });
        if (allDeps['@sveltejs/kit']) frameworksMap.set('SvelteKit', { name: 'SvelteKit', version: allDeps['@sveltejs/kit'], category: 'fullstack' });
        if (allDeps['express']) frameworksMap.set('Express', { name: 'Express', version: allDeps['express'], category: 'backend' });
        if (allDeps['@nestjs/core']) frameworksMap.set('NestJS', { name: 'NestJS', version: allDeps['@nestjs/core'], category: 'backend' });
        if (allDeps['vite']) {
          frameworksMap.set('Vite', { name: 'Vite', version: allDeps['vite'], category: 'build' });
          buildSystems.add('Vite');
        }

        // AWS CDK
        if (allDeps['aws-cdk'] || allDeps['aws-cdk-lib'] || fsSync.existsSync(path.join(rootPath, 'cdk.json'))) {
          infrastructure.add('AWS CDK');
        }
      } catch (err) {
        console.warn('[Intelligence] Failed to parse package.json:', err);
      }
    }

    // Lockfile & JS/TS Package Manager Detection
    const jsLockfiles: { name: string; lockfile: string }[] = [];
    if (fsSync.existsSync(path.join(rootPath, 'package-lock.json'))) jsLockfiles.push({ name: 'npm', lockfile: 'package-lock.json' });
    if (fsSync.existsSync(path.join(rootPath, 'yarn.lock'))) jsLockfiles.push({ name: 'yarn', lockfile: 'yarn.lock' });
    if (fsSync.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) jsLockfiles.push({ name: 'pnpm', lockfile: 'pnpm-lock.yaml' });
    if (fsSync.existsSync(path.join(rootPath, 'bun.lock')) || fsSync.existsSync(path.join(rootPath, 'bun.lockb'))) {
      jsLockfiles.push({ name: 'bun', lockfile: 'bun.lock' });
    }

    if (jsLockfiles.length === 1) {
      packageManagers.push({ name: jsLockfiles[0].name, lockfile: jsLockfiles[0].lockfile });
    } else if (jsLockfiles.length > 1) {
      for (const lf of jsLockfiles) {
        packageManagers.push({ name: lf.name, lockfile: lf.lockfile, isAmbiguous: true });
      }
    } else if (fsSync.existsSync(pkgPath)) {
      // Default to npm if package.json exists without lockfile
      packageManagers.push({ name: 'npm' });
    }

    // 2. Python analysis
    const pyprojectPath = path.join(rootPath, 'pyproject.toml');
    const reqsPath = path.join(rootPath, 'requirements.txt');
    const pipfilePath = path.join(rootPath, 'Pipfile');

    if (fsSync.existsSync(pyprojectPath) || fsSync.existsSync(reqsPath) || fsSync.existsSync(pipfilePath)) {
      languagesMap.set('Python', { name: 'Python', category: 'programming', confidence: 'high' });

      if (fsSync.existsSync(path.join(rootPath, 'poetry.lock'))) {
        packageManagers.push({ name: 'poetry', lockfile: 'poetry.lock' });
        buildSystems.add('Poetry');
      } else if (fsSync.existsSync(path.join(rootPath, 'Pipfile.lock'))) {
        packageManagers.push({ name: 'pipenv', lockfile: 'Pipfile.lock' });
      } else if (fsSync.existsSync(path.join(rootPath, 'uv.lock'))) {
        packageManagers.push({ name: 'uv', lockfile: 'uv.lock' });
      } else if (fsSync.existsSync(reqsPath)) {
        packageManagers.push({ name: 'pip', lockfile: 'requirements.txt' });
      }

      // Framework check in requirements / pyproject
      try {
        let content = '';
        if (fsSync.existsSync(reqsPath)) content += await fs.readFile(reqsPath, 'utf-8');
        if (fsSync.existsSync(pyprojectPath)) content += '\n' + (await fs.readFile(pyprojectPath, 'utf-8'));
        const lower = content.toLowerCase();

        if (lower.includes('fastapi')) frameworksMap.set('FastAPI', { name: 'FastAPI', category: 'backend' });
        if (lower.includes('django')) frameworksMap.set('Django', { name: 'Django', category: 'fullstack' });
        if (lower.includes('flask')) frameworksMap.set('Flask', { name: 'Flask', category: 'backend' });
      } catch {}
    }

    // 3. Java analysis
    const pomPath = path.join(rootPath, 'pom.xml');
    const gradlePath = path.join(rootPath, 'build.gradle');
    const gradleKtsPath = path.join(rootPath, 'build.gradle.kts');

    if (fsSync.existsSync(pomPath) || fsSync.existsSync(gradlePath) || fsSync.existsSync(gradleKtsPath)) {
      languagesMap.set('Java', { name: 'Java', category: 'programming', confidence: 'high' });

      if (fsSync.existsSync(pomPath)) {
        packageManagers.push({ name: 'maven', lockfile: 'pom.xml' });
        buildSystems.add('Maven');
        try {
          const pomRaw = await fs.readFile(pomPath, 'utf-8');
          if (pomRaw.includes('spring-boot')) {
            frameworksMap.set('Spring Boot', { name: 'Spring Boot', category: 'backend' });
          }
        } catch {}
      }
      if (fsSync.existsSync(gradlePath) || fsSync.existsSync(gradleKtsPath)) {
        packageManagers.push({ name: 'gradle' });
        buildSystems.add('Gradle');
        try {
          const gradleRaw = fsSync.existsSync(gradlePath)
            ? await fs.readFile(gradlePath, 'utf-8')
            : await fs.readFile(gradleKtsPath, 'utf-8');
          if (gradleRaw.includes('spring-boot') || gradleRaw.includes('org.springframework.boot')) {
            frameworksMap.set('Spring Boot', { name: 'Spring Boot', category: 'backend' });
          }
        } catch {}
      }
    }

    // 4. Rust analysis
    const cargoPath = path.join(rootPath, 'Cargo.toml');
    if (fsSync.existsSync(cargoPath)) {
      languagesMap.set('Rust', { name: 'Rust', category: 'programming', confidence: 'high' });
      packageManagers.push({ name: 'cargo', lockfile: fsSync.existsSync(path.join(rootPath, 'Cargo.lock')) ? 'Cargo.lock' : undefined });
      buildSystems.add('Cargo');
    }

    // 5. Go analysis
    const goModPath = path.join(rootPath, 'go.mod');
    if (fsSync.existsSync(goModPath)) {
      languagesMap.set('Go', { name: 'Go', category: 'programming', confidence: 'high' });
      packageManagers.push({ name: 'go', lockfile: 'go.sum' });
      buildSystems.add('Go Modules');
    }

    // 6. .NET / C# analysis
    try {
      const rootEntries = await fs.readdir(rootPath);
      const hasCsproj = rootEntries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln') || e.endsWith('.fsproj'));
      if (hasCsproj) {
        languagesMap.set('C#', { name: 'C#', category: 'programming', confidence: 'high' });
        packageManagers.push({ name: 'nuget' });
        buildSystems.add('.NET');
      }
    } catch {}

    // 7. Infrastructure & DevOps
    // Docker
    if (
      fsSync.existsSync(path.join(rootPath, 'Dockerfile')) ||
      fsSync.existsSync(path.join(rootPath, 'docker-compose.yml')) ||
      fsSync.existsSync(path.join(rootPath, 'docker-compose.yaml')) ||
      fsSync.existsSync(path.join(rootPath, 'compose.yml')) ||
      fsSync.existsSync(path.join(rootPath, 'compose.yaml'))
    ) {
      infrastructure.add('Docker');
    }

    // Terraform
    try {
      const rootEntries = await fs.readdir(rootPath);
      if (rootEntries.some((e) => e.endsWith('.tf') || e.endsWith('.tfvars'))) {
        infrastructure.add('Terraform');
      }
    } catch {}

    // Kubernetes
    if (
      fsSync.existsSync(path.join(rootPath, 'k8s')) ||
      fsSync.existsSync(path.join(rootPath, 'kubernetes')) ||
      fsSync.existsSync(path.join(rootPath, 'deploy/kubernetes'))
    ) {
      infrastructure.add('Kubernetes');
    }

    // 8. CI/CD
    if (fsSync.existsSync(path.join(rootPath, '.github', 'workflows'))) {
      ciCd.add('GitHub Actions');
    }
    if (fsSync.existsSync(path.join(rootPath, 'Jenkinsfile'))) {
      ciCd.add('Jenkins');
    }
    if (fsSync.existsSync(path.join(rootPath, '.gitlab-ci.yml'))) {
      ciCd.add('GitLab CI');
    }

    // 9. Shallow file extension scan for additional language detection
    await this.scanExtensions(rootPath, languagesMap, 0, 2);

    return {
      name: projectName,
      detectedLanguages: Array.from(languagesMap.values()),
      frameworks: Array.from(frameworksMap.values()),
      packageManagers,
      buildSystems: Array.from(buildSystems),
      infrastructure: Array.from(infrastructure),
      ciCd: Array.from(ciCd),
      importantFiles,
    };
  }

  private async scanExtensions(
    dir: string,
    languagesMap: Map<string, DetectedLanguage>,
    currentDepth: number,
    maxDepth: number
  ) {
    if (currentDepth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            await this.scanExtensions(path.join(dir, entry.name), languagesMap, currentDepth + 1, maxDepth);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          switch (ext) {
            case '.ts':
            case '.tsx':
              if (!languagesMap.has('TypeScript')) {
                languagesMap.set('TypeScript', { name: 'TypeScript', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.js':
            case '.jsx':
            case '.mjs':
            case '.cjs':
              if (!languagesMap.has('JavaScript')) {
                languagesMap.set('JavaScript', { name: 'JavaScript', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.py':
              if (!languagesMap.has('Python')) {
                languagesMap.set('Python', { name: 'Python', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.java':
              if (!languagesMap.has('Java')) {
                languagesMap.set('Java', { name: 'Java', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.rs':
              if (!languagesMap.has('Rust')) {
                languagesMap.set('Rust', { name: 'Rust', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.go':
              if (!languagesMap.has('Go')) {
                languagesMap.set('Go', { name: 'Go', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.cs':
              if (!languagesMap.has('C#')) {
                languagesMap.set('C#', { name: 'C#', category: 'programming', confidence: 'medium' });
              }
              break;
            case '.html':
            case '.htm':
              if (!languagesMap.has('HTML')) {
                languagesMap.set('HTML', { name: 'HTML', category: 'markup', confidence: 'medium' });
              }
              break;
            case '.css':
            case '.scss':
            case '.sass':
            case '.less':
              if (!languagesMap.has('CSS')) {
                languagesMap.set('CSS', { name: 'CSS', category: 'stylesheet', confidence: 'medium' });
              }
              break;
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export const intelligenceService = new IntelligenceService();
