import simpleGit from 'simple-git';

export async function getCommits({ count = 50 } = {}) {
  const git = simpleGit(process.cwd());
  const log = await git.log({ '--max-count': String(count) });
  return log.all.map((c) => ({
    hash: c.hash, shortHash: c.hash.slice(0, 7),
    message: c.message.trim(), author: c.author_name, date: new Date(c.date),
  }));
}
