import { env } from "#/env"
import type {
	AuditEntry,
	AuditListQuery,
	Branch,
	BranchCreateInput,
	BranchListQuery,
	BranchUpdateInput,
	ChangePasswordInput,
	CreateStaffResult,
	Device,
	Enrollment,
	ResetPasswordResult,
	ResolvedSetting,
	SettingsUpdateInput,
	Staff,
	StaffCreateInput,
	StaffListQuery,
	StaffUpdateInput,
	SuggestCode,
	Terminal,
	TerminalCreateInput,
	TerminalListQuery,
	TerminalUpdateInput,
} from "./api-types"

export class ApiError extends Error {
	readonly status: number
	readonly code: string
	readonly requestId: string | undefined

	constructor(status: number, code: string, message: string, requestId?: string) {
		super(message)
		this.name = "ApiError"
		this.status = status
		this.code = code
		this.requestId = requestId
	}
}

type QueryValue = string | number | boolean | undefined

interface RequestOptions {
	method?: "GET" | "POST" | "PATCH" | "DELETE"
	body?: unknown
	query?: Record<string, QueryValue>
	signal?: AbortSignal
	/** Set to false for calls made from the login flow itself. */
	redirectOn401?: boolean
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
	const url = new URL(path, env.VITE_API_URL)
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined) continue
			url.searchParams.set(key, String(value))
		}
	}
	return url
}

function currentLocation(): string {
	if (typeof window === "undefined") return "/"
	return window.location.pathname + window.location.search
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const response = await fetch(buildUrl(path, options.query), {
		method: options.method ?? "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
		signal: options.signal,
	})

	if (!response.ok) {
		let envelope: { message?: string; code?: string; requestId?: string } | undefined
		try {
			const payload = (await response.json()) as { error?: typeof envelope } | null
			envelope = payload?.error
		} catch {
			envelope = undefined
		}

		const requestId = envelope?.requestId ?? response.headers.get("x-request-id") ?? undefined

		if (
			response.status === 401 &&
			options.redirectOn401 !== false &&
			typeof window !== "undefined"
		) {
			const redirect = encodeURIComponent(currentLocation())
			window.location.assign(`/login?redirect=${redirect}`)
		}

		throw new ApiError(
			response.status,
			envelope?.code ?? "HTTP_ERROR",
			envelope?.message ?? "Request failed",
			requestId,
		)
	}

	if (response.status === 204) return undefined as T
	return (await response.json()) as T
}

/** True when the API asks for a fresh sign-in before a sensitive action. */
export function isReauthRequired(error: unknown): boolean {
	return error instanceof ApiError && error.code === "REAUTH_REQUIRED"
}

export const api = {
	branches: {
		list: (query: BranchListQuery = {}) =>
			apiRequest<{ branches: Branch[] }>("/api/branches", { query }),
		get: (id: string) => apiRequest<{ branch: Branch }>(`/api/branches/${id}`),
		create: (input: BranchCreateInput) =>
			apiRequest<{ branch: Branch }>("/api/branches", { method: "POST", body: input }),
		update: (id: string, input: BranchUpdateInput) =>
			apiRequest<{ branch: Branch }>(`/api/branches/${id}`, { method: "PATCH", body: input }),
		deactivate: (id: string) =>
			apiRequest<{ branch: Branch }>(`/api/branches/${id}/deactivate`, { method: "POST" }),
		suggestCode: (query: { city: string; area?: string; type: string }) =>
			apiRequest<SuggestCode>("/api/branches/suggest-code", { query }),
	},

	terminals: {
		list: (query: TerminalListQuery = {}) =>
			apiRequest<{ terminals: Terminal[] }>("/api/terminals", { query }),
		get: (id: string) => apiRequest<{ terminal: Terminal }>(`/api/terminals/${id}`),
		create: (input: TerminalCreateInput) =>
			apiRequest<{ terminal: Terminal }>("/api/terminals", { method: "POST", body: input }),
		update: (id: string, input: TerminalUpdateInput) =>
			apiRequest<{ terminal: Terminal }>(`/api/terminals/${id}`, { method: "PATCH", body: input }),
		devices: (id: string) => apiRequest<{ devices: Device[] }>(`/api/terminals/${id}/devices`),
		revokeDevice: (id: string) =>
			apiRequest<{ device: Device }>(`/api/devices/${id}/revoke`, { method: "POST" }),
		createEnrollment: (id: string) =>
			apiRequest<{ enrollment: Enrollment }>(`/api/terminals/${id}/enrollment`, {
				method: "POST",
			}),
	},

	staff: {
		list: (query: StaffListQuery = {}) =>
			apiRequest<{ staff: Staff[]; total: number }>("/api/staff", { query }),
		get: (id: string) => apiRequest<{ staff: Staff }>(`/api/staff/${id}`),
		create: (input: StaffCreateInput) =>
			apiRequest<CreateStaffResult>("/api/staff", { method: "POST", body: input }),
		update: (id: string, input: StaffUpdateInput) =>
			apiRequest<{ staff: Staff }>(`/api/staff/${id}`, { method: "PATCH", body: input }),
		resetPassword: (id: string) =>
			apiRequest<ResetPasswordResult>(`/api/staff/${id}/reset-password`, { method: "POST" }),
		deactivate: (id: string) =>
			apiRequest<{ staff: Staff }>(`/api/staff/${id}/deactivate`, { method: "POST" }),
		reactivate: (id: string) =>
			apiRequest<{ staff: Staff }>(`/api/staff/${id}/reactivate`, { method: "POST" }),
		changeOwnPassword: (input: ChangePasswordInput) =>
			apiRequest<{ ok: true }>("/api/me/password", { method: "POST", body: input }),
	},

	audit: {
		list: (query: AuditListQuery = {}) =>
			apiRequest<{ entries: AuditEntry[]; total: number }>("/api/audit", { query }),
	},

	settings: {
		list: (query: { branchId?: string } = {}) =>
			apiRequest<{ settings: ResolvedSetting[]; branchId: string | null }>("/api/settings", {
				query,
			}),
		update: (input: SettingsUpdateInput) =>
			apiRequest<{ setting: ResolvedSetting }>("/api/settings", { method: "PATCH", body: input }),
	},
}
