import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	Device,
	Enrollment,
	Terminal,
	TerminalCreateInput,
	TerminalListQuery,
	TerminalUpdateInput,
} from "../types"
import { terminalKeys } from "./keys"

export function terminalListOptions(query: TerminalListQuery = {}) {
	return queryOptions({
		queryKey: terminalKeys.list(query),
		queryFn: () => apiRequest<{ terminals: Terminal[] }>("/api/terminals", { query }),
	})
}

export function terminalDetailOptions(id: string) {
	return queryOptions({
		queryKey: [...terminalKeys.all, id] as const,
		queryFn: () => apiRequest<{ terminal: Terminal }>(`/api/terminals/${id}`),
	})
}

export function createTerminal(input: TerminalCreateInput) {
	return apiRequest<{ terminal: Terminal }>("/api/terminals", { method: "POST", body: input })
}

export function updateTerminal(id: string, input: TerminalUpdateInput) {
	return apiRequest<{ terminal: Terminal }>(`/api/terminals/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function terminalDevicesOptions(terminalId: string) {
	return queryOptions({
		queryKey: terminalKeys.devices(terminalId),
		queryFn: () => apiRequest<{ devices: Device[] }>(`/api/terminals/${terminalId}/devices`),
	})
}

export function revokeDevice(id: string) {
	return apiRequest<{ device: Device }>(`/api/devices/${id}/revoke`, { method: "POST" })
}

export function createEnrollment(id: string) {
	return apiRequest<{ enrollment: Enrollment }>(`/api/terminals/${id}/enrollment`, {
		method: "POST",
	})
}
