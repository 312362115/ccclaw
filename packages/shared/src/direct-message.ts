export interface DirectMessage {
  channel: string;    // 'chat' | 'tree' | 'file' | 'terminal' | 'system'
  action: string;     // specific operation
  requestId?: string; // request-response pairing
  data: unknown;      // business payload
}

export interface DirectError {
  code: string;
  message: string;
}

// ====== Tree types ======
export interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtime?: number;
  children?: TreeEntry[];
}

export interface TreeListData { path: string; depth?: number; }
export interface TreeSnapshotData { path: string; truncated: boolean; entries: TreeEntry[]; }
export type TreeEventType = 'created' | 'deleted' | 'modified';
export interface TreeEvent {
  type: TreeEventType;
  path: string;
  entryType: 'file' | 'directory';
  size?: number;
  mtime?: number;
}
export interface TreeEventData { events: TreeEvent[]; }

// ====== File types ======
export interface FileReadData { path: string; }
export interface FileReadResult { path: string; content: string | null; size: number; mtime: number; binary: boolean; }
export interface FileCreateData { path: string; type: 'file' | 'directory'; content?: string; }
export interface FileCreateResult { success: boolean; path: string; }
export interface FileDeleteData { path: string; }
export interface FileDeleteResult { success: boolean; path: string; }
export interface FileWriteData { path: string; content: string; }
export interface FileWriteResult { success: boolean; path: string; size: number; mtime: number; }
export interface FileRenameData { oldPath: string; newPath: string; }
export interface FileRenameResult { success: boolean; oldPath: string; newPath: string; }
export interface FileStatData { path: string; }
export interface FileStatResult { path: string; type: 'file' | 'directory'; size: number; mtime: number; binary: boolean; }

// ====== Serialization ======
export function serializeDirectMessage(msg: DirectMessage): string {
  return JSON.stringify(msg);
}

export function parseDirectMessage(raw: string): DirectMessage {
  const parsed = JSON.parse(raw);
  if (typeof parsed.channel !== 'string' || typeof parsed.action !== 'string' || !('data' in parsed)) {
    throw new Error('Invalid DirectMessage: missing channel, action, or data');
  }
  return parsed as DirectMessage;
}
