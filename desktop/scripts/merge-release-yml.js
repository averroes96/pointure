#!/usr/bin/env node
/**
 * merge-release-yml.js
 * Combines x64 and ia32 latest.yml manifests into a single multi-architecture
 * latest.yml for electron-updater so both 64-bit and 32-bit Windows clients
 * download the correct installer without collisions.
 */

const fs = require('fs');
const path = require('path');

function parseManifest(content) {
  try {
    const yaml = require('js-yaml');
    const data = yaml.load(content);
    const files = [];
    if (Array.isArray(data.files)) {
      files.push(...data.files);
    } else if (data.path) {
      files.push({ url: data.path, sha512: data.sha512, size: data.size });
    }
    return {
      version: data.version,
      releaseDate: data.releaseDate,
      path: data.path,
      sha512: data.sha512,
      files,
    };
  } catch (e) {
    // Fallback: zero-dependency regex parser
    const versionMatch = content.match(/^version:\s*(.+)$/m);
    const releaseDateMatch = content.match(/^releaseDate:\s*(.+)$/m);
    const pathMatch = content.match(/^path:\s*(.+)$/m);
    const shaMatch = content.match(/^sha512:\s*(.+)$/m);

    const files = [];
    const filesRegex = /-\s*url:\s*(.+)\r?\n\s+sha512:\s*(.+)\r?\n\s+size:\s*(\d+)/g;
    let match;
    while ((match = filesRegex.exec(content)) !== null) {
      files.push({
        url: match[1].trim(),
        sha512: match[2].trim(),
        size: parseInt(match[3].trim(), 10),
      });
    }

    return {
      version: versionMatch ? versionMatch[1].trim() : '',
      releaseDate: releaseDateMatch ? releaseDateMatch[1].trim() : '',
      path: pathMatch ? pathMatch[1].trim() : '',
      sha512: shaMatch ? shaMatch[1].trim() : '',
      files,
    };
  }
}

function mergeYml(x64YmlPath, ia32YmlPath, outputPath) {
  if (!fs.existsSync(x64YmlPath)) {
    throw new Error(`x64 manifest not found: ${x64YmlPath}`);
  }
  if (!fs.existsSync(ia32YmlPath)) {
    throw new Error(`ia32 manifest not found: ${ia32YmlPath}`);
  }

  const x64 = parseManifest(fs.readFileSync(x64YmlPath, 'utf8'));
  const ia32 = parseManifest(fs.readFileSync(ia32YmlPath, 'utf8'));

  const allFiles = [...x64.files, ...ia32.files];
  const uniqueFiles = [];
  const seenUrls = new Set();
  for (const f of allFiles) {
    if (!seenUrls.has(f.url)) {
      seenUrls.add(f.url);
      uniqueFiles.push(f);
    }
  }

  const version = x64.version || ia32.version;
  const primaryPath = x64.path || uniqueFiles.find((f) => f.url.includes('x64'))?.url || uniqueFiles[0]?.url;
  const primarySha = x64.sha512 || uniqueFiles.find((f) => f.url === primaryPath)?.sha512 || uniqueFiles[0]?.sha512;
  const releaseDate = x64.releaseDate || ia32.releaseDate || new Date().toISOString();

  let outYaml = `version: ${version}\nfiles:\n`;
  for (const f of uniqueFiles) {
    outYaml += `  - url: ${f.url}\n    sha512: ${f.sha512}\n    size: ${f.size}\n`;
  }
  outYaml += `path: ${primaryPath}\n`;
  outYaml += `sha512: ${primarySha}\n`;
  outYaml += `releaseDate: '${releaseDate.replace(/^'|'$/g, '')}'\n`;

  fs.writeFileSync(outputPath, outYaml, 'utf8');
  console.log(`[merge-release-yml] Successfully merged manifests into ${outputPath}`);
  console.log(`[merge-release-yml] Files included:`);
  uniqueFiles.forEach((f) => console.log(`  • ${f.url} (${f.size} bytes)`));
}

if (require.main === module) {
  const [,, x64Path, ia32Path, outPath] = process.argv;
  if (!x64Path || !ia32Path || !outPath) {
    console.error('Usage: node merge-release-yml.js <path-to-x64.yml> <path-to-ia32.yml> <path-to-output.yml>');
    process.exit(1);
  }
  mergeYml(x64Path, ia32Path, outPath);
}

module.exports = { mergeYml };
