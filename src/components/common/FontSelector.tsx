/**
 * Font selector — a proper dropdown for choosing fonts.
 *
 * Replaces the raw text inputs that previously let users type arbitrary
 * font names. Each option is rendered in its own font so the user can
 * preview the appearance before selecting.
 */

import { useEffect, useRef, useState } from 'react';
import {
  BODY_FONTS,
  CODE_FONTS,
  findFont,
  type FontOption,
} from '@/lib/fonts/fontCatalog';
import { ChevronDown, Check } from '@/components/common/Icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Restrict to a category. */
  category?: 'body' | 'code';
  label?: string;
  id?: string;
}

export function FontSelector({ value, onChange, category, label, id }: Props) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fonts: FontOption[] = category === 'body' ? BODY_FONTS : category === 'code' ? CODE_FONTS : [...BODY_FONTS, ...CODE_FONTS];

  const selected = findFont(value);
  const displayLabel = selected?.label ?? value ?? 'Select font…';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, fonts.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const f = fonts[highlightIdx];
        if (f) {
          onChange(f.value);
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, fonts, highlightIdx, onChange]);

  // Reset highlight when opening.
  useEffect(() => {
    if (open) {
      const idx = fonts.findIndex((f) => f.value === value);
      setHighlightIdx(idx >= 0 ? idx : 0);
    }
  }, [open, fonts, value]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label htmlFor={id} className="label block mb-1">
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="truncate"
          style={{ fontFamily: selected?.stack ?? value }}
        >
          {displayLabel}
        </span>
        <ChevronDown size={14} className="text-muted ml-2 flex-shrink-0" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-lg"
          style={{
            background: 'var(--color-surface-elevated)',
            borderColor: 'var(--color-border)',
          }}
        >
          {fonts.map((f, idx) => {
            const isSelected = f.value === value;
            const isHighlighted = idx === highlightIdx;
            return (
              <button
                key={f.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(f.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                style={{
                  background: isHighlighted
                    ? 'var(--color-surface)'
                    : 'transparent',
                  color: 'var(--color-text-primary)',
                }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate"
                    style={{ fontFamily: f.stack, fontSize: 14 }}
                  >
                    {f.label}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wide text-muted"
                  >
                    {f.category}
                  </div>
                </div>
                {isSelected && (
                  <Check
                    size={14}
                    className="ml-2 flex-shrink-0"
                    style={{ color: 'var(--color-accent)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
