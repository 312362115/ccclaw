interface CardProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function Card({ label, value, accent }: CardProps) {
  return (
    <div className="bg-slate-50 border border-line rounded-2xl p-5 min-h-[120px] transition-all duration-200 hover:border-slate-300 hover:shadow-sm">
      <div className="text-[13px] text-text-muted mb-2">{label}</div>
      <div className={`text-[28px] font-bold ${accent ? 'text-accent' : 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  );
}
