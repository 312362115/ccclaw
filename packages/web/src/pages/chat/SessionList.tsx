import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  onSelect: (workspaceId: string, sessionId: string) => void;
}

export function SessionList({ onSelect }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);

  useEffect(() => {
    api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {});
  }, []);

  const handleSelectWorkspace = (ws: Workspace) => {
    setSelectedWs(ws.id);
    // 使用工作区 ID 作为临时 sessionId（Task 16 实现真正的 session CRUD）
    onSelect(ws.id, `session-${ws.slug}`);
  };

  return (
    <div style={{ width: 240, borderRight: '1px solid #e0e0e0', overflow: 'auto' }}>
      <div style={{ padding: '12px 16px', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>
        工作区
      </div>
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          onClick={() => handleSelectWorkspace(ws)}
          style={{
            padding: '10px 16px', cursor: 'pointer', fontSize: 14,
            background: selectedWs === ws.id ? '#e8f0fe' : 'transparent',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {ws.name}
        </div>
      ))}
      {workspaces.length === 0 && (
        <div style={{ padding: 16, color: '#999', fontSize: 14 }}>暂无工作区</div>
      )}
    </div>
  );
}
