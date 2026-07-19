import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface QuantityInputProps extends Omit<React.ComponentProps<"input">, "type" | "inputMode"> {
  /** Allow a decimal point (default true). Set false for whole-number fields. */
  allowDecimal?: boolean;
}

/**
 * Numeric-entry input (client request #14): only digits and at most one
 * decimal point can be typed or pasted. A rejected keystroke flashes the
 * invalid ring and raises a single deduped toast — the field stays a plain
 * text input (`inputMode="decimal"` for mobile keypads) to avoid the native
 * number-input quirks (scroll-to-change, silent exponent keys).
 *
 * Drop-in for `<Input type="number" step="any" min="0">`: same value/onChange
 * contract. Submit-time `Number()` validation in the forms stays as the
 * backstop for empty/edge values.
 *
 * ponytail: locale decimal-comma entry is out of scope — the app renders
 * dot-decimal everywhere; revisit only if a client asks for comma input.
 */
export function QuantityInput({ allowDecimal = true, onKeyDown, onPaste, ...props }: QuantityInputProps) {
  const [rejected, setRejected] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const reject = () => {
    toast.error(allowDecimal ? "Numbers only in this field" : "Whole numbers only in this field", {
      id: "quantity-input-numeric",
    });
    setRejected(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRejected(false), 900);
  };

  // Validate the PROSPECTIVE value — what the field would contain after the
  // keystroke/paste replaces the current selection. Checking the raw
  // concatenation would wrongly reject select-all-then-type over a value
  // that already contains a decimal point.
  const prospective = (el: HTMLInputElement, inserted: string) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    return el.value.slice(0, start) + inserted + el.value.slice(end);
  };
  const isValidValue = (value: string) => {
    if (!/^[0-9.]*$/.test(value)) return false;
    if (!allowDecimal && value.includes(".")) return false;
    return value.split(".").length - 1 <= 1;
  };

  return (
    <Input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      autoComplete="off"
      aria-invalid={rejected || undefined}
      onKeyDown={(e) => {
        // Let through shortcuts (copy/paste/select-all) and control keys
        // (Backspace, Tab, Enter, arrows — all have multi-char key names).
        if (!(e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1)) {
          if (!isValidValue(prospective(e.currentTarget, e.key))) {
            e.preventDefault();
            reject();
          }
        }
        onKeyDown?.(e);
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text");
        if (!isValidValue(prospective(e.currentTarget, text.trim()))) {
          e.preventDefault();
          reject();
        }
        onPaste?.(e);
      }}
      {...props}
    />
  );
}
