# Claude Code mods

Two Claude Code mods in one marketplace:

- [context-bar](#context-bar): a context-window bar above the prompt.
- [theme-sync](#theme-sync): applies `theme` changes in
  `~/.claude/settings.json` to running sessions.

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

## Development

Each mod is its own plugin under `plugins/`:

```bash
claude plugin validate plugins/context-bar
claude plugin test plugins/context-bar
claude plugin validate plugins/theme-sync
claude plugin test plugins/theme-sync
```
