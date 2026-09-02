import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { intelligenceService } from '../src/services/intelligenceService.js';
import { Workspace } from '@minfy/shared';

describe('Project Intelligence Ecosystem Detection', () => {
  const nodeProjectDir = path.join(os.tmpdir(), `minfy-node-test-${Date.now()}`);
  const pythonProjectDir = path.join(os.tmpdir(), `minfy-py-test-${Date.now()}`);
  const javaProjectDir = path.join(os.tmpdir(), `minfy-java-test-${Date.now()}`);
  const infraProjectDir = path.join(os.tmpdir(), `minfy-infra-test-${Date.now()}`);

  before(async () => {
    // 1. Node / TypeScript / Next.js / AWS CDK Project
    await fs.mkdir(nodeProjectDir, { recursive: true });
    await fs.writeFile(
      path.join(nodeProjectDir, 'package.json'),
      JSON.stringify({
        name: 'my-next-app',
        dependencies: { next: '^14.0.0', react: '^18.2.0', 'aws-cdk-lib': '^2.100.0' },
        devDependencies: { typescript: '^5.0.0', vite: '^5.0.0' },
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(nodeProjectDir, 'package-lock.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(nodeProjectDir, 'tsconfig.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(nodeProjectDir, 'README.md'), '# Next App\n', 'utf-8');

    // 2. Python / FastAPI / Poetry Project
    await fs.mkdir(pythonProjectDir, { recursive: true });
    await fs.writeFile(
      path.join(pythonProjectDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "fastapi-service"\n[tool.poetry.dependencies]\nfastapi = "^0.100.0"\n',
      'utf-8'
    );
    await fs.writeFile(path.join(pythonProjectDir, 'poetry.lock'), '', 'utf-8');

    // 3. Java Maven / Spring Boot Project
    await fs.mkdir(javaProjectDir, { recursive: true });
    await fs.writeFile(
      path.join(javaProjectDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
      'utf-8'
    );

    // 4. Infrastructure & CI/CD Project
    await fs.mkdir(infraProjectDir, { recursive: true });
    await fs.writeFile(path.join(infraProjectDir, 'main.tf'), 'provider "aws" {}\n', 'utf-8');
    await fs.writeFile(path.join(infraProjectDir, 'Dockerfile'), 'FROM node:20\n', 'utf-8');
    await fs.writeFile(path.join(infraProjectDir, 'docker-compose.yml'), 'version: "3"\n', 'utf-8');
    await fs.mkdir(path.join(infraProjectDir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(infraProjectDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n', 'utf-8');
  });

  after(async () => {
    await fs.rm(nodeProjectDir, { recursive: true, force: true });
    await fs.rm(pythonProjectDir, { recursive: true, force: true });
    await fs.rm(javaProjectDir, { recursive: true, force: true });
    await fs.rm(infraProjectDir, { recursive: true, force: true });
  });

  test('detects TypeScript, Next.js, React, npm, Vite, and AWS CDK in Node fixture', async () => {
    const ws: Workspace = {
      id: 'test-node-ws',
      name: 'my-next-app',
      rootPath: nodeProjectDir,
      openedAt: new Date().toISOString(),
    };

    const res = await intelligenceService.analyzeWorkspace(ws, true);
    assert.strictEqual(res.projectName, 'my-next-app');

    // Languages
    const langNames = res.project.detectedLanguages.map((l) => l.name);
    assert.ok(langNames.includes('TypeScript'), 'Should detect TypeScript');
    assert.ok(langNames.includes('JavaScript'), 'Should detect JavaScript');

    // Frameworks
    const fwNames = res.project.frameworks.map((f) => f.name);
    assert.ok(fwNames.includes('Next.js'), 'Should detect Next.js');
    assert.ok(fwNames.includes('React'), 'Should detect React');
    assert.ok(fwNames.includes('Vite'), 'Should detect Vite');

    // Package Manager
    assert.strictEqual(res.project.packageManagers[0]?.name, 'npm');
    assert.strictEqual(res.project.packageManagers[0]?.lockfile, 'package-lock.json');

    // Infrastructure
    assert.ok(res.project.infrastructure.includes('AWS CDK'), 'Should detect AWS CDK');

    // Important files
    assert.ok(res.project.importantFiles.includes('package.json'));
    assert.ok(res.project.importantFiles.includes('tsconfig.json'));
    assert.ok(res.project.importantFiles.includes('README.md'));
  });

  test('detects Python, Poetry, and FastAPI in Python fixture', async () => {
    const ws: Workspace = {
      id: 'test-py-ws',
      name: 'fastapi-service',
      rootPath: pythonProjectDir,
      openedAt: new Date().toISOString(),
    };

    const res = await intelligenceService.analyzeWorkspace(ws, true);
    const langNames = res.project.detectedLanguages.map((l) => l.name);
    assert.ok(langNames.includes('Python'), 'Should detect Python');

    const fwNames = res.project.frameworks.map((f) => f.name);
    assert.ok(fwNames.includes('FastAPI'), 'Should detect FastAPI');

    assert.strictEqual(res.project.packageManagers[0]?.name, 'poetry');
  });

  test('detects Java, Maven, and Spring Boot in Java fixture', async () => {
    const ws: Workspace = {
      id: 'test-java-ws',
      name: 'spring-service',
      rootPath: javaProjectDir,
      openedAt: new Date().toISOString(),
    };

    const res = await intelligenceService.analyzeWorkspace(ws, true);
    const langNames = res.project.detectedLanguages.map((l) => l.name);
    assert.ok(langNames.includes('Java'), 'Should detect Java');

    const fwNames = res.project.frameworks.map((f) => f.name);
    assert.ok(fwNames.includes('Spring Boot'), 'Should detect Spring Boot');

    assert.strictEqual(res.project.packageManagers[0]?.name, 'maven');
  });

  test('detects Terraform, Docker, and GitHub Actions in Infrastructure fixture', async () => {
    const ws: Workspace = {
      id: 'test-infra-ws',
      name: 'infra-repo',
      rootPath: infraProjectDir,
      openedAt: new Date().toISOString(),
    };

    const res = await intelligenceService.analyzeWorkspace(ws, true);
    assert.ok(res.project.infrastructure.includes('Terraform'), 'Should detect Terraform');
    assert.ok(res.project.infrastructure.includes('Docker'), 'Should detect Docker');
    assert.ok(res.project.ciCd.includes('GitHub Actions'), 'Should detect GitHub Actions');
  });
});
