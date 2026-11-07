const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const fs = require('fs/promises')
const path = require('path')

const isDev = !!process.env.VITE_DEV_SERVER_URL
let mainWindow = null
let pendingOpenPath = null

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: '所有文件', extensions: ['*'] },
]

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#f4f5f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      openPathInRenderer(pendingOpenPath)
      pendingOpenPath = null
    }
  })

  mainWindow.on('close', (e) => {
    if (mainWindow.documentDirty) {
      e.preventDefault()
      confirmDiscard().then((ok) => {
        if (ok) {
          mainWindow.documentDirty = false
          mainWindow.close()
        }
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function confirmDiscard() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['放弃更改', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: '当前文件有未保存的更改',
    detail: '关闭后未保存的内容将丢失，确定继续吗？',
  })
  return response === 0
}

async function openPathInRenderer(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    mainWindow.webContents.send('file:opened', { filePath, content })
    app.addRecentDocument(filePath)
  } catch (err) {
    dialog.showErrorBox('打开失败', `无法读取文件：\n${filePath}\n\n${err.message}`)
  }
}

async function handleOpenDialog() {
  if (!mainWindow) return
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: MD_FILTERS,
  })
  if (!canceled && filePaths[0]) {
    mainWindow.webContents.send('menu:open-request', filePaths[0])
  }
}

function buildMenu() {
  const send = (channel) => () => mainWindow?.webContents.send(channel)
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about', label: '关于 墨记' }, { type: 'separator' }, { role: 'quit', label: '退出 墨记' }] }]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: send('menu:new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: handleOpenDialog },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { label: '另存为…', accelerator: 'Shift+CmdOrCtrl+S', click: send('menu:save-as') },
      ],
    },
    { label: '编辑', role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { label: '仅编辑', accelerator: 'CmdOrCtrl+1', click: send('menu:mode-edit') },
        { label: '分栏', accelerator: 'CmdOrCtrl+2', click: send('menu:mode-split') },
        { label: '仅预览', accelerator: 'CmdOrCtrl+3', click: send('menu:mode-preview') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    { label: '窗口', role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.handle('file:read', async (_e, filePath) => {
  const content = await fs.readFile(filePath, 'utf-8')
  app.addRecentDocument(filePath)
  return { filePath, content }
})

ipcMain.handle('file:save', async (_e, { filePath, content }) => {
  await fs.writeFile(filePath, content, 'utf-8')
  return { filePath }
})

ipcMain.handle('file:save-as', async (_e, { content, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName || '未命名.md',
    filters: MD_FILTERS,
  })
  if (canceled || !filePath) return { canceled: true }
  await fs.writeFile(filePath, content, 'utf-8')
  app.addRecentDocument(filePath)
  return { canceled: false, filePath }
})

ipcMain.handle('dialog:open', handleOpenDialog)

ipcMain.handle('dialog:confirm-discard', confirmDiscard)

ipcMain.on('doc:dirty', (_e, dirty) => {
  if (mainWindow) {
    mainWindow.documentDirty = dirty
    mainWindow.setDocumentEdited(dirty)
  }
})

ipcMain.on('doc:represented-file', (_e, filePath) => {
  if (mainWindow && filePath) mainWindow.setRepresentedFilename(filePath)
})

app.on('open-file', (e, filePath) => {
  e.preventDefault()
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('menu:open-request', filePath)
  } else {
    pendingOpenPath = filePath
  }
})

app.whenReady().then(() => {
  const argPath = process.argv.find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
  if (argPath) pendingOpenPath = argPath
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
