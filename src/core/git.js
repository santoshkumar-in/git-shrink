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
        message: c.message.trim(), author: c.author_name, date: new Date(c.date), files,
      };
    })
  );
  return commits;
}
