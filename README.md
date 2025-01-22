# git-shrink

Squashes bloated git histories by grouping semantically related commits.

## Install

```bash
npm install -g git-shrink
```

## Usage

```bash
git-shrink analyze
git-shrink analyze --auto
git-shrink stats
```

## Commands

- `analyze` — scores commit pairs, suggests groups, writes rebase plan
- `stats` — health report: noisy ratio, oversized commits, hot dirs
- `apply <file>` — applies a saved rebase plan with confirmation prompt

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--count <n>` | `50` | Commits to analyze |
| `--auto` | false | Skip prompts |
| `--dry-run` | false | Preview only |
| `--threshold <0-100>` | `60` | Min score to group |
