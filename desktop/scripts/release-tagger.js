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
 * Parses a semver tag like "v1.4.12", "1.4.12", or "v1.9.0-beta.10".
 * The prerelease field is set only when the tag has a suffix.
 */
function parseSemVer(tag) {
  if (!tag) return null;
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  const parsed = {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
  if (match[4]) parsed.prerelease = match[4];
  return parsed;
}

function compareSemVer(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return String(left.prerelease).localeCompare(String(right.prerelease), undefined, { numeric: true });
}

function isStableReleaseBranch(branchName) {
  return branchName === 'release';
}

/**
 * Highest stable semver in the list. Pre-release tags such as
 * v1.9.0-beta.9 are ignored. Git's version sort would put those first,
 * and git describe returns the closest tag, which can be older than a
 * higher tag that already exists.
 */
function selectHighestSemver(tags, includePrerelease = false) {
  let bestTag = null;
  let bestParsed = null;
  for (const tag of tags) {
    const parsed = parseSemVer(tag);
    if (!parsed) continue;
    if (!includePrerelease && parsed.prerelease) continue;
    if (!bestParsed || compareSemVer(parsed, bestParsed) > 0) {
      bestTag = tag.trim();
      bestParsed = parsed;
    }
  }
  return bestTag;
}

/**
 * Finds the highest stable semver tag reachable from HEAD.
 * Falls back to the highest stable tag in the repo so a new release
 * cannot reuse a version that was already published.
 */
function getLatestSemverTag(exec = execCmd, includePrerelease = false) {
  let rawTags = '';
  try {
    rawTags = exec("git tag -l 'v*.*.*'", { allowFailure: true });
  } catch (_) {}

  const parsedTags = rawTags.split('\n').map(t => t.trim()).filter(t => parseSemVer(t));
  const pool = includePrerelease
    ? parsedTags
    : parsedTags.filter(tag => !parseSemVer(tag).prerelease);
  if (pool.length === 0) return null;

  const ancestors = pool.filter(tag => {
    const marker = exec(
      `git merge-base --is-ancestor "${tag}" HEAD && echo ancestor`,
      { allowFailure: true },
    );
    return String(marker).includes('ancestor');
  });

  return selectHighestSemver(ancestors.length > 0 ? ancestors : pool, includePrerelease);
}

/**
 * Attaches the next free -beta.N suffix to an already bumped stable version.
 */
function nextPrerelease(stableNext, existingTags = []) {
  const escaped = stableNext.version.replace(/\./g, '\\.');
  const pattern = new RegExp(`^v?${escaped}-beta\\.(\\d+)$`);
  let beta = 1;
  for (const tag of existingTags) {
    const match = String(tag).trim().match(pattern);
    if (!match) continue;
    beta = Math.max(beta, parseInt(match[1], 10) + 1);
  }
  const prerelease = `beta.${beta}`;
  const version = `${stableNext.version}-${prerelease}`;
  return {
    major: stableNext.major,
    minor: stableNext.minor,
    patch: stableNext.patch,
    prerelease,
    version,
    tag: `v${version}`,
  };
}

/**
 * Bumps once, then keeps moving the patch up while the tag name is taken.
 */
function resolveNextVersion(currentTag, bump, existingTags = []) {
  const taken = new Set(existingTags);
  let next = bumpVersion(currentTag, bump);
  let guard = 0;
  while (taken.has(next.tag) && guard < 50) {
    next = bumpVersion(next.tag, 'patch');
    guard += 1;
  }
  return next;
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

  // Case 1: Workflow triggered directly by a tag push (v1.5.0 or v1.9.0-beta.1)
  if (gitRef.startsWith('refs/tags/v') || /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(gitRefName)) {
    const tag = gitRefName || gitRef.replace('refs/tags/', '');
    const version = tag.replace(/^v/, '');
    const isPrerelease = Boolean(parseSemVer(tag) && parseSemVer(tag).prerelease);
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
      appendGitHubOutput('is_prerelease', isPrerelease ? 'true' : 'false');
    }
    return;
  }

  // Only the release branch publishes a stable version. Every other branch is a beta.
  const branchName = gitRefName || gitRef.replace('refs/heads/', '') || execCmd('git rev-parse --abbrev-ref HEAD', { allowFailure: true });
  const isPrerelease = !isStableReleaseBranch(branchName);
  const previousStableTag = getLatestSemverTag(execCmd, false);
  const previousTag = isPrerelease
    ? (getLatestSemverTag(execCmd, true) || previousStableTag)
    : previousStableTag;
  console.log(`[release-tagger] Branch "${branchName}" prerelease=${isPrerelease}`);
  console.log(`[release-tagger] Previous tag: ${previousTag || '(none)'} (stable ${previousStableTag || 'none'})`);

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
      appendGitHubOutput('is_prerelease', isPrerelease ? 'true' : 'false');
    }
    return;
  }

  const bump = determineBump(commits);
  let existingTags = [];
  try {
    existingTags = execCmd("git tag -l 'v*.*.*'", { allowFailure: true })
      .split('\n')
      .map(tag => tag.trim())
      .filter(Boolean);
  } catch (_) {}
  const stableNext = resolveNextVersion(previousStableTag, bump, existingTags);
  const next = isPrerelease ? nextPrerelease(stableNext, existingTags) : stableNext;

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
    appendGitHubOutput('is_prerelease', isPrerelease ? 'true' : 'false');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseSemVer,
  isStableReleaseBranch,
  selectHighestSemver,
  getLatestSemverTag,
  nextPrerelease,
  resolveNextVersion,
  getCommitsSince,
  parseConventionalCommit,
  determineBump,
  bumpVersion,
  generateChangelog,
};

