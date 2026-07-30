/**
 * Device PIN policy — the credential a person uses to sign in on the offline
 * desktop when there is no network to ask.
 *
 * Lives in @fnb/core because the Electron app must apply the SAME rules the
 * server does. A PIN the desktop accepts but the server would have rejected is
 * a credential that stops working the moment the machine reconnects.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/**
 * PINs that a person standing at the bar would guess in three tries. Blocking
 * them is worth more than adding a digit to the minimum length: the realistic
 * attacker here is a coworker who watched you type, not a cracking rig.
 */
const OBVIOUS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "1212", "2020", "6969",
  "000000", "111111", "123456", "654321", "121212", "112233",
]);

/** Digits only: it is typed on a numeric keypad, often on a touchscreen. */
const DIGITS_ONLY = /^\d+$/;

function isSequential(pin: string): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const step = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

function isRepeated(pin: string): boolean {
  return new Set(pin).size === 1;
}

/**
 * Returns null when the PIN is acceptable, or the reason it is not — phrased for
 * the person typing it, since that is where every one of these is shown.
 */
export function validatePin(pin: string): string | null {
  if (!DIGITS_ONLY.test(pin)) return "Use numbers only";
  if (pin.length < PIN_MIN_LENGTH) return `Use at least ${PIN_MIN_LENGTH} digits`;
  if (pin.length > PIN_MAX_LENGTH) return `Use at most ${PIN_MAX_LENGTH} digits`;
  if (OBVIOUS.has(pin) || isRepeated(pin) || isSequential(pin)) {
    return "That PIN is too easy to guess — avoid runs like 1234 and repeats like 1111";
  }
  return null;
}

/**
 * Recovery answers are compared after normalising, so "Manila " and "manila"
 * are the same answer. Applied identically before hashing and before checking —
 * if these two ever diverge, every recovery attempt fails and the break-glass is
 * welded shut.
 */
export function normalizeRecoveryAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, " ");
}

export const RECOVERY_ANSWER_MIN_LENGTH = 2;
