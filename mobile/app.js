(() => {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const els = {
    empty: $('empty'),
    content: $('content'),
    editor: $('editor'),
    title: $('title'),
    toc: $('toc'),
    tocList: $('tocList'),
    noteList: $('noteList'),
    scrim: $('scrim'),
    fileInput: $('fileInput'),
    selPop: $('selPop'),
    noteScrim: $('noteScrim'),
    noteQuote: $('noteQuote'),
    noteText: $('noteText'),
    noteDelete: $('noteDelete'),
    btnEdit: $('btnEdit'),
    btnExport: $('btnExport'),
  }

  const STORE = {
    theme: 'moji.theme',
    size: 'moji.size',
    doc: 'moji.lastDoc',
    name: 'moji.lastName',
    notes: 'moji.notes.',
  }

  const state = {
    md: '',
    name: '',
    editing: false,
    notes: [],
    pendingSel: null,
    editingNoteId: null,
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t)
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#1c1d1a' : '#4a6b57')
    localStorage.setItem(STORE.theme, t)
  }
  applyTheme(localStorage.getItem(STORE.theme) || 'light')

  const SIZES = [15, 17, 19, 21, 23]
  let sizeIdx = Math.max(0, SIZES.indexOf(parseInt(localStorage.getItem(STORE.size), 10)))
  if (sizeIdx < 0) sizeIdx = 1
  function applySize() {
    document.documentElement.style.setProperty('--reader-size', SIZES[sizeIdx] + 'px')
    localStorage.setItem(STORE.size, String(SIZES[sizeIdx]))
  }
  applySize()

  marked.setOptions({ gfm: true, breaks: false })

  function slugify(text, used) {
    let base = text.trim().toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\- ]/g, '')
      .replace(/\s+/g, '-') || 'section'
    let s = base, n = 1
    while (used.has(s)) s = base + '-' + (++n)
    used.add(s)
    return s
  }

  function notesKey() { return STORE.notes + (state.name || '__untitled__') }
  function loadNotes() {
    try { state.notes = JSON.parse(localStorage.getItem(notesKey()) || '[]') }
    catch { state.notes = [] }
  }
  function saveNotes() {
    try { localStorage.setItem(notesKey(), JSON.stringify(state.notes)) }
    catch { /* ignore */ }
  }

  function renderReader() {
    const dirty = marked.parse(state.md)
    const clean = DOMPurify.sanitize(dirty, { ADD_ATTR: ['target', 'style', 'align'], ADD_TAGS: ['span', 'div', 'mark'] })
    els.content.innerHTML = clean

    els.content.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block) } catch { /* ignore */ }
    })

    const used = new Set()
    const toc = []
    els.content.querySelectorAll('h1, h2, h3').forEach((h) => {
      const id = slugify(h.textContent, used)
      h.id = id
      toc.push({ level: +h.tagName[1], text: h.textContent, id })
    })
    buildToc(toc)

    applyHighlights()
    buildNoteList()
  }

  function applyHighlights() {
    state.notes.forEach((n) => highlightText(n.quote, n.id, !!n.text))
  }

  function highlightText(quote, noteId, hasNote) {
    if (!quote) return
    const walker = document.createTreeWalker(els.content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        let p = node.parentNode
        while (p && p !== els.content) {
          if (p.nodeName === 'MARK' || p.nodeName === 'PRE' || p.nodeName === 'CODE') return NodeFilter.FILTER_REJECT
          p = p.parentNode
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let node
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(quote)
      if (idx === -1) continue
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + quote.length)
      const mark = document.createElement('mark')
      mark.className = 'note-mark' + (hasNote ? ' has-note' : '')
      mark.dataset.noteId = noteId
      try {
        range.surroundContents(mark)
        mark.addEventListener('click', (e) => {
          e.stopPropagation()
          openNoteSheet(noteId)
        })
      } catch { /* cross-node, skip */ }
      return
    }
  }

  function buildToc(toc) {
    if (!toc.length) {
      els.tocList.innerHTML = '<div class="toc-empty">该文档没有标题</div>'
      return
    }
    els.tocList.innerHTML = ''
    toc.forEach((item) => {
      const a = document.createElement('a')
      a.textContent = item.text
      a.href = '#' + item.id
      a.className = 'lv' + item.level
      a.addEventListener('click', (e) => {
        e.preventDefault()
        closeToc()
        const target = document.getElementById(item.id)
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      els.tocList.appendChild(a)
    })
  }

  function buildNoteList() {
    if (!state.notes.length) {
      els.noteList.innerHTML = '<div class="toc-empty">暂无批注，选中文字即可添加</div>'
      return
    }
    els.noteList.innerHTML = ''
    state.notes.forEach((n) => {
      const a = document.createElement('a')
      a.className = 'note-list-item'
      a.href = 'javascript:void 0'
      a.innerHTML = '<span class="nq"></span><span class="nt"></span>'
      a.querySelector('.nq').textContent = '「' + n.quote + '」'
      a.querySelector('.nt').textContent = n.text || '（仅高亮）'
      a.addEventListener('click', (e) => {
        e.preventDefault()
        closeToc()
        const mark = els.content.querySelector('mark[data-note-id="' + n.id + '"]')
        if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        openNoteSheet(n.id)
      })
      els.noteList.appendChild(a)
    })
  }

  function openToc() { els.toc.classList.add('show'); els.scrim.classList.add('show') }
  function closeToc() { els.toc.classList.remove('show'); els.scrim.classList.remove('show') }

  function loadDoc(md, name) {
    state.md = md
    state.name = name || ''
    state.editing = false
    loadNotes()

    els.empty.hidden = true
    els.content.hidden = false
    els.editor.hidden = true
    els.btnExport.hidden = false
    els.btnEdit.textContent = '✏️'

    if (state.name) {
      els.title.textContent = state.name
      document.title = state.name + ' · 墨记阅读'
    }
    renderReader()
    window.scrollTo(0, 0)
    persistDoc()
  }

  function persistDoc() {
    try {
      localStorage.setItem(STORE.doc, state.md)
      if (state.name) localStorage.setItem(STORE.name, state.name)
    } catch { /* too large */ }
  }

  function setEditing(on) {
    state.editing = on
    if (on) {
      els.editor.value = state.md
      els.editor.hidden = false
      els.content.hidden = true
      els.btnEdit.textContent = '✓'
      hideSelPop()
      setTimeout(() => els.editor.focus(), 0)
    } else {
      state.md = els.editor.value
      els.editor.hidden = true
      els.content.hidden = false
      els.btnEdit.textContent = '✏️'
      renderReader()
      persistDoc()
    }
  }

  function onSelection() {
    if (state.editing) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) { hideSelPop(); return }
    const text = sel.toString().trim()
    if (!text || text.length > 200) { hideSelPop(); return }
    const anchor = sel.anchorNode
    if (!anchor || !els.content.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) { hideSelPop(); return }

    state.pendingSel = { quote: text }
    els.selPop.hidden = false
  }
  function hideSelPop() { els.selPop.hidden = true }

  function addNote(quote, text) {
    const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 6)
    state.notes.push({ id, quote, text: text || '' })
    saveNotes()
    renderReader()
  }

  function openNoteSheet(noteId) {
    const n = state.notes.find((x) => x.id === noteId)
    if (!n) return
    state.editingNoteId = noteId
    els.noteQuote.textContent = '「' + n.quote + '」'
    els.noteText.value = n.text || ''
    els.noteDelete.hidden = false
    els.noteScrim.hidden = false
    setTimeout(() => els.noteText.focus(), 0)
  }
  function openNewNoteSheet(quote) {
    state.editingNoteId = null
    state.pendingSel = { quote }
    els.noteQuote.textContent = '「' + quote + '」'
    els.noteText.value = ''
    els.noteDelete.hidden = true
    els.noteScrim.hidden = false
    setTimeout(() => els.noteText.focus(), 0)
  }
  function closeNoteSheet() {
    els.noteScrim.hidden = true
    state.editingNoteId = null
  }
  function saveNoteSheet() {
    const text = els.noteText.value.trim()
    if (state.editingNoteId) {
      const n = state.notes.find((x) => x.id === state.editingNoteId)
      if (n) { n.text = text; saveNotes(); renderReader() }
    } else if (state.pendingSel) {
      addNote(state.pendingSel.quote, text)
      state.pendingSel = null
    }
    closeNoteSheet()
  }
  function deleteNote() {
    if (!state.editingNoteId) return
    state.notes = state.notes.filter((x) => x.id !== state.editingNoteId)
    saveNotes()
    renderReader()
    closeNoteSheet()
  }

  function buildExport() {
    let out = state.editing ? els.editor.value : state.md
    const withNotes = state.notes.filter((n) => n.text)
    if (!withNotes.length) return out
    out = out.replace(/\s*$/, '') + '\n\n---\n\n## 批注\n\n'
    withNotes.forEach((n, i) => {
      out += (i + 1) + '. 「' + n.quote + '」\n   > ' + n.text.replace(/\n/g, '\n   > ') + '\n\n'
    })
    return out.replace(/\s*$/, '') + '\n'
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function exportDoc() {
    if (state.editing) { state.md = els.editor.value }
    const base = (state.name || 'document').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
    download(base + '.md', buildExport())
    showToast('已导出（含批注）到下载')
  }

  function readFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => loadDoc(String(reader.result), file.name)
    reader.onerror = () => alert('读取文件失败')
    reader.readAsText(file, 'utf-8')
  }

  $('btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme')
    applyTheme(cur === 'dark' ? 'light' : 'dark')
  })
  $('btnSize').addEventListener('click', () => {
    sizeIdx = (sizeIdx + 1) % SIZES.length
    applySize()
  })
  $('btnToc').addEventListener('click', openToc)
  els.scrim.addEventListener('click', closeToc)

  els.btnEdit.addEventListener('click', () => {
    if (els.empty.hidden === false) { loadDoc('', '未命名.md'); setEditing(true); return }
    setEditing(!state.editing)
  })
  els.btnExport.addEventListener('click', exportDoc)

  const pick = () => els.fileInput.click()
  $('btnOpen').addEventListener('click', pick)
  $('btnOpenBig').addEventListener('click', pick)
  $('btnNewBig').addEventListener('click', () => { loadDoc('# 新文档\n\n', '未命名.md'); setEditing(true) })
  els.fileInput.addEventListener('change', (e) => readFile(e.target.files[0]))

  document.addEventListener('selectionchange', onSelection)
  els.content.addEventListener('click', (e) => {
    if (!e.target.closest('mark.note-mark')) hideSelPop()
  })

  // 阻止按下操作条按钮时抢走选区（否则选区塌陷会先关掉工具条）
  ;['selHighlight', 'selNote'].forEach((id) => {
    $(id).addEventListener('mousedown', (e) => e.preventDefault())
    $(id).addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
  })

  $('selHighlight').addEventListener('click', (e) => {
    e.preventDefault()
    if (state.pendingSel) addNote(state.pendingSel.quote, '')
    window.getSelection().removeAllRanges()
    hideSelPop()
  })
  $('selNote').addEventListener('click', (e) => {
    e.preventDefault()
    if (state.pendingSel) openNewNoteSheet(state.pendingSel.quote)
    window.getSelection().removeAllRanges()
    hideSelPop()
  })

  els.noteDelete.addEventListener('click', deleteNote)
  $('noteCancel').addEventListener('click', closeNoteSheet)
  $('noteSave').addEventListener('click', saveNoteSheet)
  els.noteScrim.addEventListener('click', (e) => { if (e.target === els.noteScrim) closeNoteSheet() })

  ;['dragover', 'drop'].forEach((ev) => {
    document.addEventListener(ev, (e) => { e.preventDefault() })
  })
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]
    if (f) readFile(f)
  })

  const last = localStorage.getItem(STORE.doc)
  if (last) loadDoc(last, localStorage.getItem(STORE.name) || '')

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('已更新到新版本，下次打开生效')
            }
          })
        })
      }).catch(() => { /* ignore */ })
    })
  }

  function showToast(msg) {
    const t = document.createElement('div')
    t.textContent = msg
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--accent);color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;z-index:70;box-shadow:0 4px 16px rgba(0,0,0,.2);'
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 3000)
  }
})()
