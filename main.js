const { Plugin, MarkdownRenderChild, MarkdownRenderer, TFile, Keymap } = require('obsidian');

const DEFAULTS = { file: 'todo.md.md', heading: 'Today' };
const TASK = /^(\s*[-*+]\s\[)(.)(\].*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// Y of the baseline of the first line of text inside `el`, or null if it has none.
function firstBaseline(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const text = walker.nextNode();
  if (!text) return null;
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  text.parentNode.insertBefore(probe, text);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
}

// Leading `file:` / `heading:` / `title:` lines are settings; everything after them is
// markdown for a side column, shown left of the todos on desktop.
function parseOptions(source) {
  const opts = { ...DEFAULTS, side: '' };
  const lines = source.split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(file|heading|title)\s*:\s*(.+?)\s*$/);
    if (m) opts[m[1]] = m[2];
    else if (lines[i].trim()) break;
  }
  opts.side = lines.slice(i).join('\n').trim();
  return opts;
}

// The task lines under `heading`. Each keeps its line number so a tick can be
// written back.
function readSection(text, heading) {
  const lines = text.split('\n');
  const tasks = [];
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && h[2].toLowerCase() === heading.toLowerCase()) level = h[1].length;
      continue;
    }
    if (!level) continue;
    if (TASK.test(lines[i])) tasks.push({ line: i, text: lines[i] });
  }
  return { found: level > 0, tasks };
}

class TodayTodos extends MarkdownRenderChild {
  constructor(plugin, el, opts, sourcePath) {
    super(el);
    this.sourcePath = sourcePath;
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
      const from = link.closest('.today-todos-side') ? this.sourcePath : this.path();
      this.app.workspace.openLinkText(link.dataset.href || link.getAttribute('href'), from, Keymap.isModEvent(e));
    });

    // The outer element is the size container; the grid lives on the inner one.
    this.containerEl.addClass('today-todos');
    this.layoutEl = this.containerEl.createDiv('today-todos-layout');
    if (this.opts.side) {
      this.layoutEl.addClass('has-side');
      this.sideEl = this.layoutEl.createDiv('today-todos-side');
      MarkdownRenderer.render(this.app, this.opts.side, this.sideEl, this.sourcePath, this).then(() => this.align());
      // The layout switches between grid and stacked with the pane's width.
      let width = 0;
      const observer = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width !== width) (width = entry.contentRect.width), this.align();
      });
      observer.observe(this.containerEl);
      this.register(() => observer.disconnect());
    }
    const column = this.layoutEl.createDiv('today-todos-list');
    if (this.opts.title) column.createEl('h2', { cls: 'today-todos-title', text: this.opts.title });
    this.listEl = column.createDiv('today-todos-items');
    this.render();
  }

  // Side by side, push the list down so its first line shares a baseline with
  // the side column's first line (e.g. a callout's title).
  align() {
    if (!this.sideEl) return;
    const list = this.listEl.parentElement;
    list.style.paddingTop = '';
    if (getComputedStyle(this.layoutEl).display !== 'grid') return;
    const side = firstBaseline(this.sideEl), own = firstBaseline(list);
    if (side !== null && own !== null && side > own) list.style.paddingTop = `${side - own}px`;
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

    const el = this.listEl;
    el.empty();

    if (!file) return this.note(`No file "${this.opts.file}".`);
    const { found, tasks } = readSection(text, this.opts.heading);
    if (!found) return this.note(`No "${this.opts.heading}" heading in ${file.basename}.`);
    if (!tasks.length) return this.note('All clear for now.');

    await MarkdownRenderer.render(this.app, tasks.map((t) => t.text.trimStart()).join('\n'), el, file.path, this);
    el.querySelectorAll('input.task-list-item-checkbox').forEach((input, i) => {
      const task = tasks[i];
      if (!task) return;
      input.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle(file, task);
      });
    });
    this.align();
  }

  note(msg) {
    this.listEl.createDiv({ cls: 'today-todos-empty', text: msg });
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
      ctx.addChild(new TodayTodos(this, el, parseOptions(source), ctx.sourcePath));
    });
  }
};
