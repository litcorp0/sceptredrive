import type { TerminalListQuery } from "../types"

/**
 * Every key the terminals module owns. The root stays `["terminals"]` so the dashboard's
 * pre-Phase-8 card key and the four invalidations written before Phase 8 still match the list.
 */
export const terminalKeys = {
	all: ["terminals"] as const,
	list: (query: TerminalListQuery) => [...terminalKeys.all, query] as const,
	devices: (terminalId: string) => [...terminalKeys.all, terminalId, "devices"] as const,
}
