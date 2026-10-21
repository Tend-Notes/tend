// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Parts of the File System Access API that lib.dom does not declare.
//
// Two gaps: directory iteration lives in DOM.AsyncIterable (not in this
// project's `lib` list), and the permission methods plus `showDirectoryPicker`
// are Chromium extensions that TypeScript does not ship at all.
//
// Local-folder gardens are Edge-only by design, so these are declared rather
// than feature-detected in types — but every call site still checks at runtime,
// because another browser will simply not have them.

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt'

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<FileSystemPermissionState>
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<FileSystemPermissionState>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  keys(): AsyncIterableIterator<string>
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: string | FileSystemHandle
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}
