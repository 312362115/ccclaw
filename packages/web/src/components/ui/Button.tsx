interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'icon';
  size?: 'sm' | 'md';
}

const variants = {
  primary: 'bg-accent text-white hover:bg-accent-ink shadow-sm',
  ghost: 'border border-line bg-white text-text-primary hover:bg-slate-50 hover:border-slate-300',
  danger: 'bg-danger text-white hover:bg-red-600 shadow-sm',
  icon: 'text-text-muted hover:bg-slate-100 hover:text-text-primary',
};

const sizes = {
  sm: 'px-3 py-1 text-xs rounded-lg',
  md: 'px-4 py-1.5 text-sm rounded-lg',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  const isIcon = variant === 'icon';
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        isIcon ? 'w-8 h-8 rounded-lg' : sizes[size]
      } ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
