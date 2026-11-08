(() => {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const els = {
    empty: $('empty'),
    content: $('content'),
    title: $('title'),
    toc: $('toc'),
    tocList: $('tocList'),
    scrim: $('scrim'),
    fileInput: $('fileInput'),
  }

  const STORE = {
    theme: 'moji.theme',
    size: 'moji.size',
    doc: 'moji.lastDoc',
    name: 'moji.lastName',
  }

  // ---- 主题 ----
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t)
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#1c1d1a' : '#4a6b57')
    localStorage.setItem(STORE.theme, t)
  }
  applyTheme(localStorage.getItem(STORE.theme) || 'light')

  // ---- 字号 ----
  const SIZES = [15, 17, 19, 21, 23]
  let sizeIdx = Math.max(0, SIZES.indexOf(parseInt(localStorage.getItem(STORE.size), 10)))
  if (sizeIdx < 0) sizeIdx = 1
  function applySize() {
    document.documentElement.style.setProperty('--reader-size', SIZES[sizeIdx] + 'px')
    localStorage.setItem(STORE.size, String(SIZES[sizeIdx]))
  }
  applySize()

  // ---- marked 配置 ----
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

  function render(md, name) {
    const dirty = marked.parse(md)
    const clean = DOMPurify.sanitize(dirty, { ADD_ATTR: ['target', 'style', 'align'], ADD_TAGS: ['span', 'div'] })
    els.content.innerHTML = clean

    els.content.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block) } catch { /* 忽略高亮失败 */ }
    })

    // 为标题加 id 并构建目录
    const used = new Set()
    const toc = []
    els.content.querySelectorAll('h1, h2, h3').forEach((h) => {
      const id = slugify(h.textContent, used)
      h.id = id
      toc.push({ level: +h.tagName[1], text: h.textContent, id })
    })
    buildToc(toc)

    els.empty.hidden = true
    els.content.hidden = false
    if (name) {
      els.title.textContent = name
      document.title = name + ' · 墨记阅读'
    }
    window.scrollTo(0, 0)

    try {
      localStorage.setItem(STORE.doc, md)
      if (name) localStorage.setItem(STORE.name, name)
    } catch { /* 文档过大忽略 */ }
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

  function openToc() { els.toc.classList.add('show'); els.scrim.classList.add('show') }
  function closeToc() { els.toc.classList.remove('show'); els.scrim.classList.remove('show') }

  function readFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => render(String(reader.result), file.name)
    reader.onerror = () => alert('读取文件失败')
    reader.readAsText(file, 'utf-8')
  }

  // ---- 事件 ----
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

  const pick = () => els.fileInput.click()
  $('btnOpen').addEventListener('click', pick)
  $('btnOpenBig').addEventListener('click', pick)
  els.fileInput.addEventListener('change', (e) => readFile(e.target.files[0]))

  // 拖拽
  ;['dragover', 'drop'].forEach((ev) => {
    document.addEventListener(ev, (e) => { e.preventDefault() })
  })
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]
    if (f) readFile(f)
  })

  // ---- 启动：恢复上次文档 ----
  const last = localStorage.getItem(STORE.doc)
  if (last) render(last, localStorage.getItem(STORE.name) || '')
})()
