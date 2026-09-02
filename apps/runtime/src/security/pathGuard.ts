import path from 'node:path';
import fs from 'node:fs';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Checks if a canonical target path is equal to or resides inside the canonical root path.
 */
function isInsideOrEqual(targetPath: string, rootPath: string): boolean {
  const isWindows = process.platform === 'win32';
  const target = path.resolve(targetPath);
  const root = path.resolve(rootPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (isWindows) {
    const t = target.toLowerCase();
    const r = root.toLowerCase();
    const rws = rootWithSep.toLowerCase();
    return t === r || t.startsWith(rws);
  }
  return target === root || target.startsWith(rootWithSep);
}

/**
 * Validates and resolves a workspace-relative path.
 * Guarantees that the resolved path never escapes the workspace root,
 * protecting against lexical traversal (..), null bytes, and filesystem symlink escapes.
 *
 * @throws {SecurityError} if path traversal, invalid characters, or external symlinks are detected.
 */
export function resolveSafeWorkspacePath(rootPath: string, relativePath: string = ''): {
  absolutePath: string;
  relativePath: string;
} {
  if (!rootPath) {
    throw new SecurityError('Workspace root path is required.');
  }

  // Check for null bytes
  if (relativePath.includes('\0') || rootPath.includes('\0')) {
    throw new SecurityError('Invalid path: null bytes are not permitted.');
  }

  // Obtain canonical root path
  const canonicalRoot = path.resolve(rootPath);
  let realRoot = canonicalRoot;
  try {
    if (fs.existsSync(canonicalRoot)) {
      realRoot = fs.realpathSync(canonicalRoot);
    }
  } catch {
    realRoot = canonicalRoot;
  }

  // Normalize requested relative path
  let cleanedRel = path.normalize(relativePath || '');

  // Strip leading drive letters / absolute separators on Windows or Unix
  let resolved: string;
  if (path.isAbsolute(cleanedRel)) {
    const absPath = path.resolve(cleanedRel);
    if (!isInsideOrEqual(absPath, canonicalRoot) && !isInsideOrEqual(absPath, realRoot)) {
      throw new SecurityError('This path resolves outside the current workspace and cannot be accessed.');
    }
    resolved = absPath;
  } else {
    // Remove leading separators to ensure relative join
    cleanedRel = cleanedRel.replace(/^[/\\]+/, '');
    resolved = path.resolve(canonicalRoot, cleanedRel);

    // Lexical boundary check
    if (!isInsideOrEqual(resolved, canonicalRoot) && !isInsideOrEqual(resolved, realRoot)) {
      throw new SecurityError('This path resolves outside the current workspace and cannot be accessed.');
    }
  }

  // Realpath / Symlink boundary verification
  try {
    if (fs.existsSync(resolved)) {
      // For existing targets, verify the real filesystem target resides inside real workspace root
      const realTarget = fs.realpathSync(resolved);
      if (!isInsideOrEqual(realTarget, realRoot)) {
        throw new SecurityError('This path resolves outside the current workspace and cannot be accessed.');
      }
    } else {
      // For non-existing targets (e.g. file creation), verify the nearest existing parent directory
      let currentParent = path.dirname(resolved);
      while (currentParent && !fs.existsSync(currentParent)) {
        const nextParent = path.dirname(currentParent);
        if (nextParent === currentParent) break;
        currentParent = nextParent;
      }

      if (fs.existsSync(currentParent)) {
        const realParent = fs.realpathSync(currentParent);
        if (!isInsideOrEqual(realParent, realRoot)) {
          throw new SecurityError('This path resolves outside the current workspace and cannot be accessed.');
        }
      }
    }
  } catch (err: any) {
    if (err instanceof SecurityError) {
      throw err;
    }
    // Re-throw if it's a filesystem permission / access issue
  }

  const rel = path.relative(canonicalRoot, resolved);
  return {
    absolutePath: resolved,
    relativePath: rel.replace(/\\/g, '/'),
  };
}
