// A problem with one field of a form is shown beside it: the field is marked invalid and
// described by the message, and the page moves focus to it. `on` names the form, `name` the field.
export type Bad = { on: string; field: string; text: string } | undefined;
export const fieldId = (on: string, name: string) => `${on}-${name}`;
export function invalid(bad: Bad, on: string, name: string) {
  const id = fieldId(on, name), is = bad?.on === on && bad.field === name;
  return { id, ...(is ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}) };
}
export function Problem({ bad, on, name }: { bad: Bad; on: string; name: string }) {
  return bad?.on === on && bad.field === name ? <p id={`${fieldId(on, name)}-error`} className="field-error" role="alert">{bad.text}</p> : null;
}
