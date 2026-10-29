// The header's name field is opened from elsewhere on the page: the menu's "Change name", and
// a form the server refused for want of a name. The event carries the refusal's text, which
// the page read from a signed notice (lib/notice.ts), never from the URL directly.
export const ASK_NAME = "hr:ask-name";
export function askName(text?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(ASK_NAME, { detail: text }));
}
