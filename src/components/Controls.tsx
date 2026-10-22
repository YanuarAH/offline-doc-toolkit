import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/format'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: LucideIcon
  disabled?: boolean
}

interface SegmentedProps<T extends string> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
  compact?: boolean
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  compact = false,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'grid gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 font-medium transition',
              compact ? 'py-1.5 text-[10.5px]' : 'py-2 text-[11.5px]',
              active
                ? 'bg-white/[0.075] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]'
                : 'text-ink-400 hover:bg-white/[0.03] hover:text-ink-200',
              option.disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent',
            )}
          >
            <span className="flex items-center gap-1.5">
              {Icon ? (
                <Icon size={compact ? 11 : 13} className={active ? 'text-accent' : undefined} />
              ) : null}
              {option.label}
            </span>
            {option.hint ? (
              <span className="text-[9px] font-normal text-ink-400">{option.hint}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
  hint?: string
  disabled?: boolean
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  hint,
  disabled = false,
}: SliderFieldProps) {
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const fill = `linear-gradient(to right, #5eead4 0%, #5eead4 ${percent}%, #1d2634 ${percent}%, #1d2634 100%)`

  return (
    <div className={cn('space-y-2', disabled && 'pointer-events-none opacity-40')}>
      <div className="field-label">
        <span className="flex items-baseline gap-1.5">
          {label}
          {hint ? <span className="text-[9.5px] font-normal text-ink-500">{hint}</span> : null}
        </span>
        <span className="value-badge">{display}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ background: fill }}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (!Number.isNaN(next)) onChange(next)
        }}
      />
    </div>
  )
}
