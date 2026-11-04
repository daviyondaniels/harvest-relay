"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { commitOrderChange } from "../../../src/order-change.ts";
import { act } from "../../lib/hub.ts";
import { forgetOldName, rememberName, rememberedName } from "../../lib/name.ts";
import { runAs } from "../../lib/names.ts";
import { keepWho } from "../../lib/kept.ts";
import { signNotice } from "../../lib/notice.ts";
const value = (f: FormData, key: string, max: number) => typeof f.get(key) === "string" ? String(f.get(key)).slice(0, max) : "";
export async function changeQuantityAction(f: FormData) {
  const order = value(f, "order", 160), amount = value(f, "amount", 12), reason = value(f, "reason", 501);
  const params = new URLSearchParams({ order, amount, reason });
  try {
    if (!/^\d{1,9}$/.test(amount)) throw new Error("Enter a positive whole quantity.");
    await forgetOldName();
    await runAs(f.get("who"), await rememberedName(), rememberName, async who => {
      await act(Number(value(f, "version", 16)), w => commitOrderChange(w, { orderId: order, amount: Number(amount), reason }, value(f, "reviewHash", 65), who, new Date().toISOString()));
    });
  } catch (e) {
    const field = e && typeof e === "object" && "field" in e && e.field === "who" ? "who" : undefined;
    for (const [key, val] of Object.entries({ ...keepWho(f), ...signNotice({ text: e instanceof Error ? e.message : "The change could not be saved.", on: "order-change", field }, { page: "/orders/adjust", id: order }) })) params.set(key, val);
    redirect(`/orders/adjust?${params}`);
  }
  revalidatePath("/", "layout");
  redirect(`/orders?${new URLSearchParams({ order, ...signNotice({ ok: true, text: "Order quantity changed and recorded. Check the plan and confirm it again before packing this order." }, { page: "/orders", id: order }) })}`);
}
