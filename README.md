# Claude Code mods

Three Claude Code mods in one marketplace:

- [context-bar](#context-bar): a context-window bar above the prompt.
- [theme-sync](#theme-sync): applies `theme` changes in
  `~/.claude/settings.json` to running sessions.
- [memory-sync](#memory-sync): keeps every project's auto memory in a private
  git repo, synced across machines.

## context-bar

A band above the prompt: a context-window bar split by category, and how many
tokens each category holds.

```
▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆ 42%  84k / 200k
● system 4k  ● tools 20k  ● memory 200  ● messages 59.8k
```

- Colours are [Gruvbox Material](https://github.com/sainnhe/gruvbox-material)
  dark (medium contrast), one fixed colour per category; the percentage turns
  yellow at 50% and red at 80%.
- Sized to the band's width: as the terminal narrows it drops the token count,
  then the legend's smallest categories, then the legend, then the bar, and
  never wraps.

### Install

At a Claude Code prompt in a terminal:

```
/plugin install context-bar --marketplace kokko-ng/claude-context-bar
```

Answer `y` to add the marketplace, then pick the user scope.

Or in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "kokko-ng-claude-context-bar": {
      "source": { "source": "github", "repo": "kokko-ng/claude-context-bar" }
    }
  },
  "enabledPlugins": { "context-bar@kokko-ng-claude-context-bar": true }
}
```

Mods (function-hook plugins) are an early-access Claude Code feature; this one
is built and tested against Claude Code 2.1.292.

## theme-sync

Claude Code reloads `~/.claude/settings.json` when it changes but keeps the
running session's theme. theme-sync checks the file once a second and, when
its `theme` differs from the session's, sets it as `/config` would, with a
toast. Edit the file from anywhere (a script that flips `light-ansi` and
`dark-ansi` alongside the terminal theme, for instance) and every open
session follows.

```
/plugin install theme-sync --marketplace kokko-ng/claude-context-bar
```

or `"theme-sync@kokko-ng-claude-context-bar": true` under `enabledPlugins`.

## memory-sync

Keeps the auto memory of every project (`~/.claude/projects/<project>/memory/`)
in a git repo, so each machine sees the others' memories.

- The git work tree is `~/.claude/projects` itself, with the git directory at
  `~/.claude/memory-sync.git`; only each project's `memory/` folder is
  tracked, never transcripts. Memories stay ordinary files where Claude Code
  reads and writes them, so nothing about recall or permissions changes.
- Session start pulls (waiting up to 15 s, so the session loads the latest
  memories), every turn that changed a memory commits and pushes, and an idle
  session pulls every ten minutes.
- The first run on a machine imports its memories: it restores what the repo
  has that the machine lacks and commits the rest on top.
- Two machines editing one memory file merge by keeping both sides' lines
  (`merge=union`), so `MEMORY.md` index additions never conflict. Anything
  git cannot merge is left unpushed with a toast saying how to resolve it.

The repo defaults to `kokko-ng/claude-memory`; set `CLAUDE_MEMORY_REPO` to
`owner/name` (GitHub, using your git credentials) or any git URL. Create it
private and empty first:

```bash
gh repo create <owner>/claude-memory --private
/plugin install memory-sync --marketplace kokko-ng/claude-context-bar
```

Mods do not run where `disableAllHooks` is set, and a `settings.local.json`
in `~/.claude` sets it for sessions started in your home folder.

## Development

Each mod is its own plugin under `plugins/`:

```bash
claude plugin validate plugins/context-bar
claude plugin test plugins/context-bar
claude plugin validate plugins/theme-sync
claude plugin test plugins/theme-sync
claude plugin validate plugins/memory-sync
claude plugin test plugins/memory-sync
```
