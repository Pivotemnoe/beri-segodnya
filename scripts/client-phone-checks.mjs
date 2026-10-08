import assert from "node:assert/strict";
import { Script } from "node:vm";

export function runClientPhoneChecks(publicSource) {
  const source = publicSource.match(/  function russianPhoneDigits\([\s\S]*?(?=\n  function humanError)/)?.[0];
  assert.ok(source, "Russian phone mask is missing");
  const listeners = {};
  const input = {
    value: "", selectionStart: 0, selectionEnd: 0,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    setCustomValidity(message) { this.validityMessage = message; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  };
  const phone = new Script(source + "; ({russianPhoneDigits, formatRussianPhone, setupRussianPhoneInputs});").runInNewContext({document: {querySelectorAll: () => [input]}});
  phone.setupRussianPhoneInputs();
  function reset() { input.value = ""; input.setSelectionRange(0, 0); listeners.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  function insert(value) {
    input.value = input.value.slice(0, input.selectionStart) + value + input.value.slice(input.selectionEnd);
    input.setSelectionRange(input.value.length, input.value.length);
    listeners.input();
  }
  function remove(inputType = "deleteContentBackward") {
    let prevented = false;
    listeners.beforeinput({inputType, cancelable: true, preventDefault: () => { prevented = true; }});
    assert.ok(prevented, "Masked deletion was not handled");
  }
  for (const number of ["9001234567", "89001234567", "79001234567"]) {
    reset(); insert(number);
    assert.equal(input.value, "+7 (900) 123-45-67", "Pasted number was not normalized: " + number);
  }
  for (const number of ["9001234567", "89001234567"]) {
    reset(); for (const digit of number) insert(digit);
    assert.equal(input.value, "+7 (900) 123-45-67", "Typed number was not normalized: " + number);
    assert.equal(input.validityMessage, "");
    for (let index = 0; index < 10; index++) remove();
    assert.equal(input.value, "+7 (", "Backspace is stuck on mask punctuation");
    remove(); assert.equal(input.value, "+7 (", "Country prefix was deleted");
    assert.ok(input.validityMessage, "Incomplete number became valid");
  }
  reset(); insert("9001234567"); input.setSelectionRange(7, 7); remove();
  for (const number of ["8613712345", "88613712345", "78613712345", "+7 (861) 371-23-45"]) {
    reset(); insert(number);
    assert.equal(input.value, "+7 (861) 371-23-45", "Landline code was mistaken for a trunk prefix: " + number);
  }
  reset(); for (const digit of "8613712345") insert(digit);
  assert.equal(input.value, "+7 (861) 371-23-45", "Typed landline area code was changed");
  reset(); insert("9001234567"); input.setSelectionRange(7, 7); remove();
  assert.equal(input.value, "+7 (901) 234-56-7", "Deletion before closing bracket removed the wrong digit");
  reset(); insert("9001234567"); input.setSelectionRange(7, 7); remove("deleteContentForward");
  assert.equal(input.value, "+7 (900) 234-56-7", "Forward deletion after area code is incorrect");
  input.setSelectionRange(4, 4); remove(); assert.ok(input.value.startsWith("+7 ("));
  reset(); insert("90012"); assert.ok(input.validityMessage);
  input.value = ""; listeners.blur(); assert.equal(input.value, "");
  console.log("Client phone checks passed: typed/pasted 9 and 8, fixed +7, mask backspace, middle/forward deletion and incomplete validation");
}
