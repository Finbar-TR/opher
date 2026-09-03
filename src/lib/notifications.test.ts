import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: Array<{ to: string; subject: string; html: string }> = [];

vi.mock("./email", () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => {
    sent.push(m);
  },
  emailLayout: (body: string) => body,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
}));

const order = {
  id: "ord_1",
  totalPence: 2200,
  cancellationDeadline: new Date("2026-12-16T08:00:00Z"),
  user: { email: "a@test", name: "Aisha" },
  tier: { label: "Medium (5 kg)" },
  basket: { sku: { product: { name: "White Yam" } }, city: { name: "Sheffield" } },
  window: { deliveryDate: new Date("2026-12-19T00:00:00Z") },
};

vi.mock("./prisma", () => ({
  prisma: {
    order: { findUnique: async () => order },
  },
}));

beforeEach(() => {
  sent.length = 0;
});

describe("sendJoinConfirmation", () => {
  it("names the delivery date, the charge date and how to cancel", async () => {
    const { sendJoinConfirmation } = await import("./notifications");
    await sendJoinConfirmation("ord_1");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@test");
    expect(sent[0].html).toContain("White Yam");
    expect(sent[0].html).toContain("Saturday 19 December");
    expect(sent[0].html).toContain("Wednesday 16 December");
    expect(sent[0].html.toLowerCase()).toContain("cancel");
  });

  it("never claims the order might not be charged", async () => {
    const { sendJoinConfirmation } = await import("./notifications");
    await sendJoinConfirmation("ord_1");
    const html = sent[0].html.toLowerCase();
    expect(html).not.toContain("if enough");
    expect(html).not.toContain("minimum");
    expect(html).not.toContain("fills");
  });
});

describe("sendChargeFailed", () => {
  it("explains the retry and links to the order", async () => {
    const { sendChargeFailed } = await import("./notifications");
    await sendChargeFailed("ord_1");
    expect(sent[0].subject.toLowerCase()).toContain("payment");
    expect(sent[0].html).toContain("/orders/ord_1");
  });

  it("never tells the customer to update their card — there is no way to do that", async () => {
    const { sendChargeFailed } = await import("./notifications");
    await sendChargeFailed("ord_1");
    const html = sent[0].html.toLowerCase();
    expect(html).not.toContain("update your card");
    expect(html).not.toContain("update it");
  });
});

describe("sendOrderReleased", () => {
  it("tells the customer the order was cancelled and no money was taken", async () => {
    const { sendOrderReleased } = await import("./notifications");
    await sendOrderReleased("ord_1");
    const html = sent[0].html.toLowerCase();
    expect(html).toContain("cancel");
    expect(html).toContain("not been charged");
  });
});
