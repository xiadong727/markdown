// 墨记 · 云同步 + AI 层。暴露全局 MojiCloud。
(() => {
  'use strict'

  const SUPABASE_URL = 'https://uriexaurqzndddnefzfk.supabase.co'
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaWV4YXVycXpuZGRkbmVmemZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzOTIxNDMsImV4cCI6MjEwOTk2ODE0M30.rPFwivc_xZGLhlNGRPiNCarSnZ60fk1V-P_jnYSPr1E'

  const KEY = {
    space: 'moji.spaceKey',
    ai: 'moji.ai',
  }

  let sb = null
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false },
    })
  } catch (e) { /* 库未加载 */ }

  // ---- 口令（space_key）----
  function getSpace() { return localStorage.getItem(KEY.space) || '' }
  function setSpace(k) { localStorage.setItem(KEY.space, (k || '').trim()) }
  function hasSpace() { return !!getSpace() }

  // ---- AI 配置 ----
  function getAI() {
    try { return JSON.parse(localStorage.getItem(KEY.ai) || '{}') }
    catch { return {} }
  }
  function setAI(cfg) { localStorage.setItem(KEY.ai, JSON.stringify(cfg || {})) }
  function hasAI() {
    const a = getAI()
    return !!(a.baseUrl && a.model && a.apiKey)
  }

  function ready() { return !!sb && hasSpace() }

  // ---- 文档 CRUD ----
  async function listDocs() {
    if (!ready()) return []
    const { data, error } = await sb
      .from('docs')
      .select('id,name,updated_at')
      .eq('space_key', getSpace())
      .order('updated_at', { ascending: false })
    if (error) throw error
    return data || []
  }

  async function getDoc(id) {
    const { data, error } = await sb
      .from('docs')
      .select('*')
      .eq('id', id)
      .eq('space_key', getSpace())
      .single()
    if (error) throw error
    return data
  }

  // 按文件名在当前 space 查一篇（用于本地打开自动上云的去重）
  async function findDocByName(name) {
    if (!ready() || !name) return null
    const { data, error } = await sb
      .from('docs')
      .select('*')
      .eq('space_key', getSpace())
      .eq('name', name)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return (data && data[0]) || null
  }

  // 标记"最近打开"：仅更新 updated_at，不产生版本快照
  async function touchDoc(id) {
    try {
      await sb.from('docs')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id).eq('space_key', getSpace())
    } catch (e) { /* ignore */ }
  }

  // 新建文档，返回其记录
  async function createDoc(name, content, notes) {
    const { data, error } = await sb
      .from('docs')
      .insert({ space_key: getSpace(), name: name || '未命名.md', content: content || '', notes: notes || [] })
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  // 保存：更新内容 + 存一条版本快照
  async function saveDoc(id, name, content, notes) {
    const { data, error } = await sb
      .from('docs')
      .update({ name, content, notes: notes || [], updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('space_key', getSpace())
      .select('*')
      .single()
    if (error) throw error
    // 版本快照（失败不影响保存）
    try {
      await sb.from('doc_versions').insert({
        doc_id: id, space_key: getSpace(), name, content,
      })
    } catch (e) { /* ignore */ }
    return data
  }

  async function deleteDoc(id) {
    const { error } = await sb
      .from('docs').delete()
      .eq('id', id).eq('space_key', getSpace())
    if (error) throw error
  }

  // ---- 版本历史 ----
  async function listVersions(docId) {
    const { data, error } = await sb
      .from('doc_versions')
      .select('id,name,content,created_at')
      .eq('doc_id', docId)
      .eq('space_key', getSpace())
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  }

  // ---- 实时订阅：当前 space 下 docs 变化 ----
  function subscribe(onChange) {
    if (!ready()) return null
    const ch = sb
      .channel('docs-' + getSpace())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'docs', filter: 'space_key=eq.' + getSpace() },
        (payload) => { try { onChange(payload) } catch (e) { /* ignore */ } })
      .subscribe()
    return ch
  }
  function unsubscribe(ch) { if (ch && sb) try { sb.removeChannel(ch) } catch (e) { /* ignore */ } }

  // ---- AI 润色（OpenAI 兼容 chat/completions）----
  async function polish(text, instruction) {
    const a = getAI()
    if (!a.baseUrl || !a.model || !a.apiKey) throw new Error('AI 未配置')
    const url = a.baseUrl.replace(/\/+$/, '') + '/chat/completions'
    const sys = '你是中文写作润色助手。请在不改变原意的前提下，让文字更通顺、准确、简洁。' +
      '只输出润色后的正文本身，不要加任何解释、前后缀或引号。'
    const user = (instruction ? ('要求：' + instruction + '\n\n') : '') + '待润色文字：\n' + text
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + a.apiKey,
      },
      body: JSON.stringify({
        model: a.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        stream: false,
      }),
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).error?.message || '' } catch { detail = await res.text().catch(() => '') }
      throw new Error('AI 请求失败 ' + res.status + (detail ? '：' + detail : ''))
    }
    const json = await res.json()
    const out = json.choices?.[0]?.message?.content
    if (!out) throw new Error('AI 返回为空')
    return out.trim()
  }

  window.MojiCloud = {
    available: () => !!sb,
    getSpace, setSpace, hasSpace,
    getAI, setAI, hasAI,
    ready,
    listDocs, getDoc, findDocByName, createDoc, saveDoc, deleteDoc,
    touchDoc,
    listVersions,
    subscribe, unsubscribe,
    polish,
  }
})()
