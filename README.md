# Today Todos

Put this in any note:

````
```today-todos
```
````

It renders the tasks under `## Today` in `todo.md.md`. Ticking a box edits
`todo.md.md`; editing `todo.md.md` re-renders the block.

Override either default inside the block:

````
```today-todos
file: todo.md.md
heading: Today
```
````

Install: `./install.sh` (no build step; `main.js` is the source).
