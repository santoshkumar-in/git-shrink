# git-shrink

> Semantic git history compressor — intelligently squashes bloated commit histories by analyzing message similarity, file proximity, directory overlap, and time windows.

```
  git-shrink v1.0.0  — semantic commit history compressor

  ✔ Loaded 47 commits
  ✔ Found 9 squash group(s) — history shrinks 47 → 18 commits (62% reduction)

  Group 1/9 — touch the same file(s): src/auth/middleware.js · committed within 14min
  Suggested message: "feat: implement OAuth2 PKCE flow with refresh token rotation"
  Similarity score:  ████████████████░░░░  80/100
```

---

## The problem

Every long-running codebase has this:

```
abc1234  fix
def5678  fix again
fff0001  wip
aaa9999  temp
bbb1111  ok now it works
ccc2222  actually works now
```

`git rebase -i` helps, but it requires you to manually identify which commits belong together — across dozens or hundreds of entries. That doesn't scale.

`git-shrink` automates the grouping. It scores every pair of commits across four dimensions and suggests squash groups you can approve, edit, or skip — then writes a ready-to-apply rebase script.

---

## Install

```bash
npm install -g git-shrink
```

Requires Node.js ≥ 18.

---

## Usage

### Analyze (interactive)

```bash
git-shrink analyze
```

Analyzes the last 50 commits, scores pairs, and walks you through each suggested group interactively.

### Analyze (auto mode)

```bash
git-shrink analyze --auto --count 100
```

Skips the interactive prompt — auto-approves all groups above the similarity threshold.

### Dry run

```bash
git-shrink analyze --dry-run
```

Shows what would be grouped without writing any files. Safe to run on any repo.

### Commit health stats

```bash
git-shrink stats
```

Prints a health report: noisy commit ratio, oversized commits, hot directories, and an overall history health score.

### Apply a saved plan

```bash
git-shrink apply git-shrink-plan-1706123456789.txt
```

Executes a previously generated rebase plan after a final confirmation prompt.

---

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--count <n>` | `50` | Number of commits to analyze from HEAD |
| `--from <hash>` | — | Start of commit range |
| `--to <hash>` | `HEAD` | End of commit range |
| `--auto` | `false` | Skip interactive prompts |
| `--dry-run` | `false` | Preview only, no files written |
| `--threshold <0-100>` | `60` | Minimum similarity score to form a group |
| `--min-group <n>` | `2` | Minimum commits required to form a group |

---

## How the scoring works

Every pair of commits is scored across four dimensions, then combined into a weighted composite:

| Dimension | Weight | Method |
|-----------|--------|--------|
| Message similarity | 55% | Levenshtein distance on normalized messages — strips conventional commit prefixes (`fix:`, `feat:`) and noise words (`wip`, `temp`, `minor`) before comparing |
| File proximity | 30% | Jaccard similarity of changed file sets — commits touching the same files score high regardless of message wording |
| Directory overlap | 15% | Jaccard similarity of parent directories — weaker structural signal, useful when file names differ but work is in the same area |

Time proximity and branch origin are **intentionally excluded**. They group commits that happen to be close in time or on the same branch, not commits that are semantically related — which is the wrong heuristic for history cleanup.

Pairs scoring above `--threshold` are clustered using union-find. The suggested squash message is the most semantically meaningful message within the group (longest after noise removal).

---

## Config file

Place a `.gitshrinkrc` in your project root (or add a `gitshrink` key to `package.json`):

```json
{
  "threshold": 65,
  "timeWindow": 20,
  "minGroup": 2,
  "count": 75
}
```

---

## Safety

`git-shrink analyze` and `git-shrink stats` are **read-only**. They never touch your git history.

`git-shrink apply` rewrites history via interactive rebase. It will:
- Show a full preview of the rebase plan
- Warn you explicitly that history will be rewritten
- Require a confirmation prompt before executing
- Print `git rebase --abort` instructions if anything goes wrong

**Never run on shared branches** that other developers have pulled without coordinating first.

---

## Example workflow

```bash
# 1. Check your repo health first
git-shrink stats

# 2. Preview what would be grouped (no files written)
git-shrink analyze --dry-run --count 80

# 3. Run interactively and approve/edit/skip groups
git-shrink analyze --count 80

# 4. Review the generated plan
cat git-shrink-plan-*.txt

# 5. Apply it
git-shrink apply git-shrink-plan-*.txt

# 6. Verify
git log --oneline
```

---

## Limitations

- Analyzes up to ~200 commits efficiently (O(n²) pair scoring). For larger ranges, use `--from`/`--to` to target specific ranges.
- Merge commits are included in analysis but rarely grouped (they typically touch many files with distinct messages).
- Rebase rewrites history — coordinate with your team before running on shared branches.

---

## License

MIT © [Santosh Kumar](https://github.com/santoshkumar-in)
