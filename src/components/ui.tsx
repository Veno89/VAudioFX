import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Button({
  children,
  label,
  onClick,
  disabled,
  active,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`button ${active ? 'active' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
export function Range({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (value: number) => void;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="range-control">
      <label htmlFor={id}>
        <span>{label}</span>
        <output>{display ?? value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {help && <p className="help">{help}</p>}
    </div>
  );
}
export function NumberField({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="number-control" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        value={Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number)));
        }}
      />
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    previousFocus = useRef<HTMLElement | null>(
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    ),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = ref.current!;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, summary, [tabindex]',
          ),
        ).filter(
          (node) =>
            node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <Button label="Close dialog" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
export function formatTime(time: number): string {
  return `${Math.floor(time / 60)
    .toString()
    .padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}`;
}
