interface Props {
  title: string;
  message: string;
  detail?: string;
  onApprove: () => void;
  onReject: () => void;
}

export function ConfirmDialog({ title, message, detail, onApprove, onReject }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 24, maxWidth: 480, width: '90%',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 12px', color: '#d93025' }}>{title}</h3>
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>{message}</p>
        {detail && (
          <pre style={{ margin: '0 0 16px', fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
            {detail}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onReject}
            style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 4, background: '#d93025', color: '#fff', cursor: 'pointer' }}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
