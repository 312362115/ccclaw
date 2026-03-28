/**
 * MemoryStore — 键值存储 + 分层记忆接口
 *
 * Agent 运行时可通过 MemoryStore 持久化上下文信息（如对话摘要、用户偏好等）。
 * 实现可以是内存、文件、数据库等。
 *
 * 分层记忆类型：
 * - decision: 决策记录，必须注入上下文
 * - feedback: 反馈记录，必须注入上下文
 * - project: 项目信息，作为索引摘要
 * - reference: 参考资料，作为索引摘要
 * - log: 日志条目，仅搜索时返回
 */

export type MemoryType = 'decision' | 'feedback' | 'project' | 'reference' | 'log';

export interface MemoryEntry {
  name: string;
  type: MemoryType;
  content: string;
  updatedAt: Date;
}

export interface MemoryStore {
  // 基础键值操作（向后兼容）
  /** 获取值，不存在时返回 undefined */
  get(key: string): string | undefined;
  /** 设置键值对 */
  set(key: string, value: string): void;
  /** 删除键 */
  delete(key: string): void;
  /** 获取所有键 */
  keys(): string[];

  // 分层记忆操作
  /** 插入或更新记忆条目 */
  upsertMemory(name: string, type: MemoryType, content: string): void;
  /** 获取记忆条目，可按类型过滤 */
  getMemories(type?: MemoryType): MemoryEntry[];
  /** 搜索记忆条目（关键词匹配 name + content） */
  searchMemories(query: string, limit?: number): MemoryEntry[];
}
