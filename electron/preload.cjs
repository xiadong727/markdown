const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('moji', {
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
  saveFileAs: (payload) => ipcRenderer.invoke('file:save-as', payload),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirm-discard'),
  setDirty: (dirty) => ipcRenderer.send('doc:dirty', dirty),
  setRepresentedFile: (filePath) => ipcRenderer.send('doc:represented-file', filePath),
  onMenu: (channel, handler) => {
    const listener = (_e, ...args) => handler(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
