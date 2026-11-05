#!/usr/bin/env node
/**
 * desktop/scripts/release-tagger.js
 *
 * Automated Semantic Versioning and Changelog Generator.
 *
 * Automatically determines whether the next release should be:
 * - MAJOR: Breaking changes (e.g. `feat!:`, `BREAKING CHANGE:`)
 * - MINOR: New features (e.g. `feat:`, `feat(...):`)
 * - PATCH: Fixes, perf, refactor, and maintenance (`fix:`, `refactor:`, etc.)
 *
 * Generates formatted Markdown changelogs categorized by change type,
 * creates annotated git tags, and communicates with GitHub Actions.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function execCmd(cmd, options = {}) {
  try {
    return cp.execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (err) {
    if (options.allowFailure) return '';
    throw err;
  }
}

/**
 * Parses a semver tag like "v1.4.12" or "1.4.12" into numbers.
 */
function parseSemVer(tag) {
  if (!tag) return null;
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Finds the latest valid semver tag in the repository.
 */
function getLatestSemverTag(exec = execCmd) {
  // Try git describe first
  try {
    const described = exec("git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*'", { allowFailure: true });
    if (described && parseSemVer(described)) {
      return described;
    }
  } catch (_) {}

  // Fallback: list all tags sorted by version descending
  try {
    const rawTags = exec("git tag -l 'v*.*.*' --sort=-v:refname", { allowFailure: true });
    const tags = rawTags.split('\n').map(t => t.trim()).filter(Boolean);
    for (const t of tags) {
      if (parseSemVer(t)) {
        return t;
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Collects commits between previousTag and HEAD.
 */
function getCommitsSince(previousTag, exec = execCmd) {
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
  // Use unique delimiter to handle multiline commit messages and bodies safely
  const format = '__COMMIT_START__%n%H%n%s%n%an%n%cI%n%b%n__COMMIT_END__';
  const raw = exec(`git log ${range} --pretty=format:"${format}"`, { allowFailure: true });
  if (!raw) return [];

  const commits = [];
  const rawBlocks = raw.split('__COMMIT_START__\n').filter(Boolean);

  for (const block of rawBlocks) {
    const endIndex = block.indexOf('__COMMIT_END__');
    const content = endIndex !== -1 ? block.slice(0, endIndex).trim() : block.trim();
    if (!content) continue;

    const lines = content.split('\n');
    const hash = lines[0] || '';
    const subject = lines[1] || '';
    const author = lines[2] || '';
    const date = lines[3] || '';
    const body = lines.slice(4).join('\n').trim();

    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      subject,
      author,
      date,
      body,
    });
  }

  return commits;
}

/**
 * Parses conventional commit metadata from subject and body.
 */
function parseConventionalCommit(commit) {
  const subject = commit.subject.trim();
  const body = commit.body || '';

  // Check for breaking changes
  const isBreakingMarkerInBody = /BREAKING[ -]CHANGE:\s*(.+)/i.test(body);
  const isBreakingMarkerInSubject = /BREAKING[ -]CHANGE:\s*(.+)/i.test(subject);

  const match = subject.match(/^([a-z]+)(\([^\)]+\))?(!)?:\s*(.+)$/i);
  if (match) {
    const type = match[1].toLowerCase();
    const scope = match[2] ? match[2].replace(/[()]/g, '').trim() : null;
    const hasExclamation = Boolean(match[3]);
    const description = match[4].trim();
    const isBreaking = hasExclamation || isBreakingMarkerInBody || isBreakingMarkerInSubject;

    return {
      type,
      scope,
      description,
      isBreaking,
      rawSubject: subject,
    };
  }

  return {
    type: 'other',
    scope: null,
    description: subject,
    isBreaking: isBreakingMarkerInBody || isBreakingMarkerInSubject,
    rawSubject: subject,
  };
}

/**
 * Determines whether the bump should be 'major', 'minor', or 'patch'.
 */
function determineBump(commits) {
  if (!commits || commits.length === 0) return null;

  let hasMinor = false;
  let hasPatch = false;

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit);

    if (parsed.isBreaking) {
      return 'major'; // Breaking change always takes highest priority
    }

    if (parsed.type === 'feat') {
      hasMinor = true;
    } else {
      hasPatch = true;
    }
  }

  if (hasMinor) return 'minor';
  if (hasPatch) return 'patch';
  return 'patch';
}

/**
 * Increments semver given a current tag and a bump level.
 */
function bumpVersion(currentTag, bump) {
  const current = parseSemVer(currentTag) || { major: 0, minor: 0, patch: 0 };

  if (bump === 'major') {
    return {
      major: current.major + 1,
      minor: 0,
      patch: 0,
      version: `${current.major + 1}.0.0`,
      tag: `v${current.major + 1}.0.0`,
    };
  }

  if (bump === 'minor') {
    return {
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
      version: `${current.major}.${current.minor + 1}.0`,
      tag: `v${current.major}.${current.minor + 1}.0`,
    };
  }

  // patch (default)
  return {
    major: current.major,
    minor: current.minor,
    patch: current.patch + 1,
    version: `${current.major}.${current.minor}.${current.patch + 1}`,
    tag: `v${current.major}.${current.minor}.${current.patch + 1}`,
  };
}

/**
 * Generates GitHub-flavored markdown changelog.
 */
function generateChangelog({ version, previousTag, bump, commits, repoUrl = '' }) {
  const tag = `v${version}`;
  const humanBump = bump ? bump.toUpperCase() : 'RELEASE';

  const groups = {
    breaking: { title: '⚠️ Breaking Changes', items: [] },
    feat: { title: '🚀 Features & Enhancements', items: [] },
    fix: { title: '🐛 Bug Fixes', items: [] },
    perf: { title: '⚡ Performance Improvements', items: [] },
    refactor: { title: '🔄 Refactoring & Core Logic', items: [] },
    security: { title: '🛡️ Security & Access Control', items: [] },
    test: { title: '🧪 Tests & Quality Assurance', items: [] },
    docs: { title: '📝 Documentation', items: [] },
    other: { title: '🛠️ Maintenance & Chores', items: [] },
  };

  for (const c of commits) {
    const parsed = parseConventionalCommit(c);
    const scopePrefix = parsed.scope ? `**${parsed.scope}:** ` : '';
    const hashLink = repoUrl
      ? `[\`${c.shortHash}\`](${repoUrl}/commit/${c.hash})`
      : `\`${c.shortHash}\``;
    const line = `- ${scopePrefix}${parsed.description} (${hashLink})`;

    if (parsed.isBreaking) {
      groups.breaking.items.push(line);
      continue;
    }

    if (parsed.type === 'feat') {
      groups.feat.items.push(line);
    } else if (parsed.type === 'fix') {
      groups.fix.items.push(line);
    } else if (parsed.type === 'perf') {
      groups.perf.items.push(line);
    } else if (parsed.type === 'refactor') {
      groups.refactor.items.push(line);
    } else if (parsed.type === 'security' || parsed.type === 'rbac') {
      groups.security.items.push(line);
    } else if (parsed.type === 'test') {
      groups.test.items.push(line);
    } else if (parsed.type === 'docs') {
      groups.docs.items.push(line);
    } else {
      groups.other.items.push(line);
    }
  }

  let changelog = `## ShoeDZ Desktop ${tag}\n\n`;
  changelog += `*Release Type:* **${humanBump}** | *Previous Tag:* \`${previousTag || 'none'}\` | *Total Commits:* ${commits.length}\n\n`;

  for (const group of Object.values(groups)) {
    if (group.items.length > 0) {
      changelog += `### ${group.title}\n\n`;
      changelog += group.items.join('\n') + '\n\n';
    }
  }

  if (repoUrl && previousTag) {
    changelog += `**Full Changelog:** ${repoUrl}/compare/${previousTag}...${tag}\n`;
  }

  return changelog.trim();
}

/**
 * Appends key/value pairs to GitHub Actions output environment file.
 */
function appendGitHubOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;

  if (typeof value === 'string' && value.includes('\n')) {
    const delimiter = `DELIM_${Date.now()}`;
    const formatted = `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    fs.appendFileSync(outputFile, formatted, 'utf8');
  } else {
    fs.appendFileSync(outputFile, `${key}=${value}\n`, 'utf8');
  }
}

/**
 * Main execution routine.
 */
function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const shouldCreateTag = args.includes('--create-tag');
  const isCI = args.includes('--ci') || Boolean(process.env.GITHUB_ACTIONS);

  const gitRef = process.env.GITHUB_REF || '';
  const gitRefName = process.env.GITHUB_REF_NAME || '';
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repository = process.env.GITHUB_REPOSITORY || '';
  const repoUrl = repository ? `${serverUrl}/${repository}` : '';

  console.log(`[release-tagger] Starting semantic version inspection...`);
  console.log(`[release-tagger] GITHUB_REF: "${gitRef}", GITHUB_REF_NAME: "${gitRefName}"`);

  // Case 1: Workflow triggered directly by a tag push (e.g. refs/tags/v1.5.0)
  if (gitRef.startsWith('refs/tags/v') || gitRefName.match(/^v\d+\.\d+\.\d+$/)) {
    const tag = gitRefName || gitRef.replace('refs/tags/', '');
    const version = tag.replace(/^v/, '');
    console.log(`[release-tagger] Triggered by explicit tag push: ${tag}`);

    // Find previous tag before this one
    let previousTag = null;
    try {
      const allTags = execCmd("git tag -l 'v*.*.*' --sort=-v:refname")
        .split('\n')
        .map(t => t.trim())
        .filter(t => Boolean(t) && t !== tag);
      previousTag = allTags[0] || null;
    } catch (_) {}

    const commits = getCommitsSince(previousTag);
    const changelog = generateChangelog({
      version,
      previousTag,
      bump: 'manual',
      commits,
      repoUrl,
    });

    console.log(`[release-tagger] Changelog generated for tag ${tag} (${commits.length} commits)`);

    if (isCI) {
      appendGitHubOutput('should_release', 'true');
      appendGitHubOutput('tag', tag);
      appendGitHubOutput('version', version);
      appendGitHubOutput('bump', 'manual');
      appendGitHubOutput('changelog', changelog);
    }
    return;
  }

  // Case 2: Workflow triggered by branch push (e.g. feature/windows-desktop-installer, main)
  const previousTag = getLatestSemverTag();
  console.log(`[release-tagger] Previous semver tag detected: ${previousTag || '(none)'}`);

  const commits = getCommitsSince(previousTag);
  console.log(`[release-tagger] Found ${commits.length} commits since ${previousTag || 'initial commit'}`);

  if (commits.length === 0) {
    console.log(`[release-tagger] No new commits since ${previousTag}. Skipping release and tagging.`);
    if (isCI) {
      appendGitHubOutput('should_release', 'false');
      appendGitHubOutput('tag', previousTag || '');
      appendGitHubOutput('version', previousTag ? previousTag.replace(/^v/, '') : '');
      appendGitHubOutput('bump', 'none');
      appendGitHubOutput('changelog', '');
    }
    return;
  }

  const bump = determineBump(commits);
  const next = bumpVersion(previousTag, bump);

  console.log(`[release-tagger] Evaluated bump level: ${bump.toUpperCase()}`);
  console.log(`[release-tagger] Next release version: ${next.version} (Tag: ${next.tag})`);

  const changelog = generateChangelog({
    version: next.version,
    previousTag,
    bump,
    commits,
    repoUrl,
  });

  console.log('\n--- GENERATED CHANGELOG ---\n' + changelog + '\n---------------------------\n');

  // Save changelog file for build steps
  try {
    fs.writeFileSync('RELEASE_CHANGELOG.md', changelog, 'utf8');
  } catch (_) {}

  // Tag creation
  if (shouldCreateTag && !isDryRun) {
    console.log(`[release-tagger] Creating annotated git tag: ${next.tag}`);
    try {
      execCmd(`git config user.name "github-actions[bot]"`);
      execCmd(`git config user.email "github-actions[bot]@users.noreply.github.com"`);

      // Write changelog to a temp file for tag annotation
      const tempTagMsg = path.join(__dirname, '.tag_msg.txt');
      fs.writeFileSync(tempTagMsg, `Release ${next.tag}\n\n${changelog}`, 'utf8');
      execCmd(`git tag -a "${next.tag}" -F "${tempTagMsg}"`);
      fs.unlinkSync(tempTagMsg);

      console.log(`[release-tagger] Pushing tag ${next.tag} to origin...`);
      execCmd(`git push origin "${next.tag}"`);
      console.log(`[release-tagger] Successfully pushed tag ${next.tag}`);
    } catch (tagErr) {
      console.error(`[release-tagger] Warning: Failed to push tag directly via git: ${tagErr.message}`);
      console.log(`[release-tagger] Note: GitHub Release action will create the tag automatically via GitHub API.`);
    }
  }

  if (isCI) {
    appendGitHubOutput('should_release', 'true');
    appendGitHubOutput('tag', next.tag);
    appendGitHubOutput('version', next.version);
    appendGitHubOutput('bump', bump);
    appendGitHubOutput('changelog', changelog);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseSemVer,
  getLatestSemverTag,
  getCommitsSince,
  parseConventionalCommit,
  determineBump,
  bumpVersion,
  generateChangelog,
};

