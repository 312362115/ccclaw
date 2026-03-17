interface Props {
  children: React.ReactNode;
}

export function ContentPageShell({ children }: Props) {
  return (
    <div className="flex-1 min-w-0 flex p-3">
      <div className="flex-1 bg-white border border-line-soft rounded-[20px] shadow-md flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  );
}
