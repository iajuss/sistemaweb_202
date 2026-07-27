"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export type StyledSelectOption = { value: string; label: string; disabled?: boolean };

type StyledSelectProps = {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Select com lista própria para que a opção ativa não dependa da cor azul
 * imposta pelo sistema operacional nos menus nativos.
 */
export function StyledSelect({ value, options, onChange, ariaLabel, className = "", disabled = false }: StyledSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const select = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const index = Math.max(0, enabled.findIndex((option) => option.value === value));
    const nextIndex = event.key === "ArrowDown" ? Math.min(enabled.length - 1, index + 1) : Math.max(0, index - 1);
    if (enabled[nextIndex]) select(enabled[nextIndex].value);
  };

  return <div className={`styled-select ${className}`.trim()} ref={rootRef}>
    <button
      type="button"
      className="styled-select-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-controls={listId}
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((wasOpen) => !wasOpen)}
      onKeyDown={onKeyDown}
    >
      <span>{selected?.label ?? ""}</span><i aria-hidden="true" />
    </button>
    {open && <div id={listId} className="styled-select-options" role="listbox" aria-label={ariaLabel}>
      {options.map((option) => <button
        type="button"
        key={option.value}
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? "selected" : ""}
        disabled={option.disabled}
        onClick={() => select(option.value)}
      >{option.label}</button>)}
    </div>}
  </div>;
}
