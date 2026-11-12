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
    noteScrim: $('noteScrim'),
    noteQuote: $('noteQuote'),
    noteText: $('noteText'),
    noteDelete: $('noteDelete'),
    btnEdit: $('btnEdit'),
    btnExport: $('btnExport'),
    btnSave: $('btnSave'),
    menuScrim: $('menuScrim'),
    cloudScrim: $('cloudScrim'),
    cloudList: $('cloudList'),
    histScrim: $('histScrim'),
    histList: $('histList'),
    setScrim: $('setScrim'),
    setSpace: $('setSpace'),
    aiBase: $('aiBase'),
    aiModel: $('aiModel'),
    aiKey: $('aiKey'),
    mnHistory: $('mnHistory'),
    polishScrim: $('polishScrim'),
    polishOrig: $('polishOrig'),
    polishInstr: $('polishInstr'),
    polishOut: $('polishOut'),
    polishRun: $('polishRun'),
    polishRetry: $('polishRetry'),
    polishCopy: $('polishCopy'),
    polishApply: $('polishApply'),
    aiFab: $('aiFab'),
    editFab: $('editFab'),
    recentHead: $('recentHead'),
    recentList: $('recentList'),
    emptyRecent: $('emptyRecent'),
    emptyRecentList: $('emptyRecentList'),
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
    docId: null,       // 云文档 id，null = 未上云
    polishedText: '',  // AI 润色结果
    polishSrc: '',     // 本次润色的原文（用于替换定位）
    realtimeCh: null,
    blocks: [],        // 当前渲染的顶层 token（marked.lexer）
    blkEditing: false, // 就地块编辑模式开关
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
    // 按顶层 token 逐块渲染，每块记住它在源码里的 raw，
    // 以便「就地编辑」时点哪块改哪块，而不碰整篇源码。
    const tokens = marked.lexer(state.md)
    state.blocks = tokens
    els.content.innerHTML = ''
    tokens.forEach((tok, i) => {
      if (tok.type === 'space') return
      const wrap = document.createElement('div')
      wrap.className = 'blk'
      wrap.dataset.blk = String(i)
      const dirty = marked.parser([tok])
      wrap.innerHTML = DOMPurify.sanitize(dirty, { ADD_ATTR: ['target', 'style', 'align'], ADD_TAGS: ['span', 'div', 'mark'] })
      els.content.appendChild(wrap)
    })

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

    if (state.blkEditing) {
      const add = document.createElement('button')
      add.className = 'add-blk'
      add.textContent = '＋ 新段落'
      add.addEventListener('click', appendBlock)
      els.content.appendChild(add)
    }
  }

  // 在文末追加一个新段落并立即编辑
  function appendBlock() {
    commitActiveBlock()
    if (state.md && !/\n\n$/.test(state.md)) {
      state.md += /\n$/.test(state.md) ? '\n' : '\n\n'
    }
    state.md += '新段落…\n'
    renderReader()
    const blks = els.content.querySelectorAll('.blk')
    if (blks.length) beginBlockEdit(blks[blks.length - 1])
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

  function loadDoc(md, name, docId) {
    state.md = md
    state.name = name || ''
    state.editing = false
    state.blkEditing = false
    state.docId = docId || null
    loadNotes()

    els.empty.hidden = true
    els.content.hidden = false
    els.content.classList.remove('editing')
    els.editor.hidden = true
    els.btnExport.hidden = false
    els.btnSave.hidden = false
    els.mnHistory.hidden = !state.docId
    els.btnEdit.textContent = '✏️'
    els.aiFab.hidden = false
    els.editFab.hidden = false
    els.editFab.classList.remove('on')

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

  // ===== 云同步 =====
  function cloudOn() { return window.MojiCloud && MojiCloud.available() }

  async function saveToCloud() {
    if (state.blkEditing) commitActiveBlock()
    if (!cloudOn()) { showToast('云功能不可用'); return }
    if (!MojiCloud.hasSpace()) { showToast('请先在设置里填同步口令'); openSettings(); return }
    try {
      showToast('保存中…')
      if (state.docId) {
        await MojiCloud.saveDoc(state.docId, state.name, state.md, state.notes)
      } else {
        const rec = await MojiCloud.createDoc(state.name, state.md, state.notes)
        state.docId = rec.id
        els.mnHistory.hidden = false
      }
      persistDoc()
      showToast('已保存到云 ✓')
      refreshRecent()
    } catch (e) {
      showToast('保存失败：' + (e.message || e))
    }
  }

  // 本地打开的文档自动上云：同名复用，否则新建。静默进行，失败不打扰。
  async function autoUpload() {
    if (!cloudOn() || !MojiCloud.hasSpace()) return
    if (state.docId) return
    const name = state.name, md = state.md
    try {
      const existing = await MojiCloud.findDocByName(name)
      if (existing) {
        // 云端已有同名：只接管 id 并刷新打开时间，不覆盖云端内容
        if (state.name !== name || state.md !== md) return // 用户已切走
        state.docId = existing.id
        els.mnHistory.hidden = false
        MojiCloud.touchDoc(existing.id)
      } else {
        const rec = await MojiCloud.createDoc(name, md, state.notes)
        if (state.name !== name || state.md !== md) return
        state.docId = rec.id
        els.mnHistory.hidden = false
      }
      persistDoc()
      refreshRecent()
    } catch (e) { /* 自动上云失败就静默，用户仍可手动💾 */ }
  }

  async function openCloudLib() {
    closeMenu()
    if (!cloudOn()) { showToast('云功能不可用'); return }
    if (!MojiCloud.hasSpace()) { showToast('请先在设置里填同步口令'); openSettings(); return }
    els.cloudScrim.hidden = false
    els.cloudList.innerHTML = '<div class="list-empty">加载中…</div>'
    try {
      const docs = await MojiCloud.listDocs()
      renderCloudList(docs)
    } catch (e) {
      els.cloudList.innerHTML = '<div class="list-empty">加载失败：' + (e.message || e) + '</div>'
    }
  }

  function renderCloudList(docs) {
    if (!docs.length) {
      els.cloudList.innerHTML = '<div class="list-empty">云端还没有文档。<br>打开或新建一篇后点「新建并上传当前」。</div>'
      return
    }
    els.cloudList.innerHTML = ''
    docs.forEach((d) => {
      const row = document.createElement('div')
      row.className = 'doc-row'
      const main = document.createElement('div')
      main.className = 'dr-main'
      main.innerHTML = '<div class="dr-name"></div><div class="dr-time"></div>'
      main.querySelector('.dr-name').textContent = d.name || '未命名.md'
      main.querySelector('.dr-time').textContent = fmtTime(d.updated_at)
      main.addEventListener('click', () => openCloudDoc(d.id))
      const del = document.createElement('button')
      del.className = 'dr-del'
      del.textContent = '🗑'
      del.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm('删除「' + (d.name || '') + '」？历史版本也会一并删除。')) return
        try { await MojiCloud.deleteDoc(d.id); row.remove() } catch (err) { showToast('删除失败') }
      })
      row.appendChild(main)
      row.appendChild(del)
      els.cloudList.appendChild(row)
    })
  }

  async function openCloudDoc(id) {
    try {
      const d = await MojiCloud.getDoc(id)
      els.cloudScrim.hidden = true
      state.notes = Array.isArray(d.notes) ? d.notes : []
      saveNotes2(id, state.notes)
      loadDoc(d.content || '', d.name || '未命名.md', d.id)
      MojiCloud.touchDoc(id)   // 标记最近打开
      refreshRecent()
    } catch (e) { showToast('打开失败：' + (e.message || e)) }
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso)
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    } catch { return '' }
  }
  function saveNotes2(id, notes) {
    try { localStorage.setItem(STORE.notes + (id || ''), JSON.stringify(notes)) } catch { /* ignore */ }
  }

  // ===== 最近打开 =====
  const RECENT_KEY = 'moji.recent'
  function cacheRecent(docs) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(docs.slice(0, 8))) } catch { /* ignore */ }
  }
  function readRecentCache() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
  }

  async function refreshRecent() {
    // 先用本地缓存即时渲染（离线也能显示）
    renderRecent(readRecentCache())
    if (!cloudOn() || !MojiCloud.hasSpace()) { renderRecent([]); return }
    try {
      const docs = await MojiCloud.listDocs()
      const top = docs.slice(0, 8)
      cacheRecent(top)
      renderRecent(top)
    } catch (e) { /* 网络失败保留缓存 */ }
  }

  function renderRecent(docs) {
    const has = docs && docs.length
    // 抽屉顶部
    els.recentHead.hidden = !has
    els.recentList.hidden = !has
    els.recentList.innerHTML = ''
    // 空状态页
    els.emptyRecent.hidden = !has
    els.emptyRecentList.innerHTML = ''
    if (!has) return

    docs.forEach((d) => {
      // 抽屉项
      const a = document.createElement('a')
      a.href = 'javascript:void 0'
      a.className = 'recent-row'
      a.innerHTML = '<span class="rr-name"></span><span class="rr-time"></span>'
      a.querySelector('.rr-name').textContent = d.name || '未命名.md'
      a.querySelector('.rr-time').textContent = shortTime(d.updated_at)
      a.addEventListener('click', (e) => { e.preventDefault(); closeToc(); openCloudDoc(d.id) })
      els.recentList.appendChild(a)
      // 空状态卡片
      const item = document.createElement('div')
      item.className = 'recent-item'
      item.innerHTML = '<span class="ri-name"></span><span class="ri-time"></span>'
      item.querySelector('.ri-name').textContent = d.name || '未命名.md'
      item.querySelector('.ri-time').textContent = shortTime(d.updated_at)
      item.addEventListener('click', () => openCloudDoc(d.id))
      els.emptyRecentList.appendChild(item)
    })
  }

  function shortTime(iso) {
    try {
      const d = new Date(iso), now = new Date()
      const p = (n) => String(n).padStart(2, '0')
      const sameDay = d.toDateString() === now.toDateString()
      if (sameDay) return p(d.getHours()) + ':' + p(d.getMinutes())
      return (d.getMonth() + 1) + '月' + d.getDate() + '日'
    } catch { return '' }
  }

  // ===== 历史版本 =====
  async function openHistory() {
    closeMenu()
    if (!state.docId) { showToast('先保存到云才有历史版本'); return }
    els.histScrim.hidden = false
    els.histList.innerHTML = '<div class="list-empty">加载中…</div>'
    try {
      const vers = await MojiCloud.listVersions(state.docId)
      if (!vers.length) { els.histList.innerHTML = '<div class="list-empty">暂无历史版本。<br>每次保存都会生成一个快照。</div>'; return }
      els.histList.innerHTML = ''
      vers.forEach((v, i) => {
        const row = document.createElement('div')
        row.className = 'doc-row'
        const main = document.createElement('div')
        main.className = 'dr-main'
        main.innerHTML = '<div class="dr-name"></div><div class="dr-time"></div>'
        main.querySelector('.dr-name').textContent = (i === 0 ? '最新 · ' : '') + fmtTime(v.created_at)
        main.querySelector('.dr-time').textContent = (v.content || '').slice(0, 40).replace(/\n/g, ' ') + '…'
        main.addEventListener('click', () => {
          if (!confirm('回滚到此版本？当前未保存内容会被覆盖。')) return
          els.histScrim.hidden = true
          loadDoc(v.content || '', v.name || state.name, state.docId)
          showToast('已回滚（记得再点保存以固化）')
        })
        row.appendChild(main)
        els.histList.appendChild(row)
      })
    } catch (e) {
      els.histList.innerHTML = '<div class="list-empty">加载失败：' + (e.message || e) + '</div>'
    }
  }

  // ===== AI 润色 =====
  // 打开润色对话框。text 有值则带入原文（来自选区/菜单），否则留空待输入。
  function openPolish(text) {
    if (!cloudOn() || !MojiCloud.hasAI()) { showToast('请先在设置里填 AI 接口'); openSettings(); return }
    closeMenu()
    els.polishOrig.value = text || ''
    els.polishInstr.value = ''
    els.polishOut.value = ''
    els.polishOut.placeholder = '润色结果会显示在这里…'
    els.polishApply.hidden = true
    els.polishCopy.hidden = true
    els.polishRetry.hidden = true
    state.polishSrc = ''
    els.polishScrim.hidden = false
    setTimeout(() => (text ? els.polishInstr : els.polishOrig).focus(), 0)
  }

  async function runPolish() {
    const src = els.polishOrig.value.trim()
    const instr = els.polishInstr.value.trim()
    if (!src && !instr) { showToast('请填入原文，或至少写一条润色要求'); els.polishOrig.focus(); return }
    if (!cloudOn() || !MojiCloud.hasAI()) { showToast('请先在设置里填 AI 接口'); openSettings(); return }
    state.polishSrc = src  // 记住本次润色的原文，用于「替换原文」时定位
    els.polishOut.value = ''
    els.polishOut.placeholder = 'AI 润色中…'
    els.polishApply.hidden = true
    els.polishCopy.hidden = true
    els.polishRetry.hidden = true
    els.polishRun.disabled = true
    try {
      const out = await MojiCloud.polish(src, instr)
      state.polishedText = out
      els.polishOut.value = out
      els.polishApply.hidden = false
      els.polishCopy.hidden = false
      els.polishRetry.hidden = false
    } catch (e) {
      els.polishOut.placeholder = ''
      els.polishOut.value = '【失败】' + (e.message || e)
      els.polishRetry.hidden = false
    } finally {
      els.polishRun.disabled = false
    }
  }

  function applyPolish() {
    const q = state.polishSrc
    const out = els.polishOut.value.trim()
    if (!q || !out) { els.polishScrim.hidden = true; return }
    const idx = state.md.indexOf(q)
    if (idx !== -1) {
      state.md = state.md.slice(0, idx) + out + state.md.slice(idx + q.length)
      renderReader()
      persistDoc()
      showToast('已替换（记得点保存同步到云）')
      els.polishScrim.hidden = true
    } else {
      showToast('正文里找不到这段原文，可用「复制」手动粘贴')
    }
  }

  async function copyPolish() {
    const out = els.polishOut.value.trim()
    if (!out) return
    try { await navigator.clipboard.writeText(out); showToast('已复制') }
    catch { showToast('复制失败，请手动选择') }
  }

  // ===== 设置 =====
  function openSettings() {
    closeMenu()
    const ai = MojiCloud.getAI()
    els.setSpace.value = MojiCloud.getSpace()
    els.aiBase.value = ai.baseUrl || ''
    els.aiModel.value = ai.model || ''
    els.aiKey.value = ai.apiKey || ''
    els.setScrim.hidden = false
  }
  function saveSettings() {
    MojiCloud.setSpace(els.setSpace.value)
    MojiCloud.setAI({ baseUrl: els.aiBase.value.trim(), model: els.aiModel.value.trim(), apiKey: els.aiKey.value.trim() })
    els.setScrim.hidden = true
    showToast('设置已保存')
    startRealtime()
    refreshRecent()
  }

  // ===== 更多菜单 =====
  function openMenu() { els.menuScrim.hidden = false }
  function closeMenu() { els.menuScrim.hidden = true }

  // ===== 实时订阅 =====
  function startRealtime() {
    if (!cloudOn() || !MojiCloud.hasSpace()) return
    if (state.realtimeCh) MojiCloud.unsubscribe(state.realtimeCh)
    state.realtimeCh = MojiCloud.subscribe(async (payload) => {
      const row = payload.new || payload.old
      if (!row) return
      // 当前打开的文档被其他设备更新 → 重新拉完整内容再热更新。
      // 注意：Supabase realtime 的 payload.new 默认只含主键，不含 content，
      // 所以必须 getDoc 取全量，否则会把正文刷成空白。
      if (state.docId && row.id === state.docId && payload.eventType === 'UPDATE' && !state.editing) {
        try {
          const d = await MojiCloud.getDoc(state.docId)
          if (d && d.content !== state.md) {
            state.notes = Array.isArray(d.notes) ? d.notes : state.notes
            loadDoc(d.content || '', d.name || state.name, state.docId)
            showToast('已同步其他设备的最新修改')
          }
        } catch (e) { /* 拉取失败则不动当前内容 */ }
      }
      // 任何文档增删改 → 刷新"最近"列表
      refreshRecent()
    })
  }

  function setEditing(on) {
    // 就地编辑：保持阅读视图，开启后点某块即可编辑该块。
    state.editing = on
    state.blkEditing = on
    if (on) {
      els.editor.hidden = true
      els.content.hidden = false
      els.btnEdit.textContent = '✓'
      els.editFab.textContent = '✓'
      els.editFab.classList.add('on')
      els.content.classList.add('editing')
      renderReader()
    } else {
      commitActiveBlock()
      els.btnEdit.textContent = '✏️'
      els.editFab.textContent = '✏️'
      els.editFab.classList.remove('on')
      els.content.classList.remove('editing')
      renderReader()
      persistDoc()
    }
  }

  // 点击某块 → 原位替换为 textarea，填入该块源码
  function beginBlockEdit(wrap) {
    if (!state.blkEditing) return
    if (wrap.classList.contains('blk-editing')) return
    commitActiveBlock()
    const i = +wrap.dataset.blk
    const tok = state.blocks[i]
    if (!tok) return
    const ta = document.createElement('textarea')
    ta.className = 'blk-edit'
    ta.value = (tok.raw || '').replace(/\n+$/,'')
    ta.dataset.blk = String(i)
    wrap.classList.add('blk-editing')
    wrap.innerHTML = ''
    wrap.appendChild(ta)
    autoGrow(ta)
    ta.addEventListener('input', () => autoGrow(ta))
    ta.addEventListener('blur', () => commitActiveBlock())
    ta.focus()
    // 光标移到末尾
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }

  function autoGrow(ta) {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }

  function openFirstBlock() {
    const wrap = els.content.querySelector('.blk')
    if (wrap) beginBlockEdit(wrap)
  }

  // 把正在编辑的块写回 state.md 并就地重渲染该块
  function commitActiveBlock() {
    const ta = els.content.querySelector('textarea.blk-edit')
    if (!ta) return
    const i = +ta.dataset.blk
    const tok = state.blocks[i]
    if (!tok) return
    const newRaw = ta.value
    const oldRaw = tok.raw || ''
    if (newRaw !== oldRaw.replace(/\n+$/,'')) {
      // 用新内容替换源码中该块对应片段，保留块后的空行分隔
      const before = state.blocks.slice(0, i).map((t) => t.raw || '').join('')
      const after = state.blocks.slice(i + 1).map((t) => t.raw || '').join('')
      const trail = (oldRaw.match(/\n+$/) || ['\n\n'])[0]
      state.md = before + newRaw + trail + after
      saveNotes()
      renderReader()
      persistDoc()
    } else {
      // 内容未变，仅恢复渲染
      renderReader()
    }
  }

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
    if (state.blkEditing) commitActiveBlock()
    let out = state.md
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
    if (state.blkEditing) commitActiveBlock()
    const base = (state.name || 'document').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
    download(base + '.md', buildExport())
    showToast('已导出（含批注）到下载')
  }

  function readFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { loadDoc(String(reader.result), file.name); autoUpload() }
    reader.onerror = () => alert('读取文件失败')
    reader.readAsText(file, 'utf-8')
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme')
    applyTheme(cur === 'dark' ? 'light' : 'dark')
  }
  function cycleSize() {
    sizeIdx = (sizeIdx + 1) % SIZES.length
    applySize()
  }

  $('btnToc').addEventListener('click', openToc)
  els.scrim.addEventListener('click', closeToc)

  els.btnEdit.addEventListener('click', () => {
    if (els.empty.hidden === false) { loadDoc('# 新文档\n\n正文…\n', '未命名.md'); setEditing(true); openFirstBlock(); return }
    setEditing(!state.editing)
  })
  els.editFab.addEventListener('click', () => setEditing(!state.editing))
  els.btnExport.addEventListener('click', exportDoc)
  els.btnSave.addEventListener('click', saveToCloud)

  // 顶栏「云」「更多」
  $('btnCloud').addEventListener('click', openCloudLib)
  $('btnMore').addEventListener('click', openMenu)
  els.menuScrim.addEventListener('click', (e) => { if (e.target === els.menuScrim) closeMenu() })
  $('mnSize').addEventListener('click', () => { cycleSize() })
  $('mnTheme').addEventListener('click', () => { toggleTheme() })
  $('mnOpen').addEventListener('click', () => { closeMenu(); pick() })
  $('mnHistory').addEventListener('click', openHistory)
  $('mnSettings').addEventListener('click', openSettings)

  // 云库 / 历史 / 设置 弹层
  $('cloudClose').addEventListener('click', () => { els.cloudScrim.hidden = true })
  $('cloudNew').addEventListener('click', async () => {
    if (els.empty.hidden !== false) { showToast('先打开或新建一篇文档'); return }
    state.docId = null
    await saveToCloud()
    openCloudLib()
  })
  $('histClose').addEventListener('click', () => { els.histScrim.hidden = true })
  $('setClose').addEventListener('click', () => { els.setScrim.hidden = true })
  $('setSave').addEventListener('click', saveSettings)

  // AI 润色弹层
  function openPolishFromSelection() {
    const sel = window.getSelection()
    const t = sel && !sel.isCollapsed ? sel.toString().trim() : ''
    openPolish(t)
  }
  $('mnPolish').addEventListener('click', openPolishFromSelection)
  els.aiFab.addEventListener('click', openPolishFromSelection)
  $('polishRun').addEventListener('click', runPolish)
  $('polishRetry').addEventListener('click', runPolish)
  $('polishCopy').addEventListener('click', copyPolish)
  $('polishApply').addEventListener('click', applyPolish)
  $('polishCancel').addEventListener('click', () => { els.polishScrim.hidden = true })
  els.polishScrim.addEventListener('click', (e) => { if (e.target === els.polishScrim) els.polishScrim.hidden = true })

  const pick = () => els.fileInput.click()
  $('btnOpenBig').addEventListener('click', pick)
  $('btnNewBig').addEventListener('click', () => { loadDoc('# 新文档\n\n正文…\n', '未命名.md'); setEditing(true); openFirstBlock() })
  els.fileInput.addEventListener('change', (e) => readFile(e.target.files[0]))

  els.content.addEventListener('click', (e) => {
    if (state.blkEditing) {
      const wrap = e.target.closest('.blk')
      if (wrap) { beginBlockEdit(wrap); return }
    }
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

  // 启动实时订阅（已填口令时）
  startRealtime()
  refreshRecent()

  // 页面重新可见/获得焦点时，刷新「最近打开」并重连实时。
  // 实时推送不一定可靠（连接可能被浏览器挂起），focus 兜底保证能看到其他设备的新文档。
  function resync() {
    if (document.visibilityState === 'hidden') return
    refreshRecent()
    startRealtime()
  }
  document.addEventListener('visibilitychange', resync)
  window.addEventListener('focus', resync)
  window.addEventListener('online', resync)

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
