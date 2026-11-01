// The header's name field is opened from elsewhere on the page: the menu's "Change name".
export const ASK_NAME = "hr:ask-name";
export function askName() {
  window.dispatchEvent(new Event(ASK_NAME));
}
