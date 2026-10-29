// Small inline icons; stroke follows the text colour.
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const Arrow = () => <svg {...base}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const Crate = () => <svg {...base}><path d="M3 8h18v11H3zM3 8l2-4h14l2 4M8 12h8" /></svg>;
export const Basket = () => <svg {...base}><path d="M4 10h16l-2 9H6zM9 10l3-6 3 6M9 14v2M15 14v2" /></svg>;
export const Gap = () => <svg {...base}><path d="M12 4v10M12 18v.5M4 20h16L12 4z" /></svg>;
export const Message = () => <svg {...base}><path d="M4 5h16v11H9l-5 4z" /></svg>;
export const Calendar = () => <svg {...base}><path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" /></svg>;
