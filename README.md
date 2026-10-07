# Today Todos

An Obsidian code block that shows the tasks under one heading of another note —
by default, `## Today` in `todo.md.md`.

````
```today-todos
```
````

- Ticking a box edits the source note; editing the source note re-renders the block.
- The section runs until the next heading of the same or higher level. Only task
  lines (`- [ ]`, `- [x]`) are shown, as one list.

## Options

Leading `key: value` lines:

````
```today-todos
file: todo.md.md
heading: Today
title: Todo
```
````

`file` and `heading` pick the source (defaults shown). `title` adds a
second-level heading above the list.

## Side column

Any markdown after the options is rendered beside the list — on the left on a
desktop pane at least 480px wide, stacked above it on mobile and in narrow panes.

````
```today-todos
> [!quote]
> know what to do
```
````

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `j1mmy2hang/obsidian-today-todos`.

Locally: `./install.sh <vault>/.obsidian/plugins/today-todos` (no build step;
`main.js` is the source).
