/**
 * Commerce assistant (Milestone 6) — honestly UNAVAILABLE.
 *
 * Commerce (products, orders, payments) arrives in Milestone 8. There is
 * no product data to work with yet, so this agent has no handler that
 * could do real work. The registry marks it unavailable with this reason
 * and the command centre shows it as such; task creation for it is
 * rejected with the same reason. It is listed here (not hidden) so the
 * roster is complete and the gap is visible.
 */
import type { AgentDefinition } from "../types";

export const commerceAssistant: AgentDefinition = {
  id: "commerce-assistant",
  name: "Commerce Assistant",
  description:
    "Will help with products, orders and payments when commerce lands in Milestone 8. Not available yet — there is no product or order data to work with.",
  capabilities: ["Products and orders (Milestone 8)", "Payments (Milestone 8)"],
  risk: "high",
  requiresProvider: false,
  unavailableReason:
    "Commerce (products, orders, payments) arrives in Milestone 8. This agent cannot run until then.",
  async run(): Promise<never> {
    // Unreachable: the orchestrator rejects tasks for unavailable agents.
    throw new Error("Commerce assistant is unavailable until Milestone 8.");
  },
};
