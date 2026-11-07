import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {
  FileText, FolderOpen, Save, SaveAll, FilePlus2,
  PenLine, Columns2, BookOpen,
} from 'lucide-react'
import 'highlight.js/styles/github.css'

type ViewMode = 'edit' | 'split' | 'preview'

const WELCOME = `# 欢迎使用 墨记

一个简洁的本地 **Markdown** 编辑与阅读工具。

## 快速上手

- \`⌘O\` 打开文件 · \`⌘S\` 保存 · \`⇧⌘S\` 另存为 · \`⌘N\` 新建
- \`⌘1\` 仅编辑 · \`⌘2\` 分栏 · \`⌘3\` 仅预览

## 支持的语法

支持 GFM：表格、任务列表、删除线、代码高亮等。

| 功能 | 状态 |
| ---- | ---- |
| 实时预览 | ✅ |
| 代码高亮 | ✅ |

- [x] 打开 / 编辑 / 保存
- [ ] 开始写点什么吧…

\`\`\`js
console.log('Hello, 墨记!')
\`\`\`
`

function baseName(p: string | null) {
  if (!p) return '未命名'
  return p.split('/').pop() ?? p
}

export default function App() {
  const [content, setContent] = useState(WELCOME)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<ViewMode>('split')
  const [status, setStatus] = useState('')

  const stateRef = useRef({ content, filePath, dirty })
  stateRef.current = { content, filePath, dirty }

  const bridge = window.moji

  const flashStatus = useCallback((msg: string) => {
    setStatus(msg)
    window.setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2500)
  }, [])

  const markDirty = useCallback((d: boolean) => {
    setDirty(d)
    bridge?.setDirty(d)
  }, [bridge])

  const loadFile = useCallback((fp: string, text: string) => {
    setContent(text)
    setFilePath(fp)
    markDirty(false)
    bridge?.setRepresentedFile(fp)
    flashStatus(`已打开 ${baseName(fp)}`)
  }, [bridge, markDirty, flashStatus])

  const doSave = useCallback(async (saveAs = false) => {
    if (!bridge) return
    const { content: text, filePath: fp } = stateRef.current
    try {
      if (!saveAs && fp) {
        await bridge.saveFile({ filePath: fp, content: text })
        markDirty(false)
        flashStatus('已保存')
      } else {
        const res = await bridge.saveFileAs({
          content: text,
          suggestedName: fp ? baseName(fp) : '未命名.md',
        })
        if (!res.canceled && res.filePath) {
          setFilePath(res.filePath)
          bridge.setRepresentedFile(res.filePath)
          markDirty(false)
          flashStatus(`已保存到 ${baseName(res.filePath)}`)
        }
      }
    } catch (err) {
      flashStatus(`保存失败：${(err as Error).message}`)
    }
  }, [bridge, markDirty, flashStatus])

  const doNew = useCallback(async () => {
    if (stateRef.current.dirty && bridge) {
      const ok = await bridge.confirmDiscard()
      if (!ok) return
    }
    setContent('')
    setFilePath(null)
    markDirty(false)
    flashStatus('新建文档')
  }, [bridge, markDirty, flashStatus])

  const doOpen = useCallback(() => bridge?.openDialog(), [bridge])

  const openPath = useCallback(async (fp: string) => {
    if (!bridge) return
    if (stateRef.current.dirty) {
      const ok = await bridge.confirmDiscard()
      if (!ok) return
    }
    try {
      const { content: text } = await bridge.readFile(fp)
      loadFile(fp, text)
    } catch (err) {
      flashStatus(`打开失败：${(err as Error).message}`)
    }
  }, [bridge, loadFile, flashStatus])

  useEffect(() => {
    if (!bridge) return
    const subs = [
      bridge.onMenu('file:opened', (payload) => {
        const { filePath: fp, content: text } = payload as { filePath: string; content: string }
        loadFile(fp, text)
      }),
      bridge.onMenu('menu:open-request', (fp) => openPath(fp as string)),
      bridge.onMenu('menu:new', doNew),
      bridge.onMenu('menu:save', () => doSave(false)),
      bridge.onMenu('menu:save-as', () => doSave(true)),
      bridge.onMenu('menu:mode-edit', () => setMode('edit')),
      bridge.onMenu('menu:mode-split', () => setMode('split')),
      bridge.onMenu('menu:mode-preview', () => setMode('preview')),
    ]
    return () => subs.forEach((off) => off())
  }, [bridge, loadFile, openPath, doNew, doSave])

  const onChange = useCallback((value: string) => {
    setContent(value)
    if (!stateRef.current.dirty) markDirty(true)
  }, [markDirty])

  const extensions = useMemo(() => [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
  ], [])

  const stats = useMemo(() => {
    const chars = content.length
    const lines = content.length ? content.split('\n').length : 0
    return `${lines} 行 · ${chars} 字符`
  }, [content])

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="brand"><FileText size={16} /> 墨记</span>
          <span className="divider" />
          <button className="btn" onClick={doNew} title="新建 (⌘N)"><FilePlus2 size={15} /></button>
          <button className="btn" onClick={doOpen} title="打开 (⌘O)"><FolderOpen size={15} /></button>
          <button className="btn" onClick={() => doSave(false)} title="保存 (⌘S)"><Save size={15} /></button>
          <button className="btn" onClick={() => doSave(true)} title="另存为 (⇧⌘S)"><SaveAll size={15} /></button>
        </div>
        <div className="toolbar-title">
          {baseName(filePath)}{dirty ? ' •' : ''}
        </div>
        <div className="toolbar-right">
          <div className="mode-group">
            <button className={`btn ${mode === 'edit' ? 'active' : ''}`} onClick={() => setMode('edit')} title="仅编辑 (⌘1)"><PenLine size={15} /></button>
            <button className={`btn ${mode === 'split' ? 'active' : ''}`} onClick={() => setMode('split')} title="分栏 (⌘2)"><Columns2 size={15} /></button>
            <button className={`btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => setMode('preview')} title="仅预览 (⌘3)"><BookOpen size={15} /></button>
          </div>
        </div>
      </header>

      <main className={`workspace mode-${mode}`}>
        {mode !== 'preview' && (
          <section className="pane editor-pane">
            <CodeMirror
              value={content}
              onChange={onChange}
              extensions={extensions}
              basicSetup={{ foldGutter: false, highlightActiveLine: true }}
              placeholder="开始输入 Markdown…"
              autoFocus
            />
          </section>
        )}
        {mode !== 'edit' && (
          <section className="pane preview-pane">
            <article className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {content}
              </ReactMarkdown>
            </article>
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span>{filePath ?? '未保存到磁盘'}</span>
        <span className="statusbar-right">
          {status && <span className="status-flash">{status}</span>}
          <span>{stats}</span>
        </span>
      </footer>
    </div>
  )
}
