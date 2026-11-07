export type FileOpenedPayload = { filePath: string; content: string }

export interface MojiBridge {
  readFile(filePath: string): Promise<FileOpenedPayload>
  saveFile(payload: { filePath: string; content: string }): Promise<{ filePath: string }>
  saveFileAs(payload: { content: string; suggestedName?: string }): Promise<{ canceled: boolean; filePath?: string }>
  openDialog(): Promise<void>
  confirmDiscard(): Promise<boolean>
  setDirty(dirty: boolean): void
  setRepresentedFile(filePath: string): void
  onMenu(channel: string, handler: (...args: unknown[]) => void): () => void
}

declare global {
  interface Window {
    moji?: MojiBridge
  }
}

export {}
