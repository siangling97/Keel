// Small building blocks used on every page. Plain Tailwind classes, no UI library,
// so every style choice is visible right here.

import { useId } from 'react';

// Each variant sets its own padding, so two padding classes never fight each other.
const BUTTON = {
  primary: 'h-10 px-4 bg-primary text-white hover:bg-primary-hover disabled:opacity-50',
  secondary: 'h-10 px-4 border border-rule-strong bg-surface text-ink hover:border-ink-2 disabled:opacity-50',
  quiet: 'py-0.5 text-primary hover:underline underline-offset-4 disabled:opacity-50',
  danger: 'py-0.5 text-loss hover:underline underline-offset-4 disabled:opacity-50',
};

export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-[15px] font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

/** A labeled input. `hint` sits under the label; `error` replaces it in red. */
export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const describedBy = error || hint ? `${id}-note` : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {(error || hint) && (
        <p id={`${id}-note`} className={`text-sm ${error ? 'text-loss' : 'text-muted'}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'h-10 w-full rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-loss';

export const Input = ({ className = '', ...props }) => <input className={`${CONTROL} ${className}`} {...props} />;
export const Select = ({ className = '', ...props }) => <select className={`${CONTROL} ${className}`} {...props} />;

/**
 * A row of mutually exclusive choices (radio group) that looks like a segmented control.
 * options: [{ value, label, hint? }]
 */
export function Choice({ legend, value, onChange, options, name }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer flex-col rounded-[var(--radius-control)] border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                selected ? 'border-primary bg-primary-soft' : 'border-rule-strong bg-surface hover:border-ink-2'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className={`text-[15px] font-semibold ${selected ? 'text-primary' : 'text-ink'}`}>{option.label}</span>
              {option.hint && <span className="text-sm text-muted">{option.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** On/off switch (a checkbox underneath, so keyboards and screen readers just work). */
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[15px]">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full bg-rule-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
      />
      <span>{label}</span>
    </label>
  );
}

const ALERT = {
  warning: { box: 'bg-warn-soft text-warn', icon: '!' },
  error: { box: 'bg-loss-soft text-loss', icon: '×' },
  info: { box: 'bg-primary-soft text-primary', icon: 'i' },
};

/** A message box with an icon, so meaning never depends on color alone. */
export function Alert({ tone = 'warning', title, children, items }) {
  const style = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-[var(--radius-control)] px-4 py-3 text-[15px] ${style.box}`}>
      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
        {style.icon}
      </span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children}
        {items?.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Show an ApiError: its message, plus field details when the server sent them. */
export function ErrorAlert({ error }) {
  if (!error) return null;
  const items = (error.details ?? []).map((d) => (d.field ? `${d.field}: ${d.message}` : d.message));
  return <Alert tone="error" title={error.message} items={items} />;
}

/** Warnings from the engines, if any. */
export function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return <Alert tone="warning" title={warnings.length === 1 ? warnings[0] : 'Check these'} items={warnings.length > 1 ? warnings : undefined} />;
}

const ACTION_STYLE = {
  BUY: 'bg-primary-soft text-primary',
  SELL: 'bg-loss-soft text-loss',
  HOLD: 'bg-paper text-ink-2',
};
const ACTION_LABEL = { BUY: 'Buy', SELL: 'Sell', HOLD: 'Hold' };

export function ActionBadge({ action }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${ACTION_STYLE[action]}`}>{ACTION_LABEL[action]}</span>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[65ch]">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.015em]">{title}</h1>
        {children && <div className="mt-2 text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

export function Section({ title, description, actions, children, className = '' }) {
  return (
    <section className={`mt-12 first:mt-0 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[21px] font-bold tracking-[-0.01em]">{title}</h2>}
            {description && <p className="mt-1 max-w-[65ch] text-ink-2">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <p className="py-10 text-muted" role="status">
      {label}…
    </p>
  );
}

/** Gain/loss in its color, with a sign, so it reads without color too. */
export function GainLoss({ value, children }) {
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-ink-2';
  return <span className={tone}>{children}</span>;
}

/** Table with the app's styling. Numbers go in cells with className="num text-right". */
export function Table({ caption, children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-[15px] [&_td]:border-b [&_td]:border-rule [&_td]:px-3 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-rule-strong [&_th]:px-3 [&_th]:py-2 [&_th]:text-sm [&_th]:font-semibold [&_th]:text-ink-2 [&_tr>*:first-child]:pl-0 [&_tr>*:last-child]:pr-0">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
