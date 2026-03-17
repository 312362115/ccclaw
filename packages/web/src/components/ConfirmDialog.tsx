interface Props {
  title: string;
  message: string;
  detail?: string;
  onApprove: () => void;
  onReject: () => void;
}

export function ConfirmDialog({ title, message, detail, onApprove, onReject }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
      <div className="bg-white rounded-2xl p-6 max-w-md w-[90%] shadow-lg">
        <h3 className="text-base font-bold mb-3 text-danger">{title}</h3>
        <p className="text-sm mb-2">{message}</p>
        {detail && (
          <pre className="mb-4 text-xs bg-slate-50 border border-line p-2.5 rounded-lg overflow-auto max-h-[200px]">
            {detail}
          </pre>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onReject}
            className="px-4 py-2 border border-line rounded-lg bg-white text-sm hover:bg-slate-50 transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            className="px-4 py-2 rounded-lg bg-danger text-white text-sm hover:bg-red-600 transition-colors"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
