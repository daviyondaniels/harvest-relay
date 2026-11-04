import type { Metadata } from "next";
import { previewOrderChange } from "../../../src/order-change.ts";
import { normalize } from "../../../src/quantity.ts";
import { current } from "../../lib/hub.ts";
import { buyer, quantity, time, weight } from "../../lib/format.ts";
import { readNotice } from "../../lib/notice.ts";
import { rememberedName } from "../../lib/name.ts";
import { fieldId, invalid, Problem, type Bad } from "../../lib/field-error.tsx";
import { NamedSubmit } from "../../named-submit.tsx";
import { Result } from "../../result.tsx";
import { changeQuantityAction } from "./actions.ts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Adjust order quantity" };
export default async function Adjust({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, str = (k: string, max: number) => typeof params[k] === "string" ? (params[k] as string).slice(0, max) : "";
  const { state: w, version } = await current(), order = w.ledger.snapshot.orders.find(o => o.id === str("order", 160));
  if (!order) return <section className="panel"><h1>Choose an order first</h1><a href="/orders">Back to orders</a></section>;
  const q = normalize(order.quantity), amount = str("amount", 12), reason = str("reason", 500), notice = readNotice(params, { page: "/orders/adjust", id: order.id });
  let preview: ReturnType<typeof previewOrderChange> | undefined, problem: string | undefined, problemField = "amount";
  if (amount || reason) {
    try {
      if (!/^\d{1,9}$/.test(amount)) throw new Error("Enter a positive whole quantity.");
      if (!reason.trim()) { problemField = "reason"; throw new Error("Enter the reason or buyer instruction."); }
      preview = previewOrderChange(w, { orderId: order.id, amount: Number(amount), reason });
    } catch (e) { problem = e instanceof Error ? e.message : "Check the quantity and reason."; }
  }
  const previewBad: Bad = problem ? { on: "quantity-preview", field: problemField, text: problem } : undefined;
  const bad: Bad = notice?.field === "who" ? { on: "order-change", field: "who", text: notice.text } : undefined;
  return <>
    <section className="panel" aria-labelledby="adjust-title">
      <a href={`/orders?order=${encodeURIComponent(order.id)}`}>Back to {buyer(order.buyerId)}'s order</a>
      <h1 id="adjust-title" tabIndex={-1}>Adjust order quantity</h1>
      <p>{buyer(order.buyerId)} currently wants <b>{quantity(order.quantity)} {order.product}</b>. This changes demand only; it does not record buyer consent or deliver a message.</p>
      <p className="muted small">Product, buyer, grade, delivery day and substitution permissions stay as recorded. Quantities are entered in {q.unit}. Promises cannot be reduced here; packed orders cannot be edited.</p>
      {notice && <Result key={String(params.sig)} text={notice.ok ? notice.text : undefined} focus={bad ? fieldId(bad.on, bad.field) : "adjust-title"} />}
      {notice && !notice.ok && !notice.field && <p className="error" role="alert">{notice.text}</p>}
      <form action="/orders/adjust" method="get" noValidate>
        <input type="hidden" name="order" value={order.id} />
        <label>New quantity ({q.unit})<input name="amount" inputMode="numeric" required maxLength={12} defaultValue={amount || String(q.amount)} {...invalid(previewBad, "quantity-preview", "amount")} /></label>
        <Problem bad={previewBad} on="quantity-preview" name="amount" />
        <label>Reason or buyer instruction<textarea name="reason" required maxLength={500} rows={3} defaultValue={reason} {...invalid(previewBad, "quantity-preview", "reason")} /></label>
        <Problem bad={previewBad} on="quantity-preview" name="reason" />
        <button type="submit">Preview impact</button>
      </form>
    </section>
    {preview && <section className="panel" aria-labelledby="impact-title">
      <h2 id="impact-title" tabIndex={-1}>Check the impact before confirming</h2>
      <p>{weight(preview.before.amount, q.unit)} → <b>{weight(preview.after.amount, q.unit)}</b>. Reason: {preview.reason}</p>
      <p>These quantities are planned until confirmed. Existing promises stay held. Other buyers are shown if their covered or short quantity changes.</p>
      <div className="table-wrap"><table><caption className="sr-only">Order change impact</caption><thead><tr><th scope="col">Buyer</th><th scope="col">Covered before → after</th><th scope="col">Short before → after</th></tr></thead><tbody>{preview.impact.map(x => {
        const o = w.ledger.snapshot.orders.find(o => o.id === x.orderId)!, unit = normalize(o.quantity).unit;
        return <tr key={x.orderId}><th scope="row">{buyer(o.buyerId)} · {o.product}</th><td>{weight(x.beforeCovered, unit)} → {weight(x.afterCovered, unit)}</td><td>{weight(x.beforeShort, unit)} → {weight(x.afterShort, unit)}</td></tr>;
      })}</tbody></table></div>
      <form action={changeQuantityAction} noValidate>
        <input type="hidden" name="order" value={order.id} /><input type="hidden" name="version" value={version} /><input type="hidden" name="amount" value={preview.after.amount} /><input type="hidden" name="reason" value={preview.reason} /><input type="hidden" name="reviewHash" value={preview.reviewHash} />
        <NamedSubmit known={!!await rememberedName()} on="order-change" purpose="this order change" bad={bad} className="primary" label="Confirm order change" />
      </form>
      <p className="fine-print">Confirmation records your name and reason. Any intervening change requires another review. Check and confirm the plan again afterward.</p>
    </section>}
    {!!w.orderChanges?.some(x => x.orderId === order.id) && <section className="panel"><h2>Quantity history</h2><ul>{w.orderChanges.filter(x => x.orderId === order.id).map(x => <li key={x.id}>{x.by}, {time(x.at)}: {quantity(x.before)} → {weight(x.after.amount, x.after.unit)}. {x.reason}</li>)}</ul><p className="small">Full records are included in the day export.</p></section>}
  </>;
}
