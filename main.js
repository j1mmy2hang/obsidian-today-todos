const { Plugin, MarkdownRenderChild, MarkdownRenderer, TFile, Keymap } = require('obsidian');

const DEFAULTS = { file: 'todo.md.md', heading: 'Today' };
const TASK = /^(\s*[-*+]\s\[)(.)(\].*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// Settings come from `key: value` lines inside the code block.
function parseOptions(source) {
  const opts = { ...DEFAULTS };
  for (const line of source.split('\n')) {
    const m = line.match(/^\s*(file|heading)\s*:\s*(.+?)\s*$/);
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

// The task lines under `heading`, grouped by the blank lines between them.
// Each task keeps its line number so a tick can be written back.
function readSection(text, heading) {
  const lines = text.split('\n');
  const groups = [];
  let level = 0, current = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && h[2].toLowerCase() === heading.toLowerCase()) level = h[1].length;
      continue;
    }
    if (!level) continue;
    if (TASK.test(lines[i])) {
      if (!current) groups.push((current = []));
      current.push({ line: i, text: lines[i] });
    } else if (!lines[i].trim()) {
      current = null;
    }
  }
  return { found: level > 0, groups };
}

class TodayTodos extends MarkdownRenderChild {
  constructor(plugin, el, opts) {
    super(el);
    this.plugin = plugin;
    this.app = plugin.app;
    this.opts = opts;
  }

  onload() {
    const refresh = (file) => { if (file.path === this.path()) this.render(); };
    this.registerEvent(this.app.vault.on('modify', refresh));
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('rename', (file) => refresh(file)));

    // Clicks stay inside the block, so Live Preview doesn't jump into source mode.
    this.registerDomEvent(this.containerEl, 'mousedown', (e) => e.stopPropagation());
    this.registerDomEvent(this.containerEl, 'click', (e) => {
      e.stopPropagation();
      const link = e.target.closest('a.internal-link');
      if (!link) return;
      e.preventDefault();
      this.app.workspace.openLinkText(link.dataset.href || link.getAttribute('href'), this.path(), Keymap.isModEvent(e));
    });

    this.render();
  }

  path() {
    const f = this.app.metadataCache.getFirstLinkpathDest(this.opts.file.replace(/\.md$/, ''), '');
    return f ? f.path : this.opts.file;
  }

  file() {
    const f = this.app.vault.getAbstractFileByPath(this.path());
    return f instanceof TFile ? f : null;
  }

  async render() {
    const token = (this.token = {});
    const file = this.file();
    const text = file ? await this.app.vault.cachedRead(file) : null;
    if (token !== this.token) return; // a newer render started meanwhile

    const el = this.containerEl;
    el.empty();
    el.addClass('today-todos');

    if (!file) return this.note(`No file "${this.opts.file}".`);
    const { found, groups } = readSection(text, this.opts.heading);
    if (!found) return this.note(`No "${this.opts.heading}" heading in ${file.basename}.`);
    if (!groups.length) return this.note('Nothing for today.');

    for (const group of groups) {
      const box = el.createDiv('today-todos-group');
      await MarkdownRenderer.render(this.app, group.map((t) => t.text.trimStart()).join('\n'), box, file.path, this);
      box.querySelectorAll('input.task-list-item-checkbox').forEach((input, i) => {
        const task = group[i];
        if (!task) return;
        input.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle(file, task);
        });
      });
    }
  }

  note(msg) {
    this.containerEl.createDiv({ cls: 'today-todos-empty', text: msg });
  }

  // Flip `[ ]` ↔ `[x]` on the task's line; if the file shifted, find the line by its text.
  async toggle(file, task) {
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      let i = lines[task.line] === task.text ? task.line : lines.indexOf(task.text);
      if (i < 0) return data;
      lines[i] = lines[i].replace(TASK, (_, a, mark, b) => a + (mark === ' ' ? 'x' : ' ') + b);
      return lines.join('\n');
    });
  }
}

module.exports = class TodayTodosPlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor('today-todos', (source, el, ctx) => {
      ctx.addChild(new TodayTodos(this, el, parseOptions(source)));
    });
  }
};
