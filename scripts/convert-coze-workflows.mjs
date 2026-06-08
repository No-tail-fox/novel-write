#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.inputs.length === 0) {
  console.error('Usage: node scripts/convert-coze-workflows.mjs [--out draft-templates.json] [--install-db data.db] <workflow-file-or-dir-or-glob> [...]');
  process.exit(1);
}

const tsxLoader = resolve('node_modules/tsx/dist/loader.mjs');
await import(pathToFileURL(tsxLoader).href);
const { convertManyCozeWorkflowsToDraftTemplates } = await import('../src/shared/coze-workflow-converter.ts');
const { FileDatabase } = await import('../src/shared/storage.ts');

const inputFiles = await expandInputFiles(options.inputs);
const templates = [];
const diagnostics = [];
const failures = [];
const sources = [];

for (const inputPath of inputFiles) {
  const source = await readFile(inputPath, 'utf8');
  const results = convertManyCozeWorkflowsToDraftTemplates(source, { namePrefix: sourceName(inputPath) });
  if (!results.length) {
    const failure = { inputPath, index: 0, error: 'No Coze workflow source found in file.', diagnostics: [] };
    failures.push(failure);
    sources.push({ inputPath, status: 'failed', error: failure.error });
    continue;
  }

  results.forEach((result, index) => {
    if (!result.ok) {
      failures.push({ inputPath, index, error: result.error, diagnostics: result.diagnostics });
      sources.push({ inputPath, index, status: 'failed', error: result.error });
      return;
    }
    templates.push(result.template);
    diagnostics.push({
      inputPath,
      workflowId: result.workflowId,
      templateId: result.template.id,
      diagnostics: result.diagnostics,
    });
    sources.push({
      inputPath,
      index,
      status: 'converted',
      workflowId: result.workflowId,
      templateId: result.template.id,
      templateName: result.template.name,
    });
  });
}

let installed = [];
if (options.installDbPath && templates.length) {
  const db = await FileDatabase.open(resolve(options.installDbPath));
  try {
    for (const template of templates) {
      const saved = await db.upsertDraftTemplate(template);
      installed.push(saved.id);
    }
  } finally {
    await db.close();
  }
}

await writeFile(resolve(options.outputPath), JSON.stringify({
  generatedAt: new Date().toISOString(),
  inputCount: inputFiles.length,
  installedDbPath: options.installDbPath ? resolve(options.installDbPath) : null,
  installed,
  sources,
  templates,
  diagnostics,
  failures,
}, null, 2), 'utf8');

const outputMessage = `Converted ${templates.length} Coze workflow(s). Output: ${options.outputPath}`;
const installMessage = options.installDbPath ? ` Installed ${installed.length} template(s) into ${options.installDbPath}.` : '';
if (failures.length) {
  console.error(`Converted ${templates.length} Coze workflow(s), ${failures.length} failed. Output: ${options.outputPath}${installMessage}`);
  process.exitCode = 1;
} else {
  console.log(`${outputMessage}${installMessage}`);
}

function parseArgs(rawArgs) {
  const inputs = [...rawArgs];
  let outputPath = 'coze-draft-templates.json';
  let installDbPath = '';
  for (let index = 0; index < inputs.length; index += 1) {
    const arg = inputs[index];
    if (arg === '--out') {
      outputPath = inputs[index + 1] || outputPath;
      inputs.splice(index, 2);
      index -= 1;
    } else if (arg === '--install-db') {
      installDbPath = inputs[index + 1] || '';
      inputs.splice(index, 2);
      index -= 1;
    }
  }
  if (!installDbPath) {
    const installIndex = inputs.findIndex((arg) => arg.startsWith('--install-db='));
    if (installIndex >= 0) {
      installDbPath = inputs[installIndex].slice('--install-db='.length);
      inputs.splice(installIndex, 1);
    }
  }
  if (inputs.length > 1 && extname(inputs[0]).toLowerCase() === '.json') {
    outputPath = inputs.shift();
  }
  return { inputs, outputPath, installDbPath };
}

async function expandInputFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const expanded = hasGlob(input) ? await expandGlob(input) : [resolve(input)];
    for (const candidate of expanded) {
      await collectInputFiles(candidate, files);
    }
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

async function collectInputFiles(inputPath, files) {
  const entry = await stat(inputPath);
  if (entry.isDirectory()) {
    const children = await readdir(inputPath);
    for (const child of children) {
      await collectInputFiles(join(inputPath, child), files);
    }
    return;
  }
  if (entry.isFile() && isWorkflowSourceFile(inputPath)) {
    files.push(inputPath);
  }
}

async function expandGlob(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  const wildcardIndex = normalized.search(/[*?]/);
  const slashBeforeWildcard = normalized.lastIndexOf('/', wildcardIndex);
  const basePattern = slashBeforeWildcard >= 0 ? normalized.slice(0, slashBeforeWildcard) : '.';
  const baseDir = resolve(basePattern || '.');
  const regex = globRegex(resolve(normalized).replaceAll('\\', '/'));
  const files = [];
  await collectGlobFiles(baseDir, regex, files);
  return files;
}

async function collectGlobFiles(directory, regex, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectGlobFiles(fullPath, regex, files);
    } else if (entry.isFile() && regex.test(fullPath.replaceAll('\\', '/'))) {
      files.push(fullPath);
    }
  }
}

function globRegex(pattern) {
  let output = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      output += '.*';
      index += 1;
    } else if (char === '*') {
      output += '[^/]*';
    } else if (char === '?') {
      output += '[^/]';
    } else {
      output += escapeRegex(char);
    }
  }
  return new RegExp(`${output}$`, 'i');
}

function hasGlob(input) {
  return /[*?]/.test(input);
}

function isWorkflowSourceFile(inputPath) {
  return ['.json', '.txt'].includes(extname(inputPath).toLowerCase());
}

function sourceName(inputPath) {
  return basename(inputPath, extname(inputPath)).replace(/^\s+|\s+$/g, '');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
