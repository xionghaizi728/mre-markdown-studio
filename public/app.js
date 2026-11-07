'use strict';

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const preview = $('preview');
const fileListEl = $('fileList');
const dirtyDot = $('dirtyDot');
const saveBtn = $('saveBtn');
const autosaveEl = $('autosave');

let files = [];
let currentPath = null;
let savedContent = '';
let dirty = false;
let autosaveTimer = null;
let modalResolve = null;

/* ------------------------------------------------ 渲染 */

if (window.marked) {
  marked.setOptions({ gfm: true, breaks: false });
}

function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, style, form').forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^(javascript:|data:text\/html)/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.innerHTML;
}

function renderPreview() {
  const text = editor.value;
  const trimmed = text.trim();
  if (!trimmed) {
    preview.classList.add('empty');
    preview.textContent = currentPath ? '这篇文档还是空的，开始写点什么吧。' : '右侧将实时显示 Markdown 渲染效果。';
  } else {
    preview.classList.remove('empty');
    try {
      preview.innerHTML = sanitize(marked.parse(text));
    } catch (err) {
      preview.innerHTML = '<p class="placeholder">渲染失败：' + escapeHtml(err.message) + '</p>';
    }
  }
  const chars = text.length;
  $('charStat').textContent = chars.toLocaleString('zh-CN') + ' 字符';
  const minutes = Math.max(1, Math.round(chars / 400));
  $('readTime').textContent = trimmed ? '约 ' + minutes + ' 分钟阅读' : '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setDirty(value) {
  dirty = value;
  dirtyDot.hidden = !value;
  saveBtn.disabled = !currentPath || !value;
  $('saveStat').textContent = !currentPath ? '未选择文档' : value ? '有未保存的修改' : savedContent ? '已保存' : '新建文档';
  if (document.title.indexOf('*') === 0 !== value) {
    document.title = (value ? '* ' : '') + 'MRE · Markdown 写作台';
  }
}

function updateCursorStat() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  $('cursorStat').textContent = '行 ' + line + '，列 ' + col;
}

/* ------------------------------------------------ 接口 */

async function api(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch { /* 忽略空响应 */ }
  if (!res.ok) throw new Error(data.error || res.status + ' ' + res.statusText);
  return data;
}

async function loadFiles() {
  const data = await api('/api/files');
  files = data.files || [];
  $('docsDir').textContent = data.docsDir || '';
  $('docsDir').title = data.docsDir || '';
  renderFileList();
}

function renderFileList() {
  const keyword = $('search').value.trim().toLowerCase();
  const visible = files.filter((f) => !keyword || f.path.toLowerCase().includes(keyword));
  fileListEl.innerHTML = '';
  $('fileCount').textContent = visible.length + ' / ' + files.length + ' 个文档';

  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.style.cursor = 'default';
    li.textContent = files.length ? '没有匹配的文档' : '还没有文档，点右上角 ＋ 新建';
    fileListEl.appendChild(li);
    return;
  }

  visible.forEach((file) => {
    const li = document.createElement('li');
    li.className = 'file-item' + (file.path === currentPath ? ' active' : '');
    li.dataset.path = file.path;

    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = 'MD';

    const name = document.createElement('span');
    name.className = 'file-name';
    if (dir) {
      const folder = document.createElement('span');
      folder.className = 'folder';
      folder.textContent = dir;
      name.appendChild(folder);
    }
    name.appendChild(document.createTextNode(file.name));

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = formatSize(file.size);

    const acts = document.createElement('span');
    acts.className = 'file-actions';
    acts.innerHTML = '<button type="button" class="mini-btn" data-act="rename" title="重命名">改名</button>' +
      '<button type="button" class="mini-btn" data-act="delete" title="删除">删除</button>';

    li.append(icon, name, meta, acts);
    li.addEventListener('click', (e) => {
      const btn = e.target.closest('.mini-btn');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.act === 'rename') renameFile(file.path);
        else deleteFile(file.path);
        return;
      }
      openFile(file.path);
    });
    fileListEl.appendChild(li);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function openFile(path) {
  if (path === currentPath) return;
  if (dirty && currentPath && !confirm('「' + currentPath + '」有未保存的修改，确定要放弃吗？')) return;
  try {
    const data = await api('/api/file?path=' + encodeURIComponent(path));
    currentPath = data.path;
    editor.value = data.content;
    savedContent = data.content;
    editor.disabled = false;
    editor.scrollTop = 0;
    $('docPath').textContent = currentPath;
    $('docPath').title = currentPath;
    setDirty(false);
    renderPreview();
    updateCursorStat();
    $('statusLeft').textContent = '已打开 ' + currentPath;
    renderFileList();
    localStorage.setItem('mre:last', currentPath);
  } catch (err) {
    alert('打开失败：' + err.message);
  }
}

async function saveFile(manual) {
  if (!currentPath) return;
  if (!dirty) {
    if (manual) $('statusLeft').textContent = '没有需要保存的修改';
    return;
  }
  const content = editor.value;
  try {
    await api('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, content })
    });
    savedContent = content;
    setDirty(false);
    $('statusLeft').textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN');
    const file = files.find((f) => f.path === currentPath);
    if (file) file.size = content.length;
    renderFileList();
  } catch (err) {
    $('statusLeft').textContent = '保存失败：' + err.message;
    alert('保存失败：' + err.message);
  }
}

async function deleteFile(path) {
  if (!confirm('确定删除「' + path + '」？该操作不可撤销。')) return;
  try {
    await api('/api/file?path=' + encodeURIComponent(path), { method: 'DELETE' });
    if (path === currentPath) {
      currentPath = null;
      editor.value = '';
      savedContent = '';
      editor.disabled = true;
      $('docPath').textContent = '未选择文档';
      setDirty(false);
      renderPreview();
    }
    await loadFiles();
    $('statusLeft').textContent = '已删除 ' + path;
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

/* ------------------------------------------------ 弹窗 */

function askModal({ title, tip, value, okText }) {
  $('modalTitle').textContent = title;
  $('modalTip').textContent = tip || '';
  const input = $('modalInput');
  input.value = value || '';
  $('modalOk').textContent = okText || '确定';
  $('modal').hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 20);
  return new Promise((resolve) => { modalResolve = resolve; });
}

function closeModal(value) {
  $('modal').hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(value);
}

async function newFile() {
  const path = await askModal({
    title: '新建文档',
    tip: '相对 docs 目录的路径，可带子目录，例如「笔记/周报.md」，后缀可省略',
    value: '未命名.md',
    okText: '创建'
  });
  if (!path) return;
  let target = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!/\.(md|markdown)$/i.test(target)) target += '.md';
  try {
    await api('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target, content: '# ' + target.split('/').pop().replace(/\.(md|markdown)$/i, '') + '\n\n' })
    });
    await loadFiles();
    await openFile(target);
    editor.focus();
    $('statusLeft').textContent = '已创建 ' + target;
  } catch (err) {
    alert('创建失败：' + err.message);
  }
}

async function renameFile(path) {
  const next = await askModal({
    title: '重命名 / 移动',
    tip: '填写新的路径，也可以借此移动到子目录',
    value: path,
    okText: '重命名'
  });
  if (!next || next.trim() === path) return;
  let target = next.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!/\.(md|markdown)$/i.test(target)) target += '.md';
  try {
    await api('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: path, to: target })
    });
    if (currentPath === path) currentPath = target;
    await loadFiles();
    if (currentPath === target) $('docPath').textContent = target;
    $('statusLeft').textContent = '已重命名为 ' + target;
  } catch (err) {
    alert('重命名失败：' + err.message);
  }
}

/* ------------------------------------------------ 编辑辅助 */

function wrapSelection(prefix, suffix, placeholder) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || placeholder || '';
  editor.setRangeText(prefix + selected + (suffix === undefined ? prefix : suffix), start, end, 'end');
  editor.focus();
  editor.dispatchEvent(new Event('input'));
}

function prefixLines(prefix) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end);
  const stop = lineEnd === -1 ? value.length : lineEnd;
  const block = value.slice(lineStart, stop);
  const replaced = block.split('\n').map((line) => (line.trim() ? prefix + line : line)).join('\n');
  editor.setRangeText(replaced, lineStart, stop, 'select');
  editor.focus();
  editor.dispatchEvent(new Event('input'));
}

function insertBlock(text) {
  const start = editor.selectionStart;
  const value = editor.value;
  const needLf = start > 0 && value[start - 1] !== '\n';
  const prefix = needLf ? '\n\n' : '';
  editor.setRangeText(prefix + text, start, editor.selectionEnd, 'end');
  editor.focus();
  editor.dispatchEvent(new Event('input'));
}

const TOOL_ACTIONS = {
  bold: () => wrapSelection('**', '**', '加粗文字'),
  italic: () => wrapSelection('*', '*', '斜体文字'),
  code: () => wrapSelection('`', '`', '代码'),
  link: () => wrapSelection('[', '](https://)', '链接文字'),
  heading: () => prefixLines('## '),
  list: () => prefixLines('- '),
  quote: () => prefixLines('> '),
  table: () => insertBlock('| 列 A | 列 B |\n| --- | --- |\n| 内容 | 内容 |\n')
};

/* ------------------------------------------------ 视图与分割 */

function setView(view) {
  document.body.classList.remove('view-edit', 'view-split', 'view-preview');
  document.body.classList.add('view-' + view);
  document.querySelectorAll('.view-switch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  localStorage.setItem('mre:view', view);
  if (view !== 'edit') renderPreview();
}

function initDivider() {
  const divider = $('divider');
  const paneEditor = $('paneEditor');
  const panePreview = $('panePreview');
  let dragging = false;

  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    divider.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = $('workspace').getBoundingClientRect();
    const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
    paneEditor.style.flex = '0 0 ' + (ratio * 100) + '%';
    panePreview.style.flex = '1 1 auto';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.userSelect = '';
  });
}

/* ------------------------------------------------ 事件绑定 */

editor.addEventListener('input', () => {
  setDirty(editor.value !== savedContent);
  renderPreview();
  updateCursorStat();
  clearTimeout(autosaveTimer);
  if (autosaveEl.checked && currentPath) {
    autosaveTimer = setTimeout(() => saveFile(false), 1200);
  }
});

['keyup', 'click', 'select'].forEach((ev) => editor.addEventListener(ev, updateCursorStat));

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
});

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const key = e.key.toLowerCase();
  if (key === 's') { e.preventDefault(); saveFile(true); }
  else if (key === 'n') { e.preventDefault(); newFile(); }
  else if (key === 'b' && document.activeElement === editor) { e.preventDefault(); TOOL_ACTIONS.bold(); }
  else if (key === 'i' && document.activeElement === editor) { e.preventDefault(); TOOL_ACTIONS.italic(); }
});

document.querySelectorAll('.md-tools button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = TOOL_ACTIONS[btn.dataset.wrap];
    if (action) action();
  });
});

document.querySelectorAll('.view-switch button').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

$('saveBtn').addEventListener('click', () => saveFile(true));
$('newBtn').addEventListener('click', newFile);
$('search').addEventListener('input', renderFileList);

$('modalOk').addEventListener('click', () => closeModal($('modalInput').value));
$('modalCancel').addEventListener('click', () => closeModal(null));
$('modalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') closeModal($('modalInput').value);
  if (e.key === 'Escape') closeModal(null);
});
$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeModal(null);
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ------------------------------------------------ 启动 */

async function boot() {
  setView(localStorage.getItem('mre:view') || 'split');
  initDivider();
  editor.disabled = true;
  renderPreview();
  try {
    await loadFiles();
    const last = localStorage.getItem('mre:last');
    const target = files.find((f) => f.path === last) || files.find((f) => f.path.includes('欢迎')) || files[0];
    if (target) await openFile(target.path);
    else $('statusLeft').textContent = 'docs 目录中还没有 Markdown 文档';
  } catch (err) {
    $('statusLeft').textContent = '加载失败：' + err.message;
  }
}

boot();
