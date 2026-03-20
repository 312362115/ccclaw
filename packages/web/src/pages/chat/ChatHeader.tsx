import { TerminalIcon, FileIcon } from '../../components/icons';

interface Props {
  title: string;
  aiStatus: 'idle' | 'thinking' | 'typing' | 'disconnected';
  planMode?: boolean;
  terminalOpen: boolean;
  filePreviewOpen: boolean;
  onToggleTerminal: () => void;
  onToggleFilePreview: () => void;
}

const dotConfig = {
  idle:         { color: 'bg-emerald-400', glow: '', ring: '' },
  thinking:     { color: 'bg-emerald-400', glow: 'shadow-[0_0_6px_rgba(52,211,153,0.7)]', ring: 'ring-emerald-400/30' },
  typing:       { color: 'bg-emerald-400', glow: 'shadow-[0_0_6px_rgba(52,211,153,0.7)]', ring: 'ring-emerald-400/30' },
  disconnected: { color: 'bg-red-400',     glow: 'shadow-[0_0_6px_rgba(248,113,113,0.7)]', ring: 'ring-red-400/30' },
};

function StatusDot({ status }: { status: Props['aiStatus'] }) {
  const cfg = dotConfig[status];
  const breathing = status !== 'idle';

  return (
    <span className="relative inline-flex items-center justify-center w-4 h-4 shrink-0">
      {/* 外圈呼吸光晕 */}
      {breathing && (
        <span
          className={`absolute w-3 h-3 rounded-full ${cfg.color} opacity-30`}
          style={{ animation: 'status-breathe 2s ease-in-out infinite' }}
        />
      )}
      {/* 内圈实心点 */}
      <span
        className={`relative w-[7px] h-[7px] rounded-full ${cfg.color} ${cfg.glow}`}
        style={breathing ? { animation: 'status-pulse 2s ease-in-out infinite' } : undefined}
      />
    </span>
  );
}

export function ChatHeader({ title, aiStatus, planMode, terminalOpen, filePreviewOpen, onToggleTerminal, onToggleFilePreview }: Props) {
  return (
    <div className="flex items-center justify-between px-5 border-b border-line-soft gap-3 min-h-14">
      {/* 左：标题 + 状态点 + Plan 徽章 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <h3 className="text-[15px] font-bold whitespace-nowrap overflow-hidden text-ellipsis">
          {title}
        </h3>
        <StatusDot status={aiStatus} />
        {planMode && (
          <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full shrink-0">
            📋 计划模式
          </span>
        )}
      </div>

      {/* 右：操作按钮 */}
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onToggleTerminal}
          className={`w-[34px] h-[34px] rounded-lg flex items-center justify-center transition-all duration-200 ${
            terminalOpen
              ? 'bg-accent-soft text-accent'
              : 'text-text-muted hover:bg-slate-100 hover:text-text-primary'
          }`}
        >
          <TerminalIcon className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={onToggleFilePreview}
          className={`w-[34px] h-[34px] rounded-lg flex items-center justify-center transition-all duration-200 ${
            filePreviewOpen
              ? 'bg-accent-soft text-accent'
              : 'text-text-muted hover:bg-slate-100 hover:text-text-primary'
          }`}
        >
          <FileIcon className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
