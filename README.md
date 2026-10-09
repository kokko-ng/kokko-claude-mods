# kokko-claude-mods

Two Claude Code mods in one marketplace:

- [context-bar](#context-bar): a context-window bar above the prompt.
- [memory-sync](#memory-sync): keeps every project's auto memory in a private
  git repo, synced across machines.

## context-bar

A band above the prompt: a context-window bar split by category, and how many
tokens each category holds.

```
▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆ 42%  84k / 200k  effort high
● system 4k  ● tools 20k  ● memory 200  ● messages 59.8k
```

- Colours are [Gruvbox Material](https://github.com/sainnhe/gruvbox-material)
  (medium contrast), one fixed colour per category; the percentage turns
  yellow at 50% and red at 80%. The light palette is used while the Claude
  Code theme is a `light*` one, dark otherwise, and the band switches as soon
  as the theme changes (`/config`).
- The thinking effort of the conversation's latest request (`/effort`, the
  settings' `effortLevel`, or the model's default) follows the token count.
- Sized to the band's width: as the terminal narrows it drops the effort, then the token count,
  then the legend's smallest categories, then the legend, then the bar, and
  never wraps.

### Install

At a Claude Code prompt in a terminal:

```
/plugin install context-bar --marketplace kokko-ng/kokko-claude-mods
```

Answer `y` to add the marketplace, then pick the user scope.

Or in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "kokko-claude-mods": {
      "source": { "source": "github", "repo": "kokko-ng/kokko-claude-mods" }
    }
  },
  "enabledPlugins": { "context-bar@kokko-claude-mods": true }
}
```

Mods (function-hook plugins) are an early-access Claude Code feature; this one
is built and tested against Claude Code 2.1.292.

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
- Machines never clash. `MEMORY.md` indexes merge line by line
  (`merge=union`), so every machine's entries are kept. Any other memory both
  machines changed gets a normal three-way merge; if that conflicts, the
  version already pushed stays and this machine's is kept beside it as
  `<name>.from-<host>.md` (a git merge driver the mod installs), so nothing is
  lost or interleaved and the sync carries on. Reconcile those pairs when they
  appear. Only a memory deleted on one machine and changed on another stops
  the sync, with a toast saying how to resolve it.
- Projects are matched by folder name, which Claude Code derives from the
  project's absolute path: use the same username and code folder on every
  machine for a project's memories to be shared.

The repo defaults to `kokko-ng/claude-memory`; set `CLAUDE_MEMORY_REPO` to
`owner/name` (GitHub, using your git credentials) or any git URL. Create it
private and empty first:

```bash
gh repo create <owner>/claude-memory --private
/plugin install memory-sync --marketplace kokko-ng/kokko-claude-mods
```

Mods do not run where `disableAllHooks` is set, and a `settings.local.json`
in `~/.claude` sets it for sessions started in your home folder.

## Development

Run `pre-commit install` once per clone. It installs the pre-commit and
commit-msg hooks: file hygiene, gitleaks, `claude plugin validate --strict`
and `claude plugin test` for every mod (on a pinned Claude Code), and
[Conventional Commits](https://www.conventionalcommits.org/) messages checked
by commitizen. CI runs the same hooks and checks every commit message.

Each mod is its own plugin under `plugins/`:

```bash
claude plugin validate plugins/context-bar
claude plugin test plugins/context-bar
claude plugin validate plugins/memory-sync
claude plugin test plugins/memory-sync
```
