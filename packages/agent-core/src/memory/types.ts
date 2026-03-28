/**
 * MemoryStore — 键值存储接口
 *
 * Agent 运行时可通过 MemoryStore 持久化上下文信息（如对话摘要、用户偏好等）。
 * 实现可以是内存、文件、数据库等。
 */

export interface MemoryStore {
  /** 获取值，不存在时返回 undefined */
  get(key: string): string | undefined;
  /** 设置键值对 */
  set(key: string, value: string): void;
  /** 删除键 */
  delete(key: string): void;
  /** 获取所有键 */
  keys(): string[];
}
