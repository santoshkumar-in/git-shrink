import simpleGit from 'simple-git';
import path from 'path';

export async function getCommits({ count = 50, from, to, branch } = {}) {
  const git = simpleGit(process.cwd());
  const isRepo = await git.checkIsRepo();
  if (!isRepo) throw new Error('Not a git repository.');
  const log = await git.log({ '--max-count': from ? undefined : String(count) });
  const commits = await Promise.all(
    log.all.map(async (c) => {
      let files = [];
      try {
        const diff = await git.diffSummary([`${c.hash}^`, c.hash]);
        files = diff.files.map((f) => f.file);
      } catch {}
      return {
        hash: c.hash, shortHash: c.hash.slice(0, 7),
        message: c.message.trim(), author: c.author_name, date: new Date(c.date),
        files,
        dirs: [...new Set(files.map((f) => path.dirname(f)))],
        fileExts: [...new Set(files.map((f) => path.extname(f)).filter(Boolean))],
      };
    })
  );
  return commits;
}

export async function getCurrentBranch() {
  const git = simpleGit(process.cwd()); 
  const summary = await git.branchLocal();
  return summary.current;
}

export async function generateRebaseScript(groups, outputPath) {
  const { writeFileSync } = await import('fs');
  const lines = [];
  for (const group of groups) {
    if (group.commits.length === 1) {
      lines.push(`pick ${group.commits[0].shortHash} ${group.commits[0].message}`);
    } else {
      const [head, ...rest] = group.commits;
      lines.push(`pick ${head.shortHash} ${group.squashedMessage || head.message}`);
      for (const c of rest) lines.push(`squash ${c.shortHash} ${c.message}`);
    }
    lines.push('');
  }
  writeFileSync(outputPath, lines.join('\n'), 'utf8');
  return outputPath;
}
